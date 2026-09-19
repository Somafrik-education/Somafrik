# LOT 7 — preuves RED → GREEN (PARITY-021 / 052 / 057 / 081 / 083)

Base : `develop@2a0b4f95b32d1aff40f963a43dae9a59bf8fec31`  
Branche : `cursor/lot7-planning-parity`  
Mandats : #704 `#5741752516` / `#5742156349`

Aucun élargissement planning. Aucun LOT 8. Pas de recode des clôtures LOT 0–6.

## Tableau audit 704 → état actuel → gap → décision

| ID | Audit #704 | État `develop@2a0b4f95` | Gap résiduel | Décision LOT 7 |
| --- | --- | --- | --- | --- |
| **PARITY-021** | `PermissionsScreen.tsx` non branché, `canReadView("Permissions")` faux | Écran toujours hors `AppNavigator`. `MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false`. `canReadView("Permissions")` retourne `false` (hors Superadmin, qui a la vue dans `SUPER_ADMIN_ALLOWED_VIEWS` mais **aucune route live**). LOT 1 interdit déjà le remount. Pas de PUT `/role-permissions` côté écran. | Surface morte, pas une divergence fonctionnelle live. | **KEEP DEAD.** Ne pas remonter. Ne pas activer PUT. Ne pas inventer une gouvernance Superadmin Mobile. Pas de suppression opportuniste du fichier. |
| **PARITY-052** | Web page dédiée, Mobile liste filtrée | LOT 2 déjà live : `ClassesScreen` → `SCOLARITE_COPY.openClassStudents` ; `StudentsScreen` filtre classe (`filterStudentsByClassName` / `Toutes les classes`) ; Web `ClassStudentsPage` + `POST /classes/:classCode/students`. | Aucun. Équivalence fonctionnelle classe-first. | **Aucun code produit.** Preuve + verrou source seulement. |
| **PARITY-057** | Web compteur lignes vs Mobile % fail-closed | Mobile `resolveClassTodayPresenceBadge` : 0 élève → `Présence —` ; appel incomplet / absent → `Non saisi` (jamais 0 %) ; `recorded === expected` → `Présence N %` (Présent+Retard). Web cartes : `{n} enregistrement(s) aujourd'hui`. | Sens métier différent ; Web peut suggérer un appel alors qu'il est incomplet. | **Unifier Web** sur le contrat fail-closed Mobile. Helper Web local. Ne pas affaiblir Mobile. |
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

## GREEN (cette branche)

```
npm run test:lot7-parity
# scripts/lot7-parity.test.ts 6/6
# web/src/lib/classTodayPresenceBadge.test.ts 5/5
```

- Helper Web `formatClassTodayPresenceBadge` : vide → `Présence —` ; incomplet → `Non saisi` ; complet → `Présence N %`.
- Hint inscription `Format ${DISPLAY_DATE_HINT}` (JJ-MM-AAAA).
- Action de masse Web `Tout présent`.
- Job CI `LOT 7 parity` dans Required, `needs` extensible (`lot7` n'est pas figé comme dernier).

STOP : Draft. Pas Ready. Pas merge. Pas LOT 8.
