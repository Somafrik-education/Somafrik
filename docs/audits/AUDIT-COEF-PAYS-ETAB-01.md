# AUDIT-COEF-PAYS-ETAB-01 — Coefficients, barèmes et pondérations par pays et établissement

**Référentiel :** issue #1207 · **Dépôt :** `Somafrik-education/Somafrik`
**Base auditée :** `develop@05329844e67b1d8fc23ac8ca75cbf4c03a5e3cda`, identique au SHA de référence du mandat (vérifié le 23/11/2026).
**Statut : AUDIT ONLY — DRAFT / HOLD — NO MERGE.** Aucune modification de calcul, de données, de RBAC ni de schéma.

Légende : **CONFIRMÉ** (code lu ou calcul exécuté) · **NON VÉRIFIÉ** · **À CONFIRMER** (décision ou source réglementaire requise) · **PROPOSITION** (cible Somafrik, non implémentée).

Les références `fichier:ligne` portent sur `develop@05329844`.

---

## 0. Synthèse

1. **Deux chaînes de calcul de bulletin coexistent :**
   - la chaîne historique (`report_cards`), qui s'appuie sur `GradeBookService` ;
   - le moteur `somafrik.report_card.v1`, qui s'appuie sur `AcademicRuleProfile`, des versions immuables et des snapshots signés.

   Seul le moteur v1 apporte versionnage, provenance et figeage.
2. **Quatre implémentations divergent pour une même moyenne générale** : backend, Web personnel, Web Parent et Mobile. Sur des données identiques, les écarts ont été mesurés par exécution réelle :

   | Cas | Backend + bulletin historique + Web personnel | Mobile | Web Parent |
   |---|---|---|---|
   | Maths 16/20 coef. 4, Histoire « dispensé » coef. 2 | **10,67** | **16,00** | 16,00 (calculé) |
   | Maths 16/20 coef. 4, Histoire 8/20 coef. 2 | 13,33 | 13,33 | **12,00** |

3. **Un bulletin historique publié peut changer après coup.** `report_cards` ne fige aucune moyenne ; elle est recalculée à chaque lecture, avec les coefficients du moment.
4. **Le niveau pays n'existe pas pour les règles de notation.** Le référentiel national ne couvre que niveaux, filières et groupes de classes. Les profils de règles sont rattachés au seul établissement.
5. **Le barème de l'établissement (`school_settings.default_scale`) est stocké mais n'est jamais utilisé par un calcul.** L'échelle /20 est codée en dur dans tous les moteurs.
6. **Les coefficients et barèmes d'une évaluation déjà validée ou publiée restent modifiables**, y compris par un enseignant affecté, sans verrou ni recalcul contrôlé.
7. **Les fondations du moteur v1 sont saines** et constituent la base recommandée : versions DRAFT → ACTIVE → SUPERSEDED, immuabilité par trigger, `spec_sha256`, provenance dans le snapshot signé, interdiction des branchements par pays ou par école.

---

## 1. Livrable A — Cartographie As-Is

### 1.1 Stockage PostgreSQL

