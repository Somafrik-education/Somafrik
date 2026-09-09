# AUDIT DE PARITÉ WEB ↔ MOBILE — ÉTABLISSEMENT UNIQUEMENT

**Mandat :** parité métier Web ↔ Mobile pour les rôles établissement.  
**Date d’audit :** 9 septembre 2026  
**Nature :** lecture de code uniquement. Aucune correction. Aucune modification plateforme. Aucune modification production.  
**PR :** Draft — STOP validation CTO — aucun Ready — aucun merge.

---

## 0. Base Git auditée

| Élément | Valeur |
|---|---|
| Branche de base | `develop` |
| SHA `develop` audité | `1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82` |
| Commit | Merge pull request #572 — `cursor/p0-platform-users-catalog-733b` |
| Working tree à l’audit | propre, aligné `origin/develop` |
| Branche documentation | `cursor/audit-parite-web-mobile-etablissement-ff85` |
| Fichiers de cet audit | `docs/audits/parite-web-mobile-etablissement-2026-09-09.md`, `docs/audits/parite-web-mobile-etablissement-matrix.json` |

**Périmètre volontairement exclu (décision CTO, pas un manque de parité) :**

`super_admin`, `country_admin`, Pays, référentiels pédagogiques nationaux, gestion globale des établissements, abonnements / tarification / marketplace plateforme, matrice globale RBAC (écriture), administration globale, vitrine, Render, Supabase, migrations, CI/CD, EAS / Play Store, redesign.

Ces fonctions sont **Web-only**. Leur absence Mobile n’est **pas** un écart de parité métier établissement.

---

## 1. Verdict

Pour les rôles établissement, Web et Mobile partagent déjà les **APIs canoniques PostgreSQL** sur le cœur opérationnel (classes, élèves, enseignants, utilisateurs, présences, notes/évaluations, encaissements, planning hebdo, messages, annonces, notifications internes, paramètres de base).

La parité métier **n’est pas atteinte**. Les écarts P1 sont des **fonctions Web essentielles absentes ou partielles sur Mobile**, plus des **écrans MVP / fail-closed encore visibles**. Aucune **écriture Mobile établie comme faux succès** n’a été prouvée sur le cœur métier dans cet audit statique.

| Classe | Ouverts (établissement) |
|---|---|
| **P0 prouvés (écriture fausse / fuite tenant / faux succès)** | **0** dans le code lu |
| **P0 candidats (vérité affichée divergente, à confirmer par tests rouges)** | **1** — KPI « Impayés » Mobile ≠ ledger Impayés Web |
| **P1** | **14** (fonctions essentielles absentes, partiellement branchées, ou faux écrans) |
| **P2** | organisation d’écrans, exports, Mobile Money, confort |

**Recommandation CTO :** ne pas ouvrir de lot plateforme. Ouvrir des lots de correction **établissement** ci-dessous, chacun précédé de tests rouges, en Draft, STOP après chaque lot.

---

## 2. Légende de la matrice

| Colonne | Sens |
|---|---|
| **Web** | A = fonctionnelle (API canonique) ; B = lecture seule volontaire ; C = absente / hors UI |
| **Mobile** | idem |
| **API** | même contrat Web/Mobile / partiel / absent Mobile / Web-only |
| **RBAC** | jetons `Module:ACTION` ; `appliesMobile` du catalogue fonctionnel |
| **Écart** | `paritaire` / `partiel` / `absent-mobile` / `retirer-mobile` / `fail-closed` / `web-only-volontaire` |
| **Priorité** | P0 / P1 / P2 / — (volontaire) |

Catégorie d’entrée Mobile (mandat §9) : **A** fonctionnelle · **B** lecture seule volontaire · **C** à retirer.

---

## 3. Matrice complète

### LOT A — Vie scolaire

| Domaine | Web | Mobile | API | RBAC | Écart | Priorité |
|---|---|---|---|---|---|---|
| Classes (créer / modifier / désactiver) | A `/etablissement/classes` `ClassesListPage` POST/PATCH `/classes` | A `ClassesScreen` + `ClassMutationControls` POST/PATCH `/classes` (année, niveau, filière, groupe) | Même contrat | `Classes:*` `appliesMobile: true` | **paritaire** (UX différente) | — |
| Effectif classe / inscription | A `/etablissement/classes/:code/eleves` POST `/classes/:code/students` | A `StudentMutationControls.enrollClassStudent` même POST | Même contrat | `Élèves:CREATE` | **paritaire** | — |
| Élèves liste / archive | A `/etablissement/eleves` DELETE `/students/:id` | A `StudentsScreen` `deleteSchoolStudent` | Même contrat | `Élèves:READ/UPDATE/DELETE` | **paritaire** | — |
| Fiche élève | A dossier `/etablissement/eleves/:id` + sections identité, inscription, responsables, médical, documents, historique | **partiel** `StudentDetailScreen` : identité + liens notes / présences / paiements | GET `/students/:id` + sous-ressources ; **pas** de modules dossier Web | `Élèves:READ` ; Web a aussi `student.*.read` | **partiel** | P1 |
| Relations parent-enfant | A `/etablissement/relations-parent-enfant` GET `/parents/identity` POST `/parents/link` PATCH `/parents/relations/:id` | **C** aucun écran ; parent lit `session.user.children` | API canonique **non consommée** Mobile | `Relations:*` **`appliesMobile: false`** | **absent-mobile** | P1 |
| Enseignants | A `/etablissement/enseignants` `/teachers` `/assignments` | A `TeachersScreen` + `TeacherMutationControls` + `AssignmentMutationControls` POST `/assignments` | Même graphe | `Enseignants:*` `Affectations:*` | **paritaire** (création enseignant via users/create-teacher, volontaire) | — |
| Utilisateurs établissement | A `/etablissement/comptes-utilisateurs` `/backoffice/users` grant/revoke | A `UsersScreen` + `UserMutationControls` mêmes endpoints | Même contrat | `Utilisateurs:*` | **paritaire** (attribution de rôle existant, pas matrice globale) | — |

