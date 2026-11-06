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
| Livrable | ce document + la maquette archivée |
| Maquette | `docs/audits/evidence/tableau-de-bord-web-maquette-805.png` |
| Verdict | **HOLD.** Le socle métier existe. La maquette fixe la mise en page du contenu. Les cinq lots ci-dessous sont le périmètre autorisé. La coque globale (sidebar, topbar) ne suit pas la maquette. |

---

## Verdict exécutif

`/tableau-de-bord` pour un rôle établissement n’est pas une page vide. C’est une grille de graphiques Recharts, filtrée par rôle et par permission, avec une période calendaire **par graphique** et un réordonnancement local. Ce n’est pas le tableau de bord décrit par #805.

La maquette reste la référence de mise en page. Ses chiffres sont fictifs et ne deviennent pas des constantes. Quand la maquette et une règle déjà verrouillée divergent, **la règle métier gagne**. Les écarts sont listés dans la section « Règles qui priment sur la maquette ».

L’isolation établissement, le RBAC, le taux de paiement et la présence du jour sont des contrats à conserver. La maquette redessine aussi la sidebar et la barre du haut : ce chrome est partagé par tout le back-office et **reste hors des cinq lots**. Le contenu de l’accueil établissement, lui, suit la maquette.

**Hors périmètre de tous les lots :**

- `ParentDashboardPage` et le routage Parent de `DashboardEntryPage`.
- Le tableau de bord plateforme (Super Admin, Admin Pays) et `dashboardChartConfig` plateforme.
- Mobile.
- Les formules canoniques de notes, présences, frais et impayés.
- `GET /api/audit` (journal plateforme, inutilisable comme fil établissement).
- Toute donnée codée en dur issue de la maquette.

---

## Maquette

Fichier versé pour les lots suivants : `docs/audits/evidence/tableau-de-bord-web-maquette-805.png` (1536×1024). L’issue citait `/Somafrik/Maquettes/tableau-de-bord-web.png`, absent du dépôt au moment du premier passage. La capture runtime actuelle, à ne pas prendre pour cible, reste `docs/user-guides/assets/web/02-tableau-de-bord-etablissement.png`.

Lecture de la zone **contenu** (c’est le contrat visuel des lots 1 à 4) :

```text
Titre « Tableau de bord »
Sous-titre « Vue d'ensemble de votre établissement »     [calendrier] Aujourd'hui

[Élèves] [Enseignants] [Classes] [Recettes (devise)]
 valeur     valeur        valeur    montant
 variation vs mois dernier, seulement si elle est calculable

+----------------------------------+  +----------------------+
| Évolution des effectifs          |  | Activités récentes   |
| sous-titre de la série           |  | pastille temps réel  |
| barres par mois de l'année       |  | 8 lignes typées      |
| sélecteur (menu ouvert) :        |  | lien vers l'objet    |
|   Effectifs                      |  | « Voir toutes les    |
|   Inscriptions                   |  |    activités »       |
|   Présences                      |  +----------------------+
|   Notes moyennes                 |
|   Recettes                       |
|   Impayés                        |
|   Par classe                     |
|   Par niveau                     |
+----------------+-----------------+
| Répartition    | Taux de présence |
| par niveau     | (aujourd'hui)    |
| donut + total  | anneau + légende |
+----------------+-----------------+
```

Le sélecteur ouvert sur la maquette met **Par classe** et **Par niveau** dans le même menu que les séries temporelles. Ce ne sont pas un second contrôle. « Effectifs » est une série mensuelle sur l’année scolaire (l’exemple trace Sept → Juin). « Par classe » et « Par niveau » changent le graphique en répartition, plus en courbe mensuelle.

Les huit lignes d’activité dessinées, comme **formes** et non comme données :

| Forme | Titre | Détail visible |
| --- | --- | --- |
| Inscription | Nouvel élève inscrit | nom, classe |
| Paiement | Paiement reçu | montant, devise, parent |
| Présence | Présence enregistrée | classe, présents / attendus |
| Note | Note saisie | matière, classe — pas la note chiffrée |
| Enseignant | Nouvel enseignant | nom, discipline |
| Communication | Message envoyé | objet, classe |
| Cours | Cours créé | matière, classe |
| Frais | Frais réglé | libellé de frais, montant |

« Frais réglé » et « Paiement reçu » sont deux libellés du même domaine financier. Un seul type d’événement paiement suffit s’il n’existe qu’une écriture. L’horodatage est relatif (« il y a 2 min »). Le lien « Voir toutes les activités » est la suite paginée du même fil, pas un nouveau module.

