# GO Production — Finance Comptable + payment-student-options + Paramètres Finances — 2026-08-27

**Type :** audit + correctifs P0/P1  
**PR :** Draft dédiée  
**Branche :** `cursor/go-prod-finance-settings-9855`  
**Base :** `origin/develop@d5c7d5c0fbb72d2c4832fa7c3425f2ee46bea756`

## Verdict cible

```text
PostgreSQL Finance authority       OK
payment-student-options            OK
Comptable Web                      OK
Comptable Mobile                   OK
Paramètres → Finances              OPÉRATIONNEL V1
Types de frais                     OK (fee_grids + school_fee_items)
Échéances                          OK (due_date / period_label)
Moyens de paiement                 OK (school_payment_methods)
Devise                             OK (pays / profile établissement)
Réductions/Pénalités               DIFFÉRÉES V1 (obligation.discount / status En retard)
RBAC live                          OK
Cross-tenant                       0 fuite (SQL + tests A/B)
Legacy authority                   0 (pas de backoffice_state / localStorage)
P0                                 0
P1 bloquant production             0 (sous réserve Gates + rejeu HTTP)
```

Ready **NON**. Merge **NON**.

## 1. Architecture actuelle (avant)

```text
Finances opérations     /finances/paiements  /frais  /impayes
Paramètres Finances     /parametres/finances  ComingSoonState
GET /students           Élèves:READ — Comptable 403
GET /finance/payment-student-options   ABSENT
Moyens de paiement      hardcodés Web/Mobile
Devise                  school.profile / country.currency
Types de frais          fee_grids + school_fee_items (déjà PG)
```

Cause Comptable Mobile : `PaymentsScreen` appelait `GET /students` → 403 → aucun élève à encaisser.  
Cause Paramètres : placeholder UI alors que le référentiel `fee_grids` existait déjà.

## 2. Architecture cible (V1 livrée)

```text
Paramètres → Finances (Admin School)
        ↓  PostgreSQL
fee_grids / school_fee_items / school_payment_methods / countries.currency
        ↓
GET /api/finance/catalog
        ↓
écran de paiement Web + Mobile
        ↓
GET /api/finance/payment-student-options
        ↓
élève inscrit du tenant
        ↓
POST /api/payments
```

Séparation stricte : paramètres = règles ; Finances = transactions. Aucune transaction dans le catalogue. Aucune reconstruction des tarifs depuis l'historique.

## 3. Endpoints

| Méthode | Chemin | RBAC | Qui |
|---|---|---|---|
| GET | `/api/finance/payment-student-options` | Paiements:READ / Gérer paiements | Comptable, Admin |
| GET | `/api/finance/catalog` | Paiements:READ / Frais:READ | Comptable (lecture), Admin |
| GET | `/api/finance/payment-methods` | Paiements:READ | Comptable, Admin |
| PUT | `/api/finance/payment-methods` | Frais:UPDATE / Paramètres:UPDATE | **Admin School uniquement** |
| GET/POST/PATCH | `/api/finance/fee-grids*` | inchangé | WRITE Admin School |
| GET/POST | `/api/payments` | inchangé | Comptable opérations |

Query/body `schoolId` B ignorés : le tenant vient du principal live.

## 4. Tables PostgreSQL

| CONCEPT | TABLE | CANONIQUE ? | WEB | MOBILE | DUPLICATION | ACTION |
|---|---|---|---|---|---|---|
| Paiement | `payments` + `payment_items` | oui | oui | oui | non | conserver |
| Obligation | `student_fee_obligations` | oui | oui | oui | discount/exemption **par élève** | conserver |
| Grille / types / échéances | `fee_grids` + `school_fee_items` | oui | Paramètres + /finances/frais | via catalog | non | **référentiel V1** |
| Statuts paiement | `payment_statuses` | oui | API existante | non V1 | ≠ moyens | conserver |
| Moyens de paiement | `school_payment_methods` | **nouveau relationnel** | Paramètres | catalog | plus de hardcode client | V1 |
| Devise | `countries.currency` / `schools.profile_payload.currency` | oui | lecture | catalog | défauts CDF/USD historiques | lecture seule V1 |
| Réductions établissement | — | non | — | — | `subscription_discounts` = SaaS | **P2** |
| Pénalités | — | non | statut calculé « En retard » | — | — | **P2** |
| `finance_settings` générique | — | interdit | — | — | — | non créé |

## 5. RBAC

| Rôle | READ params | WRITE params | payment-student-options | CREATE paiement |
|---|---|---|---|---|
| SCHOOL_ADMIN | oui | oui | oui | oui |
| ACCOUNTANT / Comptable | catalog lecture | **non** | **oui** | oui |
| TEACHER | non | non | **403** | non |
| Préfet / Secrétaire | selon grants live | non grilles | non (pas Paiements) | non |
| JWT | identité/contexte | — | — | — |

