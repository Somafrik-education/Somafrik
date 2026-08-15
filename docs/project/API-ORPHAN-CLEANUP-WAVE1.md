# API orphan cleanup — wave 1

Baseline : `develop@37a88d36ca9606647f4fcda60855e82358791899` (après merge #202).

## Objet

Cette PR ne supprime plus de routes métier. La Wave 2 (#202) a déjà supprimé les alias legacy confirmés :

- `GET /api/users` ;
- `GET /api/schools` ;
- `GET /api/school` ;
- `GET /api/announcements`.

`GET /api/schools/:code` reste volontairement actif pour le Mobile.

## Fiabilisation du scanner API

Le scanner distingue désormais correctement :

- les segments dynamiques `${...}` normalisés en `:param` ;
- les wrappers Mobile `request(...)` / `apiRequest(...)` ;
- les clés RBAC utilisées explicitement par `requirePermission(...)`, classées `RBAC_PERMISSION_KEY` même si le libellé de permission n'est pas un handler Express exact.

Cela évite notamment de considérer à tort `POST /api/backoffice/finance/unpaid/reminders` comme orphelin alors que cette clé protège le handler `POST /api/backoffice/finance/unpaid/:studentId/reminders`.

## Fiabilisation PostgreSQL

Le manifeste `dashboardChartConfig` cible désormais la table canonique réelle `dashboard_chart_config` (singulier).

## Gouvernance

Aucune suppression automatique n'est autorisée à partir de `ORPHAN_CANDIDATE`. Une suppression future exige toujours une revue CTO du consommateur, du RBAC, des scripts/tests/ops et du remplacement canonique.
