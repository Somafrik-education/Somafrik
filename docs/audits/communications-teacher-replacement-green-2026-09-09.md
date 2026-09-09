# Audit Lot L5 — TEACHER_REPLACEMENT (GREEN)

## Identifiants Git

| Champ | Valeur |
|---|---|
| Base SHA | `0c79ed4099b6148df97e27e076fb7aa17d155f00` |
| Branche | `cursor/communications-teacher-replacement-d98a` |
| HEAD SHA | voir `git rev-parse HEAD` de la branche — dernier commit de revue CTO |
| PR | #569 (Draft) |

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

## Isolation tenant recipient (correctif P1 revue CTO #569)

Ni `teachers.user_id` ni `contacts.user_id` ne sont contraints à la même école que la ligne parente ; `notification_recipients.school_id` et `.user_id` sont deux FK indépendantes. La résolution des destinataires est donc rendue **fail-closed** par jointure explicite :

- **Parents** — `listClassParentUserIds()` joint désormais `contacts.school_id = enrollments.school_id` **et** `users.school_id = enrollments.school_id` (+ `users.status` actif).
- **Enseignants** — `resolveTeacherUser()` joint `users.school_id = teachers.school_id` (+ `teachers.status` et `users.status` actifs).

Tests : **RED-TR-28** (contact école A lié à un compte école B) et **RED-TR-29** (teacher école A lié à un compte école B) — les deux échouent sur le code d'avant correctif, passent après.

## Policy / préférences

Moteur Lot I inchangé : policy établissement AND préférences utilisateur. Tests RED-TR-20/21/20b.

## Rollback

Mutation invalide (ex. remplaçant = titulaire) → rollback transaction → 0 ligne replacement, 0 outbox (RED-TR-23).

## Concurrence

**RED-TR-30** ouvre deux connexions PostgreSQL distinctes : TX A réaffecte B→C sans committer, TX B tente C→D et reste bloquée sur le verrou ligne (vérifié explicitement), puis rejoue après le COMMIT de A. Résultat : révisions 2 puis 3, deux event keys distinctes, aucun event perdu ni écrasé, `change_revision` final = 3.

## Non-régression

- L4 `TIMETABLE_CHANGED` : producteur partagé **non modifié** ; fonction dédiée L5.
- Weekly slot `change_revision` inchangé lors d'un remplacement (RED-TR-26).
- 8 producteurs L1–L4 préservés.

## AUDIT-COM-FINAL

**9/9** Lot I câblés ; `missingProducers = []`.

## P0 / P1 / P2

| Niveau | Count | Détail |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | 1 P1 revue CTO #569 (isolation recipient user/tenant) **corrigé** — RED-TR-28/29 |
| P2 | 0 | 2 P2 revue CTO #569 (concurrence non concurrente, SHA rapport) **corrigés** — RED-TR-30 |

Le P2 historique Lot K « at-most-once lost-delivery window » reste documenté selon la décision CTO précédente.

## Correctifs revue CTO #569

| Point | Correction |
|---|---|
| P1 isolation recipient | Jointures fail-closed `users.school_id` sur parents et enseignants (RED-TR-28/29) |
| CI Communications C4 rouge | `verify-communications-c4.js` lisait `trg_c4_teacher_replacement_event` dans `communicationsNotificationsSchema.js` alors que le trigger vit dans `teacherReplacementOutbox.sql` ; le gate lit désormais la source réelle |
| P2 concurrence | RED-TR-30 : deux transactions réellement simultanées |
| P2 SHA rapport | HEAD figé au dernier commit de branche |

## Verdict L5

**GREEN technique** — producteur `TEACHER_REPLACEMENT` câblé, tests RED-TR-01→30 + BOOT verts (33/33).

## Verdict Communications global

Sous réserve CI HEAD et diff CTO indépendant : **Communications — GO technique** (9/9, P0/P1=0). Ne constitue pas un GO production global.
