# RC1 — Rapport performance — 2026-09-20

**Outil :** harness Node `scripts/rc1/run-rc1-performance.js` (`npm run verify:rc1-performance`).  
Aucun k6 / artillery canonique dans le dépôt.  
**Evidence :** [evidence/rc1-performance-results.json](./evidence/rc1-performance-results.json)

## Garde-fous

- Refuse `somafrik.app` et `api.somafrik.app`.
- Backend **mémoire éphémère** (`http://127.0.0.1:5000/api`) ; `DATABASE_URL` vidé pour éviter un boot PG vide.
- `productionLoad=false`. Aucune charge préprod.

## Mesure (cette VM)

| Endpoint | Profil | p50 | p95 | p99 | errorRate |
|----------|--------|-----|-----|-----|-----------|
| health | nominale | 2 ms | 3 ms | 4 ms | 0 |
| login (401 attendu) | nominale | 2 ms | 15 ms | 17 ms | 0 |
| health | pic court | 3 ms | 6 ms | 7 ms | 0 |
| login | pic court | 5 ms | 11 ms | 12 ms | 0 |

Seuils #719 (erreurs < 1 %, p95 lecture ≤ 1 s, p95 écriture ≤ 1,5 s) **respectés sur backend mémoire**.  
**Ne pas** en déduire un PASS préprod PostgreSQL.

Lectures métier (dashboard, classes, students, teachers, présences, payments, messages, planning) **non mesurées** : elles exigent un API PG seedé.

## CPU / mémoire / pool DB

Non observés sur hôte de charge.  
Sonde lecture seule préprod : `GET https://api-preprod.somafrik.app/api/health` → `database=postgresql` (aucune charge). Voir [evidence/rc1-operator-readonly.json](./evidence/rc1-operator-readonly.json).

## Preuve opérateur restante

Rejouer le harness (ou k6) contre un API **isolé/préprod autorisé** avec `DATABASE_URL` réelle, sans production.
