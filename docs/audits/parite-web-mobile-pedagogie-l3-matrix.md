# Matrice de parité Pédagogie L3

**Base :** `develop` au départ de la branche `cursor/pedagogie-parite-l3-06a4`.  
**Cible :** même métier, mêmes droits, mêmes données PG, interface adaptée au support.

Légende : **O** = présent et branché API/PG · **P** = partiel / divergent · **N** = absent · **—** = non applicable.

## Avant

| Fonction | Web | Mobile | API | Données PG | Parité | Cause |
| --- | --- | --- | --- | --- | --- | --- |
| Consultation évaluations | O | O | GET `/evaluations` | `evaluations` | P | Mobile sans filtres, sans coef/enseignant/progression |
| Création évaluation | O | O | POST `/evaluations` | `evaluations` | P | Web sans `classId` ; Mobile coef forcé à 1 ; vocabulaire CTA |
| Modification évaluation | O | N | PATCH `/evaluations/:id` | `evaluations` | N | CTA Modifier absent Mobile |
| Saisie notes | O | O | POST `/notes` | `grades` | P | Roster Web=`className`, Mobile=`classId` ; vocabulaire save |
| Consultation notes | O | O | GET `/notes` | `grades` | P | Liste Mobile n’hydrate pas les notes ; moyenne coef matière vs éval |
| Filtres période/statut | O | N | query non requise | terms / status | N | UI Mobile |
| Navigation détail / saisie | P | O | — | — | P | Web : pas de CTA « Saisir les notes » sur la ligne |
| Matières / cours | O | O | courses / assignments | `subjects` / `school_courses` | O | |
| Classes | P | O | classes | `classes` | P | Web identité nom ; Mobile UUID |
| Enseignants | O | P | JWT / assignments | `teachers` | P | Carte Mobile n’affiche pas l’enseignant |
| Élèves (roster) | O | P | GET `/students` | `students`+`enrollments` | P | Échec roster si seul `className` |
| Coefficients | O | P | body `coefficient` | `evaluations.coefficient` | P | Mobile create ignore le champ |
| Résultats / moyennes | O | P | pas d’endpoint moyenne Notes | moteur `gradesCanonical` | P | `evaluationCoefficient` vs `coefficient` matière |
| Valider | O | O | PATCH status Validée | `locked` | P | Libellé Valider vs Valider l’évaluation |
| Publier | O | N | PATCH status Publiée | `published` | N | CTA absent Mobile |
| Clôturer | N | N | — | — | — | Notion absente du métier |
| Demo / fallback | N | N (fichier mort `data/notes.ts`) | ignoreClientScope | JWT `school_id` | O | Fichier demo non importé |

## Après (cible L3)

| Fonction | Web | Mobile | API | Données PG | Parité |
| --- | --- | --- | --- | --- | --- |
| Consultation évaluations | O | O | GET `/evaluations` | `evaluations` | O |
| Création évaluation | O + `classId` | O + coefficient | POST `/evaluations` | `evaluations` | O |
| Modification évaluation | O | O | PATCH | `evaluations` | O |
| Saisie notes | O + CTA ligne | O + roster className fallback | POST `/notes` | `grades` | O |
| Consultation notes | O | O + hydratation liste | GET `/notes` | `grades` | O |
| Filtres | O | O | — | — | O |
| Navigation | O | O | — | — | O |
| Classes / élèves | classId + nom | classId + nom | UUID | UUID | O |
| Coefficients | O | O | body | colonne | O |
| Moyennes consultation | coef d’évaluation | coef d’évaluation | moteur canonique | — | O |
| Valider / Publier | O | O (mêmes rôles) | PATCH status | `locked`/`published` | O |
