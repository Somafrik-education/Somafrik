# FIN-SIMPLE-01 — Audit TEST-FIRST de simplification du module Finances

| Champ | Valeur |
|-------|--------|
| **ID** | `FIN-SIMPLE-01` |
| **Nature** | Audit documentaire TEST-FIRST. Aucun correctif d'interface, aucune écriture comptable. |
| **Base** | `develop` |
| **SHA audité** | `36bb96249af79abf5119348939761b6c7f700ced` |
| **Sujet du SHA** | `feat(nfc): integrate controlled NFC-INT-01 #920` |
| **Remote** | `origin/develop` identique au moment de l'audit (`git fetch origin develop`) |
| **merge-base code** | `36bb96249af79abf5119348939761b6c7f700ced` |
| **Branche de cette PR** | `cursor/fin-simple-01-audit-9c1f` |
| **Périmètre du diff** | Ce fichier uniquement |
| **Statut** | **DRAFT / HOLD. Corrections documentaires A, B et C appliquées sur le HEAD `71466d76`. En attente du re-diff CTO.** |
| **Revue** | Périmètre Git de #923 approuvé au HEAD `71466d7626f52b7aa051171bff397818cdcb06f4`. Cette révision ne change que les trois imprécisions relevées. |
| **Merge** | Non. Pas de Ready. Pas d'implémentation avant décision CTO. |
| **Production / `main` / données** | Non touchés. Aucune requête d'écriture PostgreSQL. RBAC et périmètres établissements inchangés. |

Le parent de cette PR est le SHA audité. Le HEAD de la PR est le commit qui ajoute ce rapport. Il ne contient aucun changement de comportement.

---

## 0. Verdict

**GO conditionnel pour une seule PR corrective de présentation. NO-GO pour toute modification comptable, et NO-GO pour supprimer l'option d'encaissement « Non imputé » dans cette même PR.**

Les trois montants demandés existent déjà, et ils ne sont pas calculés par `Obligation − Encaissé`.

| Indicateur cible | Source déjà en place | Formule |
|---|---|---|
| **Obligation** | `formatPaymentOverviewAmounts().expectedLabel` | Σ `max(0, amountDue − exemption)` des obligations non annulées et non archivées, par devise |
| **Encaissé** | `formatPaymentCashAmounts().collectedLabel` | Σ des paiements réellement comptés, par devise |
| **Reste à payer** | `formatPaymentOverviewAmounts().remainingLabel` | Par devise : `max(0, Σ max(0, amountDue − exemption) − Σ max(0, amountPaid))`. Ce n'est pas une lecture de la colonne `balance`. |

`amountPaid` est alimenté par la projection PostgreSQL des allocations (`student_fee_obligations.amount_paid`). La colonne `balance` est la même projection, stockée à côté : `GREATEST(0, amount_due − amount_paid − exemption)`. L'affichage recalcule le reste à partir de `amountDue`, `exemption` et `amountPaid`. Il est équivalent à la somme des `balance` lorsque les invariants tiennent, en particulier l'absence de surallocation. Le Backend reste l'autorité. Le cash non affecté et le surplus restent dans le paiement et dans `unallocatedAmount`. Ils ne réduisent pas la dette. Une allocation ne dépasse pas l'obligation.

Ce qui manque est un contrat d'affichage, pas un nouveau moteur de calcul.

