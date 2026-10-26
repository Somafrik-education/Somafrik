# Baseline des tests backend (MONO-T0)

**Statut :** DRAFT / HOLD — préalable à toute refactorisation des monolithes (MONO-AUDIT-01).
**Base :** `develop@12eb98fa9c653484c9cc156ad2a429a4fe205dd7`.

Ce document décrit comment exécuter **tous** les tests backend `node:test`, comment la couverture est mesurée, et quels tests relèvent d'un régime d'exception (avec la raison et la condition pour les traiter).

## 1. Pourquoi

Avant MONO-T0, aucune étape CI n'exécutait l'ensemble des tests backend : chaque workflow lance une liste choisie à la main (`verify:*`, workflows par domaine). Une analyse statique des workflows (workflows → scripts npm → scripts de vérification → fichiers de test) trouve **65 fichiers de test backend sur 462 qu'aucun workflow n'atteint** (dont 8 PostgreSQL ; liste en annexe). C'est une estimation : un script qui construit le chemin d'un test dynamiquement n'est pas détecté. Quatre tests étaient rouges sans que la CI le signale, et aucune couverture n'était mesurée.

## 2. Commandes

```bash
# Tests des garde-fous de l'exécuteur (sans base ; avec SOMAFRIK_TEST_PG_URL, contrôles sur cluster réel en plus)
node --test scripts/backend-test-baseline.test.js

# Tous les tests unitaires (hors *.pg.test.js) + couverture node:test
npm run test:backend-baseline:unit

# Tous les tests PostgreSQL, en série, sur un cluster DÉDIÉ AUX TESTS + couverture c8
SOMAFRIK_TEST_PG_URL=postgres://postgres:postgres@localhost:5432/somafrik_disposable_test_cluster \
  npm run test:backend-baseline:pg

# Inventaire (nombre de fichiers, exceptions du manifeste)
node scripts/backend-test-baseline.js inventory
```

Sorties : `backend-test-baseline/<mode>/` (ignoré par Git) — `main.results.json` (résultat par test et par fichier), `summary.md`, couverture (`coverage-lcov.info` en unitaire ; `coverage/lcov.info` et `coverage/coverage-summary.json` en PostgreSQL). En CI, le résumé est recopié dans le résumé du job et les fichiers sont publiés en artefacts. Les tests PDF exigent Chromium (`postinstall` Puppeteer du backend, ou `PUPPETEER_EXECUTABLE_PATH`).

Workflow : `.github/workflows/backend-test-baseline.yml` — deux jobs (`unit`, `pg` avec service `postgres:16`), déclenchés sur les PR vers `develop`/`main` qui touchent le backend, chaque nuit et à la demande. Il **n'est pas** ajouté aux checks requis (`.github/governance/merge-authorizers.json` → `Required`) : c'est une décision CTO.

## 3. Sécurité du mode PostgreSQL

Un hôte `localhost` n'est **pas** une preuve qu'une base est jetable : une base de développement peut tourner en local. Les tests PostgreSQL créent et suppriment des dizaines de bases sur le **serveur** visé (`*_it`, `somafrik_<x>_<hex>`, `nfc_prog_05_<hex>`…) et acceptent des surcharges `SOMAFRIK_*_IT_DATABASE`. La baseline exige donc un **cluster entier dédié aux tests** (`scripts/backend-test-baseline-guards.js`) :

| Garde-fou | Refus si… |
|---|---|
| Variable dédiée `SOMAFRIK_TEST_PG_URL` | absente. `DATABASE_URL` n'est **jamais** lue en entrée, ni utilisée comme repli. |
| Hôte | autre que `localhost`, `127.0.0.1`, `[::1]` (leurres `localhost.evil…`, `127.0.0.1.nip.io`, IPv4/IPv6 privées refusés). |
| Paramètres d'URL | présents (`?host=`, `hostaddr`, `options`… pourraient rediriger la connexion). |
| Base de connexion | autre que la sentinelle `somafrik_disposable_test_cluster`. |
| Déclaration explicite | la sentinelle ne porte pas le commentaire `somafrik:disposable-test-cluster`. Ce commentaire est posé **volontairement** à la création du cluster de test (étape CI dédiée) ; l'exécuteur ne le pose jamais. |
| Contenu du cluster | une seule base n'a pas un nom de base de test reconnu (ex. `somafrik`, `somafrik_dev`, `production`). |
| Environnement des tests | toute variable de base héritée (`DATABASE_URL`, `*_DATABASE_URL`, `*_DB_URL`, `*_IT_DATABASE`, `PG*`, `DB_*`, `SUPABASE_DB_URL`) est **retirée** ; l'exécuteur fixe lui-même `DATABASE_URL`. |
| Bases créées/supprimées par l'exécuteur | nom hors de la liste fermée : `somafrik_test_run_*` (base amorcée) et `nfc_encoding_test` (exigée par la fixture NFC, recréée puis supprimée). |
| Base source des tests | `DATABASE_URL` = base de maintenance `postgres` du cluster **vérifié** : les tests créent leurs propres bases à partir d'elle, et les gardes de 10 tests `admin*` n'acceptent que `postgres` (ou `somafrik`) comme base source. |

