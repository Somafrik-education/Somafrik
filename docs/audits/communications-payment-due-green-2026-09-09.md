# Lot L3 GREEN — PAYMENT_DUE outbox C4

**Date :** 9 septembre 2026  
**Branche :** `cursor/communications-payment-due-d98a`  
**Base :** `develop@a70ddc3a6ec2e3d07dd0929106e2e1cd67804f3c` (post #566 L2 REPORT_CARD_PUBLISHED)  
**PR :** Draft — pas Ready, pas merge autonome

---

## SoT Finance identifié

| Champ | Valeur |
|---|---|
| **Table SoT** | `student_fee_obligations` |
| **PK** | `id` (UUID) |
| **Tenant** | `school_id` |
| **Élève** | `student_id` |
| **Montant initial** | `amount_due` |
| **Payé** | `amount_paid` (projection allocations via trigger F4) |
| **Solde** | `balance` |
| **Échéance** | `due_date` (DATE métier) |
| **Statuts** | `À payer`, `Partiellement payé`, `En retard`, `Payé`, `Exonéré`, `Annulé` |
| **Annulation** | `archived_at`, `cancelled_at` |
| **Exonération** | `exemption` |

**Verdict SoT :** durable — pas de STOP P1 architecture.

---

## Définition exacte PAYMENT_DUE

Une obligation produit `finance.payment.due` lorsque le balayage idempotent détecte :

```text
archived_at IS NULL
AND cancelled_at IS NULL
AND balance > 0
AND due_date IS NOT NULL
AND due_date < CURRENT_DATE   -- aligné financeSchema (jour J exclus)
AND status NOT IN ('Payé', 'Exonéré', 'Annulé')
```

**Non déclencheurs :** paiement reçu, facture créée seule, consultation solde, échéance future, obligation soldée/exonérée/annulée.

**Paiement partiel :** si `balance > 0` à l’échéance → 1 événement (statut `Partiellement payé` ou `En retard`).

**Premier passage uniquement :** pas de relance J+3/J+7 dans ce lot.

---

## Correction P1 (course sweep/paiement)

Module partagé `communicationsPaymentDueEligibility.js` :

- `isPaymentDueEligible()` — utilisé par sweep SQL (`paymentDueEligibleSqlConditions`) et `eventSpec()` au drain
- Si obligation plus éligible à la consommation : 0 recipient, 0 notification, outbox `processed` sans erreur
- Tests RED-PD-17 (sweep → paiement → drain) et RED-PD-18 (outbox + paiement concurrent)

Body neutralisé P2 : « Un paiement scolaire est arrivé à échéance. »

---

## Mécanisme temporel / scheduler

Aucun cron Finance dédié n’existait. Le producteur s’appuie sur le **worker C4 canonique** (`communicationsNotificationsWorker.runOnce`) :

```text
sweepPaymentDueOutbox (INSERT idempotent ON CONFLICT)
→ drainOutbox
→ dispatchProcessedEvents
```

- Idempotent : `event_key` UNIQUE + `NOT EXISTS` + `ON CONFLICT DO NOTHING`
- Reprise après crash : prochain cycle worker
- Concurrence multi-workers : une seule ligne outbox par obligation
- `referenceDate` paramétrable en tests (DATE métier, pas UTC arbitraire)

---

## RED initial observé (develop@a70ddc3a)

Aucun producteur `finance.payment.due` : balayage absent, mapping Lot I absent, handler `processOneEvent` absent.

---

## Architecture GREEN

| Composant | Changement |
|---|---|
| **Sweep** | `communicationsPaymentDueSweep.js` |
| **event_type** | `finance.payment.due` |
| **event_key** | `finance.payment.due:<student_fee_obligation_id>` |
| **processOneEvent** | PARENT + SCHOOL_ADMIN, titre « Paiement arrivé à échéance » |
| **Dispatcher** | `"finance.payment.due": ["PUSH","EMAIL"]` |
| **Lot I map** | `"finance.payment.due" → PAYMENT_DUE` |
| **Worker** | sweep avant drainOutbox |

Pas de migration SQL (pas de trigger partagé modifié).

---

## Destinataires

Lot I : **PARENT** + **SCHOOL_ADMIN** (`schoolNotificationPolicy.js`).

---

## Legacy unpaidService

| Question | Réponse |
|---|---|
| Encore actif ? | Oui (liste impayés + relances manuelles HTTP) |
| Rappels auto ? | Non — relance manuelle admin uniquement |
| Double-write PAYMENT_DUE ? | Non — PG `createReminder` → `payment_reminders` seulement |
| Écrit `state.notifications` ? | Uniquement chemin mémoire legacy `UnpaidService.sendReminder` |
| Neutralisé ce lot ? | Non requis — flux automatique C4 disjoint des relances manuelles |

---

## Non-régression

- `finance.payment.recorded` / PAYMENT_RECEIVED : intact (trigger payments)
- L1 STUDENT_LATE, L2 REPORT_CARD_PUBLISHED : non modifiés

---

## AUDIT-COM-FINAL après lot

| Avant | Après |
|---|---|
| 6/9 Lot I câblés | **7/9 câblés** |
| missing: PD + TT + TR | missing: TIMETABLE_CHANGED, TEACHER_REPLACEMENT |

**Verdict Communications global : HOLD — 7/9**

---

## Tests

| Suite | Contrats |
|---|---|
| `communicationsPaymentDue.red.test.js` | RED-PD-01 → 16 |
| `communicationsFinal.audit.test.js` | 7/9 |

---

## P0 / P1 / P2 (lot)

| Classe | Lot L3 |
|---|---|
| P0 | 0 |
| P1 lot | 0 (course sweep/paiement corrigée) |
| P1 Communications global | 1 (2/9 restants) |
| P2 | inchangé |

**Verdict lot L3 : GO** (sous réserve CI verte et review CTO).
