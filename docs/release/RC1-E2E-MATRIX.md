# RC1 — Matrice E2E métier — 2026-09-19

**Environnement d’exécution :** agent Cloud **sans Docker**, **sans PostgreSQL**, **sans préprod authentifiée**.  
**Charge production :** interdite (non tentée).

Légende : `PASS` · `FAIL` · `SKIP` (prérequis absent) · `BLOCKED` (infra) · `STATIC` (preuve code seulement).

| ID | Parcours | Rôles | Résultat | Preuve |
|----|----------|-------|----------|--------|
| E2E-AUTH | login / refresh / logout / lockout | tous | **SKIP** | Suites `verify:auth-sessions` / `verify:jwt-header` = contrat local si deps OK ; parcours UI préprod non joué. |
| E2E-SCHOOL | création / config établissement | super_admin, country_admin, school_admin | **BLOCKED** | `verify:e2e-0014` / `0004` exigent backend Docker + PG. |
| E2E-YEAR | année scolaire / périodes / pédagogie | school_admin | **BLOCKED** | Gates tenant Academic Year existent (`verify:academic-year-tenant`) mais PG requis. |
| E2E-CLASS | classes | school_admin | **BLOCKED** | `verify:e2e-0004`. |
| E2E-ENROLL | inscription élève via classe uniquement | school_admin | **BLOCKED** | `verify:e2e-0005`. |
| E2E-USERS | utilisateurs / enseignant / affectations / PP | school_admin | **BLOCKED** | `verify:e2e-0003` / `0006`. |
| E2E-PRESENCE | Présent / Absent / Retard / Justifié | teacher | **BLOCKED** | Pas d’UI isolée. |
| E2E-GRADES | notes / évaluations / examens | teacher | **BLOCKED** | `verify:e2e-0008` / `0028`. |
| E2E-BULLETIN | bulletins | school_admin | **BLOCKED** | `verify:report-card-s1-e2e` exige `DATABASE_URL`. |
| E2E-FINANCE | grilles / paiements / impayés / relances | school_admin | **BLOCKED** | `verify:e2e-0001` / `0009` / `0011`. |
| E2E-COM | annonces / messages / préférences | school_admin | **BLOCKED** | `verify:communications-e2e` PG. |
| E2E-RBAC | restrictions cross-tenant | A/B | **STATIC** | Contrats tenant dans le tree (lots GP-002+). Exécution HTTP dual-identity **non rejouée** ici. |
| E2E-PARENT | workflow parent / élève | parent_student / student | **BLOCKED** | `verify:e2e-0012`. |
| E2E-SETUP | première connexion | school_admin | **BLOCKED** | Setup lot tests RED existent ; pas de recette UI. |
| E2E-DATES | dates JJ-MM-AAAA | web/mobile | **STATIC** | Contrat date + CI historique #718. Non rejoué ici. |
| E2E-WEBPUSH | Web Push préprod | school_admin | **FAIL** (produit) | Feature absente — voir RQ-646. |
| E2E-MOBPUSH | Mobile Push natif | teacher | **SKIP** | RQ-645 — device / credentials hors de cet agent. |
| E2E-MOBNAV | navigation Expo/RN | teacher | **FAIL** (produit) | RQ-717 HelpHost crash sur baseline. |

## Outils déjà versionnés (non exécutés faute d’API PG)

`npm run verify:e2e-api` → `verify:e2e-preflight` + chaînes `0001`–`0015` / `0028`.  
Prérequis documenté : `npm run docker:up:core`.

## Critères #719 non prouvés

- zéro donnée fantôme
- zéro écriture legacy en conditions réelles
- cohérence Web/Mobile sur la **même** ligne PostgreSQL
- screenshots / traces d’échec UI
