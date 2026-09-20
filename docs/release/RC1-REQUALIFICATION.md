# RC1 — Requalification tickets — 2026-09-20

**Mandat :** [#719](https://github.com/Somafrik-education/Somafrik/issues/719) · requalification après merge #733  
**Baseline :** `develop@109fa474664485e298f82db9c727cb8d2325e29a`  
**Règle :** un ticket ouvert n’est pas une preuve de reproductibilité. RC1 vérifie le **code actuel**.  
**Hors gate bloquant :** #646 / #737 (dettes techniques acceptées).

| ID | Ticket | Verdict baseline | Sévérité RC1 | Preuve |
|----|--------|------------------|--------------|--------|
| RQ-733 | PR #733 / #732 assignment ↔ school_course | **CLOSED / PASS** | — | Merge `109fa474`. `teacherAssignmentsRepository.test.js` **6/6** (mémoire + PG local) : NULL→teacher, replace, detach, refus tiers. `subjectsAssignments.pg.test.js` OK. |
| RQ-717 | PR #717 HelpHost startup | **CLOSED / PASS** | — | Déjà sur develop (`e457934f`). Non rouvert. |
| RQ-645 | #645 Mobile Push préprod | **CLOSED** (GitHub) | — | Hors reouverture. Pas de régression métier Push constatée dans cette vague. |
| RQ-646 | #646 Web Push navigateur | **STILL_OPEN** | **P2** accepté / hors gate | Feature absente (contrat LOT 6). Pas une régression métier rejouée. |
| RQ-737 | #737 tap notification flash | **STILL_OPEN** | **P2** accepté / hors gate | Dette visuelle Mobile Push. Pas de crash / pas de workflow métier bloqué ici. |
| RQ-499 | #499 storage Android AAB | **FIXED_ON_BASELINE** (source) / **NEEDS_RUNTIME** (AAB) | **P2** | `verify:android-release-readiness` PASS (config). Manifeste AAB EAS non réinspecté. |
| RQ-503 | #503 RGPD / AAB | **FIXED_ON_BASELINE** (code) / **NEEDS_OPERATOR** (live/AAB) | **P2** process | `verify:platform-personal-data-deny` PASS ; `verify:supabase-data-api-lockdown` PASS (PG local, 0 grant résiduel) ; `verify:preprod-503-local` PASS (auth/refresh ; erasure/reuse non destructif SKIP). Live préprod + AAB store **non rejoués**. |
| RQ-510 | #510 dette Expo / RN | **STILL_OPEN** | **P3** | Mobile `npm audit` : 20 vulns (16 high / 4 moderate). Pas d’exploit runtime prouvé. |

## Conséquence gate RC1

- P0 reproduits **= 0**.
- P1 reproduits **= 0**.
- HOLD = preuves HTTP UI→PG + perf PG + live/AAB **manquantes**, pas un ticket métier rouvert.

**RC1 ne peut pas être PASS** tant que les parcours HTTP seedés et la perf PG ne sont pas joués (opérateur / CI isolée).
