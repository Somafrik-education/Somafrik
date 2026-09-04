# P0-1 — Verrouillage Data API Supabase

**Statut :** correctif versionné, à appliquer en préprod puis production après GO CTO  
**Date :** 2026-09-04  
**Issue :** #503  
**Opérateur :** Baudouin Okito — France — `contact@somafrik.app`

## Architecture réelle

Les clients Web et Mobile **n’appellent pas** PostgREST / Data API. Chemin canonique :

`Web / Mobile → API Somafrik (Node) → PostgreSQL (connexion DATABASE_URL)`

Preuve statique : aucun `@supabase/supabase-js` dans `web/src`, `Mobile/src`, `backend`. Gate : `npm run verify:supabase-data-api-lockdown`.

## Ce que fait la migration

Fichier : `backend/db/migrations/20260904_p0_supabase_data_api_lockdown.sql`

Idempotente. Si les rôles `anon` / `authenticated` existent :

- `REVOKE ALL` tables, séquences, fonctions du schéma `public`
- révocation des **default privileges** pour les rôles créateurs connus (`postgres`, `supabase_admin`, utilisateur courant)
- `REVOKE` des grants `PUBLIC` sur tables / séquences / fonctions `public`
- **ne révoque pas** `service_role` ; lui ré-accorde `ALL` s’il existe

Le rôle applicatif (propriétaire des tables / `DATABASE_URL`) conserve ses droits d’owner. Smoke backend PostgreSQL : `SELECT` applicatif OK après lockdown.

## Gate automatisé

`npm run verify:supabase-data-api-lockdown`

- statique : SQL, boot `ensureSupabaseDataApiLockdown()`, absence de client Data API
- PostgreSQL (si `DATABASE_URL`) : recrée un schéma, simule des grants larges `anon`/`authenticated`/`PUBLIC`, applique la migration, exige **permission denied** (`42501`) sur au moins :

`users`, `students`, `teachers`, `contacts`, `payments`, `audit_logs`, `sessions`, `mobile_push_devices`

Inventaire lu (non bloquant) : fonctions `SECURITY DEFINER` et vues du schéma `public`.

## Procédure CTO — désactiver la Data API (dashboard)

La migration SQL **ne désactive pas** PostgREST. Elle rend les tables inexploitables par `anon` / `authenticated` même si l’endpoint REST reste allumé.

Si aucune dépendance applicative n’existe (constat ci-dessus) :

1. Supabase Dashboard → Project Settings → API → **Data API** / PostgREST → Disable (libellé selon console).
2. Ne pas supposer que c’est fait sans preuve.
3. Preuve attendue (à coller dans le ticket CTO, pas dans git) :
   - capture d’écran datée du toggle Disabled
   - `curl -sS -D - "https://<projet>.supabase.co/rest/v1/students?select=id" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"` → 401 / permission denied / endpoint down
   - même test sur `users`, `payments`
4. Cursor n’a pas accès au dashboard et **n’écrit pas** en production.

## Ordre d’application

1. Merge PR Draft après GO lot P0-1
2. Déploiement **préprod** (boot applique `ensureSupabaseDataApiLockdown`)
3. Exécuter le gate PG contre la préprod (ou une copie)
4. Dashboard Data API + preuves
5. Production : uniquement après GO CTO. Pas de write prod par Cursor.

## Risques résiduels

- Un rôle custom autre que `anon`/`authenticated` avec grants métier n’est pas couvert (hors constat CTO).
- Schémas `auth`, `storage`, `extensions` : non modifiés.
- Désactivation Data API dashboard : **non vérifiable depuis le dépôt**.
