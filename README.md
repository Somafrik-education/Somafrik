# Somafrik — Plateforme de gouvernance scolaire

Somafrik unifie la gestion éducative, du pays à la classe. Stack Docker : PostgreSQL, API backend, plateforme web (Vite) et Expo mobile.

## Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows)
- Copier `.env.example` vers `.env` et adapter l’IP Wi‑Fi si besoin

## Démarrage (tout sur Docker)

```powershell
Copy-Item .env.example .env
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

```powershell
npm run docker:logs:mobile   # QR Code Expo
npm run docker:logs          # tous les services
```

## Mobile sur téléphone

Dans `.env`, l’IP Wi‑Fi du PC doit être correcte :

```env
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.35
EXPO_PUBLIC_API_URL=http://192.168.1.35:5000
EXPO_PUBLIC_DEMO_MODE=false
```

Le téléphone et le PC doivent être sur le **même Wi‑Fi**. Test : `http://VOTRE_IP:5000/api/health` depuis le navigateur du téléphone.

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
3. Mobile : `EXPO_PUBLIC_DEMO_MODE=false` et même backend Docker

## Avant usage réel

- Changez `POSTGRES_PASSWORD` et `JWT_SECRET` dans `.env`.
- Gardez `SOMAFRIK_DB_REQUIRED=true`.
- Définissez `CORS_ORIGINS` avec vos URL réelles.
