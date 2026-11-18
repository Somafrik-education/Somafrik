# E2E-PREPROD-GLOBAL-01 — Sécurité, RBAC et isolation des établissements

Ce document mêle trois natures de preuve, signalées à chaque fois :
- **[E2E préprod]** : exécuté contre `api-preprod.somafrik.app` ;
- **[Code]** : analyse statique ;
- **[Auto]** : tests automatisés.

Aucun test **authentifié** n'a été exécuté en préproduction : il n'y a pas de comptes de test (voir `RAPPORT-FINAL-CTO.md` §2).

Sources :
- code : `develop@93f98e44` (`backend/server.js`, `backend/services/rbacService.js`) ;
- préproduction : API `gitSha=93f98e44`, lu le 2026-11-17 à 12:14 UTC.

## 0. [E2E préprod] Refus sans authentification (E2E-009), exécuté le 2026-11-17

- **GET :** 138 routes protégées appelées sans jeton, avec des identifiants inexistants (`E2E-NONEXISTENT-0000`) → **138 × 401**, message uniforme `{"message":"Authentification JWT requise"}`, aucune donnée.
- **Écritures :** 196 routes protégées (POST, PUT, PATCH, DELETE) appelées sans jeton, corps vide `{}` et identifiants inexistants → **196 × 401**, même message. Les 7 routes publiques ont été exclues : connexion, identification, refresh, essai, effacement, et la route de déverrouillage E2E.
- **Route de diagnostic :** `GET /api/debug/notes-authz-trace` → **404**. La route n'existe pas en préproduction, donc `SOMAFRIK_AUTHZ_TRACE≠1`.
- **Débit :** contrôlé, une requête toutes les 200 ms. Aucune écriture possible : tout est refusé avant le gestionnaire.
- **Preuves :** `preuves/E2E-009-unauth-sweep.tsv`, `preuves/E2E-009-unauth-write-sweep.tsv`.

**Résultat : aucune route protégée n'est accessible sans authentification. Aucun P0 constaté sur ce périmètre.**

## 0 bis. Points non vérifiables à ce stade

- **`SOMAFRIK_E2E` / `POST /api/backoffice/e2e/clear-login-lockout` (E2E-013) : BLOCKED.**
  - La clé API Render enregistrée est refusée (401).
  - Appeler directement la route n'est pas une méthode acceptable : si la variable valait `true`, l'appel **effacerait** les compteurs de verrouillage, ce qui est une suppression de données, interdite.
  - **[Code]** En production, `assertLoginLockoutProductionGuards` refuse de démarrer avec `SOMAFRIK_E2E=true`. En préproduction, aucune garde équivalente n'existe.
- **#1178, côté base (C03 et C06) : BLOCKED,** faute d'accès PostgreSQL de préproduction en lecture seule. Les requêtes de comptage prêtes sont dans l'issue.

## 1. Surface non authentifiée

Sur 347 routes API, **12 seulement ne passent pas par `requireAuth`**. Les autres exigent une session, et presque toutes une permission RBAC (291 routes sont inscrites dans la table `rbacService`).

| Route | Protection constatée dans le code | À vérifier en préproduction |
|---|---|---|
| `GET /`, `GET /web/` | Page ou redirection | — |
| `GET /api/health` | Public, par conception | Contenu exposé (aucune donnée métier) |
| `GET /api/schools/:code`, `GET /api/schools/:code/logo` | Public : identité publique de l'établissement | Aucun champ privé dans la réponse |
| `POST /api/login`, `/api/backoffice/login`, `/api/identify` | `loginRateLimiter` et verrouillage de compte | Verrouillage après N échecs (E2E-002) |
| `POST /api/auth/refresh` | Jeton de rafraîchissement requis dans le corps | Rotation, refus d'un jeton révoqué (E2E-003) |
| `POST /api/privacy/erasure-requests` | `loginRateLimiter` | — |
| `POST /api/public/trial-requests` | `trialRequestRateLimiter` | — |
| `POST /api/backoffice/e2e/clear-login-lockout` | 404 sauf si `SOMAFRIK_E2E=true` **et** `NODE_ENV≠production`. En production, `assertLoginLockoutProductionGuards` refuse de démarrer avec `SOMAFRIK_E2E=true` | **Préproduction : vérifier `SOMAFRIK_E2E`.** Si la variable vaut `true`, n'importe qui peut lever les verrous de connexion, ce qui facilite la force brute (E2E-013). |

Les routes `/api/debug/notes-authz-trace` et `/api/mobile/push-devices/test` exigent `requireAuth` et ont des gardes propres : la première n'existe que si `SOMAFRIK_AUTHZ_TRACE=1`, la seconde dépend d'un environnement et d'un acteur dédiés.

## 2. Routes authentifiées sans entrée RBAC

Environ 44 routes sont protégées par `requireAuth`, plus des contrôles propres à chaque gestionnaire, mais n'ont pas d'entrée dans `rbacService`. Exemples :
- `me/*` et `auth/*` (portée : l'utilisateur lui-même) ;
- `dashboard/*` ;
- `mobile-sync/l1/*` ;
- les lots de cartes élèves ;
- les pièces jointes de communication.

Leur contrôle d'accès est donc **applicatif** : périmètre d'établissement, rôle et propriété de la ressource sont vérifiés dans le gestionnaire. Ce n'est pas une anomalie en soi, mais chacune doit être couverte par un test négatif de rôle et d'établissement en E2E (E2E-009 à E2E-011, E2E-019 à E2E-022). Liste complète : `INVENTAIRE-FONCTIONNALITES.md` (colonne « Permissions » = —).

## 3. Isolation multi-tenant

- **Côté application :** le tenant est dérivé de `users.school_id` (membership) et de `tenantScopeService.assertSchoolAccess`, jamais d'un `schoolCode` laissé au client sans contrôle. C'est couvert par les tests automatisés existants (RBAC HTTP live, guided B8, PG audit10 ISO).
- **Côté base : risque ouvert, P1 sécurité.** [#1178](https://github.com/Somafrik-education/Somafrik/issues/1178) : PostgreSQL accepte des `teacher_assignments` et des `enrollments` qui référencent la classe ou la matière d'un autre établissement (caractérisations C03 et C06). La défense en profondeur manque ; la correction suppose d'abord un audit des données (lecture seule, sur GO CTO).
- **Verrou NFC :** maintenu (`studentCardNfcReleaseGate`). Aucun scénario ne le contourne (E2E-116).

## 4. Points de sécurité à exécuter dès le déblocage

1. Balayage, sans authentification, des routes GET protégées, en débit contrôlé : 401 attendu partout, sans aucune donnée.
2. Matrice rôle × module, avec un compte par rôle : 403 attendu hors périmètre.
3. Établissement A contre B, et pays Burundi contre RDC, avec des identifiants croisés : 403/404, sans fuite par comptage ou message d'erreur.
4. Révocation d'un rôle, puis appel avec la session existante : refus effectif.
5. Valeur de `SOMAFRIK_E2E` en préproduction (lecture de la configuration Render, sur GO).
