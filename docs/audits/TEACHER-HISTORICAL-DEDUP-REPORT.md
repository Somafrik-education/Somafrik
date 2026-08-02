# Audit read-only — doublons historiques enseignants

- Généré : 2026-08-02T23:28:06.214Z
- Source : postgres:backoffice_state@2026-08-02T23:11:35.485Z
- Hash snapshot SHA-256 : `9ccd75d2fa130b7bb0534c33d4b9272697e10ed25adfd8c65e2fea4e5f54645d`
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


## Phase A2 — arbitrage assisté read-only

### GROUP-0001 — CONFIRMED_DUPLICATE_REFERENCE_SPLIT

- Même personne démontrée : **oui**
- Décision canon : **CTO_ARBITRATION_REQUIRED**

#### Comptes et identité civile

- teacherId=TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1; identité=Etienne Etienne LUPUNGU; userId=43b64560-dfeb-4bca-8040-68cc935591cd; identifier=; publicId=TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1; naissance=non renseignée.
- teacherId=TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c; identité=Etienne Etienne LUPUNGU; userId=43b64560-dfeb-4bca-8040-68cc935591cd; identifier=; publicId=TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c; naissance=non renseignée.
- Compte PostgreSQL id=43b64560-dfeb-4bca-8040-68cc935591cd; code=8e363f4c-3c8b-4018-85ad-206f3bfa351f; identité=Etienne LUPUNGU; email=non renseigné; téléphone=non renseigné; statut=deleted; créé=[object Object]; modifié=[object Object].
- Compte PostgreSQL id=745d78af-4420-43c6-9432-6ffca2f59cc5; code=43b64560-dfeb-4bca-8040-68cc935591cd; identité=Etienne LUPUNGU; email=non renseigné; téléphone=non renseigné; statut=deleted; créé=[object Object]; modifié=[object Object].
- Fiche PostgreSQL teacherId=TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1; postgresId=657e6063-2fad-4cc1-bc19-94ef28d82d92; compte lié=745d78af-4420-43c6-9432-6ffca2f59cc5; statut=active; créé=[object Object]; modifié=[object Object] (dates informatives uniquement).
- Fiche PostgreSQL teacherId=TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c; postgresId=9583d5ec-324e-47cd-a0cf-338cedd69860; compte lié=745d78af-4420-43c6-9432-6ffca2f59cc5; statut=active; créé=[object Object]; modifié=[object Object] (dates informatives uniquement).

#### Matrice des canons candidats

| candidateTeacherId | identité liée | références métier | cohérence identifiants | pertes potentielles sans repointage |
|---|---|---|---|---|
| TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1 | etienne lupungu / 43b64560-dfeb-4bca-8040-68cc935591cd | users:1, postgresGrades:1, postgresEvaluations:2 | userId partagé=true; identifier=vide; publicId=TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1 | 7 |
| TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c | etienne lupungu / 43b64560-dfeb-4bca-8040-68cc935591cd | users:1, classes:2, courses:2, postgresEvaluations:3 | userId partagé=true; identifier=vide; publicId=TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c | 3 |

#### Simulations

- Canon candidat TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1 : 7 référence(s) à repointer (classes:2, courses:2, postgresEvaluations:3); notes perdues=0, présences perdues=0, évaluations perdues=0, affectations perdues=0, références pendantes=0, comptes modifiés=0, nouveaux enseignants=0.
- Canon candidat TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c : 3 référence(s) à repointer (postgresGrades:1, postgresEvaluations:2); notes perdues=0, présences perdues=0, évaluations perdues=0, affectations perdues=0, références pendantes=0, comptes modifiés=0, nouveaux enseignants=0.

### GROUP-0002 — AMBIGUOUS_IDENTITY_CROSS_LINK

- Même personne démontrée : **non**
- Décision canon : **NO_CANON_ALLOWED**
- Alerte : identifier/publicId reprend 43b64560-dfeb-4bca-8040-68cc935591cd, userId logique de GROUP-0001 ; aucune relation canonique autorisée

#### Comptes et identité civile

