# AUDIT — Superadmin / Rôles et droits (RED first)

**Mandat :** Audit + tests rouges d’abord. Aucune correction fonctionnelle.  
**Branche :** `audit/superadmin-rbac-rights`  
**Base `origin/develop` :** `c805b15239842f717b2b50670dabee3c2fb9257f`  
**Écran :** Web → Super Admin → Administration → Rôles et droits (`/administration/permissions`)  
**Date :** 2026-10-01  
**Statut :** DRAFT / HOLD — attendre validation CTO. Ne pas Ready. Ne pas Merge.  
**Complément :** inventaire complet Relations · Utilisateurs · Rôles · Droits · Documents · Conformité (§13–16). Parent HEAD droits : `38b3d96b`.

**Hors périmètre respecté :** aucun refactor opportuniste, aucune migration DB, aucun changement de schéma PostgreSQL, aucun contournement RBAC, aucun élargissement de privilèges, aucun changement de rôle système.

Preuve d’exécution : [`docs/audits/evidence/rbac-admin-audit-results.json`](./evidence/rbac-admin-audit-results.json)  
Commande : `npm run verify:rbac-admin-audit`

---

## 1. Résumé exécutif

Le Superadmin **peut** sélectionner Pays → Établissement → Rôle → Module et **dispose déjà d’une API d’écriture** (`PATCH /api/backoffice/rbac/permissions`). Il **ne peut pas réellement paramétrer** les droits effectifs Création / Lecture / Modification / Suppression.

Cause racine (démontrée par tests rouges, non corrigée) :

1. **`GET /api/backoffice/rbac/permissions` hydrate uniquement les lignes du scope demandé** (école si `schoolCode` est envoyé). En l’absence d’override école, toutes les cases sont `false` alors que le moteur effectif résout déjà `établissement → pays → global`.
2. **`PermissionsPage` n’appelle jamais `/rbac/permissions/effective`.** Le draft UI = flags configured école (souvent vides).
3. **Enregistrer envoie les 4 flags du draft.** Un Enregistrer sans toggle, ou un simple cochage de Lecture, **écrit un grant `scope_type=school` qui remplace entièrement le grant global** (first-match, pas de fusion). Résultat : DENY école ou perte de UPDATE/DELETE hérités.
4. Les **cadenas** ne sont pas « la console en lecture seule ». Ils viennent de deux règles distinctes : invariants SUPER_ADMIN et dépendance Lecture si Création/Modification/Suppression est active. Pour un rôle métier à draft vide, **aucune case n’est verrouillée** — le Superadmin croit paramétrer un rôle sans droits.

L’API d’écriture Superadmin **existe et fonctionne**. L’écart n’est pas « endpoint absent » ni « P1-07 a rendu la page read-only ». C’est une **hydratation scope-exact + remplacement fail-closed** qui rend la console inopérante pour le métier.

Les protections de sécurité (invariants SUPER_ADMIN, archive des 3 rôles système, fail-closed, isolation école/pays, SCHOOL_ADMIN sans écriture) **restent vertes**.

---

## 2. Architecture RBAC actuelle

Deux mondes coexistent. L’écran Administration parle du second.

| Couche | Rôle | Tables / artefacts réels |
|--------|------|---------------------------|
| Jetons legacy | Cartes `role_permissions` JSONB + `data.js` + `establishment_role_permissions` | Bootstrap / fallback si `role_module_permissions` est vide |
| Matrice CRUD scopée | Autorité live après bootstrap | `functional_modules` + `role_module_permissions` |
| Catalogue rôles | Identité des rôles | `establishment_roles` (`role_code`, `system_protected`) |
| Affectations | Qui porte quel rôle | `user_roles` |
| Périmètre | Pays / établissement | `countries`, `schools` |
| Runtime Superadmin | Invariants forcés | `SUPER_ADMIN_INVARIANT_MODULES` + jeton `ALL_PRIVILEGES` |

Résolution effective (`functionalRbacResolution.pickGrant`) :

```text
1. grant school (role_key + school_id + module_key)
2. sinon grant country (role_key + country_id + module_key)
3. sinon grant global
4. sinon DENY (tous flags false)
```

Premier match gagne. **Pas de fusion des flags entre portées.** Multi-rôle = UNION (OR) des rôles actifs. SUPER_ADMIN : invariants réappliqués après résolution.

---

## 3. Source d’autorité

**Affirmation UI :** « PostgreSQL est la source d’autorité. »

**Verdict :** partiellement vrai, réfuté comme source unique de ce que l’écran affiche.

| Affirmation | Preuve |
|-------------|--------|
| PostgreSQL porte la matrice CRUD scopée | Table réelle `role_module_permissions` (`backend/db/migrations/20260823_functional_rbac_canonical.sql`) |
| L’écran n’affiche pas cette autorité résolue | `getConfiguredPermissions` liste `listGrantsForScope` uniquement |
| Des overlays code écrasent PG | `overlayMandatoryFlags` (GET configured) + `applySuperAdminInvariants` (runtime) |
| Fallback hors PG si aucun grant | `resolveEffectivePermissionsForPrincipal` → `legacy-map-fallback` (`data.js` + `role_permissions` JSONB + `establishment_role_permissions`) |
| L’ancienne carte globale n’est plus writable | `PUT /api/backoffice/role-permissions` → 403 `LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN` |

