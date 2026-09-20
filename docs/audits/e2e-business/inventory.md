# Inventaire exhaustif — tests E2E / parcours métier

**SHA inventorié :** `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` (`origin/develop`)  
**Méthode :** lecture du monorepo (scripts, `package.json`, workflows, docs, `Mobile/maestro/`).  
**Aucune correction.** Un test rouge doit rester rouge.

Légende **État** initial (avant exécution) :

| État | Sens |
| ---- | ---- |
| EXISTS | Fichier / script présent |
| RUNNABLE | Présent + commande officielle + prérequis théoriquement satisfaisables en local |
| NOT-RUNNABLE | Présent mais prérequis absents sur cette machine (device, secrets, APK…) |
| DISABLED | Désactivé / ignoré par le code existant (skip, blocked-by-design) |
| SKIPPED | Skip conditionnel déjà prévu par le repository |
| DUPLICATE | Même parcours exposé sous plusieurs commandes |
| OBSOLETE | Audits existants le signalent comme historiquement décalé |
| UNKNOWN | Présent mais nature E2E incertaine |

## 1. Outils recherchés

| Outil | Présent ? | Usage réel |
| ----- | --------- | ---------- |
| Playwright | oui (`playwright@^1.61.1` racine) | Scripts Node (`chromium.launch`) — **aucun** `playwright.config.*`, aucun dossier `e2e/` / `playwright/` |
| Cypress | non | — |
| Detox | non | — |
| Maestro | oui (`Mobile/maestro/*.yaml`) | Runtime Android préprod ; scaffold CI seulement |
| Appium | non | — |
| Jest / Supertest multi-endpoints | non (fetch natif + `node --test` / Vitest) | Parcours API via `scripts/e2e-api-helpers.js` |
| `tests/` | placeholder `tests/v2/README.md` seulement | pas de suite E2E |

## 2. Agrégateurs officiels

| ID | Domaine | Parcours | Surface | Fichier / suite | Commande | Environnement | CI | État |
| -- | ------- | -------- | ------- | --------------- | -------- | ------------- | -- | ---- |
| E2E-AGG-PREFLIGHT | plateforme | health + reset lockout + bootstrap superadmin | API | `scripts/e2e-preflight.js` | `npm run verify:e2e-preflight` | ENV-LOCAL Docker `:5000` | non (via `verify:e2e-api` local) | RUNNABLE |
| E2E-AGG-API | transversal | 16 chaînes API | API | `scripts/run-e2e-api-suite.js` | `npm run verify:e2e-api` | ENV-LOCAL | **jamais dans CI** | RUNNABLE |
| E2E-AGG-MOBILE | mobile UX | 12 scripts Playwright Expo web | Mobile web | `scripts/run-e2e-mobile-suite.js` | `npm run verify:e2e-mobile` | ENV-LOCAL Expo `:8083` | **jamais dans CI** | RUNNABLE (skip exit 0 si Expo down, sauf `SOMAFRIK_REQUIRE_MOBILE_E2E`) |
| E2E-AGG-ALL | transversal | API puis mobile | mixte | `scripts/run-e2e-all.js` | `npm run verify:e2e-all` | ENV-LOCAL | **jamais dans CI** | DUPLICATE (agrège API+mobile) |

**Écart CI majeur :** `verify:e2e-api`, `verify:e2e-mobile` et `verify:e2e-all` **ne sont référencés dans aucun workflow** `.github/workflows/*`. Ils existent mais ne sont jamais exécutés par la CI PR.

## 3. Chaînes `verify:e2e-*` (scripts racine)

