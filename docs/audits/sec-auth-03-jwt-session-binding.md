# SEC-AUTH-03 — Audit de la liaison JWT ↔ session (jetons sans `sessionId`)

Base : `develop@a0edc64a`. Comptes fictifs, PostgreSQL jetable, aucun jeton journalisé.

## 1. Chemins audités

| Élément | Emplacement | Constat |
|---|---|---|
| Signature / vérification | `backend/services/tokenService.js` | **HS256** (secret partagé `JWT_SECRET`), et non RS256. Vérification : signature à temps constant, `alg === "HS256"`, `typ === "JWT"`, `iss === "somafrik-api"`, `typ` de charge (`access` / `refresh` / curseur), `exp`. **Aucun `aud`** émis ni vérifié. Un jeton sans `exp` serait accepté, mais tous les jetons signés par le serveur en portent un. |
| Secret en production | `backend/lib/productionSecrets.js` | Longueur minimale 32, secrets connus faibles refusés au démarrage en production. |
| Durées | `backend/lib/authTokenPolicy.js` | Access 15 min (plafond production), refresh 7 jours, rotation avec fenêtre de grâce de 15 s. |
| Émission connexion Web / Mobile | `server.js` `sendAuthenticatedResponse` | Session créée, `sessionId` dans l'access et le refresh. |
| Émission refresh | `server.js` `issueRefreshedAccessToken`, `lib/sessionRefreshService.js` | Session active exigée, rotation, réutilisation → révocation de toutes les sessions, `sessionId` conservé. |
| Émission changement de mot de passe | `server.js` `/api/auth/change-password` | Recopie le `sessionId` du jeton entrant. |
| Autre signataire | `lib/mobileSyncCursor.js` | Même secret, `typ` dédié : inutilisable comme access token. |
| Contrôle d'accès | `server.js` `requireAuth` | Si `sessionId` présent : session active exigée + garde SEC-TENANT-01 (statut du compte, établissement canonique). **Si `sessionId` absent : aucun contrôle de session.** |
| Déconnexion / révocation | `/api/auth/logout`, `/api/auth/revoke-all` | Révoque la session / toutes les sessions de l'utilisateur. |
| Réinitialisation par un administrateur | `server.js` (~3372) | Révoque toutes les sessions (`password_reset`). |
| Demande d'effacement | `/api/privacy/erasure-requests` | Route publique ; un jeton est vérifié sans contrôle de session pour attribuer la demande. |
| Contrats #148 / #149 | `docs/project/V2-RECONSTRUCTION.md`, `apps/api`, `packages/auth` | RS256, liaison `sid === sessionId` et `sub === userId`, `jti` à usage unique. **Implémentés en bibliothèque V2 non branchée** : l'API servie (`backend/server.js`) ne les utilise pas. |

## 2. Constats et statut

| # | Constat | Exploitable sans le secret JWT | **Statut dans cette PR** |
|---|---|---|---|
| **F2** | Le changement de mot de passe par l'utilisateur ne révoquait pas ses autres sessions : un refresh token volé restait utilisable jusqu'à 7 jours (avec rotation). | **Oui** | **CORRIGÉ** (§3) |
| **C-03** | Un access token signé **sans `sessionId`** est accepté sans aucun contrôle de session (ni révocation, ni garde de statut / établissement). | Non : aucun chemin d'émission n'en produit ; seul un détenteur du secret peut en forger. | **NON CORRIGÉ** — proposition §4 |
| **F3** | Aucune vérification de correspondance session ↔ utilisateur : la session active d'un autre utilisateur **du même établissement** est acceptée (entre établissements, le garde SEC-TENANT-01 la révoque). | Non : exige le secret. | **NON CORRIGÉ** — proposition §4 |
| **F5** | HS256 au lieu du RS256 contractualisé (#148/#149) ; pas d'`aud` ni de `jti` sur l'access token. | — | **NON CORRIGÉ** — hors périmètre (pas de migration cryptographique dans cette PR) |
| F4 | `/api/privacy/erasure-requests` attribue une demande avec un jeton révoqué non expiré (≤ 15 min) ; l'exécution reste protégée par `requireAuth`. | Oui, impact faible | **NON CORRIGÉ** — proposition §4 |

Anciens jetons : les access tokens expirent en 15 minutes en production ; les refresh tokens ont toujours porté un `sessionId`. Aucun jeton légitime sans `sessionId` ne peut encore circuler.

## 3. Correctif F2

`/api/auth/change-password` appelle `revokeOtherSessionsForUser(sub, sessionIdCourant, "password_change")` (PostgreSQL et mémoire) juste après la mise à jour du mot de passe :
- la session courante est conservée (le nouveau jeton garde son `sessionId`, son refresh reste valide) ;
- toutes les autres sessions (autres appareils Web / Mobile) et leurs refresh tokens sont révoqués ;
- sans `sessionId` (jeton C-03), toutes les sessions sont révoquées ;
- motif `password_change` tracé, nombre de sessions révoquées dans l'audit, aucun secret journalisé.

Impact Web / Mobile : l'utilisateur qui change son mot de passe reste connecté sur l'appareil courant ; ses autres appareils devront se reconnecter.

## 4. Propositions (non réalisées, autorisation CTO requise)

Banc d'intégration : `backend/lib/disposableTestDatabaseGuard.js` refuse toute base non loopback, tout hôte de fournisseur (Render, Supabase, Neon, AWS, pooler), tout paramètre `host`/`hostaddr` distant, tout environnement production / préproduction / Render, et vérifie côté serveur la base courante et l'adresse avant le `DROP SCHEMA`.


- **C-03** : refuser en `requireAuth` tout access token sans `sessionId` (401). Impact : de nombreux tests HTTP existants forgent des jetons sans session (ex. `academicYearTenant.http.pg.test.js`) et devraient créer une session de test.
- **F3** : exiger `activeSession.user_id === principal.sub` (résolu en identifiant base) dans `requireAuth`.
- **F4** : appliquer le contrôle de session à l'attribution des demandes d'effacement, ou ignorer un jeton dont la session n'est plus active.
- **F5** : ajouter `aud` et `jti` aux access tokens ; trajectoire RS256 selon #148/#149.