Tables **réelles** impliquées (aucun nom inventé) :

- `establishment_roles`
- `establishment_role_permissions`
- `establishment_role_delegation_permissions`
- `functional_modules`
- `role_module_permissions`
- `user_roles`
- `countries`
- `schools`
- `role_permissions` (JSONB legacy, lecture / bootstrap, écriture interdite)

---

## 4. Flux UI → PostgreSQL

| Étape | Fichier | Lignes | Fonction | Responsabilité | Comportement observé |
|-------|---------|--------|----------|----------------|----------------------|
| Route | `web/src/App.tsx` | 468–474 | `PermissionRoute view="permissions"` | Accès écran | Superadmin only via `canReadView` |
| Layout | `web/src/pages/administration/AdministrationLayout.tsx` | 8, 14–27 | `AdministrationLayout` | Onglet « Rôles et droits » | Navigation uniquement |
| Gate UI | `web/src/lib/permissions.ts` | 278–280, 462–463 | `canManageRolePermissions`, `canReadView` | Qui peut voir / muter | `isSuperAdminRole` uniquement |
| Écran | `web/src/pages/PermissionsPage.tsx` | 78–148, 303–321 | `PermissionsPage` | Chemin pays → école → rôle → module | Selecteurs OK ; Enregistrer si `pathComplete` |
| Catalogue | `web/src/lib/rbacApi.ts` | 92 | `rbacApi.getCatalog` | Rôles + `mandatoryByRole` | `GET /backoffice/rbac/catalog` |
| Matrice affichée | `web/src/lib/rbacApi.ts` | 93–99 | `rbacApi.getConfigured` | Flags CRUD | **Jamais `getEffective`** |
| Draft | `web/src/pages/PermissionsPage.tsx` | 207–218 | `useEffect` + `applyMandatoryOverlay` | Cases | Hydrate `selectedModule` (configured école) |
| Cadenas | `web/src/lib/rbacLocks.ts` | 61–75 | `describeActionLock` | disabled + icône | `role_invariant` ou `dependency` (READ si C/U/D) |
| Toggle | `web/src/lib/rbacLocks.ts` | 92–106 | `toggleCrudFlag` | Mutation locale | No-op si locked ; CREATE/UPDATE/DELETE force READ |
| Save | `web/src/pages/PermissionsPage.tsx` | 230–259 | `save` | PATCH delta 1 module | Envoie les 4 flags du draft, y compris tous `false` |
| Auth route | `backend/services/rbacService.js` | 184–187 | `routePermissions` | `ALL_PRIVILEGES` | SCHOOL_ADMIN / COUNTRY_ADMIN 403 au middleware |
| Handler | `backend/server.js` | 3085–3103 | `GET/PATCH .../rbac/permissions` | HTTP | Délègue au repository |
| Gate service | `backend/lib/establishmentRolesManagement.js` | 63–70 | `assertSuperAdmin` | Second verrou | Rôle Superadmin canonique (P1-02), pas `ALL_PRIVILEGES` |
| Lecture | `backend/lib/functionalRbacService.js` | 364–414 | `getConfiguredPermissions` | Scope exact | **N’hérite pas** global/pays |
| Effective (non branché UI) | `backend/lib/functionalRbacService.js` | 416–441 | `getEffectivePermissionsConfigured` | Cascade | Existe, inutilisée par l’écran |
| Validation | `backend/lib/rbacMandatoryPermissions.js` | 192–223 | `assertMandatoryPermissionPatch` | Invariants + dépendance | 409 `MANDATORY_PERMISSION` |
| Écriture | `backend/lib/functionalRbacService.js` | 473–577 | `patchConfiguredPermissions` | Upsert scope école | Remplace le module entier |
| Store PG | `backend/db/functionalRbacPgStore.js` | `listGrantsForScope` / `upsertGrant` | SQL | Unique active (rôle × scope × module × country × school) |
| Résolution live | `backend/lib/functionalRbacResolution.js` | 83–184 | `pickGrant`, `resolveEffectivePermissionSet` | Autorisation runtime | First-match school > country > global > DENY |
| Réhydratation | `web/src/pages/PermissionsPage.tsx` | 241–242 | `getConfigured` après PATCH | UI | Recoit le grant école, pas l’héritage |

### Qui verrouille réellement une case ?

| Cas | Frontend | Backend | PostgreSQL | Moteur RBAC | Couches |
|-----|----------|---------|------------|-------------|---------|
| Rôle métier, pas d’override école (constat utilisateur) | Cases **déverrouillées** mais **vides** | PATCH accepté | Aucune ligne école | Droits réels = global | **Hydratation UI + GET configured** (pas un cadenas) |
| Lecture alors que C/U/D actifs | `describeActionLock` dependency | 409 si PATCH `canRead=false` + C/U/D | — | — | Frontend **et** backend |
| SUPER_ADMIN / `users`, `role_permissions`, `countries`, `schools`, `education_reference` | `mandatoryByRole` → disabled | `assertMandatoryPermissionPatch` | Overlay lecture | Invariants forcés au runtime | **Toutes les couches** |
| SCHOOL_ADMIN sur cet écran | `canManage=false` + route fermée | `assertSuperAdmin` 403 + `ALL_PRIVILEGES` | — | — | Frontend **et** backend |
| Archive SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN | bouton « Protégé » | `assertNotProtectedArchive` 403 | `system_protected` | — | Frontend **et** backend |

