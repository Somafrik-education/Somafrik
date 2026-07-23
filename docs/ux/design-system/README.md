# Design System Somafrik — documentation technique

**Phase :** D2.1 → D2.8  
**Code :** `web/src/design-system/`  
**Spec :** [Design Language D1.4](../design-language.md) · [Pages métier D1.3](../architecture-pages-metier.md)

## Contenu

| Document | Rôle |
|----------|------|
| [AUDIT-D2.1.md](./AUDIT-D2.1.md) … [AUDIT-D2.6.md](./AUDIT-D2.6.md) | Audits par lot |
| [RAPPORT-D2.3](./RAPPORT-D2.3-profil-etablissement.md) … [RAPPORT-D2.6](./RAPPORT-D2.6.md) | Rapports CTO D2 |
| [AUDIT-D2.7-entitypage.md](./AUDIT-D2.7-entitypage.md) · [ARCHITECTURE-D2.7-entitypage.md](./ARCHITECTURE-D2.7-entitypage.md) · [RAPPORT-D2.7-entitypage.md](./RAPPORT-D2.7-entitypage.md) | D2.7 EntityPage |
| [AUDIT-D2.8-entitypage-remainder.md](./AUDIT-D2.8-entitypage-remainder.md) · [RAPPORT-D2.8a-colonnes-entitypage.md](./RAPPORT-D2.8a-colonnes-entitypage.md) | D2.8a colonnes |
| [RAPPORT-D2.8b-options-entitypage.md](./RAPPORT-D2.8b-options-entitypage.md) | D2.8b options select |
| [RAPPORT-D2.8c-crud-entitypage.md](./RAPPORT-D2.8c-crud-entitypage.md) | D2.8c noyau CRUD |
| [RAPPORT-D2.8d1-affectations-enseignants.md](./RAPPORT-D2.8d1-affectations-enseignants.md) | D2.8d1 affectations |
| [RAPPORT-D2.8d2-contacts-comptes.md](./RAPPORT-D2.8d2-contacts-comptes.md) | D2.8d2 contacts & comptes |
| [RAPPORT-D2.8d3-relations-parent-enfant.md](./RAPPORT-D2.8d3-relations-parent-enfant.md) | D2.8d3 relations parent-enfant |
| [RAPPORT-D2.8d4-paiements.md](./RAPPORT-D2.8d4-paiements.md) | D2.8d4 paiements |
| [AUDIT-D3.1-eleves.md](./AUDIT-D3.1-eleves.md) · [RAPPORT-D3.1-eleves.md](./RAPPORT-D3.1-eleves.md) | D3.1 Élèves (fiche) |
| [RAPPORT-D3.1b-liste-eleves.md](./RAPPORT-D3.1b-liste-eleves.md) | D3.1b Liste Élèves (conso D2.7) |
| [AUDIT-D3.2-classes.md](./AUDIT-D3.2-classes.md) · [RAPPORT-D3.2-classes.md](./RAPPORT-D3.2-classes.md) | D3.2 Classes métier (audit / scope lock) |
| [RAPPORT-D3.2b-liste-classes.md](./RAPPORT-D3.2b-liste-classes.md) | D3.2b Liste Classes (conso D2.7) |
| [RAPPORT-D3.2c-membres-classe.md](./RAPPORT-D3.2c-membres-classe.md) | D3.2c Membres classe (conso D2.7) |
| [RAPPORT-D3.3-enseignants.md](./RAPPORT-D3.3-enseignants.md) | D3.3 Liste Enseignants (conso D2.7) |
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
  patterns/       entity-list (EntityListShell, Search, Table, Forbidden)
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
