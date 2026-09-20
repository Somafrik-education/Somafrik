# RC1 — Rapport fonctionnel — 2026-09-20

**Commandes :** `npm run verify:rc1-gates` · `npm run verify:rc1-e2e`  
**Evidence :** [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json) · [evidence/rc1-pg-results.json](./evidence/rc1-pg-results.json)

## Catalogue isolé (`verify:rc1-gates`)

**29 PASS / 2 FAIL / 31** — rejoué sur `develop@109fa474` (`node v22.14.0`).

Améliorations vs vague #717 :

- **JWT-HEADER** : **PASS** (PDF Bearer 200 ; Chrome Puppeteer présent).
- **SECRETS** : **PASS** (`gitleaks 8.24.3`, 2190 commits, 0 leak).
- **INV-732**, **E2E-ASSIGN-MEM**, **LEGACY-STAFF/STUDENTS**, **SETUP-GUIDED-BE**, **COM-C1-CLIENTS**, **HEAD-TEACHER** : **PASS**.

| ID | Exit | Classification RC1 |
|----|------|--------------------|
| RBAC-ADMIN-01 | FAIL | **P2** — script historique attend encore `teachers` writable sur PUT ; LOT 3 a retiré cette clé (PG). Script **stale**, pas une régression PUT métier. |
| NOTES-SYNC | FAIL | **P3** — 3/4 gardes J2A OK ; 4e sous-test mock `initializeRepository` → `STUDENT_CANONICAL_POSTGRES_ALLOCATOR_NOT_READY`. Harness incomplet, pas une écriture notes cassée. |

LOT 0–8, RBAC S1.4, mobile-security, android-release, personal-data-deny, auth-sessions, sanitize, branding, help-v1a, db-config, disclosure, audit:ci = **PASS**.

## PostgreSQL local isolé

`DATABASE_URL=postgresql://somafrik@127.0.0.1:5432/somafrik` (VM agent, hors production). **10/10 PASS.**

| ID | Résultat |
|----|----------|
| INV-732-PG | **PASS** — create/update/delete convergent `school_courses.teacher_id` |
| SUBJECTS-ASSIGN-PG | **PASS** |
| TEACHERS-LIFECYCLE | **PASS** |
| ENROLL-CLASS | **PASS** |
| FINANCE-MGMT | **PASS** (calc PG + HTTP RBAC) |
| PRESENCES-ROSTER | **PASS** |
| COM-C2-PG | **PASS** |
| SUPABASE-LOCKDOWN | **PASS** (0 grant résiduel) |
| PREPROD-503-LOCAL | **PASS** |
| REPORT-CARD-LOT0 | **PASS** 37/37 |

Aucune écriture legacy staff/élèves : contrats **PASS**.

## Vérifications #719

| Item | Résultat |
|------|----------|
| Suites unitaires / LOT 0–8 | PASS catalogue |
| Intégration backend PG (sous-ensemble) | **PASS** local |
| Contrats API live seedés | **BLOCKED** |
| Typecheck / lint / build | **CI HEAD `ad14b86b` GREEN** (26 PASS / 9 SKIP LOT hors scope / 0 FAIL) |
| Empty / loading / offline / error UI | **SKIP** UI |
| Permissions live après changement de rôle | **SKIP** runtime seedé |