**Réponse courte :** le cadenas visible est frontend (`rbacLocks`) **miroir** d’une règle backend. Le blocage métier du Superadmin sur les rôles métier n’est **pas** ce cadenas : c’est l’hydratation vide + un PATCH qui matérialise un DENY/override école.

---

## 5. Protections système

Conservées. Ne pas les retirer.

| Protection | Où | Effet |
|------------|----|--------|
| `PROTECTED_SYSTEM_ROLE_KEYS` | `functionalRbacManagement.js:24` | SUPER_ADMIN, COUNTRY_ADMIN, SCHOOL_ADMIN |
| Archive interdite | `assertNotProtectedArchive` | 403 `ROLE_PROTECTED` |
| Invariants CRUD SUPER_ADMIN | `SUPER_ADMIN_INVARIANT_MODULES` | `users` CRUD complet ; `role_permissions` R+U ; `countries`/`schools`/`education_reference` C+R+U (pas DELETE) |
| `ALL_PRIVILEGES` | résolution SUPER_ADMIN | Jeton runtime, pas une case |
| `COUNTRY_PRIVILEGES` | COUNTRY_ADMIN | Conservé ; `Pays:CREATE/DELETE` filtrés |
| PUT legacy | `throwLegacyRolePermissionsWrite` | 403 |
| Dépendance C/U/D → READ | UI + `assertMandatoryPermissionPatch` | 409 `dependency` |
| OCC | `expectedUpdatedAt` + advisory lock | 409 `CONFLICT` |
| SCHOOL_ADMIN write matrice | route `ALL_PRIVILEGES` + `assertSuperAdmin` | 403 |
| P1-02 identité Superadmin | `superadminPrincipal.js` | Rôle canonique, pas `schoolCode *` ni seul `ALL_PRIVILEGES` |

**Écart documenté, pas un correctif :** COUNTRY_ADMIN et SCHOOL_ADMIN n’ont **aucun invariant CRUD PATCH**. Superadmin *peut* aujourd’hui modifier leurs flags CRUD via l’API. Seule l’archive est protégée. RED-05 teste les protections existantes (reste VERT). Ne pas inventer un lock CRUD dans cette PR.

---

## 6. Capacités actuelles SUPER_ADMIN

| Capacité | Actuel |
|----------|--------|
| Ouvrir `/administration/permissions` | Oui |
| Choisir pays / établissement / rôle / module | Oui |
| Voir les droits **effectifs** d’un rôle métier | **Non** (matrice école vide si pas d’override) |
| Cocher Création / Modification / Suppression sur draft vide | Oui (pas de cadenas) |
| Décocher Lecture si C/U/D actifs | Non (cadenas dependency — voulu) |
| Enregistrer | Oui → `PATCH` 200 si Superadmin |
| Persister un override école | Oui |
| Modifier un droit **sans écraser les autres flags effectifs** | **Non** |
| Enregistrer sans changement | Écrit un **DENY école** (tous flags false) |
| Créer / archiver un rôle métier | Oui (pas les 3 rôles système) |
| Modifier un invariant SUPER_ADMIN | Non (409) |
| Utiliser `PUT /role-permissions` | Non (403) |

---

## 7. Capacités actuelles SCHOOL_ADMIN

Audité séparément. Aucun élargissement proposé.

| Action | Actuel |
|--------|--------|
| Consulter `/administration/permissions` | Non (`canReadView("permissions")` false même avec `ALL_PRIVILEGES`) |
| Consulter `/parametres/roles-droits` | Oui — catalogue assignable **lecture seule** (`ConfigurationPage`) |
| Affecter un rôle métier à un utilisateur de son école | Oui via Comptes utilisateurs / `GET /establishment-roles/assignable` si jetons Utilisateurs |
| Modifier la matrice CRUD | Non (403 API + pas d’UI) |
| Créer / modifier / archiver un rôle | Non (`assertSuperAdmin` dans `establishmentRolesService`) |
| Modifier un autre établissement / un pays / SUPER_ADMIN / COUNTRY_ADMIN / politique plateforme | Non |

---

## 8. Tests RED / GREEN

### TESTS ROUGES ATTENDUS (échouent volontairement)

