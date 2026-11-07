# MONO-T2 — Audit de clôture, conformité et préparation de la modularisation

**Statut : DRAFT / HOLD — NO MERGE.** Audit exclusivement documentaire : aucun fichier
Backend, Web, Mobile, test, manifeste, seed, migration ou règle GitHub n'a été modifié.
Complément obligatoire : [`MONO-T2-RISK-REVALIDATION.md`](MONO-T2-RISK-REVALIDATION.md)
(mandat MONO-T2-RISK-01, contre-expertise A5-R1 et O9-R1).

Légende des sources, indiquée pour chaque résultat :
**[EXÉCUTÉ]** test ou commande exécuté pendant l'audit ; **[HTTP]** requête sur serveur réel
et base jetable ; **[CODE]** inspection du code ; **[CI]** résultat GitHub Actions lu ;
**[DOC]** observation documentaire. Un contrôle non exécuté est signalé comme tel.

---

## 1. Résumé exécutif

1. **Les six anomalies A1, A2, A3, A4, A5 et O9 sont corrigées** au sens de leur test de
   reproduction d'origine : chacun **échoue** sur le commit parent du correctif et **passe**
   sur le correctif fusionné puis sur la base auditée (26/26 tests, 0 SKIP) [EXÉCUTÉ].
2. **Baselines vertes** : unit 2 679 / 0 / 3, PostgreSQL 352 / 0 / 0, `expectedFailures`
   vide (0/0) [EXÉCUTÉ]. Contrat des routes inchangé (371) [EXÉCUTÉ]. Matrice RBAC MONO-T1
   conforme ; 8 scripts multi-tenant et 3 contrôles RBAC « live » verts [EXÉCUTÉ].
   Web : 1 714 tests, `tsc`, eslint (0 erreur), build verts ; Mobile : `tsc` vert [EXÉCUTÉ].
3. **Mais trois défauts P1 confirmés restent ouverts**, hors du périmètre des correctifs
   fusionnés et sans régression introduite par eux :
   - **A5-R1** — un PATCH partiel de statut de paiement réinitialise les champs absents ;
   - **O9-R1** — une session ouverte avant la suspension ou l'expiration de l'abonnement
     conserve lectures et écritures (hors notes, évaluations, présences) et se renouvelle
     sans limite par `/api/auth/refresh` ;
   - **REFRESH-R1** — après le premier rafraîchissement (≤ 15 min), un enseignant (Web et
     Mobile) ne peut plus enregistrer l'appel (409), antérieur à MONO-T0.
4. **Décision : NO-GO pour la clôture MONO-T2 et pour la modularisation tant que A5-R1,
   O9-R1 et REFRESH-R1 ne sont pas corrigés par des PR distinctes** (proposées § 12, non
   ouvertes). Le socle est par ailleurs stable et testable : un **GO conditionnel** pour la
   modularisation est recommandé dès la fusion de ces trois correctifs, avec un premier lot
   à faible risque (§ 11). **NO-GO production** indépendamment (§ 12.3).

## 2. Base GitHub et SHAs contrôlés

| Élément | Valeur |
|---|---|
| Base de référence du mandat | `9d457bf99cfd6d0fb41514aff48788c58966c888` |
| `origin/develop` au début de l'audit | `9d457bf99cfd6d0fb41514aff48788c58966c888` (identique) |
| Branche d'audit | `docs/mono-t2-closure-audit`, créée depuis cette base |
| Arbre de la tête de #1015 (`4c72c866`) vs commit fusionné `9d457bf9` | identiques (`git diff` vide) [EXÉCUTÉ] |

| Réf. | PR | Commit fusionné | Parent (avant) | Fichiers non-test modifiés [EXÉCUTÉ `git show --stat`] |
|---|---|---|---|---|
| A1 | #1011 | `dad5591d` | `ec9f168f` (MONO-T0) | `services/authService.js`, `services/pedagogyGovernanceService.js` |
| A2 | #1010 | `d306a0de` | `dad5591d` | `services/schoolSubscriptionAccessService.js`, `web/src/lib/subscriptionModule.ts`, `scripts/e2e-subscription-rules.js` |
| MONO-T1 | #1009 | `2f416bc6` | `d306a0de` | tests, harnais, inventaires |
| O9 | #1012 | `09f54e6f` | `2f416bc6` | `schoolSubscriptionAccessService.js`, `db/postgresRepository.js`, `lib/platformManagement.js` |
| A3 | #1013 | `3bec26bf` | `09f54e6f` | `lib/attendanceStatus.js` (nouveau), `db/postgresRepository.js`, `db/fallbackRepository.js`, `lib/pedagogyService.js` |
| A4 | #1014 | `8d2fbeac` | `3bec26bf` | `lib/evaluationAttachment.js`, `db/postgresRepository.js`, `web/…/EvaluationFormModal.tsx`, `web/src/lib/evaluations.ts`, `web/…/GradesEvaluationsPage.tsx` |
| A5 | #1015 | `9d457bf9` | `8d2fbeac` | `lib/financePaymentStatusValidation.js` (nouveau), `server.js` (2 gestionnaires) |

