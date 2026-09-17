# AUDIT — Workflow de configuration initiale d’un établissement (`school_admin`)

**Lot :** AUDIT-SCHOOL-ADMIN-INITIAL-SETUP  
**Branche :** `audit/school-admin-initial-setup`  
**Base `origin/develop` :** `5e01d33b0ed222c1882753840b4cc5a715b057ee`  
**Date d’audit :** 2026-09-17  
**Contrôle CTO indépendant :** 2026-09-17 — PR #675 commentaire `5712709746`  
**Working tree à la création de branche :** propre  
**Statut :** HOLD CTO — Draft uniquement. Aucun Ready. Aucun merge. Aucune implémentation. Décisions D1–D4 **figées**.

**Périmètre :** lecture du code réellement présent sur `develop`. Aucun changement fonctionnel de production, aucune migration DB, aucune modification RBAC, aucune réactivation de legacy, aucun changement d’API.

**Sources de vérité :** schéma PostgreSQL, services / routes backend, RBAC live, Web (`App.tsx`, login, Scolarité, Paramètres), Mobile Expo/React Native (`AppNavigator`, login, Accueil, Paramètres), tests existants, audits SETTINGS-01 et Scolarité L0.

**Mobile** désigne exclusivement l’application Expo/React Native, jamais le responsive Web.

**Décision structurante (validée par le code) :**

> Le statut de configuration est une propriété de **l’établissement**, pas de l’administrateur.  
> `mustChangePassword` / `last_login_at` décrivent la **première connexion d’un utilisateur**.  
> Un nouvel admin arrivant dans une école déjà opérationnelle ne doit **pas** repasser par l’assistant.

---

## Gouvernance

| Règle | Application dans ce lot |
| --- | --- |
| Branche dédiée | `audit/school-admin-initial-setup` depuis `origin/develop` |
| PR | Draft / HOLD CTO |
| Changement métier | **Aucun** |
| Migration PostgreSQL | **Aucune** |
| Modification RBAC | **Aucune** |
| Réactivation legacy | **Interdite** |
| Merge | **Interdit** jusqu’au diff GitHub indépendant CTO |

Contrôle CTO avant tout futur Ready/Merge : **nouveau** diff GitHub indépendant de cette PR (après le présent patch documentation).

---

## Décisions CTO figées (PR #675, commentaire `5712709746`)

Ces décisions **remplacent** les recommandations ouvertes du premier dépôt d’audit. Elles ne sont plus des questions.

| ID | Décision |
| --- | --- |
| **D1 — `READY`** | Année scolaire courante/open **+** ≥ 1 niveau activé **+** ≥ 1 groupe activé **+** ≥ 1 classe. **Les périodes (`terms`) sortent du gate `READY`.** Preuve PG : `classes.academic_year_id NOT NULL`, **pas** de `term_id` sur `classes`. `terms` restent nécessaires à la pédagogie / notes (`evaluations.term_id`, `grades.term_id`) : étape de **complétude**, pas de gate assistant. |
| **D2 — « Plus tard »** | V1 = **dismiss session-only**. Aucune colonne DB, aucun flag métier `localStorage` / `AsyncStorage`, aucune migration de snooze. Un `dismissed_until` serveur n’est envisageable que dans un lot ultérieur si la relance à nouvelle session est trop intrusive. |
| **D3 — Widget** | **Avant `READY` :** widget `Configuration rapide` visible sur le Dashboard, avec progression et CTA Continuer. **Après `READY` :** le widget **disparaît du Dashboard** ; accès permanent depuis **Paramètres → Configuration de l’établissement**. Si l’état dérivé redescend à `IN_PROGRESS`, le widget Dashboard **réapparaît**. |
| **D4 — Endpoint** | Canonique unique : `GET /api/v2/school-setup/status`. Tenant **déduit de la session / JWT**. **Aucun `schoolCode` fourni par Web/Mobile.** **Aucune agrégation métier côté clients.** Gardes : tenant + `Paramètres Établissement:READ`. Le backend ne renvoie **pas** de routes Web/Mobile : chaque client mappe les clés d’étapes vers ses écrans canoniques. |

Le contrôle CTO a aussi **confirmé indépendamment** l’incohérence Mobile (tableau F, ligne D3) : `SchoolYearSettingsScreen.createYear` existe ; `ClassMutationControls` demande encore de configurer l’année « sur le Web ».

---

## Synthèse exécutive

Somafrik **n’a pas** d’assistant de configuration, **pas** de bouton « Configuration rapide », **pas** de statut d’établissement `NOT_STARTED` / `IN_PROGRESS` / `READY`, et **aucune** clé `localStorage` / `AsyncStorage` d’onboarding.

Après authentification, un `school_admin` (libellé session Web : `Admin School`) :

1. doit changer son mot de passe temporaire (`users.must_change_password`) ;
2. atterrit sur **Mon établissement → Scolarité** (`/etablissement/vue-ensemble`) côté Web, ou sur l’onglet **Accueil** côté Mobile ;
3. voit éventuellement une alerte « Aucune année scolaire active » ;
4. n’est **guidé vers aucun parcours** de mise en service.

Les dépendances métier sont pourtant **dures** dans PostgreSQL et les APIs : sans année scolaire et sans activation du référentiel, **aucune classe** ; sans classe, **aucun élève** ; sans élèves, présences et obligations financières sont inutilisables.

L’hypothèse UX du mandat est **compatible** avec l’architecture, à une condition non négociable : l’ouverture de l’assistant se calcule sur l’**état dérivé de l’établissement** (PostgreSQL via `GET /api/v2/school-setup/status`), jamais sur la première connexion de l’utilisateur.

**`READY` figé (D1) :** l’établissement peut créer / utiliser des classes. Ce n’est **pas** la complétude pédagogique (périodes, notes, enseignants, élèves).

---

## A — Parcours actuel

### A.1 Chaîne plateforme (avant la première connexion `school_admin`)

Cette chaîne n’est **pas** exécutée par l’administrateur établissement. Elle est documentée parce qu’elle conditionne sa capacité à se connecter.

```text
Superadmin / Admin Pays
      ↓
POST /api/backoffice/establishments     → schools + trigger school_settings
      ↓
POST /api/backoffice/users/provision    → identité + rôle SCHOOL_ADMIN
      ↓  (si créé par Admin Pays)
En attente Superadmin                  → login bloqué
      ↓
Compte Actif
      ↓
school_admin peut s’authentifier
```

**Preuves**

| Étape | Preuve |
| --- | --- |
| Création établissement | `POST /api/backoffice/establishments` — `backend/server.js` L3513+ ; RBAC `Établissements:CREATE` — `backend/services/rbacService.js` L192 |
| `school_admin` ne crée pas d’établissement | `packages/auth/src/role-permission-matrix.js` L45–54 : `schools:read` + `schools:update`, **pas** `schools:create` ; Web `establishmentsApi.list` commenté « Interdit à SCHOOL_ADMIN » — `web/src/lib/establishmentsApi.ts` L21–23 |
| Persist + `school_settings` | Trigger PG `trg_schools_ensure_school_settings` — `backend/db/schema.sql` L341–358 ; `seedDefaultSettingsIfEmpty` — `backend/db/schoolSettingsPgStore.js` L142–149 |
| **Pas** d’année scolaire auto-créée | `createAcademicYearV2` est un INSERT explicite — `backend/db/postgresRepository.js` L5958–6014 ; empty state Paramètres : « Aucune année n'est inventée automatiquement. » — `web/src/pages/ConfigurationPage.tsx` L573–576 |
| **Pas** d’admin auto-créé | Provision séparé — `backend/lib/clientsService.js` `provisionUser` L261–306 |
| Admin Pays → pending | `provisionUser` pose `PENDING_VALIDATION_STATUS` ; login refusé — `backend/lib/userAccountRules.js` L26–35, L41–46 |
| E2E documenté | `scripts/verify-e2e-onboarding-chain.js` L1–9 |

