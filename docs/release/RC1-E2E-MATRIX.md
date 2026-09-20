# RC1 — Matrice E2E métier — 2026-09-20

**Environnement :** agent Cloud, PostgreSQL 16 local, **sans** Docker compose E2E, **sans** comptes préprod, **sans** Playwright runtime.  
**Charge production :** interdite (non tentée).  
**Baseline :** `develop@109fa474`

Légende : `PASS` · `FAIL` · `SKIP` (prérequis absent) · `BLOCKED` (infra) · `STATIC` (preuve code seulement).

| ID | Parcours | Rôles | Résultat | Preuve |
|----|----------|-------|----------|--------|
| E2E-AUTH | login / refresh / logout / lockout | tous | **PASS** (contrat) / **SKIP** UI | `verify:auth-sessions` 28/28 ; `verify:jwt-header` PASS. UI préprod non jouée. |
| E2E-SCHOOL | création / config établissement | school_admin | **PASS** (guidé) / **SKIP** UI | `verify:school-setup-guided-green` backend 56 + web 56 + mobile 18. |
| E2E-YEAR | année scolaire / périodes | school_admin | **PASS** (tenant) | `verify:academic-year-tenant` 21/21 + HTTP PG. |
| E2E-CLASS | classes | school_admin | **PASS** (contrat setup) / **SKIP** UI | Couvert par setup guidé + LOT classes historiques. `verify:e2e-0004` non lancé. |
| E2E-ENROLL | inscription élève via classe uniquement | school_admin | **PASS** (tenant) / **SKIP** UI | `verify:enrollment-tenant` 25/25 + HTTP PG. Chaîne `0005` non lancée. |
| E2E-USERS | enseignant / affectation / PP | school_admin | **PASS** | `verify:teacher-account-creation` OK ; #732 6/6 mémoire+PG. |
| E2E-PRESENCE | Présent / Absent / Retard / Justifié | teacher | **PASS** (tenant) / **SKIP** UI | `verify:presence-tenant` 18/18 + HTTP PG. |
| E2E-GRADES | notes / évaluations | teacher | **PARTIAL** | 3/4 gardes notes-sync OK ; 4e SKIP env allocator. Chaîne `0008` non lancée. |
| E2E-BULLETIN | bulletins | school_admin | **SKIP** | `verify:report-card-s1-e2e` non relancé ici. |
| E2E-FINANCE | grilles / paiements / impayés | school_admin | **PASS** | `verify:finance-management` OK (mémoire + PG + HTTP RBAC). |
| E2E-COM | annonces / messages | school_admin | **SKIP** | `verify:communications-e2e` non relancé ici. |
| E2E-RBAC | cross-school / cross-country | A/B | **PASS** | Tenant HTTP PG : users / enrollment / planning / présence / academic-year. Deny plateforme #503 PASS. |
| E2E-PARENT | workflow parent / élève | parent_student | **SKIP** | `verify:e2e-0012` non lancé. |
| E2E-SETUP | première connexion | school_admin | **PASS** | Setup guidé GREEN + post-login Mobile 5/5. |
| E2E-DATES | dates JJ-MM-AAAA | web/mobile | **STATIC** | Contrat date historique. Non rejoué UI. |
| E2E-WEBPUSH | Web Push | school_admin | **HORS GATE** | #646 P2 accepté. |
| E2E-MOBPUSH | Mobile Push natif | teacher | **HORS GATE** | #645 CLOSED ; #737 P2 visuel. |
| E2E-MOBNAV | navigation Expo/RN | teacher | **PASS** (contrat) | #717 CLOSED. Device smoke non rejoué. |

## Critères #719 non prouvés (opérateur)

- zéro donnée fantôme sur préprod live
- cohérence Web/Mobile sur la **même** ligne PostgreSQL préprod
- screenshots / traces d’échec UI
- parcours parent/élève + bulletins + communication in-app bout-en-bout
