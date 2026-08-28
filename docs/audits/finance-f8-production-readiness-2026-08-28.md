# Finance F8 — Audit transversal de clôture / production-readiness

Date : 2026-08-28  
Branche : `audit/finance-f8-production-readiness`  
Base obligatoire : `develop@39bbe0f431c81ab2ae38a995370a80a2a1fb537a` (merge F7 #370)

```text
F8          AUDIT DE CLÔTURE
PR          DRAFT UNIQUEMENT
Ready       NON
Merge       NON
F9          NON OUVERT
```

Le CTO effectuera un diff GitHub indépendant `develop → HEAD` avant toute autorisation de merge.

Gate : `npm run verify:finance-readiness`  
Workflow : `.github/workflows/finance-f8.yml` (`Finance F8`)

---

## 1. Executive summary

Après F1→F7, le domaine Finance de Somafrik a une chaîne canonique PostgreSQL :

`Référentiel tarifaire → Grille → Application → Obligation élève → Encaissement → Allocation → Solde → Impayé → Relance → Annulation → Audit`

L'audit F8 a cherché les écarts de **production-readiness**, pas de nouvelles fonctionnalités métier.

Trois P0 ont été confirmés dans le code F7 mergé / le premier passage F8. Un quatrième a été levé par l'audit CTO indépendant de #371 (`0359e81f`) : le service Finance central restait fail-open si `principal.schoolCode` était vide. Tous corrigés avec tests :

| ID | Sujet | Statut |
|---|---|---|
| F8-P0-001 | `GET /api/finance/student-fees/:obligationId` lisait une obligation étrangère (pas de filtre tenant SQL) | **CORRIGÉ** |
| F8-P0-002 | Moyen « Mobile money » → statut présentation « En attente » → `payment_status=pending` → trigger F4 `FINANCE_PAYMENT_NOT_SETTLED` → rollback de l'imputation | **CORRIGÉ** |
| F8-P0-003 | `GET /api/payments/:id` fuitait un encaissement A vers B si `schoolCode` absent du principal | **CORRIGÉ** |
| F8-P0-004 | `assertTenant` / `findStudent` / `getGrid` fail-open quand `principal.schoolCode` est vide (`*` ou absence = toutes les écoles) | **CORRIGÉ** |

P1 corrigés : replis devise `USD`/`CDF`, Idempotency-Key Web, relance sans `withIdempotency`, `DEFAULT` devise obligations/grilles, **Admin Pays iso_code vs préfixe `schoolCode`** (F8-P1-006 / CTO F8-P1-005).

Aucun P0/P1 **ouvert** dans le code de cette branche après corrections. Le verdict reste **GO CONDITIONNEL** (pas GO PRODUCTION) : UX Web/Mobile non exercée dans un navigateur/appareil réel ici, smoke préprod non joué sur un établissement live, performance non mesurée à l'échelle de plusieurs milliers d'élèves. Diff CTO `develop → HEAD` obligatoire avant Ready/merge.

---

## 2. Architecture Finance finale

### 2.1 Source de vérité

PostgreSQL. JWT = identité. Permissions Finance = `resolveFinanceLivePermissions` (F6). Soldes = projection `payment_allocations` (F4). Types de frais = catalogue F2. Naissance des obligations = moteur F3 (grille / inscription), jamais le paiement.

### 2.2 Tables PostgreSQL

| Table | Verdict | PK | school_id | UNIQUE / CHECK notables | Statut | Timestamps | Monétaire | Audit |
|---|---|---|---|---|---|---|---|---|
| `fee_grids` | **CANONIQUE** | `id` UUID | OUI | `(school_id, grid_code)` ; unicité classe+année+période | `Brouillon` / `Active` / `Désactivée` | created/updated | `currency` (plus de DEFAULT CDF) | via `fee_tariff_history` |
| `school_fee_items` | **CANONIQUE** | `id` UUID | OUI | `(fee_grid_id, item_code)` ; `amount > 0` | Actif / Désactivé | created/updated | `amount` | snapshot dans obligations |
| `student_fee_obligations` | **CANONIQUE** | `id` UUID | OUI | unicité active (élève+grille+item+période) ; identity (année+fee_type_code+period_key) | À payer / Partiellement payé / Payé / En retard / Annulé / Exonéré (trigger F4) | created/updated, cancelled_at | amount_due, amount_paid, balance, discount, exemption | cancelled_by, profile_payload |
| `payments` | **CANONIQUE** | `id` UUID | OUI | `payment_code` UNIQUE ; `amount` NOT NULL (pas de CHECK `> 0`) | paid / pending / cancelled | created/updated, cancelled_at | amount, currency | cancelled_by, cancel_reason, profile_payload ; `created_by` **non alimenté** |
| `payment_items` | **CANONIQUE** | `id` UUID | OUI | `amount > 0` ; trigger tenant | — | created_at | amount | — |
| `payment_allocations` | **CANONIQUE** | `id` UUID | OUI | `amount > 0` ; trigger F4 (tenant, élève, devise, settled, over-allocation) | reversed_at NULL = actif | created_at, reversed_at | amount | — |
| `school_payment_methods` | **CANONIQUE** | `id` UUID | OUI | `(school_id, method_code)` | is_active | created/updated | — | — |
| `payment_statuses` | **CANONIQUE** | `id` UUID | OUI (nullable = global) | school+status_code | is_active | created/updated | — | — |
| `payment_reminders` | **CANONIQUE** | `id` UUID | OUI | — | send_status | sent_at, created_at | — | triggered_by ; **FK obligation jamais peuplée** |
| `fee_tariff_history` | **CANONIQUE** | `id` UUID | OUI | — | action | created_at | payload JSONB | actor_id |
| `idempotency_keys` | **CANONIQUE** (transversal) | clé+route+principal | scope école | TTL 7j paiements | — | — | — | — |
| `audit_logs` | **CANONIQUE** (transversal) | `id` UUID | OUI | — | action/entity | created_at | old/new JSONB | user_id, ip, ua |
| `backoffice_state` clés Finance | **LEGACY** | — | — | écriture interdite (`LEGACY_FINANCE_STATE_WRITE_FORBIDDEN`) | — | — | — | — |
| `financeMemoryStore` | **LEGACY** (dev only) | — | — | hors production | — | — | — | — |
| `subscription_payments` | **HORS PÉRIMÈTRE** (plateforme) | — | — | — | — | — | — | — |

`discount` obligation : hors formule V1 F4 (exemption + allocations). **RÉSIDUELLE**.

### 2.3 Devise

Chaîne visée : `countries.currency` → `getSchoolByCode` (join) → catalogue / obligations / paiements / Web / Mobile / reçus.

Plus aucun repli silencieux `CDF` / `USD` / `EUR` sur le chemin Finance. Absence → erreur `FINANCE_CURRENCY_REQUIRED` (écritures) ou devise vide → `—` (présentation F7).

Alias de présentation uniquement : `FC → CDF`.

---

## 3. Parcours certifié

Scénario HTTP PostgreSQL isolé (`somafrik_finance_f8_it`, port 19872) :

1. École A (pays CI, **XOF**) + école B (pays FR, **EUR**)
2. Classe + 2 élèves A, 1 élève B, inscriptions actives
3. Grille A (Inscription 100 + Scolarité 200, échéance 2026-01-01)
4. Activation + application → 4 obligations ; 2ᵉ apply → `created=0`
5. Paiement partiel A1 inscription 40 → solde 60
6. Paiement 60 **Mobile money** → solde 0, imputé
7. Annulation du 60 → solde 60, allocations `reversed_at`, paiement conservé
8. Paiement multi-item A2 100+200 → soldé
9. Non imputé 15, même Idempotency-Key → un seul encaissement ; nouvelle key → second
10. Impayés : A2 soldé absent
11. Relance A1 + replay key → une seule ligne `payment_reminders`
12. Isolation : A ne lit pas grille/obligation B ; B ne mute pas A
13. Concurrence 2×150 sur Scolarité 200 → pas de solde négatif, pas d'over-allocation
14. Grant live `F8_PAY` → POST 201 ; revoke PostgreSQL, **même JWT** → 403, compteur inchangé

---

## 4. Matrice API / RBAC

Source : `backend/lib/financeRbacRouteMatrix.js`. Toutes les routes listées passent `requirePermission` live F6.

| Endpoint | Permission | Tenant | Transaction | Idempotence | Web | Mobile | Test F8 |
|---|---|---|---|---|---|---|---|
| GET `/api/finance/catalog` | Paiements:READ \| Frais & tarifs:READ | schoolCode | lecture | — | oui | oui | XOF vs EUR |
| GET `/api/finance/payment-student-options` | Paiements:READ | tenant, pas Élèves:READ | lecture | — | oui | oui | F6 |
| GET/PUT `/api/finance/payment-methods` | READ / UPDATE Frais\|Paramètres | tenant | oui PUT | — | Settings | catalogue | F6/F7 |
| GET/POST/PATCH `/api/finance/payment-statuses` | Paiements:READ / UPDATE | tenant | oui | — | EntityPage | — | F6 |
| GET/POST `/api/finance/fee-grids` | READ / CREATE\|UPDATE | tenant | oui | — | FinanceFeesPage | — | F8 HTTP |
| GET `/api/finance/fee-grids/:id` | READ | HTTP 404 hors tenant | lecture | — | oui | — | F8 HTTP |
| PATCH `/api/finance/fee-grids/:id` | UPDATE | assertTenant | oui | — | oui | — | F4/F5 |
| POST `.../activate\|deactivate` | UPDATE | assertTenant | oui | — | oui | — | F8 HTTP |
| POST `.../apply` | UPDATE | assertTenant | oui + unique obligations | `Idempotency-Key` | oui + key | — | F8 HTTP |
| GET `/api/finance/student-fees` | Impayés\|Paiements\|Frais READ | tenant | lecture | — | DataContext | student-fees | F8 HTTP |
| GET `/api/finance/student-fees/:id` | idem | **SQL scope principal** | lecture | — | — | — | F8 HTTP **P0** |
| POST `.../adjust` | Paiements\|Frais UPDATE | tenant | oui | — | — | — | F3 |
| POST `/api/finance/reconcile-payment-allocations` | Paiements:UPDATE | tenant | oui | — | — | inventory | F4 |
| GET `/api/payments` | Paiements:READ | tenantScope | lecture | — | EntityPage | PaymentsScreen | F8 HTTP |
| GET `/api/payments/:id` | Paiements:READ | school_code SQL | lecture | — | reçu | reçu | F8 HTTP |
| POST `/api/payments` | CREATE \| UPDATE | ignoreClientScope schoolId | oui + lock obligations | `Idempotency-Key` 7j | QuickPaymentModal | PaymentMutationControls | F8 HTTP |
| POST `/api/payments/:id/cancel` | UPDATE seul | tenant | oui + reverse allocations | `Idempotency-Key` | EntityPage | PaymentCancelControls | F8 HTTP |
| GET `/api/backoffice/finance/unpaid` | Impayés\|Paiements\|Frais READ | overlay projection | lecture | — | page Web agrège student-fees | — | F8 HTTP |
| POST `.../unpaid/:id/reminders` | Impayés:CREATE \| Paiements:UPDATE | tenant | oui | **withIdempotency** | FinanceUnpaidPage | — | F8 HTTP |
| GET `/api/students/:id/payments` | périmètre élève | resolveAuthorizedStudent | lecture | — | fiche | StudentPayments | F6 |

Legacy : `PUT /api/backoffice/state` Finance = retiré. `financeMemoryStore` = hors prod.

---

## 5. Matrice Web / Mobile

| Étape | Web | Mobile | Même vérité backend |
|---|---|---|---|
| Devise | `resolveFinanceCurrency` | même helper | catalogue établissement |
| Tarifs / grilles | FinanceFeesPage, QuickFeeGridModal | pas d'écran grilles (hors V1 mobile) | API grilles |
| Application | `applyFeeGrid` + Idempotency-Key | — | unique PG |
| Obligations ouvertes | OpenObligationCards / GET student-fees | PaymentMutationControls | projection serveur |
| Encaissement | QuickPaymentModal + busyRef + key | PaymentMutationControls + key | POST `/payments` |
| Reçu | PaymentReceipt (persisté) | PaymentReceiptCard | GET paiement |
| Reste à payer | student-fees.balance | soldes après refresh | F4 trigger |
| Impayés | FinanceUnpaidPage (filtre client sur student-fees) | KPI unpaid = GET payments | soT obligations |
| Annulation | EntityPage + key | PaymentCancelControls | POST cancel |
| Offline | N/A (web online) | paiement **refusé**, pas d'outbox Finance | PostgreSQL only |
| RBAC UI | `resolveFinanceUiActions` live permissions | `canRecordSchoolPayment` OR CREATE\|UPDATE | F6/F7 |

Pas de `role === "Comptable"` / `"Admin School"` sur les écrans Finance.

---

## 6. Invariants monétaires

```
montant paiement = Σ allocations actives + montant non imputé
solde obligation = max(0, amount_due − Σ allocations actives − exemption)
```

Autorité : trigger `payment_allocations_assert_canonical` + `student_fee_obligations_project_allocations`.

Politique constatée :

| Sujet | Politique |
|---|---|
| Paiement 0 / négatif | 400 `PAYMENT_AMOUNT_INVALID` |
| Surpaiement | autorisé comme **non imputé** (conservation F4) ; pas de fusion élève+date |
| Arrondi | `NUMERIC(12,2)` ; tolérance trigger `+ 0.005` |
| Devise | établissement / pays ; mismatch allocation → `FINANCE_CURRENCY_MISMATCH` |
| Minimum | strictement `> 0` côté API et `payment_items` / `school_fee_items` / allocations |
| Double clic | Idempotency-Key (Web + Mobile + relance + apply) |
| Double paiement distinct | nouvelles keys → deux encaissements |

---

## 7. Isolation tenant

Lectures / mutations Finance dérivent l'école du **principal**, jamais d'un `schoolId` body (`ignoreClientScope`).

Contrats observés : **404** (ressource hors scope) ou **403** (RBAC / TENANT_MISMATCH). Aucune fuite d'identifiants B dans les listes A.

Scope canonique unique : `resolveFinanceSchoolScope` + `sqlSchoolPredicate` / `schoolCodeInScope`.

- école scoped → codes `effectiveSchoolCode` / `effectiveSchoolInternalCode` / `schoolCode` (jamais `*`) ;
- Superadmin request-scoped → uniquement l'école effective ;
- Admin Pays sans école effective → pays (`countries.iso_code` via FK `schools.country_id`, jamais le préfixe `schoolCode`) ;
- Superadmin réellement global → `mode: "all"` ;
- principal sans scope exploitable → `mode: "none"` (fail-closed).

`schoolCode` vide ne signifie plus « toutes les écoles ». `assertTenant`, `findStudent`, `getGrid`, catalogue / moyens / statuts passent par ce scope. HTTP GET grille applique le même prédicat (plus un `if (schoolCode)` fail-open).

---

## 8. Idempotence

| Mutation | Mécanisme |
|---|---|
| POST paiement | `withIdempotency` + table `idempotency_keys` (TTL 7 jours) |
| Apply grille | idempotency optionnelle **et** UNIQUE obligations |
| Annulation | idempotency + no-op si déjà `cancelled_at` (pas de DELETE) |
| Relance | `withIdempotency` (ajout F8) + cooldown 3 jours |

Interdit : fusion automatique `élève + date`. Vérifié : deux keys distinctes → deux paiements non imputés.

---

## 9. Atomicité / concurrence

`createPayment` / `cancelPayment` / `applyFeeGrid` / `createReminder` : `store.withTransaction`.

Obligations verrouillées `SELECT … FOR UPDATE` à l'encaissement. Trigger F4 refuse over-allocation. Course F8 : deux POST 150 sur dette 200 → allocated ≤ 200, solde ≥ 0.

Demi-écriture paiement+allocation : rollback transaction (F4 `FINANCE_PAYMENT_NOT_SETTLED` était le P0 Mobile money).

---

## 10. Auditabilité

| Mutation | Qui | Quand | Établissement | Ressource | Old/New | Annulation |
|---|---|---|---|---|---|---|
| Création paiement | `writeFinanceAudit` create_payment | created_at | school_code | payment_code | newValue | — |
| Annulation | cancel_payment + cancelled_by/at/reason | cancelled_at | school | payment | motif | soft |
| Grille create/update/apply | `fee_tariff_history` | created_at | school_id | fee_grid_id | payload | — |
| Ajustement obligation | updateObligation | updated_at | school | obligation | status/balance | cancel_reason si archivée |
| Catalogue moyens/statuts | Settings + audit générique | updated_at | school | row | — | — |
| Relance | `auditService.record` send_payment_reminder | sent_at | school | studentId | channel/summary | — |

`payments.created_by` UUID n'est pas alimenté (acteur dans profile_payload / audit_logs). **P2**.

`payment_reminders.student_fee_obligation_id` n'est pas renseigné. **P2**.

---

## 11. Performance

Pas de campagne de charge. Lecture code :

- Listes Finance : `JOIN schools` + filtre `school_id` / `school_code`. Index `idx_student_fee_obligations_school_student`, allocations par payment/obligation.
- Risque : `GET /backoffice/finance/unpaid` reconstruit l'état backoffice overlay (`overlayFinanceProjection`) plutôt qu'une requête SQL dédiée — acceptable à quelques centaines d'élèves, à surveiller au-delà.
- `GET /payments` enrichit chaque ligne avec `findStudent` en mémoire de la projection déjà chargée (pas de N+1 SQL HTTP).
- Pas d'optimisation F8.

---

## 12. Findings P0

### F8-P0-001 — Fuite tenant obligation (CORRIGÉ)

- **Fichier / endpoint :** `backend/db/financePgStore.js` `getObligationByPublicId` ; GET `/api/finance/student-fees/:obligationId`
- **Scénario :** principal école A, UUID/publicId d'une obligation B
- **Attendu :** 403/404, aucune donnée B
- **Observé (avant) :** SELECT sans prédicat école ; `principal` ignoré
- **Impact :** lecture de créance étrangère
- **Correction :** `resolveFinanceSchoolScope` + `sqlSchoolPredicate` (PG) ; `schoolCodeInScope` (mémoire)
- **Test :** `financeReadiness.http.pg.test.js` GET obligation B depuis A

### F8-P0-002 — Mobile money non imputable (CORRIGÉ)

- **Fichier :** `backend/lib/financeUnallocatedCash.js` `resolvePaymentStatus` ; `web/src/lib/quickPayment.ts`
- **Scénario :** paiement alloué, method = Mobile money
- **Attendu :** `payment_status=paid`, allocations persistées
- **Observé (avant) :** statut « En attente de confirmation » → `pending` → trigger F4 rollback
- **Impact :** perte d'imputation / encaissement impossible
- **Correction :** le moyen n'est plus un statut de règlement ; Payé / Partiel / Non imputé
- **Test :** HTTP Mobile money 60 imputé ; unitaire `financeUnallocatedCash.test.js`

### F8-P0-003 — Fuite tenant paiement par ID (CORRIGÉ)

- **Fichier / endpoint :** `getPaymentByCode` ; GET `/api/payments/:paymentId`
- **Scénario :** principal école B, `paymentId` d'un encaissement A
- **Attendu :** 403/404
- **Observé (avant) :** 200 + payload A si `principal.schoolCode` vide (filtre SQL sauté)
- **Impact :** lecture d'un encaissement étranger (IDOR)
- **Correction :** même scope `resolveFinanceSchoolScope` / `sqlSchoolPredicate` que les obligations
- **Test :** HTTP F8 GET paiement A depuis B + liste B sans l'id A

### F8-P0-004 — tenant Finance fail-open `principal.schoolCode` vide (CORRIGÉ)

- **Fichier / endpoint :** `backend/lib/financeService.js` `assertTenant` ; `findStudent` / `getGrid` (PG + mémoire) ; POST `/api/payments` ; POST relance ; activate/apply grilles
- **Scénario reproductible :** JWT Comptable A avec `schoolCode=""` et `effectiveSchoolCode=SCH-F8-A` (`schoolScopeSource=request`) ; `studentId` / `gridId` / `paymentId` école B
- **Attendu :** GET A 200 ; GET B 403/404 ; POST paiement B 403/404 et compteur B inchangé ; relance B refusée sans row `payment_reminders` ; activate/apply grille B refusés, obligations B inchangées ; Superadmin request-scoped A ne sort pas de A ; Admin Pays CI refuse FR/B ; Superadmin global sans request scope conserve l'accès B
- **Observé (avant, HEAD `0359e81f`) :** `assertTenant` retournait si `schoolCode` vide ou `*` ; `findStudent` devenait un SELECT global ; `getGrid` était global. Encaissement / relance / apply grille B possibles.
- **Impact :** mutation financière inter-tenant (P0) — même famille que P0-003, non limitée au GET paiement
- **Correction :** un seul scope canonique (`resolveFinanceSchoolScope`) ; plus de `if (!schoolCode) return`. SQL pays via `countries.iso_code`.
- **Test :** `financeSchoolScope.test.js` + HTTP réel `schoolCode: ""` dans `financeReadiness.http.pg.test.js` (gate `verify:finance-readiness`)

---

## 13. Findings P1

### F8-P1-001 — Repli USD impayés (CORRIGÉ)

- **Fichiers :** `web/src/lib/unpaidModule.ts` ; `backend/services/unpaidService.js`
- **Observé :** `currency ?? "USD"` si liste vide
- **Correction :** devise vide, présentation `—`
- **Test :** `unpaidModule.currency.test.ts`

### F8-P1-002 — Repli CDF silencieux (CORRIGÉ)

- **Fichiers :** `financePgStore.getSchoolByCode`, `financeService.createPayment/createReminder`, `financeCatalog.buildFinanceCatalog`, `financeObligationLifecycle.snapshotCurrency`, `financeMemoryStore`
- **Observé :** `school.currency \|\| "CDF"` masquait une devise absente
- **Correction :** `requireSchoolCurrency` (400) ; catalogue sans DEFAULT
- **Test :** école XOF vs EUR dans HTTP F8

### F8-P1-003 — DEFAULT devise landmine (CORRIGÉ)

- **Tables :** `student_fee_obligations.currency DEFAULT 'USD'` ; `fee_grids.currency DEFAULT 'CDF'`
- **Impact :** INSERT omettant la colonne écrivait une devise arbitraire
- **Correction :** `ALTER … DROP DEFAULT` dans `financeSchema.js`

### F8-P1-004 — Web sans Idempotency-Key (CORRIGÉ)

- **Fichiers :** QuickPaymentModal, EntityPage cancel, FinanceFeesPage apply, FinanceUnpaidPage relance, `financeApi.ts`
- **Observé :** Mobile envoyait la key ; Web non → retry réseau = double encaissement possible
- **Correction :** `createFinanceIdempotencyKey` + rotation après succès

### F8-P1-005 — Relance sans withIdempotency (CORRIGÉ)

- **Endpoint :** POST `/api/backoffice/finance/unpaid/:studentId/reminders`
- **Correction :** même enveloppe que POST paiement
- **Test :** replay key → une seule row

### F8-P1-006 — Admin Pays : deux sources de vérité tenant (CTO F8-P1-005) (CORRIGÉ)

- **Fichiers :** `financeSchoolScope.js` `schoolCodeInScope` / `schoolRecordInFinanceScope` / `assertTenant` ; `upsertFeeGrid` ; mappers `countryIso` ; GET fee-grids
- **Observé (HEAD `8f605620`) :** le SQL Finance scope pays via `schools.country_id → countries.iso_code`, mais `schoolCodeInScope("country")` autorisait `schoolCode.slice(0, 2) === countryCode`. `assertTenant` et `resolveActorSchoolCode` s'appuyaient sur ce préfixe. Les fixtures F8 (`SCH-F8-A` / CI, `SCH-F8-B` / FR) ne commencent pas par l'ISO : une mutation Admin Pays légitime sur A pouvait être refusée, et un code commençant par `CI` pouvait être accepté même rattaché à FR.
- **Correction :** mode `country` exige `countryIso` d'un enregistrement résolu (PostgreSQL). `assertTenant(string)` en mode pays = 403 (fail-closed, pas de décision sur le préfixe). Mutations grille : `getSchoolByCode` puis `assertTenant(principal, school)`. Aucun fallback `slice(0, 2)`.
- **Test :** `financeSchoolScope.test.js` F8-P1-006 ; HTTP `SCH-F8-A` autorisé, `SCH-F8-B` refusé, piège `CI-TRAP-26-001` (pays FR) refusé. Tous les cas F8-P0-004 conservés.

Aucun P1 ouvert dans le code de cette branche.

---

## 14. Findings P2

| ID | Sujet | Commentaire |
|---|---|---|
| F8-P2-001 | `GET /api/finance/fee-grids/:id` SQL `getGrid` sans tenant | **Reclassé / fermé par F8-P0-004** : `getGrid` + HTTP GET utilisent le scope canonique |
| F8-P2-002 | Page Impayés Web agrège `student-fees` au lieu de GET unpaid | Même filtre, même SoT obligations ; duplication de présentation |
| F8-P2-003 | `payments.created_by` non alimenté | Acteur dans `audit_logs` / profile |
| F8-P2-004 | `payment_reminders.student_fee_obligation_id` jamais posé | Relance au niveau élève |
| F8-P2-005 | `payments.amount` sans CHECK `> 0` | API refuse 0/négatif ; items/allocations ont CHECK |
| F8-P2-006 | Modification d'une grille Active autorisée | Les obligations existantes ne sont pas réécrites (insertIfAbsent) |
| F8-P2-007 | Overlay unpaid reconstruit l'état BO | Scalabilité à surveiller |
| F8-P2-008 | `discount` obligation hors formule V1 | Documenté F4 |
| F8-P2-009 | UX Web/Mobile non recettée navigateur/appareil dans F8 | Contrats + source + HTTP |

---

## 15. Tests ajoutés

| Artefact | Rôle |
|---|---|
| `backend/lib/financeReadiness.http.pg.test.js` | Parcours 1–15 PostgreSQL réel + tenant + XOF/EUR + concurrence + revoke + **F8-P0-004 schoolCode vide** + **F8-P1-006 Admin Pays iso_code** |
| `backend/lib/financeSchoolScope.test.js` | Fail-closed `schoolCode` vide / `*` ; Superadmin scoped vs global ; Admin Pays **iso_code**, pas préfixe |
| `backend/scripts/verify-finance-readiness.js` | Source guards + unitaires + HTTP |
| `web/src/lib/unpaidModule.currency.test.ts` | Pas de USD inventé |
| `backend/lib/financeUnallocatedCash.test.js` | Mobile money ≠ pending |
| `backend/lib/financeCatalog.test.js` | Devise vide ≠ CDF |
| `.github/workflows/finance-f8.yml` | CI ciblée `Finance F8` |
| `npm run verify:finance-readiness` | Gate unique F8 |

---

## 16. Limitations connues

- Pas de capture Web/Mobile réelle dans cet environnement agent (pas de navigateur applicatif Somafrik ni APK).
- Pas d'insertion sur une préprod partagée (interdit de purger ; scénario ci-dessous à jouer manuellement).
- Mode mémoire `financeMemoryStore` hors certification production.
- L1/offline : Finance n'est **pas** dans `OUTBOX_ALLOWED_DOMAINS` ; tentative paiement offline → erreur explicite, pas de succès local.
- `GET unpaid` et page Web partagent le filtre « pas les À payer non échus » : une obligation ouverte non échue n'apparaît pas comme impayé (contrat IMP existant).

### Scénario préprod reproductible (ne pas purger)

Identifiants **uniquement test**, à créer si besoin puis à supprimer par ces codes :

| Objet | Référence |
|---|---|
| École | conserver l'établissement de test existant ; ne pas créer de prod |
| Classe | `F8-CLS-SMOKE` |
| Élèves | `F8-SMOKE-A`, `F8-SMOKE-B` |
| Grille | période `F8-SMOKE-2026-08-28`, 2 types Inscription + Scolarité |
| Paiements | comment `F8-SMOKE` ; Idempotency-Key préfixe `f8-smoke-` |
| Relance | message commençant par `[F8-SMOKE]` |

Parcours : apply → partiel A → total B → non imputé A → cancel partiel A → liste unpaid (A présent, B absent) → relance A.

Nettoyage : DELETE/annuler uniquement les rows dont `student_code` / comment / message portent `F8-SMOKE` / `F8-CLS-SMOKE`.

---

## 17. Verdict final

**GO CONDITIONNEL**

P0-004 (fail-open `schoolCode` vide) a été corrigé après le NO-GO CTO sur `0359e81f`. F8-P1-006 / CTO F8-P1-005 (préfixe `schoolCode` vs `countries.iso_code` pour Admin Pays) a été corrigé après le HOLD CTO sur `8f605620`. Aucun P0/P1 ouvert dans le code de cette révision. Ready / merge / F9 restent interdits jusqu'au nouveau diff GitHub CTO `develop → HEAD`.

Conditions restantes (hors code P0/P1) avant un gel Finance / Release Candidate globale :

1. Diff GitHub CTO `develop → HEAD` de cette PR Draft.
2. Smoke préprod du scénario §16 sur un établissement de test, sans purge.
3. Recette UX Web (desktop / tablette / mobile) + Mobile (clavier, modal, reçu, refresh) par un humain.
4. Observation temps de réponse `GET /payments`, `student-fees`, `unpaid`, `fee-grids` sur un volume réel.

`GO PRODUCTION` est refusé tant que (2) et (3) ne sont pas signés.  
Aucun F9. Aucun Ready. Aucun merge depuis cet agent.
