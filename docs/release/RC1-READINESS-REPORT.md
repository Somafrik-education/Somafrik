# RC1 — Rapport de qualification — 2026-09-19

| | |
|--|--|
| Chantier | [#720](https://github.com/Somafrik-education/Somafrik/issues/720) |
| Mandat | [#719](https://github.com/Somafrik-education/Somafrik/issues/719) |
| État CTO | commentaire `#5744875678` — HOLD ; G0 en contrôle ; G1 à exécuter |
| Baseline | `develop@afa01321a42df3cfe825a789fc1a948ea0bf1e4c` |
| Branche | `cursor/release-rc1-readiness-090d` |
| G0 | PR #721 Draft HEAD `75753dc` — **non modifié** par ce lot |

## Verdict

**HOLD — RC1 NON PASS.**

Causes exactes :

1. **P0 ≠ 0** — #717 HelpHost crash toujours dans le tree baseline.
2. **P0 non levé** — #645 Mobile Push : pas de preuve device / préprod.
3. **P1 ≠ 0** — #646 Web Push absent ; #503 umbrella sans re-preuve live.
4. **E2E métier UI→PG** — non exécuté (agent sans Docker / PostgreSQL / comptes préprod).
5. **Performance préprod** — non mesurée sur PostgreSQL isolé (harness ajouté ; éventuellement mémoire seulement).

`GO RC1` = **non**.  
`GO PRODUCTION` = **non**.  
G2–G7 restent interdites.

## Familles

| Famille | Livrable | Statut |
|---------|----------|--------|
| E2E métier | [RC1-E2E-MATRIX.md](./RC1-E2E-MATRIX.md) | BLOCKED / FAIL produit (#717, #646) |
| Fonctionnel | [RC1-FUNCTIONAL.md](./RC1-FUNCTIONAL.md) + [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json) | **20/24 PASS** isolé ; 4 FAIL classés P2/P3/SKIP |
| Performance | [RC1-PERFORMANCE.md](./RC1-PERFORMANCE.md) + [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json) | harness PASS mémoire ; PG non mesuré |
| Sécurité | [RC1-SECURITY.md](./RC1-SECURITY.md) | défensif + requalification |
| Tickets CTO | [RC1-REQUALIFICATION.md](./RC1-REQUALIFICATION.md) | 6/6 traités |

## Comptage sévérités (cette vague)

| Sévérité | Ouverts | IDs |
|----------|---------|-----|
| P0 | 2 | RQ-717, RQ-645 |
| P1 | 2 | RQ-646, RQ-503 |
| P2 | 2 | RQ-499 (AAB), JWT HS256 vs checklist RS256 |
| P3 | 1 | RQ-510 |

## Non testé (honnête)

- Préprod Render / Vercel live
- Smoke Web hébergé
- APK / AAB / appareil physique
- Playwright mobile runtime
- Charge nominale PostgreSQL
- Push réel FCM / Web Push
- Recette rôles super_admin → élève sur les mêmes données

## Recommandation Cursor

Rester **HOLD**.  
Ne pas Ready / merger cette PR comme « RC1 PASS ».  
Correctifs P0 (#717 au minimum, sur mandat CTO dédié) **avant** toute prétention de qualification.  
Rejouer `verify:e2e-api` + harness perf contre un stack isolé PG, puis seulement reconsidérer G2.

## STOP

Pas Ready. Pas merge. Pas production. Pas Render / EAS / Firebase write.
