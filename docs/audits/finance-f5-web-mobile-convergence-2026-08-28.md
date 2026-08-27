# Finance F5 — Convergence Web ↔ Mobile — 2026-08-28

**Type :** convergence clients. Pas de nouvelle table. Pas de nouveau calcul d’autorité. Pas de F6 RBAC. Pas de F7 redesign.  
**Repo :** `Somafrik-education/Somafrik`  
**Base :** `origin/develop@4399f21bf53997f59eb53ea82e41ac55ce4c3fdc` (SHA attendu, inchangé)  
**Branche :** `cursor/finance-f5-web-mobile-convergence-9855`  
**F1–F4 :** mergés. F5 consomme leurs contrats.

```text
FINANCE F5 WEB↔MOBILE = attente revue CTO indépendante
PR      DRAFT
Ready   NON
Merge   NON
F6      NON OUVERT
F7      NON OUVERT
```

Gate : `npm run verify:finance-web-mobile-convergence`

---

## Matrice avant / après Web ↔ Mobile

| Sujet | Web avant | Mobile avant | Après F5 |
|---|---|---|---|
| Imputation | `items[{ feeType, amount }]` sans `obligationId` (QuickPayment) | `obligationId` si frais choisi, sinon `feeType: ""` | `{ obligationId, amount }` ou `{ feeType: "Non imputé", amount }` |
| FIFO / matching type | `computeFeeBalance` + `matchesPaymentFeeType` / minerval | `isOpenObligation` recalcule `due-paid-exempt` | Lecture `balance` serveur uniquement |
| Catalogue moyens | `/finance/catalog` (déjà fail-closed) | `/finance/catalog` | Inchangé, toujours fail-closed |
| Liste élèves paiement | `/finance/payment-student-options` | Options + fallback `GET /students` (StudentPayments) | `payment-student-options` uniquement |
| Outbox Finance | n/a | `persistOutbox: true` POST `/payments` | Interdit. Hors connexion = refus |
| Non imputé | Reçu seulement si leftover > 0 | KPI « Non imputé » | Montant reçu / imputé / non imputé sur les deux |
| Annulation | `POST /payments/:id/cancel` + refresh | Idem, online-only | Inchangé + refetch projection |
| EntityPage create | POST feeType-only encore vivant | n/a | Refus explicite, QuickPayment obligatoire |
| Pending | Statut serveur affiché | KPI exclut pending | Même lecture, pas compté comme payé |

---

## Endpoints consommés (identiques)

```text
GET  /api/finance/payment-student-options
GET  /api/finance/catalog
GET  /api/finance/student-fees
GET  /api/payments
POST /api/payments
POST /api/payments/:id/cancel
```

Aucun client n’appelle `GET /students` pour contourner le RBAC Comptable.  
Aucun client n’écrit une outbox Finance.

---

## Écrans concernés

**Web**

- `QuickPaymentModal` — création multi-obligations + Non imputé
- `EntityPage` paiements — liste, reçu, annulation ; création générique bloquée
- `PaymentReceipt` — reçu / imputé / non imputé depuis la projection serveur

**Mobile**

- `PaymentsScreen`
- `StudentPaymentsScreen`
- `PaymentMutationControls` (équivalent QuickPayment)
- `PaymentCancelControls`

Hors F5 (F7) : fiche élève Web « Coming soon », polish Impayés, redesign KPI.

---

## Duplications / calculs client retirés

| Retrait | Où |
|---|---|
| POST feeType-only | `QuickPaymentModal`, `EntityPage` |
| Fallback `GET /students` | `StudentPaymentsScreen` |
| Outbox `payments` | `OUTBOX_ALLOWED_DOMAINS`, `OutboxRuntime`, inventory |
| `balance = due - paid - exemption` | `paymentEnrollment.isOpenObligation`, `normalizeStudentFeeRow` |
| `unallocated = collected - allocated` inventé | `paymentCashKpi` |
| Catalogue fee types comme clé d’imputation | `QuickPaymentModal` |

Conservé hors autorité (documenté, pas branché sur l’encaissement scolaire) :

