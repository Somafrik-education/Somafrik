# Preuves de transfert — 5 septembre 2026

Relevé factuel pour `sous-traitants-transferts.md`. Pas de secrets.

## Render (API production)

```text
dig +short api.somafrik.app
somafrik-api-prod.onrender.com.
gcp-us-west1-1.origin.onrender.com.
```

**Lecture :** région Render **Oregon** (GCP `us-west1`). Identique pour `somafrik-api-preprod.onrender.com` et `preprod.somafrik.app`.

`/api/health` production et préprod : `{"status":"ok","database":"postgresql",...}` le 5 septembre 2026 — ne divulgue pas l’hôte PostgreSQL.

## Cloudflare

En-tête `cf-ray: …-CMH` observé depuis cette sonde : **edge** Cloudflare (pas la région d’origin Render).

## Expo

Documentation prestataire : Push Service hébergé sur GCP aux États-Unis.

## Supabase

Pas de hostname pooler dans git. Extraction ops :

```js
new URL(process.env.DATABASE_URL).hostname
// attendu : aws-0-<aws-region>.pooler.supabase.com
```

Ne jamais commiter l’URL complète.
