# FIN-UX-01 — Audit du vocabulaire « Imputé / Non imputé / Imputation »

| Champ | Valeur |
|-------|--------|
| **ID** | `FIN-UX-01` |
| **Nature** | Phase A uniquement. Aucun changement de produit, de contrat API, de donnée ni de migration. |
| **Base** | `develop` |
| **SHA audité** | `eff44c5dbe2a38da245ee377e29ffd81f8c1696d` |
| **Sujet du SHA** | `fix(workers): validate actual database identity behind Hyperdrive (#1034)` |
| **merge-base** | `eff44c5dbe2a38da245ee377e29ffd81f8c1696d` |
| **Branche** | `cursor/fin-ux-01-audit-bd91` |
| **Périmètre du diff** | Ce fichier uniquement |
| **Statut** | **DRAFT / HOLD.** Matrice proposée, pas appliquée. |
| **Merge** | Non. Pas de Ready. Pas d'implémentation des libellés avant décision CTO. |
| **Chantier voisin** | FIN-SEC-01 (PR draft séparée) verrouille l'écriture et retire le *choix* d'encaissement libre. Il ne réécrit pas les reçus historiques. |

Le parent de cette PR est le SHA audité. Le commit de la PR n'ajoute que ce rapport.

---

## 0. Verdict

Les tableaux de bord Finance n'affichent plus les KPI « Imputé » et « Non imputé ». Ils restent sur **Obligation / Encaissé / Reste à payer** (FIN-SIMPLE-01).

Le vocabulaire « imputé » reste visible à trois endroits distincts, qu'il ne faut pas traiter par un remplacement mécanique :

1. **Le formulaire d'encaissement** propose encore « Non imputé » et annonce qu'un montant sans frais ouvert sera enregistré ainsi. C'est un choix d'écriture, pas seulement un libellé.
2. **L'aperçu du formulaire** (avant enregistrement) parle de « Montant imputé » et « Montant non imputé ».
3. **Les reçus, l'historique et les statuts** portent « Montant imputé », « Montant non imputé », « Non imputé », « Partiellement imputé » et, à part, « Trop-perçu ». Ces lignes rendent visibles des encaissements déjà enregistrés, y compris les anomalies. Elles restent en **HOLD** tant que le CTO n'a pas validé la matrice.

Les identifiants techniques (`allocatedAmount`, `unallocatedAmount`, `__unallocated__`, `UNALLOCATED_FEE_TYPE`, commentaires SQL, codes `FINANCE_*`) ne sont pas des libellés. Ils ne sont pas à renommer dans cette phase.

---

## 1. Libellés utilisateur

| Libellé vu | Où | Rôle |
|---|---|---|
| `Non imputé` | `web/src/components/payments/QuickPaymentModal.tsx` — option du select (`UNALLOCATED_FEE_TYPE`) | Choix d'encaissement sans obligation |
| `Montant imputé` / `Montant non imputé` | même modal, aperçu avant enregistrement | Indicateur live du brouillon |
| `imputé` / `non imputé` | description du modal après enregistrement, au-dessus du reçu | Résumé du paiement juste créé |
| `Le montant saisi sera enregistré en non imputé.` | `web/src/components/payments/OpenObligationCards.tsx` | État vide : aucune obligation ouverte |
| `sinon il reste non imputé` | `web/src/pages/EntityPage.tsx` toast | Message si l'on tente l'ancien formulaire générique |
| `Montant imputé` / `Montant non imputé` | `web/src/components/payments/PaymentReceipt.tsx` | Reçu affiché et imprimé |
| `Partiellement imputé` | `web/src/lib/financeObligationStatus.ts` (`financePaymentStatusLabel`) et reçu | Libellé du statut serveur `Partiel` d'un **paiement**, distinct du statut d'**obligation** « Partiellement payé » |
| `Non imputé` / `Trop-perçu` | `web/src/lib/quickPayment.ts` `resolvePaymentStatus` | Statuts produits par l'ancien constructeur local de reçu |
| `Non imputé` | `Mobile/src/components/PaymentMutationControls.tsx` puce de choix | Même choix que le select Web |
| `Le montant saisi sera enregistré en non imputé.` | même écran, liste vide | Parité de l'état vide |
| `Non imputé` | `Mobile/src/components/PaymentReceiptCard.tsx` | Ligne de reçu |
| `Non imputé` | `Mobile/src/lib/dataTruth.ts`, `Mobile/src/lib/mobileUsability.ts` | Libellé de statut affiché |
| `Partiellement imputé` | `Mobile/src/lib/financeObligationStatus.ts` | Même libellé de statut paiement que le Web |

Les bannières `HomeScreen`, `PaymentsScreen`, `StudentPaymentsScreen` et `FinancePaymentsOverview` ne portent plus `label="Imputé"` ni `label="Non imputé"`. Les tests `studentPaymentsKpiDensity` et `pariteL3Finance` verrouillent cette absence.

---

## 2. Identifiants techniques — ne pas renommer

| Jeton | Rôle |
|---|---|
| `__unallocated__` / `UNALLOCATED_TARGET` | Valeur de formulaire, pas un texte montré tel quel |
| `UNALLOCATED_FEE_TYPE = "Non imputé"` | Valeur envoyée autrefois dans `items[].feeType` |
| `allocatedAmount`, `unallocatedAmount`, `overpaymentAmount` | Champs de projection API |
| `financeUnallocatedCash.js` `UNALLOCATED_STATUS` | Projection des reçus historiques |
| Commentaires SQL et codes `FINANCE_*` | Contrat interne |
| Statut persisté `Non imputé` sur d'anciens `payments` | Donnée. Aucune réécriture. |

