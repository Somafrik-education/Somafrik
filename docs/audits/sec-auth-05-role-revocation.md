# SEC-AUTH-05 — Révocation immédiate des rôles et permissions obsolètes

Base : `develop@c4d49077706f0eb211b516155de776816f1c49df`. #994 (`6f840e6d`) et #995 (`c4d49077`) sont intégrées.
Comptes fictifs, PostgreSQL local jetable (garde `disposableTestDatabaseGuard`), aucun jeton ni secret journalisé.

## 1. Matrice des chemins (avant correctif)

| Chemin | Source des rôles / permissions | Écart constaté |
|---|---|---|
| Routes avec `requirePermission` (la grande majorité) | `resolveEffectivePermissions` → `collectPrincipalRoleKeys` : rôles actifs relus dans `user_roles` à chaque requête | **Aucun rôle actif → repli sur les revendications du jeton** (`roleKeys`, `roles`, `role`) : un compte dont tous les rôles ont été retirés garde ses droits jusqu'à l'expiration du jeton (F7) |
| `POST /api/auth/refresh` (`issueRefreshedAccessToken`) | rôles actifs en base | **Aucun rôle actif → `session.role`** (rôle de connexion) réémis dans le nouveau jeton : le droit retiré est prolongé à chaque refresh |
| `POST /api/users/:id/reset-password` | `canResetUserPassword(req.principal)` sur les **permissions figées dans le jeton** | Un administrateur rétrogradé (ou multirôle ayant perdu son rôle admin) peut encore réinitialiser des mots de passe |
| `POST /api/backoffice/bulletin-design/preview` | `isSuperAdminPrincipal` sur les revendications | Éditeur de bulletins **hors périmètre** : non modifié (voir §6) |
| Compte désactivé | garde SEC-TENANT-01 (`user_status` dans la requête de session, PostgreSQL) | Conforme : session révoquée, 401 |
| Session révoquée, autre établissement, Superadmin sans privilège scolaire implicite | SEC-AUTH-04 / SEC-TENANT-01 / RBAC | Conformes |
| Permissions d'un rôle réduites (`role_module_permissions`) | octrois relus à chaque requête par `requirePermission` | Conforme |
| Web / Mobile | `GET /api/auth/effective-permissions` (droits effectifs relus) ; contrôle d'autorisation côté Backend | Affichage aligné dès le prochain chargement des permissions ; aucune modification client nécessaire |

Origine du repli : `user_roles` a été alimentée à partir de `users.role` par une migration qui ignore les libellés non canoniques. Un compte peut donc n'avoir **aucun** enregistrement `user_roles` : pour lui, le rôle de connexion reste la seule source. Le repli ne doit pas disparaître pour ces comptes ; il ne doit plus s'appliquer à un compte dont les rôles ont été **retirés**.

## 2. Reproduction (base `c4d49077`)

`SEC_AUTH_05_REPRO=1 node backend/lib/secAuth05RoleRevocation.http.pg.test.js` sur la base exacte : **9 écarts**.

```
DÉFAUT AUTH5-03 route admin après retrait du dernier rôle : attendu 401,403, reçu 200
DÉFAUT AUTH5-03 réinitialisation après retrait du dernier rôle : attendu 401,403, reçu 400
DÉFAUT AUTH5-13 libellé de rôle du jeton rafraîchi : SCHOOL_ADMIN
DÉFAUT AUTH5-13 route admin avec le jeton rafraîchi : attendu 401,403, reçu 200
DÉFAUT AUTH5-07 réinitialisation après rétrogradation (permission du jeton) : attendu 403, reçu 400
DÉFAUT AUTH5-05 réinitialisation du rôle retiré : attendu 403, reçu 400
DÉFAUT AUTH5-08 après retrait : attendu 401,403, reçu 200
DÉFAUT AUTH5-09 Superadmin après retrait : attendu 401,403, reçu 200
DÉFAUT AUTH5-10 Admin Pays après retrait : attendu 401,403, reçu 200
```

