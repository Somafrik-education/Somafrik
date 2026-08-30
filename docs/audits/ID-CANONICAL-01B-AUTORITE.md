# ID-CANONICAL-01B — Autorité PostgreSQL et Auth

**Base Lot A :** `91e1827671df31443899355e5422c02d2b83ea01`  
**Base develop :** `f2543cae12c77f83950072fc69b2ec7a1dfb7a29`  
**Statut :** Draft — pas Ready, pas merge.

## Changements runtime

| Zone | Avant | Après |
| --- | --- | --- |
| Allocation enseignant | `ENS-####` + `{school}-ENS-####` | `{ISO}-{ETAB}-{INITIALES}-{YY}-{SEQ5}` unique |
| Lookup SQL | `teacher_code OR legacy_teacher_code OR suffixe` | égalité exacte UUID / `teacher_code` / `user_code` |
| `resolveTeacherPgIdForPrincipal` | multi-clés + projection BO | `teachers.user_id = principal.sub` |
| Auth | `ENS-0001`, `CD-2026-0001`, aliases école | login V2 uniquement ; legacy → 401 |
| Schéma | `legacy_teacher_code` | `DROP COLUMN` (`20260903`) |
| Reconcile boot | réécrit ENS → composite + alias | plus de rewrite code ; school_courses UUID only |

## Tests

- `backend/lib/teacherCodeAllocation.test.js`
- `backend/lib/authCanonicalIdentity.test.js` (canonique 200 ; ENS / composite / autre tenant / `CD-2026-0001` → 401)
- `backend/lib/teacherCourseCanonicalReconcile.test.js`
- Notes #402 : `resolveTeacherPgIdForPrincipal` toujours sur le chemin write ; plus de JWT/BO.

## Résidus reportés (volontaires, non masqués)

- `getSchoolByCode` PG accepte encore `school_code` interne **ou** `login_code` (fixtures PG isolées).
- Nombreux `*.pg.test.js` Web/Mobile encore écrits avec `ENS-####` / `CD-2026-0001` — Lot C.
- Fabrication client Web/Mobile (`generateTeacherIdentifiers`) — Lot C.
- `legacy_json_id` — Lot D.

Seed mémoire : tenant = `CD-IN-26-001`, enseignant seed = `CD-IN-JK-26-00001`. Plus de login `ENS-####`.

Aucun fallback n’a été réintroduit pour faire passer un test.
