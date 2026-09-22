# Finance L2 — matrice de parité Web ↔ Mobile

**Base :** `develop@2e1eb11f239567e537e045f07eff5cd83538385f` (#583 + #584)  
**Branche :** `cursor/finance-l2-parity-8d64`  
**Règle :** même donnée métier canonique → même valeur. Pas de copie pixel Web.

## Inventaire (audit, sans correction)

| Surface | Web | Mobile | Source canonique |
| --- | --- | --- | --- |
| Accueil KPI Impayés | absent (taux de paiement) | ledger `GET /backoffice/finance/unpaid` | unpaidService |
| Paiements liste / encaissement / reçu | `/finances/paiements` | `PaymentsScreen` + cartes dépliables | `GET/POST /payments` |
| Impayés consultation | `/finances/impayes` via `GET /backoffice/finance/unpaid` | `UnpaidScreen` via `GET unpaid` | unpaidService |
| Frais & tarifs | `/finances/frais` | absent | `GET /finance/fee-grids` |
| Relances Impayés | POST reminders | absent (limite L1) | unpaid reminders |
| Encaissement depuis Impayés | QuickPayment | absent (limite L1) | POST /payments |
| Oscar attendu / alloué / reste | « Montant alloué aux impayés ouverts » | « Montant alloué aux impayés ouverts » | obligations ouvertes |
| Totaux multidevise Impayés | `totalsByCurrency`, pas de somme mixte | `totalsByCurrency`, pas de somme mixte | lignes ledger par devise |
| Taux de paiement | `getPaymentRateKpi` fail-closed si devises mixtes | idem | `GET /finance/student-fees` |
| UX 360/390/430 Finance | n/a Web | livré #583 | maquette v7 |

## Lot retenu (maîtrisable)

| ID | Fonction | Web | Mobile | Donnée canonique | UX maquette | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| FIN-L2-01 | Impayés Web lit le ledger canonique | OK | OK | `GET /backoffice/finance/unpaid` | n/a | GREEN |
| FIN-L2-02 | Totaux Impayés sans somme CDF+USD | OK | OK | lignes ledger par devise | n/a | GREEN |
| FIN-L2-03 | Libellé Oscar allocation Impayés Web | OK | OK | `amountPaid` des obligations ouvertes | n/a | GREEN |
| FIN-L2-04 | Taux de paiement Web fail-closed multidevise | OK | n/a | `student-fees.currency` | n/a | GREEN |
| FIN-L2-05 | Taux de paiement Mobile fail-closed multidevise | n/a | OK | idem | n/a | GREEN |
| FIN-L2-06 | Impayés Web : 403/RBAC ≠ liste vide succès | OK | OK | Impayés:READ + GET unpaid | n/a | GREEN |
| FIN-L2-03-M | Oscar Mobile allocation (régression #583) | n/a | OK | idem | OK | GREEN |
| FIN-L2-07 | Taux de paiement devise absente fail-closed | OK | OK | `student-fees.currency` | n/a | GREEN |
| FIN-L2-08 | Impayés : créance sans devise jamais omise | OK | n/a | lignes ledger | n/a | GREEN |

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
