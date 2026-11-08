# P0-WEB-01 — Délais dépassés sur les permissions et la Scolarité (Web)

Statut : **DRAFT / HOLD**. Branche `fix/p0-web-permissions-timeout`, base `develop` à `7bfe1e464` (PERF-PR1 à PERF-PR5 fusionnés).

## 1. Symptômes

Smoke Web en préproduction, `preprod.somafrik.app`, établissement `CD-2026-0001` :
- **A — Scolarité :** « Impossible de charger la scolarité ». `students`, `teachers`, `classes`, `users`, `assignments`, `relations` et `schools` sont en « délai de réponse dépassé (20 s) ».
- **B — Permissions :** « Permissions indisponibles — Délai de réponse dépassé (20 s) » sur `GET /api/auth/effective-permissions`.

Preuves Chrome Network transmises par le CTO (préproduction, sans limitation de débit) :

| Requête | Total | Queueing | Stalled | Request sent | **Attente serveur (TTFB)** | Téléchargement | Connexion initiale |
|---|---:|---:|---:|---:|---:|---:|---:|
| `students` | 17,93 s | 102 ms | 1,13 ms | 0,24 ms | **17,82 s** | 0,94 ms | — |
| `students`, `teachers`, `classes`, `users`, `assignments`, `relations`, `academic-config` | ≈ 17,8 à 18 s, HTTP 200 | | | | quasi identique | | |
| `CD-2026-0001` (`/backoffice/establishments/CD-2026-0001`) | 19,62 s, annulée | | | | | | |
| `CD-2026-0001` (autre capture) | 20,01 s | | | | | | **19,97 s** |

Ces captures font apparaître **deux phénomènes distincts** :
- une **attente serveur** : TTFB de 17,82 s, téléchargement négligeable ;
- une **attente de connexion** : 19,97 s de connexion initiale.

## 2. Chronologie

| Date | Événement |
|---|---|
| 28/10/2026 | Somafrik-education/Somafrik#1023 (`09ce72712`) : contrôle d'abonnement **à chaque requête scolaire** dans `requireAuth`. Il appelle `assertActiveSchoolRequest(…, getAuthoritativeBackOfficeState)`. |
| 04/11/2026 | PERF-PR1 #1062 : projections scolaires filtrées par établissement. Le chargement plateforme de `getAuthoritativeBackOfficeState` devient explicite (`{ platform: true }`), **sans changement de volume**. Avant, l'appel était déjà sans portée. |
| 04/11/2026 | PERF-PR4 #1065 : délai client de 20 s sur les lectures Web. Une requête de 18 à 30 s **attendait** jusque-là, elle **échoue** désormais de façon visible. |
| 05/11/2026 | Smoke préproduction : symptômes A et B. |

PERF-PR4 **révèle** le problème, il ne le crée pas. Le délai de 20 s n'est pas modifié.

## 3. Environnement et limites de l'enquête

- **Préproduction inaccessible depuis la session de travail :** le proxy refuse `api-preprod.somafrik.app` et `preprod.somafrik.app` (403 sur CONNECT). Les journaux Render, les métriques d'instance et la base de préproduction n'ont **pas** été consultés.
- **Faits :**
  - les durées préproduction ci-dessus sont celles des captures Chrome du CTO ;
  - toutes les autres mesures sont **locales** : vrai `backend/server.js`, PostgreSQL 16 jetable, données synthétiques.

## 4. Reproduction locale

Banc : `backend/scripts/bench-p0-web-01-school-requests.js`.
- Un établissement cible `P0-A` (200 élèves, 20 jours de présences), compte `SCHOOL_ADMIN`, plus N autres établissements plus volumineux.
- La rafale reproduit l'ouverture de « Mon établissement » : `effective-permissions` + `students`, `teachers`, `classes`, `backoffice/users`, `assignments`, `backoffice/relations`, `backoffice/establishments/P0-A`, `…/academic-config`, en parallèle.
- SQL comptée par `pg_stat_statements` ; mémoire du processus lue dans `/proc/<pid>/status` (VmRSS).

