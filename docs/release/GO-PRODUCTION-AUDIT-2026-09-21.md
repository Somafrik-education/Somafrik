# Audit final parité et GO Production

**Date :** 2026-09-21  
**SHA audité :** `develop@080cc8d77ff25a27e4d1e5edab5118216a424c1b`  
**Verdict :** **HOLD**. Pas de GO Production.

Cet audit est frais. Il ne reprend pas les conclusions de #715, #722 ou #741 comme preuves. Les tests cités ont été rejoués sur ce SHA, ou marqués SKIP / À REVALIDER.

## Drift

`git fetch origin develop` le 2026-09-21T20:47:10Z.

| Référence | SHA |
| --- | --- |
| SHA CTO connu | `080cc8d77ff25a27e4d1e5edab5118216a424c1b` |
| `origin/develop` | `080cc8d77ff25a27e4d1e5edab5118216a424c1b` |
| Commits depuis ce SHA | aucun |

Pas de drift. L'audit porte sur le develop courant. Working tree propre au départ.

## 1. Inventaire

| Élément | Valeur |
| --- | --- |
| Node local | v22.14.0 (`engines` >= 22.12.0 ; CI pin 22.12.0) |
| npm | 10.9.7 |
| Web | `somafrik-web` 1.0.0, React 18 |
| Backend | `somafrik-backend` 1.0.0 |
| Mobile | Expo SDK 54.0.37, React Native 0.81.5, app `1.2.1`, `versionCode` 13 |
| Package / bundle | `com.somafrik.app` |
| targetSdk | non figé dans `app.config.js`. Défaut `expo-modules-core` = 36 si le prebuild ne le surcharge pas. Aucun AAB inspecté. |
| Migrations SQL | 72 fichiers dans `backend/db/migrations/` |
| PostgreSQL labo | 16.15, base isolée `somafrik` sur 127.0.0.1, seed démo activé pour les parcours HTTP |
| PostgreSQL préprod | `GET https://api-preprod.somafrik.app/api/health` → `database: postgresql`, HTTP 200. SHA déployé non exposé. |
| PostgreSQL prod | `GET https://api.somafrik.app/api/health` → `database: postgresql`, HTTP 200. Le corps ne contient pas `reportCardSource`, contrairement à la préprod. |
| Web préprod | `https://preprod.somafrik.app/connexion` HTTP 200. Bundle résout `https://api-preprod.somafrik.app`. |
| Web prod build local | `npm run build` avec `VITE_API_URL=https://api.somafrik.app` et `NODE_ENV` non forcé à `test`. API effective `https://api.somafrik.app`. |
| APK / AAB | aucun artefact testé |
| Mémoire | interdite en production (`repositoryFactory.js`, boot `server.js`). Utilisée seulement par les scripts qui lancent `dev-memory.js`. |

### PR demandées, présentes dans ce develop

| PR | Preuve |
| --- | --- |
| #685 | merge commit `080cc8d7`, HEAD de develop |
| #755 | merge `a034b432`, ancêtre de HEAD |
| #738 | merge `acaa425c`, ancêtre de HEAD |
| #749 | merge `b1a783b0`, ancêtre de HEAD |

Aussi dans l'historique de ce SHA, sans être une clôture runtime : #745, #750, #751 (finance #744).

## 2. Parité Web ↔ Mobile

Matrice complète : [GO-PRODUCTION-PARITY-MATRIX.json](./GO-PRODUCTION-PARITY-MATRIX.json).

Une différence d'écran n'est pas un défaut quand le résultat métier est le même. Deux endpoints de login (`/api/backoffice/login` et `/api/login`) alimentent le même service de jeton.

| Statut | Lignes |
| --- | --- |
| PASS | connexion, refresh, lockout, setup établissement, année scolaire, liste classes, inscription / liste élèves, création enseignant canonique (tests) |
| FAIL | permissions live finance sur seed PostgreSQL ; parcours finance school_admin |
| PARTIEL | logout appareil, must_change_password, profil, périodes, structure, cours, détail classe, fiche, parents, présences (lecture prouvée, écriture non jouée), notes, bulletins, utilisateurs multi-rôles, communication, push, planning, paramètres |
| À TESTER | création et modification de classe, historique élève |
| N/A volontaire | pays / abonnements / marketplace Web ; hors-ligne et push Mobile |
| Web seulement constaté | documents élève, historique fiche |

