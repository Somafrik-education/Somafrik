# RC1 — Matrice E2E métier — 2026-09-20

**Environnement :** agent Cloud, PostgreSQL 16 local isolé, **sans Docker Compose**, **sans write préprod**.  
**Charge production :** interdite (non tentée).  
**Evidence :** [evidence/rc1-e2e-results.json](./evidence/rc1-e2e-results.json)

Légende : `PASS` · `FAIL` · `SKIP` · `BLOCKED` (stack HTTP Docker/PG) · `STATIC`.

| ID | Parcours | Rôles | Résultat | Preuve |
|----|----------|-------|----------|--------|
| E2E-AUTH | login / refresh / logout | tous | **PASS** | `verify:auth-sessions` — 28 tests JWT/refresh/révocation |
| E2E-SCHOOL | création / config établissement | super_admin, country_admin, school_admin | **BLOCKED** | `verify:e2e-0014` exige backend Docker + seed |
| E2E-YEAR | année scolaire / périodes | school_admin | **BLOCKED** | gate tenant Academic Year = CI (#742 `academic-year-tenant` PASS) |
| E2E-CLASS | classes | school_admin | **BLOCKED** HTTP ; **PASS** contrat PG | `classesRepository.pg.test.js` OK ; `verify:e2e-0004` non joué |
| E2E-ENROLL | inscription élève via classe uniquement | school_admin | **BLOCKED** HTTP ; **PASS** contrat PG | `classStudentsRepository.pg.test.js` OK ; `verify:e2e-0005` non joué |
| E2E-USERS | enseignant + affectation | school_admin, teacher | **PASS** | `verify:e2e-0006` — 14/14 mémoire |
| E2E-ASSIGN-732 | `teacher_assignments ↔ school_courses.teacher_id` | school_admin | **PASS** | 6/6 dont PG create/update/delete + refus tiers |
| E2E-HEAD-TEACHER | professeur principal | school_admin | **PASS** | `classHeadTeachers.rbac` + management — 9/9 |
| E2E-PRESENCE | Présent / Absent / Retard / Justifié | teacher | **BLOCKED** | `verify:e2e-0013` HTTP ; CI `presence-tenant` PASS |
| E2E-GRADES | notes / évaluations | teacher | **BLOCKED** | `verify:e2e-0008` / `0028` HTTP |
| E2E-BULLETIN | bulletins | school_admin | **BLOCKED** | `verify:report-card-s1-e2e` exige stack PG applicatif |
| E2E-FINANCE | frais / paiement / impayé | school_admin | **BLOCKED** HTTP ; **PASS** contrat PG | `financeRepository.pg.test.js` OK |
| E2E-COM | communication in-app | school_admin | **PASS** contrat | `verify:communications-e2e` + `clientsSecurity.test.js` |
| E2E-RBAC | plateforme interdite + isolation | A/B | **PASS** contrat | `verify:platform-personal-data-deny` ; dual-identity HTTP **BLOCKED** |
| E2E-PARENT | workflow parent / élève | parent_student | **BLOCKED** | `verify:e2e-0012` |
| E2E-SETUP | première connexion guidée | school_admin | **PASS** | setup guidé backend 26/26 |
| E2E-DATES | dates JJ-MM-AAAA | web/mobile | **PASS** | audit 0 violation ; Web + Mobile contract |
| E2E-WEBPUSH | Web Push | — | **hors gate** | #646 P2 accepté — pas rouvert |
| E2E-MOBPUSH | tap Push | — | **hors gate** | #737 P2 accepté — pas rouvert |
| E2E-MOBNAV | navigation Expo/RN | teacher | **STATIC** | #717 CLOSED ; smoke appareil non rejoué |

## Critères #719

| Critère | Résultat |
|---------|----------|
| zéro donnée fantôme (HTTP live) | **non prouvé** (stack Docker absente) |
| zéro écriture legacy | **PASS** contrats `legacyPedagogyStaffStateWrite` + `legacyStudentsStateWrite` |
| zéro contournement RBAC (contrat) | **PASS** S1.4 + deny plateforme |
| cohérence Web/Mobile même ligne PG | **non prouvé** (pas de recette UI partagée) |
