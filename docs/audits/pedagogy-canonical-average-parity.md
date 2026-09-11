# Pédagogie — correction P1 moyenne générale canonique

## Cause

Après #590, trois surfaces affichaient « Moyenne générale » avec deux formules :

- Backend + Web staff : moyenne par cours pondérée par `evaluationCoefficient`, puis moyenne générale pondérée par le coefficient du cours.
- Web parent + Mobile : moyenne plate de toutes les évaluations, ou moyenne à deux niveaux mais sans coefficient de cours (catalogue `/api/courses` inaccessible aux Parents/Élèves).

Une tentative d’élargir `GET /api/courses` avec `Notes:READ` a été rejetée.

## Contrat corrigé

Le coefficient du cours voyage avec chaque note canonique (`GET /api/notes`).

Projection PostgreSQL (`pedagogyPgStore` + snapshot `postgresRepository`) :

- `COALESCE((SELECT sc.coefficient FROM school_courses … LIMIT 1), sub.coefficient) AS subject_coefficient` → DTO `coefficient` (cours)
- `e.coefficient AS evaluation_coefficient` → DTO `evaluationCoefficient` (évaluation)
- sous-requête scalaire (pas de `JOIN school_courses`) pour ne pas dupliquer une note s’il existe une collision de cours actifs

Formule unique :

1. normaliser chaque note sur /20 ;
2. dans chaque cours, pondérer les évaluations par `evaluationCoefficient` ;
3. pondérer ensuite la moyenne de chaque cours par `coefficient` (cours) porté par la note ;
4. diviser par la somme des coefficients de cours éligibles.

Exemple de preuve :

- Mathématiques : 10/20 coef évaluation 1, 20/20 coef évaluation 3 → moyenne cours 17,5 ; coefficient cours 2.
- Français : 12/20 coef évaluation 1 → moyenne cours 12 ; coefficient cours 1.
- Moyenne générale : `(17,5 × 2 + 12 × 1) / 3 = 15,666…`, soit **15,7/20**.

La moyenne plate des évaluations donnerait **16,4/20** : elle est explicitement interdite par les tests.

## Surfaces

- Web staff : `GradeBookService` (catalogue cours si présent, sinon `grade.coefficient`).
- Web parent : `GradeBookService` + `coursesFromGradeCoefficients(grades)` — **pas** `/api/courses`.
- Mobile : `canonicalStudentGeneralAverage(notes)` — **pas** `loadSchoolCourses`.

## RBAC

`Notes:READ` n’ouvre ni `GET /api/courses` ni POST/PATCH/DELETE cours. Matrice `Matières:*` inchangée.

## Périmètre

Aucune modification Finance, Scolarité, paiements, utilisateurs, production, migrations ou écritures de cours.
