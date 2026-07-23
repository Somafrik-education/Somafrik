# Audit — D3.6 Notes (métier)

**Lot :** D3.6a — Audit et verrouillage du périmètre  
**Statut :** descriptif — **aucun changement de code applicatif**  
**Module :** Notes / Évaluations (`/notes` + mobile saisie / lecture)  
**Date :** 2026-07-23  
**Base de revue :** `develop` @ `b533652c` (tag `d3.5b`)  
**Référence DS :** Design System Somafrik (`@/design-system`) · Pattern P-007 (Outil)  
**Prérequis clos :** D2.8 (EntityPage) · D3.1 / D3.1b (Élèves) · D3.2 (Classes) · D3.3 (Enseignants) · D3.4a/b (Parents identité) · D3.5a/b (Présences contrat + PG)

**Numérotation :** prochain domaine métier = **D3.6 — Notes**.  
**D3.5** reste Présences (clos `d3.5b`). **Bulletins** restent **D3.7** — hors D3.6a.

**Hors périmètre explicite :** D3.5c · ToolLayout Présences · Bulletins (écrans, PDF, publication) · Examens EntityPage · Finance · onglet Résultats fiche Élève · migration UI `web/src/**` · modifications `backend/**` / `Mobile/**`

---

## 1. Synthèse exécutive

| Constat | Détail (post-`d3.5b`) |
|---------|------------------------|
| **Surface web d’outil** | `GradesEvaluationsPage` @ `/notes` — outil legacy (~573 LOC), 5 onglets |
| **Surface mobile écriture** | `TeacherGradesScreen` (~513 LOC) → `POST /api/notes` |
| **Lecture parent / élève** | Mobile `StudentNotesScreen` + `GET /api/notes` / `GET /api/students/:id/notes` |
| **Fiche élève web (onglet Résultats)** | Module catalogué (`grades`) mais **non navigable / non implémenté** |
| **Design System** | 🔒 0 % — `ToolLayout` (P-007) **non consommé** |
| **Modèle riche UI** | `Evaluation` + `StudentGrade` (types NE-*) dans `web/src/types.ts` |
| **Persistance** | Dual path : PG `grades` **et** JSON BackOffice `notes` / `evaluations` / `bulletins` |
| **API REST dédiée** | Notes oui (`/api/notes`) · **pas** de `/api/evaluations` ni `/api/bulletins` métier |
| **Calculs** | Triple `GradeBookService` (web / backend / mobile) **non alignés** |
| **Bulletins** | Sync opportuniste depuis publication d’évaluation + EntityPage `/bulletins` — **D3.7** |
| **Exigences non couvertes** | `grade_sessions` (SOM-DATA-002), unicité PG note×élève×évaluation, table `evaluations` |

**Recommandation D3.6a :** verrouiller le périmètre et les arbitrages §11 **avant** tout commit métier (D3.6b).  
Ne pas migrer le chrome DS tant que le **contrat de note** (valeur, barème, coefficient, type, granularité, source canonique, règles de calcul) n’est pas figé.  
Ne pas ouvrir Bulletins (D3.7) sous bannière Notes.  
Ne pas réouvrir Présences (pas de D3.5c, pas de ToolLayout Présences).

---

## 2. Routes concernées

| Route / nav | Guard | Composant | Nature | Périmètre D3.6 |
|-------------|-------|-----------|--------|----------------|
| `/notes` | `view="notes"` → feature **Notes** | `GradesEvaluationsPage` | Outil évaluations + saisie | **Cœur — surface admin/enseignant** |
| Nav « Notes & évaluations » | `constants.NAV_ITEMS` | → `/notes` | Entrée latérale pédagogie | Navigation |
| `/examens` | `view="exams"` | `EntityPage entity="exams"` | Sessions examens | **Adjacent** — consommation / lien `linkedExamId` ; pas migration D3.6 |
| `/bulletins` | `view="bulletins"` | `EntityPage entity="bulletins"` | Liste bulletins | **Hors — D3.7** |
| `/parametres/documents` | `bulletinDesign` | `BulletinDesignPage` | Templates Super Admin | **Hors — D3.7** |
| `/conception-bulletins` | — | Redirect → documents | Legacy | Hors |
| Mobile stack `TeacherGrades` | Feature Notes | `TeacherGradesScreen` | Saisie terrain | **Cœur mobile écriture** |
| Mobile `StudentNotes` | Lecture Notes | `StudentNotesScreen` | Notes enfant / élève | **Lecture** |
| Mobile `ReportCards` | Feature Bulletins | `ReportCardsScreen` | Bulletins | **Hors — D3.7** |
| `GET/POST /api/notes` | Auth + droits | `backend/server.js` | API notes | Contrat API |
| `GET /api/students/:id/notes` | Auth scoped | idem | Historique élève | Contrat API |
| `GET /api/students/:id/report(.pdf)` | Auth | GradeBook + PDF | Rapport | **Consommation** — règles D3.6 ; UI bulletins D3.7 |
| `PUT /api/backoffice/state` | Writer | État JSON | Évaluations + notes web | Contrat persistance |
| `/etablissement/eleves/:id` section `grades` | — | **Inexistant** (slug non branché) | — | **🔒 décision produit** |
| Notes EntityPage module | `entityModules.notes` | Orphelin (route = page dédiée) | Métadonnées résiduelles | Dette — ne pas réactiver |