## 3. Tableau de clôture A1–A5 / O9

Méthode [EXÉCUTÉ] : pour chaque correctif, les fichiers de test de la **base auditée**
(et le harnais MONO-T1) sont copiés dans un *worktree* du commit **parent**, puis du
commit **fusionné** ; le code produit reste celui du commit testé. Cluster PostgreSQL
jetable ; tout SKIP invaliderait la mesure (aucun observé).

| Réf. | Correction | Test(s) de reproduction | Avant (parent) | Après (fusionné) | Base auditée | Écritures PG contrôlées | Risques résiduels |
|---|---|---|---|---|---|---|---|
| A1 | Isolation des enseignants homonymes | `monoT1.anomaly.A1-…` | **échec** : 4 élèves hors affectation exposés, 3 affectés absents | 1/1 | ✔ | lecture seule (périmètre) | — |
| A2 | Dates d'abonnement ISO | `monoT1.anomaly.A2-…` | **échec** 2/2 (service + HTTP) | 2/2 | ✔ | saisie autorisée sur abonnement actif | fixture fin 31-08-2027 : passage `limited` le 14-09-2027 (déjà signalé) |
| O9 | Abonnement suspendu ⇒ bloqué | `subscriptionSuspendedAccess.http.pg` | **échec** 5/8 | 8/8 | ✔ | 0 écriture sur refus (notes, présences) | **O9-R1, O9-R2, O9-R3** (RISK-REVALIDATION § 3) |
| A3 | Statuts de présence stricts, lot atomique | `monoT1.anomaly.A3-…`, `attendanceStatusValidation.http.pg` | **échec** 3/5 | 5/5 | ✔ | lot de 20 tout ou rien, appel existant intact | chemin PostgreSQL transactionnel (`pedagogyService.upsertAttendanceBatch`) ; le chemin non transactionnel ne sert qu'au mode mémoire [CODE] |
| A4 | Résolution déterministe des classes | `monoT1.anomaly.A4-…`, `evaluationClassResolution.http.pg` | **échec** 9/9 | 9/9 | ✔ | aucune évaluation ni note sur refus | `ensureClassForSchool` (création de classe) cherche encore par nom [CODE] |
| A5 | Statuts financiers validés | `monoT1.anomaly.A5-…` | **échec** 1/1 | 1/1 | ✔ | 0 écriture (POST `{}`, PATCH inconnu) | **A5-R1 à R4** (RISK-REVALIDATION § 2) ; couverture limitée à 1 test HTTP et 3 tests unitaires |

Ensemble sur la base auditée : **26 tests, 26 passent, 0 échec, 0 SKIP** [EXÉCUTÉ].
Aucune régression nouvelle n'est apparue dans les baselines (§ 4).

## 4. Résultats de tests reproductibles

| # | Contrôle | Résultat | Source |
|---|---|---|---|
| 1 | Baseline unit (`scripts/backend-test-baseline.js unit --coverage`) | **2 679 PASS / 0 FAIL / 3 SKIP**, 340 fichiers, couverture lignes 67,1 %, branches 68,8 % | [EXÉCUTÉ] |
| 1b | Même baseline sans navigateur Chrome configuré | 16 FAIL (« Could not find Chrome ») limités à `reportCardPdf.test.js` et `secPdf01RendererIsolation.test.js` : **cause d'environnement** ; relancés avec `PUPPETEER_EXECUTABLE_PATH=/opt/pw-browsers/chromium` : 39/39, puis baseline complète verte (ligne 1) | [EXÉCUTÉ] |
| 2 | Baseline PostgreSQL (`… pg --coverage`, cluster jetable vérifié) | **352 PASS / 0 FAIL / 0 SKIP**, 146 fichiers, couverture lignes 67,4 %, branches 60,8 % | [EXÉCUTÉ] |
| 2b | `expectedFailures` | **vide (0/0)** — A1 à A5 retirées par leurs PR respectives | [EXÉCUTÉ] |
| 3 | Tests HTTP MONO-T1 | inclus dans la ligne 2 (harnais, A1–A5, auth, notes/présences, élèves, abonnements, matrice RBAC) : tous verts | [EXÉCUTÉ] |
| 4 | Tests ciblés A1–A5 et O9, avant/après | § 3 : 6/6 reproduits avant, 6/6 corrigés après, 26/26 sur la base | [EXÉCUTÉ] |
| 5 | Matrice RBAC (`monoT1.rbacMatrix.http.pg.test.js`) | conforme à `MONO-T1-RBAC-MATRIX.json` | [EXÉCUTÉ] |
| 6 | Multi-tenant (scripts des workflows) : `verify:presence-tenant`, `users-tenant`, `academic-year-tenant`, `sync-l1-tenant`, `tenant-revalidation`, `d-revalidation`, `enrollment-tenant`, `planning-tenant` — une base neuve par script | **8/8 OK** | [EXÉCUTÉ] |
| 6b | RBAC HTTP live (workflow `rbac-http-live`) : `verify-rbac-s1-4`, `verify-sanitize-user-responses`, `verify-rbac-admin-01` sur API réelle | **3/3 SUCCESS** | [EXÉCUTÉ] |
| 7 | Web : `vitest run` | **315 fichiers, 1 714 tests, 0 échec** | [EXÉCUTÉ] |
| 8 | TypeScript : `typecheck:backend` (node --check), Web `tsc --noEmit`, Mobile `tsc --noEmit` | 3/3 OK | [EXÉCUTÉ] |
| 8b | Lint Web (`eslint`) | **0 erreur**, 97 avertissements | [EXÉCUTÉ] |
| 8c | Build Web (`tsc && vite build`) | OK (avertissement : fragments > 500 kB) | [EXÉCUTÉ] |
| 9 | Mobile : tests `tsx` des suites LOT parity (présences, évaluations, CRUD, finances, bulletins) | inclus dans les LOT 0–8 : verts (§ 4.1) | [EXÉCUTÉ] |
| 10 | Secrets : gitleaks 8.24.3 (version CI) sur l'historique | **aucune fuite**, 3 660 commits | [EXÉCUTÉ] |
| 10b | Architecture (workflow `architecture-audit`) : alias hérités, scanner d'orphelins et ses tests, audit API/PostgreSQL | OK ; 199 routes ACTIVE, 76 SERVER_RBAC_NO_CLIENT, 44 CALLER_ONLY, 12 ORPHAN_CANDIDATE | [EXÉCUTÉ] |
| 11 | Inventaire des routes (`mono-t1-route-inventory.js --check`) | **contrat inchangé, 371 routes** | [EXÉCUTÉ] |
| 12 | Workflows GitHub sur le contenu audité | tête de #1015 (arbre identique à `9d457bf9`) : **28 succès, 8 sautés** (LOT 0–3, 5–8 parity, filtre de chemins Backend) ; dernière exécution Web complète : #1014 (31/31), contenu Web identique | [CI] |
| 12b | LOT 0 à 8 parity rejoués localement (jobs sautés en CI) | voir § 4.1 | [EXÉCUTÉ] |

