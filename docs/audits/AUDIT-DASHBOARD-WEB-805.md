# AUDIT — Tableau de bord Web personnalisable (#805)

**Statut :** AUDIT UNIQUEMENT — DRAFT / HOLD. Aucune implémentation dans cette PR.  
**Gouvernance :** pas Ready, pas de merge. Avant tout lot d’implémentation : validation de ce périmètre, puis diff GitHub indépendant et CI.  
**Référence :** [GitHub Issue #805](https://github.com/Somafrik-education/Somafrik/issues/805) — `[UX] Tableau de bord Web personnalisable et activités en temps réel`.

| Champ | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Base auditée | `develop` |
| SHA audité | `21934f0e2a65f232ce8212547d2ef7a19a822fcb` |
| Commit | `chore(release): reconcile main ancestry into develop (#800)` |
| Date d’audit | 2026-09-26 |
| Livrable | ce document uniquement |
| Verdict | **HOLD.** Le socle visuel et les règles métier existent. Le contrat #805 (cartes KPI, graphique métier unique, fil d’activités, filtres année/date) n’est pas implémenté. Les cinq lots ci-dessous sont le périmètre autorisé. |

---

## Verdict exécutif

`/tableau-de-bord` pour un rôle établissement n’est pas une page vide. C’est une grille de graphiques Recharts, filtrée par rôle et par permission, avec une période calendaire **par graphique** et un réordonnancement local. Ce n’est pas le tableau de bord décrit par #805.

La maquette reste la référence de mise en page. Ses chiffres sont fictifs et ne deviennent pas des constantes. Quand la maquette et une règle déjà verrouillée divergent, **la règle métier gagne**. Les écarts sont listés dans la section « Règles qui priment sur la maquette ».

La navigation latérale, l’isolation établissement, le RBAC des graphiques, le taux de paiement et la présence du jour sont des contrats à conserver. Les lots ne les réécrivent pas.

**Hors périmètre de tous les lots :**

- `ParentDashboardPage` et le routage Parent de `DashboardEntryPage`.
- Le tableau de bord plateforme (Super Admin, Admin Pays) et `dashboardChartConfig` plateforme.
- Mobile.
- Les formules canoniques de notes, présences, frais et impayés.
- `GET /api/audit` (journal plateforme, inutilisable comme fil établissement).
- Toute donnée codée en dur issue de la maquette.

---

## Maquette

L’issue archive la maquette au chemin bibliothèque `/Somafrik/Maquettes/tableau-de-bord-web.png` (24 septembre 2026). Ce fichier **n’est pas dans le dépôt**, et l’issue n’a ni commentaire ni pièce jointe. L’audit visuel pixel n’est donc pas possible.

Le contrat fonctionnel utilisé ici est le texte de #805 :

- navigation latérale ;
- filtres année scolaire et date ;
- cartes KPI élèves, enseignants, classes, recettes ;
- graphique central interchangeable : effectifs, inscriptions, présences, notes moyennes, recettes, impayés, par classe ou par niveau ;
- répartition par niveau et taux de présence ;
- fil d’activités à droite, horodaté, avec lien vers l’objet, permissions et isolation par établissement ;
- états chargement / vide / erreur ;
- pas de rechargement complet au changement de série ;
- temps réel : reconnexion, déduplication, pagination, repli polling ;
- accessibilité, responsive, tests unitaires, intégration et E2E.

La capture runtime actuelle, qui ne doit pas être confondue avec la maquette, est `docs/user-guides/assets/web/02-tableau-de-bord-etablissement.png`. Elle montre la grille « Administration / Scolarité / Pédagogie / Présences / Paiements / Effectifs par classe », des barres agrégées, et un sélecteur Quotidien–Annuel sur chaque carte. Pas de cartes KPI, pas de sélecteur métier, pas de colonne d’activités.

**Blocage lot 5 visuel :** déposer le PNG dans le dépôt (ou le joindre à #805) avant la validation visuelle. Les lots 1 à 4 peuvent démarrer sur le contrat textuel.

---

## État actuel

### Entrée et coque

| Élément | Où | Constat |
| --- | --- | --- |
| Route | `web/src/App.tsx` — `/tableau-de-bord` | `PermissionRoute view="overview"` puis `DashboardEntryPage`. |
| Aiguillage | `web/src/pages/DashboardEntryPage.tsx` | Parent → `ParentDashboardPage`. Tout le reste → `OverviewPage`. |
| Navigation | `Sidebar` (`hidden … lg:flex`), `MobileNavDrawer` (`lg:hidden`) | La navigation latérale demandée existe déjà. Menu burger sous `lg`. |
| Largeur | `AppLayout` — `main` dans `max-w-6xl` | Colonne unique. Une rail d’activités à droite ne tient pas sans exception de layout **limitée à cette page**. |
| Carte setup | `GuidedSchoolSetupDashboardCard` au-dessus de la grille | À conserver. Elle ne fait pas partie de la maquette mais c’est un flux métier actif. |

Les libellés de navigation (`NAV_ITEMS` dans `web/src/lib/constants.ts`) ne sont pas à réécrire dans ces lots. Le chantier est le contenu de l’outlet établissement, pas une nouvelle coque.

### Ce que la page établissement affiche vraiment

`OverviewPage` ne rend pas de cartes KPI. Elle calcule des graphiques puis les passe à `DashboardChartGrid`.

`buildEstablishmentDashboardCharts` construit aussi `kpiItems`, mais **aucun appelant ne les lit**. Le test `dashboardKpiTruth.test.ts` verrouille seulement la présence des libellés dans le source. Les indicateurs visibles aujourd’hui sont des barres, pas des cartes.

Profils de graphiques (`getEstablishmentChartProfile`) :

| Profil | Rôles | Graphiques |
| --- | --- | --- |
| `academic` | préfet, proviseur, directeur, principal, enseignant | pédagogie, effectifs, notes par cours (volume), jauge et donut de présences |
| `finance` | comptable | paiements par statut, montants, effectifs |
| `operations` | secrétaire, surveillant | activité administrative, scolarité, élèves par classe |
| `default` | admin établissement et le reste | scolarité, pédagogie, administration, paiements, présences, effectifs par classe |

Chaque graphique a son propre sélecteur `daily | weekly | monthly | quarterly | annual`, stocké dans `localStorage` (`somafrik:chart-period:`). Ce n’est pas l’année scolaire canonique (`academicYearsApi`, `GET /v2/academic-years`, champs `startDate`, `endDate`, `isCurrent`, `schoolId`). Les bornes sont le jour civil, 7 jours, le mois, le trimestre ou l’année civile en cours.

L’ordre des cartes est aussi local (`chartOrder.ts`), par utilisateur. Le type de visualisation (barres, donut, courbe…) est une config plateforme `dashboardChartConfig`, éditable seulement si `canManageRolePermissions` (`ChartSettingsPage`). Ce n’est pas le sélecteur métier de #805.

États :

- Démo : la page entière reste en `LoadingState` / `ErrorState` tant que les domaines critiques ne sont pas hydratés (`dashboardDemoHydration.ts`).
- Production : pas de gate équivalent. Une série vide affiche « Aucune donnée à afficher. » dans le graphique. Une grille vide affiche « Aucun graphique disponible pour votre rôle dans ce périmètre. »

### Données déjà disponibles, et ce qu’elles mesurent

| Besoin #805 | Source actuelle | Écart |
| --- | --- | --- |
| Élèves | `scopedStudents` → `projectScopedStudents` (autorité `schoolId`) | Effectif du snapshot courant. Sous filtre de période, `activeStudentsInPeriod` ne compte que les élèves qui ont une présence, une note ou un paiement dans la fenêtre. Ce n’est pas l’effectif inscrit. |
| Enseignants | `scopedTeachers` | Portée établissement, avec repli sur les classes des élèves scopés. |
| Classes | `scopedClasses` | Idem. L’enseignant est restreint par `teacherScopedClassNames`. |
| Recettes | `getPaymentRateKpi` sur `student_fee_obligations` | Le KPI verrouillé est **Taux de paiement** (`Σ amountPaid / Σ (amountDue − exemption)`). Multi-devises ou montant manquant → `—`. `collectedAmount` existe dans le résultat mais n’est pas affiché. Le donut « Paiements » compte des **lignes** de paiement par statut, pas un montant encaissé. |
| Impayés | `unpaidService.buildDashboard` | `totalAmountDue`, effectif, `byClass`. Utilisé par la page Finances, pas par l’accueil. |
| Inscriptions | table `enrollments` (`academic_year_id`, `enrollment_date`, `status`, `class_id`) | Pas de série dashboard. Le domaine Web `studentEnrollment.ts` connaît la source et le statut, pas un agrégat temporel d’accueil. |
| Présences | deux formules distinctes | Jauge dashboard : `(présents + retards) / lignes enregistrées` (`getPresenceStats`). KPI « Présence du jour » : `—` tant que l’appel n’est pas complet (`recorded !== expected`), fuseau `Africa/Kinshasa` par défaut. Une ligne manquante n’est pas une absence. |
| Notes moyennes | `gradeBook.ts` + `backend/lib/gradesCanonical.js` (`weightedAverage`) | Le graphique « Notes par cours » est un **comptage** de lignes, pas une moyenne. Les statuts absent / justifié / dispensé / non remis sont exclus de la moyenne. |
| Par niveau | `levelName` sur le domaine élève / scolarité (`studentDomain.ts`, `schoolingTruth.ts`) | Le dashboard groupe par `className`, pas par niveau. |
| Activités | notifications internes (`useInternalNotificationsUnreadCount`, poll 30 s, curseur) ; `audit_logs` | Pas de fil. `GET /api/audit` est réservé Super Admin / Admin Pays **et** listé dans `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`. Les deux gardes se ferment. Ce n’est pas un flux établissement. |

### Permissions et isolation

`filterEstablishmentDashboardCharts` retire un graphique si le rôle n’a aucun `READ` sur les modules associés (Élèves, Enseignants, Classes, Notes, Présences, Paiements, etc.). Les barres du graphique Administration sont filtrées **segment par segment**.

Isolation :

- Élèves : `studentsScope.ts` masque un autre établissement (`SCOPE_LEAK`) et exige `schoolId`.
- Paiements : `scopedPayments` compare `schoolId` UUID. Le `schoolCode` n’est qu’un repli si la ligne n’a pas d’UUID.
- Présences et notes : `schoolCode` **ou** `studentId` présent dans les élèves scopés. Un lot qui agrège ces lignes doit garder ce filtre, pas un filtre « nom de classe » seul (collision de libellés entre établissements).

Aucun WebSocket ni SSE dans le dépôt. Le seul quasi-temps réel du dashboard est le poll 30 s du compteur de notifications internes, plus refresh au focus.

### Tests existants à ne pas casser

- `web/src/lib/dashboardPermissions.test.ts`
- `web/src/lib/dashboardKpiTruth.test.ts`
- `web/src/lib/dashboardDemoHydration.test.ts`
- `web/src/lib/todayPresenceKpi.test.ts`
- `web/src/lib/paymentAmountBreakdown.test.ts` (taux non calculable)
- `web/src/pages/DashboardEntryPage.parent.test.tsx`
- `web/src/pages/demoDataAccess.hydration.test.tsx` (Overview + établissement)
- Tests DataContext de changement d’établissement (pas de fuite A sous B)

Il n’y a pas de Playwright. Les E2E du dépôt sont des scripts Node (`scripts/verify-e2e-*.js`) et des tests Vitest / `node:test`. Le lot 5 reste dans ces harness.

---

## Règles qui priment sur la maquette

1. Aucun effectif, montant ou pourcentage de la maquette n’est codé en dur.
2. « Recettes » ne remplace pas « Taux de paiement ». Si un montant encaissé est affiché, il sort de `collectedAmount`, une seule devise, sinon `—`.
3. « Présence du jour » reste `—` si l’appel est incomplet. La jauge historique `(présents + retards) / lignes` est un autre indicateur et doit porter un autre libellé.
4. L’effectif élèves de la carte est le snapshot scolarité scopé, pas le sous-ensemble « actif sur la période ».
5. Une moyenne de notes passe par `gradeBook` / `weightedAverage`. Un comptage de copies n’est pas une moyenne.
6. Un impayé est le reste dû des obligations (`unpaidService`), pas le nombre de paiements au statut Impayé.
7. Une série dont le module n’est pas en `READ` n’apparaît pas, y compris dans le sélecteur.
8. Un enseignant ne voit que ses classes affectées. S’il n’a aucune affectation résolue, le repli actuel (portée établissement) reste en vigueur : ne pas le « durcir » dans ces lots.
9. Parent et plateforme ne changent pas de page.
10. La carte de configuration guidée reste au-dessus du nouveau contenu.
11. En démo, les domaines critiques continuent de bloquer l’affichage d’un effectif partiel.
12. Le fil d’activités ne lit pas `audit_logs.old_value` / `new_value` et n’ouvre pas `GET /api/audit` aux rôles établissement.

---

## Découpage autorisé

Les lots sont des PR séparées, dans cet ordre de dépendance. Chaque PR reste Draft tant que son diff n’a pas été relu.

```text
Lot 1  structure + cartes KPI + contrat de filtres
        ├─ Lot 2  graphique métier central
        └─ Lot 3  activités (peut démarrer après le contrat de filtres du lot 1)
              Lot 4  graphiques secondaires + responsive (après lot 2)
                    Lot 5  tests transverses, sécurité, visuel (après 2, 3 et 4 ;
                           les tests du lot touché entrent dans chaque PR)
```

### Lot 1 — Structure visuelle et cartes KPI

**Objectif.** Poser la page établissement de #805 sans retirer les graphiques existants.

**Dans la PR**

- Exception de layout **uniquement** pour l’accueil établissement de `OverviewPage` : zone filtres + rangée de cartes. `max-w-6xl` des autres routes ne bouge pas. Parent et plateforme inchangés.
- Cartes, dans cet ordre, pour le profil qui voit aujourd’hui le jeu complet : Élèves, Enseignants, Classes, puis le KPI finance déjà verrouillé (**Taux de paiement**, pas un montant fictif). Les profils `academic`, `finance` et `operations` affichent le sous-ensemble déjà calculé par `buildEstablishmentKpiItems`, plus les cartes élèves / enseignants / classes seulement si le `READ` correspondant existe.
- Brancher `kpiItems` (aujourd’hui mort) au lieu d’inventer une deuxième formule.
- Filtres affichés : année scolaire via `academicYearsApi.list()` (année `isCurrent` par défaut) et une date ou une plage. En lot 1, ces filtres **pilotent les cartes dont la règle est déjà définie** (présence du jour = date civile + fuseau ; taux de paiement = obligations de l’année si le DTO porte déjà l’année). Ils ne recalculent pas encore les graphiques historiques : le sélecteur par graphique reste en place jusqu’au lot 2, pour ne pas avoir deux vérités silencieuses. Le libellé de l’année est visible même quand l’historique n’est pas encore filtré.
- États chargement / vide / erreur de la rangée, y compris hors démo : erreur réseau sur l’année scolaire, aucune année, taux ou présence non calculables (`—`, pas `0`).
- Conserver `GuidedSchoolSetupDashboardCard`, la grille actuelle, le RBAC et la démo critique.

**Hors PR**

- Sélecteur métier, rail d’activités, donut par niveau.
- Changement de `getPaymentRateKpi`, `getTodayEstablishmentPresenceKpi`, `studentsScope`.
- Suppression du drag-and-drop ou de `ChartSettingsPage`.
- Reconstruction de la sidebar.

**Fichiers touchés (prévision)**

- `web/src/pages/OverviewPage.tsx`
- `web/src/components/layout/AppLayout.tsx` (exception de largeur ciblée, ou conteneur local qui sort de `max-w-6xl` sans changer le layout global — préférer un conteneur local)
- nouveau composant de cartes sous `web/src/components/charts/` ou `web/src/components/dashboard/`
- tests Vitest de la rangée et du non-changement Parent / plateforme

**Terminé quand**

- Un admin établissement voit les cartes avec les mêmes valeurs que les formules actuelles, y compris `—`.
- Un rôle sans `READ` Paiements ne voit pas le taux.
- La grille de graphiques actuelle est encore là et ses tests passent.
- Aucune constante numérique de maquette.

### Lot 2 — Graphique métier interchangeable

**Objectif.** Un graphique central, un sélecteur, pas de rechargement de page.

**Sélecteur autorisé** (une option n’est rendue que si le module est en `READ`) :

| Option | Série | Unité | Source imposée |
| --- | --- | --- | --- |
| Effectifs | par classe, ou par niveau si `levelName` est présent | élèves | `scopedStudents` / classes scopées. Pas le sous-ensemble « actif sur la période » sauf libellé explicite. |
| Inscriptions | comptes par jour ou par mois dans l’année choisie | inscriptions | `enrollments` (`enrollment_date`, `status`, `academic_year_id`, `school_id`). Si le snapshot Web ne porte pas ces lignes, **ajouter une lecture** scopée établissement. Ne pas approximer avec `createdAt` élève. |
| Présences | répartition Présent / Absent / Retard / Justifié | lignes, plus le taux de `getPresenceStats` clairement sous-titré | Pas la formule « Présence du jour ». |
| Notes moyennes | moyenne de classe ou de niveau | points /20 | `gradeBook.ts` aligné sur `gradesCanonical.weightedAverage`. Interdit : compter les copies comme aujourd’hui dans `notes-course`. |
| Recettes | montant encaissé | devise unique | `collectedAmount` / obligations. Multi-devises → état « non calculable », pas une somme mixte. |
| Impayés | reste dû, découpage classe | devise du dashboard impayés | `unpaidService.buildDashboard`. Interdit : réutiliser le donut de statuts de paiement. |

Découpage classe / niveau : contrôle du graphique, pas une septième métrique. Sans `levelName`, le mode niveau est désactivé avec un état vide explicite. Ne pas déduire le niveau en découpant le nom de classe.

**Dans la PR**

- Le sélecteur change données, axes et unités dans le même arbre React (état local). Pas de navigation, pas de reload.
- Les filtres année + date du lot 1 deviennent la période de **ce** graphique. Retirer, pour l’accueil établissement seulement, le sélecteur calendaire par carte et l’usage de `applyEstablishmentChartPeriod` sur cette page.
- La grille multi-graphiques établissement de l’accueil est remplacée par ce graphique. Les builders et le catalogue plateforme restent.
- `ESTABLISHMENT_CHART_CATALOG` et `ChartTypeSettingsPanel` : ne pas laisser des ids morts (`scolarite`, `payments`, `classes`…) pointer vers des graphiques qui ne sont plus montés. Soit le panneau ne liste plus ces ids, soit il documente qu’ils ne concernent plus l’accueil. Pas de nouvelle config silencieuse.
- Conserver le filtre RBAC avant le calcul de série.
- États vide / erreur / chargement cohérents avec les filtres (changer l’année relance la série, pas toute l’application).

**Hors PR**

- Rail d’activités, donut secondaire, refonte responsive finale.
- Modification de `weightedAverage` ou du schéma `enrollments`.
- Tableau de bord plateforme et réordonnancement local des graphiques plateforme.

**Fichiers touchés (prévision)**

- `web/src/lib/dashboardCharts.ts`
- `web/src/lib/dashboardChartPeriod.ts` (ne plus l’appliquer à l’accueil établissement)
- `web/src/lib/dashboardPermissions.ts` (règles du nouvel id de graphique)
- `web/src/lib/chartTypes.ts` (catalogue)
- `web/src/components/charts/DashboardChartGrid.tsx` ou un successeur utilisé seulement par l’accueil établissement
- lecture API inscriptions seulement si le snapshot ne suffit pas
- tests de sélecteur, d’axes, de RBAC et de non-régression plateforme

**Terminé quand**

- Chaque option autorisée change la série sans rechargement.
- Une option interdite n’est pas dans le menu et sa série n’est pas calculée.
- Moyenne, impayés et recettes suivent les formules ci-dessus, tests à l’appui.
- Parent et plateforme : snapshots de tests inchangés.

### Lot 3 — Activités récentes et backend temps réel

**Objectif.** Un fil à droite (ou sous le graphique sous le breakpoint `lg`), scopé établissement, sans journal d’audit brut.

**Constat bloquant.** Il n’existe pas de transport push. `GET /api/audit` n’est pas le bon canal : 403 métier pour les rôles établissement, et 403 plateforme via `platformPersonalDataGuard`. Les notifications internes ont déjà école, `createdAt`, `sourceEntityType`, `sourceEntityId`, `navigationTarget`, pagination par curseur et poll 30 s — mais elles ne couvrent pas inscriptions, paiements, présences, notes, enseignants et cours, et leur corps peut contenir des données personnelles.

**Dans la PR**

- Nouveau modèle de lecture, école = `school_id` UUID. Événements autorisés : inscription, paiement, présence, note, enseignant, communication, cours.
- Champs exposés : id stable, type, horodatage, libellé court, route interne déjà existante. Pas de nom d’élève dans un événement financier si le rôle n’a pas `READ` Élèves **et** `READ` Paiements. Pas de note chiffrée dans le libellé si le rôle n’a pas `READ` Notes. Pas de pièce médicale, pas de mot de passe, pas de corps de message complet.
- Isolation : un jeton de l’établissement A ne reçoit rien de B, test d’intégration obligatoire. Le filtre `className` seul est interdit.
- Pagination par curseur, déduplication par id, reprise après coupure.
- Transport v1 : polling authentifié (même idée que les 30 s des notifications, intervalle à fixer dans la PR et testé), refresh au focus, retry avec backoff. Pas de WebSocket nouveau dans ce lot. Le critère #805 « reconnexion + fallback polling » est satisfait par ce client : la reconnexion est le retry du poll. Un canal SSE éventuel est un lot ultérieur, hors #805, seulement s’il réutilise cette même lecture et ce même masque.
- Le fil respecte les filtres année / date du lot 1.
- UI : horodatage, lien, états chargement / vide / erreur, « charger la suite ».

**Hors PR**

- Modifier `GET /api/audit`, élargir son RBAC, ou sélectionner `old_value` / `new_value` pour l’UI.
- Pousser des événements vers le Parent ou le Mobile.
- Remplacer le centre de notifications existant.

**Fichiers touchés (prévision)**

- endpoint de lecture nouveau sous `backend/` (route, scope tenant, tests PostgreSQL de fuite)
- client Web + composant de fil
- pas de changement de `auditService.record`

**Terminé quand**

- Les sept types sont produits depuis les écritures métier déjà auditées ou déjà persistées, pas depuis des fixtures de maquette.
- Deux établissements concurrents : zéro événement croisé.
- Un rôle sans le module ne voit pas l’événement correspondant.
- Coupure réseau puis retour : pas de doublon, le curseur reprend.

### Lot 4 — Graphiques secondaires et responsive

**Objectif.** Compléter la maquette sans rouvrir les formules du lot 2.

**Dans la PR**

- Répartition par niveau : agrégat `levelName` (référentiel), pas un top 8 de `className`.
- Taux de présence secondaire : libellé distinct de « Présence du jour ». Formule de plage = `getPresenceStats`. La carte « Présence du jour » du lot 1 ne change pas.
- Responsive de **cette page** : cartes en 1 colonne puis 2 ; graphique pleine largeur ; fil sous le graphique sous `lg`, à droite au-dessus. La sidebar existante (`lg`) et le drawer ne sont pas redessinés.
- Les états vide / erreur restent lisibles à 360 px et à largeur desktop.
- Accessibilité de la page : sélecteur et filtres étiquetés, fil annoncé comme liste, graphique central accompagné d’un résumé texte (la valeur ou « aucune donnée »), pas seulement un `canvas` Recharts. Le drag-and-drop de l’ancienne grille disparaît avec elle sur cet accueil ; ne pas réintroduire un drag sans alternative clavier.

**Hors PR**

- Nouveau breakpoint global, refonte Topbar, ou changement des autres pages dans `max-w-6xl`.
- Troisième formule de présence.

**Terminé quand**

- Niveau absent → état vide, pas un regroupement par nom de classe.
- Les deux taux de présence ne partagent pas le même libellé.
- La page reste utilisable avec le drawer mobile déjà en place.

### Lot 5 — Tests E2E, sécurité et validation visuelle

**Objectif.** Verrouiller les lots 1 à 4. Pas de feature nouvelle.

**Dans la PR**

- Vitest : sélecteur, filtres, `—` taux et présence, RBAC du menu, non-régression Parent et plateforme.
- Intégration backend : pagination, déduplication, isolation `school_id`, masque par rôle.
- E2E dans le harness existant (`scripts/verify-e2e-*.js` ou équivalent node), pas une introduction de Playwright : parcours admin établissement, option interdite absente, activité de l’autre école absente.
- Sécurité : relire que `GET /api/audit` n’a pas changé de garde ; qu’aucun payload d’activité ne contient `old_value` ; que le changement d’établissement purge le fil (même contrat que DataContext RED-8).
- Visuel : seulement après dépôt du PNG. Comparer la structure (cartes, graphique, deux secondaires, fil), pas les chiffres fictifs. La capture `02-tableau-de-bord-etablissement.png` est l’état **avant**, pas la cible.

**Hors PR**

- Correctifs produit découverts hors critères #805. Ils font un ticket séparé.

**Terminé quand**

- CI des suites touchées verte.
- Le PNG est dans le dépôt ou la PR reste Draft avec le blocage visuel explicite.

---

## Risques si le périmètre glisse

| Glissement | Conséquence |
| --- | --- |
| Remplacer le taux de paiement par un montant « recettes » de maquette | Contredit le fail-closed multi-devises. |
| Utiliser `activeStudentsInPeriod` comme effectif | L’effectif chute dès qu’on filtre une date sans présence. |
| Compter les notes ou parser le nom de classe | Moyennes et niveaux faux. |
| Brancher le fil sur `GET /api/audit` | 403, et fuite de valeurs d’audit si la garde est retirée. |
| Ajouter un WebSocket dans le lot 3 | Nouveau plan de auth et de tenant, hors socle actuel. |
| Éditer `AppLayout` pour toutes les routes | Régression largeur sur le reste du back-office. |
| Livrer les cinq lots dans une seule PR | Impossible à relire ; le ticket impose un diff indépendant avant merge. |

---

## Décision demandée

HOLD maintenu. Les PR d’implémentation ne s’ouvrent qu’après acceptation de ce découpage.

Ordre : **1 → 2 et 3 → 4 → 5**.  
Condition visuelle du lot 5 : fichier `/Somafrik/Maquettes/tableau-de-bord-web.png` versé au dépôt ou joint à #805.
