# Rapport D2.5 — Migration des modules de paramètres

**Objectif :** industrialiser la migration DS sur plusieurs écrans simples avant les modules cœur.  
**Suivi vivant :** [SUIVI-MIGRATIONS.md](./SUIVI-MIGRATIONS.md)

## Rapport CTO (lot)

| Élément | Résultat |
|---------|----------|
| **Layout utilisé** | `FormLayout`, `DashboardLayout`, `ListLayout` (+ `ComingSoonState` hors layout) |
| **Primitives utilisées** | Button, Card, SectionHeader, FormField, Input, Select, Textarea, Badge |
| **États utilisés** | EmptyState, ComingSoonState, ForbiddenState, InlineAlert |
| **Nouveaux composants Design System** | Non |
| **Régressions fonctionnelles** | Aucune |
| **Régressions visuelles** | Aucune intentionnelle (Badge « Bientôt/Disponible », StickyActions abonnements) |
| **DO respectées** | Oui |
| **Patterns respectés** | Oui (P-006 hub ; formulaires ; Coming soon ≠ Empty) |
| **Anti-patterns introduits** | Aucun |
| **Leçons pour le Design System** | Voir ci-dessous |

## Modules migrés (détail)

| Module | Layout | Primitives / états | Legacy restant |
|--------|--------|--------------------|----------------|
| Profil établissement | FormLayout | + EmptyState, InlineAlert (D2.4) | Toast |
| Hub Paramètres | DashboardLayout | Badge | — |
| Placeholders paramètres | — | ComingSoonState | — |
| Année scolaire | FormLayout | FormField, Select, Input, Textarea, Badge… | Toast |
| Niveaux / Filières / Classes config / Matières | FormLayout | + EmptyState (matières) | Toast |
| Rôles et droits | FormLayout | ForbiddenState | Toast, checkbox native |
| Salles (+ remplacements / EDT salle) | — | ComingSoonState | — |
| Sécurité | ListLayout | EmptyState, FormField… | Table, PrintButton |
| Données & sauvegarde | DashboardLayout | InlineAlert… | ConfirmDialog, Toast |
| Politique abonnement | FormLayout | EmptyState… | Toast |

## Difficultés

1. **`ConfigurationPage` monolithe** — Année / Structure / Rôles partagent un seul fichier ; migration UI in-place (pas d’extraction de routes).
2. **Multiples formulaires** — `FormLayout` enveloppe le contenu ; chaque section garde son propre submit (pas de StickyActions unique).
3. **Table / ConfirmDialog / Toast** — encore stubs ou legacy ; documentés dans le suivi.
4. **« Classes » ambigu** — listes de config pédagogique ≠ module métier Classes (🔒).

## Dette restante (paramètres)

- Documents / bulletins
- Graphiques dashboard
- Shell `ParametresLayout`
- Bascule `ToastProvider` DS dans `main.tsx`
- Table DS pour le journal d’audit Sécurité

## Leçons pour le Design System

1. `ComingSoonState` remplace proprement `PagePlaceholder` (icône ReactNode).
2. `ForbiddenState` unifie les early-returns permission.
3. Besoin futur : `FormSection` optionnel pour cartes multi-formulaires.
4. Table DS devient bloquante pour la suite Sécurité / listes.

## Hors périmètre (respecté)

Élèves, Classes métier, Enseignants, Présences, Notes, Finance ops, RH — 🔒  
Aucun changement backend / API / permissions / handlers.
