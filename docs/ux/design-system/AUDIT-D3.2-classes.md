# Audit — D3.2 Classes (métier)

**Lot :** D3.2a — Audit et verrouillage du périmètre  
**Statut :** descriptif — **aucun changement de code applicatif**  
**Module :** Classes métier (`/etablissement/classes`)  
**Date :** 2026-07-23  
**Base de revue :** `develop` @ `4a5684b8` (tag `d2.8e` — lot D2.8 clos)  
**Référence DS :** Design System Somafrik (`@/design-system`)  
**Audit précédent :** 2026-07-22 (pré-D3.2b/c / pré-D2.8e) — **obsolète pour l’état runtime**  

**Hors périmètre explicite :** configuration Classes D2.5 (`ConfigurationPage`), fiche Élève (D3.1), Enseignants (D3.3), Présences, Notes (`ClassGradesOverview`), Emplois du temps (`TimetableByClassPage`), Finance, inventaire d’une fiche Classe produit

---

## 1. Synthèse exécutive

| Constat | Détail (post-D2.8e) |
|---------|---------------------|
| **Fiche Classe** | **Absente** — confirmé code + [architecture-pages-metier.md](../architecture-pages-metier.md) (« Liste ; pas de fiche classe ») |
| **Liste Classes** | `ClassesListPage` → `EntityPage entity="classes"` → `EntityListShell` / `ListLayout` (**D3.2b ✅**) |
| **Membres / élèves** | `ClassStudentsPage` → `EntityPage entity="students" classScope` (**D3.2c ✅**) |
| **Composants dédiés** | Aucun `components/classes/**` ; pas de `ClassWorkspace` / `ClassDetail` |
| **Assembleur** | `EntityPage.tsx` (~1883 LOC) — modales / handlers Classes encore dans l’assembleur |
| **Infra EntityPage** | Colonnes, options, CRUD, workflows extraits (D2.8a–e) — **clos** |

**Recommandation D3.2a :** verrouiller le périmètre ci-dessous. Ne pas inventer de fiche. Ne pas rouvrir D3.2b/c ni D2.8. Aucun lot UI Classes supplémentaire tant que le produit n’ouvre pas une fiche Classe.

---

## 2. Routes concernées

| Route | Guard | Composant | Nature | Périmètre D3.2 |
|-------|-------|-----------|--------|----------------|
| `/etablissement/classes` | `PermissionRoute view="classes"` | `ClassesListPage` | Liste CRUD métier | **D3.2b ✅** |
| `/etablissement/classes/:className/eleves` | `PermissionRoute view="students"` | `ClassStudentsPage` | Élèves filtrés + retour | **D3.2c ✅** |
| `/classes` | — | `Navigate` → `/etablissement/classes` | Alias | Navigation seule |
| `/etablissement/classes/:id` (fiche) | — | **Inexistant** | — | **Fiche 🔒 produit** |
| `/parametres/structure` (Classes config) | Paramètres | `ConfigurationPage` | Config pédagogique | **Hors** (D2.5) |
| `/planning/emploi-du-temps/par-classe` | `view="planning"` | `TimetableByClassPage` | Outil planning | **Hors** |
| Notes / `ClassGradesOverview` | Notes | Grades | Outil notes | **Hors** |

Fichiers : `web/src/App.tsx`, nav `MonEtablissementLayout.tsx`, overview `EtablissementOverviewPage.tsx`.

---

## 3. Inventaire pages et composants

### 3.1 Pages Classes métier

| Fichier | LOC (approx.) | Rôle | DS direct |
|---------|---------------|------|-----------|
| `web/src/pages/etablissement/ClassesListPage.tsx` | 14 | Thin wrapper D3.2b | Non — délègue EntityPage |
| `web/src/pages/etablissement/ClassStudentsPage.tsx` | 26 | Thin wrapper D3.2c + redirect si `className` vide | Non — délègue EntityPage |
| `web/src/pages/EntityPage.tsx` | ~1883 | Assembleur liste / CRUD / modales / `classScope` | `EntityList*`, Modal, EmptyState, Button, InlineAlert |
| `web/src/lib/entityModules.ts` | bloc `classes` | Champs, colonnes, feature | — |
| `web/src/lib/classRules.ts` | ~184 | Unicité, suppression, options noms | — |

### 3.2 Modules EntityPage liés (infra, non Classes-only)

| Fichier | Rôle Classes |
|---------|--------------|
| `entity-page/entityColumns.tsx` | Colonne Effectif (`studentCount`) ; action ligne « Élèves » |
| `entity-page/entitySelectOptions.ts` | Options `classNames` ; filtre CLASSE-003 (archivées) |
| `entity-page/entityCrudCore.ts` | Audit générique inclut `classes` |

### 3.3 Absents (confirmés)

- `components/classes/**`
- `ClassWorkspacePage` / `ClassDetail*` / route fiche
- Hook `useClass*` dédié

### 3.4 Tests de surface

| Suite | Couverture |
|-------|------------|
| `ClassesListPage.test.tsx` | Chrome D2.7, table, search, empty, forbidden, export |
| `ClassStudentsPage.test.tsx` | Orientation DO-024, classScope, empty, forbidden, redirect |

