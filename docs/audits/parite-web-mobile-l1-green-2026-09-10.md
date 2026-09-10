# L1 Impayés — GREEN métier + UX

**Mandat :** parité métier et UX simultanées. Draft. Aucun Ready. Aucun merge.  
**Base :** `develop@b0bcc27799cc43bab74c7c1f23279b8897b5a5a8`  
**Branche :** `feat/577-l1-mobile-unpaid-green`

## API réutilisée (aucun backend créé)

Web Impayés agrège le ledger d'obligations (`student_fee_obligations`) via `unpaidModule`.  
Mobile appelle l'API déjà existante `GET /api/backoffice/finance/unpaid` (`listUnpaid`), qui applique le même ledger côté serveur (`unpaidService.list`) et le scope établissement du principal.

Aucune nouvelle route. Aucune migration. Aucun changement de matrice RBAC.

## GREEN

| Lot | GREEN | RED |
| --- | ---: | ---: |
| L0 | 12/12 | 0 |
| L1 métier | 10/10 | 0 |
| L1 UX | 10/10 | 0 |

Commande : `npm run verify:parite-l1-green`

## Surface

- Écran `UnpaidScreen.tsx`, route `Unpaid` (distincte de `Payments`)
- KPI Accueil « Impayés » : ledger + `Impayés:READ` + navigation `Unpaid`
- `PaymentsScreen` : la carte de reçus pending s'appelle **En attente**, plus « Impayés »
- États : loading / empty / success / forbidden / unauthenticated / error + reprise
- Ligne : nom, classe (ou « — » si l'API ne la fournit pas), montant restant, statut canonique (ou « — »)

## Hors-périmètre (non modifié)

- Relances / encaissement depuis Impayés
- Catalogue `appliesMobile`
- Backend / Web / PostgreSQL
