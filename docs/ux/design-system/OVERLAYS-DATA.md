# Overlays & Data display — D2.6

## Modal

```tsx
import { Modal, Button } from "@/design-system";

<Modal open={open} title="Titre" description="…" onClose={() => setOpen(false)} footer={<Button>OK</Button>}>
  Contenu
</Modal>
```

- Escape ferme le dialogue
- `size`: `md` | `lg`
- Fermer : `Button` `tertiary` (alias historique `ghost`)

## ConfirmDialog

```tsx
const { confirm } = useConfirm();
const ok = await confirm({ title: "Supprimer ?", tone: "danger", confirmLabel: "Supprimer" });
```

Monter `<ConfirmProvider>` une seule fois (fait dans `main.tsx`).

## Table

```tsx
import { Table, type Column } from "@/design-system";

<Table columns={columns} rows={rows} rowKey={(r) => r.id} sortable pageSize={20} emptyLabel="Vide" />
```

Parité avec l’ancienne API ui (tri, pagination client, `onRowClick`).

## Différé

- `PromptDialog` — encore `components/ui`
- `DataTable` — encore `components/ui`
