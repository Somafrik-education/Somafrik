# Baseline des tests backend (MONO-T0)

**Statut :** DRAFT / HOLD — préalable à toute refactorisation des monolithes (MONO-AUDIT-01).
**Base :** `develop@12eb98fa9c653484c9cc156ad2a429a4fe205dd7`.

Ce document décrit comment exécuter **tous** les tests backend `node:test`, comment la couverture est mesurée, et quels tests relèvent d'un régime d'exception (avec la raison et la condition pour les traiter).

## 1. Pourquoi

Avant MONO-T0, aucune étape CI n'exécutait l'ensemble des tests backend : chaque workflow lance une liste choisie à la main (`verify:*`, workflows par domaine). Une analyse statique des workflows (workflows → scripts npm → scripts de vérification → fichiers de test) trouve **65 fichiers de test backend sur 462 qu'aucun workflow n'atteint** (dont 8 PostgreSQL ; liste en annexe). C'est une estimation : un script qui construit le chemin d'un test dynamiquement n'est pas détecté. Quatre tests étaient rouges sans que la CI le signale, et aucune couverture n'était mesurée.

## 2. Commandes

```bash
# Tous les tests unitaires (hors *.pg.test.js) + couverture node:test
npm run test:backend-baseline:unit

# Tous les tests PostgreSQL, en série, sur une base LOCALE et jetable + couverture c8
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:backend-baseline:pg

# Inventaire (nombre de fichiers, exceptions du manifeste)
node scripts/backend-test-baseline.js inventory
```

- Le mode `pg` **refuse** toute `DATABASE_URL` dont l'hôte n'est pas `localhost`, `127.0.0.1` ou `::1`. Aucune base distante ne peut être visée.
- Si `SOMAFRIK_NFC_TEST_DATABASE_URL` est absente, elle est dérivée de `DATABASE_URL` (`/nfc_encoding_test`) ; les tests NFC créent puis suppriment leur propre base.
- Sorties : `backend-test-baseline/<mode>/` (ignoré par Git) — `main.results.json` (résultat par test et par fichier), `summary.md`, couverture (`coverage-lcov.info` en unitaire ; `coverage/lcov.info` et `coverage/coverage-summary.json` en PostgreSQL). En CI, le résumé est recopié dans le résumé du job et les fichiers sont publiés en artefacts.
- Les tests PDF exigent Chromium (installé par la `postinstall` Puppeteer du backend, ou fourni par `PUPPETEER_EXECUTABLE_PATH`).

Workflow : `.github/workflows/backend-test-baseline.yml` — deux jobs (`unit`, `pg` avec service `postgres:16`), déclenchés sur les PR vers `develop`/`main` qui touchent le backend, chaque nuit et à la demande. Il **n'est pas** ajouté aux checks requis (`.github/governance/merge-authorizers.json` → `Required`) : c'est une décision CTO.

## 3. Règles de la baseline

1. Tout fichier `backend/**/*.test.js` est exécuté. Il n'existe **aucune** liste d'exclusion silencieuse.
2. Un fichier sous régime d'exception est déclaré dans `scripts/backend-test-baseline.manifest.json`, avec une raison. Le manifeste est validé au démarrage (fichier existant, mode cohérent, raison non vide) : sinon la baseline échoue.
3. **Échec attendu** : le fichier est exécuté à part et doit échouer **avec la cause documentée** (`expectedOutput`). S'il passe, ou s'il échoue pour une autre raison, la baseline échoue — l'échec reste visible et figé, il n'est pas masqué.
4. **Base amorcée** : le fichier est exécuté dans une base locale dédiée, créée puis supprimée, amorcée par `initializeRepository({ required: true })`.
5. La baseline échoue sur tout test FAIL. Les tests SKIP sont listés par fichier dans le résumé.

## 4. Les quatre tests rouges de MONO-AUDIT-01

