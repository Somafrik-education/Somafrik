# GO-PROD-BASELINE-400 — Audit P0/P1 (reproduction uniquement)

**Mandat :** CTO GO-PROD-BASELINE-400  
**Gouvernance :** AUDIT + REPRODUCTION. Aucun correctif métier. Aucun Ready. Aucun merge.  
**Repo :** Somafrik-education/Somafrik  
**Baseline exigée :** `develop@ece159605147c2ad16ff7f3f32c7f448377baae0` = merge PR **#400**  
**Branche d’audit :** `cursor/audit-go-prod-baseline-400-a873`  
**Date :** 2026-08-31  

Les PR **#401–#416** ne sont **pas** la vérité runtime. Elles sont des signalements historiques.  
La seule question traitée : **le défaut existe-t-il aujourd’hui sur `develop@ece1596051` ?**

---

## 0. Ancrage Git (obligatoire)

```text
git fetch origin
git checkout develop
git pull --ff-only origin develop
HEAD = ece159605147c2ad16ff7f3f32c7f448377baae0
ahead / behind origin/develop = 0 / 0
```

| Champ | Valeur |
|---|---|
| Baseline #400 confirmée | **OUI** |
| Message | `Merge pull request #400 from Somafrik-education/feat/help-settings-02-catalog` |
| Working tree à l’ancrage | clean |
| Branche créée depuis cette SHA | `cursor/audit-go-prod-baseline-400-a873` |

**STOP non déclenché** : le HEAD n’a pas bougé.

Fichiers de cet audit (documentation + harness read-only) uniquement. Aucun fichier métier modifié.

---

## 1. Méthode

1. Inventaire `package.json` (gates `verify:*` présentes, non altérées).
2. Lecture source HEAD des chemins tenant / notes / finance / users / enrollment.
3. Reproduction unitaire des contrats live (`TenantScopeService`, `financeSchoolScope`, `teacherNotesWriteAccess`, RBAC).
4. Reproduction HTTP PostgreSQL isolée (`SOMAFRIK_SKIP_DEMO_SEED=true`) avec **volontairement** `schools.school_code != schools.login_code`.
5. Suites unitaires existantes pertinentes (44/44) + `verify:settings-functional-audit` + `typecheck:backend`.
6. **Aucun** test modifié pour obtenir du vert. **Aucun** cherry-pick #401–#416.

Établissement de preuve HTTP :

```text
school_code leftover = CD-2026-0001
login_code canonique = CD-LAC-26-001
```

Preuves machine : `docs/audits/go-prod-baseline-400-matrix.json`  
Journal : `docs/audits/evidence/go-prod-baseline-400-results.json`  
Harness : `scripts/audit-go-prod-baseline-400.js` (read-only / test harness)

---

## 2. Matrice