### LOT B — Pédagogie

| Domaine | Web | Mobile | API | RBAC | Écart | Priorité |
|---|---|---|---|---|---|---|
| Présences / appel | A `/presences` POST `/presences` | A `TeacherAttendanceScreen` `savePresences` + outbox | Même POST | `Présences:*` | **paritaire** | — |
| Notes | A `/notes` POST `/notes` | A `TeacherGradesScreen` `saveNote` | Même POST | `Notes:*` | **paritaire** | — |
| Évaluations | A même page notes POST/PATCH `/evaluations` | A `createEvaluation` / `updateEvaluation` | Même contrat | `Notes:CREATE/UPDATE` | **paritaire** | — |
| Examens | A `/examens` `EntityPage` CRUD + validate/cancel/archive `/exams` | **C** aucun `Stack.Screen` ; `Examens` seulement dans catalogues / AdminCrud mort | API existe, **0 appel écran Mobile** | `Examens:*` **`appliesMobile: true`** (catalogue dit Mobile, UI absente) | **absent-mobile** | P1 |
| Bulletins | A `/bulletins` generate / publish / archive | **B/partiel** `ReportCardsScreen` GET `/report-cards` + PDF publiés uniquement | Mobile **sans** `/report-cards/generate\|publish\|archive` | `Bulletins:*` | **partiel** | P1 |
| Planning EDT | A `/planning/emploi-du-temps/*` CRUD `/course-schedules` | A `TimetableScreen` create/update/delete `/course-schedules` | Même contrat slots | `Planning de cours:*` **`appliesMobile: false`** | **partiel** (écran existe ; catalogue RBAC dit non-Mobile) | P1 |
| Remplacements | A `/planning/remplacements` CRUD | **partiel** create depuis EDT ; `deleteCourseScheduleReplacement` dans l’inventaire **non branché à l’écran** | POST oui ; DELETE API morte côté UI | `Remplacements:*` **`appliesMobile: false`** | **partiel** | P1 |
| Salles | A `/planning/salles` CRUD `/school-rooms` | **B** picker `getSchoolRooms` uniquement, **pas de CRUD** | GET seulement Mobile | `Salles:*` **`appliesMobile: false`** | **partiel** (lecture pour affecter un cours) | P1 |
| Conflits planning | A `/planning/conflits` | C pas d’écran dédié (messages d’erreur inline) | diagnostics Web | même planning | **absent-mobile** | P2 |

### LOT C — Finance

| Domaine | Web | Mobile | API | RBAC | Écart | Priorité |
|---|---|---|---|---|---|---|
| Encaissements / paiements | A `/finances/paiements` POST `/payments` | A `PaymentsScreen` + `PaymentMutationControls` même POST + idempotency, **pas d’outbox finance** | Même contrat F5 | `Paiements:*` | **paritaire** | — |
| Annulation paiement | A `POST /payments/:id/cancel` | A `PaymentCancelControls` | Même contrat | `Paiements:UPDATE` | **paritaire** | — |
| Frais et tarifs (grilles) | A `/finances/frais` + `/parametres/finances` `/finance/fee-grids` apply | **C** aucun écran grilles | API **non consommée** Mobile | `Frais & tarifs:*` **`appliesMobile: false`** | **absent-mobile** | P1 |
| Obligations / créances | A projection `GET /finance/student-fees` + apply grilles | **partiel** `getStudentFees` lu pour KPI / imputation encaissement | GET oui ; apply grilles non | `Paiements` + `Frais` | **partiel** | P1 |
| Impayés | A `/finances/impayes` `GET /backoffice/finance/unpaid` + relances | **C** KPI Accueil « Impayés » = **reçus payment pending**, pas le ledger obligations ; navigation → `Payments` | **contrat différent** | `Impayés:*` **`appliesMobile: false`** | **absent-mobile** + **divergence sémantique** | P1 (candidat P0 vérité affichée) |
| Situation financière élève | A Impayés détail + paiements ; module dossier `finance` **non routé** Web | A `StudentPaymentsScreen` reçus + KPI frais | GET student-fees + payments | `Paiements:READ` | **partiel** (pas de relance, pas de ledger impayés) | P1 |
| Paiement parent Mobile Money | — (P2 Web) | C `MobilePayment` **MVP** (« intégration P2 ») | pas de PSP | `Paiements:READ` | **MVP / retirer ou marquer B** | P2 |

