# P0 — Teacher provisioning idempotency

## Cause racine démontrée

Les implémentations backend, web et Mobile résolvaient une fiche canonique uniquement par `userId + schoolCode`. Lorsqu'une fiche existante était reliée au même contact ou portait le même identifiant métier mais n'avait pas encore le `userId` courant, la synchronisation la considérait absente et générait un nouveau `TEACHERS-*`.

Le provisioning depuis Contact web avait un second défaut : après l'échec de la recherche par `contactId`, il utilisait `nom + prénom` puis `findIndex`. Cette règle pouvait fusionner des homonymes et sélectionnait silencieusement la première ligne en cas de pluralité.

La caractérisation rouge a reproduit le premier défaut dans `backend/services/userTeacherSyncService.test.js` : une fiche liée uniquement par `contactId` donnait deux fiches au lieu d'une (`2 !== 1`).

## Cartographie avant correctif

| chemin | déclencheur | clé de recherche existante | condition de création | risque de doublon |
|---|---|---|---|---|
| `backend/services/userTeacherSyncService.js` | sync serveur des comptes enseignants | `userId + schoolCode`; affectation active comme départage | aucun canon `TEACHERS-*` lié au `userId` | élevé : `contactId` et identifiant ignorés |
| `PUT /api/backoffice/state` (`backend/server.js`) | écriture touchant `users` ou `teachers` | délègue au service backend | service ne retrouve aucun canon | élevé sur changement/rattachement de compte; PUT sans identité ne lance pas la sync |
| `web/src/lib/userTeacherSync.ts` | sauvegarde d'un compte ou provisioning depuis EntityPage | `userId + schoolCode`; affectation active comme départage | aucun canon lié au `userId` | élevé : miroir du défaut backend |
| `web/src/pages/EntityPage.tsx` | création de fiche depuis compte/contact | compte : sync web; contact : `contactId`, sinon nom/prénom | aucun résultat du helper | élevé : homonymes et premier résultat implicite |
| `web/src/pages/UsersPage.tsx` | création/modification/suspension d'un compte enseignant | sync web | aucun canon lié au `userId` | élevé : sync répétée avec lien incomplet |
| `web/src/pages/entity-page/contactAccountWorkflow.ts` | promotion d'un contact ou création de fiche | sync web ou helper Contact | aucun lien retourné | élevé par les deux défauts ci-dessus |
| `Mobile/src/screens/AdminCrudScreen.tsx` | sauvegarde d'un compte enseignant | copie Mobile de la sync | aucun canon lié au `userId` | élevé : troisième implémentation du même défaut |
| `Mobile/src/screens/TeachersScreen.tsx` / `AdminCrudScreen.tsx` | tentative de création directe d'une fiche | aucune | création bloquée par `entityCreateViaContactsOnly` | nul pour la création directe |

## Correctif minimal

La résolution est maintenant strictement ordonnée dans les trois implémentations :

1. `userId + schoolCode` ;
2. sinon `contactId + schoolCode` ;
3. sinon identifiant métier (`identifier` ou `publicId`) dans le même établissement.

Une correspondance unique est réutilisée et reçoit le lien `userId`. Plusieurs candidats à un niveau déclenchent `TEACHER_CANON_AMBIGUOUS` (ou le no-op historique explicitement tracé pour les anciens multi-`TEACHER-*`). Aucun choix par affectation, ordre de tableau, date ou première ligne n'est autorisé. Le nom/prénom a été supprimé du provisioning enseignant depuis Contact. La génération d'un identifiant d'une nouvelle fiche tient désormais compte des fiches existantes de l'établissement.

## Preuves automatisées

- compte neuf : une seule fiche `TEACHERS-*` ;
- 10 synchronisations : nombre final `1`, même `teacher.id` ;
- lien `userId` unique : ID conservé ;
- lien `contactId` unique : rattachement, aucune création ;
- identifiant métier unique : rattachement, aucune création ;
- deux candidats fiables : `TEACHER_CANON_AMBIGUOUS`, zéro création ;
- homonymes distincts : aucune fusion ;
- affectations, notes et présences : références inchangées ;
- PUT sans changement identitaire : aucune création, skip explicite si historique ambigu ;
- Mobile : ambiguïté historique, zéro appel UI `createTeacher`/`updateTeacher`.

## Hors scope respecté

Aucune suppression, fusion, migration, modification de schéma, opération sur les données de préproduction ou modification fonctionnelle des notes, présences et bulletins.
