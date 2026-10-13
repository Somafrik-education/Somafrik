# Preuves — audit GO Production 2026-09-21

SHA : `080cc8d77ff25a27e4d1e5edab5118216a424c1b`  
Fenêtre : 2026-09-21T20:47:10Z à environ 2026-09-21T21:05:00Z  
Machine : Linux, Node v22.14.0, npm 10.9.7  
PostgreSQL labo : 16.15, `127.0.0.1:5432/somafrik`, rôle local créé pour l'audit. Ce n'est pas la base préprod.

Les journaux bruts restent sur la machine d'audit (`/tmp/audit-logs`). Ce document retient les verdicts et les commandes.

## Freeze

```text
git fetch origin develop
git rev-parse HEAD
git rev-parse origin/develop
```

Les deux SHA sont `080cc8d77ff25a27e4d1e5edab5118216a424c1b`. `git status --porcelain` vide. `git merge-base --is-ancestor` confirme #738 (`acaa425c`), #749 (`b1a783b0`), #755 (`a034b432`), #685 (`080cc8d7`).

`git log -1` : `Merge pull request #685`.

## Santé distante (lecture seule)

| Cible | Résultat |
| --- | --- |
| `GET https://api-preprod.somafrik.app/api/health` | 200, `status=ok`, `database=postgresql`, `version=1.0.0`, `attachments.ready=true`, `reportCardSource.ready=true` |
| `GET https://api.somafrik.app/api/health` | 200, `database=postgresql`, pas de champ `reportCardSource` |
| `GET https://preprod.somafrik.app/connexion` | 200 |
| `GET https://somafrik.app/connexion` | 200 |
| `GET https://api-preprod.somafrik.app/api/classes` sans jeton | 401 `Authentification JWT requise` |
| Health préprod, `Origin: https://preprod.somafrik.app` | 200 + `access-control-allow-origin` de cette origine |
| Health préprod, origine étrangère | 403 |
| Health prod, `Origin: https://somafrik.app` | 200 + ACAO de cette origine |

Bundle préprod `assets/index-CgT9BxfG.js` : la fonction de résolution remplace `https://somafrik-api-preprod.onrender.com` par `https://api-preprod.somafrik.app`, et la valeur configurée est déjà l'URL canonique.

Aucun POST n'a été envoyé à la préprod ni à la prod.

## Builds et qualité

| Commande | Exit | Durée | Note |
| --- | --- | --- | --- |
| `npm run typecheck` | 0 | 15 s | |
| `npm run lint` | 0 | 5 s | |
| `npm --prefix web run test` | 0 | 120 s | 244 fichiers, 1269 tests |
| `npm run build` avec `NODE_ENV=test` hérité | 0 | 30 s | **Invalide** comme preuve prod : le bundle marquait `DEV:true` |
| `env -u NODE_ENV VITE_API_URL=https://api.somafrik.app npm run build` | 0 | ~18 s | `DEV:false`, `PROD:true`, API `https://api.somafrik.app` |
| `gitleaks detect --source . --redact` 8.24.3 | 0 | 10 s | 2271 commits, no leaks |

## Auth et sécurité

Rejeu sans `SOMAFRIK_SKIP_DEMO_SEED` :

| Commande | Exit |
| --- | --- |
| `npm run verify:jwt-header` | 0 |
| `npm run verify:auth-sessions` | 0 |
| `npm run verify:privacy-erasure` | 0 |
| `npm run verify:rbac-s1-4` | 0 |
| `npm run verify:sanitize-user-responses` | 0 |
| `npm run verify:db-config` | 0 |

Le premier passage avec `SOMAFRIK_SKIP_DEMO_SEED=true` a donné 401 « Identifiant ou mot de passe incorrect » sur jwt-header et auth-sessions. Cause : le serveur mémoire héritait l'interdiction de seed. Ce n'est pas le résultat retenu.

Contrat JWT lu dans `backend/services/tokenService.js` et confirmé par un access émis en labo : en-tête `alg=HS256`. TTL politique : `backend/lib/authTokenPolicy.js`, max production 900. Réponse labo `expiresIn=900`.

## Parité LOT et gates PostgreSQL

`DATABASE_URL` pointait vers le PostgreSQL labo.

| Commande | Exit | Note |
| --- | --- | --- |
| `npm run test:lot0-parity` … `test:lot8-parity` | 0 | LOT 1 avait échoué une fois à cause du seed coupé. Rejeu : 0. |
| `npm run verify:users-tenant` | 0 | |
| `npm run verify:academic-year-tenant` | 0 | |
| `npm run verify:presence-tenant` | 0 | |
| `npm run verify:enrollment-tenant` | 0 | |
| `npm run verify:planning-tenant` | 0 | |
| `npm run verify:sync-l1-tenant` | 0 | |
| `npm run verify:finance-rbac` | 0 | statique / matrice, pas le seed school_admin |
| `npm run verify:mobile-push-n1` | 0 | |
| `node backend/scripts/verify-presences-roster.js` | 0 | après seed. Le test HTTP `parentAttendanceIsolation.http.pg.test.js` était déjà vert avant le 401 du script. |
| `node backend/scripts/verify-class-student-enrollment.js` | 0 | |
| `node backend/scripts/verify-login-lockout-management.js` | 0 | |
| `node backend/scripts/verify-functional-rbac.js` | 0 | 117 tests unitaires déjà verts, puis le script HTTP |
| `node --test backend/lib/backofficeStateRemoval.pg.test.js` | 0 | le premier essai a échoué avec `relation "schools" does not exist` avant le boot du schéma |

