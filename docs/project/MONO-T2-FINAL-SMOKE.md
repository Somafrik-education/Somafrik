# MONO-T2-FINAL-SMOKE — Validation finale du Backend après consolidation des correctifs P1

**Statut : AUDIT / SMOKE ONLY — DRAFT / HOLD — NO MERGE.** Document exclusivement
documentaire : aucun fichier Backend, Web, Mobile, test, manifeste, seed ou migration modifié.

Légende des sources : **[EXÉCUTÉ]** commande ou test exécuté pendant ce mandat ;
**[HTTP]** requête sur serveur réel et base PostgreSQL jetable ; **[CODE]** inspection ;
**[CI]** résultat GitHub Actions lu ; **[NON EXÉCUTÉ]** contrôle non réalisé, avec motif.
Aucun jeton d'accès, jeton de rafraîchissement, secret ou mot de passe n'apparaît ici ni dans
les journaux de sonde.

---

## 1. Résumé exécutif

1. **REFRESH-R1 corrigé** [HTTP] : Web et Mobile natif, jeton rafraîchi identique au jeton de
   connexion (rôle, rôles, clés, établissement, 26 permissions, 3 affectations) sur 3
   rafraîchissements successifs ; appel enseignant **201 après chaque rafraîchissement** ; aucune
   permission ni rôle restauré après révocation ; aucun rôle d'un autre établissement importé.
2. **O9-R1 corrigé pour le rafraîchissement, pas pour les jetons d'accès déjà émis** [HTTP] :
   après suspension ou expiration, `/api/auth/refresh` est refusé (403) pour Admin, Enseignant et
   Parent, **toutes les sessions de l'utilisateur sont révoquées**, le rejeu de l'ancien jeton de
   rafraîchissement donne 401, la nouvelle connexion 403. **Résiduel confirmé** : jusqu'au premier
   rafraîchissement de chaque utilisateur (≤ 15 min), son jeton d'accès conserve lectures et
   écritures hors notes/évaluations/présences (élèves, utilisateurs, finances, communications).
   **O9 n'est pas « totalement sécurisé »**.