---

## 4. Fiche Classe — analyse

| Question | Réponse |
|----------|---------|
| Existe-t-elle ? | **Non** |
| Données candidat fiche ? | Oui en modal CRUD : `name`, `level`, `track`, `cycle`, `schoolYear`, `capacity`, `mainRoom`, `status` |
| Enseignant principal ? | **Non** — côté affectations / enseignants |
| Layout cible si produit ouvre | `RecordLayout` (P-003 + P-001) |
| Migration UI possible sans produit ? | **Non** — créer une fiche = extension fonctionnelle |

**Verrou :** aucune route, résumé, KPI ou onglet fiche Classes dans D3.2 tant que décision produit explicite.

---

## 5. Branches Classes résiduelles dans EntityPage

| Zone | Comportement |
|------|--------------|
| Prop `classScope` | Filtre élèves ; titre « Élèves — … » ; draft create ; lock champ `className` ; lien retour classes |
| Submit `module.key === "classes"` | `validateUniqueClassName` |
| Delete `module.key === "classes"` | `removeSchoolClassFromState` + audit `classes.delete` |
| Colonnes | Effectif + lien membres (si `students.canRead`) |
| Options | Noms disponibles / CLASSE-003 |

Ces branches restent dans l’assembleur ; **ne pas les extraire sous l’étiquette D3.2** (infra EntityPage déjà clôturée en D2.8).

---

## 6. Permissions, validations, audit, données

| Domaine | Mécanisme | Note |
|---------|-----------|------|
| Liste | `view="classes"` · feature `"Classes"` | Inchangé |
| Membres | `view="students"` · feature `"Élèves"` | Action « Élèves » = `students.canRead` |
| État | `useData()` → `state.classes` + `update` / persist | Contrats inchangés |
| Scope | `scopedClasses` (synthèse `CLASS-*`, dédup) | Métier |
| Validations | `validateUniqueClassName` ; `validateClassDeletion` / `removeSchoolClassFromState` | Ne pas réécrire |
| Audit | Clés auditées + `classes.delete` dédié | Conserver |
| Auth / école | `useAuth`, `useActiveSchool` | Contexte établissement |

---

## 7. Interactions transversales

| Module | Couplage | Décision D3.2 |
|--------|----------|---------------|
| **Élèves** | Effectif ; `ClassStudentsPage` ; dossiers | Consommation seule — hors migration |
| **Enseignants / Affectations** | Noms de classe ; filtres | Hors |
| **Matières / courses** | Blocage suppression si cours | Hors |
| **Planning** | Blocage si `courseSchedules` ; `TimetableByClassPage` | Hors |
| **Notes** | `ClassGradesOverview` | Hors |
| **Structure / config** | `classNames`, levels, tracks ; sync delete → config | D2.5 hors |
| **Overview** | Compteur classes | Hors |

---

## 8. Design System déjà en place

| Surface | État |
|---------|------|
| Chrome liste Classes / membres | `ListLayout` via `EntityListShell` (D2.7) |
| Empty / Forbidden / Search / Table | Patterns EntityList + EmptyState |
| Modal CRUD | Modal DS (runtime EntityPage / D2.6) |
| Legacy indirect | `Field` / `DatePicker` / `PrintButton` / `PromptDialog` via EntityPage — dette assembleur, **pas** lot Classes |

---

## 9. Sous-lots D3.2 — verrouillage

| Sous-lot | Statut | Justification |
|----------|--------|---------------|
| **D3.2a — Audit / verrouillage** | ✅ Ce lot (docs) | Obligatoire avant toute suite |
| **Fiche Classe** | 🔒 Produit | Absente ; pas de migration inventée |
| **D3.2b — Liste** | ✅ Livré | `ClassesListPage` + tests |
| **D3.2c — Membres** | ✅ Livré | `ClassStudentsPage` + tests |
| **Lots UI Classes supplémentaires** | 🔒 | Aucun tant que fiche non ouverte produit |
| **Réouverture D2.8 / EntityPage** | 🔒 | Clos (`d2.8e`) — hors D3.2 |

---

## 10. Risques si on force une suite UI maintenant

1. **Inventer une fiche** → extension fonctionnelle + KPI inventés (interdit).
2. **Rouvrir EntityPage sous bannière Classes** → effet de bord multi-entités (interdit).
3. **Migrer Planning / Notes « par classe »** → hors module métier Classes.
4. **Toucher `classRules` / permissions** → changement métier déguisé.

---

## 11. Livrable D3.2a et merge gate

**Inclus :** ce document, rapport D3.2a, mise à jour suivi / README.  
**Exclus :** tout fichier sous `web/src/**`.

| Gate | Attente |
|------|---------|
| Draft PR | Oui |
| Revue CTO | Diff docs + verrou §9 |
| CI / Security | Verts (docs-only) |
| UX / API / métier | Aucun changement |

**Clôture :** lot D3.2 **clos** — tag `d3.2a` @ `045ef54e` (merge PR #59).  
**Suite :** uniquement sur instruction CTO explicite — fiche Classe produit, ou autre module D3 🔒 (Parents / Présences / Notes / …) ; hors réouverture D2.8f / D2.9.
