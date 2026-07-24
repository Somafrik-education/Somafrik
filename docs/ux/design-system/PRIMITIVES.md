# Primitives Design System — documentation développeur (D2.1)

Import :

```ts
import { Button, Badge, Card, Input, FormField } from "@/design-system";
```

Réf. : D1.4 Design Language · DO-035 → DO-046 · AP-007 → AP-012

---

## Button

| | |
|--|--|
| **Objectif** | Déclencher une action (primaire / secondaire / tertiaire / destructive) |
| **Variantes** | `primary` · `secondary` · `tertiary` · `danger` · `ghost` *(déprécié → tertiary)* |
| **Sizes** | `sm` · `md` |
| **Props** | Étendre `ButtonHTMLAttributes` + `variant` + `size` |
| **A11y** | `focus-visible:ring`, `disabled`, `type` défaut `button` |
| **Limites** | Une seule action primaire par zone (DO-002, AP-001). Pas pour la navigation de liens — utiliser `Link`/`NavLink` stylé. |

```tsx
<Button variant="primary">Enregistrer</Button>
<Button variant="secondary">Annuler</Button>
<Button variant="danger">Supprimer</Button>
```

---

## IconButton

| | |
|--|--|
| **Objectif** | Action iconographique compacte |
| **Props** | `aria-label` **obligatoire**, `variant`, `size`, children (icône) |
| **Limites** | Ne jamais omettre `aria-label` (DO-041). |

```tsx
<IconButton aria-label="Fermer" variant="tertiary">
  <X className="h-4 w-4" />
</IconButton>
```

---

## Input / Textarea / Select

| | |
|--|--|
| **Objectif** | Saisie texte / multiligne / liste |
| **Props** | Attributs natifs HTML + `className` ; Select accepte `options[]` |
| **A11y** | `disabled` → `aria-disabled` ; associer via `FormField` + `htmlFor` |
| **Limites** | Pas de masque / validation intégrée — déléguer au formulaire. |

---

## Checkbox / Radio / Switch

| | |
|--|--|
| **Objectif** | Choix booléen / exclusif / interrupteur |
| **Props** | Attributs natifs (+ `label` optionnel) ; Switch : `checked` + `onCheckedChange` |
| **A11y** | Switch = `role="switch"` + `aria-checked` ; cibles `min-h-10` avec label |
| **Limites** | Switch contrôlé uniquement. |

---

## Badge

| | |
|--|--|
| **Objectif** | Indicateur de statut compact |
| **Tones** | `neutral` · `success` · `warning` · `info` · `danger` (rôles D1.4) |
| **Limites** | Ne pas encoder un statut par la seule couleur (AP-005). Toujours un libellé. `StatusBadge` heuristique reste dans `components/ui`. |

---

## Card / SectionHeader

| | |
|--|--|
| **Objectif** | Surface de contenu + en-tête de section |
| **Limites** | Card ≠ Fiche complète (P-003). SectionHeader défaut `h2`. |

---

## Divider

Séparateur horizontal/vertical (`role="separator"`).

---

## Avatar

Initiales + `aria-label`. Pas d’image dans D2.1.

---

## Spinner

État loading (`role="status"` + libellé). Ne remplace pas un empty/error (DO-031).

---

## FormField

Libellé + hint/erreur pour wrappers de contrôles. Préférer à `Field` legacy pour le nouveau code.
