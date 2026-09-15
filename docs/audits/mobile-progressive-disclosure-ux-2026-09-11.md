# Audit UX Mobile — Progressive Disclosure (cartes compactes)

**Statut :** AUDIT UNIQUEMENT — **STOP. Attendre GO CTO avant toute implémentation.**  
**Périmètre :** application native `Mobile/` (Expo / React Native) exclusivement. Aucun Web. Aucun backend. Aucun changement fonctionnel, navigation, RBAC, API ou DB dans cette phase.  
**HEAD audité :** `develop@f4fdd6f05966b149eba0ddd494862b15f9b686d5` (`chore(mobile): add Android Firebase configuration`)  
**Date :** 2026-09-11  
**Méthode :** inventaire réel du graphe de navigation + lecture source de **tous** les écrans/composants rendus depuis `Mobile/`, y compris les fichiers hors suffixe `Screen` et les écrans historiques hors graphe live. Les captures fournies (Enseignants, Évaluations, Appel, Notifications, sélection de classes) ont servi de confirmation visuelle, pas de périmètre.

---

## 0. Verdict

La règle « collection d’objets = cartes synthétiques fermées ; détails et actions métier révélés après action explicite » **n’est pas appliquée uniformément**. Elle existe déjà, et elle est **testée**, sur trois îlots :

| Îlot | Composant | Tests de contrat |
| --- | --- | --- |
| Finance | `ExpandableFinanceCard` → `ExpandableEntityCard` | `pariteL1FinanceUx.test.ts` |
| Scolarité (Classes / Élèves / hub / années) | `ExpandableEntityCard` + exclusivité 1 carte | `pariteScolariteExpandableUx.test.ts` |
| Communication (Annonces / Notifications) | `ExpandableCommunicationCard` (fork local) | `pariteCommunicationUx.test.ts` |

Hors de ces îlots, les listes métier restent des **cartes locales toujours dépliées**. Les captures Enseignants / Évaluations / Appel correspondent exactement au code HEAD.

**Ne pas lancer une refonte globale en une seule PR.** Découper par modules. Imposer un contrat commun `collapsed / expanded`. Traiter l’Appel à part (vitesse de saisie ≠ accordion).

---

## 1. Périmètre, exclusions, méthode

### 1.1 Inclus

- Graphe live : `AppNavigator` + `BottomTabsNavigator` + drawer `roleDrawerPreferences`.
- Tous les `Mobile/src/screens/*` (y compris orphelins).
- Composants de liste rendus depuis ces écrans (`Expandable*`, `PaymentReceiptCard`, contrôles de mutation, `RoleDashboardLayout`, `MenuCard`, `OverflowActions`).

### 1.2 Exclus (volontaire, mandat)

- Web, backend, API, DB, RBAC, navigation.
- Implémentation, refactoring opportuniste, suppression d’écrans morts.
- Application mécanique du repli aux formulaires, login, dashboards KPI, menus, workspaces de saisie dont le contenu principal doit rester visible.

### 1.3 Classification

| Classe | Sens |
| --- | --- |
| **CONFORME** | Collection présentée en cartes compactes ; détails/actions secondaires masqués par défaut ; révélation par tap / chevron / CTA / fiche. |
| **PARTIELLEMENT CONFORME** | Pattern de repli ou de navigation présent, mais trop de méta ou une action métier fuit hors de la zone ouverte. |
| **NON CONFORME** | Collection d’objets avec détails **et/ou** actions métier toujours visibles. |
| **NON APPLICABLE** | Formulaire, login, KPI, menu, fiche unique, workspace de saisie, écran hors graphe sans collection à replier, ou atome UI. |

### 1.4 Preuves

Les preuves sont des extraits de code au HEAD ci-dessus. Les captures utilisateur confirment Enseignants, Évaluations, Appel (liste élèves + sélection classes) et Notifications. Aucun device Expo n’a été lancé (audit source, pas recette visuelle complémentaire).

---

## 2. Inventaire du graphe réel

### 2.1 Stack live — `Mobile/src/navigation/AppNavigator.tsx`

