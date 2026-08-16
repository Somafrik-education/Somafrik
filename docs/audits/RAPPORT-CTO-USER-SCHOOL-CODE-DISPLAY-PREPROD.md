# Rapport CTO — audit P0 code établissement legacy encore affiché

**PR :** [#219](https://github.com/Somafrik-education/Somafrik/pull/219) — **DRAFT, audit only**  
**Aucune correction métier dans cette PR.**  
**Aucun Ready. Aucun merge.**

Preuves runtime : `docs/audits/evidence/user-school-code-display-preprod-runtime.json`

---

## 1. HEAD SHA audité

```text
develop@c7ffc56e163ea60f941d3579c228d1ede353679e
Merge pull request #218 from Somafrik-education/fix/users-school-public-code-v3
```

Branche d’audit : `audit/users-school-code-display-preprod` (un commit docs au-dessus de ce SHA).

---

## 2. Working tree status (au moment de la capture)

```text
HEAD = e04525f1 (docs audit) → parent c7ffc56e (#218)
Branche = audit/users-school-code-display-preprod
Aucune modification métier.
```

---

## 3. Cause racine prouvée

Le navigateur affiche `CD-2026-0001` parce que **le join Web entre le compte et l’établissement est impossible** avec les contrats réellement servis, puis **`getUserEstablishmentLabel()` retombe sur `user.schoolCode`**.

Chaîne prouvée :

1. PostgreSQL a **deux codes** sur le même établissement : `school_code = CD-2026-0001` (technique) et `login_code = CD-IN-26-001` (public). Preuve : `GET /api/schools/CD-2026-0001` et `GET /api/schools/CD-IN-26-001` retournent **le même** objet `INSTITUT NURU` / `CD-IN-26-001`.
2. `GET /api/backoffice/users` projette `UserAccount.schoolCode` depuis **`s.school_code` uniquement**. SQL réel : `SELECT u.*, s.school_code, ...` — **`s.login_code` n’est pas sélectionné**. Mapping : `mapUserRow()` → `schoolCode = row.school_code`.
3. La PR #218 appelle `GET /api/schools/CD-2026-0001`. L’API **répond 200** avec le login public, mais `toPublicSchool()` **efface l’alias historique** :

```json
{"code":"CD-IN-26-001","loginCode":"CD-IN-26-001","name":"INSTITUT NURU","city":"Uvira"}
```

Champs absents : `publicId`, `schoolCode`, `legacySchoolCode`.  
`code` n’est plus `CD-2026-0001`.

4. `getUserEstablishmentLabel()` cherche une école dont `code | publicId | schoolCode` égale `user.schoolCode` (`CD-2026-0001`). **Aucune de ces clés n’existe** sur le DTO public. `find` = `undefined`.
5. Fallback obligatoire :

```ts
if (!school) return user.schoolCode as string; // → "CD-2026-0001"
```

C’est exactement le texte du champ **ÉTABLISSEMENT** (sans nom d’école). Si l’école avait été trouvée, le libellé serait `INSTITUT NURU (CD-IN-26-001)`.

6. Amplificateur : `scopedSchools()` et `applyClientScopeToState()` filtrent `school.code === user.schoolCode`. Après #218, `school.code` est `CD-IN-26-001` et `user.schoolCode` est `CD-2026-0001` → `schoolsForLabels.length = 0`.

**Ce n’est pas un bundle Web périmé.** Le JS préprod contient `resolveUserSchools` (#218), déployé 42 s après le merge.

---

## 4. Valeurs PostgreSQL réelles

**Limitation d’environnement :** cet agent n’a pas `DATABASE_URL` préprod. Aucun `SELECT` direct n’a été exécuté. Aucun `UPDATE`.

La vérité établissement est néanmoins **observée sur l’API préprod live**, dont `/api/health` déclare `"database":"postgresql"`. `GET /api/schools/:code` résout via `platformSchools` mappé par `mapEstablishmentRow()` depuis les lignes `schools` (`code = school_code`, `publicId/loginCode = login_code`). Les deux codes demandés retournent le même établissement.

| Colonne | Valeur observée / déduite | Preuve |
|---|---|---|
| `schools.school_code` | `CD-2026-0001` | lookup `GET /api/schools/CD-2026-0001` → 200 (match interne `item.code`) |
| `schools.login_code` | `CD-IN-26-001` | JSON `loginCode` / `code` public |
| `schools.name` | `INSTITUT NURU` | JSON `name` |
| `schools.city` | `Uvira` | JSON `city` |
| `schools.id` | **non capturé** (UUID absent du DTO public) | besoin SQL |
| `country_code` | `CD` (préfixe des deux codes) | déduit ; SQL requis pour `iso_code` |

Compte **JEAN PIERRE KIMWEMWE** (capture préprod) :

| Champ | Valeur | Statut |
|---|---|---|
| Identifiant affiché | `CD-IN-JPK-26-00004` | capture UI = `users.identity_code` / `users.login_code` (identité **utilisateur**, pas établissement) |
| Rôle | `Préfet des études` | capture UI |
| `users.school_id` | FK vers l’établissement ci-dessus | non lu en SQL |
| `users.school_code` projeté | `CD-2026-0001` | UI + `mapUserRow` |
| `users.id` / `users.user_code` | **non capturés** | besoin SQL authentifié |

SQL à rejouer en lecture seule dès qu’un accès PG est fourni :

```sql
SELECT id, school_code, login_code, name, country_code
FROM schools
WHERE school_code = 'CD-2026-0001'
   OR login_code = 'CD-IN-26-001';

SELECT u.id, u.user_code, u.school_id, u.role, u.login_code, u.identity_code,
       s.school_code, s.login_code, s.name
FROM users u
LEFT JOIN schools s ON s.id = u.school_id
WHERE u.login_code = 'CD-IN-JPK-26-00004'
   OR u.identity_code = 'CD-IN-JPK-26-00004';
```

---

## 5. JSON réel de `/api/backoffice/users`

Appel anonyme préprod : **HTTP 401** `{"message":"Authentification JWT requise"}`.

Implémentation réelle :

```2106:2108:backend/server.js
app.get("/api/backoffice/users", requireAuth, requirePermission("GET /api/backoffice/users"), asyncHandler(async (req, res) => {
  const clients = await repository.listClientsProjection();
  sendList(res, sanitizeUsersForResponse(tenantScopeService.filterRows(clients.users ?? [], req.principal)), req.query, ["firstName", "lastName", "identifier", "role", "schoolCode"]);
```

SQL `listProjection()` :

```sql
SELECT u.*, s.school_code, c.iso_code AS country_code, c.name AS country_name
FROM users u
LEFT JOIN schools s ON s.id = u.school_id
LEFT JOIN countries c ON c.id = s.country_id
```

**`s.login_code` n’est pas sélectionné. `s.name` n’est pas sélectionné.**

`mapUserRow()` construit notamment :

| Champ JSON | Source | Pour ce compte |
|---|---|---|
| `schoolCode` | `row.school_code` | `CD-2026-0001` |
| `schoolId` | `row.school_id` | UUID PG (non lu ici) |
| `loginCode` | `users.login_code` | `CD-IN-JPK-26-00004` (**login utilisateur**) |
| `publicId` | `users.identity_code` \| `user_code` | `CD-IN-JPK-26-00004` |
| `schoolLoginCode` | **absent** | — |
| `schoolName` | **absent** | — |
| `schoolPublicCode` | **absent** | — |

`sanitizeUserForResponse()` ne retire pas `schoolCode` / `schoolId`.  
`tenantScopeService.filterRows()` compare `row.schoolCode` à `principal.schoolCode` — les deux sont l’alias historique. Le scoping tenant **fonctionne** ; l’affichage public **non**.

JSON métier reconstruit (forme exacte, identifiants PG à compléter) :

```json
{
  "publicId": "CD-IN-JPK-26-00004",
  "loginCode": "CD-IN-JPK-26-00004",
  "role": "Préfet des études",
  "schoolCode": "CD-2026-0001",
  "schoolId": "<uuid non lu>",
  "scopeLevel": "Établissement"
}
```

Pas de `schoolLoginCode`, pas de `schoolName`.

---

## 6. JSON réel de `/api/schools/:code`

| Requête | HTTP | Body |
|---|---|---|
| `GET https://somafrik-api-preprod.onrender.com/api/schools/CD-2026-0001` | **200** | `{"code":"CD-IN-26-001","loginCode":"CD-IN-26-001","name":"INSTITUT NURU","city":"Uvira"}` |
| `GET https://somafrik-api-preprod.onrender.com/api/schools/CD-IN-26-001` | **200** | identique |

Lookup serveur : `platformSchools.find` sur `item.code` **ou** `item.publicId` (objet interne `mapEstablishmentRow`).  
Réponse : `toPublicSchool()` impose `code = loginCode ?? publicId ?? code` et **interdit** `publicId` (test unitaire `publicSchool.test.js`).

Donc :

- l’endpoint **retourne bien** `CD-IN-26-001` ;
- il **ne retourne pas** de clé joignable à `user.schoolCode = CD-2026-0001` ;
- le test #218 mockait `{ publicId, schoolCode: "CD-2026-0001" }` — **contrat fictif**, infirmé par la préprod.

---

## 7. Valeurs runtime avant la modal

Reproduites avec le JSON public réel + `scopedSchools` + `getUserEstablishmentLabel` (preuve dans le JSON d’evidence) :

| Variable | Valeur |
|---|---|
| `detail.schoolCode` | `CD-2026-0001` |
| `school.code` | `CD-IN-26-001` |
| `school.schoolCode` | `undefined` |
| `school.publicId` | `undefined` |
| `school.loginCode` | `CD-IN-26-001` |
| `schoolsForLabels.length` | `0` (après `scopedSchools`) |
| résultat du `find` | `undefined` (même **sans** scope) |
| valeur finale | **`CD-2026-0001`** |

`resolveUserSchools()` **est** dans le loader `users` et **est** dans le bundle préprod. Sur `/etablissement/comptes-utilisateurs`, `domainsForPath` demande `["users","contacts","schools"]` puis `filterDomainsByPermissions` **retire `schools`** pour un Préfet sans vue Établissements. Le loader `users` appelle quand même `resolveUserSchools()`. Le résultat, s’il arrive dans `DataContext`, est ensuite :

- mal joignable (clés disjointes) ;
- et/ou **vidé** par `applyClientScopeToState` → `scopedSchools`.

`ActiveSchoolContext` appelle aussi `ensureDomains(["schools"])` (liste privée `/backoffice/establishments`). Un 403 est skippé ; un tableau vide **remplacerait** `state.schools` (`replaceGlobalRows` = remote fait autorité). Ce n’est pas nécessaire pour expliquer le DOM : le join échoue déjà sur le DTO public seul.

---

## 8. Composant / fonction qui choisit `CD-2026-0001`

- Page : `web/src/pages/UsersPage.tsx`
- Modal détail, ligne **Établissement** :

```598:598:web/src/pages/UsersPage.tsx
              <Row label="Établissement" value={getUserEstablishmentLabel(detail, schoolsForLabels)} />
```

- Helper : `web/src/lib/userAccounts.ts` → `getUserEstablishmentLabel()`
- Fallback qui **écrit** `CD-2026-0001` dans le DOM : `if (!school) return user.schoolCode as string`

La modal utilise bien ce helper. Pas d’autre mapping intermédiaire sur ce champ.

---

## 9. Pourquoi #215 a échoué

#215 n’a touché que `getUserEstablishmentLabel()` : préférer `school.publicId` **si l’école est déjà dans `schools[]`**.

Sur `/etablissement/comptes-utilisateurs` en rôle établissement, `filterDomainsByPermissions` n’envoie pas le domaine `schools`. `schoolsForLabels` est vide → le nouveau `find` ne s’exécute jamais → fallback `user.schoolCode`.

Le test unitaire injectait déjà `[school]` avec `publicId`. Il ne reproduisait pas le Préfet sans domaine `schools`.

---

## 10. Pourquoi #217 a échoué

#217 a ajouté `schools` au bootstrap de **`/administration/utilisateurs`** (Superadmin).

La capture est sur **`/etablissement/comptes-utilisateurs`**. Même si cette route liste aussi `schools` dans `routeDomainMap`, le filtre RBAC l’enlève pour un Préfet. Le test `routeDomainMap.usersSchoolCode.test.ts` n’utilise qu’un contexte Superadmin.

---

## 11. Pourquoi #218 a échoué

#218 a appelé `GET /api/schools/:code` depuis le loader `users`. L’appel **part** et **réussit**. Le correctif échoue ensuite pour **deux raisons indépendantes**, chacune suffisante :

1. **Contrat DTO** : `toPublicSchool()` ne conserve pas `schoolCode`/`publicId` historiques. Le mock du test #218 n’est pas la réponse réelle.
2. **Scope client** : `scopedSchools` compare `school.code` (devenu `CD-IN-26-001`) à `user.schoolCode` (`CD-2026-0001`) et **jette** l’école avant la modal.

Le helper ne lit pas `school.loginCode`. Même un `state.schools` non filtré ne joindrait pas.

CI verte = tests unitaires mockés, pas le runtime Préfet.

---

## 12. État réel du déploiement Web préprod

| Question | Réponse |
|---|---|
| URL | `https://preprod.somafrik.app` |
| Hébergeur réel | **Render** (`rndr-id`) + Cloudflare. **Pas Vercel** sur cette origine (pas de `x-vercel-*`). Même `etag` HTML que `https://somafrik-web-preprod.onrender.com` |
| API | `https://somafrik-api-preprod.onrender.com` (Render) |
| Branche attendue | `develop` (doc interne) |
| SHA applicatif Web | bundle `index-CiZzAUyd.js` contient le code **#218** (`resolveUserSchools`, `GET /schools/${encodeURIComponent}`) |
| Date/heure déploiement Web | `Last-Modified: 2026-08-16 14:32:36 UTC` |
| Merge #218 | `2026-08-16 14:31:54 UTC` → **+42 s** |
| Cache | HTML `s-maxage=300`, Cloudflare HIT ; assets hashés ; **pas de service worker** |
| Verdict déploiement | **ROOT CAUSE ≠ STALE BUNDLE** |

Le backend préprod sert aussi le JSON canonique `CD-IN-26-001` : l’API n’est pas restée sur un mapping pre-login_code.

---

## 13. Liste exhaustive des fichiers concernés

### Chemin critique du bug (à traiter dans la future PR)

| Fichier | Rôle |
|---|---|
| `backend/db/clientsPgStore.js` | SQL `listProjection` / `getUserById` : `s.school_code` sans `s.login_code` |
| `backend/lib/clientsManagement.js` | `mapUserRow()` : `schoolCode` = alias historique |
| `backend/server.js` | `GET /api/backoffice/users`, `GET /api/schools/:code` |
| `backend/lib/publicSchool.js` | DTO public sans alias joignable |
| `backend/lib/schoolsManagement.js` | `mapEstablishmentRow` : `code=school_code`, `publicId=login_code` |
| `web/src/lib/userAccounts.ts` | fallback UI vers `schoolCode` |
| `web/src/pages/UsersPage.tsx` | modal / CSV |
| `web/src/lib/scope.ts` | `scopedSchools` sur `school.code` vs `user.schoolCode` |
| `web/src/context/DataContext.tsx` | `applyClientScopeToState` après merge |
| `web/src/lib/domainLoaders.ts` | `resolveUserSchools` (#218) |
| `web/src/lib/clientsApi.ts` | appel `/schools/:code` |
| `web/src/lib/domainPermissions.ts` | retire le domaine `schools` au Préfet |
| `web/src/lib/routeDomainMap.ts` | route établissement |
| `web/src/types.ts` | ambiguïté `School` / `UserAccount` |
| `web/src/context/ActiveSchoolContext.tsx` | `ensureDomains(["schools"])` parallèle |
| `backend/services/tenantScopeService.js` | filtre tenant sur `schoolCode` historique — **ne pas casser** |

### Tests / mocks qui ont masqué le bug

- `web/src/lib/clientsApi.userSchools.test.ts` (mock DTO irréel)
- `web/src/lib/userAccounts.schoolPublicCode.test.ts` (école déjà injectée)
- `web/src/lib/routeDomainMap.usersSchoolCode.test.ts` (Superadmin seulement)
- `backend/lib/publicSchool.test.js` (`publicId` encore `CD-2026-0001`, sans `loginCode`)

### Inventaire `CD-2026-0001` / `schoolCode` / `login_code` (classement A–H)

**A. Stockage PostgreSQL technique**  
`backend/db/migrations/20260822_school_login_code.sql`  
`backend/db/migrations/20260820_user_roles_canonical.sql` (`users.login_code` = identité personne)  
`backend/db/migrations/20260821_permanent_student_identifiers.sql`  
`backend/db/schoolsRepository.js`  
`backend/db/userRolesSchema.js`

**B. Compatibilité backend**  
`backend/db/clientsPgStore.js` (`getSchoolByCode` filtre `school_code = $1` seulement)  
`backend/db/postgresRepository.js` (`SELECT * FROM schools WHERE school_code = $1`, seeds `CD-2026-0001`)  
`backend/db/fallbackRepository.js`  
`backend/lib/schoolsManagement.js`  
`backend/lib/clientsManagement.js`  
`backend/lib/bulkPlatformSeed.js`  
`backend/data.js`

**C. API**  
`backend/server.js`  
`backend/lib/publicSchool.js`  
`backend/services/tenantScopeService.js`  
`backend/services/rbacService.js`

**D. Web**  
`web/src/pages/UsersPage.tsx`  
`web/src/lib/userAccounts.ts`  
`web/src/lib/scope.ts`  
`web/src/lib/clientsApi.ts`  
`web/src/lib/domainLoaders.ts`  
`web/src/lib/domainPermissions.ts`  
`web/src/types.ts`  
+ ~90 fichiers Web qui consomment `schoolCode` comme **périmètre tenant** (auth, élèves, notes, finances…). **Ne pas les retargeter en `login_code` dans le correctif d’affichage.**

**E. Mobile**  
`Mobile/src/data/catalog.ts`  
`Mobile/src/screens/AdminCrudScreen.tsx`  
`Mobile/src/screens/RoleSelectionScreen.tsx`  
`Mobile/src/lib/userTeacherSync.test.ts`

**F. Tests / fixtures**  
~80 fichiers `backend/lib/*.test.js`, `backend/scripts/verify-*.js`, `packages/auth/test/*`, `web/src/**/*.test.*` avec `CD-2026-0001`. Fixture de démo, pas l’UI préprod.

**G. Documentation**  
`docs/audits/USER-SCHOOL-CODE-DISPLAY-PREPROD.md`  
ce rapport  
`README.md`

**H. Legacy à supprimer (plus tard, pas dans le correctif d’affichage)**  
Présentation de `school_code` comme identifiant public. Conservation technique de `school_code` tant que les FK / JWT / tenant scope s’en servent. **Interdiction d’un replace global `CD-2026-0001` → `CD-IN-26-001`.**

---

## 14. Tables / colonnes PostgreSQL concernées

| Table | Colonnes | Usage |
|---|---|---|
| `schools` | `id`, `school_code`, `login_code`, `name`, `city`, `country_id`, `short_code`, `profile_payload` | source de vérité du code public |
| `users` | `id`, `user_code`, `school_id`, `role`, `login_code`, `identity_code`, `profile_payload` | `login_code` ici = **personne** (`CD-IN-JPK-26-00004`) |
| `user_roles` | `user_id`, `role_key`, `status` | hydratation du rôle Préfet |
| `countries` | `id`, `iso_code`, `name` | jointure projection |
| `school_login_code_counters` | — | génération `login_code` établissement ; hors correctif affichage |

Aucune migration de données n’est requise si `login_code` est déjà `CD-IN-26-001` (prouvé par l’API publique).

---

## 15. Correction minimale recommandée

**À la source, dans une NOUVELLE PR, après GO CTO.**

1. Étendre le SELECT users : `s.login_code AS school_login_code`, `s.name AS school_name` (list + getById).
2. Dans `mapUserRow`, ajouter des champs **nouveaux** :
   - `schoolPublicCode` = `schools.login_code`
   - `schoolName` = `schools.name`
   - **laisser `schoolCode` = `schools.school_code`** (tenant, JWT, RBAC).
3. Dans `getUserEstablishmentLabel`, si `user.schoolPublicCode` est présent : afficher `schoolName (schoolPublicCode)` **sans** consulter le domaine `schools`, **sans** fallback visuel vers `schoolCode`.
4. Assertion négative : le libellé ne contient pas `CD-2026-0001` quand `schoolPublicCode` existe.
5. Ne pas :
   - élargir le RBAC Établissements au Préfet ;
   - reconstruire `CD-IN-26-001` dans le navigateur ;
   - changer la sémantique de `UserAccount.schoolCode` ;
   - modifier les lignes PG ;
   - s’appuyer sur `resolveUserSchools()` comme source du libellé.

`toPublicSchool()` peut rester minimal (login public). Ce n’est plus le chemin d’affichage de la fiche utilisateur.

---

## 16. Tests à ajouter (future PR corrective)

1. Test PG `listProjection` : école `school_code=CD-2026-0001`, `login_code=CD-IN-26-001` → user JSON `schoolCode=CD-2026-0001` **et** `schoolPublicCode=CD-IN-26-001` + `schoolName`.
2. Test HTTP `GET /api/backoffice/users` sur ce cas.
3. Test Web modal **sans** domaine `schools` chargé.
4. Test Web rôle **Préfet des études** + `scopedSchools` vide / code disjoint.
5. Assertion : champ ÉTABLISSEMENT = `… (CD-IN-26-001)` et **ne contient pas** `CD-2026-0001`.
6. Non-régression tenant : `principal.schoolCode` / `filterRows` restent sur l’alias historique.
7. Preuve E2E préprod après déploiement : ouvrir JEAN PIERRE KIMWEMWE.

Ne plus considérer un mock `/schools/:code` comme preuve.

---

## 17. Risques de régression

| Risque | Mitigation |
|---|---|
| Changer `schoolCode` utilisateur en `login_code` | casse JWT, `tenantScopeService`, `scopedUsers`, finances, notes | **nouveaux champs uniquement** |
| Exposer `school_code` via `toPublicSchool.code` | recase le code historique comme public | ne pas le faire |
| Donner `GET /backoffice/establishments` au Préfet | élargit RBAC | interdit |
| `scopedSchools` sur `school.code` canonique | casse le sélecteur d’établissement si `code` devient login | ne pas changer `School.code` métier sans inventaire D |
| Mobile / auth qui lisent `schoolCode` | hors affichage fiche | ne pas retargeter |

---

## 18. Verdict GO / NO-GO pour la correction

**GO** pour une **nouvelle branche / nouvelle PR corrective**, après validation CTO de ce rapport.

**NO-GO** sur #219 : cette PR reste **Draft**, documentation uniquement.

Hypothèses du contrat d’audit :

| # | Hypothèse | Verdict |
|---|---|---|
| 1 | Bundle Web antérieur à #218 | **Infirmée** |
| 2 | `/api/schools/CD-2026-0001` ne retourne pas le login_code | **Infirmée** (il le retourne) ; **confirmé** : pas d’alias historique / pas de `publicId` |
| 3 | `resolveUserSchools()` non exécuté sur la route | **Infirmée** (présent loader + bundle) |
| 4 | Tranche `schools` perdue / écrasée | **Confirmée comme amplificateur** (`scopedSchools` / merge) |
| 5 | `scopedSchools()` élimine l’école canonique | **Confirmée** |
| 6 | School résolu sans alias historique | **Confirmée** (cause join) |
| 7 | La modal n’utilise pas le helper | **Infirmée** |
| 8 | Autre mapping retransforme le code | **Infirmée** ; le fallback du helper **est** l’affichage |

**Cause unique démontrée :** projection users = `school_code` historique + DTO public école = `login_code` sans clé de jointure + fallback UI = `user.schoolCode`.
