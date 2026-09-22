# LOT 2 — preuves RED → GREEN

Base : `develop@38ea23217810f12587ba29241baedfa8a64ce9fd`  
Branche : `cursor/lot2-scolarite-ae6a`  
IDs : PARITY-013, PARITY-014, PARITY-031, PARITY-032

## RED (base develop)

Sur `38ea2321` :

- pas de `GET/POST /api/students/:studentId/enrollments…/validate|assign-class|transfer|close`
- pas de `GET /api/parents/relations?studentId=`
- pas de `isAllClassesView` (CTA création encore possible sur « Toutes les classes »)
- pas de `test:lot2-parity` ni job CI `LOT 2 parity`

La fiche Mobile s’appuyait sur la ligne de liste. Aucun workflow Mobile de liaison responsables. Aucun contrat REST C18 canonique PostgreSQL.

## GREEN (cette branche)

Commandes locales :

```
npm run test:lot2-parity
# 5 contrats source + 6 tests machine C18 GREEN
# HTTP PG RBAC/tenant SKIP local (DATABASE_URL absent) — exécuté en CI (job LOT 2 parity + postgres:16)

node --test backend/lib/classStudentsRepository.test.js \
  backend/lib/enrollmentTenant.guard.test.js \
  backend/lib/platformPersonalDataGuard.test.js \
  backend/lib/routePermissionsCoverage.test.js
# GREEN

npm --prefix web test -- src/pages/etablissement/StudentEnrollmentC18aDemo.test.tsx \
  src/pages/etablissement/StudentEnrollmentC18bDemo.test.tsx \
  src/pages/etablissement/ParentChildRelationsPage.test.tsx
# 6 tests GREEN (Vitest mock — HTTP C18 désactivé sous VITEST)

npx tsc --noEmit (Mobile + web) GREEN
```

## RBAC / tenant (contrat HTTP PG)

`backend/lib/studentEnrollmentC18.http.pg.test.js` :

- établissement A autorisé
- tenant B → 403/404
- `X-Somafrik-School-Code` ne élargit pas le scope
- teacher : lecture scoped, mutation C18 403
- parent/student : propre élève, mutation C18 403
- `GET /api/parents/relations` sans `studentId` → 400 ; autre tenant → 403/404

Permissions live : `requirePermission` overlay `resolveEffectivePermissions`.  
C18 mutations : `Élèves:UPDATE` ; parent/student refusés même si lecture OK.

## Migration

`backend/db/migrations/20260918_enrollments_c18_additive.sql`  
Additive, idempotente, justifiée : `class_id` nullable (APPROVED sans classe) + colonnes d’audit C18.  
Pas de table parallèle. Pas de suppression physique. Alias lecture `active` → `ENROLLED`.

## Reliquats hors LOT 2

- Santé / documents / discipline / historique (nouveau stockage ou API)
- Machine C18 dans Expo (volontairement absente)
- `POST /students`, AdminCrud create, `EntityPage` Expo, `POST /backoffice/relations` Mobile
- LOT 3

CI #707 : job LOT 2 parity exécute `test:lot2-parity` + HTTP PG RBAC/tenant.

1. HTTP C18 : ne pas insérer `users.role = Élève` avec un `user_code` hors matricule canonique (trigger identité). JWT porte le rôle ; `users.role` reste NULL.
2. Upgrade PG : JOIN roster `active|enrolled` (classe-first écrit `ENROLLED`).
3. Finance / dataset : lecture `active|enrolled`.
4. HTTP C18 : relire `students.student_code` après INSERT — le trigger d’identité réécrit tout code client (`STU-A-*`). `GET /api/students/:id` accepte matricule **ou** UUID.
5. HOLD `#5735767299` : `findStudent` matche `studentCode` / UUID / matricule ; client C18 Mobile sans `nextStatus` ; responsables `error/offline` ≠ liste vide.
6. HOLD `#5735879036` : audit C18 persisté (`c18_validate|assign-class|transfer|close` → `audit_logs`) ; `effectiveDate` UI JJ-MM-AAAA → API YYYY-MM-DD (Web + Mobile, jamais inventée) ; assign ENROLLED A→B sans date = 409, avec date = 200, autre année = 409, autre tenant = 403/404 ; UPDATE inscription + Finance + audit dans `withTransaction` (rollback prouvé si Finance échoue).
7. HOLD `#5736045317` : adapter mémoire reconnaît `student_code OR UUID` (smoke `verify:class-student-enrollment` : GET code 200, GET UUID 200, autre école 403/404). Transitions C18 : `SELECT … FOR UPDATE OF e` + légalité dans la transaction + CAS `status IS NOT DISTINCT FROM` ; concurrence TRANSFER vs CLOSE = un 200 + un 409.

STOP : Draft. Pas Ready. Pas merge. Pas LOT 3.
