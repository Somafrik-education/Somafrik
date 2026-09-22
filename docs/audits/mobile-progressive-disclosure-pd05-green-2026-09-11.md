# PD-05 GREEN — Paiements élève, annulation dans la carte

**Date :** 2026-09-11  
**Lot :** Finance élève (après Lot 0 contrat)  
**Écran :** `StudentPaymentsScreen`  
**Pattern :** P-011 / DO-047

## Écart

`PaymentCancelControls` était un frère JSX du `PaymentReceiptCard` : l’action **Annuler le paiement** restait visible sans déplier.

## Correction

Même câblage que `PaymentsScreen` : `actions={<PaymentCancelControls … />}`. Aucun changement API, RBAC, ni navigation.

## Preuves

```bash
npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
npx --yes tsx Mobile/src/lib/pariteL1FinanceUx.test.ts
npm --prefix Mobile run verify:progressive-disclosure-red   # 6/6 restants, PD-05 sorti
```

PD-01, PD-02, PD-03, PD-04, PD-06, PD-07 restent ROUGES (lots suivants).
