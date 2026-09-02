# AUDIT COMPLET — PLANNING DES COURS V2

**Mode :** audit uniquement. Aucun correctif métier. Aucune restauration de menu. Aucune migration SQL.

| Champ | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Branche audité | `develop` |
| SHA audité | `6751f8ea0c5af38025e5dc475deb322d799d318d` |
| Commit | `Merge pull request #257 from Somafrik-education/audit/notes-par-classe-statistiques` |
| Date d’audit | 2026-08-18 |
| Branche rapport | `audit/planning-cours-v2-complet` |

**Question tranchée :** Somafrik possède **une table PostgreSQL réelle** (`course_schedule_slots`) et des **APIs d’écriture LOT 5**. Ce n’est pas du JSON BackOffice mort. Ce n’est **pas** non plus un emploi du temps hebdomadaire V2 sain : le Web **existe encore** (routes + pages) mais est **masqué par RBAC** (jeton `Planning de cours` absent de la matrice live), le grain PG est un **timestamp daté**, et le créneau **ne référence pas** `school_courses.id`.

**Ne pas remettre un bouton Planning dans le menu** tant que le grant RBAC, le grain (hebdo vs daté) et le lien cours canonique ne sont pas tranchés.

---

## 1. SHA audité

```text
git fetch origin
git checkout develop
git pull --ff-only origin develop
git status --short --branch   → ## develop
git rev-parse HEAD            → 6751f8ea0c5af38025e5dc475deb322d799d318d
```

```text
SHA exact develop  = 6751f8ea0c5af38025e5dc475deb322d799d318d
working tree clean = oui
date audit         = 2026-08-18
```

`develop` a avancé depuis les SHA #257/#258 (`e84fe5d7`) : **#257 est mergé** dans ce HEAD. Ne pas réutiliser un SHA antérieur.

---

## 2. Résumé exécutif

| Question | Réponse |
| --- | --- |
| Le module a-t-il été **supprimé** ? | **Non.** Routes, pages, loaders, APIs, table PG, tests HTTP+PG existent. |
| Existe-t-il mais n’est plus routé ? | **Non.** `/planning` est toujours dans `App.tsx`. |
| Existe-t-il mais **masqué par RBAC** ? | **Oui — cause principale de « disparition » Web.** |
| Seulement backend ? | Non. Web complet (calendrier) + placeholders salles/remplacements. |
| Code legacy mort ? | Partiel : `PUT /api/backoffice/planning-exams` est un refus explicite. Seed mémoire encore utilisé hors PG. |
| Remplacé par un autre concept ? | Non. Les examens ont un module séparé ; une partie du calendrier mélange `slot_kind=exam`. |

**Source de vérité (moteur PostgreSQL) :** table `course_schedule_slots` via `listPedagogyProjection` / overlay. **Pas** `backoffice_state`. **Pas hybride** en lecture PG (l’overlay **remplace** `courseSchedules`). Fallback mémoire = seed `data.js` si le moteur n’est pas PG.

**Scénario recommandé : C — reconstruction métier partielle.** Réactiver le menu **sans** corriger RBAC + grain + `school_course_id` exposerait un emploi du temps **récupérable mais non canonique**.

---

## 3. Historique de disparition

Le menu **n’a jamais été retiré** de `NAV_ITEMS`. Preuve `git log -S 'view: "planning"' -- web/src/lib/constants.ts` : un seul hit, l’introduction.

| Date | SHA | Fait |
| --- | --- | --- |
| 2026-07-03 | `5d6e71e2` | Introduction Planning Web : `NAV_ITEMS`, `VIEW_PERMISSION_FEATURES.planning = "Planning de cours"`, pages calendrier. **`securityMatrix` de `data.js` n’a jamais reçu la ligne `Planning de cours`.** |
| 2026-07-06 | `8ec8e38e` | `schoolOnly: true` sur l’item. Super Admin : `canAccessSchoolBackOffice` = **false** → plus de pédagogie établissement dans le sidebar. |
| 2026-08-13 | `9c06fbac` | LOT 5 : `school_courses` + `course_schedule_slots`, APIs `/api/course-schedules`. |
| 2026-08-14 | `319d989f` | `resolveEffectivePermissions` : si une source canonique existe, **les défauts internes (`Planning de cours:READ`) ne s’appliquent plus**. |

