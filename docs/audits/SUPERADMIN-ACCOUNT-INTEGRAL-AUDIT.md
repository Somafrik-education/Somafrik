# AUDIT — Compte Superadmin (première passe lecture seule)

**Gouvernance :** AUDIT ONLY / HOLD. Aucun correctif produit, aucun merge, aucun déploiement dans cette révision.  
**SHA audité :** `7e21d376` (`develop`)  
**Date :** 2026-09-30

Si un correctif est décidé : **une PR Draft isolée par correction importante** vers `develop`, puis **diff GitHub indépendant CTO** avant Ready/Merge.

Le libellé GitHub `superadmin` **n’est pas** le nom du rôle. La recherche simple rate le contrat réel.

---

## 0. Identité réelle (ne pas chercher `superadmin` comme rôle)

| Surface | Valeur canonique |
|---|---|
| Libellé métier / JWT `role` | `Super Administrateur Somafrik` |
| Alias legacy (sessions / SQL / JWT) | `Super Administrateur OKAFRIK` → remappé Somafrik au login |
| Clé RBAC PostgreSQL | `SUPER_ADMIN` (`roleKeys`) |
| Identifiant de connexion seed | `superadmin` |
| E-mail seed | `superadmin@somafrik.app` |
| Id seed | `USER-SUPERADMIN` |
| `schoolCode` JWT | `*` (global, `schoolId` vide) |
| Rôle Mobile API | `super_admin` |
| Profil Web login | `profile: "superadmin"` (sans `schoolCode`) |

Preuves : `backend/data.js` L843–867, `web/src/lib/orgHierarchy.ts` L4–6, `backend/db/userRolesSchema.js`, `backend/lib/superadminBootstrap.js` L3.

---

## 1. Cause racine du « GitHub ne trouve pas Superadmin »

Le produit n’utilise **presque jamais** le token `superadmin` comme rôle. Il apparaît comme :

- **identifiant** de compte (`identifier: "superadmin"`) ;
- **profil UI** Web (`LoginPage` / `demoAccounts.ts`) ;
- **rôle mobile** `super_admin`.

L’autorisation réelle se juge sur **trois couches** :

1. `requireAuth` + `isPlatformPersonalDataForbiddenHttp` (`backend/server.js` L6813–6826)  
2. `requirePermission` → `RbacService.canAccess` (`backend/services/rbacService.js` L582–604)  
3. UI `isSuperAdminAllowedView` / `SUPER_ADMIN_ALLOWED_FEATURES` (`web/src/lib/superAdminAccess.ts`)

`ALL_PRIVILEGES` **n’est pas** un passe-partout sur les données personnelles établissement : le deny P0-2 s’exécute **avant** `requiredPermissions.some(...)`.

---

## 2. Contrat produit observé (ce qui est voulu)

Le Superadmin est un **administrateur plateforme**, pas un Admin School global.

| Domaine | Superadmin |
|---|---|
| Pays / établissements / abonnements / offres | **Allow** CRUD |
| Utilisateurs catalogue | **Allow** créer/gérer **Admin Pays** et **Admin School** |
| Grant `SUPER_ADMIN` | **Deny** (`userRoleLifecycleService.js` L272–277) |
| Auto-grant / auto-révocation | **Deny** (`assertNotSelfTarget`) |
| Fiche élève, notes, présences, paiements scolarité, messages établissement, exports, effacement | **Deny HTTP 403** `PLATFORM_PERSONAL_DATA_DENIED` même avec `ALL_PRIVILEGES` et `X-Somafrik-School-Code` |
| UI `/etablissement/*` | **Refus** (redirection `/tableau-de-bord`) |
| Mobile | Rôle **valide** ; navigation **réduite** (Utilisateurs, Paramètres) |

Ce deny n’est pas un bug : c’est le contrat P0-2 déjà testé par `verify-platform-personal-data-deny`.

---

## 3. Authentification / sécurité

### 3.1 Login

| Canal | Route | School | `assertSchoolCanConnect` |
|---|---|---|---|
| Web | `POST /api/backoffice/login` | **absent** pour profil Superadmin | Non (plateforme) |
| Web + école optionnelle | même route | `forPlatformAdmin: true` | **Bypass** suspension/validation école (`backOfficeAccessService.js` L235–237) |
| Mobile | `POST /api/login` sans `schoolCode` | `loginPlatformAccount` | Non |
| Mobile + `schoolCode` | flux établissement | Oui — **échoue** pour Superadmin plateforme |

