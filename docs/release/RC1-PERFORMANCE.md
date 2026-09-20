# RC1 — Rapport performance — 2026-09-20

**Outil :** `scripts/rc1/run-rc1-performance.js` (`npm run verify:rc1-performance`).  
**Evidence :** [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json)

## Garde-fous

- Refuse `somafrik.app` et `api.somafrik.app`.
- Cible défaut : `http://127.0.0.1:5000/api` (isolé).
- Backend **mémoire** éphémère si aucune URL n’est fournie.
- **Aucune charge production** (non tentée).

## Profils

| Profil | Concurrence | Requêtes |
|--------|-------------|----------|
| smoke | 1 | 8 |
| nominale | 4 | 40 |
| pic court | 12 | 48 |
| endurance courte | 2 | 60 |

Endpoints : `GET /health`, `POST /login` (identifiants invalides — mesure 401).

Les lectures métier (#719 : dashboard, classes, students, teachers, présences, payments, messages, planning) **exigent PostgreSQL** et **n’ont pas** été mesurées.

## Mesure de cette VM

Backend **mémoire éphémère**. `productionLoad=false`. `status=PASS`, 0 finding.

| Endpoint | Profil | p50 | p95 | p99 | errorRate |
|----------|--------|-----|-----|-----|-----------|
| health | nominale | 1 ms | 3 ms | 4 ms | 0 |
| login (401 attendu) | nominale | (voir JSON) | < 1 s | — | 0 |

Seuils #719 respectés **sur ce backend mémoire**. **Ne pas** en déduire un PASS préprod PostgreSQL.

## Reste opérateur

- p95 lectures/écritures métier sur PostgreSQL isolé ou préprod autorisée
- CPU / mémoire / pool DB
- endurance > 60 requêtes
