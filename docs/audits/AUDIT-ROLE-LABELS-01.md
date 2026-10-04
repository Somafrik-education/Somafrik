# AUDIT-ROLE-LABELS-01 — Libellés visibles des rôles (Web + Mobile)

**Statut : DRAFT / HOLD — PAS READY — PAS MERGE**

**Contrôle CTO GitHub : PASS** (HEAD `72e97d30`, base `develop@be63efa6`). CI **38/38** y compris PR Gates et Communications C4.

**Type : AUDIT ONLY** — aucun changement produit, aucune mutation `display_label` persistée hors stores mémoire de test.

Base obligatoire : `develop@be63efa6948c5baaa468408157be7f56d6398c30` (merge #869)

Preuves machine : `docs/audits/evidence/role-label-surfaces.json`  
Tests : `backend/lib/auditRoleLabels01.audit.test.js` · `web/src/lib/auditRoleLabels01.audit.test.ts` · `Mobile/src/lib/auditRoleLabels01.audit.test.ts`

---

## Décision

**OPTION B** — ADMIN-02B existe et est **complet côté backend / contrat / sécurité**.  
La **propagation Web/Mobile est incomplète**. Des surfaces majeures affichent encore le libellé canonique (`role_name` / `user.role` / cartes hard-codées) au lieu de `effectiveLabel`.

ADMIN-02B n’est **pas INCOHÉRENT** sur l’autorité : `display_label` n’entre pas dans JWT, `toRoleKey`, permissions, route guards.  
ADMIN-02B n’est **pas COMPLET** sur les interfaces réellement visibles.

Aucun **P0**. Bootstrap **n’écrase pas** `display_label` (pas un blocker). Country / School Admin **ne peuvent pas** écrire le libellé (403).

### Contrat produit figé par le CTO

Fallbacks tant que Superadmin n’a pas personnalisé :

| roleKey | defaultLabel (immuable comme fallback) |
|---|---|
| SCHOOL_ADMIN | **Admin School** |
| STUDENT | **Élève / Étudiant** |
| TEACHER | **Enseignant** |

`SCHOOL_ADMIN → Directeur`, `STUDENT → Étudiant`, `TEACHER → Professeur` changent **uniquement** `effectiveLabel`. Jamais `roleKey`, JWT, permissions, guards.

Collision visuelle **acceptée** : `SCHOOL_ADMIN.displayLabel = "Directeur"` alors que `toRoleKey("Directeur") = PRINCIPAL`. Acceptable **uniquement** parce que les libellés visibles ne sont **jamais** reconvertis en rôle technique.

---

## 1. Architecture actuelle ADMIN-02B

Socle déjà livré (#861). Cet audit **ne reconstruit pas** le système.

| Couche | Fichier | Rôle |
|---|---|---|
| Contrat unique | `backend/lib/roleDisplayLabels.js` | `normalizeDisplayLabel` · `resolveEffectiveRoleLabel` · `applyRoleDisplayContract` · `decorateUserWithRoleDisplay` |
| Web | `web/src/lib/roleDisplayLabels.ts` | `visibleRoleLabel` / `resolveEffectiveRoleLabel` |
| Mobile | `Mobile/src/lib/roleDisplayLabels.ts` | Identique Web — **sous-utilisé** |
| Service | `establishmentRolesService.js` | `updateRoleDisplayLabel` · `resetRoleDisplayLabel` · `listRoleDisplayLabels` |
| Store PG | `establishmentRolesPgStore.js` | `UPDATE display_label = $2` (NULL autorisé) |
| Index users | `clientsPgStore.loadRoleDisplayIndex` | Décoration `effectiveRoleLabel` sur listes users |

Contrat :

```
effectiveLabel =
  trim(display_label) non vide
  SINON
  defaultLabel (= role_name)
```

`""` et whitespace → `normalizeDisplayLabel` → `NULL`.  
Aucun fallback sur `roleKey` technique si un `role_name` existe.

**Ne jamais** passer `displayLabel` / `effectiveLabel` à `toRoleKey`.

---

## 2. Modèle DB

```sql
-- backend/db/migrations/20261001_establishment_roles_display_label.sql
ALTER TABLE establishment_roles
  ADD COLUMN IF NOT EXISTS display_label TEXT;
```

- **Nullable.** Pas de UNIQUE (deux rôles peuvent afficher « Directeur »).
- Fresh schema aligné : `establishmentRolesSchema.js`.
- `users.role` et `user_roles.role_key` **n’ont pas** de `display_label`.
- Reset : `display_label = NULL` persisté (PG-DL-04).
- Redémarrage backend : valeur lue en SQL, pas en mémoire process.

---

## 3. Endpoints

| Méthode | Route | Écriture | Lecture |
|---|---|---|---|
| GET | `/api/backoffice/rbac/role-display-labels` | — | Catalogue `roleKey / defaultLabel / displayLabel / effectiveLabel` |
| PATCH | `/api/backoffice/rbac/roles/:roleId/display-label` | `{ displayLabel }` | Rôle décoré |
| POST | `/api/backoffice/rbac/roles/:roleId/display-label/reset` | NULL | Rôle décoré |
| GET | `/api/backoffice/rbac/catalog` | Superadmin | Rôles + contrat display |
| GET | `/api/backoffice/establishment-roles` | — | `mapRoleRow` + contrat |
| GET | `/api/establishment-roles/assignable` | — | Sous-ensemble affectable |

Écritures : route permission **`ALL_PRIVILEGES` uniquement** + `assertSuperAdmin` dans le service (403 identité, pas seulement masquage UI).

`listRoleDisplayLabels` Web (`rbacApi.ts`) **n’est appelé nulle part** hors définition.

---

## 4. Sécurité / autorité

Seul **SUPER_ADMIN** peut modifier ou reset.  
Refusés (403 service + RBAC route) : COUNTRY_ADMIN, SCHOOL_ADMIN, TEACHER, et tout autre rôle métier.

`updateRoleDisplayLabel` **ne passe pas** par `assertNotProtectedMutation`.  
Donc Superadmin **peut** personnaliser l’affichage de `SCHOOL_ADMIN` (et même `SUPER_ADMIN`) **sans** renommer `role_code` / `role_name`.

Rename ADMIN-02 de `SCHOOL_ADMIN` reste **403 ROLE_PROTECTED**.

Preuve obligatoire (mémoire, pas de prod) :

| | SCHOOL_ADMIN | STUDENT | TEACHER |
|---|---|---|---|
| defaultLabel | Admin School | Élève / Étudiant | Enseignant |
| displayLabel | Directeur | Étudiant | Professeur |
| effectiveLabel | Directeur | Étudiant | Professeur |
| `toRoleKey` | **SCHOOL_ADMIN** | **STUDENT** | **TEACHER** |

Collision acceptée : `SCHOOL_ADMIN.display_label = "Directeur"` et `PRINCIPAL.role_name = "Directeur"`.  
`toRoleKey("Directeur")` = **PRINCIPAL**, jamais SCHOOL_ADMIN.

---

## 5. Inventaire des rôles (catalogue réel)

Source : `backend/lib/canonicalSystemRoles.js` + `ROLE_TO_DB`.  
**Aucun rôle inventé.** Seed = ces 12 rôles. Des rôles métier custom peuvent exister en base via ADMIN-02 ; ils ne sont pas dans le seed.

| roleKey | roleCode | roleName = defaultLabel | scope | systemProtected | schoolAssignable |
|---|---|---|---|---|---|
| SUPER_ADMIN | SUPER_ADMIN | Super Administrateur Somafrik | platform | oui | non |
| COUNTRY_ADMIN | COUNTRY_ADMIN | Admin Pays | country | oui | non |
| SCHOOL_ADMIN | SCHOOL_ADMIN | Admin School | school | oui | non |
| PROVISEUR | PROVISEUR | Proviseur | school | non | oui |
| PREFET_ETUDES | PREFET_ETUDES | Préfet des études | school | non | oui |
| PRINCIPAL | PRINCIPAL | Directeur | school | non | oui |
| SECRETARY | SECRETARY | Secrétaire | school | non | oui |
| TEACHER | TEACHER | Enseignant | school | non | oui |
| PARENT | PARENT | Parent | school | non | non |
| STUDENT | STUDENT | Élève / Étudiant | school | non | non |
| ACCOUNTANT | ACCOUNTANT | Comptable | school | non | oui |
| SUPERVISOR | SUPERVISOR | Surveillant | school | non | oui |

`displayLabel` / `effectiveLabel` : runtime (`NULL` → default).  
Alias Mobile `ADJOINT` : **hors catalogue seed** (carte historique locale uniquement).

---

## 6. Inventaire Web

| Surface | Fichier | Champ utilisé | Verdict |
|---|---|---|---|
| Topbar | `Topbar.tsx` | `displayRoleName(visibleRoleLabel(user) \|\| user.role)` | **PARTIEL** — helper OK, puis remap `ROLE_LABELS` |
| Menu utilisateur | — | pas de menu rôle dédié | HORS SCOPE |
| Recherche | `GlobalSearch.tsx` | idem Topbar | **PARTIEL** |
| Session / « profil » | `SecuritySettingsPage.tsx` | `user.role` brut | **KO** |
| Users table / détail / CSV | `UsersPage.tsx` + `formatAccessRolesDisplay` | `effectiveRoleLabel` si présent, sinon `role` / `roles` / `roleKeys` | **PARTIEL** |
| Users filtre / création | `UsersPage.tsx` | `user.role`, `creatableRoles` comme label | **KO** |
| Users attribuer | `UsersPage.tsx` | `role.roleName` | **KO** |
| Compte élève | `userAccounts.ts` | `STUDENT_ACCESS_ROLE_LABEL = "Élève / Étudiant"` | **HARDCODED A** |
| Permissions onglet Rôles | `PermissionsPage.tsx` | roleCode / default / display / effective | **OK** |
| Permissions sélecteur + bandeau | `PermissionsPage.tsx` | `effectiveLabel (roleCode)` | **OK** |
| Restaurer le défaut | `PermissionsPage.tsx` | `resetRoleDisplayLabel` | **OK** |
| Configuration affectables | `ConfigurationPage.tsx` | `displayRoleName(effectiveLabel)` | **PARTIEL** |
| Messages destinataires | `MessagesConversationsPage.tsx` | `user.roleLabel` | **KO** |
| Conformité privacy | `SchoolComplianceDashboard.tsx` | `row.roleLabel` | **KO** |
| Historique RBAC | `PermissionsPage.tsx` | `item.role` serveur | **PARTIEL** |
| Contacts « Type » | `entityModules.ts` | Directeur / Secrétaire / Enseignant | **B** métier |
| Login démo | `LoginPage.tsx` / `demoAccounts.ts` | `account.role` | **C** / HORS SCOPE |
| HelpHost | `HelpHost.tsx` | `user.role` clé contexte | HORS SCOPE (pas un libellé humain catalogue) |
| `listRoleDisplayLabels()` | `rbacApi.ts` | jamais appelé | **NON BRANCHÉ** |

---

## 7. Inventaire Mobile

| Surface | Fichier | Champ | Verdict |
|---|---|---|---|
| Drawer | `RoleNavigationDrawer.tsx` | `visibleRoleLabel` **puis** `identity.roleLabel` **puis** `ROLE_LABELS` hard-codé | **KO** |
| Header | `MobileAppHeader.tsx` | école seulement | HORS SCOPE |
| Accueil | `roleHomeConfig.ts` | « Espace enseignant / directeur… » | **B** (espace, pas le rôle user) |
| Login | `LoginScreen.tsx` | `identify.roleLabel` | **PARTIEL** — `authService.managedMobileRoles` hard-code (« Admin Établissement », « Élève ») |
| Users | `UsersScreen.tsx` | `displayRoleName(formatAccessRolesDisplay)` | **KO** |
| `normalizeUser` | `canonicalResourceNormalize.ts` | **ne mappe pas** `effectiveRoleLabel` | **NON BRANCHÉ** |
| Identité session | `canonicalRoleIdentity.ts` | `ROLE_KEY_LABELS` ; **écrase** `user.role` | **KO / HARDCODED A** |
| Profil parent | `ParentProfileScreen.tsx` | « Espace parent » | **B** |
| Enseignants / élèves listes | screens métier | pas de colonne rôle d’accès | HORS SCOPE |
| Modal attribuer | `UserMutationControls.tsx` | `role.roleName` | **KO** |
| Multi-rôle session | — | aucun sélecteur | **KO** (affiche `roleKeys[0]` via carte) |
| Effective permissions refresh | `getEffectivePermissions` | permissions + roleKeys only | **NON BRANCHÉ** |

---

## 8. Hard-coded restant (classé)

**A — rôle utilisateur dynamique (doit suivre effectiveLabel)**

- Web `format.ts` `ROLE_LABELS` (`admin school` → « Administrateur d’établissement ») appliqué **après** `visibleRoleLabel` → un `display_label = "Directeur"` peut être **réécrit**.
- Web `STUDENT_ACCESS_ROLE_LABEL = "Élève / Étudiant"`.
- Mobile `RoleNavigationDrawer.ROLE_LABELS` (`school_admin` → « Admin établissement », `student` → « Élève »).
- Mobile `canonicalRoleIdentity.ROLE_KEY_LABELS` (`SCHOOL_ADMIN` → « Admin School », `TEACHER` → « Enseignant »).
- Mobile `format.displayRoleName` (même famille).
- Backend `authService.managedMobileRoles` : `Admin School` → « Admin Établissement » ; `Élève / Étudiant` → « Élève ». **Ignore `display_label`.**

**B — texte métier générique (peut rester)**

- Titres « Enseignants », « Élèves », « Espace parent », audiences annonces, `CONTACT_TYPES`, `spaceLabel` home.

**C — tests / fixtures** — nombreux `*.test.*`, `demoAccounts`, `Mobile/src/data/catalog.ts`.

**D — documentation** — `docs/audits/ADMIN-02B-role-display-labels.md` et ce document.

Ne pas remplacer aveuglément les chaînes.

---

## 9. Multi-rôle

Stockage : `user_roles.role_key` (plusieurs lignes actives).  
DTO user : `role` = label canonique du **primaire** ; `roles` / `roleKeys` = tous les tokens **canoniques**.  
`effectiveRoleLabel` : **un seul** champ, primaire uniquement. **Pas** de `effectiveLabels[]`.

Exemple attendu produit :

- TEACHER → Professeur + SCHOOL_ADMIN → Directeur  
- UI devrait montrer « Professeur · Directeur »  
- Autorité : `TEACHER` + `SCHOOL_ADMIN`, jamais `toRoleKey("Professeur")`.

État actuel : Web `formatAccessRolesDisplay` n’affiche qu’**un** `effectiveRoleLabel` (primaire) puis retombe sur `roles` canoniques. Mobile idem + remap `displayRoleName`. Aucun picker de session multi-rôle.

---

## 10. Cache / synchronisation

| Store | Contient display_label ? | Conséquence |
|---|---|---|
| JWT access / refresh | **Non** | Changement de libellé ≠ nouvelle identité |
| AuthContext Web | user API tel quel ; **pas** de refresh `role-display-labels` | Topbar OK seulement si login a déjà `effectiveRoleLabel` |
| DataContext | clé cache = `user.role` canonique | HORS SCOPE identité |
| Mobile SecureStore session | `role` / `roleKeys` / user blob **sans** champ dédié | Drawer reste sur carte hard-codée |
| Mobile permissions snapshot | permissions + roleKeys | Refresh foreground **ne met pas à jour** le libellé |
| SQLite L1 | users **non** cachés L1 | Liste users = réseau, mais `normalizeUser` jette le champ |

**Déconnexion / reconnexion** aujourd’hui : **insuffisante** sur Mobile (identité recalculée depuis `roleKeys`). Sur Web : refresh page suffit **si** `GET /backoffice/users` et login hydratent encore `effectiveRoleLabel` (PG oui, memory store non).

---

## 11. Bootstrap / reconciliation

`systemRolesReconciliation.reconcileEstablishmentCatalog` :

- rôle manquant → `insertRole` **sans** `display_label` ;
- rôle existant → `addMissingPermissions` / délégations **uniquement** ;
- **aucun UPDATE** de `role_name` ni `display_label`.

`ensureFunctionalRbacBootstrap` touche `system_protected` / `school_assignable`, pas le libellé.

**Scénario 1–4 (Directeur → reconcile → relire) : PASS en code.** Pas un BLOCKER.

---

## 12. Audit log

Actions : `ROLE_DISPLAY_LABEL_UPDATE` · `ROLE_DISPLAY_LABEL_RESET`.

Payload : `actor` + `roleKey` + `oldDisplayLabel` + `newDisplayLabel`. Horodatage `audit_logs.created_at`. Pas de JWT / secret.

Reset n’est pas silencieux.

---

## 13. Matrice de couverture

| Surface | Plateforme | Rôle affiché | Source actuelle | Attendue | Verdict |
|---|---|---|---|---|---|
| Topbar | Web | session | `visibleRoleLabel` + `displayRoleName` | effectiveRoleLabel | PARTIEL |
| Session sécurité | Web | session | `user.role` | effectiveRoleLabel | KO |
| UsersPage table | Web | users | `effectiveRoleLabel` si API | effectiveRoleLabel | PARTIEL |
| UsersPage sélecteurs | Web | create/filter/assign | `role` / `roleName` | effectiveLabel | KO |
| PermissionsPage rôles | Web | catalogue | contrat 4 colonnes | contrat 4 colonnes | OK |
| PermissionsPage matrice | Web | sélecteur | effectiveLabel | effectiveLabel | OK |
| Configuration | Web | affectables | effectiveLabel + displayRoleName | effectiveLabel | PARTIEL |
| Messages | Web | destinataire | roleLabel | effectiveRoleLabel | KO |
| Drawer | Mobile | session | ROLE_KEY_LABELS / ROLE_LABELS | effectiveRoleLabel | KO |
| Users Mobile | Mobile | liste | role + displayRoleName | effectiveRoleLabel | KO |
| Login identify | Mobile | pré-auth | managedMobileRoles | effectiveLabel | PARTIEL |
| Profil / header / home | Mobile | — | espace métier | n/a | HORS SCOPE |
| Multi-rôle | Web+Mobile | primaire only | canonique | labels distincts | KO |

Aucune conclusion « complet » : la matrice n’est pas verte.

---

## 14. Écarts classés

| ID | Sévérité | Écart |
|---|---|---|
| — | **P0** | **Aucun.** `display_label` n’influence pas RBAC / JWT / `toRoleKey`. |
| GAP-WEB-SESSION | **P1** | `SecuritySettingsPage` affiche `user.role` canonique. |
| GAP-WEB-SELECTORS | **P1** | UsersPage filtre / création / attribution ignorent `effectiveLabel`. |
| GAP-WEB-REMAP | **P1** | `displayRoleName` peut réécrire un effectiveLabel personnalisé. |
| GAP-MOBILE-DRAWER | **P1** | Drawer : cartes hard-codées dominent (`visibleRoleLabel` rarement peuplé). |
| GAP-MOBILE-USERS | **P1** | `normalizeUser` drop `effectiveRoleLabel` ; `displayRoleName` remap. |
| GAP-IDENTIFY | **P1** | `/identify` / `managedMobileRoles` hard-code, ignore catalogue. |
| — | P1 bootstrap | **Non applicable** (pas d’écrasement). |
| — | P1 Country/School write | **Non applicable** (403). |
| GAP-MULTI | **P2** | Un seul `effectiveRoleLabel` ; pas de liste par rôle. |
| GAP-CACHE | **P2** | Mobile : refresh permissions insuffisant ; relogin insuffisant. |
| GAP-API-MSG | **P2** | Messages / compliance `roleLabel` non décoré. |
| GAP-LIST-API | **P2** | `GET role-display-labels` non consommé Web. |
| GAP-UX | **P3** | Table Superadmin déjà claire ; collision visuelle SCHOOL_ADMIN/PRINCIPAL « Directeur » à expliquer. |

---

## 15. Recommandations (ne pas implémenter ici)

1. Garder ADMIN-02B tel quel comme **autorité d’écriture** (SUPER_ADMIN, colonne nullable, reset NULL, audit).
2. Propager **uniquement** `effectiveRoleLabel` / `effectiveLabel` à l’affichage. Interdire `displayRoleName` / `ROLE_KEY_LABELS` **après** résolution catalogue.
3. Hydrater Mobile : `normalizeUser` + session + identify.
4. Multi-rôle : exposer `effectiveLabels: [{ roleKey, effectiveLabel }]` (DTO), sans toucher JWT.
5. Ne pas mettre le libellé dans `JWT.role`.

---

## 16. Découpage PR éventuel (OPTION B)

Périmètre inchangé. **Ordre d’exécution figé par le CTO** : l’API fournit le contrat avant que les clients cessent leurs remaps locaux.

| Ordre | PR | Objet | Sévérité |
|---|---|---|---|
| **1** | **ROLE-LABELS-API-01** | `/identify` + DTO users/messages + multi-rôle `effectiveLabels[]` ; contrat `roleKey / defaultLabel / displayLabel / effectiveRoleLabel` | P1 / P2 |
| **2** | **ROLE-LABELS-WEB-01** | Topbar / GlobalSearch sans remap ; SecuritySettings ; UsersPage filtre/création/attribution via catalogue `effectiveLabel` | P1 |
| **3** | **ROLE-LABELS-MOBILE-01** | Conserver `effectiveRoleLabel` dans `normalizeUser` + session ; drawer / Users sans carte hard-codée comme autorité | P1 |

Pas de migration. Pas de changement `roleKey`. Pas de JWT.  
Ne pas démarrer API-01 tant que #871 n’est pas clos.

---

## 17. UX Superadmin (onglet Rôles)

La table actuelle est **suffisamment claire** :

| Rôle technique | Libellé par défaut | Libellé affiché | Libellé effectif |
|---|---|---|---|
| SCHOOL_ADMIN | Admin School | Directeur | Directeur |

« Restaurer le défaut » → `display_label NULL` → effectif = **Admin School** (libellé actuel seed, pas « Admin établissement »).

Point P3 : le default seed est **« Admin School »** (anglais produit historique), alors que Mobile identify affiche déjà « Admin Établissement » — deux défauts visuels divergents **sans** `display_label`.

---

## 18. API / DTO — qui a assez d’info ?

| Endpoint | `effectiveRoleLabel` / contrat ? |
|---|---|
| GET `/backoffice/users` (PG) | **Oui** via `decorateUserWithRoleDisplay` |
| Mutations users PG | **Oui** (`mapUserRow`) |
| GET `/backoffice/rbac/catalog` | **Oui** (rôles) |
| GET `role-display-labels` | **Oui** — sous-consommé |
| Login `user` JSON | **Parfois** (si user déjà décoré) — **pas dans le JWT** |
| `/identify` `roleLabel` | **Non** — carte `managedMobileRoles` |
| Messages participants | **Non** — `role` / `role_label` canonique |
| Effective-permissions | **Non** — permissions + roleKeys |
| Memory/fallback users | **Non** — pas d’index catalogue |

Contrat canonique recommandé (déjà le contrat rôles) :

`roleKey` · `defaultLabel` · `displayLabel` · `effectiveRoleLabel`

Ne pas corriger dans cet audit.

---

## 19. Authentification / JWT

`buildPrincipal` : `toRoleKey(rawRole)` / `user.roleKeys.map(toRoleKey)` uniquement.  
Access token = principal (`role`, `roles`, `roleKeys`, `permissions`) — **pas** `displayLabel`.  
Refresh : subset `sub / role / schoolCode / …` — **pas** de libellé display.

**INTERDIT respecté aujourd’hui** : JWT `role` n’est jamais `"Directeur"` comme nouvelle identité SCHOOL_ADMIN.

---

## 20. Tests RL-01 → RL-25

Voir fichiers d’audit. Ils **documentent l’état actuel** (y compris les écarts), sans corriger le produit.

---

## Verdict

```
OPTION B — confirmée CTO
ADMIN-02B existe mais la propagation Web/Mobile est incomplète.
Séquence après clôture #871 : ROLE-LABELS-API-01 → ROLE-LABELS-WEB-01 → ROLE-LABELS-MOBILE-01.
```

STOP. DRAFT / HOLD. PAS READY. PAS MERGE.