| ID | Fichier | Cause technique démontrée |
|----|---------|---------------------------|
| RED-01 | `backend/lib/rbacAdminAudit.red.test.js` | GET configured école ≠ effective (R+U+D invisibles). PATCH depuis draft vide pose CREATE et **perd UPDATE/DELETE**. |
| RED-01b | idem | Enregistrer sans toggle = DENY école (`all false`) qui annule le grant global. |
| RED-02 | idem | Étape bloquante : **GET configured** (Lecture invisible) puis **résolution first-match school** (U/D perdus après PATCH Lecture). API et persistance école fonctionnent. |
| RED-03 | idem | Création/Lecture/Modification/Suppression : pas de handler manquant, pas d’endpoint read-only, pas de 401/403 Superadmin. Payload UI **incorrect par construction** (flags hérités à false). |
| RED-04 | idem | Relecture : Lecture école persistée, mais U/D hérités **disparaissent**. |
| RED-01 UI | `web/src/pages/PermissionsPage.audit.red.test.tsx` | Page n’appelle pas `getEffective` ; cases R/U/D décochées. |
| RED-01b UI | idem | Enregistrer envoie `{c:f,r:f,u:f,d:f}`. |
| RED-03 UI | idem | CREATE actionnable, mais le PATCH n’emporte pas U/D effectifs. |

### TESTS VERTS DE SÉCURITÉ (passent)

| ID | Fichier | Garantie |
|----|---------|----------|
| RED-05 | `backend/lib/rbacAdminAudit.green.test.js` | Invariants SUPER_ADMIN + archive des 3 rôles système |
| RED-06 | idem | Module inconnu / rôle vide / école invalide / permission absente → refus |
| RED-07 | idem | Override école A n’autorise pas école B |
| RED-08 | idem | Grant pays CD n’autorise pas BI |
| RED-09 | idem + `PermissionsPage.audit.green.test.tsx` + `permissions.rbacAdmin.audit.green.test.ts` | SCHOOL_ADMIN / COUNTRY_ADMIN : pas d’écriture, pas de catalogue, pas de vue Administration |
| RED-10 | idem + `rbacLocks.test.ts` | C/U/D exigent READ côté **backend et UI** |
| VERT API | green backend | PUT legacy fermé ; PATCH Superadmin existe |

### TESTS EXISTANTS RÉGRESSÉS

Aucun. `functionalRbac.test.js` + `rbacMandatoryPermissions.test.js` : 31/31. `PermissionsPage.test.tsx` + `rbacLocks.test.ts` : inchangés et verts.

### TESTS EXISTANTS NON IMPACTÉS

Toute la suite `verify:functional-rbac` historique. Cette PR n’ajoute les fichiers RED qu’à `verify:rbac-admin-audit` / `vitest.audit-red.config.ts`. `*.audit.red.test.tsx` est exclu de la suite Vitest CI.

---

## 9. Cause(s) racine(s)

1. **Hydratation scope-exact** — `getConfiguredPermissions` + `PermissionsPage` affichent l’override école, pas la résolution restrictive annoncée par l’écran.
2. **Écriture substitutive fail-closed** — un grant école est un remplacement total du module ; le draft vide transforme « Enregistrer » en DENY.
3. **Pas un oubli d’API** — `PATCH` et `GET .../effective` existent. L’effective n’est pas branché sur l’écran.
4. **Pas P1-06 / P1-07 / P1-08** — ces PRs n’ont pas touché `PermissionsPage` ni le PATCH fonctionnel. P1-07 isole le domaine scolaire Superadmin ; la page utilise ses propres selecteurs `countryCode` / `schoolCode`.
5. **Cadenas #229 (`66496e7b`, 2026-08-17)** — origine des cases locked (invariants + dépendance). Ils n’expliquent pas le rôle métier « vide ».
6. **Naissance du flux actuel : #221 (`42e24a7c`, 2026-08-16)** — remplacement de `PUT /role-permissions` par PATCH scopé. L’ancienne PUT globale *écrivait*, mais n’avait pas de portée école. Ne pas la rétablir.

---

## 10. Risques de sécurité

| Risque | Niveau | Commentaire |
|--------|--------|-------------|
| SCHOOL_ADMIN écrit la matrice globale | Fermé | 403 double (route + `assertSuperAdmin`) |
| Fuite CD → BI / école A → B | Fermé | first-match + IDs distincts (tests VERT) |
| Lock-out SUPER_ADMIN | Fermé | invariants + `ALL_PRIVILEGES` |
| Archive rôles système | Fermé | 403 |
| Superadmin clique Enregistrer | **Ouvert (métier)** | DENY école involontaire : **révocation effective** des droits hérités pour cet établissement. Fail-closed trop agressif côté console, pas un élargissement. |
| Élargir SCHOOL_ADMIN | Interdit dans le correctif | Ne pas le faire |
| Rouvrir PUT JSONB | Interdit | Contournerait le scope école |

---

## 11. Écart avec l’exigence métier

| Exigence | Actuel |
|----------|--------|
| Superadmin administre pays → établissement → rôle métier → module → droits | Chemin UI oui ; paramétrage réel **non** |
| Création / Lecture / Modification / Suppression mutables pour Directeur, Secrétaire, Comptable, Enseignant, … | API oui ; UI hydrate faux-négatif et persist un remplacement |
| Rôles système protégés | Oui pour archive + invariants SUPER_ADMIN ; CRUD COUNTRY/SCHOOL_ADMIN encore patchables (documenté) |
| SCHOOL_ADMIN jamais global | Oui |
| Fail-closed | Oui (runtime). La console le retourne contre Superadmin via DENY école |
| PostgreSQL SoT | SoT live = `role_module_permissions` **résolu**. L’écran montre le scope école brut |

---

## 12. Proposition de découpage du correctif (ne pas implémenter ici)

