# E2E-PREPROD-GLOBAL-01 — Inventaire des fonctionnalités

Source : dépôt `develop@93f98e44` (inventaire statique, généré par script).

**Total : 347 routes API, 108 routes Web, 42 écrans Mobile, soit 497 entrées. 0 entrée non classée.**

Méthode :
- routes API : `app.<méthode>("/…")` dans `backend/server.js` ;
- permissions : table `backend/services/rbacService.js` ;
- routes Web : `path=` dans `web/src/App.tsx` ;
- écrans Mobile : `Stack.Screen` dans `Mobile/src/navigation/AppNavigator.tsx`.

Le classement par domaine (A à O du mandat) repose sur des mots-clés : il sert à l'organisation, pas à la sécurité. « RBAC — » signifie que la route n'a pas d'entrée dans la table RBAC : elle est alors publique, ou protégée seulement par `requireAuth` et des gardes propres (voir `SECURITE-RBAC-TENANT.md`).

| Domaine | API | Web | Mobile |
|---|---|---|---|
| A. Authentification et sécurité | 17 | 5 | 1 |
| B. Administration de la plateforme | 32 | 12 | 2 |
| C. Configuration des établissements | 49 | 16 | 7 |
| D. Utilisateurs et enseignants | 21 | 9 | 2 |
| E. Élèves et inscriptions | 22 | 6 | 4 |
| F. Présences | 4 | 2 | 2 |
| G. Cours et emploi du temps | 19 | 9 | 1 |
| H. Notes, évaluations et examens | 26 | 3 | 4 |
| I. Bulletins scolaires | 10 | 6 | 1 |
| J. Finances | 39 | 15 | 5 |
| K. Communication et notifications | 52 | 11 | 4 |
| L. Parents et élèves connectés | 8 | 2 | 1 |
| M. Tableaux de bord et rapports | 10 | 6 | 1 |
| N. Cartes élèves, QR et NFC | 27 | 0 | 2 |
| O. Fonctions transversales | 11 | 6 | 5 |

## A. Authentification et sécurité

**Web (5) :** `/confidentialite`, `/connexion`, `/mon-profil`, `/suppression-compte`, `securite`

**Mobile (1) :** `Login`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| POST | `/api/backoffice/e2e/clear-login-lockout` | — |
| POST | `/api/backoffice/login` | — |
| POST | `/api/identify` | — |
| POST | `/api/login` | — |
| POST | `/api/auth/refresh` | — |
| POST | `/api/auth/logout` | — |
| POST | `/api/auth/revoke-all` | — |
| POST | `/api/privacy/erasure-requests` | — |
| GET | `/api/privacy/erasure-requests` | Utilisateurs:READ, Gérer utilisateurs |
| POST | `/api/privacy/erasure-requests/self/execute` | — |
| POST | `/api/privacy/erasure-requests/:requestId/execute` | Utilisateurs:UPDATE, Gérer utilisateurs |
| GET | `/api/me/communication-preferences` | — |
| PUT | `/api/me/communication-preferences` | — |
| POST | `/api/auth/change-password` | — |
| POST | `/api/student-cards/:id/revoke` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/users/:id/reset-password` | Utilisateurs:UPDATE, Gérer utilisateurs, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/users/:userId/roles/revoke` | Utilisateurs:UPDATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |

## B. Administration de la plateforme

**Web (12) :** `/administration`, `/demande-essai`, `/etablissements`, `/pays`, `/permissions`, `/referentiels-pedagogiques`, `conformite`, `demandes-essai`, `etablissements`, `integrations`, `permissions`, `roles-droits`

