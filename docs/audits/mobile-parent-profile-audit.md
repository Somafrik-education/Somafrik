# Audit Mobile — Profil Parent

Phase constat uniquement. Aucune correction métier. Aucun changement Web. Aucun changement Backend fonctionnel. Aucun merge. PR Draft.

## Base auditée

```text
origin/develop = 84a6f9803146527b01602db9319c5b3b6a412327
branche        = cursor/audit-mobile-parent-profile-5cab
commande       = git fetch origin develop && git switch -c cursor/audit-mobile-parent-profile-5cab
```

```text
git rev-parse origin/develop
84a6f9803146527b01602db9319c5b3b6a412327

git rev-parse HEAD   (au moment du branchement)
84a6f9803146527b01602db9319c5b3b6a412327

git status --short   (arbre develop propre)
(vide)

git log --oneline --decorate -10
84a6f980 (origin/develop, develop) Merge pull request #739 from Somafrik-education/fix/school-subject-create-tenant
3ddd6f6d test(subjects): cover tenant-safe course creation on web/mobile API
28e8e64c fix(subjects): scope delete route to current school
abbbfc13 fix(subjects): isolate catalog writes and reads per school
4ac55446 fix(subjects): scope subject codes by school
799a9519 Merge pull request #727 from Somafrik-education/feat/school-setup-wizard
624c84da fix(setup): drop request-time guided schema ensure
61621ae9 test(setup): RED forbid request-time guided schema ensure
88f514ef test(setup): disambiguate Accueil after Terminer in Expo smoke
00690ae5 test(setup): make guided Expo smoke free the recette port
```

Le nom de branche demandé (`audit/mobile-parent-profile`) n'a pas été utilisé : la convention Cloud impose `cursor/<descriptive-name>-5cab`.

## HEAD

Le HEAD de la PR d'audit est le commit qui ajoute ce rapport et les tests RED. Voir la PR Draft.

## Périmètre

| Inclus | Exclu |
|--------|--------|
| `Mobile/` Expo / React Native | Web |
| Rôle canonique `parent_student` / `PARENT` | Refactoring opportuniste |
| Navigation, écrans, composants, API et état utilisés par le Parent | Changement fonctionnel Backend |
| Fuite RBAC vers un autre rôle (constat uniquement) | Changement de schéma PostgreSQL |
| Tests d'audit pouvant rester RED | Merge / Ready |

Rôle canonique observé : `parent_student` ↔ `PARENT` (`Mobile/src/lib/canonicalRoleIdentity.ts`). Alias historiques encore présents dans quelques gardes : `parent`, `Parent`, `eleve`.

## Architecture observée

```text
Welcome → RoleSelection (code établissement) → Login (identify + PIN)
        → persistAuthenticatedSession (SecureStore)
        → AuthContext.saveSession (selectedStudentId = children[0] | linkedStudent)
        → GET /auth/effective-permissions
        → Home = BottomTabs (Accueil + 4 onglets) + drawer rôle
```

| Couche | Mécanisme | Fichier |
|--------|-----------|---------|
| Stack | `canReadRoute` / `canReadView` | `Mobile/src/navigation/AppNavigator.tsx` |
| Tabs | `parentStudentTabs` max 4 | `Mobile/src/navigation/roleTabCatalog.ts` |
| Drawer | `parentItems` + filtre permission | `Mobile/src/navigation/roleDrawerPreferences.ts` |
| Accueil | coque `PARENT` | `Mobile/src/lib/roleHomeConfig.ts` |
| Enfant | `selectedStudentId` mémoire uniquement | `Mobile/src/context/AuthContext.tsx` |
| Scope listes | `sessionStudentAliasKeys` + `filterRowsByStudentScope` | `Mobile/src/lib/canonicalStudentIdentity.ts` |
| HTTP | Bearer + `X-Somafrik-School-Code` optionnel | `Mobile/src/services/httpClient.ts` |

`AuthResolver` (`Mobile/src/domain/auth/AuthResolver.ts`) identifie un parent par `student.parentPhone` **en local**. Il n'est **pas** branché sur `LoginScreen` (runtime = `POST /identify` + `POST /login`).

## Parcours Parent actuel

1. **Welcome** — CTA vers `RoleSelection`.
2. **Identification établissement** — saisie du code école, `GET /schools/:code`.
3. **Login** — identifiant (téléphone / email / code) → `POST /identify` → badge « Parent » → PIN 6 chiffres → `POST /login`.
4. **Session** — `user.children` fourni par le login ; `selectedStudentId` = premier enfant.
5. **Accueil** — « Espace parent », identité visuelle = **nom de l'enfant**, KPIs présence / moyenne / paiements / messages.
6. **Tabs** — Profil (fiche enfant) · Notes · Présence · Frais.
7. **Drawer** — Notes, Présences, Bulletins, Paiements (MVP mobile), Messages, Annonces, Notifications, Mode hors ligne, Support, aide, préférences comm, légal, logout.
8. **Déconnexion** — `logout()` + `reset` vers `Welcome`.

Il n'existe **aucun écran Profil compte Parent** (nom, prénom, téléphone, email, identifiant utilisateur). L'onglet intitulé « Profil » ouvre la fiche **élève**.

## Inventaire des écrans

Écran :
Welcome
Route/navigation :
`Welcome` (stack public, `initialRouteName` si non authentifié)
Fichier :
`Mobile/src/screens/WelcomeScreen.tsx`
Composants principaux :
logo, CTA, liens légal
API utilisées :
aucune
Données affichées :
marque Somafrik
RBAC appliqué :
aucun
État :
- OK

Écran :
Sélection établissement
Route/navigation :
`RoleSelection`
Fichier :
`Mobile/src/screens/RoleSelectionScreen.tsx`
Composants principaux :
`FormField`, logo école
API utilisées :
`GET /schools/:code` (`getSchoolByCode`)
Données affichées :
nom, ville, code établissement
RBAC appliqué :
aucun (pré-auth). Raccourcis `SUPERADMIN` / `ADMINPAYS-*` vers login plateforme.
État :
- OK

