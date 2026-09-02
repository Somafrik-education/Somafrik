# GO Production — Audit métier Finance Somafrik — 2026-08-27

**Type :** audit-only (documentation). Aucune migration. Aucune mutation métier. Aucun endpoint nouveau. Aucun changement de calcul, RBAC ou UX.  
**Branche :** `cursor/finance-business-domain-audit-9855`  
**Base :** `origin/develop@12472bd3` (Merge #361 — payment-student-options + Paramètres Finances)  
**PR :** Draft (audit-only). Ready **NON**. Merge **NON** sans ordre CTO.

---

## Verdict

```text
FINANCE BUSINESS MODEL = NO-GO

P0 démontrés (corruption / double comptage / fuite tenant / historique détruit)
  = 0

P1 (modèle non unique, soldes/UX divergents, duplications structurantes)
  = 14

P2 (wording, surfaces manquantes, confort)
  = 11

Duplications classées D1–D7
  = 18

Divergences Web/Mobile (actions métier)
  = 8

Divergences de calcul
  = 6

Divergences RBAC
  = 5
```

#361 a rendu **opérationnels** des flux techniques (picker élève, catalogue, moyens, grilles).  
Elle n’a **pas** unifié le modèle métier. Les montants, dettes et imputations peuvent encore diverger selon l’écran, le client et le vocabulaire de type de frais.

Geler toute nouvelle fonctionnalité Finance jusqu’à convergence P0/P1 issue de cet audit. Les correctifs P0/P1 **démontrés** restent autorisés.

---

## 1. Executive Summary

Question centrale : *comment Somafrik gère-t-il un élève depuis la définition d’un frais jusqu’au paiement complet ?*

**Aujourd’hui (réel) :**

```text
Admin crée une grille (fee_grids + school_fee_items)
        ↓  action manuelle POST …/apply  (PAS à l’inscription côté API)
student_fee_obligations  (« cet élève doit X pour Y »)
        ↓
Comptable encaisse POST /payments  (payment_items = libellés du reçu)
        ↓
allocateAmount()  → payment_allocations  (imputation FIFO par type)
        ↓
leftover → unallocatedAmount  (dans profile_payload, pas de table)
        ↓
KPI reste / taux / caisse  recalculés par couche
```

**Ce qui manque pour un modèle unique :**

1. **Trois vocabulaires de types de frais** (catalogue canonique 8 libellés, grilles `Inscription/Mensualité/Annexe`, Web `FEE_TYPES` / `Minerval`). Un matcher (`financeFeeTypeMatch.js`) colle les synonymes. C’est de la colle, pas un référentiel.
2. **Deux écrans de configuration** (`/parametres/finances` et `/finances/frais`) sur les **mêmes tables**.
3. **Deux modes d’imputation** : Mobile envoie `obligationId` ; Web envoie seulement `feeType` et laisse le serveur matcher. Un paiement de 100 000 à trois libellés **existe** (un reçu, N `payment_items`, N allocations) — mais Web et Mobile ne construisent pas le même contrat.
4. **« Acompte »** n’est pas un type de frais : c’est le fallback Mobile quand aucune dette n’est choisie → paiement 100 % non imputé.
5. **L’obligation n’est pas créée à l’inscription** côté PostgreSQL. Un helper Web (`applyActiveGridsToStudent`) existe encore dans `fees.ts` et n’est plus l’autorité (finance stripée du PUT `backoffice_state`).
6. **Changement de classe / de tarif** : pas de politique métier implémentée. `student_fee_obligations.class_id` existe et n’est **pas rempli** à l’insert.
7. **Devise V1 de facto mono-établissement**, mais l’UI affiche `CDF`, `FC`, `USD` selon l’écran.
8. **Discount** persisté, **exclu** du solde (`discountsDeferred: true`). Exonération entre dans le solde. Pénalités : statut calculé « En retard », pas de référentiel.

**Cible (sans coder) :** un graphe unique Config → Obligation gelée → Encaissement → Imputation → Solde calculé. Voir §19.

---

## 2. Glossaire métier

Définitions **cibles**. Les écarts actuels sont en *italique*.

| Terme | Définition cible Somafrik | Usage actuel / collision |
|---|---|---|
| **Type de frais** | Vocabulaire d’établissement : Inscription, Scolarité, Examen, Uniforme, Transport, Cantine, Autre. Pas un montant. | *Trois listes : `CANONICAL_FEE_TYPES`, `SCHOOL_FEE_TYPES` (Inscription/Mensualité/Annexe), `FEE_TYPES` Web (Minerval / scolarité).* |
| **Frais** | Ligne tarifaire concrète d’une grille (`school_fee_items`) : type + montant + échéance + obligatoire. | *Souvent confondu avec l’obligation élève (`studentFees`).* |
| **Tarif** | Montant d’un frais pour une classe / année. Appartient à la grille, pas au paiement. | *Copié dans `amount_due` à l’apply. PATCH grille remplace les items ; obligations déjà créées gardent l’ancien dû.* |
| **Grille tarifaire** | Barème d’une classe × année académique (`fee_grids`). Contient N frais. | *Dupliquée UI Paramètres + Finances/frais.* |
| **Échéance** | Date et/ou période à laquelle un frais (ou une mensualité) est exigible. | *Mélange `due_date`, `period_label`, `monthly_months`, `period_name` de grille.* |
| **Obligation** | « Cet élève doit payer X pour Y sur la période Z. » Snapshot. Distinct du paiement. | *Table `student_fee_obligations`. Aussi appelée « student fee », « impayé », « dette ».* |
| **Créance** | Vue école des obligations ouvertes (balance > 0). | *Module Impayés Web. Mobile n’a pas cet écran.* |
| **Paiement** | Encaissement réel : un reçu, un montant reçu, un moyen, une date, un auteur. | *Table `payments` + `payment_items`. Ne doit pas redéfinir le tarif.* |
| **Encaissement** | Synonyme opérationnel de paiement compté (non annulé, non pending). | *Mobile KPI « Encaissé » = Σ `payments.amount`. Web n’affiche pas ce KPI.* |
| **Imputation** | Affectation d’une part d’un paiement à une obligation (`payment_allocations`). | *FIFO serveur par type si pas d’`obligationId`.* |
| **Non imputé** | Part du paiement sans obligation cible. = trop-perçu technique V1. | *Statut reçu « Non imputé ». Alias `overpaymentAmount`.* |
| **Acompte** | **Cible : imputation partielle, pas un type de frais.** | *Fallback Mobile `feeType: "Acompte"` → souvent 100 % non imputé.* |
| **Solde** | Sur une obligation : `max(0, dû − imputé valide − exonération)`. | *Colonne `balance` persistée ET recalculée à la lecture.* |
| **Reste à payer** | Σ soldes d’obligations ouvertes. | *Mobile Paiements : `expected − collected` du KPI taux (approximation). Web Impayés : Σ `balance`.* |
| **Trop-perçu** | Encaissé au-delà des dettes ouvertes. V1 = non imputé. Pas un avoir. | *`OVERPAYMENT_ACTIONS` Web (Crédit élève, Remboursement…) **non persistées** côté API.* |
| **Annulation** | Neutralisation traçable d’un paiement (`cancelled_at`, allocations `reversed_at`). Pas un DELETE. | *Conforme V1. Idempotente.* |
| **Remboursement** | Sortie de caisse distincte. **Hors V1.** | *Actions UI « Remboursement à prévoir » sans écriture.* |
| **Réduction** | Abattement justifié sur une obligation, traçable, sans réécrire le tarif historique. | *Colonne `discount` **hors** formule de solde.* |
| **Pénalité** | Majoration de retard. **Hors V1** (pas de table). | *Statut « En retard » calculé si `due_date` dépassée.* |
| **Exonération** | Relâche de la créance (`exemption ≥ amount_due` → Exonéré). | *Entre dans le solde. Ajustable Comptable/Admin.* |
| **Arriéré** | Créance échue non soldée. | *Mot absent du code. Couvert par « En retard » / Impayés.* |
| **FC** | Affichage Mobile « Francs congolais » informel. | *Pas une devise ISO. Contredit `CDF` catalogue.* |

**Règle :** aucun terme ne doit avoir deux définitions. Les collisions actuelles sont P1 (§14 D5/D7).

---

## 3. Carte du domaine actuel

| CONCEPT MÉTIER | TABLE POSTGRESQL | API | WEB | MOBILE | SOURCE DE VÉRITÉ | DUPLICATION | RISQUE | RECOMMANDATION |
|---|---|---|---|---|---|---|---|---|
| Type de frais (vocabulaire) | aucune table dédiée | `catalog.canonicalFeeTypes` | Settings select + `FEE_TYPES` + `SCHOOL_FEE_TYPES` | libellé obligation / `Acompte` | Code `CANONICAL_FEE_TYPES` | D4 D7 | Imputation sur mauvais type | Une table ou enum PG unique |
| Grille tarifaire | `fee_grids` | `/finance/fee-grids*` | Paramètres **et** `/finances/frais` | — | PG | D2 (deux UI) | Double saisie | Paramètres = config ; Frais = lecture/apply |
| Ligne tarifaire | `school_fee_items` | items de grille + `catalog.feeTypes` | les deux écrans | catalogue lecture | PG | D7 vs « type » | Confusion montant / type | Garder item = tarif |
| Historique tarif | `fee_tariff_history` | via apply/upsert | — | — | PG | — | Sous-exploité | Tracer tout PATCH |
| Obligation élève | `student_fee_obligations` | `GET /finance/student-fees`, apply, adjust | Impayés, Frais KPI | studentFees + picker dettes | PG | D2 helper client `applyFeeGridToStudents` | Générateurs concurrents | Un seul apply serveur |
| Paiement / reçu | `payments` | `POST/GET /payments`, cancel | EntityPage, QuickPayment | PaymentsScreen | PG | `profile_payload` dénormalisé | Snapshot vs colonnes | Header canonique + items |
| Lignes de reçu | `payment_items` | body `items[]` | multi-libellés | 1 ligne | PG | — | Web vs Mobile contrat | Même payload |
| Imputation | `payment_allocations` | create + reconcile | implicite | `obligationId` | PG | D2 matching feeType | Mauvaise dette soldée | obligationId obligatoire V1.1 |
| Non imputé | `payments.profile_payload` | champs réponse | reçu « Non imputé » | KPI Non imputé | Calcul + JSON | D1 (pas de colonne) | Drift snapshot | Calculer ; optionnellement colonne |
| Moyens de paiement | `school_payment_methods` | GET/PUT `/finance/payment-methods` | Paramètres + catalog | catalog | PG (+ défauts code si vide) | D4 `PAYMENT_METHODS` mort | Repli client (corrigé #361 ops) | Garder PG |
| Statuts paiement config | `payment_statuses` | `/finance/payment-statuses` | chargé, peu d’UI | — | PG + statuts calculés FR | D5 FR/EN | Comptable peut écrire config | Admin only |
| Devise | `countries.currency` / `schools.profile_payload` / colonnes | `catalog.currency` | CDF/USD fallbacks | **FC** hardcodé | Pays puis école | D4 | Affichage faux | Invariant mono-devise + ISO |
| Année académique | `academic_years` + `fee_grids.academic_year` TEXT | grilles | saisie libre | — | Mixte | D1 | Historique mal scindé | FK année |
| Classe | `classes` + `fee_grids.class_id` | grilles, enrollment | | payment-student-options | PG | obligation.class_id **NULL** | Changement de classe opaque | Remplir class_id |
| Inscription | `enrollments` | payment-student-options | picker | picker | PG | — | Élève sans classe exclu picker | OK ; dette ? indéfini |
| Relances | `payment_reminders` | `/backoffice/finance/unpaid/.../reminders` | Impayés | — | PG | `student_fee_obligation_id` non rempli à l’insert | Relance orpheline | Lier l’obligation |
| Abonnements SaaS | `subscription_*` | `/backoffice/subscription-payments` | `/abonnements` | — | PG plateforme | D4 moyens EUR | Confusion métier | Frontière stricte §31 |
| Réduction établissement | — | flag deferred | alerte Settings | — | — | colonne `discount` | Solde ignore discount | Modèle P2/F3 |
| Pénalité | — | flag deferred | — | — | statut En retard | — | Pas un tarif | Différer |
| Reçu papier | pas de table | payload paiement | PaymentReceipt | PaymentReceiptCard | paiement persisté | total UI = Σ items | OK si items serveur | Toujours `payments.amount` |

---

## 4. Flux métier actuel

```text
PARAMÈTRES FINANCES          règles (devise lecture, moyens PUT, types via grille)
        ↓                    ⚠ même grilles aussi dans /finances/frais
BARÈME / FRAIS               fee_grids + school_fee_items
        ↓                    apply manuel (Admin School)
ÉLÈVE / CLASSE / ANNÉE       enrollments + classes + academic_year TEXT
        ↓
OBLIGATION / DETTE           student_fee_obligations (snapshot amount_due)
        ↓
ÉCHÉANCE                     due_date + period_label (+ monthly_months à l’apply)
        ↓
PAIEMENT                     payments + payment_items (encaissement)
        ↓
IMPUTATION                   payment_allocations (FIFO / obligationId)
        ↓
RESTE À PAYER                obligation.balance (persisté + recalculé)
        ↓
SOLDE / KPI                  Web Impayés Σ balance ≠ Mobile « reste estimé » taux
        ↓
ANNULATION                   cancel + reversed_at (dette réapparaît)
        ↓
REPORTING                    tableau Web + KPI Mobile ; pas de grand livre
```

**Autorités actuelles (pas toujours uniques) :**

| Étape | Autorité de fait |
|---|---|
| Paramètres | PG catalogue + **deuxième** UI Frais |
| Barème | `fee_grids` / `school_fee_items` |
| Élève payable | `payment-student-options` (inscription active) |
| Obligation | `applyFeeGrid` serveur ; **pas** l’enrollment |
| Paiement | `POST /payments` |
| Imputation | `financeService.allocateAmount` |
| Solde | `obligationStatus` + `projectObligationPaidAmounts` |
| Annulation | `POST /payments/:id/cancel` |

---

## 5. Flux métier cible

```text
Paramètres Finances (Admin)
  - devise établissement (lecture pays/école, invariant V1 mono-devise)
  - moyens autorisés
  - vocabulaire types de frais (un seul)
  - politique d’échéances (mensuel / trimestre / unique)
        ↓
Grille tarifaire (Admin) — une par classe × année
  - N frais (school_fee_items) : type, montant, dueDate, mandatory, périodes
        ↓
Générateur UNIQUE d’obligations
  - à l’activation/apply de grille
  - à l’inscription / changement de classe (règle explicite, une seule)
  - snapshot : amount_due, due_date, fee_item_id, period, class_id, academic_year_id
        ↓
Opérations Comptable (Finances)
  - liste créances = obligations ouvertes
  - encaissement = 1 paiement, N libellés, N imputations
  - picker élève = payment-student-options
  - picker dette = obligationId (jamais un faux type « Acompte »)
        ↓
Soldes toujours calculés
  - PAIEMENT = Σ imputations actives + non imputé
  - OBLIGATION PAYÉE = Σ imputations actives
  - RESTE = dû − imputé valide − exonération
        ↓
Annulation traçable ; pas de DELETE métier
```

Séparation stricte : **Paramètres = règles** ; **Finances = transactions**. Aucune transaction dans le référentiel. Aucun tarif reconstruit depuis l’historique des paiements.

---

## 6. Tables PostgreSQL

### 6.1 Finance scolaire (10)

| Table | Rôle | Config / Tx / Dérivé |
|---|---|---|
| `fee_grids` | Barème classe × année | Config |
| `school_fee_items` | Ligne de tarif | Config |
| `fee_tariff_history` | Audit grilles | Événement |
| `school_payment_methods` | Moyens autorisés | Config |
| `payment_statuses` | Catalogue de statuts (souvent contourné) | Config |
| `student_fee_obligations` | Dette élève | Tx + colonnes dérivées (`amount_paid`, `balance`, `status`) |
| `payments` | Encaissement | Tx + `profile_payload` snapshot |
| `payment_items` | Libellés du reçu | Tx ; `ON DELETE CASCADE` |
| `payment_allocations` | Imputation | Tx ; `reversed_at` |
| `payment_reminders` | Relances | Tx |

Contrainte d’unicité obligation active :

`(school_id, student_id, fee_grid_id, school_fee_item_id, period_label) WHERE archived_at IS NULL`.

Écarts DDL :

- `fee_grid_id` / `school_fee_item_id` sont **TEXT** alors que les PK sources sont UUID.
- `student_fee_obligations.class_id` FK existe, **non alimenté** à l’insert (`financePgStore.insertObligationIfAbsent`).
- `payments.payment_method` / `payment_status` : TEXT, pas de FK vers les catalogues.
- Devise obligation défaut DDL `'USD'` vs grilles `'CDF'` (`schema.sql`).

### 6.2 Hors domaine scolaire (ne pas fusionner)

`subscriptions`, `subscription_offers`, `subscription_payments`, `subscription_invoices`, `subscription_discounts`, `subscription_audit_log`.

---

## 7. APIs

| Méthode | Chemin | Nature | Notes |
|---|---|---|---|
| GET | `/api/finance/payment-student-options` | Lecture picker | Inscription active ; pas de parentPhone |
| GET | `/api/finance/catalog` | Lecture règles | Devise, moyens, feeTypes actifs, flags deferred |
| GET/PUT | `/api/finance/payment-methods` | Config | PUT : Admin School uniquement |
| GET/POST/PATCH | `/api/finance/payment-statuses` | Config | POST réutilise perm paiements |
| GET/POST/PATCH | `/api/finance/fee-grids*` | Config | WRITE Admin School |
| POST | `/api/finance/fee-grids/:id/apply` | **Tx** obligations | Seule génération serveur |
| GET | `/api/finance/student-fees` | Lecture dettes | |
| POST | `/api/finance/student-fees/:id/adjust` | Tx | discount / exemption / cancel |
| POST | `/api/finance/reconcile-payment-allocations` | Tx | Ré-impute l’historique non alloué |
| GET/POST | `/api/payments` | Tx | Create = items + allocations |
| GET | `/api/payments/:id` | Lecture | |
| POST | `/api/payments/:id/cancel` | Tx reverse | Motif obligatoire ; pas de DELETE |
| GET | `/api/students/:id/payments` | Lecture | **Pas de `requirePermission`** — scope élève seulement |
| GET/POST | `/api/backoffice/finance/unpaid*` | Créances / relances | Agrégat service |

Idempotence : create + cancel + apply wrappés. Client `schoolId` B ignoré (`ignoreClientScope`).

---

## 8. Web

| Surface | Rôle | Écart |
|---|---|---|
| `/parametres/finances` | Config V1 (devise, moyens, types+échéances, 403, vide) | Recrée aussi des grilles |
| `/finances/frais` | Grilles + apply + `SCHOOL_FEE_TYPES` | **Même tables** que Paramètres |
| `/finances/paiements` | Liste + QuickPayment + reçu + cancel | Multi-libellés **sans** `obligationId` |
| `/finances/impayes` | Créances client-side depuis `studentFees` | Rappels ; pas d’équivalent Mobile |
| `/etablissement/eleves/:id/finance` | ComingSoon | Parent Web incomplet |
| `fees.ts` `applyFeeGridToStudents` | Générateur **client** encore dans le bundle | Plus autorité (finance stripée du PUT état) |

Hardcodes : `FEE_TYPES`, `PAYMENT_METHODS`, `DEFAULT_FEE_AMOUNTS`, `resolveSchoolCurrency` → USD (fees.ts) ou CDF (quickPayment), Settings `|| "CDF"`.

---

## 9. Mobile

| Surface | Rôle | Écart |
|---|---|---|
| `PaymentsScreen` | Liste + saisie + KPI caisse | Devise **FC** ; « Impayés » = reçus pending |
| `StudentPaymentsScreen` | Par élève + parent | options + catalog ; `loadStudents` repli Parent |
| `PaymentMutationControls` | 1 ligne, picker **obligation** | `Acompte` si aucune dette |
| `PaymentCancelControls` | Annulation + motif | Paritaire Web |
| `PaymentReceiptCard` | Résumé | Pas d’impression ; FC |
| Config grilles / impayés / relances | — | **Absent** (volontaire V1 si config Web-only) |

`getPaymentRateKpi` est une **copie** du contrat Web (assiette obligations).  
`getPaymentStats.rate` compte des **reçus Payé** — autre indicateur, même famille sémantique à l’écran.

---

## 10. RBAC

Décision métier **cible** (à valider CTO, non dérivée seulement de l’UI) :

| Action | SCHOOL_ADMIN | ACCOUNTANT | DIRECTEUR / PRÉFET | SECRÉTAIRE | TEACHER | PARENT / ÉLÈVE |
|---|---|---|---|---|---|---|
| Lire catalogue / grilles | oui | lecture | lecture rapports si besoin | lecture si grant | non | non |
| Écrire grilles / moyens / types | **oui** | **non** | non | non | non | non |
| Apply obligations | oui | non | non | non | non | non |
| Lire créances | oui | **oui** | lecture | selon grant | non | **son** enfant |
| Encaisser | oui (pratique actuelle) | **oui** | actuel seed `Gérer paiements` | actuel seed oui | non | non |
| Imputer (via paiement) | oui | oui | idem | idem | non | non |
| Annuler paiement | oui | oui (service `Paiements:UPDATE`) | seed oui | seed oui | non | non |
| Ajuster exemption | oui | oui | non | non | non | non |
| Relancer | oui | oui | — | — | non | non |
| Modifier tarif structurant | oui | **non** | non | non | non | non |

**Écarts actuels (P1) :**

1. PUT moyens : Admin School — **conforme cible**.
2. Grilles WRITE : Admin School — **conforme**.
3. `payment_statuses` WRITE : Comptable / Secrétaire / Directeur autorisés — **trop large** si c’est de la config.
4. Annulation : tout rôle avec `Gérer paiements` (Directeur, Secrétaire seed) — à **trancher métier**.
5. `GET /api/students/:id/payments` : authentifié + élève autorisé, **sans** `Paiements:READ`.
6. Lectures grilles branchées sur la perm **Impayés**, pas une perm « Frais ».
7. Comptable n’a pas `Élèves:READ` — volontaire ; picker = `payment-student-options`.

---

## 11. Calculs

Identités **cibles** (une par indicateur) :

```text
PAIEMENT.amount            = Σ payment_items.amount
PAIEMENT.allocated         = Σ payment_allocations.amount WHERE reversed_at IS NULL
PAIEMENT.unallocated       = max(0, amount − allocated)
PAIEMENT.amount            = allocated + unallocated

OBLIGATION.amount_paid     = Σ allocations actives (autorité)
OBLIGATION.balance         = max(0, amount_due − amount_paid − exemption)
RESTE_ÉLÈVE                = Σ balance (obligations non annulées)
TAUX                       = Σ amount_paid / Σ (amount_due − exemption)   assiette vide → « — »
ENCAISSÉ                   = Σ payments.amount  (paiements comptés)
```

`discount` **exclu** du solde tant que `discountsDeferred`.

| INDICATEUR | FORMULE WEB | FORMULE MOBILE | FORMULE BACKEND | SQL | VERDICT |
|---|---|---|---|---|---|
| Total dû | `Σ amountDue` (`studentFeeSummary`) | `Σ max(0, due − exemption)` (`getPaymentRateKpi`) | `amount_due` ; KPI via status | colonne | **Écart** : Web dû brut vs Mobile dû net d’exonération |
| Payé obligation | `Σ amountPaid` | `Σ amountPaid` | `max(colonne, Σ allocations)` | `allocated_paid` latéral | OK lecture PG ; Web fait confiance au payload |
| Reste obligation | `due − paid − exemption` | idem picker ; écran Paiements : `expected − collected` | `obligationStatus` | GREATEST côté audit SQL | **Écart** écran Mobile « reste estimé » |
| Non imputé | champs API / reçu | `getPaymentCashKpi` | `projectPaymentCash` | JSON payload | Formule OK ; persistance dérivée |
| Taux | `getPaymentRateKpi` | copie + **aussi** `getPaymentStats.rate` (reçus) | pas d’endpoint KPI | — | **D3** second taux Mobile |
| Encaissé | pas de bandeau | Σ amount compté | `cashBucketsFromPayments` | `payments.amount` | Mobile-only UX |
| Impayés / arriérés | `listUnpaidStudentFees` (balance>0 + statuts) | label « Impayés » = reçus non Payé | `UnpaidService` miroir Web | — | **D7** deux métiers |
| Trop-perçu | `OVERPAYMENT_ACTIONS` locales | unallocated | leftover create | payload | UI Web non persistée |
| Quick balance | `computeFeeBalance` peut user `DEFAULT_FEE_AMOUNTS` | — | — | — | **D4** chemin MVP |

---

## 12. Imputation

Modèle réel :

1. `POST /payments` avec `items[]` (montant + `feeType` et/ou `obligationId` / `feeTypeId`).
2. Pour chaque item : `openObligationsForItem` — si `obligationId` → cette dette (contrôles tenant/élève/type) ; sinon **toutes** les dettes ouvertes dont le type matche (`obligationMatchesPaymentFeeType`).
3. `allocateAmount` : FIFO sur `balance`, crée `payment_allocations`.
4. Reliquat → `unallocatedAmount` / statut « Non imputé » ou « Partiel ».
5. Avant create : `reconcileUnallocatedPaymentsInTx` tente de coller d’anciens non imputés.

**Multi-frais (scénario D) :** un paiement, trois `payment_items`, jusqu’à trois allocations. **Le modèle PG le permet.** Web l’expose (multi-lignes). Mobile n’envoie **qu’une** ligne.

**Risque P1 :** sans `obligationId`, un libellé « Scolarité » peut s’imputer sur **plusieurs** mensualités FIFO, ou matcher `Mensualité` via alias. Deux élèves / deux dettes du même type : le serveur ne prend que les obligations **de l’élève du paiement** — OK tenant. Plusieurs périodes du même élève : FIFO, pas de choix explicite Web.

**Cible :** toute imputation V1.1 porte `obligationId`. Le multi-libellé reste un seul encaissement.

---

## 13. Statuts

### Paiement (reçu)

| UI FR | DB | Compté encaissement |
|---|---|---|
| Payé | `paid` | oui |
| Partiel | `paid` | oui |
| Non imputé / À imputer | `paid` | oui (caisse) |
| En attente de confirmation | `pending` | non |
| Annulé | `cancelled` | non |
| Refusé / Échoué | — | non |

Machine cible : `pending → paid → cancelled`. « Partiel / Non imputé » sont des **projections d’imputation**, pas des états de caisse distincts. `payment_statuses` configurable **double** cette machine (D5).

### Obligation

`À payer` | `Partiellement payé` | `Payé` | `En retard` | `Exonéré` | `Annulé`

`En retard` est **calculé** (`due_date < now` et balance > 0), aussi persisté. Risque de drift si non recalc.

### Grille

`Brouillon` | `Active` | `Désactivée` | `Clôturée` (`FEE_GRID_STATUSES`). Apply seulement si `Active`.

---

## 14. Duplications

| ID | Classe | ORIGINE | COPIE | RISQUE | AUTORITÉ CIBLE | PLAN |
|---|---|---|---|---|---|---|
| D1a | D1 | `payments.amount` | `profile_payload` allocated/unallocated | snapshot faux | colonnes + calcul lecture | F4 |
| D1b | D1 | `amount_paid` | Σ allocations | max() masque l’écart | allocations | F4 |
| D1c | D1 | `academic_years.id` | `fee_grids.academic_year` TEXT | deux années | FK | F2 |
| D1d | D1 | UUID item/grid | TEXT sur obligation | jointure fragile | UUID FK | F2 |
| D2a | D2 | `applyFeeGrid` serveur | `applyFeeGridToStudents` client | second générateur | serveur seul | F3 supprimer helper prod |
| D2b | D2 | Paramètres Finances | `/finances/frais` | double config | Paramètres écrit ; Frais apply/lecture | F2 |
| D2c | D2 | `getPaymentRateKpi` Web | copie Mobile | drift | package partagé ou API KPI | F5 |
| D3a | D3 | taux assiette | `getPaymentStats.rate` | chiffre différent même écran | un KPI | F5 |
| D3b | D3 | reste Σ balance | reste `expected−collected` | P1 solde | Σ balance | F4 |
| D4a | D4 | `CANONICAL_FEE_TYPES` | `FEE_TYPES` / `SCHOOL_FEE_TYPES` | mauvaise imputation | un vocabulaire PG | F2 |
| D4b | D4 | `school_payment_methods` | `PAYMENT_METHODS` mort + SaaS | confusion | PG scolaire vs SaaS | F2 |
| D4c | D4 | `catalog.currency` | FC / CDF / USD UI | affichage faux | ISO catalogue | F5 |
| D5a | D5 | `paid/cancelled` | Payé/Annulé/Partiel | mapping | projection unique | F4 |
| D5b | D5 | Impayés (dettes) | Impayés (reçus pending) | Comptable mal informé | deux libellés | F5 |
| D6a | D6 | `Paiements:*` fonctionnel | `Gérer paiements` seed | trop de rôles écrivent | matrice §10 | F6 |
| D6b | D6 | lecture grilles | perm Impayés | Admin/Comptable flou | perm Frais | F6 |
| D7a | D7 | Scolarité / Mensualité / Minerval | matcher | dette mal ciblée | un code type | F2 |
| D7b | D7 | Acompte | type vs partiel | non imputé fantôme | interdire comme type | F4 |

---

## 15. Divergences

### Web ↔ Mobile (actions)

| ACTION | WEB | MOBILE | API | PARITÉ |
|---|---|---|---|---|
| Voir dette | Impayés + Frais | KPI / picker obligations | student-fees | **Non** (pas d’écran créances Mobile) |
| Créer paiement | multi-items, feeType catalogue | 1 item, obligationId | POST /payments | **Non** |
| Choisir élève | search options | chips options | payment-student-options | Oui (UX) |
| Choisir frais | type catalogue | dette ouverte | items | **Non** |
| Imputer | implicite FIFO | explicite | allocateAmount | **Non** |
| Annuler | motif | motif | cancel | Oui |
| Reçu | print + vérif | carte | payload | Partiel |
| Solde / caisse | pas de bandeau Encaissé | Encaissé/Imputé/Non imputé | payments fields | **Non** |
| Config | Paramètres + Frais | — | fee-grids / methods | Web-only OK V1 |
| Relance | Impayés | — | reminders | Web-only |

### Calculs : 6 écarts — §11.  
### RBAC : 5 écarts — §10.

---

## 16. P0

Aucun P0 **démontré** (corruption de montant, double comptage persisté, DELETE historique, fuite tenant A→B) sur `develop@12472bd3`.

Candidats à **rejouer** avant tout GO métier (ne pas classer P0 sans preuve) :

- `GET /api/students/:id/payments` sans perm Paiements (scope élève — fail-closed `[]` si non autorisé).
- `ON DELETE CASCADE` sur `payment_items` si un DELETE SQL manuel du paiement (l’API ne DELETE pas).

Cross-tenant #361 : tests A/B HTTP + SQL predicates — **pas rouverts ici**.

---

## 17. P1

1. Vocabulaire types de frais non unique + matcher d’alias.
2. Deux UI de grilles (Paramètres vs Frais) sur les mêmes tables.
3. Web impute par `feeType` ; Mobile par `obligationId`.
4. « Acompte » faux type → non imputé.
5. Devise : FC vs CDF vs USD vs catalogue.
6. Deux « taux » / deux « reste » Mobile.
7. « Impayés » ≠ créances vs reçus pending.
8. Obligations non générées à l’inscription (API) ; helper client encore présent.
9. `class_id` obligation vide ; changement de classe/tarif sans politique.
10. `discount` persisté hors solde.
11. RBAC config statuts trop large ; GET payments élève sans perm module.
12. IDs TEXT vs UUID ; année TEXT vs `academic_years`.
13. Relance sans `student_fee_obligation_id`.
14. `DEFAULT_FEE_AMOUNTS` / `computeFeeBalance` encore dans le client Web.

---

## 18. P2

1. Wording Mode vs Moyen, Minerval vs Scolarité.
2. Dossier élève Web finance ComingSoon.
3. Mobile sans impression reçu / sans relance / sans config.
4. KPI Mobile « FC ».
5. `OVERPAYMENT_ACTIONS` cosmétique.
6. Rappels : cooldown 3 j, `last_reminder_at` non mis à jour.
7. Pénalités / réductions établissement différées (déjà flaggées).
8. Hub Paramètres mentionne encore « pénalités ».
9. SaaS `PAYMENT_METHODS` voisinage sémantique.
10. `payment_statuses` peu utilisé par la machine réelle.
11. Reporting scolaire avancé hors V1.

---

## 19. Modèle cible

```text
fee_type_catalog          (code stable, label)
    ↑
fee_grid                  (school, class_id, academic_year_id, currency, status)
    ↑
school_fee_item           (grid, fee_type_code, amount, due_policy, mandatory)
    ↓ apply / enroll (un seul générateur)
student_fee_obligation    (school, student, year, fee_item, period, amount_due FROZEN,
                           class_id, due_date, status calculé)
    ↑ allocations
payment                   (school, student, amount, currency, method_code, paid_at, actor)
    ↑
payment_item              (libellé reçu, amount, optional fee_item)
    ↑
payment_allocation        (payment, obligation, amount, reversed_at)
```

**Invariants V1 :**

1. Mono-devise par établissement = `catalog.currency` (pays, surcharge école).
2. Un paiement = un encaissement = N imputations ; jamais N paiements artificiels pour une transaction caisse.
3. Acompte = partielle d’obligation, pas un type.
4. Obligation distincte du paiement ; montant dû gelé à la création.
5. Changement de tarif → nouvelles obligations / apply futur ; **jamais** réécriture silencieuse des `amount_due` déjà nés ni des paiements.
6. Changement de classe → politique explicite (geler dettes 6A ; générer 6B à partir de la date / de l’apply) ; paiements passés inchangés.
7. Pas de DELETE métier d’historique ; cancel + reverse.
8. Soldes calculés ; pas d’autorité client.
9. Frontière : pas de plan comptable, TVA, banque, bilan (§31).

### Matrice source de vérité

| CONCEPT | AUTORITÉ CIBLE |
|---|---|
| Type de frais | Catalogue PG unique (code), pas les constantes client |
| Tarif | `school_fee_items.amount` de la grille active |
| Échéance | `due_date` + `period_label` / politique mensuelle de l’item |
| Obligation élève | `student_fee_obligations` |
| Montant dû | `amount_due` **gelé** à la création |
| Paiement | `payments` + `payment_items` |
| Imputation | `payment_allocations` (non reversed) |
| Non imputé | `amount − Σ allocations` (calcul) |
| Solde | calcul `due − paid − exemption` |
| Moyen de paiement | `school_payment_methods` |
| Devise | `countries.currency` / profil école ; une par établissement V1 |
| Statut paiement | machine `pending/paid/cancelled` ; Partiel/Non imputé = projection |
| Annulation | `cancelled_at` + `reversed_at` |
| Reçu | paiement persisté (`reference`, items, montant serveur) |
| Année académique | `academic_years` FK, pas seulement un libellé TEXT |

---

## 20. Plan de convergence

Pas une grosse PR. Ordre **par risque métier** (pas par écran).

| PR | Objet | Pourquoi cet ordre |
|---|---|---|
| **F1** | Invariants + glossaire dans code/docs de contrat (toujours audit-first ; tests scénarios A–H comme spec) | Figer le langage avant tout refactor |
| **F2** | Un vocabulaire types + une UI config (Paramètres écrit ; Frais = apply/lecture) + FK année/UUID | Coupe D4/D7/D2b |
| **F3** | Un générateur d’obligations (enrollment / apply) ; `class_id` ; politiques classe/tarif | Dettes complètes et historiques |
| **F4** | Paiement : `obligationId` requis pour imputer ; interdire type Acompte ; soldes API uniques ; cancel déjà OK | Arrête les mauvais rattachements |
| **F5** | Parité Web ↔ Mobile des **opérations** (multi-items + picker dette + KPI + devise ISO) | Même chiffre partout |
| **F6** | RBAC Finance selon matrice métier CTO | Empêche l’écriture hors rôle |
| **F7** | UX / wording / reçus / relances / ComingSoon dossier | Après que les montants soient justes |

Correctifs P0 démontrés : PR hotfix indépendante, hors ce séquencement.

---

## 21. Ordre des futures PR (rappel)

```text
F1  modèle / invariants / scénarios de référence
F2  suppression duplications référentiels (types, grilles UI, IDs)
F3  obligations / échéances / inscription / classe
F4  paiement / allocations / soldes / Acompte
F5  Web ↔ Mobile opérations
F6  RBAC Finance
F7  UX / wording / reçus
```

Puis seulement : **validation Finance métier** → gate parité Web/Mobile **par rôle** → feature freeze → RC.

---

## Compléments mandat (§6–§27, §30–§32)

### Obligation — création actuelle

| Mécanisme | Existe ? | Autorité prod |
|---|---|---|
| POST `fee-grids/:id/apply` | oui | **oui** |
| À l’inscription élève (API) | **non** | — |
| Au paiement | **non** (impute l’existant ; sinon non imputé) | — |
| Helper Web `applyActiveGridsToStudent` | oui dans `fees.ts` | **non** (état finance non writable client) |
| Demande unitaire | adjust / pas de « créer dette libre » Comptable | — |

Identité canonique cible : `(school, student, academicYear, fee_item, period)` + `amountDue`, `dueDate`, `status`. Unicité déjà proche en PG.

### Échéances

Aujourd’hui : si `feeType === "Mensualité"` et `monthlyMonths[]`, apply crée **une obligation par mois**. Sinon une obligation avec `periodLabel` unique.  
Pas de modèle trimestre explicite. Paiement libre = non imputé tant que pas de dette.  
Duplication : `due_date` item recopié sur chaque mensualité (même date pour tous les mois — **P1 métier** si vrai).

### Paiement vs tarif

Le paiement stocke `fee_type` dénormalisé + items. Il **ne met pas à jour** `school_fee_items`. Risque : libellé libre Web (`catalogFeeTypes` ou canonical) **sans** `feeTypeId` → matching textuel.

### Annulation / correction

Pas de DELETE HTTP paiement. Cancel + reverse allocations + audit. Montant / moyen : **pas** d’API de correction ; il faut annuler + recréer. V1 acceptable si documenté.  
`payment_items` CASCADE si le header était supprimé en SQL — l’API ne le fait pas.

### Remboursement

Non modélisé. Ne pas synonymer avec annulation. `OVERPAYMENT_ACTIONS` Web est du wording.

### Réductions / exonérations

`exemption` dans le solde. `discount` hors solde. Cible : tarif initial + réduction tracée + net dû, sans écraser l’historique de grille.

### Devise — invariant V1

**V1 = mono-devise par établissement.** Autorité : pays (`countries.currency`), surcharge `schools.profile_payload.currency`.  
Pas de multi-devises élève. Chercher/remplacer affichage `FC` / fallbacks `USD` côté frais Web.

Occurrences hardcode (hors tests/SaaS) : Mobile `FC` ; Web `CDF`/`USD` fallbacks ; DDL obligation `USD` vs grille `CDF`.

### Année académique

Grille unique `(school, class_name, year, period)`. PATCH items **remplace** les lignes de la grille (tarif 30k→35k sur **la même** grille). Obligations déjà nées **conservent** `amount_due`. Apply ultérieur skip (unique).  
**Trou :** obligations non nées voient le nouveau tarif ; pas de versionnage d’item. Cible : nouvelle année = nouvelle grille ; mid-year = nouvelle grille ou items datés, jamais update silencieux du dû existant.

### Changement de classe (6A → 6B)

**Actuel :** non spécifié. Obligations restent avec `className` dans JSON profil (grille d’origine). `class_id` NULL. Paiements passés liés à l’élève, `classId` d’encaissement = inscription **au moment du paiement**. Apply 6B peut créer de **nouvelles** dettes (autre `fee_grid_id`) sans clôturer 6A.

**Cible :** geler 6A (y compris impayés ou politique d’annulation justifiée) ; générer 6B par apply/enrollment ; ne jamais bouger les paiements passés.

### Élève sans classe

`payment-student-options` l’**exclut**. `POST /payments` exige une inscription active (`ENROLLMENT_REQUIRED`). Dette orpheline possible si créée avant sortie de classe. **Cible :** pas d’encaissement sans classe ; dettes existantes restent visibles en créances.

### Reçu

Source : paiement persisté (`reference` `{SCHOOL}-{YEAR}-PAY-{seq}`, items, montant serveur, moyen, date, auteur, école).  
Web `PaymentReceipt` somme les items côté UI (doit égaler `payments.amount`). Mobile carte sans code vérif print.

### Parent / élève

Cible : voir ses dettes, échéances, paiements, reçus, reste — jamais un autre foyer.  
Mobile `StudentPaymentsScreen` + switcher. Web dossier ComingSoon ; Impayés own-scope Parent.

### Données dérivées vs persistées

**À persister :** amount_due, amount paiement, allocations, devise, dates, method, cancel metadata, snapshots d’identité (élève/classe au reçu).  
**À calculer :** reste, taux, overdue, unallocated, Partiel/Non imputé.  
Signaler : `balance` et `status` obligation persistés **et** recalculés ; `profile_payload` cash.

### Frontière comptabilité (§31)

**V1 Finance scolaire :** tarification, créances élèves, encaissements, imputations, reçus, impayés, reporting simple.  
**Hors périmètre :** plan comptable, débit/crédit, grand livre, rapprochement bancaire, TVA, clôture, bilan, compte de résultat, opérateurs Mobile Money.

### Scénarios de référence A–H (comportement **actuel** vs cible)

| ID | Attendu métier | Actuel si obligations + API |
|---|---|---|
| A | Dû 30k, paie 30k, reste 0 | OK si `obligationId` ou feeType unique match |
| B | 10k / 30k → partiel, reste 20k | OK |
| C | 50k / 30k → 30k imputé, 20k non imputé | OK (`allocateAmount` leftover) |
| D | 30k+20k, un paiement 50k, deux imputations | **PG oui** ; Mobile non (1 ligne) ; Web oui si deux libellés matchent |
| E | Cancel → reverse → dette revient | OK |
| F | Tenant A/B | Tests #361 ; à conserver en F4 |
| G | Tarif 30k→35k, historique inchangé | Dû déjà créé inchangé ; **non nés** voient 35k |
| H | Changement classe | **Non défini** — NO-GO métier |

Comparer Web/Mobile/PG sur A–E après F4/F5, pas avant.

---

## Fichiers d’autorité inspectés (lecture seule)

`backend/db/schema.sql`, `financeSchema.js`, `financePgStore.js`, `financeService.js`, `financeCatalog.js`, `financeManagement.js`, `financeUnallocatedCash.js`, `financeObligationPaid.js`, `financeFeeTypeMatch.js`, `financePaymentItems.js`, `rbacService.js`, `server.js`  
`web/src/pages/parametres/SettingsFinancePage.tsx`, `finances/FinanceFeesPage.tsx`, `FinanceUnpaidPage.tsx`, `QuickPaymentModal.tsx`, `fees.ts`, `quickPayment.ts`, `paymentRateKpi.ts`, `unpaidModule.ts`  
`Mobile/src/screens/PaymentsScreen.tsx`, `StudentPaymentsScreen.tsx`, `PaymentMutationControls.tsx`, `paymentEnrollment.ts`, `paymentCashKpi.ts`, `paymentRateKpi.ts`

---

## Contrainte respectée

Cette PR n’introduit **aucune** migration, mutation métier, endpoint, changement de calcul ou de RBAC. Livrable = ce document.
