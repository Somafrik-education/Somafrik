# NFC-P0-R3 — Audit : récupération des cartes NFC vierges à propriétaire inconnu

**Statut : AUDIT / DRAFT / HOLD — aucun merge.** Révision 2 : intègre la revue indépendante CTO (§0).
Base auditée : `develop` @ `2adae00` (R2 inclus). Aucune écriture NFC ni mutation PostgreSQL n'a été réalisée.
Les preuves SQL ont été exécutées uniquement sur une base PostgreSQL 16 **locale et jetable**, chargée avec `backend/db/schema.sql` et un jeu de données synthétique.

> **Limite de cet audit.** Je n'ai accès ni à la base de préproduction (proxy réseau) ni aux huit cartes physiques.
> L'inventaire nominatif des huit cartes (livrables 1 et 2) est donc fourni sous forme de **procédure exécutable et de gabarit**, avec une requête de diagnostic **validée sur 15 cas synthétiques**.
> Le diagnostic réel de chaque carte s'obtient en exécutant le §6 (environ 30 minutes, lecture seule).

---

## 0. Revue CTO — décisions et corrections (révision 2)

**Audit accepté sous réserves — HOLD.** Revue faite sur HEAD `e4b8c8f`.

| Décision | Verdict CTO |
| --- | --- |
| Q1 — Les 14 diagnostics | Approuvé sous réserves (corrections ci-dessous). Un 15ᵉ cas synthétique a été ajouté : révocation de sécurité d'une réservation jamais encodée |
| Q2 — Validation d'une réattribution | **Deux approbateurs distincts** pour toute réattribution |
| Q3 — Index unique partiel | **Non autorisé pour l'instant.** R3-B reste une étude |
| Q4 — Réécriture d'une carte active effacée | **Exclue** du chantier R3 initial |
| Q5 — Diagnostic des huit cartes | **Autorisé en lecture seule**, personne habilitée uniquement. Aucun changement d'attribution, aucune écriture NFC, aucune suppression |

**Priorité : retrouver les titulaires d'origine.** Si les huit cartes sont des réservations expirées éligibles, R2 suffit, sans toucher à l'index global.

**Ordre de travail approuvé**
1. R3-1, diagnostic backend.
2. R3-2, diagnostic Android.
3. R3-3, prévention.

R3-4 et R3-5 restent en HOLD jusqu'à l'inventaire réel et une nouvelle validation de l'architecture de réattribution.

**Corrections demandées et apportées**

