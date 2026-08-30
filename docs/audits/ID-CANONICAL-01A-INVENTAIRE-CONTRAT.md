# ID-CANONICAL-01A — Inventaire et contrat d’identité

**Chantier :** ID-CANONICAL-01 — suppression définitive des identifiants legacy Somafrik V2  
**Lot :** A — contrat + inventaire (aucune suppression runtime)  
**Base :** `develop` @ `f2543cae12c77f83950072fc69b2ec7a1dfb7a29` (après #402)  
**Branche :** `refactor/id-canonical-01a-inventaire`  
**Statut :** DRAFT — HOLD CTO architecture (P1.1 school_code DELETE, P1.2 teacher_code DELETE, P1.3 zéro allowlist runtime). Cursor ne fait ni Ready ni merge.

Machine-readable : [`id-canonical-01a-entities.json`](./id-canonical-01a-entities.json)  
Scanner : `npm run verify:id-canonical` (rapport). Strict : `npm run verify:id-canonical:strict` (Lot D).

---

## 0. Autorité V2 (contrat figé)

| Rôle | Règle |
| --- | --- |
| Clé relationnelle interne | PostgreSQL `UUID` uniquement. Toute FK = `*_id` UUID. |
| Identité publique | **Une** chaîne canonique immuable par entité qui en a besoin. |
| Identité de connexion | **Une** par compte = l’identité publique user/élève. Email et téléphone restent des facteurs Auth, pas des alias d’identité métier. |
| Tenant | Déterminé par PostgreSQL / session serveur. Aucun payload client ne choisit le tenant réel. |
| Interdit | `ENS-####` comme login ; suffixe `endsWith("-ENS-0001")` ; lookup multi-alias ; fallback BackOffice / payload / fixture ; `CD-2026-0001` en runtime. |

Noms de colonnes cibles (plus de synonymes) :

| Concept | Colonne | Jamais |
| --- | --- | --- |
| UUID technique | `id` | — |
| Identité publique établissement | `schools.login_code` | `code`, `publicId`, `school_code`, `legacySchoolCode`, alias `SCH-…` |
| Identité publique personne | `users.user_code` = `identity_code` | `identifier` ≠ `publicId` ≠ `login_code` court |
| Identité publique élève | `students.student_code` | `matricule` / `publicId` / `login_code` distincts |
| Identité publique enseignant | `users.user_code` du `user_id` lié (JOIN) | `teachers.teacher_code` stocké, `legacy_teacher_code`, `ENS-####` |

API, si les deux champs sont exposés :

```text
id        = UUID technique
publicId  = identifiant public canonique (même valeur que la colonne ci-dessus)
```

`publicId` n’existe que comme **projection** de l’unique colonne publique. Il n’est jamais une deuxième identité.

---

## 1. Tableau des entités

Légende décision : **KEEP** (forme déjà canonique) · **RENAME** · **COLLAPSE** (plusieurs colonnes → une) · **DELETE** (colonne / alias à supprimer).

| Entité | Table | PK actuelle | Code public actuel | Login | Aliases legacy | Décision | Format canonique final | Contrainte PG finale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Country | `countries` | `id UUID` | `iso_code` UNIQUE | — | — | KEEP | `CD` | `iso_code NOT NULL UNIQUE` |
| School | `schools` | `id UUID` | `login_code` **et** `school_code` | `login_code` | `CD-2026-0001`, `publicId`, `code`, `legacySchoolCode`, `SCH-…` | COLLAPSE puis **DELETE** `school_code` | `CD-IN-26-001` | `login_code` UNIQUE V2 ; **DROP `school_code` au plus tard Lot D** |
| User | `users` | `id UUID` | `user_code` + `identity_code` + `login_code` | `identifier` / `publicId` / email / tél. | `ENS-0001`, codes composites, login court | COLLAPSE | `CD-IN-JPM-26-00001` | `user_code = identity_code` UNIQUE |
| Teacher | `teachers` | `id UUID` | `teacher_code` (doublon de `users.user_code`) | `ENS-####` déclaré officiel | `legacy_teacher_code`, suffixe, `publicId` distinct | COLLAPSE puis **DELETE** `teacher_code` | = `users.user_code` via JOIN | `user_id NOT NULL` ; `UNIQUE(school_id, user_id)` ; **DROP `legacy_teacher_code` B** ; **DROP `teacher_code` D** |
| Student | `students` | `id UUID` | `student_code` + `login_code` + `identity_code` | matricule / `student_code` | `CD-IN-EL-26-001`, `publicId`, `id` BO | COLLAPSE | `CD-IN-OHS-26-00001` | `student_code` UNIQUE canonical |
| Class | `classes` | `id UUID` | `class_code` UNIQUE | — | résolution par `className` JWT | KEEP | `class_code` serveur | `class_code NOT NULL UNIQUE` |
| Subject | `subjects` | `id UUID` | `subject_code` UNIQUE | — | nom matière comme identité BO | KEEP | `subject_code` serveur | `subject_code NOT NULL UNIQUE` |
| AcademicYear | `academic_years` | `id UUID` | — | — | — | KEEP | UUID + `name` | `UNIQUE(school_id, name)` |
| Term | `terms` | `id UUID` | — | — | — | KEEP | UUID + `name` | `UNIQUE(academic_year_id, name)` |
| Assignment | `teacher_assignments` | `id UUID` | — | — | id JSON BO | KEEP | tuple UUID | FK UUID ; unicité active |
| Evaluation | `evaluations` | `id UUID` | `legacy_json_id` servi comme `publicId` | — | `legacy_json_id` | DELETE | UUID seul | `DROP legacy_json_id` |
| Grade | `grades` | `id UUID` | — | — | `evaluation_legacy_id` | KEEP | UUID + FK UUID | `teacher_id` NOT NULL UUID |
| Attendance | `attendance` | `id UUID` | — | — | nom de classe (hors chemin D3.5b) | KEEP | UUID | `UNIQUE(school_id, student_id, date)` |
| Payment | `payments` | `id UUID` | `payment_code` UNIQUE | — | — | KEEP | `payment_code` serveur | `payment_code NOT NULL UNIQUE` |
| Invoice/Fee | `student_fee_obligations`, `school_fee_items`, `fee_grids` | `id UUID` | `item_code` catalogue | — | `fee_grid_id` TEXT (dette FK, pas login) | KEEP | UUID | FK UUID ; pas un sujet login |
| CourseSchedule | `course_schedule_weekly_slots` | `id UUID` | `course_code` cours | — | `room` TEXT ; lookup `legacy_teacher_code` | KEEP | UUID | FK `teacher_id` UUID |
| Room | `school_rooms` | `id UUID` | `room_code` `SAL-####` | — | `room` TEXT | KEEP | `SAL-####` / `room_id` | `UNIQUE(school_id, room_code)` |
| Announcement | `announcements` | `id UUID` | — | — | — | KEEP | UUID | FK UUID |
| Message | `school_messages` | `id UUID` | `legacy_json_id` | — | id JSON BO | DELETE | UUID seul | `DROP legacy_json_id` si plus de consommateur |

---

## 2. Consommateurs et fallbacks runtime (cœur de la dette)

### 2.1 École — dualité `school_code` / `login_code`

État @ `f2543cae` :

- Création V2 : `login_code` = `CD-IN-26-001` (trigger PG). `school_code` existe encore (souvent `CD-2026-0001` ou `SCH-…`).
- Lecture : `getByCode` matche **encore** `school_code` **ou** `login_code`.
- `schoolCodeV2.schoolLookupKeys` accepte `loginCode`, `publicId`, `code`, `legacySchoolCode`, `school_code`.
- `validateSchoolCode("CD-2026-0001")` → `kind: "legacy-read"` (création refusée, lecture acceptée).
- Seeds / fixtures / `backend/data.js` : `code: "CD-2026-0001"` partout.

**Cible finale :** `schools.id` UUID + `schools.login_code` uniquement. `school_code` (y compris un éventuel `SCH-…`) est un **troisième identifiant** — **DELETE** au plus tard Lot D. Lots B/C peuvent le conserver temporairement pendant la bascule, jamais comme identité publique ni comme alias interne durable.

**Lot B :** une seule identité fonctionnelle = `login_code`. Lookup exact. `CD-2026-0001` → refus. JWT `schoolCode` = `login_code`. Pas de nouveau `SCH-…` comme contrat.

### 2.2 Enseignant — le fichier à réécrire

`backend/lib/teacherCodeAllocation.js` déclare encore officiellement :

```text
login identifier = ENS-####
teacherCode / userCode / publicId = {schoolCode}-ENS-####
```

Helpers à **DELETE** (Lot B, pas un search/replace) :

| Symbole | Comportement |
| --- | --- |
| `LEGACY_SHORT_TEACHER_CODE_RE` | `/^ENS-\d+$/i` |
| `isLegacyShortTeacherCode` | détecte `ENS-0001` |
| `extractTeacherLoginId` | suffixe `ENS-####` |
| `formatCanonicalTeacherCodes` | émet `identifier: ENS-0001` |
| `teacherPublicCodesMatch` | `endsWith("-ENS-0001")` |
| `sqlTeacherPublicCodeEquals` | `teacher_code OR legacy_teacher_code OR right(teacher_code)` |
| `sqlTeacherIdentityEquals` | UUID OR codes OR `user_code` OR suffixe |

Consommateurs SQL de ces prédicats : `postgresRepository`, `teachersRepository`, `teacherAssignmentsRepository`, `teacherLifecycleRepository`, `pedagogyPgStore`, `fallbackRepository`, `verify-planning-replacements`.

`resolveTeacherPgIdForPrincipal()` aujourd’hui :

1. `collectTeacherLookupKeysForPrincipal` empile `sub`, `publicId`, `identifier` **et** les ids BO (`getBackOfficeState().teachers`) ;
2. pour chaque clé, `sqlTeacherIdentityEquals` (multi-alias + suffixe) ;
3. premier hit gagne.

**Cible Lot B :** session → `principal.sub` (UUID user) → `teachers.user_id` → `teachers.id`. Un seul chemin. Zéro BO. Zéro suffixe.

Schéma : `teachers.legacy_teacher_code` + index `idx_teachers_school_legacy_code` + migration `20260819_teacher_legacy_code.sql` (immuable, allowlist SQL) + **DROP `legacy_teacher_code` Lot B**. `teachers.teacher_code` reste une colonne de transition (B/C) puis **DROP Lot D** — l’identité publique enseignant n’est pas une 2e colonne, c’est `users.user_code` via `teachers.user_id`.

`teacherCourseCanonicalReconcile` **écrit** encore `legacy_teacher_code = ENS-0001` au boot. À décommissionner (plus de couche de compatibilité permanente).

### 2.3 Utilisateur / Auth

`AuthService.userMatchesIdentifier` accepte `identifier` **ou** `publicId` **ou** `email` **ou** `phone`.  
`findManagedUser` élargit le tenant via `schoolCode`, `code`, `loginCode`, `publicId`, `legacySchoolCode`, puis retombe sur `teachers.identifier / publicId / id`.

**Lot B — tests Auth obligatoires :**

| Cas | Attendu |
| --- | --- |
| login canonique (`user_code` V2 + `login_code` école V2) | 200 |
| ancien identifiant `ENS-0001` | refus |
| alias `legacy_teacher_code` / suffixe | refus |
| même code dans un autre tenant | refus |
| payload `schoolCode` client ≠ session | ignoré / refus |

### 2.4 Élève

Contrat JS actuel (`studentCanonicalIdentifier.js`) : `CD-IN-OHS-26-00001`.  
PG porte encore **trois** colonnes souvent égales (`student_code`, `login_code`, `identity_code`) et `studentLifecyclePg` lookup `OR` les trois.  
`materializeBackOfficeStudent` : `matricule ?? publicId ?? id`.

**Lot B/C :** une colonne publique. Lookups exacts. Factories = `createCanonicalStudent()`.

### 2.5 Notes #402 — non-régression

Conserver :

```text
teacher session → teacher UUID PG → teacher_assignments
  → class UUID → subject UUID → evaluation → grade
```

Interdit de réintroduire : JWT `classNames`, fallback BO assignment, `teacherCode` permissif pour autoriser l’écriture Notes.

`legacy_json_id` sur `evaluations` n’est **pas** un login personne ; c’est une identité BO. Décision **DELETE** (Lot D après bascule API UUID). Ne pas le supprimer aveuglément au Lot B si des syncs le lisent encore — mais aucun **nouveau** fallback.

### 2.6 Web / Mobile / offline (Lot C)

| Surface | Dette |
| --- | --- |
| Web tests | `CD-2026-0001` / `ENS-0001` massifs (`TeachersListPage`, `evaluations.test.ts`, …) |
| Mobile | `userTeacherSync` ids `TEACHERS-*` ; login demo `ENS-0001` |
| SQLCipher / outbox | doit porter UUID serveur ; code public = affichage / recherche |
| `backend/data.js` | seed runtime `CD-2026-0001` + `identifier: ENS-0001` |
| Web fabrication | `entityIdentifiers.generateTeacherIdentifiers` / `getTeacherLoginIdentifier` ; `userAccounts.generateUserIdentifier` ; `EntityPage` ; `contacts.ts` |
| Mobile fabrication | `AdminCrudScreen.generateTeacherPublicId` (`ENS-####` + préfixe école) ; `PRE-*` présences locales |
| Offline L1 | SQLCipher stocke UUID (`teacher_id`, `teacher_user_id`) **et** `*_code` ; auth L1 = `teacher_user_id` |

Interdit côté clients : fabriquer un identifiant, le reconstruire depuis un nom, tronquer, comparer plusieurs représentations.

### 2.7 Autres `legacy_*` — analyse (pas de purge aveugle)

| Champ | Usage | Décision |
| --- | --- | --- |
| `teachers.legacy_teacher_code` | alias login / lookup | **DELETE** Lot B |
| `teachers.teacher_code` | doublon de `users.user_code` sans contrainte d’égalité | **DELETE** Lot D (projection API = JOIN pendant B/C) |
| `schools.school_code` | 2e/3e identifiant (`CC-YYYY-NNNN` ou `SCH-…`) | **DELETE** Lot D (`login_code` seul public) |
| `evaluations.legacy_json_id` | id JSON BO, servi comme `publicId` | **DELETE** Lot D (identité runtime) |
| `school_courses.legacy_json_id` | pont JSON→PG cours | **DELETE** Lot D si plus de lookup multi-clé |
| `course_schedule_slots.legacy_json_id` | slots datés historiques | **DELETE** Lot D (planning V2 = weekly UUID) |
| `contacts.legacy_json_id` / `contact_relations.legacy_json_id` | pont BO contacts | **DELETE** Lot D si plus de consommateur d’identité |
| `school_messages.legacy_json_id` | sync BO | **DELETE** Lot D si plus de consommateur |
| `establishment_residual_records.legacy_json_id` | résidus archivés | **KEEP** (archive, pas login) |
| `studentGeneralIdentityPg` / `profile_payload.legacyIdentifier` | alias login persisté | **DELETE** Lot B si c’est un alias de connexion |
| `schoolModule.legacy_school_code` | projection JS | **DELETE** Lot B |
| `packages/auth` `legacy_admin` | rôle de test Auth | **KEEP** (hors identité métier) |

### 2.8 Compléments d’audit (schéma + backend + consommateurs)

Confirmés par inventaire croisé, non couverts seulement par les 19 lignes du tableau :

| Surface | Fait | Lot |
| --- | --- | --- |
| `pedagogyPgStore.resolveTeacherIdForPrincipal` | second résolveur multi-alias parallèle à `postgresRepository` | B |
| `AuthService.findManagedUser` + `AccountIdentifier` | fallback table `teachers` + expansion `ENS-####` | B |
| `principalIdentity.resolvePrincipalSub` | fallback `publicId` / matricule si pas d’UUID | B |
| `teacherCanAccessClassFromBackOffice` | mort pour Notes #402 ; encore dans le repo | B DELETE |
| `mapTeacher` / `getUserIdentifier` | projettent encore `identifier = extractTeacherLoginId` → `ENS-####` | B |
| Offline L1 `uiProjection` | `teacherCode` affichage vs `teacherId` UUID | C |
| `verify:teacher-course-canonical-reconcile` | **écrit** encore `legacy_teacher_code = ENS-0001` | B décommission |

---

## 3. Décisions de format — une entité, une clé, une identité

### École

```text
id         = UUID              ← seule clé technique
login_code = CD-IN-26-001      ← seule identité publique / tenant de connexion
school_code = DELETE final     ← Lot D au plus tard ; pas un alias interne SCH-…
```

Aucune création `CD-2026-0001`. Aucune lecture runtime de ce format après Lot B. Aucun `SCH-…` comme 2e identité.

### Personne (user staff / enseignant / préfet / parent)

```text
id            = UUID
user_code     = CD-IN-JPM-26-00001
identity_code = CD-IN-JPM-26-00001   (même valeur ; une colonne disparaît au Lot D)
```

Login métier = cette chaîne. Pas de login court distinct `JPM-26-00001`. Pas de `ENS-0001`.

### Enseignant (profil, pas une deuxième personne)

```text
id        = UUID
school_id = UUID
user_id   = users.id

identité publique enseignant = users.user_code via JOIN
teacher_code          = DELETE final Lot D
legacy_teacher_code   = DELETE Lot B
```

API temporaire B/C (projection, pas une 2e autorité stockée) :

```text
teacherCode = joinedUser.user_code
publicId    = joinedUser.user_code
```

`resolveTeacherPgIdForPrincipal(principal)` = `SELECT t.id FROM teachers t WHERE t.user_id = $principal.sub AND t.school_id = $sessionSchoolId`.  
Aucun lookup par `teacher_code`.

### Élève

```text
id           = UUID
student_code = CD-IN-OHS-26-00001
```

### Factories partagées (ce lot)

```text
createCanonicalSchool()
createCanonicalUser()
createCanonicalTeacher()
createCanonicalStudent()
```

Module : `backend/lib/canonicalIdentityFactories.js`.  
`createCanonicalSchool()` n’expose pas `schoolCode`.  
`createCanonicalTeacher().teacherCode` / `publicId` = projection de `users.user_code`, pas une 2e autorité.  
Les tests s’adaptent au produit V2. Interdiction de conserver `CD-2026-0001` « parce que les tests l’utilisent ».

---

## 4. Lots suivants (résidus volontairement reportés)

| Lot | Branche prévue | Périmètre | Ne pas faire avant |
| --- | --- | --- | --- |
| **B** | `refactor/id-canonical-01b-postgres-auth` | PG + Auth + `teacherCodeAllocation` + `resolveTeacherPgIdForPrincipal` + seeds runtime + tests Auth/multi-tenant | Web/Mobile UI |
| **C** | `refactor/id-canonical-01c-consommateurs` | Web, Mobile, SQLCipher, outbox, sync | Gate strict |
| **D** | `refactor/id-canonical-01d-zero-legacy` | Purge helpers/colonnes/commentaires ; **DROP `schools.school_code`** ; **DROP `teachers.teacher_code`** ; `verify:id-canonical --strict` bloquant PR Gates | — |

Lot A **ne masque aucun résidu**. Le scanner en mode rapport **doit** encore lister `teacherCodeAllocation.js`, `legacy_teacher_code`, `CD-2026-0001`, `materializeBackOfficeTeacher`.

---

## 5. Scanner `verify:id-canonical`

Règles (runtime, pas la doc) :

- format `CC-YYYY-NNNN`
- `ENS-####`
- `CC-YYYY-NNNN-ENS-####`
- `legacy_teacher_code`
- `isLegacyShortTeacherCode` / `LEGACY_SHORT_TEACHER_CODE_RE` / `extractTeacherLoginId`
- `sqlTeacherIdentityEquals` / `right(teacher_code)`
- `teacherPublicCodesMatch` / `endsWith`
- `materializeBackOfficeTeacher|Assignment|Student`
- `collectTeacherLookupKeysForPrincipal`
- `schoolLookupKeys` / `legacySchoolCode`
- `legacy_json_id`

Allowlist **minuscule** : `docs/audits/`, `docs/project/`, migrations SQL historiques immuables **nommées** (`backend/db/migrations/20YYMMDD_…`) listées dans `scripts/id-canonical/rules.js`, le scanner lui-même.  
**Aucune allowlist runtime.** Interdit : tout préfixe `backend/`, `web/`, `Mobile/`, `apps/`, `packages/` (hors migrations SQL historiques explicitement nommées). Test : aucun de ces préfixes ne peut entrer dans `ALLOWLIST_PREFIXES`.

Lot A : le script est branché sur PR Gates en **rapport** (exit 0 si l’inventaire JSON est complet).  
Lot D : `--strict` devient bloquant.

### Census @ `f2543cae` (mode rapport, 1721 fichiers)

| | |
| --- | --- |
| Hits totaux | 2727 |
| Bloquants (hors allowlist) | **2699** |
| Allowlist | 28 |

| Règle | Hits |
| --- | ---: |
| `LEGACY_SCHOOL_CODE_FORMAT` (`CC-YYYY-NNNN`) | 1987 |
| `LEGACY_SHORT_TEACHER_LOGIN` (`ENS-####`) | 363 |
| `LEGACY_COMPOSITE_TEACHER_CODE` | 98 |
| `LEGACY_JSON_ID_LOOKUP` | 89 |
| `SCHOOL_MULTI_KEY_LOOKUP` | 49 |
| `TEACHER_SUFFIX_SQL` | 38 |
| `LEGACY_SHORT_TEACHER_HELPER` | 34 |
| `LEGACY_TEACHER_CODE_COLUMN` | 30 |
| `MATERIALIZE_BACKOFFICE_IDENTITY` | 14 |
| `TEACHER_SUFFIX_JS` | 13 |
| `COLLECT_TEACHER_LOOKUP_KEYS` | 8 |
| `MULTI_ALIAS_TEACHER_LOOKUP` | 4 |

Fichiers runtime les plus chargés : `TeachersListPage.test.tsx` (96), `verify-pedagogy-management.js` (85), `classStudentsRepository.pg.test.js` (73), `teacherCourseCanonicalReconcile.test.js` (72), `backend/data.js` (69), `postgresRepository.js` (55), `teacherCodeAllocation.js` (28).

Ces chiffres sont le **point de départ**. Lot B/C/D doivent les faire descendre à 0 hors allowlist. Aucun hit n’est masqué.

---

## 6. Critères de sortie du chantier (rappel — pas de ce lot)

- UUID = seule autorité relationnelle
- une identité publique / entité ; une identité de login / compte
- plus d’ancien identifiant accepté silencieusement
- `schools.school_code` DROP (pas d’alias `SCH-…`)
- `teachers.legacy_teacher_code` DROP Lot B ; `teachers.teacher_code` DROP Lot D
- identité enseignant = `users.user_code` via `teachers.user_id` uniquement
- plus de suffix matching `ENS-####`
- plus de fallback identité BackOffice
- plus de seed runtime `CD-2026-0001`
- Web = Mobile ; offline = mêmes UUID
- Auth canonical-only testée ; isolation multi-tenant testée
- Notes #402 verte
- `verify:id-canonical --strict` vert ; PR Gates verts
- allowlist = docs + scanner + SQL historique nommé ; zéro chemin runtime

**ZERO LEGACY IDENTITY RUNTIME.**
