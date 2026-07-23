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

**Recommandation D3.6a :** verrouiller le périmètre et les arbitrages §10 **avant** tout commit métier (D3.6b).  
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
| **D3.6a — Audit / verrouillage** | ✅ Ce lot (docs) | Gate avant tout code |
| **Décisions produit §11** | 🔒 Gate CTO | Contrat note, granularité, source, calculs, interfaces |
| **D3.6b — Contrat Notes + persistance canonique** | 🔒 | Seulement après §11 |
| **D3.6c — Migration des écrans Notes** | 🔒 | Après D3.6b stable |
| **Onglet Résultats fiche Élève** | 🔒 | Hors D3.6b |
| **Chrome DS / ToolLayout Notes** | 🔒 | Après stabilisation métier (pas D3.6b) |
| **Bulletins (D3.7)** | 🔒 | Aucun chantier sous D3.6 |
| **Examens EntityPage / redesign** | 🔒 | Hors D3.6 |
| **D3.5c / ToolLayout Présences** | 🔒 | Verrou D3.5 inchangé |
| **Réouverture EntityPage** | 🔒 | Clos (`d2.8e`) |
| **D3.1–D3.5** | 🔒 | Clos — ne pas rouvrir |

---

## 11. Questions produit à trancher (gate avant code)

Sans réponses → **aucun lot D3.6b / migration UI / refactor API ouvert**.

### 11.1 Contrat de la note

1. La note canonique est-elle toujours liée à une **évaluation** (`evaluationId` obligatoire) ?  
2. Champs figés : `value`, `scale` (barème), `evaluationCoefficient`, `gradeStatus` — lesquels sont obligatoires à la saisie ?  
3. Conservons-nous l’enum `EvaluationType` NE-* (6 valeurs) pour D3.6b, ou la config établissement prime-t-elle ?  
4. Conservons-nous l’enum `GradeStatus` actuel (8 valeurs), ou simplifions-nous (ex. présent / absent justifié / dispensé) ?  
5. Signification de **Non justifiée = 0** dans les moyennes : confirmée ou revue ?

### 11.2 Granularité

6. Granularité d’écriture : **évaluation** (session) → notes élèves ?  
7. Agrégats : matière × période × élève ; période = trimestre/semestre via config ?  
8. `terms` PG vs libellés `period` JSON : quelle source canonique de période ?  
9. Année académique : obligatoire sur évaluation / note dès D3.6b ?

### 11.3 Source canonique

10. Persistance canonique : **une seule table de notes** (PG `grades` étendue / normalisée) ?  
11. Où vivent les **évaluations** (sessions) : nouvelle table PG vs rester JSON temporairement ?  
12. JSON BO `notes` / `evaluations` : autorité durable **interdite** (alignement D3.5b) ?  
13. Clé d’unicité cible : `établissement + élève + évaluation` (ou équivalent UUID) ?  
14. Comportement : upsert idempotent web = mobile = API ?

### 11.4 Règles de calcul

15. Quelle implémentation devient **la** référence (web `gradeBook.ts` ?) — les autres doivent s’aligner ou disparaître ?  
16. Pondérations : coef évaluation × coef matière — confirmées ?  
17. Arrondis : affichage 2 décimales ; stockage / bulletin 1 décimale ; règle d’arrondi métier ?  
18. Seuil de réussite classe = 10/20 — figé ?  
19. Classements / stats : calculés à la volée (pas de table) dans D3.6 ?

### 11.5 Interfaces

20. Surface web canonique = `/notes` (`GradesEvaluationsPage`) ?  
21. Mobile enseignant = saisie terrain (même contrat API) ; parent/élève = lecture publiée ?  
22. Onglet Résultats fiche Élève : 🔒 hors D3.6b ?  
23. Droits validate/publish : rester sur heuristique rôle ou basculer sur permissions feature explicites ?

### 11.6 Interfaces futures (scope in / out)