**Dead-end actuel — création admin depuis la fiche établissement**

`SchoolsPage.createSchoolAdmin` pousse encore `users` via `DataContext.update()` (`web/src/pages/SchoolsPage.tsx` L249–272). Le garde-fou canonique **rejette** cette écriture (`web/src/lib/canonicalStateWriteGuard.ts` L11–19). Documenté dans `docs/audits/SYNC-CANONICAL-WRITE-GUARD.md` L7–18.

**Chemin canonique :** `UsersPage` → `POST /api/backoffice/users/provision` (`web/src/pages/UsersPage.tsx` ; `web/src/lib/userAccounts.ts` `shouldProvisionPlatformUser` L150–155).

**Mobile :** aucun écran de création d’établissement ni de provision `SCHOOL_ADMIN`. Le Mobile résout uniquement un code public pour le login (`Mobile/src/screens/RoleSelectionScreen.tsx`).

### A.2 Première connexion utilisateur (≠ première configuration établissement)

| Canal | Auth | Gate mot de passe | Landing |
| --- | --- | --- | --- |
| Web | `POST /api/backoffice/login` — `backend/server.js` L407+ ; `LoginPage` profil `school` exige `schoolCode` — `web/src/pages/LoginPage.tsx` L34–48 | Modal si `mustChangePassword` L123–127 ; API lock 403 tant que non changé — `backend/server.js` L6540–6551 | `getDefaultAppPath` → `/etablissement` pour rôles internes — `web/src/lib/superAdminAccess.ts` L63–67 |
| Mobile | `POST /api/login` ; `LoginScreen` L128–146 | Même flag ; session restreinte jusqu’au changement — `Mobile/src/context/AuthContext.tsx` | `navigation.navigate("Home")` — `Mobile/src/screens/LoginScreen.tsx` L167–169 |

Le flag `users.must_change_password` (`backend/db/schema.sql` L67) est **utilisateur**. `users.last_login_at` (L70) est mis à jour à l’auth (`backend/db/postgresRepository.js` `touchUserLastLogin` L2570+) et **n’exprime pas** l’état de configuration de l’école.

Recherche repo : `setupStatus`, `setup_status`, `onboarding_status`, `hasCompletedSetup`, `firstLogin`, `configuration rapide` → **aucune occurrence applicative**.

### A.3 Après login — Web

```text
/login
  → (mustChangePassword ?) modal
  → /etablissement            (index → vue-ensemble)
  → EtablissementOverviewPage
```

Routes : `web/src/App.tsx` L126–136. Onglets : Scolarité, Comptes, Classes, Élèves, Enseignants, Parents & élèves — `web/src/pages/etablissement/MonEtablissementLayout.tsx` L10–16.

Le hub Scolarité affiche des KPI (élèves / classes / enseignants / utilisateurs) même à **zéro**, des actions vers Classes / Élèves / Structure / Année, et des **alertes non cliquables** :

- « Aucune année scolaire active » — `EtablissementOverviewPage.tsx` L232–238, copy `web/src/lib/schoolingTruth.ts` L14
- « N élève(s) sans classe affectée » — L240–245
- « N enseignant(s) sans affectation » — L247–252

Les alertes **n’ouvrent pas** `/parametres/annee-scolaire`. L’action « Année scolaire » existe plus bas dans la même page (L211–218) mais n’est pas présentée comme un assistant.

Hub Paramètres : `/parametres` — `SettingsHubPage.tsx` L34–147. Cartes école : Profil, Année, Structure, Rôles (lecture), Sécurité, Données, Notifications (désormais `status: "available"` L108–114 — **delta vs SETTINGS-01 du 2026-08-30** qui les classait ComingSoon), Mon abonnement. Apparence / Intégrations restent `soon`.

**Aucun bouton « Configuration rapide ».**

### A.4 Après login — Mobile Expo

```text
Welcome → RoleSelection (code établissement)
  → Login
  → (mustChangePassword ?)
  → Home (shell school_admin)
```

Shell : `Mobile/src/lib/roleHomeConfig.ts` L63–73 — KPI users / presence / students / paymentRate ; actions students / attendance / payments / classes / teachers / grades / announcements.

Drawer : Scolarité, Élèves, Classes, Présences, Paiements, Enseignants, Notes, EDT, Users, Bulletins, Annonces, Messages, Notifications, Structure, Paramètres… — `Mobile/src/navigation/roleDrawerPreferences.ts` L73–92.

Hub Scolarité Mobile : `SchoolingHubScreen.tsx` L72 — même copy « Aucune année scolaire active ».

Paramètres Mobile : `ConfigurationScreen.tsx` L19–50 — 5 cartes : Profil, Année, Structure, Rôles RO, Utilisateurs. **Pas** Finances config, **pas** Notifications config, **pas** Abonnement, **pas** Sécurité/Données.

**Aucun wizard. Aucun « Configuration rapide ».**

### A.5 Ce que « première connexion » fait aujourd’hui — et ce qu’elle ne fait pas

| Fait | Ne fait pas |
| --- | --- |
| Impose le changement de MDP temporaire | Évaluer si l’établissement est configuré |
| Pose `last_login_at` | Distinguer école vide / partielle / READY |
| Redirige vers le dashboard métier | Ouvrir un assistant |
| Affiche des KPI à 0 et une alerte année | Bloquer le dashboard (hors MDP) |
| Permet de naviguer librement | Reprendre un parcours partiel |

---

## B — Inventaire des configurations

Légende **Obligatoire** :

- **OUI** = bloquant pour un module ou pour la chaîne scolarité (contrainte PG / API / UI disable).
- **COND** = obligatoire seulement pour profiter d’un module donné.
- **NON** = recommandé / confort / déjà fourni à la création.

