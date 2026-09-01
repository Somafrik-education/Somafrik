# Déploiement préproduction — Somafrik

Ce document décrit la topologie de préproduction réellement utilisée par Somafrik.

## Source de vérité hébergement

**Render est l'unique fournisseur d'hébergement Web/API de Somafrik.**

| Composant | Service Render | Branche | URL |
|-----------|----------------|---------|-----|
| Frontend Web préprod | Static Site `somafrik-web-preprod` | `develop` | https://preprod.somafrik.app |
| API préprod | Web Service Node `somafrik-api-preprod` | `develop` | https://somafrik-api-preprod.onrender.com |

La production utilise également Render comme fournisseur cible. Le frontend production est servi sur `https://somafrik.app` et l'API sur `https://api.somafrik.app` après GO production explicite.

Voir `docs/render.md` pour la configuration hébergement canonique.

## 1. Configuration API préproduction

Sur le service Render `somafrik-api-preprod`, définir au minimum :

```env
NODE_ENV=production
APP_ENV=preproduction
DATABASE_URL=<connexion PostgreSQL préproduction>
JWT_SECRET=<secret fort>
CORS_ORIGINS=https://preprod.somafrik.app
SOMAFRIK_SKIP_DEMO_SEED=true
SOMAFRIK_DB_REQUIRED=true
SOMAFRIK_DISABLE_LOGIN_LOCKOUT=false
TRUST_PROXY_HOPS=1
```

Les secrets ne doivent jamais être copiés dans Git, les issues, les PR ou les captures d'écran.

Vérification :

```text
GET https://somafrik-api-preprod.onrender.com/api/health
```

Attendu : HTTP 200, `status=ok`, `database=postgresql`.

## 2. Configuration Web préproduction

Le frontend est le Static Site Render `somafrik-web-preprod`, construit depuis `develop`.

Variables de build attendues :

```env
VITE_API_URL=https://somafrik-api-preprod.onrender.com
VITE_SHOW_DEMO_ACCOUNTS=false
VITE_ENABLE_MARKETPLACE=false
```

Le domaine public de préproduction est :

```text
https://preprod.somafrik.app
```

L'application étant une SPA React, Render doit conserver une règle de rewrite permettant aux routes telles que `/connexion` d'être servies par `index.html`.

## 3. Contrat de déploiement GO-PROD

Un candidat préproduction n'est certifié que si les deux services Render servent le même SHA Git :

```text
RENDER_WEB_DEPLOYED_SHA == RENDER_API_DEPLOYED_SHA == G3_CANDIDATE_SHA
```

Un statut `Deployed` seul ne suffit pas : le SHA doit être vérifié dans les métadonnées du déploiement Render.

Si `develop` avance pendant une certification de release, le candidat est considéré obsolète et doit être recapturé.

## 4. Non-destruction des données

Un déploiement standard ne doit jamais exécuter automatiquement :

- wipe de la base ;
- reset PostgreSQL ;
- seed de démonstration ;
- bootstrap superadmin ;
- migration destructive non explicitement approuvée.

`SOMAFRIK_SKIP_DEMO_SEED=true` et `SOMAFRIK_DB_REQUIRED=true` restent obligatoires en préproduction.

## 5. Stack Docker locale préproduction

Le stack Docker reste disponible pour reproduire l'API localement :

```powershell
npm run preprod:check
npm run preprod:up
```

Le fichier `.env.preproduction` est local et non versionné. Pour le créer :

```powershell
npm run preprod:init-env
```

Le bootstrap est une opération explicite réservée à l'initialisation d'une base vide :

```powershell
npm run preprod:bootstrap
```

Il ne doit pas être exécuté lors d'un déploiement normal d'une préproduction contenant déjà des données.

## 6. Application mobile

Le profil preview/préproduction EAS consomme :

```text
https://somafrik-api-preprod.onrender.com
```

La production mobile consomme :

```text
https://api.somafrik.app
```

## 7. Vérifications après déploiement

Contrôler au minimum :

1. `somafrik-web-preprod` = `Deployed` sur le SHA candidat ;
2. `somafrik-api-preprod` = `Deployed` sur le même SHA candidat ;
3. `GET /api/health` = HTTP 200, PostgreSQL prêt ;
4. `https://preprod.somafrik.app/connexion` s'ouvre ;
5. les appels Web partent vers `https://somafrik-api-preprod.onrender.com` ;
6. aucune erreur CORS ou 5xx ;
7. les données de recette préexistantes sont conservées.

## 8. Dépannage

**Erreur CORS** — `CORS_ORIGINS` doit contenir exactement `https://preprod.somafrik.app` sans slash final.

**API inaccessible** — vérifier le service Render `somafrik-api-preprod`, son dernier déploiement, puis `/api/health`.

**Frontend sans données** — vérifier `VITE_API_URL` sur le Static Site Render et redéployer le bon SHA si cette variable a changé.

**Route Web directe en 404** — vérifier la règle SPA rewrite du Static Site Render vers `index.html`.

**Backend ne démarre pas** — vérifier les variables Render, la connexion PostgreSQL et `SOMAFRIK_DB_REQUIRED=true`.

## 9. Production

La promotion production reste une opération séparée et soumise au GO utilisateur/CTO :

- branche `main` ;
- hébergement Render ;
- Web `https://somafrik.app` ;
- API `https://api.somafrik.app` ;
- CORS `https://somafrik.app` ;
- aucune réutilisation implicite des secrets préproduction.

Aucun merge vers `main` ni déploiement production n'est autorisé par ce guide sans le gate de release correspondant.
