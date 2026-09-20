# Environnement d’exécution — audit E2E métier

**Date d’ouverture :** 2026-09-20  
**Mandat :** audit + exécution exhaustive, **aucune correction**  
**Production mutation :** **NONE**

## Identité Git

| Champ | Valeur |
| ----- | ------ |
| Base demandée | `origin/develop` (fetch effectué avant audit) |
| SHA exact | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Message | `Merge pull request #745 from Somafrik-education/fix/744-finance-payment-student-roster` |
| Branche d’audit | `cursor/audit-e2e-business-full-execution-d9e2` |
| Dépôt | `github.com/Somafrik-education/Somafrik` |

## Classification des environnements

| ID | Type | Cible | Mutations autorisées par ce mandat | Utilisé dans cet audit |
| -- | ---- | ----- | ----------------------------------- | ---------------------- |
| ENV-LOCAL | local Cloud Agent VM | stack Docker Compose officielle (`postgres` + `backend`, éventuellement `web-dev` + `mobile`) | oui, données locales jetables uniquement | **oui** — exécution principale |
| ENV-CI | GitHub Actions | workflows existants | non (lecture des définitions uniquement) | **inventaire seulement** |
| ENV-PREVIEW | preview | non identifié comme cible officielle des `verify:e2e-*` | non | non |
| ENV-PREPROD | préproduction Render / `*.somafrik.app` | API / Web préprod | **aucune écriture** | probes **GET** health/HTML uniquement via `verify:web-smoke` si exécuté |
| ENV-PROD | production | `somafrik.app` / `api.somafrik.app` | **READ-ONLY uniquement** | probes **GET** health/HTML uniquement via `verify:web-smoke` si exécuté |

Aucune donnée de production n’est créée, mise à jour ou supprimée.  
Aucun secret préprod/prod n’est injecté pour contourner un échec.  
Maestro runtime vise explicitement l’API préprod : **non exécuté** ici (pas d’APK, pas d’appareil, pas de secrets runtime).

## Machine d’audit (ENV-LOCAL)

| Élément | Observation à l’ouverture |
| ------- | ------------------------- |
| OS | Linux 6.12.94+ |
| Node | v22.14.0 |
| npm | 10.9.7 |
| Docker Engine | présent (TCP `127.0.0.1:2375`, Engine 29.1.4) |
| Docker CLI | **absent au boot** — CLI + Compose installés ensuite **hors dépôt** pour pouvoir lancer les commandes officielles `docker compose` / `npm run docker:up:core` |
| Conteneurs au boot | aucun |
| Fichier `.env` | **absent** (seuls les `.env.*.example` existent) — Compose utilisera les défauts du `docker-compose.yml` |
| `DATABASE_URL` process | **absent** au boot |
| `node_modules` backend/web/Mobile/racine | **absents** au boot |
| Playwright CLI | non installé localement au boot ; dépendance racine `playwright@^1.61.1` |
| Maestro | absent |
| adb / device Android | absent |
| Secrets `SOMAFRIK_E2E_*` runtime Maestro | absents |
| Production write credentials | absents (volontaire) |

## Commandes officielles prévues (sans modification produit)

```bash
# Stack locale officielle
npm run docker:up:core          # postgres + backend :5000
# éventuellement
npm run docker:up               # + web-dev :5173 + Expo :8083

# Suites E2E officielles
npm run verify:e2e-preflight
npm run verify:e2e-api
npm run verify:e2e-mobile
npm run verify:e2e-all

# Autres parcours métier multi-composants déjà présents
npm run verify:sync-end-to-end
npm run verify:report-card-s1-e2e
npm run verify:planning-v2-web
npm run verify:communications-e2e
npm run verify:communications-c2
npm run verify:communications-c3
npm run verify:communications-c4
npm run verify:web-smoke
npm run verify:mobile-ui-e2e-scaffold
npm run verify:mobile-ui-e2e-runtime
node backend/scripts/verify-admin-user-creation.js
npm --prefix backend run verify:establishment
```

## Cibles réseau officielles

| Usage | URL par défaut | Environnement |
| ----- | -------------- | ------------- |
| API E2E numérotée | `http://127.0.0.1:5000/api` (`SOMAFRIK_API_URL`) | ENV-LOCAL |
| Mobile Playwright | `http://127.0.0.1:8083` (`SOMAFRIK_MOBILE_WEB_URL`) | ENV-LOCAL |
| Web smoke local | ports isolés 5091 / 4191 | ENV-LOCAL (processus spawnés) |
| Report-card S1 | API 19891 + Vite 5191 + PG isolé | ENV-LOCAL |
| Planning v2 web | PG isolé + backend/Vite spawnés | ENV-LOCAL |
| Sync E2E | PG isolé `somafrik_sync_e2e_it` + port 19690 | ENV-LOCAL |
| Maestro runtime | `https://somafrik-api-preprod.onrender.com` | ENV-PREPROD — **non exécuté** |
| Web smoke hébergé | GET `preprod.somafrik.app`, `somafrik.app`, health API | ENV-PREPROD / ENV-PROD **lecture seule** |

## Règles de sécurité de cet audit

1. Production : **GET only**. Aucun login mutatif, aucun POST/PATCH/DELETE, aucun seed.
2. Préprod Maestro : **non lancé** faute de device / APK / secrets. Ne pas inventer de credentials.
3. Les suites API `verify:e2e-*` créent des établissements horodatés dans la **base Docker locale uniquement**.
4. Les suites isolées (`sync-end-to-end`, report-card S1, planning web, communications `*.http.pg.test.js`) créent / détruisent des bases **locales** via `DATABASE_URL`.
5. Aucun secret, cookie, token ou donnée personnelle ne doit être commité.
6. Aucune correction produit, même P0.

## Journal d’état runtime

Rempli au fil de l’exécution (voir `results/`).

| Horodatage UTC | Événement |
| ------------- | --------- |
| 2026-09-20T22:06Z | Checkout `develop` = `e8a7cf0f` |
| 2026-09-20T22:07Z | `git fetch origin develop` — SHA identique à `origin/develop` |
| 2026-09-20T22:08Z | Inventaire statique du monorepo |
| 2026-09-20T22:10Z | Constat : Docker Engine OK, CLI absente, aucun service applicatif, pas de `DATABASE_URL` |