### PR-1 — Console Superadmin : hydrater l’effectif, écrire un override école sans DENY fantôme (plus petit correctif)

Périmètre unique :

- `getConfiguredPermissions` (ou l’UI) hydrate le draft avec les flags **effectifs** du chemin, tout en distinguant `configured` (ligne école) vs hérité.
- Enregistrer n’écrit un grant école que si le Superadmin a **modifié** le module, et le payload reprend les 4 flags **affichés** (effectif + delta), pas une matrice vide.
- Ne pas toucher `pickGrant`, les invariants, SCHOOL_ADMIN, PUT legacy, le schéma.

C’est le plus petit changement qui permet au SUPER_ADMIN de gérer les rôles métier **sans affaiblir le fail-closed**.

### PR-2 — (optionnel, décision CTO) verrou CRUD COUNTRY_ADMIN / SCHOOL_ADMIN

Si le produit veut interdire tout PATCH sur ces deux rôles, l’ajouter explicitement. Aujourd’hui ce n’est pas un invariant.

### PR-3 — (optionnel) UX « réinitialiser à l’héritage »

Supprimer l’override école pour revenir à pays/global, sans fusion magique.

**Nombre de PR de correctif : 1 obligatoire + 0 à 2 optionnelles. Total livrable correctif : 1 à 3. Cette PR d’audit ne compte pas comme correctif.**

---

## Réponses Q1–Q10

**Q1. Pourquoi les cases sont-elles verrouillées ?**  
Deux règles UI/API : (a) invariant SUPER_ADMIN sur 5 modules ; (b) Lecture locked tant que C/U/D est actif. Sur un rôle métier sans override école, **rien n’est verrouillé** — les cases sont vides. Le constat « je ne peux rien paramétrer » vient de cette vacuité + d’un Enregistrer qui nie les droits réels, pas d’un `disabled` généralisé.

**Q2. Web, backend, ou les deux ?**  
Les cadenas : les deux (UI `rbacLocks` + backend `assertMandatoryPermissionPatch`). Le blocage métier Superadmin : **les deux** — GET configured (backend) + draft/save (Web). PostgreSQL et le moteur savent déjà porter des overrides.

**Q3. Existe-t-il déjà une API d’écriture ?**  
Oui. `PATCH /api/backoffice/rbac/permissions`. `PUT /api/backoffice/role-permissions` est volontairement mort (403).

**Q4. PostgreSQL contient-il les droits configurables ?**  
Oui, dans `role_module_permissions` (CRUD booléens, `scope_type` global/country/school). Plus `establishment_roles` / `user_roles` / `countries` / `schools`. La carte `role_permissions` JSONB n’est plus la SoT d’écriture.

**Q5. Le moteur sait-il résoudre des overrides pays/établissement ?**  
Oui. Tests historiques + RED-07/08 verts. Cascade restrictive, first-match.

**Q6. SUPER_ADMIN a-t-il une capacité d’écriture seulement cachée par l’UI ?**  
Non : l’UI **expose** Enregistrer et appelle PATCH. L’écriture est réelle mais **opère sur le mauvais objet** (override école vide) au lieu de la matrice effective.

**Q7. SCHOOL_ADMIN peut-il modifier des droits ?**  
Non. Ni matrice, ni catalogue de rôles, ni vue Administration. Lecture du catalogue assignable en Paramètres uniquement.

**Q8. Invariants à garder absolument ?**  
SUPER_ADMIN : modules `users`, `role_permissions`, `countries`, `schools`, `education_reference` + `ALL_PRIVILEGES`. Archive interdite des 3 rôles système. C/U/D ⇒ READ. Fail-closed si grant absent. Isolation école/pays. SCHOOL_ADMIN sans écriture globale. PUT JSONB fermé.

**Q9. Plus petit correctif ?**  
Hydrater le draft depuis l’effectif (ou fusionner l’héritage dans GET configured) et n’écrire un grant école que comme delta explicite des 4 flags visibles. Une PR. Sans toucher au moteur fail-closed.

**Q10. Combien de PR de correctif ?**  
**1** pour rétablir le paramétrage Superadmin. **+1** si le CTO verrouille le CRUD COUNTRY/SCHOOL_ADMIN. **+1** si reset d’héritage. Cette PR d’audit reste séparée, Draft/HOLD.

---

## Historique Git (diagnostic uniquement)

| SHA | PR | Rôle dans le diagnostic |
|-----|----|-------------------------|
| `a3b9ea3e` | — | Première `PermissionsPage` (état client) |
| `d148dbd3` | #167 | `PUT /role-permissions` SoT plateforme |
| `42e24a7c` | #221 | Matrice fonctionnelle + PATCH + PUT legacy 403 + chemin pays/école |
| `66496e7b` | #229 | `rbacLocks` / `rbacMandatoryPermissions` (cadenas) |
| `58b026a2` / `7f54790f` | #332 | OCC 409 |
| `986e8590` | — | Réconciliation rôles système (insert-only) |
| `9f8478ae` | #842 P1-02 | Superadmin = rôle canonique |
| `faee2cd1` / `ebc34f92` / `c805b152` | #846–#848 P1-06/07/08 | **Hors** console Rôles et droits |

