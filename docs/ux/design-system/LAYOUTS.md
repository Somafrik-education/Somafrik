# Layouts officiels — D2.2

**Statut :** normatif (implémentation)  
**Code :** `web/src/design-system/layout/`  
**Specs :** [Architecture pages métier D1.3](../architecture-pages-metier.md) · [Navigation D1.2](../architecture-navigation.md) · [Design Language D1.4](../design-language.md)

Les layouts fournissent une **structure de page stable** avec des **slots (zones d’insertion)** explicites.  
Ils ne contiennent **aucune logique métier**, aucun appel API, aucune permission.

## API des slots

Deux formes équivalentes (prop prioritaire si les deux sont fournies) :

```tsx
import { RecordLayout } from "@/design-system";

// Compound (recommandé — zones lisibles)
<RecordLayout>
  <RecordLayout.Header>…</RecordLayout.Header>
  <RecordLayout.Summary>…</RecordLayout.Summary>
  <RecordLayout.Alerts>…</RecordLayout.Alerts>
  <RecordLayout.PrimaryActions>…</RecordLayout.PrimaryActions>
  <RecordLayout.SecondaryActions>…</RecordLayout.SecondaryActions>
  <RecordLayout.Tabs>…</RecordLayout.Tabs>
  <RecordLayout.Content>…</RecordLayout.Content>
  <RecordLayout.Sidebar>…</RecordLayout.Sidebar>
  <RecordLayout.History>…</RecordLayout.History>
</RecordLayout>

// Props
<RecordLayout header={…} summary={…} content={…} />
```

Les enfants hors slots connus alimentent le slot **Content** (fallback).

---

## Catalogue

### AppLayout

| | |
|--|--|
| **Objectif** | Shell applicatif (chrome) : sidebar + header + main. |
| **Cas d’usage** | Enveloppe globale ERP (desktop / tablette / mobile). |
| **Zones** | `Sidebar`, `Header`, `Banner`, `Main`, `MobileNav` |
| **Responsive** | Sidebar masquée sous `lg` ; `MobileNav` pour le drawer. |
| **A11y** | `<aside>`, `<header>`, `<main>` |
| **Limites** | Pas d’auth, routing, titres dynamiques, permissions. Ne remplace pas `components/layout/AppLayout` en D2.2. |

### DashboardLayout

| | |
|--|--|
| **Objectif** | Synthèse opérationnelle ou analytique (P-004 / P-005). |
| **Cas d’usage** | TDB global, vue d’ensemble établissement. |
| **Zones** | `Header`, `PrimaryActions`, `Alerts`, `Kpis`, `Content` |
| **Ordre** | Header/Actions → Alerts → Kpis → Content (alertes avant KPI — D1.3). |
| **Limites** | Pas de table CRUD complète ; pas de formulaire métier principal. |

### ListLayout

| | |
|--|--|
| **Objectif** | Collection filtrable (P-002). |
| **Cas d’usage** | Élèves, Classes, Paiements, Users… |
| **Zones** | `Header`, `Description`, `Kpis`, `Filters`, `PrimaryActions`, `SecondaryActions`, `Content`, `Footer` |
| **Responsive** | Actions empilées sous le titre sur mobile ; filtres en colonne puis ligne. |
| **Limites** | Pas de logique de filtre/tri ; pagination fournie dans `Footer` ou `Content`. |

### RecordLayout

| | |
|--|--|
| **Objectif** | Fiche / workspace entité (P-003 + P-001). |
| **Cas d’usage** | Dossier élève ; futures fiches enseignant, classe… |
| **Zones** | `Header`, `Summary`, `Alerts`, `PrimaryActions`, `SecondaryActions`, `Tabs`, `Content`, `Sidebar`, `History` |
| **Ordre** | Conforme D1.3 §2 (Header → Summary → Alerts → Actions → Tabs → Content / History + Sidebar). |
| **Responsive** | Sidebar en dessous sur `< lg` ; sticky sidebar desktop. |
| **Limites** | Pas de résumé métier généré ; pas d’onglets routés. |

### FormLayout

| | |
|--|--|
| **Objectif** | Page formulaire dédiée (création / édition longue). |
| **Cas d’usage** | Changer d’offre, config année, pages formulaire hors Modal. |
| **Zones** | `Header`, `Description`, `Alerts`, `Content`, `StickyActions` |
| **Limites** | Pas de validation ; champs = contenu des slots (primitives D2.1). |

### WizardLayout

| | |
|--|--|
| **Objectif** | Assistant multi-étapes (P-008). |
| **Cas d’usage** | Inscription, création établissement (cible). |
| **Zones** | `Header`, `Stepper`, `Content`, `StickyActions` |
| **Limites** | Pas d’état d’étape ; une seule étape visible = responsabilité métier. Largeur max pour focus. |

### ToolLayout

| | |
|--|--|
| **Objectif** | Outil opérationnel dense (P-007). |
| **Cas d’usage** | Présences, saisie de notes, planning. |
| **Zones** | `Header`, `Context`, `Content`, `StickyActions` |
| **Limites** | Pas de grille métier ; densité laissée au contenu. |

---

## Exemples d’assemblage

### Liste minimale

```tsx
<ListLayout>
  <ListLayout.Header><h1>Élèves</h1></ListLayout.Header>
  <ListLayout.PrimaryActions><Button>Ajouter</Button></ListLayout.PrimaryActions>
  <ListLayout.Filters>{/* Input + Select */}</ListLayout.Filters>
  <ListLayout.Content>{/* Table */}</ListLayout.Content>
</ListLayout>
```

### Fiche

```tsx
<RecordLayout>
  <RecordLayout.Header>{/* identité */}</RecordLayout.Header>
  <RecordLayout.Summary>{/* P-001 */}</RecordLayout.Summary>
  <RecordLayout.PrimaryActions><Button>Action</Button></RecordLayout.PrimaryActions>
  <RecordLayout.Tabs>{/* nav locale */}</RecordLayout.Tabs>
  <RecordLayout.Content>{/* sections */}</RecordLayout.Content>
  <RecordLayout.History>{/* timeline */}</RecordLayout.History>
</RecordLayout>
```

---

## Intégration Design System

- Utiliser uniquement les **primitives D2.1** et tokens / classes ERP (D1.4) dans le contenu des slots.
- Ne pas créer de composants métier dans `layout/`.
- Navigation locale (TabNav) et tables restent hors layouts jusqu’aux lots dédiés.

## Accessibilité (checklist)

| Critère | Attendu |
|---------|---------|
| Landmarks | `header` / `main` / `aside` / `nav` / `footer` / `section[aria-label]` selon layout |
| Ordre de lecture | Ordre DOM = ordre D1.3 |
| Clavier | Pas de piège de focus ; actions dans l’ordre source |
| Contenu | Responsabilité des slots (labels boutons, titres `h1` uniques — DO-010) |

## Ce que D2.2 ne fait pas

- Migrer aucun écran métier
- Remplacer `components/layout/AppLayout` runtime
- Introduire HubLayout dédié (Hub → composition Dashboard / List — voir [MIGRATION.md](./MIGRATION.md))
