# Déploiement frontend — Vercel

Le frontend React est hébergé sur **Vercel**. L'API Express reste sur un serveur séparé (sous-domaines `api.*`).

## Architecture cible

| Environnement | Frontend (Vercel) | API (Docker + Caddy) |
|---------------|-------------------|----------------------|
| **Production** | https://somafrik.app (branche `main`) | https://api.somafrik.app |
| **Préproduction** | https://preprod.somafrik.app (branche `develop`) | https://api-preprod.somafrik.app |

## Configuration du projet Vercel

| Paramètre | Valeur |
|-----------|--------|
| **Root Directory** | `web` |
| **Framework Preset** | Vite |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Node.js** | ≥ 22.12.0 |

Le fichier `web/vercel.json` gère le fallback SPA (React Router).

## Variables d'environnement Vercel

Variables **build-time** (`VITE_*`, compilées dans le bundle) :

### Production (branche `main`, domaine `somafrik.app`)

```env
VITE_API_URL=https://api.somafrik.app
VITE_SHOW_DEMO_ACCOUNTS=false
VITE_ENABLE_MARKETPLACE=false
```

### Préproduction (branche `develop`, domaine `preprod.somafrik.app`)

```env
VITE_API_URL=https://api-preprod.somafrik.app
VITE_SHOW_DEMO_ACCOUNTS=false
VITE_ENABLE_MARKETPLACE=false
```

> Ne pas définir `VITE_BASE_PATH` sur Vercel : l'application est servie à la racine (`/`).
> Ne pas définir `VITE_API_TARGET` : variable dev uniquement (proxy Vite local).

## Domaines Vercel

1. **Production** : ajouter `somafrik.app` sur l'environnement **Production** (branche `main`).
2. **Préproduction** : ajouter `preprod.somafrik.app` sur l'environnement lié à la branche **`develop`**.

Dans *Project Settings → Domains*, assigner chaque domaine au bon environnement Git.

## DNS

| Enregistrement | Cible |
|----------------|-------|
| `somafrik.app` | Vercel (CNAME ou A selon doc Vercel) |
| `preprod.somafrik.app` | Vercel |
| `api.somafrik.app` | Serveur backend (A/AAAA) |
| `api-preprod.somafrik.app` | Serveur backend préprod (A/AAAA) |

## CORS (côté backend)

Le backend doit autoriser **exactement** l'origine du frontend Vercel :

| Stack | `CORS_ORIGINS` |
|-------|----------------|
| API production | `https://somafrik.app` |
| API préproduction | `https://preprod.somafrik.app` |

Voir `.env.production.example` et `.env.preproduction.example`.

## Développement local

```bash
cd web
npm install
npm run dev
```

- URL : http://localhost:5173/
- API : proxy `/api` → `http://localhost:5000` (`VITE_API_TARGET`)
- Pas besoin de `VITE_API_URL` en local

Pour tester le build intégré Docker (legacy `/web/`) :

```powershell
npm run docker:up
# http://localhost:5000/web/  (backend sert le build avec VITE_BASE_PATH=/web/)
```

## Vérification après déploiement

1. Ouvrir `https://somafrik.app/connexion` (ou préprod).
2. Onglet réseau : les appels partent vers `https://api.somafrik.app/api/...`.
3. Pas d'erreur CORS dans la console.
4. `https://api.somafrik.app/api/health` renvoie `{"status":"ok",...}`.
