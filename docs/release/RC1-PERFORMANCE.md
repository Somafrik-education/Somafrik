# RC1 — Rapport performance — 2026-09-20

**Outil :** harness Node `scripts/rc1/run-rc1-performance.js` (`npm run verify:rc1-performance`).  
**Baseline :** `develop@109fa474`

## Garde-fous

- Refuse `somafrik.app` et `api.somafrik.app`.
- Cible défaut : `http://127.0.0.1:5000/api` (isolé).
- Evidence : [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json)
- Aucune charge production.

## Mesure de cette VM

Backend **mémoire éphémère** (`http://127.0.0.1:5000/api`). `productionLoad=false`.  
`DATABASE_URL` doit être **absent** pour ce harness (sinon le process mémoire timeout 20 s).

| Endpoint | Profil | p50 | p95 | p99 | errorRate |
|----------|--------|-----|-----|-----|-----------|
| health | nominale | 1 ms | 3 ms | 4 ms | 0 |
| login (401 attendu) | nominale | 2 ms | 15 ms | 21 ms | 0 |

Seuils #719 respectés **sur ce backend mémoire**. **Ne pas** en déduire un PASS préprod PostgreSQL.

Lectures métier (dashboard, classes, students, teachers, présences, payments, messages, planning) **non mesurées** : elles exigent un stack PG isolé opérateur.

## CPU / mémoire / pool DB

**Non observés** (pas de métriques hôte ni de pool PG sous charge).

## Verdict perf

- Mémoire isolée : **PASS** (0 finding)
- PostgreSQL préprod : **SKIP / HOLD** — reste opérateur
