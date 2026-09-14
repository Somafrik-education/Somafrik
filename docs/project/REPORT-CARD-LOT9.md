# LOT 9 — Historique, corrections et versions des bulletins publiés

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 10 interdit.**  
**Ticket :** #649. **Prérequis :** LOT 8 mergé (`develop@77e10ca2b5af754ee7e456dd1b528d5c3d50930c`).  
**Branche :** `cursor/report-card-lot9-history-ce91`.

Un bulletin publié n’est jamais modifié ni re-signé. Toute correction produit une **nouvelle version immuable**. Les anciennes versions restent vérifiables (`SUPERSEDED` / `REVOKED`).

## Routes HTTP

- `GET /api/report-card/publications/:reportCardId/history` — historique tenant/scope élève (`REPORT_CARD_READ`)
- `GET /api/report-card/publications/:reportCardId/versions/:version` — snapshot authentifié d’une version historique
- `POST /api/report-card/publications/:reportCardId/corrections` — correction serveur (`REPORT_CARD_CORRECT`, motif, idempotence)
- `POST /api/report-card/publications/:reportCardId/versions/:version/revoke` — révocation (`REPORT_CARD_REVOKE`, motif)
- PDF historique : `GET .../pdf?version=` réutilise le QR/capability **de cette version** (stratégie A, aucun mint)

`getFacts` lit uniquement les notes/évaluations PostgreSQL canoniques. Le snapshot source fournit l’identité/provenance, jamais un score de repli. Absence de match, note dépubliée/supprimée ou erreur de schéma → correction refusée, pas de v+1. Plusieurs évaluations d’une même composante sont agrégées via `weightedAverage()` (barème + coefficient), pas « latest wins ». `revoke` n’accepte que `ACTIVE` (idempotent si déjà `REVOKED`) ; `SUPERSEDED` → 409.

`Bulletins:SUSPEND` → `REPORT_CARD_CORRECT`. `Bulletins:DELETE` → `REPORT_CARD_REVOKE`. `listCurrent` LOT 8 reste ACTIVE-only.

## Interdit

LOT 10 / packs pays, re-signature, mint de token dans HTTP, mutation notes/présences, correction client, suppression physique d’historique, branche `country/school`.

Gate : `npm run verify:report-card-lot9`.
