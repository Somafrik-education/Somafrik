# Audit global de parité Web / Mobile — Somafrik

**Nature :** AUDIT uniquement. Aucune correction métier. Aucun refactor opportuniste.  
**Mobile :** application native Expo / React Native uniquement. Le Web responsive n’est **pas** Mobile.  
**Branche :** `cursor/audit-web-mobile-parity-global-ae6a`  
**Base :** `develop`  
**Date :** 2026-09-18  
**Production code changed :** non  
**Backend touched :** non  

## STOP obligatoire

- **STOP.** Cette PR reste **Draft**.
- Ne pas passer Ready. Ne pas merger. Ne pas lancer les lots sans **GO CTO**.
- Un GREEN CI n’autorise pas le merge.
- Avant tout futur merge : le CTO effectue un **diff GitHub indépendant** du diff présenté ici.

---

## 1. Question produit

> Pour chaque capacité métier de Somafrik, Web et Mobile permettent-ils d’effectuer la même opération, avec les mêmes règles métier, les mêmes autorisations et les mêmes données canoniques ?

**Réponse courte :** non, pas encore.  
Les **données persistées** (notes, paiements, impayés, présences enregistrées, classes, élèves, professeur principal, messages) reposent largement sur les **mêmes APIs PostgreSQL**. Les **écarts ouverts** sont surtout :

1. un **P0 présences** (défaut d’appel et KPI de saisie) ;
2. des **fonctions établissement / plateforme / finance / pédagogie / fiche élève** présentes sur Web et absentes ou partielles sur Mobile ;
3. des **gardes client** (mot de passe, `must_change_password`, catalogues RBAC) non alignées ;
4. du **legacy** encore lisible (GET role-permissions, `EntityPage`, écrans Mobile morts).

---

## 2. Méthode

Audit **statique du code actuel** (`develop` @ merge-base de cette branche), pas un audit visuel.

Pour chaque domaine :

1. routes Web (`web/src/App.tsx`) ;
2. écrans Mobile live (`Mobile/src/navigation/AppNavigator.tsx`) — hors graphe = mort ;
3. endpoints (`backend/server.js`, `reportCardHttp.js`) ;
4. permissions (`web/src/lib/permissions.ts`, `Mobile/src/domain/security/permissions.ts`, `backend/services/rbacService.js`) ;
5. règles métier et formules client ;
6. transformations de contrats ;
7. dates (`JJ-MM-AAAA`) ;
8. legacy BackOffice / V1.

Preuves reproductibles :

| Artefact | Rôle |
|---|---|
| `docs/audits/evidence/web-mobile-parity-inventory.json` | Inventaire routes / écrans / APIs |
| `scripts/web-mobile-parity-audit.green.test.ts` | Caractérisation des contrats **alignés** |
| `scripts/web-mobile-parity-audit.red.test.ts` | Caractérisation des **écarts ouverts** (doivent échouer) |
| `scripts/verify-web-mobile-parity-audit.js` | Gate d’audit |
| `docs/audits/web-mobile-parity-matrix.json` | Matrice machine + lots |

Audits antérieurs **réutilisés comme hypothèses, revalidés** sur le code actuel : scolarité L0, finance L2, pédagogie L3, communication GREEN, dates, settings, RBAC CRUD.

---

## 3. Couverture

| Indicateur | Valeur |
|---|---:|
| Fonctionnalités inspectées | 96 |
| Parfaitement alignées | 38 |
| Divergences **P0** | 1 |
| Divergences **P1** | 28 |
| Divergences **P2** | 22 |
| Divergences **P3** | 7 |
| Routes Web sans équivalent Mobile live | 34 |
| Écrans Mobile live sans équivalent Web | 6 |
| Endpoints / chemins legacy détectés | 9 |
| Écrans Mobile morts / orphelins | 5 |

Les 38 alignements sont des **capacités métier réellement opérables des deux côtés** (même API + même règle persistée), pas une parité pixel.

---

## 4. Matrice générale

Légende Web / Mobile : **Oui** = capacité live ; **Partiel** ; **Non** ; **Mort** = fichier hors graphe.  
Statut : **ALIGNÉ** / **OUVERT**.

