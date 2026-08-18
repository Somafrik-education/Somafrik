# Planning V2 — emploi du temps hebdomadaire canonique

## Ancien modèle

La vérité métier était un **événement daté** :

- table `course_schedule_slots` : `starts_at` / `ends_at` `TIMESTAMPTZ`
- `class_name` + `subject_name` comme clés
- `teacher_id` nullable
- collisions sur **un** intervalle stocké (`tstzrange`)
- récurrence **inventée dans le navigateur** (`expandScheduleOccurrences()` + `Date.getDay()` d’un timestamp d’ancrage)

Un lundi 08:00–09:00 n’était pas une règle hebdomadaire : c’était « une date qui représente un lundi », recopiée jusqu’à 54 semaines côté Web.

Les examens (`slot_kind = exam`) partageaient la même table.

## Nouveau modèle

Table dédiée `course_schedule_weekly_slots` (PostgreSQL = seule autorité) :

| Colonne | Rôle |
| --- | --- |
| `id` | UUID PK |
| `school_id` | tenant |
| `academic_year_id` | année — pas de fuite 2025-2026 → 2026-2027 |
| `school_course_id` | FK `school_courses.id` obligatoire |
| `class_id` | dénormalisé, **cohérent** avec le cours (trigger) |
| `teacher_id` | dénormalisé, **NOT NULL**, cohérent avec le cours |
| `day_of_week` | `SMALLINT` 1=lundi … 7=dimanche |
| `start_time` / `end_time` | `TIME` local établissement, `end_time > start_time` |
| `status` | `active` \| `cancelled` \| `archived` |
| `room` | texte historique optionnel (pas d’entité salles V2) |

`class_name` / `subject_name` / `teacherName` : **projections DTO uniquement**.

`course_schedule_slots` reste pour les **examens datés** et l’historique non migré. Pas de mélange récurrence de cours / événement d’examen.

Pas de `term_id` / `valid_from` dans cette PR : un EDT appartient à `academic_year_id`.

## Stratégie migration

**Cette PR ne convertit aucune ligne historique.**

La migration SQL `20260828_course_schedule_weekly_canonical.sql` crée uniquement la table vide `course_schedule_weekly_slots`. Elle ne contient aucun `INSERT … SELECT` depuis `course_schedule_slots`.

Le preflight n’est **pas** un backfill. C’est un **inventaire de classification** :

| Chemin | Rôle |
| --- | --- |
| Boot PostgreSQL `ensurePlanningWeeklyPreflight` | après `PEDAGOGY_SCHEMA_SQL` : classe les lignes datées, journalise le résumé, **n’écrit pas** dans weekly |
| `node backend/scripts/inventory-planning-weekly-preflight.js` | même inventaire, exécutable / CI |
| `SOMAFRIK_PLANNING_WEEKLY_BACKFILL=1` | **STOP** (`PLANNING_WEEKLY_BACKFILL_REFUSED`) — y compris si toutes les lignes sont `MIGRATABLE`. Aucun INSERT n’est implémenté |

| Classe | Règle |
| --- | --- |
| `EXAM` | `slot_kind = exam` — hors planning cours hebdomadaire |
| `ORPHAN` | `class_id`, matière ou `school_course` introuvable |
| `AMBIGUOUS` | matière non unique, enseignant null/incohérent, horaire indéterminable |
| `MIGRATABLE` | classe + matière unique + `school_course` actif unique + teacher cohérent + jour/heure déterminables |

Un futur lot de backfill devra : (1) échouer si `AMBIGUOUS`/`ORPHAN` restent, (2) ne jamais convertir `EXAM`, (3) n’insérer que les `MIGRATABLE` après validation CTO. Ce n’est **pas** ce lot.

Les examens restent dans `course_schedule_slots`. Les nouvelles écritures Planning V2 vont uniquement dans `course_schedule_weekly_slots`.

## Contraintes

- `CHECK (day_of_week BETWEEN 1 AND 7)`
- `CHECK (end_time > start_time)` — pas de cours à cheval sur minuit
- Trigger de cohérence `school_course` ↔ `class_id` / `teacher_id` / `academic_year_id` / tenant
- Extension `btree_gist`

## Collisions (P0, backend/PG)

Chevauchement `[start_time, end_time[` (08:00–09:00 puis 09:00–10:00 autorisé).

