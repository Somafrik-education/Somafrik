# Audit CTO — Intégrité écran Administration → Rôles & permissions

**Repo :** Somafrik-education/Somafrik  
**Branche :** `cursor/roles-permissions-integrity-92b2`  
**Base (develop post-#228) :** `0cc7b3238b88880b857c51cccd75c4cb04fcf17c`  
**Head :** renseigné en tête de PR  
**Gouvernance :** PR **DRAFT** — aucun Ready — aucun merge — STOP revalidation CTO  
**Diff GitHub indépendant obligatoire avant tout merge.**

Objectif : certifier que l’écran reflète les droits réellement appliqués, et qu’une permission obligatoire est impossible à retirer (UI **et** API).

---

## Verdict

**NO-GO** pour l’intégrité de bout en bout du critère CTO §27.

**GO partiel** sur le contrat anti-casse livré dans cette PR :

- source unique backend `mandatoryPermissionsForRole` + dépendances intra-module ;
- catalogue API `mandatoryByRole` / `dependencies` / `locks` ;
- UI Superadmin : obligatoire = **checked + disabled** + cadenas ;
- PATCH direct `canRead=false` sur un invariant → **409 `MANDATORY_PERMISSION`**, aucune écriture PG ;
- CREATE/UPDATE/DELETE sans READ → **409 `MANDATORY_PERMISSION`** (`lockKind=dependency`).

Le NO-GO global vient des trous **hors** ce contrat (JWT stale Notes, `requirePermission` sans entrée `routePermissions`, finance role-hardcodée, vues Web non mappées, overlay runtime SUPER_ADMIN encore présent).

---

## 1. Base SHA / Head SHA

| | SHA |
|---|---|
| Base `develop` (merge #228) | `0cc7b3238b88880b857c51cccd75c4cb04fcf17c` |
| Head de cette PR | voir commit de la branche / PR |

---

## 2. Catalogue Superadmin — 27 modules, CRUD complet

Source runtime : table `functional_modules` (seed `backend/lib/functionalModulesCatalog.js`).  
L’écran charge `GET /api/backoffice/rbac/catalog` puis `GET /api/backoffice/rbac/permissions`.

| moduleKey | moduleName | CREATE | READ | UPDATE | DELETE | Web | Mobile |
|---|---|---|---|---|---|---|---|
| countries | Pays | ✓ | ✓ | ✓ | ✓ | oui | oui |
| schools | Établissements | ✓ | ✓ | ✓ | ✓ | oui | oui |
| subscriptions | Abonnements | ✓ | ✓ | ✓ | ✓ | oui | non |
| contacts | Contacts | ✓ | ✓ | ✓ | ✓ | oui | non |
| relations | Relations | ✓ | ✓ | ✓ | ✓ | oui | non |
| users | Utilisateurs | ✓ | ✓ | ✓ | ✓ | oui | oui |
| role_permissions | Droits par rôle | ✓ | ✓ | ✓ | ✓ | oui | oui |
| education_reference | Référentiels pédagogiques | ✓ | ✓ | ✓ | ✓ | oui | non |
| classes | Classes | ✓ | ✓ | ✓ | ✓ | oui | oui |
| students | Élèves | ✓ | ✓ | ✓ | ✓ | oui | oui |
| teachers | Enseignants | ✓ | ✓ | ✓ | ✓ | oui | oui |
| assignments | Affectations | ✓ | ✓ | ✓ | ✓ | oui | oui |
| attendance | Présences | ✓ | ✓ | ✓ | ✓ | oui | oui |
| grades | Notes | ✓ | ✓ | ✓ | ✓ | oui | oui |
| report_cards | Bulletins | ✓ | ✓ | ✓ | ✓ | oui | oui |
| payments | Paiements | ✓ | ✓ | ✓ | ✓ | oui | oui |
| fees | Frais & tarifs | ✓ | ✓ | ✓ | ✓ | oui | non |
| unpaid | Impayés | ✓ | ✓ | ✓ | ✓ | oui | non |
| notifications | Notifications | ✓ | ✓ | ✓ | ✓ | oui | oui |
| messages | Messages | ✓ | ✓ | ✓ | ✓ | oui | oui |
| documents | Documents | ✓ | ✓ | ✓ | ✓ | oui | oui |
| reports | Rapports | ✓ | ✓ | ✓ | ✓ | oui | oui |
| school_settings | Paramètres Établissement | ✓ | ✓ | ✓ | ✓ | oui | oui |
| academic_years | Années Académiques | ✓ | ✓ | ✓ | ✓ | oui | oui |
| subjects | Matières | ✓ | ✓ | ✓ | ✓ | oui | oui |
| exams | Examens | ✓ | ✓ | ✓ | ✓ | oui | oui |
| planning | Planning de cours | ✓ | ✓ | ✓ | ✓ | oui | non |

Aucun module « Bibliothèque ». Pas de doublon `moduleKey`.

`CRUD_PERMISSION_MODULES` (Web `constants.ts`) omet **Droits par rôle** et **Référentiels pédagogiques** — liste nav/legacy, pas SoT de l’écran Permissions.

Mobile : pas de catalogue `moduleKey` parallèle. Consomme `/auth/effective-permissions`. `Mobile/src/data/catalog.ts` `securityMatrix` = **legacy / fallback**, pas autorité runtime.

---

## 3. Modules fantômes / API sans module / alias

### UI → API

Chaque `moduleKey` du tableau ci-dessus correspond à au moins une route métier ou backoffice réelle (voir §5). Pas de module UI orphelin dans `FUNCTIONAL_MODULES`.

### API protégée sans module UI visible

| Jeton / vue | Écran Permissions | Constat |
|---|---|---|
| `Rôles Établissement:CRUD` | absent du catalogue 27 | CRUD rôles sur l’onglet **Rôles** du même écran, gated `ALL_PRIVILEGES` |
| Vue `unpaid` | module `unpaid` existe | `VIEW_PERMISSION_FEATURES.unpaid` → **Frais & tarifs** (pas Impayés) |
| Vue `mySubscription` | pas de module | « Mon abonnement » |
| Vue `chartSettings` | pas de module | « Paramètres graphiques » + route `dashboard-chart-config` (`ALL_PRIVILEGES`) |
| Vue `bulletinDesign` | pas de module | « Conception bulletins » (alias Documents/Bulletins) |
| `overview` / `establishment` | `null` | toujours visibles (hors RBAC module) |

### Alias legacy encore acceptés par `routePermissions` (OR)

`Gérer élèves`, `Voir classes`, `Gérer enseignants`, `Faire appel`, `Gérer appels`, `Modifier notes`, `Voir présences`, `Valider bulletins`, `Organiser examens`, `Gérer cours`, `Gérer paiements`, `Contrôler tous les pays`, `ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES`, etc.

Ils ne sont **pas** nécessaires au fonctionnement canonique `Module:ACTION` une fois la matrice PG peuplée. À supprimer ensuite (PR dédiée), pas dans celle-ci.

### `moduleKey` divergents

Aucun alias `presences` vs `attendance` dans le catalogue. Jeton affiché = `moduleName` (`Présences:READ`).

---

## 4. Droits obligatoires — contrat réel (rien inventé)

Fonction unique : `mandatoryPermissionsForRole(roleKey)` dans `backend/lib/rbacMandatoryPermissions.js`.

### SUPER_ADMIN (invariants déjà existants, désormais exposés)

| Module | CREATE | READ | UPDATE | DELETE |
|---|---|---|---|---|
| role_permissions | non | **oui** | **oui** | non |
| users | **oui** | **oui** | **oui** | **oui** |
| countries | **oui** | **oui** | **oui** | non |
| schools | **oui** | **oui** | **oui** | non |
| education_reference | **oui** | **oui** | **oui** | non |

`ALL_PRIVILEGES` : jeton **runtime** injecté si le principal a le rôle SUPER_ADMIN. Ce n’est pas une case CRUD. Ne pas l’inventer dans la matrice.

### COUNTRY_ADMIN / SCHOOL_ADMIN

**Contrat réel actuel :**

- rôles **protégés à l’archivage** (`PROTECTED_SYSTEM_ROLE_KEYS`) ;
- jetons runtime `COUNTRY_PRIVILEGES` / (SCHOOL via seed) ;
- **aucun invariant CRUD PATCH** dans le code avant cette PR ;
- **cette PR n’en invente pas.**

Proposition P1 (hors livrable, à valider produit) : SCHOOL_ADMIN `users:READ` + `school_settings:READ` ; COUNTRY_ADMIN `schools:READ` + `users:READ`. Non encodé.

### PREFET_ETUDES et rôles métier

Aucun invariant de rôle. L’exemple CTO « Présences:READ obligatoire pour *utiliser* le module » est une **dépendance fonctionnelle**, pas un lock de rôle : si CREATE/UPDATE/DELETE est actif, READ est verrouillé ; le module entier peut rester à false.

### Dépendances fonctionnelles encodées (dérivées de l’UI réelle)

Preuve : `PermissionRoute` + listes (`StudentsListPage`, `TeachersListPage`, …) refusent l’écran sans `canRead`.

```
create → [read]
update → [read]
delete → [read]
```

**Non encodé (cross-module, non démontré comme contrat unique sans casser des OR legacy) :**

- Affectations:CREATE → Enseignants:READ / Classes:READ / Matières:READ  
  (`GET /api/assignments` accepte aussi `Enseignants:READ` **sans** `Affectations:READ`)
- Présences:CREATE → Élèves:READ / Classes:READ  
- Notes:CREATE → Élèves / Classes / Matières / Examens  

Proposition P1 : matrice cross-module après audit UI écran par écran. Préférence CTO respectée ici : **refuser le payload incohérent intra-module**, pas normaliser silencieusement.

---

## 5. Matrice route → module → CRUD (priorité métier + inventaire)

`routePermissions` : **148** clés. Overlay live : `requirePermission` appelle `repository.resolveEffectivePermissions` (PG) puis teste les jetons.

Légende classe : **live PG** = `requirePermission` + entrée matrice ; **JWT stale** = `assertCan*` / `permissions.has` sur le JWT ; **auth-only** = `requireAuth` sans RBAC module ; **no-op** = `requirePermission(clé)` **absente** de `routePermissions` → `canAccess` retourne true.

### Priorité CTO

| Route | Module | CRUD attendu | Classe |
|---|---|---|---|
| GET `/api/students` | students | READ | live PG |
| PATCH `/api/students/:id` | students | UPDATE | live PG |
| DELETE `/api/students/:id` | students | DELETE | live PG |
| GET `/api/teachers` | teachers | READ | live PG |
| POST `/api/teachers` | teachers | CREATE | live PG |
| PATCH/DELETE teachers | teachers | UPDATE/DELETE | live PG |
| GET `/api/assignments` | assignments **OU** teachers | READ | live PG (OR large) |
| POST/PATCH/DELETE assignments | assignments | CREATE/UPDATE/DELETE | live PG |
| GET `/api/presences` | attendance | READ | live PG (#228) |
| POST `/api/presences` | attendance | CREATE **OU** UPDATE | live PG (#228) |
| GET `/api/notes` | grades | (devrait READ) | **auth-only** |
| POST `/api/notes` | grades | CREATE/UPDATE | **JWT stale** |
| POST/PATCH `/api/evaluations` | grades | CREATE/UPDATE | **JWT stale** |
| GET `/api/payments` | payments | READ | live PG |
| POST `/api/payments` | payments | CREATE **OU** UPDATE | live PG |
| GET `/api/v2/subjects` | subjects (+ OR affectations/classes) | READ | live PG |
| POST/DELETE `/api/v2/subjects` | subjects | CREATE/DELETE | live PG |
| GET/POST/PATCH classes | classes | READ/CREATE/UPDATE | live PG |
| GET/POST/PATCH exams | exams | READ / CREATE\|UPDATE / UPDATE | live PG |
| GET/POST report-cards | report_cards | READ / UPDATE | live PG |
| school-documents | documents | READ/CREATE/UPDATE | live PG |
| announcements | notifications | READ/CREATE/UPDATE | live PG |
| messages | messages | READ/CREATE/UPDATE | live PG |
| education-levels/streams | education_reference | CRUD | live PG |
| backoffice users | users | CRUD | live PG |
| backoffice establishments | schools | CRUD | live PG |
| backoffice countries | (legacy « Contrôler tous les pays ») | — | live via ALL/COUNTRY, **pas** `Pays:READ` seul |
| rbac/catalog & permissions | ALL_PRIVILEGES | — | live (Superadmin) |
| GET `/api/courses` | planning/subjects | READ | **auth-only** |
| POST `/api/courses` | planning | CREATE | **no-op** (clé absente de `routePermissions`) |
| PATCH/DELETE `/api/courses/:id` | planning | UPDATE/DELETE mappés POST | **no-op** + exception CRUD |
| course-schedules * | planning | idem | **no-op** / auth-only GET |
| GET `/api/academic-config` | school_settings | READ | **auth-only** |
| finance fee-grids / statuses | fees/payments | — | `requirePermission(POST payments)` **puis** `assertCan*` **role JWT** |
| GET student report / payments | — | — | **auth-only** |

Exceptions documentées (volontaires ou dette) :

- POST présences / paiements / exams / documents : CREATE **OR** UPDATE (upsert).
- PATCH/DELETE cours & EDT : mappés sur la clé POST (si elle existait).
- GET `/api/backoffice/countries` : pas `Pays:READ`.

Inventaire complet des 148 clés : `backend/services/rbacService.js` `routePermissions`.

---

## 6. UI — cases obligatoires

`web/src/pages/PermissionsPage.tsx` consomme `catalog.mandatoryByRole` (pas de liste locale).

- invariant de rôle : `checked=true`, `disabled=true`, cadenas, tooltip *« Permission obligatoire pour le fonctionnement de ce rôle »* ;
- dépendance : cocher CREATE/UPDATE/DELETE force READ + le verrouille ; retirer le dernier droit dépendant libère READ ;
- pas de bouton « Tout décocher » sur cet écran ;
- `toggle` no-op si locked (clavier / click ignorés) ;
- erreur `MANDATORY_PERMISSION` affichée via toast (message backend).

Preuve tests : `web/src/pages/PermissionsPage.test.tsx`, `web/src/lib/rbacLocks.test.ts`.

---

## 7. Backend — impossible à contourner

`PATCH /api/backoffice/rbac/permissions` :

1. `assertMandatoryPermissionPatch` **avant** transaction ;
2. 409 `MANDATORY_PERMISSION` ;
3. `details.lockKind` = `role_invariant` \| `dependency` ;
4. `details.legacyCode` = `SUPER_ADMIN_INVARIANT` pour SUPER_ADMIN (compat) ;
5. aucune écriture PG.

Exemple : SUPER_ADMIN `users.canRead=false` → 409, grant inchangé.

Préférence CTO respectée : **refus**, pas de normalisation silencieuse CREATE=true/READ=false → READ=true.

Filet runtime existant conservé : `applySuperAdminInvariants` réinjecte les flags SUPER_ADMIN à la **lecture effective**. Deux vérités si une vieille ligne PG est false. Cette PR empêche toute **nouvelle** écriture invalide. Réparation des lignes historiques = P1 (script one-shot), pas un rewrite silencieux à chaque PATCH.

---

## 8. Tables PG (autorité runtime)

| Table | Rôle |
|---|---|
| `functional_modules` | catalogue modules |
| `role_module_permissions` | grants CRUD scopés |
| `establishment_roles` | catalogue rôles + `system_protected` |
| `user_roles` | rôles actifs (union OR) |
| `audit_logs` | ROLE_PERMISSION_* |

Résolution : school → country → global → DENY (premier match, pas de fusion inter-portées). Multi-rôle : UNION OR des rôles actifs.

---

## 9. JSON / sources locales restantes

| Source | Classe |
|---|---|
| `functional_modules` + `role_module_permissions` | **autorité runtime** |
| `backend/lib/functionalModulesCatalog.js` | seed/bootstrap du catalogue |
| `backend/data.js` `rolePermissions` / `securityMatrix` / `rolePermissionsForLiveRbac` | seed/backfill **si grants absents** ; plus SoT écran |
| `role_permissions` JSONB | projection lecture / legacy PUT interdit |
| `web/src/lib/constants.ts` VIEW_PERMISSION_FEATURES | mapping vues nav → moduleName |
| `web/src/lib/internalRoleDefaults.ts` | fallback UI hors overlay live |
| Mobile `securityMatrix` / `internalRoleDefaults` | compat / fallback |
| `RbacService.permissionsFor(role)` | fallback JWT si pas d’overlay |

`backfillGlobalGrantsFromLegacyMaps` : **seulement si `countActiveGrants() === 0`**.  
`backfillMissingGlobalModuleGrants` : modules **absents** uniquement, n’écrase jamais un DENY explicite (ligne existante tous flags false). Idempotent. Pas de « table vide ⇒ matrice locale redevient autorité » après le premier seed.

---

## 10. Trous JWT stale restants (hors correctif cette PR)

Déjà documenté : `docs/audits/NOTES-RBAC-JWT-STALE.md`.

| Route | Classe | Correctif suivant |
|---|---|---|
| POST `/api/notes` | JWT stale `assertCanManageNotes` | P0 — `requirePermission` CREATE\|UPDATE + `PERMISSION_DENIED` |
| POST `/api/evaluations` | JWT stale | P0 frère Notes |
| PATCH `/api/evaluations/:id` | JWT stale | P0 frère Notes |
| GET `/api/notes`, GET `/api/students/:id/notes` | auth-only | P1 — durcir READ après parcours Parent/Élève |
| GET `/api/courses`, `/api/course-schedules`, `/api/academic-config` | auth-only | P1 |
| POST/PATCH/DELETE courses & schedules | **no-op** `routePermissions` | P0 — ajouter les clés `Planning de cours` / `Matières` |
| `assertCanManageFeeGrids` etc. | role JWT (Admin School, Comptable, …) | P1 — passer au module `fees` live |
| `getWebPlatformWritableEntities` | JWT `permissions.has` | legacy sync BO |
| GET student report / pdf / payments | auth-only | P1 |

Présences GET/POST : **live PG** depuis #228. Affectations : live PG.

Notes : **NO-GO live** tant que POST n’est pas overlay.

---

## 11. Scopes / multi-rôle / concurrence / audit

Couvert par tests existants (`functionalRbac.test.js`, `.pg.test.js`) :

- grant école / deny école / grant pays / grant global / autre école / autre pays ;
- union OR multi-rôle ; rôle révoqué ignoré ;
- `expectedUpdatedAt` → 409 `CONFLICT` ;
- PATCH delta 1 module (UI n’envoie qu’un grant) ;
- audit `ROLE_PERMISSION_MATRIX_UPDATED` + GRANTED/REVOKED ; fail audit → rollback.

Non régressé dans cette PR.

Tenant : PATCH rbac réservé Superadmin (`assertSuperAdmin`). Admin Pays / école / Préfet → 403. Pas de code `INVALID_TENANT_SCOPE` sur cette route (le refus est FORBIDDEN métier Superadmin). `INVALID_SCOPE` = school/country manquant.

---

## 12. Codes d’erreur stables

| Code | Usage |
|---|---|
| `PERMISSION_DENIED` | `requirePermission` 403 |
| `MANDATORY_PERMISSION` | PATCH invariant / dépendance 409 |
| `SUPER_ADMIN_INVARIANT` | alias `details.legacyCode` uniquement |
| `INVALID_MODULE` / `INVALID_ROLE` | 400 |
| `INVALID_SCOPE` | 400 portée |
| `CONFLICT` | 409 concurrence |
| `ROLE_PROTECTED` | archive SUPER/COUNTRY/SCHOOL_ADMIN |
| `LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN` | PUT JSONB |

---

## 13. Preuves tests

| Couche | Fichiers |
|---|---|
| Contrat + PATCH | `backend/lib/rbacMandatoryPermissions.test.js` |
| Cascade / backfill / concurrency | `backend/lib/functionalRbac.test.js` |
| PG IT | `backend/lib/functionalRbac.pg.test.js` (si `DATABASE_URL`) |
| HTTP mémoire | `backend/scripts/verify-functional-rbac.js` |
| UI | `PermissionsPage.test.tsx`, `rbacLocks.test.ts` |
| Présences live (frère) | `prefetPresencesRbacLive.test.js` |

Commande : `npm run verify:functional-rbac`.

Tests UI manuels non exécutés dans cet agent (pas de session Superadmin navigateur). Couverture unitaire : checked+disabled, CREATE force READ, delta PATCH.

---

## 14. CI / Security

À relire sur la PR GitHub (9 checks habituels). Cette PR ne change pas les workflows.

---

## 15. Risques

1. GET configured **overlay** les flags SUPER_ADMIN obligatoires à true pour l’affichage (aligné runtime). Une ligne PG historique false n’est pas auto-réparée tant qu’on n’enregistre pas le module.
2. Cross-module non verrouillé : CREATE Présences sans Élèves:READ reste persistable.
3. `POST /api/courses` actuellement **ouvert à tout authentifié** (clé routePermissions manquante).
4. Overlay runtime SUPER_ADMIN = deuxième vérité (filet). Préférence CTO = empêcher l’écriture ; filet conservé jusqu’à backfill de réparation.
5. `COUNTRY_PRIVILEGES` ouvre beaucoup de GET métier : un COUNTRY_ADMIN voit des modules que l’écran Permissions n’a pas forcément cochés.

---

## 16. PR suivantes recommandées (toutes DRAFT)

| Priorité | Sujet |
|---|---|
| P0 | Notes live : POST `/api/notes` + evaluations → `requirePermission` |
| P0 | Ajouter `routePermissions` pour courses / course-schedules (fin du no-op) |
| P1 | GET notes/courses/academic-config : READ live (après Parent/Élève) |
| P1 | Finance `assertCan*` → module `fees` live PG |
| P1 | Vue `unpaid` → module Impayés ; Pays:READ sur GET countries |
| P1 | Invariants SCHOOL_ADMIN / COUNTRY_ADMIN si contrat produit signé |
| P1 | Dépendances cross-module dérivées écran par écran |
| P2 | Purge alias legacy `routePermissions` + Mobile `securityMatrix` |
| P2 | Script réparation lignes SUPER_ADMIN PG false + retrait overlay runtime |

---

## 17. Critère §27 — score

| Critère | Statut |
|---|---|
| Droit affiché = droit backend (modules 27) | GO avec écarts vues nav (unpaid, chartSettings, …) |
| Toute route protégée = permission visible | **NO-GO** (no-op courses, Pays:READ, Rôles Établissement, aliases) |
| Obligatoires checked+disabled | **GO** (SUPER_ADMIN + dépendance READ) |
| API directe ne peut pas les retirer | **GO** `MANDATORY_PERMISSION` |
| Facultatifs live sans relog | **GO** pour routes `requirePermission` ; **NO-GO** Notes |
| PG unique SoT runtime | **GO** avec seed JSON bootstrap-only |
| Pas de JSON nécessaire au runtime | **GO** après bootstrap ; fallback data.js si table vide (premier boot) |

**Verdict écran : NO-GO** jusqu’aux P0 Notes + routePermissions courses.  
Anti-casse Superadmin (cette PR) : **GO** sous revalidation CTO + diff GitHub indépendant.

Aucun Ready. Aucun merge. STOP CTO.