```bash
DATABASE_URL=postgres://… OTHER_SCHOOLS=9 STUDENTS=300 DAYS=60 node backend/scripts/bench-p0-web-01-school-requests.js avant
```

## 5. Cause racine prouvée (phénomène 1 — attente serveur)

**Chaque requête authentifiée d'un compte établissement reconstruit tout l'état back-office de la plateforme, uniquement pour vérifier l'abonnement de son école.**

Chemin de chaque requête, avant correction :
1. `requireAuth`.
2. `assertActiveSchoolRequest(principal, path, getAuthoritativeBackOfficeState)`.
3. `getAuthoritativeBackOfficeState()` charge :
   - `getRuntime()` → `repository.getDataset()` : cache, mais sans vol unique (9 reconstructions simultanées à froid) ; il lit **toutes** les présences, notes, paiements et élèves ;
   - `listFinanceProjection({ platform: true })` : tous les paiements, frais et grilles ;
   - `listPedagogyProjection({ platform: true })` : **toutes** les présences, notes, évaluations et cours de **tous** les établissements ;
   - `listPlatformProjection()`, `listClientsProjection()`, `listResidualProjection()`, `listDocumentsExamsProjection()`.
4. `assertSchoolCanConnect` ne lit ensuite **que** `state.schools` et `state.subscriptions`.

`GET /backoffice/establishments/:code` refait ce même chargement complet une deuxième fois dans son gestionnaire, alors que `establishmentService.get` ne lit que `state.schools`.

Conséquences :
- le temps de **chaque** requête, y compris `effective-permissions`, croît avec le volume **de toute la plateforme** et non de l'établissement ;
- des requêtes indépendantes ont des durées **presque identiques**, parce qu'elles font le même travail en parallèle et se disputent la CPU de Node et PostgreSQL. C'est exactement la signature de la préproduction ;
- le TTFB est long et le téléchargement court, parce que la réponse elle-même est petite.

### Matrice de diagnostic (mesures **locales**, 9 autres écoles, 166 000 présences)

| Requête | Durée avant (rafale à froid / à chaud) | Après (froid / chaud) | HTTP | Backend reçu ? | SQL impliqué | Conclusion |
|---|---:|---:|---|---|---|---|
| `/auth/effective-permissions` | 29,4 s / 14,3 s | **83 ms / 25 ms** | 200 | oui | avant : lecture plateforme des présences (1 fois par requête) | contrôle d'abonnement par requête |
| `/auth/effective-permissions`, seule | 1,6 à 1,7 s, 347 requêtes SQL, 180 771 lignes | **8 à 9 ms**, 8 requêtes, 748 lignes | 200 | oui | idem | idem |
| `/students` | 29,4 s / 14,3 s | 106 ms / 42 ms | 200 | oui | idem | idem |
| `/teachers` | 29,4 s / 13,9 s | 92 ms / 37 ms | 200 | oui | idem | idem |
| `/classes` | 29,4 s / 13,9 s | 96 ms / 32 ms | 200 | oui | idem | idem |
| `/backoffice/users` | 29,8 s / 14,2 s | 120 ms / 51 ms | 200 | oui | idem | idem |
| `/assignments` | 29,4 s / 14,3 s | 121 ms / 49 ms | 200 | oui | idem | idem |
| `/backoffice/relations` | 29,8 s / 14,3 s | 127 ms / 56 ms | 200 | oui | idem | idem |
| `/backoffice/establishments/P0-A` (équivalent de `CD-2026-0001`) | 31,2 s / 15,6 s | 86 ms / 36 ms | 200 | oui | **deux** chargements complets (garde + gestionnaire) | garde + gestionnaire |
| `…/academic-config` | 29,9 s / 14,3 s | 130 ms / 54 ms | 200 | oui | idem | idem |
| **Rafale complète (9 requêtes)** | 31,2 s / 15,6 s ; 3 667 requêtes SQL ; 3,36 M lignes ; 75 s de SQL cumulé | **154 ms / 57 ms** ; 133 requêtes SQL ; 8 542 lignes ; 40 ms de SQL | | | | |
| **Mémoire du serveur (pic)** | **1 841 / 1 926 Mio** | **125 / 126 Mio** | | | | |