**Mobile (2) :** `RoleSelection`, `SchoolAssignableRoles`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/auth/effective-permissions` | — |
| POST | `/api/public/trial-requests` | — |
| GET | `/api/backoffice/establishment-roles` | Rôles Établissement:READ, ALL_PRIVILEGES |
| POST | `/api/backoffice/establishment-roles` | Rôles Établissement:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/establishment-roles/:roleId` | Rôles Établissement:UPDATE, ALL_PRIVILEGES |
| POST | `/api/backoffice/establishment-roles/:roleId/archive` | Rôles Établissement:UPDATE, ALL_PRIVILEGES |
| GET | `/api/establishment-roles/assignable` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Utilisateurs:READ, Utilisateurs:UPDATE, Gérer utilisateurs, ALL_PRIVILEGES |
| GET | `/api/backoffice/countries` | Contrôler tous les pays, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/trial-requests` | ALL_PRIVILEGES |
| GET | `/api/backoffice/platform-compliance` | ALL_PRIVILEGES |
| POST | `/api/backoffice/countries` | Contrôler tous les pays, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/countries/:code` | Contrôler tous les pays, ALL_PRIVILEGES |
| GET | `/api/backoffice/role-permissions` | ALL_PRIVILEGES |
| PUT | `/api/backoffice/role-permissions` | ALL_PRIVILEGES |
| GET | `/api/backoffice/rbac/catalog` | ALL_PRIVILEGES |
| GET | `/api/backoffice/rbac/permissions` | ALL_PRIVILEGES |
| GET | `/api/backoffice/rbac/permissions/effective` | ALL_PRIVILEGES |
| PATCH | `/api/backoffice/rbac/permissions` | ALL_PRIVILEGES |
| POST | `/api/backoffice/rbac/permissions/reset` | ALL_PRIVILEGES |
| POST | `/api/backoffice/rbac/roles` | ALL_PRIVILEGES, Rôles Établissement:CREATE |
| PATCH | `/api/backoffice/rbac/roles/:roleId` | ALL_PRIVILEGES, Rôles Établissement:UPDATE |
| GET | `/api/backoffice/rbac/role-display-labels` | ALL_PRIVILEGES, COUNTRY_PRIVILEGES, Utilisateurs:READ, Gérer utilisateurs, Rôles Établissement:READ |
| PATCH | `/api/backoffice/rbac/roles/:roleId/display-label` | ALL_PRIVILEGES |
| POST | `/api/backoffice/rbac/roles/:roleId/display-label/reset` | ALL_PRIVILEGES |
| POST | `/api/backoffice/rbac/roles/:roleId/archive` | ALL_PRIVILEGES, Rôles Établissement:UPDATE |
| GET | `/api/backoffice/rbac/history` | ALL_PRIVILEGES |
| GET | `/api/backoffice/establishments` | Établissements:READ, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/establishments/:code` | Établissements:READ, Paramètres Établissement:READ, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/establishments` | Établissements:CREATE, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/establishments/:code` | Établissements:UPDATE, Paramètres Établissement:UPDATE, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| DELETE | `/api/backoffice/establishments/:code` | Établissements:DELETE, ALL_PRIVILEGES |
| GET | `/api/audit` | Audit:READ |

## C. Configuration des établissements

**Web (16) :** `/bienvenue-etablissement`, `/classes`, `/configuration`, `/etablissement`, `/matieres`, `/parametres`, `/parametres-graphiques`, `annee-scolaire`, `apparence`, `bulletins-configuration`, `classes`, `configuration-etablissement`, `etablissement`, `matieres`, `profil`, `structure`

**Mobile (7) :** `Classes`, `Configuration`, `EstablishmentProfile`, `SchoolManagement`, `SchoolPedagogicalStructure`, `SchoolSetup`, `SchoolYearSettings`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/schools/:code` | — |
| GET | `/api/schools/:code/logo` | — |
| GET | `/api/classes` | Classes:READ, Voir classes, Gérer classes, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/mobile-sync/l1/classes` | Classes:READ, Voir classes, Gérer classes, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/classes` | Classes:CREATE, Gérer classes, ALL_PRIVILEGES |
| PATCH | `/api/classes/:classCode` | Classes:UPDATE, Gérer classes, ALL_PRIVILEGES |
| GET | `/api/academic-config` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Référentiels pédagogiques:READ, Classes:READ, Voir classes, Gérer classes, Gérer planning académique, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/establishments/:schoolCode/academic-config` | Gérer planning académique, Gérer classes, Paramètres Établissement:READ, Paramètres Établissement:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PUT | `/api/backoffice/establishments/:schoolCode/academic-config` | Gérer planning académique, Gérer classes, Paramètres Établissement:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PUT | `/api/academic-config` | Gérer planning académique, Gérer classes, Paramètres Établissement:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/school-settings` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer planning académique, Gérer classes, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/school-settings` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| PUT | `/api/academic-periods` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| GET | `/api/backoffice/establishments/:schoolCode/school-settings` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/establishments/:schoolCode/school-settings` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| PUT | `/api/backoffice/establishments/:schoolCode/academic-periods` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| GET | `/api/backoffice/education-levels` | Référentiels pédagogiques:READ, Contrôler tous les pays, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/education-levels` | Référentiels pédagogiques:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/education-levels/:levelId` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| POST | `/api/backoffice/education-levels/:levelId/archive` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| GET | `/api/backoffice/education-streams` | Référentiels pédagogiques:READ, Contrôler tous les pays, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/education-streams` | Référentiels pédagogiques:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/education-streams/:streamId` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| POST | `/api/backoffice/education-streams/:streamId/archive` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| GET | `/api/backoffice/education-class-groups` | Référentiels pédagogiques:READ, Contrôler tous les pays, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/education-class-groups` | Référentiels pédagogiques:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/education-class-groups/:groupId` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| POST | `/api/backoffice/education-class-groups/:groupId/archive` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/education-reference/labels` | Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| GET | `/api/education-reference/catalog` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer classes, Gérer planning académique, Référentiels pédagogiques:READ, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PUT | `/api/education-reference/school-activation` | Paramètres Établissement:UPDATE, Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| GET | `/api/backoffice/establishments/:schoolCode/education-reference/catalog` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer classes, Référentiels pédagogiques:READ, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PUT | `/api/backoffice/establishments/:schoolCode/education-reference/school-activation` | Paramètres Établissement:UPDATE, Référentiels pédagogiques:UPDATE, ALL_PRIVILEGES |
| GET | `/api/backoffice/establishment-documents` | Documents:READ, Valider bulletins, Voir rapports, Gérer élèves, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PUT | `/api/backoffice/establishment-documents` | Documents:CREATE, Documents:UPDATE, Gérer élèves, Valider bulletins, ALL_PRIVILEGES |
| PUT | `/api/backoffice/establishments/:code/logo` | Établissements:UPDATE, Paramètres Établissement:UPDATE, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| DELETE | `/api/backoffice/establishments/:code/logo` | Établissements:UPDATE, Paramètres Établissement:UPDATE, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/establishments/:code/activate` | — |
| PATCH | `/api/backoffice/establishments/:code/suspend` | — |
| GET | `/api/v2/subjects` | Matières:READ, Affectations:READ, Affectations:CREATE, Classes:READ, Gérer cours, Voir classes, Modifier notes, Organiser examens, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/v2/subjects` | Matières:CREATE, Gérer cours, ALL_PRIVILEGES |
| DELETE | `/api/v2/subjects/:code` | Matières:DELETE, Gérer cours, ALL_PRIVILEGES |
| GET | `/api/v2/school-setup/status` | Paramètres Établissement:READ |
| GET | `/api/v2/school-setup/guided` | Paramètres Établissement:READ |
| POST | `/api/v2/school-setup/guided/steps/:stepKey/complete` | Paramètres Établissement:UPDATE |
| POST | `/api/v2/school-setup/guided/complete` | Paramètres Établissement:UPDATE |
| GET | `/api/v2/academic-years` | Années Académiques:READ, ALL_PRIVILEGES |
| POST | `/api/v2/academic-years` | Années Académiques:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/v2/academic-years/:id` | Années Académiques:UPDATE, ALL_PRIVILEGES |

