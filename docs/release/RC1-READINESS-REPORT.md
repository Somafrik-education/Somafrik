# RC1 — Rapport de qualification — 2026-09-20

| | |
|--|--|
| Chantier | [#719](https://github.com/Somafrik-education/Somafrik/issues/719) via [#722](https://github.com/Somafrik-education/Somafrik/pull/722) |
| PR de requalification | [#741](https://github.com/Somafrik-education/Somafrik/pull/741) |
| Mandat | Rebase + rejeu après merge #733 |
| Baseline | `develop@109fa474664485e298f82db9c727cb8d2325e29a` |
| Branche | `cursor/rc1-requalify-722-f6b6` |

## Verdict

**HOLD — RC1 NON PASS.**

Aucun **P0/P1 métier réellement reproduit** sur ce develop. Le HOLD tient uniquement à des preuves opérateur encore absentes, pas à un nouveau bug créé pour occuper G1.

Causes exactes du HOLD :

1. **E2E métier UI → PostgreSQL préprod** — non exécuté (pas de `docker:up:core`, pas de comptes préprod, pas de Playwright runtime).
2. **Performance PostgreSQL préprod** — non mesurée. Le harness mémoire passe ; ce n’est **pas** une preuve PG.
3. **Preuves live AAB / Render / device** — non rejouées (#499 Store / #503 AAB).

`GO RC1` = **non**.  
`GO PRODUCTION` = **non**.

## P0 / P1 réellement reproduits

| Sévérité | Reproduits | IDs |
|----------|------------|-----|
| **P0** | **0** | — |
| **P1** | **0** | — |

Tickets précédemment HOLD qui **ne sont plus** des bloqueurs RC1 sur ce code :

- **#733 / #732** — mergé dans `109fa474`. Invariant `teacher_assignments ↔ school_courses.teacher_id` **PASS** mémoire + PG.
- **#717** — CLOSED / PASS (déjà sur develop).
- **#645** — CLOSED (Mobile Push préprod).
- **#734 / #735** — CLOSED.
- **#646 / #737** — dettes **P2** hors gate bloquant (mandat CTO).
- **#503** — remédiations code **PASS** sur le tree actuel (deny plateforme, erasure, lockdown statique). Absence de re-preuve live AAB = **P2 process**, pas un trou sécurité reproduit.

## Familles

| Famille | Livrable | Statut |
|---------|----------|--------|
| E2E métier | [RC1-E2E-MATRIX.md](./RC1-E2E-MATRIX.md) | Contrats + HTTP PG tenant **PASS** ; UI préprod **SKIP** |
| Fonctionnel | [RC1-FUNCTIONAL.md](./RC1-FUNCTIONAL.md) + [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json) | **21/24 PASS** isolé ; 3 FAIL classés P2/P3/SKIP |
| Extra / DB | [evidence/rc1-requalify-extra-results.json](./evidence/rc1-requalify-extra-results.json) | #732, #503, tenant, setup, finance, enseignants |
| Performance | [RC1-PERFORMANCE.md](./RC1-PERFORMANCE.md) + [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json) | harness mémoire PASS ; PG préprod non mesuré |
| Sécurité | [RC1-SECURITY.md](./RC1-SECURITY.md) | #503 requalifié contre le code actuel |
| Tickets | [RC1-REQUALIFICATION.md](./RC1-REQUALIFICATION.md) | P0/P1 reproduits = 0 |

## Comptage sévérités (cette vague)

| Sévérité | Ouverts bloquants | IDs |
|----------|-------------------|-----|
| P0 reproduits | 0 | — |
| P1 reproduits | 0 | — |
| P2 acceptés | 6 | RQ-646, RQ-737, RQ-499 (AAB/Store), RQ-503 live proof, JWT HS256 vs checklist RS256, script RBAC-ADMIN-01 stale |
| P3 | 3 | RQ-510, NOTES-SYNC env, gitleaks historique (CI Secrets GREEN) |

## Non testé (honnête)

- Préprod Render / Vercel live
- Smoke Web hébergé
- APK / AAB / appareil physique
- Playwright mobile runtime + `verify:e2e-api` complet
- Charge nominale PostgreSQL préprod
- Push réel FCM / Web Push (hors gate)
- Recette rôles super_admin → élève sur les **mêmes** lignes préprod
- Data API lockdown PG (besoin `BYPASSRLS` superuser)

## Recommandation Cursor

Rester **HOLD** faute de preuves UI/perf/AAB opérateur.  
**Aucun nouveau P0/P1 métier à ouvrir.**  
Ne pas Ready / merger cette PR comme « RC1 PASS ».  
Le prochain bloqueur métier, s’il existe, doit venir d’une reproduction opérateur — pas d’un ticket artificiel.

## STOP

Pas Ready. Pas merge. Pas production. Pas Render / EAS / Firebase write.
