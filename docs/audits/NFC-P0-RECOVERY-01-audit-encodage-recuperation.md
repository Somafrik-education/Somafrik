# NFC-P0-RECOVERY-01 — Audit de l'encodage NFC et récupération des cartes rejetées

| | |
| --- | --- |
| Projet | SOMAFRIK V2 |
| Priorité | **P0 — incident critique** |
| Statut | **DRAFT / HOLD / NO MERGE** — documentation uniquement — **révision 2** (complément CTO du 17/10) |
| Base auditée | `develop` @ `b82ba090ba9c465cb30ac25c57472eb5edf997eb` (fichiers d'encodage identiques à `69419df`) |
| Bibliothèque NFC | `react-native-nfc-manager` **4.0.0-beta.10** (source Java Android inspectée) |
| Opérations sur cartes physiques | **Aucune.** Aucune lecture, écriture ou formatage n'a été effectué pendant cet audit. |
| Modifications PostgreSQL / Supabase | **Aucune.** Tests uniquement sur un PostgreSQL 16 jetable local. |

> **Révision 2 — complément CTO.** Diagnostic principal validé sous réserves. Ajouts : Q7 en liste blanche (§9 SQL), protocole de récupération conservant l'unicité globale des UID (`NFC-P0-RECOVERY-01-protocole-recuperation.md`, qui **remplace** la piste « index partiel » de la PR-1 initiale), provenance des APK (`NFC-P0-RECOVERY-01-provenance-apk.md`), protocole de diagnostic physique (`NFC-P0-RECOVERY-01-protocole-diagnostic-physique.md`). Les sections ci-dessous sont mises à jour en conséquence.

Légende de preuve : **[PROUVÉ-CODE]** lecture du code, **[PROUVÉ-TEST]** test reproductible exécuté, **[HYPOTHÈSE]** à confirmer par diagnostic matériel.

---

## 0. Résumé exécutif

1. **Cause racine n° 1 — l'UID d'une carte est réservé pour toujours, même après échec.** [PROUVÉ-CODE + PROUVÉ-TEST]
   Un index unique **global** sur `student_access_cards.nfc_uid` couvre aussi les lignes `revoked`, `lost` et `replaced`. Dès qu'une réservation est créée pour une carte, son UID ne peut plus jamais être réservé, ni pour le même élève, ni pour un autre, ni dans un autre établissement, même si la réservation a expiré au bout de 30 minutes sans écriture réussie. Le refus est `STUDENT_CARD_NFC_UID_EXISTS` (« Cette carte physique est déjà affectée »). Ce comportement est **voulu par conception** et verrouillé par trois tests PostgreSQL existants (« preserves UID forever »).

2. **Cause racine n° 2 — une carte qui contient déjà un NDEF Somafrik est refusée comme « incompatible ».** [PROUVÉ-CODE + PROUVÉ-TEST]
   Le pré-contrôle de programmation refuse **toute** carte dont le NDEF n'est pas vide, y compris une carte écrite par Somafrik lors d'une tentative précédente non confirmée. Le message affiché, « Carte incompatible ou contenant un autre identifiant », est le même que pour une carte étrangère.

3. **Les deux causes se cumulent.** Scénario typique, reproduit par test : écriture réussie → l'utilisateur ne re-présente pas la carte pour la relecture (ou le réseau échoue) → la réservation expire après 30 minutes → la carte est refusée **définitivement** par l'application **et** par la base, alors que la puce est intacte et inscriptible.

4. **Aucune commande de verrouillage irréversible n'existe dans `develop`.** [PROUVÉ-CODE] Le seul octet brut envoyé est `GET_VERSION` (0x60). Il n'y a pas de `makeReadOnly`, d'écriture de page (0xA2), de mot de passe ni de formatage.
   **Toutefois**, la CI a réellement construit **trois APK** contenant un bouton « Verrouiller définitivement » (`makeReadOnly`, irréversible) : #908 (`c3db71c`, 12/10), #909 (`91c2af5`, 13/10) et #912 (`c6f5eaa`, 13/10). [PROUVÉ — journaux GitHub Actions] Leur installation sur un téléphone n'est **pas** prouvée. Ces APK sont indiscernables d'un APK sain dans les réglages Android (même paquet, même version, même signature) ; une procédure d'identification par empreinte et par repères d'interface est fournie dans `NFC-P0-RECOVERY-01-provenance-apk.md`.

5. **Le message d'erreur ne permet pas de diagnostiquer.** Le code `NFC_FOREIGN` regroupe au moins **8 situations différentes**. Les erreurs natives Android sont masquées. Aucune carte ne doit donc être classée E ou F sur la base du message applicatif.

6. **La recette physique n'a jamais été exécutée.** `docs/mobile/NFC-PROG-05-PHYSICAL-RECIPE.md` est marqué « PRÉPARÉ / NON EXÉCUTÉ ».

**Conclusion provisoire :** sauf verrouillage manuel via un APK de #908, la grande majorité des cartes rejetées sont très probablement **physiquement saines et récupérables**. Leur rejet est logique (base + pré-contrôle mobile), pas matériel. Ce point reste à confirmer carte par carte par une lecture non destructive (§6).

---

## 1. Architecture réelle du système NFC

```
Android (Expo, Reader Mode)
 ├─ Encodage (personnel habilité, fiche élève ou classe)
 │   StudentCardNfcEnrollmentPanel.tsx ─┐
 │   StudentCardNfcBatchControl.tsx ────┤→ studentCardNfcBatch.ts (ordonnancement par classe)
 │                                      └→ studentCardNfcEncoding.ts  (moteur : program / resume / rewrite)
 │                                           ├→ studentCardNfcEncoderNative.ts (matériel : inspect, openNdef, readText, writeText, isReadOnly)
 │                                           │    └→ nfcSessionNative.ts → nfcSession.ts (bail unique sur le NfcManager)
 │                                           └→ API REST (studentCardEnrollmentApi.ts)
 └─ Lecture (pointage, appel, contrôle d'entrée)
     StudentCardNfcScannerModal.tsx → studentCardNfcNative.ts → studentCardNfc.ts (extractNfcCardTokenFromTag)

Backend Node/Express (backend/server.js)
  GET  /api/students/:id/cards              (l.2235)
  POST /api/student-cards                    (réservation NFC, l.~2375 → reserveStudentCardNfc)
  POST /api/student-cards/:id/replace
  POST /api/student-cards/:id/nfc-retry      (l.2254 → retryStudentCardNfc)
  POST /api/student-cards/:id/nfc-confirm    (l.2262 → confirmStudentCardNfc)
  → backend/lib/studentCardsNfcLifecycle.js  (transactions, expiration, rejeu, audit)
  → backend/db/studentAccessCardsPgStore.js  (SQL)

PostgreSQL : table canonique student_access_cards (pas de registre UID parallèle)
  migrations 20261012_student_cards_nfc_encoding.sql, 20261013_student_cards_nfc_reservations.sql
```

### 1.1 Parcours réel d'un encodage individuel

| Étape mandat | Code réel | Action sur la puce |
| --- | --- | --- |
| Carte détectée | `inspect()` — `studentCardNfcEncoderNative.ts:30-48` : `requestTechnology([NfcA, NfcB, IsoDep])` | Aucune écriture |
| Validation modèle | `transceive([0x60])` GET_VERSION (l.43) ; `identifyNtag` — `studentCardNfcEncoding.ts:16-23` | Lecture seule |
| Pré-contrôle | `program()` l.193-208 : `openNdef` + `readText` + `isReadOnly` ; **refus si NDEF non vide ou lecture seule (l.204)** | Lecture seule |
| Attribution | `reserve()` → `POST /api/student-cards` → `reserveStudentCardNfc` (`studentCardsNfcLifecycle.js:79-119`) : ligne `issued/pending`, **UID inscrit**, expiration +30 min, secret généré | — |
| Préparation NDEF | `ndefForCard` l.30-34 : texte `somafrik:card:<publicId 22>.<secret 43>` | — |
| Écriture | `encodeNfcCard` l.119-139 → `writeText` (native l.61-72) : contrôle capacité/ReadWrite puis `ndef.writeNdefMessage` (Android `Ndef`) | **Seule écriture** : message NDEF dans la zone utilisateur |
| Lecture de contrôle | `session.reset()` puis nouvelle découverte : **l'utilisateur doit retirer et re-présenter la carte** (l.66-71) ; `readText` comparé au contenu attendu (l.136) | Lecture seule |
| Confirmation serveur | `confirmRead` l.110-118 → `nfc-confirm` → `confirmStudentCardNfc` (l.131-182) : `issued/pending` → `active/encoded` | — |
| Carte utilisable | Le lecteur accepte `somafrik:card:<token>` (`studentCardNfc.ts:188-232`) | — |

---

## 2. Format NDEF réellement écrit et attendu (NFC-03)

| | Écrit (encodeur) | Attendu (lecteur) |
| --- | --- | --- |
| Enregistrement | 1 enregistrement **Well-Known Text** (TNF 1, type `T`), langue `en` | Tout enregistrement `T`, `U` ou brut ; recherche du premier qui commence par `somafrik:card:` |
| Contenu | `somafrik:card:` + `publicId` (22 base64url) + `.` + secret (43 base64url) | Même préfixe, 2 parties base64url, ≤ 256 caractères |
| Taille | **87 octets** de message NDEF (+ TLV) | NTAG213 : 144 octets utiles → marge suffisante |

**Verdict NFC-03 : compatible.** [PROUVÉ-TEST F-01] Le lecteur est même plus tolérant que l'encodeur. **Somafrik n'écrit pas de données incompatibles avec son propre lecteur.**

Asymétrie à noter : l'**encodeur** refuse plus de cas que le lecteur (`readText`, native l.50-60) : plus d'un enregistrement, enregistrement non-Texte (URL, MIME…), NDEF non lisible.

---

## 3. Mécanismes de verrouillage (NFC-05)

### 3.1 Rappel matériel NTAG213 (NXP, fiche technique NTAG213/215/216)

| Zone | Pages | Effet | Réversible |
| --- | --- | --- | --- |
| UID + octets de verrouillage statiques | 0-2 | Bits de lock pages 3-15 | **Non** (OTP) |
| Capability Container (CC) | 3 | Octet 3 : `00` = R/W, `0F` = lecture seule NDEF | **Non** (OTP) |
| Zone utilisateur | 4-39 | NDEF | Oui si non verrouillée |
| Lock dynamiques | 40 (0x28) | Lock pages 16-39 | **Non** |
| CFG0 / AUTH0 | 41 (0x29) | Page à partir de laquelle le mot de passe est exigé (`FF` = désactivé) | Oui, si mot de passe connu |
| CFG1 / ACCESS | 42 (0x2A) | Protection lecture, compteur d'échecs | Selon configuration |
| PWD / PACK | 43-44 | Mot de passe 32 bits | — |

### 3.2 Ce que fait `develop` [PROUVÉ-CODE]

- Recherche exhaustive dans `Mobile/src` et `Mobile/plugins` : **aucun** `makeReadOnly`, `formatNdef`, `0xA2` (WRITE), `0x1B` (PWD_AUTH), ni accès aux pages 2, 3, 40-44.
- Seul `transceive` : `[0x60]` GET_VERSION (lecture d'identification).
- L'écriture passe par l'API Android `Ndef.writeNdefMessage`, qui ne touche que le TLV NDEF de la zone utilisateur. Elle ne modifie pas les octets de verrouillage. [PROUVÉ-CODE côté Somafrik ; comportement de la pile Android = référence AOSP, à corroborer par lecture des pages 2/3/40-42 sur une carte de laboratoire]
- Le backend accepte un état `locked` (`nfc_locked_at`), mais il s'agit seulement d'une **observation** remontée par le client (`isReadOnly`). Aucune commande matérielle n'y est associée.

**Verdict NFC-05 : le parcours normal de `develop` ne peut pas verrouiller une carte.**

### 3.3 Risque identifié hors `develop` — PR #908

[#908](https://github.com/Somafrik-education/Somafrik/pull/908) (`codex/nfc-encoding-ntag213-216`, DRAFT) ajoute `verifyOrLockNfcCard` → `NfcManager.ndefHandler.makeReadOnly()`, accessible par un bouton « Verrouiller définitivement » après confirmation. `docs/mobile/NFC-ENCODING-SMOKE.md` (sur cette branche) prescrit un « APK natif depuis cette branche ». **Il faut établir si un tel APK a été installé sur un téléphone de test.** Si oui, toute carte « Verrouillée définitivement » a son CC à `0F` (et Android peut aussi avoir posé les bits de lock) : **irréversible**.

Les autres PR NFC ouvertes inspectées ne contiennent pas de commande de verrouillage (voir §10).

---

## 4. Analyse des risques NFC-01 à NFC-10

| ID | Constat | Preuve | Gravité |
| --- | --- | --- | --- |
| **NFC-01** Écriture interrompue | Si le téléphone est retiré **pendant** `writeNdefMessage`, l'exception native est renvoyée sous forme de **chaîne sans code**. Elle est affichée comme « Résultat non confirmé… » (`nfcErrorCopy` l.92). La puce reste inscriptible (pas de verrouillage). L'état exact du TLV (vide, ancien, partiel) dépend de la pile Android. Si la réservation est encore valide, `rewrite` (avec consentement) permet de réécrire une puce vide ou portant le même `publicId`. | Code ; état TLV = [HYPOTHÈSE] | Moyenne |
| **NFC-01 bis** Relecture interrompue | Cas **le plus probable sur le terrain** : l'écriture réussit, mais la relecture exige de retirer puis re-présenter la carte (native l.66-71). Si l'opérateur abandonne ou dépasse le délai, la puce contient un NDEF Somafrik valide alors que le backend est toujours `pending`. | P-02 | **Critique** (porte d'entrée de la cause n° 2) |
| **NFC-02** Double encodage | Correctement géré : pas de réécriture si le contenu attendu est déjà présent (l.130) ; rejeu idempotent par `operationId`. | P-06, tests PG 2/7 | Faible |
| **NFC-03** Format | Compatible (§2). | F-01 | Aucun |
| **NFC-04** UID | Pas de confusion : l'UID n'est jamais un secret ; le secret est la capability NDEF. Mais l'UID sert de **clé d'unicité globale définitive** (cause n° 1). | Code | **Critique** |
| **NFC-05** Verrouillage | Aucun dans `develop` ; risque via #908 (§3.3). | Code | Critique si #908 a été utilisé |
| **NFC-06** Confirmation prématurée | Non : activation seulement après relecture conforme puis `nfc-confirm`. Une ligne `issued/pending` (UID réservé) existe **avant** l'écriture, ce qui est la source de la cause n° 1. | Code, test PG 1 | Faible (activation) / Critique (réservation) |
| **NFC-07** Échec backend | Une écriture physique réussie dont la confirmation échoue reste récupérable par « Reprendre l'opération — relire et confirmer » **pendant 30 minutes**. Au-delà, la carte est perdue logiquement (expiration → `revoked` + UID bloqué + NDEF refusé). | P-03, P-04 | **Critique** |
| **NFC-08** Réencodage | **Oui, Somafrik rejette une carte parce qu'elle contient déjà un NDEF**, quel qu'il soit (l.204), y compris son propre format d'une tentative antérieure. `rewrite` ne s'applique qu'à une réservation `issued` non expirée. | P-04, P-07 | **Critique** |
| **NFC-09** Bibliothèque | (a) `requestTechnology` prend la **première** technologie de la liste supportée par la puce (`TagTechnologyRequest.connect`) : une puce NTAG **non formatée NDEF** (CC absent → `NdefFormatable`) est connectée en `NfcA` → `NFC_NDEF` ; aucun parcours de formatage. (b) `getNdefMessage` en beta.10 renvoie le message **mis en cache à la découverte** (d'où la re-présentation obligatoire). (c) `getNdefStatus` Android = `isWritable()` du cache. (d) Erreurs natives masquées (pas de code). | Source Java beta.10 | Élevée |
| **NFC-10** Cohérence | L'index unique n'est pas scopé par établissement : une carte réservée en établissement A est refusée en B. Expiration **paresseuse** : une réservation passée reste `issued/pending` jusqu'à la prochaine réservation pour **le même élève** (Q3 du SQL). Le client mobile ne peut pas distinguer une réservation vivante d'une réservation morte (corrigé partiellement par #938). | Code, `\d student_access_cards` | Élevée |

### 4.1 Le code `NFC_FOREIGN` regroupe au moins 8 situations

Message affiché : « Carte incompatible ou contenant un autre identifiant. Aucune écriture autorisée. »

| Situation | Emplacement |
| --- | --- |
| Technologie non NfcA (ISO-DEP, Navigo, NfcB…) | native l.40 |
| GET_VERSION en échec | native l.44 |
| UID ne commençant pas par `04` / longueur ≠ 7 octets (puce non NXP, clone) | `normalizeNtagUid` l.13 |
| Modèle ≠ NTAG213/216 (ex. **NTAG215**, `0x11`) | `identifyNtag` l.19-21 |
| NDEF à plusieurs enregistrements, ou non-Texte (ex. URL préencodée par le fournisseur) | native l.54, l.58 |
| **NDEF Somafrik d'une tentative précédente** | `program` l.204 |
| **NDEF en lecture seule** (carte verrouillée) | `program` l.204 |
| NDEF d'un autre `publicId` lors d'une reprise | l.112, l.128, l.146 |

**Conséquence : le message applicatif ne permet de classer aucune carte.** Un diagnostic par lecture brute est indispensable (§6).

---

## 5. Causes racines

| # | Cause | Statut | Preuve |
| --- | --- | --- | --- |
| CR-1 | UID réservé à vie : index `student_access_cards_nfc_uid_unique ON (nfc_uid) WHERE nfc_uid IS NOT NULL`, sans condition de statut ni d'établissement. Une réservation expirée ou abandonnée bloque la carte physique définitivement. | **PROUVÉ** | Migration `20261012…sql` l.22-24 ; `\d student_access_cards` sur PG 16 ; tests PG existants n° 4, 8, 27, 29 (37/37 verts) ; preuve P-05 |
| CR-2 | Pré-contrôle mobile : tout NDEF non vide ou en lecture seule → `NFC_FOREIGN`, y compris un NDEF Somafrik orphelin. | **PROUVÉ** | `studentCardNfcEncoding.ts:204` ; preuves P-04, P-07, P-08 |
| CR-3 | Relecture en deux présentations + fenêtre de 30 minutes non prolongeable + `attempt` conservé en RAM seulement : forte probabilité d'interruption entre écriture et confirmation, puis expiration. | **PROUVÉ** (mécanisme) / fréquence terrain = HYPOTHÈSE | Native l.66-71 ; `reserveStudentCardNfc` l.108-109 ; l.161 ; P-02/P-03/P-04 |
| CR-4 | Diagnostics masqués : code unique `NFC_FOREIGN`, erreurs natives sans code. | **PROUVÉ** | §4.1 ; `NdefHandler.java` beta.10 |
| CR-5 | Cartes non formatées NDEF, NTAG215, clones non NXP ou préencodées par le fournisseur : refus systématique sans dommage. | **PROUVÉ** (code) / présence dans le lot = HYPOTHÈSE | F-02, P-07, NFC-09 (a) |
| CR-6 | Verrouillage irréversible par un APK de test (#908, #909 ou #912) sur bouton explicite. | APK construits : **PROUVÉ** ; installation et usage : **HYPOTHÈSE** | Runs 38300236809, 38368481589, 38415265990 ; à vérifier : empreinte APK des téléphones, puis CC page 3, 4e octet = `0F` |
| CR-7 | Recette physique jamais exécutée avant usage de cartes réelles. | **PROUVÉ** (gouvernance) | `NFC-PROG-05-PHYSICAL-RECIPE.md` |

---

## 6. Diagnostic matériel non destructif — mode opératoire

> **Révision 2 :** protocole complet (rôles, interdictions, relevés page par page, chaîne de garde, critères d'arrêt) dans `NFC-P0-RECOVERY-01-protocole-diagnostic-physique.md`. Résumé ci-dessous.

**Autorisé (lecture seule)**, sur un téléphone **sans Somafrik ouvert en encodage** :

1. Application **NXP TagInfo** (éditeur du NTAG), écran « Scan » seulement. Ne jamais utiliser d'onglet Écrire, Formater, Protéger ou Effacer (ni dans TagInfo, ni dans NFC Tools ou équivalent).
2. Relever pour chaque carte : UID ; IC/GET_VERSION ; pages 2 (lock statiques), 3 (CC), 40-42 (lock dynamiques, AUTH0, ACCESS) ; contenu NDEF **classé** (vide / `somafrik:card` / URL / autre). **Ne pas recopier le secret** : noter seulement les 22 premiers caractères après `somafrik:card:` (le `publicId`), qui ne sont pas un secret.
3. Avec l'UID, exécuter **Q1** de `evidence/nfc-p0-recovery-01/inventory-readonly.sql` (transaction `READ ONLY`, sur autorisation CTO).
4. Remplir `evidence/nfc-p0-recovery-01/registre-cartes-rejetees.template.csv` dans un espace **restreint hors Git** (les UID y figurent).

Si une page renvoie une erreur de lecture (protection par mot de passe), **noter « protégée » et s'arrêter**. Ne jamais tenter de mot de passe.

### 6.1 Arbre de classification

| Observation (lecture brute + Q1) | Catégorie | Récupération |
| --- | --- | --- |
| NDEF `somafrik:card:<publicId>` = carte `active/encoded` en base, rejetée au scan | **A** valide rejetée | Logicielle / réconciliation, **sans réécriture** |
| NDEF `somafrik:card:<publicId>` = carte `issued/pending` **non expirée** | **A/B** | « Reprendre l'opération — relire et confirmer » (P-03), sans écriture |
| NDEF `somafrik:card:<publicId>` = carte `revoked` (`nfc_reservation_expired`) | **B** lisible rejetée (CR-1 + CR-2) | **Conditionnelle** : reprise **R1 sans écriture** de la même ligne (protocole de récupération §3.2), après PR-1 + PR-2 ; `nfc_abandoned` : décision CTO |
| NDEF vide, CC `E1 10 12 00`, UID présent en base `revoked` (`nfc_reservation_expired`) | **D** bloquée logiquement (CR-1) | Conditionnelle : reprise **R2** de la même ligne avec écriture consentie (protocole §3.3) |
| NDEF vide, CC R/W, UID absent de la base | **D** vierge | Encodage normal possible ; si rejet → regarder modèle/UID (CR-5) |
| NDEF partiel / illisible, CC R/W | **C** NDEF invalide | Réparation contrôlée après sauvegarde du dump (PR-2) |
| URL ou autre contenu fournisseur, CC R/W | **C** | Effacement contrôlé du NDEF sur autorisation CTO |
| Pas de CC (`00 00 00 00`), technologie `NdefFormatable` | **D** non formatée | Formatage NDEF (non destructif) sur autorisation CTO — PR-6 |
| NTAG215 / UID non `04` / GET_VERSION ≠ NXP | **Hors spécification** (non « détruite ») | Réutilisable seulement si la politique matérielle évolue |
| AUTH0 ≠ `FF` et lecture en erreur | **E** protégée | Aucune action sans mot de passe connu et documenté |
| CC 4e octet = `0F` ou bits de lock posés | **F** verrouillée | Contenu figé. Réutilisable uniquement si son contenu correspond à une carte que la base peut réactiver (décision CTO) ; sinon perdue |
| Aucune réponse au champ NFC | **F** défectueuse | Contrôle sur un second téléphone avant conclusion |
| Résultats contradictoires | **G** | Investigation supplémentaire |

---

## 7. Procédure de récupération par catégorie

**Aucune opération ne doit être lancée automatiquement. Toute opération modifiant une puce requiert une autorisation CTO écrite, carte par carte.**

> **Révision 2 :** la procédure détaillée, conforme au complément CTO (unicité globale des UID et historique conservés, reprise de réservation expirée pour la même carte, reconnaissance du NDEF Somafrik sans effacement), est dans `NFC-P0-RECOVERY-01-protocole-recuperation.md`. Elle prévaut sur la présente section.

- **Cas A — valide rejetée** : ne pas toucher la puce. Identifier la couche (lecteur, flag établissement, RBAC, carte non active) à partir de Q1 et de l'erreur exacte. Réactivation éventuelle par le parcours `resume` existant si la réservation est vivante.
- **Cas B — NDEF Somafrik orphelin** : aucune écriture. Si le secret lu correspond au hash de la ligne expirée et que les conditions T-1 à T-10 sont réunies, reprise **R1** : la même ligne redevient active, sans toucher la puce (protocole §3.2).
- **Cas C — NDEF invalide ou étranger** : dump préalable, puis remplacement du message NDEF uniquement (jamais les pages 0-3 ni 40-44), sur carte de laboratoire d'abord.
- **Cas C (ancienne attribution)** : vérifier l'historique d'audit (Q7). La reprise n'est possible **que pour le même titulaire**, dans le même établissement, sans carte active ni réservation vivante (protocole §3.1). Une **réattribution à un autre élève** reste refusée (unicité globale de l'UID) et relève d'un mandat distinct.
- **Cas D — vierge / réinscriptible** : si l'UID est rattaché à une réservation expirée du même titulaire, reprise **R2** (même ligne, nouveau secret, écriture consentie) ; si l'UID est inconnu, parcours normal.
- **Cas E — protégée** : documenter, ne rien forcer, ne jamais deviner un mot de passe. Demander l'origine au fournisseur.
- **Cas F — verrouillée** : documenter objectivement (CC `0F` / bits de lock). Le verrouillage NTAG est **OTP et irréversible**. Aucune récupération en écriture n'est possible.

---

## 8. Architecture cible et plan de prévention

### 8.1 Machine à états proposée

```
DETECTED → VALIDATED → WRITE_PENDING → WRITTEN → VERIFIED → ACTIVE
                 │            │            │          │
                 └────────────┴────────────┴──────────┴──→ RECOVERY_REQUIRED
                                                           (jamais d'écriture aveugle ;
                                                            sortie par relecture puis décision explicite)
```

Écarts avec l'existant :

| Exigence | Existant | Proposition |
| --- | --- | --- |
| Un échec ne perd pas la carte | Expiration → `revoked` + UID bloqué | `RECOVERY_REQUIRED` : reprise auditée de **la même ligne** pour le même titulaire (R1/R2/R3) ; index UID global inchangé |
| Reprise après redémarrage | Ligne `pending` relisible 30 min ; `attempt` en RAM | Conserver ; ajouter la relecture « carte présentée → ligne en base par UID » comme point d'entrée de reprise |
| Lecture de contrôle fiable | Deux présentations (cache Android) | Relecture brute `READ 0x30` dans la même session (approche de [#939](https://github.com/Somafrik-education/Somafrik/pull/939)) |
| Diagnostic explicite | `NFC_FOREIGN` unique | Codes distincts : `NFC_MODEL_UNSUPPORTED`, `NFC_NOT_FORMATTED`, `NFC_FOREIGN_CONTENT`, `NFC_SOMAFRIK_ORPHAN`, `NFC_READ_ONLY`, `NFC_UID_BLOCKED` ; code natif journalisé sans donnée sensible |
| Zéro verrouillage | Vrai dans `develop` | **Garde-fou CI** interdisant `makeReadOnly`, `0xA2`, `0x1B`, `formatNdef` hors module explicitement autorisé |

### 8.2 PR correctives proposées (aucune ouverte dans ce lot)

> **Révision 2 :** ce tableau est **remplacé** par le §4 de `NFC-P0-RECOVERY-01-protocole-recuperation.md`. PR-1 n'y modifie plus l'index UID : elle ajoute `nfc-inspect` (lecture) et `nfc-recover` (reprise de la même ligne). Le tableau ci-dessous est conservé pour la traçabilité de la révision 1.

| # | Priorité | Périmètre | Dépend de | Contenu |
| --- | --- | --- | --- | --- |
| **PR-0** | P0 | Mobile + CI | — | Garde-fou CI contre toute commande de verrouillage/écriture brute ; marquer #908 « ne pas fusionner en l'état » (le bouton de verrouillage). |
| **PR-1** | P0 | Backend + migration | Décision CTO sur la politique UID | Remplacer l'index global par un index partiel sur les statuts vivants **ou** ajouter une libération d'UID explicite et auditée pour `nfc_reservation_expired` / `nfc_abandoned`. Historique conservé. Tests PG 4/27/29 à réviser en conséquence (changement de contrat assumé). |
| **PR-2** | P0 | Mobile | PR-1 | Pré-contrôle : distinguer NDEF Somafrik orphelin (vérifié côté serveur : `publicId` révoqué/expiré du même établissement) et autoriser sa réécriture avec consentement ; codes d'erreur distincts (§8.1). |
| **PR-3** | P1 | Mobile | — | Mode « Diagnostic carte » en lecture seule (READ 0x30 pages 0-44, aucun WRITE) produisant la classification A-G sans exposer le secret. |
| **PR-4** | P1 | Mobile | PR-2 | Relecture en une seule présentation (#939 à auditer) ; reprise après redémarrage basée sur la carte présentée. |
| **PR-5** | P2 | Backend | PR-1 | Expiration proactive des réservations et indicateur `expired` côté serveur (complète #938). |
| **PR-6** | P2 | Mobile | Décision CTO | Formatage NDEF contrôlé des puces `NdefFormatable` (non destructif, sans verrouillage). |

Ordre conseillé : PR-0 → PR-1 → PR-2 → PR-3 → PR-4 → PR-5 → PR-6.

---

## 9. Matrice de tests

### 9.1 Tests automatisés exécutés dans cet audit

| Test | Résultat |
| --- | --- |
| `evidence/nfc-p0-recovery-01/nfc-p0-proof.test.ts` (P-01 à P-08, mocks) | **8/8 verts** — reproduisent CR-1, CR-2, CR-3 |
| `evidence/nfc-p0-recovery-01/nfc-p0-format.test.ts` (F-01, F-02) | **2/2 verts** — format compatible ; NTAG215/non-NXP refusés |
| `backend/lib/studentCardsNfcLifecycle.pg.test.js` sur PostgreSQL 16 jetable | **37/37 verts** — confirment l'unicité d'UID « à vie » (n° 4, 8, 27, 29) |
| `npm run test:student-card-nfc-encoding` / `-batch` / `-security` | 52/52, 45/45, 13/13 verts |
| `src/lib/nfcSession.test.ts` | 8/10 : les 2 échecs sont dus à l'absence de `Mobile/node_modules` dans le conteneur d'audit (module natif introuvable). Le même contrôle a été rejoué par F-01 avec la bibliothèque beta.10 extraite : vert. |
| `evidence/nfc-p0-recovery-01/inventory-readonly.sql` (révision 2 : Q1-Q8, Q7 en liste blanche) | 8/8 requêtes exécutées sans erreur, en `READ ONLY` + `ROLLBACK`, sur un PostgreSQL 16 local jetable ne contenant que le schéma (aucune donnée) |

### 9.2 Matrice cible (après corrections)

| Test | Résultat attendu | Type |
| --- | --- | --- |
| NTAG213 vierge | Encodage valide | Auto (mock) + physique labo |
| Carte déjà encodée | Reconnaissance sans écriture | Auto (P-06) + physique |
| Double présentation | Pas de double écriture | Auto (P-06) |
| Interruption d'écriture | `RECOVERY_REQUIRED`, puce réinscriptible | Auto + physique labo |
| Interruption de relecture | Reprise sans réécriture | Auto (P-03) + physique |
| Échec réseau à la confirmation | Réconciliable sans perte, même après 30 min | Auto (régression de P-04) |
| Ancienne carte Somafrik (orpheline) | `NFC_SOMAFRIK_ORPHAN`, réécriture avec consentement | Auto (régression de P-04/P-05) |
| Carte d'un autre établissement | Refus métier, aucune écriture | Auto + PG |
| NDEF invalide / URL fournisseur | Diagnostic explicite | Auto (P-07) |
| Carte protégée / lecture seule | Refus sans écriture (`NFC_READ_ONLY`) | Auto (P-08) + labo |
| UID déjà attribué (carte active) | Conflit sans doublon | PG |
| Application fermée pendant l'opération | Reprise par la carte présentée, sans écriture aveugle | Auto |
| Carte valide rejetée | Couche responsable identifiée | Diagnostic PR-3 |
| Aucune commande de verrouillage | Échec CI si `makeReadOnly`/`0xA2`/`0x1B` | CI (PR-0) |

Tests destructifs : **interdits sur cartes réelles**. Utiliser des mocks et des cartes de laboratoire dédiées, étiquetées.

---

## 10. Impact sur les PR Carte Élève et NFC ouvertes

Fusionnées dans `develop` depuis le début de l'incident (consommateurs en **lecture**, sans impact sur l'encodage) : #941, #944, #945.

| PR | Impact NFC |
| --- | --- |
| [#908](https://github.com/Somafrik-education/Somafrik/pull/908) NFC-ENC-01, [#909](https://github.com/Somafrik-education/Somafrik/pull/909) NFC-RECON-02, [#912](https://github.com/Somafrik-education/Somafrik/pull/912) NFC-PROG-02 | **Bloquant** : `makeReadOnly` irréversible derrière un bouton, et un APK installable a été construit pour chacune. Ne pas fusionner en l'état. Archiver les artefacts avant le 26-27/10. |
| [#939](https://github.com/Somafrik-education/Somafrik/pull/939) ONE-TAP | Lecture brute `READ 0x30` seulement (pas de WRITE brut observé) : base utile pour PR-3/PR-4. Audit complet du chemin d'écriture requis. |
| [#938](https://github.com/Somafrik-education/Somafrik/pull/938) BATCH expired | Débloque le **créneau élève**, **ne libère pas l'UID** : ne résout pas CR-1. Compatible. |
| [#937](https://github.com/Somafrik-education/Somafrik/pull/937), [#934](https://github.com/Somafrik-education/Somafrik/pull/934), [#949](https://github.com/Somafrik-education/Somafrik/pull/949) Reader Mode | Cycle de vie de la session NFC : à réévaluer avec PR-4 (relecture). Pas de verrouillage observé. |
| [#925](https://github.com/Somafrik-education/Somafrik/pull/925), [#927](https://github.com/Somafrik-education/Somafrik/pull/927), [#922](https://github.com/Somafrik-education/Somafrik/pull/922), [#926](https://github.com/Somafrik-education/Somafrik/pull/926), [#928](https://github.com/Somafrik-education/Somafrik/pull/928), [#929](https://github.com/Somafrik-education/Somafrik/pull/929) | Redécouverte / confirmation / persistance : traitent CR-3 partiellement ; à consolider après décision sur CR-1. |
| [#935](https://github.com/Somafrik-education/Somafrik/pull/935), [#936](https://github.com/Somafrik-education/Somafrik/pull/936), [#940](https://github.com/Somafrik-education/Somafrik/pull/940), [#946](https://github.com/Somafrik-education/Somafrik/pull/946), [#947](https://github.com/Somafrik-education/Somafrik/pull/947), QA [#943](https://github.com/Somafrik-education/Somafrik/pull/943) [#948](https://github.com/Somafrik-education/Somafrik/pull/948) | Lecture uniquement : pas de risque matériel, mais inutilisables tant que les cartes ne sont pas récupérées. |
| #910, #913-#917, #930, #932 | Historique d'intégration ; à fermer ou rebaser après décision. |

---

## 11. Critères de clôture P0 — état

| Critère | État |
| --- | --- |
| Cause des rejets identifiée ou circonscrite | **Identifiée** pour CR-1/CR-2/CR-3 ; CR-5/CR-6 à confirmer par le diagnostic matériel |
| Diagnostic individuel de chaque carte rejetée | **À faire** — protocole prêt (`…-protocole-diagnostic-physique.md`), non exécuté |
| Procédure de remise en service validée | Révision 2 (`…-protocole-recuperation.md`), **à valider CTO** |
| Aucun verrouillage irréversible possible | Vrai sur `develop` ; garde-fou CI à ajouter (PR-0) ; #908/#909/#912 à neutraliser ; téléphones à vérifier (`…-provenance-apk.md`) |
| Interruptions et réencodages maîtrisés | **Non** tant que PR-1/PR-2 ne sont pas livrées |
| Cohérence NFC / API / PostgreSQL démontrée | Partielle (SQL Q2-Q6 à exécuter en lecture) |
| Tests automatisés et physiques validés | Automatisés : oui ; physiques : **non exécutés** |
| Autorisation CTO de reprise | En attente |

## 12. Questions à trancher par le CTO

1. Un des trois APK à risque (#908, #909, #912) a-t-il été installé sur un téléphone ayant manipulé les cartes ? Procédure : `…-provenance-apk.md` §2.
2. ~~Politique UID~~ — **tranché** par le complément CTO : unicité globale conservée. Décisions restantes : `…-protocole-recuperation.md` §6.
3. Autorisation d'exécuter le diagnostic non destructif (§6) et les requêtes en lecture (Q1-Q7) sur l'environnement où les cartes ont été rejetées.
4. Les cartes livrées sont-elles bien des NTAG213/216 NXP, formatées NDEF, sans contenu fournisseur ? (référence d'achat et fiche fournisseur)

---

**NFC-P0-RECOVERY-01 — DRAFT / HOLD — DIAGNOSTIC À VALIDER PAR LE CTO.**
