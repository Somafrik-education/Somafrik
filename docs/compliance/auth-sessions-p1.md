# P1-A — Chemin réel authentification / sessions

**Date :** 2026-09-04  
**Mandat :** #503  
**Code :** `backend/services/tokenService.js`, `backend/lib/authTokenPolicy.js`, `backend/lib/sessionRefreshService.js`

## Signature

| | |
|---|---|
| Algorithme | **HS256** (HMAC-SHA256), en-tête JWT `{ alg: "HS256", typ: "JWT" }` |
| Contrôle verify | signature HMAC-SHA256 **puis** `header.alg === "HS256"` et `header.typ === "JWT"` (refus même si HMAC valide) |
| Issuer | `somafrik-api` |
| Types | `typ=access` / `typ=refresh` |

Aucune autre bibliothèque JWT n’est utilisée pour l’API Express.

## Variables `JWT_*` effectivement lues

| Variable | Usage |
|---|---|
| `JWT_SECRET` | HMAC ; obligatoire en production (≥ 32 car., pas une valeur d’exemple) |
| `JWT_ACCESS_TTL_SECONDS` | TTL access ; défaut **900** ; **max 900 en production** (boot `productionSecrets`) |
| `JWT_REFRESH_TTL_SECONDS` | TTL refresh ; défaut 7 jours |

`JWT_EXPIRES`, `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_REFRESH_SECRET` **ne sont pas lus**.

## Chemin

1. `POST /api/login` ou `POST /api/backoffice/login` → access + refresh ; hash SHA-256 du refresh en `sessions.refresh_token_hash` ; audit `mobile_login` / `backoffice_login` **sans** jeton.
2. Access Bearer uniquement (`requireAuth`). JWT en query → 401.
3. `POST /api/auth/refresh` → rotation in-place + `jti`. Pendant **15 s**, une requête concurrente qui présente l’**ancien** refresh n’est pas un reuse : le serveur renvoie le **jeton courant** (celui qui a remplacé l’ancien), jamais l’ancien. Ce jeton courant est stocké chiffré (`refresh_token_grace`, AES-256-GCM dérivé de `JWT_SECRET`) le temps de la grâce. Hors grâce / reuse → `revokeAllSessionsForUser` + 401 `REFRESH_REUSE_DETECTED`.
4. `POST /api/auth/logout` → révoque la session courante.
5. `POST /api/auth/revoke-all` → toutes les sessions du `sub`.
6. `POST /api/auth/change-password` → nouvel access sur la **même** `sessionId` ; **ne révoque pas** les autres appareils (écart documenté).
7. `POST /api/users/:id/reset-password` → nouveau secret temporaire + **révocation de toutes les sessions** (`password_reset`).
8. Lockout : table `login_lockouts` ; 5 échecs / ~15 min ; interdit de le désactiver en production.
9. `mustChangePassword` : seules `/api/auth/change-password`, logout, revoke-all, effective-permissions et self-erasure sont exemptées.

## Tests

`npm run verify:auth-sessions` (rotation, replay, logout, revoke-all, reset→révocation sessions) · `npm run verify:jwt-header` · `npm run verify:login-lockout-data`