**Dernier commit où l’entrée de nav existait :** le HEAD actuel (elle existe encore).

**Premier commit où elle « disparaît » pour l’utilisateur :** pas une suppression de fichier. Combinaison :

1. la vue exige le jeton **`Planning de cours:READ`** ;
2. la matrice live / `securityMatrix` **n’émet pas** ce jeton ;
3. le legacy **`Gérer planning académique`** ne matche **pas** le nom de module `Planning de cours` (`"planning academique".includes("planning de cours")` = faux) ;
4. le backfill RBAC (`backfillMissingGlobalModuleGrants`) **n’insère pas** un grant tout-false.

Ce n’est **pas** une suppression volontaire documentée du produit. C’est une **régression d’alignement RBAC** après LOT 2 + catalogue fonctionnel.

---

## 4. Routes / menu Web

| Élément | Existe | Accessible | Route/Menu | État |
| --- | --- | --- | --- | --- |
| Item sidebar « Planning de cours » | oui | **RBAC** `Planning de cours:READ` | `NAV_ITEMS` → `/planning` | **masqué** si grant absent |
| `PermissionRoute view="planning"` | oui | idem | `App.tsx` 214–233 | URL directe = Forbidden sans grant |
| Layout onglets | oui | si route OK | `PlanningLayout.tsx` | Emploi du temps / Salles / Remplacements / Conflits |
| `/planning` → `emploi-du-temps/calendrier` | oui | | `CoursePlanningPage.tsx` | **page métier réelle** |
| `/planning/emploi-du-temps/par-classe` | oui | | `TimetableByClassPage.tsx` | lecture créneaux |
| `/planning/emploi-du-temps/par-enseignant` | oui | | `TimetableByTeacherPage.tsx` | lecture |
| `/planning/emploi-du-temps/par-salle` | oui | | `ComingSoonState` | placeholder |
| `/planning/salles` | oui | | placeholder | non fonctionnel |
| `/planning/remplacements` | oui | | placeholder | non fonctionnel |
| `/planning/conflits` | oui | | `PlanningConflictsPage.tsx` | audit client + sync API |
| `/planning/affectations` | redirect | | → `/etablissement/enseignants` | volontaire |
| Super Admin | — | **non** | hors `SUPER_ADMIN_ALLOWED_VIEWS` | verrouillage plateforme |
| Domain loaders `/planning` | oui | | `academicConfigs`, `courseSchedules`, `exams`, `classes`, `teachers`, `courses` | **assignments non chargé** |

---

## 5. Mobile

| | |
| --- | --- |
| Écran | `Mobile/src/screens/TimetableScreen.tsx` — **présent** |
| Menu | « Emplois du temps » / « Mon emploi du temps » |
| Guard | `view: "Timetable"` → feature **`Années Académiques`** (`Mobile/src/lib/constants.ts`), **pas** `Planning de cours` |
| Catalogue fonctionnel | `planning.appliesMobile = false` |
| Données | `courseSchedulesData` (sync admin) **sinon repli `timetable` mock** `Mobile/src/data/catalog.ts` |
| API d’écriture | **aucune** |
| Verdict Mobile | **partiel / dangereux** : consultation si sync ; **demo locale** si vide ; RBAC **mauvais module** |

---

## 6. Architecture métier actuelle

```text
UI Web CoursePlanningPage (jour semaine + HH:mm + période)
  → expandScheduleOccurrences() côté client (récurrence synthétique)
  → POST/PATCH/DELETE /api/course-schedules
  → pedagogyService.createCourseSchedule
  → course_schedule_slots (starts_at / ends_at TIMESTAMPTZ = UNE occurrence ancre)
  → GET /api/course-schedules
  → getAuthoritativeBackOfficeState → overlayPedagogyProjection (PG)
  → state.courseSchedules
```

Un **créneau** actuel = une ligne `course_schedule_slots` : classe + libellé matière + enseignant optionnel + intervalle UTC + salle texte + kind `course|exam` + période texte/dates.

