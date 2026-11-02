# BULLETIN-MODEL-01 — Matières, sous-matières, maxima TJ/EX et calculs

**Statut :** Draft / HOLD. Base `develop@18a5e9d` (après #1035).
**Périmètre :** modèle de données, règles pédagogiques et calculs du moteur canonique `somafrik.report_card.v1`.
**Hors périmètre :**
- liaison aux notes réelles et publication HTTP (**BULLETIN-PUBLISH-01**) ;
- rendu Web / Mobile / PDF (**BULLETIN-UI-01**).

## 1. Modèle

| Notion | Où | Rôle |
|---|---|---|
| Matière principale / simple | `subjects` (parent `NULL`) | Ligne de premier niveau du bulletin |
| Sous-matière | `subjects` avec `parent_subject_id` (même établissement, un seul niveau) | Composante de notation d'une matière principale |
| Cours dispensé | `school_courses` (classe + matière + enseignant), inchangé | Enseignement ; reste rattaché à la matière principale ou simple |
| Évaluation / note | `evaluations`, `grades`, inchangées | Activité notée / résultat. La composante TJ ou EX sera déduite par PUBLISH-01. |
| Règles de calcul (maxima, TJ/EX, périodes, coefficients) | `AcademicRuleProfile.subjects` (versionné, immuable, haché) | Par établissement et par modèle ; un modèle est lié aux classes par sa clé de modèle (LOT 6) |

**Pas de second catalogue.**
- La hiérarchie vit dans `subjects`. Le profil la reproduit et `assertProfileSubjectsInCatalog` vérifie qu'ils concordent : même établissement, même parent, matière active.
- Changement de règles d'une année à l'autre : on crée une nouvelle version du profil. Les snapshots publiés gardent leur version.

### Profil — clé optionnelle `subjects`

```json
"subjects": [
  { "id": "FRANCAIS", "order": 1 },
  { "id": "FR_LECTURE", "parent_id": "FRANCAIS", "order": 2,
    "components": { "TJ": { "max": 20 }, "EX": { "max": 30 } } },
  { "id": "MATHEMATIQUES", "order": 2,
    "components": { "TJ": { "max": 40 }, "EX": { "max": 60 } },
    "period_overrides": { "T3": { "EX": { "max": 80 } } } },
  { "id": "EPS", "order": 3, "components": { "TJ": { "max": 50, "coefficient": 1 } },
    "periods": { "exclude": ["T3"] } }
]
```

- **Matière composée** : elle est référencée comme `parent_id` et n'a **aucune composante**. C'est ce qui exclut toute double comptabilisation.
- **Composante non applicable** : elle est absente de `components`, ou vaut `"not_applicable"` dans `period_overrides`.
- **Maximum** : nombre fini strictement positif, toujours explicite. Un maximum absent n'est jamais 0.
- **Clé `subjects` absente** : comportement v1 inchangé, avec une spécification, un hash et une sortie moteur identiques à l'existant.

## 2. Formules

Pour chaque composante attendue, `poids = coefficient (règle matière) ?? coefficient (composante du profil) ?? 1`.

| Niveau | Points | Maximum |
|---|---|---|
| Sous-matière / matière simple, période p | Σ note × poids (composantes saisies) | Σ max × poids (composantes **attendues**) |
| Matière composée, p | Σ sous-matières | Σ sous-matières |
| Période p | Σ lignes de premier niveau | Σ lignes de premier niveau |
| Année | Σ périodes applicables | Σ périodes applicables |

- `Pourcentage = 100 × points / maximum`. Il vaut `NOT_APPLICABLE` si le maximum est 0.
- **Jamais une moyenne de pourcentages.**
- Arrondi : affichage uniquement (`exposed`) ; rang et décision utilisent la valeur interne.
- Les slots existants (`PERIOD_*`, `ANNUAL_*`, `PERCENTAGE`, `RANK`, `DECISION`) appliquent les mêmes maxima par matière.

## 3. États et cas particuliers

| Cas | Résultat |
|---|---|
| Note non saisie (fait absent ou `raw_score` vide) | Cellule `MISSING` / `NOT_ENTERED` : 0 point, maximum conservé, statut `INCOMPLETE` |
| Note non publiée, évaluation annulée (`fact_status`) | `MISSING` / `UNPUBLISHED` · `CANCELLED` |
| Composante non applicable | `NOT_APPLICABLE` ; une note saisie dessus est refusée (`FACT_FOR_NOT_APPLICABLE_COMPONENT`) |
| Note sur une matière composée | Refus `COMPOSITE_SUBJECT_FACT` (double comptage) |
| Note < 0 / > maximum de la matière | `INVALID_SCORE` / `SCORE_OUT_OF_BOUNDS` |
| Matière absente du modèle (retirée) | Fait exclu, anomalie `SUBJECT_NOT_CONFIGURED`, totaux non faussés |
| Matière désactivée pour une période (`periods`) | Ni attendue, ni comptée (`NOT_APPLICABLE`) |
| Doublon, parent inconnu, imbrication, maximum invalide | Refus à la validation du profil (`DUPLICATE_SUBJECT`, `UNKNOWN_PARENT_SUBJECT`, `SUBJECT_NESTING_TOO_DEEP`, `INVALID_SUBJECT_MAX`…) |
| Matière d'un autre établissement | `CATALOG_TENANT_MISMATCH` / `SUBJECT_NOT_IN_SCHOOL_CATALOG` ; clé étrangère composite en base |

Chaque élève reçoit `subject_totals`, qui contient :
- `rows` (matière, puis ses sous-matières, par période et pour l'année) ;
- `periods`, `annual`, `status` (`COMPLETE` | `INCOMPLETE`) ;
- `issues` (motif exact).

PUBLISH-01 pourra ainsi refuser ou signaler un bulletin incomplet.

## 4. Base de données

- Migration `backend/db/migrations/20261103_subject_hierarchy.sql`. Elle est additive et idempotente, et appliquée au démarrage par `ensureSubjectHierarchyCanonicalSchema`.
- Contenu : `parent_subject_id` et `display_order` NULLABLE, clé étrangère composite `(school_id, parent_subject_id)`, un seul niveau (déclencheur), doublon de sous-matière refusé.
- Aucune donnée réécrite. **Elle n'est exécutée que sur une base isolée de test dans cette PR.**
- Retour arrière : `20261103_subject_hierarchy.rollback.sql`. À exécuter manuellement après retrait du code ; il ne supprime aucune donnée.

## 5. Décisions — cours et affectations

1. **Cours** : un cours reste attaché à une matière principale ou simple. Une sous-matière est une **composante de notation**, pas un enseignement distinct.
2. **Affectations** : aucune création automatique de cours ni d'affectation. Les affectations enseignants existantes sont inchangées.
3. **Saisie des notes** : la façon dont un enseignant affecté à la matière principale saisit les notes de ses sous-matières relève de PUBLISH-01 ou de la saisie des notes.
4. **Double comptage** : une matière n'apparaît qu'une fois. Une matière composée ne porte aucune note ; seules ses sous-matières sont notées.
5. **Catalogue par établissement** : il est préservé par `school_id` et par la clé étrangère composite.

## 6. Réserves pour BULLETIN-PUBLISH-01

1. **Composantes TJ/EX** : définir la correspondance entre types d'évaluation et composantes (codes `evaluation_types` en minuscules, `TJ`/`EX` dans les profils).
2. **Trimestres** : définir la correspondance entre trimestres réels (`terms.name`) et identifiants de période (`T1`…).
3. **Échelle par matière** : `reportCardFactsStore.aggregateCanonicalFacts` utilise une échelle par composante (`scaleByComponent`). Elle doit devenir propre à chaque matière et à chaque période.
4. **Notes et évaluations** : transmettre `fact_status` pour les notes non publiées et les évaluations annulées. Conserver la règle actuelle : seules les notes publiées sont lues.
5. **Catalogue** : appeler `assertProfileSubjectsInCatalog` avant toute publication ; cohorte de classe et publication par élève.
6. **Libellés** : les libellés de matière ne figurent pas dans le profil, et l'identité n'est pas dans le snapshot (UI-01).
