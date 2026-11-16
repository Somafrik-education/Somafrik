# MIG-WORKERS-POC-01

POC expérimental, isolé de la production. Il ne déploie pas de Worker, ne change pas le DNS et n'ouvre aucune base Supabase. La migration des 371 routes reste interdite. La PR reste brouillon.

Le serveur Node traditionnel reste le repli.

## Middleware JWT / RBAC

`requireRepresentativeAccess` est un middleware représentatif simplifié. Il appelle `TokenService.verify` et `RbacService.canAccess` sur la seule route `GET /api/students`, sans reprendre une liste de permissions du JWT.

Il ne certifie pas le middleware de production. Il ne couvre pas la session PostgreSQL, le refresh, la grâce de réutilisation, la portée établissement, les permissions lues en base, le rate limit, l'idempotence, ni les autres routes.

La réponse 200 porte `middleware: "representative-simplified"` et ne contient ni élève ni établissement.

## Preuves locales déjà obtenues

Exécutées par `npm test` le 29 octobre 2026, après-midi (Europe/Paris), sur le runtime local Wrangler et une base Postgres jetable.

| # | Preuve | Résultat local |
|---|---|---|
| 1 | Express, JWT, RBAC simplifié sur `GET /api/students` | Réussie. 401 anonyme, jeton d'URL, JWT invalide. 403 `Comptable` et `super_admin`. 200 `student` et `school_admin` |
| 2 | Transaction `BEGIN` / lecture / `ROLLBACK` via `env.HYPERDRIVE.connectionString` | Réussie avec `localConnectionString`. Le nom de base contient `workers_poc` |
| 3 | PDF Browser Run | Non exécutée. `503` `BROWSER_BINDING_REQUIRED`. Aucun PDF réussi n'est simulé |
| 4 | File locale | Réussie : la ligne passe de `queued` à `processed`. Les cas négatifs couvrent l'échec de publication, le message dupliqué, le traitement répété et la reprise. Aucun envoi Expo |

## Preuves qui exigent un environnement Cloudflare réel

| # | Reste à faire hors de cette PR |
|---|---|
| 1 | Rejouer le middleware simplifié sur un Worker Cloudflare, hors production |
| 2 | Créer un Hyperdrive vers une base de test, pas vers Supabase prod ou préprod |
| 3 | Lier `BROWSER` et produire un PDF réel. Configuration préparée, non déployée : `wrangler.browser-run.jsonc` |
| 4 | Rejouer la file sur une Queue Cloudflare |

## Browser Run — bindings et coût

`wrangler.browser-run.jsonc` déclare le binding `BROWSER` lu par `src/pdf.js`. `workers_dev` est faux. Il n'y a pas de `account_id`, pas de route DNS, pas de secret. Le test local continue d'utiliser `wrangler.jsonc`, qui n'a pas ce binding.

Tarif public de la page Browser Run du 21 avril 2026, pour une session Puppeteer :

| Offre | Inclus | Au-delà |
|---|---|---|
| Workers Free | 10 minutes par jour, 3 navigateurs concurrents | non prévu |
| Workers Paid | 10 heures par mois, 10 navigateurs concurrents en moyenne mensuelle | 0,09 USD par heure, 2 USD par navigateur supplémentaire |

L'offre Workers Paid à 5 USD par mois ne contient pas ces dépassements. Cette PR ne lance pas Browser Run.

## Shim UTF-8

`src/iconvLiteShim.cjs` remplace `iconv-lite` uniquement dans les deux fichiers Wrangler du POC. Il accepte UTF-8, reconstitue un caractère coupé entre deux fragments, et rejette un encodage non pris en charge ou une séquence invalide. Il n'est pas branché sur l'application Somafrik.

## Dette RBAC indépendante

`country_admin` et `Admin Pays` divergent sur `GET /api/students`. Le constat est dans `DEBT-ADMIN-PAYS.md`. Le module RBAC n'est pas modifié.

## Garde-fous

- `APP_ENV` doit valoir `workers-poc`.
- Le jeton dans l'URL est refusé.
- Toute URL PostgreSQL dont l'hôte est Supabase, Render ou `somafrik.app` est refusée.
- Le nom de base doit contenir `workers_poc`.
- Le HTML du bulletin est la maquette officielle, remplie avec un élève fictif, sans URL externe.

## Lancer

`POC_DATABASE_URL` désigne uniquement la base jetable. Elle ne va pas dans git.

```bash
cd workers/mig-workers-poc-01
npm ci
POC_DATABASE_URL='postgresql://…@127.0.0.1:5432/somafrik_workers_poc' npm test
```
