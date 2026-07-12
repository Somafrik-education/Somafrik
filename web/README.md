# Somafrik Plateforme — Web (React + Tailwind CSS)

Frontend web de la plateforme Somafrik, réécrit en **React 18 + TypeScript + Vite + Tailwind CSS**.
Il consomme la même API Express/PostgreSQL que l'interface historique (`/api/...`) et reprend
sa logique de périmètre (scoping multi-pays / multi-établissements), ses permissions RBAC et son
flux d'état (`GET`/`PUT /api/backoffice/state`).

## Stack

- React 18 + TypeScript
- Vite (dev server + build)
- Tailwind CSS 3
- React Router 6

## Prérequis

- Node.js >= 22.12.0 (voir `.nvmrc` à la racine du dépôt)
- Backend Somafrik en cours d'exécution (`http://localhost:5000`)

## Installation

```bash
cd web
npm install
```

## Développement

```bash
npm run dev
```

Ouvrir http://localhost:5173/

Le proxy Vite redirige `/api` vers le backend Express.

En production (Vercel), définir `VITE_API_URL` (ex. `https://api.somafrik.app`). Voir `docs/vercel.md`.

## Build production

```bash
npm run build
```

Les fichiers sont générés dans `web/dist/`.

- **Vercel** (prod / préprod) : déployer `dist/` à la racine du domaine.
- **Docker local** : servis par le backend sur `/web/` (`VITE_BASE_PATH=/web/` au build).

## Structure

```
src/
  api/          Client HTTP (JWT, erreurs)
  components/   UI réutilisable (layout, formulaires)
  context/      AuthContext (session/JWT) + DataContext (état plateforme)
  lib/          Permissions, scoping, modules métier
  pages/        Vues par route
```
