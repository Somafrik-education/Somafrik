# Preuves de transfert — 5 septembre 2026

Relevé factuel pour `sous-traitants-transferts.md`. Pas de secrets.

## Render (API production)

Contrôle via métadonnées du service Render `Somafrik-api-prod` (`srv-dac22v8jo6nc739b3t9g`) :

```text
branch: main
region: frankfurt
runtime: node
healthCheckPath: /api/health
```

**Lecture :** l’API production est hébergée en région Render **Frankfurt (Allemagne)**. Le CNAME public `*.onrender.com` ou la résolution DNS ne doit pas être utilisé seul pour déduire la région d’exécution du service ; la métadonnée de service Render fait foi pour l’inventaire opérationnel.

`/api/health` production : `database=postgresql`; aucune chaîne de connexion n’est publiée.

## Supabase production

Contrôle via métadonnées projet Supabase `Somafrik-prod` (`loyubruyrxcaeshonkwp`) :

```text
region: eu-west-1
status: ACTIVE_HEALTHY
postgres: 17.6.1.166
```

**Lecture :** la base PostgreSQL de production est hébergée en **Irlande (AWS eu-west-1, EEE)**. Ne jamais recopier le mot de passe, la chaîne `DATABASE_URL` ou un secret dans ce document.

## Expo

Documentation prestataire : le service Expo Push implique un traitement sur l’infrastructure GCP aux États-Unis. Le build EAS production est utilisé pour fabriquer les binaires Android ; aucun secret EAS n’est versé dans git.

## Cloudflare / CDN

Un point de présence CDN ou un identifiant d’edge observé depuis une sonde ne constitue pas une preuve de la région d’origine de l’API. Il doit être distingué de la région d’exécution Render.