Fichiers nav : `web/src/App.tsx`, `web/src/lib/constants.ts`, `Mobile/src/navigation/AppNavigator.tsx`, `roleTabPreferences.ts`.

---

## 3. Inventaire pages et composants

### 3.1 Surfaces Notes / lecture

| Fichier | LOC (approx.) | Rôle | DS |
|---------|---------------|------|----|
| `web/src/pages/GradesEvaluationsPage.tsx` | ~573 | Outil web (évaluations, saisie, classe, élève, stats) | Legacy `components/ui` |
| `web/src/components/grades/EvaluationFormModal.tsx` | ~193 | Création / édition évaluation | Legacy |
| `web/src/components/grades/GradeEntryGrid.tsx` | ~198 | Grille saisie notes | Legacy |
| `web/src/components/grades/ClassGradesOverview.tsx` | ~117 | Classement + KPI classe | Legacy |
| `web/src/components/grades/StudentGradesPanel.tsx` | ~115 | Détail notes élève | Legacy |
| `web/src/lib/evaluations.ts` | ~740 | Lifecycle + pont legacy ↔ typé + sync bulletins | Domaine web |
| `web/src/lib/gradeBook.ts` | ~194 | Moyennes / rangs / stats (web) | Domaine web |
| `web/src/lib/gradePermissions.ts` | ~43 | Droits métier Notes | Domaine web |
| `Mobile/src/screens/TeacherGradesScreen.tsx` | ~513 | Saisie notes terrain | Legacy RN |
| `Mobile/src/screens/StudentNotesScreen.tsx` | ~135 | Lecture notes | Legacy RN |
| `web/src/design-system/layout/ToolLayout.tsx` | — | Cible P-007 | **Non utilisé** par Notes |

### 3.2 Surfaces adjacentes (hors migration D3.6)

| Fichier | Rôle | Périmètre |
|---------|------|-----------|
| `web/src/pages/EntityPage.tsx` (`exams` / `bulletins`) | CRUD générique | Examens adjacent · Bulletins **D3.7** |
| `web/src/pages/BulletinDesignPage.tsx` | Templates | **D3.7** |
| `web/src/lib/bulletinDesign.ts` / `bulletinGrapesTemplate.ts` | Design | **D3.7** |
| `Mobile/src/screens/ReportCardsScreen.tsx` | Bulletins mobile | **D3.7** |

### 3.3 Domaine / backend

| Fichier | Rôle |
|---------|------|
| `backend/db/schema.sql` (`grades`, `terms`, `subjects`, `exams`, `exam_results`) | Persistance PG partielle |
| `backend/db/postgresRepository.js` | `upsertGrade` / `mapGrade` / merge BO |
| `backend/lib/dataIntegrityRules.js` | `validateNoteWrite`, doublons `studentId\|evaluationId` |
| `backend/lib/noteConcurrency.js` | Verrou optimiste `version` (chemin JSON seulement) |
| `backend/server.js` | Routes notes + fallback `saveNotesViaBackOfficeState` |
| `backend/services/gradeBookService.js` | Moyennes / rapport (backend, règles plus simples) |
| `Mobile/src/domain/academics/GradeBookService.ts` | Variante mobile (types évaluation divergents) |
| `Mobile/src/models/Note.ts` + `data/notes.ts` | **Stale** (démo) vs `catalog.NoteItem` |
| `web/src/lib/entityModules.ts` (bloc `notes`) | Métadonnées entité (route dédiée ≠ EntityPage) |

