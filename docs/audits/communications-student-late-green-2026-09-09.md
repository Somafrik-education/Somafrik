# Lot L1 GREEN — STUDENT_LATE outbox C4

**Date :** 9 septembre 2026  
**Branche :** `feat/communications-student-late-green`  
**Base :** `develop@d3fdc4976d028eb6ccdec9d1d2c28cfdb868922c` (#564 audit final mergé)  
**PR :** Draft — pas Ready, pas merge autonome

---

## Cause P1 adressée (partielle)

Sur le contrat Lot I (**9 événements**), l’audit #564 identifiait **4/9 câblés** et **5/9 sans producteur**.  
Ce lot résout **uniquement** `STUDENT_LATE`.

---

## RED observé (develop avant GREEN)

Aucun producteur outbox pour un retard élève : la branche `attendance` du trigger `somafrik_enqueue_communication_event()` ne traitait que `absent` / `absence`.

Tests RED-LATE-01 → 10 créés dans `backend/lib/communicationsStudentLate.red.test.js`.

---

## Implémentation GREEN

| Composant | Changement |
|---|---|
| **SoT métier** | Table `attendance`, colonne `status` canonique (`late` via `toAttendanceStatus`) |
| **Trigger PG** | Branche `late` / `retard` → `attendance.student.late` |
| **event_key** | `attendance.student.late:<attendance_id>` (UNIQUE outbox) |
| **processOneEvent** | Titre « Retard enregistré », body sobre, parents via `listParentUserIdsForStudent` |
| **Dispatcher** | `"attendance.student.late": ["PUSH","EMAIL"]` |
| **Lot I map** | `"attendance.student.late" → STUDENT_LATE` |
| **Migration** | `20260913_communication_student_late_outbox.sql` |
| **Bootstrap** | `communicationsNotificationsSchema.js` aligné |

### Transitions couvertes

| Transition | Outbox |
|---|---|
| INSERT `late` | 1 événement |
| UPDATE `late → late` | 0 nouvel événement |
| UPDATE `present → late` | 1 événement |
| UPDATE `absent → late` | 1 événement `late` (+ absent déjà émis) |
| INSERT/UPDATE `present` | 0 événement |
| Replay SQL / concurrence drain | 1 seul `event_key` |

---

## Destinataires

Politique Lot I : **PARENT** uniquement (`schoolNotificationPolicy.js`).

Validé : parent lié à l’élève reçoit ; parent d’un autre élève (même école) exclu ; isolation SCHOOL_A / SCHOOL_B.

---

## Policy / prefs

`school policy AND user preference` — même mécanisme que les autres événements Lot I (tests RED-LATE-06/07).

---

## Legacy

Aucune écriture `notifications` / `state.notifications` pour ce flux.

---

## AUDIT-COM-FINAL après lot

| Avant | Après |
|---|---|
| 4/9 Lot I câblés | **5/9 câblés** |
| missing: LATE + 4 autres | missing: REPORT_CARD, PAYMENT_DUE, TIMETABLE, TEACHER_REPLACEMENT |

**Verdict Communications global : HOLD** (4 événements Lot I restent ouverts).

---

## Tests

| Suite | Résultat |
|---|---|
| `communicationsStudentLate.red.test.js` (RED-LATE-01→10) | 13/13 PASS |
| `communicationsFinal.audit.test.js` | PASS (5/9) |
| `verify:communications-c4` | GO (local) |

---

## P0 / P1 / P2 (lot)

| Classe | Lot L1 |
|---|---|
| P0 | 0 |
| P1 lot | 0 (STUDENT_LATE résolu) |
| P1 Communications global | 1 (4/9 restants) |
| P2 | inchangé (at-most-once window Lot K) |

**Verdict du lot : STUDENT_LATE GO** — prêt pour revue CTO indépendante, pas pour GO Communications global.
