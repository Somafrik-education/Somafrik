# Design System Somafrik — documentation technique

**Phase :** D2.1 — Fondation  
**Code :** `web/src/design-system/`  
**Spec :** [Design Language D1.4](../design-language.md)

## Contenu D2.1

| Document | Rôle |
|----------|------|
| [AUDIT-D2.1.md](./AUDIT-D2.1.md) | État des composants avant fondation |
| [MIGRATION.md](./MIGRATION.md) | Coexistence legacy / DS + dépréciations |
| [PRIMITIVES.md](./PRIMITIVES.md) | API développeur des primitives |

## Arborescence code

```
web/src/design-system/
  primitives/     Button, IconButton, Input, Textarea, Select,
                  Checkbox, Radio, Switch, Badge, Card,
                  Divider, Avatar, Spinner
  forms/          FormField
  feedback/       (stub — D2.x)
  navigation/     (stub — D2.2+)
  layout/         (stub — D2.2)
  overlays/       (stub — Modal etc.)
  data-display/   (stub — Table)
  tokens/         Rôles sémantiques → classes ERP existantes
  index.ts        Point d’entrée public
```

## Utilisation

```ts
import { Button, Badge, Card, FormField, Input } from "@/design-system";
```

## Tests

```bash
npm --prefix web run test
```

## Gouvernance

- DO / Patterns / Anti-patterns obligatoires
- Pas de hardcode hors tokens (AP-007)
- Un kit ERP (DO-040) — shadcn non étendu aux écrans métier
- Compatibilité ascendante (DO-045) · Dépréciation contrôlée (DO-046)

## Patterns Produit concernés

Fondation transversante pour **P-001 → P-010** (primitives consommées par tous les patterns).

## Impact modules (D2.1)

| Module | Conforme | Écart | Action future |
|--------|----------|-------|---------------|
| Tous modules métier | ⚠️ | Toujours sur `components/ui` legacy | D2.3 migration progressive |
| Fondation DS | ✅ | Primitives + docs + tests livrés | Consommer dès nouveaux écrans |
| Overlays / Tables / Layouts | — | Stubs uniquement | D2.1 suite / D2.2 |

## Éléments gelés (D2.1)

| Élément | Statut |
|---------|--------|
| Arborescence `design-system/` | Gelée |
| Variantes Button `primary/secondary/tertiary/danger` | Gelées |
| Tones Badge D1.4 | Gelés |
| Coexistence avec `components/ui` | Gelée jusqu’à migration validée |
| Valeurs hex / rebrand | Non gelées (D1.4) |