- teacherId=TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1; identité=Papy Ghislain; userId=745d78af-4420-43c6-9432-6ffca2f59cc5; identifier=43b64560-dfeb-4bca-8040-68cc935591cd; publicId=CD-2026-0001-43B64560-DFEB-4BCA-8040-68CC935591CD; naissance=15-03-1990.
- teacherId=TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd; identité=Etienne Etienne LUPUNGU; userId=745d78af-4420-43c6-9432-6ffca2f59cc5; identifier=; publicId=TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd; naissance=non renseignée.
- Compte PostgreSQL id=88312da1-1d53-4e43-bd8a-f9200e8492b7; code=745d78af-4420-43c6-9432-6ffca2f59cc5; identité=Papy Ghislain; email=non renseigné; téléphone=non renseigné; statut=active; créé=[object Object]; modifié=[object Object].
- Compte PostgreSQL id=745d78af-4420-43c6-9432-6ffca2f59cc5; code=43b64560-dfeb-4bca-8040-68cc935591cd; identité=Etienne LUPUNGU; email=non renseigné; téléphone=non renseigné; statut=deleted; créé=[object Object]; modifié=[object Object].
- Fiche PostgreSQL teacherId=TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1; postgresId=b33da034-4fa2-46bb-9562-78b6283b25a1; compte lié=88312da1-1d53-4e43-bd8a-f9200e8492b7; statut=active; créé=[object Object]; modifié=[object Object] (dates informatives uniquement).
- Fiche PostgreSQL teacherId=TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd; postgresId=f4cafbe5-7ac2-4272-8766-f361027cb935; compte lié=88312da1-1d53-4e43-bd8a-f9200e8492b7; statut=active; créé=[object Object]; modifié=[object Object] (dates informatives uniquement).

#### Matrice des canons candidats

Aucun canon autorisé : identité insuffisante ou collision démontrée.

### GROUP-0003 — IDENTIFIER_COLLISION_NOT_DUPLICATE

- Même personne démontrée : **non**
- Décision canon : **NO_CANON_ALLOWED**

#### Comptes et identité civile

- teacherId=TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567; identité=Mathieu Laurelle; userId=04e2e402-e681-46b3-bab1-5245158ee194; identifier=ENS-0002; publicId=CD-2026-0002-ENS-0001; naissance=non renseignée.
- teacherId=TEACHERS-beb4064e-3dbe-4ee9-a09b-c1653b5ed692; identité=Jean pierre KIMWEMWE; userId=a2c95657-c55a-42da-a883-05a72a23205c; identifier=ENS-0001; publicId=CD-2026-0002-ENS-0001; naissance=non renseignée.
- Compte PostgreSQL id=6f094bf5-9f94-4a33-9904-fbdc3c4fcfbc; code=a2c95657-c55a-42da-a883-05a72a23205c; identité=Jean pierre KIMWEMWE; email=non renseigné; téléphone=non renseigné; statut=active; créé=[object Object]; modifié=[object Object].
- Compte PostgreSQL id=b289794e-9a35-4951-83e5-f14e8877767c; code=04e2e402-e681-46b3-bab1-5245158ee194; identité=Mathieu Laurelle; email=non renseigné; téléphone=non renseigné; statut=active; créé=[object Object]; modifié=[object Object].
- Fiche PostgreSQL teacherId=TEACHERS-beb4064e-3dbe-4ee9-a09b-c1653b5ed692; postgresId=33f70073-3773-4034-b370-61d54c9c2c0c; compte lié=6f094bf5-9f94-4a33-9904-fbdc3c4fcfbc; statut=active; créé=[object Object]; modifié=[object Object] (dates informatives uniquement).
- Fiche PostgreSQL teacherId=TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567; postgresId=21093789-27cb-4ce9-ac18-005ce66317d0; compte lié=b289794e-9a35-4951-83e5-f14e8877767c; statut=active; créé=[object Object]; modifié=[object Object] (dates informatives uniquement).

#### Matrice des canons candidats

Aucun canon autorisé : identité insuffisante ou collision démontrée.


## Résultat du dry-run

- teachers : 61 → 61
- références simulées à déplacer : 0
- assignments : 4 → 4
- grades : 1 → 1
- attendance/presences : 16 → 16
- evaluations : 5 → 5
- références pendantes après simulation : 0

Aucune mutation n'a été exécutée. Toute exécution préproduction nécessite une validation CTO séparée.
