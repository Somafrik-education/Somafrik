# Planning V2 — Salles canoniques et remplacements ponctuels

**Base :** `develop@7b42e572f4edff77ba8b03f0e1e373ecd653e2ab` (merge #265).  
**Branche :** `cursor/planning-v2-rooms-replacements-b1e7`  
**Statut :** PR Draft — aucun Ready, aucun merge.

## Séparation métier

| Concept | Grain | Autorité | Ce que ce n’est pas |
| --- | --- | --- | --- |
| **Salle** | Ressource durable d’établissement | `school_rooms.id` → `course_schedule_weekly_slots.room_id` | Un libellé libre `room TEXT` |
| **Weekly slot** | Règle hebdomadaire (classe + enseignant + jour + heure) | `course_schedule_weekly_slots` | Une occurrence datée |
| **Remplacement** | Exception datée sur **une** occurrence | `course_schedule_replacements` (`weekly_slot_id` + `occurrence_date`) | Une mutation de `school_courses.teacher_id` ou du weekly slot |

Un lundi 08:00 titulaire Seke reste Seke pour tous les lundis. Le 24/08, Kabeya apparaît uniquement via overlay de projection.

Interdit : `localStorage`, `backoffice_state`, mock runtime, lookup enseignant par nom, `schoolId` client comme autorité, fail-open Parent/Secrétaire.

---

## Lot A — Salles

### Modèle

`school_rooms` :

- `id` UUID PK, `school_id` NOT NULL
- `room_code` `SAL-####` alloué côté backend (aucune convention concurrente dans le dépôt)
- `name`, `capacity` (> 0 si renseignée), `room_type`, `building`, `floor`
- `equipment` JSONB `[]`
- `status` `active|inactive|archived`
- UNIQUE `(school_id, room_code)`
- UNIQUE actif/inactif `(school_id, lower(btrim(name)))`

`course_schedule_weekly_slots.room_id UUID NULL REFERENCES school_rooms(id)`  
`room_id` = autorité V2. `room TEXT` = cache d’affichage déprécié, lisible pour les anciennes lignes.  
POST/PATCH Planning V2 : `roomId` UUID **ou aucune salle**. Un `room` texte non vide sans `roomId` est rejeté (`400 ROOM_TEXT_DEPRECATED`).

Trigger tenant : `room_id` doit appartenir au même `school_id`.

### Collision PostgreSQL

```text
EXCLUDE USING gist (
  school_id, academic_year_id, room_id, day_of_week, slot_minutes &&
)
WHERE status = 'active' AND room_id IS NOT NULL
```

Sémantique `[start, end)` : 08:00–09:00 puis 09:00–10:00 OK ; 08:00–09:00 et 08:30–09:30 REFUS.

Capacité insuffisante = **warning** non bloquant (`capacityWarning` sur le DTO). Le Préfet peut confirmer.

DELETE HTTP = archive logique. Les weekly slots conservent `room_id`.

### API

Tenant JWT uniquement.

| Méthode | Route | RBAC |
| --- | --- | --- |
| GET | `/api/school-rooms` | `Salles:READ` |
| POST | `/api/school-rooms` | `Salles:CREATE` |
| PATCH | `/api/school-rooms/:roomId` | `Salles:UPDATE` |
| DELETE | `/api/school-rooms/:roomId` | `Salles:DELETE` (archive) |

Filtres GET : `status`, `capacity`, `type`, `search`, `classId` (pour le warning capacité).

Audit : `ROOM_CREATE`, `ROOM_UPDATE`, `ROOM_ARCHIVE`.

Écran : `/planning/salles`. Formulaire Planning : select `roomId` (option « Aucune salle »). Le Web n’envoie plus `room` texte.

---

## Lot B — Remplacements

### Modèle

`course_schedule_replacements` :

- `weekly_slot_id` + `occurrence_date` (date civile)
- `original_teacher_id` copié du weekly slot (trigger, non spoofable)
- `substitute_teacher_id` ≠ original
- `status` `planned|completed|cancelled`
- UNIQUE actif `(weekly_slot_id, occurrence_date)` pour `planned|completed`
- ISODOW(`occurrence_date`) = `weekly_slot.day_of_week`
- date dans l’année académique du slot

**Ne modifie jamais** `school_courses.teacher_id`, `course_schedule_weekly_slots.teacher_id`, `teacher_assignments`.

### Disponibilité et concurrence

Avant INSERT :

1. `SELECT … FOR UPDATE` du weekly slot
2. `SELECT … FOR UPDATE` de l’enseignant remplaçant
3. chevauchement weekly du candidat → `SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT`
4. chevauchement d’un autre remplacement où il est déjà substitute → même code

Garantie PostgreSQL :

- trigger : weekly overlap du remplaçant
- `EXCLUDE USING gist` `(school_id, substitute_teacher_id, occurrence_date, slot_minutes &&)` pour les statuts actifs

Deux POST simultanés sur la même occurrence : un `201`, un `409` (`REPLACEMENT_OCCURRENCE_CONFLICT` ou conflit horaire).

DELETE = `status = cancelled`. La projection revient au titulaire du weekly slot.

### API

| Méthode | Route | RBAC |
| --- | --- | --- |
| GET | `/api/course-schedule-replacements` | `Remplacements:READ` |
| GET | `/api/course-schedule-replacements/options` | `Remplacements:CREATE` (Admin School / Préfet). Enseignant READ-only → **403**. |
| POST | `/api/course-schedule-replacements` | `Remplacements:CREATE` |
| PATCH | `/api/course-schedule-replacements/:replacementId` | `Remplacements:UPDATE` |
| DELETE | `/api/course-schedule-replacements/:replacementId` | `Remplacements:DELETE` (cancel) |

Filtres : `from`, `to`, `teacherId`, `substituteTeacherId`, `classId`, `weeklySlotId`, `status`.  
Enseignant : lecture filtrée à `original_teacher_id OR substitute_teacher_id = soi`. Pas de CREATE.  
`GET /options` sert à **choisir un remplaçant** : hors contrat Enseignant READ.

Options remplaçants : UUID `teacherId`, code public, spécialité, `availability` (`available` / `schedule_conflict` / `subject_mismatch`). La spécialité **classe** mais ne bloque pas.

Audit : `REPLACEMENT_CREATE`, `REPLACEMENT_UPDATE`, `REPLACEMENT_CANCEL`.

### Projection calendrier

`GET /api/course-schedules?from=&to=` :

Sans remplacement : `teacher` = titulaire weekly.  
Avec remplacement actif :

```json
{
  "teacher": "Jean Kabeya",
  "originalTeacher": "Seke Kilombo",
  "replacement": true,
  "replacementId": "uuid"
}
```

Le calendrier affiche « Remplace {originalTeacher} ».  
Depuis une occurrence : `Programmer un remplacement` passe `weeklySlotId` + `occurrenceDate` (jamais un `occurrenceId` dérivé comme FK).

---

## Lot C — Conflits (diagnostic)

`GET /api/course-schedules?projection=diagnostics` — **vue d’audit**, pas une autorité.

Kinds : `class`, `teacher`, `room`, `substitute`, `capacity` (warning).  
Les collisions bloquantes sont déjà refusées par PostgreSQL.

---

## RBAC

Modules dédiés `rooms` / `replacements` (pas un réemploi de Matières).

| Rôle | Salles | Remplacements |
| --- | --- | --- |
| Admin School | CRUD | CRUD |
| Préfet des études | CRUD | CRUD |
| Enseignant | READ | READ de ses remplacements |
| Parent / Élève / Secrétaire | aucun | aucun |

Reconcile UNION au bootstrap (`reconcileCanonicalRoomsReplacementsGrants`), même pattern que Planning.

Mémoire : 501 si le backend n’est pas PostgreSQL.

---

## Migrations

- `backend/db/migrations/20260829_school_rooms_canonical.sql`
- `backend/db/migrations/20260830_course_schedule_replacements.sql`

Incluses dans `PEDAGOGY_SCHEMA_SQL`.

---

## Tests / verifiers

```text
npm run verify:planning-rooms
npm run verify:planning-replacements
```

Couverture exigée :

- deux classes, même salle, même heure → 409
- adjacent 08–09 puis 09–10 → OK
- salle autre établissement invisible
- archive conserve `room_id` historique
- weekday d’occurrence invalide → 400
- remplaçant déjà en cours / déjà remplaçant → 409
- annulation → titulaire restauré
- weekly slot et `school_courses.teacher_id` inchangés
- `teacher_assignments` inchangé
- concurrence → un seul INSERT accepté
- Parent / Secrétaire 403
- Enseignant `GET /replacements` → 200 (ses lignes)
- Enseignant `GET /replacements/options` → 403
- Préfet/Admin `GET /options` → 200
- POST/PATCH créneau avec `room` texte sans `roomId` → `400 ROOM_TEXT_DEPRECATED`

Conserver verts :

```text
verify:planning-v2-weekly
verify:planning-v2-web
verify:planning-course-options
verify:teacher-course-canonical-reconcile
```

CI et Security exécutent `verify:planning-rooms` et `verify:planning-replacements`.

---

## No-go

- salle = string comme SoT des nouveaux écrans
- aucune collision DB salle
- remplacement qui mute le cours ou le weekly slot
- lookup enseignant par nom
- remplacement sans `occurrence_date`
- cross-tenant
- concurrence non protégée
- Parent / Secrétaire avec accès
- fallback legacy / localStorage / backoffice_state
- placeholder « Bientôt disponible » sur `/planning/salles` ou `/planning/remplacements`