`Mobile/src/lib/formFieldValidation.ts` traite `__unallocated__` comme une ligne valide. Ce n'est pas un libellé, mais c'est ce qui autorise le choix. Le retirer du formulaire sans le refuser à la validation laisserait un chemin d'écriture.

---

## 3. Matrice proposée

Chaque ligne est un libellé dans son contexte. « Avance » et « Trop-perçu » ne sont pas des synonymes de « Non imputé ».

| Ancien | Contexte | Nouveau proposé | Décision |
|---|---|---|---|
| Option `Non imputé` | Formulaire Web et Mobile | Retirée. Aucune puce, aucune option. | HOLD de libellé. Le verrou d'écriture est le sujet de FIN-SEC-01, pas de cette PR. |
| `Le montant saisi sera enregistré en non imputé.` | Élève sans somme exigible | `Aucune somme n'est exigible pour cet élève. L'encaissement est désactivé.` | Idem. Le bouton d'encaissement est désactivé. |
| `Montant imputé` (aperçu du formulaire) | Avant enregistrement | `Solde encore dû` | À valider avec le formulaire. |
| `Montant non imputé` (aperçu du formulaire) | Avant enregistrement | `Montant à encaisser` | À valider avec le formulaire. |
| Résumé `imputé … non imputé` | Bandeau du modal juste après l'enregistrement | `Encaissement de {montant}.` | Le composant reçu en dessous garde ses lignes tant que la ligne reçue n'est pas validée. |
| Toast EntityPage | Ancien formulaire générique | `Chaque montant doit viser un frais encore dû.` | Avec le formulaire. |
| `Montant imputé` | Reçu Web | `Affecté aux frais ouverts` | **HOLD.** L'anomalie historique doit rester lisible. |
| `Montant non imputé` / ligne reçu `Non imputé` | Reçu Web et Mobile | `Non affecté à un frais` | **HOLD.** |
| Statut paiement `Non imputé` | Historique, badges, filtres | `Non affecté` | **HOLD.** Ne pas l'effacer ni le mapper vers `Payé`. |
| `Partiellement imputé` | Statut de **paiement** `Partiel` | `Encaissement partiel` | **HOLD.** Ne pas le confondre avec `Partiellement payé`, qui qualifie l'**obligation**. |
| `Trop-perçu` | Statut historique d'un surplus déjà encaissé | Inchangé | **HOLD.** Ce n'est pas une variante d'« imputé ». Un nouveau trop-perçu ne doit plus pouvoir être créé (FIN-SEC-01). L'historique reste visible. |
| Avance | Il n'existe pas de libellé « avance ». L'avance passait par un encaissement sans obligation, affiché `Non imputé`. | Pas de nouveau libellé d'avance. Refus explicite : `Aucune obligation financière n'est enregistrée pour cet élève. L'encaissement est interdit.` | Contrat d'écriture FIN-SEC-01. Cette PR ne l'implémente pas. |
| Obligations toutes soldées | Aujourd'hui le formulaire retombe sur `Non imputé` | `Toutes les obligations de cet élève sont soldées. L'encaissement est interdit.` | Même contrat. |

Les messages de refus 422 (`FINANCE_NO_OPEN_OBLIGATION`, `FINANCE_OBLIGATIONS_SETTLED`, `FINANCE_PAYMENT_EXCEEDS_BALANCE`, `FINANCE_UNALLOCATED_FORBIDDEN`) sont des textes d'erreur, pas des renommages de l'historique. Ils s'affichent tels quels dans le toast Web et l'erreur Mobile déjà branchés sur le message API.

---

## 4. Tests qui figent les chaînes

Une phase B devra les mettre à jour en même temps que le libellé, sinon la CI les considérera comme une régression volontaire :

- `web/src/components/payments/PaymentReceipt.test.tsx` — `Partiellement imputé`, statut `Non imputé`
- `web/src/lib/financeObligationStatus.test.ts`, `web/src/lib/financeCalcOverpayment.red.test.ts`
- `Mobile/src/lib/pariteL1FinanceUx.test.ts` — le reçu mobile doit contenir `Non imputé`
- `Mobile/src/lib/finSimplePresentation.test.ts` — exige encore `label: "Non imputé"` dans le formulaire **et** `Non imputé` sur le reçu
- `Mobile/scripts/verify-mobile-data-truth.js`, `verify-mobile-home-data-truth.js`
- `backend/scripts/verify-finance-web-mobile-convergence.js` — `Montant non imputé` dans le modal **et** dans le reçu
- `backend/scripts/verify-finance-readiness.js` — la phrase de test `Mobile money doit être imputé` est un commentaire d'assertion, pas une copie d'écran

Le reçu et le formulaire ne doivent pas être déverrouillés par le même remplacement.

---

## 5. Phase B — seulement après validation CTO

Scénarios à rejouer une fois la matrice acceptée, Web et Mobile :

- paiement intégral ;
- paiement partiel ;
- plusieurs frais ;
- tentative d'avance (aucune obligation) ;
- tentative de trop-perçu ;
- annulation et remboursement ;
- historique et impression d'un reçu ancien qui contient encore un montant non affecté.

Contraintes inchangées : aucune suppression de donnée, aucune migration PostgreSQL dans ce chantier de vocabulaire, contrats API conservés, anomalies historiques toujours visibles.

---

## 6. Ce que cette PR ne fait pas

Aucun fichier de produit n'est modifié. Les choix « Non imputé » sont encore présents sur `develop` au SHA audité. Leur retrait d'écriture est suivi dans le chantier FIN-SEC-01, en draft séparé, et ne vaut pas validation de la matrice des reçus.
