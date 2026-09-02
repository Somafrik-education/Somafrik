# Audit CTO — Intégrité canonique Années scolaires / académiques

**Repo :** Somafrik-education/Somafrik  
**Branche :** `cursor/academic-year-audit-92b2`  
**Base (develop post-#233) :** `7e36f5e0b3d9cc5043c244c87396f6deec79f9f1`  
**Head :** tip de `cursor/academic-year-audit-92b2` / PR #234 (voir `git rev-parse HEAD`)  
**Gouvernance :** PR **DRAFT AUDIT-ONLY** — aucun Ready — aucun merge — STOP CTO  
**Diff GitHub indépendant obligatoire avant toute correction.**

**Périmètre :** lecture seule. Aucune correction métier, aucune migration, aucune suppression de code.

---

## Réponse CTO (critère §46)

> Si un Admin School crée l’année 2026-2027 dans Paramètres, quelles tables PostgreSQL sont écrites, quelles fonctionnalités la consomment, et qu’est-ce qui empêche une classe/note/examen d’utiliser une autre année incohérente ?

**Aujourd’hui, un Admin School ne peut PAS créer une année dans Paramètres.**

`/parametres/annee-scolaire` n’appelle jamais `POST /api/v2/academic-years`. Il écrit :

| Action Paramètres | Tables PG |
|---|---|
| PATCH barème / mode période / mode bulletin | `school_settings` |
| PUT périodes | `terms` (FK `academic_year_id` de l’année **ouverte/courante** uniquement) |

Si **aucune** année ouverte n’existe, PUT périodes échoue : `ACADEMIC_YEAR_REQUIRED` — « Aucune année scolaire ouverte. Créez une année avant les périodes. »

La **seule UI Web de création** d’une ligne `academic_years` est le modal Classes :

`/etablissement/classes` → Ajouter une classe → « Créer cette année scolaire » → `POST /api/v2/academic-years` → `INSERT academic_years`.

**Consommateurs d’une année créée (UUID `academic_years.id`) :**

- `classes.academic_year_id` (obligatoire)
- `enrollments.academic_year_id` (copié depuis la classe)
- `teacher_assignments.academic_year_id`
- `terms.academic_year_id` → `evaluations.term_id`, `grades.term_id`
- `exams.academic_year_id` + `exams.term_id`
- `report_cards.academic_year_id` + `report_cards.term_id`
- `promotion_decisions.academic_year_id`

**Ce qui n’empêche PAS une incohérence année :**

- Notes : le terme est résolu sur l’année **courante/ouverte**, pas sur `classes.academic_year_id`.
- Examens / bulletins PG : fallback « année courante » si `academicYearId` absent.
- Présences : pas de `academic_year_id` (uniquement `class_id` + date).
- Finance : `academic_year` est un **TEXT**, pas une FK.
- Planning : année implicite via `class_id` ; `period_name` dénormalisé.
- Aucune API de clôture ; `status=closed` n’est presque jamais posé.
- Auto-création silencieuse au boot / à la lecture (`ensureCurrentAcademicYearForSchool`, dates 01/09–31/08 hardcodées).

---

## 1. Base SHA

`7e36f5e0b3d9cc5043c244c87396f6deec79f9f1` — merge #233 (login_code SEQ3 + initiales ISC).

## 2. Head SHA

Tip de `cursor/academic-year-audit-92b2` (PR #234). Premier commit d’audit : `39b086e0e391dbc06e69d158efb727348d2d1f30`.

---

## 3. Tables PostgreSQL

| Table | PK | `school_id` | Lien année | Dates | Statut | UNIQUE |
|---|---|---|---|---|---|---|
| `academic_years` | `id` UUID | OUI FK `schools` | — | `start_date`, `end_date` DATE nullable | `status` TEXT défaut `open` ; `is_current` BOOLEAN | `(school_id, name)` |
| `terms` | `id` UUID | non (via année) | `academic_year_id` NOT NULL | `start_date`, `end_date` | `status` défaut `open` | `(academic_year_id, name)` |
| `school_settings` | `school_id` | PK | non | — | `period_mode`, `default_scale`, `report_card_mode` | PK école |
| `school_academic_configs` | `school_id` | PK | JSON legacy | — | `config_payload` | PK école |
| `classes` | `id` UUID | OUI | `academic_year_id` **NOT NULL** | — | `active`/`inactive` | `class_code` ; index `(school_id, academic_year_id, lower(name))` |
| `enrollments` | `id` | OUI | `academic_year_id` NOT NULL + `class_id` | `enrollment_date` | `active` | `(student_id, academic_year_id)` |
| `teacher_assignments` | `id` | OUI | `academic_year_id` NOT NULL | — | `active` | unique partielle active `(teacher, class, subject, year, role)` |
| `evaluations` | `id` | OUI | via `term_id` + `class_id` | `evaluation_date` | — | — |
| `grades` | `id` | OUI | via `term_id` | — | — | unique évaluation+élève (boot) |
| `exams` | `id` | OUI | `academic_year_id` + `term_id` (nullable en DDL) | `exam_date` | — | — |
| `report_cards` | `id` | OUI | `academic_year_id` + `term_id` NOT NULL | — | — | `(school_id, student_id, academic_year_id, term_id)` |
| `report_card_templates` | `id` | OUI | `academic_year_id` optionnel | — | — | partiels |
| `promotion_decisions` | `id` | OUI | `academic_year_id` NOT NULL | — | — | `(academic_year_id, student_id)` |
| `attendance` | `id` | OUI | **aucun** — `class_id` + `attendance_date` | date | — | `(school_id, student_id, attendance_date)` |
| `course_schedule_slots` | `id` | via classe | **aucun FK année** — `period_name` TEXT | `period_start/end` | — | — |
| `fee_grids` | `id` | OUI | `academic_year` **TEXT** | — | — | `(school, class_name, academic_year, period_name)` normalisés |
| `student_fee_obligations` | `id` | OUI | `academic_year` TEXT | — | — | active + `period_label` |

**Absents :** `school_years`, `school_year_id`, table `periods`, `period_id`.

**CHECK manquants sur `academic_years` / `terms` :** pas de `start_date < end_date`, pas d’EXCLUDE overlap, pas d’unicité `is_current` par école, pas de CHECK `status IN (...)`.

Définition : `backend/db/schema.sql` L111–134 (`academic_years`, `terms`).

---

## 4. Relations (schéma textuel)

```
schools
  ├── academic_years (school_id, name UNIQUE par école)
  │     ├── terms                    ← « périodes » API
  │     │     ├── evaluations
  │     │     ├── grades
  │     │     ├── exams (term_id + academic_year_id)
  │     │     └── report_cards
  │     ├── classes (academic_year_id NOT NULL)
  │     │     ├── enrollments (academic_year_id recopié)
  │     │     ├── attendance (class_id seulement)
  │     │     ├── school_courses
  │     │     └── course_schedule_slots (period_name TEXT)
  │     ├── teacher_assignments
  │     └── promotion_decisions
  ├── school_settings (period_mode, default_scale, report_card_mode)
  └── school_academic_configs (JSONB vidé au boot)

Finance (libellés, pas FK UUID) :
  fee_grids.academic_year TEXT
  student_fee_obligations.academic_year TEXT
```

---

## 5. API

| Méthode | Route | Permission `routePermissions` | Table écrite | Classement RBAC |
|---|---|---|---|---|
| GET | `/api/v2/academic-years` | `Années Académiques:READ` + jetons legacy + `Gérer classes` | lecture | **live PG** (`requirePermission` re-fetch) |
| POST | `/api/v2/academic-years` | **legacy seulement** : `Valider années académiques`, `Gérer planning académique`, `Gérer classes`, `ALL_PRIVILEGES` — **pas** `Années Académiques:CREATE` | `academic_years` | **live PG** mais **clé canonique CREATE absente** |
| PATCH/PUT/DELETE année | **inexistant** | — | — | — |
| open/close/archive | **inexistant** | — | — | — |
| GET | `/api/school-settings` | `Paramètres Établissement:READ\|UPDATE` + legacy | lecture + projection `schoolYear` | live + `assertSchoolSettingsRead` (JWT overlay) |
| PATCH | `/api/school-settings` | `Paramètres Établissement:UPDATE` | `school_settings` | live + `assertSchoolSettingsWrite` |
| PUT | `/api/academic-periods` | idem UPDATE settings | `terms` | live + assertCan |
| GET | `/api/academic-config` | **auth-only** (pas `requirePermission`) | projection | **auth-only** — dette |
| PUT | `/api/academic-config` | PUT academic-config | `school_academic_configs` = `{}` | live |
| POST | `/api/classes` | `Classes:CREATE` | `classes` (résout année **par nom**) | live |

Handlers années : `backend/server.js` ~L2604–2619.  
Création : `postgresRepository.createAcademicYearV2` ~L4947–4986.  
Audit : `academic_year_create`.

**Pas de transaction** autour duplicate-check + demote `is_current` + INSERT.

---

## 6. Web

| Surface | Route | Composant | Créer année ? | Modifier / clôturer ? |
|---|---|---|---|---|
| Classes | `/etablissement/classes` | `ClassesListPage.tsx` | **OUI** si `years.length === 0` | Non |
| Paramètres hub | `/parametres` | `SettingsHubPage.tsx` | Non | Non |
| « Année scolaire » | `/parametres/annee-scolaire` | `ConfigurationPage` section `annee-scolaire` | **NON** | Périodes + barème seulement |
| Permissions | `/administration/permissions` | `PermissionsPage` | Module `academic_years` dans la matrice | Pas d’écran métier |

**Chemin Classes (capture préprod) :**

1. `ClassesListPage` charge `academicYearsApi.list()` (`GET /v2/academic-years`).
2. Modal « Ajouter une classe ».
3. Si aucune année : panneau amber « Aucune année scolaire n'est configurée… » + NOM / DATE DÉBUT / DATE FIN.
4. Bouton « Créer cette année scolaire » → `createFirstAcademicYear()` L131–148.
5. `academicYearsApi.create({ schoolCode, name, startDate, endDate, isCurrent: true })`.
6. Defaults UI : `new Date().getFullYear()` + **01/09 → 31/08** (L62–67) — calendrier septembre hardcodé.
7. Lien vers Paramètres pour périodes/barème uniquement (L350–352).

**Paramètres :** `handlePeriodsSubmit` (ConfigurationPage ~L197–233) → `schoolSettingsApi.patch` + `replacePeriods`. Aucun `academicYearsApi`.

**Autres :** finance / élèves affichent un libellé d’année (souvent string). `years[0]?.name` préremplit le select classe (L112–115) — **pas** `is_current`.

---

## 7. Mobile

- **Aucun** client `POST /api/v2/academic-years`.
- `ConfigurationScreen` : carte « Periodes academiques » **lecture**, sans route d’édition.
- `AdminCrudScreen` : champ `schoolYear` uniquement sur l’entité `schools` **retirée**.
- `ClassesScreen` : liste lecture, pas de bootstrap année.
- Un Admin School Mobile **ne peut pas** créer d’année.
- Module « Années Académiques » apparaît dans le pilotage de rôles seulement.

---

## 8. RBAC

**Module catalogue :** `academic_years` / libellé « Années Académiques » (`functionalModulesCatalog.js` L33).

**Matrice legacy `data.js` :**

| Rôle | Années Académiques |
|---|---|
| SUPER_ADMIN (Somafrik) | CRUD |
| COUNTRY_ADMIN (Admin Pays) | — |
| SCHOOL_ADMIN (Admin School) | CRUD |
| PREFET | R |
| TEACHER | R |
| autres | — |

**Defaults internes Admin School :** `Années Académiques:READ|CREATE|UPDATE` (`internalRoleDefaults.ts` L44–46) — **pas DELETE**.

**Écart produit :**

- Cible : Admin School gère l’année **dans Paramètres**.
- Réel : Admin School crée l’année **dans Classes** si le POST passe (via `Gérer classes` / jetons legacy), pas via `Années Académiques:CREATE`.
- Un rôle qui n’a que `Années Académiques:CREATE` (matrice live) peut être **refusé** au POST.
- Préfet : READ liste, pas CREATE (sauf s’il a aussi `Gérer classes`).

---

## 9. routePermissions

```
GET  /api/v2/academic-years  → Années Académiques:READ + Valider années académiques + Gérer planning académique + Gérer classes + COUNTRY_PRIVILEGES + ALL_PRIVILEGES
POST /api/v2/academic-years  → Valider années académiques + Gérer planning académique + Gérer classes + ALL_PRIVILEGES
                               (Années Académiques:CREATE ABSENT)
```

`backend/services/rbacService.js` L74–75.

Live overlay : `requirePermission` appelle `resolveEffectivePermissions` avant `canAccess` (`server.js` ~L5242).

---

## 10. Source d’autorité (SoT)

| Source | Classe |
|---|---|
| `academic_years`, `terms` | **A. PostgreSQL canonique** |
| `school_settings` (mode période, barème, bulletin) | **A** |
| `cacheService.remember("v2:academic-years")` | **B. cache** |
| `defaultAcademicPeriods()` dates 2025–2026 | **C. seed** |
| `backend/data.js` `schoolYear: "2025-2026"` | **C** |
| `school_academic_configs.config_payload` (vidé au boot) | **D. legacy** |
| `backoffice_state` runtime `getBackOfficeState() = null` | **D** |
| `fallbackRepository` auto `"2025-2026"` | **E. fallback dangereux** |
| `ensureCurrentAcademicYearForSchool` (boot + lecture) | **E** |
| `localStorage` / `sessionStorage` | pas d’année scolaire |

Les années **sont** stockées en PostgreSQL. Elles ne viennent plus de JSON métier au runtime PG. Des **écritures silencieuses** peuvent encore les créer hors UI.

---

## 11. Legacy

- `school_academic_configs` : table encore bootée ; clés `periods`, `schoolYear`, `academicYear`, `defaultScale` **strippées** (`schoolSettingsSchema.js`).
- PUT `/api/academic-config` refuse d’écrire ces clés et persiste `{}`.
- GET `/api/academic-config` : projection PG (settings + terms de l’année courante).
- `gradeBookService` PDF bulletin : in-memory, filtre période **sans année**.
- Mobile AdminCrud JSON local : no-op sur classes/schools.

---

## 12. JSON restant

- Projection lecture `academicConfigs` côté Web (DataContext) alimentée par GET academic-config.
- Finance / fees : année en string dans grilles.
- Seeds `planningSeedData` / `data.js`.

Pas de `academicYears` dans localStorage.

---

## 13. Création depuis Classes

**Classement : workaround historique + duplication de responsabilité (la cible est Paramètres), API canonique PG.**

Trace :

```
ClassesListPage.createFirstAcademicYear
  → academicYearsApi.create
  → POST /api/v2/academic-years
  → requirePermission (legacy / Gérer classes)
  → tenantScopeService.assertSchoolAccess
  → createAcademicYearV2
  → INSERT academic_years (status='open', is_current défaut true)
  → auditService.record(..., "academic_year_create", "academic_year", id)
```

Ce n’est **pas** un fallback localStorage. C’est un **formulaire CREATE année embarqué dans Classes**.

Test Web qui **verrouille ce workaround** : `ClassesListPage.test.tsx` L211–225 (« permet de créer la première année scolaire après une remise à zéro »).

---

## 14. Création depuis Paramètres

**Impossible aujourd’hui.**

Paramètres écrit `school_settings` + `terms` de l’année déjà ouverte.  
Si zéro année ouverte : erreur 400, pas d’INSERT `academic_years`.

Hub copy (« année active ») **survend** : l’écran ne pose pas `is_current`.

---

## 15. Année courante

Fonction exacte `getCurrentAcademicYear` (`postgresRepository.js` L2873–2886) :

1. `WHERE school_id AND status IN ('active','open')`
2. `ORDER BY is_current DESC, created_at DESC LIMIT 1`
3. Si miss → **`ensureCurrentAcademicYearForSchool`** (INSERT `YYYY-(Y+1)`, **01/09–31/08**)

`findCurrentAcademicYear` (settings store L77–85) : même SELECT **sans** ensure.

`listTermRows` / `replaceTerms` utilisent `findCurrentAcademicYear` (pas d’auto-create à l’écriture périodes).

**Boot settings** `bootstrapCanonicalSettingsForAllSchools` (L327–338) appelle `seedDefaultTermsIfEmpty` → **ensure année + trimestres 2025–2026** pour **chaque** école sans année ouverte. Auto-create silencieux à **chaque** `postgresRepository.init()`.

UI Classes : select défaut = `years[0]` (tri API `start_date DESC`), pas forcément `isCurrent`.

---

## 16. Unicité

| Règle | DB | App |
|---|---|---|
| Même école + même nom | UNIQUE `(school_id, name)` | 409 case-insensitive |
| Une seule `is_current` | **non** | demote all si `isCurrent` à la création (course) |
| Chevauchement dates années | **non** | seulement `startDate < endDate` **intra**-année |
| Plusieurs années `open` | **autorisé** | oui |
| Nom de période unique par année | UNIQUE `(academic_year_id, name)` | replaceTerms refuse doublons de noms |
| Chevauchement périodes | **non** | **non** |

Écoles A et B peuvent chacune avoir `2026-2027` (scope `school_id`). **OK multi-tenant.**

---

## 17. Overlap

Cas CTO :

- 2026-2027 : 01/09/2026 → 31/08/2027
- puis 2027 : 01/01/2027 → 31/12/2027

**Le backend n’a aucune garde.** Les deux INSERT réussissent si les **noms** diffèrent.

Risque : deux années ouvertes, classes homonymes, notes/examens résolus sur « current », finance TEXT ambigu.

**Dette P0** : absence de règle, pas une règle inventée.

---

## 18. Périodes

Contrat capture : « Les périodes et le barème restent configurables dans Paramètres → Année scolaire » — **vrai pour périodes/barème, faux pour l’année elle-même.**

- SoT : table `terms` (pas JSON).
- API « periods » = projection de `terms` + `active` **calculé** par date (`academicPeriods.js`), non persisté.
- CRUD périodes : uniquement l’année courante ouverte.
- Ordre : `ORDER BY start_date, created_at, name` — pas de colonne `order`.
- Seed défaut : Trimestre 1/2/3 dates **2025–2026 hardcodées** (`academicConfigDefaults.js`).

---

## 19. Barème

| Portée | Stockage | Par année ? |
|---|---|---|
| Défaut établissement | `school_settings.default_scale` | Non |
| Évaluation | `evaluations.max_score` | Non (copie à la création) |
| Note | `grades.max_score` | Non |
| JSON config | écriture interdite | — |

SoT : **PG établissement**, pas par année.

---

## 20. Clôture

| Recherche | Résultat |
|---|---|
| `closeAcademicYear` / `archiveYear` | **0 occurrence** |
| API close | **aucune** |
| `status` `closed`/`archived` | mapping lecture `fromYearStatus` ; `notesLocked` si closed/archived |
| Garde pédagogie | `assertOpenAcademicYearForClass` — planning cours 409 si closed |
| Inscription | refuse si statut classe/année ∉ `{open, active}` |
| POST classe | **ne vérifie pas** l’année fermée |
| Notes / présences / finance | pas de garde clôture globale |

**Dette majeure :** le statut existe, **rien ne le pose**, et la clôture n’interdit pas classes / notes / présences / paiements / fige bulletins de façon uniforme.

---

## 21. Suppression

Aucune route DELETE. Aucun archive. Une année référencée resterait bloquée par FK PostgreSQL **si** un DELETE SQL manuel était tenté (`classes`, `enrollments`, `terms`, etc.). Comportement produit : **suppression impossible via API**.

---

## 22. Classes

- `academic_year_id` UUID **obligatoire** — P0 structurel **OK**.
- Client envoie `academicYearName` (string), jamais l’UUID — lookup exact `name`.
- PATCH : année immuable.
- Sans année : POST classe → 400 « Année scolaire introuvable ».
- UI actuelle : auto-create depuis le modal au lieu de bloquer + rediriger Paramètres.

**Écart cible §26 :** formulaire CREATE année dans Classes = **P0 UX / gouvernance**.

---

## 23. Enrollments

`enrollments.academic_year_id` recopié de `classes.academic_year_id` à l’INSERT.  
`UNIQUE (student_id, academic_year_id)` : une inscription active par élève et par année.

**Écart :** `ensureActiveEnrollment` (sync) utilise `getCurrentAcademicYear()` — peut inscrire sur l’année courante **≠** année de la classe (**E**).

---

## 24. Notes

`evaluations.term_id` + `class_id`. Pas de `academic_year_id` sur l’évaluation.

`evaluationAttachment.resolveEvaluationAttachments` : année = **courante**, terme = nom dans cette année.  
**Une note peut être attachée à une période d’une autre année** que celle de la classe si les noms de trimestres coïncident.

`findClassByNormalizedName` : pas de filtre année (`ORDER BY created_at DESC LIMIT 1`).

---

## 25. Présences

`attendance` : `class_id` + `attendance_date`. Pas d’année.  
Mélange d’années : uniquement via changement de `class_id` ; unicité **jour+élève+école** peut **écraser** la classe.

---

## 26. Examens

FK `academic_year_id` + `term_id` présentes.  
Résolution : `academicYearId` client **ou** première année open/active (`is_current DESC`). Classe par **nom** sans filtre année. Terme scopé à l’année **résolue**, pas forcément celle de la classe.

---

## 27. Bulletins

PG `report_cards` : UNIQUE `(school, student, academic_year_id, term_id)` — reproductible **si** IDs fournis.  
Sans `academicYearId` → année courante (**E**).  
PDF `/api/students/:id/report.pdf` : `gradeBookService` période only — **D/E**.

---

## 28. Planning

GET/POST `course_schedule_slots` via `class_id`. `assertOpenAcademicYearForClass` sur l’année de la classe.  
`period_name` TEXT, pas `term_id`.  
Fallback mémoire : no-op « PostgreSQL requis ».

---

## 29. Multi-tenant

- `academic_years.school_id` NOT NULL.
- GET liste globale puis `tenantScopeService.filterRows` par `schoolCode` (Admin School) / pays (Admin Pays). Superadmin voit tout.
- POST : `assertSchoolAccess(schoolCode)`.
- A et B peuvent tous deux avoir `2026-2027`.
- **Pas de test HTTP d’isolation A/B dédié années** identifié (filtre générique tenant).

---

## 30. Tests existants

| Couche | Fichier | Couvre |
|---|---|---|
| Unit mémoire | `academicYearsManagement.test.js` | create, 409 doublon, isCurrent unique (FallbackRepository) |
| PG settings | `schoolSettings.pg.test.js` | périodes, ensure année |
| Sync | `evaluationSyncRepository.test.js` | ensure année idempotent |
| Classes PG | `classesRepository.pg.test.js` | classe liée à une année existante |
| Web | `ClassesListPage.test.tsx` | **création année depuis Classes** (comportement à inverser plus tard) |
| HTTP | `verify-classes-management.js` / `verify-school-settings-management.js` | classes + settings, pas close/overlap |
| Mobile | aucun test année | — |
| E2E | `verify-e2e-0004-classes-config.js` | config classes |

**Manquant :** overlap dates, isolation A/B années, POST sans `Gérer classes` avec seulement `Années Académiques:CREATE`, clôture, refus POST classe sans année côté UI cible, notes vs `classes.academic_year_id`, boot qui n’auto-crée plus.

---

## Vocabulaire (§2) — décision proposée, non implémentée

| Terme | Usage réel |
|---|---|
| `academic_years` | table canonique |
| `schoolYear` / année scolaire | libellé UI Classes / Paramètres / API settings |
| Années Académiques | module RBAC + routePermissions |
| `terms` / periods | trimestres/semestres |
| `year` | trop ambigu (identité users, login_code YY, finance TEXT) |

**Proposition architecture (à valider CTO, pas à coder) :**

**Option A (recommandée) :** un seul modèle PG `academic_years` ; libellé UI « Année scolaire » ou « Année académique » selon `schools.school_type` (secondaire vs université). Comportement identique.

**Option B :** deux tables — **non justifiée** (mêmes dates, mêmes termes, mêmes classes).

Ne rien renommer dans cette PR.

---

## Nom d’année (§40)

Champ `academic_years.name` **libre** (saisie Classes). Souvent `2026-2027` par défaut calendaire.

**Double rôle actuel :** display **et** clé métier (`POST /classes` lookup `name`). Fragile (casse, espaces). L’UUID existe mais n’est pas le contrat client Classes.

---

## Calendrier pays (§41)

- UI Classes + `ensureCurrentAcademicYearForSchool` : **01/09 → 31/08** hardcodé.
- Seed trimestres : **01-09-2025 … 30-06-2026** hardcodé.
- Aucun calendrier RDC/Burundi/université.

Ne pas généraliser septembre dans un futur backend.

---

## Modification après usage (§24)

Aucune API PATCH. Impossible de changer nom/dates via produit. SQL manuel possible ; pas de garde « déjà utilisée par classes/notes ».

---

## Transaction (§33)

- POST année : **non transactionnel**.
- PATCH settings + PUT périodes : **transactionnels** (`schoolSettingsService`) ; audit fail → rollback.

POST année n’auto-crée pas les périodes. Les périodes naissent au **boot** (`seedDefaultTermsIfEmpty`) ou via Paramètres.

---

## Audit logs (§34)

| Action | Présent |
|---|---|
| `academic_year_create` | OUI |
| UPDATED / CLOSED / ARCHIVED | **NON** |
| `update_school_settings` | OUI |
| `replace_academic_periods` | OUI |
| `save_academic_config` | OUI (legacy) |

---

## Intégrité référentielle UUID (§39)

Canonique : `academic_year_id`, `term_id` UUID.  
**Comparaisons par name/string :**

- `POST /classes` → `academicYearName`
- notes/examens : période par nom
- finance : `academic_year` TEXT
- planning : `period_name` TEXT

---

## 31. Risques (P0 / P1 / P2)

| ID | Risque | Sévérité |
|---|---|---|
| R1 | Création d’année dans Classes au lieu de Paramètres (gouvernance produit) | **P0** |
| R2 | Auto-create boot/lecture (`ensureCurrentAcademicYearForSchool`, sept/août) | **P0** |
| R3 | POST année non gated par `Années Académiques:CREATE` | **P0** |
| R4 | Notes/examens résolus sur année courante ≠ année de la classe | **P0** |
| R5 | Pas de clôture réelle ni garde uniforme | **P0** |
| R6 | Pas d’overlap dates | **P1** |
| R7 | Finance / planning / présences sans FK année | **P1** |
| R8 | Lookup classe/année par **nom** | **P1** |
| R9 | `is_current` non unique en DB | **P1** |
| R10 | GET `/api/academic-config` auth-only | **P1** |
| R11 | Mobile sans gestion d’année | **P2** |
| R12 | PDF bulletin legacy sans année | **P2** |
| R13 | Test Web qui fige le formulaire Classes | **P2** (bloque la correction) |

Dépendances métier : Classes, Élèves/inscriptions, Notes, Présences, Examens, Bulletins, Planning, Finance (libellé), Rapports.

---

## 32. Écarts vs cible produit

| Cible | Actuel |
|---|---|
| CREATE/UPDATE/CLOSE uniquement Paramètres | CREATE dans Classes ; UPDATE/CLOSE inexistants |
| Classes charge / sélectionne / bloque | Charge + sélectionne + **crée** si vide |
| Message + lien Paramètres, aucun formulaire année | Formulaire NOM/DATES + bouton Créer |
| Admin School autorisé via module années | POST via `Gérer classes` / legacy |
| Pas d’auto-create | Boot + `getCurrentAcademicYear` créent des années |
| Périodes dans Paramètres | Déjà le cas (année courante seulement) |

---

## 33. Recommandations (non implémentées)

1. **Un seul modèle** `academic_years` + label UI selon type d’établissement (option A).
2. **Retirer** le formulaire année de Classes ; empty-state → Paramètres.
3. **Ajouter** CRUD année (créer / modifier dates / activer `is_current` / clôturer) dans `/parametres/annee-scolaire`.
4. **Supprimer** l’ensure silencieux (boot + GET). Refuser plutôt que d’inventer 01/09.
5. Aligner POST sur `Années Académiques:CREATE` live.
6. Client Classes : envoyer `academicYearId` UUID.
7. Notes/examens : term/year **doivent** matcher `classes.academic_year_id`.
8. Décider overlap (refuser ou autoriser explicitement) — aujourd’hui : trou.
9. Définir la clôture (gel notes, inscriptions, classes, bulletins) puis API + gardes.
10. Finance : migrer TEXT → FK (PR séparée).

---

## 34. Plan de correction par PR (après STOP CTO)

| PR | Contenu | Dépend |
|---|---|---|
| **PR-AY-1** | UI Classes : plus de CREATE année ; empty-state + lien Paramètres ; inverser le test L211 | Verdict CTO |
| **PR-AY-2** | Paramètres : formulaire CREATE année (`POST /v2/academic-years`) + liste | PR-AY-1 ou parallèle API |
| **PR-AY-3** | RBAC : POST = `Années Académiques:CREATE` ; retirer `Gérer classes` du CREATE année | PR-AY-2 |
| **PR-AY-4** | Neutraliser `ensureCurrentAcademicYearForSchool` (plus d’INSERT à la lecture/boot) | Décision seed |
| **PR-AY-5** | PATCH année + close/archive + gardes métier | Contrat clôture CTO |
| **PR-AY-6** | Notes/examens/bulletins : year = FK classe ; interdire terme hors année | PR-AY-5 utile |
| **PR-AY-7** | Overlap + unique `is_current` DB ; `academicYearId` côté Classes | — |
| **PR-AY-8** | Mobile lecture/création Paramètres miroir | PR-AY-2 |
| **PR-AY-9** | Finance FK UUID (dette) | — |

Aucune de ces PR n’est commencée ici.

---

## 35. Verdict

**AUDIT COMPLET pour gouverner. NON GO correction tant que le CTO n’a pas tranché.**

Faits certifiés :

1. SoT années = PostgreSQL `academic_years`.
2. Paramètres ≠ CRUD année ; = périodes + barème.
3. Classes **crée** l’année (workaround UI sur API v2 réelle).
4. Auto-create silencieux boot/lecture avec calendrier septembre.
5. Pas d’API close/update/delete.
6. Gardes d’incohérence année **insuffisantes** (notes, examens, finance, présences).
7. Module RBAC « Années Académiques » **désaligné** du POST réel.

**STOP CTO.**  
PR **DRAFT**. Aucun Ready. Aucun merge.  
Avant toute correction : validation de ce rapport + DIFF GITHUB indépendant.
