# Finance L2 — preuve RED

**Base :** `develop@2e1eb11f239567e537e045f07eff5cd83538385f`  
**Commande :** `npm run test:parite-l2-red`

## Résultat exact (avant implémentation)

### Web — 0 vert / 5 rouge / 5 cas

| ID | Motif |
| --- | --- |
| FIN-L2-01 | `FinanceUnpaidPage` n'appelle pas `financeApi.listUnpaid` |
| FIN-L2-02 | `buildUnpaidDashboard` n'expose pas `totalsByCurrency` et somme toutes les lignes |
| FIN-L2-03 | pas de libellé « Montant alloué aux impayés ouverts » ; copie « déjà payé » |
| FIN-L2-04 | `StudentFeeObligation` sans `currency` ; agrégat mixte possible |
| FIN-L2-06 | `listUnpaidStudentFees` + « Aucun reste à payer » (false empty) |

### Mobile — 1 vert / 1 rouge / 2 cas

| ID | Résultat | Motif |
| --- | --- | --- |
| FIN-L2-05 | ROUGE | `getPaymentRateKpi` CDF+USD → 20 % au lieu de « — » |
| FIN-L2-03-M | VERT | régression Oscar #583 conservée |

Aucun `assert(false)`. Les échecs reproduisent le code livré.