Chiffres de la maquette, **interdits en dur** : 1 248 élèves, 62 enseignants, 24 classes, 12 450 000, +5 %, +2 %, +1, +8 %, 92 %, 250 000, 500 000, Institut Nuruyetu, CD-KIN-26-0001, Kambale Samuel, Ndaya Marie. La légende de présence ne boucle pas : 1 148 + 80 + 20 + 12 = 1 260, alors que 1 148 / 1 248 = 92 %. Une seule population, un seul dénominateur.

### Ce que la maquette dessine et que les lots ne changent pas

La maquette redessine toute la coque :

- sidebar : Tableau de bord, Établissement, Scolarité, Élèves, Enseignants, Cours & Emplois du temps, Présences, Notes & Évaluations, Finance, Communication, Rapports, Paramètres, plus un encart « Besoin d'aide ? » ;
- topbar : nom d’établissement et code au centre, année scolaire à droite, cloche, identité.

Le produit actuel a une autre architecture, volontaire. `NAV_ITEMS` groupe Élèves, Enseignants et Classes dans « Mon établissement ». Le commentaire de `web/src/lib/constants.ts` laisse Messages, Annonces et Notifications dans la topbar, pas dans le menu. La topbar réelle ajoute recherche, rafraîchissement, messages, annonces, préférences et déconnexion. `HelpHost` couvre déjà l’aide.

Déplacer l’année scolaire dans la topbar globale la ferait apparaître sur toutes les routes. Les filtres année et date vivent donc dans l’en-tête **de la page** tableau de bord. La sidebar et la topbar ne sont pas dans les cinq lots. Un ticket de navigation séparé pourra plus tard mapper chaque entrée de la maquette vers une route existante, sans créer de module.

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

Les libellés de navigation ne sont pas à réécrire dans ces lots. Le chantier est le contenu de l’outlet établissement. L’écart de coque est décrit plus haut et reste hors lots.

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
| Recettes | `getPaymentRateKpi` sur `student_fee_obligations` | La 4e carte de la maquette est un **montant** encaissé, pas le taux. `collectedAmount` existe et n’est pas affiché. Multi-devises ou montant manquant → `—`. Le taux (`Σ amountPaid / Σ (amountDue − exemption)`) reste la formule du taux ; il n’est pas la carte. Le libellé de devise vient de l’obligation, pas du « FC » dessiné. Aucune variation « vs mois dernier » n’est stockée. |
| Impayés | `unpaidService.buildDashboard` | `totalAmountDue`, effectif, `byClass`. Utilisé par la page Finances, pas par l’accueil. |
| Inscriptions | table `enrollments` (`academic_year_id`, `enrollment_date`, `status`, `class_id`) | Pas de série dashboard. Le domaine Web `studentEnrollment.ts` connaît la source et le statut, pas un agrégat temporel d’accueil. |
| Présences | deux formules distinctes | Jauge dashboard : `(présents + retards) / lignes enregistrées` (`getPresenceStats`). KPI « Présence du jour » : `—` tant que l’appel n’est pas complet (`recorded !== expected`), fuseau `Africa/Kinshasa` par défaut. Une ligne manquante n’est pas une absence. |
| Notes moyennes | `gradeBook.ts` + `backend/lib/gradesCanonical.js` (`weightedAverage`) | Le graphique « Notes par cours » est un **comptage** de lignes, pas une moyenne. Les statuts absent / justifié / dispensé / non remis sont exclus de la moyenne. |
| Par niveau | `education_levels.name` (`level_code`, `display_order`, scopé pays puis `school_levels`) | Pas de colonne cycle. Maternelle / Primaire / Secondaire sur la maquette sont un exemple, pas une taxonomie à coder. Le dashboard groupe aujourd’hui par `className`. |
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

1. Aucun effectif, montant, pourcentage, nom ou code de la maquette n’est codé en dur.
2. La 4e carte affiche `collectedAmount` et la devise réelle. Multi-devises ou montant manquant → `—`. Cela n’abroge pas `getPaymentRateKpi` : le taux n’est simplement pas cette carte.
3. Pas de ligne « +5 % vs mois dernier » tant qu’un snapshot du mois précédent n’existe pas. La maquette mélange d’ailleurs un écart en effectif (`+1` classes) et des pourcentages.
4. « Taux de présence (aujourd’hui) » est le KPI du jour : `—` si l’appel est incomplet. La légende et le pourcentage partagent le même dénominateur. Pas de 92 % partiel. Le libellé « Taux de présence global » de la maquette n’est pas un second indicateur.
5. L’effectif élèves de la carte est le snapshot scolarité scopé, pas le sous-ensemble « actif sur la période ».
6. L’axe mensuel d’« Effectifs » suit `startDate` / `endDate` de l’année scolaire choisie. Sept → Juin n’est qu’un exemple.
7. Les parts du donut sont les `education_levels.name` actifs de l’établissement, dans `display_order`. Pas un regroupement Maternelle / Primaire / Secondaire inventé, et pas un découpage du nom de classe.
8. Une moyenne de notes passe par `gradeBook` / `weightedAverage`. Un comptage de copies n’est pas une moyenne. Le fil « Note saisie » ne publie pas la valeur.
9. Un impayé est le reste dû des obligations (`unpaidService`), pas le nombre de paiements au statut Impayé.
10. Une série dont le module n’est pas en `READ` n’apparaît pas, y compris dans le sélecteur.
11. Un enseignant ne voit que ses classes affectées. S’il n’a aucune affectation résolue, le repli actuel (portée établissement) reste en vigueur.
12. Parent, plateforme, sidebar et topbar ne changent pas.
13. La carte de configuration guidée reste au-dessus du nouveau contenu.
14. En démo, les domaines critiques continuent de bloquer l’affichage d’un effectif partiel.
15. Le fil d’activités ne lit pas `audit_logs.old_value` / `new_value` et n’ouvre pas `GET /api/audit` aux rôles établissement.

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