Requêtes SQL dominantes avant correction, sur une rafale :
- `SELECT a.*, s.login_code … FROM attendance` (projection pédagogie, plateforme) : **10 appels, 1,66 million de lignes**, 27 à 35 s ;
- `SELECT a.*, st.student_code … FROM attendance` (`getDataset` à froid) : **9 appels, 1,49 million de lignes**, 38 s.

**Le volume des autres établissements ne joue plus**, avec correctif :
- 544 000 présences : rafale à 154 ms, pic de 128 Mio ;
- 166 000 présences : rafale à 154 ms, pic de 125 Mio.

Sans correctif, le premier essai au même gros volume a fait tomber le serveur pendant la rafale (« other side closed »). Le second n'a produit aucun résultat dans les 900 s du banc.

**PostgreSQL :** pas de saturation ni de verrou démontré. Le coût vient de **lectures complètes répétées**, inutiles pour la décision, puis de leur transformation en mémoire par Node. Aucun index ni aucune requête SQL n'est modifié.

### Avant le chantier NFC / aujourd'hui (mesures **locales**)

Même banc, mêmes données (9 autres écoles, 544 000 présences, 4 700 élèves), même cluster PostgreSQL 16 jetable. Chaque version tourne avec **son propre** `backend/server.js` et son propre schéma, depuis une copie de travail détachée.

Référence « avant chantier NFC » : `develop@f95c3f38` (05/10/2026), commit sur lequel AUDIT-CARTE-01 a été rejoué, avant CARTE-PR0.

Méthode :
- les versions sans `lib/testAccessSession.js` reçoivent un jeton d'accès simple (`createAccessToken`), qu'elles acceptent sans session liée ;
- l'adresse PostgreSQL porte un mot de passe factice, que les anciennes versions exigent.

| Version | Ouverture à froid | Ouverture à chaud | `effective-permissions` seule | Pic mémoire | SQL à froid (appels / lignes) |
|---|---|---|---|---|---|
| `f95c3f38`, avant chantier NFC | 9,6 s | 5,1 s | 6 ms | 1 279 – 1 457 Mio | 461 / 1,12 M |
| `321c502b`, juste avant #1023 (43 des 46 commits NFC/carte inclus) | 9,5 s | 5,4 s | 7 ms | 1 318 – 1 480 Mio | 470 / 1,12 M |
| `09ce7271`, #1023 | **serveur tombé** : mémoire saturée (`heap out of memory`, SIGABRT) dès la première rafale | — | — | — | — |
| `7bfe1e46`, `develop` actuel | **serveur tombé** : même cause | — | — | — | — |
| `8411d984`, correctif P0-WEB-01 | **157 ms** | **66 ms** | 10 ms | 123 Mio | 133 / 8 542 |

Constats :
- **Le chantier NFC ne crée pas la régression.** Avant le chantier et juste avant #1023, les chiffres sont les mêmes, et aucun commit NFC ne touche `requireAuth`, `assertActiveSchoolRequest`, `schoolSubscriptionAccessService` ni `getAuthoritativeBackOfficeState`.
- **La rupture date de #1023.** Avec ce commit, le contrôle d'abonnement charge tout l'état plateforme à chaque requête, et le serveur sature sa mémoire.
- **Un coût existait déjà avant NFC**, sur la seule fiche `GET /backoffice/establishments/:code` : 9,6 s à froid, 5,1 s à chaud.
  - Cette fiche chargeait déjà tout l'état plateforme.
  - À chaud, ce calcul bloque Node et retarde les autres requêtes de la rafale, d'environ 1,2 s chacune ; `effective-permissions` restait à environ 40 ms.
  - Le correctif traite aussi cette fiche.
