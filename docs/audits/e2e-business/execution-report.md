# Rapport d’exécution — E2E métier

```text
E2E BUSINESS AUDIT

Base: origin/develop
HEAD: e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8
Branch: cursor/audit-e2e-business-full-execution-d9e2
Environment(s): ENV-LOCAL Cloud Agent (Docker Postgres 16 :5433 + backend Node hôte :5000 + Expo web :8083). ENV-PREPROD/ENV-PROD = GET health/HTML only via verify:web-smoke. Maestro préprod = non exécutable.
Production mutation: NONE

Business scenarios identified: 93
Existing E2E tests: 58 IDs inventoriés (hors trous 0007/0016)
Executed: 46 suites/scripts locaux exécutables (Maestro runtime non lancé)
PASS: 16
FAIL: 28
BLOCKED: 11 (Maestro runtime + 10 flows EXECUTABLE_FLOWS)
NOT COVERED: 22+ parcours (coverage-matrix.md)

P0: 1 (boot officiel avec seed démo bloqué — uq_users_school_email ; PG démarre si seed off)
P1: 1 (chaînes HTTP verify:e2e-* / mobile 0017–0027 inutilisables faute de superadmin)
P2: 2 (web-smoke local 500 notifications + 501 salles ; docker:up:core FAIL-INFRA)
P3: 2 (libellé 0023 ; hosted smoke SHA HOLD)
```

**Aucune interprétation favorable.** Les chaînes HTTP `verify:e2e-0001`… ne sont **pas** fonctionnelles ici : elles sont **FAIL-DATA** (login 401). Les parcours **NOT-COVERED** ne sont pas OK.

Contrôle CTO #748 : `coverage-matrix.md` est aligné sur cette matrice (plus de `NON TESTÉ` sur une ligne exécutée). Les totaux ci-dessous sont **disjoints** : un événement a exactement une classe primaire.

## 1. Inventaire

Voir `inventory.md`. Après exécution, chaque suite a un statut ci-dessous.

## 2. Commandes réellement exécutées

Toutes sur **ENV-LOCAL** sauf les GET hébergés de `verify:web-smoke`.  
SHA : `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8`.  
Logs : `results/*.txt` (JWT redactés).

| # | Commande | Environnement | Log | Code | Classification |
| - | -------- | ------------- | --- | ---- | -------------- |
| 1 | `npm run docker:up:core` | ENV-LOCAL Docker | `results/docker-up-core.txt` | 1 | **FAIL-INFRA** (classe unique ; hypothèse Dockerfile incomplet — non compté une seconde fois en FAIL-PRODUCT) |
| 2 | `docker compose up -d postgres` | ENV-LOCAL | — | 0 | PASS (service officiel, sans bind-mount applicatif) |
| 3 | `npm --prefix backend run verify:establishment` | process in-memory | `results/verify-establishment.txt` | 0 | PASS |
| 4 | `npm run verify:mobile-ui-e2e-scaffold` | fichiers | `results/verify-mobile-ui-e2e-scaffold.txt` | 0 | PASS (pas un parcours live) |
| 5 | `npm run verify:mobile-ui-e2e-runtime` | ENV-LOCAL sans device | `results/verify-mobile-ui-e2e-runtime.txt` | 1 | BLOCKED |
| 6 | `npm run verify:sync-end-to-end` | PG isolé | `results/verify-sync-end-to-end.txt` | 0 | PASS |
| 7 | `npm run verify:communications-e2e` | PG isolé | `results/verify-communications-e2e.txt` | 0 | PASS (E2E6 déjà NOT_IMPLEMENTED) |
| 8 | `npm run verify:communications-c2` | PG isolé | `results/verify-communications-c2.txt` | 0 | PASS |
| 9 | `npm run verify:communications-c3` | PG isolé | `results/verify-communications-c3.txt` | 0 | PASS |
| 10 | `npm run verify:communications-c4` | PG isolé | `results/verify-communications-c4.txt` | 0 | PASS |
| 11 | `node backend/scripts/verify-admin-user-creation.js` | PG isolé | `results/verify-admin-user-creation.txt` | 0 | PASS |
| 12 | `npm run verify:report-card-s1-e2e` | PG isolé + Playwright | `results/verify-report-card-s1-e2e.txt` | 0 | PASS |
| 13 | `npm run verify:planning-v2-web` | PG isolé + Playwright + Vitest | `results/verify-planning-v2-web.txt` | 0 | PASS |
| 14 | `npm run verify:e2e-preflight` | API hôte :5000 | `results/verify-e2e-preflight.txt` | 0 | PASS (bootstrap Docker non exécuté) |
| 15 | `node backend/scripts/bootstrap-e2e-superadmin.js --confirm` | PG `somafrik` | `results/bootstrap-e2e-superadmin.txt` | 1 | FAIL-TEST |
| 16 | backend `npm --prefix backend run dev` seed officiel | PG `somafrik` puis `somafrik_e2e_shared` | `results/official-pg-seed-init.txt` | crash | FAIL-PRODUCT |
| 17 | `npm run verify:e2e-api` | API hôte skip-seed | `results/verify-e2e-api.txt` | 1 | 14× FAIL-DATA + 0006 PASS |
| 18 | `npm run verify:web-smoke` | local spawn + GET hosted | `results/verify-web-smoke.txt` | 0 | PASS local ; hosted HOLD |
| 19 | `npm run verify:e2e-mobile` (`SOMAFRIK_REQUIRE_MOBILE_E2E=true`) | Expo :8083 | `results/verify-e2e-mobile.txt` | 1 | 0010 PASS ; 11× FAIL-DATA |
| 20 | `npm run verify:e2e-all` | — | non relancé | — | DUPLICATE (enfants déjà exécutés) |

