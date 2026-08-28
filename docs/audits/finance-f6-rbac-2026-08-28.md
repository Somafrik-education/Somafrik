# Finance F6 — RBAC live PostgreSQL

Date : 2026-08-28  
Base : `develop@cc580307a17b171fbdd9b5fd19e99044d6b04595`

## Statut

**F6 = DRAFT / NO-GO tant que la preuve HTTP PostgreSQL et la granularité endpoint/action ne sont pas closes.**

F1–F5 restent invariants. F6 ne modifie ni le modèle Finance, ni les allocations, ni les soldes, ni l'UX F7.

## Autorité cible

`user_roles PostgreSQL + role_module_permissions PostgreSQL + tenant courant -> permissions effectives par requête`

Le JWT ne transporte qu'une identité/contexte initial. Un rôle ou une permission présents dans un JWT ancien ne doivent jamais restaurer une autorisation retirée en PostgreSQL.

## Constat initial

1. `requirePermission()` recharge déjà `repository.resolveEffectivePermissions(req.principal)` à chaque requête et remplace `req.principal.permissions` avant `RbacService.canAccess()`.
2. Les helpers Finance de `financeManagement.js` ajoutaient ensuite un second contrôle fondé sur le nom du rôle JWT (`Admin School`, `Comptable`, `Secrétaire`, `Directeur`, Super Admin).
3. Une liste PostgreSQL vide de rôles pouvait retomber sur les rôles du JWT stale.
4. Le lookup des rôles était global utilisateur et non explicitement limité au tenant de la session établissement.
5. Plusieurs routes Finance réutilisent encore des route keys historiques larges (`POST /api/payments`, `GET /api/backoffice/finance/unpaid`).

## Corrections appliquées

### Capacités Finance fondées sur permissions live

Les helpers de mutation Finance ne dépendent plus du nom du rôle :

- grilles : `Frais & tarifs:CREATE|UPDATE`
- moyens de paiement : `Frais & tarifs:UPDATE` ou `Paramètres Établissement:UPDATE`
- ajustement obligation : `Paiements:UPDATE` ou `Frais & tarifs:UPDATE`
- statuts paiement : `Paiements:UPDATE`
- relance forcée : `Impayés:CREATE` ou `Paiements:UPDATE`

Un `Admin School`, `Comptable`, `Directeur`, `Secrétaire` ou Super Admin avec `permissions: []` ne reçoit plus de capacité Finance par son seul libellé de rôle.

### Zéro rôle live = deny autoritaire

`liveRbacPrincipalAuthority.js` lit les rôles actifs PostgreSQL avant la résolution des grants. Pour une session établissement, seule la primitive `listActiveUserRoleKeysForSchool(userId, schoolId)` est utilisée. Une liste vide reste vide via le sentinel interne `SANS_AFFECTATION` et ne peut plus réactiver `principal.role`, `principal.roles` ou `principal.roleKeys` du JWT.

### Tenant courant autoritaire

Le `schoolCode` de session est résolu vers l'identité PostgreSQL de l'établissement, puis les rôles actifs sont chargés pour `(user_id, school_id)`. Une primitive tenant-scoped absente ou un établissement non résolu => deny fail-closed.

### Legacy runtime neutralisé

Si la résolution effective signale une source `legacy-map-fallback` ou `role_module_permissions+legacy-role-fallback`, l'autorité F6 retourne zéro permission en runtime. Les cartes legacy peuvent rester utiles au bootstrap/migration, mais elles ne restaurent plus une permission live manquante.

### PostgreSQL uniquement

L'autorité F6 est attachée uniquement au repository PostgreSQL. Le mode mémoire de développement conserve son comportement historique pour les tests/demo ; la production reste PostgreSQL obligatoire.

## Tests/gate présents

- `backend/lib/financeLiveRbac.test.js`
- `backend/lib/liveRbacPrincipalAuthority.test.js`
- `backend/scripts/verify-finance-rbac.js`
- `.github/workflows/finance-f6.yml`

Ils couvrent déjà :

- aucun rôle nominal ne débloque une mutation Finance ;
- permissions READ seules ne débloquent aucune mutation ;
- rôle stale JWT ignoré lorsque PostgreSQL renvoie zéro rôle ;
- rôles d'un autre établissement non utilisés ;
- fallback legacy neutralisé ;
- wiring PostgreSQL-only ;
- `requirePermission()` recharge la projection live avant `RbacService.canAccess()`.

La gate `Finance F6` est verte sur le premier HEAD qui l'embarque.

## Régression CI rencontrée et corrigée

L'autorité live avait initialement été attachée aussi au repository mémoire de développement. `verify-functional-rbac.js`, qui démarre volontairement `dev-memory.js`, recevait alors 403. Ce n'était pas une raison de réintroduire un fallback JWT : le wiring a été restreint à PostgreSQL uniquement. La production n'est pas concernée par le mode mémoire.

## Invariants restant à prouver avant GO CTO

- revoke permission/grant PostgreSQL + même JWT => 403 immédiat ;
- grant PostgreSQL + même JWT => autorisation immédiate ;
- changement/révocation de rôle PostgreSQL + même JWT => DB gagne ;
- Comptable : `payment-student-options` autorisé si `Paiements:READ`, `/students` reste 403 sans `Élèves:READ` ;
- cross-tenant lecture et écriture Finance => fail-closed ;
- chaque endpoint Finance sensible doit avoir une politique action/module explicite ou une preuve équivalente sans route-key historique trop large.

## Périmètre restant avant GO

P1-C — fermer la granularité endpoint/action Finance et supprimer les ambiguïtés de route-key réutilisée.  
P1-D — ajouter le test HTTP PostgreSQL stale-JWT grant/revoke + cross-tenant, puis le brancher à la gate F6.

F7 UX reste non ouvert.