| # | Demande CTO | Correction | Preuve |
| --- | --- | --- | --- |
| C-1 | Séparer explicitement la recherche globale d'UID et l'accès aux détails : plus de `c.*`, plus de lecture du titulaire avant masquage | Requête en deux étapes. **Étape 1** `global_lookup` : seule lecture inter-établissements, limitée à `(nfc_uid, school_id = :school_id)`. **Étape 2** `school_cards` / `school_holders` : colonnes explicites, filtre `school_id` **dans la lecture** de la table et dans chaque sous-requête du titulaire. Aucun `*` dans la requête | `diagnostic-r3-readonly.sql` (rév. 2) : 15/15 conformes. `preuve-cloisonnement.sql` : séparation **imposée par PostgreSQL** (C1 : rôle limité aux colonnes `nfc_uid, school_id`, lecture du statut refusée ; C2 : RLS par établissement, carte d'un autre établissement invisible) |
| C-2 | La contrainte de libération ne vérifiait pas le motif historique : un SQL fautif pouvait libérer une révocation de sécurité | Contrainte couplée au motif : seuls `nfc_reservation_expired` et `nfc_cancelled` (R3-3) sont libérables, chacun avec son motif de libération ; remplacement exclu. **Trigger** : motif de révocation figé (aucune requalification `revoked` → expiration) et ligne libérée immuable. Les reprises R1/R2 restent admises | `prototype-r3b-liberation.sql` (rév. 2) : P7 sécurité jamais encodée refusée, P8 requalification refusée, P9 `nfc_abandoned` refusé, P10 R2 toujours possible, P11 ligne libérée immuable |

## 1. Synthèse

| Constat | Conséquence |
| --- | --- |
| L'index `student_access_cards_nfc_uid_unique` est **global** (tous établissements) et **permanent**, quel que soit le statut de la ligne. | Un UID déjà réservé une fois, même pour une réservation expirée et jamais écrite, ne peut plus jamais être réservé par une autre ligne. |
| Le refus renvoie `STUDENT_CARD_NFC_UID_EXISTS` (« Cette carte physique est déjà affectée »), produit par la violation d'index (`23505`). | Le message n'indique ni l'élève, ni l'état, ni l'action possible. |
| **Aucune route ne retrouve une carte à partir de son UID.** R1 et R2 exigent l'identifiant de carte, qu'on obtient uniquement depuis la fiche d'un élève. | R2 fonctionne quand on connaît l'élève ; avec huit cartes « anonymes », il est inatteignable. **C'est le blocage principal.** |
| R2 refuse si le titulaire est inactif, s'il a déjà une autre carte active ou réservation, ou si la réservation était un **remplacement**. | Même après identification, certaines cartes vierges restent bloquées sans aucune issue. |
| Une révocation manuelle d'une réservation jamais écrite enregistre le motif `revoked`, identique à une révocation de sécurité. | Une carte simplement annulée devient indiscernable d'une carte compromise, et donc bloquée définitivement. |
| `nfc_abandoned` est accepté par le backend mais n'est envoyé par aucun client (Web ou Mobile). | Il n'existe aucun motif « annulation non sensible » utilisable aujourd'hui. |

**Hypothèse la plus probable pour les huit cartes** (à confirmer par le §6) : réservations de programmation (individuelle ou par lot) expirées sans écriture réussie. Leur UID est alors resté réservé pour un élève de **votre** établissement.
- Dans ce cas, R3-A suffit à les rendre récupérables par R2 pour leur titulaire d'origine.
- Ce n'est pas le cas pour les sous-cas « titulaire inactif / déjà équipé / remplacement », qui demandent R3-B.

---

## 2. Cycle de vie actuel et points de blocage (R3-D)

```
réservation (issued/pending, 30 min) ──écriture+relecture+confirm──▶ active/encoded ──▶ lost | replaced | revoked
      │                                                                    └── (observation) active/locked
      ├── délai dépassé ─▶ revoked / nfc_reservation_expired   ◀── R1 (puce déjà écrite)  ◀── R2 (puce vierge, même élève)
      └── révocation manuelle ─▶ revoked / revoked              ◀── aucune reprise possible
```

| # | Point de blocage | Effet sur une carte pourtant saine |
| --- | --- | --- |
| B1 | UID unique pour toujours (index global non partiel) | Aucune nouvelle attribution possible, même si l'ancienne n'a jamais servi |
| B2 | Pas de recherche par UID | Propriétaire « inconnu » : R1/R2 inatteignables |
| B3 | R2 limité au titulaire actif sans autre carte | Titulaire parti ou déjà rééquipé : carte perdue pour l'école |
| B4 | Remplacement expiré exclu de R2 | La carte neuve d'un remplacement raté est bloquée |
| B5 | Motif `revoked` partagé entre annulation et sécurité | Impossible de distinguer une annulation sans risque d'une compromission |
| B6 | Expiration « paresseuse » par élève | Tant que la fiche de l'élève n'est pas relue, l'état stocké reste `issued` (sans danger, mais trompeur dans un inventaire) |

---

## 3. R3-A — Diagnostic par lecture NFC

### 3.1 Taxonomie validée (requête `evidence/nfc-p0-r3/diagnostic-r3-readonly.sql`)

Les 14 codes (15 cas) ont été validés sur base locale (`diagnostic-r3-fixtures.expected.csv`).

| Code | Condition (ligne PostgreSQL de l'UID) | Motif de refus expliqué | Actions autorisées |
| --- | --- | --- | --- |
| `UID_UNKNOWN` | Aucune ligne | Le refus ne vient pas de l'unicité UID | Vérifier modèle, lecture seule, NDEF ; reprendre la programmation normale |
| `OTHER_SCHOOL` | Ligne d'un **autre** établissement | « Carte gérée par un autre établissement » | **Aucune.** Aucun détail. Restitution à l'école d'origine ; procédure plateforme manuelle |
| `LIVE_RESERVATION` | `issued/pending`, délai non échu | Opération en cours (≤ 30 min) | Reprendre l'opération existante |
| `EXPIRED_NOT_MATERIALISED` | `issued/pending`, délai échu | Réservation expirée non encore matérialisée | Relire la fiche du titulaire (matérialise), puis R2 |
| `R2_ELIGIBLE` | Expirée, jamais encodée, pas un remplacement, titulaire actif sans autre carte | Réservation expirée du titulaire X | **R2** pour le titulaire d'origine, sans transfert |
| `EXPIRED_HOLDER_INACTIVE` | Idem, titulaire inactif | Titulaire n'est plus actif | R3-B (libération autorisée) |
| `EXPIRED_HOLDER_HAS_CARD` | Idem, titulaire déjà équipé ou réservation vivante | Titulaire a déjà une carte | R3-B |
| `EXPIRED_REPLACEMENT` | Réservation de remplacement expirée | Remplacement non abouti | R3-B (l'ancienne carte du titulaire n'est pas touchée) |
| `REVOKED_NEVER_ENCODED` | `revoked` (`revoked` / `nfc_abandoned`), jamais encodée | Annulation manuelle **ou** sécurité : indiscernable aujourd'hui | **Non libérable** (C-2). Revue humaine ; seule une future annulation explicite `nfc_cancelled` (R3-3) serait éligible |
| `ACTIVE` | `active/encoded` | Carte en service ; puce vierge, donc effacée | Déclarer perdue et remplacer ; ou réécriture même élève (option, §5.3) |
| `LOST` | `lost` | Déclarée perdue/volée | **Non récupérable** |
| `REPLACED` | `replaced` | Remplacée | **Non récupérable** |
| `REVOKED_SECURITY` | `revoked`, déjà encodée | Révocation de sécurité | **Non récupérable** |
| `LOCKED_RECORDED` | `locked` ou `nfc_locked_at` | Verrouillage enregistré | **Non récupérable** |

Ces codes sont croisés avec l'observation **physique**, faite sans écriture :

| Observation physique | Diagnostic | Effet |
| --- | --- | --- |
| Puce en lecture seule (CC `0F`, verrous, AUTH0 ≠ `FF`) | Carte verrouillée physiquement | Non récupérable, quel que soit le code base |
| NDEF `somafrik:card:` avec le `publicId` de **cette** ligne | Puce déjà écrite | R1 (récupération sans réécriture), pas R3 |
| NDEF `somafrik:card:` avec un autre `publicId` | Contenu suspect | Refus, signalement, aucune écriture |
| NDEF étranger (URL, texte, autre) | Contenu non Somafrik | Refus, jamais effacé automatiquement |
| Modèle ≠ NTAG213/216 ou ≠ modèle réservé | Puce non conforme | Refus |

### 3.2 Architecture proposée

**Backend — `POST /api/student-cards/nfc-diagnose` (lecture seule, sauf audit)**

- Entrée : `{ uid, tagType, ndef: { state: "empty" | "somafrik" | "foreign" | "unreadable", publicId? }, readOnly }`.
  - Le **secret NDEF n'est jamais envoyé** : le mobile extrait seulement le `publicId`, qui n'est pas un justificatif.
- Droits : nouvelle permission dédiée, réservée à la direction et aux administrateurs de l'établissement, au moins équivalente à `POST /api/student-cards/:id/nfc-confirm`. `authorize()` impose le même établissement d'inscription.
- Requête en **deux accès séparés** (correction C-1) :
  1. **Recherche globale minimale.** Fonction PostgreSQL dédiée (`SECURITY DEFINER`, propriétaire à droits de colonne limités à `nfc_uid, school_id`). Elle renvoie uniquement `{ exists, sameSchool }`. C'est la seule lecture qui traverse les établissements, imposée par l'unicité globale.
  2. **Détails.** Lecture bornée à `school_id = établissement de l'utilisateur`, colonnes explicites. La RLS est recommandée en défense en profondeur (preuve C2). Elle ne s'exécute **que** si `sameSchool = true`.
  - Pour une carte d'un autre établissement, la route s'arrête après l'étape 1. Aucune ligne de cet établissement n'est lue au-delà de `(nfc_uid, school_id)`.
- Réponse :
  - `{ code, reasons[], actions[] }` ;
  - pour **le même établissement uniquement** : `card { id, status, state, issuedDay }` et `holder { nom affichable, classe, actif }`. L'élève appartient à l'établissement de l'utilisateur, qui a déjà le droit de le voir.
- Aucune matérialisation d'expiration dans cette route : elle reste en lecture seule.
- Audit `student_card_nfc_diagnosed` : UID haché ou masqué, code, utilisateur, sans contenu NDEF.
- Limitation de débit par utilisateur, par exemple 30 diagnostics par 10 minutes, contre l'énumération d'UID.

**Mobile — « Diagnostiquer une carte NFC » (espace direction)**

- Réutilise les primitives en lecture de R2 : `inspect`, `openNdef`, `readText`, `isReadOnly`.
  - **Aucun** appel à `writeText`, `makeReadOnly`, `formatNdef` ni `transceive` d'écriture ; le garde NFC existant le vérifie.
- Affiche le motif et les actions autorisées.
- Les actions R1/R2 renvoient vers la fiche du titulaire, qui exécute les flux existants et déjà testés. Le diagnostic n'exécute aucune action lui-même.

---

## 4. R3-B — Récupération contrôlée (étude)

### 4.1 Principe : unicité de l'attribution **courante**, historique intact

Les options écartées sont refusées par le mandat ou détruisent l'historique :
- supprimer la ligne ;
- remettre `nfc_uid` à NULL (interdit en plus par la contrainte `student_access_cards_nfc_check`) ;
- changer le `student_id` de la ligne ;
- désactiver l'index.

> **HOLD — décision CTO Q3 : index partiel non autorisé pour l'instant.** Cette section décrit l'option étudiée et les garanties qu'elle devrait offrir. Elle n'autorise aucune implémentation.

**Option étudiée (prototype : `evidence/nfc-p0-r3/prototype-r3b-liberation.sql`, rév. 2)**

1. Colonnes additives : `nfc_uid_released_at`, `nfc_uid_release_reason`. L'ancienne ligne garde son UID, son titulaire, ses dates et ses audits.
2. Contrainte `CHECK` (corrigée, C-2) : une ligne libérée est `revoked`, `pending`, jamais encodée, jamais verrouillée, pas un remplacement, **et** son motif historique est non sensible et couplé au motif de libération :
   - `nfc_reservation_expired` donne `expired_never_encoded` ;
   - `nfc_cancelled` (R3-3) donne `cancelled_never_encoded`.

   Une carte active, perdue, remplacée, verrouillée, révoquée pour sécurité (même jamais encodée) ou `nfc_abandoned` est **non libérable**, même par un SQL fautif (preuves P6, P7, P9).
   - **Trigger de garde** : le motif d'une révocation est figé, donc pas de requalification de `revoked` en expiration (P8). Seule sortie admise : la reprise R1/R2 d'une réservation expirée (P10). Une ligne libérée est immuable (P11).
3. Index unique **partiel** `nfc_uid WHERE nfc_uid IS NOT NULL AND nfc_uid_released_at IS NULL`.
   - Il reste global, tous établissements confondus.
   - Il ne cesse jamais d'exister : il est créé `CONCURRENTLY` **avant** le retrait de l'ancien index.
   - Une seconde attribution courante reste refusée (preuve P4).
4. La nouvelle attribution est une **nouvelle ligne** : nouveau `public_id`, nouveau secret, nouvelle opération.
   - L'ancien `token_hash` reste sur la ligne révoquée. Un éventuel ancien jeton reste donc rejeté.
   - **Aucun ancien secret n'est réutilisé.**

### 4.2 Procédure transactionnelle de réattribution

La procédure tient en une transaction : libération et nouvelle réservation sont atomiques, pour que l'UID ne reste jamais « libre » entre les deux.

1. `authorize` : établissement d'inscription égal à celui de la ligne ; permission dédiée de réattribution, **distincte** de la programmation.
2. Lecture physique dans la même session NFC :
   - UID et modèle identiques à la ligne ;
   - NDEF **vide** ;
   - puce non verrouillée.
   L'observation est envoyée avec la demande.
3. Verrous : élève d'origine, ligne (`FOR UPDATE`), nouvel élève, et verrou consultatif sur le hachage de l'UID.
4. Gardes rejouées sous verrou :
   - code ∈ {`EXPIRED_HOLDER_INACTIVE`, `EXPIRED_HOLDER_HAS_CARD`, `EXPIRED_REPLACEMENT`}, ou `R2_ELIGIBLE` si la direction refuse R2 ;
   - pour `REVOKED_NEVER_ENCODED`, uniquement avec le nouveau motif `nfc_cancelled` (§5).
5. Autorisation explicite (décision Q2) :
   - justification texte obligatoire ;
   - **deux approbateurs distincts**, l'initiateur et un second membre habilité de la direction, vérifiés côté serveur (identifiants différents, rôles relus en base) ;
   - les deux identités sont tracées dans l'audit.
6. `UPDATE … SET nfc_uid_released_at …` avec gardes dans le `WHERE` (preuve P1/P5), puis réservation canonique pour le nouvel élève via le code de `reserveStudentCardNfc`, puis écriture, relecture et confirmation standard.
7. Audits dans la même transaction, sans aucun secret :
   - `student_card_nfc_uid_released` sur l'ancienne ligne (ancien statut, motif, justification, approbateurs) ;
   - `student_card_nfc_reserved` sur la nouvelle ligne avec `releasedFromCardId`.

**Propriétaire d'origine inconnu.** Le diagnostic R3-A le rend connu de l'établissement. Aucun transfert n'est automatique : la réattribution n'est jamais proposée par défaut. La règle reste :
- R2 pour le titulaire d'origine quand il est éligible ;
- sinon R3-B sur décision explicite.

**Carte d'un autre établissement.** Aucune libération possible depuis l'école présentatrice. Seul l'établissement propriétaire peut libérer, ou une procédure plateforme manuelle validée par le CTO. Aucun outil automatique n'est prévu.

---

## 5. R3-C et R3-D — Cartes non récupérables et prévention

### 5.1 Non récupérables, sans aucun contournement

`ACTIVE` (hors option §5.3), `LOST`, `REPLACED`, `REVOKED_SECURITY`, `LOCKED_RECORDED`, `OTHER_SCHOOL`, puce physiquement verrouillée, NDEF non vide ou suspect.
- Chacun a son message dédié (§3.1).
- La contrainte de base de R3-B refuse leur libération.
- Aucune action d'effacement n'est proposée.

### 5.2 Prévention (R3-D)

| Mesure | Détail |
| --- | --- |
| P-1 Motif `nfc_cancelled` | Révoquer une réservation **jamais encodée** demande de choisir « Annulation (non sensible) » ou « Sécurité ». `revoked` reste réservé à la sécurité. Ajouter le motif dans le Web et le Mobile. |
| P-2 État récupérable explicite | Champ calculé `nfcRecoverable` dans la liste des cartes : `revoked` + motif ∈ {`nfc_reservation_expired`, `nfc_cancelled`} + jamais encodée ni verrouillée. Calculé à la lecture, sans nouvelle colonne d'état. |
| P-3 Parcours de reprise | Depuis R3-A : `R2_ELIGIBLE` mène à R2 ; codes `EXPIRED_*` et `nfc_cancelled` mènent à R3-B. |
| P-4 Secrets | Toute reprise génère un nouveau secret (R2 et R3-B). Les identifiants d'opération restent consignés (`nfc_retry_operation_ids`). Aucun audit supprimé. |
| P-5 Message d'erreur | `STUDENT_CARD_NFC_UID_EXISTS` propose « Diagnostiquer cette carte » au lieu d'un cul-de-sac. |

### 5.3 Option : carte active effacée (même élève)

Une carte `active` dont la puce est vierge a été effacée. L'élève ne peut plus pointer.
- Aujourd'hui, seule issue : perte puis remplacement, avec une **nouvelle** carte physique.
- Une réécriture « même élève, même UID » par rotation du secret est envisageable sur le modèle de R2. L'ancien secret serait invalidé en base.
- **Non incluse par défaut** : décision CTO (§9, Q4).

---

## 6. Inventaire des huit cartes (livrables 1 et 2) — procédure

**Phase 1 — lecture physique**
- Suivre `NFC-P0-RECOVERY-01-protocole-diagnostic-physique.md` (PR #950), §3 à §5 : TagInfo en *Scan* uniquement, sur un téléphone sans Somafrik, avec un témoin.
- Remplir `evidence/nfc-p0-r3/inventaire-8-cartes.template.csv` **hors Git**.
- Relever : UID complet dans le registre restreint, masqué dans le rapport ; modèle ; classe NDEF ; lecture seule.

**Phase 2 — lecture base**
- Le détenteur des accès exécute `diagnostic-r3-readonly.sql` avec `school_id` et la liste des 8 UID dans l'ordre des cartes. La requête est en `READ ONLY` et se termine par `ROLLBACK`.
- La sortie est déjà masquée : `04••••••••XXXX`, rien pour un autre établissement.

**Phase 3 — diagnostic**
- Croiser `r3_code` et l'observation physique avec la table du §3.1.
- Remplir les colonnes `diagnostic` et `action_autorisee`, puis soumettre au CTO.
- **Aucune action n'est exécutée pendant l'audit.**

Résultat attendu par carte : un et un seul code, un motif de refus, et une liste d'actions autorisées ou « aucune ».

---

## 7. Analyse des risques de réattribution

| # | Risque | Gravité | Mesure |
| --- | --- | --- | --- |
| RR-1 | La carte a été remise physiquement à l'ancien élève, qui la porte encore : après réattribution, son passage identifie un autre élève | Haute | Exiger la **possession physique** par la direction au moment de la réattribution ; NDEF vide constaté dans la même session ; justification tracée |
| RR-2 | Réattribuer une carte compromise (volée, puis retrouvée par un tiers) | Haute | `LOST`, `REVOKED_SECURITY` et toute révocation de sécurité, même jamais encodée, non libérables par contrainte de base liée au motif (P7) ; motif figé par trigger (P8) |
| RR-3 | Fuite inter-établissements par le diagnostic | Haute | Recherche globale séparée, limitée à `(nfc_uid, school_id)` ; détails bornés à l'établissement ; défense imposée par PostgreSQL (C1/C2) ; test d'isolation |
| RR-10 | Requalification d'un motif de révocation pour rendre une carte libérable | Haute | Trigger : motif figé, seule sortie R1/R2 depuis une expiration (P8, P10) |
| RR-4 | Énumération d'UID pour cartographier les cartes | Moyenne | Permission direction, limitation de débit, audit de chaque diagnostic |
| RR-5 | Deux réattributions concurrentes du même UID | Moyenne | Index partiel, verrou consultatif et `FOR UPDATE`, test à deux connexions |
| RR-6 | Ancien jeton encore présent sur une puce (écriture réussie puis confirmation perdue) | Moyenne | NDEF vide obligatoire ; ancienne ligne révoquée, donc jeton rejeté ; si NDEF Somafrik : R1, pas R3 |
| RR-7 | Abus interne (libérer pour contourner une révocation) | Moyenne | Permission distincte, justification, **deux approbateurs distincts** (Q2), audit non supprimable |
| RR-8 | Migration d'index en production (verrou, fenêtre sans unicité) | Moyenne | `CREATE UNIQUE INDEX CONCURRENTLY` d'abord, vérification de l'absence de doublon, retrait de l'ancien ensuite ; plan de retour arrière |
| RR-9 | Perte d'historique | Faible | Aucune suppression ; l'ancienne ligne garde UID, titulaire et audits (preuve P3) |

---

## 8. Découpage des PR et complexité

Chaque PR est isolée, Draft/HOLD, avec CI verte, diff indépendant et contrôle de sécurité. **Approuvées pour préparation : R3-1, R3-2, R3-3. En HOLD : R3-4, R3-5. Exclue : R3-6 (Q4).**

| PR | Contenu | Schéma | Complexité | Dépend de |
| --- | --- | --- | --- | --- |
| R3-1 | Backend `nfc-diagnose` en lecture seule : recherche globale séparée (fonction à droits de colonne limités), détails bornés à l'établissement, RBAC strict, limite de débit, audit | Fonction de lecture + permission RBAC | M (2–3 j) | — |
| R3-2 | Mobile « Diagnostiquer une carte NFC », lecture seule, liens vers R1/R2 | Non | M (2–3 j) | R3-1 |
| R3-3 | Motif `nfc_cancelled`, champ `nfcRecoverable`, choix du motif Web/Mobile, message `UID_EXISTS` | Additif (valeur de motif) | S–M (1–2 j) | — |
| R3-4 (**HOLD**) | Libération et réattribution transactionnelle : migration (colonnes, contrainte liée au motif, trigger, index partiel concurrent), route, deux approbateurs, audits | **Oui** (migration sensible) | L (5–7 j) | Inventaire réel, nouvelle validation CTO (Q3) |
| R3-5 (**HOLD**) | Mobile, parcours de réattribution : consentement, contrôles physiques, second approbateur, appel R3-4 | Non | M (2–3 j) | R3-4 |
| ~~R3-6~~ | Réécriture d'une carte active effacée | — | — | **Exclue** (Q4) |

**Ordre approuvé :**
1. R3-1, R3-2 et R3-3, qui retrouvent les titulaires et débloquent par R2 les cartes `R2_ELIGIBLE`.
2. R3-4 et R3-5 en HOLD, réévaluées après l'inventaire réel des huit cartes.

---

## 9. Décisions CTO (rendues, voir §0)

| Question | Décision |
| --- | --- |
| Q1 | Taxonomie approuvée sous réserves (C-1, C-2 corrigées) |
| Q2 | Deux approbateurs distincts pour toute réattribution |
| Q3 | Index partiel non autorisé pour l'instant ; R3-B en HOLD |
| Q4 | Réécriture d'une carte active effacée exclue |
| Q5 | Diagnostic des huit cartes autorisé en lecture seule |

---

## 10. Tests obligatoires (plan) et protocole de smoke

### 10.1 Tests automatisés à écrire dans les PR R3-x

| Domaine | Cas |
| --- | --- |
| Unicité globale UID | Deux attributions courantes refusées, y compris entre établissements ; libération puis nouvelle attribution acceptée ; historique à deux lignes |
| Concurrence | Deux réattributions simultanées (deux connexions PG réelles) : une seule réussit ; diagnostic concurrent d'une réattribution : résultat cohérent |
| RBAC | Enseignant, parent et élève refusés ; direction d'un autre établissement refusée ; permission de réattribution distincte de la programmation |
| Isolation | `OTHER_SCHOOL` sans aucune donnée ; aucune jointure d'élève d'un autre établissement ; réponses et journaux vérifiés champ par champ |
| Réservations expirées | Délai échu non matérialisé ; matérialisé ; remplacement expiré ; titulaire inactif ; titulaire déjà équipé |
| Réattributions interdites | `ACTIVE`, `LOST`, `REPLACED`, `REVOKED_SECURITY`, `LOCKED`, NDEF non vide, puce en lecture seule, UID ou modèle différent, autre établissement : refus **et** contrainte de base |
| Opérations interrompues | Coupure après libération (transaction annulée : rien n'est libéré) ; coupure après réservation (reprise standard) ; rejeu idempotent par identifiant d'opération |
| Absence de fuite | Aucun secret, `token_hash`, NDEF complet ou UID en clair dans les réponses, audits et journaux ; UID masqué partout |
| Garde NFC | Le parcours de diagnostic ne contient aucune écriture (garde existant + test statique dédié) |

### 10.2 Smoke physique, après livraison, carte par carte

Pour chacune des huit cartes, séparément :
1. Diagnostic R3-A en lecture seule. Vérifier que le code est identique au §6.
2. Selon le code, et seulement sur décision CTO pour la carte concernée :
   - `R2_ELIGIBLE` : R2 pour le titulaire d'origine ;
   - autres codes récupérables : R3-B.
3. Relecture physique : NDEF `somafrik:card:` avec le nouveau `publicId`.
4. Scan de présence (après le correctif de #958).
5. Contrôles de non-régression :
   - une carte non récupérable reste refusée avec son motif ;
   - aucune carte n'est verrouillée ;
   - aucun audit n'est supprimé.

---

## Annexes (preuves)

| Fichier | Contenu |
| --- | --- |
| `evidence/nfc-p0-r3/diagnostic-r3-readonly.sql` | Requête de diagnostic des 8 UID, rév. 2 : deux étapes cloisonnées, lecture seule, sortie masquée |
| `evidence/nfc-p0-r3/diagnostic-r3-fixtures.sql` | Jeu synthétique couvrant les 14 codes et 15 cas (base jetable uniquement) |
| `evidence/nfc-p0-r3/diagnostic-r3-fixtures.expected.csv` | Résultat obtenu : 15/15 conformes |
| `evidence/nfc-p0-r3/preuve-cloisonnement.sql` + `.output.txt` | C1/C2 : séparation recherche globale / détails imposée par droits de colonne et RLS (annulé par `ROLLBACK`) |
| `evidence/nfc-p0-r3/prototype-r3b-liberation.sql` | Prototype R3-B rév. 2 (étude en HOLD, non une migration), entièrement annulé par `ROLLBACK` |
| `evidence/nfc-p0-r3/prototype-r3b-liberation.output.txt` | Sortie : P1 à P11, dont P4 à P11 « OK » |
| `evidence/nfc-p0-r3/inventaire-8-cartes.template.csv` | Gabarit d'inventaire masqué (à remplir hors Git) |

Reproduction locale :
```
createdb r3_audit && psql -d r3_audit -f backend/db/schema.sql
psql -d r3_audit -f docs/audits/evidence/nfc-p0-r3/diagnostic-r3-fixtures.sql
psql -d r3_audit -v school_id=00000000-0000-4000-8000-00000000000a \
  -v uids=04000000000001,…,0400000000000E,04000000000016 -f docs/audits/evidence/nfc-p0-r3/diagnostic-r3-readonly.sql
psql -d r3_audit -f docs/audits/evidence/nfc-p0-r3/preuve-cloisonnement.sql
psql -d r3_audit -f docs/audits/evidence/nfc-p0-r3/prototype-r3b-liberation.sql
```

**NFC-P0-R3 — AUDIT rév. 2 / DRAFT / HOLD — corrections C-1 et C-2 apportées ; R3-1 à R3-3 approuvés pour préparation ; R3-4/R3-5 en HOLD.**
