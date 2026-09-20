# Échecs et blocages — audit E2E métier

**SHA :** `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8`  
**Règle :** chaque FAIL reste FAIL. Aucune correction.

---

### FAIL-ID : F-SEED-001

| Champ | Valeur |
| ----- | ------ |
| ID du test | boot officiel backend + seed démo |
| Domaine | plateforme / données |
| Scénario | Démarrer le backend avec le défaut Compose `SOMAFRIK_SKIP_DEMO_SEED` non true |
| Commande | `npm --prefix backend run dev` (`DATABASE_URL` Postgres Docker) |
| Fichier source | init stockage backend (contrainte `uq_users_school_email`) |
| Surface | Backend + PostgreSQL |
| Résultat attendu | Schéma + comptes de démo / superadmin exploitables |
| Résultat observé | Crash init, process exit ; reproductible sur `somafrik` et `somafrik_e2e_shared` |
| Message d’erreur | `duplicate key value violates unique constraint "uq_users_school_email"` ; `Impossible d'initialiser le stockage Somafrik` |
| Stack trace pertinente | Code domaine `23505` (logs process backend) |
| Requête / API | n/a (avant listen) |
| HTTP status | n/a |
| Environnement | ENV-LOCAL |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Reproductibilité | oui, 2/2 bases neuves |
| Capture / trace | `results/official-pg-seed-init.txt` |
| Logs | idem |
| Classification | **FAIL-PRODUCT** |
| Sévérité métier | **P0** — impossibilité de démarrer le stockage obligatoire sur le chemin de seed officiel |

> Hypothèse uniquement — aucune correction effectuée. Le seed/bootstrap écrit deux fois le même e-mail (ou e-mail NULL collision) avant la fin d’init.

---

### FAIL-ID : F-BOOTSTRAP-001

| Champ | Valeur |
| ----- | ------ |
| ID du test | bootstrap E2E superadmin |
| Domaine | authentification |
| Scénario | Appliquer le mot de passe E2E connu sur superadmin / admin |
| Commande | `SOMAFRIK_E2E_BOOTSTRAP=true node backend/scripts/bootstrap-e2e-superadmin.js --confirm` |
| Fichier source | `backend/scripts/bootstrap-e2e-superadmin.js` |
| Surface | Backend / PG |
| Résultat attendu | Hash E2E appliqué aux comptes `users` + state |
| Résultat observé | ROLLBACK ; EXIT 1 |
| Message d’erreur | `backoffice_state introuvable ou sans utilisateurs.` |
| Stack trace pertinente | `main()` après UPDATE `users` (0 lignes) puis lecture `backoffice_state` |
| Requête / API | SQL `backoffice_state` |
| HTTP status | n/a |
| Environnement | ENV-LOCAL |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Reproductibilité | oui |
| Logs | `results/bootstrap-e2e-superadmin.txt` |
| Classification | **FAIL-TEST** |
| Sévérité métier | P1 (bloque la suite `verify:e2e-api` officielle) |

> Hypothèse uniquement — aucune correction effectuée. Le script est encore couplé au JSON legacy `backoffice_state` alors que le runtime lu par les E2E HTTP est PostgreSQL `users`.

---

### FAIL-ID : F-API-401-CLUSTER

| Champ | Valeur |
| ----- | ------ |
| ID du test | E2E-API-ONBOARD, 0001–0005, 0008–0009, 0011–0015, 0028 |
| Domaine | transversal (auth en tête de chaîne) |
| Scénario | Login Superadmin puis parcours métier HTTP |
| Commande | `npm run verify:e2e-api` |
| Fichier source | `scripts/e2e-api-helpers.js` `loginFull` + chaque `scripts/verify-e2e-*.js` |
| Surface | API |
| Résultat attendu | HTTP 200 login `superadmin` / `E2eTest!2026` |
| Résultat observé | HTTP 401 `{ "message": "Identifiant ou mot de passe incorrect." }` ; table `users` vide |
| Message d’erreur | `login superadmin: … 401 !== 200` |
| Stack trace pertinente | `assert.strictEqual(res?.status, 200)` dans `loginFull` |
| Requête / API | `POST /api/backoffice/login` |
| HTTP status | 401 |
| Environnement | ENV-LOCAL (backend skip-seed, seul mode qui reste UP) |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Reproductibilité | oui, 14/14 scripts HTTP |
| Logs | `results/verify-e2e-api.txt` |
| Classification | **FAIL-DATA** (conséquence de F-SEED-001 + F-BOOTSTRAP-001) |
| Sévérité métier | **P1** — parcours métier essentiels non démontrés |

> Hypothèse uniquement — aucune correction effectuée. Ce n’est pas une preuve que les règles finance/notes/etc. sont fausses ; le contrat n’a jamais été atteint. Aucune donnée artificielle n’a été injectée pour masquer le trou.

---

### FAIL-ID : F-MOB-401-CLUSTER

