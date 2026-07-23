# Audit — D3.4 Parents / Responsables (métier)

**Lot :** D3.4a — Audit et verrouillage du périmètre  
**Statut :** descriptif — **aucun changement de code applicatif**  
**Module :** Parents / Responsables (surfaces établissement + fiche Élève)  
**Date :** 2026-07-23  
**Base de revue :** `develop` @ `045ef54e` (tags `d2.8e`, `d3.2a`)  
**Référence DS :** Design System Somafrik (`@/design-system`)  
**Prérequis clos :** D2.8 (EntityPage) · D3.1 / D3.1b (Élèves) · D3.2 / D3.2a–c (Classes) · D3.3 (Enseignants liste)

**Numérotation :** le jalon produit « prochain bloc métier Parents » est officiellement **D3.4**.  
**D3.3** désigne déjà la **liste Enseignants** ([RAPPORT-D3.3-enseignants.md](./RAPPORT-D3.3-enseignants.md)).  
Ne pas réutiliser « D3.3 Parents » dans le suivi DS.

**Hors périmètre explicite :** Présences, Notes / Évaluations / Bulletins, Finance / paiements familiaux, Communications familles, Fiche Classe, réouverture D2.8 / EntityPage infra, inventaire d’une fiche Parent produit sans décision, refactor Mobile parent consumer (hors audit admin)

---

## 1. Synthèse exécutive

| Constat | Détail (post-`d3.2a`) |
|---------|------------------------|
| **Liste « Parents » dédiée** | **Absente** — pas de `ParentsListPage` / entité `parents` |
| **Surface admin actuelle** | `ParentChildRelationsPage` → `EntityPage entity="relations" mode="parentChildRelations"` (onglet **Parents & élèves**) |
| **Workflow métier** | Extrait en **D2.8d3** (`parentChildRelationWorkflow.ts`) — JSX picker / modales restent dans `EntityPage` |
| **Fiche Parent** | **Absente** — comme Fiche Classe |
| **Responsables (fiche Élève)** | Onglet C1.3 `StudentGuardiansTab` — lecture + édition coordonnées limitée (C1.7) ; pas de CRUD admin complet |
| **Compte famille / rôle Parent** | Via `UsersPage` / contacts + rôle `"Parent"` ; hydratation mobile `user.children` |
| **Triple source de vérité** | `relations` · `student.parentName`/`parentPhone` · `guardians` / `studentGuardianRelations` |

**Recommandation D3.4a :** verrouiller le périmètre ci-dessous.  
Ne pas ouvrir de migration UI tant que le **choix produit** (surface canonique + modèle d’identité) n’est pas arrêté.  
Ne pas inventer une fiche Parent « pour avoir une fiche ».  
Ne pas rouvrir D2.8 / D3.1–D3.3 sous bannière Parents.

---

## 2. Routes concernées

| Route | Guard | Composant | Nature | Périmètre D3.4 |
|-------|-------|-----------|--------|----------------|
| `/etablissement/relations-parent-enfant` | `view="relations"` | `ParentChildRelationsPage` | Liste spécialisée liaisons parent↔élèves | **Cœur admin — à auditer / migrer plus tard** |
| `/administration/relations` | Administration | `EntityPage entity="relations"` | Relations génériques (sans mode bundle) | **Hors** (drift possible — ne pas fusionner sans décision) |
| `/etablissement/eleves` | `view="students"` | `StudentsListPage` | Liste Élèves (`parentName` / `parentPhone` legacy) | **Dépendance** — hors migration Parents |
| `/etablissement/eleves/:studentId` (+ `/:section`) | `view="students"` | `StudentWorkspacePage` | Fiche Élève | **Dépendance** |
| `…/eleves/:id` section `guardians` | idem | `StudentGuardiansTab` | Responsables légaux (C1.3) | **Adjacent** — unifier modèle avant UI |
| `/etablissement/comptes-utilisateurs` | `view="users"` | `UsersPage` | Comptes dont rôle Parent | **Dépendance comptes** — hors lot UI |
| `/etablissement/classes` (+ membres) | classes / students | D3.2b/c | Classes stables | **Dépendance** — consommation seule |
| `/etablissement/parents` (fiche / liste) | — | **Inexistant** | — | **🔒 produit** |
| Mobile `parent_student` | Auth Parent | Accueil + suivi enfant | Consumer | **Hors** migration admin D3.4 |

Fichiers nav : `web/src/App.tsx`, `MonEtablissementLayout.tsx` (onglet **Parents & élèves**), `EtablissementOverviewPage.tsx` (KPI parents via `countUniqueParentsInRelations`).

**Écart doc / code :** `entityModules.relations.path` = `/administration/relations` alors que l’entrée établissement pointe vers `/etablissement/relations-parent-enfant`.

---

## 3. Inventaire pages et composants

### 3.1 Surfaces Parents admin