Écran :
Connexion Parent
Route/navigation :
`Login`
Fichier :
`Mobile/src/screens/LoginScreen.tsx`
Composants principaux :
`FormField`, badge rôle, modal changement de mot de passe
API utilisées :
`POST /identify`, `POST /login`, `POST /auth/change-password`, `persistAuthenticatedSession`
Données affichées :
école, rôle identifié, PIN
RBAC appliqué :
libellés PIN si `identity.role === "parent_student" || "student"`
État :
- OK

Écran :
Accueil Parent
Route/navigation :
`Home` → tab `Accueil`
Fichier :
`Mobile/src/screens/HomeScreen.tsx`
Composants principaux :
`RoleDashboardLayout`, `StudentSwitcher`, `StudentsScopeAlert`
API utilisées :
`loadNotes`, `loadPresences`, `loadPayments`, `loadStudentFees`, `loadAnnouncements`, `loadMessages`, `loadStudents` (si `Élèves:READ`)
Données affichées :
nom/classe de l'enfant, KPIs présence, moyenne, paiements, messages, dernière annonce
RBAC appliqué :
`canReadRoute` / `homeShellPermissions` / `canAccessMessagesRoute`
État :
- PARTIEL (identité = enfant ; charge aussi les datasets staff via `canReadEntity`)

Écran :
Profil (libellé UI)
Route/navigation :
tab `Profil` + stack `StudentDetail`
Fichier :
`Mobile/src/screens/StudentDetailScreen.tsx`
Composants principaux :
`ExpandableEntityCard`, `StudentSwitcher`, actions C18 / liaison parent
API utilisées :
`GET /students/:id`, `listStudentEnrollments`, `GET /parents/relations`, mutations C18 / `POST /parents/link`
Données affichées :
identité enfant, matricule, sexe, naissance, classe, statut inscription, `schoolCode`, responsables, compteurs notes/présences/paiements
RBAC appliqué :
`Élèves:READ` ; mutations C18 via `canMutateC18Mobile` (trou `parent_student`) ; link via tokens `Relations:*`
État :
- PARTIEL (fiche enfant, pas profil Parent) / CASSÉ si `Élèves:UPDATE` live

Écran :
Notes
Route/navigation :
tab `Notes` + stack / drawer `StudentNotes`
Fichier :
`Mobile/src/screens/StudentNotesScreen.tsx`
Composants principaux :
`StudentSwitcher`, `QueryStateView`, chips cours
API utilisées :
`getNotes` via `AdminDataContext`
Données affichées :
moyenne /20, matière, période, statut, note/barème
RBAC appliqué :
`Notes:READ`
État :
- PARTIEL (`route.params.studentId` prime sur le switcher ; bouton retour sur onglet racine)

Écran :
Présences
Route/navigation :
tab `Presences` + stack / drawer `StudentPresences`
Fichier :
`Mobile/src/screens/StudentPresencesScreen.tsx`
Composants principaux :
`StudentSwitcher`, `FlatList`
API utilisées :
`getPresences`, `getStudents`
Données affichées :
taux, présents/total, justifiés, date + statut
RBAC appliqué :
`Présences:READ`
État :
- PARTIEL (pas de loader/erreur/retry ; même override `studentId`)

Écran :
Paiements enfant
Route/navigation :
tab `FraisEleve` + stack `StudentPayments` (Home action « Paiements »)
Fichier :
`Mobile/src/screens/StudentPaymentsScreen.tsx`
Composants principaux :
`PaymentReceiptCard`, `PaymentMutationControls`, `QueryStateView`
API utilisées :
`GET /payments`, frais élève, `GET /finance/payment-student-options`, `GET /finance/catalog`
Données affichées :
attendu, imputé, reste, encaissé, non imputé, historique, devise, classe
RBAC appliqué :
`Paiements:READ` ; encaissement si CREATE (Parent defaults = non)
État :
- PARTIEL (écran riche OK ; `pickerStudents` = options API non recoupées aux enfants)

Écran :
Paiements drawer
Route/navigation :
drawer `MobilePayment`
Fichier :
`Mobile/src/screens/MvpUtilityScreens.tsx` (`MobilePaymentScreen`)
Composants principaux :
`InfoCard`
API utilisées :
`paymentsData` hydraté
Données affichées :
total payé, nombre de reçus, nombre d'enfants
RBAC appliqué :
`Paiements:READ`
État :
- PARTIEL (MVP, pas de Mobile Money ; doublon UX)

Écran :
Bulletins
Route/navigation :
drawer `ReportCards`
Fichier :
`Mobile/src/screens/ReportCardsScreen.tsx`
Composants principaux :
`ReportCardSnapshotView`, PDF
API utilisées :
publications / snapshot / PDF bulletins
Données affichées :
bulletins publiés filtrés par scope enfant
RBAC appliqué :
`Bulletins:READ` ; workflow staff masqué si rôle parent
État :
- PARTIEL (pas de `StudentSwitcher`)

Écran :
Messages
Route/navigation :
drawer + icône header + KPI Home → `Messages`
Fichier :
`Mobile/src/screens/MessagesScreen.tsx`
Composants principaux :
`CommunicationChrome`, `StudentSwitcher`, composer
API utilisées :
conversations / destinataires / envoi backoffice
Données affichées :
fils, messages, pièces jointes
RBAC appliqué :
`canAccessMessagesRoute` ; composer si `Messages:CREATE` (defaults Parent = READ only)
État :
- OK liste / PARTIEL envoi

Écran :
Annonces
Route/navigation :
drawer + footer Home + header → `Announcements`
Fichier :
`Mobile/src/screens/AnnouncementsScreen.tsx`
Composants principaux :
`ExpandableCommunicationCard`
API utilisées :
page canonique annonces, mark read, archive
Données affichées :
titre, origine, audience, date, pièces, auteur
RBAC appliqué :
`Announcements:READ` ; create/archive si tokens CREATE
État :
- OK

Écran :
Notifications
Route/navigation :
drawer + cloche → `InternalNotifications`
Fichier :
`Mobile/src/screens/InternalNotificationsScreen.tsx`
Composants principaux :
liste, deep-link interne
API utilisées :
`GET /backoffice/internal-notifications`
Données affichées :
titre, expéditeur, corps, pièces
RBAC appliqué :
`Notifications:READ` ; create si CREATE ; archive UI sans garde dédiée
État :
- OK lecture / PARTIEL archive

