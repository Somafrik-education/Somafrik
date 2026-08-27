# P1 #357 — Teacher assignments principal identity — 2026-08-27

**Type :** trace + correctif chaîne GET `/api/assignments`  
**PR :** https://github.com/Somafrik-education/Somafrik/pull/357 — Draft dédiée, **indépendante de #354 / #355 / #356**  
**Branche :** `cursor/p1-teacher-assignments-principal-identity-9855`  
**HEAD :** `259213e3f6df67aed5bdc23c74d07961dfe20df5`  
**Base :** `develop@1c7b8dfc` (#356 mergée)

## Constat physique

```text
Web KILOMBO SEKE             4 affectations
Preprod data                 CANONICAL (users.id === teachers.user_id)
Render                       1c7b8dfc (#356)
Mobile API                   preprod Render
GET /assignments             200
Mobile assignments           rows=0
```

#356 reste un correctif valide pour `users.school_id = NULL`. Ce n’était **pas** la cause KILOMBO : l’inventaire était déjà `CANONICAL`.

La ligne Render demandée :

```text
TEACHER_CANONICAL_IDENTITY unresolved resource=assignments scopeKind=assigned
```

n’est **pas** consultable depuis cet agent (observabilité Datadog non branchée). Elle ne peut d’ailleurs **pas** expliquer KILOMBO : elle n’est émise que si le snapshot live a déjà `scopeKind=assigned` (rôle `TEACHER` résolu). Or le JWT Mobile overlaye `users.id` par `teachers.id` à la connexion — `user_roles.user_id` ne matche plus → `roleKeys=[]` → `scopeKind=none` → `200 []` **sans** ce log.

## Cause

```text
login buildManagedMobileUser
  ...safeTeacher          ← teachers.id écrase users.id
JWT.sub = teachers.id     cd866ff1-…   ❌
GET /assignments
  loadLiveRoleKeys(cd866ff1, schoolId)
  user_roles.user_id = c81b0ec1-…      miss
  scopeKind=none
  rows=[]
```

GET `/api/classes` reste peuplé : il filtre le JWT `classIds` embarqué au login, pas l’identité live.

Preprod (READ ONLY) confirmé :

```text
users.id              c81b0ec1-b8dd-4f09-8357-6775586920ff
teachers.id           cd866ff1-92f5-4bf6-9086-dce64f903717
teachers.user_id      c81b0ec1-…
school_code           CD-2026-0001
login_code            CD-IN-26-001
affectations actives  4
```

`createSession` refuse le teacher UUID (`resolveDbUserId` → `users.id` uniquement) : `sessions.user_id` reste NULL. Le refresh ne répare pas le jeton en cours.

## Correctif

1. **Login** : `buildManagedMobileUser` conserve `id` / `publicId` / `identifier` du compte `users`. Plus d’overlay `teachers.id` dans `JWT.sub`.
2. **JWT** : `buildPrincipal` pose aussi `userId = sub` (users.id).
3. **Live Assignments** : `resolveCanonicalUserIdForSchool`
   - rang 1 : `principal.sub = users.id` + `user_roles` du tenant
   - rang 2 : `principal.sub = teachers.id` du tenant → `t.user_id` (jetons déjà émis)
   - jamais `teacherCode`, jamais le nom, jamais `Teachers:READ`, jamais school-wide
4. **Trace Render** (sans PII nominative) :

```text
TEACHER_ASSIGNMENTS_PRINCIPAL_IDENTITY hasSub=1 subKind=uuid … scopeKind=assigned hasTeacherId=1 assignmentIds=4 rows=4 canonicalUser=1 recoveredFromTeacherId=0|1
```

5. **L1** : `teacher_user_id` = `t.user_id` (plus de `LEFT JOIN users … AND u.school_id = ta.school_id`).

## Régression obligatoire

```text
principal user UUID c81b0ec1-…
→ teacher UUID cd866ff1-…
→ 4 assignment IDs
→ GET /api/assignments rows=4
```

HTTP réel :

- session TEACHER, `users.id` / `teachers.user_id` canoniques, 4 affectations actives → 200 + exactement 4 lignes
- JWT `sub = teachers.id` (overlay historique) → les mêmes 4 lignes
- principal sans `teachers.user_id` → `[]`, jamais les affectations d’un autre enseignant

## Hors scope

- #354 / #355 : inchangés, Draft/HOLD
- Ready / merge : **NON**
- RC3-2 smoke : **HOLD** jusqu’au Xiaomi

```text
RC2_L1_READ resource=assignments source=network status=success rows=4
```
