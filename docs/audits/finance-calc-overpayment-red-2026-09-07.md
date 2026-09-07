# Audit RED — calculs paiement / imputation / trop-perçu

Date : 2026-09-07  
Base : `develop@b1c904b27527efe5a04f64cb3ba46eb7c71b1edc`  
Incident : `CD-IN-26-001-2026-PAY-0006` / Oscar Mukwege / 2 CDF / statut UI « Partiellement payé »

**Aucun runtime modifié.** Lecture seule. Aucune donnée de production touchée (`DATABASE_URL` absent dans cet environnement).

---

## 1. Cas Oscar — reconstitution par le chemin de code

Le paiement de production n'a pas été lu (script `backend/scripts/audit-finance-oscar-readonly.js` : SKIP).  
La reconstitution suit `createPayment` → `allocateAmount` → `assertPaymentConservation` → `resolvePaymentStatus` → `insertPayment` → `projectPaymentCash` → `GET /api/payments` → `financePaymentStatusLabel`.

Équation du scénario métier (reste 1 CDF, encaissement 2 CDF), mesurée sur le store mémoire (FIN-CALC-RED-001, **avant** l'assertion de statut) :

```text
Dette avant paiement = 1 CDF
Montant encaissé      = 2 CDF
Montant imputable     = 1 CDF   (min(reste, encaissé))
Montant imputé réel   = 1 CDF   (allocateAmount plafonne déjà)
Trop-perçu            = 1 CDF   (leftover / unallocatedAmount)
Solde après paiement  = 0 CDF
Statut obligation     = Payé
Statut paiement DB    = Partiel     ← resolvePaymentStatus
Statut projection     = Partiel     ← presentPaymentStatus
Statut UI Paiements   = Partiellement payé  ← financePaymentStatusLabel
```

`amount_paid` persisté = `SUM(payment_allocations.amount WHERE reversed_at IS NULL)` dans le store mémoire (RED-001, assertion atteinte avant le statut).

---

## 2. Table causale « Partiellement payé »

| Niveau | Valeur Oscar (reste 1, payé 2) |
| ------ | ------------------------------- |
| Montant reçu | 2 CDF |
| Dette avant paiement | 1 CDF |
| Imputé | 1 CDF |
| Non imputé | 1 CDF |
| Balance obligation | 0 CDF |
| Statut obligation | Payé |
| Statut `payments` (écriture) | `Partiel` |
| `profile_payload.status` | même `Partiel` (copie du paiement) |
| `projectPaymentCash.status` | `Partiel` (leftover > 0) |
| Statut envoyé par API | `Partiel` |
| Statut affiché Web | **Partiellement payé** |

```text
Le "Partiellement payé" provient de :
[file]      backend/lib/financeUnallocatedCash.js
[fonction]  resolvePaymentStatus / presentPaymentStatus
[condition] allocated > 0 && leftover > 0  →  PARTIAL_STATUS = "Partiel"
            puis leftover > 0 à la lecture → encore "Partiel"
[file]      web/src/lib/financeObligationStatus.ts
[fonction]  financePaymentStatusLabel
[condition] value.includes("partiel") → "Partiellement payé"
[valeurs]   amount=2 allocated=1 leftover=1 remainingAfter=0 obligation.status=Payé
```

La table **Paiements** (`entityColumns.tsx` clé `status`) affiche `payment.status`, pas `obligation.status`.  
L'utilisateur lit un **vocabulaire de créance** (« Partiellement payé ») pour un **encaissement partiellement imputé**.

---

## 3. Trois plans de statut (aujourd'hui fusionnés)

| Plan | Valeurs métier | Où c'est stocké aujourd'hui |
| ---- | -------------- | --------------------------- |
| A. Obligation | À payer / Partiellement payé / Payé / En retard / Exonéré / Annulé | `student_fee_obligations.status` (correct pour Oscar : Payé) |
| B. Imputation du paiement | Entièrement imputé / Partiellement imputé / Non imputé | **absent** — compressé dans `payments.status = Partiel` |
| C. Transaction | Confirmé / En attente / Annulé | `payments.status` / `payment_status` |

Règle actuelle à ne **pas** modifier en RED :

```text
0 < imputé < encaissé → « Partiel », jamais « Payé »
```

(`financeUnallocatedCash.js` L8–L9, L47–L48, L59–L60)

Elle décrit correctement un **paiement partiellement imputé**, pas une **obligation partiellement payée**.

---

## 4. Conservation et plafonnement

Déjà vrais sur le chemin d'écriture (tests 008–010, 002–003, 007 verts) :

- `ENCAISSÉ = IMPUTÉ + NON IMPUTÉ` (`assertPaymentConservation`)
- `allocation <= balance avant`
- `balance = max(0, dû − imputé − exonération)` — pas de solde négatif
- pas de FIFO quand un seul `obligationId` est fourni (RED-007 vert)
- annulation restaure la dette une seule fois (RED-011 vert)
- retry `Idempotency-Key` mémoire : 1 paiement / 1 allocation (RED-012 vert)

**Le calcul d'imputation du trop-perçu V1 n'avale pas le 2ᵉ CDF dans `amountPaid`.**  
Le défaut Oscar n'est pas un solde négatif ; c'est la **fusion des statuts** + le **libellé Web**.

---

## 5. Classification

### P0

Aucun constaté dans cet audit RED :

- pas de double imputation sur retry HTTP mémoire
- pas d'argent perdu (conservation)
- pas de tenant leak exercé ici

### P1

1. **Statut paiement « Partiel » présenté comme créance « Partiellement payé »**  
   - cause : un seul champ `status` + `financePaymentStatusLabel`  
   - fichiers : `financeUnallocatedCash.js` (`resolvePaymentStatus`, `presentPaymentStatus`) ; `financeObligationStatus.ts` (`financePaymentStatusLabel`) ; `entityColumns.tsx`  
   - tests : FIN-CALC-RED-001, 004, 005, 014, 015  
   - impact : Oscar soldé à 0 CDF apparaît « Partiellement payé » dans Paiements  
   - correction envisagée (ne pas implémenter) : séparer `obligationSettlementStatus` / `allocationStatus` / `transactionStatus` ; ne plus mapper `Partiel` → `Partiellement payé` ; si `remainingAfter === 0` et leftover = trop-perçu, ne pas utiliser le vocabulaire de créance partielle

2. **Nouveau paiement ciblant une obligation déjà `Payé` → 409 `OBLIGATION_NOT_OPEN`**  
   - cause : `openObligationsForItem` refuse `status === Payé`  
   - fichier : `financeService.js` `isOpenObligation` / `openObligationsForItem`  
   - test : FIN-CALC-RED-006  
   - impact : impossible d'encaisser 10 CDF en non imputé sur une dette soldée si l'UI renvoie encore l'`obligationId`  
   - correction envisagée : si balance = 0, traiter le montant comme Non imputé (imputé 0) au lieu de rejeter, **ou** forcer l'UI à envoyer `Non imputé` sans `obligationId`

### P2

- Libellé seul : si l'on se contentait de renommer `Partiel` → « Partiellement imputé » sans séparer les plans A/B/C, le modèle resterait ambigu. **Ne pas faire un correctif local de libellé.**

---

## 6. Memory vs PostgreSQL

- Mémoire : suite FIN-CALC-RED-001..014 exécutée.  
- PostgreSQL HTTP : `DATABASE_URL` absent → `financeCalcOverpayment.pg.test.js` SKIP. Fichier ajouté pour la CI qui a une base.  
- Oscar prod : non lu.

---

## 7. Proposition de correction (ne pas implémenter)

1. Conserver `allocateAmount` (plafond déjà correct).  
2. Introduire un statut d'imputation distinct (`Partiellement imputé`) sans écraser `obligation.status = Payé`.  
3. `presentPaymentStatus` : leftover après solde intégral des cibles ≠ « obligation partielle ».  
4. Web : ne plus traduire `Partiel` par `Partiellement payé`.  
5. Décider RED-006 (409 vs non imputé automatique) avant le GREEN.
