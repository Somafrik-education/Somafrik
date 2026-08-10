# Auth Somafrik V2

Package d'autorisation pur de Somafrik V2. Il ne dépend d'Express, PostgreSQL, JWT, sessions ni des clients.

## Lot V2.1a — AuthPrincipal + `can()`

API publique :

- `CANONICAL_ROLES` — liste immuable des dix rôles V2 ;
- `isCanonicalRole(role)` — acceptation exacte, sans alias legacy ;
- `createAuthPrincipal(input)` — contrat immuable `{ userId, role, tenantScope, permissions }` ;
- `can(principal, permission)` — autorisation fail-closed par correspondance exacte.

## Règles retenues

- `tenantScope` est validé par `@somafrik/domain-v2` ;
- `permissions: []` est valide et signifie aucun droit ;
- aucun droit implicite pour `super_admin` ;
- aucun fallback `Voir tableau de bord` ;
- `*`, `ALL_PRIVILEGES` et `COUNTRY_PRIVILEGES` ne sont jamais des wildcards ;
- aucune normalisation ni matrice rôle ↔ tenant dans ce lot.

## Hors périmètre V2.1a

Login, refresh, logout, JWT, sessions, HTTP, PostgreSQL, adaptateurs legacy, provisioning, hash credentials, lockout, résolution d'établissement actif.
