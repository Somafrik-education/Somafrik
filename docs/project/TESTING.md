# Stratégie de tests — Somafrik

**Statut :** référence qualité & gates  
**Dernière mise à jour :** 2026-08-14
**Liens :** [RELEASES.md](./RELEASES.md) · [CONTRIBUTING.md](./CONTRIBUTING.md) · [../ci-cd-security.md](../ci-cd-security.md)

---

## 1. Principes

1. **Fail-closed** — prouver les 403 / 401 autant que les 200.
2. **Preuves ciblées** — préférer `verify:*` liés au périmètre plutôt qu’une suite géante non pertinente.
3. **Pas de secrets** dans les fixtures ; comptes E2E via variables d’environnement.
4. **Gate préprod manuelle** après merge pour les domaines critiques (auth, RBAC, sync, classes/enseignants, notes).
5. Une PR n’est pas « terminée » sans les tests du périmètre touché **et** la doc de gouvernance si nécessaire.

---

## 2. Pyramide

```text
        /\
       /E2E\        Playwright / scripts verify-e2e-* (hors CI PR lourde)
      /------\
     / Intégr.\     verify:rbac-* · verify:notes-sync · verify:runtime-bootstrap
    /----------\
   /  Unitaire  \   Vitest (web) · assert Node (backend/lib/*.test.js)
  /--------------\
```

| Niveau | Où | Quand |
|--------|-----|-------|
| Unitaire | `web` Vitest · `backend/lib/*.test.js` | Chaque PR touchant le module |
| Intégration / contrat | `npm run verify:*` | CI Security + local |
| E2E API | `verify:e2e-api` / chaînes `0001`… | Avant gate préprod / release |
| E2E Mobile UI | Playwright (`verify:e2e-mobile`) | Hors chemin critique PR (trop lourd) |
| Gate préprod | Checklist CTO manuelle | Après déploiement `develop` |

---

## 3. Tests unitaires

### Web (Vitest)

```bash
cd web && VITE_API_URL=http://127.0.0.1:5000 npm test
# ou ciblé :
VITE_API_URL=http://127.0.0.1:5000 npx vitest run src/lib/stripClientAuditLog.test.ts
```

Couvre notamment : outbox sync, workflows EntityPage, permissions, strip `auditLog`.

### Backend

Fichiers `*.test.js` exécutés via scripts `verify:*` (pas de runner Jest dédié) :

- `gradesBoPersistence`, `evaluationAttachment`, `evaluationSyncRepository`
- `teacherNotesWriteAccess`
- helpers d’unicité présences, etc.

```bash
npm run verify:notes-sync
node backend/lib/teacherNotesWriteAccess.test.js
```

---

## 4. Tests d’intégration / contrats