JWT : `role` Somafrik, `schoolCode: "*"`, `permissions` overlay PG `resolveEffectivePermissions`, access ~900 s, refresh rotatif + session PG.

Bootstrap **préprod/prod** : `backend/lib/superadminBootstrap.js` — hash uniquement, mot de passe ≥ 12, `must_change_password`. Distinct du seed démo.

### 3.2 Secrets seed (surface réelle)

```843:858:backend/data.js
    id: "USER-SUPERADMIN",
    identifier: "superadmin",
    password: "1234",
    schoolCode: "*",
```

Même secret dans `web/src/lib/demoAccounts.ts` (`DEMO_PASSWORD = "1234"`) et `backend/lib/bulkPlatformSeed.js` (plusieurs `superadmin` / `superadmin-02`… en clair).

`verifyUserSecret` / `verifyPassword` acceptent **hash OU clair** (`authService.js` ~L808–835). Un compte seed reste exploitable sans `passwordHash`.

**Mitigation prod déjà en place :** `SOMAFRIK_SKIP_DEMO_SEED=true` obligatoire (`productionSecrets.js` L70–71) ; `NODE_ENV=production` coupe le seed (`demoSeedPolicy.js`). Docker **dev** laisse le seed actif par défaut.

Pas de MFA. Lockout 5/15 min, clé plateforme `*:identifier`. Rate limit login. `SOMAFRIK_AUTH_OPTIONAL=true` → `canAccess` **true** (`rbacService.js` L583–585) — **interdit en production**.

---

## 4. RBAC et accès cross-tenant

### 4.1 Pipeline HTTP

```
Bearer
  → requireAuth
  → deny P0-2 si route ∈ SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM
  → applyEffectiveSchoolScope (header X-Somafrik-School-Code)
  → requirePermission / RbacService.canAccess
       → deny P0-2 à nouveau
       → requiredPermissions.some (ALL_PRIVILEGES ouvre les routes NON interdites)
  → handler (tenantScope / financeScope / usersScope)
```

Header canonique : **`X-Somafrik-School-Code`** (pas `X-School-Code`). Query `?schoolCode=` **ne contourne pas** le deny élèves.

### 4.2 Divergence dangereuse (défense en profondeur)

`platformPersonalDataGuard.isSuperAdminPrincipal` accepte **libellé OU `roleKeys.SUPER_ADMIN`** (L315–319).

`server.js` `isSuperAdminPrincipal` (L5214–5216) ne teste que le **libellé**. Un JWT avec `roleKeys: ["SUPER_ADMIN"]` et un libellé atypique peut diverger (bulletin-design vs deny HTTP).

`classStudentsAuthz.js` L171–196 : **si le middleware est sauté**, Superadmin (et même `principal` absent) **voit toute la liste élèves**. L’autorité actuelle est le middleware ; ce helper est **fail-open** et contredit le contrat P0-2.

`TenantScopeService.filterRows` : Superadmin **sans** scope request → **toutes les lignes** des handlers qui l’utilisent (L26–28) — voulu pour routes plateforme, dangereux si un handler métier l’appelle sans deny amont.

`resolveFinanceSchoolScope` : Superadmin sans scope → `mode: "all"` (`financeSchoolScope.js` L164–167) — **lecture cross-tenant des grilles / catalogue finance**, hors liste P0-2.

---

## 5. Matrice périmètre demandé

Légende : **Allow** / **Deny** / **UI-only** / **config**.

### 5.1 Établissements

| Action | UI | API | Résultat |
|---|---|---|---|
| Lister / créer / modifier | `/etablissements` | `/api/backoffice/establishments*` | Allow |
| Suspendre / activer | `SchoolsPage` `canSuspend` | `PATCH .../suspend` `.../activate` | Allow |
| Valider une création Admin Pays | Bouton Superadmin | métier établissements | Allow (contrat) |
| Entrer `/etablissement/:school` | PermissionRoute refuse | — | UI deny |

### 5.2 Utilisateurs / rôles

| Action | API | Superadmin |
|---|---|---|
| `GET /api/backoffice/users` | Allow plateforme | Allow (admins catalogue) |
| Grant `SUPER_ADMIN` | `userRoleLifecycleService` L272 | **Deny** |
| Grant `COUNTRY_ADMIN` / `SCHOOL_ADMIN` | L280–287 | **Allow** |
| Grant Enseignant / Secrétaire | hors catalogue plateforme | **Deny** |
| `PUT /api/backoffice/role-permissions` | legacy | **403** |
| `PATCH /api/backoffice/rbac/permissions` | `assertSuperAdmin` | Allow **autres** rôles ; 409 si retrait mandatory `SUPER_ADMIN` |
| Reset password `POST /api/users/:id/reset-password` | `canResetUserPassword` + `ALL_PRIVILEGES` | Allow **admins catalogue** ; deny staff métier |