| ID | Domaine | Fonction | Web | Mobile | Backend/API | Gravité | Statut |
| -- | ------- | -------- | --- | ------ | ----------- | ------- | ------ |
| PARITY-001 | Présences | Défaut d’appel + enregistrement | Présent implicite | `null` + save bloqué | `POST /presences` | **P0** | OUVERT |
| PARITY-001b | Présences | % brouillon incomplet | 100 % roster | % sur roster (non-saisis = 0) | client | **P0** | OUVERT |
| PARITY-010 | Auth | Login | `POST /backoffice/login` | `POST /login` + `/identify` | split canal | P1 | OUVERT |
| PARITY-011 | Auth | `must_change_password` | token en sessionStorage | session restreinte | `POST /auth/change-password` | P1 | OUVERT |
| PARITY-012 | Auth | Politique mot de passe UI | min 6 | min 6 | min 8 + lettre + chiffre | P1 | OUVERT |
| PARITY-013 | Scolarité | Fiche élève workspace | 12 modules | 3 sous-écrans | `GET /students/:id` | P1 | OUVERT |
| PARITY-014 | Scolarité | Relations parent–enfant | Oui | Non (hydratation sans UI) | `/backoffice/relations` | P1 | OUVERT |
| PARITY-015 | Finance | Grilles de frais | Oui | Non | `/finance/fee-grids` | P1 | OUVERT |
| PARITY-016 | Finance | Impayés (relances, filtres, encaissement) | Complet | Liste ledger | `/backoffice/finance/unpaid` | P1 | OUVERT |
| PARITY-017 | Planning | EDT + salles + remplacements + conflits | Complet | Lecture `Timetable` | `/course-schedules*` | P1 | OUVERT |
| PARITY-018 | Plateforme | Pays / établissements / abonnements / référentiels | Oui | Non (L0 retiré) | `/backoffice/*` | P1 | OUVERT |
| PARITY-019 | Config | Paramètres avancés (sécu, données, notifs, docs, abo) | Hub complet | 6 cartes | mixte | P1 | OUVERT |
| PARITY-020 | Dashboard | Charts configurables + KPI relations | Oui | 4 KPI rôle | BO chart-config | P1 | OUVERT |
| PARITY-021 | RBAC | Matrice permissions Superadmin | Oui | Écran orphelin | `/backoffice/rbac/*` | P1 | OUVERT |
| PARITY-022 | Présences | KPI jour Accueil enseignant | fail-closed | % partiel + TZ appareil | client | P1 | OUVERT |
| PARITY-023 | Pédagogie | Workflow bulletins (modèle, histo, publication) | Complet | Lecture snapshot | `/report-card/*` | P1 | OUVERT |
| PARITY-024 | Pédagogie | Examens | `EntityPage` | Non | `/exams` | P1 | OUVERT |
| PARITY-025 | Admin | Documents / conformité / export | Oui | Non | `/school-documents`, `/data-export` | P1 | OUVERT |
| PARITY-026 | Communication | Visibilité Notifications | implicite établissement | `Notifications:READ` | interne | P1 | OUVERT |
| PARITY-027 | RBAC | Catalogue CRUD modules client | 27 modules | 21 modules | 30 modules PG | P1 | OUVERT |
| PARITY-028 | Enseignants | Création identité | Users flow (POST `/teachers` 403) | `POST /backoffice/users/create-teacher` | canonique Users | P1 | OUVERT |
| PARITY-029 | Config | Auto-ouverture setup après login | Oui | Widget Accueil | `GET /v2/school-setup/status` | P1 | OUVERT |
| PARITY-030 | Auth | Expiration session globale | pas de clear | SecureStore clear | `POST /auth/refresh` | P1 | OUVERT |
| PARITY-031 | Scolarité | Inscription classe-first | page classe | CTA liste élèves | `POST /classes/:code/students` | P1 | OUVERT |
| PARITY-032 | Scolarité | Transfert / validation / clôture C18 | repo local Web | Non | pas d’API REST | P1 | OUVERT |
| PARITY-033 | Pédagogie | Moyenne parent filtrée cours | formule plate evalCoef | N/A filtre | `/notes` | P1 | OUVERT |
| PARITY-034 | Communication | Push | pas de Web Push | Expo push | `/mobile/push-devices` | P1 | OUVERT |
| PARITY-035 | Legacy | GET role-permissions | encore lu | rejeté local | GET live / PUT 403 | P1 | OUVERT |
| PARITY-036 | Finance | Paiement parent | Web paiements élève | `MobilePayment` MVP | partiel | P1 | OUVERT |
| PARITY-037 | Config | Catalogue pédagogique école | path backoffice scopé | `/education-reference/catalog` | dual path | P1 | OUVERT |
| PARITY-050 | Auth | Identify pré-login | Non | Oui | `POST /identify` | P2 | OUVERT |
| PARITY-051 | Auth | Mapping 423 lockout | message serveur | heuristique générique | 423 | P2 | OUVERT |
| PARITY-052 | Scolarité | Élèves d’une classe | page dédiée | liste filtrée | même API | P2 | OUVERT |
| PARITY-053 | Planning | Salles / remplacements / conflits | Oui | Non | APIs planning | P2 | OUVERT |
| PARITY-054 | Pédagogie | Conception / config bulletins | Oui | Non | templates + superadmin | P2 | OUVERT |
| PARITY-055 | Communication | Préférences canaux | Topbar / settings | sheet via Menu mort | `/me/communication-preferences` | P2 | OUVERT |
| PARITY-056 | Finance | Chemin paiements | `EntityPage` | `PaymentsScreen` | `GET /payments` | P2 | OUVERT |
| PARITY-057 | Présences | Badge classe | compteur lignes | % fail-closed | client | P2 | OUVERT |
| PARITY-058 | Présences | Taux fiche élève | historique lignes | historique lignes | `/presences` | P2 | OUVERT |
| PARITY-059 | Dashboard | Tuile Parents & élèves | hub établissement | absente Accueil | relations | P2 | OUVERT |
| PARITY-060 | Pédagogie | Stats classe notes | `ClassGradesOverview` | Non | `/notes` | P2 | OUVERT |
| PARITY-061 | Legacy | Écrans morts Mobile | N/A | 5 fichiers | — | P2 | OUVERT |
| PARITY-062 | RBAC | Strip Pays CREATE/DELETE Admin Pays | Web | absent | API | P2 | OUVERT |
| PARITY-063 | Finance | Onglet Frais | dédié | embarqué paiements | fee-grids | P2 | OUVERT |
| PARITY-064 | RBAC | Onglet Rôles visible layout Web | visible | N/A | PermissionRoute | P2 | OUVERT |
| PARITY-065 | Mobile | Offline / sync / support | Non | Oui | L1 + outbox | P2 | OUVERT |
| PARITY-066 | Présences | TZ jour enseignant Accueil | TZ école | TZ appareil | client | P2 | OUVERT |
| PARITY-067 | Auth | Rôles plateforme UX | onglets | codes magiques | équivalent | P2 | OUVERT |
| PARITY-068 | Communication | Notifs plateforme | Oui | écran orphelin | `/backoffice/notifications` | P2 | OUVERT |
| PARITY-069 | Config | Rooms CRUD | Oui | lecture | `/school-rooms` | P2 | OUVERT |
| PARITY-070 | Auth | Logout push/outbox | API only | + push revoke | `/auth/logout` | P2 | OUVERT |
| PARITY-071 | Pédagogie | `GradeBookService` Mobile mort | N/A | fichier non branché | — | P2 | OUVERT |
| PARITY-080 | Dates | Dates finance | `JJ/MM/AAAA` | `JJ/MM/AAAA` | contrat `JJ-MM-AAAA` | P3 | OUVERT |
| PARITY-081 | Dates | Hint naissance inscription | `AAAA-MM-JJ` | N/A | contrat UI | P3 | OUVERT |
| PARITY-082 | Dates | `unpaidModule` locale short | `17 sept. 2026` | — | hors gate | P3 | OUVERT |
| PARITY-083 | Présences | Libellé mass action | Tous présents | Tout présent | — | P3 | OUVERT |
| PARITY-084 | Auth | Préremplissage superadmin | manuel | raccourci | — | P3 | OUVERT |
| PARITY-085 | Dashboard | Libellés KPI rôle | charts | 4 cartes | — | P3 | OUVERT |
| PARITY-086 | UX | Cartes vs tables | tables | `ExpandableEntityCard` | volontaire | P3 | ALIGNÉ UX |
| ALIGN-01 | Scolarité | Liste classes | Oui | Oui | `GET /classes` | — | **ALIGNÉ** |
| ALIGN-02 | Scolarité | Liste élèves | Oui | Oui | `GET /students` | — | **ALIGNÉ** |
| ALIGN-03 | Scolarité | Inscription API | Oui | Oui | `POST /classes/:code/students` | — | **ALIGNÉ** |
| ALIGN-04 | Enseignants | Professeur principal | Oui | Oui | `/classes/:code/head-teacher` | — | **ALIGNÉ** |
| ALIGN-05 | Enseignants | Liste / affectations | Oui | Oui | `/teachers`, `/assignments` | — | **ALIGNÉ** |
| ALIGN-06 | Finance | Taux de paiement KPI | Oui | Oui | `GET /finance/student-fees` | — | **ALIGNÉ** |
| ALIGN-07 | Finance | Ledger impayés montants | Oui | Oui | `GET /backoffice/finance/unpaid` | — | **ALIGNÉ** |
| ALIGN-08 | Finance | Encaissement `obligationId` | Oui | Oui | `POST /payments` | — | **ALIGNÉ** |
| ALIGN-09 | Présences | Statuts persistés P/A/R/J | Oui | Oui | `POST /presences` | — | **ALIGNÉ** |
| ALIGN-10 | Présences | KPI jour admin fail-closed | Oui | Oui | client + TZ école | — | **ALIGNÉ** |
| ALIGN-11 | Pédagogie | Moyenne générale staff | Oui | Oui | `gradesCanonical` | — | **ALIGNÉ** |
| ALIGN-12 | Communication | Messages / annonces / C4 | Oui | Oui | backoffice comms | — | **ALIGNÉ** |
| ALIGN-13 | Config | Setup / année / structure / profil | Oui | Oui | v2 + school-settings | — | **ALIGNÉ** |
| ALIGN-14 | Dates | Helpers `dates.ts` | Oui | Oui | contrat JJ-MM-AAAA | — | **ALIGNÉ** |
| ALIGN-15 | Auth | refresh / logout / permissions live | Oui | Oui | `/auth/*` | — | **ALIGNÉ** |
| ALIGN-16 | RBAC | JWT n’est plus l’autorité API | Oui | Oui | `requirePermission` PG | — | **ALIGNÉ** |
| ALIGN-17 | UX Mobile | Progressive disclosure PD-01…07 | N/A | Oui | contrat UX | — | **ALIGNÉ** |
| ALIGN-18 | Legacy | PUT `/backoffice/state` | 410 | stub reject | gone | — | **ALIGNÉ** |
| ALIGN-19 | Scolarité | Hub Scolarité | vue-ensemble | `SchoolingHubScreen` | classes/students/years | — | **ALIGNÉ** |
| ALIGN-20 | Finance | Caisse encaissée / non imputé | Oui | Oui | payments DTO | — | **ALIGNÉ** |