## Mobile statique

| Commande | Exit |
| --- | --- |
| `npm --prefix Mobile run test:release-environments` | 0 |
| `npm --prefix Mobile run test:push-notifications` | 0 |
| `npx tsx Mobile/src/lib/legalCompliance.test.ts` | 0 |
| `npm run verify:mobile-security` | 0 |
| `npm run verify:mobile-release-readiness` | 0 |
| `npm run verify:android-release-readiness` | 0 |
| `npm --prefix Mobile run test:mobile-crud-parity` | 0 |
| `npm --prefix Mobile run test:mobile-parent-p0` | 0 |

## Runtime PostgreSQL labo

Boot : `node backend/server.js`, `NODE_ENV=development`, `SOMAFRIK_DB_REQUIRED=true`, seed démo autorisé, port 5055.

Health : `database=postgresql`. Volumes pièces jointes et report-card : `ephemeralFallback=true` (pas de disque monté).

Logins HTTP 200, `expiresIn` 900, `mustChangePassword` false :

- `POST /api/backoffice/login` superadmin
- `POST /api/backoffice/login` admin-rdc et `admin.rdc@somafrik.app` (COUNTRY_ADMIN)
- `POST /api/backoffice/login` `admin@unikin.somafrik` + `CD-UK-26-001` (SCHOOL_ADMIN, `schoolId` UUID CD)
- `POST /api/login` teacher `jean.kabeya@somafrik.cd`, role `teacher`
- `POST /api/login` parent email et téléphone, role `parent_student`
- `POST /api/backoffice/login` `admin@bujumbura.somafrik` + `BI-ESB-26-001`

Le code README `CD-IN-26-001` répond « Code etablissement invalide » sur cette base. Le login code seed est `CD-UK-26-001` (`school_code` `CD-2026-0001`).

Lectures school_admin CD : classes 50, students 48, teachers 50, presences 48, messages 0, planning 0. Query `schoolCode=BI-ESB-26-001` ne change pas le payload CD. Admin BI : 0 / 0 / 0.

Finance school_admin et admin BI : 403 `Permission insuffisante pour cette fonctionnalité` sur `/api/payments`, `/api/finance/fee-grids`, `/api/finance/student-fees`, `/api/backoffice/finance/unpaid`, `/api/finance/payment-student-options`.

SQL : `SELECT count(*) FROM user_roles` = 0. `users` = 149. Le JWT school_admin contient pourtant `Paiements:READ` et `Frais & tarifs:READ` (89 permissions). Le middleware finance remplace ces claims par `resolveFinanceLivePermissions` (`backend/lib/liveRbacPrincipalAuthority.js`). Le backfill mémoire est dans `fallbackRepository.js` uniquement.

Refresh : 200, jeton tourné, `expiresIn` 900. Logout : 200 `Déconnexion sécurisée effectuée`. L'ancien access et l'access tourné : 401 `Session révoquée`.

Jeton mal formé sur `/api/classes` : 401.

Rate limit login : en-tête `X-RateLimit-Limit: 15`, puis HTTP 429 dans la série de 20 logins. Aucun 5xx.

## Performance labo

N=20 séquentiel, même processus, seed démo. Chiffres dans le rapport principal. Pas de mesure pool, CPU ou RAM. Pas de charge préprod.

## SKIP assumés

- Lots bulletins `verify:report-card-lot0` … `lot11` et `verify:report-card-s1-e2e`
- `verify:finance-management` et la chaîne finance complète du nightly
- `npm run ci:security` entier
- image Docker préprod (`docker` absent)
- navigateur Web, APK, émulateur, FCM réel
- backup / restore
- login préprod

Ces SKIP ne comptent pas comme PASS.

## npm audit (inventaire, pas un correctif)

| Package | high | moderate | critical |
| --- | --- | --- | --- |
| backend | 2 | 4 | 0 |
| web | 6 | 5 | 0 |
| Mobile | 16 | 4 | 0 |

## Fichiers de cet audit

Aucun fichier runtime modifié. Livrables :

- `docs/release/GO-PRODUCTION-AUDIT-2026-09-21.md`
- `docs/release/GO-PRODUCTION-PARITY-MATRIX.json`
- `docs/release/GO-PRODUCTION-EVIDENCE-2026-09-21.md`
