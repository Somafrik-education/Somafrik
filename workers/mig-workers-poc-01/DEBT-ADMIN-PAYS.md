# Dette RBAC — `country_admin` / `Admin Pays`

Enregistrée le 29 octobre 2026 (Europe/Paris). Aucun module RBAC n'est modifié par `MIG-WORKERS-POC-01`.

## Observation

`RbacService.canAccess` sur `GET /api/students`, principal sans `roleKeys` et sans liste de permissions :

| `principal.role` | Résultat actuel |
|---|---|
| `country_admin` | autorisé |
| `Admin Pays` | refusé |

La clé mobile `country_admin` est traduite en permissions `Admin Pays` par `roleAliases` de `backend/services/rbacService.js`, donc `COUNTRY_PRIVILEGES` ouvre la route. Le garde-fou `isCountryAdminPrincipal` de `backend/lib/platformPersonalDataGuard.js` ne reconnaît que le libellé `Admin Pays` et la clé `COUNTRY_ADMIN` dans `roleKeys`. L'alias `super_admin`, lui, est reconnu.

`backend/server.js` normalise souvent `country_admin` vers le libellé `Admin Pays` dans `buildPrincipal` avant de signer le jeton de production. Cette normalisation ne ferme pas le trou du garde-fou lorsqu'un principal arrive encore avec l'alias et sans `roleKeys`.

## Hors de cette PR

Le correctif appartient à un mandat RBAC distinct. Il ne consiste pas à injecter `roleKeys` dans le POC pour masquer l'écart. Le test `test/aliasAdminPays.test.js` fige l'observation. S'il change, ce fichier doit être mis à jour dans le même correctif.