---

## 5. Fiches détaillées

### PARITY-001 — Défaut d’appel et enregistrement implicite Présent

**Domaine :** Présences  
**Gravité :** P0  

**Web :** `rollCallInitialStatus` retourne `"Présent"` si aucune ligne du jour. Sauvegarde : `attendance[studentId] ?? "Présent"` — un enseignant peut enregistrer tout le roster Présent sans toucher un élève.  
**Mobile :** `hydrateRollCallStatus` retourne `null`. `assertRollCallReadyToSave` bloque si un élève n’a pas de statut explicite. Action de masse « Tout présent » existe, mais ce n’est pas le défaut.  
**Backend :** `POST /api/presences` — unicité école+élève+jour ; Justifié = `excused`, `present=false`.  

**Comportement attendu :** workflow cible unique : **Présent par défaut + changement de statut simple**, identique Web/Mobile. Pourcentages identiques.  
**Comportement constaté :** avant enregistrement, Web affiche 100 % Présent ; Mobile affiche des non-saisis. Un save Web peut écrire Présent pour des élèves jamais revus.  
**Cause probable :** durcissement Mobile « jamais inventer Présent » (`attendanceTruth.ts`) vs contrat produit Web historique.  
**Fichiers concernés :** `web/src/lib/presenceMetrics.ts`, `web/src/pages/PresencesPage.tsx`, `Mobile/src/lib/attendanceTruth.ts`, `Mobile/src/screens/TeacherAttendanceScreen.tsx`  
**Endpoints concernés :** `GET/POST /api/presences`  
**Risque :** **données différentes** pour le même appel ; corruption douce (faux Présent).  
**Correction recommandée :** LOT 0 — unifier le défaut **Présent** sur Mobile **ou** exiger un statut explicite aussi sur Web. Aligner le KPI brouillon. Ne pas restaurer un workflow legacy. Test RED `PARITY-001` / `PARITY-001b`.

---

### PARITY-010 — Canaux de login différents

**Domaine :** Authentification  
**Gravité :** P1  

**Web :** `POST /api/backoffice/login` `{ identifier, password, schoolCode? }`.  
**Mobile :** `POST /api/identify` puis `POST /api/login` `{ role, identifier, pin, schoolCode? }`.  
**Backend :** `BackOfficeAccessService` vs `AuthService` ; JWT `authSource` distinct.  

**Comportement attendu :** mêmes comptes → mêmes claims, permissions, `mustChangePassword`.  
**Comportement constaté :** Web autorise un superset de rôles (`WEB_PLATFORM_DEMO_ROLES` Parent/Élève/Enseignant + `accessChannel=BackOffice`). Mobile : `managedMobileRoles` + rejet « compte réservé à la plateforme ». Directeur adjoint / variantes de labels peuvent ne pas mapper.  
**Cause probable :** split canal volontaire, matrices d’éligibilité non unifiées.  
**Fichiers concernés :** `web/src/context/AuthContext.tsx`, `Mobile/src/services/api.ts`, `backend/services/authService.js`, `backend/services/backOfficeAccessService.js`  
**Endpoints concernés :** `/api/backoffice/login`, `/api/login`, `/api/identify`  
**Risque :** un utilisateur passe sur Web et est refusé sur Mobile (ou l’inverse).  
**Correction recommandée :** matrice de comptes fixtures sur les deux endpoints ; documenter la politique produit ; étendre `managedMobileRoles` si parité requise.

