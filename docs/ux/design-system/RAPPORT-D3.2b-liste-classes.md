# Rapport D3.2b — Liste des Classes

**Type :** Migration D3.2b  
**Module :** Classes métier  
**Sous-périmètre :** Liste  
**Infrastructure :** D2.7 (`EntityListShell` / `ListLayout` / …)  
**Layout :** `ListLayout` (via `EntityListShell`)  
**Pattern(s) :** P-002  
**DO concernés :** DO-005, DO-006, DO-010, DO-023, DO-024, DO-040, DO-045  
**Impact runtime :** UI uniquement  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Périmètre

### Inclus
- Route `/etablissement/classes` → `ClassesListPage`
- Recherche, tableau, pagination, actions existantes (via `EntityPage entity="classes"`)
- EmptyState DS lorsque la liste Classes est vide
- Tests de consommation D2.7

### Exclus
- Fiche Classe (D3.2a — absente)
- Membres / `ClassStudentsPage` (D3.2c)
- Élèves, Enseignants, config Classes (D2.5)
- Refactorisation structurelle d’`EntityPage`

---

## 2. Composants D2.7 réellement utilisés

| Composant D2.7 / DS | Usage liste Classes |
|---------------------|---------------------|
| `EntityListShell` | Chrome page (via EntityPage) |
| `ListLayout` | Composition interne du shell |
| `EntityListSearch` | Recherche |
| `EntityListTable` | Tableau + tri + pageSize 25 (quand non vide) |
| `EntityListForbidden` | Accès refusé |
| `InlineAlert` | Bannières EntityPage (si applicable au module) |
| `EmptyState` | Liste Classes vide / sans résultat recherche |
| `Button` / `Modal` | Actions & formulaires existants |

**Non applicables au modèle synchrone DataContext (comportement inchangé) :**
- `LoadingState` — `loading` DataContext est aussi vrai pendant sync périodique ; un gate casserait l’UX
- `ErrorState` page — les erreurs restent en toast métier / sync (pas d’écran erreur bloquant avant)

---

## 3. Fichiers

| Fichier | Action |
|---------|--------|
| `pages/etablissement/ClassesListPage.tsx` | **Créé** — consommatrice officielle |
| `pages/etablissement/ClassesListPage.test.tsx` | **Créé** |
| `App.tsx` / `lazyPages.ts` | Route → `ClassesListPage` |
| `EntityPage.tsx` | EmptyState si `module.key === "classes"` && rows vides (présentation) |

---

## 4. Legacy

| Legacy supprimé | Legacy restant |
|-----------------|----------------|
| Route directe `<EntityPage entity="classes" />` dans App | Handlers / colonnes / modales dans EntityPage |
| Ancien chrome Card (déjà retiré en D2.7) | `PrintButton`, `Field`/`DatePicker`/`Prompt` |
| | Synthèse classes depuis élèves (`scopedClasses`) — métier inchangé |

---

## 5. Validation de l’infrastructure D2.7

### Les composants extraits ont-ils été suffisants ?

**Oui.** La liste Classes n’a nécessité **aucune nouvelle primitive générique** ni modification structurelle de `EntityListShell` / Search / Table / Forbidden.

### Des adaptations ont-elles été nécessaires ?

| Adaptation | Nature | Impact D2.7 |
|------------|--------|-------------|
| Page `ClassesListPage` | Thin wrapper officiel (`EntityPage entity="classes"`) | Aucune |
| `EmptyState` si liste Classes vide | Branche présentation dans EntityPage | Aucune — consomme feedback DS existant |
| Message empty Table (fallback) | `emptyLabel` classes | Cosmétique |

### Un nouveau composant générique a-t-il dû être créé ?

**Non.**

### Améliorations D2.7 recommandées avant Enseignants (D3.3)

1. **Slot `empty` optionnel sur `EntityListTable` / Shell** — éviter les branches `module.key` pour EmptyState.
2. **Documenter le non-usage de LoadingState** sur listes DataContext (sync périodique).
3. **EntityFormDialog** (lot infra suivant) — réduire le monolithe modal avant D3.3 si les enseignants s’appuient fort sur les modales d’affectation.
4. **Row actions shell** — optionnel ; Enseignants a des actions spécifiques (Affecter).

### Verdict maturité D2.7

Cette migration s’effectue **sans modification structurelle importante de D2.7**. L’infrastructure est **suffisamment mature** pour accélérer les listes des modules cœur (Élèves liste, Enseignants) par simple page consommatrice + éventuels EmptyState ciblés.

---

## 6. États système vs métier

| État | Type | Implémentation |
|------|------|----------------|
| Accès refusé | Système | `EntityListForbidden` |
| Liste vide / recherche sans hit | Système d’écran | `EmptyState` |
| Validation unicité / delete refusé | Métier | Toast (inchangé) |
| Sync / réseau | Système (toast) | Inchangé — pas d’ErrorState page |

---

## 7. Régressions / différences visuelles

| Élément | Résultat |
|---------|----------|
| Régressions fonctionnelles | Aucune intentionnelle |
| Différences visuelles | EmptyState dashed pour liste vide Classes (intentionnel DS) |
| Colonnes / actions / permissions / navigation | Identiques |

---

## 8. Tests

| Suite | Résultat |
|-------|----------|
| `ClassesListPage.test.tsx` | 6 pass (nominal, search, empty, forbidden, exports, chrome D2.7) |
| Suite `src/design-system` | 42 pass |
| `tsc --noEmit` | OK |

---

## 9. Tableau de résultat CTO

| Élément | Résultat |
|---------|----------|
| Layout(s) | `ListLayout` via `EntityListShell` |
| Infra D2.7 consommée | Oui |
| Nouveaux composants DS génériques | Non |
| Legacy restant | EntityPage handlers/modales/colonnes |
| Régressions | Aucune |
| Difficulté | **Faible** (première conso D2.7) |
| Leçons | Thin page + EntityPage DS = pattern pour D3.1b / D3.3 listes |
| Retour EntityListShell | Réutilisable tel quel ; EmptyState encore branché côté page/entité |

---

## 10. Suite

Attendre validation CTO avant **D3.3 — Enseignants**.  
D3.2a (fiche) et D3.2c (membres) restent hors périmètre.
