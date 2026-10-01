# ADMIN-02B — Libellés d’affichage des rôles (STOP migration)

**Statut : DRAFT / HOLD — STOP AVANT MIGRATION — PAS READY — PAS MERGE**

Base : `develop@6752b5399b3731d739dd7f8994a7a26673daa095`

## Décision

Aucun stockage existant n’est propre pour un **alias d’affichage distinct** du rôle canonique.
Aucune migration n’a été créée. Produit (API / UI / Mobile) non implémenté.

## Structure actuelle

### `establishment_roles`

| Colonne | Rôle |
|---|---|
| `role_code` | Identité technique (`UNIQUE`) = `roleKey` |
| `role_name` | Libellé **et** identité fonctionnelle (`UNIQUE`) |
| `scope` | platform / country / school |
| `system_protected` | SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN |
| `school_assignable`, `display_order`, `status` | Catalogue ADMIN-02 |

**Pas de `display_label`.** Pas de JSONB de configuration.

`role_name` est déjà le « label métier » d’ADMIN-02 (`PATCH` rename). Il n’est **pas** un alias d’affichage :

- `UNIQUE (role_name)` — deux rôles ne peuvent pas partager un libellé.
- `getRoleByNameOrCode` résout l’identité via `role_name` **ou** `role_code`.
- `ROLE_TO_DB["Directeur"] = "PRINCIPAL"` — le catalogue a déjà un rôle dont le défaut est « Directeur ».
- `assertNotProtectedMutation` refuse de renommer SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN.
- Les permissions seed et `users.role` utilisent `role_name`.

### `user_roles`

`role_key TEXT NOT NULL` — identité d’autorisation. Interdit d’y écrire « Directeur ».

### `users`

`users.role TEXT` — label canonique historique (ex. `Admin School`, `Enseignant`). Sert encore au JWT / resolver. Interdit d’y stocker l’alias.

### `role_permissions`

`role_name PRIMARY KEY` + `permissions JSONB` — matrice legacy de jetons. Détourner ce JSONB mélangerait affichage et autorisations.

### `audit_logs`

Journal uniquement. Pas un store de configuration.

### `school_settings` / `school_academic_configs`

Portée établissement. V1 = alias **global plateforme**. Hors contrat.

## Pourquoi ça ne suffit pas

1. Réutiliser `role_name` modifierait l’identité ADMIN-02 et casserait `UNIQUE` (ex. SCHOOL_ADMIN → « Directeur » vs PRINCIPAL déjà « Directeur »).
2. Les rôles protégés ne sont pas renommables, or le mandat exige un alias visuel pour SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN.
3. `toRoleKey("Directeur")` → `PRINCIPAL`. Un alias réinjecté dans le resolver créerait une ambiguïté d’autorisation (DL-18).
4. Aucune colonne / table n’exprime `displayLabel` distinct de `defaultLabel` / `roleKey`.

## Migration minimale proposée (non créée)

**Option A — V1 minimale (recommandée pour ce lot)**

```sql
ALTER TABLE establishment_roles
  ADD COLUMN IF NOT EXISTS display_label TEXT;

-- Reset = NULL. Chaîne vide interdite côté service (fallback defaultLabel).
-- PAS de UNIQUE : deux rôles peuvent afficher le même texte (DL-18).
```

- `role_code` / `role_name` / `system_protected` / permissions inchangés.
- `effectiveLabel = display_label non vide ? display_label : role_name` (defaultLabel = `role_name` actuel).
- API dédiée, pas le PATCH rename ADMIN-02.

**Option B — table dédiée (variantes pays/école plus tard)**

```sql
CREATE TABLE role_display_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'global',
  country_id UUID,
  school_id UUID,
  display_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

V1 n’écrirait que `scope_type = 'global'`. Plus large que le besoin immédiat.

## Impact si Option A autorisée

- 1 colonne nullable, pas de backfill (tous les `effectiveLabel` restent les défauts).
- Endpoints dédiés GET/PATCH/RESET Superadmin.
- Clients : transporter `roleKey` + `effectiveRoleLabel` ; ne jamais substituer le `roleKey`.
- `toRoleKey` / JWT / `routePermissions` / `user_roles.role_key` intouchés.

## Hors périmètre jusqu’à autorisation

API, UI Superadmin, propagation Web/Mobile, tests DL-01→18 produit.
