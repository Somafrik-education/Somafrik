# Inventaire UI — Audit D1.1

**Statut :** descriptif (constat)  
**Phase :** D1.1  
**Périmètre inspecté :** frontend `web/`, priorité workspace Élève  
**Normatif associé :** [Vision](./vision-produit.md) · [Principes](./principes-ux.md) · [Décisions](./decisions-officielles.md) · [Glossaire](./glossaire.md)

Cet inventaire photographie l’existant.  
Il ne prescrit pas de refonte : les corrections relèvent des étapes D suivantes, guidées par les DO-xxx.

---

## 1. Stack et fondations

| Élément | Emplacement | Notes |
|---------|-------------|--------|
| App web | `web/` | React 18 + TypeScript + Vite + Tailwind 3 + React Router 6 |
| Tokens couleur / ombre / fonte | `web/tailwind.config.js` | `ink`, `muted`, `line`, `brand`, `teal`, `amber`, `danger`, `canvas` ; fonte Inter |
| Variables shadcn | `web/src/index.css` (`:root`) | Parallèles aux tokens Tailwind |
| Classe formulaire | `.input-base` dans `index.css` | Utilisée par `Field` / `Input` / `Select` |
| Dark mode | `darkMode: ["class"]` | Présent mais UI ERP globalement claire |

Pas de design language documenté avant D1.1 (corrigé par ce framework).

---

## 2. Navigation globale et orientation

| Élément | Fichiers | Constat |
|---------|----------|---------|
| Sidebar | `components/layout/Sidebar.tsx`, `AppNavContent.tsx` | Nav groupée, état actif brand |
| Drawer mobile | `MobileNavDrawer.tsx` | `role="dialog"`, `aria-modal` |
| Topbar | `Topbar.tsx` | Titre dérivé du path ; recherche ; refresh ; notifs |
| Shell | `AppLayout.tsx` | `main` + `max-w-6xl` |
| Onglets module | `TabNav.tsx` | Variants `primary` (underline) / `sub` (pills) |
| Mon établissement | `MonEtablissementLayout.tsx` | Eyebrow + `h1` + `TabNav` au-dessus du contenu |
| Breadcrumb | — | **Absent** |

**Incohérence d’orientation (dossier élève) :**
- Topbar reste souvent sur « Élèves » ;
- onglets établissement toujours visibles ;
- header fiche + onglets dossier en dessous ;
- jusqu’à trois `h1` concurrents (Topbar, Mon établissement, header élève).

Écarts notables vs DO-009 / DO-010.

---

## 3. Workspace Élève (fiche / dossier)

### Shell

| Fichier | Rôle |
|---------|------|
| `pages/etablissement/StudentWorkspacePage.tsx` | Loading / error / not-found / permissions modules |
| `StudentWorkspaceHeader.tsx` | Identité, badges, méta `dl`, retour liste |
| `StudentWorkspaceNavigation.tsx` | Onglets sections (`aria-label`, `focus-visible`, `min-h-11`) |
| `StudentWorkspaceTabs.tsx` | Routeur d’onglets + access denied inline |

### Sections

| Module | Composants principaux |
|--------|----------------------|
| Vue d’ensemble | `StudentOverviewTab`, `StudentWorkspaceAlert`, `StudentWorkspaceMetric` |
| Identité | `StudentIdentityTab` + `editing/*` |
| Inscription | `StudentEnrollmentTab`, `StudentCurrentEnrollmentCard`, timeline / history / status badge |
| Responsables | `StudentGuardiansTab`, card / table / emergency / pickup + édition contact |
| Médical | `StudentMedicalTab`, summary / listes / badges |
| Documents | `StudentDocumentsTab`, summary / list / badges |
| Historique | `StudentHistoryTab`, summary / groups / timeline |
| À venir | `StudentWorkspaceComingSoonTab` |

### Patterns observés (à conserver)

- `Card` + `SectionHeader` + grilles `dl` (labels uppercase muted)
- Badges à tones sémantiques ; présentations dédiées inscription / médical / documents
- Empty dashed récurrent (`border-dashed border-line bg-slate-50…`)
- Alertes overview avec lien « Voir la section »
- Édition contrôlée : review, conflict, unsaved, success (`role="alert"` / `aria-live`)
- Table responsables : desktop table / mobile cards

### Écarts vs principes ERP (P2–P5)

| Principe | Constat actuel |
|----------|----------------|
| Résumé métier (P2 / DO-001) | Header + overview existent, mais le résumé n’est pas encore le contrat systématique « constat → décision » |
| Workflow (P3 / DO-006) | Fort sur édition identité ; faible sur médical / documents / historique (actions disabled « à venir ») |
| Données vivantes (P4 / DO-007) | Partiellement présent (alertes, conformité docs, risque médical) ; certains compteurs restent plats |
| Aide à la décision (P5 / DO-008) | Amorcé via alertes ; pas généralisé en interprétation + actions recommandées |