| ID | Domaine | Parcours | Surface | Fichier / suite | Commande | Environnement | CI | État |
| -- | ------- | -------- | ------- | --------------- | -------- | ------------- | -- | ---- |
| E2E-API-ONBOARD | authentification / plateforme | Superadmin → école → admin pays → admin école → validation → login | API | `scripts/verify-e2e-onboarding-chain.js` | `npm run verify:e2e-onboarding` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0001 | finance | École active → admin → classe → élève → frais → paiement → reçu → parent voit le paiement | API | `scripts/verify-e2e-0001-school-finance-chain.js` | `npm run verify:e2e-0001` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0002 | référentiels / contacts | Contacts-first, déduplication, réemploi élève/enseignant/parent | API | `scripts/verify-e2e-0002-contacts-chain.js` | `npm run verify:e2e-0002` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0003 | utilisateurs / IAM | Contact → compte → login → menus rôle ; un contact / un compte ; user désactivé bloqué | API | `scripts/verify-e2e-0003-user-from-contact.js` | `npm run verify:e2e-0003` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0004 | classes | POST `/api/classes`, projection, PUT legacy interdit, 409 doublon, classe inactive | API | `scripts/verify-e2e-0004-classes-config.js` | `npm run verify:e2e-0004` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0005 | élèves | Contact → inscription → classe → parents → fiche (paiements, présences, notes) | API | `scripts/verify-e2e-0005-student-enrollment-chain.js` | `npm run verify:e2e-0005` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0006 | enseignants | Contact → user → affectation → login enseignant ne voit que ses classes | API | `scripts/verify-e2e-0006-teacher-assignment.js` | `npm run verify:e2e-0006` | ENV-LOCAL | non | RUNNABLE / OBSOLETE signalé (audits fiche enseignant vs création Web) |
| E2E-API-0007 | — | **aucun fichier** | — | — | — | — | — | ABSENT (trou de numérotation) |
| E2E-API-0008 | notes | Enseignant → évaluation → notes → moyennes → visibilité admin/parent/élève publiée | API | `scripts/verify-e2e-0008-grades-chain.js` | `npm run verify:e2e-0008` | ENV-LOCAL | non | RUNNABLE / OBSOLETE possible (Notes V2) |
| E2E-API-0009 | finance | Grilles par classe, brouillon vs actif, application, héritage nouvelles inscriptions | API | `scripts/verify-e2e-0009-fees-tariffs-chain.js` | `npm run verify:e2e-0009` | ENV-LOCAL | non | RUNNABLE |
| E2E-MOB-0010 | mobile UX | Écran welcome : logo, marque, CTA login | Mobile web Playwright | `scripts/verify-e2e-0010-mobile-welcome-screen.js` | `npm run verify:e2e-0010` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-API-0011 | finance | Impayés, filtres, relances, sortie de liste après paiement | API | `scripts/verify-e2e-0011-unpaid-reminders-chain.js` | `npm run verify:e2e-0011` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0012 | parents | Login parent → enfants, présences, notes publiées, paiements, annonces ; isolation | API | `scripts/verify-e2e-0012-parent-student-journey.js` | `npm run verify:e2e-0012` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0013 | enseignants | Dashboard → classes → appel → évaluation → notes → historique ; pas finance/admin | API | `scripts/verify-e2e-0013-teacher-journey.js` | `npm run verify:e2e-0013` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0014 | admin établissement | Classes, contacts, affectations, frais, paiements, présences, notes, annonce | API | `scripts/verify-e2e-0014-school-admin-journey.js` | `npm run verify:e2e-0014` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0015 | plateforme / abo | Premium → usage → expiration → blocage → renouvellement sans perte | API | `scripts/verify-e2e-0015-subscription-chain.js` | `npm run verify:e2e-0015` | ENV-LOCAL | non | RUNNABLE |
| E2E-API-0016 | — | **aucun fichier** | — | — | — | — | — | ABSENT (trou de numérotation) |
| E2E-MOB-0017 | mobile auth | Login : code école → dashboards parent/enseignant | Mobile web Playwright | `scripts/verify-e2e-0017-mobile-login-journey.js` | `npm run verify:e2e-0017` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0018 | mobile auth | Mauvais code école / mauvais PIN | Mobile web Playwright | `scripts/verify-e2e-0018-mobile-error-feedback.js` | `npm run verify:e2e-0018` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0019 | mobile nav | Tabs + drawer admin | Mobile web Playwright | `scripts/verify-e2e-0019-mobile-navigation.js` | `npm run verify:e2e-0019` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0020 | mobile scolarité | Classes → élèves → fiche (Notes/Présences/Paiements) | Mobile web Playwright | `scripts/verify-e2e-0020-mobile-classes-student-journey.js` | `npm run verify:e2e-0020` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0021 | mobile UX | Indicateur de chargement classes | Mobile web Playwright | `scripts/verify-e2e-0021-mobile-classes-loading.js` | `npm run verify:e2e-0021` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0022 | mobile offline | Bannière offline, cache, actions bloquées | Mobile web Playwright | `scripts/verify-e2e-0022-mobile-offline-mode.js` | `npm run verify:e2e-0022` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0023 | mobile scolarité | Sous-écrans notes / présences / paiements | Mobile web Playwright | `scripts/verify-e2e-0023-mobile-student-subscreens-journey.js` | `npm run verify:e2e-0023` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0024 | mobile perf | Liste 50+ élèves | Mobile web Playwright | `scripts/verify-e2e-0024-mobile-long-students-list.js` | `npm run verify:e2e-0024` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0025 | mobile UX | Classe vide | Mobile web Playwright | `scripts/verify-e2e-0025-mobile-empty-states.js` | `npm run verify:e2e-0025` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-MOB-0026 | mobile UX | Viewports responsive (welcome + authentifié) | Mobile web Playwright | `scripts/verify-e2e-0026-mobile-responsive.js` | `npm run verify:e2e-0026` | ENV-LOCAL Expo + seed démo | RUNNABLE |
| E2E-MOB-0027 | mobile a11y | Cibles tactiles, contrastes, labels | Mobile web Playwright | `scripts/verify-e2e-0027-mobile-accessibility.js` | `npm run verify:e2e-0027` | ENV-LOCAL Expo | non | RUNNABLE |
| E2E-API-0028 | planning + notes | Admin provisionne enseignant + planning ; scope / hors-scope | API | `scripts/verify-e2e-0028-teacher-planning-grades.js` | `npm run verify:e2e-0028` | ENV-LOCAL | non | RUNNABLE / OBSOLETE possible (Notes V2) |

