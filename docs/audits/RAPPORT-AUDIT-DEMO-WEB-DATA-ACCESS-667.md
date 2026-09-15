# Audit DEMO-DATA — accessibilité métier Web (#667)

**Statut CTO : HOLD fonctionnel. Aucun Ready / aucun merge. Aucune correction dans ce lot.**

Référence : PR #667, commentaire `5689430122`. HEAD audité : `feat/demo-lot3-web-runtime` (`37b52cec`).

## Constat

La session Démo s’ouvre (`demo:true`, bannière, watermark, `schoolId` + `schoolPublicCode` + `schoolCode`). Le tableau de bord commence à afficher des agrégats. L’écran **Notes & évaluations** reste sur `Chargement des notes et évaluations…`. Le gate backend #665 prouve pourtant que la passerelle sert déjà le tenant (HTTP 200, volumes non nuls).

## Cause racine principale

**Loading state + batch `ensureDomains` du dashboard Démo.**

`OverviewPage` (uniquement si `VITE_DEMO_RUNTIME=true`) appelle `ensureDomains(dashboardDomainsForDemo(true))` **sans** `filterDomainsByPermissions`. Ce lot mélange des domaines métier visibles (`notes`, `exams`, `bulletins`) avec des GET facultatifs (`messages`, `documents`).

`DataContext.refreshDomains` n’applique `mergeLoadedDomains` qu’après `Promise.allSettled` de **tout** le batch. Les lignes déjà reçues (ex. GET `/notes` 200, 2400 notes) restent invisibles tant que le GET le plus lent / bloqué du même lot n’a pas fini.

`GradesEvaluationsPage` (web/src/pages/GradesEvaluationsPage.tsx:627-628) masque tout l’écran si `useData().loading` est vrai. Ce `loading` est **global** (`fetchLoading || scopeSwitching`), pas scoped à `notes` / `evaluations`.

Conséquence exacte : un GET `/backoffice/messages` encore ouvert suffit à maintenir le spinner Notes, même si `/notes`, `/evaluations`, `/students` et `/classes` ont déjà répondu 200 avec du volume.

Preuve RED : `web/src/pages/demoDataAccess.hydration.red.test.tsx`.

## Catégories

| Catégorie | Détail |
|---|---|
| **loading state** | Cause principale. Spinner Notes = `DataContext.loading` global. Dashboard Démo allonge le batch. |
| **loader** | `dashboardDomainsForDemo` hydrate trop large ; `evaluations` n’y figure pas, donc `/notes` relance un second batch pendant que le premier (notes+messages) est encore ouvert. |
| **session scope** | Secondaire pour Notes si le payload PG porte `schools.school_code` leftover (aligné JWT). Les élèves passent par `schoolId`. Finance utilise `schoolId` puis alias leftover/login_code. |
| **mapping payload** | `/exams` et `/report-cards` sont wrappés `{ exams }` / `{ bulletins }` — les loaders les déballent. `/notes`, `/classes`, `/students`, `/evaluations` sont des tableaux bruts. Pas d’incohérence de forme détectée. |
| **permissions** | 89 permissions live de l’échange Démo. Admin School a `Notes:READ`, `Élèves:READ`, `Messages:READ`, etc. Le RBAC n’interdit pas ces GET. `OverviewPage` n’applique pas le filtre RBAC du `DomainRouteBootstrap`. |

## Tableau d’audit écran par écran

Volumes backend = gate #665 (30 classes, 300 élèves, 59 enseignants, 300 paiements, 300 présences, 2400 notes, 10 examens). « Volume après scope Web » = ce que le composant peut **présenter** tant que le batch dashboard n’est pas clos.