| # | Fichier | Diagnostic | Traitement |
|---|---|---|---|
| 1 | `backend/lib/demoAssignments.greenB.test.js` — DEMO-PRES-RED-01 | Rouge **dès son commit d'introduction** (`07fa16b9`, 2026-09-17) : jamais vert. L'entrée du hash de scope mobile `input.roleKeys` contient les libellés internes (`principalRoleList` → `toRoleLabel`, depuis le 2026-08-26), pas les clés. Ce contrat est déjà figé par un test vert : `mobileSyncScope.test.js` attend `["Enseignant"]` pour Classes. Modifier le code changerait les hash de synchronisation des mobiles (contrat de sync). Aucun impact droits : la valeur vient de `user_roles`, et le refus sans rôle live est couvert par le test « GREEN-B sécurité ». | Assertion alignée sur le contrat actuel : `[toRoleLabel("SCHOOL_ADMIN")]`, plus une assertion que la clé d'origine est bien `SCHOOL_ADMIN`. **Aucun code produit modifié.** |
| 2 | `backend/lib/legacyBootMigrations.guard.test.js` — « initializeRepository conserve le tombstone fail-closed » | Test écrit le 2026-08-24. Depuis #700 (`4959bbc9`, 2026-09-18), `initializeRepository` vérifie au démarrage que l'allocateur canonique d'identifiants élèves est prêt (`assertStudentGeneralIdentityPg`) et refuse sinon. Le faux dépôt du test renvoyait des lignes vides : le démarrage refusait **à juste titre** avec `STUDENT_CANONICAL_POSTGRES_ALLOCATOR_NOT_READY`. | Prérequis corrigé : le faux dépôt simule un allocateur prêt. Ajout d'une assertion qui prouve que, sans allocateur, le démarrage reste refusé (garde de #700 intacte). |
| 3 | `backend/lib/pedagogyStaffSyncRepository.test.js` | Teste le pipeline `saveBackOfficeState → syncPedagogyStaffDomainFromBackOffice / syncNotesDomainFromBackOffice`, retiré volontairement par LOT 8 (`f5e3ad36`, 2026-08-14). `saveBackOfficeState` lève `BACKOFFICE_STATE_WRITE_REMOVED` (410). Obsolète. | **Non modifié, non supprimé.** Déclaré « échec attendu » : la CI vérifie qu'il échoue toujours pour cette cause. **Décision CTO requise** : supprimer ou réécrire en test de non-régression du retrait. |
| 4 | `backend/lib/studentsSyncRepository.test.js` | Même cause : pipeline `saveBackOfficeState → syncStudentsDomainFromBackOffice → materializeBackOfficeStudent` retiré par LOT 8. Obsolète. | Idem n°3. |

Test PostgreSQL complémentaire, déjà signalé comme préexistant dans #997/#998 : `backend/lib/backofficeStateRemoval.pg.test.js` suppose une base déjà initialisée (table `schools`, établissement `CD-2026-0001`). Il passe (3/3) dans une base amorcée par l'initialisation canonique ; il est déclaré « base amorcée » dans le manifeste. Le fichier de test n'est pas modifié.

## 5. Résultats de référence (exécution locale, 2026-10-26)

Environnement : Node 22.22.0, PostgreSQL 16.15 local et jetable, Chromium fourni. Ces chiffres ne remplacent pas l'exécution GitHub Actions.

| Mode | Fichiers | PASS | FAIL | SKIP | Échecs attendus vérifiés | Couverture lignes / branches |
|---|---|---|---|---|---|---|
| unit | 334 | 2 627 | 0 | 3 | 2 / 2 | 66,9 % / 68,4 % (334 fichiers chargés) |
| pg | 128 | 249 | 0 | 0 | — | 67,2 % / 60,6 % (283 fichiers chargés) |

SKIP unitaires (conditions internes aux fichiers, inchangées) : `studentCardsNfcEncoding.sql.test.js` (1), `teacherAssignmentsRepository.test.js` (1), `usersLoginIdentity.test.js` (1).

Les 73 tests PostgreSQL ignorés lors de l'audit étaient les suites NFC (`studentCardsNfcDiagnosis`, `studentCardsNfcLifecycle`) qui exigent `SOMAFRIK_NFC_TEST_DATABASE_URL` ; la baseline la fournit, ils s'exécutent et passent.

## 6. Limites connues (non masquées)

- **Couverture HTTP de `backend/server.js` : non mesurée.** Les tests HTTP lancent le serveur dans un processus enfant arrêté par signal, qui n'écrit pas sa couverture V8. Corriger cela demande de modifier les fixtures HTTP ou le serveur : hors périmètre MONO-T0.
- **Fichiers qui ne sont pas des tests `node:test`** (scripts `assert` + `process.exit`) : un tel fichier compte pour un seul résultat (son code de sortie).
- **Non couverts par cette baseline :** scripts `verify:*`, tests Web (Vitest), tests Mobile, e2e (Maestro, navigateur). Ils restent exécutés par les workflows existants, inchangés.
- La couverture PostgreSQL utilise `npx --yes c8@10.1.3` (même convention que `npx --yes tsx` dans `package.json`) ; aucune dépendance n'est ajoutée aux lockfiles. Si `c8` est indisponible, la couverture est déclarée « non mesurée » ; les tests restent bloquants.

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