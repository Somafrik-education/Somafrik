# Finance F3 — Obligations financières canoniques — 2026-08-27

**Type :** naissance de la dette élève. Pas d’allocations définitives (F4). Pas de parité Web/Mobile (F5).  
**Sources :** #362 audit métier · #363 F1 · #364 F2 · `financeDomainInvariants.js` · `financeFeeTypes.js`  
**Branche :** `cursor/finance-f3-obligation-lifecycle-9855`  
**Base :** `origin/develop@19930f886de3da37027d1159624f769e106a693e` (#364 mergé)

```text
FINANCE BUSINESS MODEL = NO-GO   (inchangé)
FINANCE F1 INVARIANTS            = GO (mergé)
FINANCE F2 RÉFÉRENTIELS          = GO (mergé)
FINANCE F3 OBLIGATIONS           = en revue indépendante
```

---

## Ancien générateur

Un seul INSERT production : `applyFeeGrid` → `insertObligationIfAbsent`.

| Chemin | Créait une obligation ? |
|---|---|
| `POST /finance/fee-grids/:id/apply` | Oui |
| Activation d’inscription | Non |
| Changement de classe | Non |
| `POST /payments` | Non (allocation seulement) |
| Web `applyFeeGridToStudents` | État JSON legacy, rejeté par PUT `/backoffice/state` |
| Mobile | Lecture seule |
| `DEFAULT_FEE_AMOUNTS` | Affichage solde UX, jamais INSERT |

Identité JS/DB historique : `(school, student, fee_grid_id, school_fee_item_id, period_label)` partiel `archived_at IS NULL`.  
`class_id` existait et n’était pas écrit. Pas de `period_key` / `fee_type_code` / `source_enrollment_id`.

---

## Générateur canonique

**Unique moteur :** `ensureEnrollmentFinanceObligations` / `ensureEnrollmentFinanceObligationsInTx`  
dans `backend/lib/financeObligationLifecycle.js`.

Appelé par :

1. activation d’inscription (`postgresRepository.enrollStudentInClass` → `syncEnrollmentFinanceObligations`)
2. `ensureActiveEnrollment` (création ou **transfert de classe**)
3. `applyFeeGrid` (même fonction, raison `grid_apply`)

Aucun second générateur. Le paiement n’appelle pas ce moteur.

Chaîne V1 :

```text
Enrollment ACTIVE
  → grille applicable (school + academicYear + class)
  → fee items × périodes
  → student_fee_obligations (snapshot)
  → payments / allocations (F4)
```

---

## Identité

Concept métier :

```text
schoolId + studentId + academicYear + feeTypeCode + periodKey
```

`school_fee_item_id` (code item) est le **snapshot de lignée stable**.

`source_fee_item_uuid` est une lignée UUID **best-effort** : `replaceGridItems` DELETE les lignes `school_fee_items`, et la FK est `ON DELETE SET NULL`. Après upsert de grille, le pointeur UUID historique peut être NULL. Ce n’est pas l’identité UNIQUE. L’identité durable reste `feeTypeCode + periodKey`.

Contrainte PostgreSQL :

```sql
student_fee_obligations_identity_uniq
  (school_id, student_id, academic_year, fee_type_code, period_key)
  WHERE archived_at IS NULL
    AND period_key IS NOT NULL
    AND fee_type_code IS NOT NULL
```

L’index historique `(grid, item_code, period_label)` est **conservé** (lignes pré-F3).  
Idempotence : `INSERT` + savepoint + `23505` → skip. Pas un `if (!exists) insert` JS seul.

---

## Snapshot

Nouvelle obligation :

| Champ | Source |
|---|---|
| `fee_type` | Label F2 (`Scolarité`, …) via `persistableFeeType` |
| `fee_type_code` | `TUITION`, … |
| `period_key` | `YYYY-MM` ou `ONCE` |
| `amount_due` | montant item au moment T |
| `currency` | devise établissement (jamais `FC`, jamais le client) |
| `class_id` / className | inscription |
| `academic_year` | **inscription / année académique**, pas `new Date().getFullYear()` |
| `due_date` | item de grille (pas la date de paiement) |
| `source_enrollment_id` | enrollment |
| `amount_paid` | 0 |
| `status` | À payer |

Modifier la grille ensuite **ne réécrit pas** `amount_due`. Re-apply = skip UNIQUE.

---

## Fee type F2

Toute nouvelle obligation passe par `persistableFeeType`.  
Écriture refusée : Mensualité (alias → Scolarité + mois), Minerval → Scolarité, Acompte, Annexe, Bulletin.

---

## Inscription / absence de grille

`pickEnrollment` est **fail-closed** :

- `academicYear` demandé sans match → `FINANCE_ENROLLMENT_NOT_FOUND`
- `classId` demandé sans match → `FINANCE_CLASS_ENROLLMENT_MISMATCH`
- jamais de repli sur une autre inscription
- `input.grid` doit matcher school + academicYear + class, sinon `FINANCE_GRID_ENROLLMENT_MISMATCH`

Enrollment ACTIVE sans grille applicable :

- inscription scolaire **conservée**
- 0 obligation
- audit `no_applicable_finance_grid`

Catch-up : apply manuel ou ré-activation → même moteur, idempotent.

Erreur Finance réelle (PG, type invalide, incohérence) :

- audit durable `finance_obligation_sync_failed` (`FINANCE_OBLIGATION_SYNC_FAILED`)
- enrollment conservé
- 0 fausse obligation
- cross-tenant / inscription ambiguë **rethrown** (jamais avalés)

Hook enrollment : `NO_APPLICABLE_FINANCE_GRID` reste un succès métier ; les autres erreurs ne sont plus réduites à `console.warn`.

---

## Mensualités

`monthlyMonths: [SEP, OCT, NOV]` + type TUITION → 3 obligations, 3 `period_key` (`2026-09`…).  
Pas d’obligation « Mensualité ».  
Année 2026-2027 : SEP–DEC → 2026-xx ; JAN–JUIN → 2027-xx.

Pas de prorata 15/30.

---

## Changement de tarif

Interdit : `UPDATE student_fee_obligations SET amount_due = newGridAmount`.  
Les lignes existantes (payées, partielles, impayées) restent le snapshot.

---

## Changement de classe

Date effective : `enrollments.class_effective_date` (colonne additive).

- création initiale : `enrollment_date` (éventuellement `CURRENT_DATE` du jour d’INSERT) peut servir
- transfert : `effectiveDate` **explicite obligatoire**, **avant** toute mutation de `enrollments.class_id`
- absence → `FINANCE_NEEDS_EFFECTIVE_DATE`, enrollment **reste** sur l’ancienne classe, `class_effective_date` inchangée, **aucune** obligation ancienne annulée, **aucune** obligation nouvelle créée
- retry avec date : `class_id` devient la nouvelle classe, futures anciennes superseded `CLASS_TRANSFER`, nouvelles obligations créées
- transfert daté + panne Finance : **même transaction** que la mutation `class_id` — rollback, enrollment reste 6A, `previousClass` conservé, audit durable (`previousClassId`, `targetClassId`, `effectiveDate`, `retryStatus=pending`)
- catch-up : le même appel `ensureActiveEnrollment(6B, effectiveDate)` revoit `classChanged`, supersede 6A, crée 6B, pas de double débit
- `NEEDS_EFFECTIVE_DATE`, `ENROLLMENT_NOT_FOUND`, `CLASS_ENROLLMENT_MISMATCH`, `GRID_ENROLLMENT_MISMATCH` ne sont pas avalés par le hook
- pas de backfill historique avec `CURRENT_DATE`

V1, mois courant = déjà commencé (pas de prorata) :

| Obligation ancienne classe | Action |
|---|---|
| Payée / partielle | immuable |
| Période ≤ mois effectif | immuable |
| Future, non payée, ancienne classe | `archived_at` + `cancel_reason = CLASS_TRANSFER` (pas de DELETE) |
| Nouvelle classe, périodes futures | générées |

Audit `supersede_obligation_class_transfer`.

---

## Multi-inscription / sans classe

`UNIQUE (student_id, academic_year_id)` déjà en place.  
Si plusieurs classes actives pour la même année → `FINANCE_ENROLLMENT_AMBIGUOUS`.  
Sans inscription active / sans `classId` → 0 obligation class-scoped.

---

## Tenant / devise

`enrollment.schoolId`, `grid.schoolId`, `item.schoolId`, `student.schoolId`, `obligation.schoolId` = même tenant.  
Session A + grille B → 403, 0 INSERT.

Devise snapshot = école / pays, alias `FC` → `CDF`.

---

## Paiement

`createPayment` n’appelle pas `insertObligationIfAbsent`.  
Paiement sans dette applicable : reçu possible, **aucune obligation inventée**.

---

## Migrations

Additif uniquement (`backend/db/migrations/20260827_finance_f3_obligation_lifecycle.sql` + `financeSchema.js`) :

- `enrollments.class_effective_date`
- `student_fee_obligations.fee_type_code`, `period_key`, `source_enrollment_id`, `source_fee_item_uuid`, `cancel_reason`, `cancelled_at`, `cancelled_by`
- UNIQUE `student_fee_obligations_identity_uniq`

Pas de table `student_debts` / `student_invoices` / `student_balances`.  
Pas de DROP.

---

## Tests

Mémoire : `financeObligationLifecycle.test.js` — scénarios A–E, G, H, I, J + P1-A/B/C.  
PostgreSQL : `financeObligationLifecycle.pg.test.js` — UNIQUE, retry, concurrence, tenant, snapshot, transfert, rollback, paiement ≠ dette, scope fail-closed, date de transfert, sync failed, **intégration réelle `PostgresRepository.ensureActiveEnrollment()`** (refus sans date + retry daté + **recovery panne Finance après mutation**).

Gate : `verify:finance-obligation-lifecycle` (F1 + F2 + F3 mémoire + F3 PG + source guards, dont `DEFAULT_FEE_AMOUNTS` hors autorité, **refus `NEEDS_EFFECTIVE_DATE` avant INSERT/UPDATE `enrollments.class_id`**, et **transfert + Finance atomiques**).

---

## Risques résiduels

1. `replaceGridItems` recrée les UUID d’items — UNIQUE sur `feeTypeCode+periodKey` ; `source_fee_item_uuid` peut passer à NULL (lignée stable = `school_fee_item_id`).
2. Deux lignes `Autre` / `ONCE` la même année collident (V1 acceptable).
3. Transfert via `ensureActiveEnrollment` sans date explicite : **aucune** mutation de `class_id` (refus `FINANCE_NEEDS_EFFECTIVE_DATE` avant UPDATE). Catch-up ultérieur avec date conserve `previousClass` et supersede les futures.
4. Transfert daté + panne Finance : rollback atomique de `class_id` ; l’audit durable porte `previousClassId` / `targetClassId` / `effectiveDate` pour un retry déterministe. L’inscription initiale (hors transfert) reste best-effort.
5. Web `applyFeeGridToStudents` existe encore pour scripts E2E ; les pages production passent par l’API.
6. Parité soldes / allocations = F4. UX = F7.

```text
PR     DRAFT
Ready  NON
Merge  NON sans ordre CTO
F4     NON OUVERT
```