| ID | Domaine | Scénario | Résultat baseline #400 | Sévérité | Réf. hist. | Correctif avant prod ? | Proposition |
|---|---|---|---|---|---|---|---|
| GP-001 | Notes | Enseignant crée évaluation | **REPRODUIT** | P1 | #402 | Oui | PR NOTES-P1 minimale |
| GP-002 | Academic year | tenant canonical leftover ≠ login_code | **REPRODUIT** | P0 | #408 #409 | Oui | PR academic-year tenant |
| GP-003 | Users | création tenant membership | **REPRODUIT** | P1 | #410 #411 | Oui | PR users membership UUID |
| GP-004 | Students | inscription → Finance | **REPRODUIT** | P0 | #412 | Oui | PR enrollment tenant (après GP-005) |
| GP-005 | Finance | login_code vs leftover | **REPRODUIT** | P0 | #406 | Oui | PR finance login_code only |
| GP-006 | Notes | hors affectation / homonyme / cross-school | **REPRODUIT** | P1 | #402 | Oui | Même PR que GP-001 |
| GP-007 | Notes | RBAC ≠ write_notes abonnement | **DÉJÀ_OK** | P2 | #402 SETTINGS-01 | Non | Conserver l’ordre actuel |
| GP-008 | Notes | ALL_PRIVILEGES / write implicite enseignant | **REPRODUIT** | P1 | #402 | Oui | Même PR que GP-001 |
| GP-009 | Notes | Préfet validation / publication | **DÉJÀ_OK** | P1 | #402 | Non | Revalider après GP-001 |
| GP-010 | Paramètres | Profil lecture / write / PG | **DÉJÀ_OK** | P2 | #399 #400 | Non | Smoke Web après tenant |
| GP-011 | Paramètres | Structure pédagogique V1 | **DÉJÀ_OK** | P2 | #399 | Non | — |
| GP-012 | Paramètres | Rôles école lecture seule | **DÉJÀ_OK** | P2 | #399 | Non | — |
| GP-013 | Paramètres | Finances V1 (devise / grilles / moyens) | **HOLD** | P1 | #399 #406 | Oui (via GP-005) | Pas de PR Paramètres |
| GP-014 | Planning | V1 créneau PG | **HOLD** | P1 | — | Non (après tenant) | ComingSoon ≠ blocker |
| GP-015 | Présences | enseignant / IDs / homonymes | **HOLD** | P1 | #413 | Oui (rejeu) | #413 était test-only |
| GP-016 | Parent/Élève | liaison complète | **HORS_RELEASE** | P1 | KNOWN-ISSUES §6 | Non | Décision CTO V1 |
| GP-017 | Mobile | smoke V1 + bottom nav device | **UNKNOWN** | P1 | #414–#416 | Non | Preuve device, pas de fix géométrique |
| GP-018 | Web | smoke rôles | **UNKNOWN** | P1 | #399 | Non | Smoke après PRs tenant |
| GP-019 | Seed | demo vs prod sans seed | **HOLD** | P2 | KNOWN-ISSUES §11 | Non | Séparer du runtime |
| GP-020 | Sync E2E | Users→…→Finance | **HOLD** | P0 | #407–#413 | Oui | STOP par domaine après PRs |
| GP-021 | Auth/JWT | mapUser leftover | **REPRODUIT** | P0 | #404 #406 #408 | Oui (par domaine) | Pas de mega-PR #404 |
| GP-022 | Tenant | isolation A/B leftover-vs-leftover | **DÉJÀ_OK** | P0 | #408 | Non isolé | Le P0 est leftover vs login_code du **même** tenant |

Statuts utilisés uniquement parmi : `GO` `REPRODUIT` `NON_REPRODUCTIBLE` `DÉJÀ_OK` `HOLD` `HORS_RELEASE` `UNKNOWN`.  
`GO` n’a pas été posé : aucun parcours P0 n’est certifié canonique `login_code` sur cette baseline.

---

## 3. Preuve HTTP (leftover ≠ login_code)

Environnement : PostgreSQL 16 local, backend HEAD #400, `SOMAFRIK_SKIP_DEMO_SEED=true`, base isolée `somafrik_audit_gp400`.

| Étape | Résultat | Preuve |
|---|---|---|
| Dual identity | OK | `school_code=CD-2026-0001` `login_code=CD-LAC-26-001` |
| Login leftover | 200 | identifiant admin établissement |
| Login `login_code` | 200 | **même compte** |
| JWT `schoolCode` | leftover | `CD-2026-0001` dans les deux logins |
| `POST /v2/academic-years` body=`CD-LAC-26-001` | **403** | `Accès refusé: établissement hors périmètre.` |
| `POST /v2/academic-years` body omis (JWT leftover) | **201** | `schoolCode=CD-2026-0001` |
| `GET /v2/academic-years` | 200 | projection `schoolCode=["CD-2026-0001"]` |
| `POST /backoffice/users` body `schoolCode=login_code` | 201 | projection leftover ; `users.school_id` UUID correct |
| `GET /finance/catalog` JWT leftover | 200 | leftover = identité Finance runtime |
| SQL Finance `WHERE school_code = leftover` | 1 ligne | identité métier leftover |
| SQL Finance `WHERE school_code = login_code` | **0 ligne** | login_code n’est **pas** une clé Finance |
| `GET /finance/fee-grids` | 200 | leftover JWT |
| Isolation tenant B | OK | 0 année de A visible |

