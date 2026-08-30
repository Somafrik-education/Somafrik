# ID-CANONICAL-01B — Autorité PostgreSQL et Auth

**Base develop :** `415fc3af51feab7f5ee0f0f13de16aba429548da` (#403 mergée)  
**Branche :** `refactor/id-canonical-01b-postgres-auth`  
**Statut :** Draft — pas Ready, pas merge. Aucun Lot C.

## Contrat serveur (Lot B)

```text
schools.id         = UUID
schools.login_code = seule identité publique / Auth
schools.school_code = colonne transition, plus une identité runtime

users.id           = UUID
users.user_code    = login métier

teachers.id / school_id / user_id → users.id
identité publique enseignant = users.user_code via JOIN
legacy_teacher_code = DROP (20260903)
teacher_code        = dual-write transition, DROP D

students.id / student_code exact

resolveTeacherIdForPrincipal
  = principal.sub UUID users.id → teachers.user_id → teachers.id
  fail-closed si sub absent, non UUID, autre tenant, inactif
```

## Changements runtime

| Zone | Après |
| --- | --- |
| School Auth / `getSchoolByCode` (PG cœur) | `upper(login_code) = upper($1)` uniquement |
| `validateSchoolCode` | plus de `legacy-read` ; `CD-2026-0001` / `SCH-…` → refus |
| `schoolLookupKeys` / `matchesSchoolLookup` | `login_code` V2 uniquement |
| Allocation enseignant | `users.user_code` ; dual-write `teacher_code` = même valeur |
| Session enseignant | module unique `resolveTeacherForPrincipal.js` (PG + pedagogy) |
| Auth user | `identifier` = `user_code` ; email/tél. facteurs Auth |
| Auth élève | `student_code` exact ; plus matricule/publicId/id |
| `AccountIdentifier` | égalité exacte ; plus d'aliases ENS/ELE/ETU |
| `principal.sub` PG | UUID `users.id` uniquement |
| Schéma | `DROP legacy_teacher_code` |
| Reconcile boot | plus de rewrite ENS |
| Seed mémoire | `CD-IN-26-001` / `CD-IN-JK-26-00001` ; plus d'`ENS-####` démo |

## Tests

- `backend/lib/authCanonicalIdentity.test.js` — matrice Auth
- `backend/lib/resolveTeacherForPrincipal.test.js` — UUID OK ; ENS/code public → refus
- `backend/lib/idCanonical01bMultitenant.pg.test.js` — isolation A/B (PG skip si pas de `DATABASE_URL`)
- `backend/lib/schoolCodeV2.test.js` — plus de `legacy-read`
- `npm run verify:notes-p1-teacher-runtime` — contrats Notes #402 verts (vitest web absent ici)

## Census serveur (hors allowlist)

| Règle | Lot A `f2543cae` | Lot B actuel |
| --- | ---: | ---: |
| `LEGACY_TEACHER_CODE_COLUMN` | 30 | 21 |
| `LEGACY_SHORT_TEACHER_HELPER` | 34 | 6 |
| `TEACHER_SUFFIX_SQL` | 38 | 39 |
| `TEACHER_SUFFIX_JS` | 13 | 14 |
| `COLLECT_TEACHER_LOOKUP_KEYS` | 8 | 7 |
| `SCHOOL_MULTI_KEY_LOOKUP` | 49 | 41 |
| `MATERIALIZE_BACKOFFICE_IDENTITY` | 14 | 14 |
| Bloquants totaux | 2699 | 2379 |

`TEACHER_SUFFIX_*` reste élevé : le scanner compte encore le nom `sqlTeacherIdentityEquals` (prédicat désormais UUID/`user_code`). Purge des symboles → Lot D / suite B si CTO exige la suppression des noms.

## Résidus C

- Web / Mobile : `ENS-####`, `CD-2026-0001`, `AccountIdentifier` client, fabrication d'ids
- SQLCipher / outbox / projections offline
- Nombreux `*.pg.test.js` / scripts verify encore écrits avec fixtures `school_code` interne

## Résidus D

- `DROP teachers.teacher_code`
- `DROP schools.school_code`
- `legacy_json_id` evaluations / messages
- `--strict` bloquant
- `materializeBackOffice*` hors résolution d'identité
- `collectTeacherLookupKeysForPrincipal` (filtres lecture, plus de BO)