Ne pas rétablir le legacy PUT parce qu’il « marchait ».

---

## Fichiers de cette PR (audit + tests uniquement)

- `docs/audits/AUDIT-SUPERADMIN-RBAC-RIGHTS.md` (ce rapport)
- `docs/audits/evidence/rbac-admin-audit-results.json`
- `backend/lib/rbacAdminAudit.fixtures.js`
- `backend/lib/rbacAdminAudit.red.test.js`
- `backend/lib/rbacAdminAudit.green.test.js`
- `web/src/pages/PermissionsPage.audit.red.test.tsx`
- `web/src/pages/PermissionsPage.audit.green.test.tsx`
- `web/src/lib/permissions.rbacAdmin.audit.green.test.ts`
- `web/vitest.audit-red.config.ts`
- `web/vitest.config.ts` (exclude `*.audit.red.test.*`)
- `web/package.json` (`test:rbac-admin-audit-red`)
- `scripts/verify-rbac-admin-audit.js`
- `package.json` (`verify:rbac-admin-audit`)
- `backend/lib/administrationCompleteness.red.test.js`
- `backend/lib/administrationCompleteness.green.test.js`
- `web/src/lib/administrationCompleteness.audit.red.test.ts`
- `web/src/lib/administrationCompleteness.audit.green.test.ts`
- `docs/audits/evidence/administration-completeness-matrix.json`

---

## 13. Complément — inventaire fonctionnel Administration

Périmètre des 5 onglets de `AdministrationLayout` (`web/src/pages/administration/AdministrationLayout.tsx:5-11`) :

| Onglet | Route | Composant | `PermissionRoute` |
|--------|-------|-----------|-------------------|
| Relations | `/administration/relations` | `EntityPage entity="relations"` | `view="relations"` |
| Utilisateurs | `/administration/utilisateurs` | `UsersPage` | parent `view="users"` |
| Rôles et droits | `/administration/permissions` | `PermissionsPage` | `view="permissions"` |
| Documents | `/administration/documents` | `EntityPage entity="documents"` | `view="documents"` |
| Conformité | `/administration/conformite` | `ReportsPage` | `view="reports"` |

Les onglets sont **toujours tous affichés**. Aucun filtre `canReadView`. Un Superadmin clique Documents / Conformité et se fait **rediriger** (vues hors `SUPER_ADMIN_ALLOWED_VIEWS`).

Matrice machine : [`docs/audits/evidence/administration-completeness-matrix.json`](./evidence/administration-completeness-matrix.json)

Légende : **A** bout-en-bout · **B** incomplet · **C** façade UI · **D** attendu / absent.

### 13.1 Relations

Nature réelle : **lien parent → élève** (`contact_relations`), pas un CRM plateforme. Le cœur opérationnel est `/etablissement/relations-parent-enfant` (`POST /api/parents/link`, `PATCH /api/parents/relations/:id`).

| Action UI | Rôle | API | Authz | Service | PG | Persist / relecture | Tests | État |
|-----------|------|-----|-------|---------|-----|---------------------|-------|------|
| Liste | Superadmin : vue OK | `GET /backoffice/relations` | `Relations:READ` **puis** deny `platformPersonalDataGuard.js:182` | `listClientsProjection` | `contact_relations` | GET 403 plateforme | RED-ADM-REL | **D** Superadmin / **A** école |
| Créer | Superadmin UI CREATE | `POST /backoffice/relations` | CREATE + deny plateforme | `createRelation` → `ensureActiveParentRelation` | `contact_relations` | 403 plateforme | RED-ADM-REL | **D** / **A** |
| Modifier | Bouton UPDATE | même POST | — | create idempotent | même | pas de PATCH | — | **B** |
| Supprimer | Bouton DELETE | **aucune** | — | `deleteEntityFromState` | **non** | refresh recharge l’ancien GET | RED-ADM-REL-DELETE | **C** |
| Hydratation admin | — | — | — | `routeDomainMap` n’a **pas** `/administration/relations` | — | liste potentiellement vide même hors deny | RED-ADM-REL | **B** |

`clientsApi` : `listRelations` + `createRelation` seulement (`clientsApi.ts:78-79`).

### 13.2 Utilisateurs

Chaîne démontrée pour le Superadmin **sur le catalogue plateforme** (Admin Pays / Admin School uniquement).