### LOT D — Communication

| Domaine | Web | Mobile | API | RBAC | Écart | Priorité |
|---|---|---|---|---|---|---|
| Messages | A `/messages` conversations + PJ | A `MessagesScreen` + outbox | `/backoffice/conversations\|messages` | `Messages:*` | **paritaire** | — |
| Annonces | A `/annonces` publish / read / archive + PJ | A `AnnouncementsScreen` + mutations | `/backoffice/announcements` | `Announcements:*` | **paritaire** | — |
| Notifications établissement | A `/notifications` inbox C4 | A `InternalNotificationsScreen` list / create / read / archive + PJ | `/backoffice/internal-notifications` | `Notifications:*` | **paritaire** (inbox) | — |
| Lecture / archivage | A | A mark read / archive serveur (pas AsyncStorage) | même | UPDATE | **paritaire** | — |
| Navigation depuis notification | A 9 types → ressource (`notificationNavigation.ts`) | **partiel** allowlist `Home` \| `StudentPayments` ; seul `finance_obligation` est profond | cibles serveur identiques ; **client Mobile ignore** conversation, announcement, payment, attendance, grade, report_card, timetable, teacher_replacement | — | **partiel** | P1 |
| Notifications plateforme | Web-only back-office | `PlatformNotificationsScreen` (rôles plateforme) | hors périmètre | — | **retirer-mobile** (volontaire Web-only) | — |
| Préférences communication | A `/parametres/notifications` (carte ComingSoon Web settings-audit) | préférences perso Menu/drawer | politique école Web incomplète | `configuration` | **hors lot visuel** ; config école ComingSoon **les deux** | P2 / FUTURE |

### LOT E — Paramètres établissement

| Domaine | Web | Mobile | API | RBAC | Écart | Priorité |
|---|---|---|---|---|---|---|
| Profil établissement | A `/parametres/profil` | A `EstablishmentProfileScreen` | PATCH establishments | `Paramètres Établissement` ; opérateur = Admin School | **paritaire** | — |
| Année scolaire | A `/parametres/annee-scolaire` | A `SchoolYearSettingsScreen` | `/v2/academic-years` | `Années Académiques:*` | **paritaire** | — |
| Périodes + barème | A même page | A même écran année | `school-settings` / periods | settings UPDATE | **paritaire** | — |
| Types d’évaluation | A structure / année | A `createEvaluationType` dans année scolaire | `/evaluation-types` | settings | **paritaire** | — |
| Structure pédagogique | A `/parametres/structure` | A `SchoolPedagogicalStructureScreen` activation + cours | référentiel + subjects | `Matières` + settings | **paritaire** | — |
| Matières / cours école | A structure | A `createSchoolSubject` / `createSchoolClassCourse` | canonique settings API | `Matières:*` | **paritaire** | — |
| Rôles disponibles (lecture) | A `/parametres/roles-droits` RO école | A `SchoolAssignableRolesScreen` RO | `listAssignableEstablishmentRoles` | lecture | **paritaire** (volontaire RO) | — |
| Matrice globale RBAC | A Superadmin `/administration/permissions` | `PermissionsScreen` Superadmin **lecture seule** (`MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false`) | pas de PATCH Mobile | `Droits par rôle` | **web-only-volontaire** (écriture) | — |
| Finances (grilles) dans Paramètres | A `/parametres/finances` | C absent du hub Mobile (5 cartes) | fee-grids Web | `Frais & tarifs` | **absent-mobile** | P1 (même que Lot C) |
| Documents administratifs école | A `/administration/documents` `/school-documents` CRUD | C `DocumentsScreen` **MVP** (hub vers bulletins/élèves/annonces) | `/school-documents` **non appelé** Mobile | `Documents:*` `appliesMobile: true` | **fail-closed / MVP** | P1 |
| Rapports / conformité | A `/administration/conformite` table MVP Web | C `ReportsScreen` **compteurs locaux AdminData** | `/v2/reports/advanced` non | `Rapports:*` | **MVP des deux côtés** ; Mobile plus trompeur | P1 |
| Mon abonnement SaaS | A école | C absent Mobile | plateforme | `mySubscription` | **web-only-volontaire** (SaaS) | — |
| Sécurité / export données | A | C | — | configuration | **absent-mobile** | P2 |
| ComingSoon (Apparence, Intégrations, Notifications config) | B/FUTURE | C non exposé | — | — | **paritaire d’absence** | — |