Lecture : sur #400, **leftover est l’identité métier qui marche**. `login_code` est l’identité publique V2. Les deux coexistent. Tout client qui envoie le `login_code` (E2E, Superadmin `publicId`, futur UI) prend un **faux 403**. C’est exactement le scénario #408 / #406 / #412.

---

## 4. Synthèse par domaine

### Notes enseignant

**REPRODUIT (P1)** — le parcours V1 enseignant n’est pas borné au contrat canonique `teacher_assignments` PG.

- `POST /api/evaluations` = `Notes:CREATE` **OU** `Notes:UPDATE` (pas CREATE seul, contrairement au contrat #402).
- `teacherHasNotesWritePermission` : rôle `Enseignant` → **true** sans jeton live.
- Fallback JWT `classNames` / `subjects` si aucune fiche enseignant.
- Résolution d’évaluation par **nom de classe** (`findClassByNormalizedName`) — risque homonyme.
- Bootstrap J3 : TEACHER a `assignments` READ, **pas** `grades` CREATE.
- `write_notes` (abonnement) est **distinct** de RBAC et précède `requirePermission` → GP-007 DÉJÀ_OK.
- Préfet : `assertTeacherCannotValidateEvaluation` refuse locked/published à l’enseignant ; PATCH = `Notes:UPDATE` → GP-009 DÉJÀ_OK sur le contrat source.
- Admin School : matrice Notes = **R** seulement (ne crée pas d’évaluation) — attendu.
- KNOWN-ISSUES.md §18 **toujours présent** sur cette baseline.

Ne pas conclure « #402 était mergée donc c’est corrigé » : #402 **n’est pas** dans HEAD #400.

### Academic year tenant

**REPRODUIT (P0)** — HTTP réel.

```text
POST body login_code + JWT leftover → 403 hors périmètre
POST JWT leftover, body omis          → 201 leftover
GET                                   → schoolCode leftover
```

Cause exacte HEAD :

```3391:3394:backend/server.js
app.post("/api/v2/academic-years", ...
  const schoolCode = req.body?.schoolCode ?? req.principal.schoolCode;
  tenantScopeService.assertSchoolAccess(req.principal, schoolCode);
```

`assertSchoolAccess` compare des **chaînes**. Leftover ≠ `login_code` → 403.  
GET `getAcademicYearsV2()` projette `s.school_code` leftover, pas `login_code`.  
UI Admin School omet souvent `schoolCode` (`scopedSettingsSchoolCode()` → `undefined`) donc le chemin UI leftover **marche**. Le chemin canonique / E2E / `ensureSchoolYear(schoolCode)` **casse**.

Aucun module `academicYearTenant.js` sur HEAD.

### Users tenant

**REPRODUIT (P1)** — double lecture.

- Admin établissement : `resolveCreateUserSchoolCode` = `principal.schoolCode` leftover. Le `schoolCode` client est **ignoré** (fail-closed vis-à-vis du client, mais autorité leftover).
- HTTP : POST users avec body `login_code` → **201**, `users.school_id` = UUID A (correct), projection `schoolCode` leftover.
- Donc le chemin leftover **écrit dans le bon établissement**.
- Ce qui est faux vis-à-vis du contrat canonique : l’autorité n’est pas le membership `login_code` / UUID exposé ; aliases `admin` / `admin-bi` / `admin-cd` restent dans `mapUser`.
- Fail-closed sans école : `requireConcreteSchoolCode` présent.
- #410/#411 corrigeaient surtout store mémoire + presets tests. Runtime PG Admin School n’est pas un 404 systématique sur leftover.

### Student enrollment → Finance

**REPRODUIT (P0)** — source + cohérence Finance leftover.

`POST /api/classes/:classCode/students` prend `req.principal.schoolCode` leftover puis :

```6446:6454:backend/db/postgresRepository.js
financeSync = await this.syncEnrollmentFinanceObligations(
  { ..., schoolCode, ... },
  { role: "system", schoolCode, sub: "finance-obligation-lifecycle" },
);
```

Sur #400, Finance **accepte** leftover (`WHERE school_code = leftover` → hit) donc l’inscription leftover **ne 404 pas**.  
Le P0 de #412 (`TENANT_MISMATCH` Finance) apparaît **dès que Finance n’accepte plus que `login_code`** (correctif #406). Ordre obligatoire : **GP-005 puis GP-004**.  
Cross-tenant classe B : `getClassForEnrollment` filtre `school_id` — refus attendu (HOLD rejeu HTTP classe, non empilé).

### Finance tenant

**REPRODUIT (P0)** — HTTP + SQL.

Contrat exigé par le mandat :

| Identité | Attendu | Observé #400 |
|---|---|---|
| `login_code` canonique | accepté | **refusé** (`WHERE school_code = login_code` → 0) |
| leftover `school_code` | pas une 2e identité métier | **est** l’identité qui marche (catalog 200, fee-grids 200) |
| `schoolCode` forgé body/query | ignoré/refusé | JWT leftover fait autorité |
| tenant A → données B | invisibles | **DÉJÀ_OK** leftover-vs-leftover (GP-022) |

`sqlSchoolPredicate` = `alias.school_code = ANY(...)`. Aucun `login_code`.

### Planning

**HOLD (P1)** — persistence weekly slots PG présente (`POST /api/course-schedules`, `planningWeekly`). ComingSoon : vue par salle (`PlanningPlaceholders`). Tenant leftover via `pedagogyPgStore.getSchoolByCode` leftover-only. Pas de blocker ComingSoon. Rejouer create/drag/refresh **après** GP-002/GP-005. Pas de preuve navigateur dans cet audit.

### Présences / Appel

**HOLD (P1)** — contrat `verify:presences-roster` présent (IDs, `teacher_assignments.class_id`, homonymes). #413 était **test-only** (affectation fixture ENS-SYNC-01). Runtime `findTeacherForAttendance` déjà fail-closed d’après le signalement. RC3 SQLCipher / offline exactly-once = **HORS_RELEASE**. Rejouer HTTP enseignant après GP-001.

### Paramètres

SETTINGS-01 / #399–#400 restent la vérité documentaire V1.

| Carte | Verdict audit #400 |
|---|---|
| Profil | DÉJÀ_OK |
| Année scolaire | UI leftover marche ; canonique login_code **403** (GP-002) |
| Structure | DÉJÀ_OK (activation école ≠ catalogues Superadmin) |
| Rôles école | DÉJÀ_OK lecture seule |
| Finances V1 | HOLD jusqu’à GP-005 |
| Pénalités / restore / apparence / notifications / intégrations | HORS_RELEASE (ComingSoon ou non livré) |

`verify:settings-functional-audit` : **OK** (gate documentaire, SHA SETTINGS-01 inchangé).

### Parent / Élève

**HORS_RELEASE (P1)** — `parentLinking.js` + `verify:parent-linking` existent. Le guide (KNOWN-ISSUES §6 / §19) interdit de certifier le parcours. Aucune relation parent-enfant simulée par fixture. Décision CTO : exiger V1 ou reporter.

### Mobile

**UNKNOWN** — pas d’Android/iOS réel ici. Interdiction : aucun correctif géométrique. Bottom nav #414–#416 **hors baseline** (post-#400, rollback documenté). Preuve device obligatoire avant toute PR visuelle. Gates `verify:mobile-*` présentes, non rejouées comme vérité device.

### Web

**UNKNOWN** (smoke navigateur). API login Admin School leftover **200**. CTA affichées mais 403 backend : le cas `POST academic-years` avec `login_code` est le spécimen. Smoke rôles (SUPER_ADMIN, SCHOOL_ADMIN, PREFET, TEACHER, ACCOUNTANT, PARENT/STUDENT) à faire après PRs tenant.

### Sync E2E

**HOLD (P0)** — script HEAD `verify:sync-end-to-end` login `CD-2026-0001` leftover. Sur #400 leftover-cohérent, Users HTTP **201** (prouvé). `ensureSchoolYear` envoie le leftover → année **201** (prouvé).  
Risques STOP ensuite, **sans modifier le script** :

1. `POST /evaluations` avec **adminToken** (Admin School Notes:R) → 403 RBAC probable (domaine Notes, pas tenant).
2. Finance / inscription dès que login_code devient obligatoire.

Ne pas rematcher le script pour le faire passer. Rejouer après GP-001 / GP-002 / GP-005 / GP-004. STOP à la première panne domaine.

### Seed

**HOLD (P2)** — HTTP d’audit sans demo seed. Aliases `admin` / `admin-bi` dans `mapUser`. KNOWN-ISSUES §11 (boot local seed) classé **séparément** des P0 runtime. Pas de nettoyage seed dans ce mandat.

---

## 5. Tests exécutés (HEAD #400, non modifiés)

| Commande | Résultat |
|---|---|
| `node scripts/audit-go-prod-baseline-400.js` (unit + HTTP PG) | GO harness — 16/16 étapes HTTP OK (dont 403 canonique attendu) |
| `node --test` notes / finance scope / academic-years RBAC / schoolCodeV2 / teacherNotes / clientsUserSchoolPublicCode / requestSchoolScope | **44/44 pass** |
| `npm run verify:settings-functional-audit` | OK |
| `npm run typecheck:backend` | OK |
| `verify:sync-end-to-end` | **non empilé** (STOP par domaine, GP-020 HOLD) |
| typecheck web/mobile, lint, verify:functional-rbac PG complet | non bloquants pour cet audit ; web/Mobile `node_modules` non installés |

Aucun test n’a été changé pour obtenir du vert.

---

## 6. Ce qui a disparu / ce qui n’a jamais été sur #400

| Signalement | Sur #400 ? |
|---|---|
| #402 Notes enseignant runtime | **Absent** — défaut **présent** |
| #406 Finance login_code | **Absent** — leftover = identité Finance |
| #408/#409 Academic year login_code | **Absent** — 403 HTTP reproduit |
| #410/#411 Users membership | **Partiel** — UUID école correct via leftover ; autorité non canonique |
| #412 Enrollment → Finance login_code | **Absent** ; masqué tant que Finance accepte leftover |
| #413 Attendance fixture | Test-only, hors runtime |
| #404 Auth canonical-only | Gelée historiquement — **ne pas** mega-PR |
| #414–#416 Bottom nav | Post-baseline, hors audit runtime #400 |
| SETTINGS-01 / HELP-SETTINGS-02 | **Dans** la baseline (c’est #399/#400) |

Les anciens bugs « disparus » : **aucun** des P0 tenant/notes post-#400 n’a disparu, puisqu’ils n’étaient pas mergés dans cette SHA.  
Ce qui **marche déjà** sur leftover : isolation A/B, profil paramètres, write_notes distinct, validation enseignant interdite, création user Admin School dans le bon UUID.

---

## 7. PR correctives proposées avant production

Ordre CTO : une PR minimale → diff GitHub indépendant → merge → revalidation → suivante.  
**Pas de mega-PR #401–#416. Pas de cherry-pick automatique.**

### PR-1 — P0 Finance tenant `login_code`

- **Titre proposé :** `P0 — Finance tenant : login_code only, leftover n’est plus une identité`
- **P0/P1 :** P0 (GP-005)
- **Périmètre strict :** `sqlSchoolPredicate` + `financePgStore.getSchoolByCode` + projections tenant Finance. Aucun Auth/JWT/RBAC. Aucun `ALL_PRIVILEGES`.
- **Fichiers probables :** `backend/lib/financeSchoolScope.js`, `backend/db/financePgStore.js`, tests `financeSchoolScope.test.js`, `financeRepository.pg.test.js`, `financeReadiness.http.pg.test.js`
- **Tests exigés :** leftover refusé ; `login_code` accepté ; tenant A invisible de B ; `verify:finance-readiness` / `verify:finance-rbac`
- **Dépendances :** aucune. **Débloque** GP-004 (qui cassera tant que non enchaîné).

### PR-2 — P0 Academic year tenant

- **Titre proposé :** `P0 — Années scolaires : POST/GET via membership UUID + login_code`
- **P0/P1 :** P0 (GP-002, GP-021 partiel)
- **Périmètre strict :** `POST/GET/PATCH /api/v2/academic-years` + `ensureSchoolYear` test helper. Pas de rewrite `mapUser`.
- **Fichiers probables :** `backend/server.js`, `backend/db/postgresRepository.js` (`getAcademicYearsV2`), nouveau `backend/lib/academicYearTenant.js`, `backend/lib/canonicalClassHttp.js`
- **Tests exigés :** leftover body 403 ; JWT leftover + body `login_code` **201** ; GET projection `login_code` ; isolation A/B ; pas de 409 double identité
- **Dépendances :** aucune (indépendante de PR-1)

### PR-3 — P0 Inscription élève → Finance `login_code`

- **Titre proposé :** `P0 — Enrollment tenant : membership → login_code Finance`
- **P0/P1 :** P0 (GP-004)
- **Périmètre strict :** `POST /api/classes/:classCode/students` + `syncEnrollmentFinanceObligations`. Pas de JWT global.
- **Fichiers probables :** `backend/server.js`, `backend/db/postgresRepository.js`, `backend/db/classStudentsRepository.js`
- **Tests exigés :** leftover ≠ login_code → HTTP 201 ; `student.school_id` / `enrollment.school_id` corrects ; **aucun** leftover transmis à Finance ; classe étrangère 403/404 ; `verify:class-student-enrollment`
- **Dépendances :** **PR-1 merge** (sinon le 404 Finance n’apparaît pas / ou leftover reste valide)

### PR-4 — P1 Notes enseignant runtime

- **Titre proposé :** `P1 — Notes enseignant : Notes:CREATE + teacher_assignments PG`
- **P0/P1 :** P1 (GP-001, GP-006, GP-008)
- **Périmètre strict :** RBAC POST évaluations CREATE-only ; write enseignant = affectations PG ; retirer fallback JWT et `role===Enseignant → true` ; grant J3 `TEACHER/grades` CREATE si contrat V1. Pas de HELP. Pas d’Auth JWT schoolCode.
- **Fichiers probables :** `backend/services/rbacService.js`, `backend/lib/teacherNotesWriteAccess.js`, `backend/lib/criticalParityRbacCanonical.js`, `backend/db/postgresRepository.js` (attachment), `web/src/lib/evaluations.ts` si CTA
- **Tests exigés :** `notesEvaluationsRbacLive`, `verify:pedagogy-management`, HTTP enseignant 6ème A Maths OK / 6ème B Histoire 403 / cross-school 403 ; write_notes 403 distinct
- **Dépendances :** aucune stricte ; revalider GP-009 après merge

### PR-5 — P1 Users tenant membership (après P0)

- **Titre proposé :** `P1 — POST /users : tenant via membership UUID, pas leftover JWT`
- **P0/P1 :** P1 (GP-003)
- **Périmètre strict :** `createClientsUser` / `resolveCreateUserSchoolCode` dérivé de `users.school_id`. Presets `admin-cd`/`admin-bi` non autorité. Fail-closed sans membership.
- **Fichiers probables :** `backend/lib/clientsService.js`, éventuellement `backend/db/fallbackRepository.js` (tests mémoire seulement)
- **Tests exigés :** `verify:clients-management`, `verify:user-role-lifecycle`, HTTP leftover≠login_code 201 + relecture + GRANT persisté
- **Dépendances :** aucune stricte ; ne pas mélanger avec Auth #404

### Non proposées maintenant

| Sujet | Raison |
|---|---|
| Mega-PR Auth/JWT #404 | Gelée ; JWT leftover peut rester si chaque write ignore leftover comme autorité |
| #413 fixture attendance | Test-only ; pas un défaut runtime Présences |
| Bottom nav mobile | Hors baseline ; preuve device |
| Parent-enfant | HORS_RELEASE sauf CTO |
| Seed doublons | P2 séparé |
| ComingSoon Paramètres / Planning salles | HORS_RELEASE |
| Offline SQLCipher RC3 | HORS_RELEASE |

---

## 8. Compteurs

```text
Scénarios rejoués : 22

GO                 : 0
REPRODUIT          : 8   GP-001 GP-002 GP-003 GP-004 GP-005 GP-006 GP-008 GP-021
DÉJÀ_OK            : 6   GP-007 GP-009 GP-010 GP-011 GP-012 GP-022
NON_REPRODUCTIBLE  : 0
HOLD               : 5   GP-013 GP-014 GP-015 GP-019 GP-020
HORS_RELEASE       : 1   GP-016
UNKNOWN            : 2   GP-017 GP-018

P0 : 6
  REPRODUIT GP-002 GP-004 GP-005 GP-021
  HOLD      GP-020
  DÉJÀ_OK   GP-022 (isolation A/B leftover)

P1 : 11
  REPRODUIT GP-001 GP-003 GP-006 GP-008
  DÉJÀ_OK   GP-009
  HOLD      GP-013 GP-014 GP-015
  UNKNOWN   GP-017 GP-018
  HORS_RELEASE GP-016

P2 : 5
  DÉJÀ_OK GP-007 GP-010 GP-011 GP-012
  HOLD    GP-019
```

---

## 9. Gouvernance de sortie

```text
Draft : OUI
Ready : NON
Merge : NON
```

STOP. Rapport au CTO. Aucune correction commencée.

Critère de sortie du mandat :

| Question | Réponse |
|---|---|
| Quels P0 existent réellement sur #400 ? | Dual identité leftover vs `login_code` (JWT, années, Finance) ; enrollment transmet leftover à Finance (latent jusqu’à PR-1) |
| Quels P1 existent réellement ? | Notes enseignant (write implicite, fallback JWT, CREATE\|UPDATE, homonyme) ; users autorité leftover |
| Quels anciens bugs ont disparu ? | Aucun des signalements #402/#406/#408–#412 : ils ne sont pas dans cette SHA |
| Quels correctifs post-#400 réappliquer ? | PR-1 Finance, PR-2 Academic year, PR-3 Enrollment (après PR-1), PR-4 Notes, PR-5 Users — **minimales, une par une** |
| Repoussables après production ? | Parent-enfant, RC3 offline, bottom nav, ComingSoon, seed P2, mega Auth #404 |

Stratégie confirmée :

```text
BASELINE #400
  → AUDIT P0/P1          ← vous êtes ici
  → PR corrective n°1
  → diff GitHub indépendant CTO
  → merge
  → revalidation
  → PR suivante
  → RC figée
  → smoke Web + API + PostgreSQL + Android réel
  → préproduction
  → release main
  → Google Play
```
