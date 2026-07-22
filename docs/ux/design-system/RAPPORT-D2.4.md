# Rapport D2.4 — Feedback & États transverses

**Nature :** fondation Design System (pas une migration d’écran métier)  
**Code :** `web/src/design-system/feedback/`  
**Docs :** [AUDIT-D2.4.md](./AUDIT-D2.4.md) · [FEEDBACK.md](./FEEDBACK.md)

## Rapport CTO

| Élément | Résultat |
|---------|----------|
| **Layout utilisé** | N/A (lot feedback — layouts inchangés) |
| **Primitives / composants DS** | `InlineAlert`, `EmptyState`, `ComingSoonState`, `LoadingState`, `ErrorState`, `ForbiddenState`, `ToastProvider` / `useToast` |
| **Nouveaux composants Design System** | Oui (catalogue feedback) |
| **Régressions fonctionnelles** | Aucune (aucun écran migré ; `main.tsx` inchangé) |
| **Régressions visuelles** | Aucune |
| **DO respectées** | Oui (DO-005, DO-006, DO-012, DO-021, DO-031, DO-045) |
| **Patterns respectés** | Oui — contrats Empty ≠ Coming soon ≠ Forbidden |
| **Anti-patterns introduits** | Aucun |
| **Leçons pour le Design System** | Toast `warning` ajouté ; bascule provider à planifier ; états Conflit / Maintenance / Sync encore absents |

## Difficultés

1. API Toast legacy utilise `error` alors que StatusTone utilise `danger` — alias `error` conservé pour compatibilité.
2. Ne pas monter deux `ToastProvider` — documentation explicite.
3. `ComingSoonState` découple Lucide (`ReactNode`) vs `PagePlaceholder` (`LucideIcon`).

## Hors périmètre

- Migration des écrans / remplacement dashed empties
- Bascule `ToastProvider` dans `main.tsx`
- Modal, Table, états Conflit / Maintenance

## Suite recommandée

1. PR dédiée : brancher `ToastProvider` DS dans `main.tsx` + smoke test.
2. Prochaine migration métier : consommer `EmptyState` / `InlineAlert` sur une page Paramètres ou Liste.
3. D2.x : Table / Modal.
