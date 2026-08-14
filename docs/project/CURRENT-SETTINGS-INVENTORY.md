# Inventaire / audit des paramètres actuels — Somafrik

| | |
|--|--|
| **Nature** | Inventaire factuel uniquement. **Aucun correctif**, aucune migration, aucune mutation métier. |
| **Dépôt** | `Somafrik-education/Somafrik` |
| **Branche de base** | `develop` |
| **SHA de base** | `0a9513cfcd6b933b013f25e3ade438575a73161b` (merge PR #172 — teachers lifecycle) |
| **Périmètre** | Web, Mobile, Backend, BackOffice résiduel ; PostgreSQL, JSONB, env, config statique, localStorage, mémoire processus |
| **Méthode** | Code réellement exécuté (routes `backend/server.js`, loaders Web/Mobile, stores PG, overlays). Un écran existant n’est pas considéré fonctionnel s’il n’écrit pas ou n’appelle pas d’API. |

Document complémentaire (état LOT 8, partiellement daté sur les chemins) : `docs/project/LEGACY-BACKOFFICE-INVENTORY.md`. Le présent inventaire **prime** pour l’état actuel des paramètres.

---

## 0. Légende — types de source

Chaque paramètre est classé dans **une** catégorie principale (la plus proche du runtime) :

| Type | Signification |
|------|----------------|
| **Canonique PostgreSQL relationnel** | Tables/colonnes dédiées ; CRUD via APIs métier. |
| **JSONB canonique PG** | Persisté en PostgreSQL mais dans un payload JSON (`config_payload`, `profile_payload`, `establishment_residual_records`). Pas de colonnes métier 1:1. |
| **Lecture legacy résiduelle** | Helper interne `getAuthoritativeBackOfficeState()` (`backend/server.js`) qui **agrège des projections PG** ; le nom est historique. **Ne lit plus** la table `backoffice_state` (`getBackOfficeState()` retourne `null`). |
| **Écriture legacy encore possible** | PUT replace-all sur domaines résiduels (`exams` / `bulletins` / `documents`) ; restore JSON client ; `DataContext.update` résiduel. `PUT/GET /api/backoffice/state` = **410 Gone**. |
| **Config statique / seed / env** | `backend/data.js`, `web/src/lib/internalRoleDefaults.ts`, `Mobile/src/data/catalog.ts`, variables d’environnement. |
| **Calculé / non persisté** | Dérivé en mémoire (session, overlays, défauts si JSON vide). |
| **Fonctionnalité morte / écran résiduel** | Carte « Bientôt », ComingSoon, cartes Mobile sans `route`, helpers non appelés, table `backoffice_state` orpheline. |

Niveaux de risque : **P0** (incohérence métier ou sécurité opérationnelle actuelle), **P1** (double source / RBAC trompeur / dette exploitable), **P2** (UX morte, dette locale), **INFO** (constat sans impact immédiat).

Les **décisions métier CTO** (section 4) décrivent une **cible validée, non implémentée**. Elles ne modifient ni l’état constaté ni les niveaux de risque.

---

## 1. Cartographie du menu / écran Paramètres (Web)

### 1.1 Entrée et filtrage

| Élément | Fichier / fonction | Comportement réel |
|---------|-------------------|-------------------|
| Route hub | `web/src/App.tsx` — `/parametres` dans `PermissionRoute view="settings"` + `ParametresLayout` | Layout : `web/src/pages/parametres/ParametresLayout.tsx` |
| Grille de cartes | `SettingsHubPage` / `SETTING_CARDS` | `web/src/pages/parametres/SettingsHubPage.tsx` |
| Superadmin | `SUPERADMIN_SETTING_PATHS` | Uniquement abonnements, graphiques, sécurité, données |
| Admin Pays | `COUNTRY_ADMIN_SETTING_PATHS` | Uniquement abonnements, données |
| Rôles établissement | `canReadView(ctx, card.view)` | Filtrage permission par vue |
| Anciennes URLs | `/configuration` → `/parametres` ; `/conception-bulletins` → `/parametres/documents` ; `/parametres/etablissement` → année scolaire ; `/parametres/utilisateurs` → rôles-droits | Redirects uniquement |

Les cartes marquées `status: "soon"` restent cliquables : elles ouvrent un `ComingSoonState` **sans API**.

### 1.2 Chaque section affichée

| Carte / route | Page exécutée | Données réellement lues | Action persistée ? | Type |
|---------------|---------------|-------------------------|--------------------|------|
| **Mon abonnement** `/parametres/mon-abonnement` | `MonAbonnementPage` + sous-routes factures / paiements / changer-offre / résiliation | APIs abonnements plateforme | **Oui** — tables `subscriptions`, `subscription_*` | Canonique PG |
| **Profil établissement** `/parametres/profil` | `EstablishmentProfilePage` | `activeSchool` (domaine `schools`) | **Oui** — `PATCH /api/backoffice/establishments/:code` | Canonique PG + JSONB profil |
| **Année scolaire** `/parametres/annee-scolaire` | `ConfigurationPage section="annee-scolaire"` | `state.academicConfigs[schoolCode]` (périodes, barème) + catalogue **`evaluation_types`** via `/api/evaluation-types` | **Oui** — PUT academic-config → `school_academic_configs.config_payload` (**pas** `academic_years` / `terms`). Types d’éval = table PG `evaluation_types` (LOT 3), plus le JSON | JSONB PG périodes ; **types = PG canonique** |
| **Structure pédagogique** `/parametres/structure` | `ConfigurationPage section="structure"` | mêmes `academicConfigs` (`levels`, `tracks`, `classNames`, `subjects`) — **pas** `evaluationTypes` aujourd’hui | **Oui** — même PUT JSON ; **pas** sync `classes` / `subjects` / `school_courses`. Vocabulaire niveaux/filières créé par l’école. Cible CTO §4.A/C non implémentée | JSONB PG, dual |
| **Rôles et droits** `/parametres/roles-droits` | `ConfigurationPage section="roles-droits"` | `academicConfigs.userRoles` + `state.rolePermissions` | **Partiel** : liste de rôles → JSON academic-config ; **pilotage** → `PUT /api/backoffice/role-permissions` (**Super Admin uniquement**) | Dual JSONB + `role_permissions` |
| **Documents** `/parametres/documents` | `BulletinDesignPage` | `academicConfigs` (design par classe) + listes classes/matières | **Oui** si Superadmin — PUT academic-config. Page **redirige** les non-Superadmin | JSONB PG |
| **Sécurité** `/parametres/securite` | `SecuritySettingsPage` | Session AuthContext + `state.auditLog` + texte **codé en dur** | **Non** — lecture locale / export CSV client. **Pas** `GET /api/audit` | Calculé + écran trompeur |
| **Données et sauvegarde** `/parametres/donnees` | `DataBackupSettingsPage` | `state` client (domaines déjà chargés) | Export CSV/JSON **local**. Restore appelle `DataContext.update` qui **strippe** écoles/élèves/enseignants/finance/pédagogie/plateforme/clients | Écriture legacy inopérante pour le métier |
| **Finances** `/parametres/finances` | `SettingsFinancePage` | Aucune | **Non** — `ComingSoonState` | Écran résiduel (ops Finance existent ailleurs) |
| **Notifications** `/parametres/notifications` | `SettingsNotificationsPage` | Aucune | **Non** — ComingSoon | Écran résiduel (annonces / `notifications` existent ailleurs) |
| **Apparence** `/parametres/apparence` | `SettingsAppearancePage` | Aucune | **Non** — ComingSoon. Champs `logoUrl` / `primaryColor` existent pourtant sur l’établissement | Écran mort ; données ailleurs |
| **Intégrations** `/parametres/integrations` | `SettingsIntegrationsPage` | Aucune | **Non** — ComingSoon | Écran résiduel |
| **Politique abo pays** `/parametres/abonnements` | `SubscriptionPolicySettingsPage` | `state.countries` + barème `GLOBAL_SUBSCRIPTION_POLICY` | **Oui** — `PATCH /api/backoffice/countries/:code` (`profile_payload.subscriptionPolicy`) | JSONB PG pays |
| **Graphiques** `/parametres/graphiques` | `ChartSettingsPage` → `ChartTypeSettingsPanel` | `dashboardChartConfig` | **Types : oui** (PG, Super Admin). **Périodes graphiques : localStorage uniquement** (`web/src/lib/chartPeriod.ts`) | Dual PG + local |

Hors hub mais liés aux « paramètres » :

| Écran | Route | Rôle |
|-------|-------|------|
| Matrice Superadmin Admin Pays / Admin School | `/administration/permissions` — `PermissionsPage` | Écrit `PUT /api/backoffice/role-permissions` (canonique PG, Super Admin) |
| Utilisateurs métier | modules Utilisateurs / Contacts | APIs `/api/backoffice/users`, `/api/users` |
| Classes, enseignants, élèves, notes, finance | modules opérationnels, **pas** le hub Paramètres | APIs dédiées |

---

## 2. Inventaire par domaine

Convention des fiches : propriétaire métier, UI, API, source, tables, RBAC, scope, validations, chemins alternatifs, dépendances, incohérences, risque.

### 2.1 Paramètres établissement

**Propriétaire métier** : Admin School (profil local) ; Super Admin / Admin Pays (cycle de vie, validation, suspension).

| Paramètre | UI | API | Source actuelle | Tables / colonnes | RBAC lecture / écriture | Scope | Validations | Alternatif / legacy | Dépendances | Incohérences | Risque |
|-----------|----|-----|-----------------|-------------------|-------------------------|-------|-------------|---------------------|-------------|--------------|--------|
| Identité (nom, type, adresse, téléphone, e-mail, logo) | `EstablishmentProfilePage` | `GET/PATCH /api/backoffice/establishments/:code` — `establishmentsApi.update` | Canonique PG + JSONB | `schools.name`, `school_type`, `address`, `phone`, `email`, `logo_url` ; extras dans `profile_payload` (`backend/lib/schoolsManagement.js` `PROFILE_KEYS`) | Lecture : `Établissements:READ` / `Paramètres Établissement:READ`. Écriture : `Établissements:UPDATE` / `Paramètres Établissement:UPDATE`. UI : `canManageEstablishmentSettings` (Admin School + UPDATE, ou Superadmin) | Établissement | `validateSchoolForm` (`web/src/lib/schoolModule.ts`) : types `SCHOOL_TYPES`, contacts | Création/import Superadmin ; `GET /api/schools` **public** (sous-ensemble `toPublicSchool`) | Pays (`country_id`) ; abonnement | Écran Apparence ComingSoon alors que `logoUrl` / `primaryColor` sont dans le profil | P1 |
| Responsable légal | même page | même PATCH | JSONB `profile_payload` (`principalName`, `principalEmail`, `principalPhone`) | `schools.profile_payload` | idem | Établissement | e-mail principal repli sur e-mail école | — | Comptes Admin School distincts (`users`) | Deux notions « responsable » (profil vs user) | INFO |
| Statut / validation / soft-delete | Fiches établissements (hors hub Paramètres) | `PATCH …/activate`, `…/suspend`, `DELETE` | Canonique PG `schools.status` + `profile_payload` (validation*, `deletedAt`) | `schools.status`, `deleted_at`, JSONB | Superadmin / Admin Pays selon `rbacService.routePermissions` | Établissement / pays | Statuts `SCHOOL_STATUSES` | — | Abonnement, login | — | INFO |
| `schoolYear` affiché sur l’école | profil / seed | PATCH établissement | JSONB `profile_payload.schoolYear` défaut `"2025-2026"` (`schoolsManagement.mapEstablishmentRow`) | `schools.profile_payload.schoolYear` | idem PATCH | Établissement | Aucune sync avec `academic_years` | Seed `backend/data.js` | Classes (`academic_year_id`), finance `academic_year` texte | **Deux années scolaires** : label profil vs table `academic_years` | **P1** |
| `primaryColor`, timezone, language, slogan, website | **non exposés** (Apparence = ComingSoon) | PATCH établissement accepte `PROFILE_KEYS` | JSONB | `schools.profile_payload` | idem | Établissement | — | Seed `primaryColor: "#2563EB"` | — | Données orphelines d’écran | P2 |
| Code établissement | lecture seule sur le profil | généré à la création `generateSchoolCode` | Canonique PG | `schools.school_code` UNIQUE | Création : `Établissements:CREATE` | Pays + année calendaire | Format `CC-AAAA-nnnn` | `GET /api/schools` public | Tenant scope partout | Catalogue public sans auth | P1 |

**Écriture canonique ?** Oui pour PATCH establishments. **Legacy PUT state :** 410.

---

### 2.2 Paramètres académiques (JSON `school_academic_configs`)

**Propriétaire métier** : Admin School (Paramètres Établissement) ; Superadmin peut cibler un établissement dans `ConfigurationPage`.

**UI** : `web/src/pages/ConfigurationPage.tsx` — sections `annee-scolaire` (périodes, barème, types d’évaluation, flags custom) et `structure` (niveaux, filières, classNames, subjects).

**API** :

- `GET /api/academic-config` — `requireAuth` + tenant **sans** `requirePermission` (`backend/server.js`).
- `PUT /api/academic-config` — `Gérer planning académique` / `Gérer classes` / `Paramètres Établissement:UPDATE` / `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES`.
- `GET/PUT /api/backoffice/establishments/:schoolCode/academic-config` — mêmes familles de permissions ; utilisé par Web `residualBackOfficeSync.syncResidualBackOfficePatch`.

**Persistance** : `residualPgStore.getAcademicConfig` / `saveAcademicConfig` (`backend/db/residualPgStore.js`) → `school_academic_configs.config_payload` (migration `backend/db/migrations/20260814_residual_state_canonical.sql`).

**Lecture réelle des périodes** (`getAcademicConfig`) :

1. Si `config_payload.periods[]` est non vide → **JSON prioritaire**.
2. Sinon mapping des lignes `terms` (jointure `academic_years`) ou défauts `defaultAcademicPeriods()`.
3. `saveAcademicConfig` **n’écrit que le JSON** ; **aucune** INSERT/UPDATE `terms` / `academic_years`.

Champs JSON typiques : `periodMode`, `periods[]`, `defaultScale`, `reportCardMode`, `allowCustomClasses|Courses|ReportCards`, `classNames`, `subjects` (map classe → matières), `bulletinDesignByClass` (page Documents). `levels` / `tracks` / `userRoles` / `evaluationTypes` : **lecture projection PG uniquement**, écriture interdite.

| Paramètre | Scope | Validations UI | Dual / legacy | Risque |
|-----------|-------|----------------|---------------|--------|
| Périodes / mode trimestre-semestre | Établissement | `academicPeriods.ts` (`coercePeriodMode`, `applySystemActivePeriod`) | Notes/évaluations utilisent `terms.id` (PG). Config hub n’alimente pas `terms`. | **P0** |
| Barème `defaultScale` | Établissement | nombre | JSON `config_payload` uniquement | INFO |
| Types d’évaluation | Établissement | catalogue PG via `EvaluationTypesPanel` (année scolaire) | **Table `evaluation_types`** (SoT LOT 3). `GET /api/academic-config.evaluationTypes` = projection des noms actifs. Écriture JSON interdite (`LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN`). | INFO |
| Niveaux, filières | Établissement | listes lignes | JSON `config_payload.levels` / `tracks` ; seed `backend/data.js` `demoLevels` / `demoTracks` si JSON vide. Gérés aujourd’hui par Admin établissement. Cible CTO (non implémentée) : §4.A | INFO |
| `classNames` / `subjects` | Établissement | listes | **Non synchronisés** avec `classes`, `subjects`, `school_courses` | **P0** |
| Flags `allowCustom*` | Établissement | booléens | Consommés planning / bulletins côté Web | INFO |
| Design bulletins | Établissement + classe | Superadmin only UI | JSON dans le même `config_payload` | P1 |
| Années scolaires relationnelles | Établissement | APIs v2 | `GET/POST /api/v2/academic-years` — **pas** branchées sur le hub Année scolaire | **P1** |

**Types d’évaluation — LOT 3 (canonique PostgreSQL).** La table `evaluations` stocke des **instances** (un devoir, une interrogation… : `title`, `term_id`, `class_id`, `subject_id`, `max_score`, …).

- `evaluation_types` = **catalogue établissement** (SoT) : `id`, `school_id`, `code`, `name`, `status`, `display_order`.
- `evaluations.evaluation_type_id` = **FK canonique** vers `evaluation_types.id`.
- `evaluations.evaluation_type` TEXT = **projection / compatibilité uniquement**, plus la source de vérité.
- `school_academic_configs.config_payload.evaluationTypes` : **écriture interdite** ; lecture = projection des noms actifs PostgreSQL.
- `backoffice_state` : routes 410 ; aucune SoT `evaluationTypes` à l’exécution.
- Seeds `data.js` / constantes Web `EVALUATION_TYPES` : **retirés comme catalogue**.

C’est un écart de modèle (catalogue JSON vs colonne d’instance), pas un second référentiel relationnel. Cible CTO (non implémentée) : §4.C.

**RBAC lecture GET `/api/academic-config`** : tout utilisateur authentifié dans le tenant. **P1**.

**Mobile** : `GET/PUT /academic-config` (`Mobile/src/services/api.ts`). L’écran `ConfigurationScreen` **affiche** un résumé (`periodMode`, `defaultScale`, counts) mais les cartes « Periodes académiques » / « Niveaux et filieres » **n’ont pas de `route`** : `onPress` no-op. **Écran partiellement mort.**

---

### 2.3 Rôles et permissions

**Propriétaire métier** : Super Administrateur Somafrik (matrice globale) ; Admin School (liste locale `userRoles` + UI de pilotage).

**Trois sources de permissions (non unifiées)** :

1. **PostgreSQL** `role_permissions(role_name, permissions JSONB)` — `platformPgStore.replaceRolePermissions` via `platformService.replaceRolePermissions` qui appelle **`assertSuperAdmin`**. Route `PUT /api/backoffice/role-permissions` : permission RBAC `ALL_PRIVILEGES` uniquement (`backend/services/rbacService.js`).
2. **Seed statique** `backend/data.js` → `rolePermissions`. `postgresRepository.mapUser()` injecte `permissions: seedData.rolePermissions[role]` — **pas** la matrice PG — sur le compte chargé depuis `users`.
3. **Client** `web/src/lib/internalRoleDefaults.ts` (`INTERNAL_ROLE_DEFAULT_PERMISSIONS`) et `Mobile/src/data/catalog.ts` / `Mobile/src/domain/security/permissions.ts`. Fusion runtime Web : `resolveEffectivePermissions` dans `DataContext` à partir de `state.rolePermissions`.

| Paramètre | UI | API | Stockage | Écriture canonique ? | Legacy | Risque |
|-----------|----|-----|----------|----------------------|--------|--------|
| Matrice globale rôle → permissions | `PermissionsPage` (`/administration/permissions`) | GET/PUT `/api/backoffice/role-permissions` | `role_permissions` | Oui, Super Admin | Seed `data.js` si table vide / login | **P1** |
| Liste des rôles établissement (`userRoles`, ex. Secrétaire, Préfet, Directeur) | `ConfigurationPage` rôles-droits | PUT academic-config (`userRoles`) | JSON `config_payload.userRoles` | Oui (JSON) | Défauts `DEFAULT_USER_ROLES`. Cible CTO (non implémentée) : §4.B — catalogue Superadmin, établissement = affectation uniquement | INFO |
| Pilotage local par fonction | `ConfigurationPage.saveRolePilotage` | `platformApi.replaceRolePermissions` | `role_permissions` (global) | **Non pour Admin School** : API refuse hors Super Admin. Toast « Échec de l'enregistrement ». `update({ users })` ensuite est **strippé** (`stripClientClientsFromPutPayload`) | UI laisse croire à un persist établissement | **P0** |
| Permissions effectives session | Auth login | — | Calculé : seed au mapUser + overlay `rolePermissions` client | Non persisté sur `users` (pas de colonne permissions) | Triple source | **P1** |

**Scope** : matrice = **plateforme** (tous établissements). `userRoles` = **établissement**. Confusion produit : le pilotage « local » écrit une table globale.

**Dépendances** : `rbacService.canAccess` compare `principal.permissions` aux clés `routePermissions`. `SOMAFRIK_AUTH_OPTIONAL=true` court-circuite **toutes** les clés (`rbacService.js`) ; interdit en production par `backend/lib/productionSecrets.js`.

---

### 2.4 Paramètres utilisateurs / comptes

**Propriétaire métier** : Admin School (comptes établissement) ; Superadmin / Admin Pays (création Admin Pays, validation).

| Paramètre | UI | API | Source | Tables | RBAC | Scope | Validations | Alternatif | Risque |
|-----------|----|-----|--------|--------|------|-------|-------------|------------|--------|
| Compte (identité, rôle, statut, e-mail, téléphone) | modules Utilisateurs / Contacts | `GET/POST/PATCH /api/backoffice/users` ; `GET /api/users` (projection overlay) | Canonique PG | `users` : `user_code`, `first_name`, `last_name`, `email`, `phone`, `role`, `status`, `school_id`, `birth_date`, `gender`, `must_change_password`, `last_login_at` | `Utilisateurs:*` / `Gérer utilisateurs` / privilèges pays/global | Utilisateur + établissement (`school_id` nullable Superadmin) | `userAccountRules.js` (statuts Actif/Inactif/Suspendu/Verrouillé/…) | Provision depuis contact `POST …/contacts/:id/provision-account` | INFO |
| Mot de passe / PIN | flux login, reset, Mobile | `POST /api/users/:id/reset-password` ; login `POST /api/backoffice/login` | Hash PG | `users.password_hash`, `users.pin_hash` | Reset : `canResetUserPassword` (ALL/COUNTRY/`Utilisateurs:UPDATE`/`Gérer utilisateurs`) — **pas** `requirePermission` route-key | Utilisateur | `validatePasswordPolicy` : ≥8, 1 lettre, 1 chiffre. PIN : 6 chiffres + denylist faibles | Écran Sécurité **affiche** les règles en dur, **n’édite pas** | P1 (UI vs API) |
| Session | calculé à l’écran Sécurité | login / refresh | Canonique PG sessions + JWT | `sessions` (`refresh_token_hash`, `expires_at`, `revoked_at`) | Authentifié | Utilisateur | TTL JWT / refresh | — | INFO |
| Lockout login | **aucun écran** | `loginLockout.js` | **Mémoire processus** `Map` | — | — | identifiant + schoolCode | 5 échecs / 15 min ; off si `SOMAFRIK_DISABLE_LOGIN_LOCKOUT`, E2E, `NODE_ENV=test` | Endpoint E2E `POST /api/backoffice/e2e/clear-login-lockout` | **P0** |
| Contacts / relations / messages | CRM, pas hub Paramètres | `/api/backoffice/contacts`, `relations`, `messages` | Canonique PG | `contacts`, `contact_relations`, `school_messages`, … | `Contacts:*` / `Messages:*` | Établissement | — | — | INFO |

`GET /api/users` passe par `getAuthoritativeBackOfficeState()` → overlay `listClientsProjection()` (PG), **pas** `backoffice_state`.

---

### 2.5 Paramètres enseignants

**Propriétaire métier** : Admin School / Préfet ; Superadmin hors tenant.

**Hors hub Paramètres.** CRUD opérationnel :

- `GET/POST /api/teachers`, `GET/PATCH/DELETE /api/teachers/:teacherCode`
- Affectations `GET/POST/PATCH/DELETE /api/assignments`
- RBAC : `Enseignants:*` / `Gérer enseignants` ; DELETE cycle de vie (PR #172)
- Tables : `teachers`, `teacher_assignments` ; overlay pédagogie `school_courses.teacher_id`

**Source** : Canonique PostgreSQL. PUT state enseignants **interdit** (`legacyPedagogyStaffStateWrite.js`) et 410 global.

**Dépendances** : comptes `users` (provision enseignant depuis contact) ; planning / notes.

**Risque** : INFO (domaine opérationnel, pas un « paramètre » du hub). Liste `classNames` JSON peut diverger des classes réellement affectées → lié au **P0** structure.

---

### 2.6 Paramètres élèves

**Propriétaire métier** : secrétariat / Admin School.

**Hors hub Paramètres.**

- `GET/PATCH /api/students`, `GET/POST /api/classes/:classCode/students`
- Import : `POST /api/backoffice/import/students/validate` (**validation seule**, pas persist)
- Tables : `students`, `enrollments`
- RBAC : `Élèves:*` / `Gérer élèves`
- PUT state élèves : 410 + `legacyStudentsStateWrite.js`

**Restore JSON** du hub Données **prétend** restaurer les élèves puis les strippe. **P0** (voir §2.11).

---

### 2.7 Paramètres pédagogiques (classes, matières, évaluations, notes, présences, planning)

**Propriétaire métier** : Admin School / Préfet / enseignants (notes, présences).

Ces objets sont des **données opérationnelles** avec des APIs PG. Le hub Paramètres n’expose que le **référentiel JSON** (`classNames` / `subjects` / périodes).

| Sous-domaine | UI réelle | API | Stockage | RBAC | Dual / notes | Risque |
|--------------|-----------|-----|----------|------|--------------|--------|
| **Classes** | module Classes | `GET/POST /api/classes`, `PATCH /api/classes/:classCode` | `classes` (`class_code`, `academic_year_id`, `school_id`, …) | `Voir classes` / `Gérer classes` | Noms aussi dans JSON `classNames` | **P0** dual |
| **Matières V2** | limité | `GET/POST /api/v2/subjects`, `DELETE /api/v2/subjects/:code` | `subjects` | `Matières:*` / `Gérer cours` | JSON `subjects` academic-config ; cours `school_courses` | **P0** |
| **Cours** | planning / classes | `GET /api/courses` (**auth seul**, pas `requirePermission`) ; POST/PATCH/DELETE avec `POST /api/courses` | `school_courses` | écriture `Gérer cours` | GET via overlay `getAuthoritativeBackOfficeState` | P1 lecture large |
| **Emploi du temps** | `CoursePlanningPage` | `GET/POST/PATCH/DELETE /api/course-schedules` | `course_schedule_slots` | `POST /api/course-schedules` | Lit aussi `academicConfigs` (périodes JSON) | P1 |
| **Évaluations (instances)** | notes / pédagogie | `POST/PATCH /api/evaluations` + feature abo `write_notes` | table `evaluations` : instance (`term_id`, `title`, `evaluation_type_id` FK canonique, `evaluation_type` TEXT projection) | abonnement + auth | Catalogue = `evaluation_types`. Type inconnu/étranger → 404 ; archivé → 409. Pas d’auto-création | INFO |
| **Notes** | module Notes | `GET /api/notes` (auth seul) ; `POST /api/notes` + `write_notes` | `grades` | lecture large ; écriture feature | Filtrage principal / parent | P1 |
| **Présences** | module Présences | `GET /api/presences` (auth) ; `POST` + `write_presence` | `attendance` | idem | Helper mort `savePresencesViaBackOfficeState` (défini, **aucun appelant**) | INFO |
| **Examens résiduels** | planning exams | `GET/PUT /api/backoffice/planning-exams` | `establishment_residual_records` `record_domain='exam'` JSON | `Organiser/Valider examens` | Table relationnelle `exams` / `exam_results` **en parallèle** (APIs `/api/v2/exams`) | **P1** dual exams |
| **Bulletins / documents résiduels** | bulletins ; hub Documents (design) | `GET/PUT /api/backoffice/report-cards`, `…/establishment-documents` | même table résiduelle `bulletin` / `document` | `Bulletins:*` / `Documents:*` | PUT = **replace-all** scoped école (`replaceDomainRecords`) | P1 |

---

### 2.8 Finance

**Propriétaire métier** : Admin School / caissier ; Admin Pays (suivi).

**Hub Paramètres Finances** : ComingSoon — **aucune** persistance. Configuration réelle ailleurs :

| Paramètre | UI | API | Tables | RBAC | Scope | Risque |
|-----------|----|-----|--------|------|-------|--------|
| Statuts de paiement | Web finance ; Mobile `AdminCrud` entity `paymentStatuses` | `GET/POST /api/finance/payment-statuses`, `PATCH …/:statusId` (permission `GET/POST /api/payments`) | `payment_statuses` | Paiements | Établissement | Mobile : après write, `refreshBackOfficeState` **ne recharge pas** `paymentStatuses` (`AdminDataContext.tsx` recharge students/classes/notes/… seulement) → UI potentiellement **stale**. **P0** |
| Grilles / items / tarifs | module Finances (pas hub) | `/api/finance/fee-grids` (+ activate/deactivate/apply) | `fee_grids`, `school_fee_items`, `fee_tariff_history` | lecture unpaid / écriture paiements | Établissement + année | INFO |
| Obligations / paiements | Impayés, encaissements | `/api/payments`, `/api/finance/student-fees`, `/api/backoffice/finance/unpaid` | `payments`, `student_fee_obligations`, `payment_allocations`, `payment_reminders` | `Paiements:*`, `Impayés:*` | Élève / établissement | INFO |
| Relances | Impayés | `POST /api/backoffice/finance/unpaid/:studentId/reminders` | `payment_reminders` | `Impayés:CREATE` | Élève | INFO |

PUT state Finance : 410 + `legacyFinanceStateWrite.js`.

`fees.ts` / `quickPayment.ts` Web lisent encore `academicConfigs.schoolYear` (JSON) pour le libellé d’année — **pas** `academic_years.is_current`. **P1**.

---

### 2.9 Pays / plateforme / abonnements / notifications

**Propriétaire métier** : Super Admin (pays, offres, matrice, graphiques) ; Admin Pays (abonnements / notifications de son pays).

| Paramètre | UI | API | Stockage | RBAC | Scope | Validations | Risque |
|-----------|----|-----|----------|------|-------|-------------|--------|
| Pays (nom, ISO, devise, actif) | admin pays | `GET/POST /api/backoffice/countries`, `PATCH /:code` | `countries` + `profile_payload` | `Contrôler tous les pays` / ALL | Plateforme | code ISO 2 lettres (`platformService.createCountry`) | INFO |
| Politique tarifaire abo | `SubscriptionPolicySettingsPage` | PATCH country `subscriptionPolicy` | `countries.profile_payload.subscriptionPolicy` | `Abonnements` UPDATE UI ; PATCH countries Superadmin | Pays | `GLOBAL_SUBSCRIPTION_POLICY` repli statique (`web/src/lib/subscriptionPolicy.ts`) | P1 (JSON vs table `subscription_offers`) |
| Offres / paiements / factures / remises SaaS | Mon abonnement + admin | `/api/backoffice/subscriptions`, `subscription-offers`, `-payments`, `-discounts` | tables `subscriptions`, `subscription_*` + JSONB profil | `Gérer abonnements` / COUNTRY / ALL | École / pays | — | INFO |
| Notifications plateforme | **ComingSoon hub** ; APIs existent | `GET/POST/PATCH /api/backoffice/notifications` | `notifications` + `profile_payload` | ALL / COUNTRY | Pays / plateforme | — | P2 écran hub mort |
| Annonces établissement | Communication | `/api/backoffice/announcements` | `announcements` | `Notifications:*` | Établissement | **Deux systèmes** notifications vs announcements | P1 |
| Types de graphiques dashboard | `ChartTypeSettingsPanel` | GET/PUT `/api/backoffice/dashboard-chart-config` | `dashboard_chart_config` (`scope_key`, `chart_overrides`) | ALL_PRIVILEGES + `assertSuperAdmin` | Plateforme + catalogue établissement | — | INFO |
| Période d’affichage des graphes | dashboards | **aucune API** | `localStorage` `somafrik:chart-period:*` | navigateur | Utilisateur-navigateur | — | P2 |

---

### 2.10 Sécurité / authentification (paramètres pertinents)

| Paramètre | UI | API / code | Source | Persisté ? | Risque |
|-----------|----|------------|--------|------------|--------|
| Politique mot de passe | texte hardcodé `SecuritySettingsPage` | `validatePasswordPolicy` (`userAccountRules.js`) | **Statique code** | Non configurable | P1 (écran lecture seule cohérent avec le code, pas un paramètre) |
| Politique PIN | idem | `validatePinPolicy` (6 chiffres + denylist) | Statique | Non | INFO |
| Journal d’audit (écran Paramètres) | `state.auditLog` DataContext | **n’appelle pas** `GET /api/audit` | Client / contacts locaux | Non = PG `audit_logs` | **P1** |
| Journal d’audit réel | pas dans le hub | `GET /api/audit` — Super Admin / Admin Pays uniquement (`server.js`) | `audit_logs` | Oui | INFO |
| Lockout | — | `backend/lib/loginLockout.js` | RAM processus | Perdu au restart / multi-instance | **P0** |
| `SOMAFRIK_AUTH_OPTIONAL` | — | `rbacService.canAccess` | Env | Bypass RBAC si true | **P1** (bloqué prod) |
| Secrets JWT / DB | — | `productionSecrets.js` | Env `JWT_SECRET`, `DATABASE_URL`, … | Déploiement | INFO |
| `GET /api/schools` | login picker | **sans** `requireAuth` | Projection écoles | Catalogue public | P1 |

Écran Sécurité : session = **calculé** depuis `AuthContext`. Aucun PATCH politique.

---

### 2.11 `backoffice_state` et structures legacy

| Artefact | État runtime vérifié | Type |
|----------|----------------------|------|
| Table `backoffice_state` (`schema.sql`) | **Toujours créée**. Runtime `getBackOfficeState()` = `null`. `saveBackOfficeState()` throw 410. Aucun backfill (ADR LOT 8). | Schéma orphelin / scripts |
| `GET/PUT /api/backoffice/state` | `sendBackOfficeStateReadRemoved` / `WriteRemoved` — **410** (`backend/lib/backofficeStateRemoval.js`, `server.js`) | API morte volontaire |
| `getAuthoritativeBackOfficeState()` | Overlay interne : runtime + finance + pédagogie + plateforme + clients + résiduel | Lecture agrégée **PG**, nom legacy |
| `ensureRepositoryBackOfficeSnapshot` / `savePresencesViaBackOfficeState` | **Définis, aucun appelant** (grep) | Code mort |
| Loaders Web `domainLoaders.ts` | Un GET par domaine (establishments, students, academic-config, finance, …) | Canonique |
| `DataContext.update` | Strip écoles/élèves/staff/finance/pédagogie/plateforme/clients puis `syncResidualBackOfficePatch` (academicConfigs, exams, bulletins, documents uniquement) | Écriture résiduelle JSONB |
| Restore JSON `SettingsDataPage` | Confirme un remplacement métier puis `update(restoreState)` → strips → **ne restaure pas** students/teachers/classes/payments/notes/presences | **P0** UX dangereuse |
| `docs/project/DATABASE.md` / inventaire LOT 0 | Peuvent encore parler du snapshot comme SoT | Doc **stale** (hors périmètre de correctif) |

Domaines encore en **JSONB résiduel** (écriture possible) : `academicConfigs`, `exams`, `bulletins`, `documents` via APIs dédiées (pas via PUT state).

---

### 2.12 Mobile

| Surface | Fichier | Réel |
|---------|---------|------|
| Hub Configuration | `Mobile/src/screens/ConfigurationScreen.tsx` | Résumé academic-config **lu**. Cartes périodes / niveaux **sans navigation**. Cartes classes / users / paymentStatuses → `AdminCrud`. |
| Academic config | `getAcademicConfig` / `saveAcademicConfig` | API existante ; **pas d’écran d’édition** des périodes depuis ce hub |
| Statuts paiement | `AdminCrudScreen` + `upsertFinancePaymentStatus` | Écriture PG OK ; refresh **n’inclut pas** le domaine → stale | **P0** |
| Permissions | `catalog.ts` + `permissions.ts` | Catalogue local parallèle au Web `internalRoleDefaults` | P1 |
| BackOffice state client | retiré (verify-backoffice-state-removal) | Charge par APIs | INFO |

---

### 2.13 BackOffice autonome résiduel

`BackOffice/app.js` : redirect `window.location.replace("/web/")`. **Aucun écran de paramètres**, plus de polling snapshot. Coquille de déploiement.

---

## 3. Distinctions demandées (vue d’ensemble)

| Catégorie | Exemples concrets |
|-----------|-------------------|
| **Canonique PostgreSQL relationnel** | `schools` colonnes, `users`, `teachers`, `students`, `classes`, `subjects`, `school_courses`, `terms`, `academic_years`, `grades`, `attendance`, `payments`, `fee_*`, `role_permissions`, `subscriptions`, `sessions`, `audit_logs` |
| **JSONB canonique PG** | `schools.profile_payload`, `countries.profile_payload.subscriptionPolicy`, `school_academic_configs.config_payload`, `establishment_residual_records.profile_payload`, `dashboard_chart_config.chart_overrides` |
| **Lecture legacy résiduelle** | `getAuthoritativeBackOfficeState` sur GET users/courses/notes/presences ; GET academic-config qui **préfère** JSON `periods` aux `terms` |
| **Écriture legacy encore possible** | PUT replace-all exams/bulletins/documents ; PUT academic-config JSON (sans sync relationnel) ; restore JSON client (no-op métier après strip) |
| **Config statique / env** | `backend/data.js` permissions & défauts ; `internalRoleDefaults.ts` ; `GLOBAL_SUBSCRIPTION_POLICY` ; `SOMAFRIK_*` ; politique MDP/PIN dans le code |
| **Calculé / non persisté** | Session affichée ; lockout RAM ; overlay permissions client ; `chartPeriod` localStorage ; ComingSoon |
| **Morte / résiduelle** | Hub Finances/Notifications/Apparence/Intégrations ; cartes Mobile sans route ; `GET/PUT /api/backoffice/state` 410 ; table `backoffice_state` ; `BackOffice/app.js` redirect ; helpers snapshot non appelés |

---

## 4. Décisions métier CTO — cible validée

**Statut :** arbitrages métier **déjà validés** par le CTO. **Non implémentés** dans cette PR, ni dans le runtime actuel.

Cette section ne décrit **pas** le comportement d’aujourd’hui. L’état constaté reste les sections 1–3 et 6. Les risques P0/P1/P2/INFO de l’audit **ne sont pas relevés** pour « coller » à la cible.

Lecture obligatoire de chaque fiche :

1. **État actuel** (code exécuté) ;
2. **Problème constaté** (si applicable, déjà chiffré dans l’audit) ;
3. **Décision métier cible** (lots futurs uniquement).

### 4.A Niveaux / filières / séries / options

**État actuel**

- Stockage : `school_academic_configs.config_payload.levels` et `config_payload.tracks` (JSON, scope **établissement**).
- UI : Admin établissement, hub Paramètres → **Structure pédagogique** (`ConfigurationPage` section `structure`).
- Si JSON vide : seed `backend/data.js` `demoLevels` / `demoTracks`.
- L’établissement **crée librement** le vocabulaire (listes de lignes).

**Problème constaté**

- Référentiel pédagogique **local à l’école**, non partagé par pays.
- Vocabulaire non gouverné (doublons, libellés divergents entre établissements d’un même pays). Risque audit actuel : **INFO** (pas de dual-write avec une table `levels` / `tracks` — elle n’existe pas).

**Cible validée (implémentée LOT 1 — PR référentiels pédagogiques)**

- Propriétaire du **référentiel** = Superadmin (`education_levels`, `education_streams` scopés par `country_id`).
- L’établissement **ne crée plus librement** le vocabulaire (`levels`/`tracks` rejetés sur `PUT /api/academic-config` avec codes stables).
- Admin établissement **active uniquement** via `PUT /api/education-reference/school-activation` (`school_levels`, `school_streams`).
- Lecture `GET /api/academic-config` : `levels`/`tracks` dérivés du référentiel canonique PG, plus du JSON `config_payload`.

Cible conceptuelle :

```
Superadmin
  → Référentiels pédagogiques
    → Pays
      → Niveaux
      → Filières / séries / options

Puis établissement :
  → Structure pédagogique
    → Niveaux / filières activés dans cet établissement
```

### 4.B Rôles généraux

Exemples visés : Secrétaire, Préfet des études, Directeur, Économe, autres rôles internes génériques.

**État LOT 2 (implémenté sur branche `cursor/establishment-roles-lot2-f873`)**

- Catalogue canonique PostgreSQL : `establishment_roles`, `establishment_role_permissions`, `establishment_role_delegation_permissions`.
- API Superadmin : `GET/POST/PATCH /api/backoffice/establishment-roles`, `POST …/archive`.
- API établissement (lecture) : `GET /api/establishment-roles/assignable`.
- `config_payload.userRoles` : **lecture seule** (dérivée du catalogue assignable) ; écriture rejetée (`LEGACY_USER_ROLES_WRITE_FORBIDDEN`).
- Matrice plateforme : `role_permissions` (Superadmin) ; matrice établissement : tables LOT 2.
- JWT / `buildPrincipal` : permissions depuis `getRolePermissionsMap()` (PG), sans seed `data.js` sur le compte ; rôle PG actif avec `permissions=[]` → JWT vide (fail-closed, pas de fallback « Voir tableau de bord »).
- Web `ConfigurationPage` rôles-droits : catalogue assignable en lecture seule (plus de pilotage local ni liste `userRoles` éditable).
- Defaults client (`internalRoleDefaults.ts`, Mobile `catalog.ts`) : ignorés dès qu’une matrice serveur est chargée.

**Legacy neutralisé**

- `PUT /api/academic-config` avec clé `userRoles` → 400.
- Boot PG : inventaire `userRoles` JSON avant strip ; ambiguïté → arrêt (`LEGACY_ESTABLISHMENT_ROLES_AMBIGUOUS`).
- `saveRolePilotage` / édition locale de la matrice retirés de l’UI établissement.

**Cible validée (atteinte LOT 2)**

- Catalogue des **rôles généraux** = Superadmin.
- Matrice **rôle → permissions** = Superadmin.
- Admin établissement **ne crée pas** de rôle général privilégié.
- Admin établissement **affecte uniquement** les rôles autorisés aux utilisateurs de son établissement.

**Recommandation future (modèle, hors lot) :** pour chaque rôle général, prévoir **rôle canonique + permissions + scope / plafond de délégation**.

### 4.C Types d’évaluation

Exemples visés : Devoir, Interrogation, Examen, TP, Oral, Projet, Composition, …

**État LOT 3 (implémenté)**

- Catalogue canonique PostgreSQL : `evaluation_types` scopé `school_id` (`UNIQUE (school_id, code)` + unicité nom normalisé).
- API établissement : `GET/POST /api/evaluation-types`, `PATCH …/:id`, `POST …/:id/archive` (tenant JWT).
- API Superadmin / backoffice : `GET/POST/PATCH /api/backoffice/establishments/:schoolCode/evaluation-types`.
- `evaluations.evaluation_type_id` = SoT ; `evaluations.evaluation_type` TEXT = projection/compatibilité.
- `config_payload.evaluationTypes` : **lecture seule** (projection des noms actifs) ; écriture rejetée (`LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN`).
- Web `EvaluationTypesPanel` + `EvaluationFormModal` : catalogue API, identifiant canonique, types actifs uniquement.
- Mobile `TeacherGradesScreen` : `GET /api/evaluation-types`, `evaluationTypeId` à l’enregistrement.
- Boot PG : preflight → inventaire legacy JSON → STOP `LEGACY_EVALUATION_TYPES_AMBIGUOUS` si le catalogue n’est pas exactement équivalent aux 8 types défaut (sous-ensemble inclus) → schéma → strip → bootstrap défauts si établissement vide (`absent` / `null` / `[]` autorisés).
- Création d’évaluation authentifiée : type canonique explicite obligatoire (`400 EVALUATION_TYPE_REQUIRED`), sans fallback `"Devoir"`.
- Aucune auto-création d’un type depuis une évaluation.

**Legacy neutralisé**

- `PUT /api/academic-config` avec clé `evaluationTypes` → 400.
- UI textarea locale / constantes `EVALUATION_TYPES` / `data.js` : plus de catalogue autoritaire.

**Cible validée (atteinte LOT 3)**

- Le **catalogue est spécifique à l’établissement**.
- Admin School gère les types de **son** établissement ; enseignants : lecture.
- Superadmin : gouvernance via routes backoffice `:schoolCode` (pas de tenant inventé dans le body).

---

## 5. Matrice de synthèse

Domaine | Paramètre | UI | API | Stockage | Scope | Écriture canonique ? | Legacy résiduel ? | RBAC | Risque | Recommandation future
--------|-----------|----|-----|----------|-------|----------------------|-------------------|------|--------|----------------------
Établissement | Profil identité / contacts / logo | `EstablishmentProfilePage` | PATCH `/api/backoffice/establishments/:code` | `schools` + `profile_payload` | Établissement | Oui | Non (PUT state 410) | Paramètres Établissement UPDATE / Établissements UPDATE | P1 | Relier Apparence au même PATCH ; documenter `GET /api/schools` public
Établissement | `schoolYear` profil | implicite / seed | même PATCH | JSONB `profile_payload.schoolYear` | Établissement | Oui (JSON) | Dual `academic_years` | idem | P1 | Une seule année courante (`academic_years.is_current`) ; profil en lecture dérivée
Établissement | `primaryColor` / timezone / langue | ComingSoon Apparence | PATCH establishments (clés acceptées, UI absente) | JSONB | Établissement | API oui, UI non | Écran mort | idem | P2 | Brancher l’écran Apparence ou retirer les clés
Académique | Périodes / mode / barème | `ConfigurationPage` année-scolaire | GET/PUT `/api/academic-config` (+ establishments/…) | `school_academic_configs.config_payload` | Établissement | JSON oui ; **tables `terms` non** | Dual-read `terms` si JSON vide | PUT : Paramètres UPDATE / planning / classes. GET config : auth seul | **P0** | Sync transactionnelle JSON → `academic_years`/`terms` ou UI sur APIs v2
Académique | Niveaux / filières / séries / options | `ConfigurationPage` structure + `EducationReferencePage` | `GET/PUT /api/education-reference/*`, CRUD `/api/backoffice/education-*` | `education_levels`, `education_streams`, `school_levels`, `school_streams` | Pays + établissement | Oui PG | JSON `levels`/`tracks` retiré ; PUT academic-config interdit | Référentiels pédagogiques / Paramètres UPDATE | INFO → **migré LOT 1** | Superadmin catalogue ; établissement activation uniquement
Académique | Types d’évaluation | `ConfigurationPage` année scolaire (`EvaluationTypesPanel`) | `GET/POST/PATCH /api/evaluation-types` (+ archive ; backoffice `:schoolCode`) | `evaluation_types` | Établissement | Oui PG | JSON `evaluationTypes` lecture projection ; PUT interdit | Paramètres UPDATE / planning ; GET notes enseignants | INFO → **migré LOT 3** | Catalogue établissement ; Superadmin modèles optionnels plus tard
Académique | `classNames` / `subjects` JSON | structure | même PUT | JSON | Établissement | Oui JSON **sans** sync `classes`/`subjects`/`school_courses` | Dual opérationnel | idem | **P0** | Génération / mapping vers classes et matières PG ; interdire double saisie
Académique | Année scolaire v2 | **pas le hub** | `/api/v2/academic-years` | `academic_years` | Établissement | Oui (autre écran/API) | Hub ignore | Années Académiques READ/WRITE | P1 | Hub Année scolaire → API v2
Rôles | Matrice globale | `PermissionsPage` | PUT `/api/backoffice/role-permissions` | `role_permissions` | Plateforme | Oui Super Admin | Seed `data.js` + `mapUser` | ALL_PRIVILEGES + `assertSuperAdmin` | P1 | **Cible CTO §4.B (non implémentée) :** catalogue Superadmin + permissions centralisées. Login doit charger la matrice PG, pas le seed. Prévoir rôle canonique + permissions + scope/plafond de délégation
Rôles | Liste `userRoles` (rôles généraux) | `ConfigurationPage` rôles | PUT academic-config | JSON `userRoles` | Établissement | Oui JSON (l’école **édite le catalogue**) | Défauts Web | Paramètres UPDATE | INFO | **Cible CTO §4.B (non implémentée) :** catalogue Superadmin ; établissement = affectation uniquement, pas de création de rôle général privilégié
Rôles | Pilotage local fonctions | `saveRolePilotage` | PUT role-permissions (global) | `role_permissions` | **Plateforme** (malgré UI école) | **Non** pour Admin School | `update(users)` strippé | ALL_PRIVILEGES | **P0** | Aligné §4.B : retirer l’illusion d’une matrice établissement ; Superadmin = unique écrivain des permissions ; école = affectation de rôles autorisés
Rôles | Defaults client | — | — | `internalRoleDefaults.ts` / Mobile `catalog.ts` | Build | Non | Triple source | UI | P1 | Une source générée depuis PG
Utilisateurs | Comptes | Utilisateurs / Contacts | `/api/backoffice/users`, `/api/users` | `users` | Utilisateur / école | Oui | Overlay nommage legacy | Utilisateurs:* | INFO | —
Utilisateurs | MDP / PIN | Sécurité (lecture) + reset | reset-password ; login | hashes `users` | Utilisateur | Politique **code** | Écran non éditable | UPDATE utilisateurs | P1 | Si politique un jour configurable : table + écran
Utilisateurs | Lockout | aucun | login | RAM | Instance | Non | — | — | **P0** | Persister lockout (PG) + partage multi-instance
Enseignants | Fiches / cycle de vie | TeachersList | `/api/teachers`, assignments | `teachers`, `teacher_assignments` | Établissement | Oui | PUT state 410 | Enseignants:* | INFO | —
Élèves | Fiches / inscriptions | Élèves | `/api/students`, classes/students | `students`, `enrollments` | Établissement | Oui | Restore JSON no-op | Élèves:* | **P0** (restore) | Restore serveur ou retirer le bouton
Pédagogie | Classes PG | Classes | `/api/classes` | `classes` | École + année | Oui | Dual JSON names | Gérer classes | P0 (dual) | Voir structure
Pédagogie | Cours / EDT | Planning | `/api/courses`, `/api/course-schedules` | `school_courses`, `course_schedule_slots` | École | Oui | GET courses sans permission fine | Gérer cours | P1 | Aligner GET sur `requirePermission`
Pédagogie | Notes / présences / instances d’évaluation | modules ops | `/api/notes`, `/api/presences`, POST/PATCH `/api/evaluations` | `grades`, `attendance`, `evaluations` (`evaluation_type_id` FK + TEXT projection) | École / élève | Oui pour l’instance | GET auth-only ; feature abo en écriture ; types = `evaluation_types` | write_notes / write_presence | INFO | Types : voir ligne Académique « Types d’évaluation » / §4.C
Pédagogie | Examens JSON vs V2 | planning | PUT planning-exams vs `/api/v2/exams` | residual JSON vs `exams` | École | Deux écritures | Dual | Examens:* | P1 | Une SoT examens
Pédagogie | Bulletins / documents JSON | Documents (design) + listing | PUT report-cards / establishment-documents | residual JSON | École | Replace-all | Oui | Documents/Bulletins | P1 | CRUD item, pas replace-all
Finance | Hub « Paramètres Finances » | ComingSoon | aucune | — | — | Non | Ops Finance ailleurs | — | P2 | Pointer vers fee-grids / payment-statuses
Finance | Statuts paiement | Finance / Mobile CRUD | `/api/finance/payment-statuses` | `payment_statuses` | École | Oui | Mobile refresh incomplet | POST /api/payments | **P0** | Inclure le domaine dans `refreshBackOfficeState`
Finance | Grilles / obligations | Finances | `/api/finance/fee-grids`, student-fees, payments | `fee_*`, `payments`, … | École | Oui | PUT state 410 | Paiements / Impayés | INFO | —
Pays | Fiche pays | admin | `/api/backoffice/countries` | `countries` + JSONB | Plateforme | Oui Superadmin | — | Contrôler tous les pays | INFO | —
Pays | Barème abo | `SubscriptionPolicySettingsPage` | PATCH country | JSONB `subscriptionPolicy` | Pays | Oui JSON | Dual `subscription_offers` | Abonnements / PATCH countries | P1 | Offres tabulaires = SoT, policy pays dérivée
Plateforme | Graphiques types | `ChartSettingsPage` | PUT dashboard-chart-config | `dashboard_chart_config` | Plateforme | Oui Superadmin | Périodes en localStorage | ALL_PRIVILEGES | P2 | Persister périodes ou documenter local-only
Plateforme | Notifications hub | ComingSoon | `/api/backoffice/notifications` existent | `notifications` | Pays | API oui, hub non | Dual `announcements` | ALL/COUNTRY | P1 | Unifier canaux + brancher l’écran
Abo école | Mon abonnement | `MonAbonnement*` | subscriptions / payments / invoices | tables `subscription_*` | École | Oui | — | mySubscription | INFO | —
Sécurité | Audit UI | `SecuritySettingsPage` | **pas** GET `/api/audit` | `state.auditLog` client | Session | Non | PG `audit_logs` ailleurs | configuration view | P1 | Brancher GET audit ou retirer le journal
Sécurité | Auth optional | — | env | process | Déploiement | — | Bypass RBAC | — | P1 | Conserver garde prod
Legacy | Snapshot global | — | GET/PUT state | table orpheline | — | **410** | Helpers morts | — | INFO | Drop table + dead code (lot ultérieur)
Legacy | Restore JSON | Données | `DataContext.update` | strips | École | **Non** pour le métier | Résiduel academic/exams/docs seulement | canManage settings | **P0** | Désactiver restore ou restore API domaine par domaine
Mobile | Hub Configuration | `ConfigurationScreen` | GET academic-config | JSON + résumé | École | Édition périodes **absente** | Cartes mortes | Configuration view | P2 | Naviguer vers éditeurs ou retirer cartes
BackOffice | App autonome | `BackOffice/app.js` | redirect `/web/` | — | — | Non | Coquille | — | INFO | Retirer artefact déploiement

Les recommandations de la dernière colonne sont **hors lot** : elles ne sont **pas** implémentées dans cette PR. Les trois cibles CTO (§4.A/B/C) y figurent pour les lots suivants uniquement.

---

## 6. Synthèse des constats par criticité

### P0

1. **Périodes académiques duales** : hub enregistre `config_payload.periods` ; notes/évaluations s’appuient sur `terms` / `academic_years`. `saveAcademicConfig` ne synchronise pas. Lecture : JSON gagne s’il est non vide.
2. **Référentiel classes/matières dual** : `classNames` / `subjects` JSON vs `classes` / `subjects` / `school_courses`.
3. **Pilotage des rôles établissement non persistable** : `saveRolePilotage` → `replaceRolePermissions` + `assertSuperAdmin` ; Admin School échoue. Patch `users` strippé.
4. **Restore JSON** : UI promet un remplacement irréversible des jeux élèves/enseignants/finance/notes ; `update()` strippe ces domaines.
5. **Lockout login en RAM** : non partagé, non survivant au restart.
6. **Mobile paymentStatuses** : écriture PG puis refresh qui **omet** le domaine → liste locale potentiellement fausse.

### P1

- `schoolYear` profil JSON vs `academic_years`.
- `GET /api/academic-config` sans `requirePermission`.
- Triple source permissions (PG / seed `mapUser` / defaults client).
- Écran Sécurité : politique hardcodée + `auditLog` ≠ `audit_logs`.
- Examens residual JSON vs `exams` V2 ; PUT replace-all bulletins/documents.
- Apparence ComingSoon vs champs profil déjà persistables.
- `SOMAFRIK_AUTH_OPTIONAL` ; `GET /api/schools` public.
- GET `/api/courses`, `/api/notes`, `/api/presences` : auth sans permission de feature.
- Notifications plateforme vs announcements établissement ; policy pays vs `subscription_offers`.
- Hub Année scolaire ignoré par `/api/v2/academic-years`.

### P2

- Cartes hub Finances / Notifications / Apparence / Intégrations = ComingSoon.
- Périodes de graphiques en `localStorage`.
- Cartes Mobile Configuration sans `route`.
- Champs profil orphelins (timezone, language, slogan, …).

### INFO

- Table et routes `backoffice_state` : 410 / `getBackOfficeState()=null` ; ADR LOT 8 appliqué au runtime.
- `BackOffice/app.js` redirect.
- Helpers snapshot / présences BO non appelés.
- Types d’évaluation : `evaluation_types` = SoT PostgreSQL ; `academic-config.evaluationTypes` = projection lecture / écriture interdite ; `evaluations.evaluation_type_id` = FK canonique ; TEXT = projection.
- Session JWT + table `sessions` canonique.
- Mon abonnement : APIs plateforme PG.

---

## 7. Fichiers et fonctions principales cités (index)

| Zone | Chemins |
|------|---------|
| Hub Paramètres | `web/src/pages/parametres/SettingsHubPage.tsx`, `ParametresLayout.tsx`, `App.tsx` (`/parametres`) |
| Pages | `EstablishmentProfilePage.tsx`, `ConfigurationPage.tsx`, `SecuritySettingsPage.tsx`, `DataBackupSettingsPage.tsx`, `SettingsPlaceholders.tsx`, `SubscriptionPolicySettingsPage.tsx`, `BulletinDesignPage.tsx`, `ChartSettingsPage.tsx`, `PermissionsPage.tsx` |
| Sync client | `web/src/lib/residualBackOfficeSync.ts`, `web/src/context/DataContext.tsx`, `web/src/lib/domainLoaders.ts`, `web/src/lib/stripClient*.ts` |
| Backend routes | `backend/server.js` (academic-config, establishments, role-permissions, finance, teachers, students, residual PUT, 410 state, audit, schools public) |
| Stores | `backend/db/residualPgStore.js`, `platformPgStore.js`, `postgresRepository.js` (`mapUser`, `getBackOfficeState`) |
| RBAC / auth | `backend/services/rbacService.js`, `backend/lib/platformService.js`, `backend/lib/loginLockout.js`, `backend/lib/userAccountRules.js`, `backend/lib/productionSecrets.js` |
| Schema | `backend/db/schema.sql`, migrations `20260813_platform_canonical.sql`, `20260813_pedagogy_canonical.sql`, `20260813_finance_canonical.sql`, `20260814_residual_state_canonical.sql` |
| Mobile | `Mobile/src/screens/ConfigurationScreen.tsx`, `AdminDataContext.tsx` (`refreshBackOfficeState`), `AdminCrudScreen.tsx` |
| BackOffice | `BackOffice/app.js` |
| LOT 8 | `backend/lib/backofficeStateRemoval.js`, `docs/project/ADR-LOT8-REMOVE-BACKOFFICE-STATE-PUT.md` |

---

## 8. Confirmation d’absence de correctif

Cette PR ne contient **que** le présent fichier documentaire.

- **Aucun correctif fonctionnel** (backend, Web, Mobile, BackOffice).
- **Aucune migration SQL**, aucun changement de schéma, aucun changement RBAC.
- **Aucun nettoyage legacy**, aucun renommage, aucun test applicatif modifié.
- **Aucune suppression** de donnée ni de fichier applicatif.
- Les **décisions CTO §4** sont des **cibles** ; le runtime n’a pas changé.

Les colonnes « Recommandation future » et la section 4 préparent des lots ultérieurs ; elles ne constituent pas un plan d’exécution dans cette PR.
