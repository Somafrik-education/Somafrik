# RC1 — Requalification tickets — 2026-09-20

**Mandat :** [#719](https://github.com/Somafrik-education/Somafrik/issues/719) commentaire CTO après #733  
**Base :** `develop@109fa474664485e298f82db9c727cb8d2325e29a`  
**Règle :** ne conserver en HOLD que les P0/P1 **reproduits** sur ce develop. #646 / #737 hors gate bloquant.

| ID | Ticket | Verdict code actuel | Sévérité RC1 | Preuve |
|----|--------|---------------------|--------------|--------|
| RQ-733 | #732 / PR #733 assignment ↔ school_course | **CLOSED / PASS** | — | Merge `109fa474`. Tests mémoire + PG create/update/delete + refus tiers. |
| RQ-717 | HelpHost | **CLOSED** | — | déjà sur develop (e457934f) |
| RQ-645 | Mobile Push préprod | **CLOSED** 2026-09-20 | — | hors rejeu device |
| RQ-730 | DNS API préprod | code **FIXED** (#731) | **P2 opérateur** | `GET /api/health` préprod OK (`database=postgresql`). Issue ouverte pour smoke **login** après redeploy. Pas un défaut code reproduit. |
| RQ-646 | Web Push | **STILL_OPEN** | **P2 accepté** | hors gate bloquant |
| RQ-737 | Mobile tap Push flash | **STILL_OPEN** | **P2 accepté** | hors gate bloquant |
| RQ-503 | RGPD / AAB umbrella | **STILL_OPEN** process | **P3 umbrella** | lockdown + deny + erasure + 503-local **PASS** sur le code actuel. Pas de P0/P1 sécurité critique reproduit. |
| RQ-499 | storage AAB | source **FIXED** | **P2** | gates readiness PASS ; AAB store non réinspecté |
| RQ-510 | Expo / RN audit | **STILL_OPEN** | **P3** | 20 vulns npm Mobile |

## Conséquence gate RC1

- P0 reproduits = **0**
- P1 reproduits = **0**
- E2E HTTP UI→PG critique = **non exécuté** (preuve manquante, pas un FAIL métier)
- Sécurité critique isolée = **PASS**
- Performance préprod PG = **non mesurée** (harness mémoire PASS)

**RC1 ne peut pas être déclaré PASS gate #719 complète** tant que l’opérateur n’a pas rejoué `verify:e2e-api` + charge PG.  
**RC1 n’est plus HOLD pour un P0/P1 produit ouvert reproduit.**