| Action | SUPERADMIN | SCHOOL_ADMIN | API | PG | Persist + relecture | Tests | État |
|--------|------------|--------------|-----|----|---------------------|-------|------|
| Consulter | Oui (filtre `isSuperadminManagedUser`) | Oui sur son école | `GET /backoffice/users` | `users`, `user_roles` | `ensureDomains` + refresh | UsersPage.schoolAdminScope | **A** |
| Créer | Provision COUNTRY/SCHOOL_ADMIN | create / create-teacher | `POST .../provision` / `.../users` / `.../create-teacher` | `users`, `user_roles`, `teachers` | `refresh(["users"])` | superadminCreateCountry | **A** |
| Modifier identité | Cibles plateforme | Même établissement | `PATCH /users/:id` | `users` | refresh | editTenantReadonly | **A** |
| Valider / refuser pending | Oui | Non | PATCH status | `users` | refresh | verify-admin-user-creation | **A** / **D** |
| Suspendre / réactiver | Oui | Si SUSPEND | PATCH | `users` | refresh | — | **A** |
| Attribuer rôles | Plateforme | Rôles établissement | grant/revoke | `user_roles` | refresh | userRoleLifecycle | **A** |
| Réaffecter établissement | Oui (pas COUNTRY_ADMIN) | Non | `POST .../reassign-school` | `users`, `user_roles`, `sessions` | refresh | editTenantReadonly | **A** / **D** |
| Reset mot de passe | Oui | Si UPDATE | `POST /api/users/:id/reset-password` | `users`, `sessions`, `login_lockouts` | persist **A** ; UI sans refresh | productionRbac | **B** |
| Créer SUPER_ADMIN | Interdit | Interdit | provision allowlist | — | — | clientsService | **D** protégé |
| CSV / print | Client | Client | — | — | — | — | **C** |

Protections Superadmin : pas dans la liste mutuelle ; pas de provision SUPER_ADMIN ; `canManageUserAccount` limité à COUNTRY_ADMIN / SCHOOL_ADMIN.

### 13.3 Rôles

Onglet **Rôles** de `PermissionsPage` (pas un 6ᵉ onglet).

| Action | SUPERADMIN | SCHOOL_ADMIN | API | PG | Relecture | État |
|--------|------------|--------------|-----|----|-----------|------|
| Catalogue | Oui | 403 ; Paramètres lecture assignable | `GET /rbac/catalog` | `establishment_roles` | getCatalog | **A** |
| Créer rôle métier | Oui | Non | `POST /rbac/roles` | `establishment_roles` | refreshCatalog | **A** |
| Modifier libellé | API oui, **UI non** | Non | `PATCH /rbac/roles/:id` | même | — | **B** |
| Archiver / réactiver | Oui si non protégé | Non | archive / PATCH status | `system_protected` | refreshCatalog | **A** |
| Rôles système | Affichés « Protégé » | — | `assertNotProtectedArchive` | — | — | **A** |

### 13.4 Droits

Diagnostic #851 inchangé.

| Action | SUPERADMIN | SCHOOL_ADMIN | API | PG | État |
|--------|------------|--------------|-----|----|------|
| CRUD par module | Selecteurs + PATCH ; hydratation école vide | Fermé | GET+PATCH `/rbac/permissions` | `role_module_permissions` | **B** |
| Héritage global/pays/école | Texte UI ; moteur oui ; écran non | — | GET `.../effective` non branché | même | **D** dans l’UI |
| Overrides | Écrits trop facilement (DENY) | — | PATCH school | même | **B** dangereux |
| Reset override | **Absent** | — | pas d’endpoint | — | **D** |
| Audit mutations | Écrit `audit_logs` | — | pas d’écran Administration | `audit_logs` | **B** |

### 13.5 Documents

`/parametres/documents` = **gabarits bulletins** (`bulletinDesign`). Hors cet inventaire.

`/administration/documents` = métadonnées `school_documents` (attestations).

| Action | SUPERADMIN | SCHOOL_ADMIN | API | PG | Persist | État |
|--------|------------|--------------|-----|----|---------|------|
| Ouvrir l’onglet | **Deny** `documents` ∉ allowed views | Si `Documents:READ` | — | — | — | **D** Superadmin |
| Liste | Inaccessible | `GET /school-documents` | deny plateforme si appelé en Superadmin | `school_documents` | GET | **A** école |
| Ajout / modification | — | POST / PATCH | `documentsExamsService` | même | refresh | **A** école |
| Archivage | — | `POST .../archive` | — | `status=archived` | refresh | **A** école |
| Upload / download | **Absent** | **Absent** | pas dans `schoolDocumentsApi` | `storage_key` non exposé | — | **D** |

Champs UI : `studentName`, `documentType`, `title`, `format`, `status`, `generatedAt` — pas de fichier.

### 13.6 Conformité

Pas un workflow de conformité.

`ReportsPage` rend `MVP_COVERAGE` (`constants.ts`) : tableau statique « Couvert / P0 ». **Aucune API, aucune table, aucune relecture.**

APIs existantes **non branchées** : `GET /api/audit` (lui-même deny plateforme pour Superadmin, `platformPersonalDataGuard.js:213` + commentaire `server.js:3952-3953`), `GET /api/v2/reports/advanced`, `privacy/erasure-requests`.

| Action | SUPERADMIN | SCHOOL_ADMIN | API | PG | État |
|--------|------------|--------------|-----|----|------|
| Voir la table MVP | Deny vue `reports` | Si `Rapports:READ` | — | — | **C** / **D** Superadmin |
| Imprimer | — | PrintButton | — | — | **C** |
| Journal / workflow / historique | Absent de la page | Absent | APIs orphelines ici | `audit_logs` ailleurs | **D** |

---

## 14. Matrice finale