### Surfaces Mobile hors métier (à classer C)

| Entrée | Où | Catégorie | Priorité |
|---|---|---|---|
| Documents | drawer établissement | C MVP | P1 |
| Rapports | drawer | C MVP (métriques locales) | P1 |
| Audit | drawer plateforme + stack `Audit: Utilisateurs` | C MVP | retirer / P1 si visible établissement |
| Mode hors ligne | drawer | C MVP statut | P2 |
| Synchronisation | drawer | C MVP | P2 |
| Support | drawer | C MVP | P2 |
| SchoolManagement → AdminCrud `schools/courses/assignments/paymentStatuses` | non `school_admin` | fail-closed | retirer-mobile |
| Drawer super/country : Établissements, Abonnements | `roleDrawerPreferences` `platformItems` | fail-closed | **retirer-mobile** (Web-only) |
| `MenuScreen.tsx` Pays / Établissements / Abonnements / Cours / Affectations | **non enregistré** dans `AppNavigator` (code mort) | fail-closed latent | retirer code mort |
| Home KPI Pays / Établissements | `isPlatformAdmin` → AdminCrud | fail-closed | retirer-mobile |

---

## 4. Synthèse demandée (mandat §12)

### 4.1 Déjà paritaires (même API, même PG, mutations réelles)

Classes (année/niveau/filière/groupe) · inscription élève · liste/archive élèves · enseignants + création d’affectation · utilisateurs + grant/revoke rôle établissement · appel présences · notes · évaluations · encaissement · annulation paiement · messages · annonces · inbox notifications C4 (CRUD inbox) · profil / année / périodes / barème / types d’éval / structure / cours école · catalogue rôles lecture seule.

Preuves types :

- Classes : Web `ClassesListPage.tsx` ↔ Mobile `ClassMutationControls.tsx` → `POST/PATCH /api/classes`.
- Paiements : audit F5 `docs/audits/finance-f5-web-mobile-convergence-2026-08-28.md` — mêmes `POST /payments` et `POST /payments/:id/cancel`, pas d’outbox finance Mobile.
- Présences : Web `PresencesPage` ↔ Mobile `TeacherAttendanceScreen` → `POST /presences`.
- Utilisateurs : `/api/backoffice/users` + grant/revoke.

### 4.2 Partiellement paritaires

| Fonction | Ce qui marche Mobile | Ce qui manque |
|---|---|---|
| Fiche élève | identité + 3 sous-écrans | responsables, médical, documents dossier, historique, inscription riche |
| Bulletins | liste + PDF **publiés** | generate / publish / archive |
| Planning | CRUD slots + create remplacement + picker salles | CRUD salles, delete remplacement, conflits, vues prof/salle Web |
| Finance élève | reçus + GET student-fees | ledger impayés, relances, apply grilles |
| Notifications | inbox C4 | deep-link 8/9 types → Home |
| Paramètres hub | 5 cartes | grilles tarifaires, export, sécurité |

### 4.3 Absentes sur Mobile (établissement, donc écart)

1. **Examens** (CRUD Web `/examens`, API `/api/exams`, RBAC `Examens:*` déjà `appliesMobile: true`).
2. **Relations parent-enfant** (Web `/etablissement/relations-parent-enfant`, API `/api/parents/*`).
3. **Frais & tarifs** (grilles, activation, apply → obligations).
4. **Impayés** (ledger + relances).
5. **Gestion complète des bulletins** (generate/publish/archive).
6. **Documents scolaires canoniques** (`/school-documents`).
7. **CRUD salles**.
8. **Modules dossier élève** (responsables / médical / documents / historique).

### 4.4 Fonctionnalités Mobile à retirer car Web-only (plateforme)

Ne **pas** les reconstruire. Les **cacher** :

- Drawer `super_admin` / `country_admin` : Établissements (`entity: schools`), Abonnements (`entity: subscriptions`), Droits par rôle (écriture déjà bloquée ; l’entrée Superadmin RO est discutable), Notifications plateforme, Audit.
- KPI Accueil Pays / Établissements → `AdminCrud`.
- `SchoolManagement` cartes sans route canonique (`schools`, `courses`, `assignments`, `paymentStatuses`).
- `PlatformNotificationsScreen` pour tout rôle établissement (déjà filtré C4 ; garder le filtre).
- `MenuScreen.tsx` legacy (Pays, Abonnements, Cours, Affectations) — **hors graphe de navigation live** mais encore dans le dépôt.
- `PermissionsScreen` n’est pas un manque établissement : écriture matrice = Web-only, conforme mandat §7.

### 4.5 Écrans / boutons fail-closed ou MVP (mandat §9 interdit comme opérationnel)