---

## 4. Primitives UI réutilisables

### Kit ERP canonique (`components/ui/`) — DO-011

| Primitive | Fichier | API / notes |
|-----------|---------|-------------|
| `Button` | `Button.tsx` | `primary` / `secondary` / `ghost` / `danger` ; sizes `sm` / `md` |
| `Badge` / `StatusBadge` | `Badge.tsx` | Tones officiels ; `StatusBadge` = heuristique sur libellés FR |
| `Card` / `SectionHeader` | `Card.tsx` | Conteneur section standard |
| `Field` / `Input` / `Select` | `Field.tsx` | Labels uppercase + `.input-base` |
| `Modal` | `Modal.tsx` | `role="dialog"` ; **pas** de focus trap / Escape / `aria-labelledby` |
| `ConfirmDialog` | `ConfirmDialog.tsx` | Promise + tone `danger` |
| `Toast` | `Toast.tsx` | `aria-live="polite"` |
| `Table` / `DataTable` | `Table.tsx`, `DataTable.tsx` | `emptyLabel` |
| `DatePicker` | `DatePicker.tsx` | A11y soignée |
| `PagePlaceholder` | `PagePlaceholder.tsx` | « Bientôt disponible » (style distinct du empty métier) |
| `PrintButton` | `PrintButton.tsx` | Impression |

### Sous-ensemble shadcn (`components/ui/shadcn/`)

Usage limité : Login, Landing, Reports.  
Ne pas étendre aux écrans ERP sans décision contraire à DO-011.

### Absents (dette connue, hors D1.1 code)

- `EmptyState` partagé
- `InlineAlert` / bannière d’alerte unifiée
- `LoadingState` / `AccessDeniedState` partagés
- Breadcrumb
- Skip link dans le shell app (présent seulement sur Landing)

---

## 5. Incohérences classées

### P1 — Impact orientation / compréhension

1. Double barre d’onglets (établissement + dossier) sur le workspace élève.
2. Titre Topbar non aligné sur l’entité ouverte.
3. Hiérarchie de titres (`h1` multiples).
4. Statut d’inscription dupliqué (badge + champ `dl` header).

### P2 — Cohérence de design language

5. `TabNav` vs `StudentWorkspaceNavigation` (focus / hauteur tactile).
6. Empty métier dupliqué (~15 occurrences students) ≠ `PagePlaceholder` ≠ « Module à venir ».
7. Alertes : `role="status"` (overview) vs `role="alert"` (édition) ; succès `emerald-*` hors tones Badge.
8. `StatusBadge` heuristique vs maps canoniques (ex. Suspendu : warning enrollment vs danger heuristique).
9. Actions « à venir » : boutons disabled hors `Button`, style opaque.

### P3 — Accessibilité / responsive

10. Modal sans piège de focus ni Escape.
11. Loading / forbidden peu annoncés sémantiquement.
12. Deux `overflow-x-auto` d’onglets empilés sur mobile.
13. Topbar dense sur petit écran.

---

## 6. Risques (synthèse)

| Domaine | Risque |
|---------|--------|
| UX | Perte d’orientation ; action primaire noyée ; écrans passifs |
| A11y | Dialogs incomplets ; titres ; focus inégal |
| Responsive | Double scroll horizontal d’onglets |
| Dette | Dual kit UI ; empty non factorisé ; pas de contrat « résumé → décision » systématique |

---

## 7. Patterns à conserver explicitement

1. Shell fiche : header identité + navigation sections + contenu.
2. `Card` + `SectionHeader` + `dl` pour la lecture métier.
3. Badges à tones + présentations de statut dédiées par domaine.
4. Confirmations destructives via `ConfirmDialog`.
5. Édition contrôlée (review / conflict / unsaved) sur Identité.
6. Empty dashed explicite (intention) — factorisation ultérieure sans changer le sens.
7. Overview : alertes cliquables vers la section concernée.
8. Responsive table → cartes (Responsables) comme référence listes denses.

---

## 8. Hors périmètre D1.1 (rappel)

Ne pas traiter dans cette PR :

- couleurs / typographie globales ;
- navigation ou structure d’onglets ;
- extraction de composants ;
- changements métier, API, permissions, backend.

---

## 9. Suite recommandée (hors D1.1)

Ordre indicatif, chaque sous-phase = PR séparée :

1. **D1.2+** — Appliquer DO-001 / DO-006 / DO-007 / DO-008 sur le résumé / overview Élève (sans refonte globale).
2. Factoriser les états système / empty **après** stabilisation des libellés (DO-012).
3. Aligner `TabNav` sur les garanties a11y de la nav dossier (DO-010).
4. Traiter orientation (titre, breadcrumb, densité des doubles onglets) sous DO-009.
5. Durcir `Modal` (focus / Escape) sous DO-010.

Toute PR cite les DO-xxx impactées.