| Champ | Valeur |
| ----- | ------ |
| ID du test | E2E-MOB-0017 … 0025, 0027 |
| Domaine | mobile auth / scolarité / UX |
| Scénario | Préparer un jeu via API puis piloter Expo web Playwright |
| Commande | `SOMAFRIK_REQUIRE_MOBILE_E2E=true npm run verify:e2e-mobile` |
| Fichier source | `scripts/verify-e2e-0017-…0027-*.js` |
| Surface | Mobile web + API |
| Résultat attendu | Jeu E2E créé, parcours UI |
| Résultat observé | Étape 0–1 OK (API + Expo up) ; étape 2 KO login superadmin/admin 401 |
| Message d’erreur | identique au cluster API |
| Requête / API | `POST /api/backoffice/login` |
| HTTP status | 401 |
| Environnement | ENV-LOCAL Expo `:8083` |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Reproductibilité | oui |
| Logs | `results/verify-e2e-mobile.txt` |
| Classification | **FAIL-DATA** |
| Sévérité métier | **P1** |

> Hypothèse uniquement — aucune correction effectuée.

---

### FAIL-ID : F-MOB-0026-SEED

| Champ | Valeur |
| ----- | ------ |
| ID du test | E2E-MOB-0026 |
| Domaine | mobile UX responsive |
| Scénario | Viewports welcome + authentifié (seed démo requis) |
| Commande | `npm run verify:e2e-0026` (via suite mobile) |
| Fichier source | `scripts/verify-e2e-0026-mobile-responsive.js` |
| Surface | Mobile web |
| Résultat attendu | Seed démo actif |
| Résultat observé | `Prérequis manquants` / `SOMAFRIK_SKIP_DEMO_SEED=true ou backend PostgreSQL requis` |
| HTTP status | n/a |
| Environnement | ENV-LOCAL |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Logs | `results/verify-e2e-mobile.txt` |
| Classification | **FAIL-DATA** |
| Sévérité métier | P2 |

> Hypothèse uniquement — aucune correction effectuée. Le seed officiel qui satisferait le prérequis est celui qui crashe (F-SEED-001).

---

### FAIL-ID : F-DOCKER-UP-CORE

| Champ | Valeur |
| ----- | ------ |
| ID du test | stack officielle `docker:up:core` |
| Domaine | infra locale |
| Scénario | Construire et démarrer postgres + backend |
| Commande | `npm run docker:up:core` |
| Fichier source | `backend/Dockerfile` stage `web` |
| Surface | Docker |
| Résultat attendu | Conteneurs healthy |
| Résultat observé | Vite : `ENOENT /packages/help-catalog/src/index.js` |
| Environnement | ENV-LOCAL |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Logs | `results/docker-up-core.txt` |
| Classification | **FAIL-INFRA** (build) / cause probable produit (contexte Docker incomplet) |
| Sévérité métier | **P2** (workflow local Docker) |

> Hypothèse uniquement — aucune correction effectuée. Le stage web de l’image copie `web/` sans `packages/`.

Second constat (non corrigé) : même image reconstruite avec l’ARG **déjà prévu** `SKIP_WEB_BUILD=true`, `docker compose up backend` crash en boucle `ENOENT /app/package.json` — le volume `./backend:/app` n’est pas le filesystem de cette VM pour le daemon Docker.

---

### FAIL-ID : F-MAESTRO-RUNTIME

| Champ | Valeur |
| ----- | ------ |
| ID du test | E2E-MOB-RUNTIME + E2E-MAE-01…08, 10 |
| Domaine | mobile natif |
| Scénario | APK Preview + Maestro + API préprod |
| Commande | `npm run verify:mobile-ui-e2e-runtime` |
| Fichier source | `Mobile/scripts/verify-mobile-ui-e2e-runtime.js` |
| Surface | Android |
| Résultat attendu | FAIL-closed BLOCKED si prérequis absents |
| Résultat observé | `BLOCKED_MAESTRO_MISSING, BLOCKED_ADB_MISSING, BLOCKED_NO_DEVICE, BLOCKED_APK_PATH_MISSING, BLOCKED_PACKAGE_NOT_INSTALLED, BLOCKED_APP_LAUNCH_FAILED, BLOCKED_CREDENTIALS_MISSING` |
| Environnement | ENV-LOCAL (cible officielle ENV-PREPROD) |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Logs | `results/verify-mobile-ui-e2e-runtime.txt` |
| Classification | **BLOCKED** |
| Sévérité métier | non classée produit (contrat respecté : pas de faux SUCCESS) |

> Hypothèse uniquement — aucune correction effectuée.

---

### SKIPPED-EXISTING

- **E2E-MAE-09** `BLOCKED_NO_FAILURE_INJECTION`
- **E2E-MAE-11** hors `EXECUTABLE_FLOWS`
- **E2E-MAE-12** mutation attendance sans fixture QA
- **COM-C1 E2E6** `NOT_IMPLEMENTED` (documenté dans un run **PASS** de `verify:communications-e2e`)

---

### Observations pendant un PASS (non fatales pour la commande)

Suite `verify:web-smoke` EXIT 0, mais le navigateur a journalisé :

- HTTP **500** `GET /api/backoffice/internal-notifications/unread-count?effectiveSchoolCode=CD-2026-0001`
- HTTP **501** `GET /api/school-rooms?status=active`

Classification annexe : **FAIL-PRODUCT** latent / **P2**. Aucune correction.

Hosted GET préprod/prod : joignables, **SHA non vérifiable** → HOLD du script, **pas** un PASS métier hébergé.
