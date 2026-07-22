# Design System Somafrik — documentation technique

**Phase :** D2.1 → D2.5  
**Code :** `web/src/design-system/`  
**Spec :** [Design Language D1.4](../design-language.md) · [Pages métier D1.3](../architecture-pages-metier.md)

## Contenu

| Document | Rôle |
|----------|------|
| [AUDIT-D2.1.md](./AUDIT-D2.1.md) | État des composants avant fondation |
| [AUDIT-D2.2.md](./AUDIT-D2.2.md) | État des layouts avant fondation |
| [AUDIT-D2.3.md](./AUDIT-D2.3.md) | Audit module Profil établissement |
| [AUDIT-D2.4.md](./AUDIT-D2.4.md) | Audit feedback & états transverses |
| [RAPPORT-D2.3-profil-etablissement.md](./RAPPORT-D2.3-profil-etablissement.md) | Rapport CTO première migration |
| [RAPPORT-D2.4.md](./RAPPORT-D2.4.md) | Rapport CTO lot feedback |
| [SUIVI-MIGRATIONS.md](./SUIVI-MIGRATIONS.md) | Tableau officiel de suivi des migrations |
| [RAPPORT-D2.5.md](./RAPPORT-D2.5.md) | Rapport CTO migration paramètres |
| [MIGRATION.md](./MIGRATION.md) | Coexistence legacy / DS + mapping |
| [PRIMITIVES.md](./PRIMITIVES.md) | API primitives |
| [LAYOUTS.md](./LAYOUTS.md) | API layouts |
| [FEEDBACK.md](./FEEDBACK.md) | API feedback & états |

## Arborescence code

```
web/src/design-system/
  primitives/     Button, IconButton, Input, Textarea, Select,
                  Checkbox, Radio, Switch, Badge, Card,
                  Divider, Avatar, Spinner
  forms/          FormField
  layout/         AppLayout, DashboardLayout, ListLayout,
                  RecordLayout, FormLayout, WizardLayout, ToolLayout
  feedback/       InlineAlert, EmptyState, ComingSoonState,
                  LoadingState, ErrorState, ForbiddenState, Toast
  navigation/     (stub)
  overlays/       (stub — Modal etc.)
  data-display/   (stub — Table)
  tokens/         Rôles sémantiques → classes ERP existantes
  index.ts        Point d’entrée public
```

## Utilisation

```ts
import {
  Button,
  RecordLayout,
  InlineAlert,
  EmptyState,
  LoadingState,
} from "@/design-system";
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
- Layouts / feedback génériques — pas de logique métier

## Impact modules

| Zone | Conforme | Écart | Action future |
|------|----------|-------|---------------|
| Paramètres simples (D2.5) | ✅ | Hub, config, sécurité, données, placeholders | [SUIVI-MIGRATIONS.md](./SUIVI-MIGRATIONS.md) |
| Modules métier cœur | 🔒 | Hors D2.5 | Après validation CTO |
| Primitives / Layouts / Feedback DS | ✅ | Livrés D2.1–D2.4 | Consommer dès nouveaux écrans |
| Toast runtime | ⚠️ | Toujours `components/ui/Toast` | Bascule provider = PR dédiée |
| Overlays / Tables | — | Table legacy Sécurité ; Modal stub | Lots suivants |

## Éléments gelés

| Élément | Statut |
|---------|--------|
| Arborescence `design-system/` | Gelée |
| Variantes Button `primary/secondary/tertiary/danger` | Gelées |
| Tones Badge / InlineAlert D1.4 | Gelés |
| Catalogue layouts D2.2 + slots | Gelé |
| Catalogue états feedback D2.4 | Gelé (extensions via PR documentée) |
| Coexistence Toast / PagePlaceholder legacy | Gelée jusqu’à migration validée |
| Valeurs hex / rebrand | Non gelées (D1.4) |
