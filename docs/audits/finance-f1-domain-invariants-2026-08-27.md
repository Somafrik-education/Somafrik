# Finance F1 — Invariants métier canoniques — 2026-08-27

**Type :** contrat + tests purs. Pas de migration. Pas de nouvelle table. Pas de nouveau vocabulaire de frais. Pas de nouveau calcul Web/Mobile.  
**Source normative :** #362 `docs/audits/go-prod-finance-business-domain-audit-2026-08-27.md`  
**Branche :** `cursor/finance-f1-domain-invariants-9855`  
**Base :** `origin/develop@12472bd3`

```text
FINANCE BUSINESS MODEL = NO-GO   (inchangé)
FINANCE F1 INVARIANTS            = (gate ci-dessous)
```

Module : `backend/lib/financeDomainInvariants.js`  
Tests : `backend/lib/financeDomainInvariants.test.js` (scénarios A–G + tenant)  
Gate : `npm run verify:finance-domain-invariants`

Les fonctions de caisse/solde **existantes** (`financeUnallocatedCash`, `obligationStatus`) délèguent au contrat.  
`projectObligationPaidAmounts` conserve `max(colonne, Σ allocations)` — écart lecture actuel, migration F4.

---

## Vocabulaire F1

| Concept | Signification | N’est pas |
|---|---|---|
| FEE_TYPE | Catégorie métier (Scolarité, Inscription, …) | Un montant, un acompte |
| FEE_ITEM | Tarif concret d’une grille | La dette élève |
| FEE_OBLIGATION | Snapshot « cet élève doit X pour Y » | Un paiement |
| PAYMENT | Argent réellement encaissé | Un tarif |
| PAYMENT_ALLOCATION | Quelle part d’un paiement règle quelle obligation | Un calcul UI |
| UNALLOCATED_AMOUNT | Encaissé non encore affecté | Un type de frais |

**Acompte** = allocation partielle. Interdit comme FEE_TYPE canonique (`assertNotCanonicalFeeType`).

---

## Identités minimales (pas un libellé)

| Objet | Identité |
|---|---|
| Fee item | schoolId, feeGridId, feeType, academicYear, class scope, amount, due rule |
| Obligation | schoolId, studentId, academicYear, sourceFeeItemId, feeType, period, amountDue, dueDate |
| Payment | schoolId, studentId, paymentId, amount, currency, method, paidAt, authorUserId |
| Allocation | schoolId, paymentId, obligationId, amount, reversedAt |

---

## Invariants

| ID | Invariant | Justification | Source PG actuelle | État actuel | Cible | PR |
|---|---|---|---|---|---|---|
| A | Config ≠ dette | Un barème n’est pas ce qu’un élève doit | `fee_grids`, `school_fee_items` vs `student_fee_obligations` | Apply manuel crée les dettes | Inchangé F1 ; naissance F3 | F3 |
| B | Obligation ≠ paiement | L’encaissement ne définit pas un tarif | `payments` / `payment_items` vs obligations | Create payment n’insert pas de fee_item | Conserver | F4 |
| C | Allocation = unique autorité d’imputation | Web/Mobile ne doivent pas recalculer | `payment_allocations` | Web feeType FIFO vs Mobile obligationId | Contrat F1 ; clients F4/F5 | F4/F5 |
| D | amount = Σ alloc actives + unallocated | Conservation de caisse | allocations + `profile_payload` | Vrai à l’écriture ; snapshot JSON | `assertPaymentConservation` | F4 colonne éventuelle |
| E | balance = max(0, dû − paid − exemption) | Une formule | `amount_due`, `exemption`, alloc | Discount **hors** formule ; lecture `max(colonne, alloc)` | Paid = Σ alloc (F4) | F4 |
| F | Cancel = persisté + reverse + hors encaissement | Pas de DELETE | `cancelled_at`, `reversed_at` | API cancel OK | Conserver | — |
| Devise | V1 mono-devise / établissement | Une transaction = devise école | `countries.currency`, profil école, colonnes | FC/USD/CDF d’affichage | FC = présentation CDF | F5 affichage |
| Année | Obligation historique | Grille 2027-28 ≠ dette 2026-27 | `academic_year` TEXT + snapshot `amount_due` | Dû gelé ; items grille remplacés | FK année F2 | F2/F3 |
| Classe | Paiements/alloc/soldés immuables au changement de classe | Histoire financière | `payments.class` payload ; obligation.class_id NULL | Politique futures F3 | F3 |
| Tenant | payment.schoolId = alloc.schoolId = obligation.schoolId | Isolation | `school_id` sur les 3 tables | Triggers items ; assert F1 | Ne pas assouplir |