---

### PARITY-011 — `must_change_password` Web persiste la session complète

**Domaine :** Authentification  
**Gravité :** P1  

**Web :** modal sur `LoginPage` ; `ProtectedRoute` ne teste que `isAuthenticated` (présence token). Tokens en `sessionStorage`. Annuler = `setSession(null)`.  
**Mobile :** `beginRestrictedSession` ; `httpClient` bloque tout sauf `/auth/change-password` ; pas d’Annuler ; pas de restore Home.  
**Backend :** 403 hors `/auth/change-password`.  

**Comportement attendu :** aucun shell métier tant que le mot de passe n’est pas changé.  
**Comportement constaté :** navigation manuelle Web vers une URL protégée possible (UI) ; API bloquée. Mobile conforme.  
**Cause probable :** durcissement Mobile post data-truth ; Web s’appuie uniquement sur le backend.  
**Fichiers concernés :** `web/src/components/ProtectedRoute.tsx`, `web/src/pages/LoginPage.tsx`, `Mobile/src/lib/restrictedSession.ts`, `Mobile/src/services/httpClient.ts`  
**Endpoints concernés :** `POST /api/auth/change-password`  
**Risque :** fuite UI / confusion session ; pas un contournement API.  
**Correction recommandée :** LOT 0 — garde `mustChangePassword` sur `ProtectedRoute` + session restreinte, miroir Mobile.

---

### PARITY-012 — Validation mot de passe client ≠ politique backend

**Domaine :** Authentification  
**Gravité :** P1  

**Web :** `passwordChangeSchema` Zod `.min(6)`.  
**Mobile :** `submitNewPassword` `length < 6`.  
**Backend :** `validatePasswordPolicy` min 8 + lettre + chiffre ; PIN = 6 chiffres.  

**Comportement attendu :** le client refuse ce que le serveur refuse.  
**Comportement constaté :** un mot de passe 6–7 caractères passe l’UI puis 400 API.  
**Cause probable :** schéma UI non mis à jour après durcissement serveur.  
**Fichiers concernés :** `web/src/pages/LoginPage.tsx`, `Mobile/src/screens/LoginScreen.tsx`, `backend/lib/userAccountRules.js`, `web/src/lib/userAccountRules.ts`  
**Endpoints concernés :** `POST /api/auth/change-password`  
**Risque :** friction, pas corruption.  
**Correction recommandée :** LOT 0 — réutiliser `validatePasswordPolicy` des deux côtés.

---

### PARITY-013 — Fiche élève incomplète sur Mobile

**Domaine :** Scolarité  
**Gravité :** P1  

**Web :** `StudentWorkspacePage` — modules `overview`, `identity`, `enrollments`, `guardians`, `attendance`, `grades`, `finance`, `documents`, `health`, `history` (+ discipline/access optionnels).  
**Mobile :** `StudentDetailScreen` + `StudentNotes` / `StudentPresences` / `StudentPayments`. Pas d’identité étendue, responsables, médical, documents, historique, C18.  
**Backend :** `GET /api/students/:id` + sous-ressources notes/presences/payments.  

**Comportement attendu :** mêmes informations critiques et mêmes actions métier.  
**Comportement constaté :** information critique perdue sur Mobile (responsables, inscription, santé, documents).  
**Cause probable :** workspace Web C18 vs hub Mobile 3 tuiles.  
**Fichiers concernés :** `web/src/lib/studentWorkspace.ts`, `web/src/pages/.../StudentWorkspacePage`, `Mobile/src/screens/StudentDetailScreen.tsx`  
**Endpoints concernés :** `GET /api/students/:id`  
**Risque :** décisions métier (santé, responsables, inscription) impossibles sur le terrain.  
**Correction recommandée :** LOT 2 — étendre la fiche Mobile aux modules critiques (identité, responsables, inscription) sans copier le pixel Web. Pattern cartes repliées.

---

### PARITY-014 — Relations parent–enfant absentes du graphe Mobile live

**Domaine :** Scolarité  
**Gravité :** P1  

**Web :** `/etablissement/relations-parent-enfant` → `ParentChildRelationsPage` / `EntityPage`.  
**Mobile :** hydratation `domainHydrationApi` sans écran.  
**Backend :** `GET/POST /api/backoffice/relations`, `/parents/link`.  

**Comportement attendu :** lier / consulter responsables depuis Mobile.  
**Comportement constaté :** lecture possible via API si le client l’appelle ; **aucune action UI**.  
**Cause probable :** lot L3 parent-relations reporté (`parite-web-mobile-l0-l1-matrix.json`).  
**Fichiers concernés :** `web/src/pages/etablissement/ParentChildRelationsPage.tsx`, `Mobile/src/services/domainHydrationApi.ts`  
**Endpoints concernés :** `/api/backoffice/relations`, `/api/parents/link`  
**Risque :** parité fonctionnelle ; pas de calcul divergent.  
**Correction recommandée :** LOT 2 — écran Mobile lecture + lien, même API, pas de workflow Students legacy.

---

### PARITY-015 / PARITY-016 — Finance : grilles et actions impayés

**Domaine :** Finance  
**Gravité :** P1  

**Web :** `/finances/frais` grilles ; `/finances/impayes` filtres classe/période, relances, encaissement rapide.  
**Mobile :** `UnpaidScreen` liste ledger ; pas de grilles ; pas de reminders.  
**Backend :** `GET/POST /api/finance/fee-grids`, `GET /api/backoffice/finance/unpaid`, `POST .../reminders`.  

