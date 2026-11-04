# PERF-01 — Audit transversal des performances Web, Mobile, API et PostgreSQL

| Champ | Valeur |
|---|---|
| Date | 04 novembre 2026 |
| Priorité | P1 — Expérience utilisateur critique |
| Statut | **AUDIT UNIQUEMENT / HOLD / DRAFT** — aucun correctif produit, aucun merge |
| Base des mesures initiales | `develop` @ `eff44c5dbe2a` |
| Relecture code | `develop` @ `ea1250e5948f` (21 commits après le merge-base initial, voir §11) |
| Périmètre | Web (React/Vite) · Mobile Expo React Native · Backend Express · PostgreSQL · Render |

> **Gouvernance respectée.** Aucune modification de code produit, de RBAC, de schéma PostgreSQL, de cache, de transactions ni de service Render. Aucun merge, aucun déploiement. Les seuls ajouts sont ce rapport et les scripts de banc synthétique sous `docs/audits/perf-01/`.

---

## 0. Résumé exécutif

**Verdict.** La cause principale des lenteurs identifiée par cet audit est **côté backend / PostgreSQL** : plusieurs endpoints très sollicités (présences, notes, paiements, cours, emploi du temps, fiche établissement, connexion) **lisent les tables de *tous* les établissements de la plateforme**, puis filtrent en JavaScript. Le coût de chaque requête croît donc avec la taille de **toute** la plateforme, pas avec celle de l'école consultée. Le frontend Web aggrave l'effet dans le code : **le tableau de bord rappelle ces endpoints toutes les 10 secondes**, sans pagination ni requête incrémentale. Sur mobile, le code traite une connexion lente (et non coupée) comme une **erreur plutôt que comme un affichage des données déjà en cache**.

**Gain démontré et gain non constaté.** L'écart d'environ **95 %** (1 200 000 lignes → 60 000, soit 549 Mio → 27,5 Mio sur le premier banc) est la différence de **volume de lignes lues par deux requêtes SQL** sur une base PostgreSQL locale synthétique. Ce n'est pas une réduction déjà constatée du temps d'affichage. Aucune latence Render, aucun parcours Web en 3G et aucun téléphone Android n'ont été mesurés (§1.3, §11).

Les 6 constats les plus graves, par niveau de preuve :

| # | Constat | Couche | Preuve | Sévérité |
|---|---|---|---|---|
| B1 | `GET /api/presences`, `/api/notes`, `/api/payments` (+ fiches élève) exécutent 5 à 9 requêtes SQL **sans `WHERE school_id`** puis filtrent en Node | Backend/PG | **Code + mesure** (banc local) | P0 |
| B2 | Le volume lu croît linéairement avec le nombre d'établissements : présences ×20 écoles = **1,2 M lignes / 549 Mio** lus pour servir **une** école (contre 60 k / 27,5 Mio filtré). Écart de volume du banc, pas un temps d'écran | PG | **Mesuré (banc local)** | P0 |
| W1 | Le tableau de bord établissement recharge **6 listes complètes toutes les 10 s** (élèves, enseignants, classes, présences, paiements, frais), plus le fil d'activité (10 s) et le compteur de notifications (30 s) | Web | **Code** | P0 |
| B3 | `GET /api/presences` d'une école de 500 élèves à mi-année ≈ **22,8 Mio de JSON brut** (≈ 1,8 Mio gzip). Express n'a **aucune compression** ; la compression côté Render n'est pas vérifiée | API/Réseau | **Estimation calculée** + code | P0 |
| M1 | Mobile : un `TIMEOUT` (20 s) ou un serveur injoignable **n'est pas traité comme hors ligne** → l'écran affiche une erreur au lieu des données SQLite déjà synchronisées | Mobile | **Code** | P1 |
| W2 | Web : `fetch` **sans aucun timeout** ; en production une route attend la **fin de toutes** ses requêtes (`Promise.allSettled`) avant d'afficher quoi que ce soit | Web | **Code** | P1 |

**Ce qui n'est PAS établi** (faute d'accès, voir §1.3) : la part exacte du réseau, de la région Render, du plan d'instance, des cold starts et de la latence PostgreSQL ↔ API en production. Ces hypothèses sont listées en §7 avec la mesure exacte à réaliser.

---

## 1. Méthode et niveaux de preuve

### 1.1 Niveaux de preuve utilisés

