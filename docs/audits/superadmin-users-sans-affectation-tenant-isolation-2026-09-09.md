# Audit P0/P1 — Visibilité Superadmin des utilisateurs établissement / « Sans affectation »

**Mandat :** CTO — audit fonctionnel + sécurité tenant  
**Date :** 9 septembre 2026  
**Baseline :** `develop@7bcca23a3e594985c4a5d2ff6ef4e516a073f808`  
**Périmètre :** lecture Git, lecture code Web/backend, tests unitaires non destructifs, reconstruction SQL.  
**Hors périmètre (interdit par le mandat) :** UPDATE/INSERT/DELETE, migration, Render, redeploy, merge, PR corrective, changement RBAC.

**Environnement d’audit :** Cloud Agent sans `DATABASE_URL` préprod/prod. Aucune requête live n’a été exécutée. Les inventaires PROD/PREPROD sont donc **reconstruits depuis le contrat d’identifiants + le SQL d’application + les tests qui figent le comportement HTTP**. Les `SELECT` ops à jouer en lecture seule sont fournis tels quels.

---

## 1. Verdict CTO : **P0**

| Question | Réponse |
| --- | --- |
| Un Superadmin voit-il des **Admin School** d’établissements dans Administration → Utilisateurs ? | **Oui, et c’est le périmètre plateforme documenté** (copy UI, allowlist P0-2, tests). |
| Un Superadmin voit-il des comptes **« Sans affectation »** avec identifiants `CD-ITS-…` ? | **Oui.** Ces identifiants **prouvent** `users.school_id IS NOT NULL` (contrat V2). Ce ne sont pas des comptes plateforme. |
| Isolation SCHOOL_ADMIN A vs SCHOOL_ADMIN B ? | **Tenue** (membership UUID, `u.school_id = $1`, tests GP-003). Pas une fuite école A → école B. |
| Isolation plateforme vs données personnelles établissement ? | **Non tenue sur GET `/api/backoffice/users`.** Superadmin et Admin Pays reçoivent le catalogue `users` **sans filtre de rôle**, avec e-mail, téléphone, nom, `identity_code`. Cela contredit P0-2 (« comptes admin établissement »), tout en étant **explicitement allowlisté** et **testé comme requis** (P0-9). |
| « Sans affectation » contourne-t-il l’isolation tenant ? | **Oui, au catalogue UI et en écriture.** `#207` traite **toute** identité sans rôle comme gérable par le Superadmin. Un SCHOOL_ADMIN peut créer une identité (`role = NULL`), qui remonte alors dans l’écran global, modifiable / attribuable / reset-password par le Superadmin (`scope.mode = "all"`). |

**P0** = exposition HTTP de PII établissement à des rôles plateforme + capacité d’écriture cross-directory via le libellé « Sans affectation ».  
**P1 associé** = surcharge sémantique du libellé (aucun rôle d’accès ≠ absence d’établissement) et divergence Web / BackOffice.

Ce n’est **pas** GO. Ce n’est **pas** seulement un fallback UI.

---

## 2. Comportement observé

Sur `/administration/utilisateurs`, un Super Administrateur Somafrik voit notamment :

- des comptes **Admin School** (rôle d’accès réel `SCHOOL_ADMIN`) ;
- plusieurs comptes **Actif** affichés **Sans affectation** / **Aucun rôle d’accès** ;
- au moins un compte **Suspendu** (le filtre UI n’exclut que `Supprimé`) ;
- des identifiants permanents du type `{PAYS}-{ETAB}-{INITIALES}-{YY}-{SEQ}` ex. `CD-ITS-…`.

Côté réseau, le Web appelle **une seule liste** : `GET /api/backoffice/users` **sans query de pagination**. Le backend répond **le tableau complet** du scope. Pour un Superadmin non request-scoped, le SQL est :

```sql
SELECT u.*, s.school_code, s.login_code AS school_login_code, s.name AS school_name,
       c.iso_code AS country_code, c.name AS country_name
FROM users u
LEFT JOIN schools s ON s.id = u.school_id
LEFT JOIN countries c ON c.id = s.country_id
WHERE TRUE
ORDER BY u.created_at
```

puis hydratation `user_roles` actifs + profils métier. **Aucun filtre `SCHOOL_ADMIN` / `COUNTRY_ADMIN`.** Enseignants, secrétaires, élèves liés, parents, identités orphelines : tout part dans le JSON (e-mail / téléphone inclus ; seuls hash / PIN / mots de passe sont sanitizés).

Le Web **refiltre ensuite** pour l’affichage :

```text
isSuperadminManagedUser =
  (compte « Sans affectation »)  OR  rôle Admin Pays  OR  rôle Admin School
```

Conséquence visuelle : les enseignants **avec** rôle disparaissent de l’écran ; les identités établissement **sans** rôle restent. D’où la capture « CD-ITS + Sans affectation + Admin School + Suspendu ».

Le copy de la page dit pourtant :

> « N compte(s) **plateforme**. Le Super administrateur valide et gère les Administrateurs établissement créés par les Administrateurs pays. »

L’écran se présente comme un catalogue plateforme. L’API et le filtre « Sans affectation » le transforment en **vue partielle du tenant**.

---

## 3. Comportement attendu (reconstruit depuis le code + la politique)

