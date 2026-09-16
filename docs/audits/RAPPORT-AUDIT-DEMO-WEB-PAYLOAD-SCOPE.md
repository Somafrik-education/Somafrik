# Audit DEMO-DATA — payload réel (seed PostgreSQL → API → scope Web)

Mandat CTO **#669 commentaire `5690016482`**. Référence terrain : `#669` HEAD `6b874c025b21d5f25b013bd990c4773fef148c33`.

**#669 reste Draft / HOLD.** Cette PR d’audit ne corrige pas les spinners et n’assouplit pas `schoolId`.

## Hypothèse à prouver (pas encore une conclusion)

La session Démo transporte trois identités (`schoolId` UUID, `schoolPublicCode=CD-IN-26-001`, `schoolCode=SCH-BULK-CD-0001`). Les domaines `students` / `users` sont fail-closed sur `schoolId` ; `classes` / `teachers` filtrent encore par `schoolCode`. Le premier point où le volume passe de `>0` à `0` doit être mesuré, pas déduit.

## Gate

`npm run verify:demo-web-payload-scope`

1. Base PostgreSQL isolée + `schema.sql` / migrations réelles.
2. Seed réel `backend/scripts/seed-platform-bulk.js --fresh` (pas de rows alignées à la main).
3. Login réel : d’abord le chemin terrain Démo `POST /api/login` (`role=school_admin`, `identifier=admin`, `schoolCode=CD-IN-26-001`, pin `1234`), puis découverte des identifiants SCHOOL_ADMIN persistés (sans réécriture du seed), puis `POST /api/backoffice/login`.
4. GET métier : schools, users, students, classes, teachers, notes, evaluations, presences, payments, assignments, courseSchedules.
5. Application des **vrais** scopers Web (`projectScopedStudents`, `projectScopedUsersForSchool`, `scopedClasses`, `scopedTeachers`, `scopedNotes`, `scopedEvaluations`, `scopedPresences`, `scopedPayments`, `scopedAssignments`).

## Tableau raw → mapped → scoped

Rempli par le gate (artifact CI `docs/audits/evidence/demo-web-payload-scope.json`) :

| domaine | HTTP | raw PG | mapped API | scoped Web | 1er drop | identité 1er row |
|---|---|---|---|---|---|---|
| *(généré à l’exécution)* | | | | | | |

RED minimal : `classes.raw ≥ 30 && classes.scoped === 0` **ou** `students.raw ≥ 300 && students.scoped === 0`.

## Hors périmètre

- pas de fallback permissif
- pas de bypass `schoolId`
- pas de changement PROD/PREPROD
- pas de réécriture du seed
- pas de nouvelle logique de spinner