PostgreSQL live RBAC = autorité. Aucun `Élèves:READ` ajouté au Comptable.

## 6. Cross-tenant

P0 : `listFinanceFeeGrids` / `listFinancePaymentStatuses` / student-options / methods filtrent **SQL** via `sqlSchoolPredicate`, plus seulement `filterRows` HTTP.

Tests A/B : élève B, grille B, moyens A jamais visibles sous principal A. Élève sans inscription exclu.

## 7. Web / Mobile

- Web `QuickPaymentModal` : source `payment-student-options` + `catalog` (plus snapshot élèves / parentPhone dans la recherche).
- Mobile `PaymentsScreen` : plus de `GET /students` obligatoire ; même catalogue métier.
- Paramètres Finances : page opérationnelle (loading / vide / liste / ajout / désactivation / 403 / erreur). Enregistrer après succès API.
- Mobile ne duplique pas le moteur de configuration V1.

## 8. Dette / hardcodes restants

- `FEE_TYPES` / `PAYMENT_METHODS` / `DEFAULT_FEE_AMOUNTS` encore dans `quickPayment.ts` comme **valeurs de repli de type**, plus comme autorité d’établissement.
- `/finances/frais` conserve l’UI opérationnelle historique (snapshot + API) — non réécrit pour ne pas casser le flux existant.
- KPI Mobile affiche encore « FC » en libellé d’affichage (devise métier = catalog).
- Réductions / pénalités établissement = P2.

## 9. P0

| ID | Sujet | Statut |
|---|---|---|
| P0-1 | Fuite list fee-grids / statuses cross-tenant (filtre mémoire seul) | **corrigé SQL** |
| P0-2 | Comptable + UUID élève/classe B | fail-closed existant + student-options scopé |

## 10. P1

| ID | Sujet | Statut |
|---|---|---|
| P1-1 | `payment-student-options` absent | **créé** |
| P1-2 | Paramètres Finances placeholder | **page V1** |
| P1-3 | Moyens hardcodés | **school_payment_methods + catalog** |
| P1-4 | Web `canManageFeeGrids` autorisait Comptable | **aligné backend** |

## 11. P2 (hors lot)

- Intégration opérateur Mobile Money
- Réductions / pénalités établissement
- Reporting / rapprochement / comptabilité générale
- RC3 offline write
- Duplicate UI `/finances/frais` vs Paramètres (convergence progressive)

## 12. Recommandations

1. Merger uniquement après Gates + rejeu Comptable Xiaomi : `GET /finance/payment-student-options` rows>0 puis paiement.
2. Ne pas accorder `Élèves:READ` au Comptable.
3. Ne pas créer `finance_settings` JSON.
4. Prochaine étape plan CTO : **gate de parité Web ↔ Mobile par rôle**, sans nouveau chantier Finance structurel.

## 13. Fichiers

Backend : `financeCatalog.js`, `financePgStore.js`, `financeMemoryStore.js`, `financeSchema.js`, `schema.sql`, `server.js`, `rbacService.js`, repositories, `20260827_school_payment_methods.sql`.  
Web : `SettingsFinancePage.tsx`, hub, `financeApi.ts`, `QuickPaymentModal.tsx`, `fees.ts`.  
Mobile : `PaymentsScreen.tsx`, `PaymentMutationControls.tsx`, `api.ts`.  
Tests : `financeCatalog.test.js`, `financeRepository*.js`, `verify-finance-management.js`, `SettingsFinancePage.test.tsx`.

## 14. Migrations

`backend/db/migrations/20260827_school_payment_methods.sql` — table `school_payment_methods` uniquement. Aucune mutation de données métier. Aucun `backoffice_state`.

## 15. Champs Paramètres Finances

| UI | API | DB | Requis | Défaut | Validation | RBAC | Tenant |
|---|---|---|---|---|---|---|---|
| Devise | `catalog.currency` | `countries.currency` / `schools.profile_payload.currency` | oui | pays | ISO lecture | READ catalog | school |
| Moyen label/actif | `paymentMethods[]` | `school_payment_methods` | oui | canonique serveur si vide | codes canoniques | WRITE Admin | school_id |
| Type de frais | `feeTypes[]` / POST fee-grids | `school_fee_items.fee_type` | oui | — | catalogue canonique | WRITE Admin | school_id |
| Montant | item.amount | `school_fee_items.amount` | oui | — | > 0 | WRITE Admin | school_id |
| Échéance | dueDate | `school_fee_items.due_date` | non | null | date | WRITE Admin | school_id |
| Classe / année | grid | `fee_grids.class_name` / `academic_year` | oui | — | tenant | WRITE Admin | school_id |
| Obligatoire | mandatory | `school_fee_items.mandatory` | oui | true | bool | WRITE Admin | school_id |
| Réductions | — | — | — | différé | — | — | — |
| Pénalités | — | — | — | différé | — | — | — |