## 3. E2E métier

Environnement : API Node lancée sur PostgreSQL 16 local, seed démo, pas la préprod (aucun login préprod, aucun write Render).

| Parcours | Résultat |
| --- | --- |
| A. Connexion, refresh, logout | PASS labo. Rôles super_admin, country_admin, school_admin, teacher, parent. Logout révoque l'access courant et l'access tourné. |
| B–F. Setup, année, classe, élève, enseignant, professeur principal | Lectures classes / élèves / enseignants PASS. Créations UI non exécutées. Gates tenant année, enrollment, users PASS. |
| G. Présences | Lecture scopée PASS. Isolation parent HTTP PostgreSQL PASS. Écriture d'appel non exécutée. |
| H–I. Notes, examens, bulletin | Tests LOT 5 PASS. UI et publication non exécutées. |
| J. Finance | **FAIL** sur le seed PostgreSQL : school_admin reçoit 403 sur grilles, obligations, paiements, impayés et options d'encaissement. |
| K. Multi-rôles | Liste utilisateurs PASS. Grant / revoke non rejoués. Gate users-tenant PASS. |
| L. Communication | Liste messages 200 vide. Écriture non exécutée. |
| M. Setup première connexion | Tests LOT 1 PASS, dont le blocage setup tant que `mustChangePassword`. |
| N. Parent / élève | Parent HTTP PASS et scopé. Élève mobile non ouvert. |
| O. Navigation native | Non exécutée (pas d'APK, pas d'émulateur). |
| P. Push | Tests statiques PASS. Pas de device. |

Interdit respecté : aucun succès d'interface sans écriture observée. Les lectures 200 sont des réponses API, pas des écrans.

## 4. Intégrité tenant

Autorité prévue : `school_id` UUID. Les dépôts classes / élèves lient `class_code` **et** `school_id`. `classes.class_code` est UNIQUE globalement dans `schema.sql`, ce qui empêche le même code dans deux établissements et transforme une collision en refus d'écriture, pas en fusion de lignes.

Preuve labo :

- school_admin CD (`school_id` `190c0e62-b03e-4240-a5f5-a960d10cea2e`) : 50 classes, 48 élèves.
- `GET /classes?schoolCode=BI-ESB-26-001` et `GET /students?schoolCode=BI-ESB-26-001` renvoient exactement les données CD. Le query param n'élargit pas le scope.
- Admin BI (`school_id` `2f756e84-4315-41d6-aceb-34254d6bf400`) : 0 classe, 0 élève, 0 enseignant. Pas de ligne CD.
- Enseignant : 5 classes, 11 élèves, 12 présences, 403 sur utilisateurs et paiements.
- Parent : 1 classe, 2 élèves, 4 présences.
- Jeton invalide : 401.
- Les tests d'isolation parent (P0-2 à P0-14) sont PASS sur PostgreSQL.

Écart de contrat, pas une fuite observée : les DTO ne portent pas tous `schoolId`. Les élèves exposent le login code `CD-UK-26-001`. Les classes et enseignants exposent `school_code` `CD-2026-0001`. À traiter comme dette P2, pas comme fuite démontrée.

Le seul établissement du seed qui a des classes est Unikin. Une collision réelle de `class_code` entre deux écoles peuplées n'a pas été rejouée au-delà de la contrainte UNIQUE et des tests de dépôt.

## 5. RBAC et sécurité

