# Design System Somafrik — documentation technique

**Phase :** D2.1 (primitives) + D2.2 (layouts)  
**Code :** `web/src/design-system/`  
**Spec :** [Design Language D1.4](../design-language.md) · [Pages métier D1.3](../architecture-pages-metier.md)

## Contenu

| Document | Rôle |
|----------|------|
| [AUDIT-D2.1.md](./AUDIT-D2.1.md) | État des composants avant fondation |
| [AUDIT-D2.2.md](./AUDIT-D2.2.md) | État des layouts avant fondation |
| [MIGRATION.md](./MIGRATION.md) | Coexistence legacy / DS + mapping pages → layouts |
| [PRIMITIVES.md](./PRIMITIVES.md) | API développeur des primitives |
| [LAYOUTS.md](./LAYOUTS.md) | API, zones, exemples et limites des layouts |

## Arborescence code

```
web/src/design-system/
  primitives/     Button, IconButton, Input, Textarea, Select,
                  Checkbox, Radio, Switch, Badge, Card,
                  Divider, Avatar, Spinner
  forms/          FormField
  layout/         AppLayout, DashboardLayout, ListLayout,
                  RecordLayout, FormLayout, WizardLayout, ToolLayout
  feedback/       (stub)
  navigation/     (stub)
  overlays/       (stub — Modal etc.)
  data-display/   (stub — Table)
  tokens/         Rôles sémantiques → classes ERP existantes
  index.ts        Point d’entrée public
```

## Utilisation

```ts
import { Button, Badge, Card, FormField, Input, RecordLayout } from "@/design-system";
```

## Tests

```bash
npm --prefix web run test
```

## Gouvernance

- DO / Patterns / Anti-patterns obligatoires
- Pas de hardcode hors tokens (AP-007)
- Un kit ERP (DO-040)
- Compatibilité ascendante (DO-045) · Dépréciation contrôlée (DO-046)
- Layouts génériques à slots — pas de logique métier

## Impact modules

| Zone | Conforme | Écart | Action future |
|------|----------|-------|---------------|
| Modules métier | ⚠️ | Toujours sur legacy ui/layout | D2.3 migration progressive |
| Primitives DS | ✅ | Livrées D2.1 | Consommer dès nouveaux écrans |
| Layouts DS | ✅ | Livrés D2.2, non branchés runtime | Brancher en D2.3+ |
| Overlays / Tables | — | Stubs | Lots suivants |

## Éléments gelés

| Élément | Statut |
|---------|--------|
| Arborescence `design-system/` | Gelée |
| Variantes Button `primary/secondary/tertiary/danger` | Gelées |
| Tones Badge D1.4 | Gelés |
| Catalogue layouts D2.2 + slots nommés | Gelé (extensions via PR documentée) |
| Coexistence avec `components/ui` et `components/layout` | Gelée jusqu’à migration validée |
| Valeurs hex / rebrand | Non gelées (D1.4) |
