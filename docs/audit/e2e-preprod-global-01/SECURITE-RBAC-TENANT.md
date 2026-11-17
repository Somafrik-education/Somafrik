# E2E-PREPROD-GLOBAL-01 — Sécurité, RBAC et isolation des établissements

**Statut : analyse statique et automatisée uniquement.** Aucun test de sécurité authentifié n'a été exécuté en préproduction (voir `RAPPORT-FINAL-CTO.md` §2). Rien ici n'est un PASS E2E.

Source : `develop@763d9bd8` (`backend/server.js`, `backend/services/rbacService.js`).

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
