# Finance L2 — matrice de parité Web ↔ Mobile

**Base :** `develop@2e1eb11f239567e537e045f07eff5cd83538385f` (#583 + #584)  
**Branche :** `cursor/finance-l2-parity-8d64`  
**Règle :** même donnée métier canonique → même valeur. Pas de copie pixel Web.

## Inventaire (audit, sans correction)

| Surface | Web | Mobile | Source canonique |
| --- | --- | --- | --- |
| Accueil KPI Impayés | absent (taux de paiement) | ledger `GET /backoffice/finance/unpaid` | unpaidService |
| Paiements liste / encaissement / reçu | `/finances/paiements` | `PaymentsScreen` + cartes dépliables | `GET/POST /payments` |
| Impayés consultation | `/finances/impayes` via `studentFees` client | `UnpaidScreen` via `GET unpaid` | **divergence** |
| Frais & tarifs | `/finances/frais` | absent | `GET /finance/fee-grids` |
| Relances Impayés | POST reminders | absent (limite L1) | unpaid reminders |
| Encaissement depuis Impayés | QuickPayment | absent (limite L1) | POST /payments |
| Oscar attendu / alloué / reste | calcul OK ; libellé Impayés Web « déjà payé » | « Montant alloué aux impayés ouverts » | obligations ouvertes |
| Totaux multidevise Impayés | somme arithmétique + 1re devise | `totalsByCurrency`, pas de somme mixte | — |
| Taux de paiement | `getPaymentRateKpi(studentFees)` | copie Mobile identique | `GET /finance/student-fees` |
| UX 360/390/430 Finance | n/a Web | livré #583 | maquette v7 |

## Lot retenu (maîtrisable)

| ID | Fonction | Web | Mobile | Donnée canonique | UX maquette | Statut visé |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-L2-01 | Impayés Web lit le ledger canonique | NOK | OK | `GET /backoffice/finance/unpaid` | n/a | RED→GREEN |
| FIN-L2-02 | Totaux Impayés sans somme CDF+USD | NOK | OK | lignes ledger par devise | n/a | RED→GREEN |
| FIN-L2-03 | Libellé Oscar allocation Impayés Web | NOK | OK | `amountPaid` des obligations ouvertes | n/a | RED→GREEN |
| FIN-L2-04 | Taux de paiement Web fail-closed multidevise | NOK | n/a | `student-fees.currency` | n/a | RED→GREEN |
| FIN-L2-05 | Taux de paiement Mobile fail-closed multidevise | n/a | NOK | idem | n/a | RED→GREEN |
| FIN-L2-06 | Impayés Web : 403/RBAC ≠ liste vide succès | NOK | OK | Impayés:READ + GET unpaid | n/a | RED→GREEN |

Régression Oscar Mobile (déjà GREEN #583) : `pariteL1FinanceUx.test.ts` — ne pas reculer vers « Montant payé ».

## Reportés volontairement

| Sujet | Pourquoi |
| --- | --- |
| L2-fee-grids (Frais & tarifs Mobile) | Lot #577 suivant, trop large pour cette PR |
| Relances Mobile | Limite L1 volontaire ; endpoint déjà là |
| Encaissement depuis Impayés Mobile | Limite L1 volontaire |
| KPI Accueil « À percevoir » (reçus pending) | Libellé distinct d’Impayés ; hors ledger |
| PSP / Mobile Money | Hors Finance consultation |
| Backend unpaidService.dashboard mixte | Client Web/Mobile déjà capables de regrouper ; **STOP** si un correctif serveur est exigé |

Aucun backend / PostgreSQL / migration / matrice RBAC serveur dans ce lot.