| Contrôle | Constat sur ce SHA |
| --- | --- |
| Algorithme JWT | **HS256**. `tokenService.js` refuse tout `alg` autre que HS256, y compris RS256 (anti-confusion). Le libellé « RS256 » du mandat ne correspond pas au contrat testé (`verify-jwt-header.js`). |
| TTL access | Défaut et plafond production 900 s. Réponses labo `expiresIn: 900`. |
| Refresh / logout | PASS labo, rotation et révocation. |
| must_change_password | Présent dans le contrat. Parcours de changement non rejoué. |
| Lockout | Gate PASS. `SOMAFRIK_DISABLE_LOGIN_LOCKOUT=true` est refusé en production. |
| Jeton invalide | 401, message sans stack. |
| CORS préprod | Origine `https://preprod.somafrik.app` acceptée. Origine étrangère : 403. |
| CORS prod | Origine `https://somafrik.app` acceptée sur `/api/health`. |
| Headers | `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`. HSTS présent sur la prod derrière TLS. |
| Rate limit | Login : `X-RateLimit-Limit: 15`, puis 429. |
| Stack / secrets | Erreur 500 masque `detail` en production. Gitleaks 8.24.3 : 2271 commits, no leaks. |
| Secrets prod | `JWT_SECRET` obligatoire, >= 32, valeurs d'exemple refusées. Seed démo refusé. Mémoire refusée. `SOMAFRIK_AUTH_OPTIONAL` et `SOMAFRIK_E2E` refusés. |
| Mobile | SecureStore déclaré. Logout code révoque le push device puis efface la session. `google-services.json` versionné : clé client Firebase, package `com.somafrik.app`, pas de clé privée. |
| Finance live | **FAIL seed.** `resolveFinanceLivePermissions` remplace les permissions du JWT par `user_roles`. Table vide après seed PostgreSQL. Le backfill existe pour le dépôt mémoire seulement. |

`npm audit` (non corrigé, hors mandat) : backend 2 high / 4 moderate ; web 6 high / 5 moderate ; mobile 16 high / 4 moderate. Pas de critical. Les high Mobile sont surtout la chaîne Expo, déjà signalée par le README. Ce n'est pas un exploit démontré.

## 6. Legacy et dettes

| Dette | Classe | Preuve |
| --- | --- | --- |
| Finance school_admin impossible sur seed PostgreSQL (`user_roles` vide) | P1 | Reproduit. 0 ligne `user_roles`, 403 finance. |
| #744 encaissement Mobile, issue OPEN, device non rejoué | P1 jusqu'à preuve runtime | Correctifs #745 #750 #751 dans le SHA. Tests LOT 4 PASS. Pas de clôture. |
| `docs/project/OPERATIONS.md` décrit encore Vercel et `somafrik-api-preprod.onrender.com` | P2 | Contredit `docs/render.md`, qui est la source canonique. Le bundle Web réécrit l'ancienne origine vers `api-preprod`. |
| DTO `school_code` vs `login_code` | P2 | Observé sur classes / enseignants vs élèves. |
| README compte démo `CD-IN-26-001` | P2 | Le seed PostgreSQL de ce boot expose `CD-UK-26-001`. |
| targetSdk non épinglé, pas d'AAB | P2 process store | Défaut SDK 36 non prouvé sur binaire. |
| Pas de Error Boundary React | P3 | Aucun `componentDidCatch` dans `web/src`. |
| Route inconnue Web redirige vers `/tableau-de-bord` | P3 | `App.tsx` `path="*"`. |
| Pas de service worker | P3 | Web Push #648 hors priorité. |
| HS256 au lieu du mot RS256 du mandat | P3 contrat | Choix testé, pas un contournement d'auth. |
| Audit npm high Mobile | P2 dépendance | Pas un P0 démontré. |

AdminCrud retiré (LOT 8 PASS). Écritures legacy examens, bulletins, documents, périodes refusées dans le code. BackOffice state write testé PASS une fois le schéma PostgreSQL initialisé. Aucune URL preview dans le profil EAS production : `https://api.somafrik.app`, et le profil production refuse l'API préprod.

## 7. Tests exécutés

Détail des commandes : [GO-PRODUCTION-EVIDENCE-2026-09-21.md](./GO-PRODUCTION-EVIDENCE-2026-09-21.md).

| Gate | Résultat |
| --- | --- |
| typecheck Web + Mobile + backend syntax | PASS |
| lint Web | PASS |
| build Web production (NODE_ENV propre) | PASS |
| tests Web vitest | PASS, 244 fichiers, 1269 tests |
| JWT header, auth sessions, privacy, RBAC S1.4, sanitize | PASS |
| gitleaks | PASS |
| LOT 0 à 8 | PASS |
| users, academic year, presence, enrollment, planning, sync L1, finance RBAC statique | PASS |
| présences roster + isolation parent PG | PASS |
| enrollment script, lockout, functional RBAC script, backoffice PG | PASS au rejeu avec seed |
| mobile release env, push, legal, security, release readiness, android readiness, crud, parent P0 | PASS |
| mobile push N1 | PASS |
| CI du dépôt sur ce SHA | non rejouée ici ; la PR docs ne couvre pas les gates code |
| Lots bulletins 0–11, finance-management complet, web smoke navigateur, nightly CI | SKIP, non lancés dans cette fenêtre |
| UI Web Playwright, APK, device, charge préprod | SKIP |