Enregistrement conditionné par `canReadRoute` / `canReadView` (fail-closed). `AdminCrud` est **typé** dans `RootStackParamList` mais **jamais enregistré** (« Type conservé pour compiler l'écran historique, jamais enregistré dans le graphe live »).

| Route | Composant | Titre nav |
| --- | --- | --- |
| `Welcome` | `WelcomeScreen` | (sans header) |
| `RoleSelection` | `RoleSelectionScreen` | Sélection de rôle |
| `Login` | `LoginScreen` | (sans header) |
| `Home` | `HomeTabs` → `BottomTabsNavigator` | (sans header stack) |
| `SchoolManagement` | `SchoolManagementScreen` | Gestion de l'établissement |
| `Teachers` | `TeachersScreen` | Enseignants |
| `Users` | `UsersScreen` | Utilisateurs |
| `Payments` | `PaymentsScreen` | Paiements |
| `Unpaid` | `UnpaidScreen` | Impayés |
| `Schooling` | `SchoolingHubScreen` | Scolarité |
| `Classes` | `ClassesScreen` | Classes |
| `Students` | `StudentsScreen` | Élèves |
| `TeacherStudents` | `StudentsScreen` | Mes élèves |
| `TeacherAttendance` | `TeacherAttendanceScreen` | Appel |
| `TeacherGrades` | `TeacherGradesScreen` | Notes |
| `StudentDetail` | `StudentDetailScreen` | Fiche élève |
| `StudentNotes` | `StudentNotesScreen` | Notes |
| `StudentPresences` | `StudentPresencesScreen` | Présences |
| `StudentPayments` | `StudentPaymentsScreen` | Paiements |
| `Announcements` | `AnnouncementsScreen` | Annonces |
| `Messages` | `MessagesScreen` | Messages |
| `Timetable` | `TimetableScreen` | Emploi du temps |
| `ReportCards` | `ReportCardsScreen` | Bulletins |
| `MobilePayment` | `MobilePaymentScreen` | Paiement mobile |
| `OfflineMode` | `OfflineModeScreen` | Mode hors ligne |
| `Synchronization` | `SynchronizationScreen` | Synchronisation |
| `Support` | `SupportScreen` | Support |
| `Configuration` | `ConfigurationScreen` | Paramètres |
| `EstablishmentProfile` | `EstablishmentProfileScreen` | Profil établissement |
| `SchoolYearSettings` | `SchoolYearSettingsScreen` | Année scolaire |
| `SchoolPedagogicalStructure` | `SchoolPedagogicalStructureScreen` | Structure pédagogique |
| `SchoolAssignableRoles` | `SchoolAssignableRolesScreen` | Rôles disponibles |
| `InternalNotifications` | `InternalNotificationsScreen` | Notifications |

Écran de bootstrap permissions (inline `AppNavigator`, pas une route) : **NON APPLICABLE**.

### 2.2 Bottom tabs live — `BottomTabsNavigator.tsx` + `roleTabCatalog.ts`

Toujours : onglet `Accueil` → `HomeScreen`. Puis jusqu’à 4 onglets métier (overflow = tabs cachés, actions rapides).

| Rôle | Onglets visibles (max 4) | Overflow possible |
| --- | --- | --- |
| `school_admin` | Élèves, Appel, Frais, Classes | Notes, Profs |
| `teacher` / `principal` / `prefet` / `proviseur` | Classes, Élèves, Appel, Notes | — |
| `secretary` | Élèves, Appel, Frais, Classes | — |
| `accountant` | Frais, Élèves | — |
| `parent_student` / `student` | Profil, Notes, Présence, Frais | — |
| `super_admin` / `country_admin` | Comptes | — |

### 2.3 Drawer live — `roleDrawerPreferences.ts`

Sections Quotidien / Admin / Outils, filtrées RBAC. Entrées listes : Élèves, Classes, Scolarité, Enseignants, Utilisateurs, Paiements, Impayés, Présences, Notes, EDT, Bulletins, Annonces, Messages, Notifications, Structure, Paramètres, Sync, Offline, Support. Ce n’est **pas** une collection métier à replier.

### 2.4 Fichiers `Screen` hors graphe live (inventoriés, non accessibles)

Confirmé : **aucun import** depuis le navigateur live.

| Fichier | Taille | Statut |
| --- | --- | --- |
| `AdminCrudScreen.tsx` | **3 378 L / ~116 Ko** | Historique. Cartes always-open + actions Modifier/Supprimer. |
| `SafeAdminCrudScreen.tsx` | 104 L | Gate autour d’AdminCrud. |
| `MenuScreen.tsx` | 346 L | Menu mort (#577 L0). |
| `PlatformNotificationsScreen.tsx` | 359 L | Orphelin, Web-only volontaire (#577). Cartes always-open (corps complet). |
| `PermissionsScreen.tsx` | 182 L | Matrice RBAC, hors graphe. |

Ces écrans **ne doivent pas** être réintroduits pour « aligner » l’UX. S’ils revivent un jour, le contrat ci-dessous s’applique.

### 2.5 Composants de collection (hors `Screen`)

| Composant | Rôle | Utilisé par |
| --- | --- | --- |
| `ExpandableEntityCard` | **Référence scolarité / finance** — titre, sous-titre, badge, chevron, `children` si ouvert, mode contrôlé | Classes, Élèves, Hub scolarité, Années, Finance (via alias) |
| `ExpandableFinanceCard` | Alias 1:1 de Entity | `PaymentReceiptCard`, Impayés |
| `ExpandableCommunicationCard` | **Fork** (tokens + state local, pas de mode contrôlé) | Annonces, Notifications internes |
| `PaymentReceiptCard` | Reçu finance sur Entity | Paiements, Paiements élève |
| `nextExclusiveExpandedKey` | Une seule carte ouverte | Scolarité seulement — **pas** Finance ni Communication |
| `OverflowActions` | Menu `…` → feuille d’actions | Mutations élève (déjà dans zone dépliée) |
| `StatusBadge` | Atome pastille | Finance, Annonces |
| `MenuCard` / `SectionCard` | Tuile nav / Paper | SchoolManagement ; `SectionCard` **aucun usage** |
| `RoleDashboardLayout` | Shell Accueil KPI + actions | HomeScreen |
| Contrôles `*MutationControls` | CRUD dans ou hors carte | Enseignants, Users, Élèves, Classes, Paiements, Annonces |

---

## 3. Modèles de référence déjà dans le code

### 3.1 Finance (contrat cible du mandat)

Carte **fermée** = identité + état (élève, montant/moyen/date, badge statut).  
Carte **ouverte** = référence, ventilation, libellés, CTA, annulation.

Preuve `PaymentReceiptCard` :

```47:89:Mobile/src/components/PaymentReceiptCard.tsx
    <ExpandableFinanceCard
      title={studentName || payment.studentName || "Élève"}
      subtitle={summaryMeta}
      badge={statusLabel}
      ...
    >
      ...
      {actions}
    </ExpandableFinanceCard>
```

### 3.2 Scolarité — Classes / Élèves

Même primitive Entity + **exclusivité** (`nextExclusiveExpandedKey`). Tap carte ≠ navigation ; CTA « Voir les élèves » / « Ouvrir la fiche » + mutations **dans** la zone ouverte.

### 3.3 Notifications / Annonces

Chevron + badge Lu/Non lu. Corps, PJ, Archiver, Marquer lu **uniquement** après expand. C’est le bon pattern communication — **pas** encore le composant commun (fork tokens).

### 3.4 Messages — exception volontaire

Contrat `pariteCommunicationUx.test.ts` : **interdit** `ExpandableCommunicationCard`. Liste de fils → modal de conversation. Correct : un fil n’est pas une fiche à déplier.

---

## 4. Matrice de conformité

Légende sévérité : **P0** surcharge quotidienne forte / actions métier exposées en masse ; **P1** même défaut sur surface moins fréquente ou fuite d’action ; **P2** densité mineure, tokens, orphelins.

### 4.1 Accueil, auth, chrome

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | Welcome | `WelcomeScreen.tsx` | Onboarding | — | — | NON APPLICABLE | — | Aucune |
| Auth | RoleSelection | `RoleSelectionScreen.tsx` | Choix de rôle | — | — | NON APPLICABLE | — | Aucune |
| Auth | Login | `LoginScreen.tsx` | Formulaire | — | — | NON APPLICABLE | — | Aucune |
| Accueil | `Home` / tab Accueil | `HomeScreen.tsx` + `RoleDashboardLayout.tsx` | KPI + actions rapides + identité | KPI toujours visibles (voulu) | Teaser « Dernière annonce » affiche le **corps** (parent) | NON APPLICABLE (dashboard) | P2 mineur | Ne pas replier les KPI. Option : teaser = titre seul, corps sur Annonces |
| Chrome | Drawer | `RoleNavigationDrawer.tsx` | Menu | chevron-forward | — | NON APPLICABLE | — | Aucune |
| Chrome | Header | `MobileAppHeader.tsx` | Actions globales | — | — | NON APPLICABLE | — | Aucune |

### 4.2 Scolarité / Élèves / Classes

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Scolarité | `Schooling` | `SchoolingHubScreen.tsx` | KPI + actions `ExpandableEntityCard` exclusives | Label action | Description + « Ouvrir » | CONFORME (contrat L0 existant) | P2 | Observer : ce sont des **entrées de menu** ; un tap de plus avant « Ouvrir ». Ne pas défaire sans GO. |
| Classes | `Classes` | `ClassesScreen.tsx` | Entity exclusive | Nom, effectif, badge présence | Statut, code, prof, « Voir les élèves », mutations | CONFORME | — | Référence à conserver |
| Élèves | `Students` / `TeacherStudents` | `StudentsScreen.tsx` | Entity exclusive | Nom, classe (si « toutes »), badge P/A/R/J | Matricule, sexe, statut, présence, « Ouvrir la fiche », mutations | CONFORME | — | Référence à conserver |
| Élèves | `StudentDetail` | `StudentDetailScreen.tsx` | Fiche + menu | Profil + stats + liens chevron | — | NON APPLICABLE | — | Destination, pas liste |
| Année | `SchoolYearSettings` | `SchoolYearSettingsScreen.tsx` | Liste années Entity ; formulaires hors accordion | Nom + « Année courante » | Dates + « Définir comme courante » | CONFORME (liste) / N/A (forms) | — | Conserver le split liste / formulaire |
| Structure | `SchoolPedagogicalStructure` | `SchoolPedagogicalStructureScreen.tsx` | Formulaires / checklists | — | — | NON APPLICABLE | — | Contrat existant : pas Entity |

### 4.3 Enseignants / Utilisateurs

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Enseignants | `Teachers` (tab overflow school_admin + stack + drawer) | `TeachersScreen.tsx` | Carte locale always-open `borderRadius: 22`, **sans chevron** | *Tout est « fermé » = tout est visible* | Code, matières, classes, statut, téléphone, **Modifier / Archiver** | **NON CONFORME** | **P0** | Entity : fermé = nom + badge statut (+ code en sous-titre). Ouvert = matières, classes, téléphone, mutations. Exclusivité. CTA header « créer / affecter » inchangés. |
| Utilisateurs | `Users` (tab plateforme + stack + Paramètres) | `UsersScreen.tsx` | Même pattern local que Enseignants | *Tout visible* | Identifiant, type métier, rôles, statut, école, email, téléphone, mutations | **NON CONFORME** | **P1** | Même contrat Entity. Fermé = nom + badge statut. Ouvert = méta + `UserMutationControls`. |

Preuve Enseignants (alignée captures) :

```87:98:Mobile/src/screens/TeachersScreen.tsx
          <View style={styles.card}>
            ...
              <Text style={styles.name} ...>{teacher.name || teacher.teacherCode}</Text>
              <Text style={styles.code}>{teacher.teacherCode || teacher.publicId}</Text>
              <Text style={styles.meta} ...>{teacherCourses.join(", ") || teacher.mainSubject || "Cours non renseignés"}</Text>
              <Text style={styles.meta} ...>Classes : {teacherClasses.join(", ") || "Non assignées"}</Text>
              {teacher.status ? <Text style={styles.meta}>Statut : {displayStatusName(teacher.status)}</Text> : null}
              {teacher.phone ? <Text style={styles.phone}>{teacher.phone}</Text> : null}
              <TeacherMutationControls row={teacher} onChanged={() => load()} />
```

### 4.4 Présences / Appel

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Appel | `TeacherAttendance` — **sélection classes** | `TeacherAttendanceScreen.tsx` | Cartes locales tap → workspace ; chevron-forward | Nom, `N élève(s) • cours`, `N appel(s) aujourd'hui` | Méta cours + historique du jour toujours visibles | **PARTIELLEMENT CONFORME** | **P1** | Fermé : nom + effectif + badge « Appel à faire / enregistré (N) ». Cours seulement s’il discrimine deux classes. **Conserver assez d’info pour choisir.** Pas d’accordion Entity : c’est une navigation d’écran. |
| Appel | `TeacherAttendance` — **liste élèves** | idem | Ligne always-open + **4 boutons** wrapping | Nom, matricule, arrivée, motif, « Statut : … • source » | `Présent / Absent / Retard / Justifié` × N élèves ; header Tout présent / Enregistrer | Densité **NON CONFORME** ; masquer les 4 actions = **NON APPLICABLE** | **P0** (densité) | Voir §5.3 — pattern **Roll-call compact**, pas accordion. |
| Appel | Header workspace (KPI, Tout présent, Enregistrer) | idem | Outils de saisie | — | — | NON APPLICABLE | — | Rester visibles |
| Présences élève/parent | `StudentPresences` / tab Presences | `StudentPresencesScreen.tsx` | Date + badge statut | Date, statut | Tap → fiche élève | **CONFORME** | — | Si motif/créneau arrivent plus tard : les mettre en expand |

Preuve 4 actions (alignée captures) :

```793:828:Mobile/src/screens/TeacherAttendanceScreen.tsx
            <View style={styles.statusActions}>
              {ATTENDANCE_ACTIONS.map((action) => (
                  <TouchableOpacity ... onPress={() => setAttendanceStatus(student.id, action)}
                    style={[styles.statusAction, ...]}>
                    ...
                    <Text ...>{action}</Text>
                  </TouchableOpacity>
              ))}
            </View>
```

`statusActions` = `flexWrap: "wrap"` + `minHeight: 44` → sur 360 dp les 4 libellés longs **passent souvent sur 2 lignes**, d’où la densité observée.

### 4.5 Évaluations / Notes / Bulletins / EDT

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Notes | `TeacherGrades` **liste évaluations** | `TeacherGradesScreen.tsx` | `historyCard` always-open | *Tout visible* | Classe, cours, période, statut, date, barème, coef, enseignant, progression, **Modifier / Valider / Publier / Saisir** | **NON CONFORME** | **P0** | Voir §5.2. **Conflit contrat L3** (§6). |
| Notes | `TeacherGrades` saisie roster | idem | Champ note + Abs par élève | Workspace | — | NON APPLICABLE | — | Ne pas replier |
| Notes | `TeacherGrades` create / edit | idem | Formulaires | — | — | NON APPLICABLE | — | Ne pas replier |
| Notes | `StudentNotes` / tab Notes | `StudentNotesScreen.tsx` | Ligne compacte + note | Titre, période•statut•barème, valeur | Tap → fiche élève (pas fiche note) | **PARTIELLEMENT CONFORME** | P2 | Fermé : titre + note. Période/statut/barème en expand. Ne pas naviguer vers la fiche élève pour « voir la note ». |
| Bulletins | `ReportCards` | `ReportCardsScreen.tsx` | Carte always-open | Élève, période, badge | Moyenne, rang, date, **Visionner le bulletin** | **NON CONFORME** | **P1** | Fermé : élève + période + statut. Ouvert : métriques + PDF. |
| EDT | `Timetable` créneaux | `TimetableScreen.tsx` | Carte always-open ; tap → form | Horaire, cours, classe, enseignant, salle, badge remplacement, **swap** | Tout + Remplacer | **NON CONFORME** | **P1** | Fermé : horaire + cours + classe + badge Remplacé. Ouvert : enseignant, salle, détail remplacement. Swap en zone ouverte (pas disparaître : action métier). Forms = N/A. |

Preuve évaluations (alignée captures) :

```838:891:Mobile/src/screens/TeacherGradesScreen.tsx
              <View key={evaluation.evaluationId} style={[styles.historyCard, ...]}>
                <Text style={styles.historyTitle}>{evaluation.title}</Text>
                <Text style={styles.meta}>{evaluation.className} • {evaluation.courseName} • {evaluation.periodName}</Text>
                <Text style={styles.statusBadge}>{evaluation.status}</Text>
                <Text style={styles.meta}>{evaluation.date} • /{evaluation.scale} • Coef. {evaluation.coefficient}</Text>
                <Text style={styles.meta}>{PEDAGOGY_COPY.teacher} : {evaluation.teacherName || "—"}</Text>
                <Text style={styles.meta}>{PEDAGOGY_COPY.progress} : {progression}</Text>
                <View style={styles.actionsRow}>
                  ... Modifier / Valider / Publier / Saisir-Consulter ...
```

### 4.6 Finance

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Frais | `Payments` / tab Paiements | `PaymentsScreen.tsx` + `PaymentReceiptCard` | Finance expandable ; KPI hero N/A | Élève, montant·moyen·date, badge | Réf., ventilation, annulation **dans** `actions` | **CONFORME** | — | Référence. Option P2 : exclusivité 1 carte (Scolarité l’a, Finance non). |
| Impayés | `Unpaid` | `UnpaidScreen.tsx` | Finance expandable | Nom, classe, badge montant dû | Période, attendu, alloué, reste, échéance | **CONFORME** | — | Aucune |
| Frais élève | `StudentPayments` / tab FraisEleve | `StudentPaymentsScreen.tsx` | Reçu expandable **mais** cancel frère JSX | Idem reçu | `PaymentCancelControls` **visible sans déplier** | **PARTIELLEMENT CONFORME** | **P1** | Passer `actions={<PaymentCancelControls …/>}` comme `PaymentsScreen`. |
| Paiement mobile | `MobilePayment` | `MvpUtilityScreens.tsx` | InfoCards MVP | — | — | NON APPLICABLE | — | Aucune |

Fuite d’action :

```222:226:Mobile/src/screens/StudentPaymentsScreen.tsx
          renderItem={({ item }) => (
            <>
              <PaymentReceiptCard payment={item} studentName={student?.name} currency={catalogCurrency} showItems />
              <PaymentCancelControls payment={item} onChanged={() => refreshFinance()} />
            </>
```

### 4.7 Communication

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Annonces | `Announcements` | `AnnouncementsScreen.tsx` | `ExpandableCommunicationCard` | Titre, origine, Lu/Non lu | Message, auteur, audience, badge, PJ, Archiver | **CONFORME** | — | Référence communication. Purger styles `card` morts. |
| Notifications | `InternalNotifications` | `InternalNotificationsScreen.tsx` | Idem chevron | Titre, expéditeur·date, Lu/Non lu | Corps, PJ, Voir paiement, Marquer lu, Archiver | **CONFORME** | — | Référence citée par les captures. Purger styles morts. Option : exclusivité. |
| Messages | `Messages` | `MessagesScreen.tsx` | Liste de fils + modal | Titre, badge unread, excerpt 1 ligne, date | Conversation en modal | **CONFORME** (thread, pas accordion) | — | Ne **pas** forcer Entity/CommunicationCard. |
| Notifs plateforme | *(hors graphe)* | `PlatformNotificationsScreen.tsx` | Always-open | Titre + **message complet** + méta + priorité | Tout | **NON CONFORME** | P2 orphelin | Rester hors graphe (#577). Si réactivation : CommunicationCard. |

### 4.8 Paramètres / établissement / outils

| Module | Écran / route | Fichier | État actuel | Infos carte fermée | Détails / actions exposés | Conformité | Sévérité | Correction UX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paramètres | `Configuration` | `ConfigurationScreen.tsx` | Hub nav titre+description | — | — | NON APPLICABLE | — | Menu, pas collection métier |
| Établissement | `EstablishmentProfile` | `EstablishmentProfileScreen.tsx` | Formulaire | — | — | NON APPLICABLE | — | Aucune |
| Établissement | `SchoolManagement` | `SchoolManagementScreen.tsx` | MenuCard | — | — | NON APPLICABLE | — | Aucune |
| Rôles | `SchoolAssignableRoles` | `SchoolAssignableRolesScreen.tsx` | Catalogue always-open | Nom, code, **toutes** les permissions en badges | Tout | **NON CONFORME** | **P2** | Fermé : nom + `N permissions`. Ouvert : badges. Lecture seule, pas d’actions métier. |
| Outils | Support / Offline / Sync | `MvpUtilityScreens.tsx` | InfoCards | — | — | NON APPLICABLE | — | Aucune |

### 4.9 Historique hors graphe

| Module | Écran | Fichier | Conformité | Note |
| --- | --- | --- | --- | --- |
| CRUD générique | AdminCrud | `AdminCrudScreen.tsx` (~116 Ko) | NON CONFORME | Hors graphe. Ne pas réactiver. |
| Gate | SafeAdminCrud | `SafeAdminCrudScreen.tsx` | N/A | Wrapper |
| Menu | MenuScreen | `MenuScreen.tsx` | N/A | Mort L0 |
| RBAC | Permissions | `PermissionsScreen.tsx` | N/A | Hors graphe |

---

## 5. Priorités déjà confirmées par captures + code

### 5.1 Enseignants — P0

**Carte fermée cible**

- Titre : nom
- Sous-titre : code enseignant (identifiant)
- Badge : statut (`Actif` / `Inactif` via `displayStatusName`)
- Chevron Entity

**Carte ouverte**

- Matières / cours
- Classes
- Téléphone
- `TeacherMutationControls` (Modifier / Archiver)

Header d’écran (créer, affecter un cours) : **hors liste**, inchangé.

### 5.2 Évaluations — P0 + conflit de contrat

Restructuration cible (proposition, **GO CTO requis** à cause de PED-L3-12) :

**Fermée**

- Titre
- Sous-titre : `classe • cours`
- Badge : statut
- Signal d’état : progression `N/M` (aide à la décision, P4) — pas date/barème/coef/enseignant

**Ouverte**

- Période, date, barème, coefficient, enseignant
- Modifier / Valider / Publier

**CTA primaire « Saisir les notes » / « Consulter »** — deux options :

| Option | Comportement | Pour | Contre |
| --- | --- | --- | --- |
| **A (recommandée)** | Visible même carte fermée (1 bouton primaire) | P3 workflow, appel quotidien Notes | Moins « Finance pur » |
| B | Uniquement après expand | Strict contrat Finance | Un tap de plus avant la saisie |

Roster de saisie : **ne pas** accordion.

### 5.3 Appel — P0 densité, pattern spécial

**Ne pas sacrifier la vitesse.** Les 4 statuts restent actionnables **sans** ouvrir une carte Entity.

**Ligne élève — Roll-call compact (proposé)**

| Zone | Toujours visible | Après tap sur l’identité |
| --- | --- | --- |
| Identité | Nom + pastille statut courant | Matricule, arrivée, motif, source |
| Actions | 4 commandes **une rangée**, cibles ≥ 44 dp | — |
| Header classe | KPI, Tout présent, Enregistrer | — |

Compactage des 4 boutons (360 dp) :

1. Libellés courts `P / A / R / J` **ou** icônes + `accessibilityLabel` complet (`Présent pour {nom}`).
2. Interdire le wrap 2 lignes si possible (`flexWrap: "nowrap"` + largeur égale).
3. Couleur + icône déjà présentes : les conserver (DO-004 : la couleur ne porte pas seule le sens → garder label a11y).

**Interdit :** cacher Présent/Absent/Retard/Justifié derrière un chevron.

**Sélection de classes — P1**

Fermée : **nom + N élèves + badge appel du jour** (assez pour choisir).  
Cours : seulement collision de noms. Chevron-forward = navigation, pas expand.

### 5.4 Notifications — déjà la bonne grammaire

Peut servir de **référence comportementale** Communication. Ne pas en faire le composant unique : tokens et API diffèrent d’Entity (§7). Unifier le **contrat**, pas forcément le fichier du jour 1.

---

## 6. Conflits de contrats existants (bloquants avant implémentation)

Toute PR d’alignement **sans** amender ces tests cassera le CI actuel.

| Contrat actuel | Exigence | Collision avec progressive disclosure |
| --- | --- | --- |
| `docs/audits/parite-l3-pedagogie-ux-maquette.md` §1 + **PED-L3-12** | Carte évaluation Mobile affiche coef, enseignant, date, progression **sur la liste** | Ces champs doivent passer en zone ouverte |
| Tests Communication | Messages **sans** ExpandableCommunicationCard | Ne pas « uniformiser » Messages en accordion |
| Tests Scolarité | Hub actions en Entity ; Structure **sans** Entity ; fiche élève **sans** Entity | Ne pas replier fiche / formulaires |
| Finance L1 | Détails reçus au dépliage | Référence à **étendre**, pas à défaire |

**Décision CTO requise avant Lot B (Notes) :** amender PED-L3-12 + maquette L3 (« champs visibles » = résumé fermé + détail ouvert), et choisir option A ou B pour le CTA Saisir.

---

## 7. Divergences de composants et de style

### 7.1 Trois (en réalité deux) implémentations du même pattern

```
ExpandableEntityCard          ← primitive scolarité, mode contrôlé, badgeContent, exclusivité possible
  └── ExpandableFinanceCard   ← alias 1 ligne
ExpandableCommunicationCard   ← fork copié-collé : state local, pas de expanded contrôlé, pas de badgeContent
+ N cartes locales            ← Teachers, Users, Attendance, Grades, ReportCards, Timetable, AssignableRoles
```

### 7.2 Tokens

| Token | Entity / Finance | Communication | Cartes locales (ex. Teachers / Appel) |
| --- | --- | --- | --- |
| `borderRadius` | **18** | **12** | **22** (Teachers, selectClass) / **18** (Users, studentRow, historyCard) / **20** (bulletins) / **24** (classCard appel) |
| Bordure | `#D9E1EC` 1 px | `#E2E8F0` | Souvent **aucune** (ombre absente, carte blanche) |
| `marginBottom` | 12 | 8 | 10–14 |
| `summary.minHeight` | **68** | **44** | variable ; Appel actions 44 |
| Padding | 14 / 12 | 12 / 10 | 16 courant |
| Titre | 16 / 800 | 15 / 800 | 17–20 / 900 |
| Sous-titre | 13, **2 lignes** | 12, **1 ligne** | méta 600–700, souvent 3 lignes |
| Badge | tones default / **warning** / danger | default / **info** / danger | texte brut ou pastille locale |
| Chevron | Ionicons 20 up/down | idem | absent (Teachers, Users, Grades, Bulletins) ; **forward** (Appel classes, fiche, drawer) |
| Contrôle expand | `expanded` + callback | state interne seulement | aucun |
| Exclusivité 1 carte | Scolarité oui | non | non |
| Fond page | `#F8FAFC` | `#F8FAFC` | Paramètres `#F4F7FB` |

Boutons : primary `#2563EB` radius **12–16**, minHeight 44. Pas de primitive bouton partagée pour les CTA de carte ouverte (`openButton` recopié Classes / Élèves / Finance).

Typographie : mélange 800 / 900 ; Communication plus dense (liste inbox), Entity plus confortable (identité).

### 7.3 Recommandation design system (après GO, pas dans cet audit)

1. **Une** primitive `ExpandableEntityCard` (Finance = alias conservé pour tests).
2. Communication = même primitive + `density: "compact"` **ou** tokens Entity partout — **décision CTO** (inbox vs fiche).
3. Ajouter `expanded` contrôlé + `badgeContent` à l’unique primitive (aujourd’hui seulement Entity).
4. Exclusivité : listes longues (enseignants, users, classes, élèves, évaluations). Pas obligatoire inbox Communication ni reçus Finance (listes plus courtes / scan).
5. Pattern **Roll-call** : composant dédié, **pas** Entity.
6. Messages : liste + modal, inchangé.

---

## 8. Contrat UX Mobile commun (proposition — pas encore normatif)

À figer par GO CTO, puis tests RED **avant** le premier lot d’implémentation.

### 8.1 Règle

> Une **collection d’objets métier** se présente en cartes synthétiques **fermées par défaut**.  
> La carte fermée permet d’**identifier** l’objet et son **état**.  
> Détails secondaires et actions métier (sauf exception documentée) se révèlent après **tap / chevron / « Voir détails » / ouverture de fiche**.

Aligne P2 (résumé), P7 (une primaire), P11 (cohérence), P13 (réutiliser une primitive).

### 8.2 Carte fermée — contenu autorisé

- Identité (nom / titre / horaire+cours)
- Un sous-titre discriminant (classe, code, `classe • cours`)
- Un badge d’état (statut, lu/non lu, montant dû, P/A)
- Chevron ou destination explicite
- **Au plus une** action primaire si le workflow quotidien l’exige (Saisir, 4 statuts d’appel) — exception **nommée** dans le lot

### 8.3 Carte ouverte — contenu

- Méta (dates, coef, contacts, audience, ventilation)
- Actions secondaires (Modifier, Archiver, Valider, Publier, PDF, Remplacer)
- Sous-listes (lignes de paiement, PJ)

### 8.4 Exceptions nommées (ne pas accordion)

| Surface | Pourquoi |
| --- | --- |
| Login, welcome, role selection | Auth |
| Accueil KPI + actions rapides | Dashboard P-004 |
| Menus (drawer, Paramètres hub, SchoolManagement) | Navigation |
| Formulaires (création évaluation, profil établissement, structure pédagogique, composer message) | Contenu principal = champs |
| Fiche élève | Destination P-003 |
| Roster saisie de notes | Workspace |
| **Appel — 4 statuts** | Vitesse métier — pattern Roll-call |
| Messages | Fil → modal |
| États loading / empty / error | P9 |

### 8.5 Comportement

- `defaultExpanded = false`
- `accessibilityState.expanded` + label « Afficher / Masquer les détails »
- Cible tactile résumé ≥ 44 dp (Entity vise 68)
- Listes longues : une carte ouverte à la fois
- Tap résumé bascule ; CTA internes n’utilisent pas le même handler que le résumé
- Pas de navigation implicite sur le tap résumé si une fiche existe : CTA « Ouvrir la fiche » dans la zone ouverte (déjà Classes / Élèves)

### 8.6 Tokens cibles (à geler)

Proposition d’alignement sur Entity (déjà Finance + Scolarité) :

- Radius carte **18**, bord `#D9E1EC`, fond `#FFFFFF`, page `#F8FAFC`
- Badge pill 999, `StatusBadge` pour les statuts métier
- CTA zone ouverte : minHeight 44, radius 12

Communication compact : seulement si le CTO refuse d’aligner l’inbox sur 18/68.

---

## 9. Liste P0 / P1 / P2

### P0 — quotidien dense, actions métier exposées

| ID | Surface | Problème | Lot |
| --- | --- | --- | --- |
| PD-01 | Enseignants | Méta + Modifier/Archiver always-on | A |
| PD-02 | Évaluations liste | 8+ champs + 4 actions always-on | B (après amendement L3) |
| PD-03 | Appel roster | 4 boutons × N + méta secondaire | C (pattern dédié) |

### P1

| ID | Surface | Problème | Lot |
| --- | --- | --- | --- |
| PD-04 | Utilisateurs | Clone du défaut Enseignants | D |
| PD-05 | Paiements élève | Cancel hors expand | D (diff minimal) |
| PD-06 | Bulletins | Métriques + PDF always-on | E |
| PD-07 | EDT créneaux | Méta + swap always-on | E |
| PD-08 | Appel — sélection classes | Cours + compteur trop verbeux | C (même écran que PD-03) |

### P2

| ID | Surface | Problème | Lot |
| --- | --- | --- | --- |
| PD-09 | Notes élève/parent | Méta secondaire + tap vers mauvaise destination | F |
| PD-10 | Rôles disponibles | Toutes permissions visibles | F |
| PD-11 | Teaser Accueil annonce | Corps déjà lu | F optionnel |
| PD-12 | Hub Scolarité actions | Extra tap sur un menu | Observer, pas corriger d’office |
| PD-13 | Tokens Entity vs Communication vs locales | Radius 12/18/20/22/24, chevrons hétérogènes | F (après primitive unique) |
| PD-14 | AdminCrud / PlatformNotifications / MenuScreen | Always-open **hors graphe** | Ne pas toucher |
| PD-15 | Finance / Communication sans exclusivité | Écart mineur vs Scolarité | Optionnel |
| PD-16 | Styles morts Annonces/Notifications | Cartes locales non utilisées | Purge avec lot Communication tokens |

---

## 10. Plan de migration par lots (après GO)

**Règle :** une PR = un lot = un module (ou un diff minimal type PD-05). Pas de « alignement UX global ».

Chaque lot : **tests RED ciblés → correction → GREEN**, puis **diff GitHub indépendant au HEAD exact** avant Ready/merge.

### Lot 0 — Contrat (docs + tests RED, 0 changement UI)

- Adopter §8 dans `docs/ux/` (nouvelle DO ou avenant patterns Mobile).
- Tests RED machine : « Teachers/Users/Grades list ne doivent plus rendre mutations dans le résumé » — **volontairement rouges** jusqu’aux lots A/B/D.
- Trancher : CTA Saisir option A/B ; densité Communication ; exclusivité Finance.

Sans GO sur le Lot 0, ne pas coder A–F.

### Lot A — Enseignants (PD-01)

- Remplacer la carte locale par `ExpandableEntityCard` + exclusivité.
- Mutations **uniquement** en `children`.
- Tests GREEN calqués sur `pariteScolariteExpandableUx.test.ts`.
- Recette manuelle : school_admin overflow « Profs » + drawer Enseignants.

### Lot B — Évaluations liste (PD-02)

- **Préalable :** amendement PED-L3-12 + maquette L3.
- Entity (ou primitive unifiée) sur `historyCard`.
- Roster / formulaires inchangés.
- Tests : résumé sans Valider/Publier/Modifier ; progression + statut visibles fermés ; Saisir selon option CTO.

### Lot C — Appel (PD-03 + PD-08)

- **Pas** Entity sur le roster.
- Nouveau pattern / styles compact (icônes ou P/A/R/J, nowrap, identité repliable).
- Sélection classes : badge état d’appel, méta cours réduite.
- Tests : les 4 `accessibilityLabel` d’action restent sur la ligne **sans** expand ; `attendance-class-list` conserve nom + effectif.
- Recette : appel 20+ élèves à 360 dp — une rangée d’actions, scroll plus court.

### Lot D — Utilisateurs + fuite Finance élève (PD-04, PD-05)

- Users = même recette que Lot A (peut suivre A immédiatement, PR séparée).
- StudentPayments : 5 lignes, `actions={...}` — PR isolée possible **dès GO**, très faible risque.

### Lot E — Bulletins + EDT (PD-06, PD-07)

- Entity ou primitive ; CTA PDF / Remplacer en zone ouverte.
- Forms EDT inchangés.

### Lot F — P2

- StudentNotes, AssignableRoles, tokens Communication, purge styles morts.
- **Ne pas** réécrire AdminCrud / MenuScreen / PlatformNotifications.

### Hors lot

- Web, backend, RBAC, nouvelles routes.
- Fusionner CommunicationCard dans Entity **sans** décision densité.
- Replier l’Appel en accordion.
- Forcer Messages en cartes dépliables.

---

## 11. Tests RED cibles (pour les futures PRs, pas cette PR)

À écrire **avant** le code UI, dans l’esprit des contrats existants (`pariteL1FinanceUx`, `pariteScolariteExpandableUx`, `pariteCommunicationUx`) :

1. `TeachersScreen` : `TeacherMutationControls row=` est **dans** `ExpandableEntityCard` children ; absent du résumé (title/subtitle/badge).
2. Idem `UsersScreen` / `UserMutationControls`.
3. `TeacherGradesScreen` liste : `historyCard` / Entity ; `Valider`/`Publier`/`Modifier` absents du résumé ; `PEDAGOGY_COPY.progress` + statut présents fermés (si option retenue).
4. Appel : `ATTENDANCE_ACTIONS` toujours rendus dans `renderItem` hors bloc expand ; identité n’affiche plus `arrivalTime`/`reason` dans le résumé.
5. `StudentPaymentsScreen` : `PaymentCancelControls` passé via `actions` de `PaymentReceiptCard`, pas frère JSX.
6. Exclusivité `nextExclusiveExpandedKey` sur Teachers / Users / Grades list.
7. `defaultExpanded = false` conservé sur la primitive.
8. Viewports 360 / 390 / 430 et min touch 44 (déjà `UX_V1_VIEWPORTS`).

Aucune de ces assertions n’est ajoutée dans **cette** PR d’audit (sinon CI rouge sans GO).

---

## 12. Synthèse chiffrée (graphe live uniquement)

Surfaces avec collection d’objets métier (hors N/A) :

| Classe | Nb | Surfaces |
| --- | --- | --- |
| CONFORME | 11 | Classes, Élèves, Années (liste), Paiements, Impayés, Reçu, Annonces, Notifications, Messages (thread), Présences élève, Hub scolarité |
| PARTIELLEMENT CONFORME | 4 | Appel sélection classes, Paiements élève, Notes élève, (Appel roster : densité seulement) |
| NON CONFORME | 5 | **Enseignants**, **Évaluations liste**, **Utilisateurs**, **Bulletins**, **EDT créneaux** |
| NON APPLICABLE | le reste | Auth, Accueil KPI, menus, forms, fiche, saisie notes, outils, bootstrap |

Primitive partagée utilisée : **3 familles d’écrans**. Cartes locales still-open : **Teachers, Users, Grades, Attendance, ReportCards, Timetable, AssignableRoles**.

---

## 13. STOP

**Aucune implémentation dans cette phase.**  
Attendre **GO CTO** sur :

1. Adoption du contrat §8 (dont exceptions Appel + Messages + CTA Saisir option A/B).
2. Amendement PED-L3-12 / maquette pédagogie L3.
3. Ordre des lots (recommandé : **0 → D(PD-05) → A → C → B → D(Users) → E → F** ; PD-05 peut partir seul).

Ensuite seulement : tests RED du lot → PR d’implémentation **un module** → GREEN → diff GitHub indépendant au HEAD exact avant Ready/merge.