Écran :
Emploi du temps
Route/navigation :
catalogue drawer `Timetable` (filtré si pas `Planning de cours:READ`)
Fichier :
`Mobile/src/screens/TimetableScreen.tsx`
Composants principaux :
planning V2
API utilisées :
planning via `AdminDataContext`
Données affichées :
créneaux établissement (pas d'enfant)
RBAC appliqué :
`Planning de cours:READ` — **absent** des defaults Parent
État :
- ABSENT (menu standard) / PARTIEL si droit live

Écran :
Aide
Route/navigation :
footer drawer → `helpUi.openHelp()`
Fichier :
`Mobile/src/help/HelpHost.tsx`, `buildMobileHelpContext.ts`
Composants principaux :
`HelpSheet`
API utilisées :
catalogue help (local)
Données affichées :
contexte route / rôle
RBAC appliqué :
session métier prête
État :
- OK si catalogue disponible

Écran :
Support
Route/navigation :
drawer Outils `Support`
Fichier :
`Mobile/src/screens/MvpUtilityScreens.tsx`
Composants principaux :
`InfoCard`
API utilisées :
aucune
Données affichées :
nom user, nom école
RBAC appliqué :
`Messages:READ`
État :
- PARTIEL (MVP, pas de ticket)

Écran :
Mode hors ligne
Route/navigation :
drawer Outils `OfflineMode` ; header sync Parent
Fichier :
`Mobile/src/screens/MvpUtilityScreens.tsx`
Composants principaux :
`InfoCard`
API utilisées :
compteurs `AdminDataContext`
Données affichées :
nombre d'élèves / présences / annonces du contexte (pas borné enfant)
RBAC appliqué :
`Documents:READ`
État :
- PARTIEL

Écran :
Préférences communication
Route/navigation :
sheet drawer (pas une route stack)
Fichier :
`Mobile/src/components/CommunicationPreferencesSheet.tsx`
Composants principaux :
sheet
API utilisées :
`communicationPreferencesApi`
Données affichées :
préférences canal
RBAC appliqué :
école liée (`schoolCode !== "*"`)
État :
- OK

Écran :
Paramètres / confidentialité / suppression
Route/navigation :
liens drawer + Welcome (URLs)
Fichier :
`Mobile/src/lib/legalCompliance.ts`, `RoleNavigationDrawer.tsx`
Composants principaux :
liens externes
API utilisées :
aucune in-app
Données affichées :
politique, suppression de compte (URL)
RBAC appliqué :
URL fail-closed production
État :
- PARTIEL (pas de paramètres compte in-app)

Écran :
Déconnexion
Route/navigation :
footer drawer + bootstrap permissions
Fichier :
`Mobile/src/components/RoleNavigationDrawer.tsx`, `AuthContext.tsx`
Composants principaux :
bouton « Déconnexion »
API utilisées :
`POST /auth/logout`, `clearSecureSession` (async)
Données affichées :
—
RBAC appliqué :
—
État :
- PARTIEL (UI reset immédiat ; tokens nettoyés en différé)

Écran :
Profil compte Parent
Route/navigation :
—
Fichier :
—
Composants principaux :
—
API utilisées :
—
Données affichées :
—
RBAC appliqué :
—
État :
- ABSENT

## Inventaire des routes

### Menu Parent (permissions defaults `Parent`)

| Surface | Route | Visible |
|---------|-------|---------|
| Tab | `Accueil` | oui |
| Tab | `Profil` → `StudentDetailScreen` | oui |
| Tab | `Notes` | oui |
| Tab | `Presences` | oui |
| Tab | `FraisEleve` | oui |
| Drawer | `StudentNotes`, `StudentPresences`, `ReportCards`, `MobilePayment`, `Messages`, `Announcements`, `InternalNotifications`, `OfflineMode`, `Support` | oui |
| Drawer | `Timetable` | non (pas `Planning de cours:READ`) |
| Drawer section Admin | — | non |

### Routes stack enregistrées pour le même Parent (hors menu)

`canReadRoute` partage la feature entre surface Parent et surface staff :

| Route | Feature | Enregistrée ? | Menu Parent |
|-------|---------|---------------|-------------|
| `TeacherGrades` | Notes | **oui** | non |
| `TeacherAttendance` | Présences | **oui** | non |
| `ClassGradesStats` | Notes | **oui** | non |
| `Payments` | Paiements | **oui** | non |
| `FeeGrids` | Paiements:READ via `canReadFeeGrids` | **oui** | non |
| `Students` | Élèves | **oui** | non |
| `Schooling` | `classes` OR `students` | **oui** | non |
| `StudentDetail` / `StudentNotes` / `StudentPresences` / `StudentPayments` | features Parent | oui | oui / tab |
| `Synchronization` | Documents | **oui** | non |
| `Users`, `Teachers`, `SchoolManagement`, `Unpaid`, `Configuration` | features absentes | non | non |

Deep links push allowlist : `Home`, `StudentPayments`, `Messages`, `Announcements`, `InternalNotifications`. Fallback `Home` si route non montée. `somafrikStudentId` n'est **pas** recoupé aux `user.children` avant navigation.

## Inventaire des API

| Endpoint Mobile | Usage Parent | Signal tenant côté Mobile | Preuve de contrôle observée |
|-----------------|--------------|---------------------------|-----------------------------|
| `POST /identify` | pré-login | `schoolCode` body | public |
| `POST /login` | session + `user.children` | `schoolCode` body | Backend enrichit `children` |
| `GET /auth/effective-permissions` | bootstrap | JWT | live permissions |
| `POST /auth/logout` | logout | JWT | best-effort |
| `GET /students` | Home / Présences / fiche | JWT + header école | Mobile **ne refiltre pas** pour parent si `schoolId` session absent (`studentsScope.ts`) |
| `GET /students/:id` | fiche « Profil » | JWT ; `studentId` = param route | Mobile n'exige pas l'appartenance à `user.children` |
| `GET /notes` | notes / home | JWT | filtre client `notesForStudent` ; fail-open si id étranger |
| `GET /presences` | présences / home | JWT | filtre client alias |
| `GET /payments` | frais / home | JWT | filtre client sur écran enfant ; **aucun** sur `PaymentsScreen` |
| `GET /finance/payment-student-options` | picker frais | JWT | liste affichée telle quelle |
| `GET /finance/catalog` | devise / moyens | JWT | — |
| `GET /parents/relations` | responsables fiche | JWT + studentId | — |
| `GET /backoffice/messages*` | messages | JWT + school query | allowlist CTA |
| `GET /backoffice/announcements*` | annonces | JWT + school query | audience serveur |
| `GET /backoffice/internal-notifications` | inbox | JWT | — |

Mobile n'envoie pas `parentId`. L'isolation famille/école repose sur le JWT + le filtre client. Toute API listée sans preuve Mobile d'appartenance enfant est un risque si le Backend relâche le filtre.

## RBAC

Mécanismes :

- Permissions live `Feature:ACTION` (`permissions.ts`).
- Defaults internes `Parent` **seulement si** le tableau permissions est absent (`resolveEffectivePermissions`).
- **Aucun grant** messages par `role === PARENT` (`mobileCtaRbacAlignment.ts`).
- Drawer / tabs filtrés par `canReadRoute`.
- Stack : **toute** route dont `canReadRoute` est vrai est montée, y compris hors catalogue Parent.

Defaults Parent (`internalRoleDefaults.ts`) :

```text
Élèves:READ, Notes:READ, Bulletins:READ, Présences:READ, Paiements:READ,
Messages:READ, Notifications:READ, Announcements:READ, Documents:READ
```

### RBAC cosmétique (P0)

Le menu cache Enseignant / Finance staff / Admin. `canReadRoute` les rouvre :

```97:128:Mobile/src/domain/security/permissions.ts
  Profil: "Élèves",
  StudentDetail: "Élèves",
  ...
  TeacherAttendance: "Présences",
  TeacherGrades: "Notes",
  ...
  Students: "Élèves",
  Payments: "Paiements",
  MobilePayment: "Paiements",
```

`canReadFeeGrids` accepte `Paiements:READ` (`permissions.ts` 430–437).  
`canOpenAdminScreens` devient vrai (`AppNavigator.tsx` 237–243).  
`Schooling` s'ouvre via `Élèves:READ` (`canReadView("Schooling")`).

Un Parent peut donc **monter** `TeacherGrades`, `TeacherAttendance`, `Payments`, `FeeGrids`, `Students`, `Schooling`, `ClassGradesStats` et y naviguer par `navigation.navigate`, deep link interne, ou restauration d'état. Ce n'est pas un simple hide UI.

## Isolation tenant

| Identifiant | Contrôle Mobile Parent | Risque |
|-------------|------------------------|--------|
| `selectedStudentId` | state React, chips `user.children` uniquement dans l'UI | un param de route / push peut forcer un autre id |
| `sessionStudentAliasKeys` | **ajoute `selected` même s'il n'est pas un enfant** | fail-open client |
| `schoolId` | `projectScopedStudentsForSession` pass-through si parent sans `schoolId` | confiance GET |
| `schoolCode` | header request + login | tamper local = défense serveur |
| `parentId` | **absent** du client | — |
| `userId` | exclu des alias élève | OK |
| Cache L1 | partition `{userId, schoolId, schoolCode}`, purge logout | OK si purge tenue |
| Push `somafrikStudentId` | allowlist destination, **pas** allowlist enfant | P0 combiné à MP-001 |

Scénario demandé :

```text
Parent A
 ├── Enfant A1
 └── Enfant A2
Parent B
 └── Enfant B1
```

- Switcher : A ne voit que A1/A2. **OK UI**.
- `selectedStudentId = B1` (route, push, tamper) : les alias **incluent B1**. Si `notesData` / `paymentsData` / L1 contiennent une ligne B1 (hydratation large, cache, API trop large), A **voit B1**. **P0 client**.
- `GET /students/B1` : Mobile appelle. Isolation réelle = Backend 404. **Pas de pré-check**.

## Profil Parent

| Champ demandé | Où c'est affiché | Source |
|---------------|------------------|--------|
| Nom / prénom Parent | drawer `session.user.name` seulement | login |
| Téléphone Parent | **nulle part** sur un écran profil | `user.phone` / `user.parentPhone` dans le type session, non rendu |
| Email Parent | **absent** du type `LoginResponse.user` | — |
| Identifiant utilisateur | **non affiché** (pas d'`user.id` sur l'UI Parent) | — |
| Établissement | drawer `school.name` ou fallback `schoolCode` | session |
| Modification profil | **ABSENT** | — |
| PIN / mot de passe | uniquement `mustChangePassword` au login | pas de settings |

Données techniques / hors rôle exposées sur l'écran appelé « Profil » :

- `schoolCode` brut (« Établissement »)
- statuts C18 bruts (`PRE_REGISTERED`, `ENROLLED`, …)
- boutons Valider / Affecter / Transférer / Clôturer si `canMutateC18Mobile` (trou `parent_student`)
- formulaire « Lier un responsable » si tokens Relations

Aucune donnée d'un autre établissement n'est *intentionnellement* rendue. Le risque est le `studentId` étranger, pas un sélecteur d'école (Parent n'a pas `SchoolSelector`).