| Inclure dans D3.6b (recommandation audit) | Exclure de D3.6b |
|-------------------------------------------|------------------|
| Contrat note / évaluation / statuts | Écrans Bulletins / EntityPage bulletins |
| Persistance canonique PG + unicité | Redesign PDF / Grapes / conception bulletins |
| Alignement règles de calcul (une référence) | Classements persistés / stats avancées produit |
| Alignement API web / mobile | Onglet fiche Élève « Résultats » |
| Tests contrat / upsert / publication filter | Migration ToolLayout Notes |
| Points d’extension documentés pour D3.7 | D3.5c / ToolLayout Présences / Examens redesign |

24. Les Notes doivent-elles **continuer** à pousser un agrégat bulletin à la publication (comportement actuel), ou ce feed est-il gelé jusqu’à D3.7 ?  
25. D3.7 Bulletins consomme le contrat Notes sans modifier les tables Notes — confirmé ?

### 11.7 Recommandations audit (propositions — non validées)

> Ces propositions accélèrent le gate ; elles **ne remplacent pas** la validation CTO.

| # | Sujet | Proposition |
|---|-------|-------------|
| R1 | Surface | `/notes` + mobile TeacherGrades (même API) ; lecture parent/élève ; fiche Élève 🔒 |
| R2 | Contrat note | Note toujours rattachée à une évaluation ; `value` + `scale` + `evaluationCoefficient` + `gradeStatus` |
| R3 | Types | Conserver enums NE-* D3.6b ; config établissement en lecture |
| R4 | Granularité | Évaluation → notes ; agrégats matière/période calculés |
| R5 | Période | Libellé aligné sur `terms` / config ; pas de période orpheline |
| R6 | Persistance | PG canonique ; JSON BO non autorité durable ; UNIQUE élève×évaluation (+ school) |
| R7 | Calcul | Web `gradeBook.ts` = référence ; backend/mobile s’alignent en D3.6b |
| R8 | Arrondi | Affichage 2 déc. ; contrat stockage à figer (proposer 2 déc. numériques, projection bulletin 1 déc. en D3.7) |
| R9 | D3.6b in | Contrat + persistance + alignement calcul/API/tests |
| R10 | D3.6b out | ToolLayout · fiche Élève · Bulletins UI · Examens redesign · Présences |
| R11 | Bulletins | Garder sync minimale non régressive **ou** la geler explicitement jusqu’à D3.7 (choix CTO) |
| R12 | Séquence | D3.6b → D3.6c (écrans) → D3.7 Bulletins |

---

## 12. Risques si on force une implémentation maintenant

1. Migrer ToolLayout sans figer le contrat note → refonte UI puis refonte modèle.  
2. Ouvrir Bulletins (D3.7) en parallèle → dépendances circulaires Notes ↔ Bulletins.  
3. Unifier PG/JSON sans UNIQUE → perte ou doublons silencieux.  
4. Laisser trois GradeBook divergents → moyennes différentes selon surface.  
5. Réouvrir Présences / EntityPage sous bannière Notes → dette transversale.  
6. « Activer » l’onglet Résultats fiche Élève sans contrat → écran creux.  
7. Traiter `exam_results` comme seconde source de notes → double autorité.

---

## 13. Livrable D3.6a et merge gate

**Inclus :** ce document, rapport D3.6a, mise à jour suivi / README.  
**Exclus :** tout fichier sous `web/src/**`, `backend/**`, `Mobile/**`, scripts runtime.

| Gate | Attente |
|------|---------|
| Draft PR | Oui |
| Revue CTO | Diff docs + verrou §10–11 |
| CI / Security | Verts (docs-only) |
| UX / API / métier runtime | Aucun changement |

**Suite après validation CTO :** intégrer les arbitrages §11 (section Décisions CTO), tag `d3.6a`, **puis seulement** ouvrir **D3.6b — Contrat Notes + persistance canonique**, sans ToolLayout, sans Bulletins, sans D3.5c.