**Comportement attendu :** mêmes montants (OK — ALIGN-07) **et** mêmes actions métier.  
**Comportement constaté :** montants alignés (`paymentRateKpi` copies identiques, ledger API). Actions manquantes Mobile.  
**Cause probable :** lots L2 GREEN montants ; L3 actions non portées.  
**Fichiers concernés :** `web/src/pages/finances/*`, `Mobile/src/screens/UnpaidScreen.tsx`, `Mobile/src/lib/paymentRateKpi.ts`  
**Endpoints concernés :** voir ci-dessus  
**Risque :** comptable Mobile ne peut pas relancer / paramétrer les grilles. Les **soldes d’un même élève sont identiques** si les deux clients lisent l’API.  
**Correction recommandée :** LOT 4 — port relances + filtres ; décider si les grilles restent Web-only (produit) ou Mobile lecture.

---

### PARITY-021 — Administration RBAC Mobile orpheline

**Domaine :** Utilisateurs / RBAC  
**Gravité :** P1  

**Web :** `/administration/permissions` Superadmin — catalogue PG, PATCH delta, onglet rôles.  
**Mobile :** `PermissionsScreen.tsx` existe ; **non enregistré** dans `AppNavigator` ; `canReadView(..., "Permissions")` **hardcodé false**.  
**Backend :** `GET/PATCH /api/backoffice/rbac/permissions` Superadmin only. PUT `/role-permissions` 403.  

**Comportement attendu :** soit Mobile administre la matrice, soit l’écran n’existe pas.  
**Comportement constaté :** code mort + faux sentiment de couverture.  
**Cause probable :** L0 hygiène a retiré la nav plateforme sans supprimer le fichier.  
**Fichiers concernés :** `web/src/pages/PermissionsPage.tsx`, `Mobile/src/screens/PermissionsScreen.tsx`, `Mobile/src/domain/security/permissions.ts`  
**Endpoints concernés :** `/api/backoffice/rbac/*`  
**Risque :** dette ; pas de contournement API (PATCH reste Superadmin).  
**Correction recommandée :** LOT 7/8 — retirer l’écran **ou** le brancher en lecture seule Superadmin. Ne pas réintroduire PUT legacy.

---

### PARITY-022 — KPI présence Accueil enseignant Mobile

**Domaine :** Présences / Tableau de bord  
**Gravité :** P1  

**Web :** `getTodayEstablishmentPresenceKpi` — `%` seulement si `recorded === expected`, sinon « — ». TZ école.  
**Mobile admin :** même contrat (`todayPresenceKpi.ts`).  
**Mobile teacher :** `getPresenceStats(presences du jour, teacherStudentIds)` **sans** exhaustivité ; `isTodayPresence` via **timezone appareil**.  

**Comportement attendu :** même source canonique, même fail-closed.  
**Comportement constaté :** 5/20 saisis → Mobile enseignant ~25–71 % selon formule ; Web « — ». Décalage minuit Kinshasa vs UTC.  
**Cause probable :** Accueil enseignant n’a pas basculé sur le contrat D3.5.  
**Fichiers concernés :** `Mobile/src/screens/HomeScreen.tsx`, `web/src/lib/presenceMetrics.ts`, `Mobile/src/lib/todayPresenceKpi.ts`  
**Endpoints concernés :** `GET /api/presences`  
**Risque :** **mauvaise donnée affichée** (pas persistée).  
**Correction recommandée :** LOT 0 — remplacer par `getTodayEstablishmentPresenceKpi` + TZ école.

---

### PARITY-027 — Dérive catalogues CRUD clients

**Domaine :** RBAC  
**Gravité :** P1  

**Web :** `CRUD_PERMISSION_MODULES` 27 items dont Frais, Impayés, Planning, Contacts, Relations.  
**Mobile :** 21 items — **omets** Contacts, Relations, Frais & tarifs, Impayés, Planning, Droits par rôle.  
**Backend :** 30 `functional_modules`.  

**Comportement attendu :** même catalogue (même si l’UI Mobile n’expose pas tous les modules).  
**Comportement constaté :** un Superadmin lisant un éventuel écran Mobile verrait une matrice incomplète.  
**Cause probable :** copies divergentes `constants.ts`.  
**Fichiers concernés :** `web/src/lib/constants.ts`, `Mobile/src/lib/constants.ts`, `backend/lib/functionalModulesCatalog.js`  
**Endpoints concernés :** `/api/backoffice/rbac/catalog`  
**Risque :** UI de gouvernance fausse ; l’API live reste complète.  
**Correction recommandée :** LOT 8 — une source partagée ou génération depuis le catalogue backend.

---

### PARITY-028 — Création enseignant : chemins API divergents

**Domaine :** Enseignants  
**Gravité :** P1  

**Web :** UI via Utilisateurs ; `teachersApi.create` → `POST /teachers` **toujours 403** `TEACHER_IDENTITY_MUST_COME_FROM_USERS` (non appelé UI).  
**Mobile :** `POST /backoffice/users/create-teacher`.  
**Backend :** identité enseignant **uniquement** depuis Users.  

**Comportement attendu :** même mutation canonique.  
**Comportement constaté :** Web API layer expose encore la route interdite ; Mobile utilise le chemin canonique.  
**Cause probable :** résidu V1 `POST /teachers`.  
**Fichiers concernés :** `web/src/lib/teachersApi.ts`, `Mobile/src/services/api.ts`  
**Endpoints concernés :** `POST /api/teachers` (403), `POST /api/backoffice/users/create-teacher`  
**Risque :** un appel futur Web casserait ; pas d’écriture live actuelle via ce helper.  
**Correction recommandée :** LOT 3/8 — supprimer l’export Web interdit ; documenter le seul chemin Users.

---

### PARITY-031 — Inscription : API V2 alignée, UX pas classe-first sur Mobile

**Domaine :** Scolarité  
**Gravité :** P1  

**Web :** `ClassStudentsPage` — Inscrire depuis la classe. `StudentsListPage` n’ajoute pas d’élève.  
**Mobile :** `enrollClassStudent` même `POST /classes/:code/students` ; CTA sur `StudentsScreen`.  
**Backend :** inscription via classe uniquement.  

