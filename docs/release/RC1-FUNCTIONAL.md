# RC1 — Rapport fonctionnel — 2026-09-20

**Commande :** `npm run verify:rc1-gates`  
**Evidence :** [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json) · [evidence/rc1-pg-extra-results.json](./evidence/rc1-pg-extra-results.json)  
**Baseline exécutée :** `172b2b3a` puis HEAD de ce rapport  
**Environnement :** Node v22.14.0 · PostgreSQL 16 local · `DATABASE_URL` isolée · gitleaks 8.24.3

## Catalogue

37 gates (lots 0–8, sécurité, #732, setup, erasure, architecture, dates, COM-C1).

**35 PASS / 2 FAIL.**

### PASS notables

- LOT 0–8
- INV-732 (`teacherAssignmentsRepository` mémoire + PG)
- E2E-0006 mémoire
- HEAD-TEACHER
- SETUP-GUIDED-BE
- DATE-CONTRACT (0 violation JJ-MM-AAAA)
- ARCHITECTURE (legacy aliases + orphan scanner)
- PERSONAL-DATA-DENY, AUTH-SESSIONS, SANITIZE, SECRETS, AUDIT-CI
- PRIVACY-ERASURE, PREPROD-503-LOCAL, DATA-API-LOCKDOWN
- JWT-HEADER (PASS — Puppeteer/PDF désormais disponible)
- COM-C1 + clients security
- Legacy staff / students write guards

### FAIL classés (pas P0/P1)

| ID | Exit | Classification |
|----|------|----------------|
| RBAC-ADMIN-01 | FAIL | **P2 stale** — le script exige encore `teachers` dans `ADMIN_SCHOOL_WRITABLE_ENTITIES`. LOT 3 a retiré cette clé state (écritures enseignants = API dédiée). Pas une régression PUT métier. |
| NOTES-SYNC | FAIL | **P3 stale** — 3/4 tombstones legacy OK. `initializeRepository()` lève `STUDENT_CANONICAL_POSTGRES_ALLOCATOR_NOT_READY` : fail-closed actuel, pas une écriture notes cassée. |

## PostgreSQL isolé (extra)

Tous **PASS** :

- `teacherAssignmentsRepository` PG convergence #732
- `subjectsAssignments.pg.test.js`
- `classStudentsRepository.pg.test.js`
- `financeRepository.pg.test.js`
- `teachersRepository.pg.test.js`
- `classesRepository.pg.test.js`
- `supabaseDataApiLockdown.pg.test.js` (`residualGrants=0`)

## CI candidate (#733 mergé + #742)

- #733 : Core / Quality / Risk-targeted / LOT 3 / Secrets / architecture **SUCCESS**
- #742 : workflows tenant (academic-year, enrollment, users, presence, planning, sync-l1, d-revalidation) **PASS** au moment de la rédaction ; Core/Quality encore en cours sur le HEAD preuves — relire le rollup terminal.

## Hors catalogue volontaire

`verify:e2e-api` HTTP Docker. Typecheck/lint/build complets = CI PR Gates, pas ce runner.
