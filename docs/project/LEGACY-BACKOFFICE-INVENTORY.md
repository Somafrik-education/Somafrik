# Inventaire legacy BackOffice — LOT 0

| | |
|--|--|
| **Nature** | Inventaire factuel uniquement (pas de correctifs) |
| **Base** | `develop` tip `bb3caf591316601ad335eac946e7bdd53ac17f78` |
| **Commit** | Merge PR #160 — matérialisation schools BO → PG |
| **Baseline préprod** | Hotfix établissements validé (Render `develop@bb3caf59` + création année scolaire puis classe) |
| **Périmètre** | Routes `/api/backoffice/*`, snapshot `backoffice_state`, consommateurs Web/Mobile, SoT PG vs dual/JSON |

---

## 1. Routes actives `/api/backoffice/*`

Source : `backend/server.js`. Permissions déclarées dans `backend/services/rbacService.js` (`routePermissions`) sauf mention contraire.

### 1.1 Auth

| Méthode | Path | Fichier:ligne | Permission / garde |
|---------|------|---------------|--------------------|
| POST | `/api/backoffice/login` | `backend/server.js:315` | Public + `loginRateLimiter` |
| POST | `/api/backoffice/e2e/clear-login-lockout` | `backend/server.js:266` | Environnement E2E uniquement (hors prod) |

### 1.2 State (snapshot JSON)

| Méthode | Path | Fichier:ligne | Permission / garde |
|---------|------|---------------|--------------------|
| GET | `/api/backoffice/state` | `backend/server.js:1328` | `requireAuth` + `assertBackOfficeReader` — **pas** de clé `routePermissions` |
| PUT | `/api/backoffice/state` | `backend/server.js:1334` | `requireAuth` + `assertBackOfficeWriter` + matrice `backend/lib/backOfficeWritableEntities.js` ; classes / schools / students / teachers / assignments / **Finance** / **Pédagogie** refusés via `legacy*StateWrite.js` |

### 1.3 Establishments / plateforme lecture

| Méthode | Path | Fichier:ligne | Permission (rbac) |
|---------|------|---------------|-------------------|
| GET | `/api/backoffice/countries` | `:1178` | `GET /api/backoffice/countries` |
| GET | `/api/backoffice/subscriptions` | `:1183` | `GET /api/backoffice/subscriptions` |
| GET | `/api/backoffice/notifications` | `:1188` | `GET /api/backoffice/notifications` |
| GET | `/api/backoffice/subscription-access` | `:1193` | `requireAuth` seul ; clé rbac listée mais **non branchée** sur la route |
| GET | `/api/backoffice/establishments` | `:1202` | `GET /api/backoffice/establishments` |
| GET | `/api/backoffice/establishments/:code` | `:1218` | `GET /api/backoffice/establishments/:code` |
| GET | `/api/backoffice/establishments/:code/users` | `:1208` | même clé `:code` |
| GET | `/api/backoffice/establishments/:code/subscription` | `:1213` | même clé `:code` |
| POST | `/api/backoffice/establishments` | `:1223` | `POST /api/backoffice/establishments` |
| PATCH | `/api/backoffice/establishments/:code` | `:1257` | `PATCH /api/backoffice/establishments/:code` |
| PATCH | `/api/backoffice/establishments/:code/activate` | `:1265` | même clé PATCH |
| PATCH | `/api/backoffice/establishments/:code/suspend` | `:1273` | même clé PATCH |
| DELETE | `/api/backoffice/establishments/:code` | `:1281` | `DELETE /api/backoffice/establishments/:code` |
| POST | `/api/backoffice/establishments/import` | `:1233` | `POST /api/backoffice/establishments/import` |

Écritures establishments → `saveEstablishmentState` → `repository.saveBackOfficeState` (JSON + side-effects §2.3).

### 1.4 Finance

| Méthode | Path | Fichier:ligne | Permission (rbac) |
|---------|------|---------------|-------------------|
| GET | `/api/backoffice/finance/unpaid` | `:1289` | `GET /api/backoffice/finance/unpaid` |
| GET | `/api/backoffice/finance/unpaid/:studentId` | `:1300` | même clé GET unpaid |
| GET | `/api/backoffice/finance/unpaid/:studentId/reminders` | `:1305` | même clé GET unpaid |
| POST | `/api/backoffice/finance/unpaid/:studentId/reminders` | `:1311` | `POST /api/backoffice/finance/unpaid/reminders` |