## Enfants liés

| Point | Constat |
|-------|---------|
| Source | `session.user.children` au login |
| Liste | `StudentSwitcher` si `length > 1` |
| Affiché | `child.name`, `child.className` |
| Établissement enfant | pas sur le switcher ; `schoolCode` sur la fiche |
| Navigation fiche | Home / tab Profil / sous-écrans |
| Mélange A1/A2 | si `selectedStudentId` null, **tous** les alias enfants sont unionnés |
| Enfant d'une autre famille | fail-open alias (MP-001) |
| 0 enfant | switcher hidden ; identité « Élève » ; listes vides fail-closed **si** selected null et children [] |
| Persistance sélection | **non** — restart = enfant `[0]` |

## Notes

| Contrôle | État |
|----------|------|
| Enfant sélectionné | param route **ou** switcher |
| Matière | chips + `item.subject` |
| Note / barème | `value/scale`, défaut /20 moyenne |
| Période | `item.period` |
| Appréciation | non affichée |
| Vide | `QueryStateView` + copy |
| Isolation | `notesForStudent(aliasKeys)` — contaminable par id étranger |

## Présences

| Contrôle | État |
|----------|------|
| Présent / Absent / Retard / Justifié | `normalizePresenceStatus` |
| Date | `item.date` |
| Pourcentage | `getPresenceStats.rate` |
| Vide | texte seul |
| Loader / erreur / retry | **ABSENT** |
| Isolation | `studentAliasKeys.includes(presence.studentId)` — même fail-open |

