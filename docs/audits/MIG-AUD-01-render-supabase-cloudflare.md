# MIG-AUD-01 — Audit de migration Render vers Supabase + Cloudflare

| Champ | Valeur |
|---|---|
| Projet | SOMAFRIK |
| Dépôt | `Somafrik-education/Somafrik` |
| Branche documentaire | `audit/mig-aud-01-render-supabase-cloudflare` |
| Base | `develop` |
| Base SHA | `09ce72712d036e3729ebefd3625a7cf9cf9c5fc0` |
| Date du relevé | 29 octobre 2026, 11:48 CET (Europe/Paris) |
| Classification | AUDIT ONLY — aucune implémentation |
| Statut | **DRAFT / HOLD / NO MERGE** |
| Autorité | CTO Somafrik |

Ce document est le seul changement de la branche d'audit. Il ne modifie ni le code, ni les schémas, ni les workflows, ni les paramètres Render, Supabase ou Cloudflare.

Le SHA du commit documentaire est le HEAD de la pull request. Il n'est pas recopié dans ce fichier, parce qu'un hash inscrit avant le commit ne peut pas se désigner lui-même.

---

## Décision CTO du 29 octobre 2026 — cible Workers

Décision reçue le 29 octobre 2026, après-midi (Europe/Paris), après le relevé de 11:48 CET.

| Sujet | Décision |
|---|---|
| Cible principale | **Cloudflare Workers** pour l'API, avec Cron Triggers, Queues, Browser Run, R2 et Hyperdrive |
| Postgres | Supabase production et préproduction, inchangés, connexion prévue par Hyperdrive |
| Scénario B (Node traditionnel) | **Option de repli**, plus la cible |
| Migration des 371 routes | Interdite tant que le POC `MIG-WORKERS-POC-01` n'a pas réussi quatre preuves isolées |
| Offre Workers | Paid à 5 USD/mois privilégiée si le POC est viable. Le minimum publié ne couvre pas Browser Run, R2 ni les dépassements. La mémoire reste **128 Mo** par isolate |
| DNS, données scolaires, production | Toujours hors de ce mandat et hors du POC |

Les quatre preuves exigées avant toute migration complète :

1. Un endpoint Express représentatif, exécuté dans Workers, avec le JWT et le RBAC existants, sans les affaiblir.
2. Une transaction PostgreSQL réelle sur une base de test, via Hyperdrive.
3. Un bulletin PDF produit par Browser Run.
4. Un traitement différé de notification par Queues ou Cron.

L'analyse des sections 5 et 6 reste valable : la documentation Cloudflare confirme `pg` avec Hyperdrive (minimum `pg@8.16.3`) et Browser Run via `@cloudflare/puppeteer`, et elle ne garantit pas que le code Somafrik actuel tient sans adaptation. Le boot DDL, le disque, `setInterval`, Nodemailer sur le port 587 et la mémoire 128 Mo restent des travaux, pas des détails.

Le POC est une pull request séparée. Il ne part pas de cette branche documentaire.

---

## 0. Méthode et légende

| Mention | Sens |
|---|---|
| **CONFIRMÉ** | Preuve lue dans le dépôt, dans une réponse HTTP/DNS publique, ou dans une documentation prestataire citée. |
| **PROBABLE** | Indice technique cohérent, vérification incomplète. |
| **INCONNU** | Information absente de ce relevé (dashboard, secret, facture, contenu de disque, schéma réellement appliqué). |
| **HYPOTHÈSE** | Scénario de charge ou de prix, explicitement non constaté. |

Périmètre respecté :

- lecture du dépôt au SHA de base ;
- résolution DNS publique ;
- `GET` HTTPS non authentifiés sur les noms déjà publiés ;
- documentation tarifaire publique consultée le 29 octobre 2026.

Hors périmètre, et non effectué : réactivation Render, SQL, rotation de secret, changement DNS ou TLS, création de base, build ou publication mobile, merge, push sur `develop` ou `main`.

Aucune chaîne de connexion, aucun mot de passe, aucun jeton et aucune clé de service ne figurent dans ce rapport. Les identifiants de projet déjà présents dans d'autres documents de conformité ne sont pas recopiés.

---

## 1. Synthèse exécutive

Somafrik peut quitter Render **sans réécrire le backend** et **sans nouvelle version mobile obligatoire**, à condition de conserver les noms `api.somafrik.app` et `api-preprod.somafrik.app`, de garder un runtime Node.js 22 capable d'exécuter l'image actuelle, et de traiter les fichiers locaux avant toute suppression de service.

Le portage du monolithe Express vers Cloudflare Workers ou vers les Edge Functions Supabase est **insuffisant**. Les deux runtimes refusent, par leurs limites publiées, la combinaison réellement utilisée : processus long, Chromium, disque persistant, pool PostgreSQL et travailleurs `setInterval`.

**Cible retenue par le CTO le 29 octobre 2026 : scénario A adapté (Workers), sous réserve du POC. Le scénario B devient le repli.**

| Couche | Cible |
|---|---|
| DNS | Rester sur la zone Cloudflare déjà autoritaire |
| Web | Assets statiques Vite sur Cloudflare, mêmes noms `somafrik.app` et `preprod.somafrik.app` |
| TLS, proxy et WAF | Cloudflare devant le Web ; devant l'API seulement après réglage de `TRUST_PROXY_HOPS` |
| API | Runtime Node.js traditionnel, image `backend/Dockerfile` (Node 22.12 + Chromium) |
| PostgreSQL | Projets Supabase déjà désignés, sans nouvelle base |
| Fichiers | Objet (R2 recommandé, Storage Supabase acceptable) après POC, téléchargement toujours autorisé par l'API |
| Mobile | Aucun changement de contrat ni de nom. Expo Updates est désactivé : un changement de nom imposerait un binaire |
| Démo | Hors migration de données. Code partagé avec `server.js`, base séparée |

Le 29 octobre 2026, les services Web et API de production, préproduction et démonstration répondent **HTTP 503** avec l'en-tête `x-render-routing: suspend` et le texte « This service has been suspended ». Le processus Node ne répond plus. Ce n'est pas le JSON de `GET /api/health`. Les applications Web et les binaires mobiles qui ciblent ces noms sont indisponibles tant que le DNS pointe vers ces services suspendus.

La base de production a été consignée le 5 septembre 2026 sur Supabase `eu-west-1`, PostgreSQL 17. Le mandat CTO confirme aussi la préproduction `eu-central-1`. **Ce relevé n'a pas relu les dashboards** et ne prouve pas que les variables Render pointent encore vers ces projets, ni que les disques contiennent encore les fichiers.

Point de procédure **P0** : le démarrage de l'API exécute `schema.sql` puis une chaîne d'assurances de schéma. Le premier boot d'un nouveau runtime contre la base de production n'est pas une opération en lecture seule. Il doit d'abord être répété sur une copie ou une branche de base.

---

## 2. Inventaire de l'infrastructure

### 2.1 Ce que le dépôt décrit

`docs/render.md` est la source de vérité d'hébergement versionnée. Elle énonce un fournisseur unique Render pour le Web et l'API.

| Environnement | Rôle | Service nommé dans le dépôt ou le DNS | Branche documentée | Nom public |
|---|---|---|---|---|
| Production | API Node | `somafrik-api-prod.onrender.com` | `main` | `api.somafrik.app` |
| Production | Web statique | `somafrik-web-prod.onrender.com` | `main` | `somafrik.app` et `www` |
| Préproduction | API Node | `somafrik-api-preprod.onrender.com` | `develop` | `api-preprod.somafrik.app` |
| Préproduction | Web statique | `somafrik-web-preprod.onrender.com` | `develop` | `preprod.somafrik.app` |
| Démonstration | API | `somafrik-api-demo.onrender.com` | non prioritaire | `api-demo.somafrik.app` |
| Démonstration | Web | `somafrik-web-demo.onrender.com` | non prioritaire | `demo.somafrik.app` |
| Historique | Nom `somafrik.onrender.com` | encore résolu | aucune référence dans le dépôt | suspendu |

**CONFIRMÉ** par DNS public le 29 octobre 2026 : chaque nom canonique est un CNAME vers le service `onrender.com` correspondant, puis vers `gcp-us-west1-1.origin.onrender.com`.

**CONFIRMÉ** : aucun `render.yaml`, aucun `wrangler.toml`, aucun `vercel.json`. Le déploiement Render n'est pas décrit par un workflow GitHub. `.github/workflows/` construit et vérifie ; il ne publie pas Render.

### 2.2 Conséquences observées de la suspension

Sonde non authentifiée, 29 octobre 2026, 11:48 CET. Chaque URL suivante a renvoyé **503**, `Content-Type: text/html`, en-tête `x-render-routing: suspend`, page « Service Suspended » :

- `https://somafrik.app/`
- `https://www.somafrik.app/`
- `https://api.somafrik.app/api/health` et `/`
- `https://preprod.somafrik.app/`
- `https://api-preprod.somafrik.app/api/health`
- `https://demo.somafrik.app/`
- `https://api-demo.somafrik.app/api/health`
- `https://somafrik-api-prod.onrender.com/api/health`
- `https://somafrik-web-prod.onrender.com/`
- `https://somafrik.onrender.com/`

Conséquences réelles :

| Effet | Statut |
|---|---|
| Le Web production, préproduction et démo ne sert plus l'application | **CONFIRMÉ** |
| L'API ne sert plus le JSON de santé, donc ni login, ni sync, ni PDF, ni push déclenché par l'API | **CONFIRMÉ** |
| Les noms et les certificats existent encore | **CONFIRMÉ** — certificats `somafrik.app` et `api.somafrik.app`, émetteur Google Trust Services, valides du 2 septembre 2026 au **1 décembre 2026** |
| PostgreSQL Supabase est arrêté par cette suspension | **Non établi**. Render et Supabase sont des prestataires distincts. L'état des projets n'a pas été relu |
| Les fichiers des disques Render sont lisibles par HTTP | **CONFIRMÉ que non** : l'API ne répond plus |
| Les fichiers survivent à la suspension | **INCONNU** sans dashboard |
| Le DNS peut être rebasculé plus tard vers un autre origin sans changer le nom | **CONFIRMÉ** au niveau DNS (TTL observé 300 s sur les CNAME) |

