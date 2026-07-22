# Rapport D2.6 — Stabilisation du socle UI

**Nature :** fondation / runtime (pas une migration de module cœur)  
**Code :** `design-system/overlays`, `design-system/data-display`, re-exports `components/ui/*`, `main.tsx`

## Rapport CTO

| Élément | Résultat |
|---------|----------|
| **Layout utilisé** | N/A (stabilisation socle) |
| **Primitives / composants DS** | `Modal`, `ConfirmProvider`/`useConfirm`, `Table` (+ Toast runtime) |
| **Nouveaux composants Design System** | Oui (overlays + Table) |
| **Régressions fonctionnelles** | Aucune (API parité + re-exports) |
| **Régressions visuelles** | Aucune intentionnelle (fermeture Modal = `tertiary` ≈ ghost) |
| **DO respectées** | Oui (DO-003, DO-045, DO-046) |
| **Patterns respectés** | Oui (P-002 Table, P-009 Modal) |
| **Anti-patterns introduits** | Aucun |
| **Leçons pour le Design System** | Re-export ui → DS = seule bascule Toast sûre ; PromptDialog / DataTable / TabNav encore hors lot |

## Livrables

1. **Toast** — `main.tsx` monte `ToastProvider` DS ; `components/ui/Toast` re-exporte le même contexte.
2. **Confirm** — `ConfirmProvider` DS dans `main.tsx` ; re-export ui.
3. **Modal** — implémentation DS + Escape ; re-export ui (PromptDialog legacy continue de fonctionner).
4. **Table** — parité API (tri, pagination, emptyLabel) ; re-export ui ; Sécurité importe `@/design-system`.
5. **PagePlaceholder** — wrapper `ComingSoonState` ; Marketplace migré.
6. Docs + suivi + tests.

## Différé (explicite)

| Élément | Raison |
|---------|--------|
| PromptDialog DS | Moins bloquant ; lot dédié |
| DataTable | Distinct de Table ; consumers planning |
| TabNav / navigation DS | Stub |
| ParametresLayout → shell DS | Hors stabilisation runtime |
| Documents / Graphiques | Écrans encore ⏳ |
| Modules cœur | 🔒 |

## Suite recommandée

1. Migrer imports Toast/Modal/Table progressivement vers `@/design-system` (DO-046).
2. PromptDialog + DataTable DS.
3. Après validation CTO : premier module stratégique (hors Finance/Notes en premier jet).
