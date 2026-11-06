# NFC-P0-RECOVERY-01 — Protocole de récupération des cartes (révision 2)

**Statut : DRAFT / HOLD / NO MERGE — protocole à valider par le CTO.**
Ce document **remplace** la piste « index unique partiel » de la révision 1 (§8.2 PR-1 du rapport). Conformément au complément CTO :

- l'**unicité globale des UID est conservée** (`student_access_cards_nfc_uid_unique` inchangé) ;
- l'**historique des cartes est conservé** (aucune ligne supprimée, aucun audit modifié) ;
- **aucune écriture NFC ni mutation PostgreSQL** n'est réalisée à cette étape ; tout ce qui suit est une **spécification**.

Légende : **[PROUVÉ-CODE]** lecture du code/DDL, **[SPÉC]** comportement proposé, non implémenté.

---

## 1. Invariants à respecter (non négociables)

| # | Invariant | Mécanisme existant |
| --- | --- | --- |
| I-1 | Un UID physique n'appartient qu'à **une seule ligne** de carte, pour toujours. | Index unique global `nfc_uid` [PROUVÉ-CODE] |
| I-2 | Au plus **une carte active** par élève. | Verrou élève + contrôle `findActive` [PROUVÉ-CODE] |
| I-3 | Au plus **une réservation vivante** par élève. | Index `one_pending_nfc_per_student` [PROUVÉ-CODE] |
| I-4 | Une carte n'est active qu'après **preuve de possession du secret** lu sur la puce. | `tokenHashesMatch` dans `nfc-confirm` [PROUVÉ-CODE] |
| I-5 | Toute transition est **auditée dans la même transaction** ; échec d'audit = rollback. | `transaction()` du cycle de vie [PROUVÉ-CODE] |
| I-6 | Aucune lecture n'écrit ; aucune écriture n'efface un contenu **étranger** ; aucune commande de verrouillage. | À garantir par PR-0 (garde-fou CI) |
| I-7 | Établissement issu du **principal authentifié**, jamais du client. | `authorize()` [PROUVÉ-CODE] |

Conséquence directe de I-1 avec la contrainte `student_access_cards_lifecycle_check` (`issued`/`active` ⇒ `revoked_at IS NULL`) [PROUVÉ-CODE] : **reprendre une carte expirée signifie rouvrir la même ligne**, pas en créer une nouvelle. L'historique de l'expiration est porté par `audit_logs` (événement `student_card_nfc_reservation_expired`, déjà écrit) et par un nouvel événement de reprise (§3.4).

---

## 2. Reconnaissance d'un NDEF Somafrik déjà présent (lecture seule)

### 2.1 Principe

Aujourd'hui, tout NDEF non vide est refusé `NFC_FOREIGN` (`studentCardNfcEncoding.ts:204`) [PROUVÉ-CODE]. Le parcours cible **lit** le NDEF, ne l'efface jamais automatiquement, et demande au serveur de le **classer**.

### 2.2 Classification locale (mobile, sans réseau, sans écriture) [SPÉC]

| Contenu lu | Classe locale | Suite |
| --- | --- | --- |
| Vide (TLV 03 00 ou enregistrement vide usine) | `BLANK` | Parcours normal ou reprise §3 |
| Exactement 1 enregistrement Texte `somafrik:card:<22>.<43>` | `SOMAFRIK_TOKEN` | Classification serveur §2.3 |
| Texte `somafrik:card:` mal formé | `SOMAFRIK_MALFORMED` | Catégorie C ; aucune action automatique |
| URL, MIME, plusieurs enregistrements, autre texte | `FOREIGN_CONTENT` | Catégorie C ; refus, aucune écriture |
| NDEF en lecture seule | `READ_ONLY` | Catégorie E/F ; refus |
| Puce sans NDEF (`NdefFormatable`) | `NOT_FORMATTED` | Catégorie D ; PR-6, décision CTO |

### 2.3 Classification serveur [SPÉC]

