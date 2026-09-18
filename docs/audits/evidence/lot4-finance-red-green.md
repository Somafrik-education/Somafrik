# LOT 4 — preuves RED → GREEN (PARITY-015 / 016 / 080 Finance)

Base : `develop@907b80d1996113d935ac8c297ba983a18fd1f9b4`  
Branche : `cursor/lot4-finance-ae6a`  
Mandat : #704 commentaire `#5736611657`

## Décision contrat canonique

- **PARITY-015** — Mobile consulte nativement `GET /finance/fee-grids` + `GET /finance/fee-grids/:gridId`. Création / PATCH / activate / deactivate / apply restent Web-only.
- **PARITY-016** — Impayés Mobile : recherche, filtres classe/période, relance `POST /backoffice/finance/unpaid/:studentId/reminders` + Idempotency-Key, encaissement rapide via `PaymentMutationControls` / `POST /payments`.
- **PARITY-080** — `formatFinanceDate` Web + Mobile délègue à `formatDateForDisplay` → `JJ-MM-AAAA`. Fallback `"—"`.

Invariants : soldes DTO backend, pas de somme multi-devise, pas de devise implicite, paiements/relances online-only, pas d'outbox Finance.

## RED (base `907b80d1`, avant mutation produit)

`npx --yes tsx --test scripts/lot4-parity.test.ts` → **6 fail / 0 pass**

- FAIL PARITY-015 : `FeeGridsScreen.tsx` absent, aucun `listFeeGrids` / `getFeeGrid`
- FAIL PARITY-016 : `unpaidFilters.ts` absent ; `UnpaidScreen` lecture seule
- FAIL PARITY-080 : `formatFinanceDate("2026-08-19") === "19/08/2026"` Web + Mobile
- FAIL PARITY-080 live : tests Finance attendent encore `19/08/2026`
- FAIL Finance truth : `unpaidFilters.ts` absent
- FAIL gate CI : `test:lot4-parity` et job `LOT 4 parity` absents

Preuve brute : `/tmp/lot4-red.txt`

## GREEN (cette branche)

```
npm run test:lot4-parity
# scripts/lot4-parity.test.ts 7/7
# Vitest Web financeCurrency 4/4
# Mobile financeCurrency + unpaidFilters + unpaidReminders + unpaidLedger + L1 UX + L308
# backend financeLiveRbac 3/3
```

- `FeeGridsScreen` : cartes compactes, GET liste + détail, états loading / empty / 401 / 403 / error, hint Web-config, aucune mutation de grille.
- `UnpaidScreen` : recherche, classe, période, totaux filtrés par `amountDue` DTO / devise, Relancer, Encaisser (`openSignal` + `hideTrigger` + `initialStudentId`).
- `formatFinanceDate` → `formatDateForDisplay` des deux côtés.
- Job CI `LOT 4 parity` dans Required, `needs` extensible (`lot4` n'est pas figé comme dernier).

CI GitHub `0425489f` : **37/37 SUCCESS**, dont `PR Gates / LOT 4 parity` et `PR Gates / Required`.

## HOLD `#5736885148` — filtre période multi-périodes

Correction-only depuis `e011be87` :

- `GET /backoffice/finance/unpaid?period=` avant agrégation serveur ;
- options T1/T2 depuis `fees` du ledger non filtré ;
- `matricule` additif sur le DTO `unpaidService.list` ;
- dataset T1 30 000 + T2 20 000 (sans filtre 50 000 / Plusieurs périodes).

## Reliquats hors LOT 4

- PARITY-036 paiement parent
- PARITY-056 chemin legacy paiements
- configuration structurelle des grilles sur Mobile
- LOT 5 Pédagogie

STOP : Draft. Pas Ready. Pas merge. Pas LOT 5.