## Paiements

| Contrôle | État écran enfant | État écran staff `Payments` |
|----------|-------------------|-----------------------------|
| Montant attendu / payé / restant | KPIs `StudentPaymentsScreen` | totaux **dataset entier** |
| Statut / historique | reçus | reçus non scopés enfant |
| Devise | catalogue finance | catalogue |
| Établissement | implicite session | implicite |
| Enfant | sous-titre + classe | **tous les élèves hydratés** |
| Isolation | alias keys | **aucune** `filterRowsByStudentScope` |

Drawer « Paiements » ≠ tab « Frais » (MVP vs écran métier).

## Communications

| Canal | Audience | Isolation enfant | Pièces |
|-------|----------|------------------|--------|
| Annonces | école / plateforme | non (institutionnel) | oui |
| Messages | compte Parent | `studentId` hint à l'envoi | oui |
| Notifications internes | école | non | oui + deep link |

Footer Home : `announcementsSnapshot.data[0]` — dernière annonce globale, pas par enfant.

## Notifications

Inbox C4 + cloche header. Deep link finance peut porter un `studentId` non lié. Archive visible sans wrapper RBAC dédié. Composer create si `Notifications:CREATE` (hors defaults Parent).

## Paramètres

| Fonction | Accessible | Implémenté |
|----------|------------|------------|
| Modifier profil Parent | non | non |
| Téléphone / email | non | non |
| PIN / mot de passe | login forcé seulement | `changePassword` |
| Préférences comm | drawer | oui |
| Notifications push | test hors prod | register device |
| Aide | drawer | catalogue |
| Confidentialité | URL | oui |
| Suppression compte | URL | hors app |
| Paramètres établissement | non | gated settings operator |
| Déconnexion | drawer | oui, incomplet côté tokens |

Écran déclaré vs accessible : `Timetable` déclaré au catalogue, filtré. `MobilePayment` accessible mais MVP. `Configuration` déclaré staff, non monté.

## Logout/session

`logout()` :

1. `clearRequestSchoolScope` / `clearStoredSchoolCode`
2. `clearAuthenticatedState` → `selectedStudentId = null`, invalidate L1, dismiss push
3. `blockOutboxOnLogout().finally(logoutSession)` **async**
4. `logoutSession` = `POST /auth/logout` puis `clearSecureSession`

Trous :

- Tokens encore en SecureStore pendant la fenêtre async.
- `logoutSession().catch(() => undefined)` silencieux.
- Profil session (PII enfants, téléphone) dans SecureStore jusqu'à clear.
- Changement de session : L1 generation bump prévu ; non démontré runtime ici.

## Authentification Parent

Écran :
`Login` après `RoleSelection` + `POST /identify` (badge rôle Parent)
Composant :
`FormField` `type="password"` (`secureTextEntry`, pas de bouton afficher/masquer)
Route :
`Login`
Endpoint :
`POST /api/login` via `login()` / `buildMobileLoginPayload` — champ unique `pin` pour **tous** les rôles
Payload :
`{ role: "parent_student", identifier, pin, schoolCode }`
Type de champ :
password masqué ; libellé **PIN** / placeholder **Ex. 1234** si `identity.role === "parent_student"`
Clavier :
`resolveSecretKeyboardType("parent_student")` → `"number-pad"` ; `mapKeyboardToInputMode` → `"numeric"` (helper spec, non branché sur le TextInput)
Validation Mobile :
login : non-vide seulement (`canSubmitLogin`) — **aucun** filtre digits-only / `maxLength` à la soumission
Validation API observée (lecture seule) :
`authService.login` exige `pin` ; `verifyUserSecret` accepte `passwordHash` **ou** `pinHash` **ou** `temporaryPassword` **ou** plaintext `password`/`pin`
Politique de secret observée :
hybride `validateAccountSecret` (miroir Mobile `userAccountRules.ts` = backend `lib/userAccountRules.js`) : PIN 6 chiffres **ou** mot de passe ≥8 + 1 lettre + 1 chiffre. `POST /auth/change-password` applique cette politique **sans** distinction de rôle — un Parent peut donc stocker `Pass1234`.
Legacy détecté :
- runtime : payload encore nommé `pin` ; UI Parent/élève number-pad
- `Mobile/src/models/Parent.ts` : PIN clair + `verifierConnexion` (hors chemin login)
- backend : colonnes/champs `pin` / `pinHash` **et** `password` / `passwordHash` en parallèle
- scripts de vérif historiques : `pin: "1234"`
Classification :
**P0 (MP-041)** — un secret **valide serveur** contenant des lettres (ex. après `mustChangePassword` / mot de passe temporaire) n'est pas saisissable sur le clavier `number-pad` iOS/Android.
Preuve :
`loginScreenSpec.ts` 166–168 + `LoginScreen.tsx` 336–352 + `validateAccountSecret("Pass1234") === null` + `verifyUserSecret` passwordHash. Test RED **MP-014**.
Cible métier :
lot séparé **Parent Auth Password** — mot de passe standard, même politique que les autres comptes, plus de PIN UI, plus de number-pad, plus de fallback PIN silencieux. Migration des anciens PIN à décider explicitement (UI PIN ≠ secret stocké PIN ≠ secret déjà password). Ne pas « convertir » automatiquement un PIN en mot de passe.

## UX

| Incohérence | Gravité |
|-------------|---------|
| « Profil » = enfant, pas le Parent | P1 |
| Accueil affiche le nom de l'enfant comme identité | P2 |
| Drawer « Paiements » vs tab « Frais » | P1 |
| Boutons retour sur onglets racine | P2 |
| Présences : vide = erreur possible | P1 |
| Fiche enfant : « Élève introuvable » sans retry | P1 |
| Support / Offline / MobilePayment MVP, copy sans accents | P2 |
| `schoolCode` technique | P2 |
| 0 enfant → placeholder « Élève » | P1 |
| Multi-enfant : ReportCards sans switcher | P1 |