**Comportement attendu :** « inscription d’un élève via sa classe ; aucun retour aux workflows legacy d’ajout élève ».  
**Comportement constaté :** API conforme ; parcours Mobile part de l’annuaire. AdminCrud création élève bloquée (mort).  
**Cause probable :** navigation Mobile liste-first.  
**Fichiers concernés :** `web/src/pages/etablissement/ClassStudentsPage.tsx`, `Mobile/src/lib/StudentMutationControls` / `StudentsScreen.tsx`  
**Endpoints concernés :** `POST /api/classes/:code/students`  
**Risque :** UX ; pas de POST `/students` legacy.  
**Correction recommandée :** LOT 2 — CTA principal sur `ClassesScreen` / hub Scolarité.

---

### PARITY-033 — Moyenne parent filtrée (formule plate)

**Domaine :** Pédagogie  
**Gravité :** P1  

**Web :** moyenne générale = `GradeBookService.getStudentAverageValue` (2 niveaux, coef cours). Filtre cours : `parentGradesKpis` pondère **uniquement** `evaluationCoefficient`.  
**Mobile :** `canonicalStudentGeneralAverage` 2 niveaux (ALIGN-11). Pas de filtre cours équivalent.  
**Backend :** `gradesCanonical.weightedAverage` + `GradeBookService`.  

**Comportement attendu :** calculs identiques.  
**Comportement constaté :** dataset Maths 10×1+20×3 (coef 2) + Français 12 (coef 1) → générale **15,67** (canonique) vs plate **16,4** (interdite). Le panel parent utilise la canonique **sans** filtre ; **avec** filtre cours la plate s’applique.  
**Cause probable :** KPI parent historique.  
**Fichiers concernés :** `web/src/lib/parentNotes.ts`, `web/src/components/grades/ParentChildGradesPanel.tsx`, `Mobile/src/lib/pedagogyAverage.ts`, `backend/lib/gradesCanonical.js`  
**Endpoints concernés :** `GET /api/notes`  
**Risque :** moyenne affichée fausse si filtre cours ; générale OK.  
**Correction recommandée :** LOT 5 — `parentGradesKpis` doit réutiliser `GradeBookService` / `gradesCanonical`.

---

### PARITY-080 — Dates finance en `JJ/MM/AAAA`

**Domaine :** Dates  
**Gravité :** P3  

**Web / Mobile :** `formatFinanceDate` convertit vers **slash** `19/08/2026`. Test Mobile `financeCurrency.test.ts` fige ce format.  
**Cible produit :** **JJ-MM-AAAA**. Helpers `dates.ts` déjà alignés (ALIGN-14).  

**Comportement attendu :** toutes dates visibles = `JJ-MM-AAAA`.  
**Comportement constaté :** Finance (échéances, reçus) = `JJ/MM/AAAA`. Gate dates D1/D7 ne scanne pas ce helper comme violation slash métier.  
**Cause probable :** lot F7 finance antérieur au contrat dates CTO.  
**Fichiers concernés :** `web/src/lib/financeCurrency.ts`, `Mobile/src/lib/financeCurrency.ts`  
**Endpoints concernés :** N/A (présentation)  
**Risque :** cosmétique / confusion jour-mois.  
**Correction recommandée :** LOT 4/7 — déléguer à `formatDateForDisplay`.

Les autres fiches P1/P2/P3 de la matrice suivent le même schéma ; détail opérationnel dans les sections 6–13.

---

## 6. Authentification — synthèse

| Sujet | Web | Mobile | Aligné |
|---|---|---|---|
| Connexion | `/connexion` 3 profils | Welcome → RoleSelection → Login | Partiel |
| Endpoint | `/backoffice/login` | `/login` + `/identify` | Non |
| Déconnexion | `POST /auth/logout` | + revoke push + outbox | Partiel |
| Refresh | retry 401, session conservée si échec | clear SecureStore | Non (PARITY-030) |
| Mot de passe | modal min 6 | modal min 6, pas Annuler | Non vs backend |
| `must_change_password` | UI only | restricted session | Non |
| Établissement | code inline + `ActiveSchoolContext` | `GET /schools/:code` + selector | Partiel |
| Erreurs | message brut | `mapLoginApiError` | Partiel |
| Rôles | superset BO + demo | `managedMobileRoles` | Non |
| Redirect | `getDefaultAppPath` + wizard setup | toujours Home | Non |

Endpoints partagés alignés : `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/effective-permissions`.

---

## 7. Tableau de bord

| | Web | Mobile |
|---|---|---|
| Entrée | `/tableau-de-bord` charts + `/etablissement/vue-ensemble` hub | `HomeScreen` 4 KPI rôle + `SchoolingHubScreen` |
| Source effectifs | `GET /classes`, `/students` | idem |
| Présence admin | `getTodayEstablishmentPresenceKpi` | idem |
| Présence enseignant | fail-closed | **PARITY-022** |
| Taux paiement | `getPaymentRateKpi` / student-fees | **identique** (GREEN-FIN-01) |
| Charts configurables | `dashboardChartConfig` | absent |
| Navigation cartes | routes PermissionRoute | tabs + drawer |

**Verdict :** mêmes sources pour classes/élèves/finance admin. KPI enseignant et charts = écarts.

---

## 8. Établissement / configuration

Aligné : profil, setup wizard (`GET /v2/school-setup/status`), année (`/v2/academic-years`), structure pédagogique, rôles assignables (lecture).

Web-only : notifications établissement, sécurité, données/export, documents/bulletin design, graphiques, mon abonnement, intégrations/apparence, référentiels pays.

Mobile : `ConfigurationScreen` 6 cartes. Auto-open wizard après login = Web only (PARITY-029).

---

## 9. Scolarité

V2 respecté côté **API** : inscription `POST /classes/:code/students`. Pas de restauration AdminCrud. `createItem("classes")` no-op.

Écarts : fiche workspace (PARITY-013), parents (PARITY-014), CTA inscription (PARITY-031), C18 sans REST (PARITY-032).

Professeur principal : **ALIGN-04** — `classHeadTeacher.ts` partagé, mêmes endpoints.

---

## 10. Enseignants

Liste, fiche, affectations, matières, classes, professeur principal : **parité forte**.  
Création : Users canonique ; résidu `POST /teachers` Web (PARITY-028).  
RBAC matrice : footer Mobile « Web-only ».

---

## 11. Pédagogie

