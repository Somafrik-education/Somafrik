# Finance L2 — preuve RED P1 (devise absente)

**HEAD audité :** `ccefbcbca5f6fec7ef390e60951d7a357294a2a9`  
**Commande :** `npm run test:parite-l2-red`

## IDs ajoutés

| ID | Surface | Motif attendu (échec sur HEAD audité) |
| --- | --- | --- |
| FIN-L2-07 | Web + Mobile `getPaymentRateKpi` | `100000 CDF` + obligation à devise absente/vide → encore un taux numérique |
| FIN-L2-08 | Web `unpaidTotalsByCurrency` | `120000 CDF` + `50 USD` + créance positive sans devise → ligne inconnue omise du résumé mixte |

Aucun `assert(false)`. Aucun snapshot fabriqué.