Sources : `docs/project/SECURITY.md` §2.4 P0-2, `docs/project/DATABASE.md` §4.1bis, copy `UsersPage`, `SUPERADMIN_DIRECT_USER_ROLES`, `platformPersonalDataGuard.js`.

**Superadmin**

- administre la plateforme (pays, établissements, abonnements, RBAC, **comptes Admin Pays / Admin School**) ;
- ne lit **pas** les données personnelles métier d’un établissement (`students`, `teachers`, contacts, notes, paiements, messages, audit, export) — deny P0-2 ;
- **peut** utiliser `GET /api/backoffice/users` comme fonction plateforme — l’intention documentée est **« comptes admin établissement »**, pas le dump `users`.

**Pour chaque utilisateur, le modèle canonique est :**

| # | Concept | SoT PostgreSQL | N’est pas |
| --- | --- | --- | --- |
| 1 | Compte / identité | `users` (`id`, `user_code`, `identity_code` si `school_id` non null) | un rôle |
| 2 | Appartenance établissement | `users.school_id` (FK unique — **pas de table `memberships`**) | le libellé UI |
| 3 | Rôle global | `user_roles` actif avec `school_id IS NULL` (`SUPER_ADMIN`, `COUNTRY_ADMIN`) | `users.role` seul |
| 4 | Rôle établissement | `user_roles` actif avec `school_id` (`SCHOOL_ADMIN`, `TEACHER`, …) | « Sans affectation » |
| 5 | Statut | `users.status` (`active` / `suspended` / …) | l’affectation |
| 6 | Permissions | union RBAC des `role_key` actifs | le classement UI |
| 7 | Absence d’affectation | **zéro** `user_roles` actif → `assignmentStatus = "Sans affectation"` | une échappatoire tenant |

**« Sans affectation » ne doit jamais servir de critère d’appartenance au catalogue Superadmin.** C’est un état d’accès vide, pas un type d’annuaire.

Attendu pour l’écran Administration → Utilisateurs :

- Superadmin : Admin Pays, Admin School (y compris suspendus / en attente de validation), et **uniquement** les identités **plateforme** encore sans rôle (création identité-d’abord par Superadmin / Admin Pays) ;
- Admin Pays : Admin School de **son** pays + identités plateforme/pays sans rôle de ce pays — **pas** le staff métier ;
- Admin School : utilisateurs de **son** `school_id` uniquement.

---

## 4. Route API réelle

| | |
| --- | --- |
| Page | `/administration/utilisateurs` |
| Client | `clientsApi.listUsers()` → `GET /backoffice/users` (`web/src/lib/clientsApi.ts`) |
| HTTP | **`GET /api/backoffice/users`** |
| Handler | `backend/server.js` ~L2834 |
| Auth | `requireAuth` (Bearer JWT uniquement ; refuse `?token=`) |
| Deny P0-2 | **non appliqué** à cette route (`PLATFORM_ADMIN_ALLOWED`) |
| RBAC | `requirePermission("GET /api/backoffice/users")` → jetons `Utilisateurs:READ` \| `Gérer utilisateurs` \| `COUNTRY_PRIVILEGES` \| `ALL_PRIVILEGES` |
| Principal Users | `usersHttpPrincipal` → `attachUsersMembershipScope` |
| Scope | `assertUsersReadable` → `resolveUsersSchoolScope` |
| Repository | `repository.listClientsUsers(scope)` → `clientsPgStore.listUsers` |
| Post-filtre | `filterUsersRows` (redondant si SQL déjà scopé) |
| Réponse | `usersApiUsers` = `projectUsersApiUser` + `sanitizeUsersForResponse` (hash/PIN seulement) |
| Pagination | **absente par défaut** (`sendList` renvoie le tableau brut si pas de `page`/`limit`) |

Aliases legacy `GET /api/users` : retirés (gate `verify-api-legacy-aliases.js`).

Mutations liées (même scope `mode: "all"` pour Superadmin) :

- `POST /api/backoffice/users`
- `POST /api/backoffice/users/provision`
- `PATCH /api/backoffice/users/:userId`
- `POST /api/backoffice/users/:userId/roles/grant|revoke`
- `POST /api/backoffice/users/:userId/reassign-school`
- `POST /api/users/:id/reset-password` (liste d’abord `listClientsUsers(scope)` puis cible)

---

## 5. Chaîne Web → API → SQL

```text
AdministrationLayout  /administration/utilisateurs
        ↓
UsersPage
        ↓ ensureDomains(["users"])  (routeDomainMap : users, schools, teachers)
        ↓
domainLoaders.users  →  clientsApi.listUsers()
        ↓
GET /api/backoffice/users
        ↓ requireAuth + requirePermission + usersHttpPrincipal
        ↓ resolveUsersSchoolScope
              SUPER_ADMIN (pas de schoolCode effectif) → { mode: "all" }
              COUNTRY_ADMIN                            → { mode: "country", countryCode }
              SCHOOL_ADMIN                             → { mode: "school", schoolId }
        ↓ sqlUsersScope
              all     → TRUE
              country → school_id IS NULL ? profile_payload.countryCode : countries.iso_code
              school  → u.school_id = $uuid
              none    → FALSE (403)
        ↓ SELECT users LEFT JOIN schools LEFT JOIN countries
        ↓ SELECT user_roles actifs
        ↓ hydrateUser = mapUserRow + displayRoles + businessProfile
        ↓ JSON (e-mail, téléphone, identity_code, schoolId, …)
        ↓
DataContext : Superadmin → applyClientScopeToState ne filtre PAS (state.users = dump API)
        ↓
UsersPage : projectScopedUsers → isSuperadminManagedUser → table
        ↓
Colonnes Type métier / Rôle d'accès
        formatBusinessProfileKind  → « Sans affectation » si accountKind unassigned
        formatAccessRolesDisplay   → « Aucun rôle d'accès » si roleKeys vides
```

