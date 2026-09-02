# Finance F6 — RBAC live PostgreSQL

Date : 2026-08-28  
PR : #368  
Branche : `cto/finance-f6-live-rbac`  
Base : `develop@cc580307a17b171fbdd9b5fd19e99044d6b04595`

```text
F6          DRAFT
Ready       NON
Merge       NON
F7          NON OUVERT
```

F1–F5 restent invariants. F6 ne modifie ni le modèle Finance, ni les allocations, ni les soldes, ni l'UX F7.

## 1. Cause racine

`requirePermission()` rechargeait déjà `resolveEffectivePermissions`, mais :

1. une liste PostgreSQL vide de `user_roles` retombait sur `principal.role` / `roleKeys` / `roles` du JWT ;
2. le lookup des rôles pouvait être global (`listActiveUserRoleKeys(userId)`) au lieu du tenant courant ;
3. les mutations Finance (grilles, statuts, ajustements) réutilisaient la route key trop large `POST /api/payments` ;
4. les helpers métier pouvaient encore s'appuyer sur le libellé de rôle ;
5. les preuves HTTP PostgreSQL stale-JWT n'étaient pas dans la gate (`UNIT GO — HTTP PostgreSQL stale-JWT reste requis`).

## 2. Architecture finale

```text
JWT = identité de session (sub, schoolCode)
        ↓
user_roles PostgreSQL filtrés par (userId, currentSchoolId, active=true)
        ↓
role_module_permissions PostgreSQL
        ↓
permissions effectives de la requête
        ↓
RbacService.canAccess(routeKey) + gardes secondaires (canManage*)
```

Invariant : **POSTGRESQL LIVE > JWT STALE**.

- Session établissement : uniquement `listActiveUserRoleKeysForSchool`. Primitive absente ou établissement introuvable → `[]`.
- Identité JWT : `sub` = `users.id`, ou overlay `teachers.id` du tenant résolu vers `users.id`. Jamais de reconstruction de rôles depuis le JWT.
- Zéro rôle actif → sentinel interne `SANS_AFFECTATION` → permissions Finance `[]`. Le JWT `Admin School` / `ALL_PRIVILEGES` / `Paiements:UPDATE` ne restaure rien **sur les routes Finance**.
- `requirePermission` Finance (`isFinanceLiveRbacRouteKey`) appelle `resolveFinanceLivePermissions` et **remplace toujours** `principal.permissions` par le tableau live (ou `[]`).
- `requirePermission` hors Finance conserve l'overlay historique `resolveEffectivePermissions` (contrat L1 / Classes / Présences / Notes). `attachLiveRbacAuthority` **n'écrase plus** `resolveEffectivePermissions`.
- Source `legacy-map-fallback` / `legacy-role-fallback` → fail-closed permissions vides **pour Finance**.
- Autorité F6 attachée au repository PostgreSQL seulement (`resolveFinanceLivePermissions`). Le mode mémoire de développement reste hors production.

## 3. Matrice endpoint / action

Voir `backend/lib/financeRbacRouteMatrix.js`. Extraite :

| METHOD | PATH | ACTION | PERMISSION | GARDE |
|---|---|---|---|---|
| GET | `/api/finance/catalog` | catalogue | Paiements:READ / Frais & tarifs:READ | |
| GET | `/api/finance/payment-student-options` | élèves encaissement | **Paiements:READ** | pas Élèves:READ |
| GET/PUT | `/api/finance/payment-methods` | moyens | READ catalogue / UPDATE Frais&tarifs ou Paramètres | canManagePaymentMethods |
| GET/POST/PATCH | `/api/finance/payment-statuses` | statuts | Paiements:READ / UPDATE | canManagePaymentStatuses |
| GET/POST/PATCH | `/api/finance/fee-grids` | grilles | Frais & tarifs:READ/CREATE/UPDATE | canManageFeeGrids |
| POST | `/api/finance/fee-grids/:id/activate\|deactivate\|apply` | cycle de vie grille | Frais & tarifs:UPDATE | canManageFeeGrids |
| GET | `/api/finance/student-fees` | obligations | Impayés:READ / Paiements:READ / Frais & tarifs:READ | |
| POST | `/api/finance/student-fees/:id/adjust` | ajustement | Paiements:UPDATE / Frais & tarifs:UPDATE | canAdjustStudentFee |
| POST | `/api/finance/reconcile-payment-allocations` | réconciliation | Paiements:UPDATE | |
| GET | `/api/payments` | liste encaissements | Paiements:READ | |
| POST | `/api/payments` | encaissement | Paiements:CREATE / UPDATE | obligationId ou Non imputé |
| POST | `/api/payments/:id/cancel` | annulation | **Paiements:UPDATE** (CREATE insuffisant) | canCancelPayment |
| GET | `/api/backoffice/finance/unpaid` | impayés | Impayés:READ / Paiements:READ | |
| POST | `/api/backoffice/finance/unpaid/:id/reminders` | relance | Impayés:CREATE / Paiements:UPDATE | **canForceReminder = Impayés:CREATE seulement** si force |
| GET | `/api/students/:id/payments` | fiche élève | auth + périmètre élève | pas d'élargissement Élèves:READ |