### 3.4 Onglets `GradesEvaluationsPage`

| Tab | Label | Responsabilité |
|-----|-------|----------------|
| `evaluations` | Évaluations | CRUD évaluations ; valider / publier / désactiver |
| `saisie` | Saisie des notes | `GradeEntryGrid` + correction note validée |
| `classe` | Par classe | `ClassGradesOverview` (classement + KPI) |
| `eleve` | Par élève | `StudentGradesPanel` |
| `stats` | Statistiques | **Quasi-doublon** de `classe` (même composant) |

### 3.5 Absents / non livrés (confirmés)

- Onglet Résultats fiche Élève web (catalogué, non branché)
- Table PG `evaluations` / `grade_sessions` (exigence SOM-DATA-002)
- Contrainte UNIQUE note (élève × évaluation) en PG
- API REST `/api/evaluations`, `/api/grades`, `/api/bulletins`
- Alignement des trois `GradeBookService`
- Tests unitaires dédiés `gradeBook` / `evaluations` (hors E2E scripts)
- Consommation `ToolLayout`

---

## 4. Cartographie API

| Méthode | Path | Comportement |
|---------|------|--------------|
| `GET` | `/api/notes` | Scope locataire / enfants ; filtre parent-élève → évaluations **Publiée** |
| `POST` | `/api/notes` | Droit `write_notes` + `assertCanManageNotes` ; tente `upsertGrade` PG puis **fallback JSON BO** |
| `GET` | `/api/students/:id/notes` | Historique élève autorisé + même filtre publication |
| `GET` | `/api/students/:id/report` | `GradeBookService.generateReport` |
| `GET` | `/api/students/:id/report.pdf` | Rapport + design bulletin + PDF |
| `PUT` | `/api/backoffice/state` | Chemin **principal web** pour `evaluations` + `notes` (+ `bulletins`) |
| `GET` | `/api/v2/exams` | Lecture examens relationnels |
| `GET/POST/DELETE` | `/api/v2/subjects` | Matières (FK grades) |
| `GET` | `/api/academic-config` | Périodes, types d’évaluation, barème défaut |

**Pas** de `PUT`/`PATCH`/`DELETE` unitaire notes REST — upsert / merge état.  
**Pas** d’API REST évaluations / bulletins métier.

### 4.1 Droits

| Fonction / garde | Règle |
|------------------|--------|
| Feature CRUD Notes | `Notes:READ/CREATE/UPDATE` |
| `assertCanManageNotes` | `Modifier notes` / `Notes:CREATE` / `Notes:UPDATE` / privileges ALL/COUNTRY |
| `canValidateGrades` / publish / correct | Heuristique **rôle** (préfet, proviseur, directeur, admin) — **pas** la feature Notes |
| Parent / Élève lecture | Uniquement notes liées à évaluation `status === "Publiée"` |
| Conception bulletins | Super Admin only |

---

## 5. Modèle de données actuel

### 5.1 Domaine typé web (NE-*)

**`Evaluation`** — session d’évaluation pédagogique :

| Champ | Notes |
|-------|--------|
| `id`, `schoolCode` | Identité |
| `className`, `subject` | Couplage string (pas d’UUID classe/matière) |
| `teacherId` / `teacherName` | Enseignant |
| `period` | Libellé période (ex. « Trimestre 1 ») |
| `evaluationType` | Devoir · Interrogation · Composition · Examen · Rattrapage · Contrôle continu |
| `title`, `date` | Libellé / date |
| `scale` | Barème (défaut 20) |
| `coefficient` | Coefficient de l’évaluation |
| `status` | Brouillon → Ouverte → Saisie terminée → Validée → Publiée · Annulée |
| `active`, `linkedExamId`, `history` | Soft-delete / lien examen / audit |

**`StudentGrade`** — note élève liée à une évaluation :

| Champ | Notes |
|-------|--------|
| `studentId`, `evaluationId` | Clé fonctionnelle métier (intégrité JSON) |
| `value?`, `scale` | Valeur + barème |
| `evaluationCoefficient` / `coefficient` | **Double sens** — coef évaluation vs coef matière |
| `gradeStatus` | Saisie · Absente · Justifiée · Non justifiée · Dispensée · Validée · Corrigée · En attente |
| `audit` | Historique modifications (NE-SEC-002) |

