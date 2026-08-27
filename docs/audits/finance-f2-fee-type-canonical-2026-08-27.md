# Finance F2 — Référentiels de types de frais uniques — 2026-08-27

**Type :** convergence de vocabulaire. Pas de naissance d’obligation (F3). Pas de soldes définitifs (F4). Pas de parité d’imputation (F5).  
**Sources :** #362 audit métier · #363 F1 invariants · `backend/lib/financeDomainInvariants.js`  
**Branche :** `cursor/finance-f2-fee-type-canonical-9855`

```text
FINANCE BUSINESS MODEL = NO-GO   (inchangé)
FINANCE F1 INVARIANTS            = GO (mergé)
FINANCE F2 RÉFÉRENTIELS          = GO (Gates #364)
```

---

## Décision d’autorité

**Catalogue système** dans `backend/lib/financeFeeTypes.js`.

Aucune table `fee_types` : les types V1 ne sont pas personnalisables par établissement. Créer une table n’ajouterait qu’une quatrième copie.  
`school_fee_items.fee_type` / `student_fee_obligations.fee_type` / `payment_items.fee_type` restent TEXT (snapshot). Les colonnes ne sont pas supprimées.

Identité stable = `code` (ex. `TUITION`). Stockage = label FR canonique (`Scolarité`).  
Les relations financières comparent le **code** via `resolveFeeType`, plus `feeType === "Minerval"`.

GET `/finance/catalog` projette `feeTypeCatalog` (et `canonicalFeeTypes` = même liste, compat).

---

## Matrice des vocabulaires

| Libellé actuel | Source | Utilisé par | Signification | Canonique ? | Mapping cible | Suppression F2 |
|---|---|---|---|---|---|---|
| Inscription | CANONICAL / grilles | Web, API, PG | Catégorie métier | Oui `ENROLLMENT` | Inscription | Non |
| Réinscription | CANONICAL | Settings, paiements | Catégorie métier | Oui `REENROLLMENT` | Réinscription | Non |
| Scolarité | CANONICAL | Mobile, matcher | Nature du frais | Oui `TUITION` | Scolarité | Non |
| Scolarité / mensualité | ancien CANONICAL label | catalog | Confusion type/période | Non | Scolarité | Oui (label) |
| Mensualité | SCHOOL_FEE_TYPES | FinanceFeesPage, apply | **Périodicité** | Non | Scolarité + `monthlyMonths` | Liste locale |
| Minerval / scolarité | FEE_TYPES Web | QuickPayment, tests | Alias scolarité | Non | Scolarité | Liste locale |
| Examen / Frais d'examen | CANONICAL / FEE_TYPES | paiements | Catégorie | Oui `EXAM` | Examen | Alias lecture |
| Uniforme | CANONICAL | Settings | Catégorie | Oui `UNIFORM` | Uniforme | Non |
| Transport / Frais de transport | CANONICAL / FEE_TYPES | paiements | Catégorie | Oui `TRANSPORT` | Transport | Alias lecture |
| Cantine / Frais de cantine | CANONICAL / matcher | paiements | Catégorie | Oui `CANTEEN` | Cantine | Alias lecture |
| Autre / Autre frais | CANONICAL / FEE_TYPES | Settings | Fourre-tout V1 | Oui `OTHER` | Autre | Alias lecture |
| Annexe | SCHOOL_FEE_TYPES | grilles, matcher | Seau vague | **Non** | Fail closed à l’écriture | Sélecteur |
| Acompte | Mobile fallback | PaymentMutation | Paiement partiel / non imputé | **Non** | Interdit ; `Non imputé` si pas d’obligation | Fallback |
| Frais de bulletin | FEE_TYPES Web | MVP balances | Non démontré V1 | **Non** | Fail closed | Liste locale |
| aliases financeFeeTypeMatch | matcher | allocation Web | Colle | Non (lecture) | codes catalogue | Autorité matcher |

---

## Inventaire PostgreSQL (valeurs legacy)

L’agent Cloud n’avait pas les tables Finance provisionnées (`school_fee_items` absent). Inventaire **code + seeds/tests** :

| VALUE | COUNT (code/tests) | SCHOOL COUNT | MAPPING | AMBIGUOUS ? | ACTION |
|---|---|---|---|---|---|
| Inscription | fréquent | n/a | ENROLLMENT | Non | Conserver |
| Mensualité | fréquent (grilles) | n/a | TUITION | Non (périodicité démontrée) | Écriture → Scolarité ; lecture alias |
| Minerval / scolarité | paiements Web | n/a | TUITION | Non | Écriture → Scolarité |
| Scolarité | Mobile / matcher | n/a | TUITION | Non | Conserver |
| Annexe | grilles 3-types | n/a | — | **Oui** | Pas de backfill ; écriture refusée |
| Acompte | Mobile | n/a | — | Interdit | Plus d’écriture ; historique lisible |
| Cantine / Transport / Uniforme / Examen | mixte | n/a | codes | Non | Labels canoniques |
| Frais de bulletin | FEE_TYPES seul | n/a | — | Oui | Pas d’écriture |

