# P0 — Notes & évaluations RBAC live

**Repo :** Somafrik-education/Somafrik  
**Branche :** `cursor/notes-evaluations-rbac-live-92b2`  
**Base `develop` post-#229 :** `af5fe04aff74e3719427a8454ba66bf25454d0a1`  
**Head :** voir PR  
**Gouvernance :** PR **DRAFT** — aucun Ready — aucun merge — STOP CTO  
**Diff GitHub indépendant obligatoire avant tout merge.**

Audit préalable : `docs/audits/NOTES-RBAC-JWT-STALE.md` (cause JWT).  
Correctif : même moteur que Présences #228 — `requirePermission` overlaye `role_module_permissions`.

---

## 1. Base / Head SHA

| | SHA |
|---|---|
| Base | `af5fe04aff74e3719427a8454ba66bf25454d0a1` |
| Head | HEAD de la branche (voir PR) |

---

## 2. Routes auditées

| Route | Méthode | Action UI | Permission attendue | Avant | Classe avant | Classe après |
|---|---|---|---|---|---|---|
| `/api/notes` | GET | Liste notes | `Notes:READ` | `requireAuth` + filtre Parent/Élève | **auth-only** | **live PG** |
| `/api/students/:id/notes` | GET | Fiche élève | `Notes:READ` | `requireAuth` + filtre lié | **auth-only** | **live PG** |
| `/api/notes` | POST | Saisie / upsert note | `Notes:CREATE` **OR** `Notes:UPDATE` | `assertCanManageNotes(JWT)` | **JWT stale** | **live PG** |
| `/api/evaluations` | GET | — | — | **n’existe pas** | non concernée | non concernée (projection pédagogie via GET notes / state) |
| `/api/evaluations` | POST | Nouvelle évaluation | `Notes:CREATE` **OR** `Notes:UPDATE` | `assertCanManageNotes(JWT)` | **JWT stale** | **live PG** |
| `/api/evaluations/:id` | PATCH | Modifier / valider / désactiver | `Notes:UPDATE` | `assertCanManageNotes(JWT)` | **JWT stale** | **live PG** |
| DELETE/archive évaluations | — | Désactiver = PATCH | `Notes:UPDATE` | pas de DELETE HTTP | non concernée | non concernée |

Module canonique : `grades` / libellé **Notes**. Pas de module `evaluations` inventé.

---

## 3. Cause exacte

`assertCanManageNotes` lisait `principal.permissions` (claims JWT).  
`requireAuth` n’overlaye pas PG. `requirePermission` overlaye `repository.resolveEffectivePermissions`.

Même trou que POST `/api/presences` avant #228.

---

## 4. routePermissions avant / après

**Avant :** aucune clé Notes/Évaluations (canAccess = true si `requirePermission` avait été posé sans entrée = no-op). Les écritures passaient par JWT.

**Après (canonique, sans alias) :**

```
GET  /api/notes                          Notes:READ | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
GET  /api/students/:id/notes             Notes:READ | COUNTRY_PRIVILEGES | ALL_PRIVILEGES
POST /api/notes                          Notes:CREATE | Notes:UPDATE | ALL_PRIVILEGES
POST /api/evaluations                    Notes:CREATE | Notes:UPDATE | ALL_PRIVILEGES
PATCH /api/evaluations/:evaluationId     Notes:UPDATE | ALL_PRIVILEGES
```

POST notes = **upsert** (CREATE=true UPDATE=false → OK ; inverse → OK ; les deux false → 403).

---

## 5. assertCan supprimés

`function assertCanManageNotes` **supprimée**. Plus aucun appel.

Restent (frères, hors PR) :

- `teacherHasNotesWritePermission` (legacy backoffice write, rôle Enseignant toujours true)
- `getWebPlatformWritableEntities` (JWT `permissions.has` Notes:*)
- finance `assertCanManageFeeGrids` / payment statuses / student fee
- GET courses / course-schedules / academic-config auth-only
- POST courses **no-op** `routePermissions`

---

## 6. Permissions exactes

Jetons runtime : `Notes:CREATE|READ|UPDATE|DELETE`.  
`ALL_PRIVILEGES` pour Superadmin.  
`COUNTRY_PRIVILEGES` sur GET seulement (comme Présences).  
POST n’accepte plus `COUNTRY_PRIVILEGES` ni `Modifier notes` / `Notes:CRUD` / `Evaluations:CRUD`.

