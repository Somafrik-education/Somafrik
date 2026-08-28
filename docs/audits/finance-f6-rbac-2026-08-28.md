# Finance F6 — RBAC live PostgreSQL

Date : 2026-08-28  
Base : `develop@cc580307a17b171fbdd9b5fd19e99044d6b04595`

## Statut

**F6 = DRAFT / NO-GO tant que les P1 ci-dessous ne sont pas fermés.**

F1–F5 restent invariants. F6 ne modifie ni le modèle Finance, ni les allocations, ni les soldes, ni l'UX F7.

## Autorité cible

`user_roles PostgreSQL + role_module_permissions PostgreSQL + tenant courant -> permissions effectives par requête`

Le JWT ne transporte qu'une identité/contexte initial. Un rôle ou une permission présents dans un JWT ancien ne doivent jamais restaurer une autorisation retirée en PostgreSQL.

## Constat initial

1. `requirePermission()` recharge déjà `repository.resolveEffectivePermissions(req.principal)` à chaque requête et remplace `req.principal.permissions` avant `RbacService.canAccess()`.
2. Les helpers Finance de `financeManagement.js` ajoutaient ensuite un second contrôle fondé sur le **nom du rôle JWT** (`Admin School`, `Comptable`, `Secrétaire`, `Directeur`, Super Admin). Cela empêchait une matrice RBAC réellement configurable et rendait Web/API/Mobile dépendants d'un libellé de rôle.
3. `collectPrincipalRoleKeys()` dans `functionalRbacService.js` considère actuellement une liste PostgreSQL vide comme « pas de donnée live » et retombe sur `principal.roleKeys / principal.roles / principal.role` du JWT. Une révocation de tous les rôles peut donc réactiver un rôle stale. **P1.**
4. `collectPrincipalRoleKeys()` charge `listActiveUserRoleKeys(userId)` sans scope établissement. Une session établissement doit résoudre les rôles actifs du tenant courant, pas l'union de rôles d'autres établissements. **P1 cross-tenant à corriger avant GO.**
5. Plusieurs routes Finance réutilisent des route keys trop larges (`POST /api/payments`, `GET /api/backoffice/finance/unpaid`) puis compensent par des helpers. F6 doit finir avec une matrice endpoint/action explicite et testée.

## Correctif déjà appliqué dans la branche F6

Les helpers de mutation Finance ne dépendent plus du nom du rôle :

- grilles : `Frais & tarifs:CREATE|UPDATE`
- moyens de paiement : `Frais & tarifs:UPDATE` ou `Paramètres Établissement:UPDATE`
- ajustement obligation : `Paiements:UPDATE` ou `Frais & tarifs:UPDATE`
- statuts paiement : `Paiements:UPDATE`
- relance forcée : `Impayés:CREATE` ou `Paiements:UPDATE`

Un `Admin School`, `Comptable`, `Directeur`, `Secrétaire` ou Super Admin avec `permissions: []` ne reçoit donc plus de capacité Finance par son seul libellé de rôle.

## Invariants F6 à prouver avant GO

- revoke permission DB + même JWT => 403 immédiat ;
- grant permission DB + même JWT => autorisation immédiate ;
- révocation de tous les rôles => zéro fallback JWT ;
- changement de rôle => PostgreSQL gagne sur le JWT ;
- rôle d'un autre établissement => aucune permission dans le tenant courant ;
- Admin sans grant Finance => refusé ; aucune règle « Admin = tout » ;
- Comptable : `payment-student-options` autorisé si `Paiements:READ`, tandis que `/students` reste 403 sans `Élèves:READ` ;
- Web et Mobile utilisent les mêmes endpoints/backend guards ;
- cross-tenant lecture et écriture Finance => 403/404 fail-closed selon contrat existant.

## Périmètre restant avant GO

P1-A — rendre une liste `user_roles` vide **autoritaire** et supprimer le fallback JWT.  
P1-B — résoudre les `user_roles` dans le scope établissement/pays de la session.  
P1-C — remplacer les route keys Finance réutilisées par une politique endpoint/action explicite, puis couvrir le tout par tests HTTP PostgreSQL réels.  
P1-D — gate `verify:finance-rbac` + CI ciblée et scénarios stale-JWT grant/revoke.

F7 UX reste non ouvert.
