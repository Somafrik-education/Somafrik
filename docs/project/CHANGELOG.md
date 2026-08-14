# Changelog — Somafrik

Toutes les évolutions notables de ce projet sont documentées dans ce fichier.

Le format s’inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning sémantique](https://semver.org/lang/fr/) pour les releases produit ([RELEASES.md](./RELEASES.md)).

**Règle :** toute PR mergée qui change le comportement observable ou l’architecture doit ajouter une entrée ici (sous `[Unreleased]` puis bascule à la release).

---

## [Unreleased]

### Added

- **LOT 6 — Export versionné + lockout PostgreSQL** : `GET /api/data-export` enveloppe `somafrik-export` v1 (domaines réellement lus : `schoolSettings`, `students`, `classes`, `teachers`, `audit` Superadmin) ; aucun secret ; tenant JWT (Admin School ignore le `schoolCode` query) ; audit `export_school_data` sans payload. Restauration globale Web **retirée** ; `DataContext.update({ partial: false })` refusé. Lockout : table `login_lockouts` SoT (clé `school_scope` + `identifier_normalized`, `INSERT … ON CONFLICT` atomique, 5 échecs / 15 min) ; plus de `Map` processus en runtime PG ; `POST /api/backoffice/e2e/clear-login-lockout` = 404 hors `SOMAFRIK_E2E` non-prod ; `SOMAFRIK_DISABLE_LOGIN_LOCKOUT` interdit en production.
- **LOT 5 — Examens, bulletins et documents canoniques** : SoT unique `exams` / `exam_results` (pas de 3e table) ; `report_cards` = publication (notes restent dans `grades`) ; `report_card_templates` = layout de rendu ; `school_documents` = métadonnées. CRUD `/api/exams`, `/api/report-cards`, `/api/report-card-templates`, `/api/school-documents`. PUT residual `planning-exams` / `report-cards` / `establishment-documents` → `400 LEGACY_*_WRITE_FORBIDDEN`. Boot fail-closed : preflight → inventaire residual/statuts **avant** toute mutation DDL/data ; STOP `LEGACY_EXAMS_AMBIGUOUS` / `LEGACY_REPORT_CARDS_AMBIGUOUS` / `LEGACY_DOCUMENTS_AMBIGUOUS` / `LEGACY_EXAM_STATUS_AMBIGUOUS` ; conversion déterministe `published` → `completed` uniquement. Overlay `getAuthoritativeBackOfficeState` = projection PG uniquement. Web Planning / Bulletins / Conception branchés sur les APIs canoniques.
- **LOT 4 Paramètres — Paramètres établissement** : table canonique `school_settings` (`period_mode`, `default_scale`, `report_card_mode`) ; périodes = projection `terms` (pas de table `periods` doublon) ; `GET/PATCH /api/school-settings` et `PUT /api/academic-periods` (tenant JWT) ; `PUT /api/academic-config` refuse les clés migrées (`LEGACY_SCHOOL_*_WRITE_FORBIDDEN`) ; `GET /api/academic-config` = projection PostgreSQL ; boot fail-closed `LEGACY_SCHOOL_SETTINGS_AMBIGUOUS` ; capture des scalaires B **avant** strip JSON puis matérialisation PG vérifiée ; trigger `AFTER INSERT ON schools` + matérialisation à la lecture (pas de fallback mémoire) ; Web Paramètres année scolaire sur les APIs canoniques ; classes/matières en lecture seule.
- **LOT 3 Paramètres — Types d'évaluation** : table canonique `evaluation_types` scopée établissement ; CRUD `/api/evaluation-types` (tenant JWT) et `/api/backoffice/establishments/:schoolCode/evaluation-types` ; `PUT /api/academic-config` refuse `evaluationTypes` (`LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN`) ; `evaluations.evaluation_type_id` = SoT, TEXT = projection ; boot fail-closed `LEGACY_EVALUATION_TYPES_AMBIGUOUS` (catalogue JSON exactement équivalent aux 8 défauts, sinon STOP) ; création d’évaluation authentifiée sans type → `400 EVALUATION_TYPE_REQUIRED` ; Web/Mobile chargent le catalogue API sans fallback `data.js`.
- **LOT 2 Paramètres — Rôles généraux d'établissement** : tables canoniques `establishment_roles`, `establishment_role_permissions`, `establishment_role_delegation_permissions` ; CRUD Superadmin via `/api/backoffice/establishment-roles` ; lecture assignable via `/api/establishment-roles/assignable` ; `PUT /api/academic-config` refuse `userRoles` (`LEGACY_USER_ROLES_WRITE_FORBIDDEN`) ; JWT dérivé de la matrice PostgreSQL (plateforme + établissement) ; Web Paramètres/Rôles en lecture seule sur le catalogue.
- **LOT 1 Paramètres — Référentiels pédagogiques Superadmin** : tables canoniques `education_levels`, `education_streams`, `school_levels`, `school_streams` scopées par pays ; CRUD Superadmin via `/api/backoffice/education-levels` et `/api/backoffice/education-streams` ; activation établissement via `/api/education-reference/*` ; `PUT /api/academic-config` refuse toute présence de `levels` ou `tracks` (`LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN` / `LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN`) ; inventaire legacy fail-safe sans migration automatique ambiguë ; audit transactionnel.
- **LOT 5 — Pédagogie PostgreSQL** : cours, emplois du temps, évaluations, notes et présences passent par des APIs dédiées persistées en PostgreSQL ; `PUT /api/backoffice/state` refuse toute présence des clés pédagogiques (`LEGACY_PEDAGOGY_STATE_WRITE_FORBIDDEN`) ; `GET state` projette la pédagogie uniquement depuis PostgreSQL ; audit transactionnel sur les écritures sensibles.
- **LOT 4 — Finance PostgreSQL** : paiements, grilles, obligations, allocations, reminders et annulations passent par des APIs dédiées persistées en PostgreSQL ; `PUT /api/backoffice/state` refuse toute présence des clés Finance (`LEGACY_FINANCE_STATE_WRITE_FORBIDDEN`) ; `GET state` projette Finance uniquement depuis PostgreSQL, sans fusion JSON historique ni backfill ; l'audit `create_payment` / `cancel_payment` est écrit dans la même transaction PostgreSQL que l'effet métier (`cancelled_by` persisté ; rollback complet si l'audit échoue).
- **LOT 3 — Enseignants / affectations PostgreSQL** : `POST/PATCH/DELETE /api/assignments` fournit le CRUD d'affectations scopé établissement ; `PUT /api/backoffice/state` refuse toute présence de `teachers` ou `assignments` avec codes stables fail-closed ; `state.teachers` et `state.assignments` deviennent des projections PostgreSQL read-only.
- **LOT 2 — Élèves PostgreSQL** : inscription via `POST /api/classes/:classCode/students`, liste/fiche/modification via `GET/PATCH /api/students` ; `PUT /api/backoffice/state` refuse toute présence de `students` (`LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN`, y compris PUT mixte et snapshot) avant toute mutation ; `state.students` devient une projection de lecture PostgreSQL.
- **LOT 1 — Établissements PostgreSQL** : CRUD `/api/backoffice/establishments` persiste la table `schools` (`profile_payload` JSONB) ; `PUT /api/backoffice/state` refuse **toute présence** de `schools` (`LEGACY_SCHOOLS_STATE_WRITE_FORBIDDEN`, y compris payload mixte / snapshot) sans mutation partielle ; pays hors référentiel refusé (`COUNTRY_NOT_FOUND`) sans inventer `phone_code` / `currency` ; `state.schools` reste une projection de lecture.
- Lot V2.1a : package `@somafrik/auth-v2` avec rôles canoniques, contrat immuable `AuthPrincipal` et évaluation fail-closed `can(principal, permission)` (sans JWT, session, HTTP ni alias legacy).
- Ouverture du chantier de reconstruction contrôlée Somafrik V2 : structure `apps/` / `packages/` / `tests/v2/`, premier invariant tenant scope et garde-fou CI des frontières legacy.
- Gouvernance documentaire officielle sous `docs/project/` (ROADMAP, ARCHITECTURE, CHANGELOG, RELEASES, CONTRIBUTING, DECISIONS) — PR #82.
- Extension gouvernance SaaS : [TESTING.md](./TESTING.md), [SECURITY.md](./SECURITY.md), [OPERATIONS.md](./OPERATIONS.md), [DATABASE.md](./DATABASE.md).
- Règle CONTRIBUTING : PR fonctionnelle incomplète sans mise à jour doc de gouvernance lorsque nécessaire.

### Changed

- **LOT 2 correctifs CTO** : matrice `getPermissionsMap()` inclut les rôles actifs sans permission (LEFT JOIN) ; `mergeRolePermissions` fail-closed sans fallback dashboard ; bootstrap `role_permissions` plateforme ; canonicalisation du rôle sur `PATCH` utilisateur ; tests permissions vides / roleCode / rôle absent. (`courses`, `courseSchedules`, `evaluations`, `notes`, `presences`) retirées des writables PUT ; Web, Mobile et BackOffice les omettent des snapshots.
- `saveBackOfficeState` ne persiste plus les projections Pédagogie dans `backoffice_state` et n'effectue aucun dual-write JSON.
- Matrice S1.4 : clés Finance (`payments`, `paymentStatuses`, `feeGrids`, `schoolFeeItems`, `studentFees`, `feeTariffHistory`, `paymentReminders`) retirées des writables PUT ; Web, Mobile et BackOffice les omettent des snapshots.
- `saveBackOfficeState` ne persiste plus les projections Finance dans `backoffice_state` et n'effectue aucun dual-write JSON.
- Matrice S1.4 : `teachers` et `assignments` retirés des clés writables ; Web, Mobile et BackOffice ne les incluent plus dans les PUT globaux, et les interfaces d'affectation utilisent les APIs dédiées.
- `saveBackOfficeState` ne déclenche plus `syncPedagogyStaffDomainFromBackOffice` et ne persiste plus les projections enseignants/affectations dans `backoffice_state`.
- Matrice S1.4 : `students` retiré de toutes les clés writables via PUT state ; Web, Mobile et BackOffice omettent la projection élèves des snapshots envoyés.
- Le `saveBackOfficeState` PostgreSQL ne déclenche plus `syncStudentsDomainFromBackOffice` et ne persiste plus `students` dans `backoffice_state`.
- Matrice S1.4 : `schools` retiré des clés writables Admin Pays / Super Admin sur PUT state (LOT 1).
- Web `DataContext` : strip `schools` avant PUT, comme `auditLog`.
- Mobile `saveBackOfficeState` et BackOffice `getBackOfficeStatePayload` : `schools` omis du PUT (toute présence est un 400 serveur).
- Mobile AdminCrud : CRUD établissements retiré (lecture web `/etablissements`).

### Removed

- Writers Finance legacy Web/Mobile/BackOffice et toute écriture snapshot `payments*` / `fee*` / reminders via PUT state.
- Writers élèves legacy Web/Mobile/BackOffice et synchronisation JSON `students[]` → PostgreSQL déclenchée par PUT state.
- Écriture snapshot `backoffice_state.schools` via PUT state et via `saveEstablishmentState` pour le CRUD establishments.

---

## [1.0.0-preprod] — 2026-07-26

Jalonnement préproduction MVP — base `develop` après HOTFIX-RBAC-ADMIN-01 (#81).

### Added

- **D2.8 — EntityPage** (a→e) : extraction colonnes, options select, noyau CRUD, workflows affectations / contacts / relations / paiements, nettoyage assembleur.
- **D3.2 — Classes** : audit D3.2a, liste D3.2b, membres D3.2c (tag `d3.2a`).
- **D3.3 — Enseignants** : liste via EntityPage.
- **D3.4 — Parents** : audit + contrat d’identité `contactId` (D3.4b).
- **D3.5 — Présences** : contrat + persistance PG canonique.
- **D3.6 — Notes** : contrat PG, ToolLayout `/notes`, sync évaluations.
- **HOTFIX-SYNC-01** : outbox non destructive + ACK.
- **HOTFIX-SYNC-02** : rattachement évaluations / `syncError` visible.
- **HOTFIX-SYNC-03** : RBAC enseignant `evaluations` + `notes` (#79).
- **HOTFIX-RBAC-ADMIN-01** : classes/enseignants sans `auditLog` client ; audit serveur (#81).
- Filet CI `verify:runtime-bootstrap` (post P0 AUTH).
- Inscriptions élèves C1.8a / C1.8b (valider, affecter, transfert, clôture).

### Changed

- Matrice d’écriture `PUT /backoffice/state` fail-closed par rôle (S1.4).
- Notes UI et EntityPage classes/enseignants : plus d’envoi client de `auditLog`.
- DataContext : strip systématique de `auditLog` avant PUT.

### Fixed

- Sync enseignant bloquée (`Permission insuffisante…`) — KNOWN-ISSUE-NOTES-01 clôturée par SYNC-03.
- Création classe/enseignant rejetée à cause de `auditLog` client — RBAC-ADMIN-01.
- Rattachement évaluations en échec silencieux — SYNC-02.

### Removed

- Écriture client de `auditLog` pour Notes, classes, enseignants, affectations (reste interdit pour tous les rôles).

### Security

- S1.3 sanitization réponses utilisateur.
- S1.4 RBAC backoffice + MVP.
- S2.1 JWT header-only (plus de token en query).
- S2.2 / S2.2.1 durcissement config DB.
- S2.3 mobile SecureStore / HTTPS.
- S2.4 CI Security (Secrets, Security, TypeScript, Lint, Tests, Audit).

---

## Légende des sections

| Section | Usage |
|---------|-------|
| **Added** | Nouvelles fonctionnalités |
| **Changed** | Changements de comportement rétrocompatibles ou migrations |
| **Fixed** | Corrections de bugs |
| **Removed** | Suppressions / dépréciations effectives |
| **Security** | Correctifs ou durcissements sécurité |