| Calcul | Autorité | Web staff | Mobile | Statut |
|---|---|---|---|---|
| Moyenne matière | `gradesCanonical.weightedAverage` | `gradeBook.ts` | `evaluationsV2.ts` | ALIGNÉ |
| Moyenne générale | Σ (moyenne_matière × coef_cours) | `getStudentAverageValue` | `pedagogyAverage.ts` | ALIGNÉ (GREEN-PED-01) |
| Parent filtre cours | — | `parentNotes.ts` plate | — | PARITY-033 |
| Bulletins | snapshot publication | workflow complet | lecture PDF | PARITY-023 |
| Examens | `/exams` | EntityPage | absent | PARITY-024 |

Les clients **ne doivent pas** recalculer hors DTO `/api/notes`. Dataset de caractérisation : `(17,5×2+12×1)/3` ; moyenne plate 16,4 interdite (`backend/lib/canonicalAverageParity.test.js`).

---

## 12. Présences

| | Web | Mobile | Cible |
|---|---|---|---|
| Défaut | Présent | null | Présent + changement simple |
| Statuts | P/A/R/J | P/A/R/J | identiques persistés |
| % jour admin | fail-closed `recorded===expected` | idem | ALIGNÉ |
| % brouillon | 100 % si défaut Présent | attended/roster | P0 |
| Offline | non | outbox | Mobile-only légitime |

Justifié = absence justifiée (`present=false`) — contrat backend D3.5, clients alignés post-save.

---

## 13. Finance

**Même élève, mêmes endpoints → mêmes soldes** (caractérisé GREEN-FIN-01/02).

| Calcul | Source |
|---|---|
| `balance` | Backend `amountDue − exemption − amountPaid` |
| Ledger | `unpaidService.js` |
| Taux | Client identique Web/Mobile sur DTO student-fees |
| Caisse | DTO payments `allocatedAmount` / `unallocatedAmount` |

Écarts = **actions** (grilles, relances, filtres) et **format de date** (PARITY-080), pas la formule d’obligation.

Duplication à surveiller : `web/src/lib/fees.ts` / `unpaidModule.ts` (demo / tests) vs pages prod branchées API.

---

## 14. Communication

Post-lots C2/C3/C4 : messages, annonces, notifications internes, unread-count, chrome cartes repliées = **ALIGN-12**.

Écarts : Web Push absent (PARITY-034) ; notifs plateforme Web-only (PARITY-068) ; préférences canaux (PARITY-055) ; visibilité Notifications (PARITY-026).

Pattern UX cartes synthétiques : conforme PD Mobile (Teachers, Classes, Students, Users, Notifications). Appel : 4 statuts toujours visibles (PD-03) — justifié.

---

## 15. Matrice RBAC (extrait)

| Action | Web | Mobile | Backend | Conforme |
|---|---|---|---|---|
| Lire classes/élèves/enseignants | PermissionRoute | `canReadRoute` | PG live | Oui |
| Appel présences | `Présences:CREATE/UPDATE` | idem | live | Oui |
| Notes POST | live | live | live | Oui |
| Paiements | tabs finance | Payments/Unpaid | live + dual-gate fee-grids | Partiel |
| PATCH rbac | Superadmin | Non monté | Superadmin | Non UI |
| Pays CREATE Admin Pays | stripped client | non stripped | API | Partiel PARITY-062 |
| Notifications icône | implicite comms établissement | token READ | token | Non PARITY-026 |
| UI masquée / API ouverte | notifs Web | — | 403 si pas le token | **anomalie** : UI plus large que API (pas l’inverse) |
| AdminCrud live | — | hors graphe | — | OK L0 |
| GET `/backoffice/role-permissions` | encore hydraté | reject local | lecture compat | PARITY-035 |

Rôles V2 constatés : `SUPER_ADMIN`, `COUNTRY_ADMIN`, `SCHOOL_ADMIN`, `PROVISEUR`, `PREFET_ETUDES`, `PRINCIPAL`, `SECRETARY`, `TEACHER`, `PARENT`, `STUDENT`, `ACCOUNTANT`, `SUPERVISOR` + rôles custom `establishment_roles`.

**Anomalie de sécurité retenue :** pas de P0 « UI cachée mais API ouverte pour un rôle établissement » sur les routes live auditées (`requirePermission` recalcule PG). Points d’attention P1/P2 : aliases legacy OR dans `routePermissions`, finance dual JWT, GET countries token legacy, GET assignments OR `Enseignants:READ`.

---

## 16. Audit API (écarts de chemin)

| Fonction | Web | Mobile |
|---|---|---|
| Login | `POST /backoffice/login` | `POST /login` |
| Teacher create | `POST /teachers` (403, non UI) | `POST /backoffice/users/create-teacher` |
| Education catalog école | `/backoffice/establishments/:code/education-reference/catalog` | `/education-reference/catalog` |
| Evaluation types superadmin | path backoffice scopé | `/evaluation-types` |
| Offline schooling | live GET | + `/mobile-sync/l1/*` |
| Report cards write | LOT `/report-card/*` | publications read |
| Unpaid reminders | POST reminders | — |
| Role permissions | GET legacy | reject |
| Academic config write | scoped backoffice PUT | `saveAcademicConfig` exporté, UI gardée |

Logique métier canonique : **backend** pour soldes, notes, présences persistées, RBAC. Duplication client : `paymentRateKpi` (aligné), `normalizeUnpaidLedger` (aligné), `gradesToLegacyNotes` Web vs `stripEvaluationClientScope` Mobile.

---

## 17. Modèles / contrats

| Objet | Écart |
|---|---|
| User.role | Web labels FR (`Admin School`) vs Mobile snake (`school_admin`) |
| Presence.status | FR `Présent`… vs PG `present/late/absent/excused` — normalizers alignés |
| Payment amounts | number \| string — `parseMoney` identique KPI |
| StudentFeeObligation | `archivedAt` / `archived_at` gérés des deux côtés |
| Grade.coefficient vs evaluationCoefficient | contrat L3 ; respecté staff |
| School.dateFormat | Mobile lookup ; pas d’auth |
| Dates civiles | ISO API / JJ-MM display — sauf finance slash |

---

## 18. Dates