Un SKIP n'est pas un PASS.

Premier échec de `verify:jwt-header`, `verify:auth-sessions` et de plusieurs scripts HTTP : cause d'audit, `SOMAFRIK_SKIP_DEMO_SEED=true` hérité, donc pas de comptes démo. Rejeu sans ce flag : PASS. Ce n'est pas un défaut produit.

## 8. Performance

Labo seulement. PostgreSQL 16, seed démo, un processus Node, N=20 séquentiel. Ce n'est pas une preuve de capacité préprod ou prod. Aucune charge n'a été envoyée à la préprod.

| Route | p50 | p95 | p99 | Statut | Erreurs 5xx |
| --- | --- | --- | --- | --- | --- |
| login school_admin | 55 ms | 61 ms | 64 ms | 13×200 puis 7×429 (plafond 15) | 0 |
| refresh | ~380–453 ms (5 échantillons) | — | — | 200 | 0 |
| classes | 4.4 ms | 4.8 ms | 5.0 ms | 200 | 0 |
| students | 4.3 ms | 4.9 ms | 4.9 ms | 200 | 0 |
| teachers | 4.9 ms | 5.4 ms | 5.5 ms | 200 | 0 |
| users | 220 ms | 230 ms | 239 ms | 200, ~136 Ko | 0 |
| assignments | 3.4 ms | 4.1 ms | 5.2 ms | 200 vide | 0 |
| presences | 18 ms | 23 ms | 23 ms | 200 | 0 |
| payments / fees / unpaid | ~3 ms | < 11 ms | < 11 ms | **403** | 0 |
| messages | 3.4 ms | 4.4 ms | 4.6 ms | 200 vide | 0 |
| planning | 8.5 ms | 9.6 ms | 10.0 ms | 200 vide | 0 |

Sous les seuils indicatifs de latence sur ce jeu minuscule. Le 403 finance n'est pas un timeout. Le pool et la RAM n'ont pas été instrumentés. Aucun effondrement observé sur N=20.

## 9. Mobile GO store

Présent dans le code : package `com.somafrik.app`, version 1.2.1 / versionCode 13, icône, adaptive icon, splash, demo mode refusé hors développement, API prod HTTPS imposée, preview refusé vers l'API prod, POST_NOTIFICATIONS demandé au runtime Android 13, SecureStore, scheme `somafrik`, liens confidentialité et suppression vers `https://somafrik.app`.

Manque pour un GO store :

- aucun AAB/APK de ce SHA inspecté ;
- targetSdk du binaire non lu ;
- Data Safety Play : dossier `docs/compliance/google-play/data-safety/` existe, formulaire Play non soumis ici ;
- test fermé Play : **process store**, pas un bug métier ;
- App Store : pas de build iOS, pas de preuve Privacy Manifest / compte Apple. HOLD App Store ;
- crash startup, navigation native, deep link `somafrik://` : non exécutés.

## 10. Web GO prod

Build local propre : API `https://api.somafrik.app`, `DEV` false, `PROD` true. L'ancienne origine Render n'est utilisée que comme source de réécriture vers l'API préprod canonique.

Préprod déployée : le bundle courant fait la même réécriture et appelle déjà `https://api-preprod.somafrik.app`. Le symptôme DNS de #730 n'est pas reproduit sur ce bundle. Le login UI préprod n'a pas été rejoué : **À REVALIDER**, pas un P0 rouvert.

Présent : favicon, titre et meta description, pages `/confidentialite` et `/suppression-compte`, CORS aligné. Absent : service worker (non bloquant), error boundary, vraie page 404.

## 11. Backend et PostgreSQL

Boot labo : `database: postgresql`, schéma appliqué, seed démo chargé parce que `NODE_ENV` n'était pas `production`. En production le boot refuse mémoire, secret faible, TTL > 900 et seed démo.

