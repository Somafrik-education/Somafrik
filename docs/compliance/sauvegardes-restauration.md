# P1-D — Sauvegardes et restauration (comportement réel)

**Date :** 2026-09-04  
**Opérateur :** Baudouin Okito — France — `contact@somafrik.app`  
**Pas de SIREN / SLA inventés.**

L’application Somafrik **n’implémente pas** de job de backup, de PITR, ni de restore. Les sauvegardes sont celles des hébergeurs.

## Ce qui existe dans le dépôt

| Élément | Réalité code / docs |
|---|---|
| Export établissement | `GET /api/data-export` — snapshot lecture PG `READ ONLY` + `REPEATABLE READ` ; **pas** un backup/restore global ; **403** Superadmin / Admin Pays (#503) |
| UI `/parametres/donnees` | Export CSV/JSON ; pas d’import restore |
| Runbook | `docs/project/OPERATIONS.md` §4.3 : restauration snapshot hébergeur plutôt qu’un reverse-migration |
| Hébergement Web+API | Render (`docs/render.md`) |
| PostgreSQL | Projet Supabase (PITR / backups dashboard — **non copiés dans git**) |

## Exigences CTO vs écart

| Exigence | État |
|---|---|
| Sauvegardes au même niveau de protection que la prod | **Ops hébergeur** (chiffrement au repos, accès dashboard) — non prouvable depuis git |
| Test de restauration documenté | Procédure ci-dessous ; **aucun** dernier test daté n’est versionné ici |
| Rétention bornée | Politique **Supabase / Render**, pas une durée unique dans l’app |
| Réappliquer suppressions après restore d’un backup ancien | Voir procédure ; **pas** de journal d’effacement hors PostgreSQL aujourd’hui |

## Procédure ops (sous GO CTO, pas depuis Cursor prod)

1. Choisir le snapshot / PITR (heure incident notée).
2. Restaurer **hors production** d’abord si possible.
3. Relancer le lockdown Data API (`ensureSupabaseDataApiLockdown` au boot).
4. Smoke : `GET /api/health`, login établissement, pas Superadmin sur `/api/students`.
5. **Effacements :** un backup antérieur à un `privacy_erasure` **réintroduit** le compte. `privacy_requests` est dans la même base : le restore peut aussi effacer la trace. Tenir un registre ops hors bande (ticket : request_code, identifiant, école, date) et rejouer `POST /api/privacy/erasure-requests/:id/execute` ou recréer la demande puis l’exécuter.
6. Purge sessions : `node backend/scripts/purge-retention.js` uniquement si `SOMAFRIK_ALLOW_RETENTION_PURGE=true` et cible non-prod, ou équivalent ops.

## Android

Le backup OS d’un appareil n’est pas une sauvegarde métier Somafrik. Voir `docs/mobile/RELEASE-READINESS.md` (SecureStore / `allowBackup`).
