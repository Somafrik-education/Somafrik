# Audit Lot L4 — TIMETABLE_CHANGED (GREEN)

## Identifiants Git

| Champ | Valeur |
|---|---|
| Base SHA | `25c3d8367502294256c4798d22fc21bda66eb395` |
| Branche | `cursor/communications-timetable-changed-d98a` |
| HEAD SHA | _(voir commit bootstrap P1)_ |

## Correctifs P1 CTO (#568)

| P1 | Correction |
|---|---|
| Clé OLD→NEW | Colonne `change_revision` monotone + trigger BEFORE UPDATE ; clé `planning.timetable.changed:<slot_id>:<change_revision>` |
| Drain état courant | `eventSpec()` lit snapshot immuable `event.payload` (teacherId, previousTeacherId, classId, horaires…) |

Tests ajoutés : RED-TT-17 (cycle A→B→A→B → 3 events), RED-TT-18 (E1/E2 drain avec snapshot).

## SoT Planning

**Objet canonique :** séance hebdomadaire Planning V2 — table `course_schedule_weekly_slots`.

| Attribut | Colonne / source |
|---|---|
| PK | `id` (UUID) |
| `school_id` | `school_id` |
| `class_id` | `class_id` |
| `subject_id` | via `school_course_id` → `school_courses.subject_id` |
| `teacher_id` | `teacher_id` |
| Jour | `day_of_week` (1=lundi … 7=dimanche) |
| Heure début / fin | `start_time`, `end_time` (TIME local) |
| Salle | `room`, `room_id` (optionnel) |
| Année | `academic_year_id` |
| Statut visible | `status IN ('active','cancelled','archived')` — seul `active` est applicable (contraintes d'exclusion) |

**Legacy non canonique :** `course_schedule_slots` (événements datés / examens) — hors périmètre L4.

**Brouillon :** pas de statut `draft`. Les créneaux `cancelled` / `archived` ne sont pas notifiables à la modification.

## Définition d'un changement notifiable

`UPDATE` d'un créneau dont `OLD.status = 'active'` avec changement réel sur au moins un champ :

- `day_of_week`, `start_time`, `end_time`, `room`, `room_id`
- `school_course_id`, `teacher_id`, `class_id`
- `status` (ex. annulation `active` → `cancelled`)

**Exclusions :**

- `INSERT` nouvelle séance → **0 event**
- modification d'un créneau non `active` → **0 event**
- `UPDATE` sans delta métier (ex. `updated_at` seul) → **0 event**

## Distinction TEACHER_REPLACEMENT

| Mécanisme | Événement |
|---|---|
| `course_schedule_replacements` | `TEACHER_REPLACEMENT` (lot futur, non implémenté) |
| `UPDATE course_schedule_weekly_slots.teacher_id` (mutation planning générale) | `TIMETABLE_CHANGED` uniquement |

L4 ne produit **jamais** `TEACHER_REPLACEMENT`.

## RED initial

Sur `develop@25c3d836` sans migration L4 : un `UPDATE` réel d'un créneau `active` (ex. décalage horaire) ne produisait **aucun** enregistrement dans `communication_event_outbox`.

Fichier : `backend/lib/communicationsTimetableChanged.red.test.js` (RED-TT-01 → 18).

## Event type

`planning.timetable.changed` → mapping Lot I `TIMETABLE_CHANGED`.

## Event key

```
planning.timetable.changed:<weekly_slot_id>:<change_revision>
```

`change_revision` (BIGINT) est incrémenté atomiquement par `trg_course_schedule_weekly_slots_bump_revision` à chaque mutation notifiable d'un créneau `active`. Préserve les cycles A→B→A→B (RED-TT-17).

## Stratégie idempotence / version

Révision monotone durable sur la ligne canonique — pas de hash OLD|NEW. Rejeu d'un UPDATE sans delta métier → pas d'incrément → pas d'event.

## Snapshot payload / recipients enseignant

Le trigger enregistre dans `payload` l'état **post-mutation** (`teacherId`, `classId`, horaires…) plus `previousTeacherId` si `teacher_id` a changé.

`eventSpec()` **ne relit pas** `course_schedule_weekly_slots` au drain :

- mutation sans changement de prof → **nouvel enseignant** (`teacherId`) uniquement ;
- mutation avec changement de prof → **nouvel + ancien** enseignant (`teacherId` + `previousTeacherId`).

Contrat distinct de `TEACHER_REPLACEMENT` (table `course_schedule_replacements`, lot futur).

## Recipients Lot I

Policy canonique (`schoolNotificationPolicy.js`) :

- **TEACHER** — résolu depuis le snapshot payload (assignee ± previous_assignee)
- **SCHOOL_ADMIN** — admins établissement via `listSchoolAdminUserIds`

(Pas de PARENT / STUDENT pour `TIMETABLE_CHANGED`.)

## Isolation

- **Classe :** seul l'enseignant du créneau modifié est notifié (pas l'enseignant d'une autre classe).
- **Tenant :** `school_id` sur outbox, notifications, recipients ; aucun recipient école B pour mutation école A.

## Policy / prefs

Moteur commun : `school policy AND user preference` via `resolveAllowedChannels` + dispatcher C4.

## Navigation Web/Mobile

`navigationTarget = {}` — pas de contrat mort (option B du mandat). Mobile `resolveInternalNotificationNavigationTarget` ne route que `finance_obligation`.

## Migration / bootstrap

- `backend/db/planningWeeklyChangeRevision.sql` — source unique `change_revision` + trigger bump (domaine Planning)
- Inclus dans `PEDAGOGY_SCHEMA_SQL` via `ensurePedagogyCanonicalSchema()` **avant** C4
- `backend/db/migrations/20260916_communication_timetable_changed_outbox.sql`
- `backend/db/migrations/20260917_communication_timetable_changed_revision.sql` (upgrade versionné, même SQL Planning)
- RED-TT-19 : `schema.sql` → Pédagogie → `ensureClientsCanonicalBootstrap()` sans migrations L4 manuelles
- `backend/db/communicationsNotificationsSchema.js` (bootstrap canonique)
- Trigger `trg_c4_timetable_changed_event` sur `course_schedule_weekly_slots`
- Fonction `somafrik_enqueue_communication_event()` — non-régression L1/L2/L3 préservée

## Tests PostgreSQL runtime

`communicationsTimetableChanged.red.test.js` — UPDATE réel, outbox, `drainOutbox`, recipients, tenant/classe, policy, idempotence, multi-champs → 1 event.

## P0 / P1 / P2

| Niveau | Lot L4 |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | navigation ciblée planning non câblée (choix `{}` volontaire) |

## Matrice Lot I après L4

**8/9 câblés**

`mappedPolicy` : ANNOUNCEMENT_PUBLISHED, GRADE_PUBLISHED, PAYMENT_DUE, PAYMENT_RECEIVED, REPORT_CARD_PUBLISHED, STUDENT_ABSENT, STUDENT_LATE, **TIMETABLE_CHANGED**

`missingProducers` : `[TEACHER_REPLACEMENT]`

**Verdict L4 :** GO technique lot  
**Verdict Communications global :** HOLD — 8/9