| Fichier | LOC (approx.) | Rôle | DS direct |
|---------|---------------|------|-----------|
| `web/src/pages/etablissement/ParentChildRelationsPage.tsx` | ~6 | Thin wrapper mode `parentChildRelations` | Non — délègue EntityPage |
| `web/src/pages/EntityPage.tsx` | ~1883 | Assembleur liste / CRUD / picker multi-élèves | EntityList*, Modal, EmptyState… |
| `web/src/pages/entity-page/parentChildRelationWorkflow.ts` | ~292 | Plans submit/delete bundle + unitaire (D2.8d3) | — |
| `web/src/lib/relations.ts` | ~395 | Domaine PE-005, bundles, options, sync | — |
| `web/src/lib/entityModules.ts` | bloc `relations` | Champs `fromContactId` / `toStudentId` / `isPrincipal` | — |

### 3.2 Responsables (fiche Élève — C1.3 / C1.7)

| Fichier | Rôle |
|---------|------|
| `web/src/components/students/StudentGuardiansTab.tsx` | Onglet Responsables |
| `StudentGuardianCard` / `Table` / `Badges` | Affichage |
| `StudentEmergencyContacts` / `StudentPickupAuthorization` | Urgence / récupération |
| `editing/StudentGuardianContactEditForm.tsx` | Édition coordonnées (périmètre C1.7) |
| `web/src/lib/studentGuardian.ts` (+ selection / viewModel) | Domaine typé + fallback legacy `parentName`/`parentPhone` |

### 3.3 Backend / auth famille

| Fichier | Rôle |
|---------|------|
| `backend/lib/parentChildren.js` | `resolveParentChildren` : (1) téléphone ↔ `student.parentPhone` ; (2) `user.contactId` ↔ `relation.fromContactId` |
| Auth / RBAC | Rôle `Parent` → mobile `parent_student` ; injection `user.children` |
| `web/src/lib/internalRoleDefaults.ts` | Droits lecture Parent (Élèves, Notes, Présences, Paiements…) |

### 3.4 Absents (confirmés)

- `ParentsListPage` / `ParentWorkspacePage` / `components/parents/**`
- Entité `SchoolEntityKey` `"parents"`
- Route fiche `/etablissement/parents/:id`
- Tests de surface chrome dédiés type `ParentsListPage.test.tsx` (contrairement D3.1b / D3.2b / D3.3)

### 3.5 Tests / E2E existants

| Suite | Couverture |
|-------|------------|
| `parentChildRelationWorkflow.test.ts` | Plans D2.8d3 |
| `scripts/verify-e2e-0012-parent-student-journey.js` | API parent : contact + user + relations + `parentPhone` ; isolation ; notes publiées |
| `verify:student-guardians` | C1.3 + fallback legacy |
| `verify-user-account-coverage.js` | Parent sans lien élève (téléphone) |

**Trous :** pas d’E2E UI web sur `/etablissement/relations-parent-enfant` ; 0012 seed **double** (phone + relations) — masque les divergences d’identité.

---

## 4. Cartographie des dépendances

```
Comptes (rôle Parent) ──contactId──► Contacts (type Parent)
        │                              │
        │                         ??? identité ???
        ▼                              ▼
 students.parentPhone ◄──phone── resolveParentChildren ──► children[] (mobile)
 students.className   ◄──toStudentId── relations.fromContactId
        │
        ├── Classes (D3.2) — consommation seule
        └── Fiche Élève guardians (C1.3) ← studentGuardianRelations
                                        ← fallback parentName/Phone
```

| Module | Couplage | Décision D3.4 |
|--------|----------|---------------|
| **Élèves** | Liaisons, legacy parent*, onglet Responsables | Consommation / contrat — **ne pas migrer** sous D3.4 |
| **Classes** | `className` enfant ; E2E seeds | Hors — stable D3.2 |
| **Enseignants** | Aucun lien UI direct Parents | Hors (D3.3 clos) |
| **Comptes / Contacts** | Prérequis création parent | Hors UI (D2.8d2 déjà extrait) |
| **Présences / Notes / Finance** | Consommation mobile parent | **Hors** — candidats ultérieurs |
| **Overview** | Compteur parents uniques | Hors |

---

## 5. Risque structurant — identité `fromContactId`

| Couche | Interprétation observée |
|--------|-------------------------|
| Web `relations.ts` | `lookupParentUser(state, fromContactId)` → **`users.id`** ; options = comptes Parent |
| Commentaire code | `fromContactId = user.id` (nom de champ trompeur) |
| Backend `resolveParentChildren` | Match relations sur **`user.contactId`** |
| E2E 0012 | Seed souvent avec **`contact.id`** + `parentPhone` |

**Impact :** une liaison créée uniquement via l’UI établissement peut **ne pas** hydrater `user.children` côté mobile si ni téléphone legacy ni `contactId` ne matchent.

**Verrou D3.4a :** aucune migration UI Parents tant que le **modèle d’identité canonique** n’est pas décidé et documenté (user.id vs contactId vs phone, et stratégie de migration des données existantes).

---

## 6. Triple source de vérité

