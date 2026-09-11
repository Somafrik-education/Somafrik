# Pédagogie — correction P1 moyenne générale canonique

## Cause

Après #590, trois surfaces affichaient « Moyenne générale » mais n'appliquaient pas toutes la même formule :

- Backend + Web staff : moyenne par cours pondérée par `evaluationCoefficient`, puis moyenne générale pondérée par le coefficient du cours.
- Web parent + Mobile : moyenne plate de toutes les évaluations, pondérée seulement par `evaluationCoefficient`.

## Contrat corrigé

Formule unique :

1. normaliser chaque note sur /20 ;
2. dans chaque cours, pondérer les évaluations par `evaluationCoefficient` ;
3. pondérer ensuite la moyenne de chaque cours par le coefficient canonique du cours ;
4. diviser par la somme des coefficients de cours éligibles.

Exemple de preuve :

- Mathématiques : 10/20 coef évaluation 1, 20/20 coef évaluation 3 → moyenne cours 17,5 ; coefficient cours 2.
- Français : 12/20 coef évaluation 1 → moyenne cours 12 ; coefficient cours 1.
- Moyenne générale : `(17,5 × 2 + 12 × 1) / 3 = 15,666…`, soit 15,7/20 à un chiffre.

La moyenne plate des évaluations donnerait 16,4/20 : elle est explicitement interdite par les tests.

## Accès aux coefficients de cours

Web et Mobile consomment le catalogue `/api/courses`, déjà tenant-scopé. `Notes:READ` autorise désormais uniquement `GET /api/courses` pour fournir les coefficients nécessaires au calcul ; aucune permission CREATE/UPDATE/DELETE n'est ajoutée.

La route Web `/notes` hydrate explicitement le domaine `courses`. Le Mobile charge le snapshot `schoolCourses` avec les notes.

## Périmètre

Aucune modification Finance, Scolarité, paiements, utilisateurs, production, migrations ou écritures de cours.