- `web/src/lib/quickPayment.ts` `computeFeeBalance` / `DEFAULT_FEE_AMOUNTS` / `PAYMENT_METHODS` — encore utilisés par abonnements / workflow local, **pas** par QuickPayment F5
- `web/src/lib/fees.ts` `refreshStudentFeeStatuses` — grilles locales hors parcours encaissement
- `AdminCrudScreen` liste méthodes — `canRunGenericAdminCrud("payments") === false`

---

## Flux paiement final

```text
Élève (payment-student-options)
  → classe d'inscription active
  → projection GET /finance/student-fees
  → une ou plusieurs lignes { obligationId, amount }
  → ligne Non imputé pour le reste
  → moyen issu du catalogue serveur
  → POST /payments
  → affichage allocatedAmount / unallocatedAmount / status serveur
```

Invariant conservé (F4) :

```text
Σ allocations + Non imputé = montant reçu
```

Surpaiement : le client envoie le montant saisi + `obligationId` ; le serveur alloue `min(solde, montant)` et place le reste en Non imputé. Aucun client ne décide.

---

## Flux annulation

```text
POST /payments/:id/cancel { reason }
  → allocations reversed_at
  → projection obligation restaurée
  → reçu conservé (statut Annulé)
  → refetch GET /payments + GET /finance/student-fees
```

Aucun `splice` local de la liste pour représenter l’annulation.

---

## Non imputé

Concept unique, libellé unique : **Non imputé**.  
Jamais « Acompte », « Autre », « Solde créditeur », « Trop-perçu » dans le parcours d’encaissement F5.

Un encaissement sans `obligationId` est **toujours** sérialisé `{ feeType: "Non imputé", amount }`.  
`Acompte` reste interdit comme type de frais (F1/F2).

---

## Pending

Un paiement `pending` / « En attente de confirmation » (Mobile Money) :

- n’entre pas dans Encaissé / Imputé / Non imputé côté KPI Mobile (`isCountedMobileCashPayment`)
- n’est pas présenté comme Payé
- l’intégration opérateur Mobile Money reste hors scope F5

Écart F4 résiduel (mémoire) : `createPayment` peut encore allouer avant de poser le statut pending. PostgreSQL refuse une allocation sur paiement `pending` (`FINANCE_PAYMENT_NOT_SETTLED`). Les clients n’inventent pas la répartition.

---

## Offline fail-closed

```text
lecture offline      : seulement si déjà RC2
mutation Finance     : interdite hors connexion
outbox Finance       : absente
```

Mobile : `isOfflineContext()` → message « Paiement hors connexion refusé. Aucune file Finance. »  
`createSchoolPayment` n’est plus dispatché par `OutboxRuntime`.

---

## Contrats API consommés

| Contrat | Source |
|---|---|
| Fee type = référentiel | F2 `persistableFeeType` |
| Obligation = dette | F3 `student_fee_obligations` |
| Allocation = imputation | F4 `payment_allocations` |
| `FINANCE_OBLIGATION_ID_REQUIRED` | F4 |
| Conservation `allocated + unallocated = amount` | F1/F4 |
| Catalogue méthodes | `/finance/catalog` |
| Options élève Comptable | `/finance/payment-student-options` |

---

## Divergences restantes F6 (RBAC — non ouvertes)

- Parité des **droits live PostgreSQL** Comptable / Secrétaire / Directeur entre Web et Mobile : F5 n’élargit aucune permission.
- `AdminCrudScreen` reste un écran générique hors paiements ; F6 s’il faut auditer d’autres entités.
- Parent / élève : surfaces de lecture différentes (hors F5).

---

## Divergences restantes F7 (UX — non ouvertes)

- Fiche situation financière élève Web encore « Coming soon »
- Densité / polish des chips Mobile vs tableau Web
- Impayés Web (`unpaidModule`) agrège encore une projection locale
- `fees.ts` / `computeFeeBalance` legacy hors encaissement
- Redesign reçu, raccourcis montants, multi-devise présentation

---

## Tests

- `backend/lib/financeWebMobileConvergence.test.js` — scénarios 1–8, 10–11 + surpaiement
- `web/src/lib/financePaymentWrite.test.ts`
- `Mobile/src/lib/paymentEnrollment.test.ts`
- Source guards : scénarios 9 (pas de fallback catalogue) et 12 (offline fail-closed)

---

## GO F5

Déclaré **NON**. Attente revue CTO indépendante du HEAD exact. Ready NON. Merge NON.