| Surface | Fichier | Comportement | Catégorie |
|---|---|---|---|
| `SafeAdminCrudScreen` | `Mobile/src/screens/SafeAdminCrudScreen.tsx` L13–46 `testID="admin-crud-fail-closed"` | aucune mutation ; message « retirée » | fail-closed |
| Flag CRUD générique | `mobileMutationSafety.ts` `MOBILE_GENERIC_ADMIN_CRUD_IN_RC1 = false` | courses/assignments aussi fail-closed | fail-closed |
| Entités CRUD-only | `canonicalRouteMap.ts` L14–21 `schools, countries, subscriptions, courses, assignments, paymentStatuses` | | fail-closed |
| Documents | `MvpUtilityScreens.tsx` L71–122 « Centre MVP » | pas `/school-documents` | C MVP |
| Rapports | L124–147 compteurs `AdminData` locaux | pas API rapports | C MVP |
| Audit | L149–180 | journal cosmétique | C MVP |
| MobilePayment | L183–228 | suivi + « Mobile Money P2 » | C MVP |
| Offline / Sync / Support | L230–289 | statut / contact | C MVP |
| Drawer entity → AdminCrud | `RoleNavigationDrawer.tsx` L68–72 | schools/subscriptions plateforme | fail-closed |
| SchoolManagement | `SchoolManagementScreen.tsx` L24–62 | courses/assignments/schools/paymentStatuses | fail-closed |
| Menu legacy | `MenuScreen.tsx` L31–45, L224–228 | AdminCrud ou « Action non configurée » | mort + fail-closed |

### 4.6 Différences RBAC

1. **Catalogue fonctionnel** `backend/lib/functionalModulesCatalog.js` : `appliesMobile: false` pour `relations`, `fees`, `unpaid`, `planning`, `rooms`, `replacements` (et plateforme `subscriptions`, `contacts`, `education_reference`). **Contradiction** avec des écrans Mobile déjà branchés (EDT, remplacements create, picker salles) et avec le présent mandat (ces domaines établissement **sont** dans le périmètre).
2. **Examens** : `appliesMobile: true` mais **zéro écran** — inverse : le catalogue promet Mobile, l’UI ne livre pas.
3. **Defaults** `Mobile/src/lib/internalRoleDefaults.ts` Admin School : `Examens:CREATE/UPDATE` présents ; **pas** de `Planning de cours`, `Salles`, `Remplacements`, `Frais & tarifs`, `Impayés`, `Relations`. La vérité runtime reste `GET /api/auth/effective-permissions` (PG). Les defaults locaux peuvent masquer l’EDT si la matrice PG n’accorde pas `Planning de cours:READ`.
4. **Gating bizarre Mobile** (`permissions.ts` `routeFeatureMap`) : `Audit` → `Utilisateurs` ; `Support` → `Messages` ; `OfflineMode` / `Synchronization` → `Documents`. Un utilisateur Documents:READ voit Sync/Offline MVP. Un Utilisateurs:READ peut ouvrir Audit MVP.
5. **Paramètres** : `isSchoolSettingsOperator` = Superadmin ciblé ou Admin School. Un Préfet avec `Paramètres Établissement:READ` n’est pas opérateur (aligné Web hub).
6. **school_admin** : `schoolAdminForbiddenFeatures` bloque `Établissements` / `Abonnements` (correct). `AppNavigator` n’enregistre pas `SchoolManagement` pour `school_admin` (correct).
7. **Matrice globale** : Mobile lecture Superadmin only, mutation flag false — **conforme** mandat §7.
8. **Attribution de rôle établissement** : Mobile `grantClientsUserRole` / `revoke` — autorisé si API + RBAC + scope école ; à conserver, **sans** pouvoir attribuer `super_admin` / `country_admin` (à verrouiller par tests rouges dédiés si pas déjà couverts côté API).

### 4.7 Différences de contrats API

| Sujet | Web | Mobile |
|---|---|---|
| Classes / élèves / notes / présences / payments cancel | `/api/classes`, `/students`, `/notes`, `/presences`, `/payments` | identiques |
| Sync lecture | GET métier | **en plus** `/api/mobile-sync/l1/{classes,students,assignments,school-courses,course-schedules}` (additif, mêmes jetons) |
| Examens | `/api/exams` + validate/cancel/archive | non appelé |
| Parents | `/api/parents/link` | non appelé |
| Impayés | `/api/backoffice/finance/unpaid` + reminders | non appelé ; KPI local sur `payments` |
| Grilles | `/api/finance/fee-grids` (+ apply) | non appelé |
| Bulletins write | `/api/report-cards/generate\|publish\|archive` | GET + PDF élève |
| Documents école | `/api/school-documents` | non appelé |
| Salles write | `/api/school-rooms` CRUD | GET only |
| Remplacements delete | DELETE API Web UI | fonction API Mobile **non utilisée** par `TimetableScreen` |
| Navigation notif | 9 types résolus | 1 type (`finance_obligation`) + défaut Home |
| State legacy | 410 | `saveBackOfficeState` rejeté `BACKOFFICE_STATE_WRITE_REMOVED` |

### 4.8 Différences de persistance PostgreSQL