Un **cours** V2 (`school_courses`) = `class_id` + `subject_id` + `teacher_id` + coefficient + statut. **Pas de FK** depuis le créneau.

Relation enseignant : à l’écriture, `resolveTeacherWithActiveAssignment` (class_id + subject_id + année ouverte). Si `teacherId` payload **vide**, l’affectation **n’est pas exigée**.

---

## 7. Modèle PostgreSQL

Table réelle : **`course_schedule_slots`** (`backend/db/pedagogySchema.js`, migration `20260813_pedagogy_canonical.sql`). Pas de table `schedules` / `timetable` / `rooms`.

| Colonne | Présent |
| --- | --- |
| `id` UUID PK | oui |
| `school_id` FK schools | oui |
| `class_id` FK classes NOT NULL | oui (après backfill LOT 5) |
| `class_name` TEXT | oui (**libellé dupliqué**) |
| `subject_id` | **non** |
| `subject_name` TEXT | oui |
| `school_course_id` | **non** |
| `teacher_id` FK teachers | oui, **nullable** |
| `academic_year_id` / `term_id` | **non** |
| `day_of_week` | **non** (déduit de `starts_at`) |
| `starts_at` / `ends_at` TIMESTAMPTZ | oui, CHECK `ends_at > starts_at` |
| `room` TEXT | oui, pas de table salles |
| `slot_kind` | `course` \| `exam` |
| `period_name`, `period_start`, `period_end` | oui (texte/date, pas FK `terms`) |
| `legacy_json_id` | oui |
| `profile_payload` JSONB | teacherId/teacherName client |
| `active` / soft delete | **non** |
| `created_by` / `updated_by` | **non** (audit_logs à part) |
| UNIQUE exclusion horaire | **non** (seulement unique `school_id, legacy_json_id`) |
| Index | `(school_id, class_name, starts_at)` |

`school_courses` : unique actif `(school_id, class_id, subject_id)`. **Deux modèles parallèles.**

`attendance` : `school_id + student_id + class_id + date` — **pas** `schedule_id`.

---

## 8. API

