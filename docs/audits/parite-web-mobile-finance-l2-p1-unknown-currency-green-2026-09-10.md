# Finance L2 — preuve GREEN P1 (devise absente)

**HEAD audité :** `ccefbcbca5f6fec7ef390e60951d7a357294a2a9`  
**SHA RED :** `493e364f6dac11f18f8932e32dd9cfe0870ea705`  
**Commande :** `npm run test:parite-l2-red`

## Résultat

- Web : 7 vert / 0 rouge / 7 cas (FIN-L2-01…04, 06, 07, 08)
- Mobile : 3 vert / 0 rouge / 3 cas (FIN-L2-05, 07, 03-M)

## Production

| Fichier | Raison |
| --- | --- |
| `web/src/lib/paymentRateKpi.ts` | `currency` vide compte comme devise distincte → fail-closed |
| `Mobile/src/lib/paymentRateKpi.ts` | même contrat |
| `web/src/lib/unpaidModule.ts` | groupe `Devise non renseignée` ; jamais omise ; pas de total unique mixte |
| `web/src/pages/finances/FinanceUnpaidPage.tsx` | affiche le groupe inconnu avec le montant |

Aucun backend. Oscar inchangé.