---

## 7. GET Parent / Élève

Audit avant durcissement :

| Rôle | Contrat lecture | Source |
|---|---|---|
| Admin School | Notes:READ | seed « Voir notes » + matrice R |
| Préfet | Notes:READ | matrice CRUD |
| Enseignant | Notes:READ | matrice CRUD |
| Élève | Notes:READ | seed « Voir notes » + matrice R |
| Parent | Notes:READ | matrice Notes:R ; seed **complété** « Voir notes » (alignement #228 Présences) |

Le handler conserve `filterNotesForPrincipal` (notes d’évaluations **publiées** + élèves liés).  
GET branché `requirePermission` : sans `Notes:READ` live → 403 `PERMISSION_DENIED`.  
Pas de GET `/api/evaluations` : la lecture des évaluations reste la projection pédagogique.

---

## 8–12. Grant / revoke / scope / multi-rôle

Même JWT :

1. CREATE=false → POST notes **403 PERMISSION_DENIED**
2. Superadmin accorde CREATE → POST **autorisé** (non-403)
3. revoke CREATE → **403**
4. UPDATE seul → POST notes **autorisé** ; PATCH evaluations **autorisé**
5. école A CREATE, école B DENY → A OK / B 403
6. PREFET READ + TEACHER CREATE → UNION OR autorise ; TEACHER révoqué → 403

Abonnement `write_notes` : middleware **avant** RBAC ; 403 **sans** `code: PERMISSION_DENIED` (message abonnement). Distinct. Testé dans `notesEvaluationsRbacLive.test.js`.

---

## 13–16. Tests

| Couche | Fichier |
|---|---|
| Backend live | `backend/lib/notesEvaluationsRbacLive.test.js` |
| Régression Présences | `prefetPresencesRbacLive.test.js` (notes n’est plus JWT) |
| HTTP | `backend/scripts/verify-functional-rbac.js` |
| PG | `functionalRbac.pg.test.js` (`module_key = grades`, A/B, union, revoke) |
| Web | `permissions.effective.test.ts` (`canManageNotes`) ; `GradesEvaluationsPage.test.tsx` (CREATE/UPDATE boutons) |

Commande : `npm run verify:functional-rbac`.

PG IT : skip local si `DATABASE_URL` absent ; **pas de skip en CI** (même fichier que #229, DATABASE_URL CI).

---

## 17. E2E

Couvert en HTTP mémoire (login Préfet, PATCH Superadmin, même token, POST notes).  
Pas de scénario Playwright Superadmin UI dans cette PR (même contrat que #228).  
UI : `useFeaturePermissions("Notes")` déjà live via `/auth/effective-permissions` ; saisie grille = CREATE **ou** UPDATE ; « Nouvelle évaluation » = CREATE ; « Modifier » = UPDATE. Toast affiche `code` backend.

Refresh applicatif = re-hydratation `effective-permissions` (login / token), pas un F5 obligatoire pour l’API. L’UI boutons suit `session.user.permissions` après hydrate.

---

## 18. Non-régression

Présences #228, anti-casse #229, filtre Parent/Élève notes publiées, Enseignant saisie via `Notes:*` live, audit pédagogie inchangé.

---

## 19. Bugs frères (non corrigés)

- GET courses / course-schedules / academic-config auth-only
- POST/PATCH/DELETE courses **no-op** routePermissions
- finance `assertCan*` rôle JWT
- `getWebPlatformWritableEntities` JWT
- `teacherHasNotesWritePermission` : Enseignant toujours true (legacy sync)

PR suivantes DRAFT : courses live ; finance `fees` live.

---

## 20. Legacy / JSON

Aucune autorisation runtime Notes depuis `data.js` / `securityMatrix` après bootstrap. Seed Parent « Voir notes » = backfill modules manquants uniquement.

---

## Verdict

**GO** pour le critère P0 : le droit Notes configuré par le Superadmin s’applique immédiatement (même JWT) sur POST notes, POST/PATCH évaluations, GET notes.

**NO-GO** inchangé pour l’intégrité totale de l’écran Rôles (#229) tant que courses no-op / finance JWT restent.

Aucun Ready. Aucun merge. STOP CTO.