Helpers partagés : `scripts/e2e-api-helpers.js`, `scripts/e2e-mobile-ui-helpers.js`, règles `scripts/e2e-*-rules.js`.  
Destructif : **oui** sur la Postgres Docker **locale** (écoles horodatées `E2E School …`).  
Cleanup officiel : `npm run cleanup:e2e` (non exécuté tant que non nécessaire ; ne pas lancer contre préprod/prod).

## 4. Autres scripts `verify-*-e2e` / parcours multi-composants

| ID | Domaine | Parcours | Surface | Fichier / suite | Commande | Environnement | CI | État |
| -- | ------- | -------- | ------- | --------------- | -------- | ------------- | -- | ---- |
| E2E-BE-ESTABLISHMENT | configuration établissement | Création / activation / login admin (in-memory) | Backend in-memory | `backend/scripts/verify-establishment-e2e.js` | `npm --prefix backend run verify:establishment` (aussi dans `verify:schools-legacy-cleanup`) | process local | indirect (`ci.yml` via cleanup) | RUNNABLE — **nom E2E mais pas HTTP/DB** |
| E2E-API-COM-C1 | communication | Messages / annonces / isolation tenant / RBAC / PDF ; E2E6 notifications **NOT_IMPLEMENTED** | API + PG isolé + guards source | `backend/scripts/verify-communications-e2e.js` | `npm run verify:communications-e2e` | ENV-LOCAL `DATABASE_URL` | `communications-c1.yml` | RUNNABLE |
| E2E-API-COM-C2 | communication | Messages : participants, destinataires, threads, read receipts, ACL PDF | API + PG | `verify:communications-c2` | `npm run verify:communications-c2` | ENV-LOCAL `DATABASE_URL` | `communications-c2.yml` | RUNNABLE |
| E2E-API-COM-C3 | communication | Annonces audiences, snapshots, isolation tenant | API + PG | `verify:communications-c3` | `npm run verify:communications-c3` | ENV-LOCAL `DATABASE_URL` | `communications-c3.yml` | RUNNABLE |
| E2E-API-COM-C4 | communication | Notifications internes, outbox, PJ | API + PG | `verify:communications-c4` | `npm run verify:communications-c4` | ENV-LOCAL `DATABASE_URL` | `communications-c4.yml` | RUNNABLE |
| E2E-WEB-PLANNING | planning | Playwright `/planning` CRUD hebdo, 409, teacher RO, parent/secrétaire interdits | Web + API + PG isolé | `backend/scripts/verify-planning-v2-web-e2e.js` | inclus dans `npm run verify:planning-v2-web` | ENV-LOCAL `DATABASE_URL` | `ci.yml`, `pr-gates.yml` | RUNNABLE / SKIPPED si `DATABASE_URL` absent (exit 0 existant) |
| E2E-WEB-REPORTCARD-S1 | notes / bulletins | Playwright bulletins S1 : demande modèle → artefact → mapping Superadmin → RBAC / cross-tenant | Web + API + PG isolé | `backend/scripts/verify-report-card-s1-e2e.js` | `npm run verify:report-card-s1-e2e` | ENV-LOCAL `DATABASE_URL` | `pr-gates.yml` (scope reportcard/web) | RUNNABLE / SKIPPED si `DATABASE_URL` absent (exit 0 existant) |
| E2E-API-SYNC | sync multi-domaines | Users → teachers → students → classes → notes → présences → finance → notifications ; POST/PATCH/GET/reload | API + PG isolé | `backend/scripts/verify-sync-end-to-end.js` | `npm run verify:sync-end-to-end` | ENV-LOCAL `DATABASE_URL` | `ci.yml`, `pr-gates.yml` | RUNNABLE |
| E2E-API-ADMIN-USER | administration plateforme | Superadmin / admin pays / admin école + GRANT secrétaire + contrôles PG | API + PG isolé | `backend/scripts/verify-admin-user-creation.js` | `node backend/scripts/verify-admin-user-creation.js` (pas d’alias racine) | ENV-LOCAL `DATABASE_URL` | `admin-user-creation.yml` | RUNNABLE |
| E2E-WEB-SMOKE | web smoke | Backend mémoire + Vite local + **GET** hébergés préprod/prod | Web + hosted | `scripts/verify-web-smoke.js` | `npm run verify:web-smoke` | ENV-LOCAL + probes hosted RO | `web-smoke.yml` | RUNNABLE |
| E2E-MOB-SCAFFOLD | mobile Maestro | Lint YAML + contrat anti-faux-E2E — **n’exécute pas Maestro** | Mobile fichiers | `Mobile/scripts/verify-mobile-ui-e2e-scaffold.js` | `npm run verify:mobile-ui-e2e-scaffold` | local fichiers | `ci.yml` | RUNNABLE (pas un parcours métier live) |
| E2E-MOB-RUNTIME | mobile Maestro | APK + device + Maestro préprod | Android natif | `Mobile/scripts/verify-mobile-ui-e2e-runtime.js` | `npm run verify:mobile-ui-e2e-runtime` | ENV-PREPROD | `mobile-e2e-runtime.yml` (`workflow_dispatch` only) | NOT-RUNNABLE ici |

