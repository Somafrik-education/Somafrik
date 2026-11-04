# PERF-PR2 — KPI légers du tableau de bord et arrêt du polling des listes

Statut : **DRAFT / HOLD — pas ready — pas de merge.**

Base : `develop` `c53b04f80c46caf2b8bc1e9c76c7145f9f0c3282` (inclut #1062).
Branche : `perf/pr2-dashboard-lightweight-kpi`.
Aucune migration. Aucun déploiement. `main` non modifié. PERF-PR3 non commencé.

## 1. Architecture avant

La page personnel `OverviewPage` (`/tableau-de-bord`, via `DashboardEntryPage`) rechargeait six domaines complets :

`students`, `teachers`, `classes`, `presences`, `payments`, `studentFees`.

Le chargement passait par `refresh(DASHBOARD_METRIC_DOMAINS)` dans `web/src/pages/OverviewPage.tsx`.
`SchoolRecentActivities` appelait `GET /api/dashboard/school-activities?limit=10`.
Le bouton du bandeau appelait `refresh(domainsForPath("/tableau-de-bord"))`, qui contenait les mêmes six domaines.
`DomainRouteBootstrap` les demandait aussi à l'entrée de la route.

Les cartes, le donut des niveaux, la présence du jour et les graphiques étaient ensuite calculés dans le navigateur (`getEstablishmentMetrics`, `buildSchoolDashboardSecondaryMetrics`, `getPaymentCashBreakdown`, `getPaymentRateKpi`, `buildEstablishmentDashboardCharts`, `applyPeriodToDashboardChart`).

`EtablissementOverviewPage` (`/etablissement/vue-ensemble`) est une autre page. Elle n'avait pas ce timer. Elle n'est pas modifiée.

## 2. Cause du polling excessif

Un seul effet sur `OverviewPage` armait un `setInterval` de 10 secondes, plus un rafraîchissement au focus et sur `somafrik:dashboard-activities-changed`.
Chaque tick relançait les six listes, même si l'écran n'a besoin que de comptes, de sommes et de courtes séries.
Le fil d'activités utilisait le même délai de 10 secondes.
L'onglet masqué sautait le tick, mais le timer restait armé et le retour au premier plan relançait toujours les listes.

Déclencheurs avant correction :

| Requête | Montage | Focus | Timer 10 s | Écriture métier | Bouton Actualiser |
| --- | --- | --- | --- | --- | --- |
| Six listes (`students`, `teachers`, `classes`, `presences`, `payments`, `studentFees`) | Bootstrap de route et effet `OverviewPage` | `window` `focus` | Oui, onglet visible | `DASHBOARD_SYNC_EVENT` | `domainsForPath("/tableau-de-bord")` |
| `GET /api/dashboard/school-activities?limit=10` | `SchoolRecentActivities` | `focus` | Oui, onglet visible | `DASHBOARD_SYNC_EVENT` | Non |
| `GET` configuration guidée | `OverviewPage` | Non | Non | Non | Non |

Les lectures globales encore utilisées par les autres écrans (finance, présences, élèves, pédagogie) restent en place. Elles ne sont pas réécrites ici.

## 3. Architecture après

Le tableau de bord établissement vivant ne demande plus ces six listes.

- `GET /api/dashboard/school-kpis?period=` retourne les cartes et les séries courtes de la période.
- Le polling des KPI est de 60 secondes, uniquement onglet visible.
- Le fil d'activités reste sur son endpoint, avec un polling de 60 secondes, onglet visible.
- Le bouton Actualiser du bandeau, sur `/tableau-de-bord` et hors démonstration, émet `somafrik:dashboard-kpis-refresh`. Il ne relance pas les six listes.
- Une écriture métier (`attendance`, `presences`, `course-schedules`, `payments`, `classes`) émet toujours `DASHBOARD_SYNC_EVENT`. Le dashboard ne recharge que les KPI et les dix dernières activités.
- L'onglet masqué retire l'intervalle. Le retour au premier plan ne relance la requête que si le dernier succès a plus de 60 secondes, ou si une mutation a été mise en attente.
- Une requête déjà en vol est regroupée. Une réponse dont l'effet a été démonté, ou dont la période ne correspond plus, est ignorée.
- Une erreur réseau conserve le dernier payload et affiche le message déjà prévu. Elle ne remplace pas les valeurs par zéro.
- Le mode démonstration continue d'hydrater ses domaines une fois, sans timer de 10 secondes. Il ne passe pas par le nouvel endpoint.

La disposition des cartes, les activités à droite, le sélecteur d'indicateur, le sélecteur de période et les deux indicateurs du bas sont conservés. Pendant le premier chargement, les cartes affichent « — » et les indicateurs complémentaires affichent « Chargement des indicateurs… ».

## 4. Endpoint et contrat

`GET /api/dashboard/school-kpis?period=daily|weekly|monthly|quarterly|annual`

`period` absent vaut `monthly`. Toute autre valeur répond 400. Le corps de requête et `schoolId` d'URL sont ignorés.

Réponse `Cache-Control: no-store` :

- `schoolId` : UUID résolu côté serveur.
- `period`, `periodLabel`, `timeZone` (fuseau IANA de l'établissement).
- `cards` : `students`, `teachers`, `classes`, `revenue`, `levels`, `attendance`, `paymentRate`.
- `series` : effectifs actifs sur la période, pédagogie, présences, paiements, tailles de classes, notes par matière.

Un module sans droit de lecture vaut `null` et n'est pas agrégé. Ce n'est pas un zéro.

## 5. Sources et règles de calcul

Les règles reprises sont celles du client actuel, pas une nouvelle définition.

| Indicateur | Source SQL | Règle reprise |
| --- | --- | --- |
| Élèves | `students` + inscription ouverte | Tous les élèves de l'établissement pour un rôle non enseignant. Un enseignant est limité aux classes de `teacher_assignments` actives et de `class_head_teachers` actives. Sans affectation active, ou si l'identifiant n'est pas un UUID, le périmètre est un tableau vide : aucune classe n'est retenue. |
| Enseignants | `teachers` | Effectif de l'établissement pour un rôle non enseignant, et pour un enseignant qui a au moins une classe active. Un enseignant sans affectation reçoit 0. |
| Classes | `classes` | Noms distincts. Pour un enseignant, uniquement ses classes actives. Sans affectation, 0. |
| Niveaux | `classes.level`, sinon « Non renseigné » | Même regroupement que `buildSchoolDashboardSecondaryMetrics`. |
| Présence du jour | `attendance` du jour civil de l'établissement | Élève attendu : statut hors archivé, inactif, désinscrit, transféré, sorti, et inscription de classe ouverte. Ligne manquante non comptée comme absence. Taux seulement si `recorded = expected`, sinon « — ». Présent et retard comptent comme présents. Un enseignant sans classe n'a aucun élève attendu. |
| Recettes | `payments.amount` | Hors annulé, attente, pending, refusé, échoué, brouillon. Affichage seulement s'il reste une seule devise. `FC` est présenté `CDF`. Les allocations ne sont pas additionnées. Pour un enseignant, seuls les paiements des élèves inscrits (inscription ouverte) dans ses classes actives sont retenus. Un enseignant sans affectation reçoit « — », même avec `Paiements:READ`. L'administration garde tout l'établissement. |
| Taux de paiement | `student_fee_obligations` | Hors archivées et hors annulées. `Σ amount_paid / Σ (amount_due − exemption)`. Devises mélangées, montant manquant ou assiette nulle : « — ». Même périmètre que les recettes : élèves des classes de l'enseignant, rien sans classe. |
| Séries de période | dates des lignes | Élèves du graphique = élèves ayant une présence, une note ou, si le droit paiements existe, un paiement dans la fenêtre. Les cartes, elles, ne sont pas filtrées par la période. C'est le comportement de `applyEstablishmentChartPeriod`. |
| Présences du graphique | `attendance.status` | Présent, retard, justifié, sinon absent. Taux = (présents + retards) / lignes. |
| Notes, examens, bulletins | `grades.created_at`, `exams.exam_date`, `report_cards.created_at` | Le bulletin `draft` correspond au « brouillon » du client. Le statut « en validation » n'a pas d'équivalent canonique. |
| Utilisateurs actifs du graphique | `users.created_at` | Le filtre de période du client lit `createdAt` avant `lastLoginAt`. Le compte suit cette première date, et exclut les statuts inactifs. Un enseignant sans classe reçoit 0. |
| Annonces | `announcements.created_at` | Comptées seulement avec le droit Annonces. Avant, la barre valait souvent 0 parce que le domaine n'était pas chargé par le dashboard. Un enseignant sans classe reçoit 0. |

Le jour et les fenêtres quotidienne, hebdomadaire, mensuelle, trimestrielle et annuelle suivent `schools.profile_payload->>'timezone'`, lu par `resolveSchoolTimeZone` (le même résolveur que le planning et la carte élève). Une valeur vide ou qui n'est pas un fuseau IANA retombe sur le repli déjà partagé, `Africa/Kinshasa`. Le module KPI n'impose plus ce fuseau à tous les établissements. Le littéral SQL est le fuseau validé, jamais la chaîne brute du profil.

## 6. Périodes

`daily` : le jour civil. `weekly` : ce jour et les six précédents. `monthly` : du 1er au jour courant. `quarterly` : début du trimestre au jour courant. `annual` : 1er janvier au jour courant.

Le sélecteur de période du graphique visible relance cet endpoint. Il ne recharge pas les listes. La description du graphique reprend `periodLabel`.

## 7. Invalidation

| Événement | Effet |
| --- | --- |
| Montage | Un GET KPI et un GET activités. |
| Timer visible | KPI et activités toutes les 60 secondes. |
| Onglet masqué | Intervalles arrêtés, aucune requête de tick. |
| Retour visible | Requête seulement si le dernier succès a au moins 60 secondes, ou si une mutation a été différée. |
| Écriture métier signalée | KPI et activités, une fois les requêtes en vol terminées. |
| Bouton Actualiser | KPI immédiatement. |
| Changement de période | Un GET KPI pour la période choisie. |

## 8. Protection tenant et RBAC

Authentification obligatoire. Le Superadmin et l'Admin Pays reçoivent 403 avant toute lecture, y compris avec `ALL_PRIVILEGES`. Le rôle doit être un rôle interne d'établissement. L'UUID vient du principal (`effectiveSchoolId` ou `schoolId`), avec le même rattrapage JWT que les activités pour l'Admin School. Un code école seul, sans UUID, est refusé. Aucune lecture inter-établissement. Une erreur PostgreSQL est propagée : pas d'appel à `getAuthoritativeBackOfficeState`, pas de projection globale.

L'inventaire MONO-T1 enregistre `GET /api/dashboard/school-kpis` comme `school-activities` : `requireAuth` seul, aucune clé `routePermissions`, `allowedRoles` nul. L'heuristique statique ne voit pas le contrôle, qui est dans `resolveSchoolKpiPrincipal`. La matrice RBAC observée des routes sous `requirePermission` n'est pas élargie. Aucun droit nouveau n'est ajouté au catalogue.

Les droits lus sont ceux déjà portés par le principal : `Élèves:READ`, `Enseignants:READ`, `Classes:READ`, `Paiements:READ`, `Présences:READ`, `Notes:READ`, `Examens:READ`, `Bulletins:READ`, `Documents:READ`, `Utilisateurs:READ`, `Annonces:READ`, ainsi que les alias « Voir » / « Gérer » déjà reconnus par le web. Aucun droit nouveau n'est créé dans le catalogue RBAC.

## 9. Tests

Backend, sans base : `backend/lib/schoolDashboardKpis.test.js`.
Backend PostgreSQL jetable : `backend/lib/schoolDashboardKpis.pg.test.js`.
Web : `web/src/lib/dashboardSync.test.ts`, `web/src/lib/useSchoolDashboardKpis.test.tsx`, `web/src/lib/routeDomainMap.usersSchoolCode.test.ts`, `web/src/components/dashboard/SchoolRecentActivities.lot5.test.tsx`, `web/src/components/DomainRouteBootstrap.forbiddenDomains.red.test.tsx`, `web/src/pages/demoDataAccess.hydration.test.tsx`. Le hook vérifie aussi qu'une mutation reçue onglet masqué est rejouée au retour, sans attendre les 60 secondes.

La parité PostgreSQL du fixture école A, fuseau explicite `Africa/Kinshasa`, au 4 novembre 2026, 11:00 dans ce fuseau, donne : 4 élèves, 1 enseignant, 2 classes, recettes `97 CDF`, taux `53 %`, présence du jour `100 %`. L'enseignant affecté à la seule 6e voit 2 élèves et 1 classe, sans bloc finance. L'enseignant sans affectation active, y compris avec une affectation et une titularisation inactives et avec tous les droits de lecture, voit 0 élève, 0 classe, 0 enseignant, recettes « — », taux « — », présence « — » et séries vides, alors que l'administration voit toujours 4 élèves, 2 enseignants et `97 CDF`. L'école vide reste à « — » pour les recettes, le taux et la présence. L'école B n'entre pas dans les comptes de l'école A.

Finance des enseignants, sur la même base après ajout d'un paiement de 300 CDF et d'une obligation 200 / 100 pour l'élève de 5e : l'administration voit `397 CDF` et un taux de `51 %` (370 dus, 190 payés). L'enseignant de la seule 6e, avec tous les droits de lecture, voit `97 CDF` et `60 %` (150 dus, 90 payés) : le paiement de l'élève de 5e n'entre pas. L'enseignant affecté à la 6e et à la 5e voit 3 élèves, 2 classes, `397 CDF` et `51 %`. L'enseignant sans affectation reste à « — ». Sur le code précédent, l'enseignant de la seule 6e recevait `397 CDF`.

Autour de minuit, le 4 novembre 2026 à 23:30 UTC, le jour civil est le 5 novembre à Kinshasa et à Auckland, et encore le 4 novembre à New York. À 22:30 UTC, Auckland est déjà le 5 novembre et Kinshasa est encore le 4. Une annonce horodatée le 5 novembre 2026 à 03:30 UTC entre dans le jour Kinshasa et reste hors du jour New York. Un fuseau stocké illisible retombe sur le repli partagé.

## 10. Benchmarks

Fixture reproductible : base jetable PERF-PR1, école A décrite par `schoolDashboardKpis.pg.test.js`. Ce n'est pas une mesure Render.

Octets mesurés au 4 novembre 2026, deux exécutions identiques. Les `created_at` et `updated_at` des six tables sont figés à `2026-11-04T10:00:00.000Z` dans le test, sinon `row_to_json` varie de quelques octets selon les fractions de seconde de `NOW()`.

| Donnée | Octets |
| --- | --- |
| Élèves | 1 802 |
| Enseignants | 329 |
| Classes | 632 |
| Présences | 2 065 |
| Paiements | 1 612 |
| Obligations | 2 593 |
| Somme des `row_to_json` des six tables de l'école A | 9 033 |
| `JSON.stringify` de `GET /api/dashboard/school-kpis?period=monthly` | 1 189 |

Le proxy des listes est le JSON des lignes, pas la réponse HTTP historique, qui ajoute encore des champs de projection. Le KPI est le corps réellement renvoyé.

Requêtes déduites des timers du code, onglet visible, sans compter le focus ni les mutations :

| Scénario | Avant | Après |
| --- | --- | --- |
| Chargement initial des six listes | Bootstrap + effet immédiat | 0 liste, 1 KPI, 1 activités |
| 5 minutes ouvertes | 31 ticks × 6 listes + 31 activités, plus le bootstrap | 6 KPI + 6 activités |
| 30 minutes ouvertes | 181 ticks × 6 listes + 181 activités, plus le bootstrap | 31 KPI + 31 activités |
| 5 minutes masquées | Timer armé, ticks sautés mais retour au focus relançait les listes | 0 requête de tick |
| Retour après 5 minutes masquées | Nouveau chargement des six listes | 1 KPI + 1 activités, car le succès a plus de 60 secondes |
| Mutation de présence ou de paiement | Six listes + activités | 1 KPI + 1 activités |
| Changement de période | Recalcul local sur les listes déjà téléchargées | 1 KPI |
| Connexion lente | Une liste lente bloquait le `Promise` des six domaines | Le dernier KPI reste affiché ; l'échec est un message, pas un zéro |

Sur ce fixture, un cycle KPI pèse 1 189 octets contre 9 033 octets de lignes. Le gain grandit avec le nombre de lignes, parce que la réponse KPI ne transporte pas les fiches.

## 11. Risques résiduels

- Le fuseau des graphiques était celui du navigateur. Le serveur suit le fuseau enregistré de l'établissement. Un poste dans un autre fuseau peut donc encore décaler une frontière de jour par rapport à l'écran. Un profil sans fuseau valide conserve le repli partagé `Africa/Kinshasa`.
- La finance d'un enseignant suit désormais les élèves de ses classes. C'est plus restrictif que l'ancien client, qui affichait les recettes de tout l'établissement à un enseignant ayant `Paiements:READ`. Les écrans Finance hors dashboard ne sont pas modifiés et gardent leur périmètre actuel.
- Les comptes d'annuaire (enseignants, utilisateurs actifs, annonces) restent à l'échelle de l'établissement pour un enseignant qui a au moins une classe active, et à 0 sans classe.
- Le compte « Messages » non lus du graphique d'administration n'est pas recalculé. Le dashboard ne chargeait pas ce domaine. Le chantier messages reste séparé. Les alertes internes continuent de venir du hook déjà en place.
- Le statut bulletin « en validation » n'existe pas dans `report_cards`. Seul `draft` alimente « À valider ».
- Les classes synthétiques fabriquées côté client quand un `className` n'avait pas de fiche ne sont pas recrées. Le compte suit `classes`.
- Les autres routes continuent de pouvoir charger les listes complètes. C'est hors de ce chantier.
- Le client HTTP, les timeouts et les retries restent PERF-PR4.

## 12. Travaux reportés

- PERF-PR3 n'est pas ouvert.
- Lectures historiques hors dashboard.
- Messages non lus du graphique.
- Refonte du client HTTP.