### 5.3 Abonnements

| Action | Résultat |
|---|---|
| `GET/PATCH /api/backoffice/subscriptions*` | Allow |
| Offres / paiements plateforme | Allow (`assertSuperAdmin` sur offres) |
| Paiements **scolarité** `/api/payments*` | **Deny** P0-2 |
| `/parametres/mon-abonnement` | UI deny Superadmin |

### 5.4 Actions administratives sensibles

| Route | Authz | Superadmin / prod |
|---|---|---|
| `POST /api/backoffice/e2e/clear-login-lockout` | **aucun JWT** ; `SOMAFRIK_E2E=true` + non-prod | **404** prod |
| `GET /api/privacy/erasure-requests` (+ execute) | P0-2 | Deny |
| `GET /api/data-export` | P0-2 | Deny |
| `GET /api/audit` | P0-2 (handler commenté « Superadmin autorisé » **jamais atteint**) | Deny |
| `POST /api/backoffice/bulletin-design/preview` | `requireAuth` + `isSuperAdminPrincipal` **libellé seul** | Allow |
| `GET /api/debug/notes-authz-trace` | `SOMAFRIK_AUTHZ_TRACE=1` + rôle | Superadmin dans la liste |

### 5.5 Dashboard / navigation

**Web menu** (`useVisibleNavItems` + `canAccessSchoolBackOffice` = false) : Tableau de bord, Pays, Référentiels pédagogiques, Établissements, Abonnements, Administration (utilisateurs + permissions), Paramètres (cartes plateforme). **Pas** de « Mon établissement », planning, notes, finances, présences.

Dashboard = vue **plateforme** (`OverviewPage` `internalSchool` false).

**Pas de switcher d’établissement global** dans le chrome. `ActiveSchoolContext` peut quand même poser un `activeSchoolCode` (1er établissement / sessionStorage) sans UI. Messages : icône visible, `scopeReady` faux si `*` → liste vide. Annonces plateforme : OK sans école.

**Mobile** : login `SUPERADMIN` → `super_admin`. Tiroir : Utilisateurs, Paramètres, Support. **Pas** d’écrans Pays / Abonnements malgré CRUD catalogue. `canReadRoute("Students"|"Classes")` = false. Vue `Permissions` allow-list **sans écran**.

---

## 6. Couverture de tests

| Preuve | Couverture Superadmin |
|---|---|
| `verify-platform-personal-data-deny` | Login `superadmin`/`1234` ; **403** GET perso ± header ; **200** pays/établissements |
| `platformPersonalDataGuard.test.js` | Principal synthétique ; **toute** liste FORBIDDEN |
| `usersTenant.http.pg.test.js` | Grant Superadmin deny ; users cross-pays |
| `verify-user-role-lifecycle` / establishment-roles | Grant Superadmin deny |
| `verify-functional-rbac` | Invariants SUPER_ADMIN ; **pas** GET `/students` Superadmin |
| `authPlatformLogin.test.js` | Mobile sans école |
| `scripts/verify-suspension.js` | Superadmin **connecte** pendant suspension |
| `verify-preprod-superadmin-login.js` | Bootstrap préprod |
| Web `UsersPage.superadminCreateCountry` / `PermissionsPage` / `permissions.planningUi` | UI partielle |
| Mobile `mobileRbacLive` / `roleNavigationPreferences` | Nav réduite |

**Lacunes :** pas de HTTP verify **PATCH** `/students` / **POST** `/payments` Superadmin (unitaire `canAccess` seulement) ; pas de test menu complet `useVisibleNavItems` Superadmin ; pas de test redirection `/etablissement` ; pas de test Messages + `activeSchoolCode: *` ; `GET /api/finance/fee-grids` cross-tenant **non** asserté 403 (volontairement hors deny).

---

## 7. Findings P0 → P1 → P2

Les P0 ci-dessous sont des **risques de configuration / défense en profondeur**, pas la preuve qu’un Superadmin authentique contourne aujourd’hui `GET /api/students` (ce chemin est deny + testé).

### P0 — à corriger en PR isolées

