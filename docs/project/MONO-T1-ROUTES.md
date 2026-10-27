# MONO-T1 — inventaire des routes HTTP (généré)

Généré par `node scripts/mono-t1-route-inventory.js` ; le contrat des routes est vérifié en CI par `--check`. Ne pas éditer à la main.

Routes réellement enregistrées : **371** (relevé runtime d'Express, pas une recherche textuelle).

Tous les routes authentifiées (hors expression régulière) sont aussi couvertes par les balayages A de `backend/lib/monoT1.authSessions.http.pg.test.js` (anonyme, en-tête invalide, signature étrangère, jeton expiré, session inconnue ⇒ 401 sans donnée) ; la matrice RBAC observée (`backend/lib/monoT1.rbacMatrix.http.pg.test.js`, référence `docs/project/MONO-T1-RBAC-MATRIX.json`) couvre chaque route sous `requirePermission` pour six comptes établissement ; la colonne « Tests MONO-T1 » ne liste que les tests ciblés qui appellent le chemin.

Limites : `allowedRoles` = matrice de rôles **par défaut** (seed), la matrice PostgreSQL est éditable ; les colonnes tenant / validation / dépôt / erreurs sont des **indices statiques** du gestionnaire. Les comportements effectifs sont vérifiés par les tests HTTP de caractérisation (`docs/project/MONO-T1-CHARACTERIZATION.md`).

## Synthèse par famille et niveau de risque

| Famille | Routes | CRITIQUE | ÉLEVÉ | MOYEN | FAIBLE | Tests existants (HTTP / toute mention) | Tests MONO-T1 ciblés |
|---|---|---|---|---|---|---|---|
| A. Authentification et sessions | 12 | 0 | 9 | 3 | 0 | 8 / 11 | 6 |
| Autres | 7 | 0 | 0 | 3 | 4 | 5 / 5 | 1 |
| B. Utilisateurs et rôles | 37 | 0 | 25 | 12 | 0 | 6 / 8 | 6 |
| C. Élèves et inscriptions | 47 | 0 | 28 | 19 | 0 | 36 / 39 | 7 |
| D. Notes et présences | 64 | 0 | 34 | 30 | 0 | 39 / 43 | 8 |
| E. Finance | 26 | 0 | 13 | 13 | 0 | 18 / 18 | 9 |
| F. Communication | 45 | 0 | 23 | 22 | 0 | 33 / 35 | 9 |
| G. Pédagogie, planning et référentiels | 80 | 0 | 2 | 48 | 30 | 26 / 37 | 0 |
| H. Plateforme, établissements et abonnements | 53 | 0 | 0 | 34 | 19 | 9 / 17 | 2 |

## Routes sans authentification déclarée

| Route | Middlewares | Statut |
|---|---|---|
| `POST /api/auth/refresh` | — | public par conception |
| `POST /api/backoffice/e2e/clear-login-lockout` | — | conditionnelle : 404 sauf SOMAFRIK_E2E=true hors production ; le démarrage refuse SOMAFRIK_E2E=true en production |
| `POST /api/backoffice/login` | rateLimitMiddleware | limitation de débit |
| `POST /api/identify` | rateLimitMiddleware | limitation de débit |
| `POST /api/login` | rateLimitMiddleware | limitation de débit |
| `GET /` | — | public par conception |
| `GET /^\/verify\/rc(\/.*)?$/` | — | public par conception |
| `GET /api/health` | — | public par conception |
| `POST /api/privacy/erasure-requests` | rateLimitMiddleware | limitation de débit |
| `POST /api/public/report-cards/verify` | — | public par conception |
| `POST /api/public/trial-requests` | rateLimitMiddleware | limitation de débit |
| `GET /api/schools/:code` | — | public par conception |
| `GET /api/schools/:code/logo` | — | public par conception |

## Inventaire détaillé

### A. Authentification et sessions

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /api/auth/change-password` | backend/server.js:684 | oui | — | — | — | principal.schoolCode | 400, validate/assert/parse | changeUserPassword, listActiveUserRoleKeys, resolveEffectivePermissions, revokeAllSessionsForUser (+1) | 400, 404 | ÉLEVÉ | 1 | — |
| `GET /api/auth/effective-permissions` | backend/server.js:522 | oui | — | — | — | — | — | resolveEffectivePermissions | — | MOYEN | 6 | authSessions, rbacMatrix |
| `POST /api/auth/logout` | backend/server.js:543 | oui | — | — | — | — | — | revokeSession | — | ÉLEVÉ | 5 | authSessions |
| `POST /api/auth/refresh` | backend/server.js:504 | **non** | — | — | — | — | — | — | — | ÉLEVÉ | 8 | authSessions |
| `POST /api/auth/revoke-all` | backend/server.js:549 | oui | — | — | — | — | — | revokeAllSessionsForUser | — | ÉLEVÉ | 3 | authSessions |
| `POST /api/backoffice/e2e/clear-login-lockout` | backend/server.js:355 | **non** | — | 403 explicite, isSuperAdminPrincipal | — | — | — | — | 403, 404 | MOYEN | **0** | authSessions |
| `POST /api/backoffice/login` | backend/server.js:417 | **non** | — | — | — | — | — | — | — | ÉLEVÉ | 11 | authSessions |
| `POST /api/identify` | backend/server.js:431 | **non** | — | — | — | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/login` | backend/server.js:438 | **non** | — | — | — | principal.schoolCode, schoolId | — | — | — | ÉLEVÉ | 7 | — |
| `GET /api/me/communication-preferences` | backend/server.js:636 | oui | — | — | — | — | — | — | — | MOYEN | **0** | — |
| `PUT /api/me/communication-preferences` | backend/server.js:641 | oui | — | — | — | — | — | — | — | ÉLEVÉ | **0** | — |
| `POST /api/privacy/erasure-requests/self/execute` | backend/server.js:624 | oui | — | — | — | — | — | — | — | ÉLEVÉ | **0** | — |

### Autres

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /` | backend/server.js:266 | **non** | — | — | — | — | — | — | — | FAIBLE | **0** | — |
| `GET /^\/verify\/rc(\/.*)?$/` | backend/server.js:609 | **non** | — | — | — | — | — | — | 404 | FAIBLE | **0** | — |
| `GET /api/health` | backend/server.js:334 | **non** | — | — | — | — | — | init | 503 | FAIBLE | 4 | authSessions |
| `GET /api/privacy/erasure-requests` | backend/server.js:619 | oui | `GET /api/privacy/erasure-requests` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | — | — | FAIBLE | 2 | — |
| `POST /api/privacy/erasure-requests` | backend/server.js:555 | **non** | — | assertBoundAccessSession | — | — | — | recordAudit | — | MOYEN | 2 | — |
| `POST /api/privacy/erasure-requests/:requestId/execute` | backend/server.js:630 | oui | `POST /api/privacy/erasure-requests/:requestId/execute` | — | SCHOOL_ADMIN | — | — | — | — | MOYEN | 1 | — |
| `POST /api/public/report-cards/verify` | backend/lib/reportCard/reportCardHttp.js:360 | **non** | — | — | — | — | — | — | — | MOYEN | 3 | — |

### B. Utilisateurs et rôles

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/backoffice/contacts` | backend/server.js:3947 | oui | `GET /api/backoffice/contacts` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | scope/tenant | — | listClientsProjection | — | MOYEN | **0** | — |
| `POST /api/backoffice/contacts` | backend/server.js:3952 | oui | `POST /api/backoffice/contacts` | — | SCHOOL_ADMIN | — | — | createClientsContact | — | ÉLEVÉ | **0** | — |
| `PATCH /api/backoffice/contacts/:contactId` | backend/server.js:3957 | oui | `PATCH /api/backoffice/contacts/:contactId` | — | SCHOOL_ADMIN | — | — | updateClientsContact | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/contacts/:contactId/provision-account` | backend/server.js:3962 | oui | `POST /api/backoffice/contacts/:contactId/provision-account` | — | SCHOOL_ADMIN | — | — | provisionClientsContactAccount | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/establishment-roles` | backend/server.js:2011 | oui | `GET /api/backoffice/establishment-roles` | — | SUPER_ADMIN | — | — | listEstablishmentRoles | — | MOYEN | **0** | — |
| `POST /api/backoffice/establishment-roles` | backend/server.js:2019 | oui | `POST /api/backoffice/establishment-roles` | — | SUPER_ADMIN | — | — | createEstablishmentRole | — | ÉLEVÉ | **0** | — |
| `PATCH /api/backoffice/establishment-roles/:roleId` | backend/server.js:2025 | oui | `PATCH /api/backoffice/establishment-roles/:roleId` | — | SUPER_ADMIN | — | — | updateEstablishmentRole | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/establishment-roles/:roleId/archive` | backend/server.js:2031 | oui | `POST /api/backoffice/establishment-roles/:roleId/archive` | — | SUPER_ADMIN | — | — | archiveEstablishmentRole | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/rbac/catalog` | backend/server.js:3726 | oui | `GET /api/backoffice/rbac/catalog` | — | SUPER_ADMIN | — | — | listRbacCatalog | — | MOYEN | **0** | — |
| `GET /api/backoffice/rbac/history` | backend/server.js:3820 | oui | `GET /api/backoffice/rbac/history` | — | SUPER_ADMIN | — | — | — | — | MOYEN | **0** | — |
| `GET /api/backoffice/rbac/permissions` | backend/server.js:3731 | oui | `GET /api/backoffice/rbac/permissions` | — | SUPER_ADMIN | — | — | getConfiguredRolePermissions | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/rbac/permissions` | backend/server.js:3741 | oui | `PATCH /api/backoffice/rbac/permissions` | — | SUPER_ADMIN | — | — | patchConfiguredRolePermissions | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/rbac/permissions/effective` | backend/server.js:3736 | oui | `GET /api/backoffice/rbac/permissions/effective` | — | SUPER_ADMIN | — | — | getEffectiveRolePermissions | — | MOYEN | **0** | — |
| `POST /api/backoffice/rbac/permissions/reset` | backend/server.js:3751 | oui | `POST /api/backoffice/rbac/permissions/reset` | — | SUPER_ADMIN | — | — | — | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/rbac/role-display-labels` | backend/server.js:3783 | oui | `GET /api/backoffice/rbac/role-display-labels` | — | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishmentRoleDisplayLabels | — | MOYEN | **0** | — |
| `POST /api/backoffice/rbac/roles` | backend/server.js:3762 | oui | `POST /api/backoffice/rbac/roles` | — | SUPER_ADMIN | — | — | createEstablishmentRole | — | ÉLEVÉ | **0** | — |
| `PATCH /api/backoffice/rbac/roles/:roleId` | backend/server.js:3772 | oui | `PATCH /api/backoffice/rbac/roles/:roleId` | — | SUPER_ADMIN | — | — | updateEstablishmentRole | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/rbac/roles/:roleId/archive` | backend/server.js:3809 | oui | `POST /api/backoffice/rbac/roles/:roleId/archive` | — | SUPER_ADMIN | — | — | — | — | ÉLEVÉ | **0** | — |
| `PATCH /api/backoffice/rbac/roles/:roleId/display-label` | backend/server.js:3788 | oui | `PATCH /api/backoffice/rbac/roles/:roleId/display-label` | — | SUPER_ADMIN | — | — | updateEstablishmentRoleDisplayLabel | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/rbac/roles/:roleId/display-label/reset` | backend/server.js:3799 | oui | `POST /api/backoffice/rbac/roles/:roleId/display-label/reset` | — | SUPER_ADMIN | — | — | resetEstablishmentRoleDisplayLabel | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/relations` | backend/server.js:3970 | oui | `GET /api/backoffice/relations` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | scope/tenant | — | listClientsProjection | — | MOYEN | **0** | — |
| `POST /api/backoffice/relations` | backend/server.js:3975 | oui | `POST /api/backoffice/relations` | — | SCHOOL_ADMIN | — | — | createClientsRelation | — | ÉLEVÉ | **0** | — |
| `PATCH /api/backoffice/relations/:relationId` | backend/server.js:3982 | oui | `PATCH /api/backoffice/relations/:relationId` | — | SCHOOL_ADMIN | — | — | updateClientsRelation | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/relations/:relationId/archive` | backend/server.js:3992 | oui | `POST /api/backoffice/relations/:relationId/archive` | — | SCHOOL_ADMIN | — | — | archiveClientsRelation | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/role-permissions` | backend/server.js:3716 | oui | `GET /api/backoffice/role-permissions` | — | SUPER_ADMIN | — | — | getRolePermissionsMap | — | MOYEN | **0** | — |
| `PUT /api/backoffice/role-permissions` | backend/server.js:3721 | oui | `PUT /api/backoffice/role-permissions` | — | SUPER_ADMIN | — | — | — | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/users` | backend/server.js:3875 | oui | `GET /api/backoffice/users` | assertUsersReadable | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listClientsUsers | — | MOYEN | 3 | usersRoles |
| `POST /api/backoffice/users` | backend/server.js:3888 | oui | `POST /api/backoffice/users` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | createClientsUser | — | ÉLEVÉ | 3 | usersRoles |
| `PATCH /api/backoffice/users/:userId` | backend/server.js:3918 | oui | `PATCH /api/backoffice/users/:userId` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | updateClientsUser | — | ÉLEVÉ | 1 | usersRoles |
| `POST /api/backoffice/users/:userId/reassign-school` | backend/server.js:3924 | oui | `POST /api/backoffice/users/:userId/reassign-school` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | reassignClientsUserSchool | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/users/:userId/roles/grant` | backend/server.js:3935 | oui | `POST /api/backoffice/users/:userId/roles/grant` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | grantClientsUserRole | — | ÉLEVÉ | 1 | usersRoles |
| `POST /api/backoffice/users/:userId/roles/revoke` | backend/server.js:3941 | oui | `POST /api/backoffice/users/:userId/roles/revoke` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | revokeClientsUserRole | — | ÉLEVÉ | **0** | usersRoles |
| `GET /api/backoffice/users/assignable-roles` | backend/server.js:3883 | oui | `GET /api/backoffice/users/assignable-roles` | — | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listAssignableClientsUserRoles | — | MOYEN | 1 | usersRoles |
| `POST /api/backoffice/users/create-teacher` | backend/server.js:3900 | oui | `POST /api/backoffice/users/create-teacher` | canAccess | SCHOOL_ADMIN | — | — | — | — | ÉLEVÉ | **0** | — |
| `POST /api/backoffice/users/provision` | backend/server.js:3894 | oui | `POST /api/backoffice/users/provision` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | provisionClientsUser | — | ÉLEVÉ | **0** | — |
| `GET /api/establishment-roles/assignable` | backend/server.js:2037 | oui | `GET /api/establishment-roles/assignable` | — | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishmentRoles | — | MOYEN | **0** | — |
| `POST /api/users/:id/reset-password` | backend/server.js:3307 | oui | — | 403 explicite, assertUsersReadable, assertUsersTargetAccess | — | principal.schoolCode, scope/tenant | 400, validate/assert/parse | createTxScope, listClientsUsers, resolveEffectivePermissions, withTransaction | 400, 403, 404, 409 | ÉLEVÉ | 2 | — |

### C. Élèves et inscriptions

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/classes/:classCode/students` | backend/server.js:1046 | oui | `GET /api/classes/:classCode/students` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | listClassStudents, listSchoolClasses | — | MOYEN | 4 | students |
| `POST /api/classes/:classCode/students` | backend/server.js:1072 | oui | `POST /api/classes/:classCode/students` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | enrollStudentInClass | 500 | ÉLEVÉ | 4 | students |
| `GET /api/parents/identity` | backend/server.js:4001 | oui | `GET /api/parents/identity` | — | SCHOOL_ADMIN | — | — | lookupParentIdentity | — | MOYEN | **0** | — |
| `POST /api/parents/link` | backend/server.js:4023 | oui | `POST /api/parents/link` | — | SCHOOL_ADMIN | — | — | linkParent | — | ÉLEVÉ | **0** | — |
| `GET /api/parents/relations` | backend/server.js:4009 | oui | `GET /api/parents/relations` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | 400 | listParentRelations | 400 | MOYEN | 1 | — |
| `PATCH /api/parents/relations/:relationId` | backend/server.js:4031 | oui | `PATCH /api/parents/relations/:relationId` | — | SCHOOL_ADMIN | — | — | archiveParentRelation | — | ÉLEVÉ | **0** | — |
| `POST /api/student-cards` | backend/server.js:2403 | oui | `POST /api/student-cards` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 8 | — |
| `POST /api/student-cards/:id/lost` | backend/server.js:2488 | oui | `POST /api/student-cards/:id/lost` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 3 | — |
| `POST /api/student-cards/:id/nfc-confirm` | backend/server.js:2479 | oui | `POST /api/student-cards/:id/nfc-confirm` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/:id/nfc-provision` | backend/server.js:2461 | oui | `POST /api/student-cards/:id/nfc-provision` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | **0** | — |
| `POST /api/student-cards/:id/nfc-provision/confirm` | backend/server.js:2470 | oui | `POST /api/student-cards/:id/nfc-provision` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | **0** | — |
| `POST /api/student-cards/:id/nfc-recover` | backend/server.js:2439 | oui | `POST /api/student-cards/:id/nfc-confirm` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/:id/nfc-reencode` | backend/server.js:2429 | oui | `POST /api/student-cards/:id/nfc-retry` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/:id/nfc-retry` | backend/server.js:2419 | oui | `POST /api/student-cards/:id/nfc-retry` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/:id/replace` | backend/server.js:2580 | oui | `POST /api/student-cards/:id/replace` | assertEnrollmentStudentAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | getSchoolStudentByCode | 404, 503 | ÉLEVÉ | 4 | — |
| `POST /api/student-cards/:id/revoke` | backend/server.js:2503 | oui | `POST /api/student-cards/:id/revoke` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 4 | — |
| `GET /api/student-cards/capabilities` | backend/server.js:2518 | oui | `GET /api/student-cards/capabilities` | — | PREFET_ETUDES, PROVISEUR, SECRETARY, SUPERVISOR, TEACHER | schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/student-cards/entries` | backend/server.js:2751 | oui | `GET /api/student-cards/entries` | — | aucun | — | — | — | — | MOYEN | 1 | — |
| `POST /api/student-cards/entry-scan` | backend/server.js:2709 | oui | `POST /api/student-cards/entry-scan` | canAccess | aucun | schoolId | — | resolveFinanceLivePermissions | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/nfc-diagnose` | backend/server.js:2450 | oui | `POST /api/student-cards/:id/nfc-confirm` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/student-cards/roll-call/overview` | backend/server.js:2699 | oui | `GET /api/student-cards/roll-call/overview` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | MOYEN | 1 | — |
| `GET /api/student-cards/roll-call/roster` | backend/server.js:2660 | oui | `GET /api/student-cards/roll-call/roster` | — | PREFET_ETUDES, PROVISEUR, SECRETARY, SUPERVISOR, TEACHER | — | — | — | — | MOYEN | 1 | — |
| `POST /api/student-cards/roll-call/scan` | backend/server.js:2646 | oui | `POST /api/student-cards/roll-call/scan` | — | PREFET_ETUDES, PROVISEUR, SECRETARY, SUPERVISOR, TEACHER | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/roll-call/validate` | backend/server.js:2674 | oui | `POST /api/student-cards/roll-call/validate` | — | PREFET_ETUDES, PROVISEUR, SECRETARY, SUPERVISOR, TEACHER | — | validate/assert/parse | — | — | ÉLEVÉ | 1 | — |
| `POST /api/student-cards/scan` | backend/server.js:2527 | oui | `POST /api/student-cards/scan` | — | PREFET_ETUDES, PROVISEUR, SECRETARY, SUPERVISOR, TEACHER | schoolId | — | — | — | ÉLEVÉ | 6 | — |
| `POST /api/student-cards/verify` | backend/server.js:2267 | oui | `POST /api/student-cards/verify` | canAccess | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | resolveFinanceLivePermissions | — | ÉLEVÉ | 1 | — |
| `GET /api/students` | backend/server.js:2072 | oui | `GET /api/students` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | listSchoolStudents | 503 | MOYEN | 7 | anomaly.A1-teacher-homonym-scope, authSessions, students |
| `DELETE /api/students/:id` | backend/server.js:2881 | oui | `DELETE /api/students/:id` | assertEnrollmentStudentAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | archiveSchoolStudentByCode, getSchoolStudentByCode | 404, 503 | ÉLEVÉ | 4 | students |
| `GET /api/students/:id` | backend/server.js:2218 | oui | `GET /api/students/:id` | assertEnrollmentStudentAccess | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | schoolId, scope/tenant | — | getSchoolStudentByCode | 404, 503 | MOYEN | 4 | students |
| `PATCH /api/students/:id` | backend/server.js:2843 | oui | `PATCH /api/students/:id` | assertEnrollmentStudentAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | getSchoolStudentByCode, updateSchoolStudentByCode | 404, 503 | ÉLEVÉ | 4 | students |
| `GET /api/students/:id/cards` | backend/server.js:2391 | oui | `GET /api/students/:id/cards` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/students/:id/notes` | backend/server.js:2914 | oui | `GET /api/students/:id/notes` | assertParentNotesStudentAccess | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, STUDENT, TEACHER | — | — | — | — | MOYEN | **0** | — |
| `GET /api/students/:id/payments` | backend/server.js:3143 | oui | `GET /api/students/:id/payments` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | — | — | MOYEN | **0** | students |
| `GET /api/students/:id/presences` | backend/server.js:3128 | oui | `GET /api/students/:id/presences` | assertPresenceReadable | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | MOYEN | 1 | — |
| `GET /api/students/:id/report` | backend/server.js:3091 | oui | `GET /api/students/:id/report` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | scope/tenant | — | — | 404 | MOYEN | **0** | — |
| `GET /api/students/:id/report.pdf` | backend/server.js:3103 | oui | `GET /api/students/:id/report.pdf` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | scope/tenant | — | — | 404 | MOYEN | **0** | — |
| `GET /api/students/:studentId/documents` | backend/server.js:2109 | oui | `GET /api/students/:id` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | MOYEN | 1 | — |
| `POST /api/students/:studentId/documents` | backend/server.js:2121 | oui | `GET /api/students/:id` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/students/:studentId/documents/:documentId/archive` | backend/server.js:2165 | oui | `GET /api/students/:id` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/students/:studentId/documents/:documentId/file` | backend/server.js:2182 | oui | `GET /api/students/:id` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | scope/tenant | — | — | — | MOYEN | **0** | — |
| `POST /api/students/:studentId/documents/:documentId/verify` | backend/server.js:2148 | oui | `GET /api/students/:id` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | ÉLEVÉ | **0** | — |
| `GET /api/students/:studentId/enrollments` | backend/server.js:2760 | oui | `GET /api/students/:studentId/enrollments` | 403 explicite | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | 403 | MOYEN | 1 | — |
| `POST /api/students/:studentId/enrollments/:enrollmentId/assign-class` | backend/server.js:2793 | oui | `POST /api/students/:studentId/enrollments/:enrollmentId/assign-class` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/students/:studentId/enrollments/:enrollmentId/close` | backend/server.js:2827 | oui | `POST /api/students/:studentId/enrollments/:enrollmentId/close` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/students/:studentId/enrollments/:enrollmentId/transfer` | backend/server.js:2810 | oui | `POST /api/students/:studentId/enrollments/:enrollmentId/transfer` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/students/:studentId/enrollments/:enrollmentId/validate` | backend/server.js:2778 | oui | `POST /api/students/:studentId/enrollments/:enrollmentId/validate` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/students/:studentId/photo` | backend/server.js:2203 | oui | `GET /api/students/:id` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | MOYEN | 1 | — |

### D. Notes et présences

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/assignments` | backend/server.js:1352 | oui | `GET /api/assignments` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, TEACHER | assert*School/Tenant, principal.schoolCode, schoolId, scope/tenant | 400 | getSchoolByCode, listSchoolTeacherAssignments | 400, 503 | MOYEN | 2 | — |
| `POST /api/assignments` | backend/server.js:1419 | oui | `POST /api/assignments` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | createSchoolTeacherAssignment | 400 | ÉLEVÉ | 2 | — |
| `DELETE /api/assignments/:assignmentId` | backend/server.js:1450 | oui | `DELETE /api/assignments/:assignmentId` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | deleteSchoolTeacherAssignment | 400 | ÉLEVÉ | 1 | — |
| `PATCH /api/assignments/:assignmentId` | backend/server.js:1434 | oui | `PATCH /api/assignments/:assignmentId` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | updateSchoolTeacherAssignment | 400 | ÉLEVÉ | 1 | — |
| `GET /api/backoffice/report-cards` | backend/server.js:2052 | oui | `GET /api/backoffice/report-cards` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listReportCards | — | MOYEN | **0** | — |
| `PUT /api/backoffice/report-cards` | backend/server.js:2057 | oui | `PUT /api/backoffice/report-cards` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | — | — | ÉLEVÉ | **0** | — |
| `GET /api/evaluation-types` | backend/server.js:1655 | oui | `GET /api/evaluation-types` | assertSchoolAccess | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, STUDENT, SUPER_ADMIN, TEACHER | assert*School/Tenant, scope/tenant | — | listEvaluationTypes | — | MOYEN | **0** | anomaly.A4-ambiguous-class-name, notesPresences |
| `POST /api/evaluation-types` | backend/server.js:1667 | oui | `POST /api/evaluation-types` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | createEvaluationType | — | ÉLEVÉ | **0** | anomaly.A4-ambiguous-class-name, notesPresences |
| `PATCH /api/evaluation-types/:typeId` | backend/server.js:1681 | oui | `PATCH /api/evaluation-types/:typeId` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | updateEvaluationType | — | ÉLEVÉ | **0** | — |
| `POST /api/evaluation-types/:typeId/archive` | backend/server.js:1696 | oui | `POST /api/evaluation-types/:typeId/archive` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | archiveEvaluationType | — | ÉLEVÉ | **0** | — |
| `GET /api/evaluations` | backend/server.js:1304 | oui | `GET /api/evaluations` | assertSchoolAccess | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, STUDENT, TEACHER | assert*School/Tenant, principal.schoolCode, scope/tenant | — | listSchoolEvaluations | — | MOYEN | **0** | anomaly.A4-ambiguous-class-name, notesPresences |
| `POST /api/evaluations` | backend/server.js:1315 | oui | `POST /api/evaluations` | — | PREFET_ETUDES, PROVISEUR, TEACHER | — | — | createSchoolEvaluation | — | ÉLEVÉ | **0** | anomaly.A4-ambiguous-class-name, notesPresences |
| `PATCH /api/evaluations/:evaluationId` | backend/server.js:1333 | oui | `PATCH /api/evaluations/:evaluationId` | — | PREFET_ETUDES, PROVISEUR, TEACHER | — | — | updateSchoolEvaluation | — | ÉLEVÉ | **0** | — |
| `GET /api/exams` | backend/server.js:1763 | oui | `GET /api/exams` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | — | — | listExams | — | MOYEN | 1 | — |
| `POST /api/exams` | backend/server.js:1768 | oui | `POST /api/exams` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | createExam | — | ÉLEVÉ | 1 | — |
| `GET /api/exams/:examId` | backend/server.js:1774 | oui | `GET /api/exams/:examId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | — | — | getExam | — | MOYEN | **0** | — |
| `PATCH /api/exams/:examId` | backend/server.js:1779 | oui | `PATCH /api/exams/:examId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | patchExam | — | ÉLEVÉ | **0** | — |
| `POST /api/exams/:examId/archive` | backend/server.js:1797 | oui | `POST /api/exams/:examId/archive` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | archiveExam | — | ÉLEVÉ | **0** | — |
| `POST /api/exams/:examId/cancel` | backend/server.js:1791 | oui | `POST /api/exams/:examId/cancel` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | cancelExam | — | ÉLEVÉ | **0** | — |
| `POST /api/exams/:examId/validate` | backend/server.js:1785 | oui | `POST /api/exams/:examId/validate` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | validate/assert/parse | validateExam | — | ÉLEVÉ | **0** | — |
| `GET /api/notes` | backend/server.js:2927 | oui | `GET /api/notes` | assertParentNotesStudentAccess | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, STUDENT, TEACHER | scope/tenant | — | — | — | MOYEN | 1 | notesPresences |
| `POST /api/notes` | backend/server.js:3004 | oui | `POST /api/notes` | — | PREFET_ETUDES, PROVISEUR, TEACHER | principal.schoolCode | — | upsertGrade, upsertSchoolGrade | — | ÉLEVÉ | 1 | notesPresences |
| `GET /api/presences` | backend/server.js:2963 | oui | `GET /api/presences` | assertPresenceReadable | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | scope/tenant | — | — | — | MOYEN | 5 | anomaly.A3-attendance-status-coercion, notesPresences |
| `POST /api/presences` | backend/server.js:3044 | oui | `POST /api/presences` | assertPresenceReadable | PREFET_ETUDES, PROVISEUR, SECRETARY, SUPERVISOR, TEACHER | — | — | upsertAttendanceBatch, upsertSchoolAttendanceBatch | — | ÉLEVÉ | 5 | anomaly.A3-attendance-status-coercion, notesPresences |
| `GET /api/report-card-templates` | backend/server.js:1826 | oui | `GET /api/report-card-templates` | — | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | listReportCardTemplates | — | MOYEN | **0** | — |
| `PUT /api/report-card-templates` | backend/server.js:1831 | oui | `PUT /api/report-card-templates` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, SUPER_ADMIN | — | — | upsertReportCardTemplate | — | ÉLEVÉ | **0** | — |
| `POST /api/report-card-templates/:templateId/archive` | backend/server.js:1837 | oui | `POST /api/report-card-templates/:templateId/archive` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, SUPER_ADMIN | — | — | archiveReportCardTemplate | — | ÉLEVÉ | **0** | — |
| `GET /api/report-card/admin/bindings/:modelKey` | backend/lib/reportCard/reportCardHttp.js:826 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/admin/catalog` | backend/lib/reportCard/reportCardHttp.js:798 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/admin/queue` | backend/lib/reportCard/reportCardHttp.js:742 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/admin/requests/:requestId` | backend/lib/reportCard/reportCardHttp.js:756 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `POST /api/report-card/admin/requests/:requestId/activate` | backend/lib/reportCard/reportCardHttp.js:986 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/report-card/admin/requests/:requestId/bind-bundle` | backend/lib/reportCard/reportCardHttp.js:883 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/report-card/admin/requests/:requestId/bundle` | backend/lib/reportCard/reportCardHttp.js:810 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `POST /api/report-card/admin/requests/:requestId/configure` | backend/lib/reportCard/reportCardHttp.js:854 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/report-card/admin/requests/:requestId/ready-for-review` | backend/lib/reportCard/reportCardHttp.js:929 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/report-card/admin/requests/:requestId/reject` | backend/lib/reportCard/reportCardHttp.js:969 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | **0** | — |
| `POST /api/report-card/admin/requests/:requestId/review` | backend/lib/reportCard/reportCardHttp.js:842 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `POST /api/report-card/admin/requests/:requestId/save-template` | backend/lib/reportCard/reportCardHttp.js:866 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/report-card/admin/requests/:requestId/source-artifact` | backend/lib/reportCard/reportCardHttp.js:768 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/admin/requests/:requestId/source-artifact/content` | backend/lib/reportCard/reportCardHttp.js:780 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/bindings/:modelKey` | backend/lib/reportCard/reportCardHttp.js:499 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/publications` | backend/lib/reportCard/reportCardHttp.js:531 | oui | — | — | — | resolveSchoolId (actor), schoolId, scope/tenant | — | — | — | MOYEN | 2 | — |
| `POST /api/report-card/publications/:reportCardId/corrections` | backend/lib/reportCard/reportCardHttp.js:695 | oui | — | — | — | resolveSchoolId (actor), schoolId, scope/tenant | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/report-card/publications/:reportCardId/history` | backend/lib/reportCard/reportCardHttp.js:627 | oui | — | — | — | resolveSchoolId (actor), schoolId, scope/tenant | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/publications/:reportCardId/pdf` | backend/lib/reportCard/reportCardHttp.js:572 | oui | — | — | — | resolveSchoolId (actor), schoolId, scope/tenant | — | — | — | MOYEN | 2 | — |
| `GET /api/report-card/publications/:reportCardId/snapshot` | backend/lib/reportCard/reportCardHttp.js:606 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/publications/:reportCardId/versions/:version` | backend/lib/reportCard/reportCardHttp.js:673 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `POST /api/report-card/publications/:reportCardId/versions/:version/revoke` | backend/lib/reportCard/reportCardHttp.js:718 | oui | — | — | — | resolveSchoolId (actor), schoolId, scope/tenant | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/report-card/requests` | backend/lib/reportCard/reportCardHttp.js:365 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 3 | — |
| `POST /api/report-card/requests` | backend/lib/reportCard/reportCardHttp.js:377 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 3 | — |
| `GET /api/report-card/requests/:requestId` | backend/lib/reportCard/reportCardHttp.js:446 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `POST /api/report-card/requests/:requestId/approve` | backend/lib/reportCard/reportCardHttp.js:458 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/report-card/requests/:requestId/audit` | backend/lib/reportCard/reportCardHttp.js:487 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-card/requests/:requestId/bundle` | backend/lib/reportCard/reportCardHttp.js:515 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `POST /api/report-card/requests/:requestId/request-changes` | backend/lib/reportCard/reportCardHttp.js:470 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | **0** | — |
| `GET /api/report-card/requests/:requestId/source-artifact` | backend/lib/reportCard/reportCardHttp.js:416 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | **0** | — |
| `POST /api/report-card/requests/:requestId/source-artifact` | backend/lib/reportCard/reportCardHttp.js:394 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | ÉLEVÉ | **0** | — |
| `GET /api/report-card/requests/:requestId/source-artifact/content` | backend/lib/reportCard/reportCardHttp.js:428 | oui | — | — | — | resolveSchoolId (actor), schoolId | — | — | — | MOYEN | 1 | — |
| `GET /api/report-cards` | backend/server.js:1803 | oui | `GET /api/report-cards` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listReportCards | — | MOYEN | 2 | — |
| `POST /api/report-cards/:cardId/archive` | backend/server.js:1820 | oui | `POST /api/report-cards/:cardId/archive` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | archiveReportCard | — | ÉLEVÉ | **0** | — |
| `POST /api/report-cards/:cardId/publish` | backend/server.js:1814 | oui | `POST /api/report-cards/:cardId/publish` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | publishReportCard | — | ÉLEVÉ | **0** | — |
| `POST /api/report-cards/generate` | backend/server.js:1808 | oui | `POST /api/report-cards/generate` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | generateReportCard | — | ÉLEVÉ | **0** | — |
| `GET /api/v2/exams` | backend/server.js:4824 | oui | `GET /api/v2/exams` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | scope/tenant | — | getExamsV2 | — | MOYEN | **0** | — |

### E. Finance

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/backoffice/finance/unpaid` | backend/server.js:4566 | oui | `GET /api/backoffice/finance/unpaid` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | — | — | MOYEN | 2 | finance |
| `GET /api/backoffice/finance/unpaid/:studentId` | backend/server.js:4578 | oui | `GET /api/backoffice/finance/unpaid` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | — | — | MOYEN | **0** | — |
| `GET /api/backoffice/finance/unpaid/:studentId/reminders` | backend/server.js:4584 | oui | `GET /api/backoffice/finance/unpaid` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | — | — | MOYEN | 1 | — |
| `POST /api/backoffice/finance/unpaid/:studentId/reminders` | backend/server.js:4591 | oui | `POST /api/backoffice/finance/unpaid/reminders` | — | ACCOUNTANT, SCHOOL_ADMIN, SECRETARY | — | — | createFinanceReminder | — | ÉLEVÉ | 1 | — |
| `GET /api/finance/catalog` | backend/server.js:3498 | oui | `GET /api/finance/catalog` | — | ACCOUNTANT, COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | getFinanceCatalog | — | MOYEN | 1 | — |
| `GET /api/finance/fee-grids` | backend/server.js:3567 | oui | `GET /api/finance/fee-grids` | — | ACCOUNTANT, COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | scope/tenant | — | listFinanceFeeGrids | — | MOYEN | 3 | — |
| `POST /api/finance/fee-grids` | backend/server.js:3573 | oui | `POST /api/finance/fee-grids` | — | COUNTRY_ADMIN, SCHOOL_ADMIN | — | — | upsertFinanceFeeGrid | — | ÉLEVÉ | 3 | — |
| `GET /api/finance/fee-grids/:gridId` | backend/server.js:3579 | oui | `GET /api/finance/fee-grids` | — | ACCOUNTANT, COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | getFinanceFeeGrid | 404 | MOYEN | 1 | — |
| `PATCH /api/finance/fee-grids/:gridId` | backend/server.js:3590 | oui | `PATCH /api/finance/fee-grids/:gridId` | — | COUNTRY_ADMIN, SCHOOL_ADMIN | — | — | upsertFinanceFeeGrid | — | ÉLEVÉ | 1 | — |
| `POST /api/finance/fee-grids/:gridId/activate` | backend/server.js:3596 | oui | `POST /api/finance/fee-grids/:gridId/activate` | — | COUNTRY_ADMIN, SCHOOL_ADMIN | — | — | setFinanceFeeGridStatus | — | ÉLEVÉ | 1 | — |
| `POST /api/finance/fee-grids/:gridId/apply` | backend/server.js:3608 | oui | `POST /api/finance/fee-grids/:gridId/apply` | — | COUNTRY_ADMIN, SCHOOL_ADMIN | — | — | applyFinanceFeeGrid | — | ÉLEVÉ | 1 | — |
| `POST /api/finance/fee-grids/:gridId/deactivate` | backend/server.js:3602 | oui | `POST /api/finance/fee-grids/:gridId/deactivate` | — | COUNTRY_ADMIN, SCHOOL_ADMIN | — | — | setFinanceFeeGridStatus | — | ÉLEVÉ | 1 | — |
| `GET /api/finance/payment-methods` | backend/server.js:3503 | oui | `GET /api/finance/payment-methods` | — | ACCOUNTANT, COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | listSchoolPaymentMethods | — | MOYEN | **0** | — |
| `PUT /api/finance/payment-methods` | backend/server.js:3508 | oui | `PUT /api/finance/payment-methods` | — | COUNTRY_ADMIN, SCHOOL_ADMIN | — | — | replaceSchoolPaymentMethods | — | ÉLEVÉ | **0** | — |
| `GET /api/finance/payment-statuses` | backend/server.js:3514 | oui | `GET /api/finance/payment-statuses` | — | ACCOUNTANT, COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | scope/tenant | — | listFinancePaymentStatuses | — | MOYEN | **0** | anomaly.A5-payment-status-upsert |
| `POST /api/finance/payment-statuses` | backend/server.js:3520 | oui | `POST /api/finance/payment-statuses` | — | ACCOUNTANT, COUNTRY_ADMIN, SECRETARY | — | — | upsertFinancePaymentStatus | — | ÉLEVÉ | **0** | anomaly.A5-payment-status-upsert |
| `PATCH /api/finance/payment-statuses/:statusId` | backend/server.js:3526 | oui | `PATCH /api/finance/payment-statuses/:statusId` | 403 explicite, canAdjustStudentFee, canManageFeeGrids | ACCOUNTANT, COUNTRY_ADMIN, SECRETARY | — | — | upsertFinancePaymentStatus | 403 | ÉLEVÉ | **0** | anomaly.A5-payment-status-upsert |
| `GET /api/finance/payment-student-options` | backend/server.js:3493 | oui | `GET /api/finance/payment-student-options` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | listPaymentStudentOptions | — | MOYEN | 2 | — |
| `POST /api/finance/reconcile-payment-allocations` | backend/server.js:3632 | oui | `POST /api/finance/reconcile-payment-allocations` | — | ACCOUNTANT, SECRETARY | — | — | reconcileFinancePaymentAllocations | — | ÉLEVÉ | **0** | — |
| `GET /api/finance/student-fees` | backend/server.js:3622 | oui | `GET /api/finance/student-fees` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | scope/tenant | — | listFinanceStudentFees | — | MOYEN | 4 | finance |
| `GET /api/finance/student-fees/:obligationId` | backend/server.js:3642 | oui | `GET /api/finance/student-fees` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | getFinanceStudentFee | 404 | MOYEN | 1 | — |
| `POST /api/finance/student-fees/:obligationId/adjust` | backend/server.js:3648 | oui | `POST /api/finance/student-fees/:obligationId/adjust` | — | ACCOUNTANT, SCHOOL_ADMIN, SECRETARY | — | — | adjustFinanceStudentFee | — | ÉLEVÉ | **0** | — |
| `GET /api/payments` | backend/server.js:3436 | oui | `GET /api/payments` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | scope/tenant | — | — | — | MOYEN | 5 | finance |
| `POST /api/payments` | backend/server.js:3453 | oui | `POST /api/payments` | — | ACCOUNTANT, SCHOOL_ADMIN, SECRETARY | — | — | createSchoolPayment | — | ÉLEVÉ | 5 | finance |
| `GET /api/payments/:paymentId` | backend/server.js:3468 | oui | `GET /api/payments/:paymentId` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT | — | — | getSchoolPayment | 404 | MOYEN | 1 | finance |
| `POST /api/payments/:paymentId/cancel` | backend/server.js:3474 | oui | `POST /api/payments/:paymentId/cancel` | — | ACCOUNTANT, SCHOOL_ADMIN, SECRETARY | — | — | cancelSchoolPayment | — | ÉLEVÉ | 2 | finance |

### F. Communication

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/backoffice/announcements` | backend/server.js:4173 | oui | `GET /api/backoffice/announcements` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listClientsAnnouncements | — | MOYEN | 4 | communication |
| `POST /api/backoffice/announcements` | backend/server.js:4178 | oui | `POST /api/backoffice/announcements` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | createClientsAnnouncement | — | ÉLEVÉ | 4 | communication |
| `GET /api/backoffice/announcements/:announcementId` | backend/server.js:4209 | oui | `GET /api/backoffice/announcements/:announcementId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsAnnouncement | — | MOYEN | 1 | communication |
| `PATCH /api/backoffice/announcements/:announcementId` | backend/server.js:4224 | oui | `PATCH /api/backoffice/announcements/:announcementId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | updateClientsAnnouncement | — | ÉLEVÉ | 1 | communication |
| `POST /api/backoffice/announcements/:announcementId/archive` | backend/server.js:4229 | oui | `POST /api/backoffice/announcements/:announcementId/archive` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | archiveClientsAnnouncement | — | ÉLEVÉ | 2 | — |
| `PATCH /api/backoffice/announcements/:announcementId/read` | backend/server.js:4214 | oui | `PATCH /api/backoffice/announcements/:announcementId/read` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | markClientsAnnouncementRead | — | ÉLEVÉ | 1 | — |
| `POST /api/backoffice/announcements/attachments` | backend/server.js:4191 | oui | `POST /api/backoffice/announcements/attachments` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | uploadAnnouncementAttachment | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/announcements/audience-options` | backend/server.js:4168 | oui | `GET /api/backoffice/announcements/audience-options` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | listAnnouncementAudienceOptions | — | MOYEN | 1 | — |
| `GET /api/backoffice/announcements/unread-count` | backend/server.js:4163 | oui | `GET /api/backoffice/announcements/unread-count` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsAnnouncementsUnreadCount | — | MOYEN | 1 | — |
| `POST /api/backoffice/communications/attachments` | backend/server.js:4138 | oui | `POST /api/backoffice/communications/attachments` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | uploadCommunicationAttachment | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/communications/attachments/:attachmentId` | backend/server.js:4156 | oui | `GET /api/backoffice/communications/attachments/:attachmentId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | downloadCommunicationAttachment | — | MOYEN | **0** | — |
| `GET /api/backoffice/communications/deliveries/health` | backend/server.js:4319 | oui | `GET /api/backoffice/communications/deliveries/health` | — | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | getClientsStore | 403 | MOYEN | **0** | — |
| `GET /api/backoffice/conversations` | backend/server.js:4088 | oui | `GET /api/backoffice/conversations` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listClientConversations | — | MOYEN | 2 | — |
| `POST /api/backoffice/conversations` | backend/server.js:4093 | oui | `POST /api/backoffice/conversations` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | createClientConversation | — | ÉLEVÉ | 2 | — |
| `GET /api/backoffice/conversations/:conversationId` | backend/server.js:4110 | oui | `GET /api/backoffice/conversations/:conversationId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientConversation | — | MOYEN | 2 | — |
| `GET /api/backoffice/conversations/:conversationId/messages` | backend/server.js:4115 | oui | `GET /api/backoffice/conversations/:conversationId/messages` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listClientConversationMessages | — | MOYEN | 1 | — |
| `POST /api/backoffice/conversations/:conversationId/messages` | backend/server.js:4120 | oui | `POST /api/backoffice/conversations/:conversationId/messages` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | replyClientConversationMessage | — | ÉLEVÉ | 1 | — |
| `GET /api/backoffice/internal-notifications` | backend/server.js:4331 | oui | `GET /api/backoffice/internal-notifications` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsStore | — | MOYEN | 1 | — |
| `POST /api/backoffice/internal-notifications` | backend/server.js:4336 | oui | `POST /api/backoffice/internal-notifications` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | getClientsStore | — | ÉLEVÉ | 1 | — |
| `GET /api/backoffice/internal-notifications/:notificationId` | backend/server.js:4380 | oui | `GET /api/backoffice/internal-notifications/:notificationId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsStore | — | MOYEN | 1 | — |
| `PATCH /api/backoffice/internal-notifications/:notificationId/archive` | backend/server.js:4394 | oui | `PATCH /api/backoffice/internal-notifications/:notificationId/archive` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsStore | — | ÉLEVÉ | 1 | — |
| `PATCH /api/backoffice/internal-notifications/:notificationId/read` | backend/server.js:4387 | oui | `PATCH /api/backoffice/internal-notifications/:notificationId/read` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsStore | — | ÉLEVÉ | 1 | — |
| `POST /api/backoffice/internal-notifications/attachments` | backend/server.js:4347 | oui | `POST /api/backoffice/internal-notifications/attachments` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | getClientsStore | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/internal-notifications/attachments/:attachmentId` | backend/server.js:4366 | oui | `GET /api/backoffice/internal-notifications/attachments/:attachmentId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsStore | — | MOYEN | **0** | — |
| `GET /api/backoffice/internal-notifications/unread-count` | backend/server.js:4314 | oui | `GET /api/backoffice/internal-notifications/unread-count` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientsStore | — | MOYEN | 1 | — |
| `GET /api/backoffice/messages` | backend/server.js:4056 | oui | `GET /api/backoffice/messages` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listClientsMessages | — | MOYEN | 4 | communication |
| `POST /api/backoffice/messages` | backend/server.js:4061 | oui | `POST /api/backoffice/messages` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | sendClientsMessage | — | ÉLEVÉ | 4 | communication |
| `GET /api/backoffice/messages/:messageId` | backend/server.js:4051 | oui | `GET /api/backoffice/messages/:messageId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientMessage | — | MOYEN | 2 | communication |
| `PATCH /api/backoffice/messages/:messageId/read` | backend/server.js:4078 | oui | `PATCH /api/backoffice/messages/:messageId/read` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | markClientsMessageRead | — | ÉLEVÉ | 2 | — |
| `GET /api/backoffice/messages/recipients` | backend/server.js:4046 | oui | `GET /api/backoffice/messages/recipients` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listClientMessageRecipients | — | MOYEN | 1 | — |
| `GET /api/backoffice/messages/unread-count` | backend/server.js:4041 | oui | `GET /api/backoffice/messages/unread-count` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | getClientMessagesUnreadCount | — | MOYEN | 1 | — |
| `GET /api/backoffice/notifications` | backend/server.js:3675 | oui | `GET /api/backoffice/notifications` | — | COUNTRY_ADMIN, SUPER_ADMIN | scope/tenant | — | listPlatformProjection | — | MOYEN | **0** | communication |
| `POST /api/backoffice/notifications` | backend/server.js:3704 | oui | `POST /api/backoffice/notifications` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | createPlatformNotification | — | ÉLEVÉ | **0** | communication |
| `PATCH /api/backoffice/notifications/:notificationId` | backend/server.js:3710 | oui | `PATCH /api/backoffice/notifications/:notificationId` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | updatePlatformNotification | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/platform-announcements` | backend/server.js:4244 | oui | `GET /api/backoffice/platform-announcements` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | listPlatformAnnouncements | — | MOYEN | 1 | — |
| `POST /api/backoffice/platform-announcements` | backend/server.js:4249 | oui | `POST /api/backoffice/platform-announcements` | — | SUPER_ADMIN | — | — | createPlatformAnnouncement | — | ÉLEVÉ | 1 | — |
| `GET /api/backoffice/platform-announcements/:announcementId` | backend/server.js:4291 | oui | `GET /api/backoffice/platform-announcements/:announcementId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | getPlatformAnnouncement | — | MOYEN | 1 | — |
| `POST /api/backoffice/platform-announcements/:announcementId/archive` | backend/server.js:4305 | oui | `POST /api/backoffice/platform-announcements/:announcementId/archive` | — | SUPER_ADMIN | — | — | archivePlatformAnnouncement | — | ÉLEVÉ | **0** | — |
| `PATCH /api/backoffice/platform-announcements/:announcementId/read` | backend/server.js:4296 | oui | `PATCH /api/backoffice/platform-announcements/:announcementId/read` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | markPlatformAnnouncementRead | — | ÉLEVÉ | 1 | — |
| `POST /api/backoffice/platform-announcements/attachments` | backend/server.js:4266 | oui | `POST /api/backoffice/platform-announcements/attachments` | — | SUPER_ADMIN | — | — | uploadPlatformAnnouncementAttachment | — | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/platform-announcements/attachments/:attachmentId` | backend/server.js:4284 | oui | `GET /api/backoffice/platform-announcements/attachments/:attachmentId` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | downloadPlatformAnnouncementAttachment | — | MOYEN | **0** | — |
| `GET /api/backoffice/platform-announcements/unread-count` | backend/server.js:4239 | oui | `GET /api/backoffice/platform-announcements/unread-count` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPER_ADMIN, TEACHER | — | — | getPlatformAnnouncementsUnreadCount | — | MOYEN | 1 | — |
| `POST /api/mobile/push-devices` | backend/server.js:650 | oui | — | — | — | — | — | upsertMobilePushDevice | — | ÉLEVÉ | 2 | — |
| `DELETE /api/mobile/push-devices/current` | backend/server.js:660 | oui | — | — | — | — | — | revokeCurrentMobilePushDevice | — | ÉLEVÉ | 1 | — |
| `POST /api/mobile/push-devices/test` | backend/server.js:668 | oui | — | — | — | — | — | sendMobilePushSelfTest | — | ÉLEVÉ | 1 | — |

### G. Pédagogie, planning et référentiels

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/academic-config` | backend/server.js:1465 | oui | `GET /api/academic-config` | assertSchoolAccess | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, SUPER_ADMIN, TEACHER | assert*School/Tenant, scope/tenant | — | getAcademicConfig | — | FAIBLE | **0** | — |
| `PUT /api/academic-config` | backend/server.js:1511 | oui | `PUT /api/academic-config` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | createTxScope, invalidateCachedDataset, withTransaction | — | MOYEN | **0** | — |
| `PUT /api/academic-periods` | backend/server.js:1578 | oui | `PUT /api/academic-periods` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | replaceAcademicPeriods | — | MOYEN | **0** | — |
| `POST /api/backoffice/bulletin-design/preview` | backend/server.js:4627 | oui | — | 403 explicite, isSuperAdminPrincipal | — | — | 400 | — | 400, 403, 404 | ÉLEVÉ | **0** | — |
| `GET /api/backoffice/education-class-groups` | backend/server.js:1930 | oui | `GET /api/backoffice/education-class-groups` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | 400 | listEducationClassGroupsByCountry | 400 | FAIBLE | **0** | — |
| `POST /api/backoffice/education-class-groups` | backend/server.js:1943 | oui | `POST /api/backoffice/education-class-groups` | — | SUPER_ADMIN | — | — | createEducationClassGroup | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/education-class-groups/:groupId` | backend/server.js:1949 | oui | `PATCH /api/backoffice/education-class-groups/:groupId` | — | SUPER_ADMIN | — | — | updateEducationClassGroup | — | MOYEN | **0** | — |
| `POST /api/backoffice/education-class-groups/:groupId/archive` | backend/server.js:1955 | oui | `POST /api/backoffice/education-class-groups/:groupId/archive` | — | SUPER_ADMIN | — | — | archiveEducationClassGroup | — | MOYEN | **0** | — |
| `GET /api/backoffice/education-levels` | backend/server.js:1866 | oui | `GET /api/backoffice/education-levels` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | 400 | listEducationLevelsByCountry | 400 | FAIBLE | **0** | — |
| `POST /api/backoffice/education-levels` | backend/server.js:1879 | oui | `POST /api/backoffice/education-levels` | — | SUPER_ADMIN | — | — | createEducationLevel | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/education-levels/:levelId` | backend/server.js:1885 | oui | `PATCH /api/backoffice/education-levels/:levelId` | — | SUPER_ADMIN | — | — | updateEducationLevel | — | MOYEN | **0** | — |
| `POST /api/backoffice/education-levels/:levelId/archive` | backend/server.js:1891 | oui | `POST /api/backoffice/education-levels/:levelId/archive` | — | SUPER_ADMIN | — | — | archiveEducationLevel | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/education-reference/labels` | backend/server.js:1961 | oui | `PATCH /api/backoffice/education-reference/labels` | — | SUPER_ADMIN | — | — | updateCountryPedagogicalLabels | — | MOYEN | **0** | — |
| `GET /api/backoffice/education-streams` | backend/server.js:1897 | oui | `GET /api/backoffice/education-streams` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | 400 | listEducationStreamsByCountry | 400 | FAIBLE | **0** | — |
| `POST /api/backoffice/education-streams` | backend/server.js:1912 | oui | `POST /api/backoffice/education-streams` | — | SUPER_ADMIN | — | — | createEducationStream | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/education-streams/:streamId` | backend/server.js:1918 | oui | `PATCH /api/backoffice/education-streams/:streamId` | — | SUPER_ADMIN | — | — | updateEducationStream | — | MOYEN | **0** | — |
| `POST /api/backoffice/education-streams/:streamId/archive` | backend/server.js:1924 | oui | `POST /api/backoffice/education-streams/:streamId/archive` | — | SUPER_ADMIN | — | — | archiveEducationStream | — | MOYEN | **0** | — |
| `POST /api/backoffice/import/students/validate` | backend/server.js:4469 | oui | `POST /api/backoffice/import/students/validate` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | validate/assert/parse | — | — | MOYEN | **0** | — |
| `GET /api/backoffice/planning-exams` | backend/server.js:2042 | oui | `GET /api/backoffice/planning-exams` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | — | — | listExams | — | FAIBLE | **0** | — |
| `PUT /api/backoffice/planning-exams` | backend/server.js:2047 | oui | `PUT /api/backoffice/planning-exams` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | — | — | MOYEN | **0** | — |
| `GET /api/backoffice/state` | backend/server.js:4617 | oui | — | — | — | — | — | — | — | MOYEN | 1 | — |
| `PUT /api/backoffice/state` | backend/server.js:4622 | oui | — | — | — | — | — | — | — | ÉLEVÉ | 1 | — |
| `GET /api/classes` | backend/server.js:776 | oui | `GET /api/classes` | assertSchoolAccess | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, SUPER_ADMIN, TEACHER | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | listSchoolClasses, listSchoolStudents | 400 | FAIBLE | 4 | — |
| `POST /api/classes` | backend/server.js:893 | oui | `POST /api/classes` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | createSchoolClass | 400 | MOYEN | 4 | — |
| `PATCH /api/classes/:classCode` | backend/server.js:909 | oui | `PATCH /api/classes/:classCode` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | updateSchoolClass | 400 | MOYEN | **0** | — |
| `DELETE /api/classes/:classCode/head-teacher` | backend/server.js:975 | oui | `DELETE /api/classes/:classCode/head-teacher` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | removeClassHeadTeacher | 400 | MOYEN | **0** | — |
| `PUT /api/classes/:classCode/head-teacher` | backend/server.js:949 | oui | `PUT /api/classes/:classCode/head-teacher` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | assignClassHeadTeacher | 400 | MOYEN | **0** | — |
| `GET /api/classes/:classCode/head-teacher/candidates` | backend/server.js:926 | oui | `GET /api/classes/:classCode/head-teacher/candidates` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | listClassHeadTeacherCandidates | 400 | FAIBLE | **0** | — |
| `POST /api/classes/:classCode/student-cards/batches` | backend/server.js:2304 | oui | `POST /api/classes/:classCode/student-cards/batches` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | MOYEN | 1 | — |
| `GET /api/classes/:classCode/student-cards/batches/:batchId` | backend/server.js:2321 | oui | `GET /api/classes/:classCode/student-cards/batches/:batchId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | FAIBLE | 1 | — |
| `POST /api/classes/:classCode/student-cards/batches/:batchId/abort` | backend/server.js:2374 | oui | `POST /api/classes/:classCode/student-cards/batches/:batchId/abort` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | MOYEN | 1 | — |
| `POST /api/classes/:classCode/student-cards/batches/:batchId/activate` | backend/server.js:2356 | oui | `POST /api/classes/:classCode/student-cards/batches/:batchId/activate` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | MOYEN | 1 | — |
| `POST /api/classes/:classCode/student-cards/batches/:batchId/receipt` | backend/server.js:2338 | oui | `POST /api/classes/:classCode/student-cards/batches/:batchId/receipt` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | MOYEN | 1 | — |
| `GET /api/classes/:classCode/student-cards/preflight` | backend/server.js:2291 | oui | `GET /api/students/:id/cards` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | — | — | — | — | FAIBLE | **0** | — |
| `GET /api/course-schedule-replacements` | backend/server.js:1256 | oui | `GET /api/course-schedule-replacements` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER | — | — | listCourseScheduleReplacements | — | FAIBLE | **0** | — |
| `POST /api/course-schedule-replacements` | backend/server.js:1262 | oui | `POST /api/course-schedule-replacements` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | createCourseScheduleReplacement | — | MOYEN | **0** | — |
| `DELETE /api/course-schedule-replacements/:replacementId` | backend/server.js:1293 | oui | `DELETE /api/course-schedule-replacements/:replacementId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | cancelCourseScheduleReplacement | — | MOYEN | **0** | — |
| `PATCH /api/course-schedule-replacements/:replacementId` | backend/server.js:1281 | oui | `PATCH /api/course-schedule-replacements/:replacementId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | updateCourseScheduleReplacement | — | MOYEN | **0** | — |
| `GET /api/course-schedule-replacements/options` | backend/server.js:1250 | oui | `GET /api/course-schedule-replacements/options` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listReplacementTeacherOptions | — | FAIBLE | **0** | — |
| `GET /api/course-schedules` | backend/server.js:1118 | oui | `GET /api/course-schedules` | assertPlanningReadable | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | scope/tenant | — | listCourseSchedules | — | FAIBLE | 3 | — |
| `POST /api/course-schedules` | backend/server.js:1160 | oui | `POST /api/course-schedules` | assertPlanningReadable | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | createCourseSchedule | — | MOYEN | 3 | — |
| `DELETE /api/course-schedules/:scheduleId` | backend/server.js:1195 | oui | `DELETE /api/course-schedules/:scheduleId` | assertPlanningReadable | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | deleteCourseSchedule | 501 | MOYEN | 1 | — |
| `PATCH /api/course-schedules/:scheduleId` | backend/server.js:1181 | oui | `PATCH /api/course-schedules/:scheduleId` | assertPlanningReadable | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | updateCourseSchedule | — | MOYEN | 1 | — |
| `GET /api/courses` | backend/server.js:1096 | oui | `GET /api/courses` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER | scope/tenant | — | — | — | FAIBLE | **0** | — |
| `POST /api/courses` | backend/server.js:1133 | oui | `POST /api/courses` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | createSchoolCourse | — | MOYEN | **0** | — |
| `DELETE /api/courses/:courseId` | backend/server.js:1150 | oui | `DELETE /api/courses/:courseId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | deleteSchoolCourse | — | MOYEN | **0** | — |
| `PATCH /api/courses/:courseId` | backend/server.js:1139 | oui | `PATCH /api/courses/:courseId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | updateSchoolCourse | — | MOYEN | **0** | — |
| `GET /api/education-reference/catalog` | backend/server.js:1967 | oui | `GET /api/education-reference/catalog` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | getEducationSchoolCatalog | — | FAIBLE | **0** | — |
| `PUT /api/education-reference/school-activation` | backend/server.js:1975 | oui | `PUT /api/education-reference/school-activation` | assertSchoolAccess | SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | saveSchoolEducationActivation | — | MOYEN | **0** | — |
| `GET /api/mobile-sync/l1/assignments` | backend/server.js:839 | oui | `GET /api/mobile-sync/l1/assignments` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, TEACHER | scope/tenant | — | — | — | FAIBLE | 1 | — |
| `GET /api/mobile-sync/l1/classes` | backend/server.js:803 | oui | `GET /api/mobile-sync/l1/classes` | — | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, SUPER_ADMIN, TEACHER | scope/tenant | — | — | — | FAIBLE | 4 | — |
| `GET /api/mobile-sync/l1/course-schedules` | backend/server.js:875 | oui | `GET /api/mobile-sync/l1/course-schedules` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | scope/tenant | — | — | — | FAIBLE | 1 | — |
| `GET /api/mobile-sync/l1/school-courses` | backend/server.js:857 | oui | `GET /api/mobile-sync/l1/school-courses` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, TEACHER | scope/tenant | — | — | — | FAIBLE | 1 | — |
| `GET /api/mobile-sync/l1/students` | backend/server.js:821 | oui | `GET /api/mobile-sync/l1/students` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, TEACHER | scope/tenant | — | — | — | FAIBLE | 2 | — |
| `GET /api/school-documents` | backend/server.js:1843 | oui | `GET /api/school-documents` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listSchoolDocuments | — | FAIBLE | 1 | — |
| `POST /api/school-documents` | backend/server.js:1848 | oui | `POST /api/school-documents` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | createSchoolDocument | — | MOYEN | 1 | — |
| `PATCH /api/school-documents/:documentId` | backend/server.js:1854 | oui | `PATCH /api/school-documents/:documentId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | patchSchoolDocument | — | MOYEN | **0** | — |
| `POST /api/school-documents/:documentId/archive` | backend/server.js:1860 | oui | `POST /api/school-documents/:documentId/archive` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | archiveSchoolDocument | — | MOYEN | **0** | — |
| `GET /api/school-rooms` | backend/server.js:1214 | oui | `GET /api/school-rooms` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER | — | — | listSchoolRooms | — | FAIBLE | **0** | — |
| `POST /api/school-rooms` | backend/server.js:1220 | oui | `POST /api/school-rooms` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | createSchoolRoom | — | MOYEN | **0** | — |
| `DELETE /api/school-rooms/:roomId` | backend/server.js:1239 | oui | `DELETE /api/school-rooms/:roomId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | archiveSchoolRoom | — | MOYEN | **0** | — |
| `PATCH /api/school-rooms/:roomId` | backend/server.js:1227 | oui | `PATCH /api/school-rooms/:roomId` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | updateSchoolRoom | — | MOYEN | **0** | — |
| `GET /api/school-settings` | backend/server.js:1554 | oui | `GET /api/school-settings` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | getSchoolSettings | — | FAIBLE | **0** | — |
| `PATCH /api/school-settings` | backend/server.js:1564 | oui | `PATCH /api/school-settings` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | patchSchoolSettings | — | MOYEN | **0** | — |
| `GET /api/teachers` | backend/server.js:3153 | oui | `GET /api/teachers` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | listSchoolTeachers | 400 | FAIBLE | 5 | — |
| `POST /api/teachers` | backend/server.js:3214 | oui | `POST /api/teachers` | — | SCHOOL_ADMIN | — | — | — | 403 | MOYEN | 5 | — |
| `DELETE /api/teachers/:teacherCode` | backend/server.js:3256 | oui | `DELETE /api/teachers/:teacherCode` | assertSchoolAccess, canResetUserPassword | PREFET_ETUDES | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | archiveSchoolTeacher, getClientsStore | 400 | MOYEN | **0** | — |
| `GET /api/teachers/:teacherCode` | backend/server.js:3185 | oui | `GET /api/teachers/:teacherCode` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | getSchoolTeacherByCode | 400 | FAIBLE | **0** | — |
| `PATCH /api/teachers/:teacherCode` | backend/server.js:3221 | oui | `PATCH /api/teachers/:teacherCode` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | updateSchoolTeacher | 400 | MOYEN | **0** | — |
| `GET /api/v2/academic-years` | backend/server.js:4772 | oui | `GET /api/v2/academic-years` | assertAcademicYearReadable | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER | — | — | getAcademicYearsV2 | — | FAIBLE | 1 | — |
| `POST /api/v2/academic-years` | backend/server.js:4784 | oui | `POST /api/v2/academic-years` | — | SCHOOL_ADMIN, SUPER_ADMIN | schoolId | — | createAcademicYearV2 | — | MOYEN | 1 | — |
| `PATCH /api/v2/academic-years/:id` | backend/server.js:4806 | oui | `PATCH /api/v2/academic-years/:id` | assertAcademicYearPatchAccess | SCHOOL_ADMIN, SUPER_ADMIN | — | — | getAcademicYearV2ById, updateAcademicYearV2 | 404 | MOYEN | 1 | — |
| `GET /api/v2/documents` | backend/server.js:4830 | oui | `GET /api/v2/documents` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | scope/tenant | — | getDocumentsV2 | — | FAIBLE | **0** | — |
| `GET /api/v2/reports/advanced` | backend/server.js:4835 | oui | `GET /api/v2/reports/advanced` | — | ACCOUNTANT, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | — | — | FAIBLE | **0** | — |
| `GET /api/v2/school-setup/guided` | backend/server.js:4743 | oui | `GET /api/v2/school-setup/guided` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | — | — | FAIBLE | **0** | — |
| `POST /api/v2/school-setup/guided/steps/:stepKey/complete` | backend/server.js:4757 | oui | `POST /api/v2/school-setup/guided/steps/:stepKey/complete` | — | SCHOOL_ADMIN, SUPER_ADMIN | — | — | — | — | MOYEN | **0** | — |
| `GET /api/v2/school-setup/status` | backend/server.js:4730 | oui | `GET /api/v2/school-setup/status` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | — | — | FAIBLE | 1 | — |
| `GET /api/v2/subjects` | backend/server.js:4671 | oui | `GET /api/v2/subjects` | isSuperAdminPrincipal | COUNTRY_ADMIN, PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, SUPERVISOR, SUPER_ADMIN, TEACHER | principal.schoolCode, scope/tenant | 400 | getSubjectsV2 | 400 | FAIBLE | **0** | — |
| `POST /api/v2/subjects` | backend/server.js:4698 | oui | `POST /api/v2/subjects` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | createSubject | 400 | MOYEN | **0** | — |
| `DELETE /api/v2/subjects/:code` | backend/server.js:4710 | oui | `DELETE /api/v2/subjects/:code` | assertSchoolAccess | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, principal.schoolCode, scope/tenant | 400 | deleteSubject | 400 | MOYEN | **0** | — |

### H. Plateforme, établissements et abonnements

| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /api/audit` | backend/server.js:4659 | oui | `GET /api/audit` | — | aucun | — | — | — | — | FAIBLE | 1 | — |
| `GET /api/backoffice/countries` | backend/server.js:3655 | oui | `GET /api/backoffice/countries` | — | COUNTRY_ADMIN, SUPER_ADMIN | scope/tenant | — | listPlatformProjection | — | FAIBLE | 3 | — |
| `POST /api/backoffice/countries` | backend/server.js:3680 | oui | `POST /api/backoffice/countries` | — | SUPER_ADMIN | — | — | createPlatformCountry | — | MOYEN | 3 | — |
| `PATCH /api/backoffice/countries/:code` | backend/server.js:3686 | oui | `PATCH /api/backoffice/countries/:code` | — | SUPER_ADMIN | — | — | updatePlatformCountry | — | MOYEN | **0** | — |
| `GET /api/backoffice/dashboard-chart-config` | backend/server.js:3826 | oui | `GET /api/backoffice/dashboard-chart-config` | — | SUPER_ADMIN | — | — | listPlatformProjection | — | FAIBLE | **0** | — |
| `PUT /api/backoffice/dashboard-chart-config` | backend/server.js:3831 | oui | `PUT /api/backoffice/dashboard-chart-config` | — | SUPER_ADMIN | — | — | savePlatformDashboardChartConfig | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishment-documents` | backend/server.js:2062 | oui | `GET /api/backoffice/establishment-documents` | — | PARENT, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY, STUDENT, TEACHER | — | — | listSchoolDocuments | — | FAIBLE | **0** | — |
| `PUT /api/backoffice/establishment-documents` | backend/server.js:2067 | oui | `PUT /api/backoffice/establishment-documents` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SECRETARY | — | — | — | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments` | backend/server.js:4419 | oui | `GET /api/backoffice/establishments` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | — | — | FAIBLE | **0** | — |
| `POST /api/backoffice/establishments` | backend/server.js:4435 | oui | `POST /api/backoffice/establishments` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | **0** | — |
| `DELETE /api/backoffice/establishments/:code` | backend/server.js:4555 | oui | `DELETE /api/backoffice/establishments/:code` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | 1 | — |
| `GET /api/backoffice/establishments/:code` | backend/server.js:4430 | oui | `GET /api/backoffice/establishments/:code` | — | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | — | — | FAIBLE | 1 | — |
| `PATCH /api/backoffice/establishments/:code` | backend/server.js:4477 | oui | `PATCH /api/backoffice/establishments/:code` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | 1 | — |
| `PATCH /api/backoffice/establishments/:code/activate` | backend/server.js:4535 | oui | `PATCH /api/backoffice/establishments/:code` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | **0** | — |
| `DELETE /api/backoffice/establishments/:code/logo` | backend/server.js:4515 | oui | `DELETE /api/backoffice/establishments/:code/logo` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | **0** | — |
| `PUT /api/backoffice/establishments/:code/logo` | backend/server.js:4488 | oui | `PUT /api/backoffice/establishments/:code/logo` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments/:code/subscription` | backend/server.js:4425 | oui | `GET /api/backoffice/establishments/:code` | — | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | — | — | — | — | FAIBLE | **0** | — |
| `PATCH /api/backoffice/establishments/:code/suspend` | backend/server.js:4545 | oui | `PATCH /api/backoffice/establishments/:code` | — | COUNTRY_ADMIN, SCHOOL_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments/:schoolCode/academic-config` | backend/server.js:1473 | oui | `GET /api/backoffice/establishments/:schoolCode/academic-config` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | getAcademicConfig | — | FAIBLE | **0** | — |
| `PUT /api/backoffice/establishments/:schoolCode/academic-config` | backend/server.js:1480 | oui | `PUT /api/backoffice/establishments/:schoolCode/academic-config` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | createTxScope, invalidateCachedDataset, withTransaction | — | MOYEN | **0** | — |
| `PUT /api/backoffice/establishments/:schoolCode/academic-periods` | backend/server.js:1641 | oui | `PUT /api/backoffice/establishments/:schoolCode/academic-periods` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | replaceAcademicPeriods | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments/:schoolCode/education-reference/catalog` | backend/server.js:1984 | oui | `GET /api/backoffice/establishments/:schoolCode/education-reference/catalog` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | getEducationSchoolCatalog | — | FAIBLE | **0** | — |
| `PUT /api/backoffice/establishments/:schoolCode/education-reference/school-activation` | backend/server.js:1996 | oui | `PUT /api/backoffice/establishments/:schoolCode/education-reference/school-activation` | assertSchoolAccess | SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | saveSchoolEducationActivation | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments/:schoolCode/evaluation-types` | backend/server.js:1710 | oui | `GET /api/backoffice/establishments/:schoolCode/evaluation-types` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | listEvaluationTypes | — | FAIBLE | **0** | — |
| `POST /api/backoffice/establishments/:schoolCode/evaluation-types` | backend/server.js:1721 | oui | `POST /api/backoffice/establishments/:schoolCode/evaluation-types` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | createEvaluationType | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/establishments/:schoolCode/evaluation-types/:typeId` | backend/server.js:1735 | oui | `PATCH /api/backoffice/establishments/:schoolCode/evaluation-types/:typeId` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | updateEvaluationType | — | MOYEN | **0** | — |
| `POST /api/backoffice/establishments/:schoolCode/evaluation-types/:typeId/archive` | backend/server.js:1750 | oui | `POST /api/backoffice/establishments/:schoolCode/evaluation-types/:typeId/archive` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | archiveEvaluationType | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments/:schoolCode/notification-settings` | backend/server.js:1615 | oui | `GET /api/backoffice/establishments/:schoolCode/notification-settings` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | — | — | FAIBLE | **0** | — |
| `PATCH /api/backoffice/establishments/:schoolCode/notification-settings` | backend/server.js:1625 | oui | `PATCH /api/backoffice/establishments/:schoolCode/notification-settings` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | — | — | MOYEN | **0** | — |
| `PUT /api/backoffice/establishments/:schoolCode/notification-settings` | backend/server.js:1633 | oui | `PUT /api/backoffice/establishments/:schoolCode/notification-settings` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | — | — | MOYEN | **0** | — |
| `GET /api/backoffice/establishments/:schoolCode/school-settings` | backend/server.js:1592 | oui | `GET /api/backoffice/establishments/:schoolCode/school-settings` | assertSchoolAccess | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | getSchoolSettings | — | FAIBLE | **0** | — |
| `PATCH /api/backoffice/establishments/:schoolCode/school-settings` | backend/server.js:1601 | oui | `PATCH /api/backoffice/establishments/:schoolCode/school-settings` | assertSchoolAccess | PREFET_ETUDES, SCHOOL_ADMIN, SUPER_ADMIN | assert*School/Tenant, scope/tenant | — | patchSchoolSettings | — | MOYEN | **0** | — |
| `POST /api/backoffice/establishments/import` | backend/server.js:4448 | oui | `POST /api/backoffice/establishments/import` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | listEstablishments, persistEstablishment | — | MOYEN | **0** | — |
| `GET /api/backoffice/platform-compliance` | backend/server.js:3670 | oui | `GET /api/backoffice/platform-compliance` | — | SUPER_ADMIN | — | — | — | — | FAIBLE | **0** | — |
| `GET /api/backoffice/subscription-access` | backend/server.js:4401 | oui | `GET /api/backoffice/subscription-access` | assertSubscriptionAccessForPrincipal | COUNTRY_ADMIN, PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN, SUPER_ADMIN | principal.schoolCode | — | getPlatformSchoolByCode | — | FAIBLE | **0** | anomaly.A2-subscription-iso-date |
| `POST /api/backoffice/subscription-discounts` | backend/server.js:3861 | oui | `POST /api/backoffice/subscription-discounts` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | createPlatformSubscriptionDiscount | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/subscription-discounts/:discountId` | backend/server.js:3867 | oui | `PATCH /api/backoffice/subscription-discounts/:discountId` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | updatePlatformSubscriptionDiscount | — | MOYEN | **0** | — |
| `POST /api/backoffice/subscription-offers` | backend/server.js:3837 | oui | `POST /api/backoffice/subscription-offers` | — | SUPER_ADMIN | — | — | upsertPlatformSubscriptionOffer | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/subscription-offers/:offerId` | backend/server.js:3843 | oui | `PATCH /api/backoffice/subscription-offers/:offerId` | — | SUPER_ADMIN | — | — | upsertPlatformSubscriptionOffer | — | MOYEN | **0** | — |
| `POST /api/backoffice/subscription-payments` | backend/server.js:3849 | oui | `POST /api/backoffice/subscription-payments` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | createPlatformSubscriptionPayment | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/subscription-payments/:paymentId` | backend/server.js:3855 | oui | `PATCH /api/backoffice/subscription-payments/:paymentId` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | updatePlatformSubscriptionPayment | — | MOYEN | **0** | — |
| `GET /api/backoffice/subscriptions` | backend/server.js:3660 | oui | `GET /api/backoffice/subscriptions` | — | COUNTRY_ADMIN, SUPER_ADMIN | scope/tenant | — | listPlatformProjection | — | FAIBLE | **0** | — |
| `POST /api/backoffice/subscriptions` | backend/server.js:3692 | oui | `POST /api/backoffice/subscriptions` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | upsertPlatformSubscription | — | MOYEN | **0** | — |
| `PATCH /api/backoffice/subscriptions/:subscriptionId` | backend/server.js:3698 | oui | `PATCH /api/backoffice/subscriptions/:subscriptionId` | — | COUNTRY_ADMIN, SUPER_ADMIN | — | — | upsertPlatformSubscription | — | MOYEN | **0** | — |
| `GET /api/backoffice/trial-requests` | backend/server.js:3665 | oui | `GET /api/backoffice/trial-requests` | — | SUPER_ADMIN | — | — | — | — | FAIBLE | **0** | — |
| `GET /api/dashboard/school-activities` | backend/server.js:767 | oui | — | — | — | — | — | — | — | MOYEN | 1 | — |
| `GET /api/data-export` | backend/server.js:1542 | oui | `GET /api/data-export` | — | PREFET_ETUDES, PROVISEUR, SCHOOL_ADMIN | — | — | — | — | FAIBLE | 1 | — |
| `GET /api/mvp/dashboard` | backend/server.js:4856 | oui | — | 403 explicite, assertMvpAccess, canAccessBackOfficeRole | — | — | — | getDataset, listClientsAuthAccounts | 403 | MOYEN | **0** | — |
| `GET /api/mvp/readiness` | backend/server.js:4844 | oui | — | assertMvpAccess | — | — | — | — | — | MOYEN | **0** | — |
| `GET /api/mvp/snapshot` | backend/server.js:4850 | oui | — | assertMvpAccess | — | — | — | — | — | MOYEN | **0** | — |
| `POST /api/public/trial-requests` | backend/server.js:583 | **non** | — | — | — | scope/tenant | — | — | — | MOYEN | **0** | — |
| `GET /api/schools/:code` | backend/server.js:389 | **non** | — | — | — | — | — | — | 404 | FAIBLE | 1 | authSessions |
| `GET /api/schools/:code/logo` | backend/server.js:403 | **non** | — | — | — | — | — | — | 404 | FAIBLE | **0** | — |