Health préprod et prod : PostgreSQL ok. Préprod annonce aussi les volumes pièces jointes et report-card prêts. Le labo est retombé en `ephemeralFallback` pour ces volumes : normal sans disque, pas une preuve prod.

Migrations : 72 fichiers SQL. Idempotence non rejouée une seconde fois sur une base déjà migrée dans cet audit. Backup et restore : documentés, **non exécutés**.

## 12. Exploitation

`docs/render.md` est cohérent avec les URL publiques testées. `docs/project/OPERATIONS.md` est périmé (Vercel, ancienne URL Render) : risque de runbook, P2, pas un défaut du binaire.

Bloquant technique avant prod : preuve backup/restore, SHA Render = SHA candidat, finance school_admin sur une base dont `user_roles` est réellement peuplé, AAB du SHA, smoke login préprod.

Runbook, pas un bug : rotation des clés, test fermé Play, Data Safety, monitoring, procédure de rollback déjà écrite dans OPERATIONS à condition de la réaligner sur Render.

## 13. Classification

**P0 : 0** démontré. Pas de fuite cross-tenant, pas d'auth contournée, pas de crash généralisé sur les parcours lancés.

**P1 : 2**

1. Finance school_admin impossible sur PostgreSQL alimenté par le seed démo : `user_roles` reste vide, le RBAC live finance répond 403 alors que le JWT annonce les droits paiements. Le chemin canonique de création (tests qui insèrent `user_roles`) n'a pas été rejoué comme parcours UI. La préprod n'a pas été authentifiée.
2. #744 reste OPEN. Les correctifs sont dans le SHA et LOT 4 est vert. Le parcours Mobile « obligations de l'élève inscrit » n'a pas été rejoué sur appareil ou préprod.

**P2 :** runbook OPERATIONS périmé, identifiants école mixtes dans les DTO, code établissement du README différent du seed, targetSdk/AAB non prouvés, dettes npm high Mobile.

**P3 :** pas d'error boundary, pas de 404 dédiée, pas de service worker, écart de libellé RS256 vs contrat HS256.

## 14. GO PRODUCTION GATES

| Gate | État |
| --- | --- |
| P0 ouverts | 0 démontré |
| P1 ouverts | 2 (finance seed PostgreSQL / RBAC live ; #744 runtime Mobile) |
| CI | À REVALIDER sur la PR. Cette livraison est documentaire : les gates code ne se déclenchent pas toutes. |
| Web E2E | HOLD. Vitest PASS. Pas de navigateur, pas de login préprod. |
| Mobile APK | HOLD. Aucun binaire. |
| PostgreSQL | PARTIEL. Labo 16 PASS sur les gates listées. Préprod health PASS sans SHA. Prod health sans `reportCardSource`. |
| RBAC | PARTIEL. Scripts PASS. Finance live 403 sur le seed. |
| Cross-tenant | PASS sur le jeu labo et les tests d'isolation parent. Collision de classes entre deux écoles peuplées non rejouée. |
| Performance | PARTIEL labo, sous les seuils sur un petit seed. Pas une preuve préprod. |
| Google Play | HOLD process. Pas d'AAB, pas de test fermé. |
| App Store | HOLD. Pas de build iOS. |
| Observabilité / backup | HOLD. Runbook existant, restore non exécuté. |

**Décision Cursor : HOLD. STOP. Pas Ready. Pas merge. Pas production.**

## Actions avant production

1. Peupler `user_roles` sur toute base PostgreSQL qui sert de démo ou de préprod, ou faire échouer le seed s'il ne le fait pas. Rejouer finance school_admin jusqu'à un 200 scopé.
2. Rejouer #744 sur Mobile préprod (élève inscrit, obligations, pas seulement « Non imputé ») et fermer l'issue sur preuve.
3. Smoke login Web préprod vers `https://api-preprod.somafrik.app` avec un compte réel, sans write destructif.
4. Produire l'AAB du SHA, lire `targetSdk`, confirmer l'absence de `READ/WRITE_EXTERNAL_STORAGE`.
5. Exécuter un backup et un restore de la base candidate, puis health + login.
6. Aligner `docs/project/OPERATIONS.md` sur `docs/render.md` dans un mandat séparé. Pas dans cette PR.
7. Ne pas promouvoir tant que le SHA Render préprod n'est pas égal au SHA candidat.