(La route de réinitialisation est appelée avec un corps vide : 400 = permission accordée, 403 = refusée ; aucun mot de passe n'est modifié.)

## 3. Solution retenue

1. `backend/lib/liveRoleState.js` — `loadLiveRoleState(repo, userId)` :
   - rôles actifs → ces rôles ;
   - **aucun rôle actif mais un historique `user_roles`** (tous retirés) → **aucun rôle** ;
   - aucun enregistrement `user_roles` (compte legacy), dépôt sans lecture ou erreur de lecture → repli existant inchangé.
   L'historique n'est lu que si la liste des rôles actifs est vide.
2. `collectPrincipalRoleKeys` (`functionalRbacService.js`) : tous les rôles retirés → aucun rôle, donc aucune permission, quelles que soient les revendications du jeton.
3. `issueRefreshedAccessToken` (`server.js`) : même règle ; le jeton rafraîchi porte le libellé « Sans affectation » et aucune permission.
4. `POST /api/users/:id/reset-password` : permissions effectives relues (`resolveEffectivePermissions`, comme `requirePermission`) avant `canResetUserPassword`.
5. `userHasRoleHistory(userId)` : dépôts PostgreSQL (`SELECT 1 … WHERE user_id = $1::uuid LIMIT 1`, index `idx_user_roles_user`) et mémoire.

## 4. Solutions écartées

| Option | Raison |
|---|---|
| Revalider tous les droits dans `requireAuth` | Requêtes supplémentaires sur chaque requête authentifiée, y compris les ~17 routes sans permission ; `requirePermission` revalide déjà les rôles à chaque appel. Le défaut est le repli, pas l'absence de revalidation. |
| Version d'autorisation dans le jeton (`authz_version` + déclencheurs sur `user_roles`) | Changement du contrat du jeton, déclencheurs SQL, refresh forcé de tous les clients ; ne couvre pas les réductions de permissions par rôle. Coût et risque disproportionnés pour le défaut constaté. |
| Révocation ciblée des sessions à chaque changement de rôle | Nombreux chemins d'écriture de `user_roles` à couvrir ; déconnecte l'utilisateur au lieu de seulement retirer le droit ; ne couvre pas les jetons déjà émis entre l'écriture et la révocation. |
| Supprimer le repli pour tous | Couperait l'accès des comptes legacy sans `user_roles`. |

## 5. Résultats

`backend/lib/secAuth05RoleRevocation.http.pg.test.js` (PostgreSQL, HTTP réel) : **12/12** (base : 9 écarts). `backend/lib/liveRoleState.test.js` : **6/6**.

| Réf. | Résultat | Preuve |
|---|---|---|
| AUTH5-01 JWT avec rôle actif | PASS | admin actif 200 ; réinitialisation autorisée |
| AUTH5-02 Retrait d'un rôle | PASS (base : 403 déjà sur la route ; réinitialisation 400 → **403**) | rôle remplacé SCHOOL_ADMIN → TEACHER |
| AUTH5-03 Retrait du dernier rôle | PASS (base : **200** → 403) | route admin et réinitialisation refusées |
| AUTH5-04 Utilisateur désactivé | PASS (déjà conforme) | 401, refresh 401 |
| AUTH5-05 Multirôle | PASS (base : réinitialisation 400 → **403**) | rôle retiré refusé, TEACHER conservé |
| AUTH5-06 Rôle d'un autre établissement | PASS (déjà conforme) | aucune donnée de A |
| AUTH5-07 Permissions réduites | PASS (base : **400** → 403) | permission du jeton plus utilisée |
| AUTH5-08 Réattribution | PASS (base : **200** après retrait → 403, puis 200 après réattribution) | |
| AUTH5-09 Superadmin | PASS (base : **200** après retrait → 403) | aucun privilège scolaire implicite (403) |
| AUTH5-10 Admin Pays | PASS (base : **200** après retrait → 403) | |
| AUTH5-11 Enseignant | PASS | rôles effectifs `["TEACHER"]` |
| AUTH5-12 Parent | Couvert par les suites existantes (`parentAttendanceIsolation`, `parent-linking`) | aucun changement de chemin parent |
| AUTH5-13 Refresh après retrait | PASS (base : libellé **SCHOOL_ADMIN** et route **200** → « Sans affectation », 403) | |
| AUTH5-14 Session révoquée | PASS (déjà conforme) | 401 |
| AUTH5-15 Web / Mobile légitimes | PASS | connexions Web et Mobile, compte legacy inchangé |
| AUTH5-16 Changements simultanés | PASS | 6 requêtes parallèles → 403 |

Compte legacy sans `user_roles` : comportement identique avant et après (accès à la connexion et après refresh).

## 6. Risques résiduels et constats hors périmètre

- **Erreur de lecture de `user_roles`** : comportement antérieur conservé (repli sur le rôle de connexion). Un mode fail-closed changerait le comportement en cas d'incident de base ; à décider séparément.
- **Comptes legacy sans `user_roles`** : leur rôle reste celui du jeton jusqu'à son expiration (≤ 15 min) ; un retrait passe par `users.role`. Migration des comptes restants à envisager.
- **`POST /api/backoffice/bulletin-design/preview`** : contrôle sur la revendication Superadmin du jeton. Éditeur de bulletins hors périmètre : non modifié.
- **Dépôt mémoire** : utilisateur désactivé non revérifié par la garde de session (projection absente) — mode de développement uniquement, inchangé.
- F6, HS256/RS256, `aud`/`jti` : non modifiés.

## 7. Performance

Aucune requête supplémentaire lorsque l'utilisateur a au moins un rôle actif (cas nominal). Sinon une requête `SELECT 1 FROM user_roles WHERE user_id = $1::uuid LIMIT 1` sur l'index `idx_user_roles_user` (≈ 0,1 ms mesuré). Réinitialisation de mot de passe : une résolution de permissions, identique à celle de `requirePermission`.
