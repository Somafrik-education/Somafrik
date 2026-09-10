# Finance L2 — preuve GREEN

**Base RED :** `b87237b979e10bc782127e99ad9dfae6eccde67d`  
**SHA GREEN :** `70e7ad1b34eb468e1e7a76391ab25dca1a831b0d`  
**Commande :** `npm run test:parite-l2-red`

## Résultat exact (après implémentation)

### Web — 5 vert / 0 rouge / 5 cas

| ID | Motif GREEN |
| --- | --- |
| FIN-L2-01 | `FinanceUnpaidPage` appelle `financeApi.listUnpaid()` (`GET /backoffice/finance/unpaid`) |
| FIN-L2-02 | `unpaidTotalsByCurrency` / `totalsByCurrency` ; pas de `reduce` unique CDF+USD |
| FIN-L2-03 | détail Impayés : « Montant attendu », « Montant alloué aux impayés ouverts » ; plus de « déjà payé » |
| FIN-L2-04 | `StudentFeeObligation.currency` + `currencies.size > 1` → `—` |
| FIN-L2-06 | ledger GET unpaid ; 401/403/erreur ≠ EmptyState « Aucun reste à payer » |

### Mobile — 2 vert / 0 rouge / 2 cas

| ID | Motif GREEN |
| --- | --- |
| FIN-L2-05 | `getPaymentRateKpi` CDF+USD → `rate: null`, `value: "—"` |
| FIN-L2-03-M | UnpaidScreen conserve « Montant alloué aux impayés ouverts » |

## Fichiers de production

| Fichier | Raison métier |
| --- | --- |
| `web/src/pages/finances/FinanceUnpaidPage.tsx` | même ledger Impayés que Mobile ; Oscar ; 403 ≠ vide |
| `web/src/lib/unpaidModule.ts` | totaux par devise fail-closed ; normalizer payload ledger |
| `web/src/types.ts` | `UnpaidDashboardStats.totalsByCurrency` |
| `web/src/lib/paymentRateKpi.ts` | ne pas sommer CDF+USD dans le taux |
| `Mobile/src/lib/paymentRateKpi.ts` | même contrat que Web |

Aucun backend / PostgreSQL / contrat API / RBAC serveur.

Aucun changement de calcul Oscar : `amountExpected` / `amountPaid` (allocation obligations ouvertes) / `amountDue` inchangés.