Préparer un cluster local jetable (jamais celui de développement) :

```bash
docker run --rm -d --name somafrik-test-pg -p 55432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=somafrik_disposable_test_cluster postgres:16
PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d somafrik_disposable_test_cluster \
  -c "COMMENT ON DATABASE somafrik_disposable_test_cluster IS 'somafrik:disposable-test-cluster'"
SOMAFRIK_TEST_PG_URL=postgres://postgres:postgres@localhost:55432/somafrik_disposable_test_cluster npm run test:backend-baseline:pg
```

Tests négatifs reproductibles : `scripts/backend-test-baseline.test.js` (16 tests ; 13 sans base, 3 sur cluster réel exécutés dans le job CI `pg`). Ils couvrent : variable absente, `DATABASE_URL` seule, hôtes distants et leurres, paramètres d'URL, base non sentinelle, sentinelle sans commentaire, cluster contenant une base étrangère, noms de bases de travail, nettoyage de l'environnement, cluster injoignable, couverture absente.

## 4. Règles de la baseline

1. Tout fichier `backend/**/*.test.js` est exécuté. Il n'existe **aucune** liste d'exclusion silencieuse.
2. Un fichier sous régime d'exception est déclaré dans `scripts/backend-test-baseline.manifest.json`, avec une raison. Le manifeste est validé au démarrage (fichier existant, mode cohérent, raison non vide) : sinon la baseline échoue.
3. **Échec attendu** (`expectedFailures`, vide aujourd'hui) : le fichier est exécuté à part et doit échouer **avec la cause documentée**. S'il passe, ou échoue pour une autre raison, la baseline échoue. Ce régime n'est utilisé que si aucun test comportemental ne peut vérifier directement le contrat.
4. **Base amorcée** (`seededDatabase`) : le fichier est exécuté dans une base de travail `somafrik_test_run_seeded_*` du cluster de test, créée, amorcée par `initializeRepository({ required: true })`, puis supprimée (y compris en cas d'échec).
5. La baseline échoue sur tout test FAIL et sur tout code de sortie non nul de `node --test`. Les tests SKIP sont listés par fichier dans le résumé.
6. **Couverture** : avec `--coverage`, un rapport absent, vide ou sans ligne mesurée (générateur `c8` en échec, `lcov` manquant) fait **échouer** la baseline. Les mesures unitaire et PostgreSQL restent séparées.

## 5. Les quatre tests rouges de MONO-AUDIT-01

| # | Fichier | Diagnostic | Traitement |
|---|---|---|---|
| 1 | `backend/lib/demoAssignments.greenB.test.js` — DEMO-PRES-RED-01 | Rouge **dès son commit d'introduction** (`07fa16b9`, 2026-09-17) : jamais vert. L'entrée du hash de scope mobile `input.roleKeys` contient les libellés internes (`principalRoleList` → `toRoleLabel`, depuis le 2026-08-26), pas les clés. Ce contrat est déjà figé par un test vert : `mobileSyncScope.test.js` attend `["Enseignant"]` pour Classes. Modifier le code changerait les hash de synchronisation des mobiles. Aucun impact droits : la valeur vient de `user_roles`, et le refus sans rôle live est couvert par « GREEN-B sécurité ». | Assertion alignée sur le contrat actuel : `[toRoleLabel("SCHOOL_ADMIN")]`, plus une assertion que la clé d'origine est `SCHOOL_ADMIN`. |
| 2 | `backend/lib/legacyBootMigrations.guard.test.js` | Depuis #700 (`4959bbc9`, 2026-09-18), `initializeRepository` refuse de démarrer si l'allocateur canonique d'identifiants élèves n'est pas prêt. Le faux dépôt du test renvoyait des lignes vides : refus **justifié**. | Prérequis corrigé (allocateur prêt simulé) + assertion prouvant que, sans allocateur, le démarrage reste refusé. |
| 3 | `backend/lib/pedagogyStaffSyncRepository.test.js` | Testait le pipeline `saveBackOfficeState → syncPedagogyStaffDomainFromBackOffice / syncNotesDomainFromBackOffice`, retiré par LOT 8 (`f5e3ad36`). | **Remplacé** par un test de non-régression du refus : dépôts PostgreSQL et mémoire, payload complet puis chaque domaine (enseignants, affectations, évaluations, notes) → rejet `BACKOFFICE_STATE_WRITE_REMOVED` / 410 / message exact, **aucune** requête SQL ni transaction, aucun appel aux synchronisations ou migrations BackOffice, données inchangées ; réponse HTTP de `PUT /api/backoffice/state` = 410 avec le contrat de refus. Aucune méthode legacy réintroduite. |
| 4 | `backend/lib/studentsSyncRepository.test.js` | Testait le pipeline `saveBackOfficeState → syncStudentsDomainFromBackOffice → materializeBackOfficeStudent`, retiré par LOT 8. | **Remplacé** par un test de non-régression du refus (élèves, payload multi-établissements, vide, `null`) sur les deux dépôts, sans aucune écriture ; lecture globale toujours supprimée. |

Preuve de mutation : en réintroduisant temporairement une écriture legacy dans `saveBackOfficeState` (préchargement hors dépôt), 3 des 4 tests de chacun des deux fichiers échouent (le 4ᵉ porte sur la lecture ou la réponse HTTP).

Test PostgreSQL complémentaire, déjà signalé comme préexistant dans #997/#998 : `backend/lib/backofficeStateRemoval.pg.test.js` suppose une base déjà initialisée (table `schools`, établissement `CD-2026-0001`). Déclaré « base amorcée » ; fichier non modifié.

## 6. Résultats de référence (exécution locale, 2026-10-26)

Environnement : Node 22.22.0, PostgreSQL 16.15 en cluster jetable configuré comme la CI (sentinelle + commentaire), contenant déjà les bases d'une exécution précédente, avec `DATABASE_URL` et `SOMAFRIK_USERS_GP003_IT_DATABASE` parasites (retirées par l'exécuteur), Chromium fourni. Ces chiffres ne remplacent pas l'exécution GitHub Actions.

| Mode | Fichiers | PASS | FAIL | SKIP | Couverture lignes / branches |
|---|---|---|---|---|---|
| garde-fous | 1 | 16 | 0 | 0 | — |
| unit | 334 | 2 635 | 0 | 3 | 66,9 % / 68,4 % (334 fichiers chargés) |
| pg | 128 | 249 | 0 | 0 | 67,2 % / 60,6 % (283 fichiers chargés) |

SKIP unitaires (conditions internes aux fichiers, inchangées) : `studentCardsNfcEncoding.sql.test.js` (1), `teacherAssignmentsRepository.test.js` (1), `usersLoginIdentity.test.js` (1).

Les 73 tests PostgreSQL ignorés lors de l'audit étaient les suites NFC (`studentCardsNfcDiagnosis`, `studentCardsNfcLifecycle`) qui exigent `SOMAFRIK_NFC_TEST_DATABASE_URL` et une base `nfc_encoding_test` existante. Dans la première version de #1006, cette base n'était pas créée : le job CI `pg` a échoué sur 73 tests (`database "nfc_encoding_test" does not exist`), alors que l'exécution locale passait parce que la base avait été créée à la main. L'exécuteur la crée désormais lui-même.

## 7. Limites connues (non masquées)

- **Couverture HTTP de `backend/server.js` : non mesurée.** Les tests HTTP lancent le serveur dans un processus enfant arrêté par signal, qui n'écrit pas sa couverture V8. Corriger cela demande de modifier les fixtures HTTP ou le serveur : hors périmètre MONO-T0.
- **Fichiers qui ne sont pas des tests `node:test`** (scripts `assert` + `process.exit`) : un tel fichier compte pour un seul résultat (son code de sortie).
- **Non couverts par cette baseline :** scripts `verify:*`, tests Web (Vitest), tests Mobile, e2e (Maestro, navigateur). Ils restent exécutés par les workflows existants, inchangés.
- La couverture PostgreSQL utilise `npx --yes c8@10.1.3` (même convention que `npx --yes tsx` dans `package.json`) ; aucune dépendance n'est ajoutée aux lockfiles. Si `c8` échoue, la baseline échoue.
- Les scripts `verify:*` existants qui créent leurs propres bases ne passent pas par ces garde-fous ; ils ne sont pas modifiés par MONO-T0.
- **Instabilité préexistante : `backend/lib/secAuth04SessionBinding.http.pg.test.js`** (SEC-AUTH-04, #995). Ses 21 contrôles passent, puis le processus peut planter au nettoyage : `DROP DATABASE … WITH (FORCE)` termine une connexion encore ouverte d'un pool `pg` du test, sans écouteur `error` (« terminating connection due to administrator command »). Reproduit en isolation sur le fichier inchangé de `develop` : 1 échec sur 6 exécutions ; 1 sur 4 exécutions complètes de la baseline. La baseline le signale (FAIL) ; il n'est **ni ignoré, ni relancé automatiquement**. Correctif proposé (test uniquement, hors mandat MONO-T0 car test de sécurité) : écouteur `error` sur les pools du test et fermeture de toutes les connexions avant la suppression de la base.

## Annexe — fichiers de test backend non atteints par les workflows avant MONO-T0 (estimation statique)

- `backend/contracts/reportCard/reportCardLot0.contract.test.js`
- `backend/contracts/reportCard/reportCardLot0.crypto.test.js`
- `backend/contracts/reportCard/reportCardLot0.fixtures.test.js`
- `backend/contracts/reportCard/reportCardLot0.jcs.test.js`
- `backend/lib/academicConfigDefaults.test.js`
- `backend/lib/allPrivilegesSchoolDomainDeny.p1-12.test.js`
- `backend/lib/authComptableMobile.test.js`
- `backend/lib/authOptionalFailClosed.test.js`
- `backend/lib/authParentPassword.test.js`
- `backend/lib/backofficeDedupe.teachers.test.js`
- `backend/lib/classStudentsAuthz.p0-03.test.js`
- `backend/lib/communicationsMessages.p1-03.test.js`
- `backend/lib/demoAssignments.greenB.test.js`
- `backend/lib/demoFinanceAssignments.p0.red.test.js`
- `backend/lib/deployGitSha.test.js`
- `backend/lib/evaluationAttachment.test.js`
- `backend/lib/evaluationSyncRepository.test.js`
- `backend/lib/gradeUniqueness.test.js`
- `backend/lib/gradesBoPersistence.test.js`
- `backend/lib/gradesMigrationOrder.test.js`
- `backend/lib/idempotency.pg.test.js`
- `backend/lib/idempotencyService.test.js`
- `backend/lib/legacyBootMigrations.guard.test.js`
- `backend/lib/legacyClassesStateWrite.test.js`
- `backend/lib/parentChildren.test.js`
- `backend/lib/parentLoginChildren.test.js`
- `backend/lib/parentRelationIdentity.test.js`
- `backend/lib/pedagogyStaffBoPersistence.test.js`
- `backend/lib/pedagogyStaffSyncRepository.test.js`
- `backend/lib/pgPoolGuard.test.js`
- `backend/lib/planningSyncDeny.p1-06.test.js`
- `backend/lib/platformAnnouncements.memoryFallback.test.js`
- `backend/lib/platformManagement.schoolCode.audit.test.js`
- `backend/lib/postgresSeedUserRoles.pg.test.js`
- `backend/lib/principalStudentIds.test.js`
- `backend/lib/rbacSchoolAdminParity.test.js`
- `backend/lib/reportCard/academicRuleProfile.calculability.test.js`
- `backend/lib/reportCard/academicRuleProfile.pg.test.js`
- `backend/lib/reportCard/academicRuleProfile.test.js`
- `backend/lib/reportCard/reportCardConfiguration.pg.test.js`
- `backend/lib/reportCard/reportCardConfiguration.test.js`
- `backend/lib/reportCard/reportCardEngine.test.js`
- `backend/lib/reportCard/reportCardPdf.test.js`
- `backend/lib/reportCard/reportCardPublication.pg.test.js`
- `backend/lib/reportCard/reportCardPublication.test.js`
- `backend/lib/reportCard/reportCardSchema.pg.test.js`
- `backend/lib/reportCard/reportCardSchema.test.js`
- `backend/lib/requestSchoolScopeData.test.js`
- `backend/lib/schoolCourseTeacherRepair.pg.test.js`
- `backend/lib/schoolSetupGuided.red.test.js`
- `backend/lib/schoolSetupGuided.regression.test.js`
- `backend/lib/sessionSchoolIdentity.test.js`
- `backend/lib/student-user-canonical-link.pg.test.js`
- `backend/lib/studentsBoPersistence.test.js`
- `backend/lib/studentsSyncRepository.test.js`
- `backend/lib/subscriptionAccessScope.test.js`
- `backend/lib/superadminPrincipal.p1-02.test.js`
- `backend/lib/superadminSeedSecret.test.js`
- `backend/lib/teacherHistoricalPreprodCleanup.test.js`
- `backend/lib/teacherPostCleanupFullAudit.test.js`
- `backend/lib/trialAccessRequests.red.test.js`
- `backend/services/userTeacherSyncService.test.js`
- `backend/test/studentCardBatchPlan.test.js`
- `backend/test/studentCardBatchPreflight.test.js`
- `backend/tests/schoolDashboardActivities.lot5.test.js`
- `backend/tests/schoolDashboardActivities.test.js`