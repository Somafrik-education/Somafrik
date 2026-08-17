# Audit P0 — Préfet des études : droit Présences accordé, action refusée

**Suivi :** correctif live implémenté dans PR #228 (`requirePermission` + overlay `role_module_permissions`). Ce rapport reste la preuve de cause (#227).  
**Statut historique :** AUDIT UNIQUEMENT au moment de #227.  
**Branche audit :** `cursor/prefet-presences-rbac-audit-92b2`  
**Base SHA (`origin/develop` au départ de l’audit) :** `53f9a4ee5490eb3673c487853a629189e0542d8a`  
**Gouvernance :** PR draft uniquement. Aucun Ready. Aucun merge.

Cet environnement Cloud n’a **pas** accès PostgreSQL préprod. Les lignes `user_roles` / `role_module_permissions` d’un Préfet réel et le JSON HTTP préprod ne peuvent pas être capturés ici. La cause racine **code** est démontrée par lecture de `develop` + fixtures (`backend/lib/prefetPresencesRbacAudit.test.js`). Les requêtes SQL de capture préprod sont en annexe.

---

## 1. Base SHA / Head SHA

| | SHA |
|---|---|
| Base (`origin/develop` au départ de l’audit) | `53f9a4ee5490eb3673c487853a629189e0542d8a` (merge #226) |
| Head (cette branche d’audit) | voir commit de cette PR |

#226 hydrate le **frontend** via `GET /api/auth/effective-permissions` après login/F5. Le JWT d’accès **n’est pas** réémis. Les routes qui lisent `req.principal.permissions` **sans** overlay live restent sur les claims du login.

---

## 2. Reproduction exacte (contrat UI → HTTP)

### Action UI

Nav **Appels & présences** → page `PresencesPage` (`/presences`).

1. Ouvrir une classe (cartes).
2. Marquer Présent / Absent / Retard / Justifié.
3. Bouton **« Enregistrer l’appel »** → `saveCall()`.

Garde UI avant fetch :

- page : `useFeaturePermissions("Présences").canRead` → `Présences:READ`
- saisie / enregistrement : `canManagePresences(ctx)` = `Présences:CREATE` **OU** `Présences:UPDATE` (alias legacy « Faire appel » / « Gérer appels » aussi)

Si `canManagePresences` est faux : toast *« Action refusée — vous n'êtes pas autorisé à enregistrer l'appel. »* **sans** appel HTTP (classe C).

### HTTP réel (Web et Mobile identiques)

| Champ | Valeur |
|---|---|
| Action UI | Enregistrer l’appel |
| Méthode | `POST` |
| URL client | `/presences` |
| URL serveur | `POST /api/presences` |
| Payload | `{ className, date, hour, items: [{ studentId, className, date, present, status, schoolCode, ... }] }` |
| Succès attendu | `201` + tableau upserté |
| 403 RBAC | `{ "message": "Permission insuffisante pour enregistrer l'appel." }` — **pas de `code` métier** (`BusinessError` sans `code`) |
| 403 abonnement | message `LIMITED_MESSAGE` / `BLOCKED_MESSAGE` (`write_presence`) — à distinguer |
| 401 | JWT / session révoquée |

**Pas de PATCH / DELETE présences** côté produit. L’enregistrement est un **upsert batch POST** (création **et** mise à jour du jour).

Mobile : `TeacherAttendanceScreen.saveCall` → `savePresences` → même `POST /presences`.

---

## 3. Table ACTION UI → ROUTE → PERMISSION ATTENDUE → PERMISSION RÉELLEMENT TESTÉE

| ACTION UI | ROUTE API | Permission attendue (matrice Superadmin) | Permission réellement testée |
|---|---|---|---|
| Ouvrir la page / nav | — (frontend `PermissionRoute view="presences"`) | `Présences:READ` | `Présences:READ` (feature `Présences`) |
| Charger la liste | `GET /api/presences` | `Présences:READ` | **aucune** — `requireAuth` seulement |
| Présences d’un élève | `GET /api/students/:id/presences` | `Présences:READ` | **aucune** — `requireAuth` seulement |
| Créer / enregistrer l’appel | `POST /api/presences` | `Présences:CREATE` (et/ou UPDATE, voir §10) | `assertCanManagePresences(req.principal)` sur **JWT** : `Présences:CREATE` **ou** `Présences:UPDATE` **ou** `Faire appel` **ou** `Gérer appels` **ou** `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` |
| Modifier une présence (même écran, même jour) | `POST /api/presences` (upsert) | `Présences:UPDATE` | **même gate CREATE\|\|UPDATE** |
| Valider un appel | *n’existe pas* comme route distincte | — | — |
| Supprimer / annuler | *pas de DELETE API* | `Présences:DELETE` | **jamais testé** |

`rbacService.routePermissions` **n’a aucune entrée** `GET/POST /api/presences`. `RbacService.canAccess` : route inconnue → `true`. Brancher `requirePermission` **sans** ajouter la clé ne protégerait rien.

---

## 4. PostgreSQL — grant configuré (contrat, pas capture préprod)

Table autoritaire : `role_module_permissions`.

| Colonne | Valeur attendue pour ce scénario |
|---|---|
| `role_key` | `PREFET_ETUDES` |
| `module_key` | **`attendance`** (pas `attendances`, `presences`, `calls`) |
| `scope_type` | `school` si Superadmin a choisi un établissement ; sinon `country` / `global` |
| `country_id` / `school_id` | UUID `countries.id` / `schools.id` |
| `can_create` / `can_read` / `can_update` / `can_delete` | flags cochés dans PermissionsPage |
| `status` | `active` |
| `updated_at` / `version` | bumpés par `upsertGrant` |

Le PATCH Superadmin refuse un `module_key` inconnu (`INVALID_MODULE`). Si le clic a réussi (200), la ligne est bien `attendance`.

SQL de capture : annexe A.

---

## 5. Scope du grant (à comparer en préprod)

Résolution live (`resolveEffectivePermissionsForPrincipal`) :

1. `principal.schoolCode` (JWT) → `resolveCountryAndSchool({ schoolCode })`
2. PG : `WHERE upper(s.school_code) = upper($1)` — **`login_code` n’est pas matché**
3. `pickGrant` : école → pays → global → DENY (premier match, **pas de fusion inter-portées**)

Écarts à détecter en préprod :

| Risque | Effet |
|---|---|
| Grant école A, Préfet sur école B | live sans `Présences:CREATE` (classe A) |
| Grant pays/global true + **DENY école** (ligne school, flags false) | DENY gagne (classe A) |
| JWT `schoolCode` = `login_code` alors que le grant est sur `schools.id` via `school_code` | `schoolId` non résolu → grant école **ignoré** (prouvé par test) |
| `user_roles.school_id` ≠ `users.school_id` | le live utilise le **schoolCode du JWT**, pas `user_roles.school_id` |

---

## 6. Rôle actif du Préfet

Autorité : `user_roles` (`status = 'active' AND revoked_at IS NULL`), via `listActiveUserRoleKeys`.

Pas `users.role` seul. Multi-rôle = **UNION OR**. Pas de « premier rôle seulement ».

Si le catalogue établissement (`establishment_role_permissions`) a une **liste vide** pour un rôle non protégé, `applyEstablishmentCatalogFailClosed` **drop** ce rôle → le Préfet peut disparaître de la résolution (classe A).

---

## 7. `/auth/effective-permissions` — classification

`GET /api/auth/effective-permissions` (`requireAuth` only) appelle `repository.resolveEffectivePermissions(req.principal)` = live `role_module_permissions`.

Tokens aplatis : `Présences:CREATE|READ|UPDATE|DELETE` depuis `moduleName` « Présences » + `moduleKey` `attendance`.

| Scénario | Lecture |
|---|---|
| **A** — jeton absent du JSON live | résolution / scope / DENY école / catalogue fail-closed / grant non persisté |
| **B** — jeton présent live, `POST /api/presences` 403 | **cause racine démontrée** : POST hors `requirePermission`, JWT stale |
| **C** — live + API OK, UI bloque | frontend (`canManagePresences` / `PermissionRoute`) — écart module `Attendances`/`Appels` **écarté** (feature = `Présences`) |

Preuve fixture (scénario B) :

1. JWT Préfet = `["Présences:READ"]` uniquement  
2. Superadmin PATCH école A `attendance` CREATE=true, UPDATE=false  
3. `resolveEffectivePermissionsForPrincipal` → contient `Présences:CREATE`  
4. `assertCanManagePresences(jwt)` → **403**  
5. même gate après overlay live → **OK**

---

## 8. Session existante (contrat #221)

| Cas | UI (après #226) | `POST /api/presences` |
|---|---|---|
| **A.** Préfet déjà connecté **avant** le grant | pas de refetch tant que `accessToken` inchangé ; **F5** hydrate le live | JWT inchangé → **403** si le claim CREATE n’était pas dans le JWT |
| **B.** Nouvelle connexion **après** le grant | login overlay live **dans le JWT** (`sendAuthenticatedResponse` / refresh) | devrait **passer** si la résolution live contient CREATE |

`AuthContext` n’appelle `GET /auth/effective-permissions` que si `session.accessToken` change (mount / login). Pas de poll, pas de refetch au focus.

**Le contrat #221 « live sans nouveau JWT » n’est pas honoré sur POST présences.**  
Le Web peut afficher le bouton après F5 (live) pendant que l’API refuse (JWT).

Si **B** échoue aussi en préprod : ce n’est plus (seulement) l’overlay ; capturer le JSON live + la ligne PG (classe A).

---

## 9. Chaîne `requirePermission` vs POST présences

```
POST /api/presences
  server.js
    requireAuth                    → JWT → req.principal.permissions  (PAS d’overlay)
    requireSchoolSubscriptionFeature("write_presence")  → 403 abonnement possible
    assertCanManagePresences(req.principal)             → 403 RBAC JWT
    upsertSchoolAttendanceBatch → table PG `attendance`
```

Chaîne **non utilisée** par cette route :

```
requirePermission("POST /api/presences")
  → repository.resolveEffectivePermissions(req.principal)   overlay live
  → rbacService.canAccess(routeKey)
  → routePermissions[routeKey]   ← entrée ABSENTE
```

`assertCanManagePresences` (server.js ~L3074) n’appelle **pas** `RbacService` / `functionalRbacResolution`. Il lit le `Set` JWT.

Même écart structurel : `POST /api/notes` + `assertCanManageNotes` (risque frère, hors périmètre correction).

---

## 10. Module key

| Couche | Clé |
|---|---|
| Catalogue `functional_modules` / UI Superadmin | `moduleKey: "attendance"`, `moduleName: "Présences"` |
| `role_module_permissions.module_key` | `attendance` |
| Jetons live | `Présences:CREATE` … |
| Frontend / Mobile | feature `"Présences"` |
| Table métier | `attendance` (projection API `presences`) |

Pas de divergence `attendances` / `presences` / `calls` / `Appels & présences` comme `module_key` canonique. Alias parse : token contenant `"appel"` → module `attendance`.

**Écarté comme cause principale** si le PATCH Superadmin a renvoyé 200.

---

## 11. Verbe métier (CREATE vs UPDATE)

UI « Enregistrer l’appel » / « Faire une présence » → **POST upsert**.

Gate API **et** `canManagePresences` : CREATE **OU** UPDATE.

Si Superadmin coche **CREATE uniquement** : UI et API acceptent (prouvé par tests).  
Ce n’est **pas** un mismatch CREATE-coché / UPDATE-exigé.

`Présences:DELETE` n’est jamais exigé (pas de DELETE).  
`Présences:READ` seul : UI bloque (classe C) ; GET liste n’est de toute façon pas RBAC.

---

## 12. Inventaire routes Présences

| Méthode / URL | Permission | Tenant | Repository | Table |
|---|---|---|---|---|
| `GET /api/presences` | auth only | `tenantScopeService` + élèves scopés | pédagogie canonique | `attendance` |
| `POST /api/presences` | JWT `assertCanManagePresences` + abo `write_presence` | school du principal | `upsertSchoolAttendanceBatch` | `attendance` |
| `GET /api/students/:id/presences` | auth only | élève autorisé | idem | `attendance` |

Route réellement appelée par le Préfet à l’enregistrement : **`POST /api/presences`**.

---

## 13. 403 métier vs RBAC

| Status | Couche | Message / code |
|---|---|---|
| 401 | `requireAuth` | JWT manquant / session révoquée |
| 403 | `principalMustChangePassword` | changement de mot de passe obligatoire |
| 403 | `assertSchoolFeature("write_presence")` | texte abonnement (pas le message « enregistrer l'appel ») |
| **403** | **`assertCanManagePresences`** | **`Permission insuffisante pour enregistrer l'appel.`** — **sans `code`** |
| 400 | `assertPresenceWrite` | payload / intégrité |
| 404 | (autres routes) | pas le gate d’appel |

Si le JSON d’erreur est exactement ce message : couche RBAC JWT, pas un 404/409 maquillé.

---

## 14. UI

```
AuthContext.hydrateEffectivePermissions
  → session.user.permissions = GET /auth/effective-permissions
PermissionContext
  → canManagePresences → Présences:CREATE|UPDATE
PresencesPage
  → api.post("/presences", …)  (Bearer = JWT non overlayé)
```

Module UI = **Présences**, pas Attendances.  
Alias frontend encore actif : tout jeton contenant « appel » (`Faire appel`, `Gérer appels`, même `Appels:CREATE`) est traité comme Présences CREATE/UPDATE (`matchesPresenceLegacyPermission`). Ce n’est pas le `module_key` Superadmin, mais un repli legacy.  
`internalRoleDefaults` Préfet contient Présences READ/CREATE/UPDATE mais **n’est plus autorité** si `user.permissions` est un tableau (live/JWT).

---

## 15. Mobile

Même jeton canonique `Présences:*`.  
`Mobile/src/domain/security/permissions.ts` `canManagePresences` = CREATE\|\|UPDATE.  
`savePresences` → `POST /presences`.  
Pas de matrice runtime distincte. Même 403 JWT.

`Mobile/src/data/catalog.ts` et `internalRoleDefaults` = seed/fallback **D/E**, pas SoT si session.permissions est fourni.

---

## 16. Legacy / JSON (classement)

| Source | Classe | Autorité runtime ? |
|---|---|---|
| `role_module_permissions` | **A. PG autoritaire** | OUI (live GET + requirePermission) |
| JWT `permissions` claim | session | OUI sur POST présences (**bug**) |
| `GET /auth/effective-permissions` | live | OUI frontend après #226 |
| `data.js` `securityMatrix.Présences["Préfet des études"]="CRUD"` | **D** seed / backfill | seulement si `countActiveGrants()===0` ou rôle **sans aucune** ligne grant |
| `rolePermissions` JSON / `establishment_role_permissions` | **D** | backfill / fail-closed catalogue |
| `sessionStorage` session Web | **B** cache UI | overlayé au mount par GET live |
| `backoffice_state` | **D** retiré des writes | — |
| `internalRoleDefaults` / Mobile `catalog.ts` | **E** fallback dangereux si `permissions` absent | pas si live array présent |
| `rbacService.routePermissions` | mapping routes | **absent** pour présences |

Aucune permission runtime POST ne devrait être décidée par JSON local. Aujourd’hui elle est décidée par le **JWT**, pas par PG.

---

## 17. Test matrice (attendu produit vs réel)

Cible :

```
PREFET_ETUDES / école A
Présences: READ=true CREATE=true UPDATE=false DELETE=false
```

| Appel | Attendu métier | Réel `develop` |
|---|---|---|
| GET liste | 200 + `Présences:READ` | **200 sans check READ** |
| POST création | 201 si CREATE | 201 **seulement si JWT** a CREATE\|\|UPDATE (live ignoré) |
| PATCH | 403 | **pas de PATCH** — upsert POST |
| DELETE | 403 | **pas de DELETE** |

Inverser UPDATE=true : le POST upsert est déjà autorisé dès CREATE. UPDATE seul autorise aussi le POST.

---

## 18. Test live-change (obligatoire)

```
1. login Préfet (JWT sans Présences:CREATE)
2. POST présence → 403
3. Superadmin accorde Présences:CREATE (même école)
4. sans logout
5. même POST, même JWT
6. attendu contrat #221 → autorisé
   réel develop     → encore 403
```

Preuve fixture : `live-change #221` dans `prefetPresencesRbacAudit.test.js`.

---

## 19. DENY explicite / multi-rôle / cache / transaction grant

- **DENY école** prioritaire sur pays/global : respecté (`pickGrant`). Superadmin doit savoir s’il édite l’école, le pays ou le global.
- **Multi-rôle** : UNION OR — un Enseignant CREATE n’est pas écrasé par un Préfet READ.
- **Cache** : `functionalRbacPgStore` **sans TTL**. Pas d’invalidation à faire. Un grant PG est visible au prochain `resolveEffectivePermissions`. Le JWT, lui, n’est pas invalidé.
- **PATCH** `/api/backoffice/rbac/permissions` : `withTransaction` → upsert `role_module_permissions` → audit `ROLE_PERMISSION_MATRIX_UPDATED` → COMMIT. Si audit échoue : rollback. Pas de cache à invalider.

---

## 20. Livrable CTO (22 points)

1. **Base SHA** — `53f9a4ee5490eb3673c487853a629189e0542d8a`
2. **Head SHA** — commit de cette PR d’audit
3. **Utilisateur Préfet testé** — non capturé (pas de PG préprod dans cet agent). Fixture : `sub=prefet-user-id`, rôle `PREFET_ETUDES`, `schoolCode=CD-2026-TEST`
4. **user_roles actif(s)** — à lire en préprod (annexe A). Code : `listActiveUserRoleKeys` = `status=active AND revoked_at IS NULL`
5. **Scope exact** — à lire en préprod. Code live : `schools.id` via `school_code` du JWT
6. **Ligne role_module_permissions** — à lire en préprod. Contrat : `role_key=PREFET_ETUDES`, `module_key=attendance`
7. **JSON /auth/effective-permissions** — non capturé en préprod. Fixture après grant : contient `Présences:CREATE` + `Présences:READ`, pas UPDATE/DELETE
8. **Action UI** — « Enregistrer l’appel » (`PresencesPage.saveCall`)
9. **Méthode/URL** — `POST /api/presences`
10. **Status/code** — 403, message `Permission insuffisante pour enregistrer l'appel.`, **pas de code métier**
11. **Permission réellement exigée** — JWT `Présences:CREATE` **ou** `Présences:UPDATE` (pas `requirePermission`, pas le live)
12. **module_key UI** — `attendance` / libellé Présences
13. **module_key backend** — `attendance` → jetons `Présences:*`
14. **Cause racine démontrée** — **classe B** : overlay live absent sur POST présences ; le JWT du login est l’autorité de la route. Causes A (scope / DENY / login_code) à écarter par SQL préprod si un **re-login** échoue encore
15. **Cache** — aucun sur `role_module_permissions`. Cache de fait = **claims JWT**
16. **Alias legacy** — `Faire appel` / `Gérer appels` encore acceptés par le gate ; parse `appel` → `attendance`. Pas d’autorité runtime JSON
17. **Fichiers** — `backend/server.js`, `backend/services/rbacService.js`, `backend/lib/functionalRbacService.js`, `backend/lib/functionalRbacResolution.js`, `backend/lib/functionalModulesCatalog.js`, `web/src/pages/PresencesPage.tsx`, `web/src/lib/permissions.ts`, `web/src/context/AuthContext.tsx`, `Mobile/src/screens/TeacherAttendanceScreen.tsx`, `Mobile/src/domain/security/permissions.ts`
18. **Tables** — `role_module_permissions`, `functional_modules`, `user_roles`, `users`, `schools`, `attendance`, `audit_logs` (grant)
19. **Tests à ajouter après correctif** — voir §22
20. **Correction minimale recommandée** — voir §21 (**ne pas implémenter avant GO CTO**)
21. **Risques** — voir §21
22. **Verdict** — **NO-GO correction** jusqu’à revalidation CTO + DIFF GitHub indépendant

---

## 21. Recommandation minimale (après GO CTO)

Ne **pas** : `if (role === "PREFET_ETUDES")`, hardcode, réactiver `securityMatrix` comme SoT, corriger par JSON local.

Correctif minimal :

1. Overlay live **avant** `assertCanManagePresences` — soit dans `requireAuth` (toutes les routes, y compris notes), soit uniquement sur POST/GET présences en passant par `requirePermission` **après** avoir ajouté les clés `routePermissions` :
   - `GET /api/presences` → `Présences:READ`
   - `POST /api/presences` → `Présences:CREATE` **et** `Présences:UPDATE` (OR, upsert)
2. Conserver `assertCanManagePresences` en défense en profondeur **après** overlay, ou le remplacer par le mapping `routePermissions` pour une seule source.
3. Optionnel : refetch `effective-permissions` au `visibilitychange` (UX) — **insuffisant** sans overlay serveur.
4. Vérifier en préprod `school_code` vs `login_code` sur le JWT du Préfet si le re-login échoue encore.

**Risques du correctif :**

- Overlay dans `requireAuth` : coût `resolveEffectivePermissions` à chaque requête (pas de cache aujourd’hui — acceptable, cohérent multi-instance).
- GET présences aujourd’hui ouvert à tout JWT : durcir avec `Présences:READ` peut casser Parent/Élève s’ils n’ont pas le jeton (ils ont souvent `Présences:READ` via seed).
- POST notes : même trou JWT ; hors mandat mais même rustine `requireAuth`.

---

## 22. Tests à ajouter **après** cause validée / correctif

- PREFET_ETUDES reçoit `attendance` CREATE au bon `school_id`
- `GET /auth/effective-permissions` contient `Présences:CREATE`
- `POST /api/presences` accepte **avec l’ancien JWT** après grant live
- revoke retire immédiatement le droit (même JWT)
- scope autre école refusé
- DENY établissement prioritaire
- aucun alias JSON requis (`Faire appel` non nécessaire)
- GET exige `Présences:READ` (si GO CTO pour durcir)
- 403 abonnement `write_presence` distinct du 403 RBAC

Déjà livrés dans cette PR d’audit (preuve, pas de correctif) :

- contrat source POST sans overlay
- matrice CREATE sans UPDATE
- live-change JWT stale
- DENY école
- `schoolCode` non résolu
- UNION multi-rôle
- UI `canManagePresences` CREATE seul

---

## Annexe A — SQL préprod (à exécuter hors de cet agent)

```sql
-- Rôles actifs du Préfet (remplacer l'identifiant)
SELECT u.id, u.identifier, u.role AS users_role, u.school_id AS users_school_id,
       ur.role_key, ur.status, ur.revoked_at, ur.school_id AS user_roles_school_id,
       s.school_code, s.login_code
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN schools s ON s.id = COALESCE(ur.school_id, u.school_id)
WHERE u.identifier ILIKE '%prefet%'
   OR ur.role_key = 'PREFET_ETUDES';

-- Grant Présences
SELECT rmp.id, rmp.role_key, rmp.module_key, rmp.scope_type,
       rmp.country_id, rmp.school_id,
       rmp.can_create, rmp.can_read, rmp.can_update, rmp.can_delete,
       rmp.status, rmp.version, rmp.updated_at, rmp.updated_by,
       s.school_code, s.login_code, c.iso_code AS country_code
FROM role_module_permissions rmp
LEFT JOIN schools s ON s.id = rmp.school_id
LEFT JOIN countries c ON c.id = rmp.country_id
WHERE rmp.role_key = 'PREFET_ETUDES'
  AND rmp.module_key = 'attendance'
  AND rmp.status = 'active';
```

Puis, token Préfet :

```http
GET /api/auth/effective-permissions
Authorization: Bearer <access_prefet>
```

Classer A / B / C selon présence de `Présences:CREATE` et status du `POST /api/presences`.