| # | Configuration | Backend (modèle / service / endpoint) | Web | Mobile Expo | RBAC `school_admin` | Dépendances | Obligatoire | Blocage si absent | Parité | Risque |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Pays + référentiel national (niveaux / filières / groupes) | `countries`, `education_levels`, `education_streams`, `education_class_groups` ; CRUD `/api/backoffice/education-*` | `/referentiels-pedagogiques` Superadmin / Admin Pays | Superadmin only | **NO CREATE** — lecture catalog `GET /api/education-reference/catalog` (`server.js` L1866–1871) | Pays | OUI (prérequis plateforme) | Classe : « Niveau introuvable » `classesRepository.js` L230 | School_admin identique (lecture) | Dead-end si catalogue pays vide |
| 1 | Établissement | `schools` `schema.sql` L21–38 ; `POST/PATCH /api/backoffice/establishments` | Création `/etablissements` (plateforme) ; profil `/parametres/profil` | Pas de création ; `EstablishmentProfile` | CREATE interdit ; UPDATE via `Paramètres Établissement:UPDATE` (`rbacService.js` L193) | Pays | OUI (préexiste) | Login school impossible | Profil : oui | Code/ville/pays immuables école |
| 2 | `school_settings` scalaires | `school_settings` L329–338 ; trigger L341–358 | Inclus année scolaire | `SchoolYearSettings` | `Paramètres Établissement:*` | Établissement | NON (auto-seed trimestre / 20 / period) | — | Oui | Ne **pas** confondre avec année scolaire |
| 3 | Année scolaire courante | `academic_years` L122–133 **NOT NULL** school_id ; `GET/POST /api/v2/academic-years` `server.js` L3813–3825 | `/parametres/annee-scolaire` `App.tsx` L491–496 | `SchoolYearSettings` `AppNavigator.tsx` L334–336 ; **création possible** `SchoolYearSettingsScreen.tsx` L116–139 | `Années Académiques:CREATE` (`internalRoleDefaults.ts` L49–51 ; `rbacService.js` L148) | Établissement + `login_code` (`postgresRepository.js` L5987–5991) | **OUI** pour classes, périodes, affectations, grilles | UI Classes disable + bannière L439–451 ; API 400 « Année scolaire introuvable… » `classesRepository.js` L214–216 | Création : **oui** (les deux) ; hint Mobile classes **faux** (renvoie au Web) | **Critique** |
| 4 | Périodes / terms | `terms` L135–145 `academic_year_id NOT NULL` ; `PUT /api/academic-periods` ; `replaceTerms` | Même page année | Même écran année | `Paramètres Établissement:UPDATE` | **Année courante** | **COND** pédagogie / bulletins — **hors gate READY (D1)** | 400 `ACADEMIC_YEAR_REQUIRED` « Aucune année scolaire ouverte. Créez une année avant les périodes. » `schoolSettingsPgStore.js` L224–231 | Oui | PG **ne seed pas** les terms à `POST /v2/academic-years` (`createAcademicYearV2` L6005–6008 INSERT seul). Memory store seed au GET — **divergence**. `classes` n’a **pas** de `term_id`. |
| 5 | Activation structure école | `school_levels` / `school_streams` / `school_class_groups` ; `PUT /api/education-reference/school-activation` `server.js` L1874–1880 | `/parametres/structure` | `SchoolPedagogicalStructure` | `Paramètres Établissement:UPDATE` (`rbacService.js` L316–320) | Référentiel national | **OUI** pour classes | « Ce niveau n'est pas activé… » L236–239 ; « Ce groupe n'est pas activé… » L293–297 ; UI bannières `ClassesListPage.tsx` L453–479 | Oui | **Critique** |
| 6 | Cours / matières école | `subjects` L170–180 ; `/api/v2/subjects`, `/api/courses` | Structure → `SchoolSubjectsPanel` | Structure | `Matières:CREATE` | Établissement | **COND** affectations / notes / planning | Affectation : « Enseignant, classe et cours sont requis. » | Oui | Pas requis pour créer une classe |
| 7 | Types d’évaluation | `evaluation_types` L309–320 ; `/api/evaluation-types` | Page année | Page année | `Paramètres Établissement:UPDATE` | Établissement | **COND** pédagogie | Évaluations acceptent encore un texte legacy | Oui | Non bloquant boot |
| 8 | Classes | `classes` L147–158 **`academic_year_id NOT NULL`** ; `POST /api/classes` `server.js` L806–819 + `assertSchoolAccess` | `/etablissement/classes` | `Classes` + `ClassMutationControls` | `Classes:CREATE` | Année + niveau activé + groupe activé | **OUI** élèves / présences / affectations / grilles | Empty `SCOLARITE_COPY.emptyClasses` ; submit disabled L544 | Création oui ; hint année Mobile L268–269 **renvoie au Web alors que Mobile sait créer l’année** | **Critique** + dead-end copy |
| 9 | Enseignants (identité) | `teachers` ; **interdit** `POST /api/teachers` 403 `TEACHER_IDENTITY_MUST_COME_FROM_USERS` `server.js` L2383–2388 | **Pas de bouton** `TeachersListPage` `primaryActions={null}` L405 ; chemin : `/etablissement/comptes-utilisateurs` puis GRANT Enseignant | `TeacherMutationControls` → `POST /backoffice/users/create-teacher` | `Utilisateurs:CREATE` + GRANT | Établissement | **COND** affectations / notes (`grades.teacher_id NOT NULL` L413) | Empty « Aucun enseignant à afficher » L415–418 | **Écart volontaire** Web vs Mobile (KNOWN-ISSUES / SETTINGS-01) | Wizard ne doit **jamais** appeler `POST /teachers` |
| 10 | Affectations | `teacher_assignments` L265–276 tous FK NOT NULL ; `POST /api/assignments` | Enseignants | Teachers / AssignmentMutationControls | `Affectations:CREATE` | Enseignant + classe + matière + année | **COND** planning / notes | Alerte hub « sans affectation » | Partielle | |
| 11 | Élèves | `enrollments` L250–261 **`class_id NOT NULL`** + **`academic_year_id NOT NULL`** ; **uniquement** `POST /api/classes/:classCode/students` `server.js` L973 | `/etablissement/classes/:classCode/eleves` ; liste `/etablissement/eleves` | `Students` enroll class-scoped | `Élèves:CREATE` | Classe **active** + année **open/active** | **OUI** pour présences / finance élève / bulletins | 409 « La classe doit être active… » / « L'année scolaire de la classe n'est pas valide… » `classStudentsManagement.js` L253–258 ; empty `SCOLARITE_COPY.emptyStudents` | Oui | Pas de `POST /api/students` |
| 12 | Relations parent-enfant | relations API | `/etablissement/relations-parent-enfant` | partiel | `Relations:*` | Élèves + comptes parents | NON (boot) | Module relations vide | Partiel | KNOWN-ISSUES parent |
| 13 | Grilles tarifaires | `fee_grids` L749–763 `academic_year TEXT NOT NULL` ; `POST /api/finance/fee-grids` | `/finances/frais` (`/parametres/finances` redirige `App.tsx` L516) | Paiements ops, **pas** l’écran grilles | `Frais & tarifs:CREATE` | Classe + libellé année | **COND** encaissement | Web `fees.ts` L157–166 « La classe est obligatoire » / « L'année scolaire est obligatoire » | **Non** (config Web only) | Volontaire ops vs admin |
| 14 | Présences | `attendance` L578–592 student_id + class_id NOT NULL ; `POST /api/presences` + `write_presence` | `/presences` | `TeacherAttendanceScreen` | `Présences:CREATE` | Élèves inscrits | **COND** | Validation élève/classe | Ops Mobile riche | Gate abonnement |
| 15 | Notes / évaluations | `evaluations` L362–368 `term_id NOT NULL` ; `grades` L407–414 `term_id` + `teacher_id` NOT NULL ; `write_notes` | `/notes-evaluations` | `TeacherGradesScreen` | Admin School defaults : `Notes:READ` **pas CREATE** (`internalRoleDefaults.ts` L29) | Classe + matière + période + (souvent) enseignant | **COND** | PG refuse sans term | Partiel | P1 notes enseignant documenté |
| 16 | Bulletins | report-card APIs | `/bulletins/*` ; config Superadmin | `ReportCardsScreen` lecture | `Bulletins:*` | Notes + périodes + classe | **COND** | — | Config plateforme Web only | |
| 17 | Planning | cours + classes + enseignants + affectations | `/planning/*` ; vue salle ComingSoon | `TimetableScreen` partiel | `Planning de cours:*` | Chaîne 3→10 | **COND** | — | Non | |
| 18 | Annonces / messages | `announcements` school_id ; conversations | `/annonces`, `/messages` | mêmes | `Announcements:*`, `Messages:*` | Établissement ; classe optionnelle | **NON** | Fonctionne sur école vide | Oui (lots COM) | Ne pas mettre dans le chemin bloquant |
| 19 | Notifications établissement | `GET/PATCH …/notification-settings` | `/parametres/notifications` **livré** (`SettingsNotificationsPage.tsx`) | **Pas** d’écran config (centre in-app ailleurs) | `Paramètres Établissement:UPDATE` | Établissement | NON | Défauts serveur | **Écart** Web config / Mobile absent | SETTINGS-01 obsolète sur ComingSoon |
| 20 | Abonnement SaaS | `subscriptions` L43–55 ; `schoolSubscriptionAccessService` `write_notes` / `write_presence` | `/parametres/mon-abonnement` lecture | Non | Lecture `mySubscription` | Plateforme | **COND** écriture notes/présences si plan `readonly`/`blocked` | 403 feature distinct de RBAC | Non | Hors assistant établissement ; ne pas confondre |
| 21 | Rôles / matrice | catalogue Superadmin | `/parametres/roles-droits` **RO** | `SchoolAssignableRoles` RO | Lecture | — | NON | Attribution = Comptes | Oui RO | Interdit d’ouvrir la matrice école |

