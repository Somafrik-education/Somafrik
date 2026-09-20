# RC1 — Requalification tickets — 2026-09-20

**Mandat :** [#719](https://github.com/Somafrik-education/Somafrik/issues/719) après merge #733  
**Baseline :** `develop@109fa474664485e298f82db9c727cb8d2325e29a`  
**Règle :** un ticket ouvert n’est pas une preuve de reproductibilité. RC1 vérifie le **code actuel**.  
**Dettes hors gate :** #646 / #737.

| ID | Ticket | Verdict baseline | Sévérité RC1 | Preuve |
|----|--------|------------------|--------------|--------|
| RQ-733 | #732 / PR #733 affectation → `school_courses.teacher_id` | **CLOSED / PASS** | — | Merged `109fa474`. Tests 6/6 mémoire+PG ; inventaire 11/11 ; `subjectsAssignments.pg` / `teachersRepository.pg` OK. |
| RQ-717 | HelpHost startup | **CLOSED / PASS** | — | Déjà sur develop. |
| RQ-645 | #645 Mobile Push préprod | **CLOSED** | — | Issue CLOSED. Hors reouverture. |
| RQ-734 | #734 channelId self-test | **CLOSED** | — | Issue CLOSED. |
| RQ-735 | #735 boot `CANONICAL_SCHOOL_COURSE_AMBIGUOUS` | **CLOSED** | — | Issue CLOSED. Correctif write-path = #733. |
| RQ-646 | #646 Web Push navigateur | **STILL_OPEN** | **P2 hors gate** | Feature absente. Mandat : ne pas rouvrir en P1. |
| RQ-737 | #737 tap Push flash | **STILL_OPEN** | **P2 hors gate** | Dette visuelle Mobile Push. |
| RQ-499 | #499 storage AAB | **FIXED_ON_BASELINE** (source) / **NEEDS_RUNTIME** (AAB) | **P2** | Différé G4 Store. Manifeste AAB EAS non réinspecté ici. |
| RQ-503 | #503 RGPD / AAB | **CODE PASS** / live AAB **SKIP** | **P2 process** | Deny plateforme 9/9 ; erasure 12/12 ; lockdown statique 3/3. Aucun cross-tenant / élévation reproduite. Preuve dashboard Supabase + AAB store = opérateur. |
| RQ-510 | #510 dette Expo / RN | **STILL_OPEN** | **P3** | Audit Mobile : 20 vulns (16 high / 4 moderate). Pas d’exploit runtime prouvé. |
| RQ-648 | #648 Draft Web Push | **FROZEN** | — | Draft gelée. Hors G1. |

## Conséquence gate RC1

- P0 reproduits = **0**
- P1 reproduits = **0**
- E2E UI→PG préprod = **non prouvé**
- Perf PG préprod = **non prouvée**

**RC1 ne peut pas être PASS** (preuves opérateur manquantes), **sans créer un nouveau bug métier**.
