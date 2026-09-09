# Audit Lot L5 — TEACHER_REPLACEMENT (GREEN)

## Identifiants Git

| Champ | Valeur |
|---|---|
| Base SHA | `0c79ed4099b6148df97e27e076fb7aa17d155f00` |
| Branche | `cursor/communications-teacher-replacement-d98a` |
| HEAD SHA | `6f750761` |

## SoT replacement

**Table :** `course_schedule_replacements` (ponctuel par `occurrence_date`).

Ne modifie jamais `school_courses.teacher_id` ni `course_schedule_weekly_slots.teacher_id`.

Statuts : `planned` | `completed` | `cancelled`.

## Distinction L4 / L5

| Mutation | Événement |
|---|---|
| `INSERT/UPDATE/CANCEL` remplacement ponctuel | `planning.teacher.replacement` → `TEACHER_REPLACEMENT` |
| `UPDATE course_schedule_weekly_slots` (créneau actif) | `planning.timetable.changed` → `TIMETABLE_CHANGED` uniquement |

Tests : création remplacement → `TEACHER_REPLACEMENT=1`, `TIMETABLE_CHANGED=0` ; update weekly slot → inverse.

## RED initial

Sur `develop@0c79ed40` sans L5 : `createCourseScheduleReplacement(...)` créait le remplacement PG mais **0** event C4 `TEACHER_REPLACEMENT`.

## Event type

`planning.teacher.replacement` → mapping Lot I `TEACHER_REPLACEMENT`.

Action métier dans le payload : `assigned` | `reassigned` | `cancelled`.

## Event key

```
planning.teacher.replacement:<replacement_id>:<change_revision>
```

## change_revision

Colonne `BIGINT` sur `course_schedule_replacements`, bump **dans PostgreSQL** (`trg_course_schedule_replacements_bump_revision`) :

| Transition | Révision |
|---|---|
| INSERT `planned` | 1 |
| réaffectation remplaçant (`planned`, substitute change) | OLD + 1 |
| annulation (`planned` → `cancelled`) | OLD + 1 |
| reason / note / `planned` → `completed` | pas d'incrément, pas d'event |

Annulation + changement remplaçant atomique → `cancelled` (snapshot OLD substitute).

## Bootstrap

`backend/db/courseScheduleReplacementChangeRevision.sql` dans `PEDAGOGY_SCHEMA_SQL` **avant** `ensureClientsCanonicalBootstrap()`.

Producteur dédié `somafrik_enqueue_teacher_replacement_event()` + `trg_c4_teacher_replacement_event` dans `COMMUNICATIONS_C4_SCHEMA_SQL` (`teacherReplacementOutbox.sql`).

Test **RED-TR-BOOT** : schema.sql → PEDAGOGY → bootstrap, sans migration L5 manuelle.

## Migration

`backend/db/migrations/20260918_communication_teacher_replacement_outbox.sql` (idempotente, converge bootstrap + upgrade).

## Payload snapshot immuable

Produit dans le trigger (pas rechargé au drain) : `replacementId`, `changeRevision`, `action`, `weeklySlotId`, `classId` (via join slot), `academicYearId`, `occurrenceDate`, `originalTeacherId`, `substituteTeacherId`, `previousSubstituteTeacherId`, `startTime`, `endTime`, `status`.

## Recipients Lot I

| Action | PARENT | TEACHER | SCHOOL_ADMIN |
|---|---|---|---|
| assigned | classe (dedupe) | titulaire + remplaçant | oui |
| reassigned | classe | titulaire + ancien + nouveau remplaçant | oui |
| cancelled | classe | titulaire + remplaçant avant annulation (OLD) | oui |

Résolution parents : `listClassParentUserIds(schoolId, [classId])` (enrollments + contact_relations canoniques).

## Policy / préférences

Moteur Lot I inchangé : policy établissement AND préférences utilisateur. Tests RED-TR-20/21/20b.

## Rollback

Mutation invalide (ex. remplaçant = titulaire) → rollback transaction → 0 ligne replacement, 0 outbox (RED-TR-23).

## Non-régression

- L4 `TIMETABLE_CHANGED` : producteur partagé **non modifié** ; fonction dédiée L5.
- Weekly slot `change_revision` inchangé lors d'un remplacement (RED-TR-26).
- 8 producteurs L1–L4 préservés.

## AUDIT-COM-FINAL

**9/9** Lot I câblés ; `missingProducers = []`.

## P0 / P1 / P2

| Niveau | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 (fenêtre at-most-once Lot K documentée historiquement) |

## Verdict L5

**GREEN technique** — producteur `TEACHER_REPLACEMENT` câblé, tests RED-TR-01→27 + BOOT verts.

## Verdict Communications global

Sous réserve CI HEAD et diff CTO indépendant : **Communications — GO technique** (9/9, P0/P1=0). Ne constitue pas un GO production global.
