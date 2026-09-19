# RC1 — Rapport performance — 2026-09-19

**Outil inventorié :** aucun k6 / artillery / autocannon canonique dans le dépôt.  
**Ajout G1 :** harness Node `scripts/rc1/run-rc1-performance.js` (`npm run verify:rc1-performance`).

## Garde-fous

- Refuse `somafrik.app` et `api.somafrik.app`.
- Cible défaut : `http://127.0.0.1:5000/api` (isolé).
- Peut tenter un backend **mémoire** éphémère si aucune URL n’est fournie.
- Evidence : [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json)

## Profils

| Profil | Concurrence | Requêtes |
|--------|-------------|----------|
| smoke | 1 | 8 |
| nominale | 4 | 40 |
| pic court | 12 | 48 |
| endurance courte | 2 | 60 |

Endpoints smoke du harness : `GET /health`, `POST /login` (identifiants invalides — mesure 401, pas un login métier).

Les lectures métier (#719 : dashboard, classes, students, teachers, présences, payments, messages, planning) **exigent PostgreSQL** et ne sont **pas** dans ce premier harness.

## Seuils #719

- erreurs techniques < 1 % sous charge nominale
- p95 lecture ≤ 1 s
- p95 écriture ≤ 1,5 s
- pas de timeout systémique

Un backend mémoire, s’il démarre, **n’est pas** représentatif du runtime production PostgreSQL. Un PASS mémoire ne lève pas le HOLD perf préprod.

## Mesure de cette VM

Backend **mémoire éphémère** (`http://127.0.0.1:5000/api`). `productionLoad=false`.

| Endpoint | Profil | p50 | p95 | p99 | errorRate |
|----------|--------|-----|-----|-----|-----------|
| health | nominale | 2 ms | 5 ms | 6 ms | 0 |
| login (401 attendu) | nominale | 2 ms | 19 ms | 22 ms | 0 |

Seuils #719 respectés **sur ce backend mémoire**. **Ne pas** en déduire un PASS préprod PostgreSQL.

## CPU / mémoire / pool DB

**Non observés** (pas de métriques hôte ni de pool PG dans cet agent).
