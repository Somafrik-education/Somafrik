# Hébergement Somafrik — Render

Ce document est la **source de vérité canonique** pour l'hébergement Somafrik.

## Fournisseur unique

Somafrik utilise **Render** pour l'hébergement de ses composants Web et API.

Aucun autre fournisseur d'hébergement Web ne fait partie de la topologie active documentée.

## Préproduction

| Composant | Type Render | Service | Branche | URL publique |
|-----------|-------------|---------|---------|--------------|
| Web | Static Site | `somafrik-web-preprod` | `develop` | https://preprod.somafrik.app |
| API | Web Service Node | `somafrik-api-preprod` | `develop` | https://somafrik-api-preprod.onrender.com |

### Web préproduction

Variables de build :

```env
VITE_API_URL=https://somafrik-api-preprod.onrender.com
VITE_SHOW_DEMO_ACCOUNTS=false
VITE_ENABLE_MARKETPLACE=false
```

Le frontend est une SPA React. Le Static Site Render doit conserver une règle de rewrite vers `index.html` pour les routes applicatives directes (`/connexion`, etc.).

### API préproduction

Variables non secrètes/contrats minimaux :

```env
NODE_ENV=production
APP_ENV=preproduction
CORS_ORIGINS=https://preprod.somafrik.app
SOMAFRIK_SKIP_DEMO_SEED=true
SOMAFRIK_DB_REQUIRED=true
SOMAFRIK_DISABLE_LOGIN_LOCKOUT=false
TRUST_PROXY_HOPS=1
```

`DATABASE_URL`, `JWT_SECRET` et les autres secrets sont configurés uniquement dans Render et ne doivent pas être documentés avec leurs valeurs.

Health check :

```text
https://somafrik-api-preprod.onrender.com/api/health
```

## Production

La production utilise Render comme fournisseur cible :

| Composant | Branche | URL publique |
|-----------|---------|--------------|
| Web | `main` | https://somafrik.app |
| API | `main` / release approuvée | https://api.somafrik.app |

La création ou modification des services production, leurs secrets et tout déploiement production restent soumis au gate GO-PROD et à un GO explicite.

## Contrat de release

Avant de promouvoir un candidat, relever le SHA Git exact de chaque déploiement Render.

Préproduction :

```text
RENDER_WEB_DEPLOYED_SHA == RENDER_API_DEPLOYED_SHA == G3_CANDIDATE_SHA
```

Un badge `Deployed` sans SHA ne constitue pas à lui seul une preuve suffisante.

## Données et sécurité

Un déploiement Render standard ne doit pas déclencher :

- wipe de données ;
- reset PostgreSQL ;
- seed de démonstration ;
- bootstrap superadmin ;
- exposition ou rotation implicite des secrets.

Les volumes/disques persistants nécessaires aux pièces jointes et autres données persistantes doivent rester montés conformément aux variables du service API.

## DNS

Les domaines publics doivent pointer vers les services Render correspondant à l'environnement :

- `preprod.somafrik.app` → Static Site préproduction ;
- `somafrik.app` → Static Site production lorsque celui-ci est activé ;
- `api.somafrik.app` → API production lorsque celle-ci est activée.

L'URL native `somafrik-api-preprod.onrender.com` reste l'endpoint API préproduction utilisé par le Web et le profil Mobile preview.

## Vérification opérateur

Pour toute certification de déploiement :

1. ouvrir le service Render ;
2. identifier le dernier déploiement ;
3. relever branche, SHA et statut ;
4. comparer au SHA candidat GitHub ;
5. vérifier `/api/health` pour l'API ;
6. effectuer le smoke Web ;
7. confirmer que les données préexistantes sont intactes.

Voir également `docs/preproduction.md` pour la procédure préproduction détaillée.