3. **A5-R1 corrigé en PostgreSQL** [HTTP][PG] : PATCH partiel conservant les champs omis,
   404 sans création (inconnu, autre école, statut global). **Restent ouverts** : POST sur code
   existant (écrasement, P2) ; **régression nouvelle en mode mémoire : PATCH → 500** (P2,
   introduite par #1019) ; POST inter-établissement en mémoire (P2).
4. **Baselines vertes sur `develop@35319d13`** [EXÉCUTÉ] : unit 2 679 / 0 / 3 ; PostgreSQL
   **355 / 0 / 0** ; `expectedFailures` 0/0 ; contrat de 371 routes inchangé ; Web 1 714 tests,
   `tsc` ×3, lint (0 erreur), build ; architecture et secrets OK ; multi-tenant, RBAC live et
   LOT 0–8 : § 9.
5. **Décisions** (§ 13) : **A. GO** clôture documentaire MONO-T2 ; **B. GO conditionnel** pour la
   modularisation, limité aux lots 0 (outillage) et 1 (Finance) après correction de la régression
   mémoire A5 ; **C. NO-GO production** en l'état.

## 2. HEAD réellement testé

| Élément | Valeur | Source |
|---|---|---|
| `origin/develop` | `35319d138a93ff451d2876708a670555b3b26cb2` (inchangé depuis le mandat) | [EXÉCUTÉ] `git fetch` |
| Commits depuis la base MONO-T2 `9d457bf9` | `c1e0048b` (#1018), `11fb9ecf` (#1020), `35319d13` (#1019) — aucun autre | [EXÉCUTÉ] `git log` |
| Code testé | branche `docs/mono-t2-closure-audit` à `e57bfeaa…` : `git diff origin/develop HEAD -- backend web Mobile scripts` **vide** → code identique à `develop@35319d13` | [EXÉCUTÉ] |
| PR #1017 | ouverte, brouillon, sans conflit, merge-base `35319d13`, en avance de 3 / en retard de 0, diff limité à `docs/project/` | [EXÉCUTÉ][CI] |
| Historique Git | aucune réécriture | — |

## 3. Traçabilité des correctifs

| Défaut | PR | Commit | Fichiers non-test | Changement | CI de la PR (tête avant fusion) [CI] |
|---|---|---|---|---|---|
| REFRESH-R1 | #1018 | `c1e0048b6e671aad1e48d916f3ba9078d8b011d6` | `backend/server.js` (`issueRefreshedAccessToken`) | `role`/`roles`/`roleKeys` reconstruits par `displayRoles(roleKeys)` depuis les rôles **vivants** ; `userId`, `schoolId` ajoutés | 26 succès, 9 sautés, 0 échec |
| O9-R1 (refresh) | #1020 | `11fb9ecfc98c4f83d5ac87517a1ac46781ba4d46` | `backend/server.js` (`issueRefreshedAccessToken`) | `assertSchoolCanConnect` sur l'état autoritatif pour tout principal d'établissement ; refus ⇒ `revokeAllSessionsForUser(…, "subscription_blocked")` | 27 succès, 8 sautés, 0 échec |
| A5-R1 (PATCH) | #1019 | `35319d138a93ff451d2876708a670555b3b26cb2` | `server.js`, `financePgStore.js`, `financeMemoryStore.js`, `postgresRepository.js` | `updateFinancePaymentStatus` : UPDATE seul, périmètre établissement, champs omis conservés, `profile_payload` fusionné ; 404 si aucune ligne | 28 succès, 8 sautés, 0 échec |

[CODE] Constat sur #1019 : la délégation `updateFinancePaymentStatus` est ajoutée à
`PostgresRepository` mais **pas à `FallbackRepository`** ni à `repositoryContract.js` (§ 6.3).

## 4. Résultats REFRESH-R1 [HTTP]

Base jetable `somafrik_mono_t1_fs_refresh_it`, compte Enseignant de démonstration
(affecté en Sciences à `CLS-2026-000035`).

### 4.1 Web et Mobile natif, rafraîchissements successifs

| Étape | Web (`POST /api/backoffice/login`) | Mobile (`POST /api/login`, `role: "teacher"`) |
|---|---|---|
| Claims à la connexion | `Enseignant` / `["Enseignant"]` / `["TEACHER"]`, `CD-2026-0001`, `schoolId` et `userId` présents, 26 permissions, 3 affectations, 3 classes | identique |
| Présence avant rafraîchissement | 201, 1 ligne écrite | 201, 1 ligne |
| Rafraîchissement n° 1, 2, 3 | 200 ; claims **identiques** à la connexion (même ensemble de 26 permissions) | 200 ; identiques |
| Présence après chaque rafraîchissement | **201 ×3**, 1 ligne écrite à chaque fois | **201 ×3** |

Critère du mandat : **aucune erreur 409 liée à l'identité enseignante après rafraîchissement — atteint.**

### 4.2 Révocation de rôle

| Étape | Résultat |
|---|---|
| Révocation du rôle Enseignant avec affectations actives | **409** « Révocation enseignant refusée : des affectations actives existent » (règle métier) |
| Affectations désactivées (SQL, base jetable), puis révocation par l'API Admin School | 200, `roleKeys: []` |
| Ancien jeton d'accès : présence | **403 `PERMISSION_DENIED`**, 0 écriture (permissions relues en direct) |
| Rafraîchissement après révocation | 200 ; jeton émis : rôle `Sans affectation`, `roleKeys: []`, **0 permission** |
| Présence et lecture des évaluations avec ce jeton | 403 / 403, 0 écriture |
| Nouvelle connexion | 200, `Sans affectation`, 0 permission |

**Aucune identité, affectation ou permission révoquée n'est restaurée.**

### 4.3 Multi-rôles et rôles d'un autre établissement

| Scénario | Résultat |
|---|---|
| Rôle `SCHOOL_ADMIN` actif dans BI-2026-0002 inséré pour l'enseignant CD (base jetable) | connexion et rafraîchissement : `roleKeys: ["TEACHER"]`, 26 permissions ; finances GET 403, création d'utilisateur 403 → **aucun rôle étranger importé** |
| Effet de bord observé | avec cette ligne, la connexion **et** le rafraîchissement renvoient 0 affectation (`classCodes: []`) : comportement de la connexion, reproduit à l'identique par le rafraîchissement ; donnée artificielle (rattachement multi-établissement), à investiguer hors de ce mandat |
| Enseignant + Préfet des études | connexion : rôle principal `Préfet des études`, `roleKeys: ["PREFET_ETUDES","TEACHER"]`, 74 permissions, **0 affectation** ; rafraîchissements ×2 : identiques (parité respectée, aucune permission ajoutée) |
| Présence de cet utilisateur | **409 `ATTENDANCE_TEACHER_UNRESOLVED` dès la connexion**, avant tout rafraîchissement |

**MULTI-ROLE-01 — défaut confirmé, antérieur aux correctifs** : reproduit à l'identique sur
`9d457bf9` (avant #1018) et sur `35319d13` [HTTP]. Le contrôle des présences exige
`principal.role === "Enseignant"` (`backend/db/postgresRepository.js`, `upsertAttendance`) et les
affectations ne sont calculées que si le rôle principal est Enseignant. Un utilisateur cumulant
Préfet des études et Enseignant ne peut pas faire l'appel. **P2** (fonctionnel, cumul de rôles).

## 5. Résultats O9-R1 [HTTP][PG]

Une base jetable par scénario ; abonnement CD-2026-0001 modifié par le **chemin métier**
(`PATCH /api/backoffice/subscriptions/:id` par le Superadmin), sauf « sans abonnement »
(`DELETE` SQL en base jetable puis PATCH neutre de l'abonnement BI pour invalider le cache).
Comptes : Admin School, Enseignant, Secrétaire, Parent, connectés **avant** la modification.
Chaque écriture est mesurée par différentiel de `count(*)` (`students`, `users`,
`payment_statuses`, `evaluations`, `grades`, `attendance`, `announcements`, `school_messages`).

### 5.1 Rafraîchissement et sessions

| Contrôle | Suspendu | Expiré (J-40) | `limited` (J-20) | Sans abonnement | Témoin |
|---|---|---|---|---|---|
| Refresh Admin | **403** « accès suspendu… », aucun jeton | **403**, aucun jeton | 200 | 200 | 200 |
| Sessions Admin après refus | **0 active, 2 révoquées `subscription_blocked`** | idem | 2 actives | 2 actives | 2 actives |
| Rejeu de l'ancien refresh Admin | **401 `SESSION_REVOKED`** | **401** | 200 (fenêtre de grâce) | 200 | 200 |
| Refresh Enseignant / Parent | **403 / 403**, sessions révoquées | **403 / 403** | 200 / 200 | 200 / 200 | 200 / 200 |
| Nouvelle connexion Admin / Enseignant | **403 / 403** | **403 / 403** | 200 / 200 | 200 / 200 | 200 / 200 |
| Renouvellements répétés | impossibles (session révoquée) | impossibles | chaîne 200 | chaîne 200 | chaîne 200 |

### 5.2 Anciens jetons d'accès — portée réelle (point de décision CTO)

Matrice pour **suspendu** ; **expiré** donne exactement les mêmes résultats.

| Domaine | Requête | Avant | Ancien jeton, **aucun refresh encore tenté** | Ancien jeton **après** la tentative de refresh |
|---|---|---|---|---|
| Élèves | `GET /api/students` | 200 | **200** | 401 |
| Élèves / inscriptions | `POST /api/classes/:code/students` | 201 (+1) | **201 (+1 élève, +1 compte)** | 401, 0 écriture |
| Utilisateurs | `GET` / `POST /api/backoffice/users` | 200 / 201 | **200 / 201 (+1)** | 401 / 401 |
| Finances | `GET /api/finance/payment-statuses`, `GET /api/payments` | 200 / 200 | **200 / 200** | 401 / 401 |
| Finances | `POST /api/finance/payment-statuses` | 201 | **201 (+1)** | 401 |
| Communications | `GET` / `POST /api/backoffice/announcements` | 200 / 201 | **200 / 201 (+1)** | 401 / 401 |
| Communications | `POST /api/backoffice/messages` | 201 | **201 (+1)** | 401 |
| Évaluations | `GET` / `POST /api/evaluations` | 200 / 201 | 200 / **403**, 0 écriture | 401 / 401 |
| Notes | `GET` / `POST /api/notes` | 200 / 201 | 200 / **403**, 0 écriture | 401 / 401 |
| Présences | `GET` / `POST /api/presences` | 200 / 201 | 200 / **403**, 0 écriture | 401 / 401 |
| Abonnement | `GET /api/backoffice/subscription-access` | `full` | `blocked` | 401 |

**Secrétaire (jamais rafraîchie)**, ancien jeton après suspension : `GET /api/students` 200,
`GET` statuts de paiement 200, **`POST` statut de paiement 201 (+1)**, **`POST` annonce 201 (+1)** ;
sa session reste **active** (aucune révocation proactive).

**Conclusion O9-R1** :
- **corrigé** : aucun nouveau JWT après suspension ou expiration ; sessions de l'utilisateur
  révoquées au premier refresh refusé ; aucun contournement par renouvellement répété ; refus
  sans écriture ; RBAC inchangé ;
- **résiduel confirmé (O9-R1b, P1)** : fenêtre d'**au plus 15 minutes par utilisateur**
  (`JWT_ACCESS_TTL_SECONDS` par défaut, plafonné à 15 min en production,
  `backend/lib/authTokenPolicy.js`) pendant laquelle un jeton d'accès émis avant la suspension
  conserve **toutes** les routes non protégées par `requireSchoolSubscriptionFeature`, écritures
  comprises ; les sessions des autres utilisateurs de l'établissement ne sont révoquées qu'à leur
  propre tentative de rafraîchissement ;
- `limited` et « sans abonnement » : **inchangés** (accès complet, `FEATURE_RULES`
  `create_student`… non appliquées) — décisions de politique O9-R2 / O9-R3 toujours ouvertes.

**Correctif distinct proposé (non ouvert) — MONO-FIX-O9-R1b** : à la suspension, à l'expiration
détectée et à la suspension d'établissement, révoquer **toutes** les sessions de l'établissement
(`upsertPlatformSubscription`, `establishments/:code/suspend`), et/ou vérifier le niveau
d'abonnement dans `requireAuth` (lecture ciblée de l'abonnement, pas de reconstruction de l'état
complet). Fichiers : `backend/server.js`, `backend/db/postgresRepository.js` (révocation par
établissement), éventuellement `backend/lib/sessionRefreshService.js`. Tests : matrice § 5.2
rejouée, ancienne session d'un utilisateur n'ayant jamais rafraîchi → 401 immédiat. Impact client :
Web et Mobile traitent déjà 401 (reconnexion). **1 PR.**

## 6. Résultats A5-R1 [HTTP][PG]

### 6.1 PostgreSQL (`somafrik_mono_t1_fs_a5_it`, compte Admin School CD)

| # | Requête | HTTP | Ligne `payment_statuses` après (`label` / `is_active` / `sort_order` / `profile_payload`) | Conforme |
|---|---|---|---|---|
| 0 | `POST {code:"TEST-A5", label:"Initial", status:"Inactif", sortOrder:10}` | 201 | Initial / false / 10 / `{code,label,status,sortOrder}` | oui |
| 1 | `PATCH {label:"Réglé"}` | 200 | **Réglé / false / 10** / payload fusionné | **oui** |
| 2 | `PATCH {sortOrder:5}` | 200 | **Réglé / false / 5** | **oui** |
| 3 | `PATCH {status:"Actif"}` puis `{status:"Inactif"}` | 200 / 200 | Réglé / true / 5 puis Réglé / false / 5 | **oui** |
| 4 | `PATCH /TEST-INCONNU` | **404** `FINANCE_PAYMENT_STATUS_NOT_FOUND` | aucune création ; table inchangée | oui |
| 5 | `PATCH` d'un statut de BI-2026-0002 | **404** | ligne BI intacte ; table inchangée | oui |
| 6 | `PATCH` d'un statut global (`school_id NULL`, inséré en base jetable — aucun dans le seed) | **404** | ligne globale intacte, **aucune copie créée** ; table inchangée | **oui** (A5-R3 corrigé) |
| 7 | `POST {code:"TEST-A5", label:"Écrasé par POST"}` (code existant) | **201** | **Écrasé par POST / true / 0** ; payload remplacé | **non** — **A5-R2 ouvert (P2)** |
| 8 | `POST` code vide, libellé vide, code blanc, `{}` | 400 ×4 `FINANCE_PAYMENT_STATUS_INVALID` | table inchangée | oui |
| 8b | `PATCH {code:"AUTRE"}` (contradictoire) | 400 | table inchangée | oui (message « code doit être une chaîne non vide » trompeur, P2) |
| 8c | `PATCH` `{status:"Suspendu"}`, `{sortOrder:"abc"}`, `{label:""}`, `{label:null}` | 400 ×4 | table inchangée | oui |
| 9 | Superadmin, Admin Pays, Enseignant, Parent : PATCH et POST | 403 ×8 | table inchangée | oui |

### 6.2 Mode mémoire (`backend/scripts/dev-memory.js`)

| # | Requête | HTTP | Résultat |
|---|---|---|---|
| 0 | POST TEST-A5 | 201 | créé |
| 1–3 | `PATCH {label}`, `{sortOrder}`, `{status}` sur un statut **existant** | **500 « Erreur interne Somafrik »** ×3 | aucune modification |
| 4 | PATCH inconnu | 404 | aucune création |
| 5 | PATCH d'un statut BI | 404 | BI intact |
| 7 | POST d'un code existant de BI par l'Admin CD | 201 | **statut de BI écrasé** (A5-R4 ouvert) |

### 6.3 Diagnostic

- **A5-REG-01 — régression nouvelle, confirmée (P2)** : `server.js` appelle désormais
  `repository.updateFinancePaymentStatus`, absent de `FallbackRepository`
  (`FallbackRepository.prototype.updateFinancePaymentStatus === undefined` [EXÉCUTÉ]) ⇒ exception
  ⇒ 500 en mode mémoire. Avant #1019, ce PATCH répondait 200. Mode mémoire interdit en production
  (`connectionConfig.js`) : impact limité au développement et aux démonstrations mémoire.
  **Correctif minimal proposé (non ouvert)** : délégation de 3 lignes dans
  `backend/db/fallbackRepository.js` vers `getFinanceStore().updateFinancePaymentStatus`, ajout de
  la méthode à `backend/db/repositoryContract.js`, test HTTP en mode mémoire (PATCH partiel).
  **1 PR, à fusionner avant le lot Finance de la modularisation.**
- **A5-R2 (POST sur code existant)** et **A5-R4 (POST inter-établissement en mémoire)** :
  **non corrigés**, non revendiqués comme tels par #1019. Correctif : création stricte (409 si le
  code existe pour l'établissement ; filtre établissement en mémoire). **1 PR** (peut être
  regroupée avec A5-REG-01).

## 7. Résultats Web et Mobile

### 7.1 Exécuté

| Contrôle | Résultat | Source |
|---|---|---|
| Web `vitest run` | **315 fichiers, 1 714 tests, 0 échec** | [EXÉCUTÉ] |
| Web `tsc --noEmit`, `eslint`, `vite build` | OK ; lint 0 erreur / 97 avertissements ; build OK (fragments > 500 kB) | [EXÉCUTÉ] |
| Mobile `tsc --noEmit` | OK | [EXÉCUTÉ] |
| Tests Mobile `tsx` (présences, évaluations, CRUD, finances, bulletins) | inclus dans LOT 0–8 (§ 9) | [EXÉCUTÉ] |
| Contrats API Web et Mobile natif (connexion, refresh, présences après refresh) | § 4.1 : `/api/backoffice/login` (Web) et `/api/login` (Mobile) | [HTTP] |

### 7.2 Vérifications statiques des clients [CODE]

| Parcours | Web (`web/src/api/client.ts`) | Mobile Expo React Native (`Mobile/src/services/httpClient.ts`) |
|---|---|---|
| Renouvellement automatique | anticipé 60 s avant expiration et sur 401 ; rotation persistée | sur 401 (une fois), rotation enregistrée |
| Refresh refusé (403 abonnement, nouveau) | `refreshAccessTokenOnce` → `null` ; la requête suivante reçoit 401 (session révoquée) → fin de session | `null` → `clearSecureSession`, `notifySessionExpired`, erreur « Session expirée. Veuillez vous reconnecter. » |
| Message à l'utilisateur | « session expirée » ; le motif « abonnement suspendu » n'apparaît qu'à la nouvelle connexion (403 avec message) | idem |
| Erreurs 400/403/404/409 | message serveur affiché | `ApiClientError(message, status, code)` |

**UX-O9-01 (P2)** : le refus de rafraîchissement pour abonnement est présenté comme une
expiration de session ; le motif n'est visible qu'à la reconnexion.

### 7.3 Non exécuté

**[NON EXÉCUTÉ]** Parcours d'interface réels : application Web dans un navigateur (tableau de bord
enseignant, présences, évaluations, finances) et application Mobile Expo sur appareil ou émulateur
(appel après renouvellement automatique, comportement après suspension, reconnexion). Motif :
environnement d'exécution sans émulateur ni appareil Mobile, et sans backend déployé accessible ;
la parité est couverte par les tests API ci-dessus, les suites automatisées Web/Mobile et
l'inspection des clients. **Un smoke UI manuel Web + Mobile natif reste requis avant production.**

## 8. Baselines Backend et PostgreSQL

| # | Commande | Environnement | Réussis | Échecs | Ignorés | Remarque |
|---|---|---|---|---|---|---|
| 1 | `PUPPETEER_EXECUTABLE_PATH=<chromium> node scripts/backend-test-baseline.js unit --coverage` | Node 22.22, Chromium local pour les tests PDF | **2 679** | 0 | 3 | 340 fichiers ; lignes 67,1 %, branches 68,8 % ; les 3 SKIP sont les mêmes qu'au § 4 de l'audit de clôture |
| 2 | `SOMAFRIK_TEST_PG_URL=…/somafrik_disposable_test_cluster node scripts/backend-test-baseline.js pg --coverage` | cluster PostgreSQL 16.15 jetable créé pour le mandat (`initdb`, port 55432, base sentinelle vérifiée) | **355** | 0 | 0 | 146 fichiers ; +3 tests apportés par #1018–#1020 ; `expectedFailures` **0/0** |
| 3 | Tests HTTP MONO-T1 (dans 2) | idem | **57** (13 fichiers) | 0 | 0 | A1–A5 (8), auth/sessions 15, communication 4, finance 5, notes/présences 8, élèves 6, abonnement 4, utilisateurs/rôles 6, matrice RBAC |
| 4 | Ciblés (dans 2) : `monoT1.authSessions` (REFRESH-R1), `subscriptionSuspendedAccess` (O9-R1), `monoT1.anomaly.A5` (A5-R1) | idem | **15 / 9 / 2** | 0 | 0 | plus les sondes § 4–6 |
| 5 | `node scripts/mono-t1-route-inventory.js --check` | sans base | contrat inchangé, **371 routes** | — | — | |
| 6 | Architecture : `verify-api-legacy-aliases`, `audit-api-orphans(.test)`, `audit-feature-pg-relations` | sans base | OK | 0 | — | 199 ACTIVE, 12 ORPHAN_CANDIDATE ; 28 relations, 0 manque |
| 7 | `gitleaks detect --redact` 8.24.3 | historique complet | **aucune fuite**, 3 665 commits | — | — | |
| 8 | `typecheck:backend`, Web `tsc`, Mobile `tsc` | — | 3/3 OK | 0 | — | |

## 9. Matrice RBAC et isolation multi-tenant

Toutes les commandes ci-dessous ont été exécutées sur le code de `35319d13`, chacune sur une
**base neuve** du cluster jetable (supprimée en fin de script), avec l'environnement des
workflows correspondants [EXÉCUTÉ].

| Contrôle | Commande | Résultat |
|---|---|---|
| Matrice RBAC MONO-T1 (6 comptes × 371 routes) | `monoT1.rbacMatrix.http.pg.test.js` (baseline pg) | **conforme** (1/1) |
| Multi-tenant | `npm run verify:presence-tenant`, `users-tenant`, `academic-year-tenant`, `sync-l1-tenant`, `tenant-revalidation`, `d-revalidation`, `enrollment-tenant`, `planning-tenant` | **8/8 OK** |
| RBAC HTTP live (API réelle, workflow `rbac-http-live`) | `verify-rbac-s1-4`, `verify-sanitize-user-responses`, `verify-rbac-admin-01` | **3/3 SUCCESS** |
| LOT 0–8 parity (Web, Mobile `tsx`, Backend) | `npm run test:lot<n>-parity` ; LOT 2 et 3 avec base neuve et `SOMAFRIK_SKIP_DEMO_SEED=true`, autres sans variable de base (comme `pr-gates.yml`) | **9/9 OK**, 0 SKIP réel (vitest : LOT 0 9/9, LOT 4 4/4, LOT 5 10/10, LOT 6 6/6, LOT 7 11/11 ; LOT 2 node:test 6+12+7, LOT 3 7+7+1) |
| Isolation par sondes | § 4.3 (rôle d'un autre établissement ignoré), § 6.1 n° 5 (statut BI : 404, aucune écriture), § 5 (refus sans écriture) | conforme en PostgreSQL ; A5-R4 en mémoire (§ 6.2) |
| RBAC sur les statuts de paiement | Superadmin, Admin Pays, Enseignant, Parent | 403, aucune écriture |

## 10. État des risques P0 / P1 / P2

| ID | Risque | Statut au HEAD `35319d13` | Prio. |
|---|---|---|---|
| REFRESH-R1 | Jeton enseignant rafraîchi | **Corrigé** [HTTP] | — |
| O9-R1 (refresh) | Nouveaux JWT après suspension/expiration | **Corrigé** [HTTP] | — |
| **O9-R1b** | Jeton d'accès déjà émis : ≤ 15 min d'accès lecture/écriture hors notes/évaluations/présences ; sessions des autres utilisateurs non révoquées proactivement | **Défaut confirmé (résiduel)** | **P1** |
| O9-R2 | `FEATURE_RULES` non appliquées (`create_student`…) en `limited` | Ouvert, décision CTO | P2 |
| O9-R3 | Établissement sans abonnement ⇒ `full` | Comportement intentionnel, décision CTO | décision |
| UX-O9-01 | Refus de refresh présenté comme « session expirée » | Constat | P2 |
| A5-R1 | PATCH partiel PostgreSQL | **Corrigé** [HTTP][PG] | — |
| A5-R3 | PATCH d'un statut global ⇒ création implicite | **Corrigé** (404, aucune écriture) | — |
| **A5-REG-01** | **PATCH en mode mémoire ⇒ 500** (délégation absente) | **Régression nouvelle confirmée** | P2 |
| A5-R2 | POST sur code existant écrase la ligne | Ouvert, confirmé | P2 |
| A5-R4 | POST inter-établissement en mode mémoire | Ouvert, confirmé (hors production) | P2 |
| **MULTI-ROLE-01** | Enseignant + Préfet : rôle principal Préfet, 0 affectation, appel 409 | **Défaut confirmé, antérieur** | P2 |
| MULTI-SCHOOL-01 | Rôle actif dans un second établissement : 0 affectation à la connexion | Observé (donnée artificielle), à investiguer | P2 |
| G-01 | CI non déclenchée sur `develop` après fusion | Ouvert (gouvernance) | P2 |
| T-01 | Couverture HTTP de `server.js` non mesurée ; 183 routes sans test HTTP | Ouvert | P1 (modularisation) |

Aucun **P0** ouvert constaté.

## 11. Résultats de la CI

| Objet | Résultat | Source |
|---|---|---|
| #1018 (tête avant fusion) | 26 succès, 9 sautés (filtre de chemins), 0 échec | [CI] |
| #1020 | 27 succès, 8 sautés, 0 échec | [CI] |
| #1019 | 28 succès, 8 sautés, 0 échec | [CI] |
| `develop@35319d13` après fusion | **aucune exécution** (les poussées sur `develop` ne déclenchent plus de workflow) — remplacée par les exécutions locales § 8–9 | [CI] |
| #1017 (tête `e57bfeaa`) | Scope, Secrets, Required verts ; 12 sautés (documentaire). L'échec « Required » sur `b87c315a` provient d'un job Secrets **annulé** par la poussée suivante (« Required gate failed: cancelled »), non d'un défaut | [CI] |

Les résultats CI historiques ne sont pas considérés comme une exécution sur `develop` : toutes
les suites ont été rejouées localement sur le code de `35319d13`.

## 12. Limites des tests

- Parcours UI Web et Mobile natif non exécutés (§ 7.3).
- Aucun environnement de préproduction ou de production contacté ; aucun smoke de déploiement.
- Révocation de rôle testée après désactivation SQL des affectations (base jetable) : la règle
  « affectations actives ⇒ 409 » a été observée, pas contournée en production.
- Statut global et rôle inter-établissement créés par SQL en base jetable (aucun chemin API).
- La fenêtre O9-R1b dépend du TTL d'accès configuré (15 min par défaut et plafond production) ;
  non mesurée en temps réel (expiration non attendue).
- Les 36 comparaisons strictes de libellés de rôle n'ont pas été toutes rejouées individuellement ;
  présences (Enseignant), parent (refresh) et finances couverts.

## 13. Décision GO / NO-GO motivée

### A. Clôture documentaire MONO-T2 — **GO**

Les rapports `MONO-T2-CLOSURE-AUDIT.md`, `MONO-T2-RISK-REVALIDATION.md` (état avant
correctifs), `MONO-T2-CLOSURE-POSTFIX-ADDENDUM.md` et le présent rapport (état consolidé) sont
complets, cohérents et vérifiables (commandes § 8, sondes décrites § 4–6).

### B. Modularisation Backend — **GO conditionnel, périmètre restreint**

- **Aucun P0 ouvert** ; les trois P1 du mandat RISK-01 sont corrigés pour leur périmètre ; baselines
  consolidées vertes.
- **Conditions** :
  1. fusion préalable d'une PR **MONO-FIX-A5-REG-01** (délégation mémoire + contrat ; idéalement
     avec A5-R2/R4) avant le **lot 1 Finance** ;
  2. GO limité aux **lots 0 (outillage) et 1 (Finance)** du plan de l'audit de clôture ;
  3. les lots touchant l'authentification, les sessions ou les abonnements (lots 7 et 9) restent
     **NO-GO** tant qu'O9-R1b n'est pas tranché ;
  4. inventaire `--check` et baselines unit/pg obligatoires à chaque PR d'extraction.
- Nouveau mandat CTO requis avant toute PR d'extraction.

### C. Déploiement en production — **NO-GO**

O9-R1b (P1) ouvert ; smoke UI Web et Mobile natif non exécuté ; CI non déclenchée sur `develop`
après fusion ; aucun contrôle de release ni de préproduction réalisé. Décision indépendante,
nécessitant ses propres contrôles.

## Annexe — commandes de reproduction

```bash
git fetch origin develop && git rev-parse origin/develop        # 35319d138a93ff451d2876708a670555b3b26cb2
# Cluster jetable : voir MONO-T2-RISK-REVALIDATION.md § 6 (initdb, port 55432, base sentinelle)
PUPPETEER_EXECUTABLE_PATH=<chromium> node scripts/backend-test-baseline.js unit --coverage
SOMAFRIK_TEST_PG_URL=postgres://postgres:<mdp>@127.0.0.1:55432/somafrik_disposable_test_cluster \
  node scripts/backend-test-baseline.js pg --coverage
node scripts/mono-t1-route-inventory.js --check
DATABASE_URL=postgres://postgres:<mdp>@127.0.0.1:55432/postgres node fs-refresh.js         # § 4.1, 4.3
DATABASE_URL=… node fs-refresh-revoke.js                                                   # § 4.2
DATABASE_URL=… node fs-multirole.js <racine> <étiquette> <port>                            # § 4.3, sur 9d457bf9 et 35319d13
DATABASE_URL=… node fs-o9.js                                                               # § 5
DATABASE_URL=… node fs-a5.js                                                               # § 6 (PostgreSQL puis mémoire)
# Multi-tenant / RBAC live / LOT : une base neuve du cluster jetable par script (environnement des workflows)
npm --prefix web run test && npm --prefix web run typecheck && npm --prefix web run lint && npm run build
npm --prefix Mobile run typecheck && npm run typecheck:backend
gitleaks detect --source . --redact --exit-code 1
```

Les sondes `fs-*.js` sont des scripts d'audit hors dépôt (mandat documentaire), construits sur
`backend/lib/monoT1HttpHarness.js` ; leurs scénarios sont décrits intégralement ci-dessus pour être
convertis en tests HTTP/PostgreSQL dans les PR correctives.