| FONCTION | SUPERADMIN | SCHOOL_ADMIN | UI | API | DB | TEST | ÉTAT | MANQUANT |
|----------|------------|--------------|----|-----|----|------|------|----------|
| Nav onglets Administration | 5 onglets non filtrés | Accès parent si users READ | Layout | — | — | green completeness | **C** | Filtrer les onglets |
| Relations liste/création | Vue OK, API 403 | Chaîne PG si jeton | EntityPage | GET/POST relations | `contact_relations` | RED-ADM-REL | **D** / **A** | Débloquer ou retirer |
| Relations update | POST create | POST create | EntityPage | pas de PATCH | même | — | **B** | PATCH |
| Relations delete | Local | Local | EntityPage | — | non | RED-ADM-REL-DELETE | **C** | Archive persistée |
| Users consulter/créer/éditer | Plateforme A | École A | UsersPage | backoffice/users | `users` | UsersPage.* | **A** | — |
| Users valider pending | A | D | UsersPage | PATCH | `users` | verify-admin | **A** / **D** | — |
| Users rôles | A | A établissement | UsersPage | grant/revoke | `user_roles` | lifecycle | **A** | — |
| Users réaffecter | A | D | UsersPage | reassign-school | users+roles+sessions | editTenant | **A** / **D** | — |
| Users reset MDP | B | B | UsersPage | reset-password | users+sessions | productionRbac | **B** | refresh UI |
| Users CSV | C | C | UsersPage | — | — | — | **C** | — |
| Rôles catalogue/création/archive | A | D (Paramètres RO) | PermissionsPage | /rbac/roles | `establishment_roles` | functional-rbac | **A** | — |
| Rôles modifier libellé | B | D | — | PATCH existe | même | — | **B** | UI |
| Droits CRUD console | B | D | PermissionsPage | PATCH permissions | `role_module_permissions` | RED-01..04 | **B** | Hydratation effective |
| Droits effective / reset | D | D | — | GET effective only | même | RED-ADM-DROITS-RESET | **D** | UI + reset |
| Documents CRUD meta | D | A | EntityPage | school-documents | `school_documents` | RED-ADM-DOC | **D** / **A** | Accès Superadmin |
| Documents fichier | D | D | — | — | storage_key | RED-ADM-DOC | **D** | Upload/download |
| Conformité MVP | D | C | ReportsPage | — | — | RED-ADM-CONF | **C** / **D** | Retirer ou brancher |
| Conformité audit/workflow | D | D | — | audit / advanced / erasure | audit_logs | RED-ADM-CONF | **D** | Écran réel |

---

## 15. BACKLOG ADMINISTRATION À COMPLÉTER

Uniquement ce qui est **manquant ou incomplet** (constaté). Pas d’implémentation ici.

1. **Droits — hydrater l’effectif et interdire le DENY fantôme** (PR-1 déjà proposée). État B dangereux.
2. **Droits — afficher l’héritage et reset d’override école** (GET effective existe ; reset absent). État D.
3. **Droits — consulter l’audit des PATCH** (`audit_logs` écrits, pas d’UI Administration). État B.
4. **Rôles — UI de modification de libellé** (PATCH API déjà là). État B.
5. **Relations Administration — chaîne Superadmin cassée** (vue ouverte, API 403 + pas de domaine de hydrate). État D. Décision : retirer l’onglet plateforme **ou** ouvrir un mode non perso-élève.
6. **Relations — suppression persistée** sur cet écran (archive parents existe ailleurs). État C.
7. **Relations — vrai update** (aujourd’hui POST create). État B.
8. **Documents Administration — onglet visible, route Superadmin fermée.** État D. Retirer l’onglet ou autoriser une lecture plateforme non perso.
9. **Documents — upload / téléchargement** (`storage_key` non exposé). État D.
10. **Conformité — façade `MVP_COVERAGE`.** État C. Brancher `GET /api/audit` / rapports / erasure **ou** retirer l’onglet.
11. **Conformité Superadmin** — vue `reports` interdite + `GET /api/audit` deny plateforme. État D.
12. **Layout — filtrer les onglets** selon `canReadView` (Documents/Conformité actuellement cliquables puis redirigés). État C.
13. **Users — refresh après reset mot de passe.** État B.

Ne pas lancer PR-1 RBAC en croyant Documents / Relations / Conformité opérationnels pour le Superadmin : **ils ne le sont pas**.

---

## 16. Nouveaux tests (complément)

| Fichier | Couleur | Contenu |
|---------|---------|---------|
| `backend/lib/administrationCompleteness.red.test.js` | RED | Relations/Documents non deny ; Conformité persistée ; DELETE relations ; reset droits |
| `backend/lib/administrationCompleteness.green.test.js` | GREEN | APIs users/rbac présentes ; deny actuel documenté ; tables réelles |
| `web/src/lib/administrationCompleteness.audit.red.test.ts` | RED | Superadmin documents/reports ; hydrate relations ; reset/effective UI ; tabs filtrés |
| `web/src/lib/administrationCompleteness.audit.green.test.ts` | GREEN | 5 onglets ; faits d’accès ; ReportsPage statique ; clients sans deleteRelation |

Les RED Droits #851 (RED-01..04) restent rouges. Aucun verdissement artificiel.

**STOP.** Pas de correctif. Pas de Ready. Pas de Merge. Attendre nouveau diff CTO depuis `38b3d96b`.