Matrice machine : `docs/audits/school-admin-initial-setup-matrix.json`.

### Obligatoire pour **`READY`** (gate assistant — décision CTO D1)

Sans ces éléments, l’établissement n’est pas « configuré » au sens du workflow. Preuve : `classes` exige `academic_year_id` + offering activé ; **aucun** `term_id` sur `classes` (`schema.sql` L147–158).

1. Établissement existant + compte `school_admin` validé (plateforme)
2. Année scolaire **courante / open**
3. Activation d’au moins un **niveau** et un **groupe** du référentiel national
4. Au moins une **classe**

Les **périodes** ne font **pas** partie de `READY`. Elles sont **obligatoires pour la pédagogie / notes / bulletins** (`evaluations.term_id NOT NULL`, `grades.term_id NOT NULL`), donc étape de complétude du widget, pas un prérequis de création de classe.

### Recommandé pour **profiter d’un module** (non bloquant dashboard)

| Module | Prérequis supplémentaires |
| --- | --- |
| Élèves | Classe active |
| Pédagogie / notes / bulletins | **≥ 1 période (`terms`)** — hors `READY` (D1) ; `evaluations.term_id` / `grades.term_id` NOT NULL |
| Enseignants / planning | Identité via Utilisateurs + GRANT ; cours ; affectation |
| Présences | Élèves inscrits + (abonnement `write_presence`) |
| Finance encaissement | Grilles (classe + année) + élèves |
| Bulletins | Notes + modèle plateforme |
| Communication | Aucun prérequis structurel (école suffit) |
| Profil | Déjà rempli à la création — revue recommandée, pas un gate |

**Aucune de ces étapes ne doit emprisonner le Dashboard**, hors le gate MDP déjà existant. Le code actuel **laisse déjà** entrer sur `/etablissement` avec une école vide.

---

## C — Graphe de dépendances (réel, d’après le code)

```text
Pays + référentiel national          ← Superadmin / Admin Pays (hors school_admin)
   ↓
Établissement (schools)
   ├─ school_settings (trigger, scalaires seulement)
   ├─ profil (déjà peuplé à la création)
   ↓
Année scolaire courante (academic_years)
   ├─ Périodes (terms)  ─── HORS READY (D1) ; requis notes / bulletins / évaluations
   ↓
Activation école (school_levels + school_class_groups [+ streams optionnels])
   ↓
Classes (academic_year_id NOT NULL + offering activé ; PAS de term_id)
   ├─ Élèves (enrollments.class_id NOT NULL) ── présences, finance élève, bulletins
   └─ (en parallèle) Cours (subjects) + Enseignants (via Utilisateurs)
           ↓
       Affectations (teacher + class + subject + year)
           ↓
       Planning / Notes (term_id NOT NULL) / EDT
```

Dépendances **indépendantes** de cette chaîne (ne pas les sérialiser dans l’assistant bloquant) :

- Annonces / messages
- Notifications in-app
- Lecture abonnement
- Export données

**Interdiction produit :** ne jamais proposer « Créer des élèves » (étape N) si Classes (étape N-k) est incomplète. L’API l’interdit déjà ; l’assistant doit **refléter** cet ordre, pas inventer un ordre UI.

---

## D — Matrice Web / Mobile / Backend

| Étape assistant proposé | Web disponible ? | Mobile disponible ? | Même API ? | Même règle métier ? | Même statut calculable ? | Écart |
| --- | --- | --- | --- | --- | --- | --- |
| Auth + MDP temporaire | Oui `LoginPage` | Oui `LoginScreen` | Web `/backoffice/login` vs Mobile `/login` — même user PG | Oui `mustChangePassword` | Oui (user, pas school) | Canaux login distincts, flag unique |
| Profil établissement | `/parametres/profil` | `EstablishmentProfile` | `GET/PATCH /backoffice/establishments/:code` | Oui tenant | Oui | — |
| Année scolaire | `/parametres/annee-scolaire` | `SchoolYearSettings` **crée** | `POST /api/v2/academic-years` | Oui + scope membership `academicYearSchoolScope.js` L315–327 | Oui | Copy Mobile classes : « Configurez-la sur le Web » `ClassMutationControls.tsx` L268–269 **faux** |
| Périodes / barème | Même page | Même écran | `PUT academic-periods` / school-settings | Oui `ACADEMIC_YEAR_REQUIRED` | Oui | Seed terms : PG ≠ memory |
| Structure | `/parametres/structure` | `SchoolPedagogicalStructure` | catalog + `PUT school-activation` | Oui | Oui | — |
| Cours | Structure | Structure | `/api/v2/subjects` | Oui | Oui | — |
| Classes | `/etablissement/classes` | `Classes` | `POST /api/classes` | Oui | Oui | Hint année |
| Enseignants | Comptes utilisateurs (pas liste Enseignants) | Bouton dédié `create-teacher` | Users provision/grant ; **pas** `POST /teachers` | Oui 403 | Oui | UX volontairement divergente |
| Élèves | Classe → Inscrire | Même enroll | `POST /classes/:code/students` | Oui | Oui | — |
| Finances grilles | `/finances/frais` | Non (ops paiements) | `/api/finance/fee-grids` | Oui si appelé | Oui si API | Config Web-only |
| Notifications config | `/parametres/notifications` | Non | notification-settings | Oui si appelé | Oui | Écart |
| Dashboard reprise | `/etablissement/vue-ensemble` | `Home` / `SchoolingHubScreen` | **`GET /api/v2/school-setup/status` (D4, à créer)** | Oui | **Oui, dès l’endpoint unique** — pas d’agrégation client | Widget absent aujourd’hui |
| Assistant / Configuration rapide | **Non** | **Non** | même endpoint | Oui | Oui | À créer (lots futurs) |

**Règle de parité d’état (D4) :** un établissement configuré sur Web doit apparaître configuré sur Mobile **immédiatement**. Source unique = `GET /api/v2/school-setup/status` (tenant JWT). Aucun état d’onboarding client séparé. Aucun `schoolCode` dans la query client.

---

## E — Analyse RBAC

### E.1 Trois couches (ne pas les confondre dans l’implémentation)

| Couche | Rôle | Contenu |
| --- | --- | --- |
| `packages/auth` | Jetons canoniques plateforme | `school_admin` : 8 tokens (`schools:read/update`, `users:*`, `roles:assign`, `sessions:revoke`) — **pas** `schools:create`, **pas** `platform:manage`, **pas** `countries:*` |
| Matrice live PG / `data.js` | Jetons métier français | `Admin School` : `Paramètres Établissement`, `Années Académiques`, `Classes`, `Élèves`, etc. |
| `internalRoleDefaults.ts` | Fallback UI si JWT permissions vides | L5–76 |

