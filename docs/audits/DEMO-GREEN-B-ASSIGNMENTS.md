# GREEN-B Démo — Affectations / Présences

## Symptôme terrain

La classe `1ère A` charge ses 20 élèves mais l'écran `/presences` affiche :

> Aucun enseignant n'est affecté à cette classe. Vérifiez l'affectation du cours.

Le dataset PostgreSQL contient pourtant des `teacher_assignments` actifs et des créneaux de planning.

## Cause racine

`GET /api/assignments` calcule son périmètre depuis les memberships canoniques `user_roles` du tenant. Le seed PostgreSQL Démo renseigne le rôle historique `users.role`, mais le dataset Démo existant ne possède pas nécessairement les lignes `user_roles` actives correspondantes.

La session peut donc être authentifiée comme administrateur d'établissement tandis que le snapshot live Assignments reçoit `roleKeys=[]`, calcule `scopeKind=none` et renvoie HTTP 200 avec `[]`.

Ce comportement fail-closed est correct et ne doit pas être remplacé par un fallback vers le JWT.

## Correctif GREEN-B

- réparation idempotente des memberships canoniques pour l'unique école Démo publique `CD-IN-26-001` ;
- source de migration : `users.role` PostgreSQL, jamais le JWT ;
- rôles plateforme (`SUPER_ADMIN`, `COUNTRY_ADMIN`) interdits dans cette réparation ;
- conflit étudiant/staff refusé ;
- aucun autre établissement n'est modifié ;
- vérification runtime étendue à `GET /api/assignments` avec résultat non vide ;
- test Web : une affectation canonique active `classId/classCode/status` doit sélectionner automatiquement l'enseignant pédagogique ;
- la sécurité demeure fail-closed si `user_roles` live est vide.

## Application Démo existante

Après déploiement de l'API contenant GREEN-B, exécuter une seule fois sur le service API Démo :

```bash
node backend/scripts/repair-demo-role-memberships.js
```

Le script réutilise les gardes de sécurité du reset Démo (`APP_ENV=demo`, marqueur DATABASE_URL, confirmation Démo) mais n'efface aucune donnée. Il est idempotent.

Aucun `demo:reset` n'est requis.

## Hors périmètre

- aucune modification PROD/PREPROD ;
- aucun fallback RBAC permissif ;
- aucune modification Finance GREEN-A ;
- aucune modification Render/env ;
- aucune donnée fictive supplémentaire.