**Pourquoi le Web affiche « Sans affectation »**

Deux libellés distincts existent depuis `#514` :

| Colonne | Source | Texte si aucun rôle |
| --- | --- | --- |
| Type métier | `businessProfileLabel` / `accountKind` | **Sans affectation** (`unassigned`) |
| Rôle d’accès | `assignmentStatus` / `roleKeys` | **Aucun rôle d’accès** |

Code exact du libellé métier :

```text
backend/lib/userRoleLifecycle.js
  UNAFFECTED_LABEL = "Sans affectation"
  displayRoles([]) → { role, assignmentStatus } = "Sans affectation"

backend/lib/businessProfileIntegrity.js
  resolveAccountKind({ roleKeys: [] }) → "unassigned"
  BUSINESS_PROFILE_KIND_LABELS.unassigned = "Sans affectation"

web/src/lib/userAccounts.ts
  formatBusinessProfileKind → BUSINESS_PROFILE_KIND_LABELS.unassigned
  UsersPage colonne "Type métier" appelle formatBusinessProfileKind
```

Ce n’est **pas** : « aucun membership », « établissement absent », « permission absente ».  
C’est **strictement** : aucun `user_roles` actif (et pas de fiche élève/enseignant liée, sinon le type métier change).

Un élève lié sans rôle d’accès **n’est plus** « Sans affectation » (`#514`) : type métier = « Compte lié à un élève ». Un staff sans rôle **l’est**.

---

## 6. Modèle users / memberships / rôles

**Il n’existe pas de table `memberships`.** Le mot « membership » dans GP-003 désigne :

```text
principal.sub → users.id → users.school_id → schools.id
schools.login_code = code public
```

| Table | Rôle |
| --- | --- |
| `users` | Identité. `school_id` nullable. `role` dénormalisé, **nullable**. `profile_payload` JSONB (createdBy, countryCode, validation*, history, identifier legacy). |
| `user_roles` | GRANT/REVOKE. Unique actif `(user_id, school_id, role_key)` ou plateforme `(user_id, role_key)` si `school_id` NULL. |
| `schools` | Tenant. `short_code` entre dans `identity_code`. |
| `identity_counters` | Séquence `{PAYS}-{SHORT}-{INITIALES}-{YY}-{SEQ}`. |

Trigger `somafrik_assign_permanent_user_identity` :

```sql
IF NEW.school_id IS NULL THEN
  RETURN NEW;   -- pas d'identity_code établissement
END IF;
-- sinon CD-{short_code}-{initials}-{YY}-{seq}
```

**Preuve d’appartenance pour `CD-ITS-…` :**  
`identity_code` n’est émis que si `school_id` est posé. `ITS` est le `schools.short_code`. Ces comptes **appartiennent à un établissement**, même avec `user_roles` vide.

Un utilisateur = **un** `users.school_id`. Le multi-établissement n’est pas un membership list ; au plus des `user_roles` avec des `school_id` distincts, mais `listUsers` joint uniquement `u.school_id`.

Création : `POST /api/backoffice/users` refuse `role` / `roles` client (`FORBIDDEN_CREATE_KEYS`). Toute création est **identité sans rôle** (`role: null`). L’affectation est un GRANT ultérieur. C’est volontaire (Comptes V2) — et c’est ce qui alimente le catalogue Superadmin via `#207`.

---

## 7. Inventaire anonymisé PROD

**Non exécuté.** Aucun secret `DATABASE_URL` production dans l’environnement d’audit. Aucune connexion Render/Supabase.

**Ce qui est néanmoins certain pour les lignes vues sur la capture prod :**

| Signal visuel | Interprétation technique | Cas |
| --- | --- | --- |
| Identifiant `CD-ITS-…` | `users.identity_code` V2, `school_id` NOT NULL, `schools.short_code = 'ITS'`, pays `CD` | Établissement, pas plateforme |
| Rôle **Admin School** | `user_roles.role_key = 'SCHOOL_ADMIN'` actif | **A** — compte plateforme légitime (admin établissement) |
| **Sans affectation** + Actif | `user_roles` actifs = 0 ; `accountKind = unassigned` ; pas de `students.user_id` / `teachers.user_id` actif | **B** (majoritaire) — identité établissement sans rôle |
| Compte **Suspendu** encore listé | `users.status` ∈ {suspended, …} ; `isUserAccountVisible` ne masque que `Supprimé` | Même requête, statut non filtrant |
| E-mail / téléphone dans le détail | `mapUserRow` les copie ; sanitize ne les retire pas | PII établissement dans le JSON Superadmin |