1. **Secret Superadmin démo versionné (`superadmin` / `1234`)**  
   `backend/data.js` L857–858, `demoAccounts.ts` L18–28, `bulkPlatformSeed.js` (plusieurs identifiants).  
   Prod : seed coupé. Tout environnement où `shouldSeedDemoData()` est vrai (Docker dev défaut) expose un compte **plateforme**.  
   Correctif proposé : jamais de clair dans le seed runtime ; bootstrap hash-only partout ; UI démo hors bundles prod.

2. **Vérification mot de passe en clair** (`password` / `pin` / `temporaryPassword`)  
   `authService.js` ~L824–834, `backOfficeAccessService.js` L186–202.  
   Correctif proposé : chemin clair **uniquement** si `NODE_ENV !== production` **et** seed demo ; sinon hash only.

3. **`classStudentsAuthz` fail-open Superadmin / `!principal`**  
   L171–196, L239, L276. Contredit le deny HTTP. Si une route élèves esquive `requireAuth` ou la garde P0-2, leak.  
   Correctif proposé : Superadmin → **deny** (aligné middleware) ; `!principal` → deny.

4. **`SOMAFRIK_AUTH_OPTIONAL=true`**  
   `canAccess` → true. Interdit prod, risque staging.  
   Correctif proposé : fail-closed même hors prod, ou fail au boot si combiné à un bind public.

### P1 — gouvernance / surface / UX

5. **Finance configuration cross-tenant** (`mode: "all"`) — grilles / catalogue hors deny P0-2. Décider : scope obligatoire ou deny plateforme.

6. **`isSuperAdminPrincipal` divergent** (`server.js` L5214 vs `platformPersonalDataGuard.js` L315) — unifier sur libellé **+** `roleKeys`.

7. **Login Web Superadmin pendant suspension pays/école** (`forPlatformAdmin: true`) — voulu pour réactivation, à borner aux routes `.../activate` plutôt qu’au login global.

8. **Messages Web** : icône sans switcher d’établissement → état vide. Soit retirer Messages de `SUPER_ADMIN_ALLOWED_VIEWS`, soit exiger un sélecteur.

9. **Contexte école Web opaque** (`ActiveSchoolContext` sans switcher chrome vs `configTarget` local).

10. **Parité Mobile** : catalogue CRUD Pays/Établissements/Abonnements vs UI Users-only — documenter comme dette ou ouvrir les écrans.

11. **Reset password** Superadmin via `ALL_PRIVILEGES` sur admins catalogue — à limiter à un jeton dédié.

### P2 — dette

12. Alias **OKAFRIK** (backend / SQL / JWT hérités) ; UI déjà Somafrik.  
13. Double sémantique `ALL_PRIVILEGES` (legacy HTTP vs `@somafrik/auth` où ce n’est **pas** un wildcard).  
14. Commentaire `GET /api/audit` « Superadmin autorisé » vs 403 réel.  
15. Vue Mobile `Permissions` allow-list sans écran.  
16. Pas de MFA.  
17. Tests navigation Superadmin Web / PATCH HTTP P0-2 Superadmin.  
18. `bulkPlatformSeed` peut créer **plusieurs** Superadmin (`superadmin-02`…).

---

## 8. Plan de correctifs (PR isolées, plus tard)

| Ordre | PR Draft | Périmètre |
|---|---|---|
| A | Défense élèves Superadmin | `classStudentsAuthz` deny + tests HTTP PATCH/POST Superadmin |
| B | Secrets seed | plus de `1234` runtime ; verify hash-only hors demo |
| C | Unifier `isSuperAdminPrincipal` | `server.js` = guard (`role` + `SUPER_ADMIN`) |
| D | Finance Superadmin | `mode: "all"` → scope obligatoire ou deny |
| E | UI Messages / school switcher | retirer ou sélecteur unique |
| F | Mobile parité plateforme | écrans ou restriction catalogue |

**Aucun merge sans diff GitHub CTO.** Cette PR d’audit ne corrige rien.

---

## 9. Limites de preuve

- Aucun replay live Network/SQL/login préprod dans cet environnement agent.  
- Preuve d’absence d’accès élèves : graphe middleware + `verify-platform-personal-data-deny` (login seed).  
- Non inspecté : instance PG déjà bootstrappée (compte `1234` résiduel vs bootstrap ≥ 12).  
- Non inspecté : RLS Data API `anon`/`authenticated` (déjà noté hors bande dans l’audit RBAC #490).

Preuves machine : `docs/audits/evidence/superadmin-account-audit.json`.