| Commande | Objet |
|----------|-------|
| `npm run verify:rbac-s1-4` | Matrice écriture BO + MVP |
| `npm run verify:rbac-admin-01` | Classes/enseignants sans `auditLog` |
| `npm run verify:jwt-header` | JWT header-only |
| `npm run verify:sanitize-user-responses` | Pas de secrets dans les réponses |
| `npm run verify:db-config` | Config DB prod/préprod |
| `npm run verify:runtime-bootstrap` | `init` → health → login 401 |
| `npm run verify:classes-legacy-cleanup` | PUT `classes` interdit ; `/api/classes` + projection lecture |
| `npm run verify:schools-legacy-cleanup` | PUT `schools` interdit (seul, mixte `{schools,users}` / `{schools,subscriptions}`, snapshot) sans mutation partielle ; pays hors référentiel (`FR`) refusé ; `/api/backoffice/establishments` + projection lecture |
| `npm run verify:students-legacy-cleanup` | PUT `students` interdit (toute valeur, seul, mixte, snapshot) sans mutation partielle ; inscription/liste/fiche/PATCH via APIs PG ; projection `state.students` read-only ; writers Web/Mobile/BackOffice retirés |
| `npm run verify:finance-legacy-cleanup` | PUT Finance interdit (clés `payments`, `paymentStatuses`, `feeGrids`, `schoolFeeItems`, `studentFees`, `feeTariffHistory`, `paymentReminders` — vide, null, mixte, snapshot) sans mutation partielle ; projection GET depuis PostgreSQL uniquement ; writers Web/Mobile/BackOffice retirés |
| `npm run verify:finance-management` | Paiement/allocation atomiques, annulation/réversion, application concurrente de grille, cooldown reminders, isolation tenant, RBAC Super Admin / Admin School / Comptable / Secrétaire / Directeur / rôles non autorisés |
| `npm run verify:pedagogy-legacy-cleanup` | PUT Pédagogie interdit (`courses`, `courseSchedules`, `evaluations`, `notes`, `presences` — vide, null, mixte) sans mutation partielle ; `rejectedKeys` déterministes |
| `npm run verify:pedagogy-management` | Routes canoniques `/api/courses`, `/api/course-schedules`, `/api/evaluations`, `/api/notes`, `/api/presences` ; intégration PG (`pedagogyRepository.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:platform-legacy-cleanup` | PUT Plateforme interdit (10 clés — vide, null, mixte) sans mutation partielle ; writers Web/Mobile/BackOffice retirés |
| `npm run verify:platform-management` | APIs `/api/backoffice/countries`, `/subscriptions`, `/notifications`, `/role-permissions`, collections abonnement ; isolation tenant HTTP ; `getRolePermissionsMap()` PostgreSQL ; audit transactionnel (`platformRepository.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:clients-legacy-cleanup` | PUT Clients interdit (5 clés) ; writers Web/Mobile/BackOffice retirés |
| `npm run verify:clients-management` | APIs `/api/backoffice/users`, `/contacts`, `/relations`, `/messages`, `/announcements` ; provisionnement contact/parent ; isolation tenant ; pas de fuite `password_hash` (`clientsRepository.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:education-reference-data` | Référentiels pédagogiques canoniques PG : CRUD Superadmin niveaux/filières, activation établissement, unicité par pays, cross-country, rejet `levels`/`tracks` sur `PUT /api/academic-config` (`LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN` / `LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN`) ; audit transactionnel (`educationReference.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:establishment-roles-data` | Rôles établissement canoniques PG : CRUD Superadmin catalogue, affectation Admin School, rejet `userRoles` sur `PUT /api/academic-config` (`LEGACY_USER_ROLES_WRITE_FORBIDDEN`), escalade 403, rôle archivé non affectable, JWT depuis matrice PG (`establishmentRoles.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:evaluation-types-data` | Types d’évaluation canoniques PG : CRUD établissement, unicité par école, isolation tenant, archivage, rejet `evaluationTypes` sur `PUT /api/academic-config` (`LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN`), boot fail-closed si legacy ambigu, création d’évaluation avec `evaluationTypeId`, refus type étranger/inventé/archivé (`evaluationTypes.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:school-settings-data` | Paramètres établissement canoniques PG (LOT 4) : `school_settings` + projection `terms`/`classes`/`subjects`, `GET/PATCH /api/school-settings`, `PUT /api/academic-periods`, isolation tenant, spoof JWT, rôle enseignant 403, rollback audit, inventaire legacy fail-closed, strip après inventaire sain, `PUT /api/academic-config` clés LOT 4 interdites, projection GET, bootstrap idempotent (`schoolSettings.pg.test.js` si `DATABASE_URL`) |
| `npm run verify:notes-sync` | Sync Notes / outbox / rattachement |
| `npm run verify:mobile-security` | SecureStore / HTTPS / client mobile |
| `npm run verify:v2-foundation` | Structure V2, frontières legacy, invariants domaine et auth V2.1a |
| `npm run test:v2-auth` | Rôles canoniques, `AuthPrincipal` immuable et `can()` fail-closed |
| `npm run typecheck` · `npm run lint` | Qualité statique |
| `npm run audit:ci` | Vulnérabilités **critical** |

CI PR (`security.yml` + `ci.yml`) : Secrets · Security · TypeScript · Lint · Tests · Audit · Lint et build.

---

## 5. Tests E2E

```bash
npm run verify:e2e-preflight   # bootstrap / santé
npm run verify:e2e-api         # suite API
npm run verify:e2e-mobile      # UI mobile Playwright
npm run verify:e2e-all         # agrégat
```

Chaînes numérotées (`verify:e2e-0001` …) pour parcours métier (finance, inscriptions, etc.).

**Note :** les E2E mobiles ne sont pas tous des required checks PR (durée). Les lancer avant une release ou un gate CTO.

Variables utiles : `SOMAFRIK_E2E_SUPERADMIN_ID` / `PASSWORD`, `SOMAFRIK_API_URL`, pins E2E documentés dans `scripts/e2e-api-helpers.js`.

---

## 6. Gates de préproduction

Après déploiement Render + Vercel (`develop`) :

### Gate Auth / runtime

- [ ] `GET /api/health` → 200, `database: postgresql`
- [ ] Login faux → **401** (jamais 500)
- [ ] Login valide → session + state

### Gate Enseignants / affectations (LOT 3)

- [ ] Créer enseignant via `POST /api/teachers` → 201 + relecture PG
- [ ] Créer/modifier/retirer une affectation via `POST/PATCH/DELETE /api/assignments`
- [ ] Conflit classe + matière + année → 409 `ASSIGNMENT_COURSE_CONFLICT`
- [ ] Référence d'un autre établissement → rejet, sans mutation
- [ ] PUT state avec clé `teachers` ou `assignments`, seule/mixte/snapshot → 400 avec code stable
- [ ] `GET state.teachers` / `state.assignments` reflète PostgreSQL sans ligne JSON fantôme

### Gate Élèves (LOT 2)

- [ ] Inscrire depuis une classe → 201 et matricule canonique
- [ ] Liste/fiche/PATCH via `/api/students` → persistance après reload
- [ ] PUT state avec clé `students` seule, mixte ou snapshot → 400 `LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN`
- [ ] `GET state.students` reflète PostgreSQL sans ligne JSON fantôme

### Gate Finance (LOT 4)

- [ ] Créer un paiement via `POST /api/payments` → 201, référence générée serveur, allocations et soldes atomiques
- [ ] Annuler via `POST /api/payments/:id/cancel` avec motif → réversion des soldes, idempotente, jamais hard delete ; `cancelled_by` persisté
- [ ] Paiement / annulation + audit `audit_logs` dans **le même commit** PostgreSQL ; échec d'écriture d'audit → rollback complet
- [ ] Annulation concurrente → une seule réversion et un seul événement `cancel_payment`
- [ ] Appliquer une grille via `POST /api/finance/fee-grids/:id/apply` sans obligation en double sous concurrence
- [ ] Relance unpaid : cooldown serveur, `force` réservé Super Admin / Admin School
- [ ] PUT state avec une clé Finance, seule, mixte ou snapshot → 400 `LEGACY_FINANCE_STATE_WRITE_FORBIDDEN`
- [ ] `GET state` Finance reflète PostgreSQL sans fusion des anciennes lignes JSON
- [ ] E2E 0001 / 0009 / 0011 exécutés contre un backend PostgreSQL

### Gate Plateforme (LOT 6)

- [ ] Créer un pays via `POST /api/backoffice/countries` → 201, pas d'auto-création implicite
- [ ] Upsert abonnement via `POST /api/backoffice/subscriptions` → scope établissement/pays depuis principal uniquement
- [ ] Admin Pays hors pays → 403 `TENANT_MISMATCH`, zéro audit
- [ ] `GET /api/backoffice/subscription-access` protégé par `requirePermission` (403 sans droit, 401 sans token)
- [ ] `GET state.rolePermissions` projeté depuis PostgreSQL (`getRolePermissionsMap`)
- [ ] PUT state avec une clé plateforme, seule, mixte ou snapshot → 400 `LEGACY_PLATFORM_STATE_WRITE_FORBIDDEN`
- [ ] Persistance après redémarrage (`platformRepository.pg.test.js`)

### Gate Notes / sync enseignant

- [ ] Enseignant : evaluations/notes → ACK / outbox vide
- [ ] Hors affectation → 403 métier
- [ ] `auditLog` client → 403

### Gate CI

- [ ] Dernier merge `develop` : tous les checks verts

Détail Go/No Go par version : [RELEASES.md](./RELEASES.md).

---

## 7. Critères Go / No Go (transverses)

| | Go | No Go |
|--|----|-------|
| CI | Tous required verts | Un check rouge |
| RBAC | 403 sur hors-périmètre et `auditLog` | 200 inattendu / 500 |
| Persistance | Visible après hard reload | Uniquement localStorage / optimiste |
| Sync | ACK ou erreur métier explicite | Disparition silencieuse |
| Sécurité | Pas de secret dans logs/réponses | JWT en query, password en JSON |

---

## 8. Responsabilités

| Acteur | Rôle |
|--------|------|
| Auteur PR | Tests locaux du périmètre + doc |
| CI | Filet automatique |
| CTO | Gate préprod / Go release |

---

## 9. Mise à jour de ce document

Ajouter une section ou un script dès qu’un nouveau `verify:*` devient **obligatoire** pour un domaine, ou qu’un gate préprod change.