Comptages demandés (à jouer en **SELECT seul** sur le replica prod — ne pas exécuter ici) : voir annexe SQL. Les totaux live ne peuvent pas être inventés.

---

## 8. Inventaire anonymisé PREPROD

**Non exécuté** (pas de `DATABASE_URL` préprod).

Preuves préprod déjà versionnées :

- Capture de payload dans `UsersPage.schoolAdminScope.test.tsx` : `publicId: "CD-ITS-MR-26-00099"`, `accountKind: "unassigned"`, `businessProfileLabel: "Sans affectation"`, `schoolPublicCode: "CD-IN-26-001"`.
- `userAccounts.webRuntime.test.ts` : « capture préprod : payload unassigned → Type métier Sans affectation ».
- `verify-admin-user-creation.js` : Superadmin **doit** voir l’Admin School qu’il vient de créer dans `GET /backoffice/users` (contrat P0 identité).
- `usersTenant.http.pg.test.js` P0-9 : Superadmin **doit** voir `STAFF_A` (secrétaire école A) **et** `STAFF_B` (secrétaire école B) dans le même GET.

La préprod et la prod **partagent le même codepath**. Un écart de données (plus d’identités sans rôle en prod) change les volumes, pas la cause racine.

---

## 9. Analyse « Sans affectation »

Taxonomie demandée — **aucun compte à supprimer**.

| Cas | Critère | Compte `CD-ITS-…` Sans affectation | Admin School visible | Superadmin / Admin Pays schoolless |
| --- | --- | --- | --- | --- |
| **A — compte plateforme légitime** | `SCHOOL_ADMIN` / `COUNTRY_ADMIN` / `SUPER_ADMIN`, ou identité `school_id IS NULL` créée pour GRANT plateforme | Non (l’identifiant école le sort de A) | Oui | Oui si `school_id` NULL |
| **B — utilisateur établissement sans rôle** | `school_id` NOT NULL + 0 `user_roles` actif + pas de fiche élève/enseignant | **Oui — cas réel de la capture** | Non | Non |
| **C — membership incomplet** | `user_roles` sans `users.school_id`, ou l’inverse | Possible en legacy ; le trigger actuel refuse une identité école sans `school_id` | Admin School `school_id` NULL = fixture `USER_NO_SCHOOL` (invalidé au GRANT) | — |
| **D — compte orphelin** | `school_id` NULL, pas de rôle plateforme, pas de pays dans `profile_payload` | Non (`CD-ITS` implique école) | — | Possible hors capture |
| **E — ancien compte legacy** | `users.role` TEXT encore rempli, `profile_payload.secondaryRoles`, `identifier` dans JSON, pas de `identity_code` | Les `CD-ITS` sont V2, pas legacy SCH- | Certains Admin School peuvent encore avoir `users.role` dénormalisé | — |
| **F — erreur de projection UI** | API a des `roleKeys` mais l’UI affiche Sans affectation | Non pour un staff `roleKeys=[]` : API et UI sont alignés depuis `#514` | Non | — |
| **G — autre** | Compte lié élève mal hydraté (aurait dû être « Compte lié à un élève ») | Si `students.user_id` manquant → retombe en B/unassigned | — | — |

**Verdict par compte de la capture :**

- `CD-ITS-…` + Sans affectation = **B** (identité établissement, GRANT jamais fait ou tout révoqué).  
- `CD-ITS-…` + Admin School = **A** (périmètre plateforme voulu).  
- Suspendu Sans affectation = **B** + statut.  
- Ce n’est **pas** F : le texte vient du backend `displayRoles([])`, pas d’un fallback React isolé.

Le Superadmin **peut** `PATCH` / `GRANT` / reset-password ces comptes B : `canManageUserAccount` → `isUnassignedUserAccount` → true ; backend `assertUsersTargetAccess` en `mode: "all"` ne 403 pas. `listAssignableRolesForPrincipal` Superadmin inclut `TEACHER`, `SECRETARY`, etc. Un GRANT `TEACHER` **crée/réactive** le profil enseignant. Ce n’est plus de la simple visibilité.

---

## 10. Matrice isolation tenant

Exécution : tests unitaires GP-003 **48/48 OK** (`usersSchoolScope.test.js`, `usersTenant.guard.test.js`, `platformPersonalDataGuard.test.js`, projections métier). Parcours HTTP PG `usersTenant.http.pg.test.js` : **SKIP** (pas de `DATABASE_URL`) — le contrat est lu dans le fichier, non rejoué live.

`schoolCode` / header / JWT leftover **ne sont pas** l’autorité établissement. Un SCHOOL_ADMIN B qui forge le code de A → 403 ou liste bornée à B (P0-8 / P0-11 / P0-12).