Les grilles ne sont plus protégées par `POST /api/payments`.

## 4. Preuves stale-JWT grant / revoke

`backend/lib/financeLiveRbac.http.pg.test.js` :

1. JWT stale `ALL_PRIVILEGES` + `roleKeys: ACCOUNTANT`. PostgreSQL : seul rôle `F6_PAY` (users.role NULL pour éviter le backfill `Comptable` → ACCOUNTANT). Grant payments CRUD → POST `/payments` 201. `GET /api/auth/effective-permissions` : `roleKeys=["F6_PAY"]` + `Paiements:CREATE`.
2. Revoke le grant (flags CRUD false), **même JWT** → permissions live sans `Paiements:CREATE` → POST 403 `PERMISSION_DENIED`, compteur `payments` inchangé.
3. Ré-grant, **même JWT** → 201 immédiat, sans reconnexion.

## 5. Preuves zéro rôle

Utilisateur sans aucune ligne `user_roles` active (`users.role` NULL : le boot ne backfill pas `SCHOOL_ADMIN`). JWT `Admin School` + `ALL_PRIVILEGES` + `Paiements:UPDATE`. GET et POST `/payments` → 403. Aucun fallback JWT.

Rôle nominal `NAMED_ONLY` (libellé JWT Admin School) sans grant Finance → POST paiement et POST grille 403.

## 6. Preuves cross-tenant

Utilisateur lié aux deux établissements : `TEACHER` sur SCH-A, `ACCOUNTANT` sur SCH-B. JWT stale Comptable/`ACCOUNTANT`.

- Session SCH-A : lecture et mutation Finance 403 (`PERMISSION_DENIED`) — aucun droit B.
- Session SCH-B : lecture 200, mutation 201.

## 7. Tests exécutés

- `backend/lib/financeLiveRbac.test.js` — libellé de rôle ≠ capacité
- `backend/lib/liveRbacPrincipalAuthority.test.js` — tenant scope, zéro rôle, legacy fail-closed, isolation hors Finance
- `backend/lib/financeLiveRbac.http.pg.test.js` — scénarios 1–7 HTTP PostgreSQL stale-JWT
- `verify:finance-rbac` (source guards + unit + HTTP) → `GO — HTTP PostgreSQL stale-JWT inclus`
- `verify:finance-management` — non-régression F4 (route keys explicites)
- `verify:mobile-sync-l1-students` — TEACHER révoqué live → **200 `items: []`** (contrat RC2/L1, pas 403)
- Overlay identité `teachers.id` → `users.id` via `resolveCanonicalUserIdForSchool` **avant** le lookup Finance (identité, pas fallback de permissions JWT).

Scénario 7 : grant `Paiements:READ` live → `payment-student-options` 200 ; sans `Élèves:READ` → `GET /students` 403.

## 8. Gates

- `npm run verify:finance-rbac`
- `.github/workflows/finance-f6.yml` (service PostgreSQL 16 + `DATABASE_URL`)
- PR Gates étape Finance
- CI nightly

Le message `UNIT GO — HTTP PostgreSQL stale-JWT reste requis` a disparu.

## 9. Diffstat

`origin/develop...HEAD` (lot F6 complet) :

```text
16 files changed, 1360 insertions(+), 43 deletions(-)
```

Fichiers : workflows F6/PR Gates/nightly, `liveRbacPrincipalAuthority`, matrice `financeRbacRouteMatrix.js`, HTTP `financeLiveRbac.http.pg.test.js`, `rbacService` route keys, `server.js` `requirePermission`, gate `verify-finance-rbac`, audit.

## 10. Base SHA

`develop@cc580307a17b171fbdd9b5fd19e99044d6b04595`

## 11. HEAD SHA

Implémentation P1-A–D : `9f209cfff6036b0a180d4635b66e7b7b88e8497b`  
Isolation F6 / restauration contrat L1 : voir HEAD de branche après push.

## 12. Ahead / behind

`origin/develop...HEAD` : **0 behind**. Ahead = commits F6 sur `cto/finance-f6-live-rbac` (voir compte rendu PR).

## Web ↔ Mobile

Aucun whitelist locale `Admin School => true` / `Comptable => true` sur QuickPayment ou PaymentMutationControls. L'UI masque via permissions live ; le backend reste l'autorité.

## Non-régression F1–F5

Aucun changement du référentiel des types de frais, du lifecycle d'obligation, de `payment_allocations`, de `obligationId`, de Non imputé, des soldes, de l'annulation, de la convergence Web↔Mobile, ni de l'interdiction offline write.

## F7

Non ouvert.