Cible : **JJ-MM-AAAA**. Gate `.github/workflows/date-ui-contract.yml` : 0 violation D1/D7 sur helpers centraux.

Divergences restantes :

| ID | Surface | Format vu |
|---|---|---|
| PARITY-080 | Finance Web+Mobile | `JJ/MM/AAAA` |
| PARITY-081 | Hint `ClassStudentsPage` | `AAAA-MM-JJ` (l’input affiche JJ-MM-AAAA) |
| PARITY-082 | `unpaidModule` (peu live) | `17 sept. 2026` |
| TZ | KPI jour | `civilDateKeyInTimeZone` école — sauf Accueil enseignant |

Pas d’ISO brut exposé dans les parcours dates.ts. `toLocaleDateString` résiduel : unpaidModule, AdminCrud mort, backend messages système.

---

## 19. Parité UX

La parité n’exige pas la même UI. Cartes Mobile vs tables Web = **volontaire** (PARITY-086).

Violations métier/UX :

- P0 workflow appel (PARITY-001)
- P1 fiche élève, parents, finance actions, planning write, plateforme
- P2 CTA inscription, badges classe, stats notes classe
- Progressive disclosure Mobile : conforme PD-01…07 sur écrans live

---

## 20. Legacy

| Item | Statut | Client |
|---|---|---|
| `GET/PUT /backoffice/state` | 410 | aucun appel live ; Mobile stub reject |
| `PUT /backoffice/role-permissions` | 403 | aucun ; Mobile reject |
| `GET /backoffice/role-permissions` | live lecture | **Web domainLoaders** |
| `POST /teachers` | 403 | export Web |
| `GET /students/:id/report(.pdf)` | legacy | non consommé |
| `EntityPage` | exams, bulletins, documents, relations, **payments** | Web |
| `MenuScreen`, `AdminCrudScreen`, `SafeAdminCrudScreen` | hors graphe | Mobile |
| `PermissionsScreen`, `PlatformNotificationsScreen` | orphelins | Mobile |
| `gradesToLegacyNotes` | transform POST `/notes` | Web |
| `fees.ts` / `unpaidModule.ts` | miroir client | Web tests/demo |
| `Mobile/domain/academics/GradeBookService.ts` | non branché | Mobile |

**Ne pas restaurer** AdminCrud / PUT state / ajout élève global pour « faire la parité ».

---

## 21. Routes Web sans équivalent Mobile live (34)

`/marketplace`, `/etablissement/relations-parent-enfant`, `/planning/salles`, `/planning/remplacements`, `/planning/conflits`, `/planning/emploi-du-temps/par-salle`, `/finances/frais`, `/examens`, `/bulletins/historique`, `/bulletins/modele`, `/pays`, `/referentiels-pedagogiques`, `/etablissements`, `/abonnements/*` (8), `/notifications-plateforme`, `/administration/permissions`, `/administration/documents`, `/administration/conformite`, `/administration/relations`, `/parametres/documents`, `/parametres/bulletins-configuration`, `/parametres/graphiques`, `/parametres/securite`, `/parametres/donnees`, `/parametres/notifications`, `/parametres/apparence`, `/parametres/integrations`, `/parametres/mon-abonnement/*`, `/parametres/abonnements`, `/demande-essai` (public Web).

Écrans Mobile live sans équivalent Web : `Welcome`, `RoleSelection`, `MobilePayment`, `OfflineMode`, `Synchronization`, `Support`.

---

## 22. Lots de correction proposés (GO CTO requis)

Aucun lot n’est commencé.

| Lot | Titre | IDs | Intention |
|---|---|---|---|
| **LOT 0** | Sécurité / intégrité | PARITY-001, 001b, 011, 012, 022 | Défaut appel, session mdp, KPI présence enseignant |
| **LOT 1** | Référentiels / établissement | 018, 019, 029, 037 | Décider ce qui reste Web-only vs port Mobile |
| **LOT 2** | Scolarité | 013, 014, 031, 032 | Fiche, parents, classe-first, C18 (API d’abord) |
| **LOT 3** | Enseignants | 028 | Un seul chemin Users |
| **LOT 4** | Finance | 015, 016, 080 | Actions impayés + dates |
| **LOT 5** | Pédagogie | 023, 024, 033, 060 | Calcul parent + surface bulletins/examens |
| **LOT 6** | Communication | 034, 026, 055, 068 | Push Web / préférences / notifs |
| **LOT 7** | UX Mobile | 021, 052, 057, 081, 083 | Orphelins, hints, badges |
| **LOT 8** | Nettoyage legacy | 035, 056, 061, 027, 071 | GET role-permissions, EntityPage, catalogues, morts |

Recommandation : **lots RED/GREEN séparés**, pas une PR « parité globale ». LOT 0 en premier.

---

## 23. Tests de caractérisation

```bash
node scripts/web-mobile-parity-audit.inventory.js
npm run test:web-mobile-parity-green   # doit passer
npm run test:web-mobile-parity-red     # doit échouer (écarts ouverts)
npm run verify:web-mobile-parity-audit
```

GREEN couvre : taux de paiement, fail-closed multidevise, montants, dates `JJ-MM-AAAA`, statuts assistés, hydratation présence persistée, moyenne 15,67, intersection RBAC.

RED fige : défaut appel, KPI brouillon, dates finance, min mot de passe, catalogues CRUD, ProtectedRoute, hint AAAA-MM-JJ, Permissions orphelin, KPI enseignant.

Les tests existants `canonicalAverageParity`, finance L2, présence D3.5, dates UI restent la référence métier — **non dupliqués**.

---

## 24. Gouvernance Git (à compléter au freeze PR)

| Champ | Valeur |
|---|---|
| Branche | `cursor/audit-web-mobile-parity-global-ae6a` |
| Base | `develop` |
| Base SHA | *(commit de freeze)* |
| HEAD SHA | *(commit de freeze)* |
| Merge-base | identique à Base si branche fraîche |
| Ahead / behind | *(git rev-list)* |
| Diffstat | documentation + scripts + tests uniquement |
| Ready | **interdit** |
| Merge | **interdit** |

---

## 25. STOP

Audit clos.  
**Pas de Ready. Pas de merge. Pas de lots sans GO CTO.**