**Objectif.** Poser l’en-tête et les quatre cartes de la maquette, sans retirer les graphiques existants et sans toucher à la coque.

**Dans la PR**

- En-tête de page, accueil établissement seulement : titre « Tableau de bord », sous-titre « Vue d'ensemble de votre établissement », sélecteur d’année (`academicYearsApi.list()`, année `isCurrent` par défaut) et sélecteur de date dont la valeur par défaut est aujourd’hui. Ces deux contrôles restent dans la page. Pas dans `Topbar`.
- Quatre cartes, dans l’ordre de la maquette : Élèves, Enseignants, Classes, Recettes. Recettes = `collectedAmount` + devise de l’obligation. `—` si non calculable. Pas de ligne de variation. Un rôle sans `READ` sur le module ne voit pas la carte.
- Les profils `academic`, `finance` et `operations` ne gagnent pas une carte hors permission. `kpiItems` (utilisateurs actifs, présence du jour, taux, alertes) ne deviennent pas ces quatre cartes : ce sont d’autres indicateurs. Les afficher en plus, sous les quatre cartes, seulement s’ils sont déjà autorisés pour le profil. Ne pas les perdre en silence.
- En lot 1, l’année et la date sont affichées et mémorisées pour les lots 2 à 4. Elles ne recalculent pas encore la grille historique, qui garde son sélecteur par graphique jusqu’au lot 2.
- États chargement / vide / erreur de la rangée, y compris hors démo.
- Conserver `GuidedSchoolSetupDashboardCard`, la grille actuelle, le RBAC et la démo critique. Exception de largeur locale à cette page. `max-w-6xl` des autres routes ne bouge pas.

**Hors PR**

- Sélecteur métier, rail d’activités, donut par niveau, anneau de présence.
- Variation « vs mois dernier ».
- Changement de `getPaymentRateKpi`, `getTodayEstablishmentPresenceKpi`, `studentsScope`.
- Sidebar, topbar, encart d’aide, `ChartSettingsPage`.

**Fichiers touchés (prévision)**

- `web/src/pages/OverviewPage.tsx`
- `web/src/components/layout/AppLayout.tsx` (exception de largeur ciblée, ou conteneur local qui sort de `max-w-6xl` sans changer le layout global — préférer un conteneur local)
- nouveau composant de cartes sous `web/src/components/charts/` ou `web/src/components/dashboard/`
- tests Vitest de la rangée et du non-changement Parent / plateforme

**Terminé quand**

- Un admin établissement voit les quatre cartes, recettes en devise réelle ou `—`, sans pourcentage inventé.
- Un rôle sans `READ` Paiements ne voit pas Recettes.
- La grille de graphiques actuelle est encore là et ses tests passent.
- Sidebar et topbar identiques aux autres pages.
- Aucune constante de la maquette.

### Lot 2 — Graphique métier interchangeable

**Objectif.** Un graphique central, un sélecteur, pas de rechargement de page.

Ordre du menu, celui de la maquette. Une option sans `READ` est absente.

| Option | Géométrie | Unité | Source imposée |
| --- | --- | --- | --- |
| Effectifs | barres par mois entre `startDate` et `endDate` de l’année | élèves | effectif inscrit du mois, pas `activeStudentsInPeriod`. Titre « Évolution des effectifs ». |
| Inscriptions | barres par mois sur la même année | inscriptions | `enrollments` (`enrollment_date`, `status`, `academic_year_id`, `school_id`). Lecture scopée si le snapshot Web ne les porte pas. Pas le `createdAt` de la fiche élève. |
| Présences | barres par mois, volume d’appels enregistrés | lignes | `getPresenceStats` sur le mois. Ce n’est pas le KPI du jour. |
| Notes moyennes | barres par mois | points /20 | `gradeBook.ts` / `weightedAverage`. Interdit : compter les copies comme `notes-course`. |
| Recettes | barres par mois | devise unique | encaissé du mois. Multi-devises → état non calculable. |
| Impayés | barres par mois, ou reste dû du mois si la donnée n’a pas d’historique mensuel | devise | `unpaidService.buildDashboard`. Pas le donut de statuts de paiement. |
| Par classe | répartition, une barre ou part par classe | élèves | classes scopées. |
| Par niveau | répartition par `education_levels.name` | élèves | référentiel pays + `school_levels`. Sans niveau, état vide. Pas de taxonomie Maternelle / Primaire / Secondaire en dur. |

