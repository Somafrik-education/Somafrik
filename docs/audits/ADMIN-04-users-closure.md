# ADMIN-04 — Utilisateurs : audit de clôture

**Statut : DRAFT / HOLD — PAS READY — PAS MERGE**

Base : `develop@46a91bfae1cca4fdaf5bab4b7d51bc816c504266`

Module déjà largement opérationnel. Aucune reconstruction. Aucune migration.

## Matrice des 13 actions

| # | Action | Web | API | PG | Relecture | Verdict |
|---|--------|-----|-----|----|-----------|---------|
| 1 | Consulter | `GET` list + détail mémoire | `GET /api/backoffice/users` | lecture `users` / `user_roles` | n/a | GREEN (pas de GET-by-id) |
| 2 | Créer COUNTRY_ADMIN | provision | `POST /api/backoffice/users/provision` | `users` + `user_roles` | `refresh(["users"])` | GREEN |
| 3 | Créer SCHOOL_ADMIN | provision | idem | idem + `school_id` | refresh | GREEN (COUNTRY → pending) |
| 4 | Modifier identité | PATCH allowlist | `PATCH /api/backoffice/users/:userId` | colonnes identité | refresh | GREEN |
| 5 | Valider pending | PATCH Actif + Validé | même PATCH | `status=active` | refresh | GREEN + garde Superadmin |
| 6 | Refuser pending | PATCH Archivé | même PATCH | `status=archived` | refresh | GREEN (contrat existant = archivé) |
| 7 | Suspendre | PATCH Suspendu | même PATCH | `status=suspended` | refresh | GREEN |
| 8 | Réactiver | PATCH Actif | même PATCH | `status=active` | refresh | GREEN |
| 9 | Attribuer rôle | grant | `POST …/roles/grant` | `user_roles` | refresh | GREEN |
| 10 | Retirer rôle | revoke | `POST …/roles/revoke` | `user_roles.revoked` | refresh | GREEN |
| 11 | Réaffecter établissement | modal dédiée | `POST …/reassign-school` | `users.school_id` + `user_roles` + sessions | refresh | GREEN |
| 12 | Reset mot de passe | prompt + POST | `POST /api/users/:id/reset-password` | hash + `must_change_password` | **était GAP** | corrigé |
| 13 | Reload après mutation | `refresh(["users"])` | re-GET list | lecture | — | GREEN sauf reset avant hotfix |

## SCHOOL_ADMIN

Voit uniquement `u.school_id` de son établissement. Ne provisionne pas COUNTRY_ADMIN / SUPER_ADMIN. Ne réaffecte pas. PATCH tenant ignoré.

## Invariants Superadmin

Pas de création SUPER_ADMIN via provision. Pas d’auto grant/revoke. PATCH n’accepte pas `role`. Identité = `roleKey`. `effectiveRoleLabel` visuel only.

## Gaps trouvés

1. **Reset UI** — `resetPassword` ne rappelait pas `refresh(["users"])`. Toast seul.
2. **Prompt** — « min. 6 caractères » alors que la politique est 8.
3. **Pending** — COUNTRY_ADMIN pouvait PATCH `status: Actif` sur un compte `pending_validation`. Reset était déjà 409.
4. **Web reset gate** — `COUNTRY_PRIVILEGES` accepté backend, absent Web.

## Correctifs (ciblés)

- `UsersPage.resetPassword` → persist + `refresh(["users"])` + libellé 8 caractères + ligne d’état mot de passe temporaire.
- `backofficeStateMerge` : flags `mustChangePassword` / `hasTemporaryPassword` distants gagnent s’ils sont définis.
- `clientsService.updateUser` : sortie de `pending_validation` réservée au Superadmin.
- `canResetUserPassword` : accepte `COUNTRY_PRIVILEGES`.

## Migration

**NON.**