Retour Android : `onRequestClose` drawer / messages OK. Tabs : `goBack()` souvent no-op. Après login : `Home`. Après logout : `Welcome` (reset).

## Sécurité

- JWT / refresh en SecureStore, pas AsyncStorage. **OK**.
- `stripSecrets` retire les tokens du state React. **OK**.
- `safeLogger` redacte JWT. **OK**.
- PIN du **modèle legacy** `Mobile/src/models/Parent.ts` en clair + `Mobile/src/test.ts` qui l'instancie. **P2 / dette**, hors chemin login actuel.
- `sessionStudentAliasKeys` fail-open. **P0**.
- Routes staff montées. **P0**.
- Push `studentId` non borné aux enfants. **P0 combiné**.
- C18 `parent_student` omis. **P1**.
- APIs listes sans preuve Mobile d'enfant. Dépendance Backend.

## Legacy / dette technique

| Élément | Fichier | Note |
|---------|---------|------|
| Modèle OOP ancien | `Mobile/src/models/Parent.ts` (+ Eleve, Enseignant, …) | PIN clair, `verifierConnexion` local |
| Script démo | `Mobile/src/test.ts` | `parent.afficherProfil()` |
| AuthResolver | `Mobile/src/domain/auth/AuthResolver.ts` | non branché |
| `data/catalog.ts` | types + jeux statiques | login runtime = API |
| `API_BASE_URL = ""` | `api.ts` | déprécié, URL dynamique |
| `console.info` traces | `studentsScope.ts` | pas de token |
| TODO/FIXME dans `src/screens` | aucun | — |
| `catch {}` vide | `StudentDetailScreen` enrollments | liste C18 vidée |

## Tests

Fichier créé (volontairement RED sur les défauts) :

```text
Mobile/src/lib/mobileParentProfile.audit.red.test.ts
npm --prefix Mobile run test:mobile-parent-profile-audit
```

Contrats :

| ID test | Gravité | Intention |
|---------|---------|-----------|
| MP-INV-01..04 | inventaire | catalogue actuel (peuvent rester verts) |
| MP-001 | P0 | Parent A ne matche jamais B1 |
| MP-002 | P0 | pas d'alias école B |
| MP-003 | P0 | `canReadRoute` staff = false |
| MP-004 | P0 | `canOpenAdminScreens` = false |
| MP-005 | P0 | Payments/Students scopés enfant |
| MP-006 | P1 | C18 `parent_student` bloqué |
| MP-007 | P1 | écran Profil Parent existe |
| MP-008 | P1 | switcher > param route |
| MP-009 | P1 | drawer → StudentPayments |
| MP-010 | P1 | QueryStateView présences |
| MP-011 | P1 | logout clear SecureStore |
| MP-012 | P1 | pré-check enfants avant GET fiche |
| MP-013 | P2 | plus de PIN legacy |
| MP-014 | P0 | Parent : clavier/wording mot de passe, pas PIN number-pad |

Exécution réelle (audit, volontairement RED) :

```text
npm --prefix Mobile run typecheck
# EXIT 0

npm --prefix Mobile run test:mobile-parent-profile-audit
# EXIT 1
# mobile parent profile audit — 4 vert / 14 rouge / 18 cas
# PASS MP-INV-01 MP-INV-02 MP-INV-03 MP-INV-04
# FAIL P0 MP-001 MP-002 MP-003 MP-004 MP-005 MP-014
# FAIL P1 MP-006 MP-007 MP-008 MP-009 MP-010 MP-011 MP-012
# FAIL P2 MP-013
#
# MP-003 routes encore ouvertes :
# TeacherGrades, TeacherAttendance, ClassGradesStats, Payments, FeeGrids, Students, Schooling
# MP-014 : Parent impose number-pad — Pass1234 (secret canonique) non saisissable
```

Les tests existants (`student-user-canonical-link.regression.test.ts`, `roleNavigationPreferences.test.ts`) documentent le fail-closed **sans enfant** et le catalogue menu. Ils **ne couvrent pas** l'id étranger ni les routes staff partagées.

## P0

1. **Fail-open enfant étranger** — `sessionStudentAliasKeys` ajoute tout `selectedStudentId`.
2. **Routes staff montées** — même tokens READ que le parcours Parent.
3. **`canOpenAdminScreens` vrai** — `Payments` + `FeeGrids`.
4. **`PaymentsScreen` / `StudentsScreen` non scopés** — dataset hydraté intégral.
5. **Push / route `studentId`** — pas de allowlist `user.children`.
6. **Auth Parent PIN vs mot de passe** — `number-pad` + wording PIN alors que le secret canonique peut contenir des lettres (MP-041).

## P1

1. Pas d'écran Profil compte Parent.
2. Onglet « Profil » = fiche enfant.
3. `canMutateC18Mobile` ignore `parent_student`.
4. `route.params.studentId` fige l'enfant après switcher.
5. Drawer Paiements = MVP.
6. Présences sans état d'erreur.
7. Logout tokens async / silencieux.
8. Fiche : GET sans preuve d'enfant ; erreur sans retry.
9. ReportCards sans switcher.
10. Pas de changement de PIN in-app.
11. 0 enfant : placeholder « Élève ».

## P2

Wording Profil/enfant, `schoolCode` brut, Timetable fantôme, OfflineMode counts globaux, Support MVP, back tabs, annonce Home globale, modèles `src/models`, `AuthResolver` mort, `console.info` scope, catch C18, archive notif sans garde, PII SecureStore, copy MVP sans accents.

## Recommandations

Lot de correction **séparé**, après revue CTO + diff GitHub. Ne pas corriger dans cette PR.

Ordre suggéré :

