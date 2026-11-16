# AUDIT-NFC-02 — Système NFC Somafrik V2

**Statut :** `AUDIT-NFC-02 — RÉFÉRENTIEL NTAG216 P0 — DRAFT / HOLD — AUCUN READY — AUCUN MERGE.`

Le diff structurel de [#918](https://github.com/Somafrik-education/Somafrik/pull/918) a été confirmé par le CTO (base `1bdd302e`, HEAD alors `29ec1a93`, 1 fichier, +551). La section H confronte ensuite les conclusions critiques aux sources. Elle ne passe pas la PR en Ready.

**Nature :** audit technique, fonctionnel et sécurité. Documentation uniquement.  
**Date de lecture :** 13 octobre 2026 (mandat daté 14 octobre 2026).  
**Base auditée :** `develop` @ `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`.  
**Autorisation produit :** aucune. Aucune migration, aucun RBAC, aucun encodage, aucune donnée élève modifiée.

Ce document décrit le code **mergé** sur `develop`. Les PR NFC encore ouvertes sont inventoriées comme dépendances. Elles ne sont pas le système en service. Une fonctionnalité n’est opérationnelle que si elle est sur `develop` et couverte par une preuve exécutée. La présence de code dans une PR draft ne suffit pas.

Le nom de branche recommandé par le mandat (`audit/nfc-v2-complet`) n’est pas utilisé : la politique de branche de cet agent impose `cursor/<nom>-1f6a`. La branche de ce rapport est `cursor/audit-nfc-v2-complet-1f6a`.

---

## A. État GitHub

### A.1 Base

| Élément | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Branche lue | `develop`, alignée sur `origin/develop` (0 ahead / 0 behind au moment du `git fetch`) |
| SHA `develop` | `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f` |
| Sujet | `fix(student-docs): use canonical school login_code for student lookup (#907)` |
| Date du commit | 2026-10-12 03:10:02 +0200 |
| Merge-base de la branche d’audit | identique à ce SHA tant que la branche ne contient que ce rapport |
| État de travail avant le rapport | arbre propre |

Le SHA ci-dessus a été relu après `git fetch origin develop`. Il ne reprend pas l’ancien SHA de clôture d’AUDIT-CARTE-01 (`8cb187d7`).

### A.2 Chantiers cités par le mandat

| Référence | État au 13 octobre 2026 | Ancêtre de `develop` | Chevauchement avec cet audit |
| --- | --- | --- | --- |
| [#876](https://github.com/Somafrik-education/Somafrik/pull/876) AUDIT-CARTE-01 | **MERGED** 2026-10-05, commit `3a8d4f1fdc8055461ab3d9d50c7a453d0db08340` | oui | Document historique. Ses constats « aucune carte » sont **périmés**. Son constat « permission NFC Android retirée » reste vrai. |
| [#877](https://github.com/Somafrik-education/Somafrik/pull/877) CARTE-PR0 | **MERGED** 2026-10-06, commit `8bbeb9a9d9361e6785365b6cadde01f815afa1af` | oui | Flags `school_settings` déjà sur `develop`. Cet audit ne les réécrit pas. |
| [#878](https://github.com/Somafrik-education/Somafrik/pull/878) SEC-DEP-01 | **MERGED** 2026-10-06, commit `cea3439de1a53f861a43a55b368e326bd779d404` | oui | Correctif `proxy-addr`. Hors périmètre NFC. Aucun fichier de ce correctif n’est repris ici. |

Chaîne carte déjà mergée, à ne pas rouvrir dans ce chantier : #879 DDL, #880 cycle de vie, #881 scan resolve, #882 scan présence, #885 secret hors idempotency, #886 Web impression, #887 gate QR, #890 gate NFC (revue, pas d’implémentation matérielle).

### A.3 PR NFC ouvertes — non mergées, hors vérité `develop`

Toutes sont **draft**. Aucune n’est ancêtre de `develop`. Elles ne doivent pas être mergées au titre de cet audit.

| PR | Base déclarée | HEAD | Note |
| --- | --- | --- | --- |
| [#891](https://github.com/Somafrik-education/Somafrik/pull/891) CARTE-PR8 Mobile NFC | `72aea41b` — **base périmée**, pas le `develop` courant | `b2aaa615` | 24 fichiers, +1728/−32. Draft / HOLD. |
| [#908](https://github.com/Somafrik-education/Somafrik/pull/908) NFC-ENC-01 | `1bdd302e` | `c3db71cb` | Encodage UID / verrouillage. |
| [#909](https://github.com/Somafrik-education/Somafrik/pull/909) NFC-RECON-02 | `1bdd302e` | `91c2af5c` | Réconciliation lecteur Android. |
| [#910](https://github.com/Somafrik-education/Somafrik/pull/910) NFC-PROG-01 | `1bdd302e` | `c0230910` | Contrat. |
| [#912](https://github.com/Somafrik-education/Somafrik/pull/912) NFC-PROG-02 | `1bdd302e` | `c6f5eaaa` | Backend / PostgreSQL programmation. |
| [#913](https://github.com/Somafrik-education/Somafrik/pull/913) NFC-PROG-03 Android | `1bdd302e` | `db6ca7ec` | **Contient la phrase observée en QA.** |
| [#914](https://github.com/Somafrik-education/Somafrik/pull/914) UUID confirmation | `1bdd302e` | `01d2ebc9` | Même phrase. |
| [#915](https://github.com/Somafrik-education/Somafrik/pull/915) série par classe | `1bdd302e` | `051751e6` | Même phrase. |
| [#916](https://github.com/Somafrik-education/Somafrik/pull/916) intégration | `1bdd302e` | `6734ff81` | Même phrase. |
| [#917](https://github.com/Somafrik-education/Somafrik/pull/917) minSdk | `1bdd302e` | `5f2aa252` | Même phrase. |

Ces branches se recouvrent. Les merger en parallèle produirait des conflits. #891 n’est même pas basée sur le `develop` audité.

### A.4 Cette PR

| Élément | Valeur |
| --- | --- |
| URL | https://github.com/Somafrik-education/Somafrik/pull/918 |
| Statut | Draft / HOLD. Ne pas passer en Ready. Ne pas merger. |
| Base | `develop` @ `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f` |
| HEAD initial du rapport | `5b41de3a0432f74c1d20468af67d0dd6fcdc2a9c` |
| Merge-base | `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f` |
| Ahead / behind au premier push | 1 / 0 |
| Fichiers | `docs/audits/AUDIT-NFC-02-systeme-nfc.md` uniquement |
| Diff produit | aucun |
| CI | non déclarée PASS dans cet audit. Lire l’onglet Checks de #918. |

---

## B. Cartographie technique

### B.1 Architecture réelle sur `develop`

```
Carte logique PostgreSQL (student_access_cards)
        │  secret montré une fois (cardToken = publicId.secret)
        ▼
QR imprimé (Web)  ──lecture caméra Mobile──►  POST /api/student-cards/scan
                                                      │
                      master flag + hash SHA-256 + statut active + tenant
                                                      │
                         ┌────────────────────────────┼────────────────────┐
                         ▼                            ▼                    ▼
                    identité élève            upsert présence         badge finance
                    (200)                     si attendance{}         si finance:true
                                              + flag pointage         + flag finance
                                              + droit présence        + droit finance
```

Il n’y a **pas** de flèche « puce NTAG → téléphone » sur `develop`. La permission Android `NFC` est retirée au manifeste. Aucune bibliothèque NDEF n’est déclarée.

Le `cardToken` est le même capability pour un support déclaré `qr`, `nfc` ou `nfc_qr`. Le support est une étiquette en base. Le scan HTTP ne la consulte pas.

### B.2 Fichiers concernés (mergés)

**PostgreSQL**

- `backend/db/migrations/20261005_school_settings_student_card_flags.sql`
- `backend/db/migrations/20261006_student_access_cards.sql`
- `backend/db/schema.sql` (colonnes et table reprises)
- `backend/db/schoolSettingsSchema.js`, `schoolSettingsPgStore.js`
- `backend/db/studentAccessCardsSchema.js`, `studentAccessCardsPgStore.js`

**Backend**

- `backend/lib/schoolSettingsManagement.js` — catalogue de flags, fail-closed
- `backend/lib/studentAccessCardsManagement.js` — émission, perte, révocation, remplacement, resolve
- `backend/lib/studentCardCapability.js` — parse + comparaison de hash
- `backend/lib/studentCardCapabilities.js` — projection HTTP des flags (sans NFC)
- `backend/lib/studentCardAttendance.js` — intention présence
- `backend/lib/studentCardFinance.js` — badge informatif
- `backend/server.js` — routes `/api/student-cards*` et `/api/students/:id/cards`
- `backend/services/rbacService.js` — permissions de routes
- `backend/lib/platformPersonalDataGuard.js` — deny plateforme

**Web**

- `web/src/components/students/StudentCardTab.tsx` — fiche
- `web/src/components/students/StudentCardSettingsSection.tsx` — paramétrage
- `web/src/components/students/StudentCardPrintView.tsx` — QR
- `web/src/lib/studentCardPolicy.ts`, `studentCardsApi.ts`

**Mobile**

- `Mobile/src/components/StudentCardQrScannerModal.tsx`
- `Mobile/src/lib/studentCardScan.ts`
- `Mobile/src/services/studentCardScanApi.ts`
- `Mobile/src/screens/TeacherAttendanceScreen.tsx` — bouton dans l’appel
- `Mobile/app.config.js` et `Mobile/plugins/withSomafrikAndroidSecurity.js` — NFC bloqué

**Interdit matériel, vérifié par scripts**

- `Mobile/scripts/verify-student-card-qr.js`
- `Mobile/scripts/verify-mobile-security.js`
- `Mobile/scripts/verify-native-prebuild.js`

### B.3 Tables

`school_settings` — cinq booléens, défaut `FALSE`, `NOT NULL` :

- `student_card_enabled`
- `student_card_qr_enabled`
- `student_card_nfc_enabled`
- `student_card_attendance_enabled`
- `student_card_finance_check_enabled`

`student_access_cards` :

- identité : `id` UUID, `public_id` unique global, `token_hash` SHA-256 hex unique
- tenant : `school_id`, `student_id`, FK composite vers `students(school_id, id)`
- `medium` ∈ `nfc | qr | nfc_qr`
- `status` ∈ `issued | active | lost | revoked | replaced`
- dates : `issued_at`, `revoked_at`, `created_at`, `updated_at`, `last_scan_at` (colonne présente, **jamais écrite**)
- remplacement : `replaced_by_card_id` FK même élève
- index unique partiel : une seule ligne `active` par `(school_id, student_id)`

Pas de table d’historique dédiée. L’historique est la ligne elle-même (statuts terminaux conservés) plus `audit_logs` via `recordAudit` (`student_card_issued|lost|revoked|replaced`). Le scan et la consultation finance n’écrivent pas d’audit carte.

Pas de `ENABLE ROW LEVEL SECURITY` sur ces tables. L’isolation est applicative : le backend interroge PostgreSQL avec un rôle privilégié et filtre `school_id`.

Pas de table transport, ligne de bus, montée ou descente.

### B.4 Routes

| Méthode | Route | Source | Authn | RBAC | Établissement | Flag serveur | SQL | Idempotence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/students/:id/cards` | `server.js` ~2228 | `requireAuth` | `Élèves:READ` ou `Voir élèves` | scope école, élève dans l’école | master, sinon 404 `STUDENT_CARD_DISABLED` | `listByStudent` | lecture |
| POST | `/api/student-cards` | ~2236 | oui | `Élèves:UPDATE` ou `Gérer élèves` | scope école | master seulement | insert `active` | non. Second appel : 409 `ACTIVE_ALREADY_EXISTS`. La clé d’idempotence ne rejoue pas le token |
| POST | `/api/student-cards/:id/lost` | ~2252 | oui | idem | carte dans l’école | master | update si `active` | oui au sens métier : déjà `lost` → 200 même ligne |
| POST | `/api/student-cards/:id/revoke` | ~2267 | oui | idem | idem | master | update si `active` | déjà `revoked` → 200 |
| POST | `/api/student-cards/:id/replace` | ~2344 | oui | idem | idem | master | transaction : insert puis `replaced` puis `active` | non. Rejeu de clé après succès : 409 `INVALID_STATE` |
| GET | `/api/student-cards/capabilities` | ~2282 | oui | `Présences:CREATE` ou `UPDATE` | scope école | lecture fail-closed | settings | `Cache-Control: no-store` |
| POST | `/api/student-cards/scan` | ~2291 | oui | `Présences:CREATE` ou `UPDATE` | scope école + hash | master toujours. Pointage si body `attendance`. Finance si `finance:true` | resolve ; upsert présence ; lecture frais | **seulement** la branche présence (`withIdempotency`) |

PostgreSQL canonique requis (`repository.engine !== "memory"`), sinon 501.

Réponses d’erreur principales : 400 token ou intention invalide, 403 tenant / permission / plateforme / élève hors classe affectée, 404 master off, carte inconnue ou élève inconnu (volontairement indistincts pour le token), 409 carte inactive, inscription absente, conflit présence+finance, carte active déjà là.

Le scan **ne lit pas** `student_card_nfc_enabled` ni `student_card_qr_enabled`. Un client HTTP peut donc résoudre un token alors que la case NFC ou QR est décochée, tant que le master est vrai.

### B.5 Paramètres

Catalogue figé : `STUDENT_CARD_FLAG_FIELDS` dans `schoolSettingsManagement.js`. Clé inconnue ignorée par le parseur de patch si elle n’est pas dans la liste. Valeur non booléenne : 400 `INVALID_STUDENT_CARD_FLAG`. Absent, `null`, nombre, chaîne : **false** (`coerceFailClosedBoolean` n’accepte que `true`).

Le master à false rend toutes les sous-capacités false, y compris si la colonne NFC vaut true en base (`isStudentCardCapabilityEnabled`).

Héritage pays → école : aucun. Chaque école a sa ligne `school_settings`.

Écriture : `Paramètres Établissement:UPDATE`, `Gérer planning académique`, ou `ALL_PRIVILEGES`. Superadmin : le garde-fou settings le laisse passer dans `assertSchoolSettingsWrite`, mais les routes de données élèves restent dans `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`. Le patch des flags est un paramètre d’établissement, pas une lecture de dossier.

Lecture settings : permissions paramètres, ou `Gérer classes`, ou privilège pays. Ce n’est pas la route capabilities.

Capabilities Mobile omet `studentCardNfcEnabled`. Le téléphone qui n’appelle que `/student-cards/capabilities` ne peut pas afficher l’état NFC.

### B.6 Dépendances matérielles

Sur `develop` : aucune. `Mobile/package.json` ne contient pas `react-native-nfc-manager` ni `expo-nfc`. `android.permission.NFC` est dans `blockedPermissions`. Les scripts de sécurité échouent si on l’ajoute. iOS : pas de `NFCReaderUsageDescription`.

---

## C. Inventaire fonctionnel

| Fonction | Statut sur `develop` | Preuve |
| --- | --- | --- |
| Flag master / QR / NFC / pointage / finance | Implémenté, défaut false, fail-closed à la lecture | migration `20261005`, `schoolSettings.studentCard.test.js` PASS |
| Enforcement serveur du flag NFC | **Absent** sur émission et scan | `issueStudentCard` et `scanStudentCard` n’appellent que le master |
| Enforcement serveur du flag QR | **Absent** | le bouton Mobile le consulte ; l’API scan non |
| Enforcement pointage et finance | Implémenté, fail-closed | `studentCardAttendance.js`, `studentCardFinance.js` |
| Émission logique + QR Web | Implémenté si master et QR | `StudentCardTab`, `StudentCardPrintView` |
| Émission NFC seule depuis le Web | Désactivée volontairement | `STUDENT_CARD_NFC_ONLY_NOTICE` |
| Programmation physique NTAG216 (P0) et NTAG213 (P1) | **Absente pour les deux** | pas de code NDEF ; permission NFC retirée. La compatibilité téléphone ne vaut pas une prise en charge Somafrik |
| Lecture physique NFC | **Absente** | idem |
| Lecture QR dans l’appel | Implémentée, en ligne seulement, une carte puis réarmement manuel | `StudentCardQrScannerModal` |
| Appel classe par scans successifs sans quitter l’écran, compteur de session | **Absent** | pas de session NFC ; le QR se met en pause après chaque lecture |
| Compteur d’appel (présents / effectif de la classe) | Implémenté, hors session NFC | `TeacherAttendanceScreen.tsx` affiche `attended/effectif` via `getRollCallDraftStats`, qui compte des élèves uniques |
| Présence canonique depuis un token | Implémentée (présent ou retard), pas depuis une puce | `scanStudentCardHttp` → `upsertAttendance` |
| Badge impayé informatif | Implémenté, ne bloque pas la présence | `classifyStudentCardFinance` |
| Exclusion automatique cours ou bus pour impayé | **Absente** (conforme au mandat) | aucun lien carte → exclusion |
| Module bus (lignes, montée, descente) | **Absent** | aucune table, aucune route |
| Révocation / perte / remplacement logique | Implémenté | store + index une carte active |
| Vérification que l’ancienne puce est illisible | **Non vérifiable** | il n’y a pas de puce |
| Historique d’affectation | Partiel | statuts + audit émission/révocation ; `last_scan_at` toujours null |
| iPhone NFC | **Absent**, et bloqué par la config | pas d’entitlement |
| Multiscan Android 30 cartes | **Non implémenté** sur `develop` | aucun reader mode |

### C.1 Cas QA « Active » + « La programmation NFC est désactivée »

La phrase exacte **n’existe pas** sur `develop`. Recherche `git grep` sur `origin/develop` : zéro occurrence.

Elle existe dans le composant non mergé `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` des PR #913, #914, #915, #916 et #917 :

- le libellé de carte vient de `card.status` (`active` → « Active ») ;
- la phrase s’affiche si la liste a répondu **et** `response.nfcEnabled !== true` ;
- `nfcEnabled` est calculé, dans ce code non mergé, par `studentCardEnabled === true && studentCardNfcEnabled === true`.

Donc, **dans ce brouillon**, les deux lignes ne sont pas une contradiction : l’état de la carte et l’autorisation d’encodage sont deux champs. `assertNfcEnabled` de ce brouillon vise l’encodage (`STUDENT_CARD_NFC_DISABLED`), pas le resolve de présence. Ce comportement n’est pas en production tant que ces PR restent draft.

Ce que `develop` fait, lui, pour le même couple d’états :

| Question | Réponse sur `develop` | Limite de preuve |
| --- | --- | --- |
| 1. La carte affichée est-elle `active` dans PostgreSQL ? | L’UI Web affiche « Active » seulement si `status === "active"`. La ligne de **cet** élève de la capture n’a pas été lue : aucune connexion base, aucune écriture autorisée. | **Non vérifiable** pour la capture |
| 2. Est-elle affectée à l’élève ? | Si la ligne existe, la FK `(school_id, student_id)` l’exige. L’UI liste les cartes de l’élève ouvert. | Schéma prouvé ; ligne réelle non lue |
| 3. Le flag désactive-t-il seulement l’encodage ? | Il n’y a pas d’encodage. Le flag NFC est stocké et affiché dans Paramètres. Il ne bloque ni l’émission API ni le scan API. | Code |
| 4. La lecture NFC reste-t-elle autorisée ? | Il n’y a pas de lecture NFC. La lecture du **token** (QR ou HTTP) ignore le flag NFC. | Code |
| 5. Une carte déjà émise peut-elle encore pointer ? | Oui, si master + flag pointage, token valide, statut `active`, inscription courante, rôle `Présences:CREATE` ou `UPDATE`, et — pour un enseignant — affectation à la classe. Le flag NFC n’intervient pas. | Code ; pas de téléphone |
| 6. Peut-on encore affecter une carte neuve si NFC est off ? | Oui côté API, y compris `medium: "nfc"`, si le master est on. Le Web n’émet un support `nfc_qr` que si QR et NFC sont on, et refuse l’émission Web si seul le NFC est on. | Code |
| 7. Le backend bloque-t-il les opérations interdites ? | Master off : 404 sur émission, liste et scan. Pointage off : 404 seulement si le body contient `attendance`. Finance off : 404 seulement si `finance:true`. NFC off : **non bloqué**. | Tests unitaires PASS ; tests HTTP PostgreSQL **non exécutés** |
| 8. L’interface sépare-t-elle état de carte et autorisation d’encodage ? | Sur `develop`, la fiche montre le statut de carte. Le paramétrage montre une case NFC séparée, avec la phrase « Le Web ne programme pas la puce NFC ». La fiche ne dit pas « programmation désactivée ». Cette séparation explicite n’existe que dans les PR draft. | Code |

Matrice d’états **attendue si le flag NFC ne devait gouverner que l’encodage** (hypothèse métier du mandat) et **observée sur `develop`** :

| Master | NFC | QR | Pointage | Carte déjà `active` | Encodage puce | Nouvelle émission API `medium=nfc` | Scan token → présence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| off | * | * | * | liste 404, scan 404 | impossible (pas de code) | 404 | 404 |
| on | off | off | on | liste OK, statut inchangé | impossible | **201, flag ignoré** | 201 si token valide |
| on | off | on | on | liste OK | impossible | **201** ; le Web émet plutôt `qr` | 201 |
| on | on | on | on | liste OK | toujours impossible sur `develop` | 201, le Web choisit `nfc_qr` | 201 |
| on | on | off | on | liste OK | impossible | 201 API ; Web affiche l’avis « lot NFC » et n’émet pas | 201 API ; bouton QR Mobile caché |

---

## D. Anomalies

### NFC-02-01 — P0 — Aucune prise en charge NTAG216 ni NTAG213 sur `develop`

- **Observé :** pas de lecture, d’écriture, de verrouillage, de détection de tag vierge ou déjà programmé, pour aucun des deux types. La permission NFC est retirée.
- **Attendu :** le matériel de recette est la **NTAG216** (P0, cartes physiques disponibles). La **NTAG213** reste une compatibilité P1. Les deux sont NFC Forum Type 2. L’application doit les programmer et les relire sans fichier d’identifiants fournisseur. Le contenu NDEF doit tenir dans les 144 octets utilisateur de la NTAG213. Les 888 octets de la NTAG216 ne deviennent pas une dépendance fonctionnelle.
- **Cause :** le matériel a été volontairement tenu hors des lots mergés (gate #890, PR8 #891 encore draft). L’audit initial citait la NTAG213 comme carte de référence. L’addendum CTO du 13 octobre 2026 inverse cette priorité. Cela ne crée pas de code.
- **Fichiers :** `Mobile/app.config.js`, `Mobile/plugins/withSomafrikAndroidSecurity.js`, `Mobile/package.json`.
- **Preuve :** `verify-student-card-qr.js` PASS (le script **exige** l’absence de `react-native-nfc-manager`).
- **Reproduction :** build Android de `develop`, présenter une NTAG216. Aucun écran ne l’écoute. Le même constat vaut pour une NTAG213 le jour où ce stock existera.
- **Risque :** une carte « Active » en base n’a aucun lien prouvé avec une puce, NTAG216 comprise.
- **Correction :** ne pas l’improviser ici. Trancher d’abord le chevauchement #891 / #908–#917, puis un mandat d’implémentation commun aux deux types.

### NFC-02-02 — P0 — L’appel par scans successifs n’existe pas

- **Observé :** le scanner QR traite une carte, met la caméra en pause, affiche le résultat, et attend « Scanner une autre carte ». Chaque succès écrit tout de suite une présence `present`. Il n’y a pas de compteur « élèves restants » dans le scanner, ni de clôture de session qui enregistre le lot.
- **Attendu :** session continue, 30 → 29 → 28, doublon sans décrément, validation finale.
- **Cause :** CARTE-PR7 est un resolve QR unitaire branché sur l’appel existant, pas une session de masse.
- **Fichiers :** `StudentCardQrScannerModal.tsx` (`setPaused(true)` après lecture), `runStudentCardScanFlow`, `TeacherAttendanceScreen.tsx`.
- **Preuve :** lecture de code. Aucun téléphone. Les tests `studentCardScan.test.ts` PASS décrivent ce flux unitaire, pas un lot de 30.
- **Risque :** le geste métier « appel de classe par badges » n’est pas le geste livré. Le compteur de l’écran Présences compte des élèves au statut présent, pas des événements NFC — ce point, lui, est correct pour le QR, mais il n’est pas un compteur de session.
- **Correction :** mandat séparé, après smoke physique. Ne pas le glisser dans une PR d’encodage.

### NFC-02-03 — P1 — Le flag NFC ne ferme pas l’API

- **Observé :** `student_card_nfc_enabled = false` n’empêche pas `POST /student-cards` avec `medium: "nfc"` ni `POST /student-cards/scan`.
- **Attendu :** fail-closed. Si le métier décide que le flag ne bloque que l’encodage, l’API d’encodage (absente) doit le refuser, et l’émission d’un support `nfc` sans encodeur doit aussi être refusée. Aujourd’hui le flag est un booléen mort côté serveur.
- **Fichiers :** `studentAccessCardsManagement.js` (`assertStudentCardMasterEnabled` seulement), `server.js` route scan.
- **Preuve :** lecture. Test unitaire du helper de flags PASS. Test HTTP PostgreSQL non exécuté dans cet environnement.
- **Risque :** contournement du paramétrage par un client qui ne passe pas par le Web.
- **Correction :** petit mandat backend, après décision CTO : soit le flag bloque `medium` nfc / nfc_qr, soit il ne bloque que les futures routes d’encodage. Documenter le choix. Ne pas le faire dans cette PR.

### NFC-02-04 — P1 — Le flag QR est purement client

- **Observé :** `isStudentCardQrScanEnabled` cache le bouton. L’API scan ne relit pas `student_card_qr_enabled`.
- **Attendu :** le serveur refuse le scan QR quand le canal est coupé, ou assume explicitement que le token est indépendant du canal.
- **Fichiers :** `Mobile/src/lib/studentCardScan.ts`, `server.js`.
- **Risque :** même nature que NFC-02-03.
- **Correction :** à lier à NFC-02-03.

### NFC-02-05 — P1 — Secret montré une seule fois, carte déjà active

- **Observé :** l’insert passe directement à `status = 'active'`. Le `cardToken` n’est renvoyé qu’à la création. La liste ne le contient pas. Le Web prévient qu’il faut remplacer la carte pour réimprimer. Il n’y a pas de deuxième phase « écriture puce confirmée ».
- **Attendu pour une puce :** réserver, écrire, relire, puis activer. Sinon une carte active peut ne jamais avoir été écrite, et une écriture réussie peut ne jamais avoir été confirmée.
- **Fichiers :** `issueStudentCard`, `StudentCardPrintView`.
- **Risque :** perte de réponse HTTP = carte active dont le QR n’est plus affichable. Remplacement = seul recours, et il invalide l’ancien secret même si la puce n’a jamais été gravée.
- **Correction :** le brouillon NFC-PROG-02 introduit une réservation `issued`. Il n’est pas mergé et n’a pas été exécuté ici. Ne pas le déclarer conforme.

### NFC-02-06 — P1 — Le contrôle impayé par carte n’est pas joignable par le comptable

- **Observé :** `POST /scan` exige `Présences:CREATE` ou `UPDATE`, puis, pour le badge, `GET /api/finance/student-fees`. Le rôle Comptable a `Impayés:READ` et `Paiements:READ`, pas `Présences:CREATE`. L’enseignant a la présence, pas la finance. Le badge n’apparaît donc au Mobile que si la session a les deux (secrétaire, proviseur, préfet, directeur). Le badge ne restreint aucun service.
- **Attendu :** consultation selon le rôle finance, sans exiger le droit de faire l’appel, et sans écrire l’impayé sur la puce.
- **Fichiers :** `rbacService.js` lignes des routes scan et finance ; migration RBAC `20260903`.
- **Risque :** le parcours « scan → statut financier » est partiel. Pas d’exclusion automatique (conforme).
- **Correction :** mandat RBAC distinct. Ne pas élargir les rôles dans cet audit.

### NFC-02-07 — P2 — Capabilities sans flag NFC

- **Observé :** `projectStudentCardCapabilitiesHttp` n’expose pas `studentCardNfcEnabled`.
- **Attendu :** le Mobile qui doit expliquer « programmation désactivée » doit lire ce flag, fail-closed.
- **Fichiers :** `studentCardCapabilities.js`.
- **Note :** les PR draft passent `nfcEnabled` par la liste des cartes, pas par capabilities. Deux contrats coexistent, aucun n’est mergé pour le NFC.

### NFC-02-08 — P2 — `last_scan_at` mort, consultation finance non journalisée

- **Observé :** les tests de resolve **exigent** `last_scan_at` null après scan. Aucun événement `student_card_scanned` ni `student_card_finance_checked`.
- **Attendu :** traçabilité des consultations, sans logger le secret.
- **Fichiers :** store, `verify-student-access-cards.js`.
- **Risque :** pas d’historique de lecture. L’upsert présence, lui, est audité (`upsert_attendance_batch`) sans le token.

### NFC-02-09 — P2 — Liste des cartes sans le filtre parent / élève

- **Observé :** `GET /api/students/:id/cards` vérifie l’école et l’existence de l’élève. Elle n’appelle pas `authorizeStudentReadForPrincipal`. Parent et Élève ont `Élèves:READ`. La réponse contient `publicId`, support, statut, dates. Pas le secret.
- **Attendu :** un parent ne liste que son enfant ; un élève ne liste que lui-même. C’est le filtre déjà utilisé par `GET /api/students/:id`.
- **Fichiers :** `server.js` route cards, `classStudentsAuthz.js`.
- **Preuve :** écart de code. Le test HTTP PostgreSQL qui couvre l’enseignant (liste 200) et le comptable (403) **n’a pas été rejoué** ici, et ne contient pas de jeton Parent.
- **Risque :** inventaire des cartes d’un autre élève du même établissement. Pas d’usurpation de token.
- **Correction :** réutiliser le filtre de dossier existant. Mandat séparé.

### NFC-02-10 — P2 — Admin d’établissement ne peut pas scanner

- **Observé :** Admin School a `Élèves:UPDATE` (émission) et `Présences:READ`, pas `Présences:CREATE` ni `UPDATE`. La route scan n’accepte pas « Modifier présences ».
- **Attendu :** à clarifier. Si l’appel est réservé à l’enseignant et au surveillant, c’est cohérent. Si l’admin doit badger, la route est trop étroite.
- **Fichiers :** migration RBAC, `rbacService.js`.

### NFC-02-11 — P3 — Message de fiche ambigu sur `develop`

- **Observé :** statut « Active » et case NFC décochée vivent sur deux écrans. La fiche ne dit pas que la puce n’est pas programmable.
- **Attendu :** deux statuts lisibles, sans bouton mort.
- **Fichiers :** `StudentCardTab.tsx`, `StudentCardSettingsSection.tsx`.
- **Correction :** aucune refonte dans cet audit. La phrase QA appartient aux PR draft, qui séparent déjà les deux statuts.

Pas d’anomalie de double carte active : l’index unique partiel et le `409` la refusent. Pas de carte active pour deux élèves : `public_id` et `token_hash` sont uniques, la FK fixe l’élève. Une carte `replaced`, `lost` ou `revoked` échoue au scan (`409` « Carte inutilisable »). Le hash comparé en temps constant évite de distinguer « public_id inconnu » et « secret faux » (tous deux 404).

---

## E. Sécurité

### E.1 Contrôles réellement implémentés

- Secret 32 octets (`base64url`), hash SHA-256 seul en base, comparaison `timingSafeEqual` avec hash factice si la ligne manque.
- `cardToken` absent des audits, des listes, et de la réponse scan.
- Aucune donnée personnelle dans le format du token (`publicId.secret`). Le QR Web encode ce token, pas le nom ni la finance. Le nom imprimé sur le plastique est un choix d’impression, pas le contenu logique du capability.
- Plateforme (Superadmin, Admin Pays) : routes carte listées dans `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`, deny avant les privilèges. Tests prévus dans `studentAccessCards.http.pg.test.js` — **non rejoués** ici.
- Tenant : scope `mode === "school"` et `school_id` sur chaque requête. Jeton d’une autre école → 404, pas 409.
- Présence : les identifiants élève / classe du body sont ignorés ; la classe vient de l’inscription courante. Un enseignant doit avoir une affectation active sur cette classe (`teacherHasActiveAssignmentForClassId`). Unicité `(school_id, student_id, attendance_date)` : un second scan met à jour la même ligne, il ne crée pas un deuxième présent.
- Finance : intention exclusive avec la présence ; badge calculé côté serveur ; pas d’écriture de frais ; pas de blocage de présence.
- Idempotence de la branche présence si la même `Idempotency-Key` est rejouée. Le Mobile génère une clé **nouvelle** à chaque scan : un second passage volontaire n’est pas un rejeu, c’est un upsert du même jour.
- Data API : `student_access_cards` est dans la liste des tables sensibles du lockdown Supabase (script statique).

### E.2 Risques confirmés par le code, pas par un exploit exécuté

| Risque | Statut | Détail |
| --- | --- | --- |
| Clonage / copie du QR | Confirmé comme propriété du support | Le token est un secret porteur. Quiconque le photographie passe le hash jusqu’à révocation. Ce n’est pas une preuve cryptographique de puce. |
| UID NTAG ou NDEF comme authenticité | Non utilisé sur `develop` | Ne pas les traiter comme preuve. Les brouillons lisent un UID NXP ; ce n’est toujours pas une authentification de puce. |
| Rejeu | Atténué pour la présence du jour | Le second scan réécrit la même présence. Il ne double pas le compte. Il peut toutefois repasser un élève à « Présent » après une correction manuelle. |
| Énumération de tokens | Impraticable | 16 + 32 octets. Le 404 est uniforme. |
| IDOR inter-établissements | Contré dans le code | Filtre `school_id`. Non rejoué sur PostgreSQL dans cet audit. |
| IDOR intra-établissement (liste) | Écart NFC-02-09 | Parent / élève. |
| BOLA scan | Le token est le capability | Sans token, pas d’identité. Avec token, l’identité est renvoyée à tout rôle qui a le droit de scanner, sans filtre de classe sur le resolve nu. L’écriture présence, elle, vérifie l’affectation enseignant. |
| Escalade plateforme | Contrée sur les routes carte | Deny explicite. |
| Flag bypass | NFC-02-03 / 04 | API directe. |
| Journalisation du secret | Contrée sur les audits carte | Le token ne doit pas être loggé. Le Mobile le tient en mémoire volatile (`holdCardToken`). |
| Concurrence deux téléphones | Partielle | Index unique + `FOR UPDATE` au remplacement. Deux scans du même jour convergent vers une ligne. Pas de session de lot. |
| Double écriture puce / base | Non applicable | Pas d’écriture puce. |
| Exploitation hors Mobile | Possible | Les routes sont des API authentifiées ordinaires. Le bouton caché n’est pas un contrôle. |

### E.3 Contrôles absents

- Authentification de puce (signature, SUN, mot de passe NTAG).
- Verrouillage NDEF.
- Rate limit spécifique du scan (non recherché comme middleware dédié ; non revendiqué ici).
- RLS PostgreSQL.
- Journal de consultation finance par carte.
- File hors ligne du scan carte. Le scanner QR refuse le hors ligne. L’appel manuel a une outbox ; le scan carte non. Une coupure pendant un appel par badges perd les scans non encore acquittés et n’enregistre rien localement au titre de la carte.
- Module transport, donc aucun garde-fou « ne pas laisser un enfant descendre sur une lecture douteuse ».

---

## F. Plan de correction

Aucune de ces PR ne doit être ouverte sans mandat CTO. L’ordre tient compte des brouillons déjà ouverts : ne pas en créer de doublons.

| Ordre | Proposition | Objectif | Périmètre | Fichiers prévisibles | Dépendances | Tests obligatoires | Risque | Acceptation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Trancher les drafts | Un seul fil NFC | Décision, pas de code | #891 (rebase), #908–#917 | Cet audit | Diff GitHub indépendant | Merger les drafts en l’état mélange lecteur, encodeur et minSdk | Une base = `develop` courant, un objectif par PR |
| 1 | Contrat flag | Dire ce que NFC off interdit | Doc + tests de caractérisation | settings, scan, issue | Décision CTO sur NFC-02-03 | Unitaires déjà verts + HTTP PG | Changer le sens du flag casse les écoles qui l’ont coché sans encodeur | Matrice de la section C.1 implémentée et testée |
| 2 | Encodeur Android NTAG216 puis NTAG213 | Écrire, relire, puis activer les deux types. Charge utile bornée à la NTAG213 | Mobile + routes déjà esquissées dans #912/#913 | hors `develop` | 0 et 1, smoke NTAG216 d’abord | Tests PG du cycle réservation ; recette Android NTAG216 ; **pas** de PASS mocké | Écriture OK / base KO, ou payload qui ne tient plus sur NTAG213 | Aucune carte `active` sans relecture. Le même NDEF passe sur les deux types |
| 3 | Lecteur d’appel continu | Session, doublons, compteur, fin d’appel | Mobile appel + éventuelle session serveur | `TeacherAttendanceScreen`, scanner | 2 si le canal est NFC ; le QR peut précéder | Scénarios 1/5/10/30, dont doublons et cartes invalides, sur appareil | Perte réseau en milieu de classe | Le compteur = élèves distincts valides, pas événements |
| 4 | Filtre dossier sur la liste | NFC-02-09 | Backend | route `GET .../cards` | aucun | HTTP PG parent / élève / enseignant | Régression secrétaire | Parent : seulement son enfant |
| 5 | Droit finance du scan | NFC-02-06 | RBAC | `rbacService.js` | décision métier | Tests de rôle | Ouvrir la finance trop largement | Comptable consulte ; enseignant ne voit pas les montants ; aucune exclusion |
| 6 | Journal de scan | NFC-02-08 | Backend | audit, pas le secret | 1 | Test « secret absent de l’audit » | Fuite du token dans les logs | `last_scan_at` ou événement sans `cardToken` |
| — | Transport | **Ne pas créer** | — | — | produit inexistant | — | Décision dangereuse sur un enfant si on improvise | Hors mandat |

Le périmètre prioritaire (présence multiscan, impayé selon RBAC, bus, NTAG216) n’est pas terminable par une seule PR. Bus : pas de PR tant que le module n’est pas demandé. Minimum après autorisation, si l’on exclut le bus : les lignes 0 à 3, plus 5 si le contrôle impayé doit servir au comptable. Soit **quatre PR de produit** après la décision de consolidation, **plus** une PR RBAC finance si elle est retenue. Cet audit n’en est pas une.

---

## G. Conclusion

1. **Le système NFC actuel est-il utilisable ?** Non. Sur `develop`, il n’y a pas de système NFC matériel. Il y a une carte logique et un scan QR/HTTP.
2. **Les NTAG216 et les NTAG213 sont-elles prises en charge ?** Ni l’une ni l’autre. `develop` ne lit ni n’encode aucun Type 2. La NTAG216 est le matériel de recette P0, cartes physiques disponibles. La NTAG213 est la compatibilité P1, stock non confirmé. Un téléphone compatible NFC ne prouve pas que Somafrik sait les traiter. Aucun téléphone n’a été utilisé.
3. **Peut-on programmer une carte aujourd’hui ?** Non, sur le code mergé. Les écrans qui disent « Programmer une carte NFC » sont dans des PR draft.
4. **Pourquoi la programmation apparaît-elle désactivée ?** Parce qu’un APK de brouillon (#913 et suivantes) affiche cette phrase quand `studentCardEnabled && studentCardNfcEnabled` n’est pas vrai, **indépendamment** du statut `active` de la carte. Sur `develop`, cette phrase n’existe pas. Le flag NFC naît à `false` et n’est pas relié à un encodeur.
5. **Les cartes actives peuvent-elles être lues ?** En QR ou par API, oui, si master, token, statut `active` et droits de présence. En NFC, non.
6. **Peut-on scanner une classe entière successivement ?** Pas selon le parcours cible. On peut enchaîner des QR en réarmant le scanner à chaque carte. Chaque carte valide écrit une présence immédiatement. Pas de session de 30, pas de compteur de restants dans le scanner.
7. **Les présences sont-elles correctement enregistrées ?** Le chemin unitaire est cohérent avec l’appel canonique : élève résolu par le serveur, classe d’inscription, upsert du jour, pas de double ligne. Cela n’a pas été rejoué sur PostgreSQL dans cet audit. Le flux « on termine l’appel puis on enregistre » n’est pas celui du scan.
8. **Le contrôle des impayés existe-t-il réellement ?** Un badge informatif existe. Il ne bloque rien. Il est invisible pour un comptable qui n’a pas le droit de pointer, et pour un enseignant qui n’a pas le droit finance. Aucune donnée financière n’est écrite sur une carte, puisqu’aucune carte n’est écrite.
9. **Le bus scolaire a-t-il une implémentation ?** Non. « Responsable transport » est un libellé de catalogue, pas un module. Aucune montée, descente, ligne, ni file hors ligne.
10. **Quelles fonctions peut-on exploiter immédiatement ?** Émission et impression QR, révocation, remplacement, scan QR unitaire vers une présence, badge finance pour les rôles qui ont à la fois présence et finance, paramétrage des cinq flags. Tout cela suppose les flags master (et QR, pointage) activés pour l’établissement, ce qui est **faux par défaut**.
11. **Qu’est-ce qui bloque une mise en production NFC ?** Absence de lecteur et d’encodeur sur `develop` pour la NTAG216 comme pour la NTAG213, flags NFC/QR non enforceés côté API, pas de confirmation d’écriture, pas de multiscan, pas de recette physique NTAG216, PR draft concurrentes dont une base périmée (#891), tests PostgreSQL non rejoués dans cet environnement.
12. **Combien de PR pour le périmètre prioritaire ?** Zéro dans ce chantier. Après autorisation : une décision de consolidation des drafts, puis quatre PR produit (contrat de flags, encodeur, appel continu, journal ou filtre selon la priorité retenue) et une PR RBAC si le comptable doit scanner. Le bus n’entre pas dans ce compte.

---

## 18. Matrice de validation

| Domaine | Vérification attendue | Statut | Preuve |
| --- | --- | --- | --- |
| Paramétrage | Flags cohérents et fail-closed | **Partiel** | Master, pointage, finance : fail-closed. NFC et QR : stockés fail-closed à la lecture, non appliqués au scan. `schoolSettings.studentCard.test.js` 12/12 PASS |
| Encodage | NTAG216 P0 et NTAG213 P1 | **Absent pour les deux** | Pas de code sur `develop`. Scripts qui **interdisent** la dépendance NFC : PASS. Matrice section I |
| Affectation | Une carte active liée | **Implémenté, PG non rejoué** | Index unique + FK. Tests HTTP PG BLOCKED |
| Révocation | Ancienne carte inutilisable | **Implémenté en base, puce non concernée** | `scanStudentCard` refuse `status !== active`. Puce : n/a |
| Lecture | Identification serveur fiable | **QR/API seulement** | Hash + tenant + statut. NFC : absent |
| Présences | Multiscan et compteur exacts | **Non conforme au parcours cible** | Unitaire seulement. Compteur de classe = statuts, pas événements |
| Finance | Statut consultable selon RBAC | **Partiel** | Badge oui. Comptable bloqué par le droit présence. Pas d’exclusion |
| Transport | Parcours et contrôles | **Absent** | Aucune table |
| Android | Lecture répétée dans une session | **Absent** | Permission NFC retirée. Pas de reader mode |
| iPhone | Faisabilité documentée | **Non supporté** | Pas d’entitlement, pas de code. Core NFC NDEF serait un autre mandat ; non estimé ici au-delà de cette absence |
| QR/NFC | Règles métier cohérentes | **QR seul** | Même token prévu, canal NFC inexistant. Flags canal non enforceés |
| PostgreSQL | Intégrité et isolation | **Schéma solide, RLS absente, tests PG non exécutés** | Migration + store. Pas d’écriture réelle |
| Sécurité | Pas d’autorisation par simple possession | **Possession du token = identité** | Contrôles de rôle et d’école en plus. La puce n’ajoute rien |
| Web/Mobile | États et messages cohérents | **Écart** | Fiche `develop` ≠ phrase QA, qui vient d’un brouillon |
| CI | Résultats reproductibles | **Partiel** | Suites ci-dessous. CI GitHub de cette PR : à lire sur la PR, pas déclarée ici |

---

## 17. Tests exécutés

Environnement : Node v22.14.0, sans `node_modules`, sans `DATABASE_URL`, sans PostgreSQL, sans téléphone, sans carte.

| Suite | Commande | Résultat | Nombre | Limite |
| --- | --- | --- | --- | --- |
| Schéma cartes | `node --test backend/lib/studentAccessCards.schema.test.js` | **PASS** | 4 | statique |
| Cycle de vie (pur) | `node --test backend/lib/studentAccessCardsManagement.test.js` | **PASS** | 8 | pas de PG |
| Capability | `node --test backend/lib/studentCardCapability.test.js` | **PASS** | 5 | |
| Capabilities HTTP | `node --test backend/lib/studentCardCapabilities.test.js` | **PASS** | 5 | |
| Présence carte | `node --test backend/lib/studentCardAttendance.test.js` | **PASS** | 4 | |
| Finance carte | `node --test backend/lib/studentCardFinance.test.js` | **PASS** | 10 | |
| Flags | `node --test backend/lib/schoolSettings.studentCard.test.js` | **PASS** | 12 | |
| Unicité présence | `node backend/lib/attendanceUniqueness.test.js` | **PASS** | script OK | |
| Garde statique cartes | `node backend/scripts/verify-student-access-cards.js` | **PASS** | script OK | |
| Garde Web | `node scripts/verify-student-card-web.js` | **PASS** | script OK | |
| Politique scan Mobile | `npx tsx Mobile/src/lib/studentCardScan.test.ts` | **PASS** | script OK | pas de caméra |
| Garde QR Mobile | `node Mobile/scripts/verify-student-card-qr.js` | **PASS** | script OK | affirme l’absence de NFC |
| `studentAccessCards.pg.test.js` | `node backend/lib/studentAccessCards.pg.test.js` | **BLOCKED** | 0 | `Cannot find module 'pg'`, et `DATABASE_URL` absente |
| `lifecycle.pg`, `resolve.pg`, `http.pg`, `scan.http.pg`, `attendance.pg`, `finance.pg`, `schoolSettings.pg` | idem | **BLOCKED** | 0 | même cause. Un SKIP silencieux n’est pas un PASS |
| Web `StudentCardTab.test.tsx` et settings | vitest | **NOT RUN** | — | `web/node_modules` absent |
| NFC simulé Android | — | **NOT IMPLEMENTED** sur `develop` | — | des tests existent seulement dans les PR draft, non exécutés |
| NFC physique NTAG216, 1/5/10/30 cartes, doublons, réseau coupé | — | **NOT RUN** | — | téléphone absent de cet audit. Cartes NTAG216 déclarées disponibles par le CTO, non présentées ici. Un mock ne serait pas un PASS |
| NFC physique NTAG213 | — | **NOT RUN** | — | stock non confirmé. À programmer après la recette NTAG216, pour prouver que le même NDEF tient encore |

Tests physiques obligatoires, dans cet ordre :

1. **NTAG216 d’abord** (P0) : vierge, déjà écrite, illisible, tag non NXP, retrait entre deux cartes, 1 puis 5, 10 et 30 cartes, 30 avec doublons, 30 dont certaines invalides, 30 avec coupure réseau, NFC Android coupé, téléphone sans NFC, session expirée.
2. **NTAG213 ensuite** (P1), quand le stock sera confirmé : les mêmes cas, plus la preuve que le NDEF produit pour la NTAG216 tient dans 144 octets utilisateur.
3. iPhone en lecture seule seulement si un mandat ultérieur l’ajoute. Aucun PASS iPhone n’est déduit de la compatibilité matérielle.

---

## 13. Rôles (droits effectifs sur `develop`, pas les boutons)

Légende : oui = la permission de route ou le flag de capacité le permet. Plateforme = deny explicite même si le rôle a le privilège. « Non » pour la puce = pas de code.

| Rôle réel | Lire liste cartes | Programmer puce | Affecter / révoquer | Lire présence | Enregistrer présence par token | Consulter finance par token | Transport | Historique audit carte |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Superadmin | deny plateforme | non | deny | deny routes élèves | deny | deny | non | deny données élèves |
| Admin Pays | deny plateforme | non | deny | deny | deny | deny | non | deny |
| Admin School | oui | non | oui (`Élèves:UPDATE`) | oui (`Présences:READ`) | **non** (pas CREATE/UPDATE) | non, car le scan est fermé | non | via actions qu’il peut faire |
| Proviseur, Directeur, Préfet | oui | non | oui | oui | oui | oui (ils ont `Paiements:READ` ou frais) | non | oui |
| Enseignant | oui, école entière | non | non | oui | oui si affecté à la classe | non | non | non (pas d’émission) |
| Secrétaire | oui | non | oui | oui | oui, avec `teacherId` explicite | oui | non | oui |
| Comptable | non (403 test prévu) | non | non | pas via carte | non | non via carte | non | non |
| Surveillant | oui (`Élèves:READ`) | non | non | oui | oui (`Présences:CREATE`) | non | non | non |
| Parent | route ouverte, filtre enfant **absent** | non | non | lecture présence hors carte | non | non | non | non |
| Élève | même écart | non | non | lecture hors carte | non | non | non | non |
| Personnel transport | rôle métier absent | non | non | non | non | non | non | non |

Le personnel de transport n’a pas de rôle RBAC. Le libellé « Responsable transport » dans `backend/data.js` n’ouvre aucune route.

---

## 11. Multiscan Android — scénarios

| Scénario | `develop` | Preuve requise pour un futur PASS |
| --- | --- | --- |
| 1 carte NTAG216 | QR unitaire seulement | téléphone Android + NTAG216 physique |
| 5, 10, 30 cartes NTAG216 | non | même téléphone, session continue, cartes NTAG216 |
| 30 NTAG216 avec doublons | non | le doublon QR actuel réécrit la présence du jour après réarmement |
| 30 NTAG216 dont invalides | non | le QR invalide affiche une erreur et exige un réarmement |
| 30 NTAG216 avec coupure réseau | non | le scan carte ne queue pas |
| Même série en NTAG213 | non | après la série NTAG216, et seulement si le stock P1 est confirmé |

Performance : non mesurable. Pas de boucle reader mode à chronométrer.

---

## 12. QR et NFC

Même capability, mêmes règles **prévues**. Seul le QR est livré. La révocation casse les deux canaux d’un coup, puisqu’il n’y a qu’un hash. Copier le QR suffit à rejouer le token. Cloner une NTAG216 ou une NTAG213 copierait le même secret le jour où l’écriture existera. Ni l’UID ni le NDEF ne prouvent l’authenticité. Le choix de puce ne change pas cette limite.

---

## H. Validation documentaire finale

**Date :** 13 octobre 2026.  
**Périmètre :** flags de scan, autorisations financières, routes et schéma PostgreSQL, PR #913 à #917.  
**Méthode :** relecture des fichiers sur `develop` @ `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`, et des HEAD GitHub des PR concurrentes. Aucun test PostgreSQL nouveau : `DATABASE_URL` et le module `pg` restent absents. Aucun fichier produit modifié.

Verdict : les conclusions critiques du rapport sont **conformes aux sources**. Une précision corrige la lecture « compteur de présence absent ». Le tableau CTO peut garder « partiel » pour la finance et « absent » pour le NFC matériel. Il ne doit pas traiter le compteur d’appel de classe comme inexistant.

### H.1 Flags de scan

| Affirmation | Verdict | Source |
| --- | --- | --- |
| L’émission ne consulte que le master, puis accepte `nfc`, `qr` ou `nfc_qr`, et insère `status = 'active'` | Conforme | `studentAccessCardsManagement.js` : `assertStudentCardMasterEnabled` ligne 246, `normalizeMedium` ligne 247, `status: "active"` ligne 264. Aucune occurrence de `studentCardNfc` ni `studentCardQr` dans ce fichier |
| Le scan HTTP ne lit ni le flag NFC ni le flag QR | Conforme | `server.js` lignes 2291-2341 : master via `scanStudentCard`, pointage seulement si `attendance`, finance seulement si `finance === true` |
| Le flag pointage est fail-closed et limité à l’intention présence | Conforme | `studentCardAttendance.js` lignes 38-47, appelé depuis `scanStudentCardHttp` après `hasAttendanceIntent` |
| Le flag finance est fail-closed et limité à `finance: true` | Conforme | `studentCardFinance.js` lignes 39-44 et 74-82 ; conflit avec `attendance` lignes 58-63 |
| Le bouton QR Mobile exige master + QR + pointage | Conforme | `studentCardScan.ts` lignes 65-74, utilisé par `isStudentCardQrScannerVisible` |
| Capabilities omet le flag NFC | Conforme | `studentCardCapabilities.js` lignes 9-14 : quatre clés, pas `studentCardNfcEnabled` |
| La branche présence exige aussi l’abonnement `write_presence` | Précision ajoutée, pas une contradiction | `server.js` lignes 2304-2309. Le rapport de routes ne le citait pas |

### H.2 Autorisations financières

`canAccess` compare le jeton du principal à la liste exacte de la route (`rbacService.js` lignes 602-629). « Modifier présences » ne vaut pas `Présences:CREATE`.

| Contrôle | Liste exacte | Conséquence vérifiée |
| --- | --- | --- |
| `POST /api/student-cards/scan` | `Présences:CREATE` ou `Présences:UPDATE` (`rbacService.js` ligne 106) | Porte d’entrée unique, y compris pour le badge finance |
| Deuxième porte finance | `requirePermission("GET /api/finance/student-fees")` puis `assertStudentCardFinanceEnabled` (`server.js` lignes 2331-2337) | `Impayés:READ`, `Paiements:READ` ou `Frais & tarifs:READ` (`rbacService.js` ligne 143) |
| Comptable | `Impayés:READ`, `Paiements:READ`, `Frais & tarifs:READ` (migration `20260903` lignes 817-822). Aucune ligne `Présences:CREATE` | Ne franchit pas la première porte. Le badge existe, le rôle finance ne l’atteint pas par la carte |
| Enseignant | `Présences:CREATE` et `UPDATE` (migration lignes 767-771). Pas de jeton Paiements, Impayés ou Frais | Peut pointer. Ne reçoit pas le badge |
| Admin School | `Présences:READ` seulement (migration ligne 366). Aucune migration ultérieure ne lui ajoute CREATE ou UPDATE | Peut émettre (`Élèves:UPDATE`). Ne peut pas scanner |
| Plateforme | Routes carte dans `platformPersonalDataGuard.js` lignes 93-99, deny avant la liste | Superadmin et Admin Pays restent exclus |
| Effet métier du badge | `classifyStudentCardFinance` renvoie un code. Le scan présence et le scan finance sont exclusifs | Aucune exclusion de cours ou de transport |

Le contrôle financier est donc **partiel** : calcul serveur réel, consultation réservée aux rôles qui ont à la fois le droit de pointer et un droit de lecture finance (secrétaire, direction). Ce n’est pas un module à créer de zéro. La PR de l’étape 5 doit ouvrir la consultation au rôle finance sans donner le pointage à tout le monde, et sans bloquer une présence.

### H.3 PostgreSQL et routes

| Affirmation | Verdict | Source |
| --- | --- | --- |
| Cinq flags, défaut false | Conforme | `20261005_school_settings_student_card_flags.sql` |
| `token_hash` SHA-256 unique, une carte `active` par élève et par école | Conforme | `20261006_student_access_cards.sql` lignes 24-26 et 47-49 |
| `last_scan_at` présent et non écrit par le resolve | Conforme | colonne ligne 20 ; `studentAccessCardsPgStore.js` n’a pas d’`UPDATE` de cette colonne ; les tests de resolve exigent `null` |
| Pas de RLS sur `student_access_cards` | Conforme | aucune instruction `ENABLE ROW LEVEL SECURITY` dans la migration ni dans `schema.sql` pour cette table |
| Présence du jour unique, second scan = mise à jour | Conforme | `postgresRepository.js` lignes 5367-5375, index `uq_attendance_school_student_date` dans `attendanceUniqueness.js` lignes 42-45 |
| Les routes carte refusent le moteur mémoire | Conforme | `requireStudentCardsPg` dans `server.js` lignes 2209-2213 |
| Idempotence limitée à la branche présence | Conforme | `withIdempotency` uniquement dans le `if (hasAttendanceIntent)` lignes 2311-2324 |
| `GET /api/students/:id/cards` ne filtre pas parent / élève | Conforme | `server.js` lignes 2228-2233 : école + élève de l’école, pas `authorizeStudentReadForPrincipal` |

Ces constats de schéma sont des lectures de SQL et de store. Ils ne rejouent pas les suites `*.pg.test.js`, qui restent **BLOCKED**.

### H.4 PR #913 à #917

Relecture GitHub au moment de cette validation. Toutes sont **OPEN**, **draft**, **MERGEABLE**, base `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`. Les HEAD n’ont pas bougé depuis le rapport initial.

| PR | HEAD | Phrase QA |
| --- | --- | --- |
| #913 | `db6ca7ec48817dc52740fb64d3bf52229d01ec6a` | `StudentCardNfcEnrollmentPanel.tsx` |
| #914 | `01d2ebc95c84c68d2c23ba03490ff1f77c634fc0` | même fichier |
| #915 | `051751e6c7412d78546ec33596ca7dec774e925c` | panneau + lot + `studentCardNfcEncoding.ts` |
| #916 | `6734ff816317163830a5b3df2edd4b4e6d5b2e7b` | idem |
| #917 | `5f2aa2522f89675dc99809955feef41e486e4b51` | idem |

`git grep` de la phrase sur `develop` : **absente**.

Sur #917, le panneau affiche `statusLabels.active = "Active"` et, séparément, la phrase si `cards && !enabled`, avec `enabled = response.nfcEnabled === true`. `readNfcEnabled` vaut `studentCardEnabled === true && studentCardNfcEnabled === true`. `assertNfcEnabled` lève `STUDENT_CARD_NFC_DISABLED` pour l’encodage. La capture QA est donc expliquée par ce brouillon, pas par une incohérence de `develop`.

Les listes de fichiers sont emboîtées : #914 reprend #913, #915 ajoute le lot, #916 ajoute l’intégration, #917 ajoute `.gitleaksignore`. Elles modifient les mêmes fichiers produit (`backend/server.js`, `schema.sql`, `TeacherAttendanceScreen.tsx`, manifeste Android). Ce n’est pas la preuve que le contenu commun est identique octet pour octet. C’est la preuve qu’on ne peut pas les merger comme cinq chantiers parallèles. La consolidation doit choisir une pointe et écarter les autres, après diff de contenu. Aucune de ces branches n’est sur `develop`. Leur code NFC n’est pas opérationnel.

Aucune de ces cinq PR n’introduit, dans `StudentCardNfcScannerModal.tsx`, `studentCardNfc.ts` ou `TeacherAttendanceScreen.tsx`, les mots « restant », « remaining » ou « compteur ». Le compteur de session reste à spécifier même si une pointe draft est retenue.

### H.5 Lecture de l’ordre de développement proposé

| Étape CTO | Ce que la source impose |
| --- | --- |
| 1. Consolidation #913–#917 | Confirmé. Une pointe, pas cinq merges. #891 reste à part, base périmée `72aea41b` |
| 2. Contrat de flags | Confirmé. Le trou est l’absence d’enforcement NFC/QR sur l’API de `develop`, pas l’absence des colonnes |
| 3. Encodage et lecture, recette NTAG216 puis compatibilité NTAG213 | Les deux sont absents de `develop`. Le brouillon ne devient pas une recette. La première carte physique est la NTAG216 |
| 4. Multiscan avec compteur de classe | Le compteur d’appel existe déjà (`TeacherAttendanceScreen.tsx` lignes 333-336 et 748-749, `attendanceTruth.ts` `getRollCallDraftStats` lignes 154-179 : élèves uniques). À construire : la session continue et le décompte des restants dans cette session |
| 5. Intégration finance | Le badge existe. À trancher : quel rôle consulte sans pouvoir pointer, toujours sans exclusion automatique |
| 6. Tests PostgreSQL et recette physique | Toujours **BLOCKED** / **NOT RUN**. Indispensables avant un PASS de mise en production |
| Bus | Confirmé absent. Chantier distinct |

### H.6 Décision de cette validation

Les 551 lignes initiales ne sont pas contredites par les sources relues. La seule correction de lecture est le compteur d’appel, déjà nuance dans la section C et désormais explicite ici.

#918 reste **Draft / HOLD**. Cette section n’autorise ni Ready ni merge. Le passage Ready reste un acte CTO distinct, après lecture de cet addendum.

## I. Addendum CTO — NTAG216 référence, NTAG213 compatibilité

**Date :** 13 octobre 2026.  
**Effet :** correction du référentiel matériel. Aucun code produit. #918 reste Draft / HOLD.

L’audit initial prenait la NTAG213 comme carte de recette. Le stock physique annoncé pour Somafrik est la **NTAG216**. La compatibilité matérielle d’un téléphone Android ou d’un iPhone ne signifie pas que l’application sait déjà lire ou encoder ces puces. Sur `develop`, les deux types sont absents.

### I.1 Matrice de référence

| Caractéristique | NTAG216 | NTAG213 |
| --- | --- | --- |
| Priorité Somafrik | P0 — matériel principal | P1 — compatibilité à conserver |
| Cartes physiques | Disponibles pour les tests | Stock non confirmé |
| Mémoire utilisateur | 888 octets | 144 octets |
| Technologie | NFC Forum Type 2 | NFC Forum Type 2 |
| Android, au sens radio | Compatible | Compatible |
| iPhone, au sens radio | Compatible | Compatible |
| Prise en charge Somafrik sur `develop` | Absente | Absente |
| Lecture / encodage / révocation / multiscan à concevoir | Oui, même parcours | Oui, même parcours |
| Tests physiques | Obligatoires en premier | À programmer après la série NTAG216 |
| Présences et finance | Cible prioritaire de la recette ; bus scolaire hors périmètre | Même règles, dès que le stock existe |
| Dépendance fonctionnelle aux 888 octets | Interdite | Le NDEF doit tenir dans 144 octets |

Révocation, remplacement, présence et consultation finance portent sur le secret serveur, pas sur la taille de la puce. Une NTAG216 et une NTAG213 encodées avec le même `cardToken` sont le même capability. Révoquer l’une révoque le token, donc les deux supports s’ils portaient ce secret.

### I.2 Règle de capacité

Le message NDEF fonctionnel est borné par la NTAG213 : 144 octets utilisateur. La mémoire libre de la NTAG216 ne sert pas à ajouter le nom, la finance, la classe ou un second secret. Aucun parcours présence, finance ou transport ne peut exiger un payload qui ne tiendrait pas sur une NTAG213.

Les brouillons #913 à #917 nomment déjà les deux types (`NTAG213` et `NTAG216`) dans du code non mergé. Ce nommage n’est pas une preuve de lecture réelle, et il n’est pas sur `develop`. Il ne dispense pas de la recette NTAG216.

### I.3 Plan de recette Android

Ordre obligatoire le jour où un mandat autorisera le téléphone. Tout PASS mocké reste interdit.

1. NTAG216 vierge : écriture, relecture, puis seulement activation serveur.
2. NTAG216 déjà programmée pour un autre élève : refus, pas de deuxième affectation.
3. NTAG216 révoquée ou remplacée : la puce ne rouvre pas l’élève.
4. Sessions continues NTAG216 : 1, 5, 10, 30 cartes ; 30 avec doublons ; 30 dont certaines invalides ; 30 avec coupure réseau.
5. Erreurs : tag illisible, tag non NXP, NFC coupé, téléphone sans NFC, session expirée, retrait de la carte entre deux lectures.
6. NTAG213, quand le stock sera confirmé : rejouer 1 à 5 avec le **même** binaire et le **même** NDEF, pour prouver qu’aucune fonction ne dépend des 888 octets.
7. iPhone : non inclus dans cette première recette Android. La compatibilité radio ne crée pas un PASS.

Présences et finance se vérifient sur la série NTAG216. Le bus n’entre pas dans cette recette : le module n’existe pas.

### I.4 Conclusions révisées

| Question | Réponse après addendum |
| --- | --- |
| Le NFC de `develop` sait-il traiter la NTAG216 ? | Non. |
| Sait-il traiter la NTAG213 ? | Non. L’inversion de priorité ne laisse pas la NTAG213 « déjà prévue dans le produit ». |
| Quelle carte pour le premier test réel ? | NTAG216. |
| Que doit garantir l’architecture pour la NTAG213 ? | Le même encodage, la même lecture, la même révocation, le même multiscan, avec un NDEF qui tient dans 144 octets. |
| Les autres conclusions (QR, flags, finance, bus, drafts) changent-elles ? | Non. |

## Critères de clôture

| Critère | Tenue |
| --- | --- |
| Composants NFC recensés | oui, y compris l’absence matérielle |
| Flux bout en bout | oui pour le token ; la puce s’arrête avant le téléphone |
| Anomalies classées | NFC-02-01 à 11 |
| Risques sécurité | section E |
| Tests exécutés distincts des non exécutés | section 17 |
| Écarts métier | présence continue, finance par rôle, bus, NTAG216 P0 / NTAG213 P1 |
| Plan ordonné, PR non ouvertes | section F |
| Références et preuves | ce fichier |
| Diff GitHub indépendant possible | PR documentaire draft |

**Arrêt.** Aucune correction produit n’est engagée.