| Acteur | Route | Tenant demandé | Résultat | Verdict |
| --- | --- | --- | --- | --- |
| SCHOOL_ADMIN A | GET `/api/backoffice/users` | (membership A, header ignoré) | `u.school_id = A` uniquement | **OK** |
| SCHOOL_ADMIN B | GET idem | membership B | uniquement B ; staff A absent | **OK** |
| SCHOOL_ADMIN B | GET avec JWT/header école A | leftover A | membership B gagne ; pas de dump A | **OK** |
| SCHOOL_ADMIN B | POST body `schoolId=A` | A | 403 `TENANT_MISMATCH` | **OK** |
| SCHOOL_ADMIN B | PATCH/GRANT/RESET user de A | A | 403 | **OK** |
| SCHOOL_ADMIN A | GRANT `SUPER_ADMIN` | auto-promotion | 403 `PLATFORM_ROLE_FORBIDDEN` | **OK** |
| COUNTRY_ADMIN CD | GET users | pays CD | SQL pays : **tous** les `users` des écoles CD + schoolless `countryCode=CD` (y compris secrétaires) | **P0 PII** (frontière pays OK, trop large) |
| COUNTRY_ADMIN CD | GET | utilisateur BI | absent | **OK** frontière pays |
| COUNTRY_ADMIN CD | PATCH staff BI | BI | 403 | **OK** |
| COUNTRY_ADMIN CD | UI `/administration/utilisateurs` | CD | `projectScopedUsers` : Admin School + **unassigned** du pays | **P1** (unassigned école CD) |
| SUPER_ADMIN | GET users | global | `WHERE TRUE` — **toute** la table `users` + PII | **P0** |
| SUPER_ADMIN | GET users | header schoolCode d’une école | request-scoped → mode school (si `effectiveSchoolCode`) | OK si scopé ; **all** par défaut |
| SUPER_ADMIN | UI UsersPage | global | Admin School + Admin Pays + **tout unassigned** (tous tenants) | **P0/P1** catalogue |
| SUPER_ADMIN | PATCH/GRANT/RESET unassigned `CD-ITS` | école ITS | autorisé (`mode: "all"`) | **P0** écriture |
| SUPER_ADMIN | GET `/api/students`, notes, paiements, audit, export | n’importe | 403 `PLATFORM_PERSONAL_DATA_DENIED` | **OK** P0-2 |
| SUPER_ADMIN | GET `/api/backoffice/contacts` | — | `listClientsProjection()` charge **tous** contacts/users en mémoire, filtre ensuite | risque collatéral (pas l’écran audité) |

Aucun accès **SCHOOL_ADMIN A → données B** n’est démontré. Le P0 est **plateforme → PII tenant** sur une route présentée comme catalogue admin.

---

## 11. Cause racine

Trois couches, dans l’ordre causal :

### C1 — SQL Superadmin / Admin Pays sans prédicat de rôle (cause API)

`resolveUsersSchoolScope` : Superadmin sans école effective → `{ mode: "all" }`.  
`sqlUsersScope` : `mode === "all"` → `"TRUE"`.

Introduit avec GP-003 / **PR #429** (`44cc24ad`, 31 août 2026) en même temps que le durcissement membership UUID. L’objectif était d’empêcher l’école A de voir B, **pas** de borner le catalogue plateforme. Le test P0-9 **exige** que le Superadmin reçoive les secrétaires A et B.

P0-2 / **#503** (`01ab154f`) a ensuite **exempté** `GET /api/backoffice/users` du deny données personnelles, avec le commentaire « comptes admin établissement ». L’exemption n’a **pas** ajouté de filtre `role_key IN ('SCHOOL_ADMIN','COUNTRY_ADMIN',…)`. ALL_PRIVILEGES ouvre donc le dump.

### C2 — « Sans affectation » = gérable Superadmin (cause UI + écriture)

**PR #207** (`ecc489d22`, 15 août 2026) : après création d’identité, la liste Superadmin/Pays affichait 0 compte parce que `scopedUsers` exigeait Admin School / Admin Pays.

Correctif : `isUnassignedUserAccount` → `isSuperadminManagedUser = true`.

Le commentaire dit « identités encore sans rôle » (celles que le Superadmin vient de créer). L’implémentation est **toute** identité sans rôle, y compris `POST` par un Admin School dans son tenant. D’où `CD-ITS-…` dans l’écran global.

Le BackOffice `backOfficeAccessService.isSuperadminManagedUser` **n’inclut pas** les unassigned (Admin Pays / Admin School seulement). Deux annuaires, deux règles.

### C3 — Identité-d’abord V2 (amplificateur, pas un bug isolé)

Création sans rôle + `identity_code` dès que `school_id` est posé. Une identité école sans GRANT est **indistinguable** d’un brouillon Superadmin « Admin School plus tard », sauf `createdBy` / origine — et l’origine n’est **pas** un critère de liste.

`#514` a correctement séparé type métier et rôles d’accès ; il n’a **pas** retiré les unassigned école du catalogue Superadmin. Il a même **confirmé** le libellé pour le staff sans rôle.

**Ce n’est pas :**

- une fuite RLS PostgREST (clients n’utilisent pas PostgREST ; P0-1 lockdown) ;
- `backoffice_state.users` (écritures 410) ;
- un `OR school_id IS NULL` dans le scope **école** (le `IS NULL` n’apparaît que pour l’Admin Pays, schoolless du pays) ;
- un simple fallback React.

---

## 12. PR / commit d’introduction

