# Audit & implémentation — gestion centralisée des rôles & droits CRUD

**Branche :** `cursor/roles-permissions-crud-92b2`  
**Base :** `develop` (`805ed9daff25715558110494070dd2948619495b`)  
**Head :** `42e24a7c4fbdd195f6b4de7a181a5e01ea7e36cb`  
**Statut :** Draft — STOP revalidation CTO — aucun Ready / aucun merge

## 1. Audit de l’existant

| Composant | Avant | Problème |
|---|---|---|
| `role_permissions` | JSONB global `role_name → string[]` | Pas de `country_id` / `school_id` / colonnes CRUD / version |
| UI `/administration/permissions` | Sélecteurs pays/école **cosmétiques** | PUT écrivait une matrice globale Admin Pays / Admin School |
| `establishment_roles` | Catalogue métier LOT 2 | Permissions = liste de jetons, non scopée |
| `user_roles` | GRANT/REVOKE canonique | Conservé comme source des rôles actifs |
| JWT | Snapshot `permissions[]` | Périmé si la matrice change en session |
| `requirePermission` | Lisait uniquement le JWT | Contournement API possible |
| PUT `/api/backoffice/role-permissions` | Écriture JSONB Superadmin | Interdite (`LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN`) |
| Mobile | Reconstruction locale + PUT | Interdit ; consomme `/auth/effective-permissions` |
| PUT `/api/backoffice/state` `rolePermissions` | Snapshot legacy | Déjà fail-closed `LEGACY_PLATFORM_STATE_WRITE_FORBIDDEN` |

PostgreSQL est la source d’autorité. Le BackOffice legacy n’écrit plus les permissions.

## 2. Modèle PostgreSQL retenu

**Pas de migration JSONB → relationnel aveugle.**  
`role_permissions` JSONB est **conservé en projection de compatibilité (lecture seule)**.

**Nouvelle table justifiée** `role_module_permissions` : le JSONB ne peut pas porter portée, CRUD colonnes, `version` / `updated_at`.

Colonnes cibles :

- `role_key`, `scope_type` (`global` \| `country` \| `school`)
- `country_id` nullable, `school_id` nullable
- `module_key`, `can_create`, `can_read`, `can_update`, `can_delete`
- `status`, `version`, `created_at`, `created_by`, `updated_at`, `updated_by`

Catalogue : `functional_modules` + `establishment_roles` (colonne `system_protected`).

Index unique actif : `(role_key, scope_type, module_key, COALESCE(country_id), COALESCE(school_id))`.

## 3. Algorithme des permissions effectives

Rôles pris en compte : clés **actives** de `user_roles` (pas `users.role` seul). Un rôle révoqué ne contribue plus.

Pour chaque `module_key` et chaque rôle, **premier match gagne** (pas de fusion des flags entre portées) :

1. permission spécifique établissement (`scope_type=school`, `school_id`)
2. permission pays (`scope_type=country`, `country_id`)
3. permission globale par rôle (`scope_type=global`)
4. **DENY** (tous les flags false)

Multi-rôle : **UNION (OR)** des flags des rôles actifs dans le scope.

`SUPER_ADMIN` : invariants forcés + jeton `ALL_PRIVILEGES`.

Aucun droit implicite permissif.

## 4. Catalogue rôles

Source d’autorité : PostgreSQL `establishment_roles`.

- Plateforme protégée : `SUPER_ADMIN`, `COUNTRY_ADMIN`, `SCHOOL_ADMIN` (`system_protected`, non assignables établissement, non archivables).
- Métier établissement : `PREFET_ETUDES`, `TEACHER`, `SECRETARY`, `COMPTABLE`, etc. (seed catalogue, pas hardcodé Web).

Le Superadmin peut créer / renommer / activer / archiver un rôle métier.  
**Suppression physique interdite.** Archivage = `status=archived` : nouvelles attributions refusées ; attributions existantes non révoquées silencieusement.

## 5. Catalogue modules

Modules **réels** Web + Mobile + APIs (pas Bibliothèque) :

Pays, Établissements, Abonnements, Contacts, Relations, Utilisateurs, Droits par rôle, Référentiels pédagogiques, Classes, Élèves, Enseignants, Affectations, Présences, Notes, Bulletins, Paiements, Frais & tarifs, Impayés, Notifications, Messages, Documents, Rapports, Paramètres Établissement, Années Académiques, Matières, Examens, Planning de cours.

CRUD = CREATE / READ / UPDATE / DELETE (jamais un booléen « accès »).

## 6. APIs

| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/backoffice/rbac/catalog` | SUPER_ADMIN |
| GET | `/api/backoffice/rbac/permissions` | SUPER_ADMIN (matrice configurée) |
| GET | `/api/backoffice/rbac/permissions/effective` | SUPER_ADMIN (matrice résolue) |
| PATCH | `/api/backoffice/rbac/permissions` | SUPER_ADMIN, **delta** + `expectedUpdatedAt` |
| POST/PATCH | `/api/backoffice/rbac/roles` | SUPER_ADMIN |
| POST | `/api/backoffice/rbac/roles/:id/archive` | SUPER_ADMIN |
| GET | `/api/auth/effective-permissions` | session, **recalcul live** |
| PUT | `/api/backoffice/role-permissions` | **403 `LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN`** |
| DELETE | `/api/students/:id` | `Élèves:DELETE` live |

Écritures : SUPER_ADMIN, transactionnelles, audit dans la même TX, validation `country_id` / `school_id` / `module_key` / `role_key`.

## 7. UI

Route `/administration/permissions` : onglets **Permissions** / **Rôles**.

Parcours Superadmin : PAYS (canoniques) → ÉTABLISSEMENT (du pays) → RÔLE (catalogue) → MODULE → 4 cases CRUD.

Enregistrer = delta du module affiché uniquement.

Catalogue rôles : nom, `role_key`, portée, statut, utilisateurs actifs, dernière modification.

## 8. Règles Superadmin

Impossible d’archiver `SUPER_ADMIN` / `COUNTRY_ADMIN` / `SCHOOL_ADMIN`.  
Impossible de retirer les invariants : Droits par rôle, Utilisateurs, Pays, Établissements, Référentiels pédagogiques.  
`ALL_PRIVILEGES` toujours injecté à la résolution SUPER_ADMIN.  
WRITE UI + API = SUPER_ADMIN uniquement.

## 9. Protections tenant

Permission école A ≠ école B. Pays isolés. Fail-closed DENY.  
COUNTRY_ADMIN / SCHOOL_ADMIN / PREFET → **403** sur PATCH permissions.

## 10. Session / JWT

Le JWT **n’est plus l’autorité**. Snapshot UI seulement.  
`requirePermission` **recalcule** depuis PostgreSQL (ou store mémoire de secours) à chaque requête.

**Réponse cible :** un Préfet déjà connecté **perd immédiatement le droit côté API**.  
L’UI / Mobile se mettent à jour via `GET /api/auth/effective-permissions`.  
Un appel API manuel ne peut pas contourner l’UI.

## 11. Audit transactionnel

Même transaction PostgreSQL :

- `ROLE_PERMISSION_MATRIX_UPDATED`
- `ROLE_PERMISSION_GRANTED` / `ROLE_PERMISSION_REVOKED`
- `ROLE_CREATED` / `ROLE_UPDATED` / `ROLE_ARCHIVED`

Champs : actor, role_key / entity, module_key, scope, before, after, timestamp.  
Si l’audit échoue → rollback.

## 12. Concurrence

`expectedUpdatedAt` confronté à `MAX(updated_at)` du scope.  
Stale ou absent alors que la matrice existe → **409 CONFLICT**. Pas de last-write-wins silencieux.

## 13. Tests

| Id | Cas | Couverture |
|---|---|---|
| A | SUPER_ADMIN lecture/écriture | verify-functional-rbac + unit |
| B | COUNTRY_ADMIN 403 écriture | verify |
| C | SCHOOL_ADMIN 403 | verify |
| D | PREFET 403 écriture | verify |
| E | Isolation établissement | unit cascade + PG IT |
| F | Isolation pays | unit + PG IT |
| G | Multi-rôle union | unit |
| H | Rôle révoqué ignoré | unit |
| I | Rôle archivé non attribuable | verify |
| J | Audit fail → rollback | unit mémoire + PG IT |
| K | `expectedUpdatedAt` stale → 409 | unit + verify + PG IT |
| L | DELETE élèves refuse réellement | verify 403 puis restore |
| M | Web bouton CRUD | StudentsListPage + PermissionsPage |
| N | Mobile même source effective-permissions | client refuse PUT legacy |

E2E métier : Superadmin RDC → INSTITUT NURU → Préfet → Élèves → retirer DELETE → Enregistrer → Préfet DELETE API 403 → réactiver → autorisé (200/204/404).

## 14. Fichiers / tables

**Tables :** `role_module_permissions`, `functional_modules`, `establishment_roles` (`system_protected`), `user_roles`, `audit_logs`.  
`role_permissions` JSONB : **lecture seule**.

**Migration :** `backend/db/migrations/20260823_functional_rbac_canonical.sql`

**Rollback :** `DROP TABLE role_module_permissions; DROP TABLE functional_modules; ALTER TABLE establishment_roles DROP COLUMN system_protected;`  
La lecture JSONB `role_permissions` reste disponible (projection). Réactiver PUT legacy serait un rollback produit, pas un rollback schéma.

## 15. Base SHA

`805ed9daff25715558110494070dd2948619495b` (`develop`)

## 16. Head SHA

`42e24a7c4fbdd195f6b4de7a181a5e01ea7e36cb` (`cursor/roles-permissions-crud-92b2`)

## 17. CI / Security

- Écriture legacy permissions fail-closed.
- JWT non autoritatif.
- Isolation tenant école/pays.
- Invariants SUPER_ADMIN.
- Pas de secret dans le diff.

## 18. Verdict

**NO-GO merge** jusqu’à revalidation CTO + diff GitHub indépendant.  
PR **Draft** uniquement. Aucun Ready. Aucun merge.
