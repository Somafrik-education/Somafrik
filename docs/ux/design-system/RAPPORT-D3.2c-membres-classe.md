# Rapport D3.2c — Membres / élèves d’une classe

**Type :** Migration D3.2c  
**Module :** Classes métier  
**Sous-périmètre :** Membres (élèves d’une classe)  
**Infrastructure :** D2.7 (`EntityListShell` / `ListLayout` / …)  
**Layout :** `ListLayout` (via `EntityListShell`)  
**Pattern(s) :** P-002 · DO-024 (retour contexte)  
**Impact runtime :** UI uniquement (documentation + tests ; page déjà thin wrapper)  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées (`view="students"`)  
**Breaking change :** Non  

---

## 1. Périmètre

### Inclus
- `ClassStudentsPage` — thin wrapper `EntityPage entity="students" classScope={…}`
- Route existante `/etablissement/classes/:className/eleves`
- Orientation « ← Retour aux classes »
- Recherche, exports, actions, EmptyState générique
- Tests standardisés + redirect `className` vide

### Exclus
- Liste Classes (D3.2b) / liste Élèves globale (D3.1b)
- Fiche Élève / fiche Classe
- Refactor D2.7, nouveaux composants génériques
- Nouvelle branche EntityPage
- Backend, API, hooks

---

## 2. Particularité vs listes globales

| Aspect | Listes D3.1b / D3.2b / D3.3 | D3.2c |
|--------|----------------------------|-------|
| Wrapper | `entity` seul | `entity` + `classScope` |
| Titre | Label module | `Élèves — {classe}` |
| Orientation | — | Retour Classes (DO-024) |
| Filtrage | Scope établissement | + filtre `className` |

Toute la logique de filtre / titre / orientation reste dans EntityPage (API existante) — **aucune** duplication métier dans la page.

---

## 3. Composants D2.7 utilisés

`EntityListShell`, `ListLayout`, `EntityListSearch`, `EntityListTable`, `EntityListForbidden`, `EmptyState`, `Button` / `Modal` (via EntityPage).

**EntityPage :** non modifié dans ce lot.

---

## 4. Chaîne D2.7 (4 consommateurs listes)

| Module | Page | Lot |
|--------|------|-----|
| Classes | `ClassesListPage` | D3.2b |
| Enseignants | `TeachersListPage` | D3.3 |
| Élèves | `StudentsListPage` | D3.1b |
| Membres classe | `ClassStudentsPage` | D3.2c |

---

## 5. Tests

| Scénario | Couvert |
|----------|---------|
| ListLayout + orientation | ✅ |
| Nominal (filtre classScope) | ✅ |
| Recherche | ✅ |
| EmptyState | ✅ |
| Forbidden | ✅ |
| Exports | ✅ |
| Redirect className vide | ✅ |

---

## 6. Tableau de résultat CTO

| Élément | Résultat |
|---------|----------|
| Wrapper simple | Oui (`classScope` existant) |
| Infra D2.7 | Consommée telle quelle |
| Nouveaux composants DS | Non |
| Modif EntityPage | Non |
| Régressions métier | Aucune |
| Difficulté | **Faible** (page déjà en place ; formalisation + tests) |

---

## 7. Suite

Attendre validation CTO. Prochaine infra possible : extraction progressive modales/colonnes EntityPage (D2.7 suite).