Aucune réactivation n'a été tentée.

### 2.3 Supabase

| Projet | Région | Moteur | Source | Relecture dashboard le 29 octobre 2026 |
|---|---|---|---|---|
| Production `Somafrik-prod` | `eu-west-1` (Irlande) | PostgreSQL 17 | Mandat CTO ; consignation du 5 septembre 2026 dans `docs/compliance/preuves-transferts-2026-09-05.md` (`postgres: 17.6.1.166`, état alors `ACTIVE_HEALTHY`) | **Non** — **INCONNU** si l'état a changé |
| Préproduction `Somafrik-preprod` | `eu-central-1` | PostgreSQL 17 | Mandat CTO | **Non** |

Le code n'embarque pas le hostname du pooler. L'exemple préproduction décrit un session pooler Supabase sur le port 5432, avec le segment de région laissé en marqueur (`.env.preproduction.example`).

**INCONNU** : taille de compute, occupation disque, PITR, sauvegarde testée, interrupteur Data API du dashboard, et preuve que `DATABASE_URL` des services Render pointe encore vers ces projets. La consignation du 5 septembre 2026 le faisait pour la production, sans copier le secret.

### 2.4 Cloudflare déjà en place, et ce qui ne l'est pas

**CONFIRMÉ** : la zone `somafrik.app` est déléguée à Cloudflare (`dale.ns.cloudflare.com`, `demi.ns.cloudflare.com`).

**CONFIRMÉ** : les enregistrements applicatifs ne sont pas proxifiés par le compte Somafrik au sens « IP anycast Cloudflare client ». Le résolveur public voit le CNAME `*.onrender.com` et des adresses `216.24.57.16` / `216.24.57.18`, qui appartiennent à la chaîne CDN de l'origin Render (`*.cdn.cloudflare.net`). L'en-tête `Server: cloudflare` et le `CF-RAY` observés depuis l'outil de sonde (colo `IAD`) décrivent cette chaîne Render, pas un Worker Somafrik. Le colo de la sonde n'est pas la région de calcul.

**CONFIRMÉ** : le courrier entrant est routé par Cloudflare Email Routing (MX `route1.mx.cloudflare.net`, `route2`, `route3`). SPF publié : `v=spf1 include:_spf.mx.cloudflare.net ~all`.

**CONFIRMÉ** : `mail.somafrik.app` pointe vers un nom Brevo (`mail-somafrik-app.brand.brevosend.com`) et un TXT de vérification Brevo existe. Le code d'envoi de l'API est un SMTP générique `nodemailer`. **INCONNU** : la valeur opérationnelle de `SMTP_HOST`. Brevo n'est pas une dépendance npm.

**INCONNU**, parce que le dashboard n'a pas été ouvert et qu'aucun fichier de configuration n'est versionné : règles WAF, rate limiting Cloudflare, cache rules, redirections, Workers, Pages, R2, plan (Free, Pro, Business). Leur présence ne doit pas être supposée.

### 2.5 Autres prestataires

| Prestataire | Rôle prouvé | Lieu |
|---|---|---|
| Expo | Push HTTP `exp.host` et builds EAS | Documentation Expo : traitement GCP États-Unis. **CONFIRMÉ** dans `docs/compliance/sous-traitants-transferts.md` et dans le code d'envoi |
| GitHub | Dépôt et CI | Actions, pas d'hébergement applicatif |
| Docker local + Caddy | Stack d'appoint, pas la topologie active | `docker-compose.production.yml`, `deploy/caddy/Caddyfile` |

### 2.6 Contradiction documentaire à ne pas traiter comme un fait d'exploitation

| Document | Affirmation |
|---|---|
| `docs/render.md`, `docs/preproduction.md` | Render seul pour Web et API |
| `docker-compose.production.yml` lignes 1–3 | Frontend Vercel, Postgres local dans Compose |
| `web/README.md` | Production Vercel |
| `docs/project/OPERATIONS.md` | Préprod Vercel et URL native `somafrik-api-preprod.onrender.com` |
| DNS du 29 octobre 2026 | Tous les noms canoniques vont vers Render |

**CONFIRMÉ** : la topologie réseau active est Render. Les mentions Vercel sont des restes. `docs/vercel.md`, référencé par OPERATIONS, est absent du dépôt.

### 2.7 Région de calcul Render

Le nom `gcp-us-west1-1.origin.onrender.com` **ne prouve pas** que le calcul est en Oregon. Le document de conformité du 5 septembre 2026 le dit explicitement et consigne l'API de production en région Render **Frankfurt**, d'après les métadonnées du service, pas d'après le CNAME.

| Sujet | Statut au 29 octobre 2026 |
|---|---|
| Région calcul API production | **PROBABLE** Frankfurt, dernière preuve datée du 5 septembre 2026. Non relue |
| Région calcul préprod, démo, sites statiques | **INCONNU** |
| Région Postgres production | **CONFIRMÉ** historiquement `eu-west-1`, et redite par le mandat |
| Région Postgres préproduction | **Déclarée par le mandat** : `eu-central-1`. Non relue |

Un futur runtime Node de production devrait être placé près de `eu-west-1` pour limiter la latence et l'egress. La préproduction devrait être placée près de `eu-central-1`. Déplacer les projets Supabase n'est ni nécessaire ni autorisé par ce mandat.

### 2.8 Démonstration et service historique

Décision CTO appliquée ici : aucune migration et aucune sauvegarde de `somafrik-demo-db`. Les données sont fictives. Les services n'ont pas été supprimés.

Dépendance technique partagée, **CONFIRMÉ** dans le code :

- `backend/demoGateway.js` lance le **même** `backend/server.js` en processus fils (`spawn`), avec `APP_ENV=demo`, `SOMAFRIK_API_ONLY=true`, port interne `DEMO_INNER_PORT` (défaut 5001).
- Le stockage démo attendu est distinct : `/var/lib/somafrik-demo/communication-storage` (`.env.demo.example`).
- Le garde-fou de reset exige un marqueur `somafrik_demo` dans l'URL de base.

Aucune référence à `somafrik.onrender.com` dans le dépôt (recherche sur les sources, docs, workflows et exemples). Le nom résout encore et sert la page de suspension. Dépendance résiduelle : **DNS et service Render orphelin**, pas un appel du code actuel. **INCONNU** : un binaire mobile ancien, non inspecté, pourrait encore viser ce nom. Les profils EAS versionnés visent `api.somafrik.app` et `api-preprod.somafrik.app`.

---

## 3. Cartographie Web → API → PostgreSQL

```text
Navigateur
  https://somafrik.app  ou  https://preprod.somafrik.app
        |  SPA Vite, VITE_API_URL figé au build
        |  Authorization: Bearer, sessionStorage
        v
  https://api.somafrik.app/api/*   ou   https://api-preprod.somafrik.app/api/*
        |  Express, server.js, requireAuth + RBAC + tenant
        |  pg.Pool, DATABASE_URL
        v
  Supabase PostgreSQL 17
  prod eu-west-1 / préprod eu-central-1
        |
        +-- fichiers locaux du service API (disque Render)
            logos, pièces jointes, documents élèves, sources de bulletins
```

Aujourd'hui les deux premières flèches s'arrêtent sur la page de suspension Render. La troisième flèche n'a pas été exécutée.

Le Web n'appelle pas PostgREST. **CONFIRMÉ** : pas de `@supabase/supabase-js` dans `web/src`. Le seul fichier de test backend qui cite ce paquet vérifie son absence (`backend/lib/supabaseDataApiLockdown.test.js`).

---

## 4. Cartographie Mobile → API → PostgreSQL

```text
Binaire Expo (URL compilée dans extra.apiUrl)
  production  -> https://api.somafrik.app/api
  preview / préproduction -> https://api-preprod.somafrik.app/api
        |  Bearer, jetons dans expo-secure-store
        |  refresh POST /api/auth/refresh
        |  sync L1 GET /api/mobile-sync/l1/*
        |  outbox présences, notes, messages
        v
  Même API Express que le Web
        v
  Même PostgreSQL
        |
        +-- POST /api/mobile/push-devices
              puis envoi serveur -> https://exp.host/--/api/v2/push/*
```

Le mobile ne parle pas non plus à la Data API Supabase. **CONFIRMÉ** : pas de client Supabase dans `Mobile/src`.

`Mobile/app.config.js` désactive Expo Updates (`updates.enabled: false`, lignes 129–131). Un changement de nom d'API ne peut pas être poussé en OTA. Il exige un nouvel AAB/APK. Conserver les noms évite cette publication.

---

## 5. AUDIT-A — Backend

Runtime exigé : Node `>=22.12.0` (`backend/package.json`, `.nvmrc` = `22.12.0`). Dépendances de production : `express` 4.22, `pg` 8.21, `puppeteer` 25.13, `nodemailer` 10.2, `cors`, `dotenv`, `jsqr`, `qrcode`. Pas de `socket.io`. Pas de Redis. Pas de client Supabase.

### 5.1 Point d'entrée

`backend/server.js` (8 053 lignes) crée l'application, puis `initRepository()` et `app.listen` sur `0.0.0.0` et `PORT` ou 5000 (lignes 8002–8014).

`SOMAFRIK_API_ONLY=true` (ligne 210) retire le site `/web` intégré. Les Compose de préproduction et de production le posent. Le BackOffice statique `/backoffice` est servi **même** en mode API seule (lignes 196–207).

`GET /api/health` (lignes 334–353) initialise le dépôt, sonde l'écriture du stockage des pièces jointes et des sources de bulletins, et répond 503 `not_ready` si un stockage de production n'est pas prêt. Le champ `database` vaut le moteur du repository (`postgresql`). Cette route n'a pas répondu le 29 octobre 2026 : Render a répondu avant le processus.

Le boot de production refuse une base mémoire (`initRepository`, lignes 8035–8036), exige les secrets, le verrouillage de login et la CORS (`warnIfUnsafeConfiguration`, lignes 8045–8052).

### 5.2 Routes