Deux `EXCLUDE USING gist` sur les lignes `status = 'active'` :

1. même établissement + année + **classe** + jour + `slot_minutes &&`
2. même établissement + année + **enseignant** + jour + `slot_minutes &&`

Code PostgreSQL `23P01` → HTTP 409 `COURSE_SCHEDULE_CONFLICT`.

Deux POST concurrents du même créneau : **une seule** réussite (contrainte d’exclusion, pas SELECT-then-INSERT).

Collision salle : hors P0 (pas d’entité `rooms`).

## RBAC (#260 conservé)

| Méthode | Grant |
| --- | --- |
| GET | `Planning de cours:READ` |
| POST | `Planning de cours:CREATE` |
| PATCH | `Planning de cours:UPDATE` |
| DELETE | `Planning de cours:DELETE` |

Pas d’autorité « Gérer planning académique ».

Parent / secrétaire : 403. Enseignant : GET 200, écritures 403. Préfet / Admin School : CRUD.

GET enseignant : filtre `teachers.id` via JWT (`sub` / `user_code` / `teacher_code`), **jamais** `teacherName` / `className`.

## DTO

```json
{
  "id": "…",
  "schoolCourseId": "…",
  "academicYearId": "…",
  "classId": "…",
  "teacherId": "…",
  "subjectId": "…",
  "dayOfWeek": 1,
  "startTime": "08:00",
  "endTime": "09:00",
  "status": "active",
  "className": "2ème A",
  "courseName": "Mathématiques",
  "teacherName": "Seke Kilombo"
}
```

Les libellés sont des projections.

## API

Mêmes chemins `/api/course-schedules`.

**POST / PATCH** — autorité :

```json
{
  "schoolCourseId": "…",
  "academicYearId": "…",
  "dayOfWeek": 1,
  "startTime": "08:00",
  "endTime": "09:00"
}
```

`className` + `subject` comme autorité → 400. `schoolCourseId` hors tenant → 404 fail-closed.

Validations CREATE et PATCH (champs d’emploi du temps) : tenant, cours actif, affectation enseignant, année de l’établissement ouverte et cohérente avec la classe, collisions.

**GET** filtres serveur : `academicYearId`, `classId`, `teacherId`, `schoolCourseId`, `dayOfWeek`.

- sans `from`/`to` : tableau de **définitions hebdomadaires** (`status=active` par défaut)
- avec `from` & `to` (dates civiles `YYYY-MM-DD`) : `{ "projection": "occurrences", "timeZone", "items": [...] }` généré **serveur** (fuseau établissement, pas navigateur)

**DELETE** : transition `status = cancelled` (pas de `DELETE FROM`). Réponse `{ cancelled: true, deleted: false }`. L’historique et l’audit restent.

Audit CREATE / UPDATE / CANCEL dans la même transaction : actor, school_id, schedule_id, school_course_id, academic_year_id, oldValue, newValue, timestamp.

## Récurrence

La définition PG est l’autorité. Le backend matérialise les occurrences pour une plage. Le Web peut afficher `dayOfWeek` + `startTime` ; il ne doit plus inventer le jour via `Date.getDay()` d’un ancrage.

## Limites restantes (hors cette PR)

- `PLANNING_WEB_UI_ENABLED = false` — menu `/planning` gelé jusqu’à revalidation CTO
- pas de salles V2, remplacements, Mobile Planning, lien présences↔schedule_id, cahier, examens V2
- pas de fail-closed global `canAccess()`
- pas de `term_id` / `valid_from` (changement d’EDT intra-année)
- pas de backfill historique (inventaire + STOP si `SOMAFRIK_PLANNING_WEEKLY_BACKFILL=1` ; aucun INSERT `MIGRATABLE` dans ce lot)
- `POST /api/courses` toujours hors `routePermissions` (P1 historique)

## Procédure rollback

1. Ne pas merger / reverting la PR si déjà déployée : `git revert` du commit Planning V2.
2. Les écritures weekly cessent ; `course_schedule_slots` daté n’a pas été détruit.
3. Les lignes `course_schedule_weekly_slots` peuvent rester en base (inertes si le code V1 est rétabli). Ne pas `DROP TABLE` sans inventaire.
4. Réactiver l’UI `/planning` est **interdit** par rollback seul : le flag reste `false`.

**Aucun Ready. Aucun merge sans revalidation CTO GitHub indépendante.**