| Étiquette | Signification |
|---|---|
| **MESURÉ** | Chiffre obtenu par une exécution réelle dans cet audit (build, banc PostgreSQL local). |
| **PROUVÉ PAR CODE** | Comportement déterministe lisible dans le code de `develop` (chemin d'exécution cité, fichier:ligne). L'effet existe ; son ampleur en production reste à mesurer. |
| **ESTIMATION** | Calcul reproductible à partir du code (ex. taille d'un DTO × nombre de lignes). |
| **HYPOTHÈSE** | Cause plausible non vérifiable ici. **Aucune n'est présentée comme certaine.** |

### 1.2 Mesures réalisées

1. **Build de production Web** (`vite build`, `web/`) et pesée gzip de chaque chunk.
2. **Banc PostgreSQL 16 local** : schéma du dépôt (`backend/db/schema.sql` + `migrations/20260813_pedagogy_canonical.sql`), données **100 % synthétiques** générées par `docs/audits/perf-01/seed.sql`, requêtes **copiées à l'identique** de `pedagogyPgStore.js` et `financePgStore.js`, exécutées en version « plateforme » (actuelle) et « filtrée établissement ».
3. **Estimation de payload** : sérialisation de 60 000 objets conformes à `mapAttendance()` (`backend/db/postgresRepository.js`).

### 1.3 Limites (à lire avant d'interpréter)

| Limite | Conséquence |
|---|---|
| L'environnement d'audit **n'a pas d'accès réseau** à `api.somafrik.app` ni `api-preprod.somafrik.app` (connexion refusée par le proxy sortant). | **Aucune mesure de latence réelle** préprod/prod, ni de compression Render. |
| Pas d'accès au tableau de bord Render, aux métriques ni aux logs. | Plan d'instance, région, mémoire, cold starts : **non vérifiés**. |
| Pas d'appareil Android, pas d'émulateur, pas de parcours en connexion faible. | Aucune mesure de temps d'ouverture, de rendu, ni de repli cache sur téléphone. **Aucune mesure Android ou iOS n'est revendiquée.** Les durées « 3G » et « 4G » du §2.2 sont des quotients arithmétiques (taille estimée ÷ débit supposé), pas des transferts chronométrés. |
| Banc PG local : même machine, pas de latence réseau API↔DB, cache disque chaud. | Les temps SQL ne sont pas une latence Render ni un temps d'affichage. Le rejeu du §11 retrouve les lignes, pas les mêmes millisecondes. |
| Banc arrêté à 20 établissements (le seed à 50 a été interrompu par une restriction de permissions de l'environnement, sans lien avec Somafrik). | La tendance linéaire est établie sur 1 → 5 → 20. |
| Le texte du mandat reçu s'interrompt en §4 (« B. Écriture hors ligne… »). | Les sections suivantes du mandat n'ont pas été reçues ; l'API, PostgreSQL et Render sont couverts d'après le périmètre de l'en-tête. |

---

## 2. Résultats mesurés

### 2.1 Banc PostgreSQL — requêtes actuelles vs filtrées par établissement (MESURÉ)

Profil synthétique par établissement : 500 élèves, 10 classes, 8 matières, 10 enseignants, 120 jours de présence (≈ mi-année), 3 évaluations par classe et matière au T1, 3 paiements par élève.

| Écoles sur la plateforme | Requête | Mode | Lignes lues | Volume brut des lignes | Temps SQL (médiane) |
|---:|---|---|---:|---:|---:|
| 1 | présences | plateforme | 60 000 | 27,5 Mio | 80 ms |
| 5 | présences | plateforme | 300 000 | 137,2 Mio | 220 ms |
| 5 | présences | filtrée | 60 000 | 27,5 Mio | 74 ms |
| **20** | **présences** | **plateforme** | **1 200 000** | **549,4 Mio** | **945 ms** |
| 20 | présences | filtrée | 60 000 | 27,5 Mio | 86 ms |
| 1 | notes | plateforme | 12 000 | 13,2 Mio | 105 ms |
| 5 | notes | plateforme | 60 000 | 66,1 Mio | 764 ms |
| **20** | **notes** | **plateforme** | **240 000** | **265,0 Mio** | **1 564 ms** |
| 20 | notes | filtrée | 12 000 | 13,2 Mio | 117 ms |
| 20 | paiements | plateforme | 30 000 | 13,7 Mio | 41 ms |
| 20 | paiements | filtrée | 1 500 | 0,7 Mio | 4 ms |

Lecture — ce que le banc démontre, et ce qu'il ne démontre pas :

- **Volume de lignes (démontré, et reproduit au §11).** À 20 écoles synthétiques, la requête présences non filtrée lit 1 200 000 lignes (549 Mio) là où la variante filtrée lit 60 000 lignes (27,5 Mio). L'écart est de 20×, soit environ **95 % de lignes en moins** sur la variante filtrée. Ce pourcentage décrit le banc. Il n'a pas été constaté comme baisse du temps d'affichage.
- **Temps SQL (médianes locales, non transposables).** Sur la machine du premier banc, la médiane présences passe de 945 ms (non filtrée) à 86 ms (filtrée), soit environ 11×. Le rejeu retrouve les mêmes nombres de lignes, pas les mêmes millisecondes (664 ms contre 71 ms, environ 9×). Le facteur de temps dépend de la machine. Ce n'est ni une latence Render, ni un temps Web, ni un temps Android.
- `GET /api/presences` et `GET /api/notes` lancent **les 5 requêtes pédagogiques en parallèle** (évaluations, notes, présences, cours, créneaux — `pedagogyPgStore.js:1227`). Additionner les deux médianes du premier banc (945 ms + 1 564 ms ≈ 2,5 s) donne un **temps SQL cumulé**, pas un temps mur et pas un temps d'écran.
- Les volumes « plateforme » (≈ 815 Mio de lignes brutes pour présences + notes à 20 écoles, premier banc) dépassent ce qu'une instance Node de taille courante garde confortablement en mémoire. Le plan Render réel n'étant pas connu, le risque de saturation mémoire / GC reste une **hypothèse à vérifier** (§7), pas un incident constaté.
- La requête notes contient une **sous-requête corrélée par ligne** (`school_courses`) : coût proportionnel au nombre total de notes de la plateforme.

### 2.2 Taille des réponses API (ESTIMATION)

| Réponse | Hypothèse | Brut | gzip |
|---|---|---:|---:|
| `GET /api/presences` (1 école) | 500 élèves × 120 jours, DTO `mapAttendance()` | **22,8 Mio** | 1,8 Mio |
| Idem en fin d'année | × 180 jours | ≈ 34 Mio | ≈ 2,7 Mio |

Ordre de grandeur de téléchargement de la réponse présences seule :

| Lien | Brut (si non compressé) | gzip |
|---|---:|---:|
| 3G lente ≈ 1 Mbit/s | ≈ 190 s | ≈ 15 s |
| 4G moyenne ≈ 10 Mbit/s | ≈ 19 s | ≈ 1,5 s |

Ces durées sont des **quotients arithmétiques**. Aucun transfert n'a été chronométré en 3G, en 4G, sur Android ou via Render.

Le serveur Express n'installe **aucun middleware de compression** (`backend/server.js:171-174`). Seule la stack Docker/Caddy (`deploy/caddy/Caddyfile:5`, `encode gzip zstd`) compresse ; **la topologie active documentée est Render** (`docs/render.md`), dont la compression en sortie n'a pas pu être vérifiée.

### 2.3 Bundle Web (MESURÉ — `vite build`)

| Élément | Brut | gzip |
|---|---:|---:|
| Total JS + CSS (144 chunks JS) | 4 056 Kio | 1 248 Kio |
| **Chargement initial** (scripts/CSS référencés par `index.html`, y compris page de connexion) | **1 007 Kio** | **285 Kio** |
| dont `vendor-recharts` (graphiques) | 429 Kio | **120 Kio** |
| `vendor-grapesjs` (éditeur, chargé à la demande) | 1 090 Kio | 293 Kio |
| `ClassesListPage` (embarque `pdf-lib` + `pako`) | 611 Kio | 241 Kio |
| `StudentWorkspacePage` | 199 Kio | 51 Kio |

**Constat W3 (tailles MESURÉES sur le build de `eff44c5` ; règle relue au `ea1250e`, build non rejoué).** `vendor-recharts` (120 Kio gzip sur ce build) est préchargé **sur toutes les pages, y compris `/connexion`**, alors que recharts n'est importé que par `components/charts/DashboardCharts.tsx`. La règle `manualChunks` (`web/vite.config.ts:100`) n'assigne `vendor-recharts` qu'aux modules dont le chemin contient `recharts` ou `/d3-`. Elle ne cite pas `clsx`. L'explication initiale (« `clsx` placé explicitement dans ce chunk ») n'est pas écrite dans la règle, inchangée entre `eff44c5` et `ea1250e`. Les tailles de §2.3 n'ont pas été re-mesurées après les pages bulletins des 21 commits. Le « gain » d'environ 42 % du JavaScript initial gzip est un **potentiel calculé sur l'ancien build**, pas un allègement déjà livré.

**Constat W4.** Ouvrir la liste des classes télécharge 241 Kio gzip (génération PDF de cartes embarquée), même si l'utilisateur ne génère aucun PDF.

---

## 3. Backend & PostgreSQL

### B1 — Lectures « toute la plateforme » puis filtrage en Node (PROUVÉ PAR CODE, P0)

| Endpoint | Chemin d'exécution | Tables lues sans filtre établissement |
|---|---|---|
| `GET /api/presences`, `GET /api/notes`, `GET /api/students/:id/notes`, `GET /api/students/:id/presences`, `POST /api/notes`, `POST /api/presences` | `loadCanonicalPedagogyForPrincipal()` (`server.js:5468`) → `repository.listPedagogyProjection()` (`server.js:5471`) → `pedagogyPgStore.listProjection()` (`pedagogyPgStore.js:1226`) | evaluations, grades, attendance, school_courses, course_schedules (5 requêtes) |
| `GET /api/payments`, `GET /api/students/:id/payments` | `loadCanonicalFinanceForPrincipal()` (`server.js:5482`) → `financePgStore.listProjection()` (`financePgStore.js:865`) | payments, payment_statuses, fee_grids, school_fee_items, student_fee_obligations, fee_tariff_history, payment_reminders, payment_items, payment_allocations (9 requêtes) |
| `GET /api/backoffice/establishments/:code` (domaine `schools`, chargé **sur chaque route** pour un utilisateur établissement), `GET /api/courses`, `GET /api/course-schedules`, `GET /api/backoffice/finance/unpaid*`, `GET /api/backoffice/subscription-access`, `POST /api/backoffice/login`, `POST /api/login`, `POST /api/auth/change-password` | `getAuthoritativeBackOfficeState()` (`server.js:5494`) = dataset + projections finance + pédagogie + plateforme + clients + résiduel | Quasiment toute la base (37 appels dans `server.js`) |
| `GET /api/backoffice/notifications` (domaine `notifications`, layout) | `listPlatformProjection()` | Projection plateforme complète |

**Contraste utile :** les endpoints migrés plus récemment sont **déjà filtrés en SQL** — `GET /api/students` (`listSchoolStudents`), `/api/teachers`, `/api/classes`, `/api/evaluations`, `/api/finance/student-fees`, `/api/finance/fee-grids`, `/api/finance/payment-statuses`. Le problème est donc localisé aux chemins historiques, qui sont précisément ceux du tableau de bord.

Relecture au `ea1250e` : les cinq requêtes de `pedagogyPgStore.listProjection()` sont identiques à `eff44c5`, toujours sans `WHERE school_id`. `financePgStore.listProjection()` (`financePgStore.js:865`) non plus. Le `SELECT` des paiements (lignes 867-872) est inchangé. La requête des obligations, dans le même `Promise.all`, a gagné une sous-requête corrélée `EXISTS` sur `enrollments` (statut élève et inscription active) : elle reste sans filtre établissement et elle est hors du banc de volume, qui ne copie que le `SELECT` des paiements.

### B2 — Croissance avec le nombre d'établissements (MESURÉ)

Voir §2.1. Les index `school_id` existent (`schema.sql:1035-1074`) mais **ne sont pas utilisés**, puisque les requêtes ne filtrent pas. Il n'existe pas d'index `attendance(school_id, attendance_date)` (seul `idx_attendance_student_date`, `schema.sql:1052`) ; à évaluer **uniquement** si un filtrage par école/date est introduit.

### B4 — Pool de connexions saturé par une seule requête (PROUVÉ PAR CODE)

- Pool PG : **5 connexions par défaut, plafond 6** (`backend/db/connectionConfig.js:13-15`).
- Une seule lecture finance lance **9** requêtes en `Promise.all`, une lecture pédagogie **5**, une reconstruction du dataset **15**.
- Une seule requête peut donc occuper tout le pool ; les requêtes concurrentes (autres onglets, autres écoles, mobile) **font la queue**. À plusieurs utilisateurs simultanés, la latence perçue s'additionne.

### B5 — Cache global du dataset invalidé par chaque écriture (PROUVÉ PAR CODE)

- `getDataset()` (`postgresRepository.js:2065`) met en cache **tout le jeu de données de la plateforme** (15 tables) dans la mémoire du processus.
- Ce cache est vidé à **40 endroits** (`cachedDataset = null`), c'est-à-dire après la plupart des écritures, **quel que soit l'établissement**.
- Aucune protection contre l'emballement : après invalidation, plusieurs requêtes simultanées relancent chacune les 15 requêtes.
- Effet : dans une plateforme active, une saisie de présence dans l'école A peut ralentir la connexion d'un utilisateur de l'école B.

### B6 — Pas de pagination par défaut (PROUVÉ PAR CODE)

`sendList()` (`server.js:7761`) ne pagine que si le client envoie `page`, `limit`, `sort` ou `search`. Les loaders Web (`web/src/lib/domainLoaders.ts`) et Mobile (`Mobile/src/services/api.ts:503`, `:388`, `:955`) n'en envoient jamais : réponses toujours complètes. Le seul flux réellement paginé côté dashboard est le fil d'activité (`/dashboard/school-activities?limit=10`, curseur).

### B7 — Compression absente côté Express (PROUVÉ PAR CODE ; effet Render NON VÉRIFIÉ)

Voir §2.2.

---

## 4. Audit Web

### 4.1 Architecture de données

- **Un seul contexte global** (`web/src/context/DataContext.tsx`) contient les 29 domaines. Chaque fusion de domaine crée un nouvel objet `state` : **tous** les composants qui appellent `useData()` (51 fichiers) se re-rendent, y compris ceux qui ne lisent pas le domaine modifié. Un seul `memo()` dans tout `src/`. (PROUVÉ PAR CODE ; coût de rendu non profilé.)
- **Cache client par domaine** (`loadedDomainsRef`) : un domaine déjà chargé n'est pas re-téléchargé à la navigation (`ensureDomains`). C'est un point positif : **pas de refetch systématique à chaque navigation**. Le cache est mémoire uniquement (perdu au rechargement de page, pas de persistance).
- **Mutations** : après une écriture « résiduelle », les domaines concernés sont rechargés **en entier** (`DataContext.tsx`, `update()` → `loadDomains(refreshKeys)`). Toute mutation sur `attendance|presences|course-schedules|payments|classes` déclenche en plus l'événement `DASHBOARD_SYNC_EVENT` (`web/src/api/client.ts`, `dashboardSync.ts:21-27`), qui relance le rafraîchissement des 6 listes du tableau de bord.

### 4.2 W1 — Polling du tableau de bord (PROUVÉ PAR CODE, P0)

| Source | Fréquence | Requêtes | Coût backend |
|---|---|---|---|
| `OverviewPage.tsx:146` → `refresh(DASHBOARD_METRIC_DOMAINS)` | **10 s** + chaque `focus` + chaque mutation | `/students`, `/teachers`, `/classes`, **`/presences`**, **`/payments`**, `/finance/student-fees` | 2 projections plateforme complètes (B1) = 14 requêtes SQL non filtrées + 4 filtrées |
| `SchoolRecentActivities.tsx:76` | 10 s + `focus` | `/dashboard/school-activities?limit=10` | paginé |
| `internalNotificationsRead.ts:46` | 30 s + `focus` + `visibilitychange` | compteur non lus | léger |

- Le polling métrique s'arrête si l'onglet est masqué (`document.hidden`) ; **le fil d'activité, lui, continue en arrière-plan**.
- Extrapolation arithmétique, non mesurée sur le réseau : ≈ 23 Mio brut toutes les 10 s pendant une heure (360 cycles) donnent **plus de 8 Gio par heure et par onglet** si la réponse n'est pas compressée. Le même calcul compressé donne ≈ 1,8 Mio / 10 s ≈ 650 Mio/h. Aucun de ces volumes n'a été observé sur Render, en 3G ou sur Android.
- Les KPI sont **calculés côté client** à partir de ces listes complètes (`getEstablishmentMetrics`, `buildSchoolDashboardSecondaryMetrics`).

### 4.3 W2 — Pas de timeout, attente du plus lent (PROUVÉ PAR CODE, P1)

- `request()` (`web/src/api/client.ts:97`) appelle `fetch` **sans `AbortController`** : sur une connexion bloquée, la requête peut rester en attente indéfiniment, avec spinner permanent. Aucun retry automatique (hors refresh JWT sur 401).
- En **production**, `DomainRouteBootstrap` envoie tous les domaines de la route dans **un seul** `ensureDomains()` ; `loadDomains()` attend `Promise.allSettled` (`domainLoaders.ts:202`) puis fusionne **en une fois**. L'écran reste donc vide jusqu'à la réponse la plus lente (typiquement `/presences` ou `/payments`).
- L'hydratation **progressive par domaine** n'existe qu'en mode Démo (`DomainRouteBootstrap.tsx`, branche `demoRuntimeEnabled` ; `OverviewPage.tsx:69-100`).

### 4.4 Listes, pagination, rendu

- Aucune virtualisation de liste (`react-window` / `@tanstack/react-virtual` absents). 9 usages de pagination **client** (`getPaginationRowModel`) : toutes les lignes sont téléchargées puis découpées dans le navigateur.
- Graphiques : chargés depuis `vendor-recharts`, préchargé partout (W3).

### 4.5 Coupure réseau

- Pas de service worker, pas de lecture hors ligne Web. Un seul test `navigator.onLine` (`FinanceUnpaidPage.tsx:199`).
- Les mutations résiduelles passent par un journal local (`syncOutbox`, `localStorage`) avec relance manuelle `retryFailedSync`.

### 4.6 Matrice des écrans Web (PROUVÉ PAR CODE — `web/src/lib/routeDomainMap.ts`)

Domaines « layout » ajoutés à chaque route : `schools`, `notifications` (selon droits). Pour un utilisateur établissement, `schools` = `GET /backoffice/establishments/:code` = **état complet** (B1).

| Écran | Route | GET parallèles (max, selon droits) | Dont endpoints « plateforme complète » | Attend le plus lent ? |
|---|---|---:|---|---|
| Connexion | `/connexion` | 0 (POST login) | `POST /backoffice/login` → état complet | — |
| Tableau de bord plateforme | `/tableau-de-bord` | 13 | schools, notifications, presences, payments | Oui |
| Vue d'ensemble établissement | `/etablissement/vue-ensemble` | 8 + polling 10 s | schools, notifications ; polling : presences, payments | Oui |
| Élèves / fiche | `/etablissement/eleves` | 4 | schools, notifications | Oui |
| Enseignants | `/etablissement/enseignants` | 5 | schools, notifications | Oui |
| Utilisateurs | `/etablissement/comptes-utilisateurs` | 4 | schools, notifications | Oui |
| Classes | `/etablissement/classes` | 5 | schools, notifications (+ chunk 241 Kio gz) | Oui |
| Emploi du temps | `/planning` | 7 | schools, notifications, **course-schedules** | Oui |
| Présences | `/presences` | 7 | schools, notifications, **presences** | Oui |
| Notes | `/notes` | 6 | schools, notifications, **notes** | Oui |
| Bulletins | `/bulletins` | 6 | schools, notifications, **notes** | Oui |
| Finance | `/finances` | 8 | schools, notifications, **payments** | Oui |
| Communication | `/messages`, `/annonces` | 3 | schools, notifications | Oui |
| Paramètres | `/parametres` | 5 | schools, notifications | Oui |

« Cours » n'a pas de règle de route dédiée ; le domaine `courses` (`GET /api/courses` → état complet) est chargé par les écrans qui le demandent explicitement.

---

## 5. Audit Mobile (Expo React Native — Android ; iOS non mesuré)

### 5.1 Transport

- Client HTTP unique avec **timeout global de 20 s** (`Mobile/src/services/httpClient.ts:39`), `AbortController`, classification `TIMEOUT` / `NETWORK_UNAVAILABLE` / `BACKEND_UNREACHABLE`. Point positif par rapport au Web.
- Limite : un timeout de 20 s couvre **aussi le téléchargement**. Une réponse de plusieurs Mio (présences, §2.2) sur lien lent **ne peut pas aboutir** dans ce délai → échec systématique.

### 5.2 Rechargements

- 23 écrans rechargent leurs données à **chaque prise de focus** (`useFocusEffect`) : changement d'onglet, retour depuis un sous-écran. Exemples : `ClassesScreen.tsx:119` (5 listes : classes, élèves, présences, enseignants, affectations), `HomeScreen.tsx:234-240`, `ClassGradesStatsScreen.tsx:54-57`, `MessagesScreen.tsx:197-201`.
- Les loaders de `AdminDataContext.tsx` **ne dédupliquent pas** et n'ont **pas de durée de fraîcheur** : chaque focus relance le GET complet, même si les données datent de quelques secondes.
- Après vidage de l'outbox, l'app recharge présences + notes + paiements + frais en entier (`OutboxRuntime.tsx:82`), soit 3 projections plateforme (B1).
- Sondage de connectivité toutes les 5 s **uniquement** quand l'outbox contient des éléments (`connectivity.ts:13`, `OutboxRuntime.tsx:94`).

### 5.3 Listes

- 15 écrans utilisent `FlatList` (virtualisé).
- 17 écrans rendent des listes par `ScrollView` + `.map()` (non virtualisé), dont `StudentsScreen`, `StudentDetailScreen`, `TeacherAttendanceScreen`, `TimetableScreen`, `MessagesScreen`, `ReportCardsScreen`, `InternalNotificationsScreen`. Sur un appareil d'entrée de gamme, une classe ou une école nombreuse est rendue en entier. (PROUVÉ PAR CODE ; non profilé sur appareil.)

### 5.4 A. Lecture hors ligne (données précédemment synchronisées)

| Élément | Constat |
|---|---|
| Stockage | SQLite chiffré (SQLCipher) « L1 » (`Mobile/src/offline/l1/`), synchronisation **incrémentale par curseur** — bonne base. |
| Couverture | **5 ressources seulement** : classes, élèves, affectations, cours, créneaux (`offline/l1/schema.ts`). **Non couvert** : présences, notes, paiements, frais, messages, annonces, bulletins. |
| Stratégie | **Réseau d'abord** (`loadL1BackedSnapshot`, `readModel.ts:180`) : le cache n'est lu qu'en cas d'échec réseau. Aucun affichage immédiat du cache pendant le chargement. |
| **M1 — défaut majeur** | Le repli sur le cache n'a lieu **que** pour `NETWORK_UNAVAILABLE` (`isStrictNetworkUnavailable`, `readModel.ts:51-58`). Un `TIMEOUT` ou un `BACKEND_UNREACHABLE` — cas typique d'une connexion **lente ou instable**, ou d'un serveur lent — renvoie une **erreur avec liste vide**, alors que les données sont en SQLite. Au démarrage à froid (pas de données en mémoire), l'utilisateur voit un écran vide. |

### 5.5 B. Écriture hors ligne (opérations enregistrées puis synchronisées)

| Élément | Constat |
|---|---|
| Outbox | Fichier local `somafrik-mutation-outbox.json` (`lib/outbox.ts`). |
| Domaines autorisés | **messages, présences, notes** (`outbox.ts:10`). Les autres mutations sont bloquées hors ligne (`shouldBlockUnsupportedMutations`). |
| Idempotence / doubles soumissions | Clé d'idempotence par entrée + réutilisation d'une entrée en attente (`findReusableEntry`) ; côté serveur `withIdempotency`. Protection présente. |
| Relance | À la reconnexion + sondage 5 s tant que la file n'est pas vide. |

### 5.6 iOS

Le code ne contient pas de blocage spécifique iOS identifié pour ces points (fetch, `AbortController`, `expo-sqlite`). **Aucune mesure iOS n'a été réalisée** ; la faisabilité est à confirmer sur appareil ou simulateur (chiffrement SQLCipher et build EAS iOS en particulier).

---

## 6. Réseau & hébergement Render

| Point | Statut |
|---|---|
| Compression des réponses API | Absente côté Express ; **non vérifiée** côté Render. |
| Cache HTTP | Réponses API en `no-store` ; ETag désactivé sur les statiques BackOffice. Pas de `304` possible. |
| Pool PG 5 (max 6) | Prouvé par code (B4) ; contention à mesurer en charge. |
| Région Render / région PostgreSQL / latence API↔DB | **Non vérifié** (pas d'accès). |
| Plan d'instance, mémoire, cold start | **Non vérifié**. Le risque mémoire lié à B1/B2 est une hypothèse forte. |
| Dossier `workers/` (POC Cloudflare Workers / Hyperdrive) | Observé dans `develop`, hors topologie active documentée ; non audité. |

---

## 7. Hypothèses non prouvées et mesure exacte à réaliser

Aucune de ces causes n'est présentée comme certaine. Toutes ces mesures sont **non destructives** et à exécuter en préprod par une personne disposant des accès.

| # | Hypothèse | Mesure proposée |
|---|---|---|
| H1 | Render compresse (ou non) les réponses JSON | `curl -s -o /dev/null -H "Accept-Encoding: gzip, br" -D - https://api-preprod.somafrik.app/api/health` → présence de `content-encoding` ; même test sur `GET /api/presences` authentifié. |
| H2 | Taille réelle de `/api/presences` et `/api/payments` | `curl -w "%{size_download} %{time_starttransfer} %{time_total}"` sur un compte établissement de préprod. |
| H3 | Temps serveur dominé par SQL vs construction JS | Activer `log_min_duration_statement` en préprod, ou mesurer le TTFB de `/api/presences` avec une seule école vs la base réelle. |
| H4 | Pic mémoire / GC de l'instance | Métriques mémoire Render pendant un tableau de bord ouvert. |
| H5 | Cold start (instance mise en veille) | TTFB de `/api/health` après 30 min d'inactivité. |
| H6 | Latence API ↔ PostgreSQL (régions) | Régions Render du service et de la base ; `EXPLAIN ANALYZE` côté DB vs durée côté API. |
| H7 | Contention du pool | Nombre de requêtes en attente sur le pool (`pool.waitingCount`) en charge réelle. |
| H8 | Coût de re-rendu React | React Profiler sur `/etablissement/vue-ensemble` pendant un cycle de polling. |
| H9 | Rendu mobile des listes non virtualisées | Profiler Flipper/React DevTools sur un Android d'entrée de gamme, classe de 60+ élèves. |

---

## 8. Réponses aux questions du mandat

| Question | Réponse | Preuve |
|---|---|---|
| Pourquoi les données tardent-elles ? | Endpoints historiques lisant toute la plateforme (B1), réponses volumineuses non paginées (B6, §2.2), attente du plus lent côté Web (W2). Le temps d'affichage réel n'a pas été chronométré. | Code + banc local |
| Frontend, backend, PostgreSQL, réseau ou hébergement ? | **Backend/PostgreSQL d'abord** (code + banc local), **amplifié par le frontend** (polling, absence de pagination). Part réseau, Render et Android **non mesurée**. | Code + banc local / H1-H6 |
| Requêtes inutiles ? | Oui : polling 10 s de 6 listes complètes, rechargement complet après mutation et après outbox, rechargement à chaque focus mobile. | Code |
| Rechargement de données déjà récupérées ? | Web : non à la navigation (cache par domaine), **oui** via polling et après mutation. Mobile : **oui à chaque focus**. | Code |
| Trop de données téléchargées ? | Le code renvoie les listes entières. Présences ≈ 22,8 Mio brut est une **estimation** de DTO. Les 285 Kio gz (dont 120 Kio du chunk recharts) sont le build de `eff44c5`, non rejoué. | Estimation + build initial |
| Mobile utilisable en connexion faible ? | **D'après le code, partiellement.** Coupure franche : lecture hors ligne sur 5 ressources, écriture hors ligne sur 3 domaines. Connexion lente : le timeout ne relit pas le cache (M1). Aucun essai sur Android ni sur un lien faible réel. | Code |
| Dégradation avec le nombre d'élèves et d'établissements ? | **Oui sur le banc local** : à 20 écoles, la requête présences non filtrée lit 20× plus de lignes (environ 95 % du volume en moins sur la variante filtrée). Le facteur de temps SQL (environ 11× puis environ 9× au rejeu) dépend de la machine. Ce n'est pas un temps d'affichage déjà mesuré. | Banc PostgreSQL local uniquement |

---

## 9. Recommandations priorisées (sans implémentation — chaque lot exige un mandat dédié)

Classées par rapport gain / risque. Aucune ne modifie le RBAC ni le schéma, sauf mention contraire explicite.

| Priorité | Recommandation | Constat traité | Remarque de gouvernance |
|---|---|---|---|
| R1 | Filtrer par établissement **en SQL** les projections pédagogie et finance (`WHERE school_id = $1`, + plage de dates pour les présences), comme le font déjà `/students`, `/teachers`, `/finance/student-fees`. | B1, B2, B4 | Change le chemin de lecture : à couvrir par les tests de périmètre tenant existants. |
| R2 | Remplacer le polling des 6 listes par un endpoint d'**agrégats KPI** côté serveur (comptes, taux de présence du jour, encaissements), ou au minimum allonger l'intervalle et le couper en arrière-plan. | W1 | Le calcul côté serveur doit reproduire exactement la vérité métier actuelle. |
| R3 | Paginer / borner par défaut les listes volumineuses (présences par date ou période, paiements par période). | B6, §2.2 | Contrat API : versionner ou garder la compatibilité. |
| R4 | Activer la compression des réponses (middleware Express ou vérification Render), après mesure H1. | B7 | Changement d'infrastructure : autorisation requise. |
| R5 | Empêcher le chargement de `vendor-recharts` sur `/connexion` (la règle actuelle n'y place pas `clsx` explicitement, cf. W3) et charger `pdf-lib` à la demande dans `ClassesListPage`. Re-mesurer le build avant de chiffrer un gain. | W3, W4 | Aucun impact métier. |
| R6 | Web : timeout + annulation des requêtes ; fusion **progressive** par domaine en production (comme en Démo). | W2 | — |
| R7 | Mobile : traiter `TIMEOUT` / `BACKEND_UNREACHABLE` comme éligibles au repli L1 ; afficher le cache **puis** rafraîchir (stale-while-revalidate). | M1 | Respecter les règles de fraîcheur affichée (« données du … »). |
| R8 | Mobile : dédupliquer les loaders et ajouter une durée de fraîcheur avant refetch au focus. | §5.2 | — |
| R9 | Rendre le cache dataset backend local à l'établissement concerné, ou supprimer sa dépendance sur les chemins chauds ; dédupliquer les rechargements concurrents. | B5 | Nouvelle architecture de cache : **interdite dans PERF-01**, mandat dédié requis. |
| R10 | Élargir la lecture hors ligne L1 aux présences et notes récentes (période bornée). | §5.4 | Données personnelles : revue sécurité/RGPD. |

---

## 10. Annexes

### 10.1 Reproduire le banc PostgreSQL

Données **synthétiques uniquement**, sur une instance PostgreSQL 16 locale jetable. Ne jamais exécuter sur une base partagée.

```bash
createdb perf
```

```bash
psql -d perf -f backend/db/schema.sql
```

```bash
psql -d perf -f backend/db/migrations/20260813_pedagogy_canonical.sql
```

```bash
psql -d perf -f docs/audits/perf-01/seed.sql
```

```bash
psql -d perf -c "select perf_seed_school(i) from generate_series(1,20) i"
```

```bash
psql -d perf -c "INSERT INTO school_courses (school_id,class_id,subject_id,course_code,coefficient) SELECT c.school_id,c.id,s.id,c.class_code||'-'||s.subject_code,2 FROM classes c JOIN subjects s ON s.school_id=c.school_id ON CONFLICT DO NOTHING;"
```

```bash
psql -d perf -c "VACUUM ANALYZE;"
```

`VACUUM` doit rester dans sa propre invocation : un seul `psql -c` qui enchaîne l'`INSERT` et `VACUUM` échoue avec `VACUUM cannot run inside a transaction block`.

```bash
PERF_PG_SOCKET_DIR=/var/run/postgresql PERF_PG_PORT=5432 docs/audits/perf-01/bench.sh S=20
```

Le script suppose le port `55432` s'il n'est pas fourni. Un cluster PostgreSQL Ubuntu écoute par défaut sur `5432` : passer `PERF_PG_PORT` est alors nécessaire.

Fichiers : `seed.sql` (générateur), `q_att.sql`, `q_grd.sql`, `q_pay.sql` (requêtes copiées de `pedagogyPgStore.listProjection()`, présences lignes 1276-1284, et du `SELECT` paiements `financePgStore.js:867-872` au `ea1250e` ; le texte SQL de ces trois requêtes est celui de `eff44c5`), `bench.sh` (mesure).

### 10.2 Reproduire la mesure du bundle

```bash
cd web && npm ci && VITE_API_URL=https://api.example.invalid npx vite build --outDir /tmp/perf-dist
```

Puis gzip niveau 9 de chaque fichier de `/tmp/perf-dist/assets` ; le chargement initial correspond aux scripts et CSS référencés par `index.html`.

### 10.3 Données brutes du banc

```text
S=1    att  platform rows=60000     json=   27.5MiB  sql_ms=79.849
S=1    att  school   rows=60000     json=   27.5MiB  sql_ms=78.967
S=1    grd  platform rows=12000     json=   13.2MiB  sql_ms=104.767
S=1    grd  school   rows=12000     json=   13.2MiB  sql_ms=105.8
S=1    pay  platform rows=1500      json=    0.7MiB  sql_ms=1.588
S=1    pay  school   rows=1500      json=    0.7MiB  sql_ms=1.553
S=5    att  platform rows=300000    json=  137.2MiB  sql_ms=219.832
S=5    att  school   rows=60000     json=   27.5MiB  sql_ms=73.818
S=5    grd  platform rows=60000     json=   66.1MiB  sql_ms=764.3
S=5    grd  school   rows=12000     json=   13.2MiB  sql_ms=122.321
S=5    pay  platform rows=7500      json=    3.4MiB  sql_ms=8.878
S=5    pay  school   rows=1500      json=    0.7MiB  sql_ms=2.054
S=20   att  platform rows=1200000   json=  549.4MiB  sql_ms=944.726
S=20   att  school   rows=60000     json=   27.5MiB  sql_ms=85.593
S=20   grd  platform rows=240000    json=  265.0MiB  sql_ms=1563.926
S=20   grd  school   rows=12000     json=   13.2MiB  sql_ms=116.77
S=20   pay  platform rows=30000     json=   13.7MiB  sql_ms=40.707
S=20   pay  school   rows=1500      json=    0.7MiB  sql_ms=4.28
```

« json » = somme des `row_to_json()` des lignes SQL (volume transféré de PostgreSQL vers Node, avant mapping), pas la réponse HTTP finale.

Ces lignes sont le **premier banc** (machine de l'audit initial). Le rejeu S=20 est au §11.4. Les séries S=1 et S=5 n'ont pas été rejouées.

---

## 11. Complément de clôture — relecture sur `develop` @ `ea1250e5948f`

Complément documentaire du 4 novembre 2026. Aucun code produit, aucun schéma, aucun RBAC, aucun cache, aucun service Render. La PR reste **DRAFT / HOLD**. Aucun merge.

### 11.1 Branche et écart des 21 commits

| Élément | Valeur |
|---|---|
| Branche | `docs/perf-01-audit` |
| HEAD contrôlé par le diff CTO indépendant | `778b68967088b4047f0880b628b0cd5aa351e63f` |
| Merge-base de ce HEAD avec `develop` | `eff44c5dbe2a38da245ee377e29ffd81f8c1696d` |
| Écart à ce moment | 1 commit d'avance, 21 de retard |
| `develop` relu | `ea1250e5948f0a9c2b207f2d2601a46bf1269125` |
| Opération | rebase du commit d'audit sur ce `develop`, puis ce complément |

Les 21 commits (`eff44c5dbe2a..ea1250e5948f`) portent sur les bulletins (catalogue, périmètre classe, PDF, publication, hiérarchie de matières), la finance (verrou d'encaissement, libellés, recherche d'impayés), l'intégrité élèves, l'accélération de la CI et des tests RBAC. Aucun ne filtre `pedagogyPgStore.listProjection()` ni le `SELECT` des paiements de `financePgStore.listProjection()` par `school_id`.

### 11.2 Les constats tiennent-ils encore ?

Oui pour les six points prioritaires. Le code des chemins chauds a été relu sur `ea1250e5948f`.

| Constat | Fichiers critiques | Après les 21 commits |
|---|---|---|
| B1 / B2 présences et notes | `backend/db/pedagogyPgStore.js` | Fichier identique. Cinq requêtes sans `WHERE school_id`. |
| B1 paiements | `backend/db/financePgStore.js` | `listProjection()` toujours sans filtre établissement. Le `SELECT` paiements est inchangé. Les obligations du même appel ont une sous-requête `EXISTS` en plus, toujours non filtrée. |
| W1 polling 10 s | `dashboardSync.ts`, `OverviewPage.tsx:146`, `SchoolRecentActivities.tsx:76`, `internalNotificationsRead.ts:46` | Inchangés. Intervalle toujours 10 000 ms. |
| W2 attente du plus lent | `web/src/api/client.ts:97`, `domainLoaders.ts` | `fetch` toujours sans `AbortController`. `Promise.allSettled` déplacé de la ligne 189 à la ligne 202 (garde-fou bulletins sur `academicConfigs`, qui ne retire pas présences ni paiements). |
| M1 timeout sans repli cache | `readModel.ts:51-58` et `:180`, `httpClient.ts:39`, `outbox.ts:10` | Inchangés. `TIMEOUT` n'est toujours pas un repli SQLite. |
| W3 bundle recharts | `web/vite.config.ts` | Fichier identique. Tailles non re-mesurées (§2.3). |

Décalages de lignes, comportement inchangé : `loadCanonicalPedagogyForPrincipal` 5429 → 5468, `loadCanonicalFinanceForPrincipal` 5443 → 5482, `getAuthoritativeBackOfficeState` 5455 → 5494, `sendList` 7722 → 7761, `getDataset` 2058 → 2065, `financePgStore.listProjection` 843 → 865. Le pool reste 5 / plafond 6 (`connectionConfig.js:13-15`). Les index cités (`schema.sql:1035-1074`, `schema.sql:1052`) sont aux mêmes lignes. `cachedDataset = null` reste cité 40 fois. `getAuthoritativeBackOfficeState` reste à 37 appels. Les loaders mobile `getNotes` / `getPresences` / `getPayments` restent aux lignes 388, 503 et 955, sans `page` ni `limit`.

Hors chemin chaud : `routeDomainMap.ts` ajoute `/parametres/bulletins-catalogue` avec une liste de domaines vide (la page charge ses propres données). La route `/bulletins` charge toujours `notes`. `FinanceUnpaidPage.tsx:199` teste toujours `navigator.onLine`.

### 11.3 Limites confirmées — Render, Android, réseau faible

| Mesure | État à la clôture |
|---|---|
| Latence Render (préprod ou prod), compression de sortie, plan, région, cold start | **Non mesurée.** Pas d'appel à `api.somafrik.app` ni `api-preprod.somafrik.app`. |
| Téléphone Android, émulateur, temps d'ouverture, rendu | **Non mesuré.** |
| Connexion faible réelle (3G, perte partielle, timeout sur appareil) | **Non mesurée.** M1 est une lecture du code. |
| Temps d'affichage Web | **Non mesuré.** |
| Durées 3G / 4G du §2.2 et les 8 Gio/h du §4.2 | **Quotients arithmétiques**, pas des transferts observés. |

### 11.4 Rejeu du banc — base PostgreSQL 16 locale jetable

Recette du §10.1, sur le schéma documenté uniquement (`schema.sql` + `20260813_pedagogy_canonical.sql`), pas sur la chaîne complète des migrations de `develop`. PostgreSQL 16.15. Base `perf`, données synthétiques, 20 établissements. `VACUUM ANALYZE` lancé seul (la forme combinée avec l'`INSERT` échoue, cf. §10.1). Port 5432.

Les migrations bulletin / finance des 21 commits n'ont pas été appliquées. Les trois requêtes copiées ne lisent aucune colonne ajoutée par ces migrations. Le trigger `trg_payments_collection_covered` ne s'active que si `somafrik.enforce_collection_cover = on` ; le seed ne pose pas ce paramètre.

Résultats S=20 (médiane de 3 `EXPLAIN ANALYZE`, puis volume `row_to_json`) :

```text
S=20   att  platform rows=1200000   json=  549.7MiB  sql_ms=664.353
S=20   att  school   rows=60000     json=   27.5MiB  sql_ms=71.116
S=20   grd  platform rows=240000    json=  265.1MiB  sql_ms=459.545
S=20   grd  school   rows=12000     json=   13.2MiB  sql_ms=32.262
S=20   pay  platform rows=30000     json=   13.8MiB  sql_ms=27.323
S=20   pay  school   rows=1500      json=    0.7MiB  sql_ms=2.476
```

| Grandeur | Premier banc | Rejeu | Lecture |
|---|---:|---:|---|
| Lignes présences, non filtré / filtré | 1 200 000 / 60 000 | 1 200 000 / 60 000 | Reproduit. Écart 20×, soit 95 % de lignes en moins sur la variante filtrée. |
| Volume JSON présences | 549,4 Mio / 27,5 Mio | 549,7 Mio / 27,5 Mio | Même ordre. L'écart de 0,3 Mio vient du texte aléatoire (`present` / `absent`, notes tirées au sort), pas d'un changement de requête. |
| Médiane SQL présences | 945 ms / 86 ms (≈ 11×) | 664 ms / 71 ms (≈ 9×) | Direction reproduite. Les millisecondes ne le sont pas : elles dépendent de la machine. |
| Notes, lignes | 240 000 / 12 000 | 240 000 / 12 000 | Reproduit. |
| Paiements, lignes | 30 000 / 1 500 | 30 000 / 1 500 | Reproduit. |

S=1 et S=5 n'ont pas été re-semés. Les chiffres du §2.1 et du §10.3 pour ces tailles restent ceux du premier banc.

### 11.5 Décision

PR **#1061** maintenue **DRAFT / HOLD**. Ce complément prépare un re-diff CTO. Il ne lance pas PERF-PR1 et ne modifie pas le produit.
