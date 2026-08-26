# Mobile offline sync L1 — protocole Classes + Students + Assignments

Vertical slice serveur. **PostgreSQL est la seule source de vérité canonique.**
Le protocole (curseur opaque, scopeHash, tombstones, keyset) a été validé sur
**Classes** (#343), **Students** (#344) et **Assignments**.
SchoolCourses, CourseSchedules, SQLite Mobile, outbox et L2 restent hors scope.

## Endpoint

```
GET /api/mobile-sync/l1/classes
GET /api/mobile-sync/l1/classes?cursor=<opaque>
```

Additif. `GET /api/classes` est inchangé (contrat, RBAC, projection).

RBAC identique à `GET /api/classes` :

`Classes:READ` | `Voir classes` | `Gérer classes` | `COUNTRY_PRIVILEGES` | `ALL_PRIVILEGES`

Le Comptable n'a pas ces permissions aujourd'hui → 403.
Un enseignant n'obtient que les classes de ses **affectations actives PostgreSQL** (`classId` / `classCode`), jamais par `className`, jamais l'établissement entier, jamais `principal.assignments` du JWT.

Lecture : table `classes` PostgreSQL. **Interdit** : `backoffice_state`, overlay legacy.

## Réponse 200

```json
{
  "resource": "classes",
  "mode": "full | delta",
  "cursorStatus": "ok",
  "scopeHash": "hex-sha256",
  "items": [],
  "nextCursor": "opaque",
  "hasMore": false
}
```

- Sans `cursor` → `mode=full` (cold snapshot autorisé).
- Avec curseur valide, même scopeHash → `mode=delta` (warm).
- `nextCursor` pointe toujours vers le **dernier item réellement envoyé** (ou sentinelle si page vide) pour le warm suivant.
- `hasMore` : page suivante obligatoire si `true`.

## Pagination keyset

- `ORDER BY updated_at ASC, id ASC`
- `updated_at > lastUpdatedAt OR (updated_at = lastUpdatedAt AND id > lastId)`
- Pas d'OFFSET.
- Limite serveur : défaut **200**, max **500** (`?limit=` clampé).
- Fetch `limit+1` pour `hasMore`.

## Curseur opaque

JWT HMAC-SHA256 via `TokenService` existant (`JWT_SECRET`). `typ=mobile-sync-cursor`.
Le client ne fabrique jamais `updatedAt`, `id`, `scopeHash`, offset.

Payload serveur (non contractuel client) :

| Champ | Rôle |
| --- | --- |
| `sv` | schemaVersion (1) |
| `gen` | génération sync (1) — bump = invalidation globale |
| `resource` | `classes` |
| `schoolCode` / `schoolId` | tenant |
| `principalId` | `sub` (fail-closed si autre user) |
| `scopeHash` | périmètre d'autorisation live |
| `lastUpdatedAt` / `lastId` | keyset |
| `iat` / `exp` | TTL 30 jours (`MOBILE_SYNC_CURSOR_TTL_SECONDS`) — **fail-closed** : nombre fini, strictement positif, ≤ 90 jours. `"abc"` / `NaN` / ≤0 / hors borne → `MOBILE_SYNC_CURSOR_TTL_INVALID` (500), aucun curseur émis. |

Un curseur modifié, d'une autre ressource, d'un autre tenant ou d'un autre principal est **refusé**. Pas de clé hardcodée dédiée.

## scopeHash (P0)

Construit à chaque requête depuis un **snapshot canonique live PostgreSQL**, pas depuis le JWT :

```
userId + schoolId / schoolCode canonique
        ↓
rôles live du tenant (user_roles WHERE user_id AND school_id)
        ↓
permissions live du tenant (role_module_permissions + schoolCode)
        ↓
affectations live du tenant (teacher_assignments)
        ↓
scope réel (school-wide | assigned | none)
        ↓
scopeHash  +  filtre SQL
```

`principal.assignments` **et les rôles / permissions JWT** sont ignorés. La lecture mobile-sync n'utilise **pas** `listActiveUserRoleKeys` (tous établissements) : uniquement `listActiveUserRoleKeysForSchool(userId, schoolId)`. Une ligne `SCHOOL_ADMIN` active d'un autre établissement ne contamine pas le tenant courant.

Aucun fallback JWT : `user_roles` live du tenant `[]` → `scopeKind=none` (zéro classe) ; erreur PostgreSQL live → `503 MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE` (zéro donnée). Les permissions sont résolues avec `schoolCode` pour la cascade établissement → pays → global (`pickGrant`) ; un DENY Classes au scope school du tenant courant gagne sur un READ global.

SHA-256 déterministe de :

- `resource=classes`
- tenant (`schoolCode`, `schoolId` si connu)
- `principalId`
- rôles effectifs triés (live)
- permissions Classes effectivement détenues (live, pas le label de rôle seul)
- `scopeKind` : `school-wide` **ou** `assigned` **ou** `none`
- si `assigned` : IDs et codes des affectations **actives PostgreSQL**, triés

**School-wide** (Admin School, Préfet, Super Admin, autres rôles `SCHOOL_WIDE_STUDENT_READ_ROLES` qui passent le RBAC) : le hash **ne liste pas** les IDs de classes. Une classe créée reste un delta warm.

**Assigned** (Enseignant) : grant / revoke d'affectation **dans PostgreSQL** (JWT inchangé) → hash change → `409 MOBILE_SYNC_SCOPE_CHANGED`, puis full sync du nouveau périmètre. Pas un warm incomplet, pas de fuite de la classe révoquée.

**None** : aucun rôle actif pour le **tenant courant** (révocation, ou rôle seulement dans un autre établissement), **ou rôle live hors allowlist** (ex. `CUSTOM_ROLE` même avec `Classes:READ`) → aucune ligne, même si le JWT porte encore Admin / Enseignant. School-wide n'est jamais un fallback.

**Permission Classes live** : après le snapshot tenant-scopé et **avant toute requête SQL classes**, le handler exige une permission réelle parmi `Classes:READ` | `Voir classes` | `Gérer classes` | `COUNTRY_PRIVILEGES` | `ALL_PRIVILEGES`. Sinon **403 `PERMISSION_DENIED`**, zéro donnée — y compris si `requirePermission()` a été contaminé par un `SCHOOL_ADMIN` d'un autre établissement (ex. ACCOUNTANT@A + SCHOOL_ADMIN@B + JWT Admin stale@A). Un Comptable n'est pas élargi en school-wide lisible.

## Tombstones

Statuts SQL réels : `active` | `inactive` uniquement (`classes_status_check`).
Pas de `deleted` / `archived` inventés. L'API Classes ne fait pas de DELETE physique.

Projection item :

`id`, `classCode`, `name`, `academicYearId`, `levelId`, `streamId`, `groupId`, `status`, `updatedAt`, `tombstone`

`tombstone: true` ⇔ `status !== "active"`. Le Mobile retirera / inactivera la ligne locale.

## Erreurs

| Situation | HTTP | `code` | `cursorStatus` |
| --- | --- | --- | --- |
| Curseur illisible / falsifié / autre ressource / autre principal | 400 | `MOBILE_SYNC_CURSOR_INVALID` | — |
| Curseur d'un autre tenant | 403 | `MOBILE_SYNC_CURSOR_INVALID` | — |
| TTL / schemaVersion / génération | 409 | `MOBILE_SYNC_CURSOR_EXPIRED` | `expired` |
| scopeHash A vs B courant | 409 | `MOBILE_SYNC_SCOPE_CHANGED` | `scope_changed` |
| Dépôt mémoire (non PG) | 503 | `MOBILE_SYNC_POSTGRES_REQUIRED` | — |
| Rôles/permissions/affectations live illisibles | 503 | `MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE` | `invalid` |
| Sans JWT | 401 | existant | — |
| Sans Classes:READ **live du tenant** (y compris Comptable@A + Admin@B) | 403 | `PERMISSION_DENIED` | `invalid` |
| TTL env invalide à l'émission | 500 | `MOBILE_SYNC_CURSOR_TTL_INVALID` | — |

409 `expired` et `scope_changed` imposent `mode=full_required`. Le client **ne continue pas** avec l'ancien curseur : cold sans `cursor`.

## PostgreSQL

Chemin :

```sql
WHERE school_id = $1
  AND (filtre enseignant id/class_code si assigned)
  AND (updated_at, id) > ($lastUpdatedAt, $lastId)
ORDER BY updated_at ASC, id ASC
LIMIT $n
```

Index additif, non destructif :

`idx_classes_school_updated_at_id ON classes (school_id, updated_at, id)`

Les index existants (PK `id`, UNIQUE `class_code`, unicité nom/structure) ne couvrent pas ce keyset. Le verifier PG force `enable_seqscan=off` et exige cet index dans `EXPLAIN`.

## Observabilité

Log JSON `event=mobile_sync_l1` : `resource`, `mode`, `cursorStatus`, `itemCount`, `schoolId` interne, `durationMs`.
Jamais : curseur complet, JWT, données élèves, secrets.

## Extension L1

Réutiliser les mêmes modules (`mobileSyncCursor`, `mobileSyncScope`, erreurs, pagination).
`mobileSyncCursor` est **resource-aware** : `resource=classes`, `resource=students`
et `resource=assignments` sont inéchangeables (decode fail-closed 400).
Prochaines ressources, **une PR chacune** : SchoolCourses → CourseSchedules.
Chaque ressource a son `resource` dans le curseur (non réutilisable) et son `scopeHash` (filtre autoritatif serveur).
SQLite/SQLCipher Mobile seulement après validation de ce protocole.

## Students — `GET /api/mobile-sync/l1/students`

Additif. `GET /api/students` est inchangé (contrat, RBAC, projection).

```
GET /api/mobile-sync/l1/students
GET /api/mobile-sync/l1/students?cursor=<opaque>
```

RBAC identique à `GET /api/students` :

`Élèves:READ` | `Gérer élèves` | `COUNTRY_PRIVILEGES` | `ALL_PRIVILEGES`

Aucun nouveau privilège. Après `requirePermission()`, le handler reconstruit le scope
depuis PostgreSQL live **avant** toute lecture élèves. JWT `role` / `permissions` /
`assignments` / `studentIds` ignorés.

### Projection minimale

`id` (UUID PostgreSQL stable), `studentCode`, `firstName`, `lastName`, `classId`,
`classCode`, `enrollmentId`, `enrollmentStatus`, `academicYearId`, `status`,
`syncUpdatedAt`, `tombstone`

Interdit : parentPhone, parentEmail, adresse, profil médical, documents, secrets,
credentials, photo binaire, payload legacy.

`classId` / `classCode` / `enrollmentId` viennent de l'**inscription active courante**.
Un élève actif sans inscription active : `classId=null`, `classCode=null`, `tombstone=false`.

### syncUpdatedAt (P0 inscriptions)

Ne pas cursorer uniquement sur `students.updated_at` : un transfert / inactivation
d'inscription sans toucher l'identité serait perdu.

```
syncUpdatedAt = GREATEST(students.updated_at, MAX(enrollments.updated_at))
```

L'horloge observe **toutes** les inscriptions (y compris `status=inactive`).
La projection de classe reste l'inscription **active** courante (DISTINCT ON updated_at DESC).

### Pagination keyset

`ORDER BY sync_updated_at ASC, student UUID ASC`
Cursor opaque : `lastUpdatedAt` = lastSyncUpdatedAt, `lastId` = lastStudentId.
Pas d'OFFSET. Défaut 200, max 500, fetch `limit+1` pour `hasMore`.

### Scopes

| scopeKind | Qui | Filtre SQL | Roster dans scopeHash |
| --- | --- | --- | --- |
| `school-wide` | Admin School, Préfet, Super Admin, autres `SCHOOL_WIDE_STUDENT_READ_ROLES` qui passent le RBAC live | tous les élèves du tenant | **non** (créations/transferts = deltas) |
| `assigned` | Enseignant | inscriptions actives des classes d'affectations PG (`classId`/`classCode`, jamais `className`) | **oui** — IDs élèves actuellement autorisés |
| `linked` | Parent, uniquement s'il passe le RBAC Élèves | `contacts.user_id` → `contact_relations` (`status=active`, tenant) | **oui** |
| `self` | Compte élève | `users.user_code = students.student_code` du tenant. Jamais un `studentId` client. | **oui** |
| `none` | aucun rôle live du tenant, **ou rôle live hors allowlist** (ex. `CUSTOM_ROLE` même avec `Élèves:READ`) | zéro ligne | — |

**P0 visibilité enseignant / parent** : un élève qui quitte une classe affectée
changerait le SQL « actuellement visible » sans jamais informer le client.
Pour cette version sûre, le roster des IDs autorisés entre dans le `scopeHash`
(`assigned` / `linked` / `self`) → `409 MOBILE_SYNC_SCOPE_CHANGED` / `full_required`,
puis une full sync du nouveau périmètre. Pas de tombstones de visibilité (plus tard).

### Tombstones

`tombstone=true` ⇔ `students.status !== "active"`. Pas de statut `deleted` inventé.
Élève actif sans inscription active : **pas** un tombstone.

### Erreurs (Students)

Mêmes codes que Classes. En plus : curseur `resource=classes` présenté sur Students
→ `400 MOBILE_SYNC_CURSOR_INVALID`. Permission Élèves live absente du tenant
(y compris ACCOUNTANT@A + SCHOOL_ADMIN@B + JWT Admin stale@A) → `403 PERMISSION_DENIED`
**avant** toute requête élèves.

Erreur rôles / permissions / affectations / liens parent / identité self PG →
`503 MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE`, zéro donnée. Pas de fallback JWT.

### PostgreSQL Students

Index additifs, justifiés par le plan (pas `students(school_id, updated_at, id)` :
cette expression n'est pas le keyset) :

- `idx_students_school_id` (existant) — filtre tenant
- `idx_enrollments_school_student_updated_at` — horloge `MAX(enrollments.updated_at)`
- `idx_enrollments_school_class_status_student` — roster assigned
- `idx_contact_relations_school_contact_status_student` — liens parent

Le verifier PG force `enable_seqscan=off` et exige l'un des index tenant/horloge
dans `EXPLAIN`. Lecture **uniquement** `students` + `enrollments` + `classes` +
`contact_relations` / `contacts`. Interdit : `backoffice_state`, overlay legacy.

**Fail-closed scope** : seuls les rôles explicitement allowlistés (`SCHOOL_WIDE_STUDENT_READ_ROLES`,
Super Admin, Enseignant, Parent, Élève) reçoivent un périmètre. Un rôle live
inconnu (ex. `CUSTOM_ROLE`) même détenteur de `Élèves:READ` → `scopeKind=none`, `items=[]`.

**Isolation tenant SQL** : tout JOIN `enrollments`/`classes`/`students`/`contacts`/
`contact_relations` exige `school_id` des deux côtés. Une inscription `school_id=A`
pointant vers une classe B n'expose ni `classId` B ni `classCode` B.

## Assignments — `GET /api/mobile-sync/l1/assignments`

```
GET /api/mobile-sync/l1/assignments
GET /api/mobile-sync/l1/assignments?cursor=<opaque>
```

PostgreSQL uniquement. Même protocole que Classes / Students (`resource=assignments`).
Un curseur Classes ou Students présenté ici → `400 MOBILE_SYNC_CURSOR_INVALID`.

RBAC identique à `GET /api/assignments` :

`Affectations:READ` | `Enseignants:READ` | `COUNTRY_PRIVILEGES` | `ALL_PRIVILEGES`

Après `requirePermission()` (JWT), le handler reconstruit le scope depuis PostgreSQL
live **avant** toute lecture métier. Aucun fallback vers `principal.role`,
`principal.roleKeys`, `principal.permissions`, `principal.teacherCode`,
`principal.teacherId` ou `principal.assignments`.

**P0 — même resolver live sur l'API historique.** `GET /api/assignments` n'utilise
plus `req.principal.role === "Enseignant"` ni les identifiants JWT. Les deux
endpoints partagent `resolveLiveAssignmentsSyncSnapshot`. Un JWT `role=Admin School`
dont le rôle PostgreSQL live du tenant est `TEACHER` ne voit **que** ses affectations
sur les deux routes.

En mode mémoire (CI Teachers / seed `data.js`), `user_roles` est backfillé depuis
`userAccounts.role` + `school_id` du tenant, miroir du backfill PostgreSQL. Le
resolver live lit toujours `listActiveUserRoleKeysForSchool` — jamais
`principal.role`. Un compte `schoolCode=*` n'obtient pas de rôle school-scoped.

### Projection minimale

`id`, `teacherId` (**UUID PostgreSQL réel**, pas `teacher_code`), `teacherCode`,
`teacherUserId`, `classId`, `classCode`, `subjectId`, `subjectCode`,
`academicYearId`, `assignmentRole`, `status`, `updatedAt`, `tombstone`

L'API historique `mapAssignment()` conserve `teacherId: teacher_code` pour
compatibilité. Le protocole offline **ne recopie pas** cette ambiguïté.

Interdit : credentials, email/téléphone, fiche utilisateur complète, payload
legacy, photo, `backoffice_state`. Pas de `teacherDisplayName` dans cette version.

### Scope live

```
userId + schoolId
        ↓
rôles PostgreSQL actifs du tenant (`listActiveUserRoleKeysForSchool`)
        ↓
permissions PostgreSQL effectives du tenant
        ↓
identité Teacher PostgreSQL live si rôle Enseignant
        ↓
affectations actives autorisées
        ↓
scopeHash + filtre SQL
```

Identité enseignant :

```
users.id = principal userId
teachers.user_id = users.id
teachers.school_id = school.id
```

Filtre SQL par UUID `teachers.id`. Jamais `teacherCode` JWT.

| scopeKind | Qui | Filtre SQL | Roster dans scopeHash |
| --- | --- | --- | --- |
| `school-wide` | Super Admin + `SCHOOL_WIDE_STUDENT_READ_ROLES` allowlistés et autorisés | toutes les affectations du tenant | **non** (création / update / delete = deltas) |
| `assigned` | Enseignant live | `teacher_assignments.teacher_id` = UUID live, `status = 'active'` | **oui** — IDs des affectations actives actuellement visibles |
| `none` | aucun rôle live du tenant, **ou rôle live hors allowlist** (ex. `CUSTOM_ROLE` même avec `Affectations:READ`) | zéro ligne | — |

**Aucun fallback school-wide.** Permission live absente (scope ≠ none) →
`403 PERMISSION_DENIED` avant la requête métier. Erreur de résolution PG
(rôles / permissions / identité Teacher) → `503 MOBILE_SYNC_LIVE_SCOPE_UNAVAILABLE`,
zéro donnée. Dépôt mémoire / non-PG → `503 MOBILE_SYNC_POSTGRES_REQUIRED`.

Grant / revoke / réaffectation Teacher, ou changement de rôle → ancien curseur
`409 MOBILE_SYNC_SCOPE_CHANGED` / `mode=full_required`, puis full sync propre.

### Tombstones

`DELETE /api/assignments/:id` pose déjà `status='deleted'` et `updated_at=NOW()`.
Pas de hard delete. Pour `teacher_assignments`, le statut est canonique :
`active` ⇔ `status = 'active'` ; tombstone ⇔ `status != 'active'`.
Le CRUD n'écrit que `active` / `deleted`. Assigned n'émet pas de tombstone de
visibilité : le roster dans le `scopeHash` force une full sync.

### Pagination keyset

`ORDER BY teacher_assignments.updated_at ASC, teacher_assignments.id ASC`
Cursor opaque : `lastUpdatedAt`, `lastId` = lastAssignmentId.
Pas d'OFFSET. Défaut 200, max 500, fetch `limit+1`.

### Isolation tenant SQL

Tout JOIN confirme explicitement le tenant :

`teacher_assignments.school_id`, `teachers.school_id`, `users.school_id`,
`classes.school_id`, `subjects.school_id`, `academic_years.school_id`.

Une FK valide n'est pas une preuve d'isolation. Un assignment `school_id=A`
pointant vers une classe / un enseignant / une matière / une année B n'expose
aucune donnée B. `GET /api/assignments` utilise le même `SELECT_ASSIGNMENT`
tenant-strict. `teacherUserId` est `u.id` (LEFT JOIN `users` du tenant) : un
`teachers.user_id` cross-tenant → `teacherUserId=null`, jamais l'UUID B.

### Index

Justifiés par `EXPLAIN` (`enable_seqscan=off`) :

- `idx_teacher_assignments_school_updated_at_id` — keyset school-wide
- `idx_teacher_assignments_school_teacher_updated_at_id` — keyset assigned