| Méthode | Route | RBAC middleware | Tenant | SQL | Tests |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/course-schedules` | **auth only** (pas `requirePermission`) | `filterRows` + filtre enseignant **nom/id** | projection globale PG puis JS | lecture dans verify-pedagogy |
| POST | `/api/course-schedules` | `requirePermission("POST /api/course-schedules")` **absent du catalogue** → **fail-open** | school du principal | insert + conflits `tstzrange [)` | HTTP+PG 201 / 404 / 409 |
| PATCH | `/api/course-schedules/:id` | même clé POST → **fail-open** | `assertTenant` | update + conflits | 403 si matière sans affectation |
| DELETE | `/api/course-schedules/:id` | fail-open | `assertTenant` | **DELETE physique** | — |
| GET | `/api/courses` | auth only | filterRows | projection `school_courses` | oui |
| PUT | `/api/backoffice/planning-exams` | catalogué | — | **interdit** (`LEGACY_EXAMS_WRITE_FORBIDDEN`) | verify-documents-exams |

GET enseignant : `slot.teacherId` vient du **JSON profile**, pas forcément `teachers.teacher_code` / UUID. Fuite ou trou de scope possibles.

Pas d’endpoints dédiés « planning classe / jour / semaine » : un GET établissement, filtrage **client**.

Codes métier : `400` horaires, `403` `TEACHER_ASSIGNMENT_REQUIRED` / `TENANT_MISMATCH`, `404` classe/matière, `409` `COURSE_SCHEDULE_CONFLICT`.

---

## 9. Création / modification / suppression

**Création** (`pedagogyService.js` 191–257) : classe + cours (libellés) obligatoires ; horaires ISO ; année **ouverte** de la classe ; période optionnelle résolue sur `terms` **si** `periodName` ; enseignant seulement si `teacherId` fourni ; conflits classe **ou** teacher_id ; audit `create_course_schedule`.

**Modification** : revalide classe/matière/année ; si `teacherId` patché ou classe/matière changée, ré-exige l’affectation ; 409 si conflit.

**Suppression :** `DELETE FROM course_schedule_slots` — **destructif**, audité (`oldValue`). Pas d’archive. Impact présences/notes : **aucun** (pas de FK).

Transaction : `withTransaction` oui. Contrainte exclusion SQL : **non**. Deux POST concurrents peuvent tous deux passer `listScheduleConflicts` puis insérer (**race P1/P0 selon criticité**).

---

## 10. Conflits horaires

| Contrôle | Où | Règle |
| --- | --- | --- |
| UI | `detectScheduleConflicts` + `expandScheduleOccurrences` | récurrence **expandée** (lundi×semaines de période) |
| Backend insert | `tstzrange(starts_at, ends_at, '[)')` | **une** occurrence stockée ; classe **libellé** OU `teacher_id` |
| Salle | ni UI forte ni SQL | champ texte libre |
| `[start,end[` | SQL `'[)'` | 08:00–09:00 et 09:00–10:00 : **pas** conflit — conforme |
| 08:00–09:00 vs 08:30–09:30 **même timestamp** | SQL | conflit 409 |
| Même lundi **autre semaine** (récurrence UI) | SQL | **peut passer** : timestamps différents |

**Un contrôle UI seul pour la récurrence réelle.** Le SQL ne voit pas les occurrences générées.

---

## 11. Année / périodes

- Année : **exigée ouverte à l’écriture** via la classe (`assertOpenAcademicYearForClass`). **Pas stockée** sur le créneau.
- Période : `period_name` / dates sur la ligne ; résolution `terms` seulement si nom fourni.
- N vs N+1 : pas de `academic_year_id` → contamination possible si on réutilise les mêmes dates/libellés.
- Fermeture d’année / copie N+1 : **non implémenté** pour les créneaux.
- Vacances / fériés / journées pédagogiques : **aucun** calendrier d’exception.

---

## 12. Cours et affectations

| Chaîne | Réel |
| --- | --- |
| `teacher_assignment` class_id + subject_id | **oui à l’écriture si teacherId** |
| `school_course_id` sur le slot | **non** |
| Autorité `className` / `subject` texte | **oui** (ingress + conflits classe) |
| Enseignant non affecté | 403 `TEACHER_ASSIGNMENT_REQUIRED` **si** teacherId |
| Enseignant affecté classe autre matière | 403 |
| Affectation inactive | 403 |
| Autre établissement | school du JWT ; `schoolCode` client ignoré |
| POST sans teacherId | **créneau orphelin autorisé** |

Deux modèles : `school_courses` (UUID) **et** `course_schedule_slots` (noms). Risque de cours archivé encore planifié, et de planning sans ligne `school_courses`.

---

## 13. RBAC

| Rôle | Voir planning Web | Créer | Modifier | Supprimer |
| --- | --- | --- | --- | --- |
| Superadmin | **non** (vues plateforme) | n/a UI | n/a | n/a |
| Admin School | **théorique** `internalRoleDefaults` CRUD ; **live** souvent **non** (matrice sans module) | idem | idem | idem |
| Directeur | defaults **sans** Planning | non | non | non |
| Préfet | defaults CRUD Planning ; live **incertain** (même trou matrice) | | | |
| Enseignant | defaults READ only ; live **incertain** | non (defaults) | non | non |
| Parent / Élève | **non** (Web schoolOnly + pas de grant) | — | — | — |

Distinctions :

- **UI** : `canReadView("planning")` → `Planning de cours:READ`.
- **Endpoint GET** : pas de permission module.
- **Endpoint POST** : catalogue rbac **muet** = autorise tout utilisateur authentifié.
- **Service** : affectation enseignant si `teacherId`.

Legacy `Gérer planning académique` (Admin School / Préfet dans `data.js`) **ne débloque pas** la vue Web.

---

## 14. Tenant

Écriture : `ignoreClientScope` + school du principal. Test HTTP : POST avec `schoolCode` étranger → ligne du tenant JWT.

Lecture GET : filtre `tenantScopeService.filterRows`. UUID étranger en PATCH : `getScheduleById` + `assertTenant` → 403.

**Pas de preuve d’exclusion SQL `school_id` manquante** sur l’insert (school vient du contexte). Risque plutôt **GET trop large** (tout l’établissement, y compris parent authentifié).

---

## 15. Présences / séances

Présence = **classe + élève + jour**, pas créneau. Aucune table `lesson` / `course_session` / cahier de textes liée au slot.

Le planning **n’engendre pas** une séance d’appel. Domains **indépendants**.

Notes / évaluations : **pas** de FK planning. Frontière correcte (une éval n’a pas à dépendre d’un créneau).

Examens : module `/examens` (EntityPage, souvent read-only calendrier) **et** `slot_kind=exam` dans les mêmes slots. `PUT planning-exams` mort. Risque de double calendrier.

---

## 16. Legacy

- `PUT /api/backoffice/state` : pédagogie dont `courseSchedules` **non writable** (`legacyPedagogyStateWrite.js`).
- `PUT /api/backoffice/planning-exams` : **interdit**.
- Seed `buildSchoolPlanningSlots` / `data.js` : encore pour mémoire / tests.
- `profile_payload` + `legacy_json_id` : pont JSON → PG.
- Mobile mock `timetable` si sync vide.

**Ne pas** « recoller le menu » sur du `DataContext.update` legacy : les écritures Web passent déjà par `/api/course-schedules`.

---

## 17. Domain loaders

`courseSchedules` est un domaine canonique (`canonicalDomains.ts`, `domainLoaders.ts` → GET `/course-schedules`).

`/planning` charge : configs, slots, exams, classes, teachers, **courses**. **Pas `assignments`.** Le calendrier résout l’enseignant via `resolveCourseTeacher` / state ; les affectations JWT peuvent manquer (famille #248).

Le loader **n’a pas été retiré**. La disparition n’est pas « snapshot global enlevé ».

---

## 18. Tests

| Test | Type |
| --- | --- |
| `backend/lib/pedagogyRepository.pg.test.js` | **PG réel** create/conflit/class_id |
| `backend/scripts/verify-pedagogy-management.js` | **HTTP+PG** POST schedule, 404 classe, PATCH 403 affectation, tenant |
| `backend/scripts/verify-planning-conflicts.js` | moteur JS conflits (pas PG) |
| `web/scripts/verify-planning-rules.ts` | règles Web |
| `PlanningPlaceholders.test.tsx` | ComingSoon salles |
| Clic menu « Planning de cours » | **aucun** |
| Playwright emploi du temps | **aucun** |
| Mobile Timetable | **aucun** test d’API réelle |
| `functional-rbac` | catalogue modules ; **pas** de grant Planning dans securityMatrix |

Le backend Planning **existe** même si l’UI est invisible : les tests LOT 5 le prouvent.

---

## 19. E2E PostgreSQL

Scénario mandaté IN / Seke / 2ème A / Math / lundi 08:00–09:00.

| # | Étape | Faisable aujourd’hui ? |
| --- | --- | --- |
| 1 | POST créneau 08:00–09:00 | **oui** (HTTP LOT 5) |
| 2 | Vérifier PG | **oui** `course_schedule_slots` |
| 3 | GET planning classe | **partiel** : GET établissement + filtre JS `className` |
| 4 | GET planning enseignant | **partiel** : filtre nom/profile, pas JWT assignments |
| 5 | autre enseignant | **flou** (RBAC GET ouvert + filtre nom) |
| 6 | autre établissement | **oui** 403/ignore schoolCode |
| 7 | conflit classe 08:30 | **oui si même `starts_at` day** ; **non garanti** si autre lundi de la période |
| 8 | conflit enseignant | **oui si `teacher_id` UUID renseigné** |
| 9 | 09:00–10:00 accepté | **oui** (`[)`) |
| 10 | PATCH heure | **oui** |
| 11 | relire nouvelle session | **oui** overlay PG |
| 12 | désactiver/annuler | **non** — seulement DELETE |
| 13 | audit | **oui** `audit_logs` |

Environnement d’audit : pas de harnais préprod IN. Preuves = tests LOT 5 déjà dans le dépôt.

---

## 20. P0

### PLANNING-P0-001 — Vue Web exigée absente de la matrice live

| | |
| --- | --- |
| Couche | RBAC Web + bootstrap `role_module_permissions` |
| Fichiers | `web/src/lib/constants.ts` 65, 121 ; `backend/data.js` `securityMatrix` (pas de `Planning de cours`) ; `functionalRbacResolution.js` 186–194 ; `permissions.ts` 122–140 |
| Scénario | Admin School / Préfet ouvre le back-office : pas d’entrée Pédagogie « Planning » ; `/planning` → Forbidden |
| Impact métier | Emploi du temps **inaccessible** alors que PG/API existent |
| Impact sécurité | faible (refus) |
| Preuve | moduleName `Planning de cours` ⊄ token `Gérer planning académique` ; defaults skippés dès source canonique |
| Correctif | Ajouter le module à la matrice live (grants Admin/Préfet/Enseignant READ) **sans** se contenter d’un lien de menu |

### PLANNING-P0-002 — POST/PATCH/DELETE `/api/course-schedules` fail-open

| | |
| --- | --- |
| Couche | `rbacService.routePermissions` + `canAccess` si clé absente → `true` |
| Fichiers | `server.js` 716–740 ; `rbacService.js` 422–429 |
| Scénario | Tout JWT authentifié (y compris parent) peut appeler POST |
| Impact | pollution planning ; forge de créneaux sans teacherId |
| Preuve | clé absente du catalogue ; `createCourseSchedule` accepte `teacherId` vide |
| Correctif | Cataloguer `Planning de cours:CREATE/UPDATE/DELETE` ; exiger enseignant+affectation |

### PLANNING-P0-003 — Récurrence UI vs conflit SQL

| | |
| --- | --- |
| Couche | métier |
| Fichiers | `coursePlanning.ts` `expandScheduleOccurrences` ; `pedagogyPgStore.js` `listScheduleConflicts` 240–248 |
| Scénario | deux « chaque lundi 08:00 » ancrés sur des dates d’occurrence différentes |
| Impact | **double réservation classe/enseignant** en production |
| Preuve | SQL sur `tstzrange` d’**une** ligne ; UI expand jusqu’à 54 semaines |
| Correctif | persister weekday+minutes **ou** contrainte d’exclusion sur (school, class, weekday, minutes, period) |

---

## 21. P1

### PLANNING-P1-001 — Pas de `school_course_id`

Créneau reconstruit `className`+`subject`. Dérive V2. Fichiers : `pedagogySchema.js` 33–56 ; `insertScheduleSlot`.

### PLANNING-P1-002 — GET `/api/course-schedules` sans permission module

Tout rôle authentifié du tenant. Parent/élève : planning **établissement entier**, pas enrollment.

### PLANNING-P1-003 — Scope enseignant GET par libellé

`server.js` 664–683 : `teacherName` / `classNames` JWT. Pas `teacher_assignments.class_id+subject_id`.

### PLANNING-P1-004 — DELETE physique sans statut

Pas d’historique métier hors `audit_logs`. Pas de lien présences.

### PLANNING-P1-005 — Race conflits (pas d’EXCLUDE / lock)

Contrôle applicatif puis INSERT.

### PLANNING-P1-006 — Mobile Timetable → `Années Académiques` + mock

Mauvais module ; demo si `courseSchedules` vide.

### PLANNING-P1-007 — Directeur / Proviseur / Secrétaire sans Planning dans `internalRoleDefaults`

Même après grant Admin, ces rôles restent hors parcours.

### PLANNING-P1-008 — `assignments` absent de `routeDomainMap` `/planning`

Régression de scope enseignant côté calendrier.

### PLANNING-P1-009 — Pas d’`academic_year_id` sur le slot

Isolation N / N+1 non garantie.

---

## 22. P2

- Salles / remplacements / EDT par salle = ComingSoon.
- Salle = TEXT, pas de collision salle.
- Mixte `slot_kind=exam` dans la table cours.
- Index conflits sur `class_name` plutôt que `class_id`.
- GET sans pagination (N classes × 40 créneaux = filtre client).
- Pas de timezone établissement (UTC des ISO).
- Super Admin ne peut pas piloter un établissement (volontaire plateforme) : ne pas « réparer » en lui rendant tout le scolaire.

---

## 23. Implémentation métier actuelle (contrat réel)

```text
Créneau     = intervalle daté UTC + classe UUID + noms classe/matière + teacher UUID nullable
Cours       = school_courses (autre table)
Planning    = ensemble de créneaux, récurrence SIMULÉE au render si periodStart/End
Jour        = getDay() du timestamp (local navigateur vs UTC : risque décalage)
Heures      = starts_at / ends_at
Salle       = string
Récurrence  = UI seulement
Date exacte = oui (c’est le stockage)
Statut      = inexistant (présent ou détruit)
Année       = gate d’écriture, pas colonne
Période     = métadonnée optionnelle
```

---

## 24. Modèle cible recommandé

Grain **hebdomadaire d’année** (emploi du temps), distinct des **exceptions datées** (examens, remplacements) :

```text
school_id
academic_year_id
school_course_id     -- pas className+subject
teacher_id           -- dénormalisé contrôlé via l’affectation du cours
weekday              -- 1–5 (contrat établissement)
start_time, end_time -- minutes local établissement, [start,end[
room_id?             -- si salles V2 un jour
status               -- active | cancelled
```

Exceptions : table datée **ou** `slot_kind` clairement séparé du cours récurrent. Présences : optionnellement `schedule_id` plus tard, **pas** un prérequis pour réactiver l’UI.

---

## 25. Écart actuel → cible

| Cible | Actuel |
| --- | --- |
| `school_course_id` | noms |
| weekday + time | TIMESTAMPTZ unique |
| `academic_year_id` | absent |
| status | DELETE |
| RBAC `Planning de cours` | trou matrice + fail-open API |
| conflits récurrence | SQL sur une date |
| salles | placeholder + TEXT |
| Mobile | mauvais module + mock |

---

## 26. Scénario A/B/C/D recommandé

**C — Reconstruction métier partielle.**

Pas A : le composant Web est viable **mais** le menu n’est pas « juste retiré » ; le modèle n’est pas un EDT hebdo correct ; l’API write n’est pas RBAC-fermée.

Pas D : LOT 5 PG + tests HTTP sont un **socle réel**, pas uniquement du JSON mort.

Pas seulement B : un grant RBAC + bouton **sans** trancher récurrence/conflits/`school_course_id` livrerait un planning **faux** (doublons lundi, cours fantômes).

Ordre conseillé après revalidation : (1) fermer P0-002 catalogue RBAC, (2) grants live `planning`, (3) grain weekday ou expansion persistée + conflits, (4) FK `school_course_id`, (5) alors seulement réafficher le menu.

---

## 27. Verdict CTO

| Couche | Verdict |
| --- | --- |
| Modèle PostgreSQL | **GO SOUS RÉSERVES** (table réelle, grain daté, pas de cours FK) |
| Backend écriture | **GO SOUS RÉSERVES** (service + tests ; teacherId optionnel) |
| API | **NO-GO** (GET/POST RBAC) |
| Web | **NO-GO accès** (masqué) / **GO SOUS RÉSERVES** code calendrier |
| Mobile | **NO-GO** (module RBAC faux + mock) |
| RBAC | **NO-GO** |
| Tenant écriture | **GO** (tests LOT 5) |
| Conflits horaires | **NO-GO** pour la récurrence affichée |
| Année académique | **GO SOUS RÉSERVES** (gate, pas de colonne) |
| Présences | **ABSENT** lien séance |
| Legacy | **GO** (writes state/planning-exams coupées) |
| Tests | **GO SOUS RÉSERVES** (PG écriture oui, UI menu non) |

```text
MODULE PLANNING = NO-GO EN L’ÉTAT POUR RÉACTIVATION MENU
SoT PG         = OUI (moteur postgresql)
EDT V2 sain    = NON
Scénario       = C
P0 / P1 / P2   = 3 / 9 / 7
```

**Aucun Ready. Aucun merge. Aucun bouton menu dans cette PR.**

Revalidation CTO GitHub indépendante obligatoire avant toute suite.