## 5. Maestro — flux natifs

| ID | Domaine | Parcours | Surface | Fichier / suite | Commande | Environnement | CI runtime | État |
| -- | ------- | -------- | ------- | --------------- | -------- | ------------- | ---------- | ---- |
| E2E-MAE-01 | auth | Login admin établissement | Android | `Mobile/maestro/01-login-admin-school.yaml` | runtime Maestro | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-02 | dashboard | Métriques home | Android | `Mobile/maestro/02-home-metrics.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-03 | utilisateurs | Users vs home | Android | `Mobile/maestro/03-users-matches-home.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-04 | classes / présences | Smoke classes | Android | `Mobile/maestro/04-classes-presence.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-05 | finance | Smoke paiements | Android | `Mobile/maestro/05-payments.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-06 | enseignants | Smoke enseignants | Android | `Mobile/maestro/06-teachers.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-07 | présences | Attendance **lecture seule** | Android | `Mobile/maestro/07-attendance.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-08 | notes | Smoke notes | Android | `Mobile/maestro/08-notes.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-09 | sync erreur | Erreur domaine partielle | Android | `Mobile/maestro/09-partial-domain-error.yaml` | runtime | ENV-PREPROD | — | DISABLED (`BLOCKED_NO_FAILURE_INJECTION`) |
| E2E-MAE-10 | sécurité mobile | Relaunch sans fuite catalogue | Android | `Mobile/maestro/10-relaunch-no-catalog.yaml` | runtime | ENV-PREPROD | dispatch | NOT-RUNNABLE |
| E2E-MAE-11 | tenant | Switch tenant plateforme | Android | `Mobile/maestro/11-platform-tenant-switch.yaml` | scaffold only | ENV-PREPROD | non dans `EXECUTABLE_FLOWS` | DISABLED / SKIPPED-EXISTING |
| E2E-MAE-12 | présences | Mutation appel | Android | `Mobile/maestro/12-attendance-mutation.yaml` | runtime | ENV-PREPROD + fixtures QA | — | DISABLED sans `SOMAFRIK_E2E_ATTENDANCE_*` |

## 6. Tests **non** E2E métier (exclus de l’exécution « parcours » mais inventoriés)

Ces suites ressemblent à de l’E2E par le nom ou couvrent un contrat, mais ce sont des unitaires / composants / guards. Elles ne sont **pas** comptées comme parcours E2E métier exécutés, sauf mention contraire.

- Vitest Web `*.test.tsx` / `*.smoke.test.tsx` (pages, RBAC UI, hydration).
- `Mobile/src/lib/parite*.test.ts` et `test:parite-*` / `test:lot*-parity` — parité contrat, pas parcours live.
- `verify:report-card-lot0` … `lot11` — contrats / HTTP isolés ; seul **S1** est un E2E navigateur.
- `verify:*-tenant`, `verify:tenant-revalidation` — isolation PG, pas journey utilisateur.
- `npm run test:mobile-ui-e2e-runtime` — tests **unitaires** du gate runtime (`node --test`).
- `Mobile/recette/*UxSmoke*.tsx` — apps Expo détachées.
- Majorité des `verify:finance-*`, `verify:pedagogy-management`, `verify:*-data`.

## 7. Tests présents mais jamais exécutés par la CI

Confirmé par grep des workflows :

- `verify:e2e-preflight`
- `verify:e2e-api` et **toutes** les chaînes `verify:e2e-0001` … `0028` + onboarding
- `verify:e2e-mobile`
- `verify:e2e-all`
- `verify:e2e-onboarding`

Ces scripts sont documentés dans `docs/project/TESTING.md` comme gate préprod / release, **hors CI PR**.

## 8. Skip / disabled déjà présents (ne pas modifier)

| Mécanisme | Effet |
| --------- | ----- |
| `SOMAFRIK_SKIP_MOBILE_E2E=true` | suite mobile exit 0 |
| Expo injoignable | suite / scripts mobile exit 0 sauf `SOMAFRIK_REQUIRE_MOBILE_E2E=true` |
| `DATABASE_URL` absent | report-card S1 et planning-v2-web-e2e : `SKIP` exit 0 |
| COM-C1 E2E6 | `NOT_IMPLEMENTED` documenté |
| Maestro 09 | BLOCKED by design |
| Maestro 11 | hors `EXECUTABLE_FLOWS` |
| Maestro 12 | BLOCKED sans fixture QA |
| `SOMAFRIK_E2E_SKIP_BOOTSTRAP=true` | preflight sans bootstrap |

**Cet audit n’ajoute aucun skip / only / todo / xfail.**