- **Aujourd'hui, après correctif**, l'ouverture est environ 60 fois plus rapide qu'avant le chantier NFC, avec une mémoire environ 10 fois plus faible.

## 6. Phénomène 2 — connexion initiale de 19,97 s (non démontré en préproduction)

- Une connexion initiale longue n'est pas un temps de traitement HTTP : c'est le temps d'établir TCP et TLS jusqu'à la terminaison Render.
- **Indice local, non équivalent à une preuve préproduction :** avant correction, une seule rafale d'ouverture fait monter le serveur à **1,8 à 1,9 Gio**, et un volume plus grand le fait tomber.
- **Hypothèse à vérifier dans les journaux Render :** une instance en limite mémoire, redémarrée ou indisponible, laisse les nouvelles connexions attendre son retour. Cela produit une « Initial connection » proche de 20 s, puis une annulation par le délai client.
- **À contrôler dans Render**, aux heures des captures :
  - événements de redémarrage ou d'OOM ;
  - mémoire de l'instance ;
  - nombre d'instances ;
  - éventuel démarrage à froid.
- **À contrôler dans Chrome :** adresse distante, protocole (h2 ou http/1.1), réutilisation de connexion (Connection ID), et comparaison première requête / requêtes suivantes.
- Le correctif réduit la mémoire par rafale de ≈ 1,9 Gio à ≈ 130 Mio localement. Si l'hypothèse se confirme, il en supprime aussi la cause. Ce n'est **pas** démontré sans les métriques de préproduction.

## 7. `unread-count`

Déclencheurs, par page ouverte :
- `internal-notifications/unread-count` : deux composants (Topbar et Vue d'ensemble), chacun avec un intervalle de 30 s ;
- `messages/unread-count` ;
- `announcements/unread-count` ;
- `platform-announcements/unread-count`.

Chaque retour sur l'onglet émet **`focus` et `visibilitychange`** : chaque compteur envoyait donc **deux** requêtes identiques simultanées.

Chacune de ces requêtes passait par `requireAuth`, donc par le chargement complet. Elles amplifiaient la charge, sans en être la cause. Après correction, chaque requête est légère.

Correctif minimal : un compteur ne relance pas d'appel tant que le précédent n'est pas revenu. L'intervalle et les déclencheurs sont inchangés.

## 8. Correctifs

| Fichier | Changement | Justification |
|---|---|---|
| `backend/db/subscriptionAccessSql.js` (nouveau) | SQL partagé des écoles et des abonnements | Mêmes lignes dans l'état complet et dans le contrôle ciblé |
| `backend/db/postgresRepository.js` | `listSubscriptionAccessState()` : écoles (`mapSchool`, même SQL que `getDataset`) et abonnements (même SQL et même transformation que `listPlatformProjection`), lus **en direct** ; `getDataset` utilise le SQL partagé | Contrôle d'abonnement sans projection |
| `backend/db/platformPgStore.js` | `listSubscriptionsWithRows()` ; `listProjection` utilise le SQL partagé | idem |
| `backend/db/fallbackRepository.js` | `listSubscriptionAccessState()` (dépôt mémoire) | Contrat du dépôt |
| `backend/db/repositoryContract.js` | Ajout de `listSubscriptionAccessState` | idem |
| `backend/server.js` | `getSubscriptionAccessState()`, utilisé par `requireAuth` (garde par requête), le renouvellement de jeton et `GET /backoffice/establishments/:code` | Les trois sites ne lisent que les écoles et abonnements |
| `web/src/lib/internalNotificationsRead.ts`, `messagesRead.ts`, `announcementsRead.ts` | Un seul appel en vol par compteur | Doublon `focus` + `visibilitychange` |
| `backend/lib/subscriptionAccessState.http.pg.test.js`, `web/src/lib/unreadCount.p0Web01.test.tsx` (nouveaux) | Tests de non-régression | — |
| `backend/scripts/bench-p0-web-01-school-requests.js` (nouveau) | Banc reproductible | — |

Préservé :
- le contrôle d'abonnement reste **à chaque requête** et **en direct**. Il est même plus strict, car les écoles sont lues en direct au lieu du cache `getDataset` : une suspension s'applique immédiatement ;
- RBAC, isolation des établissements, `effective-permissions` et délai de 20 s : inchangés. Aucune permission n'est accordée par défaut.

## 9. Tests

| Test | Résultat |
|---|---|
| `subscriptionAccessState.http.pg.test.js` | vert. Couvre : équivalence stricte avec `getDataset().platformSchools` et `listPlatformProjection().subscriptions` ; même verdict d'accès (active, suspendue, inconnue) ; HTTP réel (école active → 200 ; école suspendue → 403 sur `/students`, `/classes` et `effective-permissions` ; suspension posée en base pendant que le serveur tourne → 403 à la requête suivante, puis 200 après réactivation ; fiche d'un autre établissement refusée) ; contrôles statiques (garde, renouvellement et fiche établissement sans état complet) |
| `schoolAccessRequestGuard.test.js` | 3 / 3 |
| `subscriptionSuspendedAccess.http.pg.test.js` | vert |
| `secAuth03`, `secAuth04` (sessions), `secAuth05` (révocation de rôle), `secJwt01` (politique de jetons), `secTenant01RefreshAttachment` (renouvellement) | verts |
| `projectionSchoolScope.test.js` | 9 / 9 |
| Base unitaire backend | 2 846 réussis, 0 échec, 1 ignoré |
| `unreadCount.p0Web01.test.tsx` (3), tests existants des badges | verts |
| Web complet | 333 fichiers, 1 879 tests |
| Lint (0 erreur), TypeScript (backend + web + mobile), build Web | verts |
| Inventaire MONO-T1 | 387 routes, contrat inchangé |