| Donnée | Table.colonne | Portée | Défaut | Preuve |
|---|---|---|---|---|
| Coefficient de matière (catalogue) | `subjects.coefficient` NUMERIC(8,2) | Établissement | 1 | `backend/db/schema.sql:170-181` |
| Coefficient de matière par classe | `school_courses.coefficient` NUMERIC(8,2) > 0 | Établissement × classe × matière ; classe rattachée à une année (`classes.academic_year_id`) | 1 | `backend/db/migrations/20260813_pedagogy_canonical.sql:4-26`, `schema.sql:137` |
| Coefficient d'évaluation | `evaluations.coefficient` NUMERIC(8,2) > 0 | Évaluation | 1 | `schema.sql:491-517` |
| Barème d'évaluation | `evaluations.max_score` NUMERIC(8,2) > 0 | Évaluation | 20 | `schema.sql:502,512` |
| Coefficient et barème sur la note | `grades.coefficient`, `grades.max_score` | Ligne de note | 1 / 20 | `schema.sql:536-565`. Copie non canonique, utilisée seulement en repli (`postgresRepository.js:7030-7033`) |
| Type d'évaluation | `evaluation_types` (code, name) | Établissement | — | `migrations/20260817_evaluation_types_canonical.sql:4-21`. **Aucun poids de catégorie** |
| Barème de l'établissement | `school_settings.default_scale` NUMERIC(6,2), entre 0 exclu et 100 | Établissement | 20 | `schema.sql:422-439` |
| Mode de période / bulletin | `school_settings.period_mode` (trimestre, semestre, période), `report_card_mode` (period, annual, custom) | Établissement | trimestre / period | `schema.sql:423-437` |
| Profil de règles versionné | `academic_rule_profiles`, `academic_rule_profile_versions` (DRAFT, ACTIVE, SUPERSEDED, ARCHIVED ; `spec` JSONB ; `spec_sha256`) | **Établissement uniquement** (`school_id`) | — | `migrations/20260913_academic_rule_profiles.sql:4-73` ; immuabilité par trigger, lignes 38-73 |
| Bulletin historique | `report_cards` (statuts draft, generated, published, archived) | Établissement | — | `schema.sql:637-651`. **Aucune moyenne ni règle figée** |
| Snapshot publié (moteur v1) | `report_card_published_snapshots` (`canonical_bytes`, `snapshot_sha256`, `snapshot_signature`, `engine_id`) | Établissement | — | `migrations/20260919_report_card_published_snapshots.sql:5-33` |
| Référentiel national | `education_levels`, `education_streams`, `education_class_groups` (`country_id`) | Pays | — | `migrations/20260815_education_reference_canonical.sql:3-36`, `20260826_education_class_groups.sql:4-18`. **Aucune règle de notation** |
| Catalogue de modèles de bulletin | Disponibilité d'un modèle par pays | Plateforme → pays | — | `backend/lib/reportCard/reportCardCatalog.js:13,511-520` |

### 1.2 Moteurs de calcul

| Moteur | Fichier | Formule | Notes sans valeur éligible | Arrondi | Barème |
|---|---|---|---|---|---|
| Canonique bas niveau | `backend/lib/gradesCanonical.js:175-201` | Σ(note/max × coefÉval) / ΣcoefÉval × échelle | Renvoie **moyenne 0** quand aucune note ne compte (191-192) | Aucun | `displayScale` vaut 20 par défaut |
| GradeBookService | `backend/services/gradeBookService.js:39-53,132-139` | Moyenne par matière (coefÉval), puis générale (coefMatière) | **La matière vide est comptée à 0 avec son coefficient** | `toFixed(2)` à l'affichage (30, 48) | **/20 codé en dur** (43) |
| Bulletin historique | `backend/db/documentsExamsPgStore.js:363-389` puis `backend/lib/reportCard/reportCardAverage.js:11-29` | GradeBookService | Comme ci-dessus | `Number(avg.toFixed(2))` (28) | /20 |
| Moteur v1 (faits) | `backend/lib/reportCard/reportCardFactBuilder.js:86-114` | `weighted_average` (normalisation + coefficient) ou `sum` (exige coef. 1 et maxima cohérents) | **`null`, jamais 0** (100) ; politique `NOT_APPLICABLE_not_zero` (`academicRuleProfile.js:20`) | Profil : `half_up`, `half_even` ou `down`, appliqué à l'affichage seulement (`academicRuleProfile.js:19,24,228-247`) | Maximum par cellule (matière × composante × période) |
| Web personnel | `web/src/lib/gradeBook.ts:104-155` | Copie de GradeBookService | Matière vide comptée à 0 | `toFixed` | /20 (`normalizeToScale20`) |
| Web Parent | `web/src/lib/parentNotes.ts:118-134` | Σ(note/max × 20 × coefÉval) / ΣcoefÉval, **toutes matières confondues** | Exclues | — | /20. **Coefficient de matière ignoré** |
| Mobile | `Mobile/src/lib/pedagogyAverage.ts:40-68` et `evaluationsV2.ts:549-576` | Deux niveaux, comme le backend | **Matière exclue** (`available: false`) | `toFixed(2)` (85) | /20 codé en dur (51, 66) |

### 1.3 Résolution actuelle du coefficient de matière

Ordre `COALESCE` identique dans la lecture `/api/notes` (`backend/db/pedagogyPgStore.js:1251-1264`) et dans le bulletin historique (`documentsExamsPgStore.js:370-380`) :

