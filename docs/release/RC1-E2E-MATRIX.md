# RC1 — Matrice E2E métier — 2026-09-20

**Environnement :** agent Cloud, PostgreSQL **local isolé** (`127.0.0.1:5432`, rôle test), **sans Docker**, **sans préprod**.  
**Charge production :** interdite (non tentée).  
**Evidence :** [evidence/rc1-e2e-results.json](./evidence/rc1-e2e-results.json) · [evidence/rc1-pg-results.json](./evidence/rc1-pg-results.json)

Légende : `PASS` · `FAIL` · `SKIP` · `BLOCKED` (chaîne HTTP seedée absente) · `STATIC` / `CONTRACT`.

| ID | Parcours | Rôles | Résultat | Preuve |
|----|----------|-------|----------|--------|
| E2E-AUTH | login / refresh / logout / lockout | tous | **PASS** | `verify:auth-sessions` HTTP mémoire (rotation, grâce, refuse `alg=none`). |
| E2E-SCHOOL | création / config établissement | super_admin, country_admin, school_admin | **BLOCKED** HTTP | `verify:e2e-onboarding` / `0014` exigent API seedée. Setup guidé contrat **PASS** (`schoolSetupGuided`). |
| E2E-CLASS | classes | school_admin | **CONTRACT** / HTTP **BLOCKED** | Couvert via enrollment + teachers PG. `verify:e2e-0004` non joué. |
| E2E-ENROLL | inscription élève via classe uniquement | school_admin | **PASS** PG | `verify:class-student-enrollment` (repo + HTTP PG + Web). |
| E2E-USERS | enseignant / affectation / PP | school_admin | **PASS** | `verify:e2e-0006` mémoire ; `verify:teachers-lifecycle` PG ; PP `classHeadTeachers` **PASS**. |
| E2E-INV-732 | `teacher_assignments` ↔ `school_courses.teacher_id` | school_admin | **PASS** | Mémoire + PG local : create/update/delete/refus tiers. |
| E2E-PRESENCE | Présent / Absent / Retard / Justifié | teacher | **PASS** PG roster | `verify:presences-roster` (authz + `presencesRoster.pg` + Web). UI manuelle non jouée. |
| E2E-GRADES | notes / évaluations | teacher | **CONTRACT** / HTTP **BLOCKED** | LOT 5 PASS. `verify:e2e-0008` / `0028` non joués. |
| E2E-BULLETIN | bulletins | school_admin | **CONTRACT** | `verify:report-card-lot0` 37/37. Playwright S1 **BLOCKED** (`DATABASE_URL` app seedée + Vite). |
| E2E-FINANCE | frais / paiement / impayé | school_admin | **PASS** PG | `verify:finance-management` (calc PG + HTTP RBAC). `verify:e2e-0001` / `0009` / `0011` non joués. |
| E2E-COM | annonces / messages | school_admin | **PASS** PG | `verify:communications-c2` GO PostgreSQL réel. `verify:communications-e2e` C1 HTTP non rejoué en entier. |
| E2E-RBAC | cross-school / cross-country | A/B | **PASS** contrat + deny | Isolation clients / assignments ; `verify:platform-personal-data-deny` HTTP. Dual-identity seedée **BLOCKED**. |
| E2E-PARENT | parent / élève | parent_student / student | **BLOCKED** | `verify:e2e-0012` exige API seedée. |
| E2E-SETUP | première connexion | school_admin | **PASS** contrat | Guided backend RED+regression + LOT 0 intact. Expo UI smoke non rejoué ici. |
| E2E-WEBPUSH | Web Push | — | **HORS GATE** | #646 P2 accepté. |
| E2E-MOBPUSH | Mobile Push / tap | — | **HORS GATE** | #645 CLOSED ; #737 P2 accepté. |

## Chaînes HTTP non exécutées

`npm run verify:e2e-api` → préflight Docker + bootstrap superadmin.  
Non tenté : pas de `docker compose`, pas de comptes préprod.

## Critères #719 encore non prouvés en conditions réelles

- même ligne PostgreSQL Web ↔ Mobile (UI)
- screenshots / traces d’échec UI
- zéro donnée fantôme sur un jeu seedé partagé
