# PERF-PR1 — Projections PostgreSQL limitées à l'établissement

Statut : **DRAFT / HOLD — pas ready — pas de merge.**

Base : `develop` `ed65c6460e7adc4880a72dc7308a84b10232b465` (inclut #1061, fusionnée).
Branche : `perf/pr1-school-scoped-projections`.
Aucune migration. Aucun déploiement. `main` non modifié. PERF-PR2 non commencé.

## 1. Cause

`pedagogyPgStore.listProjection()` et `financePgStore.listProjection()` lisaient toutes les lignes de la plateforme (5 requêtes pédagogiques, 9 requêtes financières), puis Node filtrait. Le volume croît avec le nombre d'établissements. Le banc PERF-01 l'avait déjà mesuré en local : à 20 écoles synthétiques, la requête de présences non filtrée renvoie 1 200 000 lignes / 549,7 Mio.

## 2. Fichiers

- `backend/db/projectionSchoolScope.js` — prédicat paramétré, fail-closed.
- `backend/lib/projectionReadScope.js` — périmètre issu du membership présences ou finance déjà validé.
- `backend/db/pedagogyPgStore.js`, `backend/db/financePgStore.js` — `listProjection(scope)` obligatoire.
- `backend/db/postgresRepository.js` — transmet le scope.
- `backend/db/fallbackRepository.js` — le moteur mémoire filtre après coup, ou renvoie des tableaux vides sans scope. Pas de lecture globale par défaut.
- `backend/server.js` — chargeurs canoniques des routes scolaires, et `GET /api/courses` lorsqu'un établissement ou un pays est résolu.
- Tests : `backend/lib/projectionSchoolScope.test.js`, `backend/lib/perfPr1SchoolScope.pg.test.js`, appel `{ platform: true }` dans `backend/lib/pedagogyRepository.pg.test.js`.

Web, Mobile, RBAC, abonnements, cache, carte élève, bulletins, Render : non modifiés.

## 3. Corrections

Le scope accepté par SQL est l'un des trois suivants.

- `{ schoolId }` : UUID vérifié, `WHERE <alias>.school_id = $1::uuid`.
- `{ countryCode }` : deux lettres, `EXISTS` paramétré sur `schools` / `countries`.
- `{ platform: true }` : SQL inchangé. Jamais implicite.

Sans scope, UUID invalide ou pays invalide : aucune requête, erreur 403 `PROJECTION_SCHOOL_REQUIRED`, `PROJECTION_SCHOOL_INVALID` ou `PROJECTION_SCOPE_INVALID`. Le prédicat est injecté au `WHERE` / `ORDER BY` de premier niveau, pour ne pas entrer dans la sous-requête de coefficient des notes.

Tables filtrées par leur `school_id` : `evaluations`, `grades`, `attendance`, `school_courses`, `course_schedule_weekly_slots`, `payments`, `payment_statuses`, `fee_grids`, `school_fee_items`, `student_fee_obligations`, `fee_tariff_history`, `payment_reminders`, `payment_items`, `payment_allocations`. Les items et allocations ont un `school_id`. Le `EXISTS` des obligations conserve `e.school_id = o.school_id` et reçoit en plus le filtre externe.

L'identifiant ne vient pas d'un paramètre client.

- Pédagogie : `attachPresenceMembershipScope` (`users.school_id` → `schools.id`). En mémoire, le `login_code` du fixture, pas un UUID forgé sur le principal.
- Finance : `login_code` émis par `attachFinanceMembershipScope`, puis `SELECT id FROM schools WHERE upper(btrim(login_code)) = $1`. Un `schoolId` présent sur le principal est ignoré.
- Superadmin finance : `resolveFinanceSchoolScope` reste `none`. Aucune projection, pas de `{ platform: true }`.
- Superadmin présences / notes / cours, sans request-scope : mode présence `all` déjà en place. La projection plateforme est alors explicite. Ce n'est pas un nouvel accès finance.
- Admin Pays sans request-scope : filtre pays, pas la plateforme entière.
- Établissement absent, session sans membership, école inconnue : tableaux vides ou 403. Pas de repli global.

`GET /api/presences`, `GET /api/notes`, `GET /api/payments`, `GET /api/students/:id/presences|notes|payments` passent par ces chargeurs, puis par les filtres de rôle déjà en place (`filterPresenceRows`, `filterNotesForPrincipal`, `filterRows`). `GET /api/course-schedules` était déjà scopé par `listCourseSchedules`. `GET /api/courses` charge la projection scopée puis `filterRows`, sauf le mode plateforme explicite.

## 4. Règles conservées

Champs, tris, coefficients de cours, statuts de présence, notes, périodes, allocations, soldes et identifiants publics des lignes autorisées. Les permissions ne sont pas recalculées ici : elles s'appliquent après la lecture SQL de l'établissement. Parent et enseignant ne reçoivent pas l'autre école ; le filtre élève / classe reste celui d'aujourd'hui.

`getAuthoritativeBackOfficeState()` n'est pas réécrit. Ses surcouches appellent explicitement `{ platform: true }`. Beaucoup de routes (tableau de bord, bulletin PDF, etc.) chargent donc encore toute la plateforme. Chantier séparé, hors PERF-PR1.

Écart assumé, hors contrat de `GET /api/payments` (la route ne renvoie que les paiements) : une projection financière scopée omet les `payment_statuses` dont `school_id` est NULL. La lecture `{ platform: true }` les conserve.

## 5. Tests

Exécutés sur cette VM, le 4 novembre 2026 (heure de Paris, UTC+1).

- `node --test backend/lib/projectionSchoolScope.test.js` — 7/7. Prédicat, sous-requête des notes, fail-closed, erreur SQL sans seconde lecture globale, filtre mémoire, school_id forgé ignoré, rôles (admin, enseignant, parent, superadmin finance vide, superadmin pédagogie plateforme, admin pays), gardes de routes.
- `backend/lib/perfPr1SchoolScope.pg.test.js` — OK. PostgreSQL 16 local, base jetable. Écoles A et B, élèves, enseignants, présences, notes, cours, créneaux, paiements, items, allocations, obligations, rappels, grilles. A ne contient pas B, B ne contient pas A. Parité `deepEqual` avec la lecture plateforme filtrée sur les mêmes objets (notes, présences, évaluations, cours, créneaux, paiements, obligations, grilles, rappels). Coefficient de cours 3, coefficient d'évaluation 2, présence Présent / Absent, allocation 40, solde 60. École vide et UUID inconnu : tableaux vides. Scope manquant ou code école à la place d'un UUID : 403, pas de lecture globale. Table `attendance` supprimée : erreur `42P01` aussi sur `{ platform: true }`.
- `backend/lib/pedagogyRepository.pg.test.js` — OK, avec `{ platform: true }`.
- `financeRepository.test.js`, `financeUnallocatedMaeva.test.js` — OK (mémoire, `listProjection()` sans scope inchangé sur le store mémoire).
- `node --test` présences GP-015, notes parent, finance superadmin P1-01 — 37/37.
- `node --check` sur les fichiers modifiés.

Non exécutés.

- Lint : le script `lint` du dépôt est celui du Web. Aucun fichier Web modifié.
- TypeScript, build Web, build Mobile : hors périmètre, non lancés.
- Suite backend complète, workflows LOT, audit sécurité GitHub : non lancés localement. L'état Actions est celui du run de la PR après poussée, pas un succès anticipé.
- Session HTTP invalide : non rejouée. `requireAuth` est inchangé et répond 401 avant les chargeurs. Le test de scope couvre le principal absent.
- Banc non rejoué comme requêtes préparées `$1` : le script PERF-01, non modifié, injecte l'UUID en littéral. Le prédicat est le même. Les temps `$1` peuvent différer légèrement. Les volumes de lignes, eux, ne dépendent pas de cette forme.

## 6. Banc local

Base jetable `perf`, détruite après mesure. Schéma `backend/db/schema.sql` plus le schéma pédagogie (la requête de notes référence `school_courses`). Jeu `docs/audits/perf-01/seed.sql`, écoles PERF1…PERFn, 500 élèves, 120 jours. `VACUUM ANALYZE` dans une commande séparée. Script `docs/audits/perf-01/bench.sh` lancé en utilisateur `postgres` (peer auth). PostgreSQL 16, port 5432, socket local. **Ce n'est pas une mesure Render, ni un gain de latence utilisateur.**

« Avant » = SQL sans filtre établissement. « Après » = le même SQL avec `school_id` de PERF1. Médiane : 3 `EXPLAIN (ANALYZE)` du script PERF-01. p95 : 20 exécutions supplémentaires, interpolation linéaire, **uniquement à 20 écoles** (la base a été agrandie sur place ; le p95 à 1 et 5 écoles n'a pas été échantillonné).

| Écoles | Requête | Lignes avant | Lignes après | JSON avant | JSON après | Médiane avant | Médiane après | p95 avant | p95 après |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | présences | 60 000 | 60 000 | 27,5 Mio | 27,5 Mio | 57,603 ms | 63,216 ms | non mesuré | non mesuré |
| 1 | notes | 12 000 | 12 000 | 13,2 Mio | 13,2 Mio | 73,253 ms | 67,723 ms | non mesuré | non mesuré |
| 1 | paiements | 1 500 | 1 500 | 0,7 Mio | 0,7 Mio | 1,091 ms | 1,083 ms | non mesuré | non mesuré |
| 5 | présences | 300 000 | 60 000 | 137,3 Mio | 27,5 Mio | 155,062 ms | 51,999 ms | non mesuré | non mesuré |
| 5 | notes | 60 000 | 12 000 | 66,2 Mio | 13,2 Mio | 143,222 ms | 32,901 ms | non mesuré | non mesuré |
| 5 | paiements | 7 500 | 1 500 | 3,4 Mio | 0,7 Mio | 5,418 ms | 1,558 ms | non mesuré | non mesuré |
| 20 | présences | 1 200 000 | 60 000 | 549,7 Mio | 27,5 Mio | 676,749 ms | 64,863 ms | 676,793 ms | 77,069 ms |
| 20 | notes | 240 000 | 12 000 | 265,1 Mio | 13,2 Mio | 454,420 ms | 32,039 ms | 463,737 ms | 36,235 ms |
| 20 | paiements | 30 000 | 1 500 | 13,8 Mio | 0,7 Mio | 27,974 ms | 2,633 ms | 29,504 ms | 3,697 ms |

À 20 écoles, ces trois requêtes passent de 1 470 000 lignes / 828,6 Mio à 73 500 lignes / 41,4 Mio, soit environ 95 % de volume en moins. À 5 écoles, 367 500 / 206,9 Mio vers 73 500 / 41,4 Mio, soit 80 %. À 1 école, les deux côtés lisent la même école : pas de gain, le filtre ne doit rien retirer. Les temps à 1 école sont du même ordre ; l'écart de quelques millisecondes n'est pas un gain produit.

Requêtes exécutées : le banc compare 3 statements, le même nombre avant et après. Une projection complète reste à 5 + 9 allers-retours. Le gain mesuré est le volume par statement, pas le nombre de statements.

Mémoire Node : non mesurée (le banc ne lit pas `process.memoryUsage`). Proxy mesuré : octets JSON ci-dessus. Mémoire PostgreSQL observée sur le plan présences à 20 écoles : tri externe disque d'environ 50 Mio par worker sans filtre, contre 7,6 Mio avec filtre. Ce n'est pas le RSS du process Node.

Le catalogue `school_courses` du banc est vide. La sous-requête de coefficient tourne, mais son coût sur un catalogue réel n'est pas dans ces temps. Le test d'isolation, lui, a un cours de coefficient 3 et la note projetée le conserve.

## 7. Index

`EXPLAIN (ANALYZE, BUFFERS)` sur la base à 20 écoles, puis base supprimée.

- Présences filtrées : `Bitmap Index Scan` sur l'unique `(school_id, student_id, attendance_date)`, puis tri `attendance_date DESC` avec spill disque. Pas d'index `(school_id, attendance_date)`.
- Notes filtrées : `Bitmap Index Scan` sur `idx_grades_school_id`.
- Paiements filtrés : `Bitmap Index Scan` sur `idx_payments_school_id`.
- Présences non filtrées : `Parallel Seq Scan` sur `attendance`.

Index déjà présents et utiles : `school_id` sur notes, évaluations, paiements, items, obligations, rappels, cours. `student_id` sur notes, présences, paiements. `class_id` via les index de classes / évaluations, pas un index dédié de la projection. `term_id` : la table `terms` du banc (60 lignes) est lue par seq scan. `payment_id` : `idx_payment_items_payment`. `payment_allocations` n'a pas d'index `school_id` dans `schema.sql` ; le banc PERF-01 ne charge pas cette table.

Pas de migration dans cette PR. Un index `(school_id, attendance_date DESC)` éviterait le tri externe de la liste de présences. Intérêt : le temps restant après filtre (médiane locale ~65 ms pour 60 000 lignes), pas les 95 % de volume déjà gagnés par le `WHERE`. Coût : un index de plus sur la table la plus écrite (une ligne par élève et par jour). À proposer dans une PR de migration à part si ce tri devient le goulot, pas ici.

## 8. Risques résiduels

- `getAuthoritativeBackOfficeState()` lit encore toutes les écoles. Toute route qui l'utilise n'est pas couverte par PERF-PR1. C'est le chantier suivant, pas un correctif à glisser ici.
- Le filtre SQL est l'établissement (ou le pays). Le filtre élève, classe et enseignant reste en Node, sur le sous-ensemble déjà limité.
- Superadmin hors finance : lecture plateforme conservée quand le mode présence historique est `all`.
- Statuts de paiement globaux (`school_id` NULL) absents d'une projection scopée.
- Moteur mémoire : le dataset est filtré en processus, pas en SQL.
- Les temps locaux ne se transportent pas vers Render.

## 9. Reporté

- Découper `getAuthoritativeBackOfficeState()` pour que chaque route scolaire ne charge que son établissement.
- Filtre SQL élève / classe, au-delà de l'établissement.
- Index `(school_id, attendance_date)` et, si un plan le justifie, `payment_allocations(school_id)`.
- PERF-PR2, non démarré.
