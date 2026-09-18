# LOT 2 — Scolarité (PARITY-013, 014, 031, 032)

Cadrage CTO `#5735020361` sur PR #704. Base `develop@38ea23217810f12587ba29241baedfa8a64ce9fd`.

Décision structurante : **C18 = backend PostgreSQL `enrollments` avant UI Mobile**. Aucune deuxième machine d’état dans Expo.

Hors périmètre : LOT 3, santé / documents / discipline / historique s’ils exigent un nouveau stockage ou une nouvelle API, `EntityPage` dans Expo, `POST /backoffice/relations` Mobile, `POST /students`, AdminCrud create.

## Matrice LOT 2

| ID | Décision | Statut LOT 2 |
|---|---|---|
| **PARITY-013** | Fiche élève Mobile : 6 cartes repliées, `GET /api/students/:id` | Corrigé |
| **PARITY-014** | Responsables depuis la fiche : identity / link / archive + lecture `GET /api/parents/relations?studentId=` | Corrigé |
| **PARITY-031** | Classe-first `POST /api/classes/:classCode/students` ; pas de CTA sur « Toutes les classes » | Corrigé |
| **PARITY-032** | Transitions C18 REST canoniques, autorité Backend + PostgreSQL | Corrigé |

## PARITY-013 — Fiche élève Mobile

Ne pas recopier les 12 modules Web. Cartes repliées :

1. Identité
2. Inscription
3. Responsables
4. Notes
5. Présences
6. Paiements

La fiche charge `GET /api/students/:id`. La ligne de liste n’est plus la fiche complète.

## PARITY-014 — Responsables

Lecture : `GET /api/parents/relations?studentId=` (tenant-scoped, fail-closed).

Mutations existantes :

- `GET /api/parents/identity`
- `POST /api/parents/link`
- `PATCH /api/parents/relations/:relationId`

Pas de `EntityPage` Expo. Pas de nouveau `POST /backoffice/relations` Mobile.

## PARITY-031 — Classe-first

Parcours : `Classes → classe → Élèves → Inscrire un élève`.

Endpoint unique : `POST /api/classes/:classCode/students`.

`StudentsScreen` « Toutes les classes » : aucun CTA de création.

Interdit : `POST /students`, création via AdminCrud.

## PARITY-032 — C18

Source de vérité : Backend + PostgreSQL `enrollments`.

| Méthode | Route |
|---|---|
| GET | `/api/students/:studentId/enrollments` |
| POST | `/api/students/:studentId/enrollments/:enrollmentId/validate` |
| POST | `.../assign-class` |
| POST | `.../transfer` |
| POST | `.../close` |

Machine :

- `PRE_REGISTERED \| PENDING_REVIEW \| INCOMPLETE → validate → APPROVED`
- `APPROVED \| ENROLLED → assign-class → ENROLLED`
- `ENROLLED → transfer → TRANSFERRED`
- `ENROLLED \| APPROVED → close → CLOSED`
- `TRANSFERRED` et `CLOSED` terminaux

Aucun retour arrière implicite. Aucune suppression physique. Pas de table parallèle. Migration éventuelle additive, idempotente, justifiée (`class_id` nullable pour APPROVED sans classe + colonnes d’audit C18). Alias lecture `active` → `ENROLLED`.

Web consomme le REST C18 (plus d’autorité locale mock en production). Mobile appelle les mêmes endpoints (`validate` / `assign-class` / `transfer` / `close`) sans machine d’état locale ni file offline. Les boutons suivent permissions + statut renvoyé par le backend ; le PostgreSQL reste seule autorité de transition.

## Sécurité

- établissement autorisé (membership `login_code`) ;
- autre tenant → 403/404 fail-closed ;
- teacher limité à son scope ;
- parent/student uniquement leur propre élève ;
- aucune mutation C18 parent/student ;
- aucun `schoolCode` client n’élargit le scope ;
- permissions live backend.

## Preuves

- `npm run test:lot2-parity`
- Job CI `LOT 2 parity` dans `Required` (extensible, sans casser LOT 0 / LOT 1)
- HTTP PG RBAC/tenant : `backend/lib/studentEnrollmentC18.http.pg.test.js`

STOP : Draft. Pas Ready. Pas merge. Pas LOT 3.
