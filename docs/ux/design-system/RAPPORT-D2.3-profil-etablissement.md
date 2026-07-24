# Rapport de migration D2.3 — Profil établissement

**Module :** Paramètres → Profil établissement (`/parametres/profil`)  
**Fichier :** `web/src/pages/parametres/EstablishmentProfilePage.tsx`  
**Branche / PR :** D2.3 première migration métier  
**Objectif :** valider en conditions réelles layouts D2.2 + primitives D2.1 **sans** changement fonctionnel.

## Rapport CTO (obligatoire D2.3+)

| Élément | Résultat |
|---------|----------|
| **Layout utilisé** | `FormLayout` |
| **Primitives utilisées** | `Button`, `Card`, `SectionHeader`, `FormField`, `Input`, `Select` |
| **Nouveaux composants Design System** | Non |
| **Régressions fonctionnelles** | Aucune (API, permissions, validation, toasts inchangés) |
| **Régressions visuelles** | Aucune intentionnelle — parité classes ERP (`input-base`, `border-line`, tokens) ; barre d’actions passée en `StickyActions` (comportement sticky bottom) |
| **DO respectées** | Oui (DO-002 action primaire unique, DO-010 hiérarchie titres, DO-040 kit ERP, DO-045 coexistence Toast legacy) |
| **Patterns respectés** | Oui — page Formulaire (D1.3) ; shell module `ParametresLayout` conservé |
| **Anti-patterns introduits** | Aucun |
| **Leçons pour le Design System** | Voir § Leçons ci-dessous |

## Difficultés rencontrées

1. **Toast hors DS** — `useToast` reste sur `components/ui/Toast` (overlays encore stubs). Migration partielle forcée.
2. **Double en-tête** — `ParametresLayout` expose déjà un `h1` « Paramètres » ; le titre page reste en `SectionHeader` (`h2`) pour éviter les `h1` concurrents (DO-010).
3. **Submit + StickyActions** — le `<form>` enveloppe `FormLayout` pour que le bouton du slot `StickyActions` soumette correctement sans `form=""`.
4. **Vitest scoped** — la config ne couvrait que `design-system/` ; élargie à `pages/**` pour les tests de migration.

## Primitives / layouts manquants

| Gap | Impact | Proposition D2.4 |
|-----|--------|------------------|
| Toast / feedback overlay | Import legacy obligatoire | Livrer `Toast` (ou hook) dans `design-system/feedback` |
| Alert / Banner inline | Alerte lecture seule en markup ad hoc | Primitive `InlineAlert` (tones D1.4) |
| Form section helper | Titres de section répétés (`h3` + grille) | Optionnel `FormSection` (layout léger, pas métier) |
| Empty state | Message « aucun établissement » ad hoc | Pattern Empty (DO-005) en feedback |

`FormLayout` était **suffisant** pour cette page (Header, Alerts, Content, StickyActions).

## Améliorations proposées pour D2.4

1. **Feedback** : Toast + InlineAlert dans le DS.
2. **Guide migration formulaire** : snippet officiel « form wrapping FormLayout + StickyActions ».
3. **Checklist PR D2.3+** : tableau rapport CTO (ce document) comme template réutilisable.
4. **Prochaine migration** : un écran Liste simple (hors cœur) une fois `Table` DS disponible — ou autre page Paramètres isolée (ex. lecture Sécurité sans Table si trop tôt).

## Accessibilité (vérifié)

| Critère | Résultat |
|---------|----------|
| Landmarks FormLayout | `header`, `section[aria-label=Formulaire]`, `footer` actions |
| Titres | `h2` page + `h3` sections (sous `h1` module) |
| Labels | `FormField` + `htmlFor` / `id` sur chaque contrôle |
| Focus | Contrôles natifs + `Button` `focus-visible:ring` |
| Alerte lecture seule | `role="status"` |
| Clavier | Ordre DOM = ordre de lecture ; submit en fin de formulaire |

## Responsive

- Grille `sm:grid-cols-2` conservée.
- `StickyActions` maintient l’action primaire accessible en bas de viewport sur formulaires longs (mobile).

## Périmètre volontairement exclu

- `ParametresLayout` (shell module)
- Backend / API / permissions
- Autres pages Paramètres
- Remplacement de Toast
