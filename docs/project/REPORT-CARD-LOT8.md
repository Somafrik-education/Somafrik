# LOT 8 — Mobile Bulletins natif Expo/React Native

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 9+ interdit.**  
**Ticket :** #643. **Prérequis :** LOT 7 mergé (`develop@3ff88495e499f1e9beaad7c439e095da695d0433`).  
**Branche :** `cursor/report-card-lot8-mobile`.

Consultation Mobile native des bulletins **publiés** à partir du snapshot authentifié LOT 4, via la façade HTTP `/api/report-card/...` (LOT 7). Aucun recalcul notes / total / pourcentage / rang / décision / présence. Aucun fallback live ou legacy (`/api/report-cards`, `/students/:id/report.pdf`). PDF = consommateur LOT 5 (`payloadForRender` + `reprintUrl`, aucun mint).

## Routes HTTP minimales (lecture)

Namespace inchangé `/api/report-card/...` (pas de collision legacy `/api/report-cards`).

- `GET /api/report-card/publications` — catalogue tenant-scopé `listCurrent` (publications `ACTIVE` seulement, pas l’outbox, pas de `token_*`).
- `GET /api/report-card/publications/:reportCardId/snapshot?version=` — snapshot `ACTIVE` + `payloadForRender`, scope élève serveur, template de publication.
- `GET /api/report-card/publications/:reportCardId/pdf?version=` — PDF LOT 5 injecté (pas `createReportCardPdf` dans le module HTTP LOT 7) avec le même payload scopé et le même `RenderingTemplate`. Le QR réutilise `reprintUrl` (stratégie A, aucun mint). Si le snapshot public contient un élève hors `studentIds`, le PDF est refusé (fail-closed) : pas de QR d’une publication multi-élèves non compatible avec le scope.

`Bulletins:READ` → `REPORT_CARD_READ` + `REPORT_CARD_REPRINT` (consult/réimpression, jamais SUBMIT/APPROVE). Liste/snapshot exigent `REPORT_CARD_READ` ; PDF exige `REPORT_CARD_REPRINT`. Acteurs `student` / `parent_student` : `studentIds` serveur-autoritaire. Superadmin sans tenant école → fail-closed. Cross-tenant et version `SUPERSEDED` → 403/404.

## Mobile

- Client : `Mobile/src/lib/reportCardPublicationApi.ts`
- Rendu natif générique : snapshot / template, champs exposés uniquement
- Écran Bulletins : liste + détail snapshot, PDF via `FileSystem.downloadAsync` + Bearer
- États : loading / empty / forbidden / not-found / server-error
- Pas de workflow Superadmin, pas de `/verify`, pas d’historique LOT 9, pas de pack pays LOT 10

## Interdit

Moteur LOT 3, mutation snapshot/token LOT 4, contrat PDF LOT 5 hors glue rétrocompatible, Superadmin Mobile, `/verify`, LOT 9+, Finance / Scolarité / Présences / Users / Auth / Notifications / Planning, branche `country/school`, fallback live.

Gate : `npm run verify:report-card-lot8`.
