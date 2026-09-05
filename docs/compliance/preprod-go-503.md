# Preuves préprod #503 — 5 septembre 2026

**Candidat Draft #505** (branche `cursor/p1-refresh-cas-erasure-logout-c225`).  
**CTO :** GO technique sur les 4 correctifs ; **NO GO merge** tant que le mandat préprod n’est pas complété.  
**Cursor :** DEV uniquement. Pas de write production. Pas de dashboard Render.

## Script de preuve

`backend/scripts/verify-preprod-503.js` — non destructif par défaut (pas d’effacement, pas de replay hors grâce). Voir [preprod-503-live.md](./preprod-503-live.md).

## Constat live (lecture seule, 5 sept. 2026 ~12:38 UTC)

| Sonde | Résultat | Lecture |
|---|---|---|
| `GET https://somafrik-api-preprod.onrender.com/api/health` | 200 `status=ok` `database=postgresql` | API préprod up, PG |
| `POST /api/privacy/erasure-requests` | **400** `PRIVACY_REQUEST_INVALID` | workflow P1 **présent** |
| `POST /api/auth/revoke-all` | **401** | route P1 **présente** |
| `GET /api/students` / `/api/audit` sans JWT | **401** | auth |
| Bundle `LegalPages-D7LM86qb.js` | Oregon + Baudouin Okito | pages légales P1 **déployées** |
| SHA Render vs candidat | non exposé par `/api/health` | dashboard ops |

Les 403 Superadmin / Admin Pays, le parcours Admin School, le reuse refresh et l’effacement recette **ne sont pas** collectés ici (pas de credentials préprod dans git).

## Interdit à ce stade

Ready GitHub · merge `develop` · promotion `main` · write production · AAB · `purge-retention` prod · inventer une région AWS.