---

## Formules

```text
allocated     = SUM(allocations WHERE NOT reversed)
unallocated   = MAX(0, payment.amount − allocated)
payment.amount = allocated + unallocated

paidAmount    = SUM(allocations actives de l'obligation)   // cible
balance       = MAX(0, amountDue − paidAmount − exemptionAmount)
discount      = hors V1 formule
```

Paiement **financièrement actif** : non annulé (`cancelledAt` / statut Annulé|cancelled).  
Annulé : hors payé, hors encaissement ; ligne PG conservée.

---

## Devise V1 — classification (pas de migration F1)

| Token | Rôle autorisé | Autorité ? |
|---|---|---|
| `CDF` | Devise canonique de stockage (ex. RDC) | Oui, via pays / école |
| `FC` | Libellé de présentation éventuel | **Non.** Alias → `CDF` |
| `USD` | Devise d’établissement si le pays/école l’est | Oui seulement si c’est la devise école |
| `EUR` | Abonnements / back-office, hors caisse élève V1 | Hors Finance établissement |

V1 = **mono-devise par établissement**. Une transaction Finance d’un établissement doit porter la devise canonique de cet établissement.  
F1 n’ajoute pas d’autorité concurrente (`PRESENTATION_CURRENCY_ALIASES` seulement). Defaults `USD` dans `web/src/lib/fees.ts` / `backend/server.js` et suffixe Mobile `FC` : copies à remplacer F5, pas à étendre.

---

## Contrat d’encaissement Web / Mobile (F1 formalise, F4/F5 migre)

| Surface actuelle | Contrat | Verdict |
|---|---|---|
| Web QuickPayment | `feeType` seulement → matching serveur FIFO / ambigu | **Interdit à terme** |
| Mobile PaymentMutation | `obligationId` → allocation déterministe | **Cible** |
| Cible unique | Les deux passent l’identité canonique de l’obligation | F4/F5 |

F1 teste le contrat (`assertAllocationTenant`, conservation, obligation id dans les identités). Aucun client n’est migré ici.

---

## Copies à remplacer (pas dans F1)

- `web/src/lib/fees.ts` `computeStudentFeeStatus` / `studentFeeSummary`
- `web/src/lib/paymentRateKpi.ts` et copie Mobile
- `web/src/lib/quickPayment.ts` `computeFeeBalance` (+ `DEFAULT_FEE_AMOUNTS`)
- `Mobile/src/lib/paymentEnrollment.ts` solde local
- `Mobile/src/domain/metrics/schoolMetrics.ts` taux sur nombre de reçus
- Fallback Mobile `feeType: "Acompte"`

---

## Scénarios de référence

A 30k/30k → balance 0, unallocated 0  
B 10k/30k → balance 20k, partiel  
C 50k/30k → balance 0, unallocated 20k  
D un paiement 50k, deux alloc 30+20 → unallocated 0  
E cancel → alloc reversed, dette 30k, paiement auditable  
F alloc 60k sur paiement 50k → CONSERVATION_VIOLATION  
G négatif / NaN / CDF vs USD → refus  
Tenant A vs B → TENANT_MISMATCH  

---

## Hors périmètre F1 (rappel)

Vocabulaires de types F2 · naissance obligation / classe / tarif F3 · clients Web/Mobile F4/F5 · réductions/pénalités/remboursement · RBAC F6 · UX F7.

---

## Verdict F1

À remplir après `verify:finance-domain-invariants` + Gates PR.

Local (`verify:finance-domain-invariants`) : **GO**.

```text
Domain vocabulary          UNIQUE (contrat ; 3 listes UI encore présentes → F2)
Payment conservation       PROUVÉ (tests A–D, F)
Balance formula            UNIQUE (module ; copies clients → F5)
Cancellation semantics     UNIQUE (E + isPaymentFinanciallyActive)
Currency invariant         DOCUMENTÉ (V1 mono-devise ; FC ≠ storage)
Academic history invariant DOCUMENTÉ
Cross-tenant invariant     PROUVÉ (assertAllocationTenant)
Nouvelle duplication       0
```