| Source | Usage actuel |
|--------|--------------|
| `state.relations` (type Parent → Élève) | Admin **Parents & élèves** ; PE-005 principal ; bundles |
| `student.parentName` / `parentPhone` | Colonnes liste Élèves ; fallback C1.3 ; match mobile téléphone |
| `guardians` / `studentGuardianRelations` | Onglet Responsables fiche Élève (C1.3) |

**Verrou :** D3.4 ne doit pas ajouter une 4ᵉ surface ni une liste « Parents » qui réécrit ces modèles.  
Toute suite UI doit déclarer la **source canonique** et le sort des deux autres (lecture seule / sync / dépréciation).

---

## 7. Permissions, validations, audit

| Domaine | Mécanisme | Note |
|---------|-----------|------|
| Liste liaisons | `view="relations"` · feature `"Relations"` | Label UI « Parents & élèves » |
| Bundle submit/delete | Plans D2.8d3 + gates EntityPage | Delete plan **sans** contrôle scope — préconditions EntityPage obligatoires |
| PE-005 | Un seul principal par périmètre | `relations.ts` / post-merge |
| Guardians fiche | `student.guardians.read` (+ update coordonnées C1.7) | CRUD création/suppression **non produit** |
| Audit | create/update/delete relations (bundle : `entityId = fromContactId`) | Conserver |
| Mobile Parent | RBAC `parent_student` | Hors migration admin |

---

## 8. Design System déjà en place

| Surface | État |
|---------|------|
| Chrome liste Parents & élèves | Via EntityPage → `EntityListShell` / `ListLayout` (D2.7) |
| Workflow plans | D2.8d3 extrait |
| JSX picker multi-élèves | Encore dans EntityPage (dette assembleur, **pas** lot Parents) |
| Fiche Élève Responsables | DS partiel (Card, EmptyState, SectionHeader) |
| Thin list page dédiée | **Absente** (contrairement Élèves / Classes / Enseignants) |

Créer un `ParentsListPage` thin wrapper **sans** décision produit sur le modèle = risque d’écran sans valeur métier (même anti-pattern que Fiche Classe inventée).

---

## 9. Sous-lots D3.4 — verrouillage

| Sous-lot | Statut | Justification |
|----------|--------|---------------|
| **D3.4a — Audit / verrouillage** | ✅ Ce lot (docs) | Obligatoire avant toute suite |
| **Décision produit — surface canonique** | 🔒 Produit | Parents & élèves vs liste Parents vs Responsables fiche vs comptes |
| **Décision technique — identité** | 🔒 Tech + produit | user.id / contactId / phone (§5) |
| **D3.4b — Chrome liste (éventuel)** | 🔒 | Seulement après § décisions ; pas de wrapper cosmétique |
| **Fiche Parent** | 🔒 Produit | Absente ; pas d’UI inventée |
| **Unification C1.3 ↔ relations** | 🔒 | Prérequis modèle ; hors UI cosmétique |
| **E2E UI liaisons** | 🔒 | Après modèle ; corriger seed double 0012 |
| **Présences / Notes / Finance familles** | 🔒 | Hors D3.4 — priorités ultérieures |
| **Réouverture D2.8 / EntityPage** | 🔒 | Clos (`d2.8e`) |
| **D3.1–D3.3** | 🔒 | Clos — ne pas rouvrir |

---

## 10. Questions produit à trancher (gate avant code)

1. **Quelle est la surface primaire « module Parents » ?**  
   Onglet actuel Parents & élèves · nouvelle liste Parents · onglet Responsables élève · comptes famille.
2. **Faut-il une fiche Parent ?** Si non → 🔒 explicite (comme Classes). Si oui → données / onglets / permissions.
3. **Source canonique du lien parent↔élève** pour admin + mobile.
4. **Que devient `parentName` / `parentPhone` ?** Conservation, sync, dépréciation.
5. **Périmètre D3.4b** : chrome DS only sur relations, ou chantier modèle d’abord ?

Sans réponses → **aucun lot UI Parents ouvert**.

---

## 11. Risques si on force une suite UI maintenant

1. **Inventer `ParentsListPage` / fiche** → écran sans valeur + dette modèle.
2. **Migrer le chrome sans corriger l’identité** → régression mobile `children`.
3. **Toucher C1.3 et relations en même temps** → double écriture / incohérence.
4. **Rouvrir EntityPage sous bannière Parents** → effet de bord multi-entités (interdit).
5. **Confondre avec D3.3 Enseignants** → chaos de suivi / tags.

---

## 12. Livrable D3.4a et merge gate

**Inclus :** ce document, rapport D3.4a, mise à jour suivi / README.  
**Exclus :** tout fichier sous `web/src/**`, `backend/**`, `Mobile/**`, scripts runtime.

| Gate | Attente |
|------|---------|
| Draft PR | Oui |
| Revue CTO | Diff docs + verrou §9–10 |
| CI / Security | Verts (docs-only) |
| UX / API / métier runtime | Aucun changement |

**Suite après validation CTO :** uniquement sur instruction explicite — décisions §10 puis éventuel D3.4b (migration incrémentale), **sans** réintroduire de dette EntityPage.