POST reminders persiste exclusivement en PostgreSQL (`payment_reminders`). Tables `payments` / `student_fee_obligations` / `payment_allocations` / `fee_grids` / `school_fee_items` / `fee_tariff_history` / `payment_statuses` sont la source de vérité. Aucun fallback JSON, aucun backfill des données historiques `backoffice_state`.

APIs Finance dédiées (hors `/api/backoffice/*`) : `GET/POST /api/payments`, `GET /api/payments/:id`, `POST /api/payments/:id/cancel`, `GET/POST/PATCH /api/finance/payment-statuses`, `GET/POST/PATCH /api/finance/fee-grids`, activate/deactivate/apply, `GET /api/finance/student-fees`, `POST .../adjust`.

### 1.5 Imports

| Méthode | Path | Fichier:ligne | Permission (rbac) |
|---------|------|---------------|-------------------|
| POST | `/api/backoffice/import/students/validate` | `:1249` | `POST /api/backoffice/import/students/validate` |

Validation seule (pas de persistance).

### 1.6 Other

| Méthode | Path | Fichier:ligne | Permission / garde |
|---------|------|---------------|--------------------|
| POST | `/api/backoffice/bulletin-design/preview` | `:1464` | `requireAuth` + Super Admin (`isSuperAdminPrincipal`) — hors `routePermissions` |

**Total :** 24 handlers `app.*(…/api/backoffice…)` dans `server.js`.

---

## 2. Lecteurs / écrivains de `backoffice_state`

Table : `backend/db/schema.sql` — PK `state_key`, payload JSONB.

### 2.1 Backend — API repository

| Symbole | Fichier | Rôle |
|---------|---------|------|
| `getBackOfficeState` | `backend/db/postgresRepository.js` | `SELECT state_payload … WHERE state_key = 'default'` |
| `saveBackOfficeState` | `postgresRepository.js` | Transaction + side-effects + UPSERT JSON |
| Fallback | `backend/db/fallbackRepository.js` | Moteur mémoire |
| Contrat | `backend/db/repositoryContract.js` | Méthodes obligatoires |

### 2.2 Backend — composition serveur

| Symbole | Fichier | Rôle |
|---------|---------|------|
| `getAuthoritativeBackOfficeState` | `server.js` | Runtime + stored + merge + sanitize ; peut réécrire si écoles orphelines |
| `saveEstablishmentState` | `server.js` | Enrichissement alertes → sanitize → hydrate abonnements → `saveBackOfficeState` |
| `sanitizeBackOfficeState` | `server.js` | Schéma snapshot (clés listées) |
| `mergeBackOfficeRuntimeState` | `server.js` | Fusion runtime PG/dataset ↔ JSON |
| `mergeScopedBackOfficeState` | `server.js` | Merge tenant sur PUT |
| `resolveTouchedBackOfficeKeys` | `server.js` | Clés touchées pour RBAC writer |
| `dedupeBackOfficeState` | `backend/lib/backofficeDedupe.js` | Dédup IDs |
| Matrice writable | `backend/lib/backOfficeWritableEntities.js` | Qui peut toucher quelles clés |
| Strip Finance | `backend/lib/legacyFinanceStateWrite.js` | Refuse toute présence des 7 clés Finance via PUT |

Autres appels `saveBackOfficeState` dans `server.js` : password/users, repair orphelins, bootstrap snapshot, fallback notes/présences mémoire.

### 2.3 Side-effects dans `saveBackOfficeState`

Ordre transactionnel :

1. **Schools** — pour chaque `payload.schools[]` → `ensureSchoolFromBackOfficeRecord` matérialise `schools` (+ `countries` si besoin). Introduit PR #160.
2. **Students** — retiré au LOT 2 : aucune synchronisation `students[]` déclenchée par PUT.
3. **Staff** — retiré au LOT 3 : aucune synchronisation `teachers[]` / `assignments[]` déclenchée par PUT.
4. **Notes** — `persistBackOfficeAfterNotesSync` → `syncNotesDomainFromBackOffice` → strip ACK.
5. **Persist JSON** — UPSERT `backoffice_state`, sans `students`, `teachers`, `assignments` ni clés Finance.
6. **Retour** — state relu + `syncAck`, projections élèves/enseignants/affectations/Finance fournies par le runtime PG.

