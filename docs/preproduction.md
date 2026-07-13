# Déploiement préproduction — Somafrik MVP

Guide pour mettre en ligne le MVP avec frontend Vercel et API backend séparée.

## Architecture

| Composant | Hébergement | URL |
|-----------|-------------|-----|
| Frontend web prod | Vercel (`main`) | https://somafrik.app |
| Frontend web préprod | Vercel (`develop`) | https://preprod.somafrik.app |
| API production | Docker + Caddy | https://api.somafrik.app |
| API préproduction | Render | https://somafrik-api-preprod.onrender.com |

Voir aussi `docs/vercel.md` pour la configuration Vercel.

## Prérequis

- Compte [Render](https://render.com) pour l'API préprod (Web Service + PostgreSQL)
- Compte Vercel lié au dépôt (`web/` comme racine)
- DNS :
  - `somafrik.app`, `preprod.somafrik.app` → Vercel
  - `api.somafrik.app` → serveur backend production
- Node.js 22+ (bootstrap / scripts locaux)

## 1. Configuration backend (préprod)

```powershell
npm run preprod:init-env
```

Cela crée **`.env.preproduction`** (séparé du `.env` de développement local) avec des secrets générés.

Ou copiez `.env.preproduction.example` vers `.env.preproduction` et renseignez :

| Variable | Description |
|----------|-------------|
| `SOMAFRIK_API_DOMAIN` | `somafrik-api-preprod.onrender.com` |
| `CORS_ORIGINS` | `https://preprod.somafrik.app` |
| `POSTGRES_PASSWORD` | Mot de passe fort unique |
| `JWT_SECRET` | Secret ≥ 32 caractères (`openssl rand -hex 32`) |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | Mot de passe initial superadmin (≥ 12 car.) |
| `EXPO_PUBLIC_API_URL` | `https://somafrik-api-preprod.onrender.com` |
| `VITE_API_URL` (Vercel develop) | `https://somafrik-api-preprod.onrender.com` |

Variables obligatoires :

```env
NODE_ENV=production
SOMAFRIK_SKIP_DEMO_SEED=true
SOMAFRIK_DISABLE_LOGIN_LOCKOUT=false
TRUST_PROXY_HOPS=1
```

## 2. Déploiement API sur Render

Sur le **Web Service** Render (`somafrik-api-preprod`), définir au minimum :

```env
NODE_ENV=production
DATABASE_URL=<fourni par Postgres Render>
JWT_SECRET=<secret fort>
CORS_ORIGINS=https://preprod.somafrik.app
SOMAFRIK_SKIP_DEMO_SEED=true
SOMAFRIK_DB_REQUIRED=true
TRUST_PROXY_HOPS=1
```

Vérifier : `https://somafrik-api-preprod.onrender.com/api/health`

## 3. Stack Docker local (optionnel)

Pour tester l'API en local avec Docker :

```powershell
npm run preprod:check
npm run preprod:up
```

Si vous avez déjà lancé la préprod avec un `.env` de développement (mots de passe faibles), réinitialisez les volumes avant de relancer :

```powershell
docker compose -f docker-compose.preprod.yml --env-file .env.preproduction down -v
npm run preprod:up
```

## 4. Bootstrap base vide + superadmin

Une fois PostgreSQL accessible (Render ou stack Docker local) :

```powershell
npm run preprod:bootstrap
```

Le bootstrap s'exécute dans le conteneur backend (connexion PostgreSQL via le réseau Docker).

Crée une base PostgreSQL vide avec un compte Super Admin initial (`mustChangePassword: true`).

Services déployés par `preprod:up` :

| Service | Rôle |
|---------|------|
| `postgres` | Base de données (port hôte `5434` pour bootstrap) |
| `backend` | API Express API-only (`SOMAFRIK_API_ONLY=true`) |
| `caddy` | HTTPS (stack Docker local uniquement) |

URLs :

- Web préprod (Vercel) : `https://preprod.somafrik.app/`
- Connexion : `https://preprod.somafrik.app/connexion`
- API santé : `https://somafrik-api-preprod.onrender.com/api/health`
- BackOffice legacy : `https://somafrik-api-preprod.onrender.com/backoffice/`

## 5. Déploiement frontend Vercel

1. Lier le projet Vercel au dépôt, **Root Directory** = `web`.
2. Branche `develop` → domaine `preprod.somafrik.app`.
3. Variables d'environnement (voir `docs/vercel.md`) :

```env
VITE_API_URL=https://somafrik-api-preprod.onrender.com
VITE_SHOW_DEMO_ACCOUNTS=false
VITE_ENABLE_MARKETPLACE=false
```

## 6. Configuration initiale métier

Connectez-vous en Super Admin sur `https://preprod.somafrik.app/connexion` puis :

1. Créer les pays
2. Créer les établissements
3. Créer les comptes Admin Pays / Admin School
4. Configurer l'année scolaire, classes, matières
5. Importer ou saisir élèves, enseignants, parents

## 7. Production

Même procédure avec :

- `.env` basé sur `.env.production.example`
- `docker compose -f docker-compose.production.yml up -d --build`
- Vercel branche `main` → `somafrik.app`
- `CORS_ORIGINS=https://somafrik.app`
- `VITE_API_URL=https://api.somafrik.app`

```powershell
npm run production:up
```

## 8. Application mobile

`Mobile/eas.json` pointe déjà vers les API :

- Preview / préprod : `https://somafrik-api-preprod.onrender.com`
- Production : `https://api.somafrik.app`

## 9. Sécurité activée en préproduction

- Pas de seed automatique de données démo
- Comptes démo masqués sur la page de connexion web
- Rate limiting sur `/api/login`, `/api/identify`, `/api/backoffice/login`
- Verrouillage après échecs de connexion (actif)
- Validation des secrets au démarrage
- CORS strict (origine Vercel exacte)
- Headers de sécurité + HSTS derrière HTTPS
- `SOMAFRIK_E2E` et `SOMAFRIK_AUTH_OPTIONAL` interdits en production

## 10. Commandes utiles

```powershell
npm run preprod:logs
npm run preprod:down
npm run production:up
npm run production:logs
npm run production:down
npm run docker:build
```

## 11. Sauvegarde PostgreSQL

```powershell
docker compose -f docker-compose.preprod.yml exec -T postgres pg_dump -U somafrik somafrik > backup.sql
```

## 12. Développement local vs préproduction

| | Développement | Préproduction |
|--|---------------|---------------|
| Frontend | `localhost:5173/` (Vite) | Vercel `preprod.somafrik.app` |
| API | `localhost:5000` | `somafrik-api-preprod.onrender.com` |
| Fichier env | `.env.example` | `.env.preproduction` |
| Compose API | `docker-compose.yml` | `docker-compose.preprod.yml` |
| Seed démo | Oui (optionnel) | Non |
| HTTPS | Non | Oui (Caddy + Vercel) |

## 13. Dépannage

**Erreur CORS** — `CORS_ORIGINS` doit être exactement `https://preprod.somafrik.app` (sans slash final).

**API inaccessible** — vérifier le service Render et `https://somafrik-api-preprod.onrender.com/api/health`.

**Frontend sans données** — vérifier `VITE_API_URL` dans Vercel (rebuild nécessaire après modification).

**Backend ne démarre pas** — le stack préprod lit **`.env.preproduction`**, pas `.env` local. Vérifiez :

```powershell
npm run preprod:check
```

**Mot de passe superadmin refusé** — le mot de passe est **uniquement** celui de `.env.preproduction` (`BOOTSTRAP_SUPERADMIN_PASSWORD`), pas le `.env` local.

```powershell
npm run preprod:repair-superadmin
npm run preprod:verify-login
```

Identifiant : `superadmin` (ou `BOOTSTRAP_SUPERADMIN_ID`).
