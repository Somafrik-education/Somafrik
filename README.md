# Somafrik — Plateforme de gouvernance scolaire

Somafrik unifie la gestion éducative, du pays à la classe. Stack Docker : PostgreSQL, API backend, plateforme web (Vite) et Expo mobile.

## Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows)
- **Node.js >= 22.12.0** pour le développement hors Docker (`nvm use` lit `.nvmrc`)
- Copier `.env.example` vers `.env` (Docker, backend, PostgreSQL)
- Copier `Mobile/.env.example` vers `Mobile/.env.local` (Expo, téléphone physique)

## Installation des dépendances

À la racine, une seule commande installe les 4 packages (racine, backend, web, Mobile) :

```powershell
npm run install:all
```

> `npm install` seul à la racine n'installe que les outils workspace (ex. Playwright). Pour le backend, le web et le mobile, utilisez `npm run install:all`.

Les alertes `npm audit` restantes dans **Mobile** proviennent surtout de la chaîne Expo (correction complète = migration Expo 57+). **Web** : `esbuild` est forcé en version corrigée via `overrides` sans passer à Vite 8.

## Configuration des variables d'environnement

| Fichier | Rôle |
|---------|------|
| `.env` | Docker Compose, backend, PostgreSQL, CORS (dev), `EXPO_PORT` (port Metro dans le conteneur) |
| `Mobile/.env.local` | Expo uniquement : IP LAN, URL API mobile, mode démo |
| `.env.production.example` | Modèle pour la production réelle (`somafrik.app`, secrets, `SOMAFRIK_SKIP_DEMO_SEED=true`) |
| `.env.preproduction.example` | Modèle préproduction MVP (`npm run preprod:up`) — voir `docs/preproduction.md` |

Les variables `REACT_NATIVE_PACKAGER_HOSTNAME`, `EXPO_PUBLIC_API_URL` et `EXPO_PUBLIC_DEMO_MODE` **ne doivent pas** être placées dans `.env` racine (Expo 57+ les refuse à cet emplacement).

**CORS :**
- **Développement** (`.env`) : localhost et IP LAN, enrichis par `npm run sync:env`
- **Production** (`.env.production.example` → `.env`) : domaine officiel `https://somafrik.app` — le backend refuse les origines locales automatiques lorsque `NODE_ENV=production`

```powershell
Copy-Item .env.example .env
Copy-Item Mobile\.env.example Mobile\.env.local
npm run sync:env   # optionnel : aligne CORS, Mobile/.env.local et Mobile/eas.json
```

## Démarrage (tout sur Docker)

```powershell
Copy-Item .env.example .env
Copy-Item Mobile\.env.example Mobile\.env.local
npm run docker:up
```

Ou avec le script (détecte l’IP LAN pour le mobile) :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\docker-up.ps1
```

**Important :** n’utilisez pas `npm run backend` en parallèle — un seul backend sur le port 5000.

## URLs

| Service | URL |
|---------|-----|
| API santé | http://localhost:5000/api/health |
| Plateforme legacy | http://localhost:5000/backoffice/ |
| Web React (build intégré) | http://localhost:5000/web/ |
| Web React (dev, hot reload) | http://localhost:5173/web/ |
| PostgreSQL (hôte) | localhost:5433 |
| Expo Metro (mobile) | port 8083 — QR dans les logs |

### Préproduction (domaine officiel)

| Service | URL |
|---------|-----|
| Application web | https://somafrik.app/web/ |
| Connexion | https://somafrik.app/web/connexion |
| API | https://somafrik.app/api/health |

Déploiement : `docs/preproduction.md` (`npm run preprod:init-env` → `preprod:bootstrap` → `preprod:up`).

```powershell
npm run docker:logs:mobile   # QR Code Expo
npm run docker:logs          # tous les services
```

## Mobile sur téléphone

L’IP Wi‑Fi du PC varie selon le réseau. Utilisez la détection automatique :

```powershell
npm run sync:env
# ou au démarrage Docker :
powershell -ExecutionPolicy Bypass -File scripts\docker-up.ps1
```

Le script détecte l’IP LAN et génère `Mobile/.env.local` :

```env
LAN_IP=<ip_detectee>
REACT_NATIVE_PACKAGER_HOSTNAME=<ip_detectee>
EXPO_PUBLIC_API_URL=http://<ip_detectee>:5000
```

Vous pouvez aussi fixer l’IP manuellement dans `.env` :

```env
LAN_IP=192.168.x.x
```

Puis relancer `npm run sync:env`.

Le téléphone et le PC doivent être sur le **même Wi‑Fi**. Test : `http://<LAN_IP>:5000/api/health` depuis le navigateur du téléphone.

## Arrêt

```powershell
npm run docker:down
# ou avec suppression des données Postgres :
powershell -ExecutionPolicy Bypass -File scripts\docker-down.ps1 -Volumes
```

## Stack minimale (sans web-dev ni mobile)

```powershell
npm run docker:up:core
```

## Comptes de démonstration

> **Usage local uniquement.** Ces comptes ne sont jamais créés en production.
> En production, définissez obligatoirement `SOMAFRIK_SKIP_DEMO_SEED=true` (le backend refuse de démarrer sinon).

Plateforme web (`http://localhost:5173/web/` ou `http://localhost:5000/web/`) — mot de passe **`1234`** :

| Groupe | Profil | Identifiant | Code établissement |
|--------|--------|-------------|-------------------|
| Plateforme | Super Admin | `superadmin` | — |
| Plateforme | Admin Pays RDC | `admin-rdc` | — |
| Plateforme | Admin Pays BI | `admin-bi` | — |
| Établissement | Admin école | `admin` | `CD-2026-0001` |
| Établissement | Secrétaire | `secretaire` | `CD-2026-0001` |
| Établissement | Préfet | `prefet` | `CD-2026-0001` |
| Métier | Enseignant | `ENS-0001` | `CD-2026-0001` |
| Métier | Parent | `+243 820 000 001` | `CD-2026-0001` |
| Métier | Élève | `ELE-0001` | `CD-2026-0001` |

Mobile (API `/api/login`) :

```text
Code établissement : CD-2026-0001
Enseignant : ENS-0001 / PIN 1234
Parent : +243 820 000 001 / PIN 1234
Élève : ELE-0001 / PIN 1234
```

## Vérification auth stable

1. `http://localhost:5000/api/health` → `"database": "postgresql"`
2. Connexion web sur `http://localhost:5173/web/` (proxy Vite → backend Docker)
3. Mobile : `EXPO_PUBLIC_DEMO_MODE=false` dans `Mobile/.env.local` et même backend Docker

## Avant usage réel

- Partez de `.env.production.example` pour créer votre `.env` de production.
- Changez `POSTGRES_PASSWORD` et `JWT_SECRET` dans `.env`.
- Définissez `NODE_ENV=production` et **`SOMAFRIK_SKIP_DEMO_SEED=true`** (obligatoire).
- Gardez `SOMAFRIK_DB_REQUIRED=true`.
- Définissez `CORS_ORIGINS` avec vos URL HTTPS publiques uniquement (pas de `localhost`, `127.0.0.1` ni IP privée).
- Les comptes réels doivent utiliser un PIN à 6 chiffres non trivial ; le premier mot de passe est imposé à la première connexion.
