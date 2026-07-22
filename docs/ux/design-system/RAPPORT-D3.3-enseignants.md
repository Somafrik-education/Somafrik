# Rapport D3.3 — Liste des Enseignants

**Type :** Migration D3.3  
**Module :** Enseignants  
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
- `TeachersListPage` — wrapper `EntityPage entity="teachers"`
- Route `/etablissement/enseignants`
- Recherche, exports, actions, permissions existantes
- `EmptyState` lorsque la liste est vide (mécanisme générique EntityPage)
- Tests de consommation D2.7

### Exclus
- Fiche enseignant
- Refactor D2.7 / nouveaux composants génériques
- Branches `module.key === "teachers"` pour l’UI empty
- Backend, API, hooks, permissions

---

## 2. Composants D2.7 utilisés

| Composant | Usage |
|-----------|--------|
| `EntityListShell` → `ListLayout` | Chrome liste |
| `EntityListSearch` | Recherche |
| `EntityListTable` | Tableau (si non vide) |
| `EntityListForbidden` | Accès refusé |
| `EmptyState` | Liste vide |
| `Button` / `Modal` / `InlineAlert` | Actions & overlays existants |

---

## 3. Correction mineure EntityPage

Généralisation de l’`EmptyState` (introduit en D3.2b pour Classes) :

- **Avant :** branche `module.key === "classes"`
- **Après :** `rows.length === 0` → `EmptyState` pour **toute** entité EntityPage
- **Aucune** condition `teachers` ajoutée
- Libellés génériques basés sur `module.label`

Cela confirme la réutilisabilité D2.7 sans duplication par module.

---

## 4. Validation multi-modules (Classes + Enseignants)

| Critère | Classes (D3.2b) | Enseignants (D3.3) |
|---------|-----------------|---------------------|
| Thin wrapper page | ✅ | ✅ |
| Conso EntityList* | ✅ | ✅ |
| EmptyState sans fork métier | ✅ (après géné.) | ✅ |
| Nouveau composant générique | Non | Non |
| Refactor D2.7 | Non | Non |

**Verdict :** D2.7 est réutilisable pour plusieurs modules cœur ; le modèle thin page + EntityPage peut s’étendre (Élèves liste, etc.).

---

## 5. Fichiers

| Fichier | Action |
|---------|--------|
| `TeachersListPage.tsx` | Créé |
| `TeachersListPage.test.tsx` | Créé |
| `App.tsx` / `lazyPages.ts` | Route |
| `EntityPage.tsx` | EmptyState générique (mineur) |
| `ClassesListPage.test.tsx` | Aligné libellés EmptyState |

---

## 6. Tests

| Suite | Résultat |
|-------|----------|
| `TeachersListPage.test.tsx` | 6 pass |
| `ClassesListPage.test.tsx` | 6 pass (régression) |
| Suite `src/design-system` | À confirmer CI |
| `tsc --noEmit` | OK |

Couverture : nominal, search, empty→EmptyState, forbidden, exports, ListLayout.

---

## 7. Tableau de résultat CTO

| Élément | Résultat |
|---------|----------|
| Wrapper simple | Oui — `TeachersListPage` |
| Infra D2.7 | Consommée telle quelle |
| Nouveaux composants DS | Non |
| Branche teachers EntityPage | Non |
| Régressions métier | Aucune intentionnelle |
| Difficulté | **Faible** |
| Leçon | EmptyState générique > branches par entité |

---

## 8. Suite

Attendre validation CTO avant d’étendre le même modèle (ex. liste Élèves D3.1b) ou d’ouvrir d’autres modules.