**CONFIRMÉ** : l'API est un monolithe. Le compteur runtime versionné dans `docs/project/MONO-T1-ROUTES.md` est **371 routes** enregistrées. Un module séparé, `registerReportCardHttp`, ajoute la famille bulletins. Il n'y a pas de découpage `express.Router` par domaine.

Familles du même inventaire : authentification 12, utilisateurs et rôles 37, élèves 47, notes et présences 64, finance 26, communication 45, pédagogie et planning 80, plateforme 53, autres 7.

Les mutations sensibles passent par `withIdempotency`. Sans en-tête `Idempotency-Key`, le handler s'exécute sans déduplication (comportement du service d'idempotence).

### 5.3 Authentification

| Mécanisme | Preuve | Compatibilité edge |
|---|---|---|
| JWT maison HS256, audience `somafrik-api`, en-tête limité à `alg` et `typ` | `backend/services/tokenService.js` | Le HMAC `crypto` est disponible sur Workers. Le service de sessions, lui, est en PostgreSQL |
| Access 15 min maximum, refresh 7 jours, grâce de réutilisation 15 s | `backend/lib/authTokenPolicy.js` | Compatible partout |
| Rejet de `?token=` et `?access_token=` | `server.js` vers 7549, monté sur `/api` ligne 195 | Compatible |
| `POST /api/auth/refresh` avec rotation de session | `server.js` ligne 504, `sessionRefreshService` | Exige PostgreSQL transactionnel |
| Binding session + garde d'abonnement + révocation | `requireAuth` dans `server.js` | Exige l'état PostgreSQL à chaque requête |

Les jetons ne sont pas des cookies. Le Web les garde dans `sessionStorage` (`somafrik.web.session`). Le mobile les garde dans SecureStore. Un changement de `JWT_SECRET` invalide tous les jetons déjà émis et force une reconnexion. Ce n'est pas une perte de données métier. Reprendre le même secret évite cette coupure.

### 5.4 RBAC et isolation multi-établissements

`RbacService.canAccess` retourne faux si la route n'a pas de permission (`backend/services/rbacService.js`, échec fermé sur route inconnue). `requirePermission` recharge les permissions PostgreSQL quand elles sont disponibles.

L'isolation d'établissement est **applicative**. `TenantScopeService.filterRows` et `assertSchoolAccess` filtrent `school_id` / code établissement à partir du principal. Il n'existe **aucune** instruction `ENABLE ROW LEVEL SECURITY` ni `CREATE POLICY` dans `backend/db/schema.sql` ni dans les 84 migrations.

Comportements à ne pas « simplifier » pendant une migration :

- `filterRows` sans principal retourne les lignes telles quelles (`tenantScopeService.js`).
- Un super-admin sans établissement effectif n'est pas filtré par école.
- `assertSchoolAccess` sans principal ne fait rien.

Ces branches sont fermées quand `requireAuth` a réellement produit un principal. Elles redeviennent un fail-open si une route oublie le middleware. La migration ne doit ni exposer la Data API, ni connecter le Web ou le mobile directement à Postgres.

### 5.5 PostgreSQL

`backend/db/connectionConfig.js` :

- `DATABASE_URL` ou variables `DB_*` / `POSTGRES_*` ;
- pool `DB_POOL_MAX`, défaut **5**, borné de **1 à 6** (lignes 12–15), commentaire explicite : marge sous un pooler session de 15 clients pour deux instances ;
- SSL selon `DB_SSL`, `sslmode`, `DB_SSL_REJECT_UNAUTHORIZED`.

`PostgresRepository` ouvre un `pg.Pool` et fournit `withTransaction` (`BEGIN` / `COMMIT` / `ROLLBACK`).

**INCONNU dans le code** : `statement_timeout`, `connectionTimeoutMillis`, `idleTimeoutMillis`. Les défauts de `node-pg` s'appliquent.

Le lockdown Data API est réappliqué à chaque init (`ensureSupabaseDataApiLockdown`, migration `20260904_p0_supabase_data_api_lockdown.sql`) : `REVOKE` de `anon`, `authenticated` et `PUBLIC`. Le rôle applicatif de `DATABASE_URL` conserve ses droits. `docs/compliance/supabase-data-api-lockdown.md` décrit en plus un interrupteur dashboard, **non vérifié** ici.

### 5.6 Migrations et idempotence de schéma

84 fichiers SQL sous `backend/db/migrations/`, du préfixe `20260811` à `20261023`. **CONFIRMÉ** : pas de table `schema_migrations` côté serveur. `PostgresRepository.init()` exécute `schema.sql` puis une longue série d'`ensure*` (extrait lignes 122–140, la chaîne continue jusqu'au lockdown et au `search_path`). Certains `ensure*` relisent un fichier de `migrations/`. D'autres fichiers SQL sont des backfills manuels, hors boot.

`npm prestart` lance `backend/scripts/prestart-idempotency-schema.js` avant `node server.js`.

Conséquence de migration : allumer un nouveau conteneur sur la base canonique **réapplique du DDL**. Les scripts sont écrits pour être idempotents (`IF NOT EXISTS`, lockdown répétable), mais l'absence de registre empêche d'affirmer que l'état Supabase égale git. **INCONNU** : écart réel. Le premier essai doit viser une copie.

L'idempotence métier (`idempotency_keys`) est distincte de ce boot. Elle déduplique les requêtes qui portent `Idempotency-Key`. Le cache de verrous est aussi en mémoire de processus.

### 5.7 Travailleurs permanents

Deux `setInterval` dans le même processus que HTTP, démarrés à la fin de `initRepository` (lignes 8041–8042) :

| Travailleur | Période par défaut | Arrêt |
|---|---|---|
| `communicationsNotificationsWorker.js` | 5 s (`COMMUNICATION_NOTIFICATIONS_POLL_MS`) | `NODE_ENV=test` ou `COMMUNICATION_NOTIFICATIONS_WORKER=disabled` |
| `expoPushReceiptsWorker.js` | 60 s | test, ou `EXPO_PUSH_RECEIPTS_WORKER=disabled` |