Le titre et le sous-titre changent avec l’option. L’exemple « Nombre d'élèves par mois sur l'année scolaire » ne reste affiché que pour Effectifs.

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
- UI alignée sur la colonne de la maquette : titre « Activités récentes », pastille verte seulement si le dernier poll a réussi, ligne avec icône, titre, détail, temps relatif, lien vers la route déjà existante. « Voir toutes les activités » charge la page suivante du même fil. Les huit formes du tableau maquette sont des libellés, pas huit jeux de données fictifs. « Note saisie » n’affiche pas la valeur.

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

- Donut « Répartition par niveau » : parts = niveaux actifs de l’établissement (`display_order`), total au centre = même effectif que la carte Élèves. Pas les trois cycles dessinés s’ils ne sont pas les niveaux réels. Pas un top 8 de `className`.
- Anneau « Taux de présence (aujourd'hui) » : formule `getTodayEstablishmentPresenceKpi`. Appel incomplet → `—` et légende vide, pas un pourcentage partiel. Présents, absents, retards et justifiés sont ceux de cette même population, et leur somme est le dénominateur. Le caption « Taux de présence global » n’est pas ajouté.
- Responsive de **cette page** : cartes en 1 colonne puis 2 ; graphique pleine largeur ; fil sous le graphique sous `lg`, à droite au-dessus. La sidebar existante (`lg`) et le drawer ne sont pas redessinés.
- Les états vide / erreur restent lisibles à 360 px et à largeur desktop.
- Accessibilité de la page : sélecteur et filtres étiquetés, fil annoncé comme liste, graphique central accompagné d’un résumé texte (la valeur ou « aucune donnée »), pas seulement un `canvas` Recharts. Le drag-and-drop de l’ancienne grille disparaît avec elle sur cet accueil ; ne pas réintroduire un drag sans alternative clavier.

**Hors PR**

- Nouveau breakpoint global, refonte Topbar, ou changement des autres pages dans `max-w-6xl`.
- Troisième formule de présence, ou regroupement de niveaux en cycles.
- Sidebar, topbar, encart « Besoin d'aide ? ».

**Terminé quand**

- Les parts du donut sont les niveaux canoniques, ou un état vide.
- Appel du jour incomplet → `—`, et la somme de la légende égale le dénominateur quand le taux est affiché.
- La page reste utilisable avec le drawer mobile déjà en place.

### Lot 5 — Tests E2E, sécurité et validation visuelle

**Objectif.** Verrouiller les lots 1 à 4. Pas de feature nouvelle.

**Dans la PR**

- Vitest : sélecteur, filtres, `—` taux et présence, RBAC du menu, non-régression Parent et plateforme.
- Intégration backend : pagination, déduplication, isolation `school_id`, masque par rôle.
- E2E dans le harness existant (`scripts/verify-e2e-*.js` ou équivalent node), pas une introduction de Playwright : parcours admin établissement, option interdite absente, activité de l’autre école absente.
- Sécurité : relire que `GET /api/audit` n’a pas changé de garde ; qu’aucun payload d’activité ne contient `old_value` ; que le changement d’établissement purge le fil (même contrat que DataContext RED-8).
- Visuel : comparer le contenu à `docs/audits/evidence/tableau-de-bord-web-maquette-805.png` (quatre cartes, sélecteur à huit entrées, deux graphiques du bas, fil). Ne pas comparer la sidebar ni la topbar, qui sont hors lots. Ne pas comparer les chiffres. La capture `02-tableau-de-bord-etablissement.png` est l’état avant.

**Hors PR**

- Correctifs produit découverts hors critères #805. Ils font un ticket séparé.

**Terminé quand**

- CI des suites touchées verte.
- L’écart visuel restant est limité à la coque (sidebar, topbar), documentée comme hors lots.

---

## Risques si le périmètre glisse

| Glissement | Conséquence |
| --- | --- |
| Coder 12 450 000, le « FC », ou « +8 % vs mois dernier » | Montant fictif. La carte recettes n’existe que si `collectedAmount` est calculable. |
| Réécrire la sidebar pour coller à la maquette | Contredit le menu actuel et le choix « communication dans la topbar ». |
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
La maquette de contenu est archivée. La coque (sidebar, topbar, aide) reste celle du produit.
