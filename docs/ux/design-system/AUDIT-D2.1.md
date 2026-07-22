# Audit composants UI — D2.1 (avant fondation)

**Statut :** descriptif  
**Phase :** D2.1  
**Périmètre :** `web/src/components/ui/`

## 1. Composants réutilisables (kit ERP)

| Composant | Fichier | Rôle |
|-----------|---------|------|
| `Button` | `Button.tsx` | Actions (primary / secondary / ghost / danger) |
| `Badge` / `StatusBadge` | `Badge.tsx` | Statuts (tones + heuristique libellés) |
| `Card` / `SectionHeader` | `Card.tsx` | Conteneurs de page / sections |
| `Field` / `Input` / `Select` | `Field.tsx` | Formulaires basiques |
| `Modal` | `Modal.tsx` | Dialogue |
| `ConfirmDialog` / `PromptDialog` | `ConfirmDialog.tsx`, `PromptDialog.tsx` | Confirmations / prompts |
| `Toast` | `Toast.tsx` | Feedback global |
| `Table` / `DataTable` | `Table.tsx`, `DataTable.tsx` | Affichage tabulaire |
| `DatePicker` | `DatePicker.tsx` | Saisie date |
| `PagePlaceholder` | `PagePlaceholder.tsx` | Coming soon |
| `PrintButton` | `PrintButton.tsx` | Impression |

## 2. Sous-ensemble shadcn (`ui/shadcn/`)

`button`, `card`, `input`, `label`, `form`, `tabs` — usage limité (auth / marketing / reports).  
Écart DO-011 / DO-040 / AP-010.

## 3. Doublons

| Concept | ERP | shadcn |
|---------|-----|--------|
| Bouton | `ui/Button` | `ui/shadcn/button` |
| Carte | `ui/Card` | `ui/shadcn/card` |
| Input | `ui/Field` → `Input` | `ui/shadcn/input` |

## 4. Variantes actuelles (ERP)

| Composant | Variantes |
|-----------|-----------|
| Button | `primary`, `secondary`, `ghost`, `danger` · sizes `sm`, `md` |
| Badge | tones `neutral`, `success`, `warning`, `danger`, `info` |

Écart D2.1 : pas de variante officielle `tertiary` (ghost joue ce rôle).

## 5. Incohérences

1. API non homogène (`tone` Badge vs `variant` Button).
2. Focus / a11y inégaux (Modal incomplet vs DatePicker soigné).
3. Pas d’IconButton / Spinner / Divider / Avatar / Switch officiels.
4. Noms tokens historiques (`brand`, `teal`) ≠ rôles D1.4 (`primary`, `success`).

## 6. Dépendances

- Tailwind 3 + tokens `tailwind.config.js` / `index.css`
- `clsx` + `tailwind-merge` (`cn`)
- `class-variance-authority` (présent, peu utilisé sur kit ERP)
- Lucide (icônes app)
- Radix (surtout shadcn)

## 7. Décision D2.1

- **Ne pas déplacer** `components/ui/*` (risque migration).
- Créer `src/design-system/` en **coexistence**.
- Primitives DS = fondation ; visuel = parité avec tokens ERP existants (pas de rebrand).