Les poussées sur `develop` ne déclenchent plus de workflow depuis août 2026 (dernières
exécutions `push` listées : 25-08-2026) : la CI de référence est celle de la PR fusionnée
[CI]. C'est un point de gouvernance à confirmer par le CTO (R15 suspendue, #1007) [DOC].

### 4.1 LOT parity

Environnement identique à `pr-gates.yml` : LOT 2 et 3 sur une base PostgreSQL neuve du
cluster jetable avec `SOMAFRIK_SKIP_DEMO_SEED=true` ; autres LOT sans variable de base
[EXÉCUTÉ].

| LOT | Résultat | SKIP réels |
|---|---|---|
| 0 | OK (dont vitest 9/9) | 0 |
| 1 | OK | 0 |
| 2 | OK (node:test 6 + 12 + 7, 0 échec) | 0 |
| 3 | OK (node:test 7 + 7 + 1, 0 échec) | 0 |
| 4 | OK (dont vitest 4/4) | 0 |
| 5 | OK (dont vitest 10/10) | 0 |
| 6 | OK (dont vitest 6/6) | 0 |
| 7 | OK (dont vitest 11/11) | 0 |
| 8 | OK | 0 |

Incident d'exécution documenté : un premier passage avait appliqué à tous les LOT les
variables de base des LOT 2 et 3 ; le LOT 1 échouait alors à la connexion (401, comptes de
démonstration absents avec `SOMAFRIK_SKIP_DEMO_SEED=true`). **Cause : configuration de
l'auditeur**, non le code ; relancé dans l'environnement CI exact : vert.

## 5. Écarts HTTP

