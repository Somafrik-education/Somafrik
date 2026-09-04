# Incident — exposition Data API Supabase (constat CTO 2026-09-04)

**Statut :** constat + remédiation P0-1 dans le dépôt ; application préprod/prod sous GO CTO  
**Date de constat :** 2026-09-04  
**Opérateur / responsable de traitement :** Baudouin Okito — France — `contact@somafrik.app`  
**Issue :** #503  
**Pas de SIREN / société / adresse inventés.**

## Faits (tels que fournis par le CTO)

- Production et préprod avaient des privilèges larges `anon` / `authenticated` sur les tables `public`.
- Aucune politique RLS n’était en place pour compenser.
- La préprod a déjà reçu une première remédiation CTO de révocation sur tables / séquences / fonctions.

Ce document ne suppose pas de volume d’accès, d’exfiltration, ni d’identités d’attaquants non fournis.

## Impact potentiel (hypothèse de surface, pas une preuve d’exploitation)

Avec une clé `anon` PostgREST, un tiers pouvait théoriquement `SELECT`/`INSERT`/`UPDATE`/`DELETE` des tables métier du schéma `public` (élèves, utilisateurs, paiements, sessions, etc.) sans passer par l’API Somafrik.

L’application elle-même n’utilise pas la Data API : Web/Mobile → API Node → PostgreSQL.

## Remédiation dans le dépôt (P0-1)

- Migration idempotente `backend/db/migrations/20260904_p0_supabase_data_api_lockdown.sql`
- Application au boot : `ensureSupabaseDataApiLockdown()`
- Gate : `npm run verify:supabase-data-api-lockdown`
- Procédure dashboard : [supabase-data-api-lockdown.md](./supabase-data-api-lockdown.md)

## Ce qui n’est **pas** clos par ce fichier

- Preuve dashboard « Data API disabled »
- Preuve curl production/préprod avec la vraie clé `anon`
- Analyse forensique des logs PostgREST
- Notification CNIL / établissements (décision CTO, hors ce lot)

## Contact

Signalement sécurité : `security@somafrik.app`  
Contact RGPD opérateur : `contact@somafrik.app`
