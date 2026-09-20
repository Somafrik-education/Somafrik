# RC1 — Rapport de qualification — 2026-09-20

| | |
|--|--|
| Chantier | [#720](https://github.com/Somafrik-education/Somafrik/issues/720) G1 |
| Mandat | [#719](https://github.com/Somafrik-education/Somafrik/issues/719) — requalification après [#733](https://github.com/Somafrik-education/Somafrik/pull/733) |
| PR preuves | [#742](https://github.com/Somafrik-education/Somafrik/pull/742) Draft (`cursor/release-rc1-readiness-2e7b`) |
| PR G1 historique | [#722](https://github.com/Somafrik-education/Somafrik/pull/722) déjà rebasée sur la même base par un lot parallèle |
| Base obligatoire | `develop@109fa474664485e298f82db9c727cb8d2325e29a` |
| HEAD preuves | `7bc06032660c50647ea0404875454914e2d7053e` |
| Conflits de rebase | `docs/project/CHANGELOG.md`, `docs/project/TESTING.md` — résolus (G0 + RC1 conservés) |

## Verdict

**HOLD RC1 — aucun P0/P1 métier reproduit sur le develop courant.**

`GO RC1` produit (tickets P0/P1 ouverts reproduits) = **non bloqué**.  
`GO RC1` gate #719 complète (E2E HTTP→PG + charge préprod) = **non**, preuves opérateur manquantes.  
`GO PRODUCTION` = **non**. G2–G7 interdites.  
PR **Draft**. **STOP** — pas Ready, pas merge, pas Render / EAS / Firebase / production write.

## Familles

| Famille | Livrable | Statut |
|---------|----------|--------|
| E2E métier | [RC1-E2E-MATRIX.md](./RC1-E2E-MATRIX.md) + [evidence/rc1-e2e-results.json](./evidence/rc1-e2e-results.json) | **10/10 PASS** isolé ; 10 parcours HTTP→PG **BLOCKED** (pas de `docker:up:core`) |
| Fonctionnel / DB | [RC1-FUNCTIONAL.md](./RC1-FUNCTIONAL.md) + [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json) | **35/37 PASS** ; 2 FAIL stale P2/P3. LOT 0–8 PASS. PG extra PASS |
| Performance | [RC1-PERFORMANCE.md](./RC1-PERFORMANCE.md) + [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json) | harness **PASS** mémoire isolée ; charge PostgreSQL préprod **non mesurée** |
| Sécurité | [RC1-SECURITY.md](./RC1-SECURITY.md) | #503 requalifié sur le code actuel : lockdown / deny / auth / erasure / secrets **PASS** isolé |
| Tickets | [RC1-REQUALIFICATION.md](./RC1-REQUALIFICATION.md) | P0/P1 reproduits = **0** |

## Comptage sévérités (cette vague)

| Sévérité | Ouverts reproduits | IDs |
|----------|-------------------|-----|
| P0 | **0** | — |
| P1 | **0** | — |
| P2 | acceptés | RQ-646, RQ-737, RQ-499, JWT HS256 vs RS256, RBAC-ADMIN-01 stale, #730 smoke login live |
| P3 | acceptés | RQ-510, NOTES-SYNC allocator, #503 umbrella sans défaut critique reproduit |

## Preuves manquantes opérateur

- Stack Docker `verify:e2e-api` (0001–0015 / 0028) UI→PostgreSQL
- Charge nominale PostgreSQL préprod / isolée hébergée (p95 lectures métier)
- Smoke login établissement sur `preprod.somafrik.app` après redéploiement Render de `develop@109fa474` (#730 reste ouvert pour cette preuve live)
- Dual-identity HTTP cross-school / cross-country
- AAB store re-proof (#499)

## Recommandation Cursor

Ne pas Ready / merger.  
Aucun P0/P1 produit n’a été reproduit après #733.  
Le HOLD restant est **documentaire / opérateur**, pas un incident métier rouvert.  
**G2 interdite** jusqu’au diff GitHub indépendant CTO.