Inventaire régénéré dans un *worktree* (le fichier versionné n'est pas modifié) et comparé
champ par champ à `docs/project/MONO-T1-ROUTES.json` [EXÉCUTÉ].

| Écart | Classement |
|---|---|
| `PATCH /api/finance/payment-statuses/:statusId` : appels dépôt `upsertFinancePaymentStatus` → `listFinancePaymentStatuses` + `upsertFinancePaymentStatus` | **Évolution autorisée et documentée** (A5, #1015) |
| Numéros de ligne et listes de tests existants (fichiers ajoutés par A3, A4, A5) | Évolution documentaire, sans effet sur le contrat |
| Méthodes, chemins, authentification, middlewares, permissions | **aucun écart** (371 routes) |
| Codes d'erreur nouveaux : `ATTENDANCE_STATUS_INVALID` 400 (A3), `EVAL_ATTACHMENT_CLASS_AMBIGUOUS` 409 et `_CONFLICT` 400 (A4), `FINANCE_PAYMENT_STATUS_INVALID` 400 et `_NOT_FOUND` 404 (A5) | **Évolutions autorisées** (mandats A3–A5) ; clients : § 8 |
| Message 400 du PATCH à code contradictoire : « code doit être une chaîne non vide » | **Écart mineur nécessitant décision** (message trompeur ; code HTTP correct) |
| Aucune régression HTTP constatée | — |

Synthèse de l'inventaire courant [EXÉCUTÉ] : 371 routes (338 dans `server.js`, 33 dans
`lib/reportCard/reportCardHttp.js`) ; 358 authentifiées, 13 publiques ; risques heuristiques
134 ÉLEVÉ / 184 MOYEN / 53 FAIBLE ; **183 routes sans test HTTP existant, dont 56 ÉLEVÉ**.

Routes publiques (13) [EXÉCUTÉ] : `POST /api/auth/refresh`, `/api/backoffice/login`,
`/api/login`, `/api/identify`, `/api/privacy/erasure-requests`,
`/api/public/report-cards/verify`, `/api/public/trial-requests`,
`/api/backoffice/e2e/clear-login-lockout`, `GET /`, `/verify/rc…`, `/api/health`,
`/api/schools/:code`, `/api/schools/:code/logo`.
`/api/backoffice/e2e/clear-login-lockout` répond 404 sauf `SOMAFRIK_E2E=true` **et**
`NODE_ENV≠production` ; `SOMAFRIK_E2E=true` est refusé au démarrage en production
(`lib/loginLockout.js:61-73`) [CODE]. Risque P2 : un environnement de préproduction non
marqué `production` avec `SOMAFRIK_E2E=true` exposerait la réinitialisation des verrous.

50 routes authentifiées sans `requirePermission` [EXÉCUTÉ] : 33 routes de bulletins
(contrôle dans `reportCardHttp.js`), sessions et préférences personnelles, appareils push,
`/api/mvp/*` (`assertMvpAccess`), `PUT /api/backoffice/state` (bouchon qui refuse
l'écriture). Aucune n'a été jugée en défaut par inspection ; les 9 sans test HTTP sont
listées dans l'inventaire.

Pagination, filtres, erreurs asynchrones : `sendList` et `asyncHandler` (340 gestionnaires
sur 349 déclarations `app.*`) sont utilisés uniformément [CODE] ; format d'erreur
`{message, code, details}` inchangé.

## 6. Évaluation RBAC / multi-tenant

| Profil / contrôle | Résultat | Source |
|---|---|---|
| Superadmin limité à l'administration plateforme | refus des routes de données scolaires : garde `isPlatformPersonalDataForbiddenHttp` dans `requireAuth` ; statuts de paiement 403 `PERMISSION_DENIED` ; matrice RBAC conforme | [CODE][HTTP][EXÉCUTÉ] |
| Admin Pays | lecture finances 200, écritures 403 | [HTTP] |
| Admin School, Préfet, Secrétaire, Enseignant, Parent | matrice MONO-T1 (6 comptes × 371 routes) conforme | [EXÉCUTÉ] |
| Élève | **non couvert** par la matrice MONO-T1 (comptes : SCHOOL_ADMIN, PROVISEUR, PREFET_ETUDES, SECRETARY, TEACHER, PARENT) | [DOC] — **contrôle non exécuté** |
| Isolation des établissements | 8 scripts tenant OK ; A1, A4, A5 inter-établissement OK ; A5 mode mémoire **non conforme** (A5-R4, hors production) | [EXÉCUTÉ][HTTP] |
| Affectations enseignants | A1 corrigé ; A4 : 403 `TEACHER_ASSIGNMENT_REQUIRED` conservé | [EXÉCUTÉ] |
| Lecture notes/présences | tests `monoT1.notesPresences` et `presence-tenant` verts | [EXÉCUTÉ] |
| Écritures financières | `finance-*` CI verts sur #1015 ; A5-R1 ouvert | [CI][HTTP] |
| Accès après suspension d'abonnement | **non conforme** : O9-R1 | [HTTP] |

Risques d'abonnement documentés séparément (mandat § 5) — détail dans
`MONO-T2-RISK-REVALIDATION.md` § 3 :

1. **Routes sans contrôle de souscription** : seules 6 portes d'écriture (notes,
   évaluations, présences) appliquent l'abonnement ; `FEATURE_RULES` déclare 9
   fonctionnalités dont 2 appliquées (O9-R2) [CODE][HTTP].
2. **Sessions JWT existantes** : conservées et renouvelables après suspension (O9-R1) [HTTP].
3. **Établissements sans ligne d'abonnement** : `full` (O9-R3, décision CTO) [HTTP].

Aucune modification RBAC n'a été faite.

## 7. Intégrité PostgreSQL

| Thème | Constat | Source |
|---|---|---|
| Isolation `school_id` | prédicats d'établissement systématiques dans les magasins finance/pédagogie ; scripts tenant verts | [CODE][EXÉCUTÉ] |
| Élèves–classes–évaluations | A4 : classe résolue par identifiant exact, refus sans écriture ; `ensureClassForSchool` reste par nom (création) | [EXÉCUTÉ][CODE] |
| Présences groupées | transaction unique (`store.withTransaction`) avec validation préalable ; lot de 20 tout ou rien vérifié | [EXÉCUTÉ] |
| Statuts financiers | contrôles A5 effectifs ; **upsert complet** non transactionnel (lecture de la liste puis écriture) : A5-R1/R2/R3 | [HTTP][CODE] |
| Transactions | 3 usages de `withTransaction` dans `server.js` ; transactions portées par les services (`platformService` 11, `educationReferenceService` 11, `postgresRepository` 11, `pedagogyService` 10, `clientsService` 9, `financeService` 7…) | [CODE] |
| Contraintes | index unique `payment_statuses (COALESCE(school_id, 0…0), status_code)` ; clés étrangères vérifiées par `audit-feature-pg-relations` (sans manque) | [CODE][EXÉCUTÉ] |
| Écritures partielles | aucun cas reproduit dans les chemins audités | [EXÉCUTÉ] |
| Concurrence | verrous explicites rares (`FOR UPDATE`/advisory dans `teacherCodeAllocation`, `schoolRoomsService`) ; A5 PATCH : fenêtre lecture-écriture sans verrou (P2) ; A4 : homonymes créés à la même seconde, ordre non déterministe désormais refusé | [CODE] |
| Invalidation des caches | `cachedDataset = null` à la main en **40 points** de `postgresRepository.js` ; la suspension par API invalide bien (O9) ; une modification SQL directe n'est vue qu'à la prochaine invalidation ; `getAuthoritativeBackOfficeState` reconstruit l'état complet à chaque porte d'abonnement (coût) | [CODE][HTTP] |

## 8. Parité Web / Mobile

| Fonction | Web | Mobile Expo React Native | Divergence |
|---|---|---|---|
| Création/modification d'évaluations | `EvaluationFormModal` : sélection de classe **par identifiant** (libellé nom — code — année), présélection seulement si une seule classe ; `resolveCanonicalClassId` sans repli arbitraire [CODE][EXÉCUTÉ vitest] | `TeacherGradesScreen` envoie `classId` de l'affectation [CODE] | aucune |
| Classes homonymes | sélection par identifiant | par affectation | aucune ; l'import Web `buildEvaluationsFromExams` (nom seul) est refusé en 409 sur homonyme (documenté A4) |
| Présences | libellés `Présent/Absent/Retard/Justifié` (`PresencesPage.tsx:48`) | mêmes libellés (`attendanceTruth.ts`) et valeurs internes `present/late/absent/excused` (appel par carte) — toutes dans le catalogue A3 [CODE] | aucune |
| Notes | `POST /api/notes` | idem | aucune |
| Finances (statuts de paiement) | PATCH avec l'objet complet, POST en création (`EntityPage.tsx:1047`) : non affecté par A5-R1 [CODE] | export `upsertFinancePaymentStatus` **sans appelant** [CODE] | aucune fonctionnelle |
| Utilisateurs et rôles | inchangé | inchangé | — |
| Consultation parent/élève | inchangé (tests parent MONO-T1 verts) | inchangé | — |
| Erreurs 400/403/404/409 | client API Web | `httpClient.ts` : tout 4xx JSON ⇒ `ApiClientError(message, status, code)` ; seul 401 déclenche le rafraîchissement [CODE] | les nouveaux codes A3–A5 sont affichés par message ; **un 403 au rafraîchissement (correctif O9-R1) devra être géré** |
| Rafraîchissement enseignant | **409 sur l'appel après rafraîchissement** | **idem** (`/api/login`, `role: "teacher"`) | **REFRESH-R1**, P1, commun Web/Mobile [HTTP] |

L'audit a porté sur l'application Mobile native (`Mobile/`), pas sur le Web responsive.

## 9. Cartographie des dépendances monolithiques

Graphe des `require` relatifs de 400 fichiers source Backend (hors tests et scripts) :
**1 081 arêtes**, **6 cycles** courts, tous présents dès MONO-T0 (`ec9f168f`) [EXÉCUTÉ] :
`clientsManagement ↔ roleDisplayLabels ↔ userRoleLifecycle` ;
`authService ↔ schoolSubscriptionAccessService` ;
`communicationsAnnouncementsService ↔ communicationsMessagesService` ;
`functionalRbacManagement ↔ rbacMandatoryPermissions` ;
`financeManagement ↔ financeUnallocatedCash` ;
`studentAccessCardsManagement ↔ studentCardsNfcEncoding ↔ studentCardsNfcLifecycle`.

| Fichier | Lignes | Responsabilités | Dép. sortantes / entrantes | `require` différés | Routes | Transactions | RBAC | Multi-tenant | Extraction | Couverture (unit / pg) | Priorité |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `backend/server.js` | 8 014 | 338 routes, `requireAuth`, portes RBAC/abonnement, 152 fonctions utilitaires, projections d'état, démarrage | 145 / 0 | **299** | 338 (familles dispersées : chaque famille s'étend sur 1 000 à 4 000 lignes) | 3 locales, le reste via services | maximale (porte d'entrée) | maximale | **très difficile** : 376 appels `repository.*` (222 distincts) depuis les gestionnaires ; état global (`repository`, `auditService`, `idempotencyService`) | non mesurée (processus enfant non instrumenté) ; couverture fonctionnelle par 146 fichiers pg | **P0** |
| `backend/db/postgresRepository.js` | 7 941 | façade de 459 méthodes : délégations vers magasins (121), SQL direct, cache `cachedDataset` | 103 / 1 | 191 | — | 11 | élevée | élevée | difficile | 24,8 % / 55,3 % | **P0** |
| `backend/db/fallbackRepository.js` | 4 400 | dépôt mémoire (274 méthodes) | 55 / 1 | 114 | — | 6 | moyenne | défauts propres (A5-R4) | moyenne | 34,7 % / 13,0 % | **P1** |
| `backend/db/clientsPgStore.js` | 1 948 | utilisateurs, rôles, comptes | 17 / 2 | 51 | — | via `clientsService` (9) | élevée | élevée | moyenne | 22,5 % / 51,9 % | P1 |
| `backend/db/pedagogyPgStore.js` | 1 508 | évaluations, notes, présences | 7 / 1 | 2 | — | via `pedagogyService` (10) | élevée | élevée | **faible à moyenne** (déjà isolé derrière un service) | 6,5 % / 74,5 % | P1 |
| `backend/db/financePgStore.js` | 1 280 | finances | 8 / 1 | 0 | — | via `financeService` (7) | élevée | élevée | **faible** | non chargé / 78,9 % | P1 |
| `backend/lib/pedagogyService.js` | 747 | règles pédagogiques transactionnelles | 9 / 2 | 0 | — | 10 | élevée | élevée | faible | 12,5 % / 84,6 % | P2 |
| `backend/lib/financeService.js` | 910 | règles financières | 8 / 2 | 0 | — | 7 | élevée | élevée | faible | 93,3 % / 76,4 % | P2 |
| `backend/services/authService.js` | 907 | connexion, identités, abonnement à la connexion | 11 / **44** | 3 | — | — | maximale | élevée | difficile (cycle avec l'abonnement, 44 dépendants) | 87,2 % / 31,1 % | P1 |
| `backend/lib/functionalRbacService.js` | 1 003 | RBAC fonctionnel | 17 / 5 | 12 | — | — | maximale | — | moyenne | 87,6 % / 75,4 % | P1 |
| `backend/lib/mobileSyncScope.js` | 1 207 | périmètres de synchronisation Mobile | 5 / 6 | 0 | — | — | élevée | élevée | moyenne | — | P2 |
| `backend/lib/reportCard/reportCardHttp.js` | 1 008 | 33 routes de bulletins (déjà extraites) | 3 / 1 | 1 | 33 | — | contrôle interne | élevée | **modèle de référence** | — | P2 |

Couvertures lues dans les rapports `c8` des deux baselines [EXÉCUTÉ].

Répartition des routes de `server.js` par famille [EXÉCUTÉ] :

| Famille | Routes | Écritures | Plage de lignes | Appels dépôt distincts | ÉLEVÉ | Sans test HTTP |
|---|---|---|---|---|---|---|
| A. Authentification et sessions | 12 | 10 | 355–684 | 6 | 9 | 4 |
| B. Utilisateurs et rôles | 37 | 25 | 2011–4003 | 30 | 25 | 31 |
| C. Élèves et inscriptions | 47 | 28 | 1046–4042 | 12 | 28 | 11 |
| D. Notes et présences | 32 | 21 | 1304–4835 | 31 | 21 | 16 |
| E. Finance | 26 | 13 | 3436–4602 | 19 | 13 | 8 |
| F. Communication | 45 | 23 | 650–4405 | 37 | 23 | 12 |
| G. Pédagogie, planning, référentiels | 80 | 49 | 776–4846 | 63 | 2 | 54 |
| H. Plateforme, établissements, abonnements | 53 | 30 | 389–4867 | 29 | 0 | 41 |
| Autres | 6 | 2 | 266–630 | 2 | 0 | 2 |

## 10. Registre des risques P0 / P1 / P2

| ID | Risque | Statut | Prio. | Source | Suite proposée |
|---|---|---|---|---|---|
| O9-R1 | Sessions ouvertes et rafraîchissement après suspension/expiration | **Défaut confirmé** | **P1** (P0 si suspension de sécurité) | [HTTP] | PR O9-R1 (2 PR), après décision |
| REFRESH-R1 | Jeton enseignant rafraîchi : rôle `TEACHER`, appel refusé 409 | **Défaut confirmé**, antérieur à MONO-T0 | **P1** | [HTTP] | PR REFRESH-R1, **avant** O9-R1 |
| A5-R1 | PATCH partiel de statut de paiement réinitialise les champs absents | **Défaut confirmé** | **P1** | [HTTP][PG] | PR A5-R1 |
| A5-R2 | POST sur un code existant écrase la ligne | Défaut confirmé | P2 | [HTTP][PG] | dans la PR A5-R1 |
| A5-R3 | PATCH d'un statut global invisible ⇒ création implicite | Défaut confirmé (aucun global dans le seed) | P2 | [HTTP][PG] | dans la PR A5-R1 |
| A5-R4 | Mode mémoire : POST écrase un statut d'un autre établissement | Défaut confirmé, hors production | P2 | [HTTP] | dans la PR A5-R1 |
| O9-R2 | `FEATURE_RULES` déclarées non appliquées (`create_student`…) | Défaut confirmé / décision | P2 | [CODE][HTTP] | décision CTO |
| O9-R3 | Établissement sans abonnement ⇒ `full` | **Comportement intentionnel** | décision | [HTTP] | options A–D (RISK-REVALIDATION § 3.7) |
| RB-01 | 36 comparaisons strictes de libellés de rôle : comportement après rafraîchissement non vérifié hors présences | **Risque plausible, non reproduit** | P1 (lié à REFRESH-R1) | [CODE] | couvert par la PR REFRESH-R1 |
| RB-02 | Profil Élève absent de la matrice RBAC MONO-T1 | Lacune de test | P2 | [DOC] | compléter la matrice avant le lot élèves |
| H-01 | `clear-login-lockout` exposé si `SOMAFRIK_E2E=true` hors `production` | Risque de configuration | P2 | [CODE] | vérifier la configuration préproduction |
| H-02 | Message 400 trompeur (PATCH à code contradictoire) | Écart mineur | P2 | [HTTP] | dans la PR A5-R1 |
| D-01 | `server.js` : 299 `require` différés, 376 appels dépôt, familles dispersées | Dette | P0 (modularisation) | [EXÉCUTÉ] | § 11 |
| D-02 | Invalidation de cache manuelle (40 points) | Dette | P1 | [CODE] | lot transversal |
| D-03 | État complet reconstruit à chaque porte d'abonnement | Performance | P2 | [CODE] | avec O9-R1 |
| D-04 | 6 cycles de dépendances | Dette | P2 | [EXÉCUTÉ] | lot transversal |
| T-01 | 183 routes sans test HTTP (56 ÉLEVÉ) ; `server.js` sans couverture mesurée | Lacune de test | P1 | [EXÉCUTÉ] | prérequis de chaque lot |
| G-01 | CI non déclenchée sur `develop` après fusion | Gouvernance | P2 | [CI] | décision CTO |
| A2-F | Fixture d'abonnement : `limited` le 14-09-2027 | Dette de test | P2 | [DOC] | avant cette date |
| A4-F | `ensureClassForSchool` par nom (création de classe) | Résiduel | P2 | [CODE] | hors A4 |

## 11. Plan de modularisation proposé (monolithe modulaire)

Invariants : Backend unique sur Render ; PostgreSQL canonique ; **routes, codes et formats
inchangés** (contrôle `mono-t1-route-inventory.js --check` obligatoire à chaque PR) ;
authentification et RBAC inchangés ; compatibilité Web/Mobile. Aucune PR d'extraction
n'est ouverte sans nouveau mandat CTO.

Ordre proposé, corrigé d'après les dépendances observées : les **routeurs par famille
d'abord** (le couplage est dans `server.js` : 376 appels dépôt, 299 `require` différés),
mais en commençant par les familles déjà adossées à un service et à un magasin isolés ;
les modules transversaux (auth, abonnement, cache) **en dernier**, car tout en dépend.

| Lot | Contenu | Risque | Prérequis | Tests de non-régression | PR |
|---|---|---|---|---|---|
| **0. Outillage** | module `httpContext` exportant `requireAuth`, `requirePermission`, `asyncHandler`, `sendList`, `financeHttpPrincipal`… sans les déplacer (réexport) ; garde de contrat des routes en CI | faible | **A5-R1, O9-R1 (a), REFRESH-R1 fusionnés** | inventaire `--check`, baselines unit/pg | 1 |
| **1. Finance** (premier lot recommandé) | `routes/finance.js` (26 routes) au modèle de `reportCardHttp.js` ; gestionnaires → `financeService`/`financePgStore` inchangés | faible à moyen | lot 0 ; A5-R1 fusionné | `finance-*` CI, A5, `financeLiveRbac`, matrice RBAC, LOT 4 | 1–2 |
| 2. Notes et présences | `routes/pedagogyGrades.js` (32 routes) | moyen (portes d'abonnement, affectations) | REFRESH-R1, O9-R1 fusionnés | A1, A3, A4, `monoT1.notesPresences`, `presence-tenant`, `d-revalidation`, LOT 5/7 | 2 |
| 3. Élèves et inscriptions | 47 routes | moyen | RB-02 (matrice Élève) | `enrollment-tenant`, `monoT1.students`, LOT 2 | 2 |
| 4. Communication | 45 routes, résoudre le cycle annonces↔messages | moyen | — | `communications-c1…c4` | 2 |
| 5. Pédagogie, planning, référentiels | 80 routes, 54 sans test HTTP | élevé | tests HTTP préalables | `planning-tenant`, `academic-year-tenant`, LOT 1/3 | 3 |
| 6. Utilisateurs et rôles | 37 routes, 31 sans test HTTP | élevé (RBAC) | tests HTTP préalables | `users-tenant`, RBAC live, matrice | 2–3 |
| 7. Plateforme, abonnements | 53 routes | élevé | décision O9-R2/R3 | O9, A2, `tenant-revalidation` | 2 |
| 8. Accès PostgreSQL | découper `postgresRepository.js` par domaine (les magasins existent déjà : finance, pédagogie, clients) ; contrat `repositoryContract.js` | élevé | lots 1–7 | baselines pg, contrat dépôt | 3–4 |
| 9. Transversal | auth/session (cycle `authService ↔ abonnement`), cache (40 invalidations), `require` différés | **très élevé** | tout le reste | suite complète | 3+ |

Estimation totale : **21 à 25 PR**, une famille par PR au plus, chacune sans changement
de comportement.

## 12. Décision GO / NO-GO motivée

### 12.1 Critères du mandat

| Critère | État |
|---|---|
| A1–A5 et O9 passent leurs tests de non-régression | ✔ [EXÉCUTÉ] |
| Aucune régression P0/P1 ouverte compromettant l'extraction | ✘ — **A5-R1, O9-R1, REFRESH-R1 (P1 confirmés)** ; ce ne sont pas des régressions des correctifs, mais des défauts ouverts dans des zones à extraire (finance, auth, notes/présences) |
| Baseline Backend verte | ✔ |
| Baseline PostgreSQL verte | ✔ |
| Matrice RBAC conforme | ✔ (hors profil Élève, non couvert) |
| Contrôles multi-tenant conformes | ✔ (PostgreSQL) ; A5-R4 en mémoire uniquement |
| Divergences Web/Mobile recensées et maîtrisées | ✔ recensées ; REFRESH-R1 commun et non maîtrisé |
| Routes et protections inventoriées | ✔ |
| Risques résiduels identifiés et hiérarchisés | ✔ |

### 12.2 Modularisation

**NO-GO**, levé dès la fusion de trois PR correctives distinctes (non ouvertes) :

1. **MONO-FIX-REFRESH-R1** (1 PR) — principal rafraîchi identique à la connexion.
2. **MONO-FIX-O9-R1 (a)** (1 PR) — refus du rafraîchissement et révocation des sessions
   pour un établissement bloqué ; la politique de lecture/écriture (b) peut suivre après
   décision CTO sans bloquer le lot 1.
3. **MONO-FIX-A5-R1** (1 PR) — PATCH partiel, POST sans écrasement, périmètre global et
   mémoire.

Ensuite : **GO conditionnel** pour les lots 0 et 1 (outillage, puis Finance).

### 12.3 Production

**NO-GO production**, indépendamment de la modularisation : O9-R1 laisse un établissement
suspendu opérer ; REFRESH-R1 bloque l'appel des enseignants après 15 minutes ; la CI ne
s'exécute plus sur `develop` après fusion (G-01). Aucun contrôle de préproduction n'a été
exécuté dans cet audit (hors mandat).

## 13. Annexes et commandes de vérification

```bash
# Base
git fetch origin develop && git rev-parse origin/develop   # 9d457bf99cfd6d0fb41514aff48788c58966c888

# Cluster PostgreSQL jetable (local) : voir MONO-T2-RISK-REVALIDATION.md § 6
export SOMAFRIK_TEST_PG_URL=postgres://postgres:<mdp>@127.0.0.1:55432/somafrik_disposable_test_cluster

# 1–2. Baselines
PUPPETEER_EXECUTABLE_PATH=<chromium> node scripts/backend-test-baseline.js unit --coverage
node scripts/backend-test-baseline.js pg --coverage

# 4. Reproductions avant/après (worktree par commit ; tests de la base auditée)
git worktree add --detach <wt> <commit-parent>      # puis copie des tests et du harnais
DATABASE_URL=postgres://postgres:<mdp>@127.0.0.1:55432/postgres \
  node --test --test-concurrency=1 backend/lib/monoT1.anomaly.A1-teacher-homonym-scope.http.pg.test.js   # etc.

# 6. Multi-tenant et RBAC live (une base neuve du cluster jetable par script)
DATABASE_URL=postgres://…/somafrik_t2_<script> NODE_ENV=test JWT_SECRET=<ci> npm run verify:presence-tenant   # etc.
node backend/scripts/verify-rbac-s1-4.js   # API réelle sur base neuve, cf. rbac-http-live.yml

# 7–8. Web / Mobile
npm --prefix web run test && npm --prefix web run typecheck && npm --prefix web run lint && npm run build
npm --prefix Mobile run typecheck && npm run typecheck:backend
npm run test:lot0-parity   # … lot8

# 10. Secrets et architecture
gitleaks detect --source . --redact --exit-code 1                     # v8.24.3
node scripts/verify-api-legacy-aliases.js && node scripts/audit-api-orphans.test.js \
  && node scripts/audit-api-orphans.js <out.json> && node scripts/audit-feature-pg-relations.js <out.json>

# 11. Routes
node scripts/mono-t1-route-inventory.js --check
```

Fichiers produits par l'audit : ce document et `MONO-T2-RISK-REVALIDATION.md`. Les
scripts de sonde, journaux et inventaire régénéré sont restés hors dépôt (mandat
documentaire). Le cluster PostgreSQL jetable est arrêté et supprimé en fin d'audit.
