# Rapport D3.6c — Migration écrans Notes vers ToolLayout

**Type :** Migration chrome DS (P-007)  
**Module :** Notes / Évaluations  
**Impact runtime :** Oui (chrome page `/notes` uniquement)  
**Persistance / contrat D3.6b :** Conservé — aucun changement  
**Bulletins / D3.7 / onglet Résultats fiche Élève :** Hors lot  

**Prérequis :** tag `d3.6b`

---

## 1. Objectif

Migrer la page `/notes` (`GradesEvaluationsPage`) vers `ToolLayout` (Header / Context / Content), avec `ForbiddenState` pour le refus d’accès, sans toucher à la persistance ni au métier Notes.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `GradesEvaluationsPage.tsx` | Chrome `Card` → `ToolLayout` + `ForbiddenState` |
| `GradesEvaluationsPage.test.tsx` | Landmarks ToolLayout + ForbiddenState |
| `SUIVI-MIGRATIONS.md` / `README.md` | Suivi D3.6b ✅ · D3.6c ouvert |

**Interdit (respecté) :** changement persistance PG/JSON · onglet Résultats fiche Élève · Bulletins / D3.7 · migration `components/grades/*` · ToolLayout Présences.

---

## 3. Structure ToolLayout

| Slot | Contenu |
|------|---------|
| `ToolLayout.Header` | `SectionHeader` (titre, description contrat D3.6b, actions CSV / nouvelle évaluation) |
| `ToolLayout.Context` | Onglets vues + filtres période / classe / élève |
| `ToolLayout.Content` | Panneaux métier existants (évaluations, saisie, classe, élève, stats) |
| Modales | Hors `ToolLayout` (siblings) |

---

## 4. Tableau CTO

| Élément | Résultat |
|---------|----------|
| `/notes` → ToolLayout | Oui |
| Contrat D3.6b conservé | Oui |
| Aucun changement persistance | Oui |
| ForbiddenState `grades` / Notes | Oui |
| Onglet Résultats fiche Élève | Non |
| Bulletins / D3.7 | Non |
| StickyActions | Non (pas de footer sticky métier actuel) |
