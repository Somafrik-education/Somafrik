# Design System Somafrik — documentation technique

**Phase :** D2.1 → D2.6  
**Code :** `web/src/design-system/`  
**Spec :** [Design Language D1.4](../design-language.md) · [Pages métier D1.3](../architecture-pages-metier.md)

## Contenu

| Document | Rôle |
|----------|------|
| [AUDIT-D2.1.md](./AUDIT-D2.1.md) … [AUDIT-D2.6.md](./AUDIT-D2.6.md) | Audits par lot |
| [RAPPORT-D2.3](./RAPPORT-D2.3-profil-etablissement.md) … [RAPPORT-D2.6](./RAPPORT-D2.6.md) | Rapports CTO D2 |
| [AUDIT-D3.1-eleves.md](./AUDIT-D3.1-eleves.md) · [RAPPORT-D3.1-eleves.md](./RAPPORT-D3.1-eleves.md) | D3.1 Élèves |
| [AUDIT-D3.2-classes.md](./AUDIT-D3.2-classes.md) · [RAPPORT-D3.2-classes.md](./RAPPORT-D3.2-classes.md) | D3.2 Classes métier (audit / scope lock) |
| [SUIVI-MIGRATIONS.md](./SUIVI-MIGRATIONS.md) | Tableau officiel de suivi |
| [MIGRATION.md](./MIGRATION.md) | Coexistence legacy / DS |
| [PRIMITIVES.md](./PRIMITIVES.md) | API primitives |
| [LAYOUTS.md](./LAYOUTS.md) | API layouts |
| [FEEDBACK.md](./FEEDBACK.md) | API feedback & états |
| [OVERLAYS-DATA.md](./OVERLAYS-DATA.md) | API Modal / Confirm / Table |

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
  overlays/       Modal, ConfirmDialog
  data-display/   Table
  navigation/     (stub — TabNav / Breadcrumb)
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
  Modal,
  Table,
  ToastProvider,
  useToast,
  ConfirmProvider,
  useConfirm,
} from "@/design-system";
```

## Runtime (D2.6)

`main.tsx` monte `ToastProvider` + `ConfirmProvider` depuis `@/design-system`.  
Les fichiers `components/ui/{Toast,Modal,ConfirmDialog,Table,PagePlaceholder}` sont des **re-exports** de coexistence (DO-045 / DO-046).

## Tests

```bash
npm --prefix web run test
```

## Impact

| Zone | Statut |
|------|--------|
| Socle UI (Toast/Modal/Confirm/Table) | ✅ Runtime DS |
| Paramètres simples | ✅ D2.5 |
| Modules cœur | 🔒 Après validation CTO |
| PromptDialog / DataTable / TabNav | ⏳ Différé |

## Éléments gelés

| Élément | Statut |
|---------|--------|
| APIs Toast / Modal / Confirm / Table DS | Gelées (extensions documentées) |
| Coexistence re-exports ui | Gelée jusqu’à migration des imports |
| Valeurs hex / rebrand | Non gelées (D1.4) |
