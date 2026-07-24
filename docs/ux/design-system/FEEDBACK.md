# Feedback & états transverses — D2.4

**Code :** `web/src/design-system/feedback/`  
**Specs :** DO-005 · DO-006 · DO-012 · DO-021 · DO-031 · [Pages métier §8](../architecture-pages-metier.md)

Composants de **présentation** pour les états transverses. Aucune logique métier, permissions ou API.

## Quand utiliser quoi

| Besoin | Composant | Notes |
|--------|-----------|-------|
| Signal inline dans la page | `InlineAlert` | Slots `Alerts` des layouts |
| Aucune donnée métier | `EmptyState` | + action si possible (DO-006) |
| Capacité non livrée | `ComingSoonState` | ≠ Empty |
| Chargement contenu | `LoadingState` | Shell conservé (DO-021) |
| Échec technique / opération | `ErrorState` | `role="alert"` ; retry optionnel |
| Droits insuffisants | `ForbiddenState` | Issue / retour |
| Feedback global court | `Toast` / `useToast` | Non bloquant |

**Interdits :** Empty pour Forbidden ; Coming soon présenté comme donnée réelle ; toast pour erreur bloquante de page.

---

## API

### InlineAlert

```tsx
import { InlineAlert, Button } from "@/design-system";

<InlineAlert
  tone="warning"
  title="Lecture seule"
  action={<Button variant="tertiary" size="sm">Demander l’accès</Button>}
>
  Seul l’Admin School peut modifier ce profil.
</InlineAlert>
```

| Prop | Type | Défaut |
|------|------|--------|
| `tone` | `StatusTone` | `info` |
| `title` | string? | — |
| `action` | ReactNode? | — |
| `children` | ReactNode | requis |

A11y : `role="alert"` si `danger`, sinon `status` (surchargeable).

### EmptyState

```tsx
<EmptyState
  title="Aucun établissement actif"
  description="Sélectionnez un établissement pour modifier son profil."
  action={<Button>Choisir</Button>}
/>
```

### ComingSoonState

Équivalent DS de `PagePlaceholder` (icône en `ReactNode`, badge via `Badge` warning).

```tsx
<ComingSoonState
  icon={<Building2 className="h-7 w-7" />}
  title="Salles"
  description="La gestion des salles arrive bientôt."
/>
```

### LoadingState / ErrorState / ForbiddenState

```tsx
<LoadingState message="Chargement de la fiche…" />
<ErrorState message="Échec du chargement" action={<Button onClick={retry}>Réessayer</Button>} />
<ForbiddenState action={<Link to="/">Retour</Link>} />
```

### Toast (coexistence)

```tsx
import { ToastProvider, useToast } from "@/design-system";

// API compatible legacy + tone `warning`
const { showToast } = useToast();
showToast("Profil enregistré", "success");
```

| Tone | Visuel |
|------|--------|
| `info` | `bg-ink` |
| `success` | `bg-teal` |
| `error` | `bg-danger` (alias API legacy) |
| `warning` | `bg-amber` (**nouveau** D2.4) |

**Runtime (D2.6) :** `main.tsx` monte `ToastProvider` depuis `@/design-system`.  
`components/ui/Toast` est un **re-export** du même contexte — ne jamais monter deux providers.

---

## Accessibilité

| Composant | Rôle |
|-----------|------|
| InlineAlert (danger) | `alert` |
| InlineAlert (autres) | `status` |
| Empty / ComingSoon / Loading / Forbidden | `status` |
| ErrorState | `alert` |
| Toast région | `aria-live="polite"` |

## Limites

- Pas d’états Conflit / Maintenance / Sync dédiés
- Pas de file d’attente toast multi-messages
- PromptDialog encore legacy (D2.6+)