Live JWT gagne (`web/src/lib/permissions.ts`). L’assistant futur doit appeler **les mêmes endpoints déjà gardés** ; il ne doit pas inventer de routes privilegiées.

### E.2 Tenant

- Scope obligatoire `TENANT_SCOPE_KIND.SCHOOL` — `packages/auth/src/principal.js`
- JWT `schoolCode` établissement — `backend/server.js` ~L6252
- `tenantScopeService.assertSchoolAccess` → 403 « établissement hors périmètre » — L184–216
- Années : membership UUID autoritaire, body `schoolCode` d’une autre école refusé — `academicYearSchoolScope.js` L315–327
- Classes : `principal.schoolCode` requis, `*` rejeté — `server.js` L806–811
- Inscription : champs de périmètre interdits dans le body — `classStudentsManagement.js` L181–193

### E.3 Ce que le futur onboarding ne doit jamais permettre

| Tentative | Contrôle existant |
| --- | --- |
| Modifier un autre établissement | `assertSchoolAccess` + academic year scope |
| Lister le catalogue établissements | `GET /backoffice/establishments` exige `Établissements:READ` ; UI `SCHOOL_ADMIN_FORBIDDEN_FEATURES` L29 |
| Créer un établissement | `POST` `Établissements:CREATE` ; auth matrix sans `schools:create` |
| Provisionner un autre `SCHOOL_ADMIN` / Admin Pays | `provisionUser` 403 sauf Superadmin / Admin Pays — `clientsService.js` L261–276 |
| CRUD référentiel national | `rbacService.js` L295–306 `ALL_PRIVILEGES` |
| Matrice RBAC | `GET/PUT /api/backoffice/role-permissions` `ALL_PRIVILEGES` L172–173 |
| `POST /api/teachers` | 403 `TEACHER_IDENTITY_MUST_COME_FROM_USERS` |
| `DataContext.update({ users })` | `canonicalStateWriteGuard` |
| Bypass MDP | 403 `principalMustChangePassword` sauf allowlist L6540–6551 |
| Pays / abonnements plateforme | UI forbidden + RBAC |

Opérateur Paramètres : **Superadmin ciblé + Admin School uniquement**. Un Préfet avec `Paramètres Établissement:READ` n’est **pas** opérateur (`canReadView("configuration")` L492–496 ; Mobile `isSchoolSettingsOperator` `schoolSettingsAccess.ts` L20–31). L’assistant ne doit s’ouvrir **que** pour cet opérateur.

### E.4 Relier chaque action wizard aux contrôles serveur

| Action wizard | Endpoint déjà gardé |
| --- | --- |
| Ouvrir profil | `GET/PATCH /api/backoffice/establishments/:code` |
| Créer année | `POST /api/v2/academic-years` + `Années Académiques:CREATE` |
| Périodes | `PUT /api/academic-periods` / school-settings |
| Activer structure | `PUT /api/education-reference/school-activation` |
| Cours | `POST /api/v2/subjects` |
| Classes | `POST /api/classes` |
| Utilisateur / enseignant | `POST /backoffice/users` + grant **ou** `POST /backoffice/users/create-teacher` |
| Élèves | `POST /api/classes/:classCode/students` |
| Grilles | `POST /api/finance/fee-grids` |

Principe : **deep link vers l’écran canonique**, pas de second formulaire métier dans le wizard.

---

## F — Dead ends UX actuels

| ID | Symptôme | Preuve | Impact |
| --- | --- | --- | --- |
| D1 | Admin School atterrit sur un dashboard « vivant » (KPI à 0) sans parcours | `EtablissementOverviewPage` ; `roleHomeConfig.ts` | Abandon / configuration dans le désordre |
| D2 | Alerte « Aucune année scolaire active » **non cliquable** | L232–238 vs action année plus bas L211–218 | Signal faible |
| D3 | Création classe bloquée, lien Paramètres année OK Web ; Mobile dit « configurez sur le Web » | `ClassesListPage.tsx` L439–451 ; `ClassMutationControls.tsx` L268–269 vs `SchoolYearSettingsScreen.tsx` L116–139 | **Dead-end Mobile — confirmé contrôle CTO indépendant #675** |
| D4 | Structure non activée : bannière Web OK ; school_admin **ne peut pas** créer le catalogue pays | `ClassesListPage.tsx` L453–479 ; RBAC national | Impasse si Admin Pays n’a pas seedé |
| D5 | Liste Enseignants Web sans CTA créer | `TeachersListPage.tsx` L405 | L’admin croit le module cassé |
| D6 | `POST /teachers` 403 si un client l’appelle | `server.js` L2383–2388 | Piège d’implémentation wizard |
| D7 | `SchoolsPage` « Créer admin établissement » cassé | `SchoolsPage.tsx` L249–272 + write guard | Hors parcours school_admin, mais casse l’amont |
| D8 | Admin Pays crée l’admin → pending, message login | `userAccountRules.js` L41–46 | Première connexion impossible jusqu’à validation Superadmin |
| D9 | Communication utilisable sur école vide, scolarité non | Annonces `school_id` only | L’admin peut « communiquer » en croyant l’école opérationnelle |
| D10 | Pas de reprise : logout = perte de contexte UI (il n’y en a pas) | Absence wizard | Le mandat §9 n’est pas satisfait aujourd’hui |
| D11 | Nouvel admin sur école **déjà complète** : même landing, mêmes alertes si données manquantes, **aucun** flag first-login école | `last_login_at` user-only | Risque d’implémenter le mauvais trigger |
| D12 | Finances config absente du hub Paramètres (redirect `/finances/frais`) | `App.tsx` L516 ; test hub sans carte Finances | Wizard finance doit deep-linker le module Finances, pas Paramètres |

---

## G — Proposition du workflow cible

L’hypothèse du mandat est **retenue**, **ajustée aux décisions CTO D1–D4**.

### G.1 Principes

1. **Source d’état = établissement (PostgreSQL dérivé)** via `GET /api/v2/school-setup/status` (D4), pas l’utilisateur, pas le device, pas d’agrégation client.
2. **Guider vers les écrans canoniques** (deep links), ne pas recréer les formulaires. Le backend **ne renvoie pas** de routes : chaque client mappe `academicYear` / `structure` / `classes` / clés optionnelles.
3. **Ne pas emprisonner le Dashboard.** Seul le MDP temporaire reste bloquant (déjà en prod).
4. **Assistant auto** seulement si statut école ∈ {`NOT_STARTED`, `IN_PROGRESS`} **et** rôle = opérateur Paramètres (`Admin School`).
5. **Avant `READY` (D3) :** widget `Configuration rapide` visible sur le Dashboard (hub Scolarité Web / SchoolingHub Mobile) avec progression + Continuer.
6. **Après `READY` (D3) :** le widget **disparaît du Dashboard**. Accès permanent depuis **Paramètres → Configuration de l’établissement**. Si le dérivé redescend à `IN_PROGRESS`, le widget Dashboard **réapparaît**.
7. **« Plus tard » (D2) :** dismiss **session-only** V1. Pas de flag métier local, pas de migration snooze.

### G.2 Première connexion