### 2.4 HTTP GET / PUT `/state`

- **GET** — lecteur BO/web ; réponse scoped.
- **PUT** — strip classes / schools / students / teachers / assignments / **Finance** → writer matrix → validations → merge scoped → `saveEstablishmentState` → audit + `syncAck`.

### 2.5 Scripts ops touchant le snapshot

| Script | Action |
|--------|--------|
| `backend/scripts/dedupe-backoffice-state.js` | Dédup + rewrite |
| `repair-backoffice-state.js`, `repair-school-users-only.js`, `repair-school-subscriptions.js`, `repair-password-flags.js` | Réparations |
| `seed-test-data.js`, `seed-bulletin-data.js`, `seed-platform-bulk.js` | Seeds |
| `wipe-demo-data.js`, `trim-teachers.js`, `reset-school-planning.js` | Purges / trim |
| `sync-contacts-registry.js`, `backfill-validation-alerts.js` | Sync / backfill |
| Audits préprod enseignants | `cleanup-teacher-historical-preprod.js`, `audit-teacher-post-cleanup-full.js` |

---

## 3. Dépendances Web

### 3.1 Contextes & clients

| Composant | Fichier | Dépendance BO |
|-----------|---------|---------------|
| `AuthContext` | `web/src/context/AuthContext.tsx` | Login `POST /backoffice/login` ; probe `GET /backoffice/state` |
| `DataContext` | `web/src/context/DataContext.tsx` | **Hub** : `GET` refresh + `PUT` via `update()` + outbox |
| `establishmentsApi` | `web/src/lib/establishmentsApi.ts` | CRUD `/backoffice/establishments*` |
| `classesApi` | `web/src/lib/classesApi.ts` | `/api/classes` (PG) |
| `studentsApi` | `web/src/lib/studentsApi.ts` | `/api/students` (PG) |
| `classStudentsApi` | `web/src/lib/classStudentsApi.ts` | `/api/classes/:code/students` (PG) |
| `teachersApi` | `web/src/lib/teachersApi.ts` | `/api/teachers` (PG) |
| `financeApi` | `web/src/lib/financeApi.ts` | `/api/payments` + `/api/finance/*` (PG) |
| `academicYearsApi` | `web/src/lib/academicYearsApi.ts` | `/api/v2/academic-years` (PG) |

### 3.2 Pages déjà sur APIs PG

| Page | Route App | API |
|------|-----------|-----|
| `ClassesListPage` | `/etablissement/classes` | `classesApi` + `academicYearsApi` |
| `ClassStudentsPage` | `/etablissement/classes/:classCode/eleves` | enrollment PG |
| `StudentsListPage` | `/etablissement/eleves` | `studentsApi.list` (lecture) |
| `StudentWorkspacePage` | `/etablissement/eleves/:id…` | `studentsApi.get` |
| `TeachersListPage` | `/etablissement/enseignants` | `teachersApi` |
| `FinanceFeesPage` | `/etablissement/finances/frais` | `financeApi` (grilles PG) |
| `FinanceUnpaidPage` | `/etablissement/finances/impayes` | `financeApi` reminders + unpaid PG |
| `QuickPaymentModal` / `EntityPage` payments | paiements | `financeApi.createPayment` / `cancelPayment` |
| `SchoolsPage` / `EstablishmentProfilePage` | établissements | `establishmentsApi` (écrit encore le JSON via backend) |

`EntityPage` redirige `entity === "classes"` → `/etablissement/classes`.

### 3.3 Pages encore sur BO state (`useData` / `update` → PUT)

| Domaine | Pages / modules |
|---------|-----------------|
| Pédagogie JSON | `GradesEvaluationsPage`, `PresencesPage`, `CoursePlanningPage`, planning, `ConfigurationPage` |
| Plateforme / clients | `CountriesPage`, `UsersPage`, `PermissionsPage`, `NotificationsPage`, abonnements, `BulletinDesignPage`, settings |
| Relations / docs / comm | `ParentChildRelationsPage`, `EntityPage` relations/documents/messages/announcements/exams/bulletins |
| Shell | `OverviewPage`, `EtablissementOverviewPage`, `Topbar`, `GlobalSearch`, `ActiveSchoolContext` |