1. `school_courses.coefficient` (classe × matière, actif, le plus ancien en premier) ;
2. `subjects.coefficient` ;
3. 1 (bulletin uniquement ; `mapGrade` applique aussi 1 si la valeur n'est pas positive, `postgresRepository.js:7020`).

Contrat DTO `/api/notes` (`postgresRepository.js:7004-7034`) : `coefficient` est celui de la matière, `evaluationCoefficient` celui de l'évaluation, et `scale` vaut `evaluations.max_score`.

### 1.4 Routes et droits (RBAC)

| Action | Route | Jetons | Rôles par défaut concernés (`backend/data.js`) |
|---|---|---|---|
| Créer ou modifier une évaluation (coefficient, barème) | `POST /api/evaluations`, `PATCH /api/evaluations/:id` | `Notes:CREATE` / `Notes:UPDATE` (`rbacService.js:601-602`) | Enseignant (« Créer notes », « Modifier notes »), Préfet des études, Admin School |
| Coefficient de matière par classe | `POST`/`PATCH /api/courses` | `Matières:CREATE`/`UPDATE`, « Gérer cours » (`backend/lib/coursesRbacPolicy.js:24-36`) | Admin School |
| Barème et périodes de l'établissement | `PATCH /api/school-settings` | « Paramètres Établissement:UPDATE », « Gérer planning académique » (`rbacService.js:447-451`) | Admin School |
| Configuration du modèle de bulletin (moteur v1) | `PUT /api/report-card/catalog/models/:modelId/configuration`, `POST …/activate` | Configuration bulletin (`reportCardHttp.js:562-585`) | Admin School |
| Disponibilité d'un modèle par pays | `PUT /api/report-card/catalog/admin/models/:modelId/countries/:countryId` | Contexte plateforme privilégié (`reportCardCatalog.js:444`) | Superadmin |
| Référentiel national | Écritures sur les référentiels pédagogiques | « Référentiels pédagogiques:CREATE/UPDATE » (`educationReferenceManagement.js:34-35`) | Superadmin |

Garde enseignant à l'écriture d'une évaluation (`postgresRepository.js:3801-3828`) : affectation active requise pour la classe et la matière, et interdiction de valider ou publier. **Aucune garde** n'empêche de changer `coefficient` ou `max_score` d'une évaluation `locked` ou `published`, ou ayant déjà des notes (`3749-3756`, `3855-3860`).

### 1.5 Interfaces

- **Web** : `GradesEvaluationsPage.tsx`, `EvaluationFormModal.tsx` et `GradeEntryGrid.tsx` (coefficient et barème d'évaluation) ; `SchoolSubjectsPanel.tsx` (coefficient de matière) ; `ReportCardCatalogSchoolPage.tsx` (maxima TJ/EX et agrégation du moteur v1).
- **Mobile** : `TeacherGradesScreen.tsx`, `SchoolPedagogicalStructureScreen.tsx`.

### 1.6 Tests existants

- `backend/lib/canonicalAverageParity.test.js` : 4 tests verts, rejoués. Ils vérifient le contrat DTO et la moyenne à deux niveaux. **Ils ne couvrent ni la matière sans note éligible ni la vue Parent.**
- `web/src/lib/gradeBook.test.ts`, `web/src/lib/parentNotes.test.ts`, `Mobile/src/lib/evaluationsV2.test.ts`.
- 44 fichiers de test dans `backend/lib/reportCard/`, dont les profils, les catalogues, la qualification A/B et la publication.
- Contrat `backend/contracts/reportCard/noCountrySchoolBranch.js` : il interdit `if (country === …)` et toute condition codée en dur sur un pays ou une école.

### 1.7 Réponses aux questions du mandat

| Question | Réponse | Preuve |
|---|---|---|
| Où sont stockés les coefficients des matières ? | `school_courses.coefficient` (par classe), sinon `subjects.coefficient` ; dans le moteur v1, `components.<C>.coefficient` du profil | §1.1, §1.3 ; `academicRuleProfile.js:424-438,555-568` |
| Où sont stockés les coefficients des évaluations ? | `evaluations.coefficient` (copie `grades.coefficient`) | `schema.sql:503,548` |
| Qui les consulte et les modifie ? | Coefficient d'évaluation : Enseignant affecté, Préfet, Admin School. Coefficient de matière : Admin School. | §1.4 |
| Paramètres propres à l'établissement ? | Barème, mode de période, coefficients, types d'évaluation, profils v1 | §1.1 |
| Paramètres au niveau pays ? | **Aucun pour la notation.** Seulement niveaux, filières et groupes, plus la disponibilité des modèles de bulletin | §1.1 |
| Configuration par classe, cycle ou niveau ? | Par classe : oui (`school_courses`). Par cycle ou niveau : **non** | §1.1 |
| Variation selon l'année scolaire ? | Indirecte, via la classe rattachée à une année. Pas de coefficient « matière × année » indépendant de la classe | `schema.sql:137` |
| Barème de référence configurable ? | Stocké (`default_scale` ≤ 100) mais **inutilisé** ; /20 codé en dur | §1.2 ; aucun calcul ne lit `default_scale` (grep) |
| Règles codées en dur | Échelle /20 ; seuils d'appréciation 16/14/12/10 (`gradeBookService.js:124-130`, `web/src/lib/gradeBook.ts`) ; rang « compétition » sur moyenne non arrondie (`gradeBookService.js:80-99`) ; `coefficient_default` = 1 imposé dans le moteur v1 (`academicRuleProfile.js:23,584`) | — |
| Coefficient implicite de 1 | Tous les `DEFAULT 1` en SQL ; repli `?? 1` dans `gradesCanonical.js:125,146,183`, `gradeBookService.js:49`, `reportCardAverage.js:17-18`, `pedagogyAverage.ts:29`, `parentNotes.ts:126` | — |
| Modifications qui changent des bulletins existants | **Historique :** tout changement de `school_courses`, `subjects`, `evaluations.coefficient`, `evaluations.max_score` ou de notes change la moyenne de bulletins **déjà publiés** (recalcul à la lecture). **Moteur v1 :** aucun effet sur un snapshot publié ; seule une nouvelle publication utilise la nouvelle version | §3 R-01 |

---

## 2. Livrable B — Matrice de configuration

| Paramètre | Source de vérité actuelle | Portée actuelle | Défaut | Autorité actuelle | Héritage | Versionnage | Validation | Statut |
|---|---|---|---|---|---|---|---|---|
| Coefficient matière × classe | `school_courses.coefficient` | Classe (donc année) | 1 | Admin School | Matière, puis 1 | Non | > 0, 2 décimales | Partiel |
| Coefficient de matière par défaut | `subjects.coefficient` | Établissement | 1 | Admin School | — | Non | NOT NULL | Partiel |
| Coefficient matière (moteur v1) | Profil, `subjects[].components.<C>.coefficient` | Profil établissement | `coefficient_default` = 1 (imposé) | Admin School (configuration catalogue) | Composante, puis défaut 1 | **Oui** | > 0 | Oui (v1) |
| Coefficient d'évaluation | `evaluations.coefficient` | Évaluation | 1 | Enseignant affecté, Préfet, Admin | — | Non | > 0 | Oui, **sans verrou après publication** |
| Poids par type d'évaluation | — | — | — | — | — | — | — | **Absent** |
| Barème d'évaluation | `evaluations.max_score` | Évaluation | 20 | Enseignant affecté, Préfet, Admin | — | Non | > 0 ; note ≤ max | Oui, sans verrou |
| Échelle de référence | `school_settings.default_scale` | Établissement | 20 | Admin School | — | Non | Entre 0 exclu et 100 | **Stockée, inutilisée** |
| Échelle du bulletin (moteur v1) | Maximum par cellule et pourcentage (`points_over_max_100`) | Profil | — | Admin School | — | Oui | max ≤ `MAX_SCORE` = 1000 (`reportCardCatalog.js:57`), alors que `default_scale` est plafonné à 100 | Oui (v1) |
| Périodes | `school_settings.period_mode`, `terms`, profil `periods` | Établissement et profil | trimestre | Admin School | — | Profil : oui | Énumération | Partiel |
| Moyenne annuelle | Profil `annual` | Profil | `true` | Admin School | — | Oui | — | Moteur v1 seulement |
| Arrondi | `toFixed(2)` (historique, Mobile, Web) ; profil `rounding` (v1) | Code ou profil | 2 décimales, `half_up` (v1) | — | — | v1 | Modes `half_up`, `half_even`, `down` | Divergent |
| Classement | Rang « compétition » codé en dur ; profil `ranking` (v1) | Code ou profil | v1 : désactivé | — | — | v1 | `competition`, `dense`, `min` | Divergent |
| Appréciation / mention | Seuils codés en dur (/20) | Code | 16/14/12/10 | — | — | Non | — | **Codé en dur** |
| Seuil de réussite | Profil `pass_rule` (pourcentage, 0 à 100) | Profil | — | Admin School | — | Oui | 0 à 100 | Moteur v1 seulement |
| Règles nationales | — | — | — | — | — | — | — | **Absent** |

---

## 3. Livrable D — Risques

| ID | Niveau | Écart | Impact | Preuve |
|---|---|---|---|---|
| R-01 | **P0** | Un bulletin historique `published` est **recalculé à chaque lecture**, sans moyenne, règle ni version figée | Historique et réglementaire : une modification faite en novembre change silencieusement des résultats publiés en octobre | `documentsExamsPgStore.js:392-403` ; `report_cards` sans moyenne, `schema.sql:637-651` |
| R-02 | **P0** | Une matière sans note éligible est comptée à 0 avec son coefficient (backend, bulletin historique, Web personnel), alors que le Mobile l'exclut | Pédagogique et parité : **10,67 contre 16,00** sur les mêmes données. Un élève dispensé ou absent est pénalisé sur le bulletin | Calcul exécuté ; `gradesCanonical.js:191-192`, `gradeBookService.js:134-138` ; `pedagogyAverage.ts:52` |
| R-03 | **P1** | La vue Parent Web ignore le coefficient de matière | Parité : **12,00 contre 13,33** affiché au parent | `parentNotes.ts:118-134` |
| R-04 | **P1** | Coefficient et barème d'une évaluation `locked` ou `published` modifiables, y compris par l'enseignant, sans recalcul contrôlé ni audit spécifique | Pédagogique et gouvernance ; combiné à R-01, cela modifie des bulletins publiés | `postgresRepository.js:3749-3756,3855-3860` |
| R-05 | **P1** | La chaîne historique ne filtre ni le statut d'évaluation ni la publication des notes : brouillons et évaluations annulées sont inclus | Pédagogique : moyenne de bulletin incluant des notes non publiées | `documentsExamsPgStore.js:367-386` (pas de condition `e.status` ni `publication_status`), comparé à `reportCardFactBuilder.js:59-63` |
| R-06 | **P1** | `default_scale` stocké mais ignoré ; /20 codé en dur partout | Réglementaire : un établissement noté sur 10 ou sur 100 voit des moyennes /20 | §1.2 |
| R-07 | **P1** | Aucune règle de notation au niveau pays ; aucun mécanisme « obligatoire / recommandé / libre » | Réglementaire : impossible d'imposer ou de borner une règle nationale | §1.1 |
| R-08 | **P1** | Quatre implémentations de la moyenne (backend, Web personnel, Web Parent, Mobile) | Technique : dérives futures garanties | §1.2 |
| R-09 | **P2** | Arrondi par `toFixed` (binaire) : `1.005` devient `1.00` au lieu de `1.01` en `half_up` | Classement : écarts au centième | Calcul exécuté |
| R-10 | **P2** | Seuils d'appréciation /20 codés en dur ; rang calculé sur valeur non arrondie, alors que le bulletin affiche une valeur arrondie | Ex-aequo visibles classés différemment | `gradeBookService.js:80-99,124-130` |
| R-11 | **P2** | Coefficients limités à 2 décimales (`NUMERIC(8,2)`) | Un coefficient 0,333 est impossible | `schema.sql:175,503` |
| R-12 | **P2** | Filtre de période divergent : le backend inclut les notes sans période dans toutes les périodes ; le Web personnel les exclut | Parité | `gradeBookService.js:58` comparé à `web/src/lib/gradeBook.ts` (filtre strict) |
| R-13 | **P2** | Pas de poids par catégorie d'évaluation | Fonctionnel : une règle « devoirs 40 %, examen 60 % » est impossible hors du moteur v1 | §1.1 |

**Points maîtrisés (CONFIRMÉ) :**
- isolation par `school_id` des profils, avec clé étrangère composite `(profile_id, school_id)` ;
- rejet des clés pays ou école dans la spécification (`academicRuleProfile.js:65-79`) ;
- interdiction des branchements par pays ;
- immuabilité des versions non DRAFT (trigger) ;
- snapshots signés et horodatés, avec provenance du profil et du schéma (`reportCardEngine.js:764-768`) ;
- note manquante jamais convertie en zéro dans le moteur v1.

---

## 4. Livrable C — Burundi et RDC

**Aucune règle nationale n'est documentée dans le dépôt.** Les fixtures « Burundi modèle A/B » sont explicitement `qualification_only` et `not_a_country_pack` (`backend/lib/reportCard/qualification/model-a.json`). Le seuil de réussite de 50 % et les maxima qu'elles contiennent ne sont pas des règles officielles.

Le catalogue modélise une structure **TJ / EX** (travail journalier et examen) et une note unique par période (`reportCardCatalog.js:39-50`). Ses maxima d'exemple (`reportCardCatalog.js:92-107`) sont des données de démonstration.

Je n'ai inventé ni recopié de mémoire aucun coefficient ou règle. Chaque cellule reste à établir à partir de textes officiels (arrêtés ministériels, circulaires, règlements des examens d'État), avec leur référence, leur date, leur niveau d'application et leur portée.

| Élément | Burundi | RDC | Ce que modélise Somafrik aujourd'hui |
|---|---|---|---|
| Système de périodes | À CONFIRMER (source officielle requise) | À CONFIRMER | Trimestre, semestre ou période (`school_settings`) ; profil T1 à T3 et annuel |
| Barème réglementaire | À CONFIRMER | À CONFIRMER | Maximum par cellule (moteur v1) ; /20 ailleurs |
| Coefficients nationaux | À CONFIRMER | À CONFIRMER | Aucun |
| Pondération des évaluations | À CONFIRMER (structure TJ/EX à valider) | À CONFIRMER (structure TJ/EX à valider) | Composantes TJ et EX par matière |
| Calcul annuel | À CONFIRMER | À CONFIRMER | Profil `annual` |
| Classement et appréciation | À CONFIRMER | À CONFIRMER | Rang par pourcentage, `pass_rule` en pourcentage |
| Dérogations des établissements | À CONFIRMER | À CONFIRMER | Tout est libre au niveau établissement |

**Décision requise :** désigner un responsable pédagogique par pays chargé de fournir les textes sources. Sans source, une règle ne peut être classée que comme « pratique Somafrik proposée », jamais comme « règle nationale ».

---

## 5. Livrable E — Architecture cible (PROPOSITION)

### 5.1 Principes

1. **Un seul moteur de calcul : `somafrik.report_card.v1`.** La chaîne historique et les trois copies client (Web personnel, Web Parent, Mobile) deviennent des consommateurs de résultats calculés côté serveur, ou, à défaut, un module partagé testé par vecteurs de référence communs.
2. **Étendre `AcademicRuleProfile` plutôt que créer un mécanisme parallèle.** Le profil est déjà versionné, immuable, haché et tracé dans les snapshots.
3. **Aucun branchement par pays dans le code**, conformément au contrat existant. Les règles nationales sont des **données**.

### 5.2 Hiérarchie de résolution proposée

1. Référentiel national : `country_rule_packs`, versionné, rattaché à `country_id`.
2. Profil de l'établissement : `academic_rule_profile_versions`, qui référence explicitement une version de pack national.
3. Année scolaire : liaison profil ↔ `academic_year_id`.
4. Cycle, niveau ou classe : `education_levels`, `school_class_groups`, `classes`.
5. Matière : `subjects[]` du profil, avec composantes.
6. Type d'évaluation : `fact_sources.components` (TJ, EX…) et poids de catégorie.
7. Période : `period_overrides`.

Résolution **déterministe** : la valeur retenue est la plus spécifique autorisée, et toute surcharge est validée contre les contraintes du pack national.

| Nature | Mécanisme proposé |
|---|---|
| Règle nationale obligatoire | Champ du pack avec `mode: locked`. L'établissement ne peut pas le surcharger : rejet `RULE_LOCKED_BY_COUNTRY` |
| Recommandation nationale | `mode: default`, avec bornes facultatives `min` et `max`. Une surcharge est permise dans les bornes et journalisée |
| Paramètre libre | Absent du pack, ou `mode: free` |
| Classe ou matière | Surcharges du profil (`subjects[].components`, `period_overrides`) |
| Année scolaire | Une version ACTIVE par (établissement, année) ; activation interdite après la première publication de la période |

**Aucun héritage implicite entre pays** : un établissement sans pack actif pour son `country_id` est en échec fermé (`COUNTRY_RULE_PACK_MISSING`), et non sur « RDC par défaut ».

### 5.3 Historique

- Chaque bulletin, y compris historique, référence `(profile_version_id, spec_sha256, pack_version_id)` et **fige ses résultats** au statut `published`. C'est déjà le cas des snapshots v1 ; à étendre ou à faire migrer la chaîne `report_cards`.
- `generated` signifie recalculable, `published` signifie figé. Une correction passe par une nouvelle version publiée (SUPERSEDED / ACTIVE), avec motif et auteur, jamais par une réécriture.
- **Verrou** : coefficient et barème d'une évaluation non modifiables lorsque l'évaluation est `locked` ou `published`, ou qu'une période liée est publiée, sauf procédure de correction administrative auditée.
- Retour à une version antérieure : réactiver une ancienne spécification sous un **nouveau** numéro de version, sans recalcul automatique des bulletins publiés.

### 5.4 RBAC (PROPOSITION, à valider)

| Rôle | Droits proposés |
|---|---|
| Superadmin | Gouvernance des schémas de packs et du catalogue ; aucun accès aux notes |
| Admin Pays | Brouillon et activation des packs de **son** pays (`country_id` du principal) ; aucune donnée d'élève |
| Admin School | Profil de son établissement, dans les limites du pack ; activation |
| Préfet des études | Lecture du profil ; proposition de brouillon (à décider) |
| Enseignant | Saisie des notes. **Coefficient et barème d'évaluation à décider** : bornés par le profil, ou en lecture seule après validation |

### 5.5 Parité

- Le calcul s'exécute **côté serveur**. Web et Mobile affichent `average`, `display_value`, `rounding` et `profile_version`, sans recalculer.
- Si un calcul client reste nécessaire (hors ligne), utiliser un module partagé unique, avec des **vecteurs de référence JSON communs** exécutés par les tests backend, Web et Mobile.
- Précision interne : valeurs exactes en `NUMERIC`, ou en rationnel côté JS. L'arrondi se fait **une seule fois**, à l'affichage, selon le mode du profil, et jamais avant le classement si le profil prévoit `metric: PERCENTAGE` non arrondi. Cohérent avec #1203 (deux décimales à l'affichage).

---

## 6. Livrable F — Plan de PR proposé (aucune ouverte)

| # | PR | Périmètre | Dépendances | Risque | Tests bloquants |
|---|---|---|---|---|---|
| 1 | **COEF-00 Décisions** (documentaire) | Arbitrages CTO sur les §4, §5.4 et §7 | — | Nul | — |
| 2 | **COEF-01 Vecteurs de parité** | Jeu de vecteurs JSON partagé et tests rouges backend, Web personnel, Web Parent et Mobile ; aucun changement de calcul | — | Nul (tests) | Les tests documentent R-02, R-03 et R-12 |
| 3 | **COEF-02 Figeage des bulletins historiques publiés** | Stocker moyenne, rang et coefficients effectifs au passage en `published`, et lire la valeur figée ; migration additive | 1 | Moyen (données) | Publié inchangé après modification d'un coefficient ; PG réel ; multi-tenant |
| 4 | **COEF-03 Matière sans note éligible** | Alignement sur « non applicable, jamais 0 » (règle du moteur v1) pour le backend et le Web personnel, **sur décision CTO** | 1, 2, 3 | **Élevé** : change des moyennes non publiées | Vecteurs COEF-01 au vert sur les 4 consommateurs |
| 5 | **COEF-04 Vue Parent** | Moyenne générale à deux niveaux, comme le backend | 2 | Moyen | Vecteurs COEF-01 |
| 6 | **COEF-05 Verrou coefficient et barème** | Refus de modifier coefficient ou barème sur une évaluation `locked` ou `published` ; procédure de correction auditée | 1 | Moyen (UX enseignant) | RBAC par rôle ; audit ; 409 attendu |
| 7 | **COEF-06 Filtre de publication** | Chaîne historique limitée aux évaluations publiées et non annulées | 3 | Moyen | PG réel |
| 8 | **COEF-07 Barème de l'établissement** | Usage de `default_scale` pour l'affichage, sans modifier la valeur interne | 2, 3 | Moyen | Barèmes 5, 10, 20, 100 ; arrondis |
| 9 | **COEF-08 Packs nationaux** | Tables `country_rule_packs` et versions, validation `locked`/`default`/bornes, RBAC Admin Pays ; aucun contenu national sans source | 1 | Moyen | Isolation pays ; fail-closed sans pack |
| 10 | **COEF-09 Liaison profil ↔ pack ↔ année** | Résolution déterministe, contraintes à l'activation | 9 | Moyen | Matrice de résolution |
| 11 | **COEF-10 Poids par catégorie** | Poids par type d'évaluation dans le profil, avec ordre de priorité documenté | 9, 10 | Moyen | Vecteurs |
| 12 | **COEF-11 Convergence** | La chaîne historique délègue au moteur v1, ou est retirée ; Web et Mobile consomment le résultat serveur | 2 à 10 | Élevé | Parité complète et smoke Android |

Chaque PR : Draft/HOLD, diff GitHub indépendant du CTO, aucune migration destructive, CI complète.

---

## 7. Décisions métier requises

1. **Matière sans note éligible** : exclue (Mobile, moteur v1) ou comptée à 0 (backend actuel) ? Recommandation : **exclue**, conformément à `NOT_APPLICABLE_not_zero`.
2. Bulletins historiques déjà publiés : figer la valeur au jour de la correction (COEF-02), ou au jour de publication si une trace permet de la reconstituer (NON VÉRIFIÉ, aucune trace n'existe) ?
3. Droit de l'enseignant sur coefficient et barème : libre, borné par le profil, ou en lecture seule ?
4. Ordre de priorité entre poids de catégorie et coefficient individuel d'évaluation.
5. Responsables et sources réglementaires pour le Burundi et la RDC.
6. Classement : sur valeur exacte ou sur valeur arrondie ; règle d'ex-aequo.
7. Barèmes au-delà de 100 (la contrainte actuelle les refuse).

---

## 8. Livrable G — Plan de tests et de smoke

**Vecteurs communs, exécutés sur les 4 consommateurs et le moteur v1 :**
- matière dispensée, absente ou sans note ;
- toutes notes saisies ;
- coefficients décimaux (0,5 ; 1,25 ; 2,75) ;
- barèmes 5, 10, 20, 100 et barèmes mixtes dans une même matière ;
- arrondis aux bornes : 1,005 ; 12,345 ; x,xx5 en `half_up` et `half_even` ;
- ex-aequo en `competition` et en `dense` ;
- notes sans période.

**PostgreSQL réel :**
- publier un bulletin, modifier `school_courses.coefficient` et `evaluations.coefficient`, puis vérifier que la valeur publiée est inchangée ;
- activer une nouvelle version de profil et vérifier qu'un snapshot existant reste identique (`snapshot_sha256` stable).

**Multi-tenant et pays :**
- deux établissements de deux pays, avec packs différents, sans lecture croisée ;
- établissement sans pack national, qui doit échouer en fail-closed ;
- Admin Pays A qui tente de modifier le pack B, qui doit être refusé ;
- Admin School qui tente de surcharger une règle `locked`, qui doit être refusé.

**RBAC :**
- enseignant non affecté, qui doit recevoir un refus 403 ;
- enseignant affecté sur une évaluation publiée, pour qui la modification du coefficient doit être refusée après COEF-05.

**Smoke Web et Android natif, pour chaque rôle :**
- Admin School, Préfet, Enseignant, Parent, Élève ;
- même élève et même période sur la fiche Web, l'application Mobile, le PDF et la vérification publique ;
- valeur identique à deux décimales sur toutes ces surfaces.

---

## 9. Méthode et limites

- Lecture seule de `develop@05329844`, dans un worktree détaché.
- Calculs reproduits avec un script jetable placé hors du dépôt, à partir des fonctions réelles : `GradeBookService`, `computeReportCardAverage`, `canonicalStudentGeneralAverage` (Mobile).
- La formule Web Parent est calculée à partir du code, car son module dépend de l'environnement Vite.
- Test rejoué : `backend/lib/canonicalAverageParity.test.js` (4/4 verts).
- **NON VÉRIFIÉ** : données de production, bulletins réellement publiés, sources réglementaires nationales.
- Aucun code, aucune donnée, aucune permission ni aucun schéma n'ont été modifiés.

`AUDIT-COEF-PAYS-ETAB-01 — AUDIT TERMINÉ / DÉCISIONS CTO REQUISES / DRAFT / HOLD / NO MERGE`
