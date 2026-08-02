# Nettoyage des doublons enseignants — préproduction

## Périmètre et sécurité

- Environnement : **préproduction uniquement**.
- Exécution : `2026-08-02T23:39:21.813Z`.
- Snapshot Backoffice avant : `9ccd75d2fa130b7bb0534c33d4b9272697e10ed25adfd8c65e2fea4e5f54645d`.
- Backup PostgreSQL complet : `preprod-before.dump`, format custom restaurable.
- Timestamp backup : `2026-08-02T23:33:02.8911295Z`.
- Taille backup : `790374` octets.
- SHA-256 backup : `6958b727d3adf585086d5a71b556bdab33aa73dba7a95012a7c2c3f13d150b4f`.
- Le dump de rollback contient des données préproduction et n'est pas versionné dans Git.

## Décisions exécutées

| Identité | Fiche conservée | Fiche supprimée | Justification |
|---|---|---|---|
| Etienne LUPUNGU | `TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c` | `TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1` | même compte logique ; canon portant les classes/cours fonctionnels actuels |
| Papy Ghislain | `TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1` | `TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd` | conservation de l'identité Papy ; suppression de la fiche Etienne croisée déjà couverte par son propre canon |
| Mathieu Laurelle | `TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567` | aucune | correction du `publicId` de `CD-2026-0002-ENS-0001` vers `CD-2026-0002-ENS-0002` |
| Jean pierre KIMWEMWE | `TEACHERS-beb4064e-3dbe-4ee9-a09b-c1653b5ed692` | aucune | personne distincte ; `publicId` `CD-2026-0002-ENS-0001` conservé |

Aucun user n'a été supprimé.

## Références traitées

- Grade `007f05da-f42e-47b7-82e4-d8aec888cc99` repointé vers le canon Etienne.
- Évaluations `ce9bb5ce-3c65-49b1-a1ed-5577095d82ab` et `24802b88-41db-42b8-a881-b2a416da8449` repointées vers le canon Etienne.
- Aucun assignment, attendance, grade ou évaluation ne référençait la fiche croisée supprimée de Papy.
- Références PostgreSQL pendantes après exécution : `0` dans `teacher_assignments`, `grades`, `attendance` et `evaluations`.

## Compteurs avant/après

| Collection | Avant | Après |
|---|---:|---:|
| Enseignants Backoffice | 61 | 59 |
| Enseignants PostgreSQL | 61 | 59 |
| Users Backoffice | 97 | 97 |
| Users PostgreSQL | 91 | 91 |
| Assignments Backoffice | 1 | 1 |
| Assignments PostgreSQL | 3 | 3 |
| Grades PostgreSQL | 1 | 1 |
| Attendance Backoffice | 8 | 8 |
| Attendance PostgreSQL | 8 | 8 |
| Evaluations PostgreSQL | 5 | 5 |

## Synchronisation x10 et audit final

- Les quatre comptes concernés ont été synchronisés dix fois consécutivement.
- Nombre d'enseignants à chaque exécution : `59`.
- Ensemble des IDs avant/après les dix exécutions : identique.
- Doublons `userId + schoolCode` : `0`.
- Doublons `contactId + schoolCode` : `0`.
- Collisions `identifier + schoolCode` : `0`.
- Collisions `publicId + schoolCode` : `0`.
- Groupes suspects détectés par l'audit indépendant de la PR #114 : `0`.
- SHA-256 snapshot final : `484dd9610e395ff967ad09fb5ac0122d7b455af45895bd3f08b52c2d25c74448`.

Les preuves machine sont disponibles dans `docs/audits/evidence/teacher-historical-preprod-cleanup-*.json` et `teacher-historical-preprod-final-audit.*`.
