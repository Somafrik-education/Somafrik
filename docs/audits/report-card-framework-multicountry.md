# AUDIT CTO — Framework bulletins scolaires multi-pays / multi-établissements

**Statut :** AUDIT UNIQUEMENT — aucune implémentation métier dans cette PR.  
**Gouvernance :** PR **Draft** — pas Ready — pas de merge automatique.  
**Interdictions respectées :** pas de migration SQL, pas de nouvelle route métier, pas de modification du calcul des notes, pas de modification d’UI production, pas de suppression de code, pas de changement Mobile, pas de modification de référentiel pédagogique, pas de contournement RBAC, pas de dépendance PDF ajoutée, pas de feature flag actif.

| Champ | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Base | `develop` |
| SHA audité | `bd91709f52bd5cf18a67efdee13596f9604f8125` |
| Commit | `Merge pull request #611 from Somafrik-education/codex/fix-mobile-class-presence-percent` |
| Date d’audit | 2026-09-12 |
| Branche rapport | `cursor/report-card-framework-audit-ce91` |
| Livrable | ce document uniquement |
| SHA de cette révision | HEAD de `cursor/report-card-framework-audit-ce91` (compléments HOLD — **aucun code**) |
| SHA HOLD audité | `30d45ee5085d5f107c38f8af18f85a1402441339` (revue ciblée : secret QR vs reprint) |
| Verdict demandé | **AUDIT REVIEW** — 1 P0 restant (token hash irréversible vs même QR au reprint) |
| Relecture croisée | 3 P0 bearer / Ed25519 / atomicité + P1 impression **couverts**. HOLD ciblé : `token_hash` seul ne permet pas de reconstruire l’URL ; défaut GO = **A** (`token_ciphertext` KMS). |
| Delta QR (chiffres) | `7d7f40b4 → 52d5bdd1` = **+382 / −19**. `52d5bdd1 → 30d45ee5` = 3 commits, **+172 / −30**. Cursor **+88 / −34** = uniquement `672773dd → 52d5bdd1`. |
| `develop` au moment de cette révision | `5c87a2f65e83ebd1a2d54927d8979e9d58eddc44` (PR #612) — **en avance** sur la base auditée `bd91709f`. Rebase + diff GitHub indépendant **avant Ready/Merge**, pas dans cette correction. |

---

## Verdict exécutif

Somafrik possède déjà un **socle pédagogique canonique PostgreSQL** (pays, établissements, années, périodes, classes, matières, cours, évaluations, notes, présences, inscriptions) et une **enveloppe bulletin** (`report_cards` + `report_card_templates` + PDF Puppeteer). Ce n’est **pas** un framework de bulletins multi-pays.

Les deux modèles burundais fournis (bulletin rose regroupé par domaines ; École La Colombière en lignes TJ / EX / Total) **ne peuvent pas être exprimés** par le moteur actuel sans code spécifique. Ils ne constituent **pas** « le modèle Burundi » : ils prouvent qu’un pays n’est pas un template.

**Relation cible (principe P0) :**

```text
pays → règles académiques autorisées → établissement → modèle / version de bulletin → classe(s)
```

**Anti-relation interdite :**

```ts
if (country === "BI") ...
if (school === "La Colombière") ...
```

**Principe fonctionnel P0 — soumission du modèle réel :** l’établissement transmet le bulletin papier/PDF/photo réellement utilisé pour chaque classe ou groupe de classes. Le Superadmin Somafrik transforme ce document en configuration structurée (`GradingProfile` + `ReportCardSchema` + `RenderingTemplate`). L’établissement ne construit pas lui-même la structure technique. **Aucun bulletin n’est activé automatiquement après l’envoi d’un document.**

**Principe fonctionnel P0 — QR d’authenticité :** chaque **version publiée** d’un bulletin possède un QR unique. Le scan ouvre une URL Somafrik opaque et affiche **le même snapshot immuable** que le PDF. Le QR **ne recalcule jamais** les notes. Un QR v1 reste lié à v1 après une correction v2.

**Pilote de qualification :** Burundi, avec les deux modèles comme fixtures. Si le futur moteur les reproduit sans branche conditionnelle, le framework est assez générique pour RDC, Congo, Sénégal, Côte d’Ivoire, Cameroun, etc.

**Verdict architecture actuelle vs cible : NO-GO pour un bulletin officiel multi-pays.** GO pour ouvrir les lots d’implémentation **après** validation explicite de ce rapport (HOLD documentaires intégrés : bearer, Ed25519, atomicité, impression, **secret QR reproductible A** — **aucun code**).

---

## Diagramme cible (mandat CTO, version 6 bis)

```text
ÉTABLISSEMENT
      │
      │ modèle papier/PDF/photo par classe
      ▼
DEMANDE DE CONFIGURATION
      │
      ▼
SUPERADMIN SOMAFRIK
      │
      ├── Academic Rules
      ├── Report Card Schema
      └── Rendering Template
      │
      ▼
ASSOCIATION TEMPLATE ↔ CLASSE(S)
      │
      ▼
APERÇU ÉTABLISSEMENT
      │
      ▼
VALIDATION
      │
      ▼
ACTIVATION
      │
      ▼
NOTES CANONIQUES PostgreSQL
      │
      ▼
CALCULATION ENGINE
      │
      ▼
SNAPSHOT BULLETIN
      │
      ├──────────────► PDF
      ├──────────────► Web/Mobile
      │
      ▼
QR UNIQUE PAR VERSION
      │
      ▼
somafrik.app/.../verify/<identifiant-opaque>
      │
      ▼
✓ BULLETIN AUTHENTIQUE  (+ ⚠ VERSION REMPLACÉE si SUPERSEDED)
      │
      ▼
AFFICHAGE DU MÊME SNAPSHOT
```

Chaîne de calcul (inchangée dans l’esprit, à imposer comme contrat) :

```text
COUNTRY / EDUCATION SYSTEM
            │
            ▼
    ACADEMIC RULE PROFILE
            │
            ▼
      SCHOOL CONFIG
            │
            ▼
      CLASS / STUDENT
            │
            ▼
    EVALUATIONS + GRADES
            │
            ▼
  CALCULATION ENGINE
            │
            ▼
REPORT CARD SNAPSHOT
            │
     ┌──────┼──────┐
     ▼      ▼      ▼
    WEB   MOBILE   PDF
            │
            ▼
    QR UNIQUE PAR VERSION
            │
            ▼
somafrik.app/.../verify/<identifiant-opaque>
            │
            ▼
    MÊME SNAPSHOT (page publique)
```

---

# 1. État actuel

## 1.1 Ce qui existe déjà (réutilisable)

| Capacité | État réel au SHA audité | Réutilisable pour le framework ? |
| --- | --- | --- |
| Pays | Table `countries` (`iso_code`, libellés pédagogiques LEVEL/TRACK/GROUP) | Oui — nœud supérieur, **pas** un template |
| Établissement | `schools` + `profile_payload` + logo/adresse/téléphone | Oui — personnalisation, pas règles académiques |
| Référentiel pédagogique pays | `education_levels`, `education_streams`, `education_class_groups` | Oui — niveaux / filières ; **pas** de `education_systems` distinct |
| Offre établissement | `school_levels`, `school_streams`, `school_class_groups` | Oui — activation d’un sous-ensemble national |
| Années / périodes | `academic_years`, `terms` ; `school_settings.period_mode` ∈ `trimestre\|semestre\|periode` | Oui — périodes configurables, **pas** profil de calcul |
| Classes | `classes` avec `level_id` / `stream_id` / `group_id` (POST consomme le catalogue activé) | Oui |
| Matières / cours | `subjects` + `school_courses` (classe + matière + enseignant + coefficient) | Oui — grain cours, **pas** groupe de bulletin |
| Types d’évaluation | `evaluation_types` (catalogue établissement : devoir, examen, …) | Partiel — type d’**événement** d’évaluation, pas composante de ligne bulletin (TJ/EX) |
| Évaluations / notes | `evaluations` + `grades` (SoT ; API projette `notes`) | Oui — **consommateur** du futur bulletin, jamais un 2e registre |
| Statuts de note non numériques | `graded \| absent \| excused \| not_submitted \| exempt` ; score NULL hors `graded` | Oui — base pour dispense / absence ; **pas** de « non applicable » distinct de exempt |
| Moteur de moyenne | `gradesCanonical.weightedAverage` + `GradeBookService` (normalisation /20, 2 niveaux de coef) | Partiel — unique formule staff, **pas** unique runtime (voir §4–5) |
| Enveloppe bulletin | `report_cards` (élève + année + période + statut) | Partiel — publication, **pas** de snapshot de notes |
| Template bulletin | `report_card_templates.layout` JSONB + GrapesJS Superadmin | Non pour la cible — HTML visuel, tableau unique Cours / Moyenne /20 / Coeff |
| PDF | Puppeteer + `report-card.html` tokens | Partiel — moteur de rendu existant, **recalcule** les notes à la volée |
| QR bulletin | `qrcode` + `buildVerificationPayload` | **Non conforme P0** — JSON PII (id, schoolCode, matricule, moyenne) dans le QR ; **pas d’URL** ; **pas de page publique** ; masquable (`showQrCode: false`) ; non lié à un snapshot |
| Notification publication | `pedagogy.report_card.published` (outbox C4) | Oui — à étendre, pas à remplacer |
| Upload PDF/JPG/PNG | `communicationsAttachments` (10 Mo, MIME allowlist) | Oui — pattern à réutiliser pour la soumission de modèle |
| Isolation tenant | `school_id` systématique + `tenantScopeService` | Oui — à conserver fail-closed |
| Audit | `audit_logs` + actions `generate/publish/archive_report_card` | Partiel — pas d’auteur de publication sur la ligne, pas de motif de correction |

## 1.2 Ce qui n’existe pas

- `EducationSystem` distinct du pays.
- `GradingProfile` / `academic_rule_profile` versionné (périodes, composantes, maxima, agrégation, pass, ranking).
- `ReportCardSchema` (sections, colonnes, lignes, signatures, appréciations) séparé du HTML.
- `ScoreComponent` (TJ, EX, oral, …) attaché à une **matière × période**, distinct du type d’évaluation.
- `SubjectGroup` (Français → Écrit / Lecture / Dictée) avec mode d’agrégation explicite.
- Snapshot immuable du bulletin publié.
- Versionning réel de schema / grading profile / template (le `version INTEGER` des templates est un compteur d’upsert, pas un historique).
- Association **Template → 1..N classes** (unicité actuelle = 1 template actif par classe, plus un défaut établissement).
- Workflow de soumission établissement → configuration Superadmin → validation établissement → activation.
- États `CALCULATED` / `VALIDATED` (seulement `draft | generated | published | archived`).
- Classement / pourcentage / total annuel persistés.
- Professeur principal / titulaire de classe (l’`assignment_role` est un rôle de **cours**, défaut `primary`).
- Lettres / mentions comme barème (seulement `exam_results.mention` TEXT, hors moteur notes).
- i18n produit (FR/EN/PT) : labels bulletin hardcodés français dans HTML, appréciations et UI.

## 1.3 Lecture des deux modèles de référence

Les deux documents burundais ne sont **pas** analysés comme un « template Burundi ». Ils sont des **fixtures de qualification** du même moteur.

### Modèle A — bulletin rose (domaines)

- Identité établissement + élève + classe + année + effectif.
- Matières **regroupées par domaines** (Français, Kirundi, Étude du milieu, Mathématiques, Arts, Anglais, autres) avec **sous-matières**.
- Maxima par matière.
- Composantes de notation distinctes.
- Trois trimestres + total par trimestre + maxima annuels + points obtenus + pourcentage + total général + place.
- Signatures titulaire et parents.

### Modèle B — École La Colombière (lignes)

- Une matière = une ligne (pas de groupes visuels obligatoires).
- Maxima distincts ; colonnes `T.J`, `EX`, `Total` × 3 trimestres.
- Bilan annuel (maximum, total, %, classement).
- Appréciations par trimestre + annuelle ; décision ; visas enseignant / parents / directeur.
- Certaines matières **avec** examen, d’autres **sans** (TPA / Religion-Morale type `/10` sans EX).
- **Aucun 0 artificiel** ne doit représenter « EX non applicable ».

**Conclusion architecturale :** deux écoles d’un même pays ne doivent pas nécessiter deux moteurs. Le pays autorise des profils ; l’établissement (via Superadmin) choisit schema + template + association de classes.

---

# 2. Cartographie des fichiers

## 2.1 Backend — calcul et pédagogie

| Fichier | Rôle |
| --- | --- |
| `backend/lib/gradesCanonical.js` | Contrat statuts + `weightedAverage` + exclusion absent/exempt |
| `backend/services/gradeBookService.js` | Moyenne matière / générale, classement, appréciation auto, `generateReport()` |
| `backend/lib/canonicalAverageParity.test.js` | Gate parité formule /20 à deux coefficients |
| `backend/db/pedagogyPgStore.js` | Projection `evaluations` / `grades` / `school_courses` ; `subject_coefficient` + `evaluation_coefficient` |
| `backend/lib/pedagogyService.js` | Services métier notes / évaluations / cours |
| `backend/lib/evaluationGradeEntry.js` | Saisie notes liée au statut d’évaluation |
| `backend/lib/gradeUniqueness.js` | Unicité `(school_id, evaluation_id, student_id)` |
| `backend/db/educationReferenceSchema.js` | Niveaux / filières / groupes par pays |
| `backend/db/educationReferencePgStore.js` | Persistence référentiel + activation école |
| `backend/db/classesRepository.js` | Classes liées au catalogue activé (`levelId`) |
| `backend/db/postgresRepository.js` | Agrégat SoT + `mapGrade` |
| `backend/lib/schoolSettingsManagement.js` | `periodMode`, `defaultScale`, `reportCardMode` |

## 2.2 Backend — bulletins / PDF / templates

| Fichier | Rôle |
| --- | --- |
| `backend/db/documentsExamsSchema.js` | DDL `report_cards`, `report_card_templates`, `school_documents` — **commentaire explicite : publication, pas copie des notes** |
| `backend/db/documentsExamsPgStore.js` | CRUD bulletins ; **`computeStudentAverage` = `AVG(g.score)` non pondéré** |
| `backend/lib/documentsExamsService.js` | RBAC + generate / publish / archive + résolution layout |
| `backend/lib/bulletinTemplate.js` | Tokens HTML ; tableau unique Cours / moyenne / coeff ; labels FR |
| `backend/templates/bulletin/report-card.html` | Template par défaut A4 |
| `backend/templates/bulletin/report-card.css` | Styles |
| `backend/services/bulletinPdfRenderer.js` | Puppeteer A4 + QR |
| `backend/services/reportPdfService.js` | Wrapper PDF |
| `backend/lib/bulletinDesignResolver.js` | Filtre matières `enabledSubjects` ; plus de lecture `academicConfig` |
| `backend/lib/bulletinDesignAccess.js` | Strip legacy `bulletinDesignByClass` du JSON académique |
| `backend/lib/bulletinDesignPreview.js` | Preview Superadmin |
| `backend/server.js` | Routes `/api/report-cards*`, `/api/students/:id/report.pdf`, preview conception |

## 2.3 Web

| Fichier | Rôle |
| --- | --- |
| `web/src/lib/gradeBook.ts` | **Copie** du moteur backend (moyenne, rang, appréciation /20) |
| `web/src/lib/evaluations.ts` | `syncBulletinsForClass` — recalcul client + IDs `BUL-…` legacy |
| `web/src/lib/reportCardsApi.ts` | Client `/report-cards` et `/report-card-templates` |
| `web/src/lib/bulletinDesign.ts` | DTO layout GrapesJS ; `readBulletinDesignByClass` n’est plus SoT |
| `web/src/pages/BulletinDesignPage.tsx` | Éditeur GrapesJS **Superadmin only** |
| `web/src/components/bulletin/BulletinGrapesEditor.tsx` | Éditeur HTML libre |
| `web/src/lib/bulletinGrapesTemplate.ts` | Tokens + HTML défaut (tableau unique /20) |
| `web/src/pages/EntityPage.tsx` | Liste/fiche Bulletins : generate / publish / archive |
| `web/src/pages/GradesEvaluationsPage.tsx` | Saisie notes ; publication d’évaluation « met à jour les bulletins » côté state |
| `web/src/lib/domainLoaders.ts` | `GET /report-cards` → `state.bulletins` |
| `web/src/lib/internalRoleDefaults.ts` | Matrice jetons `Bulletins:*` |

## 2.4 Mobile

| Fichier | Rôle |
| --- | --- |
| `Mobile/src/screens/ReportCardsScreen.tsx` | Liste + PDF ; affiche `average`/20 et `rank` de l’API |
| `Mobile/src/lib/pedagogyAverage.ts` | `canonicalStudentGeneralAverage` aligné formule staff |
| `Mobile/src/domain/academics/GradeBookService.ts` | **3e copie** du moteur (métriques / `generateReport`) |
| `Mobile/src/lib/dataTruth.ts` | Empty/error bulletins ; `isPublishedBulletin` |

## 2.5 Docs connexes (non remplacés)

| Document | Lien |
| --- | --- |
| `docs/project/AUDIT-NOTES-EVALUATIONS-V2.md` | SoT `grades` / `evaluations` ; `report_cards` déjà noté « pas de snapshot » |
| `docs/audits/pedagogy-canonical-average-parity.md` | Formule /20 à deux coefficients |
| `docs/audits/PEDAGOGICAL-MODEL-V2.md` | Taxonomie pays ≠ groupe de classe |
| `docs/audits/COUNTRY-ACADEMIC-CLASS-REFERENCE-INTEGRITY.md` | Pays → offre école → classes (POST classes consomme désormais le catalogue) |
| `docs/audits/parite-web-mobile-pedagogie-l3-matrix.md` | Parité notes/évals ; **pas** de bulletin structuré |
| `docs/audits/communications-report-card-published-green-2026-09-09.md` | SoT publication + outbox |

**Aucun de ces documents ne spécifie un schema bulletin configurable ni un workflow de soumission de modèle.**

---

# 3. Cartographie PostgreSQL

## 3.1 Inventaire demandé (A — données pédagogiques)

Pour chaque concept : source PG, API, service, Web, Mobile, contraintes, legacy.

### Pays

| | |
| --- | --- |
| PG | `countries` (`iso_code` UNIQUE, `pedagogical_level_label`, `pedagogical_track_label`, `pedagogical_group_label`) |
| API | `/api/backoffice/education-levels\|streams` (Superadmin, scopé pays) ; listings établissements |
| Service | `educationReferenceService`, `platformService` |
| Web / Mobile | Sélecteurs pays Superadmin / Admin Pays |
| Contraintes | Un établissement a **un** `country_id` |
| Legacy | `profile_payload.countryCode` encore lu en fallback |
| Écart bulletin | **Aucun lien** pays → template. Alias d’affichage/login seulement : `countryCode === "CD"` → `"RDC"` (`postgresRepository.getCountryScopeForUser`) ; cartes `BURUNDI→BI` / `RDC→CD` dans `server.js` et `authService.js` ; `repairOrphanSchools` préfixe `"BI"`. **Pas** de règle métier bulletin par ISO. |

### Établissement

| | |
| --- | --- |
| PG | `schools` (`school_code`, `logo_url`, `address`, `city`, `phone`, `email`, `school_type`, `profile_payload`) |
| API | CRUD établissements plateforme ; settings `/api/school-settings` |
| Web | Paramètres établissement ; conception bulletins Superadmin |
| Mobile | Contexte école JWT |
| Écart | Logo/adresse existent (`logo_url` = URL collée, pas upload) ; slogan dans `profile_payload` avec fallback **« Excellence et Innovation »**. **Devise/signataires bulletin** non structurés. PDF utilise souvent le logo **Somafrik** (`bulletinPdfRenderer.resolveLogoPath`), pas `schools.logo_url`. |

### Années scolaires

| | |
| --- | --- |
| PG | `academic_years` UNIQUE `(school_id, name)` ; `is_current`, `status` |
| API | `/api/academic-years`, paramètres établissement |
| Écart | Année d’établissement, pas d’année « nationale ». Un bulletin est déjà rattaché à `academic_year_id`. |

### Périodes / trimestres / semestres

| | |
| --- | --- |
| PG | `terms` UNIQUE `(academic_year_id, name)` ; `school_settings.period_mode` |
| API | Settings + résolution de `term_id` à la génération |
| Écart | Les noms de périodes sont du **texte libre** (`Trimestre 1`). Pas d’ordre canonique, pas de type `term\|semester`, pas de lien schema « 3 colonnes trimestre ». `report_card_mode` ∈ `period\|annual\|custom` **n’est pas consommé** par le générateur (unicité bulletin = 1 ligne par `term_id`). **Impossible** de stocker à la fois un bulletin T3 et un bulletin annuel sans terme synthétique. |

### Niveaux

| | |
| --- | --- |
| PG | `education_levels` (`country_id`, `level_code`) ; activation `school_levels` ; `classes.level_id` |
| API | Superadmin catalogue ; école activation ; POST `/api/classes` exige l’offre activée |
| Écart | Niveau ≠ template. Rien n’empêche deux classes du même niveau d’avoir besoin de deux bulletins différents — et rien ne le **modélise** non plus (1 template actif / classe). |

### Classes

| | |
| --- | --- |
| PG | `classes` (`school_id`, `academic_year_id`, `level_id`, `stream_id`, `group_id`) |
| API | `/api/classes` |
| Écart bulletin | `report_card_templates.class_id` nullable + unicité 1 actif / classe. **Pas** d’association N classes → 1 template. |

### Matières

| | |
| --- | --- |
| PG | `subjects` (catalogue école, `coefficient` défaut) ; `subject_class_assignments` |
| API | `/api/courses` (staff) ; notes portent le coefficient pour parents |
| Écart | Matière plate. Pas de parent/groupe. Pas de maxima TJ/EX par matière. |

### Groupes / domaines de matières

| | |
| --- | --- |
| PG | **Absent** pour les bulletins. `education_class_groups` = division A/B/C de **classe**, pas domaine Français. |
| Écart | Modèle A impossible sans `SubjectGroup`. |

### Évaluations

| | |
| --- | --- |
| PG | `evaluations` (`class_id`, `subject_id`, `term_id`, `max_score`, `coefficient`, `evaluation_type_id`, statuts `draft\|open\|locked\|published\|archived`) |
| API | `GET/POST/PATCH /api/evaluations` |
| Web / Mobile | Parité L3 (création, saisie, valider, publier) |
| Écart | Une évaluation est un **événement**. Elle n’exprime pas « cette matière a une composante EX /45 sur le bulletin ». `linked_exam_id` existe mais le module `exams` reste un 2e monde. |

### Notes

| | |
| --- | --- |
| PG | `grades` (pas de table `notes`) ; CHECK `0 ≤ score ≤ max_score` ; `grade_status` ; UNIQUE évaluation+élève |
| API | `GET/POST /api/notes` |
| Contraintes | `graded ⇒ score NOT NULL` ; autres ⇒ `score IS NULL` — **bon** (pas de 0 pour absence) |
| Legacy | `publication_status` / `locked` colonnes peu utilisées ; UI française vs PG |
| Écart | Grain = une note d’évaluation, pas une cellule bulletin (TJ trimestre 1). |

### Coefficients / maxima

| | |
| --- | --- |
| PG | `subjects.coefficient`, `school_courses.coefficient`, `evaluations.coefficient`, `evaluations.max_score`, `grades.max_score`, `school_settings.default_scale` (défaut 20, max 100) |
| Écart | Tout est pensé **moyenne /20**. Les maxima 45/45/90 du modèle B n’ont pas de place. Changer un coefficient **aujourd’hui** change silencieusement tout bulletin régénéré / PDF. |

### Présences

| | |
| --- | --- |
| PG | `attendance` UNIQUE `(school_id, student_id, attendance_date)` |
| API | `/api/attendance*` |
| Écart | Non consommé par le bulletin. Les totaux d’absences des modèles papier devront être des **champs optionnels de schema**, alimentés depuis cette table, jamais recopiés à la main. |

### Élèves / inscriptions

| | |
| --- | --- |
| PG | `students` ; `enrollments` UNIQUE `(student_id, academic_year_id)` + `class_effective_date` |
| Écart | **Un** enrollment / élève / année : un changement de classe **écrase** la classe courante. Historique de classe insuffisant pour un bulletin T1 en classe A et T2 en classe B sans journal d’affectation. Transfert d’établissement = nouvel `student_id` (pas de continuité d’identité cross-tenant, ce qui est correct pour l’isolation). |

### Enseignants / titulaire

| | |
| --- | --- |
| PG | `teachers` ; `teacher_assignments.assignment_role` défaut `primary` (rôle de cours) |
| Écart | **Pas** de titulaire de classe. `GET /api/classes` projette `teacher: "Non assigne"` (pas de `teacherId`). Mobile `ClassesScreen` affiche « Professeur principal » depuis un `teacherId` **non alimenté** par l’API canonique. Le « titulaire » du planning = propriétaire de créneau, pas homeroom. Signature modèle A sans source. |

### Classement

| | |
| --- | --- |
| PG | **Non persisté.** Calculé en mémoire par `GradeBookService.getClassRanking` (classement de compétition **1, 1, 3** — même moyenne = même rang, trou suivant). Clé = **`className` texte**, pas `classId`. |
| Écart | Recalculé à chaque PDF / écran. Homonymie de classes possible. Un ex æquo publié aujourd’hui peut bouger si une note arrive demain. |

### Bulletins (existant)

| | |
| --- | --- |
| PG | `report_cards` UNIQUE `(school_id, student_id, academic_year_id, term_id)` ; statuts `draft\|generated\|published\|archived` |
| API | `GET /api/report-cards`, `POST generate`, `POST publish`, `POST archive` |
| Templates | `report_card_templates` (`layout` JSONB, `version` INTEGER, 1 actif / classe ou défaut école) |
| Documents | `school_documents.storage_key` (métadonnées, pas binaire bulletin) ; `student_documents` |
| Commentaire schéma officiel | « `report_cards` = publication (pas de copie des notes) » — **exactement l’inverse** de l’exigence P0 d’immutabilité historique. |

### Examens (module distinct)

| | |
| --- | --- |
| PG | `exams`, `exam_results` (`mention` TEXT) |
| Écart | Ne pas fusionner silencieusement avec les notes. Le « EX » du modèle B est une **composante de bulletin**, éventuellement alimentée par des évaluations de type examen, pas par une 2e table de notes. |

### Décisions / promotion

| | |
| --- | --- |
| PG | `promotion_decisions` (`decision`, `from_class_id`, `to_class_id`) |
| Écart | Non branché au bulletin. La « décision » annuelle du modèle B doit être un **slot de schema** (saisie direction ou règle de pass), pas un recopiage libre des notes. |

---

# 4. Calculs actuellement existants

## 4.1 Formule staff canonique (notes / moyennes générales)

Documentée dans `docs/audits/pedagogy-canonical-average-parity.md` et implémentée dans `gradesCanonical` + `GradeBookService` :

1. Normaliser chaque note éligible sur l’unité (`score / max_score`).
2. Moyenne de cours pondérée par `evaluationCoefficient`.
3. Moyenne générale pondérée par `coefficient` du cours (porté par le DTO note).
4. Affichage défaut **/20**.
5. Statuts `absent | excused | not_submitted | exempt` **exclus** (score NULL, pas 0).

Exemple de preuve déjà en tests : Math 10/20 coef éval 1 + 20/20 coef 3 → 17,5 ; Français 12/20 coef 1 ; générale `(17,5×2 + 12×1) / 3 = 15,7/20`. La moyenne plate 16,4 est interdite.

## 4.2 Où chaque calcul vit aujourd’hui

| Calcul | API / PG | Web | Mobile | Hardcodé ? |
| --- | --- | --- | --- | --- |
| Moyenne matière | `GradeBookService.getSubjectAverage` ; **et** `AVG(g.score)` à l’hydratation `report_cards` | `web/src/lib/gradeBook.ts` (copie) | `canonicalWeightedAverage` (notes) ; `Mobile/.../GradeBookService.ts` **mort** sur les écrans livrés | Barème d’affichage 20 |
| Moyenne générale | idem deux niveaux | copie staff ; **3e formule plate** `parentGradesKpis` (`parentNotes.ts`) | `canonicalStudentGeneralAverage` (null si vide) | 20 |
| Total points | somme `moyenne_matière × coef_cours` en mémoire | copie | copie | — |
| Pourcentage | **Absent** (sauf affichage `/20`) | — | — | — |
| Coefficient | colonnes PG + DTO | lecture DTO | lecture DTO | — |
| Pondération | oui, 2 niveaux | oui | oui (notes) | — |
| Résultat trimestriel | filtre `period` / `term_id` texte ou UUID selon chemin | filtre `period` texte | PDF query `period` défaut `"Trimestre 1"` | nom de période |
| Résultat annuel | **Absent** comme agrégation de 3 trimestres | — | — | `report_card_mode=annual` non branché |
| Classement | mémoire, ex æquo conservés | copie | affiche `card.rank` API (souvent null) | toujours calculé |
| Admission / réussite | `successRate` si moyenne ≥ **10**/20 | copie | copie métriques (écrans notes : non) | seuil 10 hardcodé ; analytics examens = **50 % du max_score** (autre règle) |
| Absence de note | exclu si statut ≠ `graded` | **divergence** : le Web accepte tout `value` numérique hors set d’exclusion UI (`Saisie`/`Validée`) sans exiger `graded` | exclu + **`null`** si aucune note | backend `average: 0` vs Mobile/`parentGradesKpis` `null` |
| Dispense | `exempt` / UI « Dispensée » | oui | oui | pas de distinction « N/A composante » |
| Évaluation non applicable | **Absent** | — | — | risque de 0 si quelqu’un saisit 0 |

## 4.3 Chemin PDF vs chemin liste bulletin (P0)

```text
GET /api/students/:id/report.pdf
  → GradeBookService.generateReport(studentId, period, "Publié")   // pondéré /20 + rang + appréciation FR
  → applyBulletinDesignToReport(layout GrapesJS)
  → Puppeteer HTML

GET /api/report-cards  (hydrateReportCard)
  → computeStudentAverage = SELECT AVG(g.score)  // NON pondéré, ignore max_score et coefficients

Mobile ReportCardsScreen
  → affiche average hydraté (AVG)
  → bouton PDF → downloadReportCardPdf → chemin GradeBookService
```

**C’est déjà la situation interdite :** `calcul liste ≠ calcul PDF ≠ (éventuellement) calcul écran notes`.

## 4.4 Appréciation

`getAutomaticAppreciation` : ≥16 Excellent, ≥14 Très Bien, ≥12 Bien, ≥10 Assez Bien, sinon Insuffisant. Seuils et libellés **français hardcodés**, échelle 20. Inapte aux mentions burundaises, aux lettres, ou à l’absence d’appréciation.

## 4.5 Génération `report_cards`

`documentsExamsPgStore.generateReportCard` :

- résout élève / année ouverte / terme ;
- prend `enrollments.class_id` courant ;
- INSERT statut `generated` ou **retourne l’existant** s’il n’est pas `archived` ;
- **n’écrit aucune note, aucun rang, aucun schema_version**.

Publier pose `status=published` + `published_at` (une fois). Pas de lock des notes. Un PDF ultérieur relit les `grades` live.

---

# 5. Duplications Web / API / Mobile

| Composant | Copies | Divergence connue |
| --- | --- | --- |
| Moyenne générale /20 à 2 coef | Backend `GradeBookService` ; Web `gradeBook.ts` ; Mobile `pedagogyAverage.ts` | Formule staff alignée par tests de parité **si** DTO notes ; Web élargit l’éligibilité hors statut `graded` |
| KPI parent | `web/src/lib/parentNotes.ts` `parentGradesKpis` | **3e formule** : moyenne plate des évaluations, sans coef de cours |
| `GradeBookService` complet (rang, appréciation, generateReport) | Backend JS ; Web TS ; Mobile TS domain | Mobile domain **non utilisé** par les écrans notes livrés (`verify-mobile-evaluations-v2.js`) ; Web a un garde-fou anti-récursion |
| Liste bulletins | PG `report_cards` + `AVG(score)` | **Formule différente** du GradeBook |
| IDs bulletin | UUID PG vs `BUL-{student}-{period}` côté `generateReport` / `syncBulletinsForClass` | Deux identités |
| Templates | JSONB PG vs tokens HTML vs GrapesJS projet | Layout visuel ≠ schema |
| Statuts | PG `generated/published` vs UI `En validation/Publié` vs Mobile `isPublishedBulletin` | Ponts textuels |
| Preview conception | Superadmin `POST /api/backoffice/bulletin-design/preview` | Données **fictives**, pas les notes de la classe |

**Règle cible :** tout calcul académique a **une seule source de vérité serveur**. Web et Mobile n’affichent que le snapshot (ou, avant publication, une projection serveur `CALCULATED` non éditable).

Les copies `gradeBook.ts` / `parentGradesKpis` / `Mobile/.../GradeBookService.ts` (mort UI) devront **disparaître du chemin bulletin** (lots 3–8). Les écrans Notes peuvent rester temporairement branchés sur une formule partagée **serveur** — le bulletin ne doit plus les appeler.

---

# 6. Écarts avec la cible

## 6.1 Trois couches vs existant

| Couche cible | Existante ? | Écart |
| --- | --- | --- |
| **1. Academic Rules** | `school_settings.default_scale` + coefs cours/éval + `period_mode` | Pas de profil versionné, pas de composantes, pas de pass/ranking rules, pas d’interdiction école vs national |
| **2. Report Card Schema** | **Absent** | GrapesJS/HTML **mélange** structure et pixels ; `{{SUBJECT_ROWS}}` impose 3 colonnes |
| **3. Rendering Template** | `report_card_templates.layout` + HTML/CSS | Unique couche actuelle ; le rendu **recalcule** les notes |

## 6.2 Hiérarchie de configuration

Cible :

```text
Somafrik defaults → Country → Education system → School → Academic year → Level / Class → Report-card template
```

Aujourd’hui :

```text
countries
  └── schools
        ├── school_settings (scale 20, period_mode)
        ├── education activation (niveaux/filières)  — non lié au bulletin
        └── report_card_templates (1 / classe ou défaut école, layout HTML)
```

Question « Quel modèle pour cet élève, cette classe, cet établissement, cette année ? » : résolue par **nom de classe + template actif**, sans année obligatoire, sans version historique, sans profil académique.

## 6.3 Configuration établissement vs règles nationales

| L’école peut aujourd’hui | Cible |
| --- | --- |
| GrapesJS (via Superadmin) changer le HTML, masquer rang/QR, filtrer matières | Personnaliser logo, nom, couleurs, signataires **affichés** |
| Changer coefficients cours → impacte PDF live | Ne pas contourner un profil académique imposé |
| `report_card_mode` dans settings (non branché) | Choisir un **modèle autorisé** déjà configuré par Somafrik |

L’éditeur GrapesJS Superadmin est un **mauvais** éditeur de schema (HTML libre) mais un **bon** signal organisationnel : la conception n’est déjà plus dans `academicConfig` JSON ni ouverte à l’enseignant. À remplacer par l’éditeur structuré Superadmin (§6 bis), pas par un tableur Excel.

## 6.4 6 bis — soumission du modèle par l’établissement

**Inexistant.** Pas de bouton « Envoyer un modèle », pas de file Superadmin, pas d’états `SUBMITTED…ACTIVE`, pas de `report_card_template_request`.

Le plus proche : Superadmin ouvre Conception bulletins, choisit une école/classe, édite du HTML, upsert `status=active` **immédiatement**. C’est l’inverse du P0 « pas d’activation automatique ».

## 6.5 Notation générique / groupes

- Note actuelle = `matière + valeur d’une évaluation`.
- Pas de TJ=/45 + EX=/45 + Total=/90 vs TPA=/10 sans EX.
- Pas de `SubjectGroup` avec `aggregation_mode ∈ {visual_only, rollup_from_children, own_result}`.

## 6.6 Versionnage / traçabilité

| Besoin | Aujourd’hui |
| --- | --- |
| Bulletin 2026 identique en 2032 | **Non** — PDF relit `grades` |
| Versions schema / grading / template | `version` entier écrasé |
| États DRAFT→ARCHIVED | sous-ensemble, pas VALIDATED |
| généré/validé/publié par | audit_logs ponctuel ; pas sur la ligne |
| version moteur / référentiel | absente |
| motif de correction | absent |
| republication | `event_key` unique par `report_card_id` (C4) ; republication métier non définie |

## 6.7 PDF / Web / Mobile

Puppeteer A4 portrait uniquement (marges fixes). Pas de paysage. Logo plateforme. Tokens français. Mobile ouvre le PDF fichier, n’a pas de vue schema. Archivage = statut `archived`, pas blob canonique.

## 6.8 i18n

Labels « Cours », « Moyenne /20 », « Rang », « Appréciation » dans le HTML. Pas de catalogue de labels traduisibles. `countries.pedagogical_*_label` montre le **bon pattern** (concept canonique, libellé par pays) à étendre aux termes bulletin (`subject`, `period`, `rank`, `percentage`, …) — **jamais** stockés comme logique métier.

---

# 7. Risques P0 / P1 / P2

## P0 — bloquants avant tout bulletin officiel

1. **Pays ≠ template non garanti par le modèle.** Rien n’empêche une future PR `if (iso_code === "BI")`. Le layout actuel ne peut pas porter A et B ; la pression produit sera de forker le HTML par école.
2. **Pas de snapshot immuable.** Un bulletin `published` change si les notes, coefs, maxima, template ou logo changent. Inacceptable pour un document officiel 2026 relisible en 2032.
3. **Trois moteurs de moyenne.** `AVG(score)` (liste API) ≠ `GradeBookService` (PDF) ≠ copies clientes. Interdit par le mandat.
4. **`average: 0` si aucune note éligible** dans `weightedAverage`. Un élève arrivé en cours d’année / matière N/A / trimestre vide peut afficher 0 et plonger au classement.
5. **Pas de ScoreComponent / N/A.** Impossible d’exprimer « EX non applicable » sans 0 ou sans cacher la colonne en code.
6. **Pas de SubjectGroup explicite.** Modèle A non représentable.
7. **Activation immédiate du template** à l’upsert GrapesJS. **P0 mandat 6 bis :** aucun bulletin n’est activé automatiquement après envoi d’un document (et, par analogie, après une config Superadmin non validée par l’établissement).
8. **Unicité `report_cards` par terme** : pas de bulletin annuel parallèle ; `report_card_mode` mort.
9. **PDF recalcule.** Le rendu n’est pas un consommateur de snapshot.
10. **École éditrice de structure via HTML** (même si aujourd’hui gated Superadmin) : GrapesJS permet d’inventer un tableau qui n’est plus alimenté par PostgreSQL (`{{SUBJECT_ROWS}}` reste le seul bloc données). Risque de « bulletin image ».
11. **QR actuel non authentifiant.** `buildVerificationPayload` sérialise id interne, code école, **matricule** et **moyenne** dans le QR (`bulletinTemplate.js`). Aucune URL `https://somafrik.app/verify/…`, aucune identité opaque, aucun hash de snapshot, aucun statut ACTIVE/SUPERSEDED/REVOKED. `showQrCode` peut être désactivé. Le scan n’ouvre pas le bulletin canonique. **P0 mandat QR :** chaque version publiée a un QR unique → page publique → **même snapshot** que le PDF, sans recalcul.
12. **Bearer URL `/verify` = secret durable.** Sans `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP, redaction **Render**/proxy/CDN/WAF/app/**Sentry** et rate-limit **sans** préfixe token en clair, le secret fuit.
13. **`snapshot_sha256` seul ne prouve pas l’authenticité** contre un acteur qui réécrit snapshot **et** hash en base. Canonicalisation + signature **Ed25519** (clé privée hors PostgreSQL) ou threat model LOT 0 si écartée.
14. **Publication non atomique aujourd’hui** (`generate` puis `publish` séparés, PDF live). Un retry ne doit jamais émettre un second QR pour la même version.
15. **`token_hash` seul rend le reprint impossible.** Un hash n’est pas réversible : après redémarrage, Somafrik ne peut plus reconstruire `/verify/rc/<public_id>.<token>`. Contradiction avec « reprint = même QR ». Défaut GO = **A** : `token_ciphertext` (KMS hors PG) + `token_hash`.

## P1 — doivent être tranchés avant LOT 3–4

1. Titulaire de classe / signataires sans source (API classes = « Non assigne » ; Mobile label trompeur).
2. Enrollment unique par année : changement de classe en cours d’année.
3. Classement toujours on, clé `className`, compétition 1-1-3, seuil ≥10/20, appréciations FR ; analytics examens = 50 % du barème.
4. Éligibilité moyenne Web (statuts UI larges) ≠ backend (`graded` strict) ≠ Mobile (`null` si vide).
5. Module `exams` vs composante EX — frontière à figer (consommateur, pas 2e SoT). `mentionForScore` ≠ `getAutomaticAppreciation`.
6. Association Template → N classes vs copie par classe (unicité actuelle).
7. Arrondi : `toFixed(2)` vs `toFixed(1)` selon surface.
8. RBAC : Admin School n’a que `Bulletins:READ` ; Préfet CREATE/UPDATE ; Directeur/`PRINCIPAL`/Proviseur READ ; Superadmin `-` sur module Bulletins mais **seul** à concevoir via GrapesJS. Direction = trois rôles (`PRINCIPAL`, `PROVISEUR`, `PREFET_ETUDES`), pas un rôle unique. À réaligner sur la matrice §12.
9. Stockage fichiers soumission : réutiliser le pattern Communications (PDF/JPG/PNG, 10 Mo, magic bytes), **pas** `/tmp` en prod.
10. i18n labels (aucune couche fr/en/pt ; seulement `pedagogical_*_label`).
11. Année à 2 semestres vs 3 trimestres : `period_mode` existe, schema colonnes non.
12. **Contrat d’impression QR (LOT 5)** : taille physique minimale, quiet zone, niveau ECC, test scan après PDF/papier — un QR obligatoire illisible n’a aucune valeur.

## P2 — lots ultérieurs / pays suivants

1. Barèmes lettres / mentions.
2. Paysage A4, cachet, mentions légales riches.
3. Réutilisation cross-établissements d’un même template national (catalogue Somafrik, pas copie école).
4. Portugais / langues locales.
5. Redoublement / décision de passage liée à `promotion_decisions`.
6. Hygiène alias pays (`CD`/`RDC`, `BURUNDI`/`BI`, préfixe école `BI` dans `repairOrphanSchools`) — hors moteur bulletin, à ne pas étendre.

---

# 8. Architecture cible proposée

## 8.1 Principes non négociables

1. **Le pays n’est pas un template.** Il autorise des profils académiques.
2. **Un seul moteur de calcul serveur.** Interdiction de `if (country)` / `if (school)` dans ce moteur.
3. **Trois couches séparées** : Academic Rules ≠ Report Card Schema ≠ Rendering Template.
4. **Le bulletin consomme `grades` / `evaluations` / présences / inscriptions.** Il ne devient pas un 2e registre de notes. Pas d’éditeur type Excel des valeurs académiques.
5. **L’établissement apporte le modèle réel ; le Superadmin le configure ; l’établissement valide ; puis activation.**
6. **PUBLISHED ⇒ snapshot immuable.** Toute correction = nouvelle version traçable, pas un UPDATE silencieux.
7. **Qualification Burundi = A + B sur le même moteur**, fixtures, zéro branche `BI`.
8. **QR unique par version publiée** → URL opaque → **même** snapshot PDF/Web/Mobile/`/verify`. Aucune PII dans le QR. v1 reste résolvable après v2 (jamais de redirection silencieuse).
9. **Publication atomique et idempotente** : `PUBLISHED` + snapshot + digest/signature + identité ACTIVE (`token_hash` + `token_ciphertext`) + outbox dans **une** frontière ; un retry ne mint **pas** un second QR.
10. **Authenticité ≠ hash en base seul.** Canonicalisation figée (RFC 8785 JCS ou blob immuable) + signature **Ed25519** (clé privée **hors PostgreSQL**), sauf threat model **écrit** dans l’ADR LOT 0.
11. **Reprint = même URL = même QR**, y compris après redémarrage et des années plus tard. `token_hash` seul est **insuffisant** ; le plaintext se reconstruit via ciphertext KMS (A) ou KDF (B) ou un seul opaque (C).

## 8.2 Résolution « quel bulletin pour cet élève ? »

```text
student_id
  → enrollment (school_id, academic_year_id, class_id) à la date de période
  → report_card_class_assignment (class_id, academic_year_id, status=ACTIVE)
  → report_card_template_version
       ├── report_card_schema_version
       └── academic_rule_profile_version (grading)
  → calculation engine
  → snapshot
```

Si plusieurs assignments actifs : **fail-closed** (STOP), jamais un choix heuristique.

## 8.3 Couche 1 — Academic Rules

```text
Country
  └── EducationSystem          -- optionnel (ex. Fondamental / Post-fondamental) ; BI pilote peut n’en avoir qu’un
        └── AcademicLevel      -- réutilise education_levels
              └── GradingProfile (versionné)
                    ├── periods (ordered: T1, T2, T3 ou S1, S2)
                    ├── score_components (TJ, EX, …) + applicability per subject
                    ├── maxima (par composante / matière / période / annuel)
                    ├── coefficients
                    ├── aggregation_rules (période, annuel, groupe)
                    ├── pass_rules
                    ├── ranking_rules (on/off, ex æquo, population)
                    └── rounding_rules
```

Le profil dit **comment** on calcule. Il ne dit pas la couleur du tableau.

**Gouvernance :** Somafrik (Superadmin) crée les profils autorisés pour un pays / système. L’établissement **sélectionne** un profil autorisé compatible avec son offre (`school_levels`). Il ne peut pas éditer une formule nationale.

## 8.4 Couche 2 — Report Card Schema

Structure logique, indépendante du CSS :

```text
report_card_schema
report_card_schema_version
  ├── sections
  ├── subject_groups          -- aggregation_mode explicite
  ├── subject_rows            -- bind subject_id ou group_id ; pas le libellé
  ├── columns                 -- tree : Trimestre 1 / TJ, EX, Total ; Année / Max, Points, %
  ├── score_component_bindings
  ├── summary_fields          -- total, %, place, effectif, décision
  ├── signature_slots
  └── appreciation_slots
```

Colonnes = configuration, pas du JSX. Le modèle A ajoute des groupes et d’autres composantes **sans** modifier le moteur.

## 8.5 Couche 3 — Rendering Template

```text
report_card_template
report_card_template_version
  -- orientation, page size, logo binding, colors, cell metrics,
  -- signature placement, stamp, footer, legal mentions
```

Le renderer :

- reçoit un **snapshot JSON canonique** déjà calculé ;
- **n’appelle jamais** `GradeBookService` / `AVG` / notes live ;
- mappe `snapshot.cells[]` → grille selon schema_version.

GrapesJS actuel : **à déprécier** comme éditeur de vérité. Un aperçu HTML/PDF reste légitime, alimenté par le snapshot (ou une fixture de preview), pas par un HTML qui recalcule.

## 8.6 Workflow 6 bis (cible, non implémenté)

```text
Pédagogie > Bulletins
  [+ Envoyer un modèle de bulletin] / [Soumettre le modèle de cette classe]

payload: academic_year, level, class(es), country, education_system?, period?, comment, file(PDF|JPG|JPEG|PNG)

ÉTABLISSEMENT → SUBMITTED
SUPERADMIN     → UNDER_REVIEW → CONFIGURING
               → schema + grading compatible + rendering + association 1..N classes
               → READY_FOR_REVIEW (aperçu)
ÉTABLISSEMENT → APPROVED | CHANGES_REQUESTED
SUPERADMIN     → ACTIVE (seulement après APPROVED)
```

**P0 :** `SUBMITTED` n’active rien. Pas de génération de bulletins élèves tant que `ACTIVE`.

Détection de doublons : le Superadmin **réutilise** `Template #BI-001` pour 1re A/B/C au lieu de trois copies.

Modification annuelle : nouvelle `template_version` (v1 2026/27, v2 2027/28). Les snapshots `v1` restent.

---

# 9. Modèle de données proposé

**Aucune de ces tables n’est créée dans cette PR.** Noms indicatifs, alignés snake_case Somafrik. Le nom final sera figé au LOT 0 (ADR).

## 9.1 Règles académiques

```text
education_systems
  id, country_id, system_code, name, status

academic_rule_profiles
  id, country_id, education_system_id NULL, code, name, status

academic_rule_profile_versions
  id, profile_id, version, frozen_at, created_by, spec JSONB
  -- spec: periods[], components[], aggregation, pass, ranking, rounding
  -- JSONB versionné + CHECK applicatifs ; pas un 2e langage de formules par école

academic_rule_profile_subjects
  profile_version_id, subject_key, group_key NULL,
  component_id, max_score NULL, coefficient NULL, applicable BOOLEAN
```

`applicable=false` pour EX sur TPA : la cellule est `NOT_APPLICABLE`, jamais 0.

Réutilisation : `education_levels` existants ; le profil référence des `level_id` autorisés.

## 9.2 Schema bulletin

```text
report_card_schemas
  id, country_id, code, name

report_card_schema_versions
  id, schema_id, version, frozen_at, spec JSONB
  -- sections, groups, rows, columns, summaries, signatures, appreciations
```

## 9.3 Rendu + association classes

```text
report_card_templates
  id, country_id NULL,   -- catalogue Somafrik réutilisable
  origin_school_id NULL, -- école source du modèle papier
  code, name             -- ex. BI-001

report_card_template_versions
  id, template_id, version,
  schema_version_id,
  grading_profile_version_id,
  layout JSONB,          -- pixels only
  status

report_card_class_assignments
  id, school_id, academic_year_id, class_id,
  template_version_id,
  status,                -- PENDING_SCHOOL_VALIDATION | ACTIVE | SUPERSEDED
  UNIQUE (school_id, class_id, academic_year_id) WHERE status = 'ACTIVE'
```

Un `template_version` → N assignments. **Pas** de copie template par classe.

## 9.4 Soumission établissement (6 bis)

```text
report_card_template_requests
  id, school_id, academic_year_id, country_id,
  education_system_id NULL, submitted_by, reviewed_by,
  original_storage_key, original_mime, comments,
  status,  -- SUBMITTED | UNDER_REVIEW | CONFIGURING | READY_FOR_REVIEW
           -- | CHANGES_REQUESTED | APPROVED | ACTIVE | REJECTED | ARCHIVED
  resulting_template_version_id NULL,
  created_at, updated_at

report_card_template_request_classes
  request_id, class_id
  -- 1re A + 1re B + 1re C sur la même demande si même papier
```

Fichiers : même allowlist que Communications (`application/pdf`, `image/jpeg`, `image/png`), stockage durable **dédié** (nouvelle env, pas réutiliser le bucket Communications sans ACL séparée). Isolation `school_id` sur la clé.

## 9.5 Instance élève + snapshot

Étendre conceptuellement `report_cards` (évolution ultérieure, pas cette PR) :

```text
report_cards
  -- conserver school_id, student_id, class_id, academic_year_id
  period_id NULL,          -- term_id OU marqueur ANNUAL selon schema
  scope CHECK (term | annual)
  template_version_id,
  schema_version_id,
  grading_profile_version_id,
  engine_version,
  status  -- DRAFT | CALCULATED | VALIDATED | PUBLISHED | ARCHIVED
  generated_by, generated_at,
  validated_by, validated_at,
  published_by, published_at,
  correction_of_id NULL,   -- chaîne de republication
  correction_reason NULL

report_card_snapshots
  report_card_id UNIQUE,   -- 1 snapshot canonique pour PUBLISHED
  payload JSONB NOT NULL,  -- cellules, totaux, rang, labels déjà résolus + ids
                           -- **ou** canonical_blob bytea immuable (choix ADR LOT 0)
  payload_hash,            -- SHA-256 des bytes canoniques (snapshot_sha256)
  snapshot_signature,      -- Ed25519 (défaut GO) ; clé privée HORS PostgreSQL
  signing_key_id,
  signature_alg,
  frozen_at

report_card_verifications
  id,
  report_card_id,          -- version publiée précise (correction = nouvelle ligne carte)
  snapshot_id,
  public_id,               -- UUID/opaque non séquentiel (pas l'id interne)
  token_hash,              -- SHA-256 / HMAC du secret URL (vérification /verify)
  token_ciphertext,        -- envelope encryption KMS ; plaintext JAMAIS en clair en PG
  wrapping_key_id,         -- clé de wrapping HORS PostgreSQL (rotation)
  snapshot_sha256,         -- copie de contrôle (doit égaler snapshots.payload_hash)
  snapshot_signature,      -- copie de contrôle (doit égaler snapshots.snapshot_signature)
  signing_key_id,
  published_snapshot_version,
  status,                  -- ACTIVE | SUPERSEDED | REVOKED
  created_at,
  revoked_at, revoked_by, revoke_reason,
  superseded_by_verification_id NULL
  -- UNIQUE (public_id)
  -- UNIQUE (report_card_id, published_snapshot_version)  -- retry = même QR, jamais un 2e
  -- QR / URL ne portent QUE public_id + token (capability), jamais notes ni nom
```

`payload` contient les **valeurs affichées** et les ids stables (`subject_id`, `component_id`), pas seulement du HTML. Le PDF / Web / Mobile sérialisent ce JSON.

Unicité proposée : `(school_id, student_id, academic_year_id, scope, period_id)` — permet T1+T2+T3 **et** annuel.

## 9.6 Ce qu’on ne duplique pas

Interdit : table `report_card_grades` éditable. Les cellules du snapshot citent `grade_ids[]` sources. Recalcul avant publication relit `grades`. Après publication, on ne relit plus.

---

# 10. Stratégie de versionnage (exigence P0)

## 10.1 Trois versions + snapshot

| Objet | Quand ça bouge | Effet sur l’historique |
| --- | --- | --- |
| `grading_profile_version` | coefs, maxima, pass, périodes | nouvelle version ; assignments futurs seulement |
| `schema_version` | colonnes, groupes, signatures | idem |
| `template_version` | logo, couleurs, pagination | idem |
| `report_card_snapshots` | à `PUBLISHED` | **immuable** |

Règle : modifier v2 n’UPDATE jamais v1. On INSERT une version. `ACTIVE` assignment pointe vers une version. Les cartes publiées pointent vers les versions **figées dans le snapshot** (copie des ids + copie du payload).

## 10.2 États bulletin élève

| État | Sens | Opérations autorisées |
| --- | --- | --- |
| `DRAFT` | Intention, période non prête | supprimer, régénérer |
| `CALCULATED` | Moteur a tourné, snapshot **travail** mutable | régénérer, aperçu staff |
| `VALIDATED` | Titulaire / direction a contrôlé l’aperçu | publier, renvoyer en calcul (audit) |
| `PUBLISHED` | Officiel parents/élèves | **reprint** PDF du snapshot ; **correct** seulement via `correction_of_id` |
| `ARCHIVED` | Retiré de la vue courante, conservé | lecture / reprint admin |

### Une fois `PUBLISHED`

Autorisé :

- lecture tenant-scopée ;
- reprint PDF **identique** (même snapshot_hash) **et même identité de vérification / QR vN** ;
- notification déjà émise (pas de 2e event sauf correction) ;
- correction : crée une nouvelle carte `PUBLISHED` liée, motif obligatoire, anciens snapshots conservés, audit `corrected_by` ; **nouveau QR vN+1** ; QR vN reste résolvable (SUPERSEDED), jamais redirigé silencieusement vers vN+1.

Interdit :

- UPDATE des cellules ;
- recalcul silencieux ;
- changement de template/logo rétroactif ;
- passage direct `PUBLISHED` → `DRAFT` ;
- émettre un QR sur `DRAFT` / `CALCULATED` / `VALIDATED` ;
- encoder notes, nom, matricule ou id séquentiel dans le QR.

## 10.3 Atomicité / idempotence de publication (P0)

Le passage à `PUBLISHED` n’est **pas** « générer le PDF puis INSERT le QR ». Une **seule frontière transactionnelle** (PostgreSQL + outbox dans la même commit) crée ensemble :

1. statut `PUBLISHED` (`published_by`, `published_at`) ;
2. snapshot figé (bytes **canoniques** — JCS ou `bytea` immuable) ;
3. `snapshot_sha256` **et** `snapshot_signature` / `signing_key_id` (sauf dérogation ADR LOT 0) ;
4. identité de vérification `ACTIVE` (`public_id`, `token_hash`, `token_ciphertext`, `published_snapshot_version`) ;
5. événement outbox `pedagogy.report_card.published`.

**Clé d’idempotence (à figer LOT 0) :** `UNIQUE (report_card_id, published_snapshot_version)` sur l’identité de vérification. Un retry (timeout client, double-clic, redelivery) **relit** le même `public_id` / token déjà émis. **Interdit** : mint d’un second QR pour la **même** version.

Correction officielle = **nouvelle** carte (ou nouvelle `published_snapshot_version`) dans **sa** transaction ; v1 n’est ni réécrite ni ré-émise.

**PDF hors transaction (autorisé) :** Puppeteer peut tourner **après COMMIT**, uniquement en lisant snapshot + identité **déjà persistés**. Le renderer **déchiffre** `token_ciphertext` (stratégie A) pour reconstruire l’URL — il n’invente **pas** un nouveau token. Interdit : plaintext durable en PG, logs, ou mémoire process au-delà du rendu. Si le PDF échoue, reprint depuis la même identité — le bulletin reste officiellement publié et vérifiable.

## 10.4 États demande de modèle (6 bis)

`SUBMITTED → UNDER_REVIEW → CONFIGURING → READY_FOR_REVIEW → (CHANGES_REQUESTED → CONFIGURING)* → APPROVED → ACTIVE`  
Branches : `REJECTED`, `ARCHIVED`.

`ACTIVE` sur la demande = assignment(s) classe `ACTIVE` **après** validation établissement. Superadmin ne peut pas sauter `APPROVED` (sauf rejet explicite).

---

# 11. Stratégie PDF

## 11.1 Cible

```text
PostgreSQL grades/evaluations
        ↓
Academic calculation engine (unique, serveur)
        ↓
Report-card snapshot + snapshot_sha256
        ↓
   ┌────┴────┬─────────────────────┐
  PDF       Web/Mobile        Verification identity
  (QR)                           ↓
                          page publique /verify
```

## 11.2 Moteur de rendu

**Conserver Puppeteer** au LOT 5 (déjà en production, A4, lib `qrcode`). Ne **pas** ajouter de librairie dans cette PR. Évolution :

- HTML généré depuis **schema_version + snapshot**, pas depuis `{{SUBJECT_ROWS}}` unique ;
- `format: A4` + `landscape` selon template ;
- logo = `schools.logo_url` ou override template versionné (binaire figé dans snapshot ou storage hashé) ;
- preview Superadmin / établissement = mêmes renderer + **données fixture ou CALCULATED**, jamais un 3e calcul ;
- **QR = URL de vérification opaque uniquement** (remplace `buildVerificationPayload` JSON PII) ; injection obligatoire sur tout bulletin `PUBLISHED` ;
- le PDF **n’émet jamais** l’identité : rendu **après COMMIT**, depuis snapshot + `public_id` + token **reconstruit** (`token_ciphertext` déchiffré, stratégie A — §11 BIS.3).

Alternatives évaluées et **écartées pour le pilote** : React-PDF côté client (recalcule / diverge) ; image du papier scanné comme bulletin officiel (interdit : ce n’est pas PostgreSQL).

Le scan/PDF envoyé par l’école est un **artefact de configuration**, pas le document élève.

## 11.3 Impression / partage

| Canal | Source |
| --- | --- |
| Impression établissement | PDF snapshot |
| Téléchargement | idem |
| Web | vue lecture snapshot (+ bouton PDF) |
| Mobile | idem (liste + viewer) ; plus d’`average` hydraté par `AVG()` |
| Parents | uniquement `PUBLISHED` |
| Archive | snapshot + PDF optionnel dérivé (le JSON reste SoT) |
| Vérification publique | page `/verify/…` **sans login** ; même snapshot ; QR reprint = même `public_id` **et même token** (via `token_ciphertext`, pas via le hash) |

---

# 11 BIS — QR d’authentification par bulletin (P0)

**Statut cible :** exigence P0 du framework. **Non implémenté** dans cette PR. Le QR actuel n’est **pas** un mécanisme d’authenticité.

**Libellés et chaîne figés CTO (revue avant toute implémentation) :**

```text
BULLETIN PUBLIÉ
      │
      ▼
SNAPSHOT IMMUABLE
      │
      ├──────────────► PDF
      ├──────────────► Web/Mobile
      │
      ▼
QR UNIQUE PAR VERSION
      │
      ▼
somafrik.app/.../verify/<identifiant-opaque>
      │
      ▼
✓ BULLETIN AUTHENTIQUE
      │
      ▼
AFFICHAGE DU MÊME SNAPSHOT
```

Le QR ne contient **aucune note, aucun nom d’élève, aucun identifiant DB séquentiel**. Il pointe uniquement vers un identifiant opaque non devinable. Le bulletin affiché après scan est **exactement** celui qui a généré le PDF, sans recalcul des notes.

## 11 BIS.1 Principe

Même chaîne, vue identité / intégrité :

```text
REPORT CARD SNAPSHOT IMMUTABLE
          │
          ├── PDF / Web / Mobile
          │
          └── Verification Identity
                    │
                    ▼
              QR code unique par version
                    │
                    ▼
      https://somafrik.app/verify/<identifiant-opaque>
                    │
                    ▼
        PAGE PUBLIQUE DE VÉRIFICATION
                    │
                    ├── statut : ACTIVE | SUPERSEDED | REVOKED
                    ├── intégrité : snapshot_sha256
                    └── rendu du MÊME snapshot publié
```

**Interdiction absolue :** le QR ne déclenche **jamais** un nouveau calcul des notes. Page de vérification, PDF et Web authentifié consomment le **même** `report_card_snapshots` + `snapshot_sha256`.

Critère d’acceptation (tout pays / établissement / classe, **sans** `if (country)` / `if (school)`) :

```text
scan(QR imprimé)
      ↓
Somafrik retrouve UNE version publiée précise
      ↓
vérifie son état + intégrité (hash)
      ↓
affiche exactement le snapshot ayant généré le bulletin imprimé
```

## 11 BIS.2 Écart avec l’existant

| Attendu | `develop` @ SHA audité |
| --- | --- |
| URL Somafrik opaque | QR = **JSON** `id, schoolCode, matricule, average, generatedAt` (`buildVerificationPayload`) |
| Pas de PII dans le QR | **matricule + moyenne + code école** encodés |
| Page publique | **Absente** (aucun `/verify`) |
| Lié au snapshot publié | Pas de snapshot ; payload live au moment du PDF |
| Obligatoire si publié | `design.showQrCode !== false` — Superadmin/GrapesJS peut **masquer** le QR |
| Cible URL non configurable hors Somafrik | N/A (pas d’URL) |
| v1 / v2 distincts | Une ligne `report_cards` ; republication C4 = un seul `event_key` |

La lib `qrcode` et le token `{{QR_BLOCK}}` sont **réutilisables** comme primitive de rendu. Le **contrat** (JSON PII, optionnalité, absence de page) est à remplacer, pas à étendre.

## 11 BIS.3 Identité et intégrité (proposition, pas de migration ici)

Noms indicatifs — figés au LOT 0/4. Contrôle d’intégrité **minimum** (mandat CTO) :

```text
public_id
verification_token          -- plaintext éphémère à l'émission / reprint ; JAMAIS colonne PG
token_hash
token_ciphertext            -- stratégie A (défaut)
wrapping_key_id
snapshot_sha256
snapshot_signature
signing_key_id
published_snapshot_version
verification_status     -- ACTIVE | SUPERSEDED | REVOKED
```

| Concept | Rôle |
| --- | --- |
| `public_id` (`report_card_public_id`) | UUID v4 / identifiant opaque **non séquentiel**, unique mondialement |
| `verification_token` | secret aléatoire ≥ 128 bits, **capability**. **Jamais** stocké en clair. Vérification = `token_hash`. Reprint = déchiffrement `token_ciphertext` (A) — pas une re-dérivation depuis le hash. |
| `token_hash` | SHA-256 / HMAC du plaintext ; comparaison **constante** à `/verify` |
| `token_ciphertext` / `wrapping_key_id` | envelope encryption KMS ; clé **hors PostgreSQL**. Permet `same version → same URL → same QR` après restart. |
| `snapshot_sha256` | empreinte **canonique** du payload (RFC 8785 JCS ou blob immuable — ADR LOT 0) |
| `snapshot_signature` / `signing_key_id` | authenticité **Ed25519** (défaut GO), clé privée **hors PostgreSQL** ; couvre snapshot + version bulletin + établissement + `published_at`. HMAC/KMS = variante ADR, pas le défaut. |
| `published_snapshot_version` | entier de la version publiée (v1, v2, …) ; UNIQUE avec `report_card_id` (idempotence) |
| `verification_status` | `ACTIVE` \| `SUPERSEDED` \| `REVOKED` |
| `verified_at` | **pas** sur la ligne identité (évite write contention) ; journal append-only optionnel `report_card_verification_access_log` (hash IP, user-agent, résultat) — rétention limitée, pas une SoT métier |

URL recommandée (un seul opaque, non énumérable) :

```text
https://somafrik.app/verify/rc/<public_id>.<token>
```

Variante équivalente : path `public_id` + fragment `#token` (le fragment n’est pas envoyé au serveur — **à éviter** si on doit hasher côté API). Préférer **token dans le path** + lookup par hash.

**Interdit dans le QR / l’URL :** notes, nom, matricule, `student_id`, `school_id` nu, id DB séquentiel, moyenne, rang.

### Secret QR reproductible au reprint (P0)

Contradiction à lever (HOLD `30d45ee5`) :

```text
token stocké uniquement en hash  (irréversible)
        +
reprint = même QR = même <public_id>.<token>
```

Un hash ne permet **pas** de reconstruire le plaintext après perte de la valeur en mémoire (redémarrage API, reprint 10 ans plus tard).

**Invariant :** `même version de snapshot → même URL de vérification → même QR`, après redémarrage et plusieurs années. Le PDF LOT 5 **relit** cette URL ; il ne mint jamais un token.

**UNE stratégie à figer LOT 0** (défaut GO = **A**, privilégié Somafrik) :

| | Mécanisme | Reprint | Vérification `/verify` |
| --- | --- | --- | --- |
| **A (défaut)** | Token **aléatoire** haute entropie à la publication. PG : `token_hash` + `token_ciphertext` (envelope encryption KMS). Clé de wrapping **hors PostgreSQL** (`wrapping_key_id`). | Déchiffrer le ciphertext → reconstruire `<public_id>.<token>` | Lookup `public_id`, comparer `token_hash` (constante). **Pas** besoin du ciphertext. |
| **B** | Token **déterministe** HMAC/KDF(`public_id \|\| report_card_id \|\| published_snapshot_version`, secret `verification_key_id` hors PG). `token_hash` stocké pour contrôle. Rotation/version de clé **obligatoire**. | Re-dériver avec le même `verification_key_id` | Idem hash. |
| **C** | Un seul identifiant opaque **≥ 128 bits** dans l’URL (`/verify/rc/<opaque>`), sans second token. Threat model : l’opaque **est** la capability. | Réémettre l’opaque persisté | Lookup par hash de l’opaque. |

**Interdit :**
- plaintext durable en PostgreSQL, dumps, backups applicatifs lisibles, logs ;
- « on garde le token en RAM / Redis » comme SoT de reprint ;
- re-mint d’un nouveau token à chaque PDF (« reprint » qui changerait le QR papier déjà sorti).

Rotation KMS (A) : anciennes cartes déchiffrent avec `wrapping_key_id` historique ; **jamais** changer le plaintext d’une version déjà publiée.

### Canonicalisation + authenticité cryptographique (P0)

`snapshot_sha256` détecte une **corruption** si le hash de référence est intègre. Un acteur qui peut `UPDATE` PostgreSQL (dump restauré, admin compromis, migration malveillante) peut réécrire **payload et hash ensemble**. Ce n’est plus de l’intégrité, c’est de l’authenticité.

**Sérialisation canonique obligatoire** (à figer LOT 0, à implémenter LOT 4) :

- payload snapshot = JSON **RFC 8785 JCS** (JSON Canonicalization Scheme) **ou** blob binaire immuable (ex. `bytea` figé à la publication, plus jamais de `jsonb` re-sérialisé) ;
- `snapshot_sha256 = SHA-256(canonical_bytes)` ;
- **interdit** : `JSON.stringify` JS, `jsonb::text` PostgreSQL, ou tout round-trip qui réordonne les clés.

**Signature d’authenticité (défaut GO = Ed25519)** — champs indicatifs :

```text
snapshot_signature
signing_key_id
signature_alg          -- Ed25519 (défaut). HMAC via KMS seulement si ADR LOT 0 l’impose.
signed_over            -- canonical_bytes || report_card_id || published_snapshot_version
                       -- || school_id || published_at
```

- Clé **privée hors PostgreSQL** (KMS / secret manager / HSM — **pas** une colonne, **pas** un secret dans un dump). Seuls `signing_key_id` + signature vivent en PG.
- Vérification publique : recalcul JCS → SHA-256 → verify Ed25519. Hash mismatch **ou** signature invalide → **INTÉGRITÉ ROMPUE**.
- Rotation de clé : anciennes cartes vérifient avec `signing_key_id` historique ; jamais re-signer un snapshot publié.

**Si la signature est volontairement écartée :** l’ADR **LOT 0** doit écrire le threat model (qui peut écrire PG, RPO backups, séparation des rôles DB) et justifier pourquoi un hash en base suffit. **Sans cette ADR, la signature reste exigée.**

À la lecture publique :

1. parser opaque → `public_id` + token ;
2. lookup par `public_id` puis comparer `token_hash` (**comparaison constante**) — **jamais** `WHERE token LIKE prefix` ;
3. charger snapshot par `snapshot_id` ;
4. canonicaliser → SHA-256 ; si ≠ `snapshot_sha256` → **INTÉGRITÉ ROMPUE**, **ne pas** afficher le payload ;
5. vérifier `snapshot_signature` (sauf dérogation ADR) ;
6. **aucun** appel `GradeBookService` / `AVG` / `grades`.

L’identité ACTIVE naît **dans la même transaction** que `PUBLISHED` + snapshot + digest/signature + outbox (§10.3), y compris `token_hash` **et** `token_ciphertext` (A). Un retry ne mint **pas** un second QR. Le PDF s’imprime **après** commit, en déchiffrant le ciphertext déjà persisté.

## 11 BIS.4 Règle de version

```text
Publication v1 → QR v1
Correction officielle → Publication v2 → QR v2
Réimpression v1 → même QR v1
```

Scan QR v1 **après** v2 :

- résout **v1** (le papier scanné) ;
- statut affiché **exactement** :

```text
✓ BULLETIN AUTHENTIQUE
⚠ VERSION REMPLACÉE
```

- **interdiction** de rediriger silencieusement vers v2.

Scan QR v2 : snapshot v2, uniquement `✓ BULLETIN AUTHENTIQUE`.

Révocation explicite (fraude, erreur grave, demande établissement + motif) : `REVOKED`. Le snapshot reste archivé en interne ; la page publique affiche **RÉVOQUÉE** sans tableau de notes (ou version masquée — voir confidentialité).

Lien vers « version courante » depuis v1 : **opt-in policy**, défaut **non**. La possession du papier v1 authentifie v1, pas le droit de voir v2 (la correction peut porter des données nouvelles). Exception authentifiée : parent/élève/staff tenant via session, pas via le QR v1 seul.

## 11 BIS.5 Page publique de vérification

Route conceptuelle **publique** (sans compte) :

```text
GET /verify/rc/:opaque   →  200 HTML noindex
```

Pas de JWT. Pas de listing. Pas d’index moteur de recherche (`noindex, nofollow`, `X-Robots-Tag`, hors sitemap). Réponses 404 identiques pour token inconnu / mal formé (anti-énumération). Pas de `public_id` incrémental.

### Bearer URL — fuite du secret (P0)

Le token dans le path est une **capability durable** sur le bulletin complet. Exigences **obligatoires** sur `GET /verify/**` :

| Contrôle | Règle |
| --- | --- |
| Cache | `Cache-Control: no-store, no-cache, private, max-age=0` + `Pragma: no-cache`. **Interdit** CDN/HTML cache de la page ou de l’URL. |
| Referrer | `Referrer-Policy: no-referrer` (et meta équivalent). Aucun lien sortant qui fuirait l’URL. |
| CSP | CSP **stricte** (`default-src 'self'` / pas de `unsafe-inline` sauf nonce si indispensable au rendu snapshot). **Aucune** ressource, police, image, analytics, tag manager, heatmap **tierce** sur `/verify`. |
| Logs Render / ingress / reverse-proxy / CDN / WAF / app / Sentry / error / telemetry | **Interdit** : token en clair dans le path, query, Referer, breadcrumbs. **Rédaction** du segment secret. Autorisé : `public_id`, `verification_id`, HMAC/`token_hash` côté serveur **après** hash. Access logs Render/nginx/ALB : strip ou hash du secret. `beforeSend` Sentry purge `window.location` / `request.url`. |
| Rate limit | Clé = IP **et/ou** `public_id` **et/ou** HMAC/hash du token. **Interdit** d’utiliser ou de logger un **préfixe du token en clair** comme clé de quota. |
| Analytics | **Zéro** ressource/analytics tierce (RUM / GA / Pixel / tag manager / heatmap) sur `/verify`. |

Le rate limit déjà évoqué « IP + token prefix » dans une version antérieure de cet audit est **retiré** : il violait cette règle.

Maquette :

```text
Vérification de bulletin Somafrik

✓ BULLETIN AUTHENTIQUE
Établissement : …
Élève : …
Classe : …
Année scolaire : …
Période : …
Publié le : …
Version : v1

[bulletin rendu depuis le snapshot canonique — même renderer que le PDF]
```

États UI :

| `verification_status` + intégrité | Affichage |
| --- | --- |
| ACTIVE + hash OK | `✓ BULLETIN AUTHENTIQUE` + snapshot |
| SUPERSEDED + hash OK | `✓ BULLETIN AUTHENTIQUE` + `⚠ VERSION REMPLACÉE` + snapshot **v scannée** (jamais v2) |
| REVOKED | RÉVOQUÉE — pas de grille de notes |
| hash KO **ou** signature KO | INTÉGRITÉ ROMPUE — pas de grille |
| DRAFT / non publié | **aucune** identité → 404 générique |

**Protection des données personnelles :**

- **Possession du QR papier/PDF = capability.** Qui a le document peut ouvrir la page (comme un diplôme scannable). Ce n’est pas un annuaire.
- URL non devinable (entropie) ; pas d’API de recherche `?student=`.
- Anti-indexation + rate limit + pas de différentiel 403/404.
- Journalisation raisonnable : succès/échec, `verification_id` / `public_id`, timestamp, IP hashée ; **pas** le token en clair **ni un préfixe** du token ; TTL (ex. 90 jours) ; pas d’export marketing. Rate-limit : IP / `public_id` / HMAC du token — **jamais** un préfixe clair comme clé.
- Révocation : staff `REPORT_CARD_CORRECT` / Superadmin ; motif obligatoire.
- **Masquage partiel (P1 produit, à trancher LOT 7) :** certaines juridictions peuvent exiger un écran « Confirmer l’affichage du bulletin » (bouton) avant le tableau, ou un masquage nom (`O. Hope`) tant qu’un second facteur n’est pas fourni. **Défaut pilote Burundi :** affichage complet du snapshot officiel après scan valide — le papier porte déjà ces données. Flag schema/template `verification_reveal ∈ {full, confirm, masked}` **config Superadmin**, pas `if (country === "BI")`.
- Fermeture d’établissement : les identités **restent** vérifiables (archive officielle). Le tenant n’est plus opérable, la page publique lit le snapshot figé. Pas de cascade DELETE des vérifications.

**Expiration :** recommandation P0 = **vérification durable** (un bulletin 2026 reste authentifiable en 2032). Pas de TTL sur `ACTIVE`/`SUPERSEDED`. Un TTL ne serait acceptable que pour un **brouillon**, or les brouillons n’ont pas de QR.

## 11 BIS.6 PDF et RenderingTemplate

Le bloc QR est **obligatoire** pour tout rendu `PUBLISHED` (impression, téléchargement, archive PDF).

Le Superadmin configure dans le `RenderingTemplate` : **emplacement, taille, libellé** (traduisible). Il **ne peut pas** :

- désactiver le QR d’un bulletin officiel ;
- pointer une URL externe (`https://ecole.example/...`) ;
- injecter un payload JSON custom.

Exemple de libellé (i18n, pas de logique) :

```text
[ QR ] Vérifier l’authenticité de ce bulletin
       somafrik.app
```

Contrat moteur :

```text
QR → version publiée X
PDF → snapshot X
Page de vérification → snapshot X
```

Aperçu staff (`CALCULATED` / `VALIDATED`) : **filigrane « NON OFFICIEL »**, **pas** d’identité publique, **pas** de QR scannable vers `/verify` (ou QR mort explicite « aperçu » sans URL de prod).

Le PDF **n’est jamais** une source d’identité QR : il **imprime** l’URL déjà persistée (§10.3).

**Contrat d’impression (P1, LOT 5) — un QR obligatoire illisible n’a aucune valeur :**

| Critère | Exigence |
| --- | --- |
| Taille physique minimale | Module assez grand pour un scan smartphone à ~20–30 cm (fixer le mm min. dans le playbook LOT 5 ; typiquement ≥ 20–25 mm de côté **hors** quiet zone pour une URL courte). |
| Quiet zone | Marge blanche ≥ 4 modules autour du QR, **jamais** collée au filet, logo, photo élève ou marge d’imprimante. |
| Niveau ECC | **Q** (recommandé) ou **H** si papier/logo risque de recouvrir partiellement. **L** interdit en production. |
| Contraste | Noir sur blanc ; pas de QR « décoratif » coloré / inversé / trop petit dans le footer. |
| Zone template | Emplacement dédié (coin bas-droit recommandé) **non recouvert** par en-tête, filigrane ou photo. |
| Test scan | Gate **après** génération PDF **et** après impression d’un échantillon : le même token ouvre `/verify` et affiche le snapshot de **cette** version. Un PDF dont le QR ne scanne pas **n’est pas** publiable (reprint, pas nouveau token). |
| Recette template | Chaque `RenderingTemplate` LOT 5 doit passer le scan test (écran + papier) avant activation. |

## 11 BIS.7 Cas limites QR

| Cas | Règle |
| --- | --- |
| QR sur Draft | **Interdit / inexistant** — pas d’INSERT `report_card_verifications` |
| Avant publication | Non vérifiable publiquement (404) |
| Publication initiale | **Une** transaction : `PUBLISHED` + snapshot canonique + digest/signature + identité ACTIVE + outbox ; QR v1 |
| Retry publication (même version) | **Même** `public_id` / token (`UNIQUE (report_card_id, published_snapshot_version)`) — **jamais** un 2e QR |
| Réimpression | Même `public_id` / **même token plaintext** / `snapshot_sha256` / signature. Reconstruction via `token_ciphertext` (A), pas via le hash. PDF après redémarrage = **même** QR. |
| Correction après publication | Nouvelle identité v2 ACTIVE **dans sa** transaction ; v1 SUPERSEDED, toujours traçable |
| Version remplacée | Scan v1 → snapshot v1 + bandeau REMPLACÉE |
| Révoqué / annulé | REVOKED ; page sans notes |
| Fermeture établissement | Vérification **conservée** (archive) |
| Expiration | **Aucune** pour les archives officielles |
| Énumération d’ids | UUID + token haute entropie ; 404 uniforme ; rate limit (IP / `public_id` / HMAC — pas préfixe clair) |
| Copie du QR | Attendue (le papier se photocopie) ; capability inchangée ; révocation si fraude |
| QR altéré | 404 générique |
| Snapshot modifié en base | Hash mismatch **ou** signature invalide → INTÉGRITÉ ROMPUE (alerte ops) |
| PDF vs page Web | Tests de parité structurelle / hash ; **même** snapshot_id |
| QR trop petit / ECC L / quiet zone nulle | Recette LOT 5 **échoue** ; template non activable |

## 11 BIS.8 Intégration des lots

**Pas de lot isolé tardif** (évite un pilote Burundi sans authenticité). Répartition :

| Lot | Charge QR |
| --- | --- |
| **LOT 4** | Identité publique **dans la txn de** `PUBLISHED` ; canonicalisation JCS/blob ; `snapshot_sha256` + `snapshot_signature` ; `token_hash` + `token_ciphertext` (A) ; UNIQUE version → idempotence QR ; ACTIVE/SUPERSEDED/REVOKED ; outbox ; **aucun** QR sur draft ; reprint = même URL |
| **LOT 5** | Génération QR = URL reconstruite depuis `token_ciphertext` (A) ; injection template obligatoire ; lib `qrcode` existante ; **contrat d’impression** (taille, quiet zone, ECC Q/H, scan test) |
| **LOT 7** | Page `/verify` ; `Cache-Control: no-store` ; `Referrer-Policy: no-referrer` ; CSP stricte ; **aucune** ressource tierce ; redaction token (**Render** / proxy / CDN / WAF / app / **Sentry**) ; rate limit sans préfixe clair ; bandeaux AUTHENTIQUE / REMPLACÉE / RÉVOQUÉE / INTÉGRITÉ ; option `verification_reveal` |

Un lot 4b séparé n’apporte pas plus de sûreté que ces trois gates : l’identité **doit** naître avec le snapshot (LOT 4), le PDF **doit** l’imprimer (LOT 5), le scan **doit** aboutir (LOT 7).

## 11 BIS.9 Gates de tests (futurs)

```text
report-card-verification-token-uniqueness
report-card-qr-resolves-published-snapshot
report-card-qr-never-recalculates-grades
report-card-snapshot-hash-integrity
report-card-snapshot-canonical-jcs
report-card-snapshot-signature
report-card-publish-idempotent-qr
report-card-reprint-keeps-same-verification-id
report-card-correction-creates-new-verification-id
report-card-superseded-version-remains-traceable
report-card-revocation
report-card-public-id-non-enumerability
report-card-verification-tenant-boundary
report-card-pdf-web-verification-parity
report-card-verify-no-silent-redirect-to-latest
report-card-verify-no-store-headers
report-card-token-not-in-logs
report-card-verify-rate-limit
report-card-qr-print-scannability
report-card-reprint-after-restart-keeps-same-qr
```

`report-card-verification-tenant-boundary` : la page publique ne **liste** pas les bulletins d’un tenant ; un token de l’école A ne révèle rien sur B ; les APIs authentifiées restent `school_id` fail-closed.

`report-card-verify-no-store-headers` : `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP stricte, **aucune** ressource/analytics tierce.

`report-card-token-not-in-logs` : Render / access / error / Sentry / telemetry / proxy — token **absent**, y compris préfixe.

`report-card-verify-rate-limit` : clé = IP / `public_id` / HMAC — **pas** préfixe token en clair.

`report-card-snapshot-canonical-jcs` : même snapshot → même `snapshot_sha256` ; mutation JSON non canonique → hash différent ou rejet.

`report-card-snapshot-signature` : Ed25519, clé hors PostgreSQL ; altération snapshot **ou** hash **ou** ids couverts → signature invalide.

`report-card-publish-idempotent-qr` : retry de la **même** version → **un seul** `public_id` / token.

`report-card-verify-no-silent-redirect-to-latest` : scan v1 après v2 → snapshot v1 + bandeau REMPLACÉE.

`report-card-qr-print-scannability` : PDF — taille / quiet zone / ECC ; scan post-rendu.

`report-card-reprint-after-restart-keeps-same-qr` : publication v1 → mémoriser QR v1 → **redémarrer l’API** → réimprimer v1 → QR **strictement identique** → `/verify` ouvre exactement snapshot v1.

---

# 12. Stratégie RBAC

Isolation : **toute** API future `WHERE school_id = principal.school_id` (Superadmin : impersonation école explicite, jamais un SELECT global de payloads élèves). Parents/élèves : scope `student_id` comme aujourd’hui (`filterRowsByStudentScope`).

## 12.1 Nouveaux jetons proposés (lots 4–7, pas cette PR)

| Jeton | Sens |
| --- | --- |
| `REPORT_CARD_CONFIGURE` | Superadmin : schema / grading / template / file de demandes |
| `REPORT_CARD_SUBMIT_MODEL` | Établissement : envoyer PDF/photo |
| `REPORT_CARD_GENERATE` | Lancer le calcul classe / élève |
| `REPORT_CARD_VALIDATE` | Valider l’aperçu (titulaire / direction selon policy école) |
| `REPORT_CARD_PUBLISH` | Publier aux familles |
| `REPORT_CARD_READ` | Lire les cartes autorisées |
| `REPORT_CARD_REPRINT` | Rééditer un PDF publié sans recalcul |
| `REPORT_CARD_CORRECT` | Correction post-publication (motif) |
| `REPORT_CARD_REVOKE` | Révoquer une identité publique (fraude / annulation) |
| `REPORT_CARD_SCHOOL_APPROVE_TEMPLATE` | Valider le prototype configuré par Somafrik |

Les jetons actuels `Bulletins:READ/CREATE/UPDATE`, `Valider bulletins`, `Conception bulletins` deviennent des **alias de migration** (LOT 0 ADR), puis sont retirés des routes nouvelles.

## 12.2 Matrice minimale cible

| Action | Superadmin Somafrik | Admin établissement | Direction (Directeur / Proviseur) | Titulaire | Enseignant | Parent | Élève |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Configurer schema / grading / template | **oui** (multi-écoles) | non | non | non | non | non | non |
| Traiter la file de demandes | **oui** | voir les siennes | non | non | non | non | non |
| Envoyer un modèle papier | non (sauf impersonate) | **oui** | selon délégation | non | non | non | non |
| Valider le prototype configuré | non | **oui** | **oui** (recommandé) | consultation | non | non | non |
| Générer / recalculer DRAFT | impersonate | **oui** | **oui** | **sa classe** | non | non | non |
| Valider bulletin élève | non | **oui** | **oui** | **sa classe** | non | non | non |
| Publier | non | **oui** | **oui** | non par défaut | non | non | non |
| Lire publié | impersonate audit | oui école | oui école | sa classe | ses élèves? **non bulletin complet** (notes déjà via Notes:READ) | **son enfant** | **soi** |
| Reprint | oui audit | oui | oui | sa classe | non | PDF enfant | PDF soi |
| Corriger publié | exception plateforme | **oui** + motif | **oui** + motif | non | non | non | non |
| Révoquer identité QR | **oui** | **oui** + motif | **oui** + motif | non | non | non | non |
| Page publique `/verify` (possession QR) | n/a (anonyme) | n/a | n/a | n/a | n/a | n/a | n/a |
| Modifier une formule / max national | **oui** nouvelle version profil | **non** | non | non | non | non | non |

Écart actuel notable : Préfet a `Bulletins:CREATE/UPDATE` ; Directeur seulement `READ` ; Superadmin `-` sur module Bulletins mais preview conception réservée Superadmin. Le LOT 7 devra **inverser** : config technique = Superadmin ; cycle de vie élève = établissement (Préfet / Direction / titulaire), pas l’enseignant matière.

`school_id` : un établissement ne lit **jamais** les demandes, fichiers, snapshots d’un autre tenant. Superadmin : file multi-établissements, accès documents de demande, **pas** de navigation déguisée dans les notes d’une école sans contexte.

---

# 13. Stratégie multi-tenant

1. Toutes les tables nouvelles : `school_id` NOT NULL dès qu’elles portent des données d’école (requests, assignments, report_cards, snapshots, fichiers).
2. Catalogues pays (`academic_rule_profiles`, `report_card_schemas`, templates catalogue `BI-001`) : `country_id`, `school_id` NULL, lecture Superadmin + (optionnel) Admin Pays en **lecture**.
3. JWT leftover / `schoolCode: "*"` : mêmes gardes que Notes (fail-closed établissement).
4. Tests gate `tenant isolation` : école B ne GET pas `/report-cards` ni `/template-requests` de A ; Superadmin sans `schoolId` ne hydrate pas de snapshots élèves.
5. Fichiers : clé `schools/{school_id}/report-card-templates/{request_id}/…` ; path traversal déjà traité côté Communications — **répliquer les tests**.
6. Page `/verify` : **capability URL**, pas un listing tenant. Ne pas `ON DELETE CASCADE` les identités/snapshots si une école est fermée (archive officielle). `schools` actuel cascade `report_cards` — **écart P0** à corriger au LOT 4 (RESTRICT ou archivage).

---

# 14. Compatibilité des deux modèles fournis

Évaluation du **moteur actuel** : **GAP / GAP**.  
Évaluation du **framework proposé** (même moteur, fixtures, zéro `if BI`) : **PASS / PASS** sous réserve des lots 1–5.

## 14.1 Matrice d’expression

| Besoin | Modèle A | Modèle B | Actuel | Cible |
| --- | --- | --- | --- | --- |
| Groupes de matières + sous-matières | oui | non (lignes plates) | non | `SubjectGroup.aggregation_mode` |
| Ligne matière simple | partiel | oui | oui (plat /20) | `subject_row` |
| Composantes TJ / EX / Total | oui (variante) | oui | non | `ScoreComponent` + colonnes |
| Matière sans EX | possible | oui | non (0 ou colonne figée) | `applicable=false` → N/A |
| Maxima hétérogènes 45/45/90 vs /10 | oui | oui | non (scale 20) | maxima dans profil × matière |
| 3 trimestres côte à côte | oui | oui | non (1 `term_id` / carte) | colonnes période du schema ; 1 snapshot **annuel** ou 4 cartes selon config |
| Totaux trimestre + annuel + % | oui | oui | non | aggregation_rules |
| Place / effectif | oui | oui | rang mémoire /20 | ranking_rules + summary |
| Appréciations T1–T3 + annuelle | limité | oui | 1 string auto FR | appreciation_slots |
| Décision | non visible | oui | `promotion_decisions` isolé | summary slot + pass_rules |
| Signatures titulaire / parents / directeur | 2 | 3 visas | non | signature_slots |
| Religion / Morale particulière | — | oui | non | composante N/A + optionnel |
| Même code métier | — | — | forcerait 2 HTML | **1 moteur, 2 schemas, 2 templates** |

## 14.2 Fixtures de qualification (LOT 10, pas cette PR)

```text
fixture://burundi/model-a-rose
fixture://burundi/model-b-colombiere
```

Gates :

- aucune occurrence `country === "BI"` / `schoolCode ===` dans `calculationEngine` et `schemaRenderer` ;
- snapshot A contient des groupes + sous-lignes + 3 périodes ;
- snapshot B contient TJ/EX/Total, EX=`NOT_APPLICABLE` sur au moins une matière, annuel, slots signature ;
- PDF A ≠ PDF B visuellement ; payload cells issus du **même** engine.

## 14.3 Verdict compatibilité (sortie CTO)

| | Moteur actuel | Framework proposé |
| --- | --- | --- |
| **Compatibility model A** | **GAP** | **PASS** (conception ; à prouver par fixtures au LOT 10) |
| **Compatibility model B** | **GAP** | **PASS** (idem) |

---

# 15. Plan de migration sans casse

Principe : **le bulletin actuel reste en service** jusqu’au cutover par établissement / année. Pas de big-bang Notes. Pas de backfill silencieux des `report_cards` published en snapshots fictifs.

| Étape | Action | Risque si mal faite |
| --- | --- | --- |
| 0 | ADR + contrats ; GrapesJS gelé comme legacy | course au HTML par école |
| 1 | Tables profils **nouvelles** ; `school_settings` inchangé | — |
| 2 | Schema + assignments en parallèle de `report_card_templates` | double écriture |
| 3 | Engine serveur unique ; PDF **legacy** continue d’appeler GradeBook jusqu’au flag **éteint par défaut** | divergence |
| 4 | Snapshots ; nouvelles cartes seulement si template `ACTIVE` (workflow 6 bis) | — |
| 5 | PDF snapshot pour les écoles activées ; les autres : chemin actuel | deux PDF temporairement **assumés** |
| 6–9 | UI / Mobile lecture snapshot ; soumission modèle | — |
| 10 | Burundi pilote (2 fixtures) | — |
| Cutover école | année N+1 en framework ; année N published **restent** sur PDF legacy **figé** (générer un snapshot one-shot **en lecture notes à date de cutover** uniquement si l’école le demande, sinon conserver PDF fichiers si existants) | réécriture 2026 |

**Interdit :** recaler les moyennes published via `AVG` ou via le nouvel engine sans archivage.

`syncBulletinsForClass` Web (IDs `BUL-…`) : ne plus écrire d’état bulletin côté client dès LOT 4. Les publications d’évaluation **ne régénèrent pas** un bulletin (consommateur, pas producteur).

Module Notes / paiements / inscriptions : **aucune** modification de contrat d’écriture dans les lots bulletin, hors ajouts opt-in (homeroom, N/A component) validés CTO.

---

# 16. Découpage d’implémentation (lots) — à ne pas commencer ici

| Lot | Objet | Dépend | Livrable principal |
| --- | --- | --- | --- |
| **LOT 0** | Contrat domaine + ADR | — | ADR trois couches, interdiction `if(country)`, mapping jetons RBAC, fixtures A/B, **contrat QR**, **JCS vs blob**, **Ed25519**, **idempotence QR**, **stratégie secret reprint A/B/C (défaut A : token_ciphertext KMS)** |
| **LOT 1** | Profils académiques + versionnement | 0 | tables profils, pas d’UI école, tests rounding/N/A |
| **LOT 2** | Schema bulletin configurable | 0–1 | schema_version, colonnes, groupes, slots ; **pas** de GrapesJS nouveau |
| **LOT 3** | Moteur de calcul canonique | 1–2 | un module serveur ; retire `AVG(score)` du hydrate ; clients n’ont plus de formule bulletin |
| **LOT 4** | Snapshot + validation / publication + **identité + hash + ciphertext + signature** | 3 | txn atomique `PUBLISHED`+snapshot+digest/signature+identité ACTIVE (`token_hash`+`token_ciphertext`)+outbox ; idempotence QR ; **pas de QR sur draft** |
| **LOT 5** | Moteur PDF + **injection QR** + **contrat d’impression** | 4 | Puppeteer consomme snapshot **après commit** ; QR = URL reconstruite (`token_ciphertext`) ; taille / quiet zone / ECC / scan test |
| **LOT 6** | Configuration établissement + **6 bis soumission** | 2, 5 | file Superadmin, upload PDF/JPG/PNG, assignments 1..N, **pas d’auto-activation** |
| **LOT 7** | UI Web + **page publique `/verify`** | 4–6 | liste classe, aperçu, valider, publier, bouton envoyer modèle ; `/verify` AUTHENTIQUE/REMPLACÉE/RÉVOQUÉE ; `no-store` / `no-referrer` / CSP ; redaction token **Render/Sentry** ; rate-limit sans préfixe clair |
| **LOT 8** | Lecture Mobile | 4–5 | snapshot only + PDF |
| **LOT 9** | Historique / archive | 4 | reprint, versions, motif |
| **LOT 10** | Pays pilote Burundi | 1–9 | fixtures A et B, qualification « même moteur » |

Lots 6 et 7 portent le workflow 6 bis (bouton établissement, file Superadmin, éditeur **structuré** Superadmin, notifications). L’éditeur Superadmin construit `Schema + GradingProfile + RenderingTemplate`, **pas** une image. Le QR d’authenticité n’est **pas** un lot séparé : identité + signature + txn au LOT 4, impression + contrat scan au LOT 5, page publique + anti-fuite bearer au LOT 7.

**ADR LOT 0 — décisions QR à figer avant code :**

1. Canonicalisation : RFC 8785 JCS **ou** blob `bytea` immuable (pas de `jsonb` re-sérialisé).
2. Signature : **Ed25519** (défaut GO), clé privée **hors PostgreSQL**, champs `snapshot_signature` + `signing_key_id`. HMAC/KMS seulement si l’ADR l’impose. **Ou** threat model écrit (qui peut écrire PG, RPO backups, séparation des rôles) justifiant un hash seul. Sans cette ADR, Ed25519 **reste exigé**.
3. Clé d’idempotence publication : `UNIQUE (report_card_id, published_snapshot_version)` (retry = même QR).
4. Headers `/verify` : `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP stricte, zéro ressource tierce, redaction token partout.
5. **Secret QR reproductible (P0 reprint) :** **A** token aléatoire + `token_hash` + `token_ciphertext` KMS (défaut GO) **ou** **B** HMAC/KDF + `verification_key_id` **ou** **C** un seul opaque ≥128 bits. Invariant : `même version → même URL → même QR` après restart. Gate `report-card-reprint-after-restart-keeps-same-qr`.

---

# 17. UX future (non implémentée)

## 17.1 Établissement — Pédagogie > Bulletins

```text
[Année scolaire] [Période] [Classe]

[+ Envoyer un modèle de bulletin]   [Soumettre le modèle de cette classe]

Élèves
┌──────────────────────────────────────┐
│ Okito Hope       69,9 %    [Aperçu] │
└──────────────────────────────────────┘
[Générer les bulletins]

Aperçu → Validation → Publication → PDF
```

Statut modèle :

```text
Bulletin — 6e A
Modèle envoyé · En configuration par Somafrik · Envoyé le 12/09/2026
[Voir le document envoyé]

puis : Nouveau modèle disponible · [Aperçu] [Valider] [Demander une correction]
```

## 17.2 Superadmin — Configuration des bulletins

File filtrable (pays, établissement, année, niveau, classe, statut, date) :

```text
École Colombière    6e A    À configurer
Berceau Sagesse     1re B   En cours
École X             4e A    À valider
```

Éditeur deux panneaux : document original | configuration (groupes, matières, composantes, périodes, signatures). Aperçu PDF fixture. Association multi-classes. Réutilisation `BI-001`.

**Pas** d’éditeur Excel des notes.

## 17.3 Notifications (statut PG canonique)

| Sens | Message type |
| --- | --- |
| École → Somafrik | Un nouveau modèle de bulletin a été envoyé. |
| Somafrik → École | Votre modèle de 6e A est prêt à être vérifié. |
| École → Somafrik | Une correction a été demandée. |
| Somafrik → École | Votre modèle de bulletin a été activé. |
| Déjà existant | `pedagogy.report_card.published` → parents/élèves |

## 17.4 Page publique de vérification (scan QR)

Sans compte. Après scan :

```text
Vérification de bulletin Somafrik

✓ BULLETIN AUTHENTIQUE
⚠ VERSION REMPLACÉE          ← uniquement si SUPERSEDED (QR v1 après v2)

Établissement / Élève / Classe / Année / Période / Publié le / Version
[rendu snapshot — identique au PDF, sans recalcul]
```

Autres bandeaux exclusifs : `RÉVOQUÉE` ; `INTÉGRITÉ ROMPUE`. Pas de CTA « recalculer ». Filigrane uniquement sur les aperçus non publiés (qui n’ont pas cette URL).

---

# 18. Internationalisation

- Concepts stables : `subject`, `subject_group`, `period`, `rank`, `percentage`, `appreciation`, `daily_work`, `exam`, `decision`.
- Labels : table ou JSON de traduction par `locale` (`fr`, `en`, `pt`, langues locales plus tard), **surchargeables par schema_version** (ex. « Branche » vs « Matière ») sans changer les ids.
- Pattern déjà présent : `countries.pedagogical_level_label`.
- Interdit : `if (locale === "fr") total = …`.
- Appréciations : listes configurées dans le profil / schema, pas `getAutomaticAppreciation` FR /20.

Le produit Web/Mobile n’a pas d’i18n runtime complet aujourd’hui (copy FR). Les lots 7–8 consomment les labels du snapshot (déjà résolus serveur selon locale de l’école ou de l’utilisateur).

---

# 19. Cas limites (analyse, pas d’implémentation)

| Cas | État actuel | Règle cible |
| --- | --- | --- |
| Élève arrivé en cours d’année | 0 si pas de notes ; classement le pénalise | cellules manquantes `MISSING` ; ranking_rules : exclus ou inclus selon profil ; **pas** 0 |
| Changement de classe | enrollment unique écrasé | journal d’enrollment ou `class_id` **figé sur le snapshot** de la période |
| Changement d’établissement | nouvel élève / tenant | pas de fusion cross-tenant ; historique reste à l’école A |
| Matière sans examen | impossible | `NOT_APPLICABLE` |
| Matière facultative | pas de flag | `optional` dans schema : hors moyenne générale si profil le dit |
| Dispense | `exempt` exclu | conserver ; distinct de N/A |
| Absence évaluation | `absent` exclu | conserver ; affichage « Abs » configurable, pas 0 |
| Note manquante | `not_submitted` / score null | `MISSING` ; génération `CALCULATED` possible avec warning ; publication bloquable par policy |
| Changement de coefficient | PDF live change | nouvelle `grading_profile_version` ; snapshots old intouchables |
| Trimestre non clôturé | génération quand même | policy : generate OK, publish refusé tant que `terms.status` ou évaluations non `published` |
| Redoublement | `promotion_decisions` isolé | décision annuelle = slot ; ne réécrit pas l’année N-1 |
| Classement ex æquo | compétition **1, 1, 3** (pas dense 1, 1, 2) | figer dans `ranking_rules` + tests |
| Classe à 1 élève | `1e / 1` | autoriser ; option profil `ranking=off` |
| Correction après publication | UPDATE status only | `correction_of_id` + motif |
| 2 semestres vs 3 trimestres | `period_mode` non lié au schema | profil.periods length 2 ou 3 ; **même engine** |
| Sans classement | rang toujours calculé | `ranking_rules.enabled=false` masque colonne |
| Lettres / mentions | `exam_results.mention` mort pour notes | scale type `numeric \| letter \| mention` dans profil (LOT 10+ hors BI numérique) |
| QR Draft / pré-publication | QR optionnel JSON PII, sans page | **interdit** ; 404 publique |
| Réimpression | PDF recalculé | même snapshot + **même** identité QR |
| Correction → v2 | même ligne `report_cards` | QR v2 nouveau ; scan v1 → snapshot v1 SUPERSEDED |
| Révocation | `archived` sans page | REVOKED, pas de notes sur `/verify` |
| QR / snapshot altéré | non détecté | hash mismatch → INTÉGRITÉ ROMPUE |
| Fermeture école | CASCADE `report_cards` aujourd’hui | **conserver** vérifications + snapshots (pas ON DELETE CASCADE identité publique) |

---

# 20. Tests / gates à prévoir (architecture)

À créer dans les lots, **pas ici** :

```text
tenant isolation
calculation determinism
historical snapshot immutability
template rendering (no recompute)
schema versioning
grading profile versioning
PDF consistency (hash snapshot → PDF golden or structural)
annual aggregation
ranking (ties, n=1, ranking off)
rounding
non-applicable scores
missing scores
publication locking
RBAC (matrix §12)
no country/school branch in engine
template request workflow (no auto-activate)
class assignment 1..N
Burundi fixture A
Burundi fixture B
report-card-verification-token-uniqueness
report-card-qr-resolves-published-snapshot
report-card-qr-never-recalculates-grades
report-card-snapshot-hash-integrity
report-card-reprint-keeps-same-verification-id
report-card-correction-creates-new-verification-id
report-card-superseded-version-remains-traceable
report-card-revocation
report-card-public-id-non-enumerability
report-card-verification-tenant-boundary
report-card-pdf-web-verification-parity
report-card-verify-no-silent-redirect-to-latest
report-card-verify-no-store-headers
report-card-token-not-in-logs
report-card-verify-rate-limit
report-card-snapshot-canonical-jcs
report-card-snapshot-signature
report-card-publish-idempotent-qr
report-card-qr-print-scannability
report-card-reprint-after-restart-keeps-same-qr
```

Critère d’acceptation majeur :

> Les deux modèles burundais sont exprimés avec le **même** moteur, sans branche conditionnelle spécifique dans le code.

Critère P0 QR :

> `scan(QR imprimé)` retrouve une version publiée précise, vérifie état + `snapshot_sha256` + signature (sauf dérogation ADR), affiche **exactement** le snapshot du papier — sans `if (country)` / `if (school)`, sans redirection silencieuse v1→v2, sans second QR sur retry. Reprint après redémarrage API = **même** URL / QR.

---

# 21. Intégration modules Somafrik

```text
Référentiels pédagogiques (countries, levels, streams)
     ↓
Classes / inscriptions
     ↓
Matières / school_courses / enseignants (+ titulaire à créer)
     ↓
Évaluations
     ↓
Notes (grades)
     ↓
Présences (optionnel, champs schema)
     ↓
Calcul des résultats (engine unique)
     ↓
Bulletin (snapshot)
```

Le bulletin **n’écrit pas** dans `grades`. Il peut **refuser de publier** si le profil l’exige (évaluations non publiées, trimestre ouvert).

`exams` / `exam_results` : hors SoT bulletin. Un type d’évaluation `examen` peut alimenter la composante EX.

Finance / paiements : **aucune** dépendance. Pas de blocage bulletin pour impayés dans ce mandat (si produit plus tard : policy séparée, pas dans l’engine).

---

# 22. Traçabilité

Champs snapshot / ligne à exiger au LOT 4 :

| Champ | Source |
| --- | --- |
| généré par / at | principal + timestamptz |
| validé par / at | idem |
| publié par / at | idem (`published_by` aujourd’hui **absent** de `report_cards`) |
| version moteur | constante build / semver engine |
| version référentiel | `grading_profile_version_id` + hash spec |
| version template / schema | ids |
| dernière correction / motif | `correction_of_id`, `correction_reason` |
| hash payload | SHA-256 (`snapshot_sha256`) des **bytes canoniques** (JCS ou blob) |
| signature | `snapshot_signature` + `signing_key_id` + `signature_alg=Ed25519` (clé privée **hors PostgreSQL**) |
| identité publique | `public_id` + `token_hash` + `token_ciphertext` (A) ; jamais le secret en clair ; jamais le token ni un préfixe dans les logs |
| wrapping | `wrapping_key_id` — clé KMS **hors PostgreSQL** |
| statut vérification | ACTIVE / SUPERSEDED / REVOKED |
| idempotence publish | `UNIQUE (report_card_id, published_snapshot_version)` |

`audit_logs` conserve l’append-only. L’outbox C4 reste dérivé du statut, pas l’inverse.

---

# 23. Cartographie « A » condensée (checklist mandat)

| Concept | PG | API | Service | Web | Mobile | Contrainte / legacy |
| --- | --- | --- | --- | --- | --- | --- |
| Pays | `countries` | education-reference, platform | educationReference / platform | Superadmin | JWT country | hardcode CD→RDC affichage |
| Établissement | `schools` | establishments, settings | establishment | Paramètres | session | logo PDF ≠ `logo_url` |
| Années | `academic_years` | academic-years | schoolSettings | Paramètres | — | — |
| Périodes | `terms` + `period_mode` | settings | schoolSettings | filtres notes | period query PDF | noms libres |
| Niveaux | `education_levels` + `school_levels` | education-reference, classes | classesRepository | Classes | Classes | OK catalogue |
| Classes | `classes` | /classes | classesRepository | Entity / pédagogie | ClassesScreen | — |
| Matières | `subjects` | /courses | pedagogy | Matières | cours | coef défaut |
| Groupes matières bulletin | **∅** | — | — | — | — | **GAP** |
| Évaluations | `evaluations` | /evaluations | pedagogyService | GradesEvaluationsPage | Evaluations | statuts UI/PG |
| Notes | `grades` | /notes | pedagogyService | GradeEntry | saisie notes | pas de table `notes` |
| Coefficients | subjects / school_courses / evaluations | DTO notes | pedagogyPgStore | gradeBook | pedagogyAverage | 3 niveaux |
| Maxima | max_score éval/note ; default_scale | body | gradesCanonical | scale | scale | pensée /20 |
| Présences | `attendance` | /attendance | presence | Présences | Présences | pas dans bulletin |
| Élèves | `students` | /students | students | Élèves | Élèves | — |
| Inscriptions | `enrollments` | classes enroll | classStudents | Inscrire | — | 1 classe / année |
| Enseignants | `teachers` + assignments | /teachers | teacherAssignments | Affectations | — | pas titulaire classe |
| Classement | — | generateReport mémoire | GradeBookService | gradeBook | affiche rank API | non persisté |
| Bulletins | `report_cards` | /report-cards | documentsExams | EntityPage + GrapesJS | ReportCardsScreen | pas de snapshot |

---

# 24. Décisions à trancher par le CTO (hors implémentation)

1. Confirmer **pilote Burundi** = fixtures A + B, pas un `country_pack_bi.js`.
2. Confirmer **Superadmin-only** pour la structure technique (mandat 6 bis) et **retrait progressif de GrapesJS** comme SoT.
3. Confirmer qu’un bulletin **annuel** est une carte `scope=annual` distincte, pas T3 recyclé.
4. Titulaire de classe : nouveau `assignment_role=homeroom` vs slot manuel Superadmin.
5. Seuil de publication si notes `MISSING` : bloquer vs publier avec mentions.
6. Réutilisation d’un template `BI-001` **cross-écoles** (catalogue national) dès le pilote, ou seulement intra-école.
7. Conservation des `report_cards` already `published` : gel PDF legacy vs snapshot one-shot volontaire.
8. Canonicalisation snapshot : **RFC 8785 JCS** vs blob `bytea` immuable.
9. Signature d’authenticité : **Ed25519**, clé privée hors PostgreSQL (défaut GO). HMAC/KMS seulement via ADR. Threat model **écrit** dans l’ADR LOT 0 si la signature est écartée.
10. Clé d’idempotence publication = `UNIQUE (report_card_id, published_snapshot_version)` (retry = même QR).
11. Secret QR reproductible au reprint : confirmer **A** (défaut — `token_ciphertext` KMS) vs B (HMAC/KDF) vs C (un seul opaque ≥128 bits).

---

# 25. Conformité de cette PR d’audit

| Interdiction CTO | Respect |
| --- | --- |
| Pas de migration SQL | oui |
| Pas de nouvelle route métier | oui |
| Pas de modification calcul notes | oui |
| Pas de modification UI production | oui |
| Pas de suppression de code | oui |
| Pas de changement Mobile | oui |
| Pas de modification référentiel pédagogique | oui |
| Pas de contournement RBAC | oui |
| Pas de dépendance PDF ajoutée | oui |
| Pas de feature flag actif | oui |
| Pas de merge automatique | PR Draft |

Fichier unique ajouté : `docs/audits/report-card-framework-multicountry.md`.