| Date | SHA | PR | Changement | Avant → après |
| --- | --- | --- | --- | --- |
| 2026-07-07 | `8ee4bef9f` | (historique) | `isSuperadminManagedUser` = Admin Pays \| Admin School | Catalogue Superadmin borné aux rôles plateforme |
| 2026-08-14 | `30bccc952` | LOT 7 Clients | `GET /api/backoffice/users` | SoT PG ; pas encore membership UUID |
| **2026-08-15** | **`ecc489d22`** | **[#207](https://github.com/Somafrik-education/Somafrik/pull/207)** | **Unassigned ⇒ Superadmin-managed** | Les identités sans rôle (y compris école) **entrent** dans l’écran global |
| 2026-08-31 | `44cc24ad` + `d8cc7449` | **[#429](https://github.com/Somafrik-education/Somafrik/pull/429)** | `sqlUsersScope` `TRUE` pour Superadmin | Isolation A/B SCHOOL_ADMIN **OK** ; dump global Superadmin **figé par test P0-9** |
| 2026-08-31 | `5ba2ef39f` | suite #429 | Admin Pays : `school_id IS NULL` + `countryCode` | Schoolless pays visible ; staff du pays aussi |
| ~2026-09 | `01ab154f` | #503 P0-2 | Deny perso ; **allowlist GET users** | Deny élèves/notes/export ; **users reste ouvert sans filtre rôle** |
| 2026-09-01 | `8fe9a342` | leftover JWT | `projectScopedUsers` Superadmin via `isSuperadminManagedUser` | UI Superadmin = C2, pas le dump brut (le dump reste dans `state.users` / JSON) |
| 2026-09-05 | `9d17a8f4` | #514 | Type métier ≠ rôle d’accès | Élève lié ≠ Sans affectation ; **staff sans rôle = Sans affectation** |

Régression fonctionnelle du catalogue Superadmin : **#207**.  
Surface PII HTTP : **#429 `WHERE TRUE`** + **#503 allowlist**.  
Symptôme visuel actuel : **#207 + #514 + identité V2 `CD-ITS`**.

---

## 13. Tests existants

**Exécutés (non destructifs) :** 48 tests backend scope/RBAC/projection — **pass**.  
**SKIP :** HTTP PG (`DATABASE_URL` absent).  
**Non joués :** Vitest Web (`web/node_modules` absent dans l’image). Lecture des fichiers de tests effectuée.

| Couverture | Fichiers | Ce qu’ils figent |
| --- | --- | --- |
| SUPER_ADMIN GET users | `usersTenant.http.pg.test.js` P0-9 | Superadmin **voit staff A et B** (secrétaires) — encode le dump |
| SUPER_ADMIN voit Admin School | `verify-admin-user-creation.js` | Admin School listé après création |
| SUPER_ADMIN UI deux tenants | `UsersPage.hydration.red.test.tsx` | « Leaked Echo » (Admin School B) **doit** apparaître |
| Tenant SCHOOL_ADMIN A/B | `usersSchoolScope.test.js`, `usersTenant.guard.test.js`, `scope.usersCanonical.test.ts` | Isolation membership UUID |
| COUNTRY_ADMIN frontière pays | P0-10 HTTP PG ; hydration « Leaked Echo » absent | Jamais le Burundi |
| P0-2 deny | `platformPersonalDataGuard.test.js` | GET users **autorisé** Superadmin/Pays |
| Sans rôle / Sans affectation | `userRoleLifecycle.test.js`, `userAccountProjection.test.js`, `businessProfileIntegrity.test.js`, `userAccounts.businessProfile.test.ts` | Libellé + élève lié |
| Capture préprod unassigned | `UsersPage.schoolAdminScope.test.tsx` | Affiche Sans affectation **pour SCHOOL_ADMIN**, pas Superadmin |
| Suspendus | `isUserAccountVisible` | Uniquement `Supprimé` masqué |
| Reset password tenant | P0-8 HTTP | B ne reset pas A |

---

## 14. Tests manquants (trous)

Aucun de ces tests n’existe. **Ne pas les ajouter dans cet audit.**

1. Superadmin GET `/api/backoffice/users` **ne doit pas** renvoyer `SECRETARY` / `TEACHER` / `STUDENT` / unassigned `school_id NOT NULL` (le test actuel **exige l’inverse**).  
2. Superadmin UI : unassigned `CD-ITS` établissement **absent** du catalogue plateforme.  
3. `isSuperadminManagedUser` : **zéro** test dédié (aucune occurrence dans `web/**/*.test.*`).  
4. COUNTRY_ADMIN API : staff métier du pays **absent** ; seulement Admin School + identités pays.  
5. Matrice Superadmin PATCH/GRANT sur unassigned école → **403** (aujourd’hui 200).  
6. Alignement `backOfficeAccessService.isSuperadminManagedUser` vs Web.  
7. Suspendu : assertion explicite « toujours dans GET, toujours dans UI si catalogue ».  
8. Origine `profile_payload.createdBy` / directory plateforme vs école.  
9. `listClientsProjection()` unscope (contacts/relations/state overlay) vs P0-2.  
10. Superadmin request-scoped (`effectiveSchoolCode`) vs `mode: "all"`.

Les tests P0-9 / #207 **protègent le défaut**. Un correctif cassera ces assertions : il faudra les **réécrire** dans la PR GREEN, pas les supprimer silencieusement.

---

## 15. Risques de correction

| Risque | Détail |
| --- | --- |
| Casser le flux « créer identité puis Attribuer » Superadmin/Pays | C’est la raison d’être de #207. Un filtre brutal `school_id IS NULL` cacherait aussi le brouillon Admin School (identité déjà rattachée à l’école, rôle pas encore GRANTé). |
| Casser P0-9 / verify-admin-user-creation | Tests à recalibrer : Superadmin voit Admin School, **pas** le secrétaire. |
| Double filtre SQL + UI | Si on ne filtre que le Web, le JSON Superadmin reste une fuite (DevTools, CSV interne, `state.users`). Le SQL doit borner. |
| Admin Pays | Même trou PII in-country. |
| GRANT enseignant depuis l’écran global | Aujourd’hui possible ; le refermer change un pouvoir ops non documenté comme tel. |
| Données | Ne **pas** DELETE les unassigned école. Ce sont des identités V2 valides pour l’Admin School. |
| `listClientsProjection` | Correctif Users seul laisse le dump mémoire sur d’autres routes. |
| `applyClientScopeToState` Superadmin | `return state` brut : même après filtre de page, d’autres écrans (`state.users`) voient le dump. |

---

## 16. Proposition de correctif — **SANS L’APPLIQUER**

**Principe :** « Sans affectation » reste un état d’accès. Il n’est plus un critère d’annuaire. Introduire une **origine de répertoire** (plateforme vs établissement), pas un DELETE.

### 16.1 Backend (source de vérité)

1. `sqlUsersScope` / `listUsers` pour `mode: "all"` et `mode: "country"` :  
   - conserver Superadmin/Pays sur **COUNTRY_ADMIN**, **SCHOOL_ADMIN** (actifs, suspendus, validation pending) ;  
   - identités sans rôle **uniquement** si `directory = platform` (voir 16.2) ou `school_id IS NULL` (Admin Pays / brouillon pays) ;  
   - **exclure** `TEACHER`, `SECRETARY`, `STUDENT`, `PARENT`, et unassigned `school_id NOT NULL` d’origine école.
2. Ne plus permettre à `mode: "all"` de signifier `SELECT * FROM users`.
3. `assertUsersTargetAccess` Superadmin : interdire PATCH/GRANT/RESET sur un compte `directory = school` qui n’est pas Admin School (fail-closed).
4. `listAssignableRolesForPrincipal` Superadmin : **COUNTRY_ADMIN / SCHOOL_ADMIN** seulement sur cet écran — pas TEACHER/SECRETARY.
5. Réécrire P0-9 : Superadmin voit Admin School A et B, **pas** STAFF secrétaire.
6. Sortir `GET /api/backoffice/users` du commentaire trompeur P0-2, ou le garder allowlisté **avec** le prédicat rôle/directory.

### 16.2 Origine (éviter de recasser #207)

À la création :

- principal SUPER_ADMIN / COUNTRY_ADMIN → `profile_payload.directory = "platform"` (ou colonne dédiée) ;  
- principal SCHOOL_ADMIN / rôle interne → `"school"`.

Le brouillon Superadmin « Admin School plus tard » (`school_id` posé, rôle vide, directory=platform) **reste** dans l’écran global.  
Le `POST` Admin School (`directory=school`, rôle vide) **disparaît** du Superadmin.

Ne pas se fier au seul `createdBy` (identifiant libre).

### 16.3 Web

- `isSuperadminManagedUser` : unassigned seulement si `directory === "platform"` ou pas d’`identity_code` école / `school_id` vide.  
- Aligner `backOfficeAccessService`.  
- Tests UI Superadmin : `CD-ITS` unassigned école **absent** ; Admin School **présent**.  
- Ne plus laisser `applyClientScopeToState` recopier le dump brut pour Superadmin une fois l’API bornée (défense en profondeur).

### 16.4 Données

Inventaire SELECT (annexe). **Pas de DELETE.** Les unassigned école restent dans le tenant SCHOOL_ADMIN, qui est leur écran (`/etablissement/comptes-utilisateurs` / même `UsersPage` scopée).

### 16.5 Hors de cette PR

Contacts `listClientsProjection()` unscope, overlay state, `principalMustChangePassword` qui charge l’état BO complet : audits séparés.

---

## Réponse à la question CTO

> Pourquoi un Superadmin voit-il dans Administration → Utilisateurs des comptes d’établissement et des comptes « Sans affectation », et ce comportement respecte-t-il l’isolation tenant Somafrik ?

**Pourquoi**

1. Voir des **Admin School** est le contrat de l’écran (plateforme).  
2. Voir des **`CD-ITS-…` Sans affectation** : ce sont des identités **établissement** (`school_id` obligatoire pour cet `identity_code`), créées sans GRANT (modèle V2). Le Superadmin les reçoit parce que `GET /api/backoffice/users` fait `WHERE TRUE`, et parce que **#207** classe tout unassigned comme « compte plateforme gérable ».  
3. « Sans affectation » = **zéro rôle d’accès**, pas « hors établissement ».

**Isolation**

- **École A vs école B pour un Admin School : respectée (P0 tenant GP-003).**  
- **Plateforme vs PII établissement sur cet écran : non respectée (P0).** Le deny P0-2 est contourné par allowlist + SQL global + filtre UI trop large. Un Superadmin (et un Admin Pays, dans son pays) emporte e-mails, téléphones et identifiants de comptes qui ne sont pas des admins établissement. Il peut les modifier.

**STOP** — aucune correction appliquée.

---

## Annexe A — SELECT lecture seule (ops préprod puis prod)

À exécuter en `default_transaction_read_only = on`. Ne pas coller e-mails/téléphones dans un ticket.

```sql
-- 0) lecture seule de session
SHOW default_transaction_read_only;

-- 1) totaux
SELECT
  count(*) AS users_total,
  count(*) FILTER (WHERE school_id IS NULL) AS school_id_null,
  count(*) FILTER (WHERE school_id IS NOT NULL) AS school_id_set,
  count(*) FILTER (WHERE identity_code ~ '^CD-ITS-') AS identity_cd_its
FROM users;

-- 2) sans aucun user_roles actif
SELECT count(*) AS users_sans_membership_role
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles r
  WHERE r.user_id = u.id AND r.status = 'active' AND r.revoked_at IS NULL
);

-- 3) membership (school_id) sans rôle
SELECT count(*) AS school_bound_sans_role
FROM users u
WHERE u.school_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles r
    WHERE r.user_id = u.id AND r.status = 'active' AND r.revoked_at IS NULL
  );

-- 4) rôle actif sans users.school_id
SELECT count(*) AS role_sans_users_school_id
FROM users u
WHERE u.school_id IS NULL
  AND EXISTS (
    SELECT 1 FROM user_roles r
    WHERE r.user_id = u.id AND r.status = 'active' AND r.revoked_at IS NULL
  );

-- 5) plusieurs établissements via user_roles
SELECT count(*) AS users_multi_school_roles FROM (
  SELECT user_id
  FROM user_roles
  WHERE status = 'active' AND revoked_at IS NULL AND school_id IS NOT NULL
  GROUP BY user_id
  HAVING count(DISTINCT school_id) > 1
) t;

-- 6) SCHOOL_ADMIN / unassigned / suspendus (même population que GET Superadmin)
SELECT
  count(*) FILTER (WHERE rk.role_key = 'SCHOOL_ADMIN') AS admin_school,
  count(*) FILTER (WHERE rk.role_key IS NULL AND u.school_id IS NOT NULL) AS unassigned_school_bound,
  count(*) FILTER (WHERE rk.role_key IS NULL AND u.school_id IS NULL) AS unassigned_schoolless,
  count(*) FILTER (WHERE u.status ILIKE '%suspend%') AS status_suspendu
FROM users u
LEFT JOIN LATERAL (
  SELECT r.role_key
  FROM user_roles r
  WHERE r.user_id = u.id AND r.status = 'active' AND r.revoked_at IS NULL
  ORDER BY r.granted_at
  LIMIT 1
) rk ON TRUE;

-- 7) échantillon anonymisé CD-ITS (pas d'email/phone)
SELECT u.id, u.identity_code, u.user_code, u.school_id, s.short_code, s.login_code,
       u.status, u.created_at, u.role AS users_role_denorm,
       (SELECT array_agg(role_key) FROM user_roles r
         WHERE r.user_id = u.id AND r.status = 'active' AND r.revoked_at IS NULL) AS role_keys,
       u.profile_payload ? 'createdBy' AS has_created_by
FROM users u
LEFT JOIN schools s ON s.id = u.school_id
WHERE u.identity_code LIKE 'CD-ITS-%'
ORDER BY u.created_at;
```

Comparer les totaux (2)(3)(6) préprod vs prod. Même codepath ⇒ même forme ; seuls les volumes changent.

---

## Annexe B — Preuves code (pointeurs)

| Élément | Fichier |
| --- | --- |
| Route GET | `backend/server.js` L2834–2840, `usersHttpPrincipal` L2299 |
| SQL TRUE | `backend/lib/usersSchoolScope.js` `resolveUsersSchoolScope` / `sqlUsersScope` |
| Store | `backend/db/clientsPgStore.js` `listUsers` / `listProjection` (ce dernier **sans** WHERE) |
| « Sans affectation » | `backend/lib/userRoleLifecycle.js` `UNAFFECTED_LABEL` ; `businessProfileIntegrity.js` |
| Filtre Superadmin UI | `web/src/lib/userAccounts.ts` `isSuperadminManagedUser` ; `web/src/lib/scope.ts` `projectScopedUsers` |
| Page | `web/src/pages/UsersPage.tsx` ; copy « compte(s) plateforme » |
| Loader | `web/src/lib/domainLoaders.ts` ; `web/src/lib/clientsApi.ts` |
| P0-2 allowlist | `backend/lib/platformPersonalDataGuard.js` L213–230 |
| Identité CD-ITS | `backend/db/migrations/20260820_user_roles_canonical.sql` trigger `school_id IS NULL` |
| Sanitize (pas e-mail) | `backend/lib/sanitizeUserForResponse.js` |
| Tests qui figent le dump | `backend/lib/usersTenant.http.pg.test.js` P0-9 |

---

## Annexe C — Conformité mandat

| Interdit | Statut |
| --- | --- |
| UPDATE / DELETE / INSERT Supabase ou PG métier | Non fait |
| Migration / Render / redeploy / merge | Non fait |
| PR corrective / changement RBAC | Non fait (cette PR = rapport uniquement) |
| Publication e-mail / téléphone | Non fait |
| Suppression de comptes | Non faite |