## D. Utilisateurs et enseignants

**Web (9) :** `/affectations`, `/configuration/enseignants`, `/configuration/utilisateurs`, `/enseignants`, `/utilisateurs`, `affectations`, `comptes-utilisateurs`, `enseignants`, `utilisateurs`

**Mobile (2) :** `Teachers`, `Users`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/mobile-sync/l1/assignments` | Affectations:READ, Enseignants:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/classes/:classCode/head-teacher/candidates` | Classes:UPDATE, Gérer classes, Affectations:CREATE, Affectations:UPDATE, Gérer affectations, ALL_PRIVILEGES |
| PUT | `/api/classes/:classCode/head-teacher` | Classes:UPDATE, Gérer classes, Affectations:CREATE, Affectations:UPDATE, Gérer affectations, ALL_PRIVILEGES |
| DELETE | `/api/classes/:classCode/head-teacher` | Classes:UPDATE, Gérer classes, Affectations:CREATE, Affectations:UPDATE, Gérer affectations, ALL_PRIVILEGES |
| GET | `/api/assignments` | Affectations:READ, Enseignants:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/assignments` | Affectations:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/assignments/:assignmentId` | Affectations:UPDATE, ALL_PRIVILEGES |
| DELETE | `/api/assignments/:assignmentId` | Affectations:DELETE, ALL_PRIVILEGES |
| GET | `/api/teachers` | Enseignants:READ, Voir enseignants, Gérer enseignants, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/teachers/:teacherCode` | Enseignants:READ, Voir enseignants, Gérer enseignants, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/teachers` | Enseignants:CREATE, Gérer enseignants, ALL_PRIVILEGES |
| PATCH | `/api/teachers/:teacherCode` | Enseignants:UPDATE, Gérer enseignants, ALL_PRIVILEGES |
| DELETE | `/api/teachers/:teacherCode` | Enseignants:DELETE, Gérer enseignants, ALL_PRIVILEGES |
| GET | `/api/backoffice/users` | Utilisateurs:READ, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/users/assignable-roles` | Utilisateurs:READ, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/users` | Utilisateurs:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/users/provision` | Utilisateurs:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/users/create-teacher` | Utilisateurs:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/users/:userId` | Utilisateurs:UPDATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/users/:userId/reassign-school` | Utilisateurs:UPDATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/users/:userId/roles/grant` | Utilisateurs:UPDATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |

## E. Élèves et inscriptions

**Web (6) :** `/configuration/eleves`, `/eleves`, `classes/:classCode/eleves`, `eleves`, `eleves/:studentId`, `eleves/:studentId/:section`

**Mobile (4) :** `Schooling`, `StudentDetail`, `Students`, `TeacherStudents`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/mobile-sync/l1/students` | Élèves:READ, Voir élèves, Gérer élèves, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/classes/:classCode/students` | Élèves:READ, Voir élèves, Gérer élèves, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/classes/:classCode/students` | Élèves:CREATE, Gérer élèves, ALL_PRIVILEGES |
| GET | `/api/students` | Élèves:READ, Voir élèves, Gérer élèves, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/students/:studentId/documents` | — |
| POST | `/api/students/:studentId/documents` | — |
| POST | `/api/students/:studentId/documents/:documentId/archive` | — |
| GET | `/api/students/:studentId/documents/:documentId/file` | — |
| GET | `/api/students/:studentId/photo` | — |
| GET | `/api/students/:id` | Élèves:READ, Voir élèves, Gérer élèves, Voir enfant, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/students/:id/cards` | Élèves:READ, Voir élèves |
| GET | `/api/students/:studentId/enrollments` | Élèves:READ, Voir élèves, Gérer élèves, Voir enfant, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/students/:studentId/enrollments/:enrollmentId/validate` | Élèves:UPDATE, Gérer élèves, ALL_PRIVILEGES |
| POST | `/api/students/:studentId/enrollments/:enrollmentId/assign-class` | Élèves:UPDATE, Gérer élèves, ALL_PRIVILEGES |
| POST | `/api/students/:studentId/enrollments/:enrollmentId/transfer` | Élèves:UPDATE, Gérer élèves, ALL_PRIVILEGES |
| POST | `/api/students/:studentId/enrollments/:enrollmentId/close` | Élèves:UPDATE, Gérer élèves, ALL_PRIVILEGES |
| PATCH | `/api/students/:id` | Élèves:UPDATE, Gérer élèves, ALL_PRIVILEGES |
| DELETE | `/api/students/:id` | Élèves:DELETE, Gérer élèves, ALL_PRIVILEGES |
| GET | `/api/students/:id/report` | Élèves:READ, Notes:READ, Bulletins:READ, Voir bulletins, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/students/:id/report.pdf` | Élèves:READ, Notes:READ, Bulletins:READ, Voir bulletins, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/establishments/import` | Établissements:CREATE, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/import/students/validate` | Élèves:CREATE, Gérer élèves, Gérer établissements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |

## F. Présences

**Web (2) :** `/presences`, `retards`

**Mobile (2) :** `StudentPresences`, `TeacherAttendance`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/presences` | Présences:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/presences` | Présences:CREATE, Présences:UPDATE, ALL_PRIVILEGES |
| GET | `/api/students/:id/presences` | Présences:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/v2/presences` | — |

## G. Cours et emploi du temps

**Web (9) :** `/planning`, `calendrier`, `conflits`, `emploi-du-temps`, `par-classe`, `par-enseignant`, `par-salle`, `remplacements`, `salles`

**Mobile (1) :** `Timetable`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/mobile-sync/l1/school-courses` | Matières:READ, Gérer cours, Voir classes, ALL_PRIVILEGES |
| GET | `/api/mobile-sync/l1/course-schedules` | Planning de cours:READ, ALL_PRIVILEGES |
| GET | `/api/courses` | — |
| GET | `/api/course-schedules` | Planning de cours:READ, ALL_PRIVILEGES |
| POST | `/api/courses` | — |
| PATCH | `/api/courses/:courseId` | — |
| DELETE | `/api/courses/:courseId` | — |
| POST | `/api/course-schedules` | Planning de cours:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/course-schedules/:scheduleId` | Planning de cours:UPDATE, ALL_PRIVILEGES |
| DELETE | `/api/course-schedules/:scheduleId` | Planning de cours:DELETE, ALL_PRIVILEGES |
| GET | `/api/school-rooms` | Salles:READ, ALL_PRIVILEGES |
| POST | `/api/school-rooms` | Salles:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/school-rooms/:roomId` | Salles:UPDATE, ALL_PRIVILEGES |
| DELETE | `/api/school-rooms/:roomId` | Salles:DELETE, ALL_PRIVILEGES |
| GET | `/api/course-schedule-replacements/options` | Remplacements:CREATE, ALL_PRIVILEGES |
| GET | `/api/course-schedule-replacements` | Remplacements:READ, ALL_PRIVILEGES |
| POST | `/api/course-schedule-replacements` | Remplacements:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/course-schedule-replacements/:replacementId` | Remplacements:UPDATE, ALL_PRIVILEGES |
| DELETE | `/api/course-schedule-replacements/:replacementId` | Remplacements:DELETE, ALL_PRIVILEGES |

## H. Notes, évaluations et examens

**Web (3) :** `/examens`, `/marketplace`, `/notes`

**Mobile (4) :** `ClassGradesStats`, `Exams`, `StudentNotes`, `TeacherGrades`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/debug/notes-authz-trace` | — |
| GET | `/api/evaluations` | Notes:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/evaluations` | Notes:CREATE, ALL_PRIVILEGES |
| PATCH | `/api/evaluations/:evaluationId` | Notes:UPDATE, ALL_PRIVILEGES |
| GET | `/api/evaluation-types` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer planning académique, Gérer classes, Notes:READ, Notes:CREATE, Notes:UPDATE, Modifier notes, Voir notes, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/evaluation-types` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| PATCH | `/api/evaluation-types/:typeId` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| POST | `/api/evaluation-types/:typeId/archive` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| GET | `/api/backoffice/establishments/:schoolCode/evaluation-types` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer planning académique, Référentiels pédagogiques:READ, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/establishments/:schoolCode/evaluation-types` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/establishments/:schoolCode/evaluation-types/:typeId` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| POST | `/api/backoffice/establishments/:schoolCode/evaluation-types/:typeId/archive` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| GET | `/api/exams` | Examens:READ, Valider examens, Organiser examens, Gérer cours, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/exams` | Organiser examens, Valider examens, Examens:CREATE, Examens:UPDATE, ALL_PRIVILEGES |
| GET | `/api/exams/:examId` | Examens:READ, Valider examens, Organiser examens, Gérer cours, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/exams/:examId` | Organiser examens, Valider examens, Examens:UPDATE, ALL_PRIVILEGES |
| POST | `/api/exams/:examId/validate` | Valider examens, Examens:UPDATE, ALL_PRIVILEGES |
| POST | `/api/exams/:examId/cancel` | Organiser examens, Valider examens, Examens:UPDATE, ALL_PRIVILEGES |
| POST | `/api/exams/:examId/archive` | Organiser examens, Valider examens, Examens:UPDATE, Examens:DELETE, ALL_PRIVILEGES |
| GET | `/api/backoffice/planning-exams` | Examens:READ, Valider examens, Organiser examens, Gérer planning académique, Gérer cours, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PUT | `/api/backoffice/planning-exams` | Organiser examens, Valider examens, Examens:CREATE, Examens:UPDATE, Gérer planning académique, Gérer cours, ALL_PRIVILEGES |
| GET | `/api/students/:id/notes` | Notes:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/notes` | Notes:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/notes` | Notes:CREATE, Notes:UPDATE, ALL_PRIVILEGES |
| GET | `/api/v2/exams` | Examens:READ, Valider examens, Organiser examens, Gérer cours, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/v2/notes` | — |

## I. Bulletins scolaires

**Web (6) :** `/bulletins`, `/bulletins/gestion`, `/bulletins/historique`, `/bulletins/modele`, `/conception-bulletins`, `bulletins-catalogue`

**Mobile (1) :** `ReportCards`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/report-cards` | Bulletins:READ, Valider bulletins, Voir rapports, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/report-cards/generate` | Bulletins:UPDATE, Valider bulletins, ALL_PRIVILEGES |
| POST | `/api/report-cards/:cardId/publish` | Bulletins:UPDATE, Valider bulletins, ALL_PRIVILEGES |
| POST | `/api/report-cards/:cardId/archive` | Bulletins:UPDATE, Valider bulletins, ALL_PRIVILEGES |
| GET | `/api/report-card-templates` | Documents:READ, Valider bulletins, Conception bulletins, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PUT | `/api/report-card-templates` | Documents:UPDATE, Conception bulletins, ALL_PRIVILEGES |
| POST | `/api/report-card-templates/:templateId/archive` | Documents:UPDATE, Conception bulletins, ALL_PRIVILEGES |
| GET | `/api/backoffice/report-cards` | Bulletins:READ, Valider bulletins, Gérer planning académique, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PUT | `/api/backoffice/report-cards` | Valider bulletins, Bulletins:CREATE, Bulletins:UPDATE, Gérer planning académique, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/bulletin-design/preview` | — |