```text
Authentification
      ↓
mustChangePassword ?  ── OUI ──→ modal MDP (existant, user-level)
      ↓ NON
Chargement établissement (tenant JWT — aucun schoolCode client)
      ↓
GET /api/v2/school-setup/status     ← D4 ; calcul PG ; lot d’implémentation
      ↓
Opérateur Paramètres ?
   NON → Dashboard normal (préfet, enseignant, …)
   OUI
      ↓
   READY ?  ── OUI ──→ Dashboard SANS widget de progression
                      (accès Paramètres → Configuration de l’établissement)
      NON
      ↓
   Assistant (dismissible « Plus tard » = session-only)
      ↓
   Dashboard + widget « Configuration rapide »
```

**Où décider :** serveur uniquement (`GET /api/v2/school-setup/status`). Les clients présentent. Recalcul à chaque ouverture de l’assistant / du widget / du hub Paramètres.

### G.3 Assistant (shell, pas un clone métier)

Étapes **ordonnées par le graphe C**, pas par un storyboard libre :

| # | Étape | Gate | Écran canonique Web | Écran canonique Mobile | Done quand |
| --- | --- | --- | --- | --- | --- |
| 1 | Bienvenue + profil (revue) | hors READY | `/parametres/profil` | `EstablishmentProfile` | École a nom + contacts (déjà vrais à la création) — **skipable** |
| 2 | Année scolaire | **core READY (D1)** | `/parametres/annee-scolaire` | `SchoolYearSettings` | ≥ 1 année `is_current` ou `status=open` |
| 3 | Structure académique | **core READY (D1)** | `/parametres/structure` | `SchoolPedagogicalStructure` | ≥ 1 level + ≥ 1 group `schoolActive` |
| 4 | Classes | **core READY (D1)** | `/etablissement/classes` | `Classes` | ≥ 1 classe |
| 5 | Périodes / barème | **complétude pédagogique** (hors READY) | `/parametres/annee-scolaire` | `SchoolYearSettings` | ≥ 1 `terms` pour l’année courante |
| 6 | Cours | optionnel module | Structure | Structure | ≥ 1 subject |
| 7 | Comptes / enseignants | optionnel module | `/etablissement/comptes-utilisateurs` | `Users` / create-teacher | ≥ 1 enseignant |
| 8 | Compléments (élèves, grilles, notifs) | optionnel module | classes / `/finances/frais` / notifications | deep link limité | selon module |

UI type (core = 3 étapes D1) :

```text
Bienvenue dans Somafrik
Configurons votre établissement.
Progression : 2 / 3 étapes cœur

✓ Année scolaire
✓ Structure académique
○ Classes

Complétude (n’empêche pas READY) :
○ Périodes / pédagogie
○ Enseignants
○ Paramètres complémentaires

[ Continuer la configuration ]   → deep link étape core incomplète
[ Plus tard ]                    → Dashboard ; dismiss session-only (D2)
```

« Continuer » ouvre **l’écran existant**. Au retour, l’assistant **recalcule** via l’API de statut.

Étapes verrouillées : Classes reste disabled tant que année ou structure manquent (déjà vrai dans `ClassesListPage` L544).

### G.4 Configuration rapide (D3)

**Avant `READY` — Dashboard (prioritaire)**

| Surface | Rôle |
| --- | --- |
| Web `EtablissementOverviewPage` | Widget visible + progression + Continuer |
| Mobile `SchoolingHubScreen` | Même widget (parité Scolarité L0) |

```text
Configuration de l’établissement
████████░░  2 / 3 étapes cœur
[ Continuer ]
```

**Après `READY` — plus de widget Dashboard**

Le widget de progression **disparaît de l’accueil**. L’accès permanent reste :

| Surface | Mode |
| --- | --- |
| Web `/parametres` → Configuration de l’établissement | non intrusif |
| Mobile `ConfigurationScreen` | non intrusif |

Si l’état dérivé redescend à `IN_PROGRESS` (année plus courante, structure désactivée, plus de classe) : le widget Dashboard **réapparaît** automatiquement. Aucun flag « onboardingCompleted=true » client.

### G.5 Reprise

| Scénario | Comportement figé | Source |
| --- | --- | --- |
| Étapes core 1–2 puis quit | Login J+3 → assistant ou widget « 2 / 3 — Reprendre » (sauf dismiss de **cette** session) | `GET /api/v2/school-setup/status` |
| « Plus tard » / fermeture fenêtre | Dismiss **session-only** (D2) ; nouvelle session → relance possible tant que non READY | Mémoire de session, **pas** PG, **pas** localStorage métier |
| Logout / autre navigateur / autre téléphone | Même statut école ; dismiss **non** repris (nouvelle session) | PG pour le statut ; session vide pour le dismiss |
| Second admin même école | Même statut ; pas de wizard si READY | PG école, pas `last_login_at` du second |
| Config Web puis ouverture Mobile | READY identique | Même endpoint D4 |
| Suppression / désactivation d’un signal core après READY | Retour `IN_PROGRESS`, widget Dashboard réapparaît | Dérivation |

---

## H — Définition du statut de configuration (CTO D1 / D4)

### H.1 Ce qu’il ne faut **pas** utiliser

| Anti-pattern | Pourquoi |
| --- | --- |
| `localStorage` / `AsyncStorage` / SecureStore « onboardingDone » | Ne survit pas au device ; diverge Web/Mobile ; diverge entre admins ; **interdit comme vérité métier (D2)** |
| Dismiss « Plus tard » persisté en local | Idem — V1 = session-only uniquement |
| `users.last_login_at IS NULL` | Première connexion **utilisateur** |
| `users.must_change_password` | Idem |
| Colonne `schools.setup_status` écrite une fois | Devient stale si on supprime l’année / les classes |
| Flag par admin `hasSeenWizard` comme vérité métier | Un nouvel admin d’une école vide doit voir l’assistant ; un nouvel admin d’une école READY non |
| Query `?schoolCode=` fournie par le client | Interdit (D4) — tenant JWT seulement |
| Agrégation métier Web/Mobile de GET years + classes + catalog | Interdit (D4) — un seul endpoint |

### H.2 Source canonique (D4) — sans migration dans ce lot

**Calcul dérivé PostgreSQL**, exposé au lot d’implémentation par :

```text
GET /api/v2/school-setup/status
```

- `requireAuth`
- établissement **déduit du JWT / membership** — **aucun** `schoolCode` body/query client
- `assertSchoolAccess` sur le tenant déduit
- `Paramètres Établissement:READ`

Lecture seule. **Aucun INSERT de colonne d’état. Aucune agrégation métier côté clients.**

Payload contractuel (commentaire CTO `5712709746`) :

```json
{
  "status": "NOT_STARTED | IN_PROGRESS | READY",
  "core": {
    "academicYear": true,
    "structure": true,
    "classes": true
  },
  "optional": {
    "periods": false,
    "subjects": false,
    "teachers": false,
    "students": false,
    "feeGrids": false,
    "notifications": false
  },
  "progress": {
    "coreDone": 3,
    "coreTotal": 3
  }
}
```

`structure` = ≥ 1 niveau activé **et** ≥ 1 groupe activé.

Ne **pas** renvoyer de chemins Web/Mobile. Mapping client :

| Clé | Web | Mobile |
| --- | --- | --- |
| `academicYear` | `/parametres/annee-scolaire` | `SchoolYearSettings` |
| `structure` | `/parametres/structure` | `SchoolPedagogicalStructure` |
| `classes` | `/etablissement/classes` | `Classes` |
| `periods` | `/parametres/annee-scolaire` | `SchoolYearSettings` |
| `subjects` | `/parametres/structure` | `SchoolPedagogicalStructure` |
| `teachers` | `/etablissement/comptes-utilisateurs` | `Users` / create-teacher |
| `students` | `/etablissement/classes` | `Students` |
| `feeGrids` | `/finances/frais` | (écart : config Web) |
| `notifications` | `/parametres/notifications` | (écart : config Web) |

