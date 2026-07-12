# Déploiement préproduction — Somafrik MVP

Guide pour mettre en ligne le MVP avec toutes les fonctionnalités actuelles (web, API, mobile, PostgreSQL).

## Prérequis

- Serveur Linux ou Windows avec Docker et Docker Compose
- Nom de domaine officiel **somafrik.app** pointant vers le serveur
- Ports 80 et 443 ouverts (Caddy + Let's Encrypt)
- Node.js 22+ (pour le bootstrap initial uniquement)

## 1. Configuration

```powershell
# Windows
npm run preprod:init-env
```

Ou copiez manuellement `.env.preproduction.example` vers `.env` et renseignez :

| Variable | Description |
|----------|-------------|
| `SOMAFRIK_DOMAIN` | Domaine officiel (`somafrik.app`) |
| `CORS_ORIGINS` | Origines autorisées (`https://somafrik.app`) |
| `POSTGRES_PASSWORD` | Mot de passe fort unique |
| `JWT_SECRET` | Secret ≥ 32 caractères (`openssl rand -hex 32`) |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | Mot de passe initial superadmin (≥ 12 car.) |
| `EXPO_PUBLIC_API_URL` | URL HTTPS pour builds mobile EAS |

Variables obligatoires en préproduction :

```env
NODE_ENV=production
SOMAFRIK_SKIP_DEMO_SEED=true
SOMAFRIK_DISABLE_LOGIN_LOCKOUT=false
TRUST_PROXY_HOPS=1
VITE_SHOW_DEMO_ACCOUNTS=false
```

## 2. Bootstrap base vide + superadmin

```powershell
npm run preprod:bootstrap
```

Crée une base PostgreSQL vide avec un compte Super Admin initial (`mustChangePassword: true`).

## 3. Démarrage

```powershell
npm run preprod:up
```

Services déployés :

| Service | Rôle |
|---------|------|
| `postgres` | Base de données (réseau interne uniquement) |
| `backend` | API Express + web React (`/web/`) + BackOffice legacy |
| `caddy` | HTTPS, reverse proxy |

URLs :

- Application web : `https://somafrik.app/web/`
- Connexion : `https://somafrik.app/web/connexion`
- API santé : `https://somafrik.app/api/health`
- BackOffice legacy : `https://somafrik.app/backoffice/`

## 4. Configuration initiale métier

Connectez-vous en Super Admin puis :

1. Créer les pays
2. Créer les établissements
3. Créer les comptes Admin Pays / Admin School
4. Configurer l'année scolaire, classes, matières
5. Importer ou saisir élèves, enseignants, parents

Toutes les fonctionnalités MVP restent disponibles : notes, présences, paiements, bulletins PDF, planning, notifications, audit, dashboards multi-rôles.

## 5. Application mobile

Mettez à jour `Mobile/eas.json` (profils `preview` et `production`) avec votre URL HTTPS :

```json
"EXPO_PUBLIC_API_URL": "https://somafrik.app"
```

Build APK/AAB :

```powershell
cd Mobile
npm run build:apk
# ou
npm run build:play
```

> `npm run sync:env` ne modifie plus les profils EAS `production`/`preview` quand `NODE_ENV=production`.

## 6. Sécurité activée en préproduction

- Pas de seed automatique de données démo
- Comptes démo masqués sur la page de connexion web
- Rate limiting sur `/api/login`, `/api/identify`, `/api/backoffice/login`
- Verrouillage après échecs de connexion (actif)
- Validation des secrets au démarrage
- CORS strict (pas de localhost en production)
- Headers de sécurité + HSTS derrière HTTPS
- `SOMAFRIK_E2E` et `SOMAFRIK_AUTH_OPTIONAL` interdits en production

## 7. Commandes utiles

```powershell
npm run preprod:logs      # journaux
npm run preprod:down      # arrêt
npm run docker:build      # rebuild image backend seule
```

## 8. Sauvegarde PostgreSQL

```powershell
docker compose -f docker-compose.preprod.yml exec -T postgres pg_dump -U somafrik somafrik > backup.sql
```

Restauration :

```powershell
Get-Content backup.sql | docker compose -f docker-compose.preprod.yml exec -T postgres psql -U somafrik somafrik
```

## 9. Développement local vs préproduction

| | Développement | Préproduction |
|--|---------------|---------------|
| Fichier env | `.env.example` | `.env.preproduction.example` |
| Compose | `docker-compose.yml` | `docker-compose.preprod.yml` |
| Seed démo | Oui (optionnel) | Non |
| Expo / Vite dev | Oui | Non |
| HTTPS | Non | Oui (Caddy) |
| Comptes démo UI | Oui | Non |

## 10. Dépannage

**Backend ne démarre pas** — vérifiez `JWT_SECRET` (≥ 32 car.) et `POSTGRES_PASSWORD` (≠ `change-me`).

**CORS** — `CORS_ORIGINS` doit inclure exactement l'origine HTTPS du navigateur.

**Certificat TLS** — le domaine doit pointer vers le serveur avant le premier démarrage Caddy.

**503 sur /web/** — reconstruire l'image : `npm run preprod:up` (le build Vite est inclus dans `backend/Dockerfile`).