0. **P0 Parent Auth Password** (lot séparé, avec isolation + RBAC) :
   1. mot de passe à la place du PIN ;
   2. champ alphanumérique standard ;
   3. suppression du clavier `number-pad` ;
   4. suppression du wording PIN ;
   5. réutilisation de `validateAccountSecret` / politique canonique (pas de politique Parent) ;
   6. login standardisé (même UX Teacher/Admin) ;
   7. récupération / changement de mot de passe in-app ;
   8. migration ou compatibilité **explicitement** décidée pour les anciens PIN stockés (`pin` / `pinHash`) — ne pas conclure qu'un PIN devient un mot de passe ;
   9. tests de non-régression session/logout ;
   10. aucun fallback PIN silencieux.
1. **P0 isolation** — fail-closed `sessionStudentAliasKeys` : id hors `children` → `[]`. Recouper push/route params.
2. **P0 RBAC** — routes staff hors `routeFeatureMap` Parent, ou allowlist de routes par `roleKey`. `canReadFeeGrids` sans `Paiements:READ` pour PARENT. `canOpenAdminScreens` false.
3. **P0 surfaces** — ne plus monter `Payments` / `Students` / `Teacher*` pour PARENT ; ou y appliquer `filterRowsByStudentScope` fail-closed.
4. **P1 profil** — écran compte Parent (nom, prénom, téléphone, email si fourni, établissement, user public id) **sans** fiche élève ni C18.
5. **P1 C18** — ajouter `parent_student` à `PARENT_STUDENT_ROLES`.
6. **P1 nav** — switcher gagne sur le param ; drawer → `StudentPayments` ; QueryStateView présences ; logout `await clearSecureSession`.
7. **P2** — retirer `src/models` + `src/test.ts` du runtime mental ; wording ; schoolCode → nom école.

## Hors périmètre

- Web
- Backend fonctionnel / schéma
- Correction des P0/P1 dans cette branche
- Runtime Expo Parent (pas de compte Parent ni backend recette dans cet environnement)
- Autres rôles sauf fuite RBAC documentée
- Merge / Ready

## Tableau de synthèse