Aucune **deuxième base** métier Mobile n’a été identifiée pour les writes canoniques listées dans `mobileMutationInventory.ts`. Les writes listées ciblent les mêmes tables que le Web (`classes`, `students`, `attendance`, `evaluations`/`grades`, `payments`, `school_conversations`, `announcements`, `communication_notifications`, `course_schedule_slots`, `course_schedule_replacements`, `users`/`user_roles`, `teachers`/`teacher_assignments`).

Écarts de **persistance effective** (l’utilisateur Mobile ne peut pas écrire ce que le Web écrit) :

| Table / agrégat PG | Web écrit | Mobile écrit |
|---|---|---|
| `exams` / `exam_results` | oui | non |
| `contact_relations` via `/parents/link` | oui | non |
| `fee_grids` / `school_fee_items` / apply → `student_fee_obligations` | oui | non (lecture obligations seulement) |
| `payment_reminders` | oui (Impayés) | non |
| `report_cards` generate/publish/archive | oui | lecture + PDF |
| `school_documents` | oui | non |
| `school_rooms` | CRUD | lecture |
| `course_schedule_replacements` | CRUD | create seulement |

Outbox Mobile (présences, notes, messages) : file **puis** API ; succès UI après confirm — pas une source de vérité parallèle une fois sync OK. Finance **interdit** outbox (F5).

### 4.9 P0 identifiés

**Aucun P0 d’écriture / faux succès / fuite tenant n’est démontré** sur le graphe établissement live (drawer + tabs + stack) dans cet audit statique.

Les mutations cœur (classes, élèves, notes, présences, paiements, messages) affichent une erreur serveur ou bloquent hors-ligne ; `SafeAdminCrudScreen` **n’écrit pas**.

**Candidat P0 — vérité opérationnelle Impayés (à tranché par tests rouges) :**

- **Fichier Mobile :** `HomeScreen.tsx` L380–381 + `schoolMetrics.getPaymentStats` L103–126.
- **Fichier Web :** `FinanceUnpaidPage.tsx` + `GET /backoffice/finance/unpaid`.
- **Problème :** le KPI Mobile « Impayés » compte des **reçus** encore `pending`, pas les **obligations** ouvertes (`student_fee_obligations`).
- **Risque :** décision d’encaissement / relance sur un agrégat faux par rapport au Web.
- **Recommandation :** test rouge `Mobile_unpaid_kpi_should_match_web_obligation_ledger` puis soit brancher l’API unpaid, soit **retirer le libellé Impayés** tant que le ledger n’est pas là.

Pas d’autre P0 déclaré sans runtime.

### 4.10 P1 identifiés

| ID | Écart | Preuves | Lot proposé |
|---|---|---|---|
| P1-01 | Examens absents Mobile alors que RBAC `appliesMobile: true` et defaults Admin School `Examens:*` | Web `App.tsx` `/examens` ; `examsApi.ts` ; Mobile aucun screen ; `functionalModulesCatalog.js` L36 | B-examens |
| P1-02 | Relations parent-enfant absentes ; `appliesMobile: false` alors que mandat Lot A | Web `parentsApi.ts`, `ParentChildRelationsPage` ; Mobile 0 `/parents/link` | A-relations |
| P1-03 | Frais & tarifs absents (grilles / apply) | Web `FinanceFeesPage` `/finance/fee-grids` ; catalogue L26 `appliesMobile: false` | C-tarifs |
| P1-04 | Impayés absents + KPI sémantique divergente | Web unpaid API ; Mobile KPI payments | C-impayes |
| P1-05 | Bulletins : pas de generate/publish/archive | Web `reportCardsApi.ts` ; Mobile `ReportCardsScreen.tsx` download PDF | B-bulletins |
| P1-06 | Fiche élève incomplète vs dossier Web | Web `studentWorkspaceNavigation.ts` 7 modules ; Mobile `StudentDetailScreen` hub 3 liens | A-fiche |
| P1-07 | Documents MVP (pas `/school-documents`) | Web `schoolDocumentsApi.ts` ; Mobile `MvpUtilityScreens.tsx` L71 | E-documents **ou retirer** |
| P1-08 | Rapports MVP compteurs locaux | `ReportsScreen` `getPaymentStats` local | **retirer** (Web conformité déjà MVP) |
| P1-09 | Navigation notification 1/9 types | Web `notificationNavigation.ts` L26–51 ; Mobile `pushNotificationDestinations.ts` L1–35 | D-deeplink |
| P1-10 | Catalogue `appliesMobile: false` vs EDT/salles/remplacements déjà partiels | `functionalModulesCatalog.js` L37–39 vs `TimetableScreen.tsx` L80–84 | B-planning-rbac |
| P1-11 | CRUD salles absent | Web `PlanningRoomsPage` ; Mobile `getSchoolRooms` only | B-salles |
| P1-12 | Remplacement : pas de delete UI | inventory vs `TimetableScreen` create only | B-planning |
| P1-13 | Entrées fail-closed / plateforme encore navigables (hors school_admin drawer quotidien, mais stack AdminCrud ouvert dès Teachers/Users/Payments) | `AppNavigator.tsx` L234–285 ; drawer plateforme L72–82 | hide-platform |
| P1-14 | Hub Paramètres sans grilles financières | Web `SettingsHubPage` carte Finances ; Mobile `ConfigurationScreen.tsx` L19–50 5 cartes | C-tarifs / E-settings |

