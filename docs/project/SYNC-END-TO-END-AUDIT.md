# P0 SYNC-END-TO-END — Audit et périmètre

> Branche : `cursor/sync-end-to-end-2c2f`  
> Complète PR #182 (cache Web) par la convergence **mutation → PostgreSQL → GET API**.

## Problème identifié post-#182

La PR #182 corrige le merge React, mais plusieurs **GET backend** lisaient encore `getAuthoritativeBackOfficeState()` (overlays hybrides) au lieu des projections PostgreSQL canoniques :

| Endpoint | Avant | Après |
|----------|-------|-------|
| `GET /api/notes` | `getAuthoritativeBackOfficeState()` | `loadCanonicalPedagogyForPrincipal()` → `listPedagogyProjection()` |
| `GET /api/presences` | idem | idem |
| `GET /api/payments` | idem | `loadCanonicalFinanceForPrincipal()` → `listFinanceProjection()` |
| `GET /api/students/:id/notes` | idem | idem |
| `GET /api/students/:id/presences` | idem | idem |
| `GET /api/students/:id/payments` | idem | idem |
| `POST /api/notes` (validation) | `getAuthoritativeBackOfficeState()` | `loadCanonicalPedagogyForPrincipal()` |
| `POST /api/presences` (validation) | idem | idem |

## Suite contractuelle

```bash
DATABASE_URL=postgresql://... npm run verify:sync-end-to-end
```

Pour chaque domaine critique, la suite vérifie :

1. `POST`/`PATCH`/`DELETE` API
2. Ligne présente/absente en **PostgreSQL**
3. `GET` API contient / n’contient plus la donnée
4. **Deuxième GET** (reload) identique au premier

Domaines couverts : **Users, Teachers, Students, Classes, Notes, Presences, Finance (payments), Notifications**.

## Hors scope (P1 / PR2)

| Écart | Action |
|-------|--------|
| `getAuthoritativeBackOfficeState()` sur routes legacy (courses, bulletins PDF, etc.) | P1 — documenter endpoint par endpoint |
| IDs temporaires Web (`usr-*`, `ntf-*`, `EVAL-*`) | P1 — migrer vers UUID serveur |
| Mobile optimistic (`AdminDataContext`, `platformNotificationSync`) | PR2 Mobile |
| `GET /api/courses` encore hybride | P1 |

## Gouvernance

PR **Draft** — pas merge sans diff CTO indépendant vert CI/Security.