Contournements d’**infrastructure** uniquement (pas de patch produit) :

- CLI Docker installée hors dépôt pour parler au daemon TCP `:2375`.
- `docker compose build --build-arg SKIP_WEB_BUILD=true` puis abandon du conteneur backend (bind-mount `/workspace` invisible au daemon → `/app/package.json` ENOENT).
- Backend et Expo lancés via les scripts npm officiels **sur l’hôte**, Postgres via Compose.

## 3. Matrice PASS/FAIL par ID

| ID | Statut | Preuve |
| -- | ------ | ------ |
| E2E-AGG-PREFLIGHT | PASS | health OK ; bootstrap compose skip |
| E2E-AGG-API | FAIL-DATA | 14 KO login 401 |
| E2E-AGG-MOBILE | FAIL-DATA | 11 KO login 401 / seed |
| E2E-AGG-ALL | DUPLICATE | non relancé |
| E2E-API-ONBOARD | FAIL-DATA | 401 superadmin |
| E2E-API-0001 | FAIL-DATA | 401 superadmin |
| E2E-API-0002 | FAIL-DATA | 401 superadmin |
| E2E-API-0003 | FAIL-DATA | 401 superadmin |
| E2E-API-0004 | FAIL-DATA | 401 superadmin |
| E2E-API-0005 | FAIL-DATA | 401 superadmin |
| E2E-API-0006 | PASS | in-memory, 14 checks |
| E2E-API-0008 | FAIL-DATA | 401 superadmin |
| E2E-API-0009 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0010 | PASS | welcome 4 viewports |
| E2E-API-0011 | FAIL-DATA | 401 superadmin |
| E2E-API-0012 | FAIL-DATA | 401 superadmin |
| E2E-API-0013 | FAIL-DATA | 401 superadmin |
| E2E-API-0014 | FAIL-DATA | 401 superadmin |
| E2E-API-0015 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0017 | FAIL-DATA | 401 superadmin (préparation données) |
| E2E-MOB-0018 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0019 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0020 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0021 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0022 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0023 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0024 | FAIL-DATA | 401 superadmin |
| E2E-MOB-0025 | FAIL-DATA | 401 admin |
| E2E-MOB-0026 | FAIL-DATA | seed démo requis / `SKIP_DEMO_SEED=true` |
| E2E-MOB-0027 | FAIL-DATA | 401 admin |
| E2E-API-0028 | FAIL-DATA | 401 superadmin |
| E2E-BE-ESTABLISHMENT | PASS | 16 checks in-memory |
| E2E-API-COM-C1 | PASS | E2E6 SKIPPED-EXISTING |
| E2E-API-COM-C2 | PASS | |
| E2E-API-COM-C3 | PASS | |
| E2E-API-COM-C4 | PASS | |
| E2E-WEB-PLANNING | PASS | CRUD + RBAC navigateur |
| E2E-WEB-REPORTCARD-S1 | PASS | y compris cross-tenant forbidden |
| E2E-API-SYNC | PASS | 8 domaines persistés |
| E2E-API-ADMIN-USER | PASS | lockout 423 + provision |
| E2E-WEB-SMOKE | PASS | local SHA ; hosted HOLD |
| E2E-MOB-SCAFFOLD | PASS | |
| E2E-MOB-RUNTIME | BLOCKED | Maestro/adb/device/APK/secrets |
| E2E-MAE-01…08, 10 | BLOCKED | dépendent du runtime |
| E2E-MAE-09, 11, 12 | SKIPPED-EXISTING | déjà bloqués dans le repo |

## 4. Parcours non couverts

Inchangés — voir `coverage-matrix.md`. L’échec de login **n’ajoute pas** de couverture.

## 5. Tests désactivés (déjà présents)

- COM-C1 E2E6 `NOT_IMPLEMENTED` (suite C1 quand même PASS)
- Maestro 09 / 11 / 12
- Skip mobile si Expo down : **non utilisé** (`SOMAFRIK_REQUIRE_MOBILE_E2E=true`)
- Skip report-card / planning si `DATABASE_URL` absent : **non utilisé** (URL fournie)

## 6. Divergences Web / Mobile