Non exécutés localement :
- les 3 lots PostgreSQL complets (laissés à la CI) ;
- tout smoke de préproduction (préproduction inaccessible depuis la session).

## 10. Risques résiduels

- **Autres chargements complets :** plus de 30 routes appellent encore `getAuthoritativeBackOfficeState` (administration plateforme, imports, `subscription-access`, examens v2, etc.). Elles ne sont pas sur le chemin de « Mon établissement », mais restent coûteuses à l'échelle de la plateforme.
- **Renouvellement de jeton :** `principalMustChangePassword` charge l'état complet quand il est appelé sans le booléen, ce qui est le cas au renouvellement, et une seconde fois pour un enseignant. Le renouvellement reste donc lent sur une grosse plateforme. Il est mesurable avec un compte et une session réels. Non corrigé ici.
- **`getDataset()` :** pas de verrou à vol unique. Plusieurs reconstructions simultanées à froid restent possibles sur les routes qui l'utilisent encore.
- **Phénomène 2 :** cause non démontrée sans les journaux Render (§6).

## 11. Rollback

`git revert <commit>` sur `develop`. Aucune migration, aucune donnée modifiée, aucun changement de contrat d'API. Le rollback ramène le chargement complet par requête.

## 12. Plan de smoke (préproduction, sur le code effectivement déployé)

1. Connexion Directeur / Admin School `CD-2026-0001` ; **mesurer** `effective-permissions` dans Chrome (phases Timing).
2. Mon établissement → Vue d'ensemble et Scolarité : élèves, classes, enseignants, utilisateurs, parents. **Relever** le TTFB de chaque requête et la connexion initiale.
3. Changement d'établissement (compte multi-établissement si disponible).
4. Rafraîchissement manuel (bouton Réessayer après un échec simulé).
5. Retour sur l'onglet : une seule requête par compteur `unread-count`.
6. Déconnexion, puis reconnexion.
7. Connexion lente (throttling Chrome « Slow 4G ») et reprise après un délai dépassé.
8. Journaux et métriques Render pendant le smoke : durée serveur des requêtes, mémoire, redémarrages.
9. Contrôle de suspension : suspendre un abonnement de test, puis 403 à la requête suivante ; réactiver, puis 200.