## J. Finances

**Web (15) :** `/abonnements`, `/finances`, `/paiements`, `abonnements`, `changer-offre`, `factures`, `finances`, `frais`, `impayes`, `mon-abonnement`, `offres`, `paiements`, `remises`, `resiliation`, `tarifs-pays`

**Mobile (5) :** `FeeGrids`, `MobilePayment`, `Payments`, `StudentPayments`, `Unpaid`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/students/:id/payments` | Paiements:READ, Gérer paiements, Voir paiements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/payments` | Paiements:READ, Gérer paiements, Voir paiements, Voir rapports financiers, Suivre abonnements pays, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/payments` | Paiements:CREATE, Paiements:UPDATE, Gérer paiements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/payments/:paymentId` | Paiements:READ, Gérer paiements, Voir paiements, Voir rapports financiers, Suivre abonnements pays, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/payments/:paymentId/cancel` | Paiements:UPDATE, Gérer paiements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/finance/payment-student-options` | Paiements:READ, Gérer paiements, Voir paiements, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/finance/catalog` | Paiements:READ, Gérer paiements, Voir paiements, Frais & tarifs:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/finance/payment-methods` | Paiements:READ, Gérer paiements, Voir paiements, Frais & tarifs:READ, Paramètres Établissement:READ, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PUT | `/api/finance/payment-methods` | Frais & tarifs:UPDATE, Paramètres Établissement:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/finance/payment-statuses` | Paiements:READ, Gérer paiements, Voir paiements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/finance/payment-statuses` | Paiements:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/finance/payment-statuses/:statusId` | Paiements:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/finance/fee-grids` | Frais & tarifs:READ, Paiements:READ, Impayés:READ, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/finance/fee-grids` | Frais & tarifs:CREATE, Frais & tarifs:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/finance/fee-grids/:gridId` | — |
| PATCH | `/api/finance/fee-grids/:gridId` | Frais & tarifs:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/finance/fee-grids/:gridId/activate` | Frais & tarifs:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/finance/fee-grids/:gridId/deactivate` | Frais & tarifs:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/finance/fee-grids/:gridId/apply` | Frais & tarifs:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/finance/student-fees` | Impayés:READ, Paiements:READ, Frais & tarifs:READ, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/finance/reconcile-payment-allocations` | Paiements:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/finance/student-fees/:obligationId` | — |
| POST | `/api/finance/student-fees/:obligationId/adjust` | Paiements:UPDATE, Frais & tarifs:UPDATE, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/subscriptions` | Gérer abonnements, Suivre abonnements pays, ALL_PRIVILEGES |
| POST | `/api/backoffice/subscriptions` | Gérer abonnements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/subscriptions/:subscriptionId` | Gérer abonnements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/subscription-offers` | Gérer abonnements, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/subscription-offers/:offerId` | Gérer abonnements, ALL_PRIVILEGES |
| POST | `/api/backoffice/subscription-payments` | Gérer abonnements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/subscription-payments/:paymentId` | Gérer abonnements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/subscription-discounts` | Gérer abonnements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/subscription-discounts/:discountId` | Gérer abonnements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/subscription-access` | ALL_PRIVILEGES, COUNTRY_PRIVILEGES, Paramètres Établissement:READ |
| GET | `/api/backoffice/establishments/:code/subscription` | — |
| GET | `/api/backoffice/finance/unpaid` | Impayés:READ, Paiements:READ, Frais & tarifs:READ, Gérer paiements, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/finance/unpaid/:studentId` | — |
| GET | `/api/backoffice/finance/unpaid/:studentId/reminders` | — |
| POST | `/api/backoffice/finance/unpaid/:studentId/reminders` | — |
| GET | `/api/v2/payments` | — |

## K. Communication et notifications

**Web (11) :** `/administration/contacts`, `/annonces`, `/communication`, `/communication/annonces`, `/communication/messages`, `/contacts`, `/messages`, `/notifications`, `/notifications-plateforme`, `contacts`, `notifications`

**Mobile (4) :** `Announcements`, `InternalNotifications`, `Messages`, `SchoolNotificationSettings`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| POST | `/api/mobile/push-devices` | — |
| DELETE | `/api/mobile/push-devices/current` | — |
| POST | `/api/mobile/push-devices/test` | Push:TEST, ALL_PRIVILEGES |
| GET | `/api/backoffice/establishments/:schoolCode/notification-settings` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/establishments/:schoolCode/notification-settings` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| PUT | `/api/backoffice/establishments/:schoolCode/notification-settings` | Paramètres Établissement:UPDATE, Gérer planning académique, ALL_PRIVILEGES |
| GET | `/api/backoffice/notifications` | ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/notifications` | ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/notifications/:notificationId` | ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/contacts` | Contacts:READ, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/contacts` | Contacts:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/contacts/:contactId` | Contacts:UPDATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/contacts/:contactId/provision-account` | Contacts:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/messages/unread-count` | Messages:READ, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/messages/recipients` | Messages:CREATE, ...MESSAGE_WRITE_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/messages/:messageId` | Messages:READ, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/messages` | Messages:READ, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/messages` | Messages:CREATE, ...MESSAGE_WRITE_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/messages/:messageId/read` | Messages:UPDATE, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/conversations` | Messages:READ, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/conversations` | Messages:CREATE, ...MESSAGE_WRITE_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/conversations/:conversationId` | Messages:READ, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/conversations/:conversationId/messages` | Messages:READ, ...MESSAGE_READ_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/conversations/:conversationId/messages` | Messages:CREATE, ...MESSAGE_WRITE_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/communications/attachments` | Messages:CREATE, ...MESSAGE_WRITE_ALIASES, Gérer messages, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/communications/attachments/:attachmentId` | Messages:READ, Announcements:READ, ...MESSAGE_READ_ALIASES, Gérer messages, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/announcements/unread-count` | Announcements:READ, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/announcements/audience-options` | Announcements:CREATE, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/announcements` | Announcements:READ, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/announcements` | Announcements:CREATE, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/announcements/attachments` | Announcements:CREATE, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/announcements/:announcementId` | Announcements:READ, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/announcements/:announcementId/read` | Announcements:READ, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/announcements/:announcementId` | Announcements:UPDATE, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/announcements/:announcementId/archive` | Announcements:UPDATE, Gérer annonces, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/backoffice/platform-announcements/unread-count` | Announcements:READ, Gérer annonces, ALL_PRIVILEGES |
| GET | `/api/backoffice/platform-announcements` | Announcements:READ, Gérer annonces, ALL_PRIVILEGES |
| POST | `/api/backoffice/platform-announcements` | ALL_PRIVILEGES |
| POST | `/api/backoffice/platform-announcements/attachments` | ALL_PRIVILEGES |
| GET | `/api/backoffice/platform-announcements/attachments/:attachmentId` | Announcements:READ, Gérer annonces, ALL_PRIVILEGES |
| GET | `/api/backoffice/platform-announcements/:announcementId` | Announcements:READ, Gérer annonces, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/platform-announcements/:announcementId/read` | Announcements:READ, Gérer annonces, ALL_PRIVILEGES |
| POST | `/api/backoffice/platform-announcements/:announcementId/archive` | ALL_PRIVILEGES |
| GET | `/api/backoffice/internal-notifications/unread-count` | Notifications:READ, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/communications/deliveries/health` | Notifications:READ, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/internal-notifications` | Notifications:READ, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/internal-notifications` | Notifications:CREATE, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| POST | `/api/backoffice/internal-notifications/attachments` | Notifications:CREATE, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/internal-notifications/attachments/:attachmentId` | Notifications:READ, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| GET | `/api/backoffice/internal-notifications/:notificationId` | Notifications:READ, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/internal-notifications/:notificationId/read` | Notifications:READ, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |
| PATCH | `/api/backoffice/internal-notifications/:notificationId/archive` | Notifications:READ, Gérer notifications, ALL_PRIVILEGES, COUNTRY_PRIVILEGES |

## L. Parents et élèves connectés

**Web (2) :** `relations`, `relations-parent-enfant`

**Mobile (1) :** `ParentProfile`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/backoffice/relations` | Relations:READ, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/relations` | Relations:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/backoffice/relations/:relationId` | Relations:UPDATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/backoffice/relations/:relationId/archive` | Relations:UPDATE, Relations:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/parents/identity` | Relations:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/parents/relations` | Relations:READ, Élèves:READ, Voir élèves, Voir enfant, Gérer élèves, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/parents/link` | Relations:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| PATCH | `/api/parents/relations/:relationId` | Relations:UPDATE, Relations:CREATE, Gérer utilisateurs, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |

## M. Tableaux de bord et rapports

**Web (6) :** `/rapports`, `/tableau-de-bord`, `graphiques`, `pilotage`, `rapports`, `vue-ensemble`

**Mobile (1) :** `Home`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/dashboard/school-activities` | — |
| GET | `/api/dashboard/school-kpis` | — |
| GET | `/api/backoffice/dashboard-chart-config` | ALL_PRIVILEGES |
| PUT | `/api/backoffice/dashboard-chart-config` | ALL_PRIVILEGES |
| GET | `/api/backoffice/state` | — |
| PUT | `/api/backoffice/state` | — |
| GET | `/api/v2/reports/advanced` | Rapports:READ, Voir rapports globaux, Voir rapports pays, Voir rapports, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| GET | `/api/mvp/readiness` | — |
| GET | `/api/mvp/snapshot` | — |
| GET | `/api/mvp/dashboard` | — |

## N. Cartes élèves, QR et NFC

**Web (0) :** —

**Mobile (2) :** `EntryControl`, `NfcDiagnosis`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/api/classes/:classCode/student-cards/preflight` | — |
| POST | `/api/classes/:classCode/student-cards/batches` | Élèves:UPDATE, Gérer élèves |
| GET | `/api/classes/:classCode/student-cards/batches/:batchId` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/classes/:classCode/student-cards/batches/:batchId/receipt` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/classes/:classCode/student-cards/batches/:batchId/activate` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/classes/:classCode/student-cards/batches/:batchId/abort` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/student-cards` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/student-cards/:id/nfc-retry` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/student-cards/:id/nfc-reencode` | — |
| POST | `/api/student-cards/:id/nfc-recover` | — |
| POST | `/api/student-cards/nfc-diagnose` | — |
| POST | `/api/student-cards/:id/nfc-provision` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/student-cards/:id/nfc-provision/confirm` | — |
| POST | `/api/student-cards/:id/nfc-confirm` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/student-cards/:id/lost` | Élèves:UPDATE, Gérer élèves |
| GET | `/api/student-cards/capabilities` | Présences:CREATE, Présences:UPDATE, Présences — Effectuer l'appel (NFC/QR):CREATE |
| POST | `/api/student-cards/scan` | Présences:CREATE, Présences:UPDATE |
| POST | `/api/student-cards/:id/replace` | Élèves:UPDATE, Gérer élèves |
| POST | `/api/student-cards/roll-call/scan` | Présences:CREATE, Présences:UPDATE |
| GET | `/api/student-cards/roll-call/roster` | Présences:CREATE, Présences:UPDATE |
| POST | `/api/student-cards/roll-call/validate` | Présences:CREATE, Présences:UPDATE |
| GET | `/api/student-cards/roll-call/overview` | Présences:READ |
| GET | `/api/student-cards/roll-call/offline/v1/pack` | Présences — Effectuer l'appel (NFC/QR):CREATE |
| GET | `/api/student-cards/roll-call/offline/v1/classes` | Présences — Effectuer l'appel (NFC/QR):CREATE |
| POST | `/api/student-cards/roll-call/offline/v1/sync` | Présences — Effectuer l'appel (NFC/QR):CREATE |
| POST | `/api/student-cards/entry-scan` | Contrôle d'entrée:CREATE |
| GET | `/api/student-cards/entries` | Contrôle d'entrée:READ |

