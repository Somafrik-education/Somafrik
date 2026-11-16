# BULLETIN-PUBLISH-01 — Notes réelles, calculs, classement et publication officielle

**Statut :** Draft / HOLD. Base `develop@782cff8` (après #1040).
**Moteur :** `somafrik.report_card.v1` (BULLETIN-MODEL-01), réutilisé. Aucun second moteur.
**Hors périmètre :** rendu final des bulletins (BULLETIN-UI-01) ; moteur PDF inchangé.

## 1. Parcours

```text
Classe (établissement + année) → modèle actif (LOT 6, clé de modèle)
→ catalogue des matières de l'établissement (assertProfileSubjectsInCatalog)
→ inscrits actifs + notes de la classe (PostgreSQL)
→ faits canoniques (reportCardFactBuilder) → moteur (cohorte = classe)
→ brouillon NON officiel + empreinte draft_sha256
→ validation explicite de CETTE empreinte par un utilisateur habilité
→ snapshots signés (un par élève) publiés dans UNE transaction
```

| Route | Jeton | Effet |
|---|---|---|
| `POST /api/report-card/publications/preview` | `REPORT_CARD_GENERATE` | Brouillon `official: false`, aucune écriture |
| `POST /api/report-card/publications` | `REPORT_CARD_PUBLISH` | Publication de l'empreinte confirmée (`expectedDraftSha256`) |
| Routes existantes : lecture, PDF, historique, `corrections`, `revoke` | inchangés | Correction : nouvelle version (LOT 9) |

**Corps des requêtes :** `{ classId, academicYearId, modelKey, period }`, avec `period` égal à `T1`…`T3` ou `ANNUAL`.

**Attribution des jetons :** les jetons `GENERATE` et `PUBLISH` suivent la règle existante de publication des bulletins (`Bulletins:UPDATE` ou « Valider bulletins »).
- Ils ne sont jamais attribués à un parent ni à un élève.
- Un compte plateforme sans établissement est refusé.

**`publishInitial`** (LOT 9) n'est pas raccordable telle quelle. Elle produit un snapshot de classe, sans cohorte, avec une échelle unique par composante et sans contrôle de complétude. Elle est conservée pour compatibilité. Le nouveau service réutilise ses briques : liaison du modèle, moteur, `publish`.

## 2. Correspondances explicites (profil versionné, `fact_sources`)

```json
"fact_sources": {
  "components": {
    "TJ": { "evaluation_types": ["interrogation", "devoir"], "aggregation": "sum" },
    "EX": { "evaluation_types": ["examen"], "aggregation": "sum" }
  },
  "periods": {
    "T1": { "term_names": ["Trimestre 1", "Premier trimestre"] },
    "T2": { "term_names": ["Trimestre 2", "Deuxième trimestre"] },
    "T3": { "term_names": ["Trimestre 3", "Troisième trimestre"] }
  }
}
```

- **Exhaustivité** : chaque composante et chaque période du profil doit être déclarée.
- **Ambiguïté** : un code ou un nom associé à deux cibles provoque un refus (`AMBIGUOUS_FACT_SOURCE`).
- **Codes** : forme canonique de `evaluation_types.code`. Pour une évaluation sans type relié, la même normalisation s'applique au texte `evaluations.evaluation_type`.
- **Noms de trimestre** : minuscules, accents retirés, espaces réduits.
- **Valeur inconnue** : anomalie bloquante (`PERIOD_UNKNOWN`, `EVALUATION_TYPE_UNMAPPED`), jamais une conversion silencieuse.

## 3. Rattachement d'une note

| Élément | Source | Anomalie si invalide |
|---|---|---|
| Établissement | `grades`, `students`, `subjects`, `evaluations` (`school_id`) | `FOREIGN_SCHOOL_DATA` (bloquant) |
| Élève et inscription | `enrollments` actifs de la classe et de l'année | `ENROLLMENT_INVALID` (signalé, exclu) |
| Classe et année | `classes`, `terms.academic_year_id` | `TERM_NOT_IN_ACADEMIC_YEAR` |
| Cours | `school_courses` actif de la classe pour la matière **ou sa matière principale** | `COURSE_NOT_FOUND` |
| Matière ou sous-matière | `subjects.subject_code` (hiérarchie #1040) | `SUBJECT_NOT_CONFIGURED`, `SUBJECT_IS_COMPOSITE` |
| Évaluation | `grades.evaluation_id` | `GRADE_WITHOUT_EVALUATION` |
| Période / composante | `fact_sources` | `PERIOD_UNKNOWN` / `EVALUATION_TYPE_UNMAPPED` / `COMPONENT_NOT_APPLICABLE` |

Une sous-matière contribue exactement une fois à sa matière principale : une note saisie sur une matière composée est refusée.

**Agrégation de plusieurs évaluations** dans une même cellule (élève × matière × période × composante), selon la règle configurée :
- `sum` : somme des notes. La somme des maxima des évaluations doit égaler le maximum de la cellule, sinon `MAX_INCONSISTENT`. Les coefficients doivent valoir 1, sinon `COEFFICIENT_NOT_SUPPORTED`. Une note absente rend la cellule manquante.
- `weighted_average` : `gradesCanonical.weightedAverage`, ramenée au maximum de la cellule.

**Publication des notes** :
- Une note n'est comptée que si `grades.publication_status = 'published'` et que son évaluation est `published` et active.
- Évaluation archivée ou inactive : annulée.
- Toute note non publiée dans une cellule rend celle-ci `MISSING` / `UNPUBLISHED` : le bulletin est incomplet.

## 4. Périmètre, complétude, classement

**Périmètre :**
- **Bulletin trimestriel** `Tn` : trimestres T1…Tn cumulés, sans bilan annuel. Les colonnes hors périmètre valent `NOT_APPLICABLE` / `OUT_OF_SCOPE`.
- **Bilan annuel** `ANNUAL` : toutes les périodes. **Toutes doivent être complètes** : aucune tolérance de trimestre manquant.
- Le calcul suit `Σ points / Σ maxima` (jamais une somme ou une moyenne de pourcentages).

**Complétude :**
- **Publication autorisée** uniquement si aucune anomalie bloquante n'est relevée et que **chaque** élève inscrit est `COMPLETE`.
- La prévisualisation affiche les états incomplets.
- Un élève inscrit sans aucune note figure au bulletin, avec toutes ses notes attendues `MISSING`, jamais à zéro.

**Classement :**
- Il porte sur les seuls élèves du calcul : même établissement, classe, année, période et profil.
- Un total `INCOMPLETE` n'est **jamais** classé (`NOT_RANKED`).
- Ex æquo : `profile.ranking.ties`.
- Chaque total porte `rank` (`internal`, `ranked`) ; le bloc `subject_totals` porte `cohort_size`.

## 5. Publication officielle et immutabilité

- **Un snapshot par élève.** Le `report_card_id` est opaque et déterministe : il est calculé à partir de l'établissement, la classe, l'année, le modèle, le périmètre et l'élève, sans aucune donnée personnelle.
- **Contenu du payload signé** (JCS + Ed25519, LOT 0/4) :
  - `published_at`, `published_by` (identifiant de l'auteur), `provenance` (profil, schéma et gabarit : id + version + hash) ;
  - `class_id`, `academic_year_id`, `model_key`, `period_scope`, `content_sha256` ;
  - le résultat moteur de l'élève.
  - L'auteur est aussi enregistré dans `report_card_published_snapshots.actor_id`.
- **Transaction** : `publishBatch` → `insertPublications`. Une seule transaction PostgreSQL ; verrous consultatifs pris dans l'ordre des identifiants. Tout ou rien : un conflit annule le lot.
- **Republication identique** : `ALREADY_PUBLISHED` (200), comparée par `content_sha256`.
  - Contenu différent : `PUBLICATION_ALREADY_EXISTS` (409). La correction (`corrections`) produit une nouvelle version ; la version source passe en `SUPERSEDED`, sans modification.
  - Publications concurrentes : une seule écrit, l'autre répond `ALREADY_PUBLISHED`.
- **Correction** : modèle **épinglé** du snapshot, notes publiées actuelles, même périmètre. Elle est refusée si le résultat est incomplet.
- **Générer un PDF ne publie jamais un bulletin.**

| HTTP | Code |
|---|---|
| 201 / 200 | `PUBLISHED` / `ALREADY_PUBLISHED` |
| 422 | `REPORT_CARD_INCOMPLETE` (détail par élève), `INVALID_PEDAGOGICAL_DATA`, `PROFILE_NOT_PUBLISHABLE` |
| 403 | `RBAC_DENIED`, `TENANT_MISMATCH` |
| 409 | `DRAFT_CHANGED`, `PUBLICATION_ALREADY_EXISTS`, `CONCURRENCY_CONFLICT`, `MODEL_NOT_BOUND` |
| 400 / 404 | `DRAFT_CONFIRMATION_REQUIRED`, `INVALID_PERIOD_SCOPE` / `CLASS_NOT_FOUND` |

Les détails ne contiennent que des identifiants (codes élève, codes matière, identifiants de note ou d'évaluation), jamais de nom. Rien n'est journalisé.

## 6. Migration

**Aucune.**
- La correspondance vit dans le profil versionné.
- L'auteur est conservé dans la colonne existante `actor_id`.
- L'atomicité passe par la transaction PostgreSQL existante.

## 7. Réserves pour BULLETIN-UI-01

1. **Libellés et identité** : les libellés de matière et de période, l'identité de l'élève, de la classe et de l'établissement ne sont pas dans le snapshot. Ils doivent être rendus à partir de références figées, ou ajoutés au payload par une décision explicite.
2. **Appréciations et décision** : aucune appréciation n'est stockée aujourd'hui. Seule la décision calculée (`DECISION`, règle de passage du profil) est disponible ; décision délibérée, visas, signatures et cachet restent à définir.
3. **Écrans** : aucune interface Web ou Mobile de prévisualisation ni de publication n'est créée. Seules les routes HTTP sont livrées.
4. **Correction et rangs** : la correction recalcule le rang de l'élève corrigé avec la cohorte actuelle. Les bulletins des autres élèves ne sont pas republiés automatiquement.
5. **Notes héritées sans évaluation** : elles bloquent la publication (`GRADE_WITHOUT_EVALUATION`) et doivent être rattachées à une évaluation avant publication.
