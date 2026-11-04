# PERF-PR3 — Pagination canonique des listes volumineuses

Statut : **DRAFT / HOLD** — pas de Ready ni de merge sans diff CTO indépendant.
Base : `develop` @ `33cd4f23a` (PERF-PR1 #1062 et PERF-PR2 #1063 présents).

## 1. Inventaire des routes

Parcours vérifié au HEAD de `develop`, PostgreSQL → Repository → Route → Client → Écran.

| Route | Lecture PostgreSQL | Découpage | Ordre |
|---|---|---|---|
| `GET /api/presences` | `listPedagogyProjection({ schoolId })` : 5 requêtes complètes de l'école (évaluations, notes, présences, cours, créneaux), tout l'historique | filtres JS (élèves visibles, `className`, `date`) | `attendance_date DESC`, **sans départage** |
| `GET /api/payments` | `listFinanceProjection({ schoolId })` : 9 requêtes complètes de l'école | `?page=` existe mais via `PaginationService` : **découpage JavaScript après lecture complète** | `created_at` |
| `GET /api/notes` | `listPedagogyProjection({ schoolId })` (mêmes 5 requêtes) | filtres JS par élève visible | `updated_at DESC`, sans départage |

PERF-PR1 a borné ces lectures à l'établissement. Elles transfèrent encore **tout l'historique** de l'école à chaque appel.

## 2. Consommateurs Web et Mobile

| Route historique | Web | Mobile | Usage |
|---|---|---|---|
| `GET /api/presences` | `domainLoaders.presences` → `DataContext.state.presences`, lu par `PresencesPage`, `ParentDashboardPage`, graphiques et indicateurs Démo (`dashboardCharts`, `dashboardChartPeriod`, `establishment`, `schoolDashboardSecondaryMetrics`) | `getPresences` → `AdminDataContext.loadPresences` (Accueil, Classes, Appel enseignant, Présences élève) | Liste et agrégats côté client |
| `GET /api/payments` | `financeApi.listPayments` → `state.payments` : Finance, impayés (`unpaidModule`), ventilations (`paymentAmountBreakdown`), Parent | `getPayments` → `loadPayments` (Paiements, Impayés, Accueil) | Liste **et totaux côté client** |
| `GET /api/notes` | `domainLoaders.notes` → `state.notes` : Notes & évaluations (`evaluations.ts`), Parent, graphiques | `getNotes` → `loadNotes` (Notes enseignant, statistiques de classe) | Liste **et moyennes côté client** |

Le registre d'appel (élèves attendus) ne vient pas des présences : `classStudentsApi.list(classCode)` sur le Web, roster de classe sur Mobile. Un élève sans présence enregistrée reste donc dans l'appel.

## 3. Contrats avant / après

Les routes historiques sont **inchangées** (tableaux complets) : Mobile et écrans non migrés continuent de fonctionner. Ajouts explicites :

| Nouvelle route | Clé RBAC (identique) | Filtres | Tri (keyset) |
|---|---|---|---|
| `GET /api/v2/presences` | `GET /api/presences` | `date`, ou `from` + `to` ; `classId` ; `studentId` (UUID ou matricule) ; `status` (`Présent`, `Absent`, `Retard`, `Justifié`) ; `attendanceId` | `-date` (défaut) / `date` → `(attendance_date, id)` |
| `GET /api/v2/notes` | `GET /api/notes` | `classId`, `subjectId`, `termId`, `evaluationId`, `studentId` | `-updatedAt` / `updatedAt` → `(updated_at, id)` |
| `GET /api/v2/payments` | `GET /api/payments` (vérification finance live stricte) | `date` ou `from` + `to` (date de paiement, sinon date d'enregistrement) ; `studentId` ; `q` (nom, matricule, référence, littéral) | `-createdAt` / `createdAt` → `(created_at, id)` |

Réponse, sur la convention existante du fil d'activité (`{ items, nextCursor }`) :

```json
{ "items": [], "nextCursor": null, "hasMore": false }
```

Les `items` reprennent **exactement** le DTO des routes historiques (vérifié ligne à ligne en PostgreSQL, §8). `limit` : 50 par défaut, 200 au plus ; 0, négatif, non entier ou > 200 → `400`. Pas de total : son coût (`COUNT(*)` sur l'historique) n'est pas justifié par les écrans migrés.

## 4. Choix de pagination

- **Keyset**, pas d'`OFFSET` : coût constant quelle que soit la profondeur, pas de saut ni de doublon si des lignes sont écrites entre deux pages.
- Départage par `id` (UUID) : ordre total et stable.
- Curseur opaque `base64url({ v, k, id, f })`. `f` est l'empreinte (SHA-256 tronqué) de l'établissement, du tri et des filtres normalisés : un curseur rejoué avec d'autres filtres ou dans une autre école est refusé (`400`). Le curseur ne contient que la clé et l'identifiant d'une ligne déjà servie à l'appelant.

## 5. Filtrage SQL

Tout est dans PostgreSQL : `WHERE <alias>.school_id = $1::uuid`, filtres paramétrés, `ORDER BY clé, id`, `LIMIT limit + 1` (détection de la page suivante). Aucune valeur client n'est concaténée. Établissement résolu par `resolvePedagogyProjectionScope` / `resolveFinanceProjectionScope` (PERF-PR1, membership), jamais depuis un paramètre.

Sécurité :

| Règle | Mise en œuvre |
|---|---|
| Authentification, RBAC effectif | `requireAuth` + `requirePermission` avec la **même clé** que la route historique (droits relus en base ; finance par la primitive live stricte) |
| Superadmin et Admin Pays | refusés par la garde plateforme (`SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`), avant la route |
| Isolation établissement | `school_id = $1` en SQL ; jointures élève / classe bornées à la même école |
| Enseignant | classes des affectations **actives relues en base** (`teacher_assignments`, `class_head_teachers`), comme les KPI PERF-PR2 ; aucune affectation → page vide sans requête de liste. Plus strict que la route historique, qui lit les classes figées dans le JWT |
| Parent / Élève | `403 PAGINATION_STAFF_ONLY` : ils gardent la route historique (périmètre d'un enfant) |
| Contexte scolaire perdu | `403 PAGINATION_SCHOOL_REQUIRED`, aucune lecture |
| Erreur PostgreSQL | propagée (`500`), aucune projection de repli |

La matrice RBAC MONO-T1 régénérée donne, pour les 3 nouvelles routes, **les mêmes cellules** que les routes historiques sur les 6 comptes. Aucune cellule existante ne change. La matrice mesure la porte RBAC : le refus Parent a lieu ensuite, dans le gestionnaire.

## 6. Préservation des agrégats

- Aucun total, solde, taux ou moyenne n'est calculé à partir d'une page.
- Les écrans **Finance** et **Notes** du Web, ainsi que le Mobile, continuent de lire les routes historiques : leurs totaux, impayés et moyennes restent calculés sur le périmètre complet autorisé.
- Le moteur de bulletins n'est pas modifié.
- Les KPI du tableau de bord restent ceux de PERF-PR2, agrégés en SQL.

## 7. Compatibilité et migration

| Écran | Avant | Après |
|---|---|---|
| Web — Présences (personnel) | `GET /api/presences` : tout l'historique de l'école, amorcé par la route | `GET /api/v2/presences?date=<jour>&limit=200`, page après page ; le domaine `presences` n'est plus amorcé sur `/presences` pour le personnel |
| Web — Présences (Parent / Élève) | historique | inchangé |
| Web — lien de notification vers une présence d'un autre jour | recherche dans l'historique | une seule ligne : `GET /api/v2/presences?attendanceId=…&limit=1` |
| Web — après enregistrement d'un appel | `refresh(["presences"])` (historique complet) | relecture du jour + `invalidateDomains(["presences"])` : un autre écran relira la liste globale à son ouverture |
| Web — Finance, Notes, tableaux de bord Démo | historique | **inchangé** (agrégats côté client, §10) |
| Mobile | historique | **inchangé** (contrats identiques) |

Le registre d'appel reste complet : les élèves viennent du roster de classe. Les présences du jour ne servent qu'à pré-remplir les statuts, le statut Présent restant le défaut de saisie.

## 8. Tests

| Fichier | Couverture |
|---|---|
| `backend/lib/paginatedSchoolReads.test.js` (11) | limit (défaut, max, invalide, excessive), dates, curseur altéré / d'un autre filtre, Parent et Élève refusés, Superadmin et Admin Pays refusés par la garde, établissement absent, enseignant sans affectation sans requête, paramètres = emplacements SQL, keyset en SQL, erreur PostgreSQL sans repli, filtres inconnus |
| `backend/lib/paginatedSchoolReads.pg.test.js` | 2 établissements, historique sur 3 années, égalités de date : toutes les pages = toute la base, sans doublon, ordre `(date, id)` identique à PostgreSQL ; pages intermédiaires, dernière page, page vide, tri croissant ; écriture entre deux pages ; curseur rejoué avec d'autres filtres ou dans une autre école refusé ; école B isolée ; enseignant limité à sa classe, enseignant sans affectation vide ; filtres jour, classe, élève, statut, identifiant, période ; **DTO identiques** à la projection historique pour présences, notes et paiements ; recherche paiements par matricule, `%` non joker |
| `backend/lib/paginatedSchoolReads.http.pg.test.js` | serveur réel, JWT figé : pagination HTTP sans doublon, registre du jour complet, routes historiques toujours en tableau, 7 paramètres invalides → 400, aucun droit en base → 403, retrait live de `Paiements:READ` puis de `Présences:READ` → 403 |
| `web/src/lib/presencesPageApi.test.ts` (11) | chargement initial, pages suivantes sans doublon, journée vide, réponse non paginée refusée, borne de pages, lien profond, rafraîchissement, erreur réseau sans perte des lignes, parent sans requête, changement de jour |
| `web/src/pages/PresencesPage*.test.tsx` | même vérités métier (6 élèves, badge 83 %, lien profond), désormais servies par `/v2/presences` |
| `web/src/lib/routeDomainMap.usersSchoolCode.test.ts` | le personnel n'amorce plus l'historique sur `/presences` ; un parent le garde |

## 9. Benchmarks

Mesures **locales** : PostgreSQL 16, même machine, données synthétiques (`perf_seed_school`), 10 établissements, **1 008 000 présences**, 110 400 notes, 13 800 paiements. Temps = médiane de 3 exécutions, en processus (SQL + mapping + sérialisation, sans HTTP ni réseau). Ce ne sont pas des mesures Render.

| Cas | Lignes SQL | Requêtes | SQL | Gestionnaire | JSON (gzip) | Tas Node |
|---|---:|---:|---:|---:|---:|---:|
| **Présences, école 500 élèves, 3 ans** — avant (route historique) | 282 240 | 5 | 2 549 ms | 4 756 ms | 99,1 Mio (8,0 Mio) | 250 Mio |
| après : appel du jour complet (3 pages de 200) | 502 | 3 | 25 ms | 30 ms | 190 Kio (15 Kio) | 2 Mio |
| après : 1ʳᵉ page d'historique (50) | 51 | 1 | 123 ms | 124 ms | 19 Kio (2 Kio) | 0 Mio |
| **Présences, école de 100 élèves** — avant | 20 640 | 5 | 372 ms | 411 ms | 6,6 Mio (544 Kio) | 36 Mio |
| après : appel du jour complet | 100 | 1 | 6 ms | 8 ms | 38 Kio (3 Kio) | 0 Mio |
| **Notes, école 500 élèves** — avant | 282 240 | 5 | 2 552 ms | 2 667 ms | 6,5 Mio (479 Kio) | 302 Mio |
| après : 1ʳᵉ page (50) | 51 | 1 | 60 ms | 61 ms | 28 Kio (3 Kio) | 0 Mio |
| **Paiements, école 500 élèves** — avant | 3 000 | 9 | 57 ms | 45 ms | 1,4 Mio (93 Kio) | 11 Mio |
| après : 1ʳᵉ page (50) | 101 | 3 | 14 ms | 15 ms | 48 Kio (4 Kio) | 1 Mio |

Connexion lente, **estimation** à 1 Mbit/s sur la taille gzip, latence non comptée : présences de l'école 500 élèves ≈ 67 s avant, ≈ 0,1 s après pour l'appel du jour.

Plan de la requête du jour (`EXPLAIN ANALYZE`, école 500 élèves, 1 008 000 lignes en base) : `Index Scan`, 13,7 ms. Aucun nouvel index n'est ajouté. La 1ʳᵉ page d'historique sans filtre de date (123 ms) gagnerait à un index `attendance (school_id, attendance_date DESC, id DESC)`. Sa création sur une table volumineuse en production doit être planifiée à part (verrou d'écriture sans `CONCURRENTLY`). Non fait ici.

Non mesuré : temps d'affichage navigateur et mémoire sur Render (pas d'accès à ces environnements depuis la session de travail).

## 10. Risques résiduels

- Les écrans Web Finance et Notes, et le Mobile, transfèrent encore tout l'historique de l'école à l'ouverture.
- L'enseignant voit sur `/api/v2/*` les classes de ses affectations en base. La route historique utilise les classes du JWT : un enseignant dont l'affectation a changé depuis sa connexion peut voir une liste différente entre les deux routes.
- Les tableaux de bord Démo qui lisent `state.presences` le chargent depuis leur propre route. Après un appel enregistré, le domaine est invalidé et relu à leur ouverture.
- Le jour courant est celui du poste (comme avant), pas le fuseau de l'établissement.

## 11. Impacts reportés

- Migrer l'écran Finance du Web vers `/api/v2/payments`, avec des totaux, impayés et soldes servis par des agrégats SQL et non par la page.
- Migrer Notes & évaluations vers `/api/v2/notes`, avec des moyennes calculées côté serveur sur le périmètre complet, sans toucher au moteur de bulletins.
- Mobile : contrats paginés pour Présences, Paiements, Notes, avec adaptation du cache L1 (hors périmètre ici).
- Index `attendance (school_id, attendance_date DESC, id DESC)` si l'historique sans filtre de date devient un usage courant.
- PERF-PR4 (client HTTP, timeouts) non commencé.
