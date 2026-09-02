# AUDIT CIBLÉ — NOTES « PAR CLASSE » & « STATISTIQUES »

**Mode :** audit uniquement. Aucun correctif métier. Aucune migration PostgreSQL.

| Champ | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Branche cible | `develop` |
| SHA audité | `e84fe5d73589e998251a284ecc44165b9c0186a4` |
| Commit | `Merge pull request #256 from Somafrik-education/audit/notes-evaluations-v2-complet` |
| Date d’audit | 2026-08-18 |
| Branche rapport | `audit/notes-par-classe-statistiques` |
| Verdict | **NO-GO** pour les onglets Par classe / Statistiques |

**Question tranchée :** ces deux onglets ne sont **pas** morts à cause d’un `activeTab` mal aligné, et ils ne sont **pas** principalement morts parce que `GET /notes` renvoie `[]`. Le clic monte bien `ClassGradesOverview` avec un dataset souvent **déjà présent**. Le composant **plante au render** (`RangeError: Maximum call stack size exceeded`) dans le moteur `gradeBook` web. Le prochain correctif est un **petit P0 Web**. Les identifiants / le scope enseignant restent un chantier P1 **après** ce crash.

---

## 1. SHA audité

```text
git fetch origin
git checkout develop
git pull --ff-only origin develop
git status --short --branch   → ## develop
git rev-parse HEAD            → e84fe5d73589e998251a284ecc44165b9c0186a4
```

```text
base SHA exact     = e84fe5d73589e998251a284ecc44165b9c0186a4
working tree clean = oui (sur develop, avant la branche documentaire)
```

Ne pas réutiliser les SHA de l’audit #256 (`f80eaa5f`, `dd350340`). #256 est **déjà mergé** dans ce HEAD.

Branche de livrable : `audit/notes-par-classe-statistiques`. **Seul fichier ajouté : ce rapport.**

---

## 2. Reproduction préprod

**Environnement de cet audit :** Cloud Agent, pas de session navigateur authentifiée sur l’établissement IN. Aucun HAR préprod. Playwright absent du dépôt.

**Substitut obligatoire :** fixture React + contrat API (`studentId` = code élève, `className` texte, `period` = `term_name`, `value`/`gradeStatus` projetés par `mapGrade`), scénario :

```text
établissement : IN
utilisateur    : enseignant Seke Kilombo  (aussi rejoué en Admin School)
classe         : 2ème A
cours          : Mathématiques
évaluation     : Validée (non requise par ClassGradesOverview)
note           : Riziki = 14, gradeStatus relue « Saisie »
```

### Comportement observé — avant hypothèse

| Étape | Observé |
| --- | --- |
| Ouvrir `/notes` | Page `GradesEvaluationsPage` rendue. Onglets cliquables. |
| Clic **Par classe** | `setTab("classe")` → JSX `tab === "classe"` monte `ClassGradesOverview`. |
| Console | `RangeError: Maximum call stack size exceeded` dans `<ClassGradesOverview>`. Pas d’ErrorBoundary applicatif. Zone de contenu vide. |
| Clic **Statistiques** | `setTab("stats")` → **le même composant** + `difficultyThreshold={10}` (déjà la valeur par défaut). Même crash. **Aucun changement visible.** |
| Network (contrat code) | `GET /api/notes` n’est pas un no-op : projection PG + filtre JS élèves. Une note persistée 14 **peut** être dans `state.notes`. |
| `state.notes` | Présent dans le fixture (14 / Math / T1 / 2ème A). |
| `selectedClass` | Libellé `"2ème A"` (pas d’UUID). |
| `selectedPeriod` (Admin/Préfet) | `""` = « Toutes les périodes ». |
| `selectedPeriod` (Enseignant) | période académique, pas `""`. |
| Lignes rendues | **0** — le render n’atteint ni le classement ni le cartouche ambre. |

Le cartouche « Aucune note pour cette période » **existe** dans le source (`ClassGradesOverview.tsx` 62–71) mais il est **injoignable** dès qu’au moins un élève matche la classe : le crash a lieu **avant** les `return` d’empty-state, parce que `getClassRanking` / `getClassStatistics` / `getStudentsAtRisk` sont appelés inconditionnellement.

---

## 3. Navigation tabs

Fichier : `web/src/pages/GradesEvaluationsPage.tsx`.

