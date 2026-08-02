# Audit read-only — doublons historiques enseignants

- Généré : 2026-08-02T23:11:16.351Z
- Source : postgres:backoffice_state@2026-08-02T22:57:23.557Z
- Hash snapshot SHA-256 : `88ef0f2dbf33643f668c229a8ec0ea87adfdcc08f92ec4212ee301552ef3c171`
- Mode : **DRY-RUN READ-ONLY**

## Synthèse

- Fiches Backoffice : **61**
- Fiches PostgreSQL : **61**
- Union auditée : **61**
- Fiches enseignants : **61**
- Groupes suspects : **3**
- Groupes SAFE_DUPLICATE : **0**
- Fiches doublons sûres : **0**
- Groupes AMBIGUOUS : **3**
- Groupes HOMONYM_POSSIBLE : **0**
- Groupes avec références réparties : **3**
- Fiches ORPHAN : **0**

## Groupes

### GROUP-0001 — AMBIGUOUS

- Établissement : `CD-2026-0001`
- Fiches : `TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1`, `TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c`
- Canon proposé : aucun
- Signaux : userId
- Drapeaux : REFERENCE_SPLIT

| teacherId | type | userId | contactId | identifier | publicId | références |
|---|---|---|---|---|---|---|
| TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1 | TEACHERS | 43b64560-dfeb-4bca-8040-68cc935591cd |  |  | TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1 | users:1, postgresGrades:1, postgresEvaluations:2 |
| TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c | TEACHERS | 43b64560-dfeb-4bca-8040-68cc935591cd |  |  | TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c | users:1, classes:2, courses:2, postgresEvaluations:3 |

### GROUP-0002 — AMBIGUOUS

- Établissement : `CD-2026-0001`
- Fiches : `TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1`, `TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd`
- Canon proposé : aucun
- Signaux : userId
- Drapeaux : REFERENCE_SPLIT

| teacherId | type | userId | contactId | identifier | publicId | références |
|---|---|---|---|---|---|---|
| TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1 | TEACHERS | 745d78af-4420-43c6-9432-6ffca2f59cc5 |  | 43b64560-dfeb-4bca-8040-68cc935591cd | CD-2026-0001-43B64560-DFEB-4BCA-8040-68CC935591CD | users:1 |
| TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd | TEACHERS | 745d78af-4420-43c6-9432-6ffca2f59cc5 |  |  | TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd | users:1 |

### GROUP-0003 — AMBIGUOUS

- Établissement : `CD-2026-0002`
- Fiches : `TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567`, `TEACHERS-beb4064e-3dbe-4ee9-a09b-c1653b5ed692`
- Canon proposé : aucun
- Signaux : publicId
- Drapeaux : REFERENCE_SPLIT

| teacherId | type | userId | contactId | identifier | publicId | références |
|---|---|---|---|---|---|---|
| TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567 | TEACHERS | 04e2e402-e681-46b3-bab1-5245158ee194 |  | ENS-0002 | CD-2026-0002-ENS-0001 | users:1 |
| TEACHERS-beb4064e-3dbe-4ee9-a09b-c1653b5ed692 | TEACHERS | a2c95657-c55a-42da-a883-05a72a23205c |  | ENS-0001 | CD-2026-0002-ENS-0001 | users:1, assignments:1, postgresTeacherAssignments:1, postgresAttendance:3 |

## Plan de réconciliation proposé

Aucune réconciliation automatique proposée.


## Résultat du dry-run

- teachers : 61 → 61
- références simulées à déplacer : 0
- assignments : 4 → 4
- grades : 1 → 1
- attendance/presences : 16 → 16
- evaluations : 5 → 5
- références pendantes après simulation : 0

Aucune mutation n'a été exécutée. Toute exécution préproduction nécessite une validation CTO séparée.
