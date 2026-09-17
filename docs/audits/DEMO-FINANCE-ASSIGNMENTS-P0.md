# Audit P0 Démo — Finance vide + affectations enseignants absentes

**Statut :** HOLD / audit uniquement. **Aucun GREEN.**  
**Date :** 2026-09-17  
**Base :** `develop@a86ffff5827f370d9b82f7b42731dec3cd9cd37c` (post-merge #678)  
**Branche :** `cursor/audit-demo-finance-assignments-p0-94b7`  
**Environnement de référence :** `demo.somafrik.app`  
**Interdictions respectées :** pas de `demo:reset`, pas de mutation PostgreSQL / Render / env, pas de fallback tenant permissif, pas de rustine UI, pas de Ready, pas de merge.

#678 a éliminé l’hypothèse d’un affichage prématuré : après hydratation, `/finances/paiements` reste à 0 et `1ère A` reste sans enseignant. La cause n’est plus le bootstrap de route. Elle est dans le **scoping d’identité établissement**.

---

## 0. Constat recette vs reset canonique

Le reset Démo a vérifié en base :

```text
1 établissement
10 classes
200 élèves
20 enseignants
50 teacher_assignments
200 paiements
400 student_fee_obligations
250 payment_allocations
200 report_cards
50 course_schedule_weekly_slots
```

La recette Web montre encore :

| Surface | Observé | Attendu |
| ------- | ------- | ------- |
| `/finances/paiements` | Obligations élèves : 0 ; Paiements récents : 0 ; « Aucun encaissement » | 400 obligations / 200 paiements du tenant |
| `/presences` classe `1ère A` | 20 élèves OK ; « Aucun enseignant n'est affecté à cette classe. » | au moins 1 `teacher_assignment` active |
| Footer | `Établissement · SCH-BULK-CD-0001` | identité publique `CD-IN-26-001` |

`backend/scripts/verify-demo-runtime-data.js` (#678) sonde `GET /api/payments` et `GET /api/finance/student-fees` (count > 0) **mais ne sonde pas** `GET /api/assignments`. Un 200 `[]` d’affectations passe donc inaperçu.

Aucune donnée PROD/PREPROD n’a été lue ni modifiée dans cet audit (code + tests unitaires uniquement).

---

## 1. Cause racine Finance

**Les lignes canoniques existent en PostgreSQL (`payments.school_id` / `student_fee_obligations.school_id` = UUID établissement). Elles sont re-projetées en `login_code` (`CD-IN-26-001`) puis filtrées par `schools.school_code` (`SCH-BULK-CD-0001`). Les trois identifiants ne sont pas équivalents ; le Web et une partie de l’API HTTP les comparent comme s’ils l’étaient.**

Chaîne :

```text
PostgreSQL
  payments.school_id / student_fee_obligations.school_id = UUID
  JOIN schools → school_code = SCH-BULK-CD-0001
               → login_code  = CD-IN-26-001
        ↓
financeManagement.mappedSchoolCode
  login_code || loginCode || profile.loginCode || schoolCode
  → schoolCode HTTP = CD-IN-26-001
  mapPaymentRow : PAS de schoolId
  mapObligationRow : schoolId = school_id UUID + schoolCode = login_code
        ↓
GET /api/payments
  listFinanceProjection() (SQL sans prédicat tenant)
  → tenantScopeService.filterRows(principal)
GET /api/finance/student-fees
  listFinanceStudentFees : sqlSchoolPredicate sur s.login_code
  → filterRows à nouveau
        ↓
JWT principal.schoolCode = mapUser.schoolCode = schools.school_code
  = SCH-BULK-CD-0001
financeHttpPrincipal.attachFinanceMembershipScope
  users.id → users.school_id → schools.login_code
  → financeLoginCode = CD-IN-26-001  (si principal.sub est l’UUID user)
        ↓
Web DataContext
  activeSchoolCode / footer = user.schoolCode = SCH-BULK-CD-0001
  presentActiveSchoolState(state, schoolCode) filtre
    row.schoolCode === SCH-BULK-CD-0001
  → obligations/paiements tagués CD-IN-26-001 = 0
        ↓
PaymentsPage
  buildFinancePaymentsOverview → scopedStudentFees + scopedPayments
  EmptyState « Aucun encaissement »
```

Points de rupture démontrés (tests RED) :

1. `mappedSchoolCode` préfère `login_code`. `mapPaymentRow` n’émet **pas** `schoolId`. L’autorité UUID est perdue pour les paiements HTTP.
2. `TenantScopeService.filterRows` / `principalSchoolCodes` unionne `schoolCode` (SCH-BULK) et `financeLoginCode` (CD-IN-26-001) comme alias. Sans `financeLoginCode`, un JWT `SCH-BULK-CD-0001` **jette** les lignes `CD-IN-26-001` (0 paiement / 0 obligation côté HTTP).
3. `isLegacySchoolCode` ne reconnaît que `CC-YYYY-NNNN`. `SCH-BULK-CD-0001` est traité comme un **vrai** code tenant, pas un leftover.
4. `presentActiveSchoolState` (état consommé par `PaymentsPage` via `useData()`) filtre exclusivement `row.schoolCode === activeSchoolCode`. Le chrome affiche `SCH-BULK-CD-0001`. Les lignes Finance portent `CD-IN-26-001`. Résultat : 0.
5. `scopedPayments` ne lit **jamais** `schoolId`. Il compare `row.schoolCode` à `schoolPublicCode` et/ou au `schoolCode` de session non leftover. C’est un alias de codes, pas l’autorité UUID.
6. `scopedStudentFees` / `financeRowMatchesTenant` utilisent `schoolId` en premier — **si les lignes survivent à la présentation**. Après `presentActiveSchoolState(SCH-BULK-…)`, le tableau est déjà vide.

SQL n’est pas vide. Le reset l’a prouvé. La perte est **projection `login_code` vs filtre `school_code`**.

---

## 2. Cause racine Affectations / Présences

**Les 50 `teacher_assignments` PostgreSQL sont réelles (`class_id` UUID, `status = 'active'`). `/presences` décide « aucun enseignant » sur `state.assignments` via `resolvePedagogicalAttendanceTeacher`, qui ignore `className` et refuse tout statut vide. Deux transformations indépendantes ramènent 50 à 0 pour `1ère A`.**

Preuve successive exigée :

| Étape | Fait code | Identifiant |
| ----- | --------- | ----------- |
| Classe `1ère A` | `mapClassRow` : `id` / `classId` = `classes.id` UUID ; `schoolCode` = `school_code` | UUID classe + SCH-BULK |
| Enseignant | `teachers.school_id` = UUID établissement | UUID école |
| `teacher_assignment` | INSERT seed : `class_id`, `teacher_id`, `status = 'active'` | UUID + active |
| Cours | `subject_id` + `academic_year_id` | UUID |
| Créneau | 50 `course_schedule_weekly_slots` (reset) | hors sélecteur Présences |
| HTTP `/presences` | `GET /api/assignments` (domain `assignments`) + `GET /api/classes` + `classStudentsApi.list(classCode)` | roster ≠ affectations |
| Mapping Web | `api.get("/assignments")` brut, `mapAssignment` côté serveur | `teacherId = teacher_code`, `classId = UUID`, `schoolCode = school_code` |
| Sélecteur | `attendanceAuthor.resolvePedagogicalAttendanceTeacher` | `isActiveAssignment` fail-closed + `assignmentMatchesClass` (classId/classCode **uniquement**) |

Deux pertes distinctes :

**B1 — HTTP peut renvoyer `[]` (200) alors que PostgreSQL a 50 lignes.**

`GET /api/assignments` ne fait **pas** confiance au JWT. Il appelle `resolveLiveAssignmentsSyncSnapshot` : `userId + schoolId → roleKeys live`. Si `roleKeys` est vide, `livePrincipal.role = ""` et `resolveAssignmentsSyncScope` → `scopeKind: "none"` → `rows = []` **sans 403**. Un `Admin School` JWT serait `school-wide` ; le snapshot live vide l’emporte. `verify-demo-runtime-data` ne sonde pas cet endpoint.

**B2 — Même quand une ligne existe, le sélecteur Présences ne reconnaît pas la forme seed Démo.**

`backend/lib/demoPublicPlatformSeed.js` / `bulkPlatformSeed.js` `buildAssignments` émet :

```text
{ id, schoolCode, teacherId, teacherName, className, subject, course }
```

Pas de `classId`, pas de `classCode`, pas de `status`.  
`isActiveAssignment("")` → `false`.  
`assignmentMatchesClass` : si pas de `classId`/`classCode` → `false` (**`className` n’est jamais lu**).

Le roster de 20 élèves passe par `GET /api/classes/:code/students` (autorité `classCode`), indépendant de `state.assignments`. D’où le paradoxe recette : élèves visibles, enseignant « non affecté ».

Le message UI dit la vérité du sélecteur. Il ne doit pas être masqué.

---

## 3. Matrice d’identité établissement Démo

| Concept | Valeur Démo | Source | Usage autorisé |
| ------- | ----------- | ------ | -------------- |
| `schoolId` | UUID `schools.id` | PostgreSQL / session enrichie `demoGateway.enrichDemoAuthWithCanonicalSchool` | **autorité tenant** |
| `schoolCode` (interne) | `SCH-BULK-CD-0001` | `schools.school_code` ; `mapUser.schoolCode` ; `mapEstablishmentRow.code` ; `mapAssignment.schoolCode` ; `mapClassRow.schoolCode` | projection interne, **jamais** équivalent à `login_code` |
| `loginCode` | `CD-IN-26-001` | `schools.login_code` ; entrée publique Démo (`DEMO_SCHOOL_CODE` défaut) | authentification / login V2 |
| `publicId` | `CD-IN-26-001` | `mapEstablishmentRow.publicId` = login_code V2 | affichage public / API si prévu |
| `schoolPublicCode` (session) | `CD-IN-26-001` | gateway Démo (`loginCode` \| `publicId`) | diagnostic session, **pas** autorité |
| leftover historique | `CC-YYYY-NNNN` (ex. `CD-2026-0001`) | ancien `school_code` | **jamais** une autorité ; `SCH-BULK-*` n’est **pas** ce motif |

Footer Web (`useVisibleNavItems` → `session.user.schoolCode`) : `SCH-BULK-CD-0001`.  
Entrée publique : `CD-IN-26-001`.  
Finance HTTP : `schoolCode = login_code`.  
Classes / affectations HTTP : `schoolCode = school_code`.

Aucune occurrence littérale `schoolId || schoolCode || publicId` dans les zones auditées. L’équivalence **implicite** est le bug : comparer ces chaînes entre elles, ou unionner `schoolCode` + `financeLoginCode` dans un même `Set`.

---

## 4. Parcours SQL → HTTP → Web

### A. Finance — `/finances/paiements`

| Niveau | Endpoint / fonction | Status attendu | Lignes |
| ------ | ------------------- | -------------- | ------ |
| PostgreSQL | `payments` / `student_fee_obligations` filtrés `school_id` | n/a | 200 / 400 (reset) |
| SQL list | `financePgStore.listProjection` (paiements, **sans** prédicat tenant) ; `listFinanceStudentFees` prédicat `s.login_code` | n/a | 200 / 400 si `financeLoginCode` = `CD-IN-26-001` ; **0** si scope `none` |
| Mapping | `mapPaymentRow` / `mapObligationRow` | n/a | `schoolCode=CD-IN-26-001` ; paiement **sans** `schoolId` |
| HTTP | `GET /api/payments` | 200 | N si `filterRows` voit `financeLoginCode` ; **0** si JWT `SCH-BULK` seul |
| HTTP | `GET /api/finance/student-fees` | 200 | idem |
| `school_id` PG | UUID | — | conservé seulement sur obligations |
| `schoolCode` projeté | `CD-IN-26-001` | — | **≠** footer |
| `publicId` / `loginCode` | `CD-IN-26-001` | — | session gateway |
| Mapping Web | `financeApi.listPayments` / `listStudentFees` | — | tableau brut |
| Présentation | `presentActiveSchoolState(SCH-BULK-CD-0001)` | — | **0** Finance |
| Scoping page | `scopedStudentFees` / `scopedPayments` | — | 0 après présentation |
| `PaymentsPage` | `buildFinancePaymentsOverview` + `EmptyState` | — | « 0 / 0 / Aucun encaissement » |

Domaines route `/finances` : `schools, feeGrids, schoolFeeItems, studentFees, payments, paymentStatuses, students` (`routeDomainMap.ts`). #678 les rend bloquants : les zéros arrivent **après** hydratation.

### B. Affectations — `/presences`

| Niveau | Fait |
| ------ | ---- |
| PostgreSQL | 50 `teacher_assignments` `status=active` + `class_id` UUID |
| SQL | `listBySchoolCode` : `ta.school_id` + `ta.status = 'active'` → `mapAssignment` |
| HTTP | `GET /api/assignments` : snapshot live ; `scopeKind === "none"` → `[]` **200** |
| Mapping | `classId` UUID, `teacherId` = `teacher_code`, `schoolCode` = `school_code`, `status` |
| Web | `state.assignments` brut (`PresencesPage` ne passe pas par `scopedAssignments`) |
| Roster | `classStudentsApi.list(classCode)` → 20 élèves `1ère A` |
| Sélecteur | `resolvePedagogicalAttendanceTeacher` → copy `ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none` |

### C. Identité tenant

Login interne Démo : `DEMO_SCHOOL_CODE` défaut `CD-IN-26-001` (`demoGateway.js`).  
JWT émis : `user.schoolCode = schools.school_code = SCH-BULK-CD-0001`.  
Gateway : injecte `schoolId` + `schoolPublicCode` sans réécrire `schoolCode`.

---

## 5. Fichiers et fonctions responsables

### Finance

| Fichier | Fonction | Rôle |
| ------- | -------- | ---- |
| `backend/lib/financeManagement.js` | `mappedSchoolCode`, `mapPaymentRow`, `mapObligationRow` | projette `login_code` ; omet `schoolId` sur paiements |
| `backend/db/financePgStore.js` | `listFinanceStudentFees`, `listProjection`, `sqlSchoolPredicate` | SQL `login_code` ; projection globale paiements |
| `backend/lib/financeSchoolScope.js` | `attachFinanceMembershipScope`, `resolveFinanceSchoolScope` | `financeLoginCode` via UUID user ; fail-closed si `sub` absent |
| `backend/services/tenantScopeService.js` | `filterRows`, `principalSchoolCodes`, `rowSchoolCodes` | union codes ≠ UUID |
| `backend/server.js` | `GET /api/payments`, `GET /api/finance/student-fees`, `financeHttpPrincipal` | HTTP |
| `backend/db/postgresRepository.js` | `mapUser` | JWT `schoolCode = school_code` |
| `web/src/lib/backofficeStateMerge.ts` | `presentActiveSchoolState` | filtre `row.schoolCode === actif` |
| `web/src/lib/establishment.ts` | `scopedPayments` | codes, pas `schoolId` |
| `web/src/lib/fees.ts` | `financeRowMatchesTenant`, `scopedStudentFees` | `schoolId` puis alias codes |
| `web/src/lib/paymentAmountBreakdown.ts` | `buildFinancePaymentsOverview` | compteurs page |
| `web/src/pages/EntityPage.tsx` | overview + `EmptyState` « Aucun encaissement » | UI |
| `web/src/context/DataContext.tsx` | `presentedState` | applique la présentation |
| `web/src/components/layout/AppNavContent.tsx` | footer | affiche `user.schoolCode` |
| `web/src/lib/domainLoaders.ts` | loaders `payments` / `studentFees` | GET |

### Affectations / présences

| Fichier | Fonction | Rôle |
| ------- | -------- | ---- |
| `backend/db/teacherAssignmentsRepository.js` | `mapAssignment`, `listBySchoolCode` | `classId` UUID, `status`, `school_code` |
| `backend/lib/mobileSyncScope.js` | `resolveLiveAssignmentsSyncSnapshot`, `resolveAssignmentsSyncScope` | live roles ; `none` → `[]` |
| `backend/server.js` | `GET /api/assignments` | HTTP |
| `backend/lib/demoPublicPlatformSeed.js` / `bulkPlatformSeed.js` | `buildAssignments` | seed sans `classId`/`status` |
| `web/src/lib/attendanceAuthor.ts` | `isActiveAssignment`, `assignmentMatchesClass`, `resolvePedagogicalAttendanceTeacher` | fail-closed + ignore `className` |
| `web/src/pages/PresencesPage.tsx` | `attendanceTeacher` | copy « Aucun enseignant » |
| `web/src/lib/presenceRoster.ts` | cartes classe par `classId`/`classCode` | roster ≠ teacher |
| `web/src/lib/routeDomainMap.ts` | `/presences` → `assignments` | hydratation |

### Identité

| Fichier | Fonction | Rôle |
| ------- | -------- | ---- |
| `backend/lib/schoolsManagement.js` | `mapEstablishmentRow` | `code = school_code`, `loginCode/publicId = login_code` |
| `backend/lib/sessionSchoolIdentity.js` | `attachCanonicalSchoolIdentity` | `schoolId` + `schoolPublicCode` V2 |
| `backend/demoGateway.js` | `enrichDemoAuthWithCanonicalSchool` | injecte UUID + login V2 |
| `web/src/lib/schoolCanonicalIdentity.ts` | `isLegacySchoolCode`, `resolveSessionSchoolIdentity` | leftover ≠ `SCH-BULK-*` |
| `web/src/lib/activeSchool.ts` | `pickInitialSchoolCode` | `user.schoolCode` |
| `web/src/context/ActiveSchoolContext.tsx` | `activeSchoolCode` | SCH-BULK pour ensureDomains |
| `web/src/lib/fees.ts` | `sessionSchoolCodeAliases` | `schoolCode` ∪ `schoolPublicCode` |

Comparaisons codes dans le périmètre demandé :

- `web/src/context/DataContext.tsx` — `sessionPrincipalKey` concatène `schoolId`, `schoolCode`, `schoolPublicCode` (diagnostic, pas un `\|\|` permissif).
- `web/src/context/ActiveSchoolContext.tsx` — `code` d’échange = `exchangedSchool.code` (interne) puis `publicId` = login.
- `web/src/lib/backofficeStateMerge.ts` — égalité `schoolCode`.
- `web/src/lib/establishment.ts` / `fees.ts` — égalité / alias de codes.
- `web/src/pages/finances/*` — pages consommatrices ; pas de comparaison UUID vs code supplémentaire.
- `web/src/pages/PresencesPage.tsx` — pas de tenant code ; sélecteur pédagogique uniquement.
- `backend/services/tenantScopeService.js` — `principalSchoolCodes` mélange JWT et `financeLoginCode`.

---

## 6. Tests RED reproductibles

| ID | Fichier | Contrat | Cause réelle du rouge |
| -- | ------- | ------- | --------------------- |
| DEMO-FIN-RED-01 | `web/src/lib/demoFinanceAssignments.p0.red.test.ts` + `backend/lib/demoFinanceAssignments.p0.red.test.js` | Session `CD-IN-26-001` voit les obligations de son `schoolId` | Présentation / `filterRows` par `SCH-BULK-CD-0001` vs `schoolCode=login_code` |
| DEMO-FIN-RED-02 | idem | Session voit les paiements de son `schoolId` | `mapPaymentRow` sans `schoolId` + même filtre codes |
| DEMO-PRES-RED-01 | idem | `1ère A` + `teacher_assignment` canonique ≠ « sans enseignant » | Seed sans `classId`/`status` ; snapshot live `scopeKind=none` |
| DEMO-TENANT-RED-01 | idem | `schoolId`, `schoolCode`, `loginCode` non équivalents | `presentActiveSchoolState` et `principalSchoolCodes` traitent les codes comme clés tenant |

Commandes :

```bash
npm --prefix web run test -- src/lib/demoFinanceAssignments.p0.red.test.ts
node --test backend/lib/demoFinanceAssignments.p0.red.test.js
```

Attendu : **échec** (RED métier). Constat 2026-09-17 sur `develop@a86ffff` :

```text
web    : 4 failed (DEMO-FIN-RED-01/02, DEMO-PRES-RED-01, DEMO-TENANT-RED-01)
backend: 4 failed (mêmes IDs)
```

Pas un assert artificiel : le triplet Démo réel traverse les fonctions de production.

---

## 7. Proposition de correction minimale (GO CTO requis — ne pas implémenter ici)

Sans fallback `schoolId \|\| schoolCode \|\| publicId` :

1. **Finance HTTP** — `mapPaymentRow` (et aligner grilles/items si besoin) doit émettre `schoolId = payments.school_id`. `filterRows` Finance doit matcher **`schoolId` UUID** pour un rôle établissement, pas une union de codes.
2. **Finance Web** — `presentActiveSchoolState` et `scopedPayments` doivent scoper les domaines Finance par `schoolId` (fail-closed si UUID absent). `schoolCode` / `login_code` restent des projections d’affichage.
3. **Chrome** — footer : `schoolPublicCode` / `loginCode` (`CD-IN-26-001`), pas `schools.school_code`.
4. **Affectations HTTP** — `GET /api/assignments` : un `Admin School` (allowlist `SCHOOL_WIDE_STUDENT_READ_ROLES`) ne doit pas tomber en `scopeKind: "none"` quand le JWT est school-wide et que PostgreSQL a des lignes `school_id` ; sonder l’endpoint dans `verify-demo-runtime-data`.
5. **Sélecteur Présences** — ne pas assouplir le fail-closed statut. Garantir que la projection HTTP `mapAssignment` (UUID `classId` + `status=active`) **atteint** `state.assignments`. Pas de rustine `className`.
6. **Identité** — documenter et tester que `SCH-BULK-*` n’est **pas** leftover `CC-YYYY-NNNN` et n’est **pas** `login_code`.

---

## 8. Risques de régression PROD / PREPROD

| Changement futur | Risque |
| ---------------- | ------ |
| Matcher Finance uniquement sur `login_code` | établissements dont `login_code` ≠ JWT `school_code` (jeu bulk `SCH-*`, leftover `CC-YYYY-NNNN`) voient 0 |
| Matcher uniquement sur `school_code` | inverse : cas V2 déjà migrés (login_code dans `schoolCode` HTTP) cassés |
| Alias permissif codes | fuite cross-tenant si un UUID étranger porte un code ressemblant |
| Assouplir `isActiveAssignment` / matcher `className` | homonymes de classes, affectations inactives réaffichées |
| Élargir `scopeKind none` → school-wide | fuite d’affectations hors allowlist (`CUSTOM_ROLE`) |
| Changer le footer sans changer les filtres | cosmétique ; les zéros restent |

PROD/PREPROD multi-tenant réel utilise souvent leftover `CD-2026-0001` **ou** login V2 selon l’établissement. Tout GREEN devra être prouvé sur **les deux** projections, autorité UUID uniquement.

---

## 9. Preuve qu’aucune donnée PROD / PREPROD n’a été modifiée

- Aucune connexion `DATABASE_URL` métier hors tests unitaires locaux.
- Aucun `demo:reset`, aucun script `seed-platform-bulk` / `wipe-demo-data`.
- Aucun changement Render / variables d’environnement.
- Diff de cette PR : documentation + tests RED uniquement (`docs/audits/DEMO-FINANCE-ASSIGNMENTS-P0.md`, `web/src/lib/demoFinanceAssignments.p0.red.test.ts`, `backend/lib/demoFinanceAssignments.p0.red.test.js`).
- STOP après audit + RED. Pas de Ready. Pas de merge. Pas d’implémentation GREEN sans GO CTO.