### 5.2 Persistance Postgres `grades`

Colonnes : `id`, `school_id`, `student_id`, `class_id`, `subject_id`, `teacher_id`, `term_id`, `grade_type`, `score`, `max_score`, `coefficient`, `comment`, `publication_status`, `locked`, timestamps.  
Index : `student_id`, `school_id`.  
**Pas** de contrainte UNIQUE métier.  
`publication_status` / `locked` **non mappés** correctement dans le flux API courant.  
`mapGrade` pose `evaluationId = grade.id` (UUID grade ≠ id évaluation JSON) → filtre parent « Publiée » cassé pour notes PG-only.

### 5.3 Persistance JSON BackOffice

| Collection | Contenu |
|------------|---------|
| `notes` | Lignes legacy (pont `legacyNotesToGrades` / `gradesToLegacyNotes`) |
| `evaluations` | Sessions typées — **pas de table PG** |
| `bulletins` | Agrégats non typés (`unknown[]`) — **D3.7** |
| `academicConfigs[school].periods` | Périodes UI (parallèle à PG `terms`) |

### 5.4 Périodes

| Source | Usage |
|--------|--------|
| PG `terms` (+ `academic_years`) | FK `grades.term_id` ; auto-création possible à l’upsert |
| Config académique JSON | Libellés UI ; `resolveGradesPeriod` (période la plus peuplée → active → « Trimestre 1 ») |
| Fallback dur | `"Trimestre 1"` (web + mobile lecture) |

### 5.5 Écarts vs exigences

| Attendu produit / SOM-* | État code |
|-------------------------|-----------|
| `grade_sessions` / sessions de notes (SOM-DATA-002, SOM-MOB-010) | Modèle `Evaluation` JSON seulement |
| Table `grades` unique autorité | Dual PG + JSON |
| Audit modification note (SOM-SEC-005) | Audit JSON / history ; PG partiel |
| Types d’évaluation configurables établissement | Config + enum NE-* + mobile divergent |
| Bulletins simples / PDF | Présents mais **hors D3.6** (D3.7) |

---

## 6. Analyse des calculs

### 6.1 Algorithme web (`web/src/lib/gradeBook.ts`) — référence UI actuelle

1. **Normalisation /20** : `(value / scale) * 20` si `scale ≠ 20`.
2. **Moyenne matière** : Σ (note_normée × `evaluationCoefficient`) / Σ coefs évaluation.
3. **Moyenne générale** : Σ (moy_matière × `course.coefficient`) / Σ coefs matière.
4. **Exclusions** : Absente, Justifiée, Dispensée, En attente **hors** moyenne ; **Non justifiée = 0**.
5. **Rang** : dense (égalité → même rang).
6. **Appréciation auto** : ≥16 Excellent · ≥14 TB · ≥12 Bien · ≥10 AB · sinon Insuffisant.
7. **Réussite classe** : moyenne ≥ 10 ; `successRate` = `Math.round(...)`.

### 6.2 Arrondis

| Contexte | Règle |
|----------|--------|
| Calcul interne | Aucun arrondi (flottant JS) |
| Affichage UI | `toFixed(2)` |
| Sync bulletin | `toFixed(1)` stocké en **string** |
| Taux réussite | `Math.round` % |

**Aucune** règle métier documentée « arrondi 0,5 / 0,01 » — à trancher au gate.

### 6.3 Sync bulletins (couplage actuel)

`publishEvaluation` → `syncBulletinsForClass` → upsert bulletins classe/période, status `"En validation"`, appreciation auto.  
Édition évaluation bloquée si bulletin **publié** même période (`evaluationHasBulletinUsage`).

→ Les Notes **alimentent déjà** les Bulletins ; D3.6 doit figer le contrat de note **sans** refondre les écrans Bulletins (D3.7).

### 6.4 Incohérences multi-couches

| Point | Web `gradeBook.ts` | Backend `gradeBookService.js` | Mobile |
|-------|--------------------|-------------------------------|--------|
| Filtre période | Oui | **Non** | Souvent fixe / partiel |
| Exclusion statuts absence | Oui | **Non** | Modèle statut différent |
| Types évaluation | 6 NE-* | N/A | Set différent (TP, Projet…) |
| Arrondi bulletin | 1 décimale | generateReport sans même toFixed | — |

---

