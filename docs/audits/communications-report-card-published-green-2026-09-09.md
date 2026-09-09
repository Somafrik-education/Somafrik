# Lot L2 GREEN — REPORT_CARD_PUBLISHED outbox C4

**Date :** 9 septembre 2026  
**Branche :** `cursor/communications-report-card-published-d98a`  
**Base :** `develop@43f1a29cf877311a66e9d1330377d5717446d511` (post #565 L1 STUDENT_LATE mergé)  
**PR :** Draft — pas Ready, pas merge autonome

---

## SoT bulletin identifié

| Champ | Valeur |
|---|---|
| **Table** | `report_cards` |
| **Clé primaire** | `id` (UUID) |
| **Scope tenant** | `school_id` |
| **Élève** | `student_id` |
| **Année scolaire** | `academic_year_id` |
| **Période** | `term_id` |
| **Statut** | `draft`, `generated`, `published`, `archived` (CHECK) |
| **Date publication** | `published_at` (rempli à la première transition `published`) |
| **Auteur publication** | non persisté sur la ligne ; action audit via `publishReportCard()` |
| **Publication canonique** | `documentsExamsPgStore.setReportCardStatus(..., "published")` appelé par `publishReportCard()` |

**Verdict SoT :** durable — pas de STOP P1 architecture.

---

## Définition exacte de « publié »

L’événement C4 est émis **uniquement** lorsque `report_cards.status` passe à `published` :

- INSERT direct en `published` → 1 événement ;
- UPDATE `draft` / `generated` → `published` → 1 événement ;
- UPDATE `published` → `published` → 0 nouvel événement ;
- UPDATE d’autres colonnes sur bulletin déjà publié (ex. `class_id`) → 0 nouvel événement (trigger limité à `UPDATE OF status`).

**Non déclencheurs :** brouillon, génération (`generated`), preview PDF, consultation, recalcul sans changement de statut.

**Republication :** publication immutable — une ligne `report_cards` = un seul `event_key` (pas de notion de version produit).

---

## RED initial observé (develop@43f1a29)

Sur la base L1, la fonction `somafrik_enqueue_communication_event()` ne contenait **aucune branche `report_cards`**.  
Une publication réelle via `UPDATE report_cards SET status = 'published'` ne produisait **aucun** événement outbox `REPORT_CARD_PUBLISHED`.

Tests RED-RC-01 → 13 créés dans `backend/lib/communicationsReportCardPublished.red.test.js`.

---

## Architecture GREEN

| Composant | Changement |
|---|---|
| **SoT métier** | Table `report_cards`, colonne `status = 'published'` |
| **Trigger PG** | `trg_c4_report_card_event` AFTER INSERT OR UPDATE OF status |
| **event_type** | `pedagogy.report_card.published` |
| **event_key** | `pedagogy.report_card.published:<report_card_id>` |
| **payload** | `{ studentId, academicYearId, termId }` |
| **processOneEvent** | Titre « Bulletin disponible », body sobre, PARENT + STUDENT |
| **navigationTarget** | `{ type: "report_card", studentId, reportCardId, termId, academicYearId }` |
| **Dispatcher** | `"pedagogy.report_card.published": ["PUSH","EMAIL"]` |
| **Lot I map** | `"pedagogy.report_card.published" → REPORT_CARD_PUBLISHED` |
| **Migration** | `20260914_communication_report_card_published_outbox.sql` |
| **Bootstrap** | `communicationsNotificationsSchema.js` aligné |

---

## Destinataires

Politique Lot I (`schoolNotificationPolicy.js`) : **PARENT** + **STUDENT**.

Validé runtime :

- parent lié à l’élève reçoit ;
- élève (user `user_code` = `student_code`) reçoit ;
- parent d’un autre élève exclu ;
- isolation SCHOOL_A / SCHOOL_B.

---

## Policy / prefs

`school policy AND user preference` — mécanisme commun (tests RED-RC-09/10).

---

## Legacy

Aucune écriture `notifications` / `state.notifications` pour ce flux.

Chemin obligatoire : outbox → `processOneEvent` → `communication_notifications` → dispatcher → `communication_channel_deliveries`.

---

## Migration / non-régression L1

Migration L2 remplace `somafrik_enqueue_communication_event()` en conservant **tous** les producteurs existants (message, annonce, absent, **late**, grade, payment, **report_card**).

Test RED-RC-13 : `STUDENT_LATE` non régressé après migration L2.

---

## AUDIT-COM-FINAL après lot

| Avant | Après |
|---|---|
| 5/9 Lot I câblés | **6/9 câblés** |
| missing: RC + PAYMENT_DUE + TIMETABLE + TEACHER_REPLACEMENT | missing: PAYMENT_DUE, TIMETABLE_CHANGED, TEACHER_REPLACEMENT |

**Verdict Communications global : HOLD — 6/9**

---

## Tests

| Suite | Contrats |
|---|---|
| `communicationsReportCardPublished.red.test.js` | RED-RC-01 → 13 |
| `communicationsStudentLate.red.test.js` | non-régression L1 |
| `communicationsFinal.audit.test.js` | 6/9 |
| `verify:communications-c4` | GO attendu |

---

## P0 / P1 / P2 (lot)

| Classe | Lot L2 |
|---|---|
| P0 | 0 |
| P1 lot | 0 (REPORT_CARD_PUBLISHED résolu) |
| P1 Communications global | 1 (3/9 restants) |
| P2 | inchangé (at-most-once window Lot K) |

**Verdict lot L2 : GO** (sous réserve CI verte et review CTO indépendante).