- Login / classes / notes / finance / présences : **aucun E2E live Web+Mobile réussi** sur la stack partagée (API HTTP et mobile 0017+ sont FAIL-DATA).
- Planning : **PASS Web Playwright** ; **aucun** E2E Mobile planning exécutable ici.
- Bulletins S1 : **PASS Web** ; Mobile LOT 8 hors E2E navigateur.
- Welcome mobile : **PASS** ; pas d’équivalent Web Playwright dédié.
- Maestro natif : **BLOCKED** — parité native **NON TESTÉE**.

Aucune divergence comportementale n’a été **mesurée** sur un même parcours live Web vs Mobile (données absentes). Ne pas conclure à l’égalité.

## 7. Anomalies de données

- Table `users` vide après boot `SOMAFRIK_SKIP_DEMO_SEED=true`.
- Seed officiel (flag défaut Compose) **crashe** avant d’avoir un superadmin.
- Bootstrap E2E officiel exige `backoffice_state.users` (legacy) → EXIT 1.
- Conséquence : 401 « Identifiant ou mot de passe incorrect » sur toutes les chaînes HTTP qui appellent `login(superadmin)`.

## 8. Anomalies d’infrastructure

- Daemon Docker sans bind-mount du workspace → `docker compose` backend inutilisable.
- `Mobile/.env.local` absent → `docker compose exec` preflight échoue (env_file).
- Maestro / adb / APK / secrets préprod absents.
- Hébergements préprod/prod joignables en GET mais SHA ≠ HEAD (HOLD documenté par le script, exit 0).

## 9. Anomalies produit

1. **P0** — **boot officiel avec seed démo bloqué** : `uq_users_school_email` / 23505, deux bases neuves. Avec `SOMAFRIK_SKIP_DEMO_SEED=true`, PostgreSQL démarre (`/api/health` 200, `users=0`). Ce n’est **pas** « PostgreSQL obligatoire incapable de démarrer ».
2. **P2** — `docker:up:core` : build Vite image backend sans `packages/help-catalog`.
3. **P2** — pendant web-smoke local (suite PASS) : HTTP 500 `internal-notifications/unread-count`, HTTP 501 `school-rooms`.
4. **P3** — `verify-e2e-0023` encore intitulé « E2E 0022 » dans le bandeau.

Les suites isolées (sync, COM, admin-user, bulletins S1, planning) **PASS vérifié** : elles créent leurs propres fixtures et ne passent pas par le seed partagé.

## 10. Preuves reproductibles

| Preuve | Fichier |
| ------ | ------- |
| Build Docker officiel | `results/docker-up-core.txt` |
| Crash seed | `results/official-pg-seed-init.txt` |
| Bootstrap | `results/bootstrap-e2e-superadmin.txt` |
| Suite API | `results/verify-e2e-api.txt` |
| Suite mobile | `results/verify-e2e-mobile.txt` |
| Isolées PASS | `results/verify-sync-end-to-end.txt`, `verify-communications-*.txt`, `verify-admin-user-creation.txt`, `verify-report-card-s1-e2e.txt`, `verify-planning-v2-web.txt` |
| Web smoke | `results/verify-web-smoke.txt` |
| Maestro | `results/verify-mobile-ui-e2e-runtime.txt` |

Reproductibilité (ENV-LOCAL, même SHA) :

```bash
# Isolées (besoin DATABASE_URL vers un Postgres 16 capable de CREATE DATABASE)
DATABASE_URL=postgresql://somafrik:somafrik123@127.0.0.1:5433/somafrik npm run verify:sync-end-to-end
# … idem communications / report-card-s1 / planning-v2-web / admin-user-creation

# Stack partagée observée
SOMAFRIK_SKIP_DEMO_SEED=false npm --prefix backend run dev   # crash 23505
SOMAFRIK_SKIP_DEMO_SEED=true  npm --prefix backend run dev   # health OK, users=0
npm run verify:e2e-api   # 401 superadmin
```

## Couverture des tests existants

```text
Tests découverts : 58
Tests exécutables : 46
Tests exécutés : 46
PASS : 16
FAIL (unique, somme des 4 classes) : 28
  FAIL-DATA : 25          (14 API HTTP + 11 mobile 0017–0027)
  FAIL-PRODUCT : 1        (seed/init officiel seulement)
  FAIL-TEST : 1           (bootstrap backoffice_state)
  FAIL-INFRA : 1          (docker:up:core seulement)
BLOCKED : 11              (Maestro runtime + 10 YAML EXECUTABLE_FLOWS) — pas un FAIL
SKIPPED : 4               (MAE-09, MAE-11, MAE-12, COM-C1 E2E6)
```

Règle de non-double-comptage (contrôle CTO #748) :

- `docker:up:core` = **FAIL-INFRA** uniquement. L’hypothèse « Dockerfile sans `packages/help-catalog` » est documentée dans `failures.md` F-DOCKER-UP-CORE, **sans** second ticket FAIL-PRODUCT.
- Maestro runtime = **BLOCKED**, pas FAIL-INFRA.
- Seed officiel = **FAIL-PRODUCT** uniquement (P0 borné au seed démo).