Tables déjà suffisantes : `academic_years`, `school_levels` / `school_class_groups`, `classes` (core) ; `terms`, `subjects`, `teachers`, `enrollments`, `fee_grids`, notification-settings (optional).

### H.3 États (D1)

```text
NOT_STARTED
  aucune année courante/open
  ET aucune activation structure (niveau/groupe)
  ET aucune classe

IN_PROGRESS
  au moins un signal core présent
  ET READY faux

READY
  année scolaire courante/open
  ET ≥ 1 niveau activé
  ET ≥ 1 groupe activé
  ET ≥ 1 classe
```

**`READY` ≠ complétude pédagogique.** Une école `READY` peut n’avoir **aucune** période : elle peut créer des classes et inscrire des élèves ; elle **ne peut pas** encore saisir notes / évaluations / bulletins (`term_id NOT NULL`). Ces étapes restent dans `optional.periods` et **ne relancent pas** l’assistant automatique.

Enseignants, élèves, cours, grilles, notifications = `optional.*` : le widget Paramètres peut les afficher ; ils **ne** font **pas** redescendre `READY` et **ne** relancent **pas** l’assistant.

### H.4 Progression (D1)

```text
progress.coreTotal = 3
progress.coreDone  = count(academicYear, structure, classes)
steps_optional     = [periods, subjects, teachers, students, feeGrids, notifications]
```

Si l’année courante disparaît, ou plus de classe, ou plus d’activation : `READY` → `IN_PROGRESS` ; widget Dashboard réapparaît (D3). Le dérivé suit. `selectCurrentAcademicYear` → null (`schoolingTruth.ts` L55–65) ⇒ plus READY.

---

## I — Plan TDD pour l’implémentation (RED → implémentation → GREEN)

**Ce lot n’implémente aucun test GREEN fonctionnel.** Lots futurs : tests RED d’abord.

### I.1 Contrat backend `GET /api/v2/school-setup/status` (D1, D4)

| ID | Cas | Attendu |
| --- | --- | --- |
| ST-01 | École persistée, pas d’année courante/open, pas d’activation, pas de classe | `NOT_STARTED` ; core tous false ; `progress.coreDone=0`, `coreTotal=3` |
| ST-02 | Année courante seule | `IN_PROGRESS` ; `core.academicYear=true` ; classes=false ; structure=false |
| ST-03 | Année + activation niveau/groupe + ≥1 classe, **sans terms** | **`READY`** (D1 — périodes hors gate) ; `optional.periods=false` |
| ST-03b | Même école + terms ajoutés | `READY` inchangé ; `optional.periods=true` |
| ST-04 | READY puis plus d’année courante | redevient `IN_PROGRESS` ou `NOT_STARTED` selon restes |
| ST-05 | Deux admins, même `school_id` | JSON identique |
| ST-06 | Client envoie `schoolCode` d’une autre école (query/body/header) | **ignoré ou 400** ; tenant = JWT uniquement ; **jamais** les données de B (D4) |
| ST-06b | Token école A | payload de A seulement ; pas de path `:schoolCode` |
| ST-07 | Rôle enseignant | 403 ou 200 sans wizard client (fail-closed opérateur — encore ouvert, question restante) |
| ST-08 | Aucune lecture `localStorage` dans le handler | assert source PG |
| ST-09 | `mustChangePassword=true` n’apparaît **pas** dans le payload | séparation user/école |
| ST-10 | Cross Web/Mobile : même JSON | fixture PG unique + même endpoint |
| ST-11 | Payload **sans** champs de routes Web/Mobile | clients mappent les clés |
| ST-12 | `optional.teachers/students/feeGrids` n’influencent pas `status` | READY reste READY |

### I.2 Première connexion vs école

| ID | Cas | Attendu |
| --- | --- | --- |
| FL-01 | Nouvel admin, école `NOT_STARTED` | wizard auto après MDP |
| FL-02 | Nouvel admin, école `READY` | **pas** de wizard auto ; dashboard **sans** widget progression (D3) ; accès Paramètres |
| FL-03 | Admin existant, école `IN_PROGRESS` | widget Dashboard + reprise, pas « bienvenue first login » |
| FL-04 | `last_login_at` null ≠ NOT_STARTED | |
| FL-05 | École READY sans aucune période | READY + pas d’assistant ; `optional.periods=false` |

### I.3 Wizard UX / deep links

| ID | Cas | Attendu |
| --- | --- | --- |
| WZ-01 | Étape Classes disabled si pas d’année | aligné `ClassesListPage` L544 |
| WZ-02 | CTA année → `/parametres/annee-scolaire` / `SchoolYearSettings` | pas de form dupliqué |
| WZ-03 | CTA enseignant Web → comptes utilisateurs, **pas** `POST /teachers` | |
| WZ-04 | « Plus tard » → dashboard accessible ; dismiss **session-only** (D2) ; nouvelle session relance tant que non READY | |
| WZ-04b | Aucun write localStorage/AsyncStorage métier pour le dismiss | |
| WZ-05 | Mobile hint année → `SchoolYearSettings`, **pas** « allez sur le Web » | correctif copy dans le lot Mobile (dette confirmée CTO) |
| WZ-06 | Logout milieu wizard → reprise au bon step via statut ; dismiss perdu (nouvelle session) | |
| WZ-07 | Après READY : **aucun** widget Dashboard ; entrée Paramètres présente | |
| WZ-08 | READY → IN_PROGRESS (ex. plus de classe) : widget Dashboard réapparaît | |

### I.4 Parité et isolation

Réutiliser les patterns : `academicYearTenant.http.pg.test.js`, `UsersPage.schoolAdminScope.test.tsx`, `pariteL0Scolarite.red.test.ts`, `functionalRbac.test.js`.

### I.5 Fichiers de tests existants à **étendre** (pas à affaiblir)

- `web/src/pages/etablissement/ClassesListPage.test.tsx` — bannières année / catalog
- `web/src/pages/ConfigurationPage.academicYearCanonical.test.tsx`
- `backend/lib/classesRepository.pg.test.js` / `classesManagement.test.js`
- `backend/lib/classStudentsManagement.test.js`
- `backend/lib/schoolSettings.pg.test.js`
- `backend/lib/academicYearTenant.http.pg.test.js`
- `backend/scripts/verify-class-student-enrollment.js`
- `Mobile/src/lib/pariteL0Scolarite.red.test.ts`
- `Mobile/src/lib/mobileCrudParity.test.ts` (enseignants ≠ POST /teachers)
- `scripts/verify-e2e-onboarding-chain.js` (amont plateforme)

---

## J — Découpage recommandé en futurs lots

Aucun de ces lots n’est commencé ici.

| Lot | Contenu | Hors scope |
| --- | --- | --- |
| **LOT 0 — Contrat statut** | Tests RED `GET /api/v2/school-setup/status` ; payload D4 ; `READY` **sans** terms (ST-03) ; tenant JWT only ; **pas** de colonne PG ; pas d’UI | Wizard |
| **LOT 1 — Web assistant + widget** | Shell wizard + widget Dashboard **si non READY** ; entrée Paramètres permanente ; deep links ; dismiss **session-only** | Mobile ; snooze serveur |
| **LOT 2 — Mobile parité** | Même endpoint D4 ; widget `SchoolingHubScreen` avant READY ; Paramètres après READY ; **corriger copy `ClassMutationControls`** | Nouveau CRUD |
| **LOT 3 — Reprise & multi-admin** | Tests ST-05, FL-02, FL-05, WZ-07, WZ-08, logout | — |
| **LOT 4 — Complétude optionnelle** | Affichage `optional.*` (périodes, enseignants, grilles, notifs) dans Paramètres ; snooze serveur **seulement si** besoin produit ultérieur | Prison UX ; **ne pas** réintroduire `terms` dans `READY` |
| **Hors chantier (dettes connues)** | Réparer `SchoolsPage.createSchoolAdmin` ; empty catalog pays ; CTA enseignant Web ; P1 notes | Ne pas les glisser dans l’onboarding |

