# ID-CANONICAL-01B — Autorité PostgreSQL et Auth

**Base develop :** `415fc3af51feab7f5ee0f0f13de16aba429548da` (#403 mergée)  
**Statut :** Draft — pas Ready, pas merge. Contrat figé par #403.

## Contrat (figé Lot A)

```text
schools.id         = UUID
schools.login_code = seule identité publique
schools.school_code = DELETE final D

teachers.id / school_id / user_id → users.id
identité publique enseignant = users.user_code via JOIN
legacy_teacher_code = DELETE B (DROP 20260903)
teacher_code        = DELETE D (dual-write transition B/C)

resolveTeacherPgIdForPrincipal
  = principal.sub UUID → teachers.user_id → teachers.id
Aucun lookup par teacher_code.
```

## Changements runtime

| Zone | Après |
| --- | --- |
| Allocation | `{ISO}-{ETAB}-{INITIALES}-{YY}-{SEQ5}` écrit sur `users.user_code` ; dual-write `teachers.teacher_code` (transition) |
| Lookup SQL | UUID teacher / UUID user / `users.user_code` uniquement |
| Session enseignant | `teachers.user_id = principal.sub` |
| Auth | login V2 uniquement ; `ENS-####`, composite, `CD-2026-0001` → 401 |
| Schéma | `DROP legacy_teacher_code` |
| Reconcile boot | plus de rewrite code ; `school_courses` UUID only |
| API | `teacherCode` / `publicId` = projection de `users.user_code` |

## Tests

- `backend/lib/teacherCodeAllocation.test.js`
- `backend/lib/authCanonicalIdentity.test.js`
- `backend/lib/teacherCourseCanonicalReconcile.test.js`
- `backend/lib/teachersRepository.test.js`
- Notes #402 : `resolveTeacherPgIdForPrincipal` sur le chemin write

## Résidus reportés (volontaires)

- `getSchoolByCode` PG accepte encore `school_code` interne **ou** `login_code` (fixtures PG isolées). Auth refuse `CD-2026-0001`.
- Nombreux `*.pg.test.js` / Web / Mobile encore écrits avec `ENS-####` / `CD-2026-0001` — Lot C.
- Fabrication client Web/Mobile — Lot C.
- `legacy_json_id` + `DROP teachers.teacher_code` + `DROP schools.school_code` — Lot D.

Seed mémoire : tenant = `CD-IN-26-001`, enseignant = `CD-IN-JK-26-00001`.
