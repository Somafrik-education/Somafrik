# MONO-T1 — caractérisation HTTP des routes backend

Statut : **DRAFT / HOLD — NO MERGE** (mandat CTO MONO-T1). Chantier de tests uniquement : aucune route extraite de `backend/server.js`, aucune logique métier, règle RBAC, migration, Ruleset ou R15 modifiés, aucun test existant supprimé.

Base : `develop@ec9f168f` (contient #1006 MONO-T0 et #1008 SEC-RBAC-REVOKE-01).

## 1. Inventaire des routes réellement enregistrées

`node scripts/mono-t1-route-inventory.js` démarre `backend/server.js` avec un préchargement (`scripts/mono-t1-route-inventory.preload.js`) qui relève chaque appel `app.<verbe>()` **au runtime** : méthode, chemin, fichier et ligne d'enregistrement, chaîne de middlewares (noms des fonctions). La base est une URL loopback injoignable (port 1) : le démarrage échoue après l'enregistrement des routes, aucune base n'est contactée, aucun port n'est ouvert.

- **371 routes** (369 sous `/api`) ; une recherche textuelle de `app.<verbe>(` en trouve 341 : 33 routes sont enregistrées par `backend/lib/reportCard/reportCardHttp.js`, d'autres hors du motif ligne-début.
- Résultat généré : [`MONO-T1-ROUTES.md`](MONO-T1-ROUTES.md) et `MONO-T1-ROUTES.json` (méthode, chemin, source, authentification, permission(s) `requirePermission`, contrôles dans le gestionnaire, rôles autorisés par la matrice par défaut, indices tenant / validation / dépôt PostgreSQL / statuts d'erreur, famille, niveau de risque, tests existants et tests MONO-T1).
- La CI vérifie que l'inventaire est à jour (`node scripts/mono-t1-route-inventory.js --check`, job unit) : toute route ajoutée ou modifiée impose sa régénération.
- Limites : les colonnes tenant / validation / dépôt / erreurs sont des **indices statiques** du gestionnaire ; « rôles autorisés » = matrice **par défaut** (seed) ; la matrice effective PostgreSQL est mesurée au § 4.

### Matrice des risques

| Niveau | Critère | Routes |
|---|---|---|
| CRITIQUE | non authentifiée, ni publique par conception, ni conditionnelle | **0** |
| ÉLEVÉ | écriture sur un domaine critique (A–F), ou authentifiée sans `requirePermission` en écriture | 134 |
| MOYEN | lecture d'un domaine critique, écriture hors domaine critique, route conditionnelle | 184 |
| FAIBLE | lecture hors domaine critique | 53 |

Routes sans authentification : `GET /`, `GET /api/health`, `POST /api/auth/refresh`, `GET /api/schools/:code`, `GET /api/schools/:code/logo`, `POST /api/public/report-cards/verify`, `GET /verify/rc…` (publiques par conception), les routes de connexion (limitation de débit) et `POST /api/backoffice/e2e/clear-login-lockout` (**conditionnelle** : 404 sauf `SOMAFRIK_E2E=true` hors production ; le démarrage refuse `SOMAFRIK_E2E=true` en production ; 404 vérifié par test).

18 routes authentifiées n'ont pas de `requirePermission` : périmètre du compte lui-même (`/api/auth/*`, `/api/me/*`, `…/self/execute`, appareils push), contrôle dans le gestionnaire (`reset-password` : `canResetUserPassword` + portée utilisateurs ; `mvp/*` : `assertMvpAccess` ; `bulletin-design/preview` : Superadmin seul), délégation (`dashboard/school-activities` : `resolveSchoolDashboardPrincipal`) ou route retirée (`/api/backoffice/state` : 410).

## 2. Méthode et sécurité des tests

- **Serveur réel** `backend/server.js`, `NODE_ENV=test` (démo seed, workers de fond désactivés), une **base IT jetable par fichier** (`somafrik_mono_t1_<famille>_it`, `DROP SCHEMA public` au début), créée depuis la base `postgres` fournie par l'exécuteur MONO-T0 — cluster loopback dédié, vérifié par sentinelle et commentaire ; aucune base de production ou de préproduction n'est jamais visée.
- Harnais commun `backend/lib/monoT1HttpHarness.js` (code de test uniquement) : sessions réelles (`POST /api/backoffice/login`, mises en cache), requêtes HTTP, instantanés SQL pour les assertions « aucune écriture », arrêt effectif du serveur et fermeture des connexions (`pgTestLifecycle`), garde `exit` contre un serveur orphelin, jeton signé exposé pour les scénarios de jetons expirés/forgés.
- Fixtures : données de démonstration du produit (école `CD-2026-0001` peuplée, école `BI-2026-0002` avec son seul administrateur — « attaquant » interétablissement, comptes plateforme). **Abonnements : dates réelles des fixtures** (aucune date modifiée). Depuis la correction A2 (#1010), les familles qui écrivent sous abonnement vérifient seulement la précondition `assertActiveSubscriptionPrecondition` (lecture seule : CD-2026-0001, fin 31-08-2027, doit être `full` ; échec explicite sinon, jamais de SKIP). L'ancien contournement `applyActiveSubscriptionFixture` (effacement de `end_date`) est supprimé.
- Assertions sur les **réponses HTTP et les effets persistés** (lignes relues en base) ; chaque refus d'écriture est accompagné d'un instantané avant/après.
- Aucun SKIP silencieux : sans `DATABASE_URL`, chaque test est marqué SKIP avec sa raison ; dans la baseline pg (CI), `DATABASE_URL` est toujours fournie.
- Prérequis : exécuter via `npm run test:backend-baseline:pg` (cluster jetable `SOMAFRIK_TEST_PG_URL`, cf. `BACKEND-TEST-BASELINE.md`) ; ports locaux 19961–19976.

## 3. Correspondance routes ↔ tests

| Famille | Routes | Risque élevé | Avec test HTTP antérieur | Avec test MONO-T1 ciblé | Élevé sans scénario ciblé (portes seulement) |
|---|---|---|---|---|---|
| A. Authentification et sessions | 12 | 9 | 8 | 6 | 2 |
| B. Utilisateurs et rôles | 37 | 25 | 6 | 6 | 20 |
| C. Élèves et inscriptions | 47 | 28 | 36 | 7 | 5 |
| D. Notes et présences | 64 | 34 | 39 | 8 | 16 |
| E. Finance | 26 | 13 | 18 | 9 | 3 |
| F. Communication | 45 | 23 | 33 | 9 | 6 |

Détail route par route : [`MONO-T1-ROUTES.md`](MONO-T1-ROUTES.md) (colonnes « Tests HTTP existants » et « Tests MONO-T1 »).

**Toutes** les routes authentifiées passent en plus par les balayages A, et **toutes** les routes sous `requirePermission` par la matrice RBAC (§ 4). La dernière colonne liste donc des routes couvertes au niveau des **portes** (authentification, permission, rôle non autorisé ⇒ refus avant le gestionnaire), sans scénario métier autorisé ni interétablissement ciblé : administration RBAC (rôles, permissions, contacts, relations), examens et bulletins, pièces jointes de communication, ajustement d'obligation. Ce sont les candidates prioritaires de MONO-T2.

### Nouveaux tests (`backend/lib/monoT1.*.http.pg.test.js`)

| Fichier | Tests | Contenu |
|---|---|---|
| `monoT1.authSessions` | 14 | **Balayages sur les 358 routes authentifiées** : anonyme, en-tête invalide, signature étrangère, jeton expiré correctement signé, session inexistante ⇒ 401 sans donnée (corps limité à `message`/`code`) ; contrôle positif (le banc sait produire un jeton valide) ; jeton dans l'URL ; connexion (mauvais mot de passe, autre établissement, réponse sans hachage) ; logout et revoke-all (sessions fermées, refresh refusé) ; refresh invalide ; routes publiques et route E2E (404). |
| `monoT1.usersRoles` | 6 | Liste des comptes (établissement borné, BI ne voit pas CD, Superadmin limité aux administrateurs) ; attribution (autorisée, doublon 409) ; refus interétablissement (`TENANT_MISMATCH`, dans les deux sens), enseignant, parent, anonyme, rôle inconnu/vide, rôle Superadmin (`PLATFORM_ROLE_FORBIDDEN`) sans écriture ; révocation (refus BI, auto-révocation `AUTO_GRANT_FORBIDDEN`, autorisée puis rejeu 404) ; rôles attribuables ; **SEC-RBAC-REVOKE-01** : rôle révoqué via HTTP non réattribué par les chemins de boot. |
| `monoT1.students` | 6 | Liste (exactement les élèves actifs de CD ; BI vide ; parent limité ; Superadmin 403) ; fiche (BI ⇒ 404 identique à un élève inexistant, parent non lié, classe non affectée) ; modification (contrôle de concurrence `expectedUpdatedAt`, 409 sur version périmée, 400, refus BI/enseignant/anonyme sans écriture) ; inscription (201, refus classe d'un autre établissement, enseignant, champs invalides sans écriture) ; suppression = archivage ; lectures dérivées sans fuite. |
| `monoT1.notesPresences` | 8 | Types d'évaluation (établissement du principal, jamais du corps) ; évaluations (enseignant affecté ; refus classe/matière non affectées `TEACHER_ASSIGNMENT_REQUIRED`, barème `GRADE_INVALID`, admin/parent/BI `PERMISSION_DENIED`, sans écriture ; `classId` prioritaire, `classCode` ignoré) ; notes (saisie + correction = une ligne ; refus élève hors classe `STUDENT_NOT_ENROLLED`, hors barème, BI, parent `PARENT_NOTES_READ_ONLY`, admin `GRADE_TEACHER_UNRESOLVED`, anonyme, sans écriture ; lectures bornées) ; présences (affecté, refus classe non affectée/BI/parent/anonyme sans écriture). Les gardes dépôt sont couvertes par MONO-T0-GUARDS. |
| `monoT1.finance` | 5 | Encaissement (201, établissement de l'élève) ; refus montant nul/négatif, reçu vide, BI `STUDENT_NOT_FOUND`, enseignant, parent, Superadmin `PLATFORM_PERSONAL_DATA_DENIED`, anonyme, sans écriture ; **doublons** : `Idempotency-Key` (rejeu = même reçu, une ligne ; autre corps = 409 `IDEMPOTENCY_KEY_REUSED`) ; lectures bornées ; annulation (refus BI/enseignant/sans motif sans écriture, autorisée, rejeu conserve le motif initial). |
| `monoT1.communication` | 4 | Messages (participant d'un autre établissement refusé dans les deux sens, message vide, sans destinataire, parent, anonyme, sans écriture ; le destinataire lit, BI ne voit rien) ; annonces (admin publie, parent lit, BI ne voit pas, lecture directe BI 403/404) ; notifications plateforme réservées au Superadmin. |
| `monoT1.rbacMatrix` | 1 | **Matrice RBAC observée** (§ 4). |
| `monoT1.subscriptionAccess` | 4 | **Porte d'abonnement sur fixtures réelles** : abonnement actif non échu (CD, `full`, la saisie franchit la porte) ; abonnement échu au 2026-05-31 (SCH-DEMO-0017 : `blocked` avec le vrai retard, connexion refusée sans jeton) ; établissement suspendu (SCH-DEMO-0022 : connexion refusée, jamais `full`) ; droits insuffisants malgré un abonnement actif (parent : `PERMISSION_DENIED`, sans écriture). |
| `monoT1.anomaly.A1…A5` | 6 | A1 et A2 : **non-régression** (corrigées par #1011 et #1010, exécutées normalement). A3–A5 : reproductions des anomalies ouvertes (§ 5), échecs attendus vérifiés. |

## 4. Matrice RBAC observée (référence de caractérisation)

`backend/lib/monoT1.rbacMatrix.http.pg.test.js` parcourt les **308 routes sous `requirePermission`** pour six comptes de l'école CD (admin, proviseur, préfet, secrétaire, enseignant, parent) : **1 848 cellules**, comparées à [`MONO-T1-RBAC-MATRIX.json`](MONO-T1-RBAC-MATRIX.json). Une extraction de routes hors de `server.js` ne doit modifier aucune cellule ; une évolution voulue se régénère (`MONO_T1_UPDATE_RBAC_MATRIX=1`) et se relit dans le diff.

- `refusé` = 403 `PERMISSION_DENIED` (ou `PARENT_NOTES_READ_ONLY`, posé avant) : refus **avant** le gestionnaire ; `accès` = porte franchie ; `écriture autorisée (non envoyée)` = écriture permise par la matrice par défaut ou par les permissions effectives du compte : jamais déclenchée.
- Garde indépendante : chaque écriture refusée à la fois par la matrice par défaut et par les permissions effectives doit être refusée par HTTP.
- Stabilité : deux exécutions consécutives identiques.
- Écart mesuré entre la matrice par défaut (seed) et la matrice effective PostgreSQL : l'administrateur d'établissement obtient en effectif `GET /api/student-cards/capabilities` et `GET /api/student-cards/roll-call/roster` (et, côté écritures, notamment l'appel carte, les statuts de paiement, la saisie de notes/présences — relevé exploratoire). La colonne « rôles autorisés » de l'inventaire n'est donc **pas** une autorité : la référence est cette matrice.

## 5. Anomalies constatées

**État (MONO-T1-CLOSE)** : A1 corrigée par #1011 (`dad5591d`), A2 corrigée par #1010 (`d306a0de`) — leurs tests d'origine passent et sont exécutés normalement par la baseline pg (retirés de `expectedFailures`). **A3, A4 et A5 restent ouvertes** : exactement trois échecs attendus.

Chaque anomalie a un fichier `backend/lib/monoT1.anomaly.A*.http.pg.test.js` qui exprime le **comportement correct** ; il est déclaré dans `scripts/backend-test-baseline.manifest.json › expectedFailures` avec la cause attendue (`expectedOutput`). L'exécuteur MONO-T0 vérifie qu'il échoue **pour cette cause** ; le jour où il passe, la baseline échoue pour imposer la mise à jour du manifeste avec la PR corrective.

| # | Gravité | Constat | Effet | Correctif proposé (PR séparée) |
|---|---|---|---|---|
| **A1** — ✅ corrigée (#1011) | Élevée (confidentialité intra-établissement) | `authService.assignmentMatchesTeacher` rapproche les affectations du jeton enseignant **par nom** (`teacherName`) en repli. | La démo compte quatre « Patrick Ilunga » : le jeton de l'un embarque les classes des autres ; `GET /api/students` (filtré sur ces revendications) expose **4 élèves hors affectation** et **omet 3 élèves** d'une classe affectée. Les écritures de notes ne sont pas concernées (gardes PostgreSQL par identifiant, MONO-T0-GUARDS). | Construire les affectations du jeton depuis `teacher_assignments` actives de la fiche `teachers.user_id` ; supprimer le repli par nom (ou le limiter à l'absence totale d'identifiant, avec unicité vérifiée). |
| **A2** — ✅ corrigée (#1010) | Élevée (disponibilité) | `schoolSubscriptionAccessService.parseFrDate` lit `AAAA-MM-JJ` comme `JJ-MM-AA`. | `subscriptions.end_date` (DATE) est toujours ISO : tout établissement à abonnement daté est vu **« blocked »** (≈ 34 000 jours de retard) et perd notes, présences, création d'élève/enseignant, annonces, notifications. | Reconnaître l'ISO avant le format français ; test unitaire des deux formats ; la fixture MONO-T1 devient inutile. |
| **A3** | Moyenne (intégrité) | `PostgresRepository.toAttendanceStatus` convertit tout statut inconnu en `absent`. | `POST /api/presences` avec un statut inconnu répond 201 et **écrase** un « présent » par « absent ». | Refuser (400) un statut hors liste ; aucune écriture. |
| **A4** | Moyenne (intégrité) | `findClassByNormalizedName` : `ORDER BY created_at DESC LIMIT 1` ; `classCode` du corps ignoré. | Trois « 6ème A » créées au même instant : création d'évaluation par nom rattachée **arbitrairement** (201 sur une classe, 403 sur une autre selon la base). | Résoudre par `classCode`/`classId` ; refuser (409) un nom ambigu sans identifiant. |
| **A5** | Moyenne (intégrité finance) | `POST`/`PATCH /api/finance/payment-statuses` passent par un upsert sans validation. | `POST {}` crée un statut vide (201) ; `PATCH` sur un identifiant inconnu **crée** un statut (200). | Valider le corps (400) ; `PATCH` = mise à jour d'un existant (404 sinon). |

Observations (comportements actuels caractérisés, sans défaut avéré) :
- O1 — `POST /api/evaluations` : `classId` prioritaire, `classCode` ignoré, sinon résolution par nom (cf. A4).
- O2 — `POST /api/evaluation-types` invalide : 400 avec le code `FORBIDDEN` (libellé de code incohérent).
- O3 — `POST /api/presences` avec `items: []` : 201 `[]`.
- O4 — paiements sans `Idempotency-Key` : deux envois identiques créent deux reçus (aucun dédoublonnage métier ; le dédoublonnage repose sur la clé).
- O5 — Superadmin : liste des comptes limitée aux administrateurs ; finance et élèves interdits (`PLATFORM_PERSONAL_DATA_DENIED`).
- O6 — `DELETE /api/students/:id` archive (statut `archived`, fiche toujours lisible).
- O7 — le démo seed fixe des dates d'abonnement absolues (`backend/data.js` : fin 31-08-2027 pour CD et BI, 31-05-2026 pour les établissements échus). Depuis la correction A2, elles sont lues réellement : à partir du 14-09-2027 (J+14), CD passera `limited`, puis `blocked` le 30-09-2027 (J+30). La précondition `assertActiveSubscriptionPrecondition` échouera alors explicitement (aucun SKIP) : les dates du seed devront être rendues relatives ou prolongées avant cette échéance.
- O8 — accès interétablissement en lecture : 404 identique à une ressource inexistante (aucune fuite d'existence) pour élèves, paiements, notes, présences ; listes vides.
- O9 — **défaut probable, non corrigé (hors périmètre de #1009)** : la colonne `subscriptions.status` vaut `suspended` (anglais) ; `platformManagement.mapSubscriptionRow` la transmet telle quelle et `resolveLifecycleStatus` ne reconnaît que « Suspendu ». Un abonnement suspendu est donc lu `limited` (paiement « En retard »), pas `blocked`. Pour SCH-DEMO-0022 la connexion reste refusée car l'**établissement** est suspendu ; un abonnement suspendu sur un établissement actif laisserait en revanche la connexion et les saisies notes/présences (`limited`). À traiter dans une PR corrective séparée, sur décision CTO.
- Corrections A1/A2 : aucun effet sur l'authentification ni l'isolation tenant — balayages A, matrice RBAC (1 848 cellules) et tests interétablissement inchangés.

## 6. Limites explicites

- Couverture **comportementale** ciblée : routes critiques prioritaires des familles A–F ; 52 routes à risque élevé ne sont couvertes qu'au niveau des portes (§ 3).
- Familles G (pédagogie, planning, référentiels) et H (plateforme, établissements, abonnements) : balayages A et matrice RBAC uniquement.
- Un seul établissement peuplé (CD) ; BI sert d'attaquant interétablissement. Les comptes multirôles sont couverts par B (attribution/révocation) et SEC-RBAC-REVOKE-01, pas par un compte multirôle connecté.
- Les cas « session expirée » sont produits par des jetons signés avec le secret du serveur de test et une durée négative (pas d'attente réelle).
- La matrice RBAC ne déclenche jamais d'écriture autorisée (paramètres fictifs) : elle caractérise la porte, pas le gestionnaire.

## 7. Résultats

### MONO-T1-CLOSE (cluster jetable local, 2026-10-28 ; base `develop@d306a0de`, A1 et A2 corrigées)

| Contrôle | Résultat |
|---|---|
| Inventaire (`--check`, contrat des routes) | inchangé, 371 routes ; régénération : seule la correspondance vers `monoT1.subscriptionAccess` change (4 routes) |
| Garde-fous de l'exécuteur (cluster réel) | 23/23 |
| Baseline pg (2 exécutions consécutives) | **329 PASS / 0 FAIL / 0 SKIP**, échecs attendus vérifiés **3/3** (A3, A4, A5), couverture 67,4 % lignes / 60,8 % branches |
| Tests A1 et A2 d'origine | réussis normalement (non-régression) |
| Baseline unit | 2 654 PASS / 0 FAIL / 3 SKIP (2 642 + 6 tests A1 + 6 tests A2 venus de `develop`) |
| Matrice RBAC | 1 848 cellules, **identiques** à la référence (fichier inchangé) sur les deux exécutions |
| Processus orphelins après exécution | 0 |

Évolution : 322 → 329 PASS = +1 (A1), +2 (A2), +4 (`monoT1.subscriptionAccess`). Échecs attendus : 5 → 3.

### Livraison initiale (2026-10-27, base `develop@ec9f168f`)

| Contrôle | Résultat |
|---|---|
| Inventaire (`--check`, contrat des routes) | à jour, 371 routes ; un contrat modifié (route retirée, permission changée) est détecté |
| Garde-fous de l'exécuteur | 23/23 |
| Baseline pg (2 exécutions consécutives) | 322 PASS / 0 FAIL / 0 SKIP, échecs attendus vérifiés 5/5 (A1–A5), couverture 67,3 % lignes / 60,8 % branches |
| Baseline unit | 2 642 PASS / 0 FAIL / 3 SKIP (inchangés) |
| Matrice RBAC | 1 848 cellules, identiques sur deux exécutions |
| Processus orphelins après exécution | 0 |

Avant MONO-T1 : baseline pg 278 PASS ; MONO-T1 ajoutait 44 tests PASS (A 14, B 6, C 6, D 8, E 5, F 4, matrice 1) et 6 tests d'anomalies (5 fichiers en échec attendu).
