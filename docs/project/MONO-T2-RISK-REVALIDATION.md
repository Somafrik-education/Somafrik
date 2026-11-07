# MONO-T2-RISK-01 — Contre-expertise des risques résiduels A5 et O9

**Statut : AUDIT ONLY / DRAFT / HOLD — NO MERGE.** Document exclusivement documentaire.
Aucun fichier Backend, Web, Mobile, test, manifeste, seed ou migration n'a été modifié.

| Élément | Valeur |
|---|---|
| Dépôt | `Somafrik-education/Somafrik` |
| Base auditée | `develop` = `9d457bf99cfd6d0fb41514aff48788c58966c888` (#1015 incluse) |
| Environnement | Cluster PostgreSQL 16.15 jetable créé pour l'audit (`initdb` local, port 55432, base sentinelle `somafrik_disposable_test_cluster`) ; une base neuve `somafrik_mono_t1_t2_*_it` par scénario, supprimée en fin d'exécution par le harnais MONO-T1 |
| Serveur | `backend/server.js` réel (processus enfant), données de démonstration du seed |
| Date | 28-10-2026 |

Aucune base partagée, de préproduction ou de production n'a été contactée. Aucun jeton
d'accès, jeton de rafraîchissement ou secret n'apparaît dans ce document ni dans les
journaux de sonde (seuls des statuts HTTP et des booléens « jeton émis » sont relevés).

Légende des sources : **[HTTP]** requête exécutée sur serveur réel ; **[PG]** lecture SQL
de la base jetable ; **[CODE]** inspection du code à la base auditée.

## 1. Synthèse

| Référence | Reproduction | Gravité | Cause | Correctif recommandé |
|---|---|---|---|---|
| **A5-R1** — PATCH partiel | **Confirmé** [HTTP][PG], PostgreSQL et mémoire | **P1** (intégrité de paramétrage financier, sans fuite inter-établissement en PostgreSQL) | `upsertFinancePaymentStatus` réécrit **tous** les champs depuis le corps reçu, avec des valeurs par défaut pour les champs absents | PR distincte « A5-R1 » : fusion avec la ligne existante pour PATCH ; POST sans écrasement |
| **A5-R2** — POST sur code existant | **Confirmé** [HTTP][PG] | P2 | même upsert : POST d'un code existant de l'établissement écrase la ligne (201) | inclus dans la PR A5-R1 (409 sur doublon) |
| **A5-R3** — PATCH d'un statut global | **Confirmé** [HTTP][PG] (ligne globale créée en base jetable ; aucune dans le seed) | P2 | le contrôle d'existence lit la liste brute (globaux inclus) ; `GET` les filtre ; l'upsert crée une copie établissement | inclus dans la PR A5-R1 (aligner sur la liste visible) |
| **A5-R4** — mémoire inter-établissement | **Confirmé** [HTTP], mode mémoire uniquement | P2 (mode mémoire interdit en production) | `financeMemoryStore` cherche le code sans filtrer l'établissement | inclus dans la PR A5-R1 |
| **O9-R1** — sessions après suspension | **Confirmé** [HTTP][PG] | **P1** (P0 si la suspension est une mesure de sécurité, cf. § 3.6) | le rafraîchissement ne revérifie ni l'établissement ni l'abonnement ; seules 6 portes d'écriture appliquent l'abonnement | PR distincte « O9-R1 », après décision de politique CTO |
| **O9-R2** — `FEATURE_RULES` non câblées | **Confirmé** [HTTP][CODE] | P2 (décision CTO) | `create_student`, `create_teacher`, `announcements`, `notifications`, `premium_documents` déclarées mais jamais appliquées | inclus dans la décision de politique O9 |
| **O9-R3** — établissement sans abonnement | **Comportement produit intentionnel** (conservé par O9) [HTTP] | Décision CTO | absence de ligne ⇒ `full` | aucune modification sans décision (options § 3.7) |
| **REFRESH-R1** — jeton enseignant rafraîchi | **Confirmé** [HTTP], **antérieur** à MONO-T0 → A5 | **P1** (fonctionnel, Web et Mobile) | le jeton rafraîchi porte `role: "TEACHER"` au lieu de `"Enseignant"` et perd `roleKeys`, `roles`, `schoolId`, `userId`, `countryScope` | PR distincte, indépendante d'O9 |

**Recommandation : NO-GO pour la clôture MONO-T2 en l'état**, uniquement à cause des
défauts P1 confirmés (A5-R1, O9-R1, REFRESH-R1). Ils relèvent de PR correctives séparées,
soumises à autorisation CTO. Le détail figure dans `MONO-T2-CLOSURE-AUDIT.md` § 12.

---

## 2. A5-R1 — Statuts financiers

### 2.1 Chemin de code [CODE]

- `backend/server.js:3528` — `PATCH /api/finance/payment-statuses/:statusId` :
  `assertPaymentStatusPayload(req.body)` → `listFinancePaymentStatuses(principal)` →
  `assertKnownPaymentStatus` (404) → contrôle code contradictoire (400) →
  `upsertFinancePaymentStatus({ ...req.body, code, id }, principal)`.
- `backend/server.js:3520` — `POST` : validation stricte puis **même upsert**.
- `backend/db/financePgStore.js:1053` — `upsertFinancePaymentStatus` :
  ```sql
  UPDATE payment_statuses SET label = $2, is_active = $3, sort_order = $4, profile_payload = $5::jsonb …
  -- $2 = payload.label || code ; $3 = payload.status !== "Inactif" ;
  -- $4 = Number(payload.sortOrder || 0) ; $5 = JSON.stringify(payload)
  ```
  Tout champ absent du corps est remplacé par une valeur par défaut : libellé = code,
  actif = vrai, ordre = 0, `profile_payload` = corps partiel.
- `backend/db/financeMemoryStore.js:946` — même logique ; en plus, recherche
  `status_code === code` **sans** critère d'établissement.

### 2.2 Résultats PostgreSQL (compte `cdAdmin`, CD-2026-0001) [HTTP][PG]

| # | Requête | HTTP | Ligne `payment_statuses` après | Conforme ? |
|---|---|---|---|---|
| 1 | `POST {code:"T2-A5R1", label:"Statut test", status:"Inactif", sortOrder:10}` | 201 | label « Statut test », `is_active=false`, `sort_order=10`, payload complet | oui |
| 2 | `PATCH /T2-A5R1 {label:"Réglé"}` | 200 | label « Réglé », **`is_active=true`**, **`sort_order=0`**, payload = `{id, code, label}` | **non** : statut réactivé, ordre perdu |
| 3 | (remise en état) puis `PATCH {sortOrder:5}` | 200 | **label = « T2-A5R1 »** (le code), **`is_active=true`**, `sort_order=5` | **non** : libellé et statut perdus |
| 3c | (remise en état) puis `PATCH {status:"Actif"}` | 200 | **label = code**, `is_active=true`, **`sort_order=0`** | **non** |
| 4 | `PATCH /T2-INCONNU {label:"x"}` | **404** `FINANCE_PAYMENT_STATUS_NOT_FOUND` | aucune ligne créée, table inchangée | oui |
| 5 | `PATCH /T2-A5R1 {code:"AUTRE", label:"x"}` | **400** `FINANCE_PAYMENT_STATUS_INVALID` | table inchangée | oui (message trompeur : « code doit être une chaîne non vide ») |
| 5b | `PATCH {status:"Suspendu"}`, `{sortOrder:"abc"}`, `{label:""}` | 400 ×3 | table inchangée | oui |
| 6a | `biAdmin` `POST {code:"T2-BI", …}` | 201 | ligne BI | oui |
| 6b | `cdAdmin` `PATCH /T2-BI` | **404** | ligne BI intacte, table inchangée | oui |
| 6c | `cdAdmin` `GET` | 200 | T2-BI non visible | oui |
| 6d | `cdAdmin` `POST {code:"T2-BI"}` | 201 | **copie CD** distincte ; ligne BI intacte | oui (portée établissement) |
| 6e | `cdAdmin` `POST {code:"T2-A5R1", label:"Écrasé par POST"}` (code existant) | **201** | ligne **écrasée** : `is_active=true`, `sort_order=0` | **non** (A5-R2) |
| 7a | Insertion SQL d'un statut global `T2-GLOBAL` (`school_id NULL`, inactif, ordre 9) — **aucun statut global dans le seed** | — | — | — |
| 7b | `cdAdmin` `GET` | 200 | T2-GLOBAL **non visible** | — |
| 7c | `cdAdmin` `PATCH /T2-GLOBAL {label}` | **200** | ligne globale **intacte** ; **nouvelle ligne CD** créée (actif, ordre 0) | **non** (A5-R3 : création implicite par PATCH d'un statut invisible) |
| 7d | `cdSecretary` `PATCH /T2-GLOBAL` | 200 | ligne CD réécrite ; globale intacte | idem |
| 8 | `superAdmin` : GET, PATCH, POST, PATCH global | **403** `PERMISSION_DENIED` ×4 | table inchangée | oui |
| 8 | `countryAdminCd` (Admin Pays) : GET / écritures | 200 / **403** ×3 | table inchangée | oui |

### 2.3 Résultats en mode mémoire (`backend/scripts/dev-memory.js`) [HTTP]

| # | Requête | HTTP | Résultat |
|---|---|---|---|
| 1 | POST Inactif / ordre 10 | 201 | conforme |
| 2 | `PATCH {label}` | 200 | **statut « Actif », ordre 0** (même défaut) |
| 3 | `PATCH {sortOrder:5}` | 200 | **libellé = code, « Actif »** |
| 4 | PATCH inconnu | 404 | aucune création |
| 5 | code contradictoire | 400 | — |
| 6b | `cdAdmin` PATCH du statut BI | 404 | BI intact |
| 6c | `cdAdmin` **POST** du code `T2-BI` | 201 | **la ligne de BI est écrasée** (vue BI : libellé « CD écrase par POST », Actif) ; aucune ligne CD |

Le mode mémoire est refusé en production (`backend/db/connectionConfig.js:336` :
`SOMAFRIK_DB_REQUIRED=false est interdit en production`) : A5-R4 est limité aux
environnements de développement et de démonstration mémoire.

### 2.4 Diagnostic

1. **Cause racine A5-R1/R2** : POST et PATCH partagent un *upsert complet*. Le correctif A5
   (#1015) a ajouté la validation et le contrôle d'existence **avant** l'upsert, mais n'a
   pas changé la sémantique d'écriture. La validation accepte un PATCH partiel
   (`assertPaymentStatusPayload` sans `create`) que la couche de stockage ne sait pas
   appliquer partiellement.
2. **Cause A5-R3** : incohérence de périmètre. `PATCH` vérifie l'existence sur
   `repository.listFinancePaymentStatuses` (inclut `school_id IS NULL`), alors que
   `GET` applique en plus `tenantScopeService.filterRows` (exclut la ligne globale).
   L'upsert cherche ensuite `status_code AND school_id = <école>` : il ne trouve pas la
   ligne globale et **insère** une ligne d'établissement. Aucun statut global n'existe
   dans le seed ; l'impact réel dépend de données insérées hors API.
3. **Cause A5-R4** : `financeMemoryStore.upsertFinancePaymentStatus` ne filtre pas par
   établissement.
4. **Portée Web/Mobile** : le Web (`EntityPage.tsx:1047`) envoie l'objet complet
   (`preparedItem`) en PATCH : il n'est pas touché par A5-R1 tant que le formulaire
   renvoie toutes les colonnes. Le Mobile n'appelle pas cet export
   (`upsertFinancePaymentStatus` de `Mobile/src/services/api.ts:1562` n'a aucun appelant).
   **Le risque concerne les appels API directs, les intégrations et tout futur client
   envoyant un PATCH partiel.**

### 2.5 Proposition de correction minimale (PR « MONO-FIX-A5-R1 », non ouverte)

| Élément | Proposition |
|---|---|
| Périmètre | `financePgStore.upsertFinancePaymentStatus` scindé en `createFinancePaymentStatus` (INSERT, 409 si le code existe déjà pour l'établissement) et `patchFinancePaymentStatus` (UPDATE des seuls champs fournis : `COALESCE`/fusion de `profile_payload`) ; même découpage dans `financeMemoryStore` avec filtre établissement ; `server.js` PATCH : contrôle d'existence sur la **liste visible** (même filtre que GET) |
| Fichiers | `backend/server.js` (2 gestionnaires), `backend/db/financePgStore.js`, `backend/db/financeMemoryStore.js`, `backend/db/postgresRepository.js` et `backend/db/fallbackRepository.js` (délégations), `backend/db/repositoryContract.js` |
| Tests obligatoires | HTTP/PG : PATCH `{label}`, `{sortOrder}`, `{status}` ⇒ autres champs inchangés ; POST code existant ⇒ 409 sans écriture ; PATCH statut global ⇒ 404 sans écriture ; inter-établissement 404 ; mémoire : POST d'un code d'un autre établissement ⇒ aucune écriture sur l'autre établissement ; A5 existant conservé |
| Risques de régression | clients qui utilisaient POST comme « enregistrer » (upsert) : à vérifier — le Web distingue déjà création (POST) et modification (PATCH) ; `profile_payload` historique |
| Impact Web / Mobile | Web : aucun changement attendu (envoie l'objet complet, POST pour création) ; vérifier le message 409 en création d'un doublon. Mobile : aucun appelant |
| Estimation | **1 PR** |

---

## 3. O9-R1 — Sessions après suspension de l'abonnement

### 3.1 Chemin de code [CODE]

| Étape | Code | Contrôle d'abonnement ? |
|---|---|---|
| Connexion `POST /api/backoffice/login`, `POST /api/login` | `authService.assertSchoolCanConnect` (`authService.js:767`) → `schoolSubscriptionAccessService.assertSchoolCanConnect` (`:217`) | **oui** (`full`/`limited` admis) |
| Rafraîchissement `POST /api/auth/refresh` (`server.js:504`) | `rotateRefreshSession` (`lib/sessionRefreshService.js:72`) puis `issueRefreshedAccessToken` (`server.js:7042`) | **non** : session, empreinte du jeton, rotation, rôles vivants (SEC-AUTH-05), rattachement établissement — **aucune** lecture de l'abonnement ni du statut de l'établissement |
| Requête authentifiée `requireAuth` (`server.js:7541`) | session active, rattachement établissement (SEC-TENANT-01/02), garde données personnelles plateforme | **non** |
| Porte `requireSchoolSubscriptionFeature` (`server.js:5304`) | `assertSchoolFeature` | **oui**, seulement sur 6 points : `POST /api/evaluations`, `PATCH /api/evaluations/:id` (`write_notes`), `POST /api/notes` (`write_notes`), `POST /api/presences` (`write_presence`) et 2 portes internes `write_presence` (appel par carte, `server.js:2542` et `:2639`) |

`FEATURE_RULES` (`schoolSubscriptionAccessService.js:192`) déclare 9 fonctionnalités ; **2**
sont appliquées (`write_notes`, `write_presence`) ; `connect` est appliquée à la connexion ;
`read`, `create_student`, `create_teacher`, `announcements`, `notifications`,
`premium_documents` **ne sont appelées nulle part** (recherche exhaustive dans `backend/`).

### 3.2 Protocole [HTTP][PG]

Une base neuve par scénario. Comptes `cdAdmin` (Admin School) et `cdTeacher`
(Enseignant, affecté en Sciences à `CLS-2026-000035`), connectés par
`POST /api/backoffice/login` (jetons d'accès **et** de rafraîchissement obtenus).
Modification de l'abonnement CD-2026-0001 **par le chemin métier**
(`PATCH /api/backoffice/subscriptions/:id` par le Superadmin, corps `{schoolCode, …}`),
sauf « sans abonnement » (aucune route de suppression : `DELETE` SQL en base jetable,
puis PATCH neutre de l'abonnement BI pour invalider le cache applicatif).
Phases : (1) avant ; (2) ancien jeton d'accès ; (3) jeton obtenu par `/api/auth/refresh`
après modification ; (4) nouvelle connexion. Chaque écriture est mesurée par le
différentiel de `count(*)` des tables `students`, `users`, `payment_statuses`,
`evaluations`, `grades`, `attendance` avant/après la requête.

### 3.3 Matrice — abonnement **suspendu** (`status = suspended`, état PG vérifié : `status='suspended'`, `profile_payload.status='suspended'`)

| Domaine | Requête | 1. avant | 2. ancien jeton | 3. jeton rafraîchi | 4. nouvelle connexion |
|---|---|---|---|---|---|
| Élèves | `GET /api/students` | 200 | **200** | **200** | connexion 403 |
| Élèves | `POST /api/classes/CLS-2026-000035/students` | 201 (+1 élève, +1 compte) | **201 (+1 élève, +1 compte)** | **201 (+1, +1)** | — |
| Utilisateurs | `GET /api/backoffice/users` | 200 | **200** | **200** | — |
| Utilisateurs | `POST /api/backoffice/users` | 201 (+1) | **201 (+1)** | **201 (+1)** | — |
| Finances | `GET /api/finance/payment-statuses`, `GET /api/payments` | 200 / 200 | **200 / 200** | **200 / 200** | — |
| Finances | `POST /api/finance/payment-statuses` | 201 (+1) | **201 (+1)** | **201 (+1)** | — |
| Évaluations | `GET /api/evaluations` | 200 | 200 | 200 | — |
| Évaluations | `POST /api/evaluations` | 201 (+1) | **403**, 0 écriture | **403**, 0 écriture | — |
| Notes | `GET /api/notes` / `POST /api/notes` | 200 / 201 (+1) | 200 / **403**, 0 écriture | 200 / **403**, 0 écriture | — |
| Présences | `GET /api/presences` / `POST /api/presences` | 200 / 201 (+1) | 200 / **403**, 0 écriture | 200 / **403**, 0 écriture | — |
| Abonnement | `GET /api/backoffice/subscription-access` | `full` | **`blocked`** | **`blocked`** | — |

- Rafraîchissement après suspension : **200** pour l'Admin et l'Enseignant, **nouveau jeton
  d'accès et nouveau jeton de rafraîchissement émis** ; un second rafraîchissement depuis le
  jeton émis réussit aussi. Chaque rotation réécrit `sessions.expires_at` avec la nouvelle
  échéance (`postgresRepository.rotateSessionRefresh`, fenêtre glissante de 7 jours par
  défaut, `lib/authTokenPolicy.js:14`) : **la session ne s'éteint pas tant que le client
  la rafraîchit** ; aucune durée de vie absolue n'a été trouvée [CODE].
- Nouvelle connexion : **403** « L'accès à la plateforme est suspendu pour cet
  établissement (abonnement expiré ou impayé). »
- Sessions : **3 sessions CD actives** (`revoked_at IS NULL`) après la suspension — la
  suspension ne révoque aucune session.
- Refus 403 des portes `write_*` : message d'abonnement (`BLOCKED_MESSAGE`), **pas** un
  refus RBAC ; aucune écriture (différentiel nul).

### 3.4 Matrice — abonnement **expiré** (`endDate` = J-40, `status=active`)

Résultats **identiques** à la suspension : niveau `blocked` ; lectures et écritures non
protégées (élèves, utilisateurs, statuts de paiement) **201 avec écriture** avec l'ancien
jeton et avec le jeton rafraîchi ; évaluations, notes, présences 403 sans écriture ;
rafraîchissement 200 (chaîne) ; nouvelle connexion 403.

### 3.5 Matrices complémentaires

| Scénario | Niveau | Connexion | Rafraîchissement | Écritures non protégées | Écritures `write_*` |
|---|---|---|---|---|---|
| **Témoin** (aucune modification) | `full` | 200 | 200 | 201 | 201 (hors REFRESH-R1, § 4) |
| **Retard** (`endDate` = J-20) | `limited` | 200 | 200 | **201**, dont `POST /api/classes/:code/students` alors que `FEATURE_RULES.create_student = ["full"]` (O9-R2) | 201 (`limited` admis pour `write_notes`/`write_presence`) |
| **Sans ligne d'abonnement** | `full` | 200 | 200 | 201 | 201 |

### 3.6 Réponses aux questions du mandat

| Question | Réponse | Source |
|---|---|---|
| Le refresh vérifie-t-il l'état courant de l'abonnement ? | **Non.** | [CODE] `sessionRefreshService.js:72`, `server.js:7042` ; [HTTP] refresh 200 après suspension et expiration |
| Un nouvel access token peut-il être émis après suspension ? | **Oui**, ainsi qu'un nouveau refresh token ; la chaîne se prolonge. | [HTTP] |
| Quelles routes restent accessibles avec un ancien JWT ? | **Toutes**, sauf les 6 portes `write_*` (évaluations POST/PATCH, notes POST, présences POST, 2 portes internes d'appel par carte). Démontré pour élèves (lecture, inscription), utilisateurs (lecture, création), finances (lectures, création de statut). Par construction, il en va de même pour les autres écritures non protégées (classes, emplois du temps, communication, paramétrage, etc.). | [HTTP] + [CODE] |
| Quelles routes utilisent `assertSchoolFeature` ? | Uniquement `requireSchoolSubscriptionFeature` (`server.js:5304`), appliqué aux 6 points ci-dessus. | [CODE] |
| Portée réelle de `FEATURE_RULES` ? | 2 fonctionnalités appliquées sur 9 (+ `connect` à la connexion). | [CODE] [HTTP] |
| Invalidation du cache d'abonnement effective ? | **Oui** pour le chemin métier : `upsertPlatformSubscription` remet `cachedDataset` à `null` (`postgresRepository.js:1313`) ; la suspension/expiration s'applique dès la requête suivante (niveau `blocked` immédiat). Une modification SQL directe n'est prise en compte qu'à la prochaine invalidation. | [CODE] [HTTP] |
| Refus dû à l'abonnement ou au RBAC ? | Aux 6 portes : **abonnement** (message `BLOCKED_MESSAGE`, permissions RBAC intactes — les mêmes requêtes passent avant suspension). Ailleurs : **RBAC uniquement**, d'où l'accès conservé. | [HTTP] |

**Gravité.** P1 : un établissement suspendu ou expiré conserve, via une session ouverte
avant la mesure, un accès complet en lecture et en écriture à tout sauf notes, évaluations
et présences, renouvelable sans limite par le rafraîchissement. À requalifier **P0** si la
suspension est utilisée comme mesure de sécurité (compte compromis, résiliation
contentieuse) : la seule coupure effective est alors l'expiration du jeton de
rafraîchissement, qui ne survient pas tant que le client le renouvelle.

### 3.7 Établissement sans ligne d'abonnement — options de politique (décision CTO)

Comportement actuel (conservé par O9) : `resolveSchoolAccess` sans ligne ⇒ `full`
(`schoolSubscriptionAccessService.js:170`) ; vérifié [HTTP] : connexion, lectures et
écritures 200/201. Un code d'établissement **inconnu** de l'état donne aussi `full` [CODE] ;
la connexion exige cependant que l'établissement existe (`authService.js:767`).

| Option | Effet | Écoles existantes | Démonstrations | Nouvelles inscriptions |
|---|---|---|---|---|
| A. Statu quo `full` | aucun changement | aucun impact | aucun impact | un établissement créé sans abonnement a un accès complet illimité |
| B. `limited` par défaut | connexion et saisie notes/présences ; fonctionnalités `full` refusées si O9-R2 est câblé | établissements sans ligne passent en limité : **inventaire préalable obligatoire** | seed à compléter (abonnements de démonstration) | essai à formaliser par une ligne d'abonnement « trial » |
| C. `blocked` (fail-closed) | aucune connexion sans abonnement | coupure immédiate des établissements sans ligne : **migration de données préalable** | idem B, sinon démonstrations cassées | création d'établissement ⇒ création atomique d'un abonnement (essai) |
| D. `full` borné | `full` pendant N jours après la création de l'établissement, puis B ou C | transition lissée | idem | période d'essai implicite à documenter |

Recommandation technique : **D ou B**, précédée d'un inventaire SQL en lecture seule des
établissements sans ligne d'abonnement en préproduction (non exécuté : hors mandat).

### 3.8 Proposition de correction (PR « MONO-FIX-O9-R1 », non ouverte, après décision de politique)

| Élément | Proposition |
|---|---|
| Périmètre minimal | (1) `rotateRefreshSession`/`issueRefreshedAccessToken` : appeler la même règle que la connexion (`assertSchoolCanConnect`) pour les comptes d'établissement ; refus ⇒ 403 et **révocation de la session** ; (2) `requireAuth` : vérification du niveau d'abonnement pour les comptes d'établissement (lecture seule autorisée ou non selon la politique) — **ou**, variante plus étroite, porte `requireSchoolSubscriptionFeature` par famille d'écriture ; (3) à la suspension (`upsertPlatformSubscription`, `establishments/:code/suspend`), révocation des sessions de l'établissement |
| Fichiers | `backend/lib/sessionRefreshService.js`, `backend/server.js` (`issueRefreshedAccessToken`, `requireAuth` ou portes), `backend/services/schoolSubscriptionAccessService.js` (lecture seule de la règle existante), éventuellement `backend/db/postgresRepository.js` (révocation par établissement) |
| Tests obligatoires | HTTP/PG : la matrice § 3.3 rejouée après correctif (refresh 403 après suspension et expiration ; écritures élèves/utilisateurs/finances 403 sans écriture ; lectures selon politique) ; témoin `full` et `limited` inchangés ; Superadmin/Admin Pays non affectés ; sessions révoquées ; O9, A2 et la matrice RBAC MONO-T1 inchangés |
| Risques de régression | coût : `getAuthoritativeBackOfficeState` reconstruit l'état complet à chaque appel (déjà le cas aux 6 portes) — une vérification par requête exige une lecture ciblée de l'abonnement ; comptes plateforme ; parents/élèves (établissement suspendu ⇒ lecture des bulletins ?) |
| Impact Web / Mobile | Web et Mobile doivent gérer un **403 au rafraîchissement** (aujourd'hui : 401 ⇒ reconnexion) : vérifier `Mobile/src/services/httpClient.ts` (401 seulement réessayé) et le client Web ; message utilisateur « abonnement suspendu » |
| Estimation | **2 PR** : (a) refresh + révocation (petite, sans décision de politique de lecture) ; (b) application de la politique de lecture/écriture et câblage de `FEATURE_RULES` (après décision CTO O9-R2/O9-R3) |

---

## 4. REFRESH-R1 — Jeton enseignant après rafraîchissement (constat annexe)

Constat apparu dans le scénario **témoin** (aucune modification d'abonnement) [HTTP] :

| Connexion | Rôle du jeton de connexion | `POST /api/presences` | Rôle du jeton rafraîchi | `POST /api/presences` |
|---|---|---|---|---|
| `POST /api/backoffice/login` (Web) | `Enseignant` | 201 | **`TEACHER`** | **409 `ATTENDANCE_TEACHER_UNRESOLVED`** |
| `POST /api/login`, `role: "teacher"` (Mobile) | `Enseignant` | 201 | **`TEACHER`** | **409 `ATTENDANCE_TEACHER_UNRESOLVED`** |

Revendications comparées (valeurs sensibles masquées) : le jeton rafraîchi perd `roleKeys`,
`roles`, `schoolId`, `userId`, `countryScope`, `studentIds`, `guardianStudentIds`, et porte
la **clé** de rôle `TEACHER` au lieu du **libellé** `Enseignant` ; permissions et affectations
identiques. Cause : `issueRefreshedAccessToken` (`server.js:7042`) ne reconstruit pas le
principal comme la connexion (`buildPrincipal`) ; or 36 comparaisons strictes sur des
libellés de rôle existent dans le code applicatif hors seeds et scripts
(`role === "Enseignant"`, `"Parent"`, `"Admin School"`…), dont celle de
`postgresRepository.js:5460` (présences). Les autres n'ont pas été rejouées
individuellement après rafraîchissement : **risque plausible, non reproduit**. Notes et évaluations restent possibles après
rafraîchissement (contrôles par permission et affectations).

**Antériorité** : reproduit à `2f416bc6` (avant O9) ; à `ec9f168f` (MONO-T0), le jeton
rafraîchi porte déjà `TEACHER` (présences refusées en 403 pour une autre cause, A1/A2 non
corrigés). **Non introduit par MONO-T1 → A5.**

**Impact** : jeton d'accès de 15 minutes ⇒ un enseignant (Web ou Mobile) ne peut plus
enregistrer l'appel après le premier rafraîchissement silencieux. **P1 fonctionnel.**
Proposition : PR distincte « MONO-FIX-REFRESH-R1 » — construire le principal rafraîchi
avec la même fonction que la connexion (libellé de rôle, `roleKeys`, `schoolId`) ; tests
HTTP : présences, notes, parent (`studentIds`), Admin Pays (`countryScope`) après
rafraîchissement. **1 PR.** Indépendante d'O9-R1, mais elle touche la même fonction : à
séquencer **avant** O9-R1 pour éviter un conflit.

---

## 5. Vérifications transversales

| Contrôle | Résultat | Source |
|---|---|---|
| Séparation des établissements (A5) | PostgreSQL : conforme (404 inter-établissement, copies distinctes par établissement) ; mémoire : **non conforme** en POST (A5-R4) | [HTTP][PG] |
| RBAC préservé | Superadmin 403 sur les statuts de paiement ; Admin Pays lecture seule ; secrétaire autorisée (conforme à la matrice MONO-T1) | [HTTP] |
| Bases jetables uniquement | oui (cluster local `initdb`, bases `somafrik_mono_t1_t2_*_it`) | — |
| Aucune écriture sur refus | vérifié par instantané ou différentiel de comptage à chaque refus | [PG] |
| Secrets | aucun jeton ni secret journalisé | — |

## 6. Commandes de reproduction

```bash
# Cluster jetable (local, jamais partagé)
D=/var/lib/postgresql/somafrik-mono-test
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D -U postgres --pwfile=<fichier> -A scram-sha-256 -E UTF8"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D -o '-p 55432 -c listen_addresses=127.0.0.1' start"
psql -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE somafrik_disposable_test_cluster" \
     -c "COMMENT ON DATABASE somafrik_disposable_test_cluster IS 'somafrik:disposable-test-cluster'"

# Sondes (scripts d'audit non versionnés, basés sur backend/lib/monoT1HttpHarness.js)
export DATABASE_URL=postgres://postgres:<mdp>@127.0.0.1:55432/postgres
node probe-a5r1.js              # A5-R1 à R4 (PostgreSQL puis mode mémoire)
node probe-o9r1.js              # O9-R1 : témoin, suspendu, expiré, retard, sans abonnement
node probe-refresh-claims.js    # REFRESH-R1 : revendications connexion vs rafraîchissement
node probe-refresh-mobile.js    # REFRESH-R1 : /api/login (Mobile) et /api/backoffice/login (Web)

# Arrêt et suppression du cluster
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D stop" && rm -rf $D
```

Les sondes sont des scripts d'audit hors dépôt (mandat documentaire) ; leurs scénarios
sont décrits intégralement ci-dessus pour être transformés en tests HTTP/PostgreSQL dans
les PR correctives.
