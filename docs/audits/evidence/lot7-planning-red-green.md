# LOT 7 — preuves RED → GREEN (PARITY-021 / 052 / 057 / 081 / 083)

Base : `develop@2a0b4f95b32d1aff40f963a43dae9a59bf8fec31`  
Branche : `cursor/lot7-planning-parity`  
Mandats : #704 `#5741752516` / `#5742156349`

Aucun élargissement planning. Aucun LOT 8. Pas de recode des clôtures LOT 0–6.

## Tableau audit 704 → état actuel → gap → décision

| ID | Audit #704 | État `develop@2a0b4f95` | Gap résiduel | Décision LOT 7 |
| --- | --- | --- | --- | --- |
| **PARITY-021** | `PermissionsScreen.tsx` non branché, `canReadView("Permissions")` faux | Écran orphelin encore présent au premier HEAD LOT 7. | Code mort / faux sentiment de couverture. | **Suppression nette** de `Mobile/src/screens/PermissionsScreen.tsx`. Fail-closed `canReadView("Permissions")` + `MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false` conservés. Pas de remount. Pas de catalogue LOT 8. |
| **PARITY-052** | Web page dédiée, Mobile liste filtrée | LOT 2 déjà live : `ClassesScreen` → `SCOLARITE_COPY.openClassStudents` ; `StudentsScreen` filtre classe (`filterStudentsByClassName` / `Toutes les classes`) ; Web `ClassStudentsPage` + `POST /classes/:classCode/students`. | Aucun. Équivalence fonctionnelle classe-first. | **Aucun code produit.** Preuve + verrou source seulement. |
| **PARITY-057** | Web compteur lignes vs Mobile % fail-closed | Mobile : `recorded !== expectedStudents.length` via `findTodayPresenceForStudent`. Web premier HEAD : `recorded === 0 \|\| recorded < expected` + comptage brut de lignes. | `recorded > expected` et cas A/B/D ouvraient un taux trompeur. | **Roster attendu.** Complétude = chaque élève attendu a une ligne du jour. Lignes hors roster ignorées. `recorded !== expected` toujours fail-closed. Roster non fiable → `Non saisi`. |
| **PARITY-081** | Web hint naissance inscription `AAAA-MM-JJ` | `DateInput` affiche déjà JJ-MM-AAAA. Hint inscription `ClassStudentsPage` encore `Format AAAA-MM-JJ`. | Hint contredit le contrat UI. | Hint → `Format ${DISPLAY_DATE_HINT}` (JJ-MM-AAAA). Pas de nouvelle logique de date. TeachersListPage hors inscription : non touché. |
| **PARITY-083** | Web « Tous présents » / Mobile « Tout présent » | Mobile `TeacherAttendanceScreen` : `Tout présent` (LOT 0). Web `PresencesPage` : `Tous présents`. Comportement déjà identique (draft Présent, pas de POST). | Libellé seulement. | Web → **Tout présent**. Comportement inchangé. |

## RED (base `2a0b4f95`, avant mutation produit)

`npx --yes tsx --test scripts/lot7-parity.test.ts` → **3 fail / 3 pass**

- PASS PARITY-021 : écran mort, mutation off, LOT 1 interdit le remount
- PASS PARITY-052 : classe-first LOT 2 déjà live
- FAIL PARITY-057 : cartes Web encore `{n} enregistrement(s) aujourd'hui`
- FAIL PARITY-081 : hint inscription encore `Format AAAA-MM-JJ`
- FAIL PARITY-083 : bouton Web encore `Tous présents`
- PASS gate : `test:lot7-parity` + job `LOT 7 parity` dans Required extensible

Preuve brute : `/tmp/lot7-red.txt`

## GREEN (HEAD `fff08e07`, avant HOLD)

`npm run test:lot7-parity` 6/6 + helper 5/5. 081 / 083 / 052 conformes. Gate `LOT 7 parity` dans Required.

## HOLD `#5742243774` — correction-only depuis `fff08e07`

- **PARITY-021** : `PermissionsScreen.tsx` supprimé. Tests prouvent l'absence du fichier, pas la conservation du code mort.
- **PARITY-057** : `resolveClassTodayPresenceBadge` + `findTodayPresenceForStudent`. Cas : recorded 4/expected 3 ; A/B/D ; A/B/C taux ; tous absents couverts → `Présence 0 %` ; roster vide → `Présence —` ; roster null → `Non saisi`.

STOP : Draft. Pas Ready. Pas merge. Pas LOT 8.
