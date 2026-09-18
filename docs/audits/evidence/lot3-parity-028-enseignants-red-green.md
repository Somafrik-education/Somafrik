# LOT 3 — preuves RED → GREEN (PARITY-028 Enseignants)

Base : `develop@1d9341da1bd2fc8a0a3bb392acbdf63eb6055c98`  
Branche : `cursor/lot3-enseignants-ae6a`  
Mandat : #704 commentaire `#5736326064`

## Décision contrat canonique

`POST /api/backoffice/users/create-teacher` est la seule mutation de **création** d'identité enseignant.

Orchestration : `createTeacherIdentityFromUsers` → `withTransaction` → `createUser` + `grantUserRole("Enseignant")` + profil `teachers` + audits + remise `{ login, temporarySecret }`. Un seul COMMIT.

`POST /api/teachers` reste tombstone `403` `TEACHER_IDENTITY_MUST_COME_FROM_USERS`. Jamais réactivé. Pas d'alias `teachersApi.create` → Users.

### Caractérisation des deux flux Users (base develop)

| Flux | Writes HTTP | Atomique | Secret | `mustChangePassword` | Audit |
| --- | --- | --- | --- | --- | --- |
| Web `UsersPage` `createUser` puis `grantUserRole("Enseignant")` | 2 transactions distinctes | Non — user orphelin si GRANT échoue | `user.temporaryPassword` sur le 1er POST | dépend du createUser seul | 2 audits éventuellement partiels |
| Mobile / backend `POST /create-teacher` | 1 transaction | Oui — rollback users / user_roles / teachers / audit_logs | `credentials.temporarySecret` ; `user` sans secret | teacher login `true` jusqu'au change-password | create_user + grant_role dans le même COMMIT |

Inequivalence prouvée : le chemin Web générique n'est **pas** le contrat canonique (atomicité, handoff credentials, profil `teachers`).

## RED (base `1d9341da`, avant mutation produit)

`npx --yes tsx --test scripts/lot3-parity.test.ts` → **4 fail / 3 pass**

- FAIL : `teachersApi` expose encore `CreateTeacherPayload` + `create` → `POST /teachers`
- PASS : aucun autre client Web/Mobile n'appelle `POST /teachers` pour créer (Mobile déjà Users)
- PASS : `POST /api/teachers` tombstone 403
- PASS : Mobile `createTeacherIdentityFromUsers` → `/backoffice/users/create-teacher`, inventory `domain: users`, `outbox: false`
- FAIL : Web `UsersPage` = `createUser` + `grantUserRole`, pas `createTeacherIdentity`
- FAIL : `verify-teacher-account-creation.js` helper `createTeacherViaUsers` = double séquence HTTP
- FAIL (regex CI, corrigé ensuite) / job `lot3` ajouté dans Required

Vitest Web (GREEN attendu, RED sur base) :

- `clientsApi.createTeacherIdentity is not a function`
- `toCreateTeacherIdentityPayload is not a function`
- `UsersPage` Enseignant appelle encore `createUser` (1 fail) ; Préfet `createUser+grant` déjà OK (1 pass)

## GREEN (cette branche)

- `teachersApi.create` / `CreateTeacherPayload` supprimés. Liste / fiche / PATCH / DELETE inchangés.
- `clientsApi.createTeacherIdentity` → `POST /backoffice/users/create-teacher` (+ `buildCreateUserPayload` tenant).
- `UsersPage` : rôle Enseignant à la création → `createTeacherIdentity` ; toast login + `temporarySecret`. Autres rôles : `createUser`/`provision` inchangés. GRANT sur compte existant (Attribuer) inchangé.
- Helper HTTP `createTeacherViaUsers` aligné sur `create-teacher`.
- `npm run test:lot3-parity` + job CI `LOT 3 parity` (postgres:16) dans Required, composable LOT 0/1/2.

## Reliquats hors LOT 3

- GRANT Enseignant sur un compte **déjà créé** (flux Attribuer) reste `POST .../roles/grant` — ce n'est pas une création d'identité.
- Finance / Pédagogie / Communication / catalogue RBAC / cleanup legacy général.
- LOT 4.

STOP : Draft. Pas Ready. Pas merge. Pas LOT 4.