| Zone | Décision |
|---|---|
| Bandeau Finances Web, fiche élève Mobile, fiche parent Web | **GO** — n'afficher que Obligation, Encaissé, Reste à payer |
| Cartes et compteurs « Imputé », « Non imputé », « Non imputés », « Montant imputé aux obligations » | **GO** — les retirer du bandeau |
| Calculs, statuts persistés, allocations, annulations, journaux, RBAC, schéma PostgreSQL | **NO-GO** — ne pas y toucher |
| Option de formulaire « Non imputé » (`__unallocated__`) | **NO-GO tant que le contrat d'encaissement n'est pas validé** — elle est le seul chemin légitime pour encaisser sans dette ouverte (#747, #751) |
| Statuts de reçu et d'historique « Trop-perçu » et « Partiellement imputé » | **HOLD** — les masquer sans lexique de remplacement réouvrirait le défaut Oscar de la PR #542 |
| Renommage CDF → FC | **NO-GO** — « FC » de l'exemple CTO est illustratif. `FC` est un alias d'écriture vers `CDF`, jamais une devise de stockage |

**Nombre de PR correctives recommandées : 1.**

1. Cette PR : audit, DRAFT / HOLD.
2. PR suivante, après diff CTO : simplification d'affichage Web et Mobile des trois indicateurs. Aucun fichier Backend ni migration.

Une troisième PR ne se justifie que si le CTO valide ensuite un lexique de remplacement pour le reçu, l'historique et l'option d'encaissement. Elle n'est pas recommandée maintenant.

---

## 1. Base Git

```text
git fetch origin develop
git rev-parse HEAD
36bb96249af79abf5119348939761b6c7f700ced

git rev-parse origin/develop
36bb96249af79abf5119348939761b6c7f700ced

git log -1 --format='%H %s'
36bb96249af79abf5119348939761b6c7f700ced feat(nfc): integrate controlled NFC-INT-01 #920
```

`main` au moment de l'audit : `ef8bc951` (`release: promote dashboard activity 403 fix to main (#827)`). Non utilisé comme base. Non modifié.

Contrats historiques relus, tous mergés dans `develop` :

| PR | Merge | Rôle pour FIN-SIMPLE-01 |
|---|---|---|
| [#542](https://github.com/Somafrik-education/Somafrik/pull/542) | `6982f3141b8777049845ce178ebf7fdf4001e5a8` | Sépare le statut d'imputation du statut de créance. `Partiel` affiché « Partiellement imputé ». Leftover après solde des cibles = « Trop-perçu », jamais « Partiellement payé ». Oscar inchangé : un `obligationId` déjà soldé reste un 409, il n'est pas converti en Non imputé. |
| [#747](https://github.com/Somafrik-education/Somafrik/pull/747) | `6a9ae67958150852e04753457ecac1019ee0a902` | Joint UUID, `studentDbId` et matricule. Élève avec dette ouverte : ne pas tomber sur Non imputé. Élève sans obligation : Non imputé légitime. |
| [#751](https://github.com/Somafrik-education/Somafrik/pull/751) | `6af3f675bf6ad5b32d9ad857b9ead18430fcfc3e` | Mobile appelle `getStudentFees(UUID)`. Une réponse périmée ne doit pas figer `__unallocated__`. Snapshot vide temporaire ≠ élève vraiment sans obligation. |

Ces trois contrats restent des verrous. La PR corrective ne les réécrit pas.

---

## 2. Inventaire

Recherche sur le SHA audité, hors `docs/` et hors `node_modules` :

`allocatedAmount`, `unallocatedAmount`, `overpaymentAmount`, `Non imputé`, `Non imputés`, `Trop-perçu`, `Partiellement imputé`, `Montant imputé`, `Montant non imputé`, `__unallocated__`, `UNALLOCATED_`.

560 occurrences dans 87 fichiers produit. Les docs d'audit antérieurs citent les mêmes mots et ne sont pas des surfaces utilisateur. Ils ne sont pas à modifier.

Décision par famille :

| Famille | Décision |
|---|---|
| Surface utilisateur du bandeau financier | Retirer ou renommer dans la PR corrective |
| Reçu, historique, statut de ligne, option d'encaissement | Conserver dans la PR corrective. HOLD de libellé. |
| Backend, PostgreSQL, contrats d'écriture, tests d'invariant | Conserver tels quels |
| Documentation historique | Ne pas réécrire |

### 2.1 Bandeaux et indicateurs — à simplifier

| Fichier | Lignes | Surface | Comportement actuel | Dépendance | Décision |
|---|---|---|---|---|---|
| `web/src/components/payments/FinancePaymentsOverview.tsx` | 23-28 | Module Paiements Web, tête de liste | Six cartes : Montant attendu, Montant encaissé, Montant imputé aux obligations, Reste à payer, Obligations élèves, Paiements récents | `buildFinancePaymentsOverview` | Garder les trois montants. Renommer attendu → **Obligation**, encaissé → **Encaissé**. Retirer la carte d'imputation. Les deux compteurs sortent du bandeau KPI ; la liste et l'historique restent. |
| `web/src/pages/EntityPage.tsx` | 1721-1722 | Montage du bandeau si `module.key === "payments"` | Affiche `FinancePaymentsOverview` | Scope établissement via `scopedStudentFees` / `scopedPayments` | Conserver le montage. Changer seulement le composant de synthèse. |
| `web/src/pages/EntityPage.tsx` | 1037 | Toast si création générique d'un paiement | « sinon il reste non imputé » | Contrat d'écriture | HOLD. Le toast décrit le contrat d'encaissement, pas un KPI. |
| `web/src/pages/finances/ParentFinancePage.tsx` | 176-180 | Finances parent Web | Quatre cartes : Montant attendu, Montant imputé, Reste à payer, Paiements reçus | `buildParentFinanceModel` | Trois cartes : Obligation = `expectedLabel`, Encaissé = `collectedLabel` (cash), Reste = `remainingLabel`. Retirer « Montant imputé ». |
| `web/src/pages/ParentDashboardPage.tsx` | 262-266 | Tuile parent « Reste à payer » | Détail `Attendu … · imputé …` | `paidLabel` = `amountPaid` des obligations, pas le cash | Remplacer le détail par Obligation et Encaissé, sans le mot « imputé ». Le montant « Reste à payer » reste `remainingLabel`. |
| `web/src/lib/paymentAmountBreakdown.ts` | 53-137 | Calcul Web des seaux obligation / reste | `remainingAmount` = `max(0, expectedAmount − collectedAmount)` par devise. Ici `collectedAmount` est Σ `max(0, amountPaid)`, pas le cash et pas la colonne `balance`. | `amountPaid` vient de la projection des allocations | Conserver les fonctions. Le nom interne `collectedAmount` est un piège de lecture : la PR corrective ne le rebaptise que si les tests de parité sont mis à jour dans le commit GREEN, sans changer la formule. |
| `web/src/lib/paymentCashKpi.ts` | 51-127 | Cash Web par devise | `collectedLabel` est le total encaissé comptabilisé. `unallocatedLabel` vaut `—` seulement lorsque `unallocatedAmount` est absent ou invalide. Cette absence ne rend pas `collectedLabel` indisponible, et elle ne fabrique pas un zéro de non-affecté. | Champs API `amount`, `allocatedAmount`, `unallocatedAmount` | Conserver. Le bandeau ne lit plus `allocatedLabel` ni `unallocatedLabel`. |
| `web/src/lib/parentFinance.ts` | 47-58 | Modèle parent | `allocatedLabel` = montant payé des obligations. `collectedLabel` = cash | Même séparation | Conserver le modèle. L'UI cesse d'afficher `allocatedLabel`. |
| `web/src/lib/parentDashboard.ts` | 134-161 | Tuile accueil parent | `paidLabel` = `amountPaid`. `paymentLabel` = cash | Idem | Idem. |
| `Mobile/src/screens/PaymentsScreen.tsx` | 133-164 | Paiements Mobile, vue d'ensemble | Montant attendu, Reste à payer, taux, Montant encaissé, ligne « Imputé · Non imputé », compteurs Payés / Non imputés / Impayés | `formatPaymentOverviewAmounts` + `formatPaymentCashAmounts` + `getPaymentStats` | Bandeau : Obligation, Encaissé, Reste à payer. Retirer la ligne Imputé / Non imputé et le compteur Non imputés. Le lien Impayés peut rester hors du bandeau KPI : c'est une navigation vers les dettes, pas un statut d'imputation. |
| `Mobile/src/screens/StudentPaymentsScreen.tsx` | 161-194 | Fiche paiements élève | Hero « Montant attendu », puis Imputé, Reste à payer, Encaissé, Non imputé | `imputedLabel` = `amountPaid` des obligations. `collectedLabel` = cash. | Même bandeau de trois indicateurs. `Imputé` et `Non imputé` sortent. |
| `Mobile/src/screens/HomeScreen.tsx` | 168-169, 455-462 | Accueil Mobile | « À percevoir » = reste des obligations. « Encaissé » = cash. « Impayés » = compteur du ledger. | `formatPaymentOverviewAmounts` / `formatPaymentCashAmounts` | Hors tête du module Finances. Les montants sont déjà les bons. Aligner le libellé « À percevoir » sur « Reste à payer » dans la PR corrective pour que Web et Mobile disent la même chose. Ne pas y ajouter un troisième calcul. |
| `Mobile/src/lib/paymentAmountBreakdown.ts` | miroir Web | Calcul Mobile | Même formule que le Web, fichier dupliqué | Parité L3 | Ne pas créer une troisième formule. |
| `Mobile/src/lib/paymentCashKpi.ts` | 52-143 | Cash Mobile | `formatPaymentCashAmounts` aligne le Web : `unallocatedLabel` vaut `—` si `unallocatedAmount` est absent, tandis que `collectedLabel` reste le total encaissé. `getPaymentCashKpi` (l. 62-76) fait encore `unallocatedAmount ?? 0`. | API | Le bandeau doit continuer à lire `formatPaymentCashAmounts` pour l'encaissé. Ne pas promouvoir `getPaymentCashKpi` : son `?? 0` masque un non-affecté absent. Les écrans le calculent encore (`PaymentsScreen` l. 59, `StudentPaymentsScreen` l. 107) sans l'afficher comme libellé principal. |
| `Mobile/src/domain/metrics/schoolMetrics.ts` | 105-125 | Compteurs Payés / Non imputés | Un reçu « Non imputé » n'est ni Payé ni Impayé | Statut API | Le compteur « Non imputés » quitte le bandeau. La fonction de métrique reste : d'autres tests de vérité des données en dépendent. |
| `Mobile/src/lib/studentSubScreensSpec.ts` | 54 | Commentaire de layout | Fige les quatre libellés Imputé / Reste / Encaissé / Non imputé | Test de densité | Le commentaire et `studentPaymentsKpiDensity.test.ts` suivent le nouveau bandeau dans le commit GREEN. |

### 2.2 Reçus, historique, statuts — traçabilité à conserver

| Fichier | Lignes | Surface | Comportement actuel | Dépendance | Décision |
|---|---|---|---|---|---|
| `web/src/components/payments/PaymentReceipt.tsx` | 136-163 | Reçu Web | Montant reçu, Montant imputé, Montant non imputé, statut via `financePaymentStatusLabel` | `allocatedAmount`, `unallocatedAmount`, `overpaymentAmount` | **HOLD.** FIN-11 interdit de perdre la trace du surplus. Retirer ces lignes sans nouveau libellé cache un encaissement non affecté. |
| `web/src/components/payments/PaymentReceipt.test.tsx` | 59, 129-154 | Verrou Oscar | Un trop-perçu n'affiche pas « Partiellement payé ». `Partiel` affiche « Partiellement imputé ». | PR #542 | **Préserver.** Ne pas inverser ce test pour faire disparaître le mot. |
| `web/src/lib/financeObligationStatus.ts` | 35-45 | Libellés de **paiement** | `Trop-perçu` → « Trop-perçu ». `Partiel` → « Partiellement imputé ». `Non imputé` retombe sur la chaîne brute. | Statut serveur | **HOLD.** Miroir strict de `Mobile/src/lib/financeObligationStatus.ts` l. 35-45. |
| `web/src/lib/financeObligationStatus.ts` | 25-32 | Libellés d'**obligation** | `Partiel` d'obligation → « Partiellement payé » | Statut de créance | Conserver. Ce n'est pas « Partiellement imputé ». Les mélanger réouvre Oscar. |
| `web/src/pages/entity-page/entityColumns.tsx` | 148-149 | Colonne Statut de la liste paiements, donc aussi l'export CSV du module | Passe par `financePaymentStatusLabel` | Même fonction | Le CSV n'a pas de colonne `allocatedAmount`. Le statut exporté change seulement si le lexique de statut change. HOLD avec le reçu. |
| `Mobile/src/components/PaymentReceiptCard.tsx` | 39-63 | Reçu Mobile | Badge de statut + ligne « Non imputé » = `unallocatedAmount` | API | **HOLD**, même motif que le reçu Web. |
| `Mobile/src/lib/mobileUsability.ts` | 249-257 | Présentation de statut générique | « non imput » → libellé « Non imputé » | Statut | HOLD. |
| `Mobile/src/lib/dataTruth.ts` | 331 | Normalisation Mobile | Statut non affecté → « Non imputé » | Contrat F5 | Conserver. C'est une projection de vérité, pas une carte KPI. |
| `web/src/lib/quickPayment.ts` | 313-319, 349-374 | Prévisualisation locale du statut | Peut produire « Non imputé » et « Trop-perçu » avant réponse serveur | Le serveur reste l'autorité à l'enregistrement | Conserver la fonction. L'UI de prévisualisation du modal est au § 2.3. |
| `backend/services/paymentTransactionService.js` | 147-173 | Ancien chemin `applyAtomicPayment`, utilisé par les tests communications | Calcule un `overpaymentAmount` local | Pas l'autorité PostgreSQL des paiements école | Ne pas « nettoyer » ce fichier dans la PR d'UI. Ne pas le prendre comme source des trois KPI. |

### 2.3 Formulaires d'encaissement — option à ne pas retirer

| Fichier | Lignes | Surface | Comportement actuel | Dépendance | Décision |
|---|---|---|---|---|---|
| `web/src/lib/financePaymentWrite.ts` | 7-8 | Contrat d'écriture Web | `UNALLOCATED_FEE_TYPE = "Non imputé"`, `UNALLOCATED_TARGET = "__unallocated__"` | Miroir de `financeWebMobileWriteContract.js` et de `paymentEnrollment.ts` | Conserver. Seul `__unallocated__` explicite produit le fee type. `obligationId` vide ou absent est une erreur, pas un Non imputé silencieux. |
| `web/src/components/payments/QuickPaymentModal.tsx` | 170-183 | Sélecteur de frais | Le mode standard propose « Non imputé ». Le mode encaissement rapide depuis Impayés ne le propose pas par défaut, et bloque si le solde impayé n'a pas d'obligation résoluble. | #747, tests `IMP-FAST-RED-03` / `RED-06` | **Conserver l'option** dans la PR des trois KPI. |
| `web/src/components/payments/QuickPaymentModal.tsx` | 691-710 | Bandeau du formulaire | Montant reçu, Montant imputé, Montant non imputé | Prévisualisation `draftLineCash` | Les trois mots techniques quittent ce bandeau seulement après lexique CTO. Les montants de contrôle restent. |
| `web/src/components/payments/OpenObligationCards.tsx` | 30, 71 | Cartes d'obligations ouvertes | « sera enregistré en non imputé » si aucune obligation. « Reste à payer » sur chaque carte. | Solde serveur | Conserver la phrase tant que l'option existe. « Reste à payer » de la carte d'obligation est le solde de cette obligation : le garder. |
| `Mobile/src/components/PaymentMutationControls.tsx` | 116-124 | Sélecteur Mobile | Première puce `{ id: __unallocated__, label: "Non imputé" }` puis les obligations ouvertes | `preselectPaymentObligationId` | **Conserver.** Une seule obligation ouverte est présélectionnée. Zéro obligation → la puce Non imputé. |
| `Mobile/src/lib/paymentEnrollment.ts` | 158-159, 320-368 | Préselection | `UNALLOCATED_FEE_TYPE`, `UNALLOCATED_TARGET` | #751 garde de génération | Conserver. |
| `Mobile/src/lib/formFieldValidation.ts` | 181-246 | Validation | `__unallocated__` est une cible explicite valide | Contrat F5 | Conserver. |
| `backend/lib/financeWebMobileWriteContract.js` | 7-10, 140-162 | Autorité du payload | `feeType: "Non imputé"` seulement si la cible explicite est `__unallocated__` | F5 | Conserver. |
| `backend/lib/financeService.js` | 243, 286, 426-448, 508 | Création de paiement | Sans `obligationId`, le libellé persisté est « Non imputé ». `overpaymentAmount` de la réponse = reliquat de conservation. | Allocations + invariant | Conserver. |
| `backend/lib/financeFeeTypes.js` | 65, 114-115 | Garde de type | `"non impute"` et `"acompte"` ne sont pas des types de frais canoniques | F2 | Conserver. « Acompte » reste interdit comme type. |

Effet comptable de l'option, déjà prouvé par `financeWebMobileConvergence.test.js` :

- cible `__unallocated__` : `allocatedAmount = 0`, `unallocatedAmount = montant`, statut « Non imputé », dette inchangée ;
- cible obligation : le serveur alloue `min(solde, montant)` et place le reste en reliquat ;
- surplus : l'obligation passe à solde 0, le reliquat reste sur le paiement, statut « Trop-perçu » ;
- élève sans obligation : l'encaissement sans cette option devient impossible, ou retombe dans une conversion silencieuse que F5 interdit.

Le risque d'un encaissement sans obligation est donc réel, assumé, et tracé. Le retirer sans règle de remplacement bloque la caisse ou réintroduit une affectation devinée.

### 2.4 Backend et PostgreSQL — autorité à ne pas modifier

| Fichier | Lignes | Rôle | Décision |
|---|---|---|---|
| `backend/lib/financeDomainInvariants.js` | 77-98, 106-131 | `computeAllocatedAmount`, `computeUnallocatedAmount = max(0, paiement − alloué)`, `computeObligationBalance = max(0, dû − payé − exonération)`, conservation `alloué + non alloué = paiement` | Conserver. Aucune formule cliente ne remplace ces fonctions. |
| `backend/lib/financeUnallocatedCash.js` | 1-123 | Encaissé / imputé / non imputé. Statuts `Non imputé`, `Partiel`, `Trop-perçu`. `overpaymentAmount` est l'alias de `unallocatedAmount`. | Conserver. C'est le vocabulaire de persistance, pas le vocabulaire du bandeau. |
| `backend/lib/financeManagement.js` | 70-78, 195-198 | `isPaymentCounted` exclut annulé, refusé, échoué. Pending est exclu plus haut, dans `cashBucketsFromPayments` et dans les clients. | Conserver. |
| `backend/lib/financeRepository.pg.test.js` | 5, 241-507, 655, 862 | Intégration PostgreSQL : multi-lignes non affectées, surplus, élève sans dette | Conserver. Ne pas exécuter ces tests comme une migration. |
| `backend/db/migrations/20260813_finance_canonical.sql` | 81+ | Table `payment_allocations` | Ne pas modifier. |
| `backend/db/migrations/20260828_finance_f4_allocation_balance.sql` | 1-169 | Trigger `payment_allocations_assert_canonical` (tenant, élève, devise, capacité, paiement `paid`, refus de surallocation). Trigger `student_fee_obligations_project_allocations` : `amount_paid`, `balance = GREATEST(0, dû − alloué − exonération)`, statuts Payé / Partiellement payé / À payer / En retard / Exonéré / Annulé. | Ne pas modifier. L'UI ne lit pas la colonne `balance` : elle recalcule depuis `amountDue`, `exemption` et `amountPaid`. L'équivalence avec Σ `balance` suppose ces invariants. Le reste affiché ne se calcule pas depuis le cash. |
| `backend/db/schema.sql` | 900 | Schéma courant de `payment_allocations` | Ne pas modifier. |
| `backend/db/financePgStore.js` | 595-613, 1004+ | Insert, reverse, sommes d'allocations | Ne pas modifier. |
| `backend/lib/studentCardFinance.js` | 95-103 | Badge carte : cash non affecté ou en attente → situation à vérifier | Hors bandeau Finances. Ne pas le vider : un paiement non affecté ne doit pas apparaître comme une échéance impayée (AUDIT-CARTE-01). |

Aucun champ `allocated_amount` n'est une colonne de `payments`. Les montants d'imputation sont dérivés des lignes `payment_allocations` actives (`reversed_at IS NULL`). Les supprimer de l'UI ne supprime pas les lignes.

### 2.5 Autres surfaces lues

| Surface | Constat | Décision |
|---|---|---|
| `web/src/pages/finances/FinanceUnpaidPage.tsx` l. 343, 469-485 | Détail impayé : Montant attendu, « Montant alloué aux impayés ouverts » (`amountPaid`), Reste à payer | Ce n'est pas le bandeau des trois KPI. « Montant alloué… » est le règlement de la dette ouverte, pas le cash. Le laisser dans le détail d'obligation. Ne pas le présenter comme Encaissé. |
| `web/src/pages/finances/FinanceUnpaidPage.tsx` l. 470 | « Montant attendu » dans le détail | Peut devenir « Obligation » dans la PR d'affichage, même source. |
| `Mobile/src/screens/UnpaidScreen.tsx` l. 320, 374, 378 | « Reste dû » et « Montant attendu » | Même solde canonique, autre mot. Aligner « Reste dû » sur « Reste à payer » pour FIN-10. Les tests `pariteL1FinanceUx` et `pariteL2Finance` verrouillent aujourd'hui la chaîne « Reste dû » : le commit GREEN les met à jour en même temps que l'écran, sans affaiblir l'assertion de montant. |
| `web/src/components/payments/OpenObligationCards.tsx` l. 71 | « Reste à payer » par obligation | Déjà le bon libellé. |
| Export CSV `EntityPage` | Colonnes génériques du module. Le statut passe par `financePaymentStatusLabel`. Pas de colonne d'imputation dédiée. | Pas de nouvel export. Pas de perte de colonne financière. |
| Rapports PDF | Pas de générateur financier distinct trouvé qui imprime « Imputé / Non imputé / Trop-perçu » en dehors du reçu Web (`window.print` du reçu). | Le reçu reste HOLD. |
| Taux de paiement | `paymentRateKpi.ts` Web et Mobile. Taux = `amountPaid / obligation`, plafonné, fail-closed si devises mixtes. Le commentaire dit « encaissé » alors que le numérateur est `amountPaid`. | Le taux n'est pas un des trois KPI. Le retirer du hero Paiements Mobile (l. 140) pour qu'il ne soit pas lu comme Encaissé / Obligation. Conserver la fonction : l'accueil et les tests de parité L2 en dépendent. Ne pas « corriger » le taux en le divisant par le cash. |

### 2.6 Fichiers produit qui portent les symboles

Chaque fichier ci-dessous a au moins une occurrence. La décision de la famille s'applique à tout le fichier : les tests se préservent, le Backend ne se modifie pas, seules les surfaces du § 2.1 entrent dans la PR corrective.

Backend runtime : `financeUnallocatedCash.js` (28), `financeWebMobileWriteContract.js` (11), `financeService.js` (10), `financeDomainInvariants.js` (7), `financeManagement.js` (3), `financeFeeTypes.js` (2), `financeRbacRouteMatrix.js` (1), `studentCardFinance.js` (1), `services/paymentTransactionService.js` (1).

Backend tests et scripts, à préserver : `financeUnallocatedMaeva.test.js` (23), `verify-finance-web-mobile-convergence.js` (22), `financeWebMobileConvergence.test.js` (22), `verify-finance-management.js` (18), `financeUnallocatedCash.test.js` (17), `financeRepository.pg.test.js` (16), `financeReadiness.http.pg.test.js` (16), `financeCalcOverpayment.red.test.js` (15), `financeAllocationBalance.test.js` (12), `verify-finance-multi-item-payment.js` (10), `financeMultiItemPayment.test.js` (7), `studentCardFinance.test.js` (6), `financePaymentEnrollment.test.js` (6), `financeObligationLifecycle.test.js` (4), `financeObligationLifecycle.pg.test.js` (4), `idempotencyService.test.js` (3), `idempotency.pg.test.js` (3), `financeDomainInvariants.test.js` (3), `financeCalcOverpayment.pg.test.js` (3), `verify-finance-legacy-cleanup.js` (2), `verify-finance-domain-invariants.js` (2), `financeRepository.test.js` (2), `financePaymentRateConsistency.test.js` (2), `financeObligationPaymentMatch.test.js` (2), `financeAllocationBalance.pg.test.js` (2), `verify-finance-allocation-balance.js` (1), `studentAccessCards.finance.pg.test.js` (1), `financeOpenObligations.esther.test.js` (1), `financeLiveRbac.http.pg.test.js` (1).

Web runtime hors bandeau : `paymentCashKpi.ts` (17), `financePaymentWrite.ts` (10), `QuickPaymentModal.tsx` (11), `quickPayment.ts` (6), `PaymentReceipt.tsx` (4), `financeApi.ts` (3), `financeObligationStatus.ts` (2).

Web tests : `paymentCashKpi.test.ts` (22), `FinanceUnpaidPage.fastPayment.test.tsx` (13), `financePaymentWrite.test.ts` (10), `parentFinance.test.ts` (8), `financeCalcOverpayment.red.test.ts` (6), `PaymentReceipt.test.tsx` (6), `QuickPaymentModal.fastStudent.test.tsx` (6), `pariteL3Finance.red.ts` (4), `paymentCashParity.l305.test.ts` (3), `financeL308PaymentStudent.parity.test.ts` (2), `financeObligationStatus.test.ts` (2), `FinancePaymentsOverview.test.tsx` (2), `paymentHistoricalScope.l307.test.ts` (1), `quickPayment.multiItem.test.ts` (1), `paymentWorkflow.test.ts` (1).

Mobile runtime : `paymentCashKpi.ts` (22), `dataTruth.ts` (9), `paymentEnrollment.ts` (8), `PaymentMutationControls.tsx` (4), `catalog.ts` (3), `schoolMetrics.ts` (3), `formFieldValidation.ts` (2), `PaymentReceiptCard.tsx` (2), `financeObligationStatus.ts` (2), `mobileUsability.ts` (1).

Mobile tests : `paymentCashKpi.test.ts` (18), `paymentEnrollment.test.ts` (17), `paymentCashBreakdown.test.ts` (15), `schoolMetrics.test.ts` (5), `dataTruth.test.ts` (4), `pariteL3Finance.red.test.ts` (2), `homeFinanceKpis.l305.test.ts` (2), `studentPaymentsKpiDensity.test.ts` (1), `pariteL1FinanceUx.test.ts` (1), `formFieldValidation.test.ts` (1), `verify-mobile-data-truth.js` (1), `verify-mobile-home-data-truth.js` (1).

---

## 3. Dépendances Web / Mobile / Backend

| Question | Web | Mobile | Backend / PostgreSQL |
|---|---|---|---|
| Obligation | `formatPaymentOverviewAmounts` sur frais scopés | Même fonction, copie `Mobile/src/lib/paymentAmountBreakdown.ts` | `student_fee_obligations.amount_due` et `exemption`. Annulé / archivé exclus. |
| Encaissé | `formatPaymentCashAmounts` sur paiements scopés | Même fonction, copie `paymentCashKpi.ts` | `payments.amount` des paiements comptés. Pending, annulé, refusé, échoué, brouillon exclus côté client. Le Backend exclut annulé / refusé / échoué dans `isPaymentCounted`, et pending dans `cashBucketsFromPayments`. |
| Reste à payer | `remainingLabel` = `max(0, Σ max(0, amountDue − exemption) − Σ max(0, amountPaid))` par devise. Pas une lecture de `balance`. | Même copie. Home l'appelle aujourd'hui « À percevoir ». Impayés Mobile l'appelle « Reste dû ». | `amount_paid` = Σ allocations actives. `balance = GREATEST(0, amount_due − amount_paid − exemption)`. Équivalent au reste affiché s'il n'y a pas de surallocation. |
| Imputé affiché | Carte « Montant imputé aux obligations » = Σ `amountPaid` | Fiche élève : Σ `amountPaid`. Liste Paiements : Σ `allocatedAmount` du cash. Deux sources qui coïncident si la projection est saine, et qui peuvent diverger si un payload est incomplet. | Σ `payment_allocations.amount` actives |
| Non imputé affiché | Reçu + prévisualisation du modal | Bandeau, compteur, reçu, puce de formulaire | `max(0, paiement − alloué)`, statut si rien n'est alloué |
| Trop-perçu | Libellé de statut, pas une carte KPI | Libellé de statut | `presentPaymentStatus` quand `0 < leftover < amount` |
| Partiellement imputé | Libellé UI de `Partiel` | Même fichier miroir | Le statut stocké reste `Partiel` |
| Périmètre | `scopedStudentFees` / `scopedPayments` | `filterRowsByStudentScope` + école active | Trigger `FINANCE_ALLOCATION_TENANT_MISMATCH` |
| Devise | Seaux séparés. Pas de somme CDF+USD. `FC` → `CDF` à l'écriture. | Idem | Trigger `FINANCE_CURRENCY_MISMATCH` |
| Erreur API | Le bandeau n'est pas une donnée inventée | `QueryStateView` ou `—` selon l'écran. Si `unallocatedAmount` manque, seul `unallocatedLabel` vaut `—`. `collectedLabel` reste le total encaissé comptabilisé. | Les erreurs HTTP restent des erreurs |
| Écriture | `financePaymentWrite.ts` | `paymentEnrollment.ts` | `financeWebMobileWriteContract.js` puis `financeService.js` |
| Autorité du solde | Lecture | Lecture | PostgreSQL |

Écart de libellé déjà visible, à fermer par la PR d'affichage et non par un calcul nouveau :

| Montant | Web Paiements | Web parent | Mobile Paiements | Mobile fiche élève | Mobile accueil |
|---|---|---|---|---|---|
| Obligation | Montant attendu | Montant attendu | Montant attendu | Montant attendu | absent du hero |
| Cash reçu | Montant encaissé | Paiements reçus | Montant encaissé | Encaissé | Encaissé |
| Dette ouverte | Reste à payer | Reste à payer | Reste à payer | Reste à payer | À percevoir |
| Affecté aux dettes | Montant imputé aux obligations | Montant imputé | Imputé (cash `allocatedAmount`) | Imputé (`amountPaid`) | détail « imputé » côté parent Web seulement |

---

## 4. Contrat financier proposé

Le contrat d'affichage. Les règles de stockage ne changent pas.

1. **Obligation** = somme des obligations applicables au périmètre consulté (élève, établissement, devise, période déjà portée par les lignes). Une obligation annulée ou archivée ne compte pas. L'exonération est déduite du dû avant la somme. Une obligation sans `amountDue` numérique ne devient pas zéro : le seau suit la règle fail-closed déjà écrite dans `getPaymentRateKpi` et `getPaymentAmountBreakdown` (ligne ignorée seulement si le parse échoue dans le breakdown ; le taux, lui, passe à `—`). La PR corrective ne doit pas élargir le silence.
2. **Encaissé** = somme des paiements reçus et comptabilisés du même périmètre et de la même devise. Entrée : statut compté, non annulé, non en attente, non refusé, non échoué, non brouillon. Le cash non affecté entre dans Encaissé. Il n'entre pas dans le règlement de la dette.
3. **Reste à payer** = `formatPaymentOverviewAmounts().remainingLabel`. Par devise, `getPaymentAmountBreakdown` fait `remainingAmount = max(0, Σ max(0, amountDue − exemption) − Σ max(0, amountPaid))`. Les obligations annulées ou archivées sont exclues. Une ligne sans `amountDue` ou `amountPaid` numérique est ignorée par ce breakdown. Ce calcul ne lit pas la colonne PostgreSQL `balance`. `amountPaid` est la projection des allocations actives. Le solde canonique d'une obligation reste `balance = GREATEST(0, amount_due − amount_paid − exemption)`. La somme de ces `balance`, pour le même périmètre et la même devise, est équivalente au `remainingAmount` affiché lorsque les invariants existants tiennent, en particulier l'absence de surallocation : le trigger `FINANCE_OBLIGATION_OVERALLOCATED` refuse une allocation active supérieure à `GREATEST(0, amount_due − exemption)`. Cette PR ne modifie aucune formule.
4. Interdit dans le bandeau : `Obligation − Encaissé`. Le reste suit le montant affecté. Une allocation ne dépasse pas l'obligation. Les trois cas de référence sont :

| Obligation | Encaissé | Affecté | Non affecté | Reste |
|---|---:|---:|---:|---:|
| 100 | 120 | 100 | 20 | 0 |
| 100 | 120 | 0 | 120 | 100 |
| 100 | 40 | 40 | 0 | 60 |

Le premier est FIN-04 : le surplus de 20 reste sur le paiement, le reste affiché est 0. Le deuxième est FIN-07 : les 120 sont encaissés et non affectés, le reste affiché est 100. Le troisième est FIN-02. Aucun de ces cas n'autorise une allocation supérieure à l'obligation.
5. Pas de double comptage. Encaissé ne s'ajoute pas à Obligation. Le montant affecté n'est plus une quatrième carte. Une allocation n'est comptée qu'une fois dans `amount_paid`.
6. Même périmètre sur les trois montants : même élève ou même établissement, mêmes devises affichées séparément, mêmes lignes de période déjà sélectionnées par les requêtes existantes. Pas de nouveau filtre.
7. Chargement, vide et erreur restent explicites. `—` ou l'état d'erreur existant. Une erreur de `GET /payments` ou `GET /finance/student-fees` ne s'affiche pas `0 FC`.
8. La devise affichée reste celle du seau (`CDF`, `USD`, ou « Devise non renseignée »). L'exemple « 100 000 FC » du mandat est un exemple. `FC` continue d'être normalisé en `CDF` à l'écriture (`PRESENTATION_CURRENCY_ALIASES`).
9. Les allocations, reliquats, remboursements, journaux, reçus, références et codes de vérification restent persistés. Retirer un mot de l'écran ne retire pas une ligne `payment_allocations`.
10. Web et Mobile lisent les mêmes champs API. Mobile n'ajoute pas de formule locale pour ces trois nombres. Les copies `paymentAmountBreakdown.ts` et `paymentCashKpi.ts` existent déjà et sont verrouillées par les tests de parité L3 : la PR corrective les consomme, elle n'en ajoute pas une troisième.

Rafraîchissement : inchangé. Web recharge l'état du module. Mobile recharge au focus (`refreshFinance` / `loadPayments` + `loadStudentFees`). Les trois libellés se recalculent ensemble après un encaissement ou une annulation.

---

## 5. Matrice des 12 scénarios

Lecture de l'état au SHA audité. « Montant » = la règle métier est déjà tenue par les tests cités. « Affichage » = ce que la PR corrective doit rendre vrai. Les tests RED nouveaux portent sur l'affichage. Les tests de montant existants doivent rester verts avant et après.

| Test | Scénario | Montant aujourd'hui | Affichage aujourd'hui | Attendu après PR corrective |
|---|---|---|---|---|
| FIN-01 | Obligation 100, encaissé 0 | Reste 100. Scénario B des invariants (30 000 / 10 000) et taux sans paiement. | Le bandeau dit « Montant attendu », pas « Obligation ». | Obligation 100, Encaissé 0, Reste 100. |
| FIN-02 | Obligation 100, affecté 40 | Reste 60. Convergence F5 cas 2 : dû 100 / allocation 40 / balance 60. | Le 40 apparaît aussi comme « Imputé ». | Obligation 100, Encaissé 40, Reste 60. Le 40 n'a plus de carte propre. |
| FIN-03 | Obligation 100, affecté 100 | Reste 0, statut obligation Payé. Convergence F5 cas 3. | Cartes d'imputation encore visibles. | Obligation 100, Encaissé 100, Reste 0. |
| FIN-04 | Obligation 100, encaissé 120, affecté 100, non affecté 20 | Reste 0. Le surplus 20 reste en `unallocatedAmount`. Les allocations ne dépassent pas l'obligation. Statut paiement « Trop-perçu ». Scénario C : dette 30 000, paiement 50 000, balance 0, unallocated 20 000. | Le reçu et le statut disent Trop-perçu / Montant non imputé. | Bandeau : Reste 0. Le surplus reste en base et sur le reçu. Le bandeau n'affiche pas −20. |
| FIN-05 | Paiement annulé | Allocations reversées, `amount_paid` revient à 0, dette restaurée, paiement conservé et inactif. Scénario E. `isPaymentCounted` l'exclut de l'encaissé. | Historique « Annulé ». | Encaissé et Reste recalculés. La ligne d'historique reste. |
| FIN-06 | Paiement en attente | Exclu de l'encaissé client et de `cashBucketsFromPayments`. Convergence F5 cas 8 : dette inchangée. | Statut « En attente ». | Non ajouté à Encaissé. Reste inchangé. |
| FIN-07 | Obligation 100, encaissé 120, affecté 0, non affecté 120 | Reste 100. La dette ne change pas. Convergence F5 cas 5 : allocated 0, unallocated = montant. | Le bandeau montre « Non imputé ». C'est exact, et c'est le mot à retirer du bandeau. | Encaissé 120, Reste 100. Le mot quitte le bandeau. L'option de saisie reste. |
| FIN-08 | Plusieurs obligations | Une somme d'allocations, pas une somme de paiements dupliqués. Scénario D : un paiement 50 000, deux allocations, unallocated 0. | Compteur « Obligations élèves » en plus des montants. | Agrégation par devise, sans doublon. Le compteur sort du bandeau KPI. |
| FIN-09 | Plusieurs établissements | `scopedStudentFees` / `scopedPayments`. Convergence cas 11. Trigger tenant. Test `financePaymentsOverview.scope.test.ts`. | Déjà isolé. | Aucun changement de périmètre. |
| FIN-10 | Web et Mobile | Mêmes fonctions de seaux, fichiers dupliqués, libellés différents (§ 3). | Échec de parité des mots. | Mêmes trois libellés, mêmes montants, même devise. `—` signale un chargement, une erreur ou un `unallocatedLabel` indisponible. Il ne remplace pas `collectedLabel` lorsque l'encaissé est connu. |
| FIN-11 | Reçu et historique | Lignes d'allocation, référence, code de vérification, annulation auditable. | Les mots techniques sont la trace lisible du surplus. | Aucune ligne financière supprimée. Le reçu continue d'exposer le montant reçu et le reliquat, même si le lexique du reliquat est HOLD. |
| FIN-12 | Navigation | Six cartes Web. Quatre KPI Mobile + compteur Non imputés. | Échec. | Tête du module : seulement Obligation, Encaissé, Reste à payer. Encaissement, recherche, reçu, historique, consultation des obligations restent. |

FIN-04 et FIN-07 sont la raison de ne pas « simplifier » le reste en soustrayant l'encaissé de l'obligation. Les deux scénarios ont le même encaissé supérieur à l'obligation, et deux restes différents selon l'affectation.

---

## 6. Tests existants à préserver

Aucun test n'est supprimé, désactivé ou affaibli par cet audit. La PR corrective ne doit pas non plus les affaiblir. Quand un test verrouille un libellé de bandeau, le commit GREEN change le libellé et l'assertion ensemble. Il ne retire pas l'assertion de montant, de devise, de tenant, de conservation ou d'Oscar.

Verrous de calcul et de contrat, intouchables :

- `backend/lib/financeDomainInvariants.test.js` — conservation, scénarios A à G, tenant, devise
- `backend/lib/financeUnallocatedCash.test.js` — Non imputé si rien n'est alloué ; Trop-perçu si reliquat après solde des cibles ; Partiel si la dette ciblée reste ouverte ; séparation Encaissé / Imputé / Non imputé
- `backend/lib/financeCalcOverpayment.red.test.js` et `backend/lib/financeCalcOverpayment.pg.test.js` — frontière Oscar, 409 si obligation ciblée déjà soldée
- `backend/lib/financeWebMobileConvergence.test.js` — dix cas F5, dont non affecté, mixte, annulation, pending, cross-tenant
- `backend/lib/financeOpenObligations.esther.test.js` — Esther, élève sans obligation
- `backend/lib/financeAllocationBalance.test.js` et `.pg.test.js`
- `backend/lib/financeRepository.pg.test.js`, `financeReadiness.http.pg.test.js`, `financeLiveRbac.http.pg.test.js`
- `backend/scripts/verify-finance-domain-invariants.js`
- `backend/scripts/verify-finance-web-mobile-convergence.js` — les gardes source exigent encore « Montant imputé » et « Montant non imputé » **sur le reçu**. Elles restent vraies tant que le reçu est HOLD. Ne pas les commenter pour faire passer un changement de bandeau.
- `backend/scripts/verify-finance-allocation-balance.js`, `verify-finance-management.js`, `verify-finance-multi-item-payment.js`
- `web/src/lib/financePaymentWrite.test.ts` — `__unallocated__` explicite, pas de solde calculé `due - paid` à l'écriture
- `web/src/lib/financeCalcOverpayment.red.test.ts` — `financePaymentStatusLabel("Partiel") === "Partiellement imputé"`
- `web/src/lib/financeObligationStatus.test.ts`
- `web/src/components/payments/PaymentReceipt.test.tsx` — Oscar n'affiche pas « Partiellement payé »
- `web/src/components/payments/QuickPaymentModal.fastStudent.test.tsx` — Esther, courses, Non imputé seulement sans obligation
- `web/src/pages/finances/FinanceUnpaidPage.fastPayment.test.tsx` — pas de Non imputé silencieux quand le solde impayé n'a pas d'obligation
- `web/src/lib/paymentCashKpi.test.ts` et `Mobile/src/lib/paymentCashKpi.test.ts` — devises séparées, brouillon exclu, champ absent ≠ 0
- `web/src/lib/paymentAmountBreakdown.test.ts` — pas de `0 USD` artificiel
- `web/src/lib/financePaymentsOverview.scope.test.ts` — 41 obligations de l'établissement, pas celles du voisin
- `Mobile/src/lib/paymentEnrollment.test.ts` — préselection, garde de génération #751
- `Mobile/src/lib/pariteL3Finance.red.test.ts` et `web/src/lib/pariteL3Finance.red.ts` — le cash n'est pas `collected - allocated` fabriqué côté client

Assertions de libellé que le commit GREEN devra accompagner, sans les effacer :

- `web/src/components/payments/FinancePaymentsOverview.test.tsx` — FIN-L3-04-C exige la présence de « Montant imputé aux obligations » pour prouver qu'il n'est pas égal à « Montant encaissé ». Après simplification, l'assertion devient : le bandeau montre Obligation, Encaissé et Reste à payer, et il ne montre plus la carte d'imputation. Le test de non-confusion des deux montants reste dans `paymentCashKpi` / `paymentAmountBreakdown`, pas dans le DOM.
- `Mobile/src/lib/studentPaymentsKpiDensity.test.ts` — exige Imputé, Reste à payer, Encaissé, Non imputé
- `Mobile/src/lib/pariteL1FinanceUx.test.ts` — « Reste dû » et « Non imputé » sur le reçu
- `web/src/lib/pariteL3Finance.red.ts` — index des libellés du composant de synthèse

---

## 7. Stratégie RED / GREEN

Deux commits dans la future PR corrective. Cette PR d'audit n'ajoute pas ces tests : les introduire ici les laisserait rouges sur `develop` sans correctif, ce que le mandat réserve à la PR de simplification. La PR finale corrective doit être verte.

### Commit RED

Ajouter des tests de présentation, sans modifier la production.

| Test nouveau | Échoue aujourd'hui parce que |
|---|---|
| FIN-12 Web | `FinancePaymentsOverview` rend « Montant imputé aux obligations » et ne rend pas le trio Obligation / Encaissé / Reste à payer |
| FIN-12 Mobile liste | `PaymentsScreen.tsx` contient « Imputé » et « Non imputés » |
| FIN-12 Mobile fiche | `StudentPaymentsScreen.tsx` contient `label="Imputé"` et `label="Non imputé"` |
| FIN-10 libellés | Les trois écrans n'utilisent pas les trois mêmes chaînes |

Les scénarios de montant FIN-01 à FIN-09 et FIN-11 sont déjà verts (§ 6). Le commit RED les relance. Il ne les réécrit pas pour les faire échouer. Un test de montant qui passerait au rouge serait une régression de l'audit, pas le signal attendu.

Les tests RED ne cherchent pas l'absence de « Trop-perçu » ou « Partiellement imputé » dans le reçu, ni l'absence de la puce « Non imputé ». Ces assertions sont interdites tant que le HOLD du § 2.2 et du § 2.3 n'est pas levé : elles forceraient un correctif qui casse #542 ou #751.

### Commit GREEN

Modifier uniquement les fichiers du § 9. Le trio s'affiche. Les cartes techniques sortent. Les tests RED passent. La suite du § 6 reste verte, y compris `verify-finance-web-mobile-convergence.js`.

Commandes de rejeu, dans cet ordre :

```bash
node --test \
  backend/lib/financeDomainInvariants.test.js \
  backend/lib/financeUnallocatedCash.test.js \
  backend/lib/financeCalcOverpayment.red.test.js \
  backend/lib/financeWebMobileConvergence.test.js \
  backend/lib/financeOpenObligations.esther.test.js \
  backend/lib/financeAllocationBalance.test.js

node backend/scripts/verify-finance-domain-invariants.js
node backend/scripts/verify-finance-web-mobile-convergence.js

npm --prefix web test -- \
  src/lib/financeObligationStatus.test.ts \
  src/lib/paymentCashKpi.test.ts \
  src/lib/paymentAmountBreakdown.test.ts \
  src/lib/parentFinance.test.ts \
  src/lib/financeCalcOverpayment.red.test.ts \
  src/lib/financePaymentWrite.test.ts \
  src/lib/financePaymentsOverview.scope.test.ts \
  src/components/payments/FinancePaymentsOverview.test.tsx \
  src/components/payments/PaymentReceipt.test.tsx \
  src/components/payments/QuickPaymentModal.fastStudent.test.tsx

npx --yes tsx Mobile/src/lib/paymentCashKpi.test.ts
npx --yes tsx Mobile/src/lib/paymentCashBreakdown.test.ts
npx --yes tsx Mobile/src/lib/paymentEnrollment.test.ts
npx --yes tsx Mobile/src/lib/studentPaymentsKpiDensity.test.ts
npx --yes tsx Mobile/src/lib/financeCurrency.test.ts
```

Les tests PostgreSQL (`*.pg.test.js`) restent dans la CI habituelle. Cet audit ne les a pas rejoués : ils exigeraient une base, et le mandat interdit toute écriture durant l'audit.

---

## 8. Risques comptables et régressions

| Risque | Pourquoi | Parade |
|---|---|---|
| Reste = Obligation − Encaissé | FIN-04 et FIN-07 deviennent faux. Un surplus s'affiche négatif ou une dette disparaît alors que le cash n'est pas affecté. | Lire `remainingLabel`. Test de non-régression sur les deux scénarios déjà verts. |
| Supprimer `payment_allocations` ou les statuts « Non imputé » / « Trop-perçu » / « Partiel » | Perte de traçabilité, triggers F4 cassés, reçus historiques illisibles. | Aucun fichier `backend/db` ni `financeUnallocatedCash.js` dans la PR corrective. |
| Remplacer « Partiellement imputé » par « Partiellement payé » | Réouvre Oscar (#542) : l'utilisateur lit une créance partielle alors que l'obligation ciblée est soldée et que le reste est un surplus. | Ne pas toucher `financePaymentStatusLabel` dans la PR des trois KPI. |
| Retirer la puce « Non imputé » | Élève sans dette : encaissement impossible, ou retour de la conversion silencieuse `obligationId` manquant → Non imputé, interdite par F5. Cas Esther inversé si la préselection retombe sur la puce alors qu'une dette existe. | La puce reste. Les tests Esther et IMP-FAST restent verts. |
| Afficher `getPaymentCashKpi` | `unallocatedAmount ?? 0` transforme un non-affecté absent en zéro. | Continuer `formatPaymentCashAmounts`. `unallocatedLabel` vaut `—` si ce champ manque. `collectedLabel` reste le total encaissé comptabilisé. |
| Additionner CDF et USD | Interdit par FIN-L3. | Ne pas remplacer les seaux par un scalaire. |
| Afficher une erreur comme 0 | Le mandat l'interdit. Les écrans Mobile utilisent déjà `—` et `QueryStateView`. | Le test FIN-12 couvre l'état d'erreur, pas seulement le rendu nominal. |
| Confondre « Montant alloué aux impayés ouverts » avec Encaissé | Le premier est `amountPaid`. Le second est le cash. | Le détail Impayés ne change pas de source. |
| Taux de paiement lu comme Encaissé / Obligation | Le numérateur est `amountPaid` plafonné, et le commentaire dit « encaissé ». | Retirer le taux du hero Paiements. Ne pas recalculer le taux avec le cash. |
| Divergence des copies Web / Mobile | Deux fichiers `paymentAmountBreakdown.ts`, deux `paymentCashKpi.ts`, deux `financeObligationStatus.ts`. | Pas de troisième implémentation. Les tests de parité L3 restent dans la commande de rejeu. |
| Export CSV | La colonne Statut suit `financePaymentStatusLabel`. | HOLD du lexique de statut = export inchangé. |
| Badge carte élève | Un cash non affecté doit rester « situation à vérifier », pas une échéance. | `studentCardFinance.js` hors PR. |
| RBAC | Les scripts `verify-finance-management.js` prouvent qui peut enregistrer un Non imputé (comptable, directeur, secrétaire, scolarité). | Aucun changement de rôle ni de périmètre. |
| `paymentTransactionService.js` | Second calcul local d'`overpaymentAmount`, hors autorité PostgreSQL. | Ne pas le brancher sur le bandeau. Ne pas le supprimer au passage. |

---

## 9. Fichiers de la PR corrective

### À modifier

- `web/src/components/payments/FinancePaymentsOverview.tsx`
- `web/src/pages/finances/ParentFinancePage.tsx`
- `web/src/pages/ParentDashboardPage.tsx` (détail de la tuile, ligne 266)
- `web/src/components/payments/FinancePaymentsOverview.test.tsx`
- `Mobile/src/screens/PaymentsScreen.tsx`
- `Mobile/src/screens/StudentPaymentsScreen.tsx`
- `Mobile/src/screens/HomeScreen.tsx` (libellé « À percevoir » → « Reste à payer » seulement)
- `Mobile/src/screens/UnpaidScreen.tsx` (libellé « Reste dû » → « Reste à payer » seulement)
- `Mobile/src/lib/studentPaymentsKpiDensity.test.ts`
- `Mobile/src/lib/studentSubScreensSpec.ts`
- `Mobile/src/lib/pariteL1FinanceUx.test.ts` et `Mobile/src/lib/pariteL2Finance.red.test.ts` si « Reste dû » change
- `web/src/lib/pariteL3Finance.red.ts` pour le nouveau bandeau
- Nouveaux tests FIN-12 / FIN-10 de présentation, commit RED puis commit GREEN

`web/src/pages/finances/FinanceUnpaidPage.tsx` : seulement si le libellé « Montant attendu » du détail est aligné sur « Obligation ». La source `amountExpected` ne change pas. « Montant alloué aux impayés ouverts » reste.

### À ne pas modifier

- `backend/**`
- `backend/db/**`, `backend/db/migrations/**`, `backend/db/schema.sql`
- `backend/lib/financeUnallocatedCash.js`
- `backend/lib/financeDomainInvariants.js`
- `backend/lib/financeService.js`
- `backend/lib/financeWebMobileWriteContract.js`
- `backend/lib/financeManagement.js`
- `backend/scripts/verify-finance-*.js`
- `web/src/lib/financePaymentWrite.ts`
- `web/src/lib/financeObligationStatus.ts`
- `Mobile/src/lib/financeObligationStatus.ts`
- `Mobile/src/lib/paymentEnrollment.ts`
- `Mobile/src/components/PaymentMutationControls.tsx`
- `web/src/components/payments/QuickPaymentModal.tsx` (option et prévisualisation HOLD)
- `web/src/components/payments/PaymentReceipt.tsx`
- `Mobile/src/components/PaymentReceiptCard.tsx`
- `web/src/pages/entity-page/entityColumns.tsx`
- `backend/lib/studentCardFinance.js`
- Tout test d'invariant listé au § 6, sauf accompagnement explicite d'un libellé de bandeau

---

## 10. Preuves d'audit exécutées sur ce SHA

Environnement : dépendances Web installées localement pour Vitest (`npm ci --prefix web --ignore-scripts`). Aucune base PostgreSQL ouverte. Aucune donnée financière écrite.

| Commande | Résultat |
|---|---|
| `node --test` sur `financeUnallocatedCash.test.js`, `financeDomainInvariants.test.js`, `financeCalcOverpayment.red.test.js`, `financeAllocationBalance.test.js` | 49 tests, 0 échec |
| `node backend/scripts/verify-finance-domain-invariants.js` | GO. Scénarios A–G, tenant, devise. |
| `node backend/scripts/verify-finance-web-mobile-convergence.js` | GO. Gardes source, 17 tests mémoire F5 / Esther, 24 tests Web, `test:payment-enrollment` Mobile. |
| Vitest Web : obligation status, cash KPI, amount breakdown, parent finance, overpayment, payment write, scope overview, overview, receipt, quick payment Esther | 10 fichiers, 49 tests, 0 échec |
| `tsx Mobile/src/lib/paymentCashKpi.test.ts` | OK. Pending / refusé / échoué / brouillon exclus. 150 non imputés comptés à part. |
| `tsx Mobile/src/lib/paymentCashBreakdown.test.ts` | PASS FIN-L3-04 |
| `tsx Mobile/src/lib/studentPaymentsKpiDensity.test.ts` | OK |
| `tsx Mobile/src/lib/financeCurrency.test.ts` | OK |
| `tsx Mobile/src/lib/paymentEnrollment.test.ts` | OK |

Premier passage de `verify-finance-web-mobile-convergence.js` avant `npm ci` Web : gardes source et tests mémoire verts, puis échec `127` (`vitest: not found`). Ce n'est pas un échec métier. Le rejeu après installation est GO.

Non exécuté, et non requis pour cet audit documentaire : tests `*.pg.test.js`, parcours navigateur, Mobile natif. L'audit ne change aucune surface rendue.

---

## 11. Découpage

| PR | Contenu | Statut |
|---|---|---|
| PR 1, celle-ci | Rapport d'audit | DRAFT / HOLD |
| PR 2 | Trois indicateurs Web et Mobile, tests RED puis GREEN | Après diff CTO de cette PR. Aucun Backend. |
| PR 3 | Seulement si le CTO valide un lexique de reçu, d'historique et d'option d'encaissement | Non ouverte. Non recommandée tant que le contrat d'encaissement n'est pas écrit. |

FIN-SIMPLE-01 — CORRECTIONS DOCUMENTAIRES TERMINÉES — EN ATTENTE DU RE-DIFF CTO.

DRAFT / HOLD. Pas de Ready. Pas de merge.