## 7. Doublons et risques d’intégrité

1. **Double persistance durable** — PG `grades` **et** JSON BO `notes` (contrairement à D3.5b où le JSON n’est plus autorité).  
2. **Deux chemins d’écriture** — web `PUT` état BO vs mobile `POST /api/notes` (PG puis fallback).  
3. **Triple GradeBookService** — moyennes / exclusions / périodes divergentes.  
4. **Pas d’UNIQUE PG** — intégrité JSON `studentId|evaluationId` non appliquée en PG.  
5. **`evaluationId` PG cassé** — `mapGrade` → filtre publication parent/élève incorrect.  
6. **Locks asymétriques** — `POST /api/notes` avec `enforceLockedEvaluation: false` vs BO JSON enforce.  
7. **Coefficients ambigus** — matière vs évaluation mappés sur les mêmes champs.  
8. **Onglets classe ≈ stats** — doublon UI.  
9. **Module EntityPage `notes` orphelin** vs page dédiée.  
10. **Mobile démo stale** — `models/Note.ts` / `data/notes.ts`.  
11. **Validate/Publish hors matrice feature** — droits par heuristique de rôle.  
12. **Examens ↔ notes** — `exams` / `exam_results` PG + BO `exams` + `linkedExamId` sans contrat unique.

---

## 8. Dépendances transversales

| Module | Couplage | Décision D3.6a |
|--------|----------|----------------|
| **Élèves** | Id API, blocage archivés, historique notes | Consommation — ne pas migrer fiche ; onglet Résultats 🔒 |
| **Classes** | Appel / saisie par `className` ; classements | Consommation D3.2 stable |
| **Enseignants** | Scope affectations ; `teacher_id` / access évaluation | Consommation D3.3 |
| **Parents** | Lecture notes publiées (D3.4b identité) | Lecture seule |
| **Présences** | Aucun feed attendance → notes aujourd’hui | **Hors** — D3.5 clos ; pas de D3.5c |
| **Matières / Courses** | Coefficients matière pour moyenne générale | Consommation config |
| **Périodes / Année** | `terms` PG + config JSON | À figer dans le contrat |
| **Examens** | Lien optionnel `linkedExamId` / EntityPage | Adjacent — pas migration sous D3.6 |
| **Bulletins** | Sync à la publication ; EntityPage ; PDF | **D3.7** — interfaces futures seulement |
| **Abonnements** | Feature `write_notes` | Conserver |

---

## 9. Design System

| Surface | État |
|---------|------|
| Outil web Notes | Legacy — `ToolLayout` **hors D3.6b** (chrome séparé après métier) |
| Mobile saisie / lecture | Legacy RN — même contrat API cible que le web |
| SUIVI consolidé | D3.6a gate CTO · DS chrome 🔒 |
| Migration chrome DS | **Interdite** dans D3.6b |
| ToolLayout Présences | **Interdit** (verrou D3.5 inchangé) |

---

## 10. Sous-lots D3.6 — verrouillage

| Sous-lot | Statut | Justification |
|----------|--------|---------------|
| **D3.6a — Audit / verrouillage** | ✅ Ce lot (docs) | Gate §11 levé |
| **D3.6b — Contrat Notes + persistance canonique** | 🔓 Prochain lot autorisé | PG évaluations + notes · UNIQUE · calcul · migration — **pas** chrome |
| **D3.6c — Migration des écrans Notes** | 🔒 | Après D3.6b stable · éventuel ToolLayout |
| **Onglet Résultats fiche Élève** | 🔒 | Hors D3.6b |
| **Chrome DS / ToolLayout Notes** | 🔒 | D3.6c seulement |
| **Bulletins (D3.7)** | 🔒 | Aucun chantier sous D3.6 |
| **Examens EntityPage / redesign** | 🔒 | Hors D3.6 |
| **D3.5c / ToolLayout Présences** | 🔒 | Verrou D3.5 inchangé |
| **Réouverture EntityPage** | 🔒 | Clos (`d2.8e`) |
| **D3.1–D3.5** | 🔒 | Clos — ne pas rouvrir |

---

## 11. Décisions CTO — arbitrages du gate

**Statut :** validé CTO · 2026-07-23 · gate §11 levé  
**Numérotation validée :** D3.6 = Notes · Bulletins = D3.7 · Présences / EntityPage non rouverts

### 11.1 Contrat canonique d’une évaluation