| Route | Domaine(s) | Endpoint(s) | Status HTTP | Volume backend | Volume après scope Web | Cause du blocage | Fichier/ligne | Sévérité |
|---|---|---|---|---|---|---|---|---|
| `/tableau-de-bord` → `DashboardEntryPage` → `OverviewPage` | `schools users students teachers classes payments studentFees presences` (bootstrap) + `notes exams bulletins documents messages` (Démo extra) | `GET /backoffice/establishments/:code`, `/students`, `/teachers`, `/classes`, `/payments`, `/presences`, `/notes`, `/exams`, `/report-cards`, `/school-documents`, `/backoffice/messages` | 200 attendu (gate #665) | agrégats > 0 | **partiel** : seuls les domaines du 1er batch (sans notes) sont fusionnés ; le 2e batch reste invisible | La page ne lit pas `loading` : quelques KPI peuvent s’afficher (élèves/paiements/présences du 1er batch) pendant que notes/examens restent à 0 | `OverviewPage.tsx:31-40` `dashboardDemoHydration.ts:3-17` `routeDomainMap.ts:6-21` | Haute (déclencheur) |
| `/etablissement/vue-ensemble` → `EtablissementOverviewPage` | `schools students teachers classes users assignments relations` | `GET /students`, `/teachers`, `/classes`, `/backoffice/users`, `/assignments`, `/backoffice/relations`, `/v2/academic-years` | 200 | 300 / 59 / 30 | **tuiles possibles** si ce batch-ci finit ; spinner `Chargement de la scolarité…` tant que `hydrationStatus` est `idle`/`loading` | `DomainRouteBootstrap` ne pose `ready` que pour **cette** route, pas le batch dashboard. Pas de `if (loading)` global. Scope élèves = `schoolId`. Classes = `filterCanonicalClasses` (pas leftover). Enseignants = leftover **ou** classes des élèves | `EtablissementOverviewPage.tsx:98-100` `DomainRouteBootstrap.tsx:14-67` `studentsScope.ts:127-178` | Moyenne |
| `/planning/emploi-du-temps/calendrier` → `CoursePlanningPage` | `academicConfigs courseSchedules classes teachers assignments` | `GET /backoffice/establishments/:code/academic-config`, `/course-schedules`, `/classes`, `/teachers`, `/assignments` + occurrences `GET /course-schedules?from&to` | 200 si membership leftover résolu par `getSchoolByCode` | n/a (planning non chiffré #665) | **vide possible** si classes pas encore fusionnées, ou si occurrences 400/[] | Page autonome : calendrier dépend des classes scopées leftover + fetch occurrences local (`courseOptionsStatus`) | `routeDomainMap.ts:35` `CoursePlanningPage.tsx:149+` `ActiveSchoolContext.tsx:71-75` | Moyenne |
| `/presences` → `PresencesPage` | `presences classes assignments teachers` | `GET /presences`, `/classes`, `/assignments`, `/teachers` puis roster `GET /classes/:code/students` | 200 / 300 présences | 300 | **cartes classes = 0** tant que `classes` du DataContext n’est pas fusionné ; pas de spinner pleine page | Pas de `if (loading)`. UI vide si `state.classes` encore `[]` à cause du batch dashboard (si on vient du dashboard, classes du 1er batch sont déjà là → cartes possibles). Roster séparé. | `PresencesPage.tsx:77-100` | Moyenne |
| `/notes` → `GradesEvaluationsPage` | `notes evaluations students classes` | `GET /notes`, `/evaluations`, `/students`, `/classes` | 200 / 2400 notes | 2400 | **0 présenté** : spinner plein écran | `if (loading)` global. `notes` est dans le batch dashboard encore ouvert (messages). `evaluations` n’est **pas** dans le dashboard : second batch. `mergeLoadedDomains` des notes attend la fin de messages. Condition exacte : `fetchLoading === true` (`DataContext.tsx:176`) | `GradesEvaluationsPage.tsx:106,627-628` `DataContext.tsx:282-401` | **Critique** |
| `/examens` → `EntityPage entity=exams` | `exams notes students classes` | `GET /exams` → `{ exams }` | 200 / 10 | 10 | **0** tant que le batch dashboard (qui contient `exams`) n’a pas fini ; ensuite leftover `scopedExams` (JWT leftover vs `school_code` PG) | Pas de spinner EntityPage. Tableau vide. Scope : leftover **ou** nom de classe des élèves | `EntityPage.tsx` `entityModules.ts:735-736` `establishment.ts:298-307` `domainLoaders.ts:144-147` | Haute |
| `/bulletins` → `EntityPage entity=bulletins` | `bulletins notes students classes` | `GET /report-cards` → `{ bulletins }` | 200 (volume #665 non cité) | ? | **0** tant que batch dashboard ouvert ; ensuite `scopedBulletins` via studentIds | Même mécanisme que examens. Loader déballe `payload.bulletins` | `domainLoaders.ts:148-151` `establishment.ts:309-311` | Haute |
| `/finances/paiements` → `EntityPage entity=payments` | `schools feeGrids schoolFeeItems studentFees payments paymentStatuses students` | `GET /payments`, `/finance/fee-grids`, `/finance/student-fees`, `/students` | 200 / 300 | 300 | **paiements du 1er batch dashboard déjà fusionnés** (payments est dans `routeDomainMap` `/tableau-de-bord`). Scope `scopedPayments` : `schoolId`/`schoolPublicCode`/élève | Pas de spinner. Si on ouvre Finances sans passer par le dashboard, même `loading` global. `studentFees` dans le 1er batch. | `establishment.ts:246-266` `routeDomainMap.ts:36` | Moyenne |
| `/finances/frais` → `FinanceFeesPage` | idem finances | `GET /finance/fee-grids` + catalogue local | 200 | grilles tenant | Spinner **local** `Chargement des tarifs…` (`catalogLoading`), indépendant du DataContext | Scope finance = `schoolId` puis alias leftover/login_code. Pas le spinner Notes. | `FinanceFeesPage.tsx:394-396` `fees.ts:79-88` | Basse |
| `/parametres` → `SettingsHubPage` | `academicConfigs schools rolePermissions users` | `GET .../academic-config`, establishments, users | 200 | n/a | Hub de cartes, peu de listes métier. `academicConfigs` est forcé par `ActiveSchoolContext` (`force: true`) | Force-refresh academic-config peut **rallonger** `fetchLoading` global (donc Notes) à chaque changement d’identité `ensureDomains` | `SettingsHubPage.tsx` `ActiveSchoolContext.tsx:71-75` `routeDomainMap.ts:56` | Moyenne (effet de bord) |
| `/parametres/annee-scolaire` → `ConfigurationPage` | `academicConfigs schools` | `GET /backoffice/establishments/:leftover/academic-config`, `/v2/academic-years` | 200 si leftover résolu | années | Années scopées par `schoolId` (`scopeAcademicYearsForConfiguration`) | `ClassesListPage` utilise `activeSchool.id` pour les années. Si `scopedSchools` filtre `school.code === leftover` et que GET establishment renvoie `code=leftover`, OK | `ConfigurationPage.tsx` `scope.ts:56-67` | Basse |
| `/etablissement/classes` → `ClassesListPage` | fetch **direct** `classesApi.list()` (pas DataContext) | `GET /classes` | 200 / 30 | 30 | **30** si le GET page réussit — **indépendant du spinner DataContext** | `requireEnrollment` n’est pas utilisé ; `principal.schoolCode` leftover → `getSchoolByCode`. Spinner local `loading` de la page | `ClassesListPage.tsx:84-141` `classesRepository.js:399-408` | Basse si GET 200 |
| `/etablissement/eleves` → `StudentsListPage` | `students classes schools` via DataContext | `GET /students` | 200 / 300 | 300 | Spinner `Chargement des élèves…` si `dataLoading && rows.length===0` ; sinon scope `schoolId` | Même `loading` global. Si students déjà fusionnés (1er batch dashboard), l’annuaire peut s’afficher. Payload API = `login_code` + `schoolId` | `StudentsListPage.tsx:171-208` `studentsScope.ts:127-178` | Haute si ouvert à froid |
| `/etablissement/enseignants` → `TeachersListPage` | fetch **direct** `teachersApi.list()` | `GET /teachers` | 200 / 59 | 59 | **59** si GET page réussit | `sendList` sans pagination = tableau brut. Spinner local. `school_code` leftover sur les lignes | `TeachersListPage.tsx:119-170` `teachersRepository.js:110` | Basse si GET 200 |

## Condition exacte du spinner Notes

```
session.demo === true
&& permissionsReady === true          // déjà corrigé DEMO-3
&& OverviewPage.ensureDomains(dashboardDomainsForDemo(true))
&& refreshDomains([notes, exams, bulletins, documents, messages]) encore in-flight
&& GradesEvaluationsPage rend if (useData().loading) → LoadingState
```

`loading` reste `true` tant que `fetchInFlightCountRef > 0` (`DataContext.tsx:347-350`). Le GET `/notes` 200 est retenu dans `Promise.allSettled` jusqu’à `messages` / `documents` / `report-cards`.

## Lot de correction minimal (proposition, non implémenté)

1. **Ne plus mixer les domaines facultatifs avec les domaines de l’écran courant.** `OverviewPage` : `filterDomainsByPermissions` + retirer `messages`/`documents` du dashboard Démo, ou hydrater notes/examens/bulletins dans des `ensureDomains` **séparés**.
2. **Notes ne doit plus se juger sur `loading` global.** Attendre uniquement `notes` + `evaluations` (et éventuellement `students`/`classes`), ou ne spinner que si ces domaines sont absents.
3. **`mergeLoadedDomains` incrémental** (option plus invasive) : fusionner chaque domaine dès son GET 200, sans attendre le frère `messages`.
4. Tests RED → GREEN : le fichier `demoDataAccess.hydration.red.test.tsx` doit passer sans relâcher le GET messages **ou** Notes ne doit plus dépendre de ce GET. Témoin déjà présent : dès que messages se termine, volumes tenant > 0.

Hors lot : seed, RBAC, fail-closed tenant, PROD/PREPROD, DataContext legacy.

## Preuve RED

```
npm --prefix web run test:hydration-red -- src/pages/demoDataAccess.hydration.red.test.tsx
```

Cas qui **doit échouer** sur ce HEAD : session Démo + GET `/notes` 200 avec volume + GET `/backoffice/messages` encore ouvert → l’écran Notes ne doit plus afficher le spinner et les volumes scopés doivent être > 0.