## O. Fonctions transversales

**Web (6) :** `*`, `/`, `/documents`, `/verify/rc/:capability`, `documents`, `donnees`

**Mobile (5) :** `OfflineMode`, `SchoolSetupWelcome`, `Support`, `Synchronization`, `Welcome`

| Méthode | Route API | Permissions RBAC |
|---|---|---|
| GET | `/web/` | — |
| GET | `/` | — |
| GET | `/api/health` | — |
| GET | `/api/data-export` | Paramètres Établissement:READ, Paramètres Établissement:UPDATE |
| GET | `/api/school-documents` | Documents:READ, Valider bulletins, Voir rapports, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
| POST | `/api/school-documents` | Documents:CREATE, Documents:UPDATE, ALL_PRIVILEGES |
| PATCH | `/api/school-documents/:documentId` | Documents:UPDATE, ALL_PRIVILEGES |
| POST | `/api/school-documents/:documentId/archive` | Documents:UPDATE, ALL_PRIVILEGES |
| POST | `/api/students/:studentId/documents/:documentId/verify` | — |
| POST | `/api/student-cards/verify` | Élèves:READ, Voir élèves, Gérer élèves, Présences:CREATE, Présences:UPDATE |
| GET | `/api/v2/documents` | Documents:READ, Valider bulletins, Voir rapports, Gérer élèves, COUNTRY_PRIVILEGES, ALL_PRIVILEGES |