Nouvelle route **en lecture** : `POST /api/student-cards/nfc-inspect` avec `{ uid, tagType, cardToken }` (le jeton circule dans le corps HTTPS, comme pour `nfc-confirm` ; jamais dans l'URL, jamais journalisé).
Droits : identiques à `nfc-confirm` (Élèves:UPDATE, établissement du principal, flags NFC vrais). Aucune écriture, sauf une ligne d'audit `student_card_nfc_inspected` sans valeur sensible.

| Vérification serveur | Réponse (code seul, sans donnée élève) |
| --- | --- |
| `publicId` inconnu dans l'établissement | `UNKNOWN` — ne révèle pas s'il existe ailleurs |
| `publicId` connu, **UID observé ≠ `nfc_uid` de la ligne** | `UID_MISMATCH` — suspicion de copie ; aucune action, alerte audit |
| Hash du secret = `token_hash`, ligne `active` | `OWN_ACTIVE` — carte valide (cas A), aucune écriture |
| Hash = `token_hash`, ligne `issued/pending` vivante | `OWN_PENDING` — confirmation directe (parcours `resume` existant) |
| Hash = `token_hash`, ligne `revoked` / `nfc_reservation_expired` | `OWN_EXPIRED_RECOVERABLE` (si §3.1 satisfait) ou `OWN_EXPIRED_BLOCKED` |
| `publicId` et UID corrects, **hash ≠** (secret périmé après rotation) | `OWN_STALE_SECRET` — réécriture possible après consentement (§3.3) |
| Ligne `revoked` (motif administratif), `lost`, `replaced` | `OWN_RETIRED` — refus ; nouveau mandat requis |

Le serveur ne renvoie **jamais** l'identité de l'élève : l'opérateur part de la fiche de l'élève qu'il a en face de lui, et le serveur vérifie la correspondance (§3.1, condition T-1).

---

## 3. Reprise d'une réservation expirée pour la même carte

### 3.1 Conditions cumulatives (toutes vérifiées serveur, sous verrous élève + carte) [SPÉC]

| # | Condition | Contrôle |
| --- | --- | --- |
| T-1 | **Titulaire** : l'élève sélectionné par l'opérateur est `card.student_id`. | Comme `assertConfirmStudent` [PROUVÉ-CODE pour le contrôle existant] |
| T-2 | Titulaire **toujours inscrit dans le même établissement**, statut actif. | `students.school_id = scope.schoolId`, `status = 'active'` |
| T-3 | **Établissement** = celui du principal ; flags carte + NFC vrais. | `authorize` + `assertNfcEnabled` |
| T-4 | Ligne `revoked` avec `revoke_reason = 'nfc_reservation_expired'` **uniquement**. Exclus : `nfc_abandoned`, `revoked`, `lost`, `replaced`. | Décision CTO pour étendre à `nfc_abandoned` |
| T-5 | `nfc_encoded_at IS NULL` : la carte n'a jamais été active. | Une carte déjà active puis retirée relève d'un autre mandat |
| T-6 | `nfc_replaces_card_id IS NULL` (V1). Les remplacements expirés sont traités manuellement. | Évite de rejouer une bascule de remplacement |
| T-7 | **Aucun conflit actif** : pas de carte `active`, pas de réservation vivante pour l'élève (I-2, I-3). | `findActive`, `findPendingNfc` |
| T-8 | **UID et modèle observés physiquement** = `nfc_uid` / `nfc_tag_type` de la ligne. | Lecture GET_VERSION + UID |
| T-9 | Contenu puce : `BLANK`, ou `SOMAFRIK_TOKEN` du **même `publicId`**. Tout autre contenu → refus. | §2 |
| T-10 | Opération idempotente : `operationId` UUID neuf fourni par le client, rejouable. | Comme `reserve`/`retry` |

La requête **Q8** de `evidence/nfc-p0-recovery-01/inventory-readonly.sql` permet de vérifier T-2, T-4 à T-7 **en lecture seule** pour une carte donnée, avant tout développement.

### 3.2 Parcours R1 — NDEF Somafrik valide présent : reprise **sans écriture** [SPÉC]

Cas le plus fréquent d'après les preuves P-02/P-04 : l'écriture a réussi, la confirmation n'a pas abouti.

1. Lire UID, modèle et NDEF (aucune écriture).
2. `nfc-inspect` → `OWN_EXPIRED_RECOVERABLE` (le hash du secret lu = `token_hash` stocké).
3. Confirmation explicite de l'opérateur (fiche élève à l'écran).
4. `POST /api/student-cards/:id/nfc-recover` `{ uid, tagType, cardToken, studentId, operationId }` — **une seule transaction** :
   - re-vérifie T-1 à T-10 sous verrous ;
   - fait passer la **même ligne** de `revoked` à `active/encoded` (efface `revoked_at`/`revoke_reason`, renseigne `nfc_encoded_at`, enregistre le nouvel `operationId`) ;
   - écrit les audits `student_card_nfc_reservation_recovered` puis `student_card_nfc_encoded`.
