# P0 — Réconciliation RBAC production (parité préprod)

**PR :** #490 (DRAFT — NON READY — NON MERGÉE)  
**Branche :** `fix/p0-production-rbac-parity`  
**Gouvernance :** aucun apply production sans GO CTO explicite.

## Cause racine confirmée

1. `buildSeedRolesFromData()` lisait `rolePermissionsDeclared` (alias historiques) au lieu de la matrice enrichie `rolePermissions` (alias + jetons `Domaine:ACTION`).
2. `seedDefaultRolesIfEmpty()` sortait dès qu’une ligne existait dans `establishment_roles`.
3. `backfillGlobalGrantsFromLegacyMaps()` sortait dès qu’un grant `role_module_permissions` existait.
4. `rolePermissionsForLiveRbac()` renvoyait la liste déclarée pour les rôles établissement, donc le backfill des modules manquants restait incomplet.
5. Une base créée récemment (production) restait figée sur la matrice minimale. La préproduction avait accumulé les enrichissements.

Les alias `Voir élèves` / `Messages parents` ne produisent pas toujours les flags CRUD live (`Messages parents` matche le module Messages mais n’active aucun flag). Le runtime `requirePermission` overlaye `role_module_permissions` et remplace le JWT : sans `Messages:READ` / `Élèves:READ` live, l’API répond 403 (`students:` / `messages: accès refusé pour ce domaine`).

## Matrice avant / après (jetons catalogue / modules live)

| Rôle | Prod tokens | Préprod tokens | Canonique PR | Prod modules | Préprod modules | Canonique modules |
|---|---:|---:|---:|---:|---:|---:|
| Préfet des études | 29 | 74 | 101 | 10 | 24 | 24 |
| Directeur | 5 | 68 | 93 | 5 | 20 | 24 |
| Proviseur | 9 | 72 | 97 | 7 | 20 | 24 |
| Secrétaire | 4 | 42 | 48 | 3 | 15 | 16 |
| Enseignant | 11 | 28 | 37 | 10 | 17 | 17 |
| Parent | 5 | 17 | 20 | 4 | 11 | 11 |
| Élève / Étudiant | 3 | 17 | 18 | 3 | 11 | 11 |
| Comptable | 2 | 2 | 9 | 2 | 5 | 4 |
| Surveillant | 3 | 3 | 8 | 3 | 3 | 3 |
| Super Administrateur Somafrik | complet | complet | 196 (hors ALL_PRIVILEGES) | complet | complet | 27 |
| Admin Pays | complet | complet | 47 (hors COUNTRY_PRIVILEGES) | complet | complet | 9 |
| Admin School | complet | complet | 124 | complet | complet | 24 |

Les écarts canonique > préprod viennent surtout des jetons `:SUSPEND` de `securityMatrix` (conservés, jamais utilisés comme escalade). Comptable : 4 modules finance (Paiements, Frais, Impayés, Rapports) — aucun `Élèves:READ`.

## SQL

| Fichier | Usage |
|---|---|
| `backend/db/migrations/20260903_p0_system_roles_rbac_inventory.sql` | Inventaire lecture seule avant apply |
| `backend/db/migrations/20260903_p0_system_roles_rbac_reconciliation.sql` | Migration additive, transactionnelle, idempotente |
| `backend/db/migrations/20260903_p0_system_roles_rbac_verify.sql` | Seuils après apply |
| `backend/db/migrations/20260903_p0_system_roles_rbac_rollback.sql` | Rollback grants tagués ; restauration backup sinon |
| `backend/db/migrations/20260903_p0_system_roles_rbac_session_revoke.sql` | Révocation ciblée `revoke_reason=rbac_system_roles_reconciliation_p0` |

Le bootstrap applicatif (`ensureEstablishmentRolesBootstrap` + `ensureFunctionalRbacBootstrap`) exécute la même réconciliation JS. Une base neuve ne peut plus rester sur la matrice minimale.

## Invalidation des sessions

Après apply SQL (GO CTO) :

1. Exécuter l’inventaire des `user_roles` actifs des 9 rôles établissement.
2. `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'rbac_system_roles_reconciliation_p0' WHERE revoked_at IS NULL AND user_id IN (...)`.
3. Conserver les traces. Aucun `TRUNCATE` / `DELETE FROM sessions`.
4. Reconnexion obligatoire pour recalculer JWT + `resolveEffectivePermissions`.

## RLS Supabase (hors correctif immédiat)

Constat d’audit : les tables `public` ont la RLS désactivée.

- **Ne pas activer la RLS** dans cette PR.
- **Ne pas créer de politiques génériques.**
- Vérifier hors bande si les rôles Data API `anon` / `authenticated` ont des grants `SELECT/INSERT/UPDATE/DELETE` sur `public`. Si oui, c’est un chantier sécurité séparé (fail-closed + politiques par tenant).
- Activer la RLS sans politiques compatibles interromprait l’application (PostgREST et éventuellement le pooler).

Chantier proposé : `docs/audits` dédié « RLS public schema — politiques tenant UUID `school_id` », après GO RBAC.

## Interdiction

Aucune écriture Cursor sur `Somafrik-prod`. Aucune invalidation de session production depuis cet agent.
