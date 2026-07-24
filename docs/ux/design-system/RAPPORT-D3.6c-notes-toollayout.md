# Rapport D3.6c — Migration écrans Notes vers ToolLayout

**Type :** Migration chrome DS (P-007)  
**Module :** Notes / Évaluations  
**Impact runtime :** Oui (chrome page `/notes` uniquement)  
**Persistance / contrat D3.6b :** Conservé — aucun changement  
**Bulletins / D3.7 / onglet Résultats fiche Élève :** Hors lot  

**Prérequis :** tag `d3.6b`

---

## 1. Objectif

Migrer la page `/notes` (`GradesEvaluationsPage`) vers `ToolLayout` (Header / Context / Content), avec les états DS (`LoadingState` / `EmptyState` / `ForbiddenState`), sans toucher à la persistance ni au métier Notes.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `GradesEvaluationsPage.tsx` | Chrome `Card` → `ToolLayout` + états DS |
| `GradesEvaluationsPage.test.tsx` | Landmarks ToolLayout + Loading / Empty / Forbidden |
| `SUIVI-MIGRATIONS.md` / `README.md` | Suivi D3.6b ✅ · D3.6c ouvert |

**Interdit (respecté) :** changement persistance PG/JSON · moteur de calcul · onglet Résultats fiche Élève · Bulletins / D3.7 · migration `components/grades/*` · ToolLayout Présences.

**Chrome préexistant conservé (non-régression, hors livrable D3.6c) :** `PrintButton`, export CSV, onglet Statistiques, handlers métier (`lib/evaluations`) — aucune extension Bulletin / PDF / moyenne annuelle / fiche Élève.

---

## 3. Structure ToolLayout

| Slot / état | Contenu |
|-------------|---------|
| `ToolLayout.Header` | `SectionHeader` (titre, description contrat D3.6b, actions CSV / nouvelle évaluation) |
| `ToolLayout.Context` | Onglets vues + filtres période / classe / élève |
| `ToolLayout.Content` | Panneaux métier existants ; `EmptyState` si liste vide / sélection absente |
| `LoadingState` | Avant layout si `useData().loading` |
| `ForbiddenState` | Si `!canRead` Notes |
| Modales | Hors `ToolLayout` (siblings) |

---

## 4. Tableau CTO

| Élément | Résultat |
|---------|----------|
| `/notes` → ToolLayout Header/Context/Content | Oui |
| LoadingState / EmptyState / ForbiddenState | Oui |
| UI-only (pas de recalcul local) | Oui — handlers inchangés via `lib/evaluations` |
| Contrat D3.6b / PG / API / calcul | Inchangé (aucun fichier backend) |
| Onglet Résultats fiche Élève | Non |
| Bulletins / D3.7 | Non |
| StickyActions | Non (pas de footer sticky métier actuel) |