---

## 4. Dépendances Mobile

### 4.1 Sync

| Élément | Fichier | Comportement |
|---------|---------|--------------|
| `AdminDataContext` | `Mobile/src/context/AdminDataContext.tsx` | Source de données admin |
| `canSyncBackOfficeState` | AdminDataContext | Rôles admin/préfet/secrétaire → **GET/PUT** `/backoffice/state` |
| Autres rôles (enseignant…) | AdminDataContext | APIs granulaires (students/classes/notes/presences/…) |
| `getBackOfficeState` / `saveBackOfficeState` | `Mobile/src/services/api.ts` | Client HTTP |
| `persistSyncedState` | AdminDataContext | PUT après mutations entity / notes / présences / permissions |

`createItem("classes")` / `updateItem` / `deleteItem("classes")` sont no-op — aligné clôture classes.

### 4.2 Écrans consommateurs BO (via `useAdminData`)

| Écran | Usage |
|-------|-------|
| `AdminCrudScreen` | CRUD multi-entités → PUT (sauf classes/schools/students/teachers/assignments/**payments**) ; paiements via `createSchoolPayment` |
| `StudentsScreen` | Lecture ; création locale désactivée |
| `ClassesScreen` | Lecture + refresh state |
| `TeachersScreen`, `TeacherGradesScreen`, `TeacherAttendanceScreen` | Données BO / APIs selon rôle |
| `HomeScreen`, `MenuScreen`, `SchoolManagementScreen` | Agrégats |
| `PaymentsScreen`, `StudentPaymentsScreen` | lecture projection GET ; création via API dédiée |
| `MessagesScreen`, `AnnouncementsScreen`, `PlatformNotificationsScreen`, `PermissionsScreen` | écritures PUT |
| `TimetableScreen`, `ConfigurationScreen`, `ReportCardsScreen` | lecture |

Client legacy additionnel : `BackOffice/app.js` (SPA historique hors `web/`).

---

## 5. Déjà canonique PostgreSQL vs dual / JSON

### 5.1 SoT PostgreSQL (API métier dédiée)

| Domaine | Tables | API | Preuve / verify |
|---------|--------|-----|-----------------|
| Classes | `classes` (+ `academic_years`) | `GET/POST/PATCH /api/classes` | PUT `classes` **interdit** ; `verify:classes-legacy-cleanup` |
| Inscription élève | `students`, `enrollments` | `POST /api/classes/:classCode/students` | `verify:class-student-enrollment` |
| Fiche / liste élèves | `students`, `enrollments`, … | `GET/PATCH /api/students` | `verify:students-fiche-consolidation` |
| Enseignants | `teachers`, `users` | `GET/POST /api/teachers` | `verify:teacher-account-creation` |
| Affectations enseignants | `teacher_assignments` | `GET/POST/PATCH/DELETE /api/assignments` | `verify:teachers-assignments-legacy-cleanup` |
| Années scolaires | `academic_years` | `GET/POST /api/v2/academic-years` | Hotfix #160 + preuve préprod |
| Notes (écriture canonique) | `evaluations`, `grades` | `POST /api/notes` | D3.6b |
| Présences (écriture canonique) | `attendance` | `POST /api/presences` | D3.5b |
| Schools (CRUD) | `schools` (+ `profile_payload`) | `GET/POST/PATCH/DELETE /api/backoffice/establishments` | PUT `schools` **interdit** ; `verify:schools-legacy-cleanup` |
| Finance | `payments`, `student_fee_obligations`, `payment_allocations`, `payment_reminders`, `fee_grids`, `school_fee_items`, `fee_tariff_history`, `payment_statuses` | `/api/payments`, `/api/finance/*`, unpaid reminders | PUT Finance **interdit** ; `verify:finance-legacy-cleanup` + `verify:finance-management` |
| Examens | `exams`, `exam_results` | `/api/exams`, GET `/api/v2/exams`, GET planning-exams (projection) | PUT planning-exams **400 LEGACY_EXAMS_WRITE_FORBIDDEN** ; `verify:documents-exams-data` |
| Bulletins | `report_cards` (publication) ; notes = `grades` | `/api/report-cards` | PUT report-cards **400** |
| Templates bulletin | `report_card_templates` | `/api/report-card-templates` | layout JSONB de rendu uniquement |
| Documents établissement | `school_documents` | `/api/school-documents` | PUT establishment-documents **400** |

### 5.2 Dual (JSON encore writable + sync / projection)

| Domaine | État au tip develop |
|---------|---------------------|
| `students[]` dans PUT | **Projection lecture PG** ; toute présence dans PUT refusée (`LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN`) |
| `teachers[]` / `assignments[]` | **Projections lecture PG** ; toute présence dans PUT refusée (`LEGACY_*_STATE_WRITE_FORBIDDEN`) |
| Clés Finance (`payments`, `paymentStatuses`, `feeGrids`, `schoolFeeItems`, `studentFees`, `feeTariffHistory`, `paymentReminders`) | **Projections lecture PG** ; toute présence dans PUT refusée (`LEGACY_FINANCE_STATE_WRITE_FORBIDDEN`) ; jamais fusionnées avec l'ancien JSON |
| `classes[]` | **Projection lecture** dans GET state ; plus d’écriture PUT |
| `notes` / `evaluations` | PG SoT ; Web Notes UI encore via `DataContext.update` (PUT) |
| `presences` | PG SoT via POST ; PUT/Mobile peuvent encore pousser |
| `schools` / establishments API | **SoT PG** via `/backoffice/establishments*` ; PUT `schools` **interdit** ; projection lecture GET state |
| `academicConfigs` | Stocké dans JSON ; `/api/academic-config` ancré au snapshot |

### 5.3 Encore majoritairement JSON (`backoffice_state`)

`users`, `countries`, `contacts`, `relations`, `subscriptions` (+ offers/payments/invoices/discounts/audit), `notifications`, `courses`, `courseSchedules`, `announcements`, `messages`, `rolePermissions`, `dashboardChartConfig`, `deletedRows`.

`exams` / `bulletins` / `documents` : **plus de JSON résiduel SoT** (LOT 5). Overlay = projection PostgreSQL. PUT residual interdit.

---

## 6. Ordre de migration proposé (par lots / domaines)

Sans calendrier — dépendances techniques seulement.

| Lot | Domaine | Objectif de sortie du PUT state |
|-----|---------|--------------------------------|
| **0** | Inventaire (ce document) | Baseline partagée |
| **1** | **Schools / establishments** | ✅ API establishments = SoT PG ; PUT `schools` interdit |
| **2** | **Students** | ✅ PUT `students` interdit ; inscription + fiche + validation import sur projection APIs PG |
| **3** | **Teachers / assignments** | ✅ PUT `teachers`/`assignments` interdit ; CRUD affectations PG dédié |
| **4** | **Finance** | ✅ PUT clés Finance interdit ; APIs + tables PG SoT ; aucun backfill JSON historique ; lots 5–8 bloqués |
| **5** | **Pedagogy** | 🔒 Courses, schedules, exams, bulletins, documents, academicConfigs ; Notes/Présences UI 100 % APIs PG |
| **6** | **Platform** | 🔒 Countries, subscriptions, notifications, rolePermissions, dashboardChartConfig |
| **7** | **Clients / comptes** | Users, contacts, relations, messages, announcements |
| **8** | **Retrait PUT `/api/backoffice/state`** | Quand checklist §7 verte ; GET state peut rester temporairement en projection read-only |

Prérequis déjà amorcés : classes, enrollment, fiche élèves, teachers create, school materialize (#160).

---

## 7. Critères pour supprimer définitivement `PUT /api/backoffice/state`

Checklist **toutes** obligatoires :

1. **Aucun writer applicatif**
   - [ ] `web` : plus d’appel `api.put("/backoffice/state")` (`DataContext.update` retiré ou no-op)
   - [ ] `Mobile` : plus de `saveBackOfficeState` / `persistSyncedState`
   - [ ] `BackOffice/app.js` : plus de sync PUT
   - [ ] Scripts ops : plus d’UPSERT métier via state (seeds/repairs migrés ou gelés)

2. **Aucun consommateur d’écriture métier**
   - [ ] Matrice `backOfficeWritableEntities` vide ou route 410/404
   - [ ] Tests E2E / verify qui font PUT state mis à jour ou supprimés

3. **Chaque entité du sanitize a une API PG SoT**
   - [x] schools (LOT 1 — PUT retiré ; API establishments SoT PG)
   - [ ] users, contacts, relations
   - [x] countries, subscriptions*, notifications, rolePermissions, dashboardChartConfig (LOT 6 — APIs PG, PUT interdit)
   - [x] students (LOT 2 — inscription/fiche PG, projection state read-only)
   - [x] teachers, classes (déjà), assignments
   - [x] courses, courseSchedules, notes, presences, evaluations (LOT 5)
   - [x] payments*, fee*, reminders (LOT 4 — APIs PG, PUT interdit, pas de backfill JSON)

4. **Side-effects de `saveBackOfficeState` retirés ou inutiles**
   - [x] Plus de sync students déclenché par PUT
   - [x] Plus de sync staff déclenché par PUT
   - [ ] Plus de sync notes déclenché par PUT
   - [ ] Materialize schools uniquement depuis API establishments

5. **Projection JSON**
   - [ ] GET state soit retiré, soit strictement read-only dérivé de PG (pas de dual-write)
   - [x] `state.classes` / élèves ne sont plus source d’écriture
   - [x] `state.teachers` / `state.assignments` ne sont plus sources d’écriture
   - [x] `state` Finance (payments*, fee*, reminders) n’est plus source d’écriture
   - [x] `state` Plateforme (countries, subscriptions*, notifications, rolePermissions, dashboardChartConfig) n’est plus source d’écriture

6. **Vérifications vertes**
   - [ ] `verify:classes-legacy-cleanup`
   - [ ] `verify:schools-legacy-cleanup`
   - [ ] `verify:class-student-enrollment`
   - [ ] `verify:students-fiche-consolidation`
   - [ ] `verify:students-legacy-cleanup`
   - [ ] `verify:teacher-account-creation`
   - [ ] `verify:teachers-assignments-legacy-cleanup`
   - [ ] `verify:platform-legacy-cleanup`
   - [ ] `verify:platform-management`
   - [ ] RBAC state adaptés au retrait
   - [ ] `verify:runtime-bootstrap` + suite accès sans dépendance d’écriture state
   - [ ] Gates préprod domaines migrés

7. **Décision CTO**
   - [ ] ADR / CHANGELOG : PUT state deprecated → removed
   - [ ] Rollback documenté (feature flag ou restore lecture seule si besoin)

---

## 8. Annexes rapides

### Clés snapshot sanitizées (`sanitizeBackOfficeState`)

`schools`, `users`, `countries`, `contacts`, `relations`, `subscriptions`, `subscriptionOffers`, `subscriptionPayments`, `subscriptionInvoices`, `subscriptionDiscounts`, `subscriptionAuditLog`, `notifications`, `students`, `teachers`, `classes`, `courses`, `assignments`, `courseSchedules`, `payments`, `paymentStatuses`, `feeGrids`, `schoolFeeItems`, `studentFees`, `feeTariffHistory`, `paymentReminders`, `presences`, `notes`, `evaluations`, `exams`, `bulletins`, `documents`, `academicConfigs`, `announcements`, `messages`, `auditLog`, `rolePermissions`, `dashboardChartConfig`, `deletedRows`, `updatedAt`.

### Writable par rôle (extrait)

Source `backend/lib/backOfficeWritableEntities.js` — Admin School conserve notes, documents, etc. ; **pas** `classes`, `schools`, `students`, `teachers`, `assignments` ni clés Finance (bloqués avant merge, `LEGACY_FINANCE_STATE_WRITE_FORBIDDEN`). `auditLog` jamais writable client. Comptable n'a plus aucune clé PUT.

### APIs métier hors `/backoffice` déjà structurantes

`/api/classes*`, `/api/students*`, `/api/teachers*`, `/api/notes`, `/api/presences`, `/api/v2/academic-years`, `/api/academic-config`, `/api/v2/subjects`, `/api/assignments`, `/api/payments`, `/api/finance/*` — coexistent avec le snapshot. Lots 5–8 restent bloqués.

---

*LOT 0 inventaire, mis à jour LOT 6 — Plateforme PostgreSQL SoT. Aucun backfill des données historiques.*
