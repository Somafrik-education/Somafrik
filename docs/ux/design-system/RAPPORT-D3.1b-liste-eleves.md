# Rapport D3.1b — Liste des Élèves

**Type :** Migration D3.1b  
**Module :** Élèves  
**Sous-périmètre :** Liste  
**Infrastructure :** D2.7 (`EntityListShell` / `ListLayout` / …)  
**Layout :** `ListLayout` (via `EntityListShell`)  
**Pattern(s) :** P-002  
**DO concernés :** DO-005, DO-010, DO-023, DO-024, DO-040, DO-045  
**Impact runtime :** UI uniquement  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Périmètre

### Inclus
- `StudentsListPage` — thin wrapper `EntityPage entity="students"`
- Route `/etablissement/eleves`
- Recherche, exports, permissions, actions existantes (incl. lien « Dossier »)
- EmptyState générique EntityPage
- Tests standardisés + régression Classes / Enseignants

### Exclus
- Fiche / workspace Élève (`StudentWorkspacePage` — D3.1 ✅)
- `ClassStudentsPage` / D3.2c
- Refactor D2.7, nouveaux composants génériques
- Branche `module.key === "students"` dans EntityPage
- Backend, API, hooks

---

## 2. Composants D2.7 utilisés

| Composant | Usage |
|-----------|--------|
| `EntityListShell` → `ListLayout` | Chrome liste |
| `EntityListSearch` | Recherche |
| `EntityListTable` | Tableau (si non vide) |
| `EntityListForbidden` | Accès refusé |
| `EmptyState` | Liste vide (générique) |
| `Button` / `Modal` | Actions & formulaires existants |

**EntityPage :** aucune modification dans ce lot.

---

## 3. Validation chaîne D2.7 (3 modules)

| Module | Page | Lot |
|--------|------|-----|
| Classes | `ClassesListPage` | D3.2b ✅ |
| Enseignants | `TeachersListPage` | D3.3 ✅ |
| Élèves | `StudentsListPage` | D3.1b ✅ |

Même pattern : thin wrapper → EntityPage → EntityList*. Aucun fork métier UI.

---

## 4. Fichiers

| Fichier | Action |
|---------|--------|
| `StudentsListPage.tsx` | Créé |
| `StudentsListPage.test.tsx` | Créé |
| `App.tsx` / `lazyPages.ts` | Route liste |
| Fiche `StudentWorkspacePage` | **Inchangée** |

---

## 5. Tests

| Suite | Résultat |
|-------|----------|
| `StudentsListPage.test.tsx` | 6 pass |
| `ClassesListPage.test.tsx` | régression EmptyState |
| `TeachersListPage.test.tsx` | régression EmptyState |
| Suite DS / tsc | OK |

Scénarios : ListLayout, nominal, search, empty, forbidden, exports.

---

## 6. Tableau de résultat CTO

| Élément | Résultat |
|---------|----------|
| Wrapper simple | Oui |
| Infra D2.7 | Consommée telle quelle |
| Fiche Élève touchée | Non |
| Nouveaux composants DS | Non |
| Branche students EntityPage | Non |
| Régressions métier | Aucune intentionnelle |
| Difficulté | **Faible** |

---

## 7. Suite

Attendre validation CTO avant **D3.2c — Membres / élèves d’une classe**.
