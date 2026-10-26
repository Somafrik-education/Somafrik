# SEC-JWT-01 — Audit HS256 → RS256 (phases A, B et C)

Base : `develop@e4fc2b1c8f0bdcdaf005cbe8e0299f34e1bd6d7e` (#994 à #997 intégrées). Branche : `fix/sec-jwt-01-rs256-migration`.
Comptes fictifs, PostgreSQL local jetable, secrets générés à l'exécution du banc ; aucune clé, aucun secret, aucun jeton réel dans ce document ni dans le dépôt.

**Statut : audit validé par le CTO (option A+, découpage en trois PR). SEC-JWT-01a (durcissement HS256) implémenté et comparé : §10. SEC-JWT-01b et 01c non commencés.**

## 1. Inventaire des émetteurs et vérificateurs

Une seule implémentation : `backend/services/tokenService.js` (classe `TokenService`, code maison, aucune bibliothèque JWT), instanciée une fois dans `server.js` (`new TokenService()`). Le service API Render (préproduction `somafrik-api-preprod`, production `somafrik-api`) est à la fois **seul émetteur et seul vérificateur**.

| Usage | Émission | Vérification | `typ` | Clé |
|---|---|---|---|---|
| Jeton d'accès | connexion Web/Mobile, changement de mot de passe, refresh (`server.js`) | `requireAuth` ; `POST /api/privacy/erasure-requests` (jeton facultatif) | `access` | `JWT_SECRET` (HS256) |
| Refresh token | connexion, refresh (rotation) | `sessionRefreshService` + empreinte `sessions.refresh_token_hash` | `refresh` | `JWT_SECRET` (HS256) |
| Curseur de synchronisation Mobile L1 | `mobileSyncCursor.encodeMobileSyncCursor` (`tokenService.sign`) | `decodeMobileSyncCursor` | `mobile_sync_cursor` | `JWT_SECRET` (HS256) |
| Refresh token « de grâce » (rotation concurrente, 15 s) | `sealRefreshToken` (AES-256-GCM) | `openRefreshToken` | — (pas un JWT) | `sha256(JWT_SECRET)` |
| Clé de provisionnement NFC (repli) | `studentCardNfcProvisionKey` | — | — (HMAC dérivé) | `HMAC(JWT_SECRET)` si `STUDENT_CARD_NFC_PROVISION_SECRET` absent |
| Signature des bulletins | `SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM` | — | — | clé propre (hors périmètre) |

Clients : **Web** lit seulement `exp` de la charge (`web/src/api/client.ts`) ; **Mobile** ne décode pas le jeton. Aucune clé ni vérification côté client. Les deux clients rafraîchissent une fois sur 401 puis rejouent la requête.

Scripts et tests : 58 fichiers fabriquent des jetons avec `TokenService` et un secret de test ; 81 fichiers et 27 workflows CI définissent `JWT_SECRET`.

## 2. Algorithmes, clés et environnements

| Point | Constat |
|---|---|
| Algorithme émis | HS256 uniquement |
| Algorithme accepté | HS256 uniquement (`alg` lu **après** contrôle de signature, liste implicite d'une valeur) ; `typ: JWT` exigé |
| Clé | `JWT_SECRET` ; **repli codé en dur** `somafrik-dev-secret-change-me` si absent |
| Production / préproduction (`NODE_ENV=production`) | `assertProductionSecrets` au démarrage : `JWT_SECRET` obligatoire, ≥ 32 caractères, pas une valeur connue |
| Développement / test (`NODE_ENV≠production`) | repli sur le secret public de développement (avertissement seulement) |
| Rotation | aucune : pas de `kid` ; changer `JWT_SECRET` invalide tous les jetons d'accès, refresh tokens, curseurs et refresh de grâce, **et change la clé NFC dérivée** si aucune clé NFC dédiée n'est configurée |

## 3. Matrice des claims (jeton d'accès)

| Claim | Émis | Vérifié avant correctif | Cible |
|---|---|---|---|
| `alg` (en-tête) | HS256 | égalité stricte | liste fermée d'**un** algorithme par phase |
| `kid` (en-tête) | non | **ignoré** | obligatoire en RS256, liste fermée de clés ; refus de `jku`, `x5u`, `jwk`, `x5c` |
| `iss` | `somafrik-api` | égalité stricte | inchangé |
| `aud` | **non** | **non** | `somafrik-api` émis et exigé |
| `sub` | identifiant du compte | session (SEC-AUTH-04) | inchangé |
| `exp` | `iat` + 900 s | **seulement s'il est présent** | obligatoire, numérique, `exp − iat ≤ 900 s` |
| `iat` | oui | non | obligatoire, pas dans le futur (tolérance d'horloge) |
| `nbf` | non | **non** | refusé s'il est dans le futur |
| `jti` | refresh seulement | non (refresh : empreinte en base) | inchangé (hors périmètre) |
| `typ` | `access` / `refresh` / `mobile_sync_cursor` | égalité stricte | inchangé |
| `sessionId` | oui | session active liée au sujet (SEC-AUTH-04) | inchangé |
| `schoolCode` / `schoolId` | oui | établissement canonique (SEC-TENANT-02) | inchangé |

## 4. Reproduction (base `e4fc2b1c`)

`SEC_JWT_01_REPRO=1 node backend/lib/secJwt01TokenPolicy.http.pg.test.js` : **17 écarts**, tous sur des jetons **signés avec le secret du serveur** (jeton forgé ou mal émis).

```
DÉFAUT JWT01-05 kid inconnu (signature valide) : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "../../../../etc/passwd" : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "' OR 1=1 --" : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "" : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire 42 : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire {"k":1} : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx : attendu 401, reçu 200
DÉFAUT JWT01-06 clé fournie par le jeton (jku) : attendu 401, reçu 200
DÉFAUT JWT01-06 clé fournie par le jeton (x5u) : attendu 401, reçu 200
DÉFAUT JWT01-06 clé fournie par le jeton (jwk) : attendu 401, reçu 200
DÉFAUT JWT01-07 audience incorrecte : attendu 401, reçu 200
DÉFAUT JWT01-07 liste d'audiences incorrecte : attendu 401, reçu 200
DÉFAUT JWT01-09 exp absent : attendu 401, reçu 200
DÉFAUT JWT01-09 exp non numérique : attendu 401, reçu 200
DÉFAUT JWT01-09 durée de vie > 900 s : attendu 401, reçu 200
DÉFAUT JWT01-10 nbf futur : attendu 401, reçu 200
DÉFAUT JWT01-10 iat futur : attendu 401, reçu 200
```

| Réf. | Base | Nature |
|---|---|---|
| JWT01-01 signature invalide (altérée, autre clé, vide) | **401** | protégé |
| JWT01-02 `alg: none` / `None` | **401** | protégé |
| JWT01-03 HS512, HS384, en-tête RS256 signé HMAC, `alg` absent | **401** | protégé |
| JWT01-04 HS256 signé avec une clé publique | **401** | protégé (pas de clé publique aujourd'hui ; à re-tester en RS256) |
| JWT01-05 / 06 `kid` inconnu ou arbitraire, `jku` / `x5u` / `jwk` | 200 | **en-têtes ignorés** : la clé n'est jamais choisie par le jeton, donc non exploitable sans le secret ; mais aucune politique de `kid` |
| JWT01-07 audience incorrecte | 200 | `aud` ni émis ni vérifié |
| JWT01-08 émetteur incorrect ou absent | **401** | protégé |
| JWT01-09 expiré | **401** | protégé |
| JWT01-09 `exp` absent, non numérique, durée > 900 s | 200 | **un jeton forgé sans `exp` ne périme jamais** |
| JWT01-10 `nbf` / `iat` futurs | 200 | non vérifiés |
| JWT01-11 `sessionId` absent, malformé, inconnu | **401** | protégé (SEC-AUTH-04) |
| JWT01-12 session révoquée (+ refresh) | **401** | protégé |
| JWT01-13 utilisateur désactivé | **401** | protégé (SEC-TENANT-01) |
| JWT01-14 rôle retiré (+ refresh) | **403** | protégé (SEC-AUTH-05) |
| JWT01-15 établissement contradictoire | **401** | protégé (SEC-TENANT-02) |
| JWT01-16 refresh token, curseur, `typ` absent / autre utilisés comme accès ; accès utilisé comme refresh | **401** | protégé |

**Lecture.** Aucun écart n'est exploitable sans le secret de signature : un attaquant qui détient `JWT_SECRET` peut de toute façon signer un jeton conforme. Les écarts mesurent l'absence de **défense en profondeur** (durée de vie bornée, audience, politique de clés) et la **dépendance à un secret unique** :

1. `JWT_SECRET` sert à quatre finalités (jetons d'accès et refresh, curseurs, chiffrement du refresh de grâce, clé NFC dérivée). Sa compromission ou sa rotation touche toutes ces finalités.
2. Hors `NODE_ENV=production`, le serveur démarre avec un **secret public** codé en dur.
3. Aucune rotation possible sans invalider toutes les sessions et sans risquer de changer la clé NFC dérivée.

## 5. Options de migration

Architecture réelle : **un seul processus émet et vérifie**, sur Render ; préproduction déployée automatiquement depuis `develop`. Les clients ne vérifient rien.

| Critère | Option A — bascule atomique | Option B — transition courte |
|---|---|---|
| Jetons d'accès HS256 après bascule | refusés | acceptés jusqu'à la date de fermeture |
| Refresh tokens HS256 après bascule | refusés → **reconnexion de tous les utilisateurs** ; Mobile purge son cache hors ligne de la ressource sur 401 | acceptés jusqu'à la date de fermeture |
| Risque | interruption de service visible, purge des caches Mobile | double acceptation (à borner) |

**Recommandation : A pour les jetons d'accès, avec une exception unique, bornée et liée à la base pour les refresh tokens (« A+ »).**
- Jetons d'accès : bascule atomique, **aucun** jeton d'accès HS256 accepté après bascule. Les deux clients rafraîchissent sur 401 : transparent.
- Refresh tokens : seul `POST /api/auth/refresh` accepte encore un refresh token HS256, **uniquement** s'il correspond à l'empreinte d'une session active en base (`sessions.refresh_token_hash`, déjà exigée). Il est immédiatement remplacé par un refresh token RS256 (rotation existante). Fermeture automatique à date fixe (bascule + durée de vie du refresh, 7 jours) ; compteur de télémétrie ; refus définitif ensuite (suppression du code à la PR suivante).
- Justification technique : sans cette exception, l'option A impose la reconnexion de tous les comptes et la purge des caches Mobile. L'exception ne crée aucun chemin vers une route protégée : elle ne produit qu'un jeton RS256, après les contrôles de session SEC-AUTH-04 / SEC-TENANT-01 / SEC-AUTH-05 du refresh.

## 6. Frontière de déploiement — découpage soumis au CTO

Le mandat demande d'échouer au démarrage si les clés sont absentes dans un environnement protégé. Or `develop` est déployé automatiquement en préproduction : fusionner un code qui exige des clés RS256 **arrêterait l'API de préproduction** tant que les clés ne sont pas configurées dans Render, ce qui exige un changement de secrets non autorisé par ce mandat. Conformément à la gouvernance, l'implémentation s'arrête ici.

Découpage proposé :

| Étape | Contenu | Déploiement |
|---|---|---|
| **PR 1 — SEC-JWT-01a** (HS256 durci) | vérification stricte sans changer de clé : `exp` obligatoire et numérique, `exp − iat ≤ 900 s`, `iat` / `nbf` non futurs (tolérance d'horloge), `aud` émis et exigé sur les jetons d'accès, en-têtes `kid` / `jku` / `x5u` / `jwk` / `x5c` / `crit` refusés, `typ` inchangé ; banc JWT01 vert | fusion sans configuration ; anciens jetons d'accès (sans `aud`) refusés une fois, rafraîchis automatiquement |
| **PR 2 — SEC-JWT-01b** (RS256 dormant) | `TokenService` RS256 : clé privée (`JWT_PRIVATE_KEY_PEM`), `kid` (`JWT_KEY_ID`), clés publiques de vérification en liste fermée (`JWT_PUBLIC_KEYS`, `kid` → PEM), un seul algorithme accepté par configuration, validation au démarrage (clé RSA ≥ 2048 bits, paire cohérente, `kid` présent) ; exception refresh « A+ » avec date de fermeture ; tests avec clés de fixture générées à l'exécution. **HS256 reste le mode actif tant que les variables RS256 ne sont pas définies** | fusion sans effet en préproduction |
| **Opération (mandat CTO séparé)** | génération des clés hors dépôt, configuration Render préproduction, redémarrage = bascule ; observation ; puis production après GO-PROD | changement de secrets Render |
| **PR 3 — SEC-JWT-01c** | suppression du mode HS256 et de l'exception refresh après fermeture ; démarrage refusé sans clés RS256 en environnement protégé ; adaptation des 58 fichiers de tests | après bascule effective |

Points à trancher par le CTO :
1. Validation du découpage et de l'option « A+ » (ou A stricte avec reconnexion générale).
2. Séparation des finalités de `JWT_SECRET` : conserver `JWT_SECRET` après la bascule pour le refresh de grâce, les curseurs (ou les signer en RS256) et la clé NFC dérivée, ou introduire des clés dédiées. **Ne jamais retirer ni changer `JWT_SECRET` sans vérifier `STUDENT_CARD_NFC_PROVISION_SECRET`** (la clé NFC dérivée changerait).
3. Repli de développement : remplacer le secret public par une clé éphémère générée au démarrage (PR 1 ou PR 2).

## 7. Politique de clés proposée (PR 2)

- Clé privée RSA 2048 bits minimum (3072 recommandé), PEM PKCS#8, **uniquement** dans la variable secrète Render de l'API ; jamais dans le dépôt, les clients, les journaux ou la CI (les tests génèrent leurs paires à l'exécution).
- `kid` obligatoire, choisi par l'émetteur (ex. date de génération) ; le vérificateur ne sélectionne qu'une clé de sa liste fermée ; `kid` inconnu → 401 ; aucune clé lue depuis le jeton.
- Rotation : publier la nouvelle clé publique dans la liste de vérification, attendre le déploiement, basculer la clé de signature, retirer l'ancienne clé publique après 900 s (durée du jeton d'accès) et 7 jours pour les refresh tokens.
- Algorithmes : `RS256` uniquement en mode RS256 ; `HS256` uniquement en mode HS256 ; jamais les deux pour les jetons d'accès.

## 8. Procédure de déploiement et de retour arrière (non exécutée)

1. PR 1 fusionnée → préproduction : vérifier connexion, refresh, synchronisation Mobile ; les jetons d'accès sans `aud` sont rafraîchis automatiquement.
2. PR 2 fusionnée → aucun changement de comportement (mode HS256).
3. Opération préproduction (mandat séparé) : définir les variables RS256, redémarrer ; contrôler la télémétrie de l'exception refresh ; parcours Web et Mobile.
4. Retour arrière : retirer les variables RS256 et redémarrer → retour en HS256 ; les jetons RS256 émis entre-temps sont refusés et rafraîchis (refresh token RS256 refusé → reconnexion des comptes concernés). Aucun schéma ni migration de données.

## 9. Risques résiduels

- Tous les écarts relevés exigent le secret de signature ; la priorité opérationnelle reste la confidentialité de `JWT_SECRET` (et demain de la clé privée).
- Secret public de développement si `NODE_ENV≠production` (environnement non protégé uniquement).
- Clé NFC dérivée de `JWT_SECRET` lorsqu'aucune clé dédiée n'est définie : toute rotation de `JWT_SECRET` doit être coordonnée avec les cartes (hors périmètre de ce chantier).
- Saturation du pool PostgreSQL (SEC-AUTH-05 §7.1) et revendications de rôle des routes sans `requirePermission` (SEC-TENANT-02 §6) : inchangées.

## 10. SEC-JWT-01a — Durcissement HS256 (implémenté)

Branche `fix/sec-jwt-01a-hs256-hardening`, base `develop@e4fc2b1c`. Aucune nouvelle clé, `JWT_SECRET` inchangé, NFC et Render non modifiés, RS256 non introduit.

### 10.1 Changements (`backend/services/tokenService.js`, `backend/lib/authTokenPolicy.js`)

| Règle | Portée | Détail |
|---|---|---|
| En-têtes en liste fermée | tous les jetons | seuls `alg` (HS256) et `typ` (JWT) ; `kid`, `jku`, `x5u`, `jwk`, `x5c`, `crit`, `cty` et tout autre paramètre → refus. Contrôles `alg` / `typ` existants inchangés (mêmes messages) |
| `exp` et `iat` obligatoires | tous les jetons (accès, refresh, curseur) | entiers ≥ 0 ; tous les jetons émis par `sign()` les portaient déjà |
| Expiration et fenêtre de validité (revue CTO) | tous les jetons | expiré dès `exp <= now` (auparavant `exp < now`), contrôlé en premier pour garder le contrat « expiré » des appelants (curseur Mobile → 409, réconciliation) ; puis refus de toute fenêtre vide `exp <= iat` |
| `iat` / `nbf` | tous les jetons | refus si dans le futur au-delà de la tolérance d'horloge **explicite de 60 s** ; `nbf` facultatif mais entier |
| Durée de vie ≤ 900 s | jetons d'accès | vérification `exp − iat ≤ 900` ; émission : `JWT_ACCESS_TTL_SECONDS` plafonné à 900 s dans **tous** les environnements (auparavant 8 h hors production) |
| `aud` | jetons d'accès | `somafrik-api`, imposé par le serveur à l'émission (une valeur fournie par l'appelant est écrasée), exigé à l'identique à la vérification |
| Refresh tokens, curseurs | — | format inchangé (pas d'`aud`) : les refresh tokens historiques restent valides |
| Secret de développement | — | repli public supprimé ; sans `JWT_SECRET` : secret aléatoire éphémère par processus hors production (avertissement) ; en production, aucune signature ni vérification et démarrage refusé (`assertProductionSecrets`, inchangé). Tests reproductibles et multi-instance : `JWT_SECRET` explicite (déjà le cas de tous les bancs et workflows) |

### 10.2 Reproduction (base `e4fc2b1c`, banc final)

`SEC_JWT_01_REPRO=1 node backend/lib/secJwt01TokenPolicy.http.pg.test.js` : **19 écarts** (les 17 du §4 et les 2 contrôles de compatibilité JWT01-17, où la base accepte un jeton d'accès sans `aud`).

```
DÉFAUT JWT01-05 kid inconnu (signature valide) : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "../../../../etc/passwd" : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "' OR 1=1 --" : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "" : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire 42 : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire {"k":1} : attendu 401, reçu 200
DÉFAUT JWT01-06 kid arbitraire "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx : attendu 401, reçu 200
DÉFAUT JWT01-06 clé fournie par le jeton (jku) : attendu 401, reçu 200
DÉFAUT JWT01-06 clé fournie par le jeton (x5u) : attendu 401, reçu 200
DÉFAUT JWT01-06 clé fournie par le jeton (jwk) : attendu 401, reçu 200
DÉFAUT JWT01-07 audience incorrecte : attendu 401, reçu 200
DÉFAUT JWT01-07 liste d'audiences incorrecte : attendu 401, reçu 200
DÉFAUT JWT01-09 exp absent : attendu 401, reçu 200
DÉFAUT JWT01-09 exp non numérique : attendu 401, reçu 200
DÉFAUT JWT01-09 durée de vie > 900 s : attendu 401, reçu 200
DÉFAUT JWT01-10 nbf futur : attendu 401, reçu 200
DÉFAUT JWT01-10 iat futur : attendu 401, reçu 200
DÉFAUT JWT01-17 Web : jeton d'accès historique sans aud : attendu 401, reçu 200
DÉFAUT JWT01-17 Mobile : jeton d'accès historique sans aud : attendu 401, reçu 200
```

Branche : **14/14** (JWT01-01 à 17). Tests unitaires `tokenService.secJwt01a.test.js` : **9/9** (dont les cas limites `exp <= iat` et `exp = now` pour les jetons d'accès, refresh tokens et curseurs Mobile) ; `tokenService.test.js` et `authTokenPolicy.test.js` inchangés et verts. Gate CI `verify:sec-jwt-01` (pr-gates, « Security baseline »).

### 10.3 Compatibilité Web / Mobile (preuve demandée par le CTO)

| Étape (banc PostgreSQL HTTP JWT01-17) | Résultat |
|---|---|
| Refresh token émis : en-tête `alg`/`typ` seul, aucun `aud` (format historique identique) | vérifié |
| Jeton d'accès historique (sans `aud`) sur une route protégée | 401 |
| `POST /auth/refresh` avec le refresh token historique | 200, nouveau jeton d'accès avec `aud` |
| Requête rejouée (Web) | 200 |
| Mobile : curseur de synchronisation obtenu avant le changement, jeton d'accès historique | 401 |
| Mobile : refresh puis reprise de la synchronisation **avec le même curseur** | 200, curseur conservé (aucune resynchronisation complète) |

Clients :
- **Web** (`web/src/api/client.ts`) : sur 401, un refresh partagé puis rejeu ; couvert par `web/src/lib/apiClient.authRefresh.test.ts` et `web/src/api/client.jwtRefresh.test.ts`.
- **Mobile** (`Mobile/src/services/httpClient.ts`, `httpRequest`) : sur 401, `refreshAccessTokenOnce` puis rejeu de la requête. La synchronisation L1 passe par `httpRequest` (`L1CacheRuntime` → `createL1Api(httpRequest)`) : le moteur ne voit un 401 — et ne purge sa partition hors ligne — que si le refresh lui-même échoue, comme avant. Un refresh token valide n'est pas touché par ce chantier : **aucune perte de données hors ligne**.

Effet au déploiement : chaque client voit au plus un 401 transparent sur son jeton d'accès courant (≤ 15 min), renouvelé automatiquement.

### 10.4 Résultats branche / base

HEAD de code `327eceea` (aucune modification de code après ce commit), base `develop@e4fc2b1c`.

| Ensemble | Branche | Base | Lecture |
|---|---|---|---|
| Tests unitaires (`node --test`, backend) | 2 échecs | mêmes 2 échecs (`demoAssignments.greenB`, `legacyBootMigrations.guard`) | préexistants |
| Scripts `verify:*` (33 : sec-jwt-01, sec-auth-03/04/05, sec-tenant-01/02, auth-sessions, jwt-header, privacy-erasure, platform-personal-data-deny, functional-rbac, user-role-lifecycle, rbac-s1-4, rbac-admin-01, parent-linking, teacher-account-creation, clients-management, class-student-enrollment, finance-management, finance-rbac, planning-rbac-reconcile, pedagogy-management, presences-roster, platform-management, db-config, school-setup-lot4-red, d-revalidation, mobile-sync-l1 ×5, student-card-qr) + banc mémoire SEC-AUTH-04 | **34/34** | 33/34 | seul `verify:sec-jwt-01` manque à la base (nouveau) |
| Bancs PostgreSQL (121 fichiers `*.pg.test.js`, dont le banc JWT01) | **120/121** | `backofficeStateRemoval.pg.test.js` échoue aussi sur la base | préexistant |
| Job PostgreSQL `nfc-encoding-preprod` (rejoué en local) | 19/20 au passage complet | — | voir ci-dessous |

**`studentCardRollCall.http.pg.test.js` (job NFC)** : un échec au passage complet sur l'assertion `identityLeaks(s1.data)` (prénom « Bao » trouvé dans la réponse d'un scan). Relancé : **3/3 vert sur la branche**, vert sur la base. La réponse contient un reçu chiffré aléatoire en base64url ; la recherche de sous-chaînes courtes (« Bao ») peut y trouver une coïncidence aléatoire. Fragilité préexistante du test, sans lien avec SEC-JWT-01a (aucun code de reçu, de carte ou NFC modifié) ; non masquée, signalée pour un suivi séparé.

**Confirmations demandées** :
- curseur Mobile expiré → **409** (`CURSOR_EXPIRED`) : test existant `mobileSyncCursor.test.js` « TTL dépassé → expired » inchangé et vert, plus le cas limite `exp = now` (§10.2) ;
- anciens refresh tokens utilisables : banc JWT01-17 (refresh 200 avec le refresh token historique, reprise de la synchronisation avec le même curseur) ; `verify:auth-sessions`, `verify:sec-auth-03/04/05` verts.

**Aucune régression introduite par SEC-JWT-01a.**
