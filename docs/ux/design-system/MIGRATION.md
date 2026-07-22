# Stratégie de coexistence & migration — D2.1

**Décisions :** DO-045 (compatibilité ascendante) · DO-046 (dépréciation contrôlée) · DO-040 (kit ERP)

## Principe

D2.1 **ajoute** le Design System (`web/src/design-system/`) **sans remplacer** les imports existants de `web/src/components/ui/`.

Aucun écran métier n’est migré dans cette PR.

```
Écrans métier existants  →  components/ui/*     (legacy, inchangé)
Nouveaux écrans / D2.2+  →  @/design-system     (fondation)
```

Les deux coexistent jusqu’à la migration progressive (D2.3).

## Composants legacy (coexistence)

| Legacy (`components/ui`) | Équivalent DS | Statut |
|--------------------------|---------------|--------|
| `Button` | `Button` (`tertiary` ≈ `ghost`) | Coexistence — migrer progressivement |
| `Badge` | `Badge` | Coexistence |
| `StatusBadge` | — (helper métier, hors primitive) | Reste dans ui pour l’instant |
| `Card` / `SectionHeader` | `Card` / `SectionHeader` | Coexistence |
| `Field` / `Input` / `Select` | `FormField` / `Input` / `Select` | Coexistence |
| `Modal`, `ConfirmDialog`, `Toast`, `Table`… | Dossiers overlays / feedback / data-display (stubs) | Migration lots suivants |

## Alias dépréciés (DO-046)

| API | Remplacement | Suppression |
|-----|--------------|-------------|
| `Button variant="ghost"` | `variant="tertiary"` | Après migration des écrans + validation CTO |

## Règles de migration (D2.3)

1. Migrer **écran par écran** ou **composant par composant**, jamais en big-bang.
2. Une PR de migration cite : `Pattern`, DO concernées, `Aucun AP introduit`.
3. Parité visuelle obligatoire tant que les **valeurs** de tokens D1.4 ne sont pas figées.
4. Ne pas supprimer `components/ui/X` tant que des imports restent.

## Interdits D2.1

- Refonte visuelle globale
- Changement fonctionnel métier
- Suppression des fichiers `components/ui/*`
- Activation dark mode produit
