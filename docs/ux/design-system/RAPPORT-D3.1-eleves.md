# Rapport de migration D3.1 — Élèves (fiche)

**Module :** Dossier élève (`StudentWorkspacePage` + `components/students/**`)  
**Liste élèves (`EntityPage`)** : non migrée (partagée / D3.x ultérieur)

## Rapport CTO

| Élément | Résultat |
|---------|----------|
| **Layout(s) utilisé(s)** | `RecordLayout` |
| **Primitives utilisées** | Button, Card, SectionHeader, Badge, Modal |
| **États utilisés** | LoadingState, ErrorState, EmptyState, ForbiddenState, ComingSoonState, InlineAlert |
| **Composants legacy supprimés (fiche)** | Imports `ui/Card|Button|Badge|Modal` (sauf `StatusBadge`) |
| **Dette restante** | Liste `EntityPage` ; `StatusBadge` ; nav onglets custom ; Fields locaux editing |
| **Régressions** | Aucune intentionnelle |
| **DO / Patterns / AP** | Oui / P-003+P-001 / Aucun |
| **Leçons DS** | `StatusBadge` candidat DS ; EmptyState pour empties dashed ; liste partagée = PR dédiée |

## Périmètre

- ✅ Fiche / onglets / édition modale
- ❌ Liste `/eleves` (EntityPage)
- ❌ `ClassStudentsPage` (Classes métier)
- ❌ Notes / Présences / Finance

## Suite

Attendre validation CTO avant **D3.2 — Classes (métier)**.
