# ADMIN-02B — Libellés d’affichage des rôles (Option A)

**Statut : DRAFT / HOLD — IMPLÉMENTATION OPTION A — PAS READY — PAS MERGE**

Base : `develop@6752b5399b3731d739dd7f8994a7a26673daa095`

## Décision CTO

Option A autorisée : colonne `display_label TEXT` nullable, **non UNIQUE**.
Deux rôles peuvent afficher le même texte. L’identité reste `role_code`.

Aucun backfill. `NULL` = libellé par défaut (`role_name`).

## Schéma

```sql
ALTER TABLE establishment_roles
ADD COLUMN IF NOT EXISTS display_label TEXT;
```

Migration versionnée : `backend/db/migrations/20261001_establishment_roles_display_label.sql`  
Bootstrap fresh DB : `establishmentRolesSchema.js` aligné.

## Contrat

| Champ | Source |
|---|---|
| `roleKey` | `role_code` |
| `defaultLabel` | `role_name` |
| `displayLabel` | `display_label` (NULL si vide) |
| `effectiveLabel` | `trim(display_label)` non vide ? `display_label` : `role_name` |

Résolution unique : `backend/lib/roleDisplayLabels.js` (Web/Mobile : `roleDisplayLabels.ts`).

## Écriture

SUPER_ADMIN uniquement.

- `PATCH /api/backoffice/rbac/roles/:roleId/display-label` `{ "displayLabel": "Directeur" }`
- `POST /api/backoffice/rbac/roles/:roleId/display-label/reset`
- `GET /api/backoffice/rbac/role-display-labels`

Chaîne vide → RESET/NULL.  
COUNTRY_ADMIN / SCHOOL_ADMIN / autres = 403.  
Ne passe **pas** par `assertNotProtectedMutation()`.  
`role_code` / `role_name` / `scope` / `system_protected` / permissions intouchables.

## Collision acceptée

`SCHOOL_ADMIN` peut afficher « Directeur » alors que `PRINCIPAL.role_name` = « Directeur ».  
`toRoleKey("Directeur")` reste `PRINCIPAL`. Jamais `display_label` en entrée d’autorisation.

## Audit

`ROLE_DISPLAY_LABEL_UPDATE` / `ROLE_DISPLAY_LABEL_RESET`  
Payload : `roleKey`, `oldDisplayLabel`, `newDisplayLabel` + acteur. Aucun secret.

## Hors contrat

Ne pas modifier : `role_code`, `role_name`, `users.role`, `user_roles.role_key`, JWT, resolvers RBAC.