Ordre TDD de chaque lot : **RED → implémentation → GREEN**.

---

## Cas limites (mandat §14)

| Cas | Constat code | Comportement cible |
| --- | --- | --- |
| Nouvel établissement vide | schools + school_settings ; pas d’année | `NOT_STARTED` → assistant |
| Partiellement configuré | ex. année sans classe | `IN_PROGRESS` → reprendre à la première étape false |
| Ancien établissement complet | années + classes + élèves (démo) | `READY` → pas d’assistant auto |
| Nouvel admin sur école existante READY | `mustChangePassword` possible, école READY | MDP puis dashboard **sans** wizard école |
| Plusieurs admins | même `school_id` | même statut |
| Sans classe | empty + disable create élèves (API 409) | étape Classes ouverte, Élèves locked |
| Classes sans élèves | scolarité structurelle OK | **`READY` (D1)** ; `optional.students=false` |
| READY sans périodes | classes possibles ; notes impossibles | **`READY`** ; `optional.periods=false` ; **pas** d’assistant |
| Sans année active | alerte hub ; classes bloquées | pas READY |
| Config Mobile | Year/structure/classes APIs identiques | statut identique via D4 |
| Config Web | idem | idem |
| Logout pendant assistant | dismiss session perdu | reprise par GET statut si non READY |
| Session expirée | re-login + MDP si besoin | idem |
| Suppression config **core** requise | dérivé PG | READY → IN_PROGRESS, **widget Dashboard réapparaît** (D3) |
| École pending validation (Admin Pays) | login bloqué **avant** tout wizard | hors assistant ; amont plateforme |
| Référentiel national vide | school_admin ne peut pas créer | étape Structure = « contacter Admin Pays / Superadmin », pas fake create |

---

## Hypothèse UX — verdict

| Élément d’hypothèse | Verdict | Motif |
| --- | --- | --- |
| Première connexion incomplète → assistant auto | **OUI si école non READY et opérateur Paramètres** | Ne pas lier à first-login user |
| Assistant fermé → Dashboard si prérequis métier OK | **OUI toujours** (sauf MDP) | Aucune règle actuelle n’impose de bloquer `/etablissement` ; « Plus tard » = session-only (D2) |
| Dashboard → Configuration rapide | **OUI avant READY uniquement (D3)** | Après READY : disparition Dashboard ; accès Paramètres |
| Progression canonique établissement | **OUI, dérivée PG via `GET /api/v2/school-setup/status` (D4)** | Multi-device / multi-admin ; pas d’agrégation client |
| Retour → reprise auto | **OUI** via recalcul | Pas de curseur d’étape stocké ; dismiss session-only |
| Terminé → plus d’intrusion, accès Paramètres conservé | **OUI (D3)** | Pas de widget « Voir » sur le Dashboard |

---

## Questions CTO — tranchées vs restantes

### Figées (ne plus relitiger)

| # | Question initiale | Décision |
| --- | --- | --- |
| 1 | READY_CORE vs READY_OPERATIONAL ; periods in/out | **D1** : année + structure + classe. Périodes **hors** READY. Enseignants/élèves = optional. |
| 2 | Snooze session vs `dismissed_until` | **D2** : session-only V1. Pas de migration snooze. |
| 3 | Widget après READY | **D3** : disparaît du Dashboard ; accès Paramètres ; réapparaît si IN_PROGRESS. |
| 8 | Endpoint unique vs agrégation client | **D4** : `GET /api/v2/school-setup/status`, tenant JWT, pas de `schoolCode` client. |

### Encore ouvertes (hors gel D1–D4 — ne bloquent pas le contrat READY)

4. **Étape Profil** : skipable (données déjà posées à `POST establishments`) ou revue obligatoire ?
5. **Auto-création de terms** à `POST academic-years` : changement métier **séparé** ; n’entre pas dans READY.
6. **Référentiel pays vide** : message d’escalade uniquement, ou lot plateforme seed obligatoire à la création d’école ?
7. **CTA Enseignant Web** : deep link Comptes, ou d’abord un bouton sur `TeachersListPage` (dette SETTINGS-01) ?
9. **Rôles non school_admin** (Directeur, Préfet) : jamais d’assistant (recommandé, aligné `canReadView("configuration")`) ? (ST-07)
10. **Réparer `createSchoolAdmin` SchoolsPage** : lot amont séparé, pas dans l’assistant.

---

## STOP

Patch documentation D1–D4 intégré. **Pas d’implémentation. Pas de PR Ready. Pas de merge.**

Attendre le **nouveau** diff GitHub indépendant CTO de #675 avant toute fusion et avant tout lot d’implémentation.

---

## Index des preuves principales

| Sujet | Fichier |
| --- | --- |
| Landing Web | `web/src/lib/superAdminAccess.ts` L63–67 ; `web/src/pages/LoginPage.tsx` L92–131 |
| Hub Scolarité | `web/src/pages/etablissement/EtablissementOverviewPage.tsx` L126–253 |
| Copy scolarité | `web/src/lib/schoolingTruth.ts` L9–16 |
| Classes bloquées | `web/src/pages/etablissement/ClassesListPage.tsx` L439–544 |
| Endpoint setup (contrat D4, non implémenté) | `GET /api/v2/school-setup/status` — tenant JWT, pas de `schoolCode` client |
| Schema year/class/enrollment | `backend/db/schema.sql` L122–158 (`classes.academic_year_id NOT NULL`, **pas** de `term_id` classe), L250–261 |
| Activation classe | `backend/db/classesRepository.js` L206–297 |
| Élève | `backend/lib/classStudentsManagement.js` L181–258 |
| Terms | `backend/db/schoolSettingsPgStore.js` L224–231 |
| Année create | `backend/db/postgresRepository.js` L5958–6014 |
| Tenant | `backend/services/tenantScopeService.js` L184–216 |
| RBAC years / activation | `backend/services/rbacService.js` L147–149, L316–320 |
| Provision admin | `backend/lib/clientsService.js` L261–306 |
| MDP | `backend/server.js` L6540–6551 ; `schema.sql` L67 |
| Teachers 403 | `backend/server.js` L2383–2388 |
| Write guard | `web/src/lib/canonicalStateWriteGuard.ts` L11–19 |
| Paramètres hub | `web/src/pages/parametres/SettingsHubPage.tsx` |
| Mobile landing | `Mobile/src/lib/roleHomeConfig.ts` L63–73 |
| Mobile settings | `Mobile/src/screens/ConfigurationScreen.tsx` L19–50 |
| Mobile année create | `Mobile/src/screens/SchoolYearSettingsScreen.tsx` L116–139 |
| Mobile dead-end année | `Mobile/src/components/ClassMutationControls.tsx` L268–269 |
| Auth matrix | `packages/auth/src/role-permission-matrix.js` L45–54 |
| E2E amont | `scripts/verify-e2e-onboarding-chain.js` |