```65:73:web/src/pages/GradesEvaluationsPage.tsx
type TabKey = "evaluations" | "saisie" | "classe" | "eleve" | "stats";

const TABS: { key: TabKey; label: string }[] = [
  { key: "evaluations", label: "Évaluations" },
  { key: "saisie", label: "Saisie des notes" },
  { key: "classe", label: "Par classe" },
  { key: "eleve", label: "Par élève" },
  { key: "stats", label: "Statistiques" },
];
```

Handler : `onClick` → `requestContextChange(() => setTab(item.key))` (l. 526–528). Pas de mismatch `"class"` / `"classes"` / `"by-class"` / `"statistics"`.

| Onglet | Valeur state | Handler | Composant rendu | Fonctionnel |
| --- | --- | --- | --- | --- |
| Évaluations | `evaluations` | `setTab("evaluations")` | table file d’évaluations | oui (hors anomalies #256) |
| Saisie des notes | `saisie` | `setTab("saisie")` | `GradeEntryGrid` | oui (chemin heureux Web) |
| **Par classe** | `classe` | `setTab("classe")` | `ClassGradesOverview` | **non — crash render** |
| Par élève | `eleve` | `setTab("eleve")` | `StudentGradesPanel` | hors périmètre (même `gradeBook` si moyenne/rang) |
| **Statistiques** | `stats` | `setTab("stats")` | **le même** `ClassGradesOverview` | **non — crash identique ; clone UI** |

**ROOT-5 (clés d’onglets non alignées) : infirmé.**

---

## 4. Flux Par classe

```text
/notes
  → DomainRouteBootstrap / routeDomainMap
  → domains: notes, evaluations, students, classes
  → state.notes + state.evaluations + state.students + state.classes
  → GradesEvaluationsPage
       selectedClass = libellé (uniqueClassNames | listTeacherScopedClassLabels)
       period        = file Préfet "" | période enseignant
  → tab === "classe"
  → ClassGradesOverview({ className: selectedClass, period, state, user })
       buildGradeBook(state, user, period)
       getClassRanking / getClassStatistics / getStudentsAtRisk
       → RangeError  (si ≥ 1 élève avec ce className)
```

**Composant exact :** `web/src/components/grades/ClassGradesOverview.tsx`. Pas d’autre vue « par classe ».

**Props :**

| Prop | Type réel | Source | Risque |
| --- | --- | --- | --- |
| `className` | `string` (libellé) | `selectedClass` | jamais un `classId` UUID |
| `period` | `string` | state page partagé | `""` pour Préfet/Admin |
| `state` | `BackOfficeState` | DataContext | `courses` / `assignments` / `teachers` / `academicConfigs` **non chargés** sur `/notes` |
| `user` | `SessionUser` | `scopedUser` | JWT `assignments` ignoré par le roster de cette vue |
| `difficultyThreshold` | number optionnel | défaut `10` | seul écart avec Statistiques |

Le composant **ne prend pas** `evaluations`, `grades` ou `classes` en props dédiées : il relit `state` via `scopedStudents` + `scopedGrades` + `buildGradeBook`.

Domaines `/notes` (`web/src/lib/routeDomainMap.ts` l. 32) :

```text
["notes", "evaluations", "students", "classes"]
```

Non chargés : `courses`, `assignments`, `teachers`, `academicConfigs`.  
Manque `courses` → coefficients cours = 1 (distorsion, pas le crash).  
Manque `assignments`/`teachers` → `teacherScopedClassNames` ne voit pas les affectations JWT (fuite de scope après correction du crash, pas l’écran vide actuel).

---

## 5. Flux Statistiques

**Il n’existe pas de composant `Statistiques`.** Pas de `calculateClassStats` dédié hors `GradeBookService.getClassStatistics`.

```713:720:web/src/pages/GradesEvaluationsPage.tsx
          {tab === "stats" ? (
            <ClassGradesOverview
              className={selectedClass}
              period={period}
              state={state}
              user={scopeUser}
              difficultyThreshold={10}
            />
          ) : null}
```

`difficultyThreshold={10}` est déjà le défaut du composant (l. 24). Les deux onglets sont **pixel-identiques** quand ils ne crashent pas.

La vue n’affiche **ni** « nombre de notes », **ni** matrice élève × matière × 14. Elle vise un classement de **moyennes élèves** + 4 cartes (moyenne de classe, best, worst, taux de réussite).

---

## 6. Données API

### `GET /api/notes` (`backend/server.js` ~1557–1566)

```text
listPedagogyProjection()     → notes globales PG (grades JOIN students/classes/subjects/terms)
listSchoolStudents(school)   → élèves non archivés
tenantScopeService.filterRows(students)
filtre JS : note.studentId ∈ studentIds
filterNotesForPrincipal      → no-op pour staff ; publié seulement parent/élève
```

Ce n’est **pas** un SQL scopé enseignant (contrairement à `GET /api/evaluations`, qui filtre `teacher_assignments` class_id + subject_id, `postgresRepository.js` ~1367–1388). Constat #256 P1-010 **toujours vrai** sur ce SHA.

### DTO `mapGrade` (`backend/db/postgresRepository.js` 5788–5825)

| Champ relevé | Présent ? | Valeur type |
| --- | --- | --- |
| `id` | oui | UUID grade |
| `studentId` | oui | `grade.student_code` (pas UUID `students.id`) |
| `classId` | **non** | — |
| `className` | oui | `cl.name` |
| `subjectId` | **non** | — |
| `subject` | oui | `sub.name` (`course` absent du DTO note) |
| `evaluationId` | oui | `legacy_json_id` \|\| UUID éval |
| `period` | oui | `term.name` |
| `termId` | **non** | — |
| `value` / `score` | oui | les deux |
| `gradeStatus` | oui | `fromGradeStatus` → `Saisie` si PG `graded` |

### `GET /api/students` (`classStudentsRepository.js` `mapStudentRow` 139–168)

`id` = `login_code || identity_code || student_code`. Compatible avec `mapGrade.studentId` **si** le grade porte le même code. `classId` UUID **est** sur l’élève, **pas** sur la note projetée.

### Ce que lit `ClassGradesOverview` / `legacyNotesToGrades`

`web/src/lib/evaluations.ts` 156–183 : `studentId`, `subject`, `className`, `period`, `value`, `scale`, `evaluationCoefficient`, `gradeStatus`. **Pas** de mismatch `class` vs `className`, **pas** de `score` vs `value` côté web (il lit `value`). `gradeBook.ts` n’utilise pas `classId`.

Mismatch utile :

```text
API notes  : pas de classId, pas de studentName
UI Par classe : matching className + studentId
CSV export : colonne Élève = grade.studentName → souvent vide
```

Le dataset API **n’est pas le crash**. Une note 14 bien formée suffit à alimenter `state.notes`. Le render meurt ensuite.

---

## 7. `classId` vs `className`

Autorité fonctionnelle de tout le chemin Par classe / Statistiques : **le nom**.

| Site | Comparaison | UUID ? |
| --- | --- | --- |
| Sélecteur page | `selectedClass: string` | non |
| `ClassGradesOverview` roster | `normalize(student.className) === normalize(className)` l. 32, 38 | non |
| `gradeBook.getClassRanking` | `normalize(student.className) === normalize(className)` l. 146–147 | **zéro** `classId` dans `gradeBook.ts` |
| `scopedStudents` enseignant | `teacherScopedClassNames` = Set de **noms** | non |
| `uniqueClassNames` / `dedupeClassesByName` | une entrée par nom normalisé | fusion homonymes |

Contrat canonique PG : `classes.id`, `evaluations.class_id`, `enrollments.class_id`, `grades.class_id`. **Non utilisé** sur cette vue.

**Classes homonymes** (`UUID A` et `UUID B` toutes deux « 2ème A ») : le sélecteur et le ranking **fusionnent**. `className` doit rester display-only ; le sélecteur cible est `classId`.

Ceci **n’explique pas** l’écran mort actuel (le crash arrive même avec un seul « 2ème A » cohérent). C’est la dette d’identifiants **après** le P0 Web.

---

## 8. Scope enseignant

### Saisie (récent, JWT)

`teacherJwtCoversEvaluation` (`evaluations.ts` 347–355) lit `user.assignments` (classId puis className + matière). Aligné #248/#249/#251.

### Par classe / Statistiques (ancien)

```
scopedStudents → teacherScopedClassNames(user, state)
```

`teacherScopedClassNames` (`establishment.ts` 57–114) lit :

- `state.teachers` (fiche + `assignedClasses`)
- `state.classes.teacherId`
- `state.assignments`

**Il ne lit pas `user.assignments` ni `assignedClassIds`.**

Sur `/notes`, `teachers` et `assignments` ne sont pas chargés. Pour un enseignant JWT-only :

- `teacherScopedClassNames` → `null` (aucune classe rattachée dans le state)
- commentaire du code : `null` = **pas de restriction**, portée établissement
- l’enseignant Math **verrait** aussi le Français de 2ème A **si le ranking s’affichait**

Ce n’est **pas** le motif de l’écran vide (ce serait une **fuite**, pas un zéro). Régression de même famille que #248/#249/#251, classée P1 **après** le crash.

`GET /notes` : trop de notes (toute la classe / l’établissement), pas trop peu. Le frontend ne retire pas tout par `gradeStatus`. `scopedGrades` filtre par `student.id` ∈ roster, pas par matière.

---

## 9. Période

Un **seul** `period` partagé Évaluations / Saisie / Par classe / Statistiques (`GradesEvaluationsPage.tsx` 112–113, 144–150, 537–547).

| Rôle | Défaut (`resolveEvaluationsQueueDefaults`) | Effet sur Par classe |
| --- | --- | --- |
| Préfet / Admin / Proviseur | `ALL_PERIODS_FILTER = ""` | `gradedCount` : `if (!period) return 0` → empty-state ambre **si le crash n’avait pas lieu** |
| Enseignant | `null` → `resolveGradesPeriod` / trimestre | Saisie **ignore** la période pour lister les évals Validée ; Par classe **filtre** |

Preuve file Préfet déjà en tests : « Validée T1 visible dans Saisie même si Trimestre 3 est le défaut » (`GradesEvaluationsPage.test.tsx`). L’enseignant peut donc saisir 14 en T1 puis ouvrir Par classe sur T3.

Verrouillage :

```144:150:web/src/pages/GradesEvaluationsPage.tsx
  useEffect(() => {
    const key = `${scopeUser?.id ?? ""}:${scopeUser?.role ?? ""}:${code}`;
    if (queueDefaultsKey === key) return;
    setPeriod(queueDefaults.periodFilter ?? defaultPeriod);
    ...
  }, [..., defaultPeriod, queueDefaultsKey, ...]);
```

Après le premier run, `defaultPeriod` peut changer (notes chargées → période majoritaire) **sans** recalculer `period`. Enseignant : T3 figé alors que les notes sont en T1.

`academicConfigs` n’est pas chargé sur `/notes` : `getSchoolPeriodNames` retombe sur `["Trimestre 1","Trimestre 2","Trimestre 3"]`.

`buildGradeBook` traite `!period` comme « toutes les périodes » (`evaluations.ts` 745–747). `ClassGradesOverview.gradedCount` fait l’inverse (`!period` → 0). **Incohérent.** Injoignable tant que le ranking crash.

---

## 10. `gradeStatus`

`fromGradeStatus` (`backend/lib/gradesCanonical.js` 36–42) : PG `graded` → UI **`Saisie`**. C’est **NOTES-EVAL-P0-001** (#256).

`gradeBook.ts` `EXCLUDED_GRADE_STATUSES` : Absente, Justifiée, Non justifiée, Dispensée, En attente (+ codes EN). **`Saisie` compte dans la moyenne.** Aucun filtre « Validée seulement ».

```text
P0-001  +  filtre Validée-only  n’existe pas ici
→ P0-001 ne vide PAS Par classe / Statistiques
```

Absences : exclues, **pas** converties en `0/20` (preuve Vitest : 14 + Absente 0 → moyenne 14, `gradeCount` = 1).

Staff : notes `Saisie` non publiées **incluses**. Parent/élève : `filterGradesForParentOrStudent` / `filterNotesForPrincipal` = évaluations `Publiée` seulement. Ces onglets staff n’appliquent pas de règle « publié ».

---

## 11. Calcul des moyennes

Moteur web : `web/src/lib/gradeBook.ts`. Le backend canonique `backend/services/gradeBookService.js` **sépare** `getStudentAverageValue` (scalaire, sans rang) et `getStudentAverage` (détail + rang). Le web **a cassé cette séparation**.

Formule **prévue** par le code web (injoignable via ranking, vérifiée via `getSubjectAverage`) :

1. Note → `/20` : `normalizeToScale20(value, scale)` (`14/20` reste 14 ; `8/10` → 16). **Pas** `average(14, 8)`.
2. Moyenne matière : Σ (note/20 × `evaluationCoefficient`) / Σ coef éval. Défaut coef = 1.
3. Moyenne élève : Σ (moyenne matière × **coef cours**) / Σ coef cours. Coef cours = `state.courses` par **nom** ; domaine non chargé → **1**.
4. Moyenne de classe : moyenne **non pondérée des moyennes élèves**, y compris **0** si l’élève n’a aucune note comptée (`getStudentAverageValue` → 0). Réussite = moyenne ≥ 10.

Exemple demandé, **même matière** :

```text
14/20 coef 1  +  10/20 coef 2
→ (14×1 + 10×2) / 3 = 11,333…   PREUVE Vitest
```

Barèmes différents, **même matière**, coef 1 :

```text
14/20 et 8/10 → (14 + 16) / 2 = 15    PREUVE Vitest
```

Exemple « Riziki 14, 1 note, classe de 2 élèves » **selon le code de** `getClassStatistics` :

```text
attendu métier du mandat : nombre de notes = 1, moyenne = 14
code réel après correction du crash : classAverage = (14 + 0) / 2 = 7
```

`getClassStatistics` est aujourd’hui injoignable (même récursion). La dilution est lue dans `getClassRanking` l. 145–154 + `getClassStatistics` l. 182–193.

---

## 12. Permissions

| Guard | Usage Par classe / Stats |
| --- | --- |
| `useFeaturePermissions("Notes").canRead` | page entière ; sinon `ForbiddenState` |
| `canCreate` / `canUpdate` | saisie / nouvelle éval ; **pas** ces onglets |
| `canViewGrades` | **n’existe pas** sous ce nom ; `canReadGrades` dans `gradePermissions.ts` non branché ici |
| `canExportGrades` | **défini, jamais appelé** |
| `canReadNotes` | **absent** du web |

Les deux onglets sont **affichés dès que Notes:READ**. Pas de guard mort qui les masquerait. Pas de permission qui expliquerait un écran vide. Export CSV visible sans `canExportGrades`.

---

## 13. Tests actuels

| Question | Réponse |
| --- | --- |
| Clic réel « Par classe » ? | **Non.** `GradesEvaluationsPage.test.tsx` mocke `ClassGradesOverview` (`<div>ClassGradesOverview mock</div>`). Le test de structure ne clique même pas le bouton. |
| Clic réel « Statistiques » ? | **Non.** |
| Test `ClassGradesOverview` ? | **Aucun** fichier dédié dans le dépôt. |
| Test `gradeBook.ts` web ? | **Aucun.** |
| Note PostgreSQL réelle sur ces onglets ? | **Non.** |

Lacune obligatoire. Le mock **cache le P0** : la page « passe au vert » sans jamais exécuter le ranking.

Tests existants utiles ailleurs : file Préfet, période enseignant, saisie Validée T1 vs T3 actif, batch POST notes (#255).

---

## 14. E2E

Playwright : **absent** du projet. Substitut : Vitest + fixture contrat API (non commité, exécuté localement pendant l’audit).

Scénario mandaté :

| # | Étape | Résultat |
| --- | --- | --- |
| 1–4 | créer éval, valider, saisir 14 Riziki, GET `/notes` = 14 | hors process ici ; chemin heureux Web **déjà** établi #256 |
| 5 | ouvrir `/notes` | OK |
| 6 | cliquer Par classe | **OK navigation** (`setTab("classe")`) |
| 7 | sélectionner 2ème A | `selectedClass` libellé |
| 8 | attendu Riziki / Mathématiques / 14 | **ÉCHEC.** `RangeError` dans `getClassRanking`. Aucune ligne. La vue n’affiche de toute façon **pas** la matière ni la note brute 14, seulement une moyenne élève. |
| 9 | cliquer Statistiques | même composant, même crash |
| 10 | attendu notes=1 et moyenne=14 | **injoignable.** Même après correction du crash, l’UI n’a pas « nombre de notes » ; la moyenne de classe diluerait les 0. |

```text
étape exacte qui échoue = 8
valeur attendue         = ligne Riziki / Mathématiques / 14
valeur réelle           = RangeError Maximum call stack size exceeded
                          (stack : getClassRanking → getStudentAverageValue
                           → getStudentAverage → getClassRankingForStudent
                           → getClassRanking → …)
```

Preuve locale (8/8) :

```text
npx vitest run src/components/grades/ClassGradesOverview.audit.test.tsx
  ✓ getClassRanking recurse à l'infini dès qu'un élève a un className
  ✓ le render ClassGradesOverview explose même si les notes existent
  ✓ sans élève matching className, getClassRanking ne recurse pas
  ✓ (14×1 + 10×2) / 3 = 11.33
  ✓ 14/20 et 8/10 → 15, pas average(14, 8)
  ✓ Absente n'est pas 0/20
  ✓ Math 14 et Français 12 coexistent (pas de filtre matière)
  ✓ getClassStatistics injoignable (même récursion)
```

Le fichier de preuve n’est **pas** dans cette PR (livrable documentaire uniquement).

### Multi-cours / Admin (conceptuel, post-crash)

| Acteur | Après correction P0-001 UI | Aujourd’hui |
| --- | --- | --- |
| Seke Math only, 2ème A Math 14 + FR 12 | verrait **les deux** (P1 scope) | crash, ne voit rien |
| Admin School | ranking toutes matières du tenant sélectionné | crash identique |
| Autre tenant | `schoolCode` filtre students/notes | pas de preuve de fuite tenant sur cette vue |

---

## 15. Anomalies P0 / P1 / P2

### NOTES-UI-P0-001 — Récursion infinie `gradeBook` web (cause de l’écran mort)

| | |
| --- | --- |
| Priorité | **P0** |
| Fichier | `web/src/lib/gradeBook.ts` |
| Lignes | `getStudentAverage` 117–127 ; `getStudentAverageValue` 141–143 ; `getClassRanking` 145–154 ; `getClassRankingForStudent` 173–179 |
| Appelant | `web/src/components/grades/ClassGradesOverview.tsx` 26–29 |
| Scénario | `/notes` → Par classe ou Statistiques → classe avec ≥ 1 élève |
| Impact | Les deux onglets plantent. Zone de travail vide. Console `RangeError`. Pas d’ErrorBoundary. |
| Preuve | Vitest `toThrow(RangeError)` ; stack identique sur `getClassRanking`, `getClassStatistics`, `getStudentAverage`, render React. Backend `gradeBookService.js` 131–138 et Mobile `getStudentAverageValue` **n’appellent pas** `getStudentAverage`. |
| Correctif | Aligner le web sur le backend : `getStudentAverageValue` calcule le scalaire **sans** demander le rang. |
| Dépendance #256 | Aucune. |

Cycle :

```text
getClassRanking
  → getStudentAverageValue
      → getStudentAverage
          → getClassRankingForStudent
              → getClassRanking
                  → …
```

### NOTES-UI-P0-002 — `period === ""` compte 0 note (Préfet/Admin par défaut)

| | |
| --- | --- |
| Priorité | **P0** (bloqué derrière P0-001 ; redevient visible dès que le ranking rend) |
| Fichier | `web/src/components/grades/ClassGradesOverview.tsx` |
| Lignes | 34–35 (`if (!className \|\| !period) return 0`), 62–71 |
| Scénario | Admin/Préfet, défaut « Toutes les périodes », notes T1 présentes |
| Impact | Cartouche ambre « Aucune note pour cette période » alors que `state.notes` n’est pas vide. Enseignant non affecté par le défaut, mais le Select « Toutes les périodes » le casse aussi. |
| Preuve | `resolveEvaluationsQueueDefaults` + `ALL_PERIODS_FILTER = ""` (`evaluationQueue.ts` 6, 65–70). `buildGradeBook` et `exportGrades` traitent `!period` comme « tout garder ». |
| Correctif | `gradedCount` : `!period` = toutes les périodes (même sémantique que `buildGradeBook`). |
| Dépendance #256 | Non. |

### NOTES-UI-P1-001 — Autorité `className` / homonymes / pas d’`enrollments.class_id`

| | |
| --- | --- |
| Priorité | P1 |
| Fichiers | `gradeBook.ts` 146–147 ; `ClassGradesOverview.tsx` 30–33 ; `GradesEvaluationsPage.tsx` 75–79, 93–97 ; `classRules.ts` `dedupeClassesByName` |
| Scénario | Deux UUID « 2ème A » ; ou roster par `student.className` au lieu d’inscriptions actives |
| Impact | Fusion / élèves hors inscription active / ancien `className` figé |
| Preuve | Aucun `classId` dans `gradeBook.ts`. `GET /notes` ne projette pas `classId`. |
| Correctif | Sélecteur `classId` ; roster = enrollments active. |
| Dépendance | IDENTIFIER-CONTRACT / audit #256 grain UUID. |

### NOTES-UI-P1-002 — Période partagée + verrou `queueDefaultsKey`

| | |
| --- | --- |
| Priorité | P1 |
| Fichier | `GradesEvaluationsPage.tsx` 112–150, 159–166 |
| Scénario | Enseignant saisit T1 (Saisie ignore le filtre période) puis Par classe reste sur T3 |
| Impact | Empty-state ambre **après** P0-001/P0-002, perçu comme onglet mort |
| Preuve | Test existant : Validée T1 listée en Saisie si T3 actif. Effect qui ignore les updates de `defaultPeriod`. |
| Correctif | Ne pas partager le défaut file Préfet avec les vues agrégées ; ou figer la période sur celle des notes visibles. |

### NOTES-UI-P1-003 — Scope enseignant : JWT ignoré + pas de `subject_id`

| | |
| --- | --- |
| Priorité | P1 (sécurité / fuite inter-cours, famille #248/#249/#251) |
| Fichiers | `establishment.ts` `teacherScopedClassNames` 57–114 ; `routeDomainMap.ts` 32 ; `server.js` GET `/notes` 1557–1566 vs listSchoolEvaluations 1367–1388 |
| Scénario | Seke Math, même classe, note Français 12 |
| Impact | Après P0-001 : Par classe / Stats mélangent les matières. `GET /notes` envoie trop. |
| Preuve | JWT `assignments` lu pour la **saisie**, pas pour `scopedStudents`/`scopedGrades`. Vitest : `getSubjectAverage` Math et Français coexistent sans filtre. |
| Correctif | Restreindre ranking/stats aux `class_id`+`subject_id` JWT ; SQL GET `/notes` comme GET `/evaluations`. |
| Dépendance | #256 NOTES-EVAL-P1-010. |

### NOTES-UI-P1-004 — Moyenne de classe diluée par les 0 ; vue ≠ relevé par matière

| | |
| --- | --- |
| Priorité | P1 (bulletins) |
| Fichier | `gradeBook.ts` 141–193 ; `ClassGradesOverview.tsx` 48–55, 76–94 |
| Scénario | 1 note 14, N élèves |
| Impact | `classAverage = 14/N` ; pas de colonne Mathématiques ; pas de « 1 note » |
| Preuve | Lecture `getStudentAverageValue` → 0 si aucune note ; moyenne arithmétique du ranking. |
| Correctif | Exclure les élèves sans note comptée **ou** afficher un gradebook matière. Produit à trancher. |

### NOTES-UI-P2-001 — Statistiques = clone de Par classe

| | |
| --- | --- |
| Priorité | P2 |
| Fichier | `GradesEvaluationsPage.tsx` 688–720 |
| Scénario | Clic Statistiques après Par classe |
| Impact | « Aucun changement visible » même après correction du crash. |
| Correctif | Vue stats distincte (distribution, effectifs, par matière) ou retirer l’onglet dupliqué. |

### NOTES-UI-P2-002 — Domaine `courses` absent → coef = 1

| | |
| --- | --- |
| Priorité | P2 |
| Fichier | `routeDomainMap.ts` 32 ; `gradeBook.ts` 89–92 |
| Impact | Distorsion des moyennes multi-matières. Pas l’écran vide. |

### NOTES-UI-P2-003 — Tests : onglets mockés, pas de note PG

Voir §13. Lacune qui a laissé passer le P0.

### NOTES-UI-P2-004 — Export CSV ≠ écran ; `canExportGrades` mort

| | |
| --- | --- |
| Fichier | `GradesEvaluationsPage.tsx` 368–391, 488–490 ; `mapGrade` sans `studentName` |
| Preuve | `exportGrades` utilise `scopedGrades` + `!period \|\| grade.period === period`, **pas** `GradeBookService`. Admin `period=""` → CSV de **toutes** les notes. Écran crashé. Colonne Élève souvent vide. |
| Diagnostic | **écran vide + CSV potentiellement peuplé** = bug **calcul/rendu**, pas API vide. |

### NOTES-UI-P2-005 — Console / erreurs silencieuses

Pas de `catch {}` dans `ClassGradesOverview`. Le crash n’est **pas** avalé : il remonte à React. Pas d’ErrorBoundary dans `web/src`. Symptôme utilisateur = zone blanche, onglets encore cliquables.

---

## 16. Cause racine

**Cause racine prouvée (ROOT unique pour « onglets morts ») :**

```text
ROOT-P0 : web/src/lib/gradeBook.ts
          getStudentAverageValue() appelle getStudentAverage()
          qui demande le rang via getClassRanking()
          qui rappelle getStudentAverageValue()
          → récursion infinie dès qu’un élève de la classe existe
```

Ce n’est **pas** :

| Hypothèse | Verdict |
| --- | --- |
| ROOT-5 clés `class` vs `classe` / `stats` vs `statistics` | **Infirmé** |
| ROOT-2 `/notes` ne charge plus `notes`/`students` | **Infirmé** (domaines présents ; crash avec notes en state) |
| ROOT-4 filtre Validée-only + P0-001 `Saisie` | **Infirmé** (Saisie est incluse) |
| ROOT-3 `state.assignments` vide | **Non causal pour l’écran vide** ; P1 fuite après fix |
| ROOT-1 selectedClass nom vs notes `classId` | **Non causal pour l’écran vide** ; P1 identifiants |

**Réponse à la question CTO :**

> Les onglets reçoivent-ils un dataset vide **avant** le rendu, ou le rendu est-il mort ?

1. **Navigation UI : vivante.** Le bon composant est monté.
2. **Dataset API / `state.notes` : souvent non vide** (note 14 persistée, GET `/notes` projection large).
3. **Rendu : mort.** Crash compute **avant** tout tableau. Ce n’est pas un empty-state métier.
4. **Deuxième mur, déjà dans le code :** si on corrige seulement le crash, Préfet/Admin avec « Toutes les périodes » retombent sur `gradedCount = 0` (P0-002). Là, oui, **filtre UI qui vide un dataset présent**.
5. **Troisième mur :** `className` / JWT / période partagée (P1). Chantier identifiants, **pas** le P0 immédiat.

Donc le prochain correctif **n’est pas** un chantier API profond. C’est un P0 Web d’environ dix lignes sur `getStudentAverageValue`, plus le traitement de `period === ""`.

---

## 17. Correctif minimal recommandé

**Aucun de ces points n’est implémenté dans cette PR.**

### Lot A — P0 Web (débloque les onglets)

1. `web/src/lib/gradeBook.ts` : copier la séparation backend (`getStudentAverageValue` scalaire sans rang). Ne plus appeler `getStudentAverage` depuis `getClassRanking`.
2. Tests : **dé-mocker** `ClassGradesOverview` ; clic « Par classe » et « Statistiques » ; fixture Riziki 14 / 2ème A / T1 ; `expect` pas de `RangeError` ; au moins le nom + `14.00` au ranking.
3. `ClassGradesOverview` `gradedCount` : aligner `!period` sur `buildGradeBook` (toutes périodes). Test Admin défaut `""` + note T1 → pas le cartouche ambre.

C’est un correctif **UI/compute**. Pas de migration PG. Pas de changement de contrat GET `/notes`.

### Lot B — P1 (après A, sinon on « répare » un écran qui redevient faux)

4. Ne plus partager le défaut « Toutes les périodes / À valider » avec les vues agrégées ; éviter le verrou `queueDefaultsKey`.
5. Porter le sélecteur et le ranking sur `classId` ; roster = enrollments active.
6. Scope enseignant : `currentUser.assignments` / `assignedClassIds` + `subject_id`, comme la saisie. SQL GET `/notes` (reprise #256 P1-010).

### Lot C — P2 produit

7. Distinguer Statistiques ou supprimer le clone.
8. Trancher la moyenne de classe (exclure les non-notés vs bulletin complet).
9. Brancher `canExportGrades` ; projeter `studentName` sur `mapGrade` si l’export doit rester utile.

---

## 18. Verdict

```text
MODULE ONGLETS PAR CLASSE / STATISTIQUES = NO-GO
```

| | |
| --- | --- |
| Navigation | GO (onglets alignés, composant monté) |
| Dataset GET `/notes` | GO-ish (souvent peuplé ; trop large pour l’enseignant) |
| Render ranking / stats | **NO-GO P0** (récursion) |
| Préfet « Toutes les périodes » | **NO-GO P0** dès que le ranking rend |
| Identifiants classId | P1, pas le blocage actuel |
| P0-001 #256 (Validée → Saisie) | **ne vide pas** ces onglets |
| Prochain correctif | **Petit P0 Web**, pas un chantier API/UUID d’abord |
| Ready / merge cette PR | **Interdit** (audit documentaire) |

```text
P0 = 2   (P0-001 crash ; P0-002 period "")
P1 = 4   (className, période partagée, scope enseignant, dilution moyennes)
P2 = 5   (clone stats, courses, tests, export, pas d’ErrorBoundary)
```

Revalidation CTO GitHub indépendante obligatoire avant toute suite métier.

---

## Annexe — Export vs écran

```text
Imprimer     = PrintButton (DOM). DOM crashé / vide → impression vide.
Exporter CSV = scopedGrades, ignore ClassGradesOverview / gradeBook.
               period ""  → toutes les notes du roster.
               period T3  → filtre strict === (pas normalize).
```

Si préprod montre un CSV avec des lignes et un écran blanc : **confirme P0-001** (data vs render), pas une API vide.