**Décision :** une évaluation est une **entité métier distincte** de la note.

**Contrat cible minimal :**

| Champ | Rôle |
|-------|------|
| `evaluation.id` | Identité |
| `school_id` | Établissement |
| `class_id` | Classe |
| `subject_id` | Matière |
| `teacher_id` | Enseignant |
| `term_id` | Période (année scolaire → période) |
| `title` | Libellé |
| `type` | Type d’évaluation |
| `evaluation_date` | Date |
| `max_score` | Barème |
| `coefficient` | Coefficient de l’évaluation |
| `status` | Cycle de vie |

**Statuts recommandés :**

| Statut | Interprétation |
|--------|----------------|
| `draft` | Préparation |
| `open` | Saisie autorisée |
| `locked` | Saisie fermée, corrections contrôlées |
| `published` | Visible par élèves et parents |
| `archived` | Conservée, hors activité courante |

La **publication** rend les résultats visibles — elle **n’est pas** la création d’un bulletin.

### 11.2 Contrat canonique d’une note

**Décision :** une note = résultat d’un élève pour **une** évaluation.

**Contrat cible minimal :**

| Champ | Rôle |
|-------|------|
| `grade.id` | Identité |
| `school_id` | Établissement |
| `evaluation_id` | Évaluation parente (obligatoire) |
| `student_id` | Élève |
| `score` | Valeur numérique ou `null` selon statut |
| `status` | Statut de saisie |
| `comment` | Commentaire |
| `version` | Concurrence optimiste |
| `created_by` / `updated_by` | Audit acteurs |
| `created_at` / `updated_at` | Audit temps |

Le **barème** (`max_score`) et le **coefficient** appartiennent à l’**évaluation**, pas à chaque note.

**Clé d’unicité cible :**

```sql
UNIQUE (school_id, evaluation_id, student_id)
```

Une note **ne doit pas** être identifiée seulement par élève + matière + période (plusieurs évaluations possibles).

### 11.3 Valeur et statuts de saisie

**Décision :** ne pas représenter tous les cas par une seule valeur numérique nullable.

| Statut | Score | Rôle |
|--------|-------|------|
| `graded` | obligatoire | Note chiffrée |
| `absent` | `null` | Absence |
| `excused` | `null` | Absence justifiée |
| `not_submitted` | `null` | Non rendu (≠ absent) |
| `exempt` | `null` | Dispense |

**Règles :**

- `graded` exige un `score`
- les autres statuts exigent `score = null`
- `0 <= score <= max_score` (barème de l’évaluation)
- un élève absent **ne reçoit pas** implicitement zéro
- une absence justifiée **n’entre pas** dans la moyenne comme zéro
- `not_submitted` reste distinct de `absent`

Remplacement, rattrapage ou zéro disciplinaire : **hors D3.6b**, sauf nécessité déjà présente dans le runtime.

### 11.4 Granularité

**Décision :** granularité canonique =

```
une évaluation × un élève = une note
```

Une évaluation appartient à : établissement → année scolaire → période → classe → matière.

**Ne pas** introduire `grade_sessions` dans D3.6b sans besoin produit validé.  
Le modèle `evaluation` + `grades` suffit pour le premier contrat canonique.

### 11.5 PostgreSQL comme source d’autorité

**Décision :** **PostgreSQL** = source canonique.

Les collections JSON `evaluations` / `notes` deviennent des formats **transitoires** (compatibilité / moteur mémoire) — **pas** une seconde persistance durable.

PostgreSQL doit porter : évaluations · notes · relations · statuts · unicité · version de concurrence.

D3.6b ne doit **pas** se limiter à ajouter une contrainte sur `grades` : les évaluations ne doivent plus vivre durablement uniquement dans le JSON.

### 11.6 Migration legacy

**Décision :** concevoir la migration **avant** la contrainte unique.

**Ordre recommandé :**

1. Schéma non bloquant  
2. Inventaire évaluations / notes legacy  
3. Création ou résolution des `evaluation_id`  
4. Détection des doublons  
5. Déduplication déterministe  
6. Vérification  
7. Contrainte `UNIQUE`  
8. Bascule des écritures  

**Priorité de conservation des doublons (exemple) :**

```
version DESC → updated_at DESC → created_at DESC → id DESC
```

Les notes impossibles à rattacher à une évaluation : **anomalies de migration** remontées — **pas** de fusion silencieuse.

