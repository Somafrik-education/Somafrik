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

`SEC_AUTH_05_REPRO=1 node backend/lib/secAuth05RoleRevocation.http.pg.test.js` sur la base exacte : **10 écarts**.

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
DÉFAUT fail-closed : route admin refusée pendant l'incident : attendu 401,403,500,503, reçu 200
```

(La route de réinitialisation est appelée avec un corps vide : 400 = permission accordée, 403 = refusée ; aucun mot de passe n'est modifié.)

## 3. Solution retenue

1. `backend/lib/liveRoleState.js` — `loadLiveRoleState(repo, userId)`, **fail-closed** (revue CTO du HEAD `43da29a6`) :
   - `active` : au moins un rôle actif → ces rôles ;
   - `revoked` : aucun rôle actif, historique `user_roles` présent → **aucun rôle** ;
   - `legacy` : aucun rôle actif **et** `userHasRoleHistory` a répondu exactement `false` → seul cas de repli sur le rôle de connexion ;
   - `unavailable` : erreur SQL, délai dépassé (5 s), dépôt sans lecture (`listActiveUserRoleKeys` ou `userHasRoleHistory` absent), résultat invalide (liste non conforme, historique non booléen), identifiant absent → **aucun rôle**, avertissement journalisé sans identifiant ni secret.
   Les dépôts PostgreSQL et mémoire ne répondent jamais « aucun historique » par défaut : un store sans lecture d'historique rejette.
   L'historique n'est lu (et `userHasRoleHistory` exigé) que si la liste des rôles actifs est vide : le chemin nominal reste une seule requête.
2. `collectPrincipalRoleKeys` (`functionalRbacService.js`) : seuls `active` (rôles en base) et `legacy` (revendications du jeton) donnent un rôle ; `revoked` et `unavailable` → aucun rôle, donc aucune permission. Un principal **sans sujet** (`sub`/`id` absents) est une évaluation interne d'un jeu de rôles explicite (statut `explicit`, aucune lecture `user_roles`) : voir l'audit §8.
3. `issueRefreshedAccessToken` (`server.js`) : même règle ; hors `active` et `legacy`, le jeton rafraîchi porte le libellé « Sans affectation » et aucune permission. Pendant un incident de lecture des rôles, le refresh échoue (500) ou réémet un jeton sans privilège : jamais un rôle de connexion.
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

`backend/lib/secAuth05RoleRevocation.http.pg.test.js` (PostgreSQL, HTTP réel) : **13/13** (base : 10 écarts, dont l'incident de lecture des rôles : 200). `backend/lib/liveRoleState.test.js` : **10/10** (erreur SQL, délai dépassé, dépôt indisponible ou incomplet, résultat invalide, absence réelle d'historique, chemin sans sujet sans lecture, dépôts PostgreSQL et mémoire).

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

Incident de lecture des rôles (table `user_roles` renommée pendant le test) : base **200** (repli sur le jeton) → après correctif route **403**, refresh **500** sans privilège réémis.

### 5.1 Comparaison complète branche / base

| Ensemble | Branche | Base `c4d49077` |
|---|---|---|
| Tests unitaires (230 fichiers `node --test`) | 227/230 | 227/230 — mêmes 3 échecs préexistants (`demoAssignments.greenB`, `legacyBootMigrations.guard`, `secPdf01RendererIsolation`), sans lien avec SEC-AUTH-05 |
| Scripts `verify:*` (sec-auth-03, sec-auth-04, sec-tenant-01, auth-sessions, jwt-header, privacy-erasure, platform-personal-data-deny, functional-rbac, user-role-lifecycle, rbac-s1-4, rbac-admin-01, parent-linking, teacher-account-creation, clients-management, class-student-enrollment, finance-management, planning-rbac-reconcile, pedagogy-management, presences-roster, platform-management, db-config, school-setup-lot4-red) | 22/22 | 22/22 |
| `verify:mobile-sync-l1-*` (5) et `verify:d-revalidation` (gardes CI) | 6/6 après réalignement | 6/6 (ancien contrat) |
| Bancs PostgreSQL HTTP à jetons (40 sur la branche, dont `secAuth05RoleRevocation`) | 40/40 : 39 bancs verts sans changement du code serveur depuis `d5a6b5d1`, plus `studentCardRollCall` réaligné (§5.3), vert dans le job PostgreSQL `nfc-encoding-preprod` rejoué en local | 39/39 (banc SEC-AUTH-05 absent de la base) |

### 5.2 Assertions réalignées (contrat plus strict, aucune assertion affaiblie)

Sept bancs vérifiaient, après retrait de **tous** les rôles d'un compte, une réponse **200 avec une liste vide** (ou le refus métier `ROLL_CALL_ROLE_FORBIDDEN`). Ce comportement reposait sur le repli F7 : le jeton conservait ses rôles, la route passait `requirePermission`, puis le périmètre relu en base était vide. Après correctif, la requête est refusée **dès `requirePermission`** : 403 `PERMISSION_DENIED`, aucune donnée. Le client Mobile traite 403 en purgeant la ressource (`Mobile/src/offline/l1/syncEngine.ts`, `blocked_authorization`) : aucune donnée obsolète conservée, aucune modification client.

| Banc | Avant | Après |
|---|---|---|
| `mobileSyncClasses.http.pg.test.js` (enseignant, puis administrateur) | 200 `items: []` | 403 `PERMISSION_DENIED` |
| `mobileSyncStudents.http.pg.test.js` | 200 `items: []` | 403 `PERMISSION_DENIED` |
| `mobileSyncAssignments.http.pg.test.js` (sync + `GET /assignments`) | 200 `[]` | 403 `PERMISSION_DENIED` |
| `mobileSyncCourseSchedules.http.pg.test.js` | 200 `items: []` | 403 `PERMISSION_DENIED` |
| `mobileSyncSchoolCourses.http.pg.test.js` | 200 `items: []` | 403 `PERMISSION_DENIED` |
| `dRevalidation.http.pg.test.js` SY-09 (+ `dRevalidation.findings.md`) | 200 `items: []` | 403 `PERMISSION_DENIED`, sans `items` |

Chaque assertion exige le statut **et** le code exacts ; les autres assertions des bancs sont inchangées.

### 5.3 Banc Carte élève `studentCardRollCall` — réaligné sous autorisation CTO (L4-09)

`backend/lib/studentCardRollCall.http.pg.test.js` attendait `ROLL_CALL_ROLE_FORBIDDEN` après retrait du rôle `PRINCIPAL` (seul rôle du compte) ; la branche renvoie 403 `PERMISSION_DENIED` : refus plus tôt, par `requirePermission`. Réalignement autorisé par le CTO, dans les limites suivantes :

- seule l'assertion du scénario de rôle retiré change, pour `scan` et `validate` : statut 403 et code `PERMISSION_DENIED` exacts ; toutes les autres assertions du banc sont inchangées ;
- garanties conservées et vérifiées : aucune présence écrite (`attendanceOn` sur toute la table, tous établissements : `[]`), aucun appel exceptionnel, supervision toujours refusée (403), et corps du refus limité à `code` et `message` (aucune donnée d'élève, de classe ou d'établissement).

**Exception L4-09 nominative SEC-AUTH-05** (`scripts/verify-school-setup-lot4-red.ts`) :

- active seulement si les **deux** ancres propres au chantier sont présentes : `backend/lib/liveRoleState.js` et `backend/lib/secAuth05RoleRevocation.http.pg.test.js` ;
- liste fermée exacte des fichiers du chantier ; **un seul** fichier Carte élève admis (`studentCardRollCall.http.pg.test.js`) ;
- indépendante de SEC-AUTH-04 : ni ses ancres ni ses listes ne sont réutilisées ni élargies ;
- tests négatifs (auto-tests de la garde) : tout autre fichier Carte élève fait échouer la garde (autre banc, code métier, test unitaire, dépôt, Mobile, Web, migration), de même qu'un fichier LOT 4, une ancre ou un fichier de la liste SEC-AUTH-04, l'absence d'une ancre, ou un fichier de la liste sans les ancres ;
- contrôle par mutation : avec un second fichier Carte élève ajouté à la liste, la garde échoue sur le test négatif.

## 6. Risques résiduels et constats hors périmètre

- **Incident de lecture de `user_roles`** : les accès protégés sont refusés (403) pendant l'incident, y compris pour les comptes légitimes ; le refresh peut échouer (500) après rotation du refresh token, avec la fenêtre de grâce existante (15 s). Comportement voulu (fail-closed, revue CTO).
- **Comptes legacy sans `user_roles`** : leur rôle reste celui du jeton jusqu'à son expiration (≤ 15 min) ; un retrait passe par `users.role`. Migration des comptes restants à envisager.
- **`POST /api/backoffice/bulletin-design/preview`** : contrôle sur la revendication Superadmin du jeton. Éditeur de bulletins hors périmètre : non modifié.
- **Dépôt mémoire** : utilisateur désactivé non revérifié par la garde de session (projection absente) — mode de développement uniquement, inchangé.
- F6, HS256/RS256, `aud`/`jti` : non modifiés.

## 7. Performance

Aucune requête supplémentaire lorsque l'utilisateur a au moins un rôle actif (cas nominal). Sinon une requête `SELECT 1 FROM user_roles WHERE user_id = $1::uuid LIMIT 1` sur l'index `idx_user_roles_user` (≈ 0,1 ms mesuré). Réinitialisation de mot de passe : une résolution de permissions, identique à celle de `requirePermission`.

### 7.1 Délai de 5 s et connexions PostgreSQL concurrentes (mesuré)

Le délai est appliqué côté Node (`Promise.race`) : il libère la **requête HTTP**, pas la **requête SQL**. Le pool (`max` 5 par défaut, sans `statement_timeout` ni `connectionTimeoutMillis`) garde la connexion jusqu'à la fin de la requête SQL.

Mesure locale (base jetable, `LOCK TABLE user_roles IN ACCESS EXCLUSIVE MODE` tenu ~25 s, `GET /api/teachers`, compte administrateur fictif) :

| Scénario | Base `c4d49077` | Branche |
|---|---|---|
| 2 requêtes concurrentes (< taille du pool) | aucune réponse en 20 s | **403 à 5,03 s** (fail-closed) |
| Requête authentifiée sans permission (`/auth/effective-permissions`) pendant le verrou, 2 requêtes en cours | aucune réponse en 8 s | 200 à 5,0 s, **aucune permission** |
| 8 requêtes concurrentes (> taille du pool) | aucune réponse en 20 s ; 5 connexions en attente de verrou | **identique** : aucune réponse en 20 s ; 5 connexions en attente de verrou |
| Connexions encore en attente après les réponses | 2 (scénario 2) / 5 (scénario 8) | 2 / 5 : les requêtes SQL abandonnées continuent |
| `/api/health` pendant le verrou | 200, 4–5 ms | 200, 4 ms |
| Retour à la normale après libération du verrou | < 100 ms | < 120 ms |

Conséquences :
- en dessous de la taille du pool, le délai transforme une attente illimitée en refus contrôlé à 5 s ;
- au-delà, le pool est saturé **avant comme après** le correctif : les requêtes suivantes attendent une connexion libre (pas de délai d'acquisition) ; le correctif n'aggrave pas cette situation, il ne la résout pas ;
- aucune connexion n'est perdue : toutes reviennent au pool à la libération du verrou.

Un `statement_timeout` (ou `connectionTimeoutMillis`) sur le pool réglerait la saturation, mais c'est un changement de configuration globale de la base, qui touche toutes les requêtes : **hors périmètre** (consigne CTO : ne pas élargir le correctif). Recommandation pour un chantier séparé.

## 8. Audit des appels de `collectPrincipalRoleKeys` sans sujet

`collectPrincipalRoleKeys` n'est appelée que par `resolveEffectivePermissionsForPrincipal` (dépôts PostgreSQL et mémoire `resolveEffectivePermissions`, et `liveRbacPrincipalAuthority`). Chaque appelant :

| Appelant | Principal transmis | `sub` | Isolation |
|---|---|---|---|
| `requirePermission` (`server.js`, ~l. 7627) | `req.principal` | toujours présent | `requireAuth` (SEC-AUTH-04) refuse tout jeton sans `sub` UUID lié à une session active dont `user_id === sub` |
| `GET /api/auth/effective-permissions` (~l. 525) | `req.principal` | toujours présent | idem (`requireAuth`) |
| `POST /api/users/:id/reset-password` (~l. 3311) | `req.principal` | toujours présent | idem (`requireAuth`) |
| Connexion (~l. 7115) et changement de mot de passe (~l. 739) | `buildPrincipal(user)` | `resolvePrincipalSub` : identifiant du compte, jamais vide | principal construit côté serveur depuis la base |
| Refresh (`issueRefreshedAccessToken`, ~l. 7052) | `{ sub: session.user_id, … }` | `session.user_id` | `user_id` nul → `loadLiveRoleState` amont `unavailable` → `roleKeys = []`, « Sans affectation » ; jamais `explicit` avec privilège |
| Finance (`liveRbacPrincipalAuthority.js`) | `req.principal` + dépôt borné | toujours présent | rôles relus et bornés à l'établissement par le dépôt mandataire |
| **`mobileSyncScope.loadLivePermissions`** | `{ roleKeys, roles, role, schoolCode, effectiveSchoolId }` | **absent, volontairement** | **seul appel sans sujet** : `roleKeys` proviennent de `listActiveUserRoleKeys` borné à l'établissement (lecture en base, jamais du jeton) ; liste vide → retour `[]` avant tout appel. Le sujet est omis pour ne pas recharger des rôles d'un autre établissement |

Aucune donnée de requête authentifiée n'atteint le chemin `explicit` : les seuls principaux issus d'un jeton passent par `requireAuth`, qui garantit `sub`. Couvert par `liveRoleState.test.js` (chemin sans sujet sans lecture `user_roles`), les suites `verify:sec-auth-04` (jetons sans `sub` refusés) et `verify:mobile-sync-l1-*`.