Pas de `node-cron`. Un garde `running` évite le chevauchement **dans un processus**. Deux instances feraient deux balayages. Le disque Render, de son côté, interdit déjà le scale horizontal (un disque persistant Render n'est montable que sur une instance). Le passage à un stockage objet lèvera cette contrainte et rendra le double envoi **probable** tant qu'un verrou de leader n'existe pas.

### 5.8 Push Expo

`backend/lib/expoPushService.js` appelle l'API HTTP Expo par `fetch`, pas le paquet `expo-server-sdk`. URLs surchargeables : `EXPO_PUSH_SEND_URL`, `EXPO_PUSH_RECEIPTS_URL`, défauts sur `exp.host`. L'enregistrement des appareils est `POST /api/mobile/push-devices`. L'échec d'envoi ne rollback pas l'outbox (`communicationChannelFanout.js`).

Compatible avec n'importe quel runtime qui peut faire une sortie HTTPS vers Expo. Incompatible avec un modèle où le processus meurt entre les requêtes, sauf à remplacer les deux `setInterval` par un scheduler externe.

### 5.9 Courriel

`nodemailer` est optionnel. `SMTP_HOST` et `MAIL_FROM` absents : l'API démarre, la demande d'essai reste en base, l'envoi est marqué non configuré. Ports, STARTTLS et identifiants sont des variables, jamais des constantes de fournisseur.

Les Edge Functions Supabase **interdisent les connexions sortantes vers les ports 25 et 587** (documentation Supabase, page Limits). Le SMTP actuel sur 587 n'y fonctionnerait pas sans un autre transport. Un runtime Node n'a pas cette interdiction.

### 5.10 PDF et Puppeteer

`backend/services/bulletinPdfRenderer.js` : timeout 20 s (ligne 28), Chromium headless, sandbox **désactivée par défaut** parce que l'image tourne en root (lignes 67–86). `SOMAFRIK_PDF_CHROMIUM_SANDBOX=enabled` la rallume. `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` dans `backend/Dockerfile`, qui installe Chromium, nss, freetype, harfbuzz et les fontes.

Un second chemin PDF existe dans `backend/lib/reportCard/reportCardPdf.js`.

Ce couple est le principal verrou de runtime : binaire natif, mémoire bien au-dessus de 128 Mo, processus de navigateur persistant (`browserPromise`).

### 5.11 Fichiers, limites, variables

Détail stockage : section AUDIT-E. Limites constatées :

| Limite | Valeur | Preuve |
|---|---|---|
| JSON | `JSON_BODY_LIMIT`, défaut `1mb`, exemples prod/préprod `2mb` | `server.js` ligne 174, exemples d'env |
| Pièce jointe | 10 Mo, MIME pdf/jpeg/png ; upload HTTP `express.raw` 11 Mo | `communicationsAttachments.js` ; `server.js` lignes 4153–4156 |
| Logo | 5 Mo, jpeg/png/webp | `schoolLogo.js` lignes 16–22 |
| Login | 15 / 60 s par défaut | `server.js` lignes 118–123 |
| Essai public | 5 / 60 s | lignes 137–142 |
| Diagnostic NFC | 30 / 10 min | lignes 131–136 |
| Auto-test push | 5 / 60 s, et interdit en production par l'environnement | lignes 124–129 |

Le rate limit est une `Map` mémoire (`backend/lib/rateLimit.js`). Le fichier dit lui-même de le compléter par le reverse proxy en multi-instance. Il se vide au redémarrage et ne suit pas un attaquant qui change d'instance.

Variables lues par le runtime, **noms seulement** : `NODE_ENV`, `PORT`, `APP_ENV`, `SOMAFRIK_ENV`, `SOMAFRIK_API_ONLY`, `SOMAFRIK_DB_REQUIRED`, `SOMAFRIK_SKIP_DEMO_SEED`, `DATABASE_URL`, `DB_*`, `POSTGRES_*`, `DB_POOL_MAX`, `DB_SSL*`, `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `TRUST_PROXY_HOPS`, `JSON_BODY_LIMIT`, `SOMAFRIK_COMMUNICATION_STORAGE`, `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE`, `SMTP_*`, `MAIL_FROM`, `TRIAL_REQUEST_NOTIFY_TO`, `EXPO_PUSH_*`, `COMMUNICATION_NOTIFICATIONS_*`, `EXPO_PUSH_RECEIPTS_*`, `PUPPETEER_EXECUTABLE_PATH`, `SOMAFRIK_PDF_CHROMIUM_SANDBOX`, `SOMAFRIK_PUSH_SELFTEST_ENABLED`, `LOGIN_RATE_LIMIT_*`, `NFC_DIAGNOSIS_RATE_LIMIT_*`, `TRIAL_REQUEST_RATE_LIMIT_*`, `STUDENT_CARD_NFC_PROVISION_SECRET`, secrets de bootstrap superadmin, origines démo.

`CORS_ORIGINS` est documenté dans `docs/render.md` et les exemples d'environnement. **CONFIRMÉ** : aucune lecture de `CORS_ORIGINS` dans `backend/**/*.js`. Les origines effectives sont codées dans `backend/lib/corsConfig.js` : `https://somafrik.app`, `https://preprod.somafrik.app`, `https://demo.somafrik.app`.

### 5.12 Matrice de compatibilité par composant

| Composant | Fichiers | Workers | Edge Functions | Node traditionnel | Effort si on quitte Render | Risque |
|---|---|---|---|---|---|---|
| Cycle HTTP Express | `server.js` | Insuffisant : pas de `listen` durable, démarrage borné à 1 s | Insuffisant : isolate Deno, pas Express | Complet | Faible : même image | Faible si l'image est reprise telle quelle |
| 371 routes, RBAC, tenant | `server.js`, `rbacService.js`, `tenantScopeService.js` | Exigerait une réécriture | Idem | Complet | Nul si le processus est conservé | Élevé si l'on « allège » les middlewares |
| JWT HS256 + sessions PG | `tokenService.js`, refresh | Partiel (crypto oui, sessions et boot non) | Partiel | Complet | Nul si `JWT_SECRET` identique | Moyen si le secret change : reconnexion générale |
| `pg` pool max 6, transactions | `connectionConfig.js`, `postgresRepository.js` | Partiel via Hyperdrive / TCP, incompatible avec le boot DDL et 128 Mo | Possible en théorie pour une fonction courte, pas pour ce boot | Complet | Faible : `DATABASE_URL` | Élevé au premier boot (DDL) |
| Idempotence SQL | `idempotencyService.js` | Le verrou mémoire ne survit pas | Idem | Complet sur une instance | Faible | Moyen en multi-instance |
| Workers outbox + reçus push | `setInterval` | Non durable | `waitUntil` borné à 400 s payant, pas un poll 5 s permanent | Complet sur une instance | Faible tant qu'une seule instance | Élevé si scale-out sans leader |
| Push Expo | `expoPushService.js` | Sortie HTTPS possible | Possible | Complet | Nul | Faible |
| SMTP 587 | `communicationChannelFanout.js` | Possible si le port n'est pas filtré | **Insuffisant** : ports 25 et 587 interdits | Complet | Nul | Faible |
| PDF Puppeteer 20 s | `bulletinPdfRenderer.js`, Dockerfile | Insuffisant en l'état. Browser Run utilise `@cloudflare/puppeteer` (fork v22) et un binding, pas le `puppeteer` npm 25 du dépôt | Insuffisant : 256 Mo, pas de Chromium, bibliothèques natives multithread interdites | Complet avec l'image actuelle | Faible sur Node ; élevé partout ailleurs | Élevé : régression bulletins |
| Disque pièces jointes | `communicationsAttachments.js`, `schoolLogo.js` | `node:fs` annoncé supporté n'est pas un disque Render | `/tmp` éphémère seulement | Complet avec un volume, ou incomplet sans volume | Moyen : adaptateur objet | Élevé tant que les octets sont seulement sur le disque suspendu |
| Rate limit mémoire | `rateLimit.js` | À remplacer par le WAF | Non partagé | Complet sur une instance | Faible | Moyen derrière un mauvais `TRUST_PROXY_HOPS` |
| WebSocket | aucun serveur | Sans objet | Sans objet | Sans objet | Nul | Nul |
| Passerelle démo | `demoGateway.js` | `child_process` absent | Absent | Complet | Hors périmètre données | Ne pas réutiliser la base prod |

---

## 6. AUDIT-B — Trois scénarios

Prix : section AUDIT-H. Ici, le jugement de faisabilité.

### Scénario A — Cloudflare Workers pour l'API

Documentation citée le 29 octobre 2026 :

- [Limits Workers](https://developers.cloudflare.com/workers/platform/limits/) (mise à jour 12 octobre 2026) : plan payant, **128 Mo** de mémoire, **1 s** de démarrage, **5 min** de CPU par requête HTTP (défaut 30 s), 6 connexions sortantes simultanées, cron jusqu'à 15 min de CPU.
- [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) (12 août 2026) : `crypto`, `path`, `stream`, `net`, timers et file system marqués supportés à partir de la compatibility date `2026-08-04`.
- [Browser Run / Puppeteer](https://developers.cloudflare.com/browser-run/puppeteer/) (14 octobre 2026) : `@cloudflare/puppeteer` v1.1.0, basé sur Puppeteer **v22.13.1**, lancé par un binding `env.MYBROWSER`. Ce n'est pas `puppeteer` 25.13 ni un Chromium local.

| Exigence Somafrik | Verdict |
|---|---|
| Express et `app.listen` | Insuffisant sans réécriture du cycle de vie. Un adaptateur de fetch ne supprime pas les autres blocages |
| `pg` et le boot DDL | Insuffisant. Hyperdrive peut connecter Postgres ; il ne rend pas le boot de schéma compatible avec 1 s et 128 Mo |
| Puppeteer 25 + Chromium du Dockerfile | Insuffisant sans réécriture vers Browser Run, et sans preuve que les bulletins (polices, images locales, 20 s) tiennent dans ce produit |
| `fs` persistant | Insuffisant. Le support `node:fs` ne crée pas le volume `/var/lib/somafrik` |
| Requêtes PDF 20 s | Le CPU payant peut couvrir 20 s ; la mémoire 128 Mo ne couvre pas Chromium |
| `setInterval` permanent | Insuffisant. Un Cron Trigger est un autre modèle, à réécrire, et n'est pas un processus toujours chaud |
| Connexion Supabase | Possible techniquement en TCP ou Hyperdrive, inutile si le reste ne tient pas |

**Compatibilité fonctionnelle : insuffisante.** Complexité d'une réécriture : élevée. Ce scénario n'est pas une migration ; c'est un autre backend.

### Scénario B — Cloudflare pour le bord, Node pour l'API, Supabase pour Postgres

| Couche | Rôle |
|---|---|
| Cloudflare DNS | Déjà en place |
| Cloudflare assets statiques | `web/dist`, repli SPA, en-têtes de cache |
| Cloudflare TLS / WAF | Utile devant le Web. Devant l'API : cache bypass obligatoire, et `TRUST_PROXY_HOPS` recalculé |
| Runtime Node | L'image actuelle. Une instance par environnement tant que les travailleurs ne sont pas protégés par un verrou |
| Supabase | Inchangé, rôle SQL unique applicatif, Data API fermée |

**Compatibilité fonctionnelle : complète**, sous trois preuves encore à produire en POC (boot DDL sur copie, PDF sur l'hôte choisi, lecture des disques Render). Complexité : moyenne, concentrée sur l'exploitation et les fichiers, pas sur une réécriture. Réversibilité : bonne tant que les services Render et les disques ne sont pas détruits, parce que les CNAME peuvent revenir vers `*.onrender.com` (TTL 300 s).

### Scénario C — Edge Functions pour des fonctions ciblées

Limites publiées ([Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits)) : 256 Mo, 2 s de CPU par requête, horloge 150 s (Free) ou 400 s (payant), ports 25 et 587 interdits, pas de bibliothèques natives multithread.

Aucune fonction actuelle n'est un bon premier candidat sans réécriture : le PDF, le SMTP 587, le poll d'outbox et le boot de schéma sont hors limites. Un endpoint sans fichier, sans Chromium et sans état mémoire pourrait l'être plus tard. Il n'y a pas de gain à isoler une route tant que les 371 autres restent sur Node, et il y a un coût de deux modèles d'authentification à maintenir.

**Compatibilité : insuffisante comme cible principale, partielle seulement pour un futur découpage prouvé.** Ce mandat ne chiffre pas une réécriture.

### Comparatif

| Critère | A — Workers | B — Node + Cloudflare + Supabase | C — Edge Functions ciblées |
|---|---|---|---|
| Compatibilité fonctionnelle | Insuffisante | Complète, sous POC de boot, PDF et disque | Insuffisante pour le monolithe |
| Complexité | Élevée (réécriture) | Moyenne (hébergement et fichiers) | Élevée si on s'en sert comme stratégie, faible si on n'y touche pas |
| Coût d'exploitation | Bas sur le papier, non atteignable sans réécriture | Proche du compute Render actuel, Postgres déjà payé | N'enlève pas le coût du Node tant que le monolithe reste |
| Scalabilité | Isolats nombreux, mais 128 Mo et 6 connexions | Une instance par env au début ; scale-out après objet + verrou worker | Mauvais outil pour PDF et poll |
| Sécurité | Nouvelle surface (Data API à ne pas ouvrir, secrets Workers) | Risque principal : `TRUST_PROXY_HOPS`, secret JWT, boot DDL | SMTP bloqué ; même risque Data API si l'on « simplifie » |
| Maintenabilité | Deux modèles, ou un fork permanent de Puppeteer | Un seul backend, celui déjà testé en CI | Deux runtimes à garder alignés |
| Réversibilité | Faible après réécriture | Forte tant que Render n'est pas supprimé | Forte si aucune route n'y est déplacée |

**Position de l'audit au 29 octobre 2026, 11:48 CET : B était la recommandation.** A était écarté tant qu'il était envisagé comme un déplacement sans adaptation. **Décision CTO du même jour : A devient la cible, à condition d'adapter** Express, le pool `pg`, Puppeteer, les `setInterval`, les disques et le SMTP, puis de réussir `MIG-WORKERS-POC-01`. B reste le repli si une des quatre preuves échoue. C n'est toujours pas une cible.

Le fournisseur exact du Node (le successeur de Render) est une **décision CTO**. Le critère technique est : conteneur Docker, Node 22.12, Chromium, au moins 2 Go de RAM, disque ou volume le temps de la bascule fichiers, sortie HTTPS vers Supabase, Expo et SMTP, une seule instance au départ, région proche de la base. Ce mandat ne crée pas ce service.

---

## 7. AUDIT-C — Frontend Web

Build : `web/package.json` — `vite` en dev, `tsc --noEmit && vite build` en build, sortie `web/dist` (`web/vite.config.ts`). Node de CI : 22.12.0. Les PR Gates construisent avec `VITE_API_URL=https://api.somafrik.app`.

| Variable | Rôle | Défaut utile |
|---|---|---|
| `VITE_API_URL` | Origine API, **figée dans le bundle**. Build impossible si vide | Prod `https://api.somafrik.app` ; préprod `https://api-preprod.somafrik.app` |
| `VITE_BASE_PATH` | `base` Vite | `/` pour un site à la racine du domaine ; `/web/` seulement pour le mode Docker intégré |
| `VITE_API_TARGET` | Proxy de dev uniquement | `http://127.0.0.1:5000` |
| `VITE_SHOW_DEMO_ACCOUNTS` | Boutons de démo | `false` en prod/préprod documenté |
| `VITE_ENABLE_MARKETPLACE` | Flag | `false` documenté |
| `VITE_ENABLE_PUBLIC_DEMO`, `VITE_DEMO_RUNTIME`, `VITE_DEMO_WEB_ORIGIN`, `VITE_DEMO_ENTRY_API_URL` | Parcours démo | Non prioritaire |

`web/src/lib/apiUrl.ts` réécrit encore l'ancienne origine `https://somafrik-api-preprod.onrender.com` vers `https://api-preprod.somafrik.app`. Les nouveaux builds ne doivent pas réintroduire l'origine native Render.

Routage : `react-router-dom` 6, `BrowserRouter`, `basename` dérivé de `BASE_URL`. Exception : `/verify/rc/:capability` est servi avec un basename vide pour rester à la racine. Le repli d'hébergement doit envoyer les chemins inconnus vers `index.html`, y compris `/connexion` et `/verify/rc/*`. Render le documente (`docs/render.md`). Cloudflare Workers Static Assets le permet par une règle SPA. **Il n'existe pas** de `_redirects` ou de `wrangler.toml` dans le dépôt : la règle est aujourd'hui dans le dashboard Render, **non relu**.

Auth Web : `POST /api/backoffice/login`, refresh `POST /api/auth/refresh`, permissions `GET /api/auth/effective-permissions`, logout `POST /api/auth/logout`. Jeton Bearer. Pas de cookie, pas de `credentials: 'include'`. Pas de service worker, pas de WebSocket. Le tableau de bord interroge en polling.

CORS : le navigateur appelle une autre origine. Comme les noms restent `somafrik.app` et `preprod.somafrik.app`, **aucun changement de `corsConfig.js` n'est nécessaire**. Un prévisualisation `*.pages.dev` serait refusée. Stratégie : domaines custom uniquement, pas d'URL de prévisualisation Cloudflare pour les utilisateurs.

En-têtes : le Web n'en pose pas. L'API pose `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, et HSTS seulement si `NODE_ENV=production` **et** `req.secure` (`server.js` lignes 7969–7980). `req.secure` dépend de `TRUST_PROXY_HOPS`. Un proxy de trop ou de trop peu supprime HSTS ou fait confiance à un client. Cache des assets fingerprintés : un an, immutable, dans le mode Express intégré (lignes 245–252). `index.html` est `no-store`. Le site statique Cloudflare doit reproduire cette distinction, sinon un `index.html` mis en cache sert un bundle périmé après déploiement.

Assets : `web/public` (favicons, logos, marketing). Taille unitaire compatible avec la limite Workers Static Assets de 25 Mo par fichier et 100 000 fichiers en plan payant. Le build actuel est très en dessous. **PROBABLE**, non mesuré sur un `dist/` produit pendant cet audit (aucun build lancé : le mandat est documentaire et la CI PR ne construit pas un diff limité à `docs/`).

Stratégie de déploiement Web, sans toucher au mobile :

1. Construire `web/dist` avec les `VITE_*` déjà canoniques et `VITE_BASE_PATH=/`.
2. Publier d'abord sur un nom jetable, smoke des routes profondes et de `/verify/rc`.
3. Basculer le CNAME `preprod.somafrik.app`, puis plus tard `somafrik.app` / `www`.
4. Ne pas changer `VITE_API_URL` tant que l'API n'a pas suivi, et ne jamais y mettre un nom `onrender.com`.
5. Laisser les binaires mobiles sur les noms d'API. Le Web et le mobile ne partagent pas leur hébergement, seulement l'API.

---

## 8. AUDIT-D — PostgreSQL Supabase

| Sujet | Constat | Statut |
|---|---|---|
| Pilote | `pg` uniquement, pas de Data API cliente | **CONFIRMÉ** |
| Pool | max 5 par défaut, plafond 6, prévu pour un pooler session et un rolling de 2 instances | **CONFIRMÉ** dans le code. Taille réelle du pooler **INCONNUE** |
| Session vs transaction pooler | L'exemple préprod parle du **session** pooler, port 5432. Le port 6543 n'est pas le réglage recommandé des exemples | **CONFIRMÉ** comme intention documentée. Réglage live **INCONNU** |
| Transactions | `withTransaction` dans le repository | **CONFIRMÉ** |
| RLS | Absente | **CONFIRMÉ** dans git. État live **INCONNU**, mais rien dans git ne l'active |
| Droits | Lockdown `anon` / `authenticated` / `PUBLIC` rejoué au boot. Rôle applicatif conservé | **CONFIRMÉ** dans git. Application effective sur les projets **INCONNUE** sans requête |
| `search_path` | Migration `20260905_p1_function_search_path.sql` et ensure au boot | **CONFIRMÉ** dans git |
| Index | Unicité présence `(school_id, student_id, attendance_date)` ; index paiements `school_id` ; index appels `(school_id, class_id, roll_call_date)` | **CONFIRMÉ** dans `schema.sql` et migrations. Usage réel **INCONNU** |
| Sauvegardes applicatives | Aucune. Export établissement `GET /api/data-export` n'est pas un backup global | **CONFIRMÉ** — `docs/compliance/sauvegardes-restauration.md` |
| PITR / rétention Supabase | Quotas du plan, non copiés dans git | **INCONNU** |
| Cohérence git ↔ projets | 84 fichiers, pas de ledger, boot partiel | **INCONNU** — vérification SQL non faite, aucun secret de connexion dans cet environnement |
| Performance | Pas de mesures. Le pool de 6 protège Postgres et limite une instance | **INCONNU** |

Interdictions respectées : pas de SQL, pas de reset, pas de changement RLS, pas de rotation, pas de base créée, pas de migration appliquée.

Risque de saturation : avec le plafond de 6 connexions par processus, Postgres Supabase Micro (60 connexions directes / 200 pooler, tarif public) n'est pas le premier goulot. Le premier goulot est le processus unique (PDF, poll, disque). Le danger inverse existe : un scale-out non plafonné, ou un oubli du mode session du pooler, peut épuiser les connexions. Le code actuel est volontairement conservateur. Il faut le garder ainsi.

Ne pas activer la Data API « pour simplifier le mobile ». Ce serait un fail-open multi-établissements, parce que l'isolation n'est pas dans RLS.

---

## 9. AUDIT-E — Fichiers

### 9.1 Où le code écrit

| Donnée | Mécanisme | Durable ? |
|---|---|---|
| Pièces jointes communication, annonces | Répertoire `SOMAFRIK_COMMUNICATION_STORAGE`, clé en base `storage_key`, octets sur disque. Refus de `/tmp` en production | Oui, si le volume est monté |
| Logos | Même racine, préfixe `school-logos/` (`schoolLogo.js` lignes 14–17). Pas d'URL HTTP saisie par l'utilisateur | Oui |
| Documents et photos élèves | `student_documents.storage_key`, lecture `readAttachmentBytes` (`studentAdministrativeDocuments.js` lignes 215–216) | Oui |
| Sources de bulletins | `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` | Oui |
| PDF servis | Générés à la demande ou relus via l'API authentifiée | Pas un bucket |
| Démo | `/var/lib/somafrik-demo/communication-storage` | Hors périmètre |

Les exemples d'environnement citent `/var/lib/somafrik/communication-storage`. Le commentaire production mentionne aussi `/var/data/communication-storage` comme exemple Render. **CONFIRMÉ** : `/var/data` n'est pas un chemin codé en dur. Le chemin effectif est la variable du service. **INCONNU** : la valeur réellement posée sur Render.

Le mandat identifie des capacités de disque : API production 1 Go, préproduction 10 Go, démo 1 Go. **Ces tailles ne sont pas dans git.** Elles sont tenues pour déclarées par le CTO et **non revérifiées** sur le dashboard. L'occupation réelle (octets, nombre de fichiers) est **INCONNUE**. L'API suspendue empêche tout inventaire par HTTP.

Téléchargement : routes authentifiées (`GET /api/backoffice/communications/attachments/:attachmentId`, photo élève, etc.). Logo d'établissement : `GET /api/schools/:code/logo`, public par conception. Pas d'URL signée, pas de SDK Storage, pas de `multer`. Les octets passent en corps brut.

Rétention : `removeStoredAttachment` supprime le fichier. `docs/compliance` indique que les pièces jointes parentes ne sont pas purgées par le job de rétention (`attachmentsWithParentDays: null`). Purge sessions / push : script `purge-retention.js`, gardé par un drapeau. **INCONNU** : politique de cycle de vie du disque Render.

### 9.2 Option 1 — Supabase Storage

| Critère | Lecture |
|---|---|
| Permissions | Buckets et policies à créer. Sans RLS SQL métier, un bucket public ou une policy trop large recrée le fail-open. Le téléchargement doit rester derrière le RBAC de l'API, ou utiliser une URL signée émise **après** le contrôle |
| Isolation | Préfixe par établissement, comme `school-logos/{tenant}` aujourd'hui |
| Web et mobile | Inchangés si l'URL publique reste l'API |
| Migration | Copie depuis le disque Render. Impossible tant que le disque n'est pas lisible |
| Coût public | Plan Pro : 100 Go inclus puis 0,0213 USD/Go. Egress au-delà de 250 Go : 0,09 USD/Go non caché |
| Sauvegarde | Incluse dans le projet, pas un second inventaire git. Test de restauration **INCONNU** |
| Suppression | À coder : l'API supprime déjà le fichier local ; l'adaptateur devra supprimer l'objet |

### 9.3 Option 2 — Cloudflare R2

| Critère | Lecture |
|---|---|
| Permissions | Clés de compte séparées des secrets Postgres. L'API signe ou proxifie. Pas d'accès navigateur direct sans contrôle |
| Isolation | Même préfixe par établissement. Deux buckets, ou un bucket par environnement. Jamais le bucket de prod pour la préprod |
| Web et mobile | Inchangés si l'API reste le point d'entrée. Les URL signées courtes sont compatibles si le client suit une redirection, **à prouver en POC** : le mobile télécharge aujourd'hui via l'API Bearer |
| Migration | Même bloqueur disque |
| Coût public (26 octobre 2026) | 0,015 USD/Go-mois Standard, egress Internet **gratuit**, classe A 4,50 USD / million, classe B 0,36 USD / million. Palier gratuit : 10 Go, 1 million de classes A, 10 millions de classes B |
| Sauvegarde | Durabilité annoncée onze 9. Ce n'est pas une sauvegarde logique restaurable à un instant. Prévoir une réplication ou un export pour les pièces scolaires |
| Suppression | `DeleteObject` non facturé. Rétention à porter dans une lifecycle rule, aujourd'hui absente du code |

**Recommandation stockage : R2, avec téléchargement toujours autorisé par l'API.** Le volume déclaré (1 Go + 10 Go) tient dans le palier gratuit si l'occupation est inférieure à 10 Go, ce qui n'est pas mesuré. L'egress gratuit évite de faire payer les photos et PDF par le quota Supabase. Supabase Storage reste acceptable si le CTO veut un seul prestataire de données : le contrôle d'accès ne doit pas être délégué au client.

La démo ne fait pas partie de cette copie.

Bloqueur : extraire les disques exige une opération Render (export, snapshot, ou fenêtre de lecture). Elle est **interdite par ce mandat** et doit être un mandat ultérieur, avant toute suppression de service.

---

## 10. AUDIT-F — DNS, domaines, sécurité

Relevé DNS public du 29 octobre 2026.

| Nom | Enregistrement observé | Proxy Somafrik | État HTTP |
|---|---|---|---|
| `somafrik.app` | A `216.24.57.1` | Non (adresse d'edge Render, pas anycast client Cloudflare) | 503 suspendu |
| `www.somafrik.app` | CNAME `somafrik-web-prod.onrender.com` | Non | 503 |
| `api.somafrik.app` | CNAME `somafrik-api-prod.onrender.com` | Non | 503 |
| `preprod.somafrik.app` | CNAME `somafrik-web-preprod.onrender.com` | Non | 503 |
| `api-preprod.somafrik.app` | CNAME `somafrik-api-preprod.onrender.com` | Non | 503 |
| `demo.somafrik.app` | CNAME `somafrik-web-demo.onrender.com` | Non | 503 |
| `api-demo.somafrik.app` | CNAME `somafrik-api-demo.onrender.com` | Non | 503 |
| `mail.somafrik.app` | CNAME Brevo | DNS Cloudflare, cible Brevo | Non sondé (pas HTTP applicatif) |
| `cdn`, `app`, `status`, `files`, `storage`.somafrik.app | Aucun enregistrement | — | — |
| MX | Cloudflare Email Routing | Oui, courrier | — |
| NS | `dale` et `demi`.ns.cloudflare.com | Zone Cloudflare | — |

TTL des CNAME applicatifs : **300 secondes**. Une bascule DNS est donc visible en quelques minutes, et un retour arrière aussi, tant que la cible précédente existe.

TLS : certificats Google Trust Services pour `somafrik.app` et `api.somafrik.app`, échéance **1 décembre 2026**. **INCONNU** : renouvellement automatique pendant une suspension prolongée. Si la migration traîne au-delà de cette date, le risque devient une erreur de certificat en plus du 503.

CORS : origines codées, voir AUDIT-A. Conserver les noms suffit.

Cookies : non utilisés pour la session. Pas de changement `SameSite` à prévoir. HSTS est posé par l'API seulement derrière un proxy de confiance et `req.secure`.

WebSocket : aucun dans le Web ni dans l'API. Rien à préserver.

Cache API : les réponses métier posent largement `Cache-Control: no-store` ou `private, no-store`. Une règle Cloudflare qui mettrait `/api` en cache serait une fuite inter-utilisateurs. **Règle future obligatoire : bypass de cache sur `api` et `api-preprod`.** Le logo public peut être caché court ; ce n'est pas le cas du reste.

WAF et rate limit Cloudflare : **INCONNU**. Le rate limit applicatif existe et dépend de `req.ip`.

`TRUST_PROXY_HOPS` : exemples production et préproduction = 1, cohérent avec **un** proxy (Render aujourd'hui, Caddy dans Compose). Le code : si la valeur est > 0, `app.set("trust proxy", hops)` (`server.js` lignes 113–116). Si l'on ajoute Cloudflare en proxy orange **en plus** d'un reverse proxy d'origin, il faut 2 sauts, pas 1. Un saut de trop fait confiance à un `X-Forwarded-For` forgé et fausse le rate limit. Un saut de moins regroupe tous les clients sur l'IP du proxy.

Fuite d'information : la page de suspension Render est générique et ne divulgue pas le JSON de santé. Le health applicatif, quand il reviendra, expose `version`, un SHA de déploiement via `withDeployGitSha`, et l'état du stockage. Il ne doit pas exposer de chemin secret ni d'URL de base ; le code de santé actuel n'ajoute pas la chaîne de connexion. À revérifier au smoke, sans coller le corps dans un ticket s'il contient un chemin absolu.

Aucun changement DNS ou TLS n'a été fait.

---

## 11. AUDIT-G — Mobile Android et iOS

Application Expo React Native, package Android `com.somafrik.app`, version `1.2.1` / `versionCode` 13 (`Mobile/app.json`). Les profils EAS (`Mobile/eas.json`) et `Mobile/config/releaseEnvironments.js` figent :

| Profil | API |
|---|---|
| production | `https://api.somafrik.app` |
| preview et preproduction | `https://api-preprod.somafrik.app` |
| development | LAN / variable locale, HTTP seulement en développement |

Le resolver (`Mobile/src/config/env.ts`) refuse localhost et le HTTP hors développement. L'épinglage de certificat est un stub désactivé (`certificatePinning`). Il n'y a pas de liste d'IP. Il y a une liste de noms interdits (LAN) et les noms canoniques.

| Sujet | Contrat à conserver |
|---|---|
| Session | SecureStore, `POST /api/login` (différent du login Web `/api/backoffice/login`), refresh, logout |
| Sync | `GET /api/mobile-sync/l1/...`, intervalle 5 min, SQLCipher local, outbox `messages`, `presences`, `notes` |
| Push | `POST /api/mobile/push-devices`, révocation `DELETE .../current` |
| NFC / QR | `/api/student-cards/*` (scan, roll-call, verify, entry, nfc-provision, diagnose) |
| Présences | `GET`/`POST /api/presences` et roll-call |
| Finance | `/api/payments`, impayés backoffice |
| Parents | `/api/parents/relations`, identity, link |
| Documents et bulletins | `/api/students/:id/documents`, `/api/report-cards`, PDF de publication |

**Aucune de ces routes ne doit changer de chemin, de verbe ou de forme d'authentification** pendant la bascule d'hébergement.

Nouvelle version Play / App Store : **non**, si les deux noms d'API, le TLS valide et les contrats restent. **Oui**, si l'un des noms change, si le certificat devient invalide sans chaîne reconnue, ou si une route change. Ce mandat n'a déclenché aucun build EAS.

Les binaires déjà installés subissent la suspension actuelle : ils appellent un hôte qui répond 503 HTML. Ils refonctionneront si le même nom sert de nouveau l'API, sans mise à jour, sous réserve que le JSON de l'API revienne (et non une page HTML de proxy).

La démo mobile n'est pas un profil store. Elle ne justifie pas une publication.

---

## 12. AUDIT-H — Coûts

Les montants ci-dessous sont des **prix publics** lus le 29 octobre 2026. Ce ne sont pas les factures Somafrik. L'abonnement réel Render, la taille d'instance, le plan Cloudflare, la taille compute Supabase, le PITR, le volume d'egress, le volume SMTP et le volume de push sont **INCONNUS**. Aucune dépense constatée n'est inventée.

Sources :

- Render, [pricing](https://render.com/pricing) et [disques](https://render.com/docs/disks) : Web Service 0,5 CPU / 512 Mo = 7 USD/mois ; 1 CPU / 2 Go = 25 USD/mois ; 2 CPU / 4 Go = 85 USD/mois. Disque persistant 0,25 USD/Go/mois. Sites statiques sans compute. Workspace Hobby 0 USD + compute, Pro 25 USD + compute.
- Supabase, [pricing](https://supabase.com/pricing) : Pro à partir de 25 USD/mois (8 Go disque par projet, 100 Go Storage, 250 Go d'egress, crédit compute de 10 USD soit un Micro). Micro ≈ 10 USD, Small ≈ 15 USD, Medium ≈ 60 USD, Large ≈ 110 USD. Second projet = son compute en plus. PITR ≈ 100 USD par projet pour 7 jours. Disk au-delà de 8 Go : 0,125 USD/Go.
- Cloudflare Workers, [pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2 octobre 2026) : plan payant minimum 5 USD/mois, 10 millions de requêtes incluses, **requêtes d'assets statiques gratuites et illimitées**. R2 : section AUDIT-E.
- Expo et SMTP : **INCONNUS** en volume. Ils ne disparaissent pas avec Render. Les compter deux fois serait une erreur ; les compter à zéro aussi. Ils sont laissés en ligne « inchangé, montant non lu ».

### Hypothèses de charge (non mesurées)

| Scénario | Établissements | Hypothèse d'architecture, pas une mesure |
|---|---|---|
| Faible | 10 | Une instance Node 2 Go par environnement actif, Postgres Micro/Small, fichiers dans le palier gratuit R2 si l'occupation reste < 10 Go |
| Intermédiaire | 100 | Même dessin. Le PDF et le poll deviennent le sujet, pas le nombre de connexions (plafond 6) |
| Élevée | 1 000 | Scale horizontal **après** déplacement des fichiers et verrou des travailleurs. Postgres dédié (Large ou au-dessus). File d'attente PDF à concevoir. Hors de ce mandat |

Le passage de 10 à 1 000 établissements n'est pas un coefficient linéaire sur la facture actuelle, parce que l'occupation réelle des tables et des disques n'a pas été lue.

### Situation actuelle — liste de prix si les services tournaient

La suspension du 29 octobre 2026 signifie que le compute Web Service ne sert plus. La facturation à la seconde publiée par Render ne court que pendant que l'instance existe et tourne. **INCONNU** : un service suspendu laisse-t-il le disque facturé. Ne pas conclure que la facture est nulle.

Ordre de grandeur **si** prod et préprod étaient allumées, démo exclue, workspace non compté :

| Poste | Hypothèse basse (512 Mo, trop juste pour Chromium) | Hypothèse de référence (2 Go, image Docker actuelle) |
|---|---|---|
| 2 API Render | 14 USD | 50 USD |
| 2 sites statiques | 0 USD de compute | 0 USD |
| Disques 1 Go + 10 Go | 2,75 USD | 2,75 USD |
| Supabase Pro + second projet Micro | 25 + 10 = 35 USD | 35 USD |
| Cloudflare DNS | 0 USD si le plan est Free. Plan réel **INCONNU** | idem |
| Workspace Render Pro | 0 ou 25 USD | **INCONNU** |
| PITR, egress, bandwidth, SMTP, Expo | non lus | non lus |

Fourchette de référence **hors** inconnus : environ **52 à 88 USD/mois** pour API + disques + deux Postgres Micro, plus le workspace et les usages. Ce n'est pas une facture.

Un plan à 512 Mo est cité seulement comme prix Render. Il est **PROBABLE** qu'il soit insuffisant pour Chromium. Ce n'est pas une mesure de cet audit.

### Situation cible sans Render — scénario B

| Poste | Faible (10) | Intermédiaire (100) | Élevée (1 000) |
|---|---|---|---|
| Web Cloudflare | 0 USD de requêtes statiques. Plan de zone **INCONNU** | idem | idem |
| API Node, référence publique équivalente au 2 Go Render, 2 environnements | 50 USD | 50 à 170 USD si l'on passe chaque env en 4 Go (85 USD) à cause du PDF | Plusieurs instances 2 Go **après** verrou worker. Non chiffrable sans mesure de concurrence PDF |
| Postgres Supabase, 2 projets, Pro | ≈ 35 USD (Micro) à ≈ 45 USD (Small sur le second) | Medium **possible** : 60 USD l'instance en plus du forfait, si les métriques le justifient. Non constaté | Large ≈ 110 USD l'instance, ou plus. Décision après métriques, pas maintenant |
| Fichiers R2 | 0 USD si < 10 Go et peu d'opérations | Quelques USD. 100 Go ≈ 1,5 USD de stockage Standard | Dominé par le nombre d'objets, pas par l'egress (gratuit) |
| Fichiers Supabase Storage à la place de R2 | Inclus jusqu'à 100 Go sur Pro, puis 0,0213 USD/Go, egress au-delà de 250 Go | idem | L'egress peut dépasser le stockage. C'est la raison de préférer R2 |
| Sauvegardes Postgres | 7 jours inclus en Pro. PITR optionnel ≈ 100 USD par projet | idem | PITR recommandé avant d'augmenter le volume, décision CTO |
| Workers Cloudflare pour l'API | Non retenu | Non retenu | Non retenu |
| SMTP, Expo | Inchangés, montants non lus | idem | idem |

Le scénario B **ne promet pas une baisse**. Il retire le compute et les disques Render (ordre de 17 à 53 USD dans les hypothèses ci-dessus, plus un éventuel workspace) et il ajoute un compute Node du même ordre. Le gain certain est ailleurs : un seul Postgres déjà européen, un DNS déjà à soi, plus de disque qui interdit le scale-out, et la fin d'un origin suspendu. Le gain financier n'est démontrable qu'avec les factures.

Le scénario A n'est pas chiffré comme cible : le minimum Workers à 5 USD n'achète pas la compatibilité.

---

## 13. AUDIT-I — Risques, migration, rollback

### 13.1 Matrice

| Risque | Niveau | Pourquoi | Parade |
|---|---|---|---|
| Indisponibilité actuelle Web et API | **P0** | 503 suspendu constaté sur tous les noms canoniques | Hors de ce mandat. La suite est un runtime Node et une bascule DNS, pas une réactivation décidée ici |
| Perte des fichiers si le service Render est supprimé | **P0** | Octets seulement sur le disque du service, API illisible, occupation inconnue | Export avant toute suppression. Démo exclue |
| Boot DDL sur la base canonique | **P0** | `init()` exécute `schema.sql` et les `ensure*` | Répéter le boot sur une copie. Interdire le premier allumage sur la prod |
| Écart de schéma git / Supabase | **P0** | Pas de `schema_migrations`, dashboards non relus | Lecture seule ultérieure, comparant les relations critiques, avant POC |
| Régression mobile par changement de nom | **P0** si le nom change ; faible si les noms restent | URL compilée, Updates désactivés | Geler `api.somafrik.app` et `api-preprod.somafrik.app` |
| CORS | **P1** | Origines codées en dur. `CORS_ORIGINS` est ignoré | Ne pas introduire de nouvel origin utilisateur |
| `TRUST_PROXY_HOPS` | **P1** | Rate limit et HSTS dépendent du nombre de proxies | Poser la valeur après dessin de la chaîne, tester une IP forgée |
| PDF | **P1** | Chromium, sandbox off, 20 s, mémoire | POC sur l'image Dockerfile, pas sur un runtime edge |
| Notifications | **P1** | Poll dans le processus ; double envoi si deux instances ; Expo inchangé | Une instance, puis verrou avant scale-out |
| Stockage | **P1** | Adaptateur à écrire ; URLs signées peuvent contourner le RBAC | Téléchargement API conservé |
| Fail-open RBAC / fuite inter-établissements | **P1** | Filtrage applicatif, pas de RLS. Data API serait un contournement | Ne pas ouvrir la Data API. Garder les tests tenant de la CI |
| Saturation Postgres | **P2** au volume actuel du code (pool ≤ 6) ; **P1** si scale-out sauvage | Plafond volontaire | Garder `DB_POOL_MAX`. Mesurer avant d'agrandir |
| Cache Cloudflare de l'API | **P1** | Réponses authentifiées | Bypass sur les noms d'API |
| Certificats au 1 décembre 2026 | **P1** | Échéance constatée, renouvellement pendant suspension **INCONNU** | Ne pas laisser la suspension comme état durable au-delà de cette date sans décision |
| Coûts inattendus | **P2** | Egress Supabase, PITR, workspace, bande passante du nouvel hôte | Plafonds de dépense, métriques avant changement de taille |
| Rollback impossible | **P1** si Render est détruit trop tôt | Le retour DNS n'a de cible que si le service existe | Fenêtre d'observation avant suppression |
| Perte de données Postgres | **P2** si l'on ne fait que changer l'hôte API et que `DATABASE_URL` pointe déjà au bon projet ; **P0** si l'on crée une base vide ou si l'on reset | Le mandat interdit déjà la création | Copie de restauration testée, pas un nouveau projet |
| Démo | **P2** | Code partagé, données jetables | Ne pas copier la base. Ne pas supprimer dans cet audit |
| Secret JWT divergé | **P1** | Tous les jetons tombent | Reprendre le secret existant par un canal ops, jamais par git |
| Conteneur root et sandbox Chromium off | **P1** | Choix actuel documenté dans le renderer | Ne pas l'aggraver. Rallumer la sandbox seulement sur un utilisateur non root, en POC |

### 13.2 Séquence proposée — non autorisée par ce mandat

1. **Inventaire et audit** — ce document.
2. **POC isolé** — copie de la base préprod, image Docker actuelle, nom jetable, preuve du boot DDL, d'un PDF, d'un login, d'un upload. Pas de DNS canonique.
3. **Web préprod** — assets Cloudflare, `preprod.somafrik.app`, repli SPA, `index.html` non caché, `VITE_API_URL` inchangé.
4. **Stockage** — export du disque préprod, adaptateur, vérification d'un téléchargement autorisé et d'un refus inter-établissement.
5. **API préprod** — même nom `api-preprod.somafrik.app`, même secret, une instance, `TRUST_PROXY_HOPS` juste, travailleurs allumés.
6. **Smoke** — section 15.
7. **Production** — même ordre, fenêtre décidée par le CTO, base `eu-west-1` non recréée.
8. **Observation** — erreurs, PDF, push, disque, connexions pooler.
9. **Retrait Render** — seulement après l'observation et un export de disque vérifié. La démo peut être éteinte plus tard, sans migration de données. Le nom historique `somafrik.onrender.com` part avec le compte, après contrôle qu'aucun binaire ne le réclame.

Rollback de chaque bascule DNS : remettre le CNAME vers le service Render **s'il est encore là et capable de servir**. TTL 300 s. Le rollback d'un boot DDL n'est pas un DNS : c'est une restauration Supabase. D'où l'interdiction du premier boot sur la base canonique.

---

## 14. Architecture cible

Le dessin ci-dessous est le **repli Node** décrit le 29 octobre 2026 au matin. La cible décidée l'après-midi est le tableau de la section « Décision CTO » : Workers, Hyperdrive, Browser Run, Queues, R2, Supabase. Elle ne remplace ce dessin que si `MIG-WORKERS-POC-01` réussit.

```text
Utilisateur Web
  somafrik.app / preprod.somafrik.app
        |  Cloudflare DNS + assets statiques + repli SPA
        |  (WAF selon le plan réellement souscrit)
        v
  Bundle Vite  ->  api.somafrik.app / api-preprod.somafrik.app
                         |
Mobile Expo              |  TLS, cache bypass, TRUST_PROXY_HOPS aligné
(noms inchangés)         v
                   Une instance Node 22.12 + Chromium par environnement
                   server.js, RBAC, tenant, poll outbox, PDF
                         |                         |
                         v                         v
                   Supabase Postgres          R2 (ou Storage)
                   prod eu-west-1             préfixes par établissement
                   préprod eu-central-1       téléchargement via l'API
                   Data API fermée
                         |
                         +-- HTTPS -> Expo push
                         +-- SMTP 587 optionnel (nodemailer)
```

Région Node production : proche de `eu-west-1`. Préproduction : proche de `eu-central-1`. Le Web, lui, est global via Cloudflare.

Ce dessin de repli retire Render et conserve Node. La cible Workers retire aussi le processus Node permanent, seulement après les quatre preuves.

---

## 15. Plan de tests de non-régression

À exécuter au POC et à chaque bascule. Pas maintenant.

| # | Parcours | Preuve attendue |
|---|---|---|
| 1 | `GET /api/health` | JSON `status=ok`, `database=postgresql`, stockage prêt. Pas une page HTML |
| 2 | Login Web et refresh | Bearer, rotation, ancien refresh refusé après la grâce |
| 3 | Login mobile sur binaire **déjà publié** de préprod | Même nom, pas de nouvel APK |
| 4 | Deux établissements | Un jeton de A ne lit pas un élève de B (suite tenant déjà dans la CI) |
| 5 | Superadmin | Pas d'accès aux données personnelles d'établissement hors parcours prévu |
| 6 | Présence et finance | Écriture idempotente avec clé, rejeu sans doublon |
| 7 | PDF bulletin | Fichier non vide, timeout tenu, pas d'appel réseau depuis Chromium (le renderer durcit déjà le réseau) |
| 8 | Pièce jointe et photo | Upload, download autorisé, download refusé hors établissement, fichier toujours là après redémarrage |
| 9 | Push | Enregistrement d'appareil. Envoi réel seulement sur préprod, vers un appareil de test |
| 10 | NFC/QR | `POST /api/student-cards/scan` sur carte de test, pas de scan réel exigé par cet audit |
| 11 | Parent | Liste d'enfants bornée au principal |
| 12 | SPA | `/connexion` et `/verify/rc/...` sans 404 nu du CDN |
| 13 | CORS | Préflight depuis `https://preprod.somafrik.app` accepté ; origine étrangère refusée |
| 14 | Cache | Réponse authentifiée non servie depuis un cache partagé |
| 15 | IP forgée | `X-Forwarded-For` client ignoré au-delà des sauts configurés |
| 16 | Rollback DNS | CNAME inverse testé en préprod avant la prod |

La CI existante (PR Gates, tests PostgreSQL, matrices RBAC) reste la régression de code. Elle ne remplace pas le smoke d'hébergement.

---

## 16. Découpage des PR futures

**11 pull requests**, plus une optionnelle. Aucune n'est autorisée par MIG-AUD-01. Chacune reste réversible et évite `develop` direct : elles devront repartir de `develop` au moment voulu, sous un nouveau mandat.

| # | PR | Contenu | Dépend de |
|---|---|---|---|
| 1 | POC runtime préprod | Image actuelle, copie de base, nom jetable, notes de boot | Lecture de schéma et export disque autorisés |
| 2 | Adaptateur de fichiers | Interface disque actuelle ou objet, tests d'autorisation | 1 |
| 3 | Web préprod Cloudflare | Build Vite, repli SPA, en-têtes de cache, CNAME préprod | Smoke nom jetable |
| 4 | Copie disque préprod | Export puis vérification, sans supprimer Render | Mandat ops séparé |
| 5 | API préprod | DNS `api-preprod`, secret inchangé, une instance, proxy hops | 1, 2, 4 |
| 6 | Smoke préprod documenté | Grille de la section 15 | 3 et 5 |
| 7 | Web production | Même procédé | 6 |
| 8 | Fichiers production | Export disque prod | 6 |
| 9 | API production | Même procédé, région proche de `eu-west-1` | 7 et 8 |
| 10 | Observation | Journal, critères d'arrêt, pas de feature | 9 |
| 11 | Retrait Render | Suppression seulement après 10. Démo et nom historique inclus ou explicitement reportés | 10 |
| 12 optionnelle | Registre de migrations | `schema_migrations` ou équivalent, sans changer le comportement métier | Peut précéder 1 |

Une PR documentaire d'alignement (`docs/render.md`, OPERATIONS, README Web) peut accompagner la 11. Elle ne doit pas être mélangée au code de bascule.

---

## 17. Décisions CTO demandées

Migrables sans modification majeure du code métier, si les noms et le secret restent :

- zone DNS Cloudflare ;
- build Web Vite vers des assets statiques ;
- processus Node actuel vers un autre hôte de conteneurs ;
- PostgreSQL déjà Supabase, **après** preuve de boot sur copie ;
- contrats mobiles.

Exigent un POC avant bascule :

- premier `init()` contre une copie de la préprod ;
- un bulletin PDF sur l'hôte cible ;
- lecture réelle des disques suspendus et choix R2 ou Storage ;
- valeur de `TRUST_PROXY_HOPS` sur la chaîne retenue ;
- absence de double envoi avec exactement une instance.

À conserver sur un runtime Node traditionnel :

- `server.js` et ses 371 routes ;
- Puppeteer / Chromium ;
- les deux travailleurs `setInterval` ;
- le pool `pg` ;
- le SMTP 587 ;
- la passerelle démo, le jour où on la reconstruira, sur une base jetable.

Questions non résolues :

1. `DATABASE_URL` de chaque service Render pointe-t-il encore vers les projets nommés ?
2. Taille compute, PITR, interrupteur Data API, dernière restauration testée ?
3. Instance Render, octets des disques, survie du disque pendant la suspension ?
4. Plan Cloudflare, règles WAF, cache, Workers, buckets R2 déjà créés ou non ?
5. `SMTP_HOST` effectif (Brevo est prouvé pour le domaine, pas pour la variable) ?
6. Écart de schéma entre git et les deux bases ?
7. Renouvellement des certificats après le 1 décembre 2026 si Render reste suspendu ?
8. Factures réelles des trois prestataires ?
9. Un binaire mobile antérieur vise-t-il encore `somafrik.onrender.com` ?
10. Quel hébergeur Node le CTO retient-il, et dans quelles régions ?

Décisions explicites attendues avant tout mandat d'implémentation :

1. **Tranché le 29 octobre 2026 :** cible Workers, repli Node. La migration complète attend les quatre preuves du POC.
2. Geler les noms publics Web et API.
3. Autoriser une fenêtre de lecture des disques, distincte de ce mandat, avant toute suppression.
4. Choisir R2 (recommandé) ou Supabase Storage, avec téléchargement contrôlé par l'API.
5. Interdire l'ouverture de la Data API et la création d'une nouvelle base prod ou préprod.
6. Maintenir une seule instance API par environnement jusqu'à un verrou de travailleur.
7. Trancher PITR ou non.
8. Laisser la démo non migrée.
9. Choisir l'hébergeur Node et les régions.
10. Maintenir cette PR en draft jusqu'au diff indépendant.

---

## 18. Contrôles de gouvernance

| Contrôle | Résultat |
|---|---|
| Base | `develop` `09ce72712d036e3729ebefd3625a7cf9cf9c5fc0`, alignée sur `origin/develop` au moment de la branche |
| Nature du diff | Un fichier : `docs/audits/MIG-AUD-01-render-supabase-cloudflare.md` |
| Code produit, SQL, workflows, lockfiles, `.env`, configs de déploiement | Non modifiés |
| Secrets dans ce rapport | Aucune chaîne de connexion, aucun mot de passe, aucun jeton, aucune clé. Le code de vérification Brevo lu dans le DNS public n'est pas recopié |
| Opérations distantes modificatrices | Aucune. DNS et HTTP en lecture. Pas d'appel d'écriture Render, Supabase ou Cloudflare |
| Merge, rebase, push de `develop` ou `main` | Aucun |
| Conflit avec `develop` | Aucun au moment de la branche (ahead/behind 0/0 avant le commit documentaire) |
| Auto-approbation | Non |

CI applicable à ce diff, d'après `.github/workflows/pr-gates.yml` :

- le workflow part sur toute PR vers `develop`, sans filtre de chemins global ;
- le job `scope` classe les chemins ;
- `docs/**` ne met pas `code=true` ;
- le nom de **ce** fichier ne contient pas les fragments qui arment `auth`, `students`, `finance`, `platform`, etc. ;
- donc `quality`, `core` et `targeted` sont prévus **skippés** ;
- `secrets` (Gitleaks) tourne toujours ;
- `ci.yml` ne part pas sur une PR (schedule et dispatch seulement) ;
- les workflows métier à `paths:` ne listent pas ce fichier ;
- `architecture-audit.yml` ne liste pas `docs/**` ;
- `merge-authorization.yml` a ses déclencheurs de PR commentés (GOV-PAUSE-02) : il ne publie pas de statut tout seul.

L'état réel des checks sera celui de la PR après ouverture. Il n'est pas anticipé comme un succès.

Le diff GitHub indépendant reste au CTO, avant tout passage en Ready ou tout merge.

---

**MIG-AUD-01 — AUDIT DOCUMENTÉ / DRAFT / HOLD — DÉCISION CTO : WORKERS SOUS RÉSERVE DU POC — EN ATTENTE DU DIFF CTO INDÉPENDANT.**
