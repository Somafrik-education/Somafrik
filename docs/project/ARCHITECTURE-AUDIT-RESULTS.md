# Architecture Audit — résultats exécutés

Baseline : `develop@8efac7ba9179bf50eaf8e17ad26e4d98f835af90`
Workflow : `Architecture Audit` run #1 (`31898100416`)

## Résumé API

| Classification | Nombre |
|---|---:|
| ACTIVE | 101 |
| ACTIVE_NO_RBAC_KEY | 37 |
| SERVER_RBAC_NO_CLIENT | 34 |
| ORPHAN | 28 |
| CLIENT_ONLY | 5 |
| RBAC_ONLY | 1 |

Ces classifications sont des signaux d'audit, pas des décisions automatiques de suppression.

### Faux positifs confirmés à corriger dans le scanner

Les 5 `CLIENT_ONLY` proviennent majoritairement des query strings / template strings (`?countryCode=...`, `${query}`, `${schoolCode}`) qui étaient comparées comme si elles faisaient partie du path Express. Le lot `architecture-audit-accuracy` corrige cette normalisation.

### Route RBAC_ONLY certaine

`POST /api/backoffice/finance/unpaid/reminders` existe dans `routePermissions`, mais le scanner ne détecte ni handler Express ni consommateur Web/Mobile. Cette entrée est candidate à suppression après vérification tests/ops/intégrations.

### Alias / routes legacy prioritaires à revoir

- `GET /api/users` : handler + RBAC mais aucun consommateur Web/Mobile détecté ; la famille canonique active est `/api/backoffice/users`.
- `GET /api/schools`, `GET /api/schools/:id`, `GET /api/school` : aucun consommateur Web/Mobile détecté ; la famille établissement canonique est `/api/backoffice/establishments`.
- `GET /api/announcements` : aucun consommateur détecté ; `/api/backoffice/announcements` est actif.
- `POST /api/login`, `POST /api/identify` : candidats legacy à confronter aux parcours auth actuels avant suppression.
- `GET|PUT /api/backoffice/state` : stubs legacy volontairement neutralisés ; ne pas les confondre avec une API métier active.

### Routes à ne pas supprimer sur absence de client UI

`/health`, endpoints debug/E2E/ops/export, refresh auth et intégrations peuvent être volontairement sans consommateur Web/Mobile. Une revue d'usage est obligatoire.

## Résumé fonctionnalités → PostgreSQL

| Verdict | Nombre |
|---|---:|
| CANONICAL_CANDIDATE | 19 |
| NO_SCHEMA_EVIDENCE | 7 |
| NO_API_NO_TABLE | 1 |

Le premier run ne lisait que `backend/db/schema.sql`. Plusieurs tables canoniques sont créées par migrations SQL ; ces verdicts sont donc provisoires. Le lot `architecture-audit-accuracy` élargit la preuve à tous les `.sql` de `backend/db` et `backend/migrations`.

Les domaines signalés provisoirement sont : `rolePermissions`, `dashboardChartConfig`, `contacts`, `relations`, `messages`, `courses`, `courseSchedules`, `academicConfigs`.

## Règle CTO pour les lots correctifs

Une suppression de route ou de permission exige simultanément : absence de consommateur Web, absence Mobile, absence tests/ops/intégration, remplacement canonique identifié, CI/Security verts et diff GitHub indépendant avant merge.