### 4.11 Lots de correction proposés (ordre)

Chaque lot futur : tests rouges d’abord → correction minimale → Draft → STOP CTO. **Aucun lot plateforme.**

| Lot | Contenu | P | Hors lot |
|---|---|---|---|
| **L0 — Hygiène Mobile** | Retirer / cacher : drawer plateforme fail-closed, KPI Pays/Écoles, cartes SchoolManagement sans écran, Documents/Rapports/Audit MVP **ou** les marquer explicitement non opérationnels ; supprimer ou isoler `MenuScreen` mort | P1 | ne pas construire Superadmin Mobile |
| **L1 — Impayés + vérité KPI** | Brancher `GET /backoffice/finance/unpaid` **ou** retirer le mot « Impayés » du KPI ; relances si permission | P1/P0-cand | pas de PSP |
| **L2 — Frais & tarifs** | UI Mobile grilles + apply (mêmes `/finance/fee-grids`) pour Admin School / Comptable selon RBAC | P1 | pénalités non livrées Web |
| **L3 — Relations parent-enfant** | Écran établissement `POST /parents/link` + archive ; `appliesMobile: true` | P1 | CRM contacts générique |
| **L4 — Examens** | Écran établissement sur `/api/exams` (CRUD + validate/cancel selon jetons) | P1 | — |
| **L5 — Bulletins write** | generate / publish / archive si `Bulletins:CREATE/UPDATE` ; garder PDF | P1 | GrapesJS Superadmin |
| **L6 — Dossier élève** | responsables / médical / documents dossier / historique en lecture puis write selon `student.*` | P1 | modules Web pas encore routés (discipline, access) |
| **L7 — Planning complément** | CRUD salles ; delete remplacement ; aligner `appliesMobile` planning/rooms/replacements | P1 | conflits P2 |
| **L8 — Deep-link C4 Mobile** | Reprendre les 9 types Web vers routes Mobile existantes (messages, annonces, paiements, présences, notes, bulletins, EDT, remplacements) | P1 | ne pas ouvrir de ressource cross-tenant |
| **L9 — Documents canoniques** | Soit `/school-documents` soit **retrait** de l’entrée drawer | P1 | attestations non livrées Web settings |

P2 explicitement **non bloquants** : Mobile Money, exports Excel, vues planning prof/salle, confort drawer, ComingSoon Apparence.

---

## 5. Preuves détaillées des cas connus (mandat §13)

### Examens Mobile

- Web : route `/examens` → `EntityPage entity="exams"` ; `web/src/lib/examsApi.ts` list/create/patch/validate/cancel/archive.
- Mobile : pas de `Exams` dans `RootStackParamList` (`AppNavigator.tsx`). Occurrences : label mort `AdminCrudScreen.tsx`, `catalog.ts`, `isExamSlot` planning, defaults RBAC.
- PG : `exams`, `exam_results` (`schema.sql`).
- **Écart P1-01.**

### Relations parent-enfant Mobile

- Web : `web/src/lib/parentsApi.ts` `linkParent` ; permission `canLinkParent` (`permissions.ts` L312+).
- Mobile : **aucune** occurrence `parents/link`. Parent : `StudentSwitcher` + `user.children`.
- Catalogue : `relations` `appliesMobile: false`.
- **Écart P1-02.**

### Frais et tarifs

- Web : `financeApi.listFeeGrids` `/finance/fee-grids` ; settings `/parametres/finances`.
- Mobile : `getStudentFees` seulement ; pas de fee-grids.
- **Écart P1-03.**

### Impayés

- Web : `GET /backoffice/finance/unpaid`, reminders, QuickPayment depuis ledger.
- Mobile : Home KPI `unpaidPayments` → `Payments` ; stats = pending **payments**.
- **Écart P1-04 + candidat P0 sémantique.**

### Bulletins complets

- Web write : `reportCardsApi.generate|publish|archive`.
- Mobile : `getReportCards` + `downloadReportCardPdf` ; `isPublishedBulletin` pour CTA PDF.
- **Écart P1-05.**

### Documents

- Web école : `schoolDocumentsApi` `/school-documents`.
- Mobile : hub MVP. **Écart P1-07.**

### Rapports

- Web `/administration/conformite` déjà table MVP (`MVP_COVERAGE`).
- Mobile `ReportsScreen` agrège le cache client. **Retirer** plutôt que parité pixel. P1-08.

### Paramètres établissement manquants

- Mobile hub 5 cartes vs Web 14 (dont ComingSoon / plateforme / SaaS).
- Manque métier établissement : **Finances grilles**. Sécurité/export = P2. Mon abonnement = Web-only SaaS.