Aucune conversion destructive d’Annexe historique.

---

## Mensualité

Scolarité = nature. Mensuelle = `monthlyMonths` / échéancier.  
Apply serveur et helper Web étendent **si `monthlyMonths` est non vide**, plus `feeType === "Mensualité"`.

---

## Acompte

P1 : retiré des catalogues et du fallback Mobile.  
Nouvelle opération sans obligation : `feeType` vide, `feeLabel` « Non imputé » (pas un FEE_TYPE).  
Traitement d’imputation partielle : F4.

---

## Contrat API

`GET /finance/catalog` :

- `feeTypeCatalog[]` : `{ code, feeType, label, active }` — **autorité clients**
- `canonicalFeeTypes[]` : même projection (compat Settings)
- `feeTypes[]` : **lignes tarifaires** PG (`school_fee_items`), pas le vocabulaire

---

## Clients

- Settings → `feeTypeCatalog` / `canonicalFeeTypes`
- FinanceFeesPage → catalogue API (plus `SCHOOL_FEE_TYPES`)
- QuickPaymentModal → `feeTypeCatalog` (plus `FEE_TYPES` / Minerval)
- Mobile → plus de `feeType: "Acompte"` ; obligations conservent leur snapshot

---

## Cross-tenant

Catalogue **système** : A et B voient les mêmes codes. Aucun type privé. Isolation inchangée sur grilles/paiements.

---

## Historique

Modifier un libellé catalogue ne réécrit pas les obligations existantes.  
Snapshot = `fee_type` + `label` déjà copiés à l’apply. F3 pourra ajouter `feeTypeCode`.

---

## Hors périmètre

F3 obligations/classe/tarif · F4 soldes/allocations · F5 parité · F6 RBAC · F7 UX · réductions/pénalités/remboursement.

---

## P1 — LEGACY AMBIGUOUS FEE TYPE WRITE BYPASS

Le HEAD `7e59b80a` passait CI 9/9 mais `createPayment` réécrivait encore `Annexe` / `Frais de bulletin` :

1. `feeTypeId` / `schoolFeeItemId` : `resolveFeeType(..., mode:"read")` puis fallback `catalog.feeType`.
2. `obligationId` + `feeType` vide : copie silencieuse du snapshot obligation.

Correctif : les deux inférences passent par `persistableFeeType` (mode write). Alias non ambigus (`Mensualité`, `Minerval`) → `Scolarité`. Ambigu / inconnu → `FINANCE_FEE_TYPE_AMBIGUOUS`, rollback, aucune ligne `payments` / `payment_items` / `payment_allocations`. Lecture historique inchangée.

Couverture : `backend/lib/financeFeeTypeWriteBypass.test.js` dans `verify:finance-fee-type-canonical`.

---

## Verdict F2

```text
FINANCE F2 RÉFÉRENTIELS  = GO
FINANCE BUSINESS MODEL   = NO-GO
```

Local `verify:finance-fee-type-canonical` + `verify:finance-domain-invariants` : **GO**  
PR #364 HEAD `7e59b80a` : **9/9 SUCCESS** (Scope, Secrets, Quality, Core tests, Risk-targeted incl. finance-fee-type-canonical, Required, architecture-audit, Admin User Creation, verify:ui-french-copy).

```text
Référentiel Type de frais       UNIQUE (financeFeeTypes.js)
Acompte comme fee type          0 (catalogue + fallback Mobile)
Listes Web concurrentes         0 (SCHOOL_FEE_TYPES / FEE_TYPES retirés)
Listes Mobile concurrentes      0
Matching métier ambigu          lecture seule (Annexe historique)
Catalogue API                   CANONIQUE (feeTypeCatalog)
Grilles → type canonique        persistableFeeType
createPayment feeTypeId         persistableFeeType (fail-closed)
createPayment obligationId      persistableFeeType (fail-closed)
Cross-tenant                    catalogue système identique
Historique                      PRÉSERVÉ (TEXT snapshot)
Nouvelle duplication            0
```

```text
PR     DRAFT
Ready  NON
Merge  NON sans ordre CTO
```

F2 GO ≠ Finance business GO. Suite : F3 obligations, seulement après merge F2.