5. **Aucun octet n'est écrit sur la puce.** Le secret déjà présent devient le secret actif, ce que prouve la correspondance du hash (I-4).

### 3.3 Parcours R2 / R3 — puce vierge ou secret périmé : reprise **avec** écriture consentie [SPÉC]

- **R2** (`BLANK`) — réservation expirée avant toute écriture (preuve P-05).
- **R3** (`OWN_STALE_SECRET`) — même `publicId`, secret antérieur à une rotation.

1. `nfc-recover` en mode `reopen` : la **même ligne** repasse `issued/pending`, avec un **nouveau secret** (l'ancien hash est remplacé), une **nouvelle fenêtre de 30 minutes** et le nouvel `operationId`. Audit `student_card_nfc_reservation_recovered` (ancienne et nouvelle échéance, sans secret).
2. Écriture : uniquement si la puce est `BLANK` ou porte le **même `publicId`** (règle `allowRewrite` déjà présente, `studentCardNfcEncoding.ts:127-129`) [PROUVÉ-CODE pour la règle] ; consentement explicite requis pour R3.
3. Relecture, puis `nfc-confirm` existant, inchangé.
4. Si cette reprise échoue à son tour, la ligne expire de nouveau ; une seconde reprise reste possible aux mêmes conditions. Le nombre de reprises est visible dans l'audit, et un plafond (ex. 3) est proposé, à fixer par le CTO.

### 3.4 Historique conservé

| Élément | Où |
| --- | --- |
| Réservation initiale | Audit `student_card_nfc_reserved` (existant) |
| Expiration | Audit `student_card_nfc_reservation_expired` (existant, intouché) |
| Reprise | **Nouvel** audit `student_card_nfc_reservation_recovered` : `{ fromStatus, toStatus, mode: "recognized" \| "reopen", tagType }` — sans secret, sans identifiant d'élève |
| Activation | Audit `student_card_nfc_encoded` (existant) |
| Ligne de carte | Même `id`, même `public_id`, même `nfc_uid` : aucune ligne supprimée ni dupliquée |

Option additive (migration future, sur décision CTO) : colonnes `nfc_recovery_count INT NOT NULL DEFAULT 0` et `nfc_last_expired_at TIMESTAMPTZ`, pour lire l'historique sans parcourir `audit_logs`.

### 3.5 Cas refusés (aucune action)

| Situation | Réponse | Pourquoi |
| --- | --- | --- |
| UID observé ≠ UID de la ligne du jeton | `UID_MISMATCH` | Jeton copié sur une autre puce |
| Titulaire différent de l'élève sélectionné | `STUDENT_CARD_NFC_MISMATCH` | Pas de réattribution implicite |
| Élève transféré ou sorti de l'établissement | Refus | Hors périmètre de reprise |
| Carte déjà active ailleurs pour cet élève | `STUDENT_CARD_ACTIVE_ALREADY_EXISTS` | I-2 |
| Motif `lost`, `revoked`, `replaced`, `nfc_abandoned` | Refus | Décision humaine antérieure à respecter |
| Contenu étranger, lecture seule, protégé | Refus, aucune écriture | I-6 |
| **Attribuer l'UID à un autre élève** | Refus | Réattribution = mandat distinct (I-1 conservé) |

### 3.6 Analyse d'usurpation

- **R1** exige le secret exact déjà stocké (hash) **et** l'UID physique de la ligne : c'est la même preuve que l'activation normale.
- **R2/R3** génèrent un nouveau secret : l'ancien, s'il circule, devient inutilisable.
- Seul un personnel habilité de l'établissement peut agir, pour l'élève titulaire, avec un audit transactionnel. L'élève ou le parent n'a aucun parcours libre-service.
- L'UID n'est jamais traité comme un secret : il sert à lier la ligne, pas à authentifier.

---

## 4. Mise à jour du plan de PR (aucune ouverte avant validation de ce protocole)

| # | Priorité | Contenu | Dépend de |
| --- | --- | --- | --- |
| PR-0 | P0 | Garde-fou CI (aucun `makeReadOnly`, WRITE 0xA2, PWD_AUTH 0x1B, `formatNdef` dans `Mobile/src`) ; neutraliser le verrouillage de #908, #909 et #912 | — |
| PR-1 | P0 | Backend : `nfc-inspect` (lecture) + `nfc-recover` (R1/R2/R3), sous les conditions T-1 à T-10. **Index UID inchangé.** Tests PG : les tests existants n° 4, 8, 27, 29 restent verts ; ajout de tests de reprise et de refus | Validation de ce protocole |
| PR-2 | P0 | Mobile : classification §2.2, codes d'erreur distincts, appel `nfc-inspect`, parcours R1/R2/R3 avec consentement | PR-1 |
| PR-3 | P1 | Mobile : mode Diagnostic en lecture seule (READ 0x30, pages 0-44) | PR-0 |
| PR-4 | P1 | Relecture en une seule présentation (#939 à auditer) | PR-2 |
| PR-5 | P2 | Expiration proactive et indicateur `expired` serveur (complète #938) | PR-1 |
| PR-6 | P2 | Formatage NDEF contrôlé des puces non formatées | Décision CTO |

## 5. Tests requis avant toute activation

| Test | Attendu |
| --- | --- |
| R1 nominal | Ligne `revoked` → `active` ; 0 écriture ; 2 audits ; index UID intact |
| R1 avec hash faux | Refus `OWN_STALE_SECRET` ; aucune mutation |
| R1 avec UID différent | `UID_MISMATCH` ; aucune mutation ; audit d'alerte |
| R1 avec autre élève sélectionné | Refus ; aucune mutation |
| R1 concurrent ×2 (même `operationId`) | Une transition, un audit, rejeu idempotent |
| R1 concurrent avec une nouvelle réservation pour l'élève | Un seul gagnant (I-2/I-3) |
| R2 nominal | `reopen` puis écriture, relecture, confirmation ; secret neuf |
| R2 interrompu de nouveau | Nouvelle expiration propre ; reprise encore possible |
| Motifs exclus (`lost`, `replaced`, `revoked`, `nfc_abandoned`) | Refus |
| Élève transféré | Refus |
| Échec d'audit | Rollback complet |
| Garde-fou CI | Échec si une commande de verrouillage est introduite |

## 6. Décisions CTO attendues

1. Étendre ou non T-4 à `nfc_abandoned`.
2. Plafond du nombre de reprises par carte.
3. Colonnes d'historique additives (§3.4), ou audit seul.
4. Traitement des remplacements expirés (T-6).

**NFC-P0-RECOVERY-01 — DRAFT / HOLD — DIAGNOSTIC À VALIDER PAR LE CTO.**