### `schools`, `subscriptions`, `courses`, `assignments` → CRUD générique

- `ADMIN_CRUD_ONLY_ENTITIES` + `SafeAdminCrudScreen`.
- Live établissement : **pas** dans le drawer `school_admin`. Reste : rôles plateforme, `SchoolManagement` (non school_admin), `MenuScreen` mort, stack `AdminCrud` monté dès qu’un des écrans Teachers/Users/Payments est autorisé (`AppNavigator.tsx` L234–285) — un deep-link `AdminCrud` reste possible.
- **L0 hide.**

### Navigation Web vs drawer Mobile

Web sidebar établissement : Mon établissement, Planning, Présences, Notes, Examens, Bulletins, Finances (3 onglets), Paramètres. Comms en topbar.

Mobile school_admin drawer quotidien : Élèves, Classes, Présences, Paiements, Enseignants, Notes, EDT. Admin : Users, Bulletins, Annonces, Messages, Notifs, **Documents, Rapports**, Structure, Paramètres, Sync, Offline, Support.

**Manques drawer vs Web :** Examens, Frais, Impayés, Relations (sous Mon établissement Web).  
**Surplus drawer :** Documents/Rapports/Sync/Offline/Support MVP.

### Fonctions plateforme encore exposées Mobile

Oui, pour `super_admin` / `country_admin` uniquement dans le drawer prévu. **Pas un manque de parité** : à **retirer** du Mobile (L0), pas à implémenter.

---

## 6. HORS PÉRIMÈTRE — NON MODIFIÉ

Découverts pendant l’audit, **non corrigés** (mandat §14).

| Fichier | Problème | Risque | Recommandation |
|---|---|---|---|
| `backend/server.js` GET `/api/courses` | lecture encore via `getAuthoritativeBackOfficeState` (hybride legacy) alors que writes PG | dette lecture cours | lot plateforme/pédagogie dédié, pas ce chantier |
| `backend/server.js` `/api/mvp/*` | agrégats MVP, RBAC faible | surface morte / faible | ne pas brancher Mobile dessus |
| `web/src/pages/parametres/SettingsHubPage.tsx` | cartes ComingSoon Notifications/Apparence/Intégrations badge « Bientôt » | pas un écart Mobile | settings-audit existant |
| `web` `canDesignBulletins` Superadmin | conception GrapesJS | plateforme | rester Web-only |
| `web` `/administration/conformite` | Rapports déjà MVP | trompeur Web aussi | pas de parité Mobile |
| `web` `studentWorkspace` modules attendance/grades/finance/discipline/access | catalogue dossier **non routé** Web | parité future vs Mobile hub | ne pas exiger Mobile au-delà du Web réel |
| Communications 5/9 événements sans producteur | `communications-final-audit-2026-09-09.md` | inbox incomplète | chantier communications, pas parité UI |
| `packages/auth` permissions `platform:*` | couche identité distincte des jetons `Module:ACTION` | confusion audit | documenter seulement |
| Render / Supabase / EAS / CI | — | — | interdit |

---

## 7. Méthode et limites de cet audit

- **Statique** : routes Web (`web/src/App.tsx`, `constants.ts`), stack/drawer Mobile, `server.js` / `rbacService.js` / `functionalModulesCatalog.js`, inventaire mutations Mobile, audits F5 / settings / C4 déjà mergés.
- **Pas** d’exécution runtime établissement, pas de nouveaux tests rouges (mandat : audit d’abord, tests rouges **avant correction** dans un lot suivant).
- **Pas** de modification applicative.

Tests rouges **à créer dans les lots suivants** (exemples mandat, non ajoutés ici) :

```text
Mobile_exam_creation_should_match_web_contract
Mobile_fee_management_should_use_canonical_api
Mobile_parent_relation_should_persist_in_postgres
Mobile_hidden_platform_features_should_not_be_navigable
Mobile_forbidden_role_should_not_see_cta
Mobile_api_failure_should_not_show_success
Mobile_unpaid_kpi_should_match_web_obligation_ledger
Mobile_report_card_publish_should_use_canonical_api
Mobile_notification_deeplink_should_match_web_types
```

---

## 8. STOP CTO

```text
SHA develop audité : 1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82
Correction code    : NON
Plateforme         : NON TOUCHÉ
Ready / merge      : INTERDIT
Suite              : décision CTO sur L0…L9
```

**Question fermée pour le CTO :**

1. Confirmer que Superadmin/Admin Pays Mobile = **retrait** (L0), jamais construction.  
2. Trancher Impayés : **brancher le ledger** (L1) vs **retirer le KPI** en attendant.  
3. Trancher Documents/Rapports Mobile : **retrait** vs API canonique.  
4. Autoriser ou non le basculement `appliesMobile: true` pour planning / salles / remplacements / relations / frais / impayés **dans un lot RBAC catalogue** (sans UI Superadmin nouvelle).
