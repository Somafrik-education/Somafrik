# SEC-AUTH-04 — Verrouillage de la liaison JWT ↔ session ↔ utilisateur

Base : `develop@a0edc64a67f4f1fc73edbbf456b2f3295d82fd11`. Périmètre : constats **C-03** et **F3** de SEC-AUTH-03 (#994) uniquement.
Comptes fictifs, bases PostgreSQL locales jetables, jeu de démonstration mémoire. Aucun jeton ni secret journalisé.

## 1. Gouvernance

- `origin/develop` = `a0edc64a`. PR #994 (SEC-AUTH-03) : ouverte, Draft, **non fusionnée** ; aucun de ses commits n'est dans cette branche.
- SEC-AUTH-04 ne dépend pas du correctif F2 de #994 : les deux touchent des zones distinctes (`requireAuth` / `change-password`). Voir §8 pour l'ordre de fusion proposé et la vérification de compatibilité.

## 2. Matrice d'audit (avant correctif)

Tous les access tokens sont vérifiés par `TokenService.verify` : HS256 à temps constant, `alg`, `typ` d'en-tête, `iss`, `typ` de charge, `exp`.

| Chemin | Jeton accepté | Claims exigés | Session résolue | Propriétaire vérifié | Établissement / statut | Session révoquée |
|---|---|---|---|---|---|---|
| `requireAuth` (toutes les routes protégées) | access | `sub` non exigé, **`sessionId` facultatif** | **seulement si `sessionId` présent** | **non** | SEC-TENANT-01 si session ; sinon aucun | 401 si `sessionId` présent |
| `POST /api/privacy/erasure-requests` (publique) | access | aucun | **jamais** | non | non | **accepté** (demande attribuée) |
| `POST /api/auth/refresh` | refresh | `sessionId` | oui (`findSessionByCode`) | **oui, par construction** : empreinte du refresh token stockée dans la session | via le nouvel access token | 401, réutilisation → révocation globale |
| `POST /api/auth/logout`, `revoke-all`, `change-password` | access | via `requireAuth` | via `requireAuth` | via `requireAuth` | via `requireAuth` | via `requireAuth` |
| Curseur de synchro Mobile | `typ` dédié | — | — | — | — | inutilisable comme access token |
| Passerelle Démo (`demoGateway.js`) | n'évalue pas le JWT ; relaie vers l'API interne protégée par `requireAuth` | — | — | — | — | — |

Émission (toutes portent un `sessionId` lié à une session créée pour `sub`) : connexion Web et Mobile (`sendAuthenticatedResponse`, tous rôles : Superadmin, Admin Pays, établissement, enseignant, parent), refresh (`issueRefreshedAccessToken`, même session), changement de mot de passe (recopie le `sessionId`). Vérifié en HTTP pour chaque type de compte (§5).

Stockage : `sessions.user_id` = `users.id` (PostgreSQL, résolu par `resolveDbUserId` depuis `users.id` ou `users.user_code`) ; `principal.sub` tel quel (mémoire).

Changement de rôle : `requirePermission` relit les rôles actifs en base (`listActiveUserRoleKeys`). Changement d'établissement : garde SEC-TENANT-01 (session révoquée).

## 3. Correctif

`backend/lib/accessSessionBinding.js` — `resolveBoundAccessSession({ principal, repository })`, appelé par `assertBoundAccessSession` dans `server.js` :

1. `sessionId` obligatoire, format UUID (format émis par le serveur) — sinon **401 `SESSION_REQUIRED`** (C-03) ;
2. dépôt sans `findActiveAccessSession` — 401 (fail-closed, plus de contrôle conditionnel) ;
3. session existante, non révoquée, non expirée — sinon **401 `SESSION_REVOKED`** ;
4. `session.user_id` = `JWT.sub` — sinon **401 `SESSION_SUBJECT_MISMATCH`** (F3). La session d'autrui n'est pas révoquée (pas de levier de déconnexion d'un tiers). Comparaison : UUID insensible à la casse ; sinon égalité stricte ; en PostgreSQL, `users.user_code` accepté car c'est la résolution utilisée par `createSession`. `publicId`, identifiant de connexion et e-mail ne sont jamais utilisés ;
5. puis garde SEC-TENANT-01 existant (statut du compte, établissement canonique), inchangé.

Appliqué à :
- `requireAuth` : toutes les routes protégées, sans exception de rôle (Superadmin et Admin Pays compris) ;
- `POST /api/privacy/erasure-requests` : un jeton non lié est traité comme **anonyme** (la demande n'est plus attribuée à son `sub`).

`findActiveAccessSession` (PostgreSQL) projette en plus `u.user_code` dans la même requête. Aucun mode de compatibilité.

## 4. Tests historiques réalignés (sans contournement)

38 bancs HTTP fabriquaient des access tokens **sans session** (ils passaient grâce à C-03). Ils utilisent désormais `backend/lib/testAccessSession.js` : `mintSessionAccessToken` crée une **vraie ligne `sessions`** via le dépôt (sujet = `sub` du jeton, refresh aléatoire jamais renvoyé), puis signe le jeton avec ce `sessionId`. Aucun chemin serveur n'est assoupli.

Voir §6 pour les assertions modifiées et leur justification.

## 5. Résultats AUTH4-01 à AUTH4-24

Bancs : **PG** = `secAuth04SessionBinding.http.pg.test.js` (PostgreSQL 16, base au nom unique créée puis supprimée) ; **MEM** = `secAuth04SessionBinding.memory.test.js` (dépôt mémoire, démonstration) ; **U** = `accessSessionBinding.test.js`.

| Réf. | Scénario | Attendu | Résultat | Banc |
|---|---|---|---|---|
| AUTH4-01 | JWT sans `sessionId` | Refus | **PASS** — 401 `SESSION_REQUIRED` | PG, MEM, U |
| AUTH4-02 | `sessionId` vide (`""`, espaces) ou mal formé (`abc`, chemin, nombre, UUID suffixé) | Refus | **PASS** — 401 `SESSION_REQUIRED` | PG, MEM, U |
| AUTH4-03 | `sessionId` inexistant | Refus | **PASS** — 401 `SESSION_REVOKED` | PG, MEM, U |
| AUTH4-04 | Session révoquée | Refus | **PASS** — 401 `SESSION_REVOKED` | PG |
| AUTH4-05 | Session expirée (JWT encore valide) | Refus | **PASS** — 401 `SESSION_REVOKED` ; refresh refusé | PG |
| AUTH4-06 | `JWT.sub` ≠ `session.user_id` (même établissement ; session Superadmin réutilisée par un admin école et par l'Admin Pays ; enseignant ↔ parent / admin en mémoire) | Refus | **PASS** — 401 `SESSION_SUBJECT_MISMATCH`, session d'autrui **non** révoquée | PG, MEM, U |
| AUTH4-07 | Session d'un autre établissement | Refus | **PASS** — 401 | PG |
| AUTH4-08 | JWT expiré | Refus | **PASS** — 401 | PG |
| AUTH4-09 | Signature invalide (altérée, autre secret, `alg: none`) | Refus | **PASS** — 401 | PG |
| AUTH4-10 | Refresh token utilisé comme access token | Refus | **PASS** — 401 | PG |
| AUTH4-11 | Connexion Web valide | Autorisée | **PASS** — 200 | PG, MEM |
| AUTH4-12 | Connexion Mobile valide | Autorisée | **PASS** — 200 | PG, MEM |
| AUTH4-13 | Superadmin, session valide | Autorisée selon RBAC | **PASS** — 200 ; route plateforme 200, refusée (403) à un admin école | PG, MEM |
| AUTH4-14 | Admin Pays, session valide | Autorisée selon RBAC | **PASS** — 200 ; route plateforme 200 | PG, MEM |
| AUTH4-15 | Enseignant (Web et Mobile), session valide | Autorisée selon RBAC | **PASS** — 200 | MEM |
| AUTH4-16 | Parent (Web et Mobile), session valide | Autorisée selon RBAC | **PASS** — 200 | MEM |
| AUTH4-17 | Déconnexion puis réutilisation | Refus | **PASS** — 401 ; l'autre session reste active | PG, MEM |
| AUTH4-18 | Révocation globale puis réutilisation (Web + Mobile) | Refus | **PASS** — 401 | PG, MEM |
| AUTH4-19 | Refresh après révocation | Refus | **PASS** — 401 | PG, MEM |
| AUTH4-20 | Changement de rôle | Pas d'élévation | **PASS** — rétrogradation (SCHOOL_ADMIN → TEACHER) : 403 immédiat ; jeton de sa session revendiquant SUPER_ADMIN : 403. Voir constat F7 | PG |
| AUTH4-21 | Changement d'établissement | Pas d'accès transversal | **PASS** — 401 `SESSION_SCHOOL_ATTACHMENT_MISSING`, y compris avec l'en-tête du nouvel établissement | PG |
| AUTH4-22 | Ancien JWT sans `sessionId` (forme réelle Web, Mobile, Superadmin, Admin Pays, enseignant, parent) | Refus contrôlé | **PASS** — 401 `SESSION_REQUIRED` | PG, MEM |
| AUTH4-23 | Route hors `requireAuth` (`/api/privacy/erasure-requests`) | Même protection | **PASS** — jeton sans session, session d'autrui ou révoquée → traité comme anonyme (400, demande non attribuée) ; jeton lié → 201 | PG, MEM |
| AUTH4-24 | Non-régression SEC-AUTH-03 | Préservé avec #994 | RESULTAT_AUTH4_24 | Fusion locale |

Compteurs : PG 21 contrôles OK ; MEM 5/5 ; U 6/6.

## 6. Assertions historiques modifiées

ASSERTIONS_MODIFIEES

## 7. Constats hors périmètre (non corrigés, décision CTO requise)

| # | Constat | Preuve | Exploitable sans le secret JWT |
|---|---|---|---|
| F6 | Garde SEC-TENANT-01 : si `schoolId` du jeton correspond à l'établissement canonique, un `schoolCode` différent n'est pas comparé. Sa propre session, `schoolId` B + `schoolCode` A → 200. | `[SEC-AUTH-04] CONSTAT F6` (banc PG) | Non (jeton forgé) |
| F7 | RBAC : un compte sans **aucun** rôle actif en base retombe sur les rôles revendiqués par le jeton jusqu'à son expiration (≤ 15 min). Une rétrogradation (rôle remplacé) est bien appliquée immédiatement. | `[SEC-AUTH-04] CONSTAT F7` (banc PG) | Oui, pendant la durée de l'access token |
| F5 | HS256 au lieu de RS256 ; pas d'`aud` / `jti` sur l'access token. | SEC-AUTH-03 | — (hors périmètre, décision distincte) |

## 8. Dépendance à #994 et ordre de fusion

COMPATIBILITE_994

## 9. Impact Web / Mobile et risques

- **Utilisateurs connectés** : depuis l'introduction du `sessionId`, toutes les connexions, refresh et changements de mot de passe émettent des jetons liés ; les access tokens expirent en 15 minutes. Un jeton sans `sessionId` encore en circulation ne peut provenir que d'une version très ancienne ou d'un jeton forgé : refus 401, l'application se reconnecte (refresh puis connexion). Aucun impact attendu pour une session normale.
- **Refus 401 au lieu de 403** pour un jeton dont la revendication d'établissement ne correspond plus au compte : il est maintenant refusé par le garde de session (révocation), avant le garde de la route.
- **Plateforme** : Superadmin et Admin Pays soumis aux mêmes contrôles ; aucune exemption.
- **PostgreSQL / mémoire** : même contrôle, vérifié par les deux bancs.
- **Retour arrière** : revenir au commit précédent. Aucun schéma, aucune migration, aucune variable d'environnement.