| ID | Zone | Problème | Gravité | Preuve | Fichier | Correction proposée |
| ---- | ---- | -------- | -------- | ------ | ------- | ------------------- |
| MP-001 | Isolation | `sessionStudentAliasKeys` inclut un `selectedStudentId` hors `user.children` (B1 visible si la ligne est hydratée) | P0 | `canonicalStudentIdentity.ts` 98–104 ; test RED MP-001 | `Mobile/src/lib/canonicalStudentIdentity.ts` | Fail-closed : id inconnu → `[]` |
| MP-002 | Isolation | Même fail-open inter-école (élève école B) | P0 | même fonction ; test RED MP-002 | `Mobile/src/lib/canonicalStudentIdentity.ts` | Idem + ignorer schoolCode étranger |
| MP-003 | RBAC | Parent defaults : `canReadRoute` vrai pour TeacherGrades, TeacherAttendance, Payments, Students, Schooling, ClassGradesStats, FeeGrids | P0 | `routeFeatureMap` 97–128 ; test RED MP-003 | `Mobile/src/domain/security/permissions.ts` | Allowlist routes Parent ≠ features staff |
| MP-004 | RBAC | `canOpenAdminScreens` vrai via Payments/FeeGrids | P0 | `AppNavigator.tsx` 237–302 ; `canReadFeeGrids` 430–437 ; test RED MP-004 | `Mobile/src/navigation/AppNavigator.tsx` | Ne pas monter le bundle admin pour PARENT |
| MP-005 | Paiements | `PaymentsScreen` affiche `paymentsData` sans scope enfant | P0 | `PaymentsScreen.tsx` 41–45 ; test RED MP-005 | `Mobile/src/screens/PaymentsScreen.tsx` | Ne pas enregistrer la route **ou** `filterRowsByStudentScope` fail-closed |
| MP-006 | Scolarité | `StudentsScreen` liste `establishmentStudents`, pas `user.children` | P0 | `StudentsScreen.tsx` + `establishment.ts` ; test RED MP-005 | `Mobile/src/screens/StudentsScreen.tsx` | Idem : route interdite Parent |
| MP-007 | RBAC | `Schooling` hub staff enregistré via `Élèves:READ` | P0 | `permissions.ts` 361–364 ; `AppNavigator.tsx` 306 | `Mobile/src/navigation/AppNavigator.tsx` | Exclure PARENT de `Schooling` |
| MP-008 | RBAC | `TeacherGrades` / `TeacherAttendance` / `ClassGradesStats` montés | P0 | `AppNavigator.tsx` 310–314 | `Mobile/src/navigation/AppNavigator.tsx` | Exclure PARENT |
| MP-009 | Deep link | Push `somafrikStudentId` non recoupé aux enfants | P0 | `pushNotificationDestinations.ts` 37–40 | `Mobile/src/lib/pushNotificationDestinations.ts` | Allowlist `user.children` sinon Home |
| MP-010 | Profil | Aucun écran profil **compte** Parent | P1 | glob screens ; tab `Profil: StudentDetailScreen` ; test RED MP-007 | `Mobile/src/navigation/roleTabPreferences.ts` | Écran lecture (éventuellement édition) du compte Parent |
| MP-011 | UX | Onglet « Profil » = fiche enfant | P1 | `roleTabCatalog.ts` 29–30 | `Mobile/src/navigation/roleTabCatalog.ts` | Renommer « Enfant » + écran compte distinct |
| MP-012 | RBAC | `canMutateC18Mobile` n'inclut pas `parent_student` | P1 | `studentEnrollmentC18Access.ts` 5–35 ; test RED MP-006 | `Mobile/src/lib/studentEnrollmentC18Access.ts` | Ajouter `parent_student` au set bloquant |
| MP-013 | Navigation | `route.params.studentId ?? selectedStudentId` fige l'enfant | P1 | Notes/Présences/Paiements/Détail ; test RED MP-008 | `Mobile/src/screens/StudentNotesScreen.tsx` (et 3 autres) | Préférer le switcher ; sync params |
| MP-014 | Paiements | Drawer « Paiements » → `MobilePayment` MVP | P1 | `roleDrawerPreferences.ts` 257–261 ; test RED MP-009 | `Mobile/src/navigation/roleDrawerPreferences.ts` | `I.studentPayments` |
| MP-015 | Présences | Pas de QueryStateView / retry | P1 | `StudentPresencesScreen.tsx` 83–91 ; test RED MP-010 | `Mobile/src/screens/StudentPresencesScreen.tsx` | Aligner Notes/Paiements |
| MP-016 | Session | `logout()` n'attend pas `clearSecureSession` | P1 | `AuthContext.tsx` 327–333 ; test RED MP-011 | `Mobile/src/context/AuthContext.tsx` | Clear synchrone + erreur visible |
| MP-017 | Isolation | `getSchoolStudent(studentId)` sans check `children` | P1 | `StudentDetailScreen.tsx` 94–141 ; test RED MP-012 | `Mobile/src/screens/StudentDetailScreen.tsx` | Refuser id hors enfants avant GET |
| MP-018 | Bulletins | Pas de `StudentSwitcher` | P1 | `ReportCardsScreen.tsx` | `Mobile/src/screens/ReportCardsScreen.tsx` | Ajouter switcher |
| MP-019 | Paramètres | Pas de changement PIN / email / téléphone après login | P1 | aucun Settings Parent | — | Écran sécurité compte |
| MP-020 | UX | 0 enfant → identité « Élève », pas d'état dédié | P1 | `HomeScreen.tsx` 299 | `Mobile/src/screens/HomeScreen.tsx` | Empty state « aucun enfant lié » |
| MP-021 | Profil | Fiche erreur sans retry | P1 | `StudentDetailScreen.tsx` 180–187 | `Mobile/src/screens/StudentDetailScreen.tsx` | Retry + mapping 401/403/404 |
| MP-022 | UX | `schoolCode` affiché comme établissement | P2 | `StudentDetailScreen.tsx` 325 | `Mobile/src/screens/StudentDetailScreen.tsx` | Nom d'école |
| MP-023 | UX | Statuts C18 bruts | P2 | `StudentDetailScreen.tsx` 322 | `Mobile/src/screens/StudentDetailScreen.tsx` | Libellés métier |
| MP-024 | Nav | `Timetable` au catalogue sans permission default | P2 | `roleDrawerPreferences.ts` 265 | `Mobile/src/navigation/roleDrawerPreferences.ts` | Retirer ou accorder le droit |
| MP-025 | Offline | Compteurs globaux `studentsData.length` | P2 | `MvpUtilityScreens.tsx` 128–132 | `Mobile/src/screens/MvpUtilityScreens.tsx` | Scope enfant |
| MP-026 | Support | Écran MVP sans ticket | P2 | `MvpUtilityScreens.tsx` 158–176 | `Mobile/src/screens/MvpUtilityScreens.tsx` | Canal support réel |
| MP-027 | Nav | `goBack()` sur onglets racine | P2 | `StudentNotesScreen.tsx` 79–82 | 3 sous-écrans | Masquer retour si tab |
| MP-028 | Comms | Footer Home = dernière annonce globale | P2 | `HomeScreen.tsx` 494–495 | `Mobile/src/screens/HomeScreen.tsx` | Audience Parent déjà filtrée côté API ; le copy peut le dire |
| MP-029 | Legacy | `models/Parent.ts` PIN clair + `src/test.ts` | P2 | `Parent.ts` 5–29 ; test RED MP-013 | `Mobile/src/models/Parent.ts` | Supprimer hors runtime ou isoler |
| MP-030 | Legacy | `AuthResolver` mort | P2 | aucune import Login | `Mobile/src/domain/auth/AuthResolver.ts` | Documenter / retirer |
| MP-031 | Logs | `console.info` traces scope | P2 | `studentsScope.ts` 216–218 | `Mobile/src/lib/studentsScope.ts` | `safeLogger.debug` |
| MP-032 | Erreurs | `catch` enrollments vide la liste | P2 | `StudentDetailScreen.tsx` 148–150 | `Mobile/src/screens/StudentDetailScreen.tsx` | État erreur C18 |
| MP-033 | UX | Drawer fallback `schoolCode` comme nom | P2 | `RoleNavigationDrawer.tsx` 66 | `Mobile/src/components/RoleNavigationDrawer.tsx` | Nom école ou « Établissement » |
| MP-034 | Notif | Archive toujours visible | P2 | `InternalNotificationsScreen.tsx` | même fichier | Garder si token ARCHIVE |
| MP-035 | Session | PII profil en SecureStore | P2 | `secureStorage.ts` SESSION_PROFILE | `Mobile/src/services/secureStorage.ts` | Minimiser le JSON |
| MP-036 | Tenant | Parent sans `schoolId` : pass-through élèves reçus | P2 | `studentsScope.ts` 180–183 | `Mobile/src/lib/studentsScope.ts` | Filter `user.children` |
| MP-037 | UX | Accueil identité = enfant | P2 | `HomeScreen.tsx` 299 | `Mobile/src/screens/HomeScreen.tsx` | Nom Parent + enfant suivi |
| MP-038 | Paiements | `getPaymentStudentOptions` non recoupé | P1 | `StudentPaymentsScreen.tsx` 54–63 | `Mobile/src/screens/StudentPaymentsScreen.tsx` | Intersect `user.children` |
| MP-039 | Session | `selectedStudentId` non persisté | P2 | `AuthContext.tsx` 84, 113 | `Mobile/src/context/AuthContext.tsx` | Persister id **parmi** children |
| MP-040 | Nav | `Synchronization` monté via Documents:READ | P2 | `AppNavigator.tsx` 342 | `Mobile/src/navigation/AppNavigator.tsx` | Hors PARENT |
| MP-041 | Auth | Authentification Parent : PIN numérique incompatible avec la politique de mot de passe | P0 | `resolveSecretKeyboardType("parent_student") === "number-pad"` ; `validateAccountSecret("Pass1234") === null` ; `verifyUserSecret` accepte `passwordHash` ; test RED MP-014 | `Mobile/src/lib/loginScreenSpec.ts` ; `Mobile/src/screens/LoginScreen.tsx` | Lot **Parent Auth Password** : clavier default, wording mot de passe, même politique que les autres comptes |

Les IDs MP-001… du tableau de synthèse sont les anomalies métier. Les IDs du fichier de test (MP-001…) sont des contrats d'audit (mapping dans la section Tests).