### 11.7 Règles de calcul

**Décision :** **une** règle partagée web / backend / mobile.

Pour une évaluation : `normalized_score = score / max_score`  

Moyenne pondérée :

```
sum(normalized_score × coefficient) / sum(coefficients éligibles)
```

puis conversion vers l’échelle d’affichage (typiquement /20).

**Exclusions de la moyenne :** `absent` · `excused` · `not_submitted` · `exempt` (sauf règle produit future explicite).

| Règle | Décision |
|-------|----------|
| Arrondi | Uniquement à l’affichage |
| Calcul interne | Précision complète |
| Coefficient / barème | Strictement positifs |
| Classement | Pas de classement sur échantillon incomplet sans signalement |
| Implémentation normative | **Une seule** côté domaine / backend |
| Web / mobile | Adaptateurs / consommateurs — **pas** trois moteurs indépendants |

### 11.8 Interfaces

| Surface | Responsabilité |
|---------|----------------|
| **`/notes` web** | Gestion des évaluations, saisie, verrouillage et publication |
| **Mobile enseignant** | Saisie terrain sur évaluations `open` |
| **Mobile élève / parent** | Lecture des seules évaluations `published` |
| **Fiche Élève « Résultats »** | 🔒 Hors D3.6b |
| **ToolLayout Notes** | D3.6c |
| **Bulletins** | D3.7 |

**Surface canonique :** `/notes`.

### 11.9 Bulletins et publication

**Décision :** D3.6 expose des données stables pour D3.7, mais **ne crée / ne synchronise pas** de bulletins comme effet secondaire métier durable.

```
publication d’une évaluation
  → rend les notes visibles
  → émet éventuellement un événement métier
  → ne fabrique pas automatiquement le bulletin canonique
```

Génération, agrégation, PDF et publication des bulletins = **D3.7**.

La sync opportuniste actuelle (`syncBulletinsForClass`) : **inventorier puis isoler** — pas forcément suppression brutale au premier commit D3.6b si risque de régression.

### 11.10 Périmètre D3.6b / D3.6c

**Nom D3.6b :** Contrat Notes et persistance canonique

| Inclure dans D3.6b | Exclure de D3.6b |
|--------------------|------------------|
| Table / modèle PG des évaluations | Refonte `GradesEvaluationsPage` |
| Contrat PG des notes | ToolLayout |
| `UNIQUE (school_id, evaluation_id, student_id)` | Onglet Résultats fiche Élève |
| Statuts évaluation / note | Classement avancé |
| Validation score / barème | Génération ou design des bulletins |
| Migration legacy déterministe | D3.7 |
| Concurrence / `version` | |
| Moteur de calcul canonique | |
| Fallback JSON limité au moteur mémoire | |
| Tests unitaires et migration | |

**D3.6c** (après clôture D3.6b seulement) : alignement web/mobile · suppression duplications UI/domaine · éventuel ToolLayout · simplification des cinq onglets · suppression du quasi-doublon classe / stats.

---

## 12. Risques résiduels (post-décisions)

1. Laisser le JSON BO comme autorité parallèle → divergence (interdit durable).  
2. Ajouter seulement UNIQUE sur `grades` sans table évaluations PG → contrat incomplet.  
3. Fusionner silencieusement les notes sans `evaluation_id` → perte de données.  
4. Conserver trois GradeBook indépendants → moyennes divergentes (interdit).  
5. Resynchroniser des bulletins à la publication comme effet durable → empiète sur D3.7.  
6. Migrer ToolLayout / ouvrir fiche Élève avant D3.6b → refonte UI prématurée.  
7. Réouvrir Présences / EntityPage sous bannière Notes → dette transversale (interdit).

---

## 13. Livrable D3.6a et merge gate

**Inclus :** ce document (décisions CTO §11), rapport D3.6a, mise à jour suivi / README.  
**Exclus :** tout fichier sous `web/src/**`, `backend/**`, `Mobile/**`, scripts runtime.

| Gate | Attente |
|------|---------|
| Décisions CTO §11 | ✅ Levées (ce document) |
| CI / Security | Verts (docs-only) |
| Undraft → merge | Après checks verts |
| Tag | `d3.6a` après merge sur `develop` |
| Suite | Ouvrir **D3.6b** en draft (contrat + persistance — pas chrome DS, pas Bulletins) |
