# MIG-WORKERS-POC-01

POC expérimental, isolé de la production. Il ne déploie pas de Worker, ne change pas le DNS et n'ouvre aucune base Supabase.

La migration des 371 routes reste interdite. Le 29 octobre 2026 (Europe/Paris), `npm test` a réussi dans le runtime local Wrangler. Cette exécution ne ferme pas la condition CTO : la preuve 3 n'a pas tourné, et les preuves 2 et 4 n'ont pas vu un Hyperdrive ni une Queue hébergés par Cloudflare.

| # | Preuve | Résultat local du 29 octobre 2026 | Ce qui manque pour valider |
|---|---|---|---|
| 1 | Express dans Workers, `TokenService`, `RbacService.canAccess("GET /api/students")` | Réussie. Anonyme, jeton d'URL et JWT invalide : 401. `Comptable` et `super_admin` : 403. `student` et `school_admin` : 200, sans donnée d'élève | Rejouer sur un Worker Cloudflare déployé, hors production |
| 2 | Transaction `BEGIN` / lecture / `ROLLBACK` via `env.HYPERDRIVE.connectionString` | Réussie contre Postgres local, binding `localConnectionString`, base dont le nom contient `workers_poc` | Un Hyperdrive Cloudflare vers une base de test, pas Supabase prod ou préprod |
| 3 | PDF de bulletin par Browser Run | Non exécutée. Sans binding, la route répond `503` `BROWSER_BINDING_REQUIRED`. Aucun PDF n'est produit par le Puppeteer npm | Un compte Cloudflare et le binding `BROWSER` |
| 4 | Notification différée | Réussie en local : `NOTIFY_QUEUE` fait passer `poc_outbox` de `queued` à `processed` | Une Queue Cloudflare |

Le serveur Node traditionnel reste le repli. Cette PR ne l'écarte pas.

## Adaptations déjà nécessaires

- `iconv-lite` 0.4, tiré par Express, appelle `require("./streams")` alors que son champ `browser` neutralise ce module. Avec `nodejs_compat`, le runtime Workers s'arrête au démarrage. Le POC alias ce module vers `src/iconvLiteShim.js`, limité à UTF-8. Les routes du POC ne lisent pas de corps de requête.
- `import.meta.url` est indéfini dans l'isolate. `TokenService` et `RbacService` sont donc empaquetés par `src/backendBridge.cjs`, pas chargés par `createRequire`.
- `GET /api/classes` est dans `PLATFORM_ADMIN_ALLOWED`. La route représentative est `GET /api/students`, qui est bien dans la liste d'interdiction des données personnelles. Le code RBAC du dépôt n'est pas modifié.
- La clé mobile `country_admin` n'est pas reconnue par `isPlatformAdminPrincipal` (le garde-fou connaît le libellé `Admin Pays` et la clé `COUNTRY_ADMIN`). Le POC ne lui injecte pas de `roleKeys` et ne corrige pas ce point.

## Garde-fous

- `APP_ENV` doit valoir `workers-poc`.
- Le jeton dans l'URL est refusé.
- Le principal envoyé au RBAC ne reprend pas une liste de permissions portée par le JWT.
- La réponse 200 ne contient ni élève, ni établissement, seulement la route et le rôle.
- Toute URL PostgreSQL dont l'hôte est Supabase, Render ou `somafrik.app` est refusée.
- Le nom de base doit contenir `workers_poc`.
- Le HTML du bulletin est la maquette officielle, remplie avec un élève fictif, sans URL externe.
- Browser Run absent : échec explicite, pas de repli Chromium local.

## Lancer

La variable `POC_DATABASE_URL` désigne uniquement la base jetable. Elle ne va pas dans git.

```bash
cd workers/mig-workers-poc-01
npm ci
POC_DATABASE_URL='postgresql://…@127.0.0.1:5432/somafrik_workers_poc' npm test
```
