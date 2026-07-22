# Design Language & Design System Somafrik — D1.4

**Statut :** normatif — **validé CTO** (APPROVE WITH COMMENTS, amendements intégrés)  
**Phase :** D1.4 — clôture de la Phase D1 (Framework Produit)  
**Nature :** spécification uniquement dans cette PR — l’implémentation relève de la Phase D2  
**Références :** [Vision](./vision-produit.md) · [Principes](./principes-ux.md) · [Navigation](./architecture-navigation.md) · [Pages métier](./architecture-pages-metier.md) · [Patterns](./patterns-produit.md) · [Anti-patterns](./anti-patterns.md) · [Décisions](./decisions-officielles.md) · [Glossaire](./glossaire.md)

Cette spécification définit le **Design Language officiel** de Somafrik et l’architecture du **Design System**.  
Elle doit rester valable plusieurs années et servir de base à tous les composants UI.

Avec D1.1–D1.3, elle constitue le **socle Framework Produit** Somafrik.  
L’implémentation progressive s’ouvre en **Phase D2** (DO-042 levé).

---

## 0. Constat de l’existant (audit code)

Analyse `web/` (branche `develop`) — descriptif uniquement.

| Domaine | Existant | Écart vs D1.4 |
|---------|----------|---------------|
| Couleurs ERP | Tokens Tailwind `ink`, `muted`, `line`, `brand`, `teal`, `amber`, `danger`, `canvas` | Noms partiels ; pas de catalogue de **rôles** sémantiques gelé |
| Couleurs shadcn | Variables HSL `:root` (`primary`, `destructive`, `border`…) | **Double système** parallèle au kit ERP |
| Typographie | Famille Inter + utilitaires Tailwind ad hoc | Pas de hiérarchie typographique documentée |
| Rayons / ombres | `--radius`, `shadow-card` / `brand` / `lift` | Non catalogués comme tokens DS |
| Dark mode | `darkMode: ["class"]` présent | UI ERP globalement claire ; thème sombre non productisé |
| Motion | `blob` / `float` (marketing) + transitions utilitaires | Pas de politique motion ERP |
| Icônes | Lucide largement utilisé | Pas de règles d’usage officielles |
| Kit UI | `components/ui/*` (ERP) + `ui/shadcn/*` (auth/marketing/reports) | Dette dual-kit (DO-011) |

---

## 1. Philosophie visuelle

### Identité produit

Somafrik est un **ERP scolaire de confiance** : sérieux, clair, orienté décision.  
L’interface doit inspirer la fiabilité administrative (notes, paiements, dossiers élèves) sans paraître froide ni « startup décorative ».

### Personnalité

| Trait | Niveau cible | Pourquoi |
|-------|--------------|----------|
| Professionnel | Fort | Contexte scolaire / administratif multi-pays |
| Clair | Fort | Décision rapide (Vision Produit) |
| Chaleureux | Modéré | Humanité (élèves, familles) sans infantiliser |
| Expressif / playful | Faible | Éviter le bruit visuel qui concurrence l’information |

### Ton visuel

- **Sobre, lisible, structuré**
- Surfaces calmes ; accent couleur réservé au sens métier et aux actions
- Pas de décoration gratuite sur les écrans ERP authentifiés

### Densité

- **Densité moyenne à élevée** (outil de travail, pas landing)
- Tableaux, formulaires et fiches privilégient l’information utile
- Respirations contrôlées via l’échelle d’espacement (pas de « vide luxe »)

### Sobriété

- Hiérarchie par typo, poids, espace et tones — pas par effets multiples
- Une action primaire visuelle par zone (DO-002)
- Ombres et gradients **limités** aux surfaces qui en ont besoin (cards, focus)

### Lisibilité

- Contraste texte / fond conforme aux minima a11y
- Libellés métier explicites ; la couleur ne porte jamais seule le sens (DO-004, AP-005)
- Tailles tactiles / focus visibles

### Hiérarchie de l’information

Ordre de lecture cible sur une page métier :

1. Orientation (où suis-je / contexte)  
2. Résumé / constat  
3. Alertes / risques  
4. Action primaire  
5. Détail / tableau / sections  

Aligné Vision Produit + P-001 + P14.

---

## 2. Principes du Design System

| Principe | Exigence |
|----------|----------|
| **Cohérence** | Mêmes rôles, mêmes densités, mêmes états d’un module à l’autre |
| **Simplicité** | Pas de style « one-off » sans Pattern / DO |
| **Lisibilité** | Information métier avant ornement |
| **Accessibilité** | Contraste, focus, clavier, zones tactiles — non négociable (DO-010, DO-041) |
| **Réutilisabilité** | Composants construits sur tokens et rôles, pas sur valeurs magiques |
| **Évolutivité** | Les **rôles** et **familles** sont stables ; les **valeurs** (hex, px) peuvent évoluer |
| **Sémantique d’abord** | On consomme `danger` / `success` / `text-muted`, pas `#dc2626` en dur |
| **Un kit ERP** | Le kit `components/ui/*` reste la source de vérité ERP (DO-011, DO-040) |

---

## 3. Familles de tokens (structure uniquement)

**Aucune valeur n’est fixée dans D1.4.**  
Seule l’architecture des familles est définie (gelée — voir §18).

| Famille | Contenu typique (structure) | Consommateurs |
|---------|----------------------------|---------------|
| **Couleur** | Rôles sémantiques + échelles optionnelles | Badges, boutons, surfaces, textes |
| **Typographie** | Familles, rôles de texte, graisses, interlignages | Titres, corps, labels, captions |
| **Espacement** | Échelle d’espace (stack, inline, inset) | Layouts, cards, formulaires |
| **Rayon** | Niveaux de bord (contrôle, carte, pill…) | Inputs, cards, badges |
| **Élévation / Ombre** | Niveaux d’élévation sémantiques | Cards, modals, dropdowns |
| **Bordure** | Largeur / style liés aux rôles surface | Séparateurs, inputs |
| **Motion** | Durées, easings, réductions `prefers-reduced-motion` | Transitions UI |
| **Icône** | Tailles, stroke, alignement au texte | Lucide / équivalent |
| **Dimension** | Hauteurs de contrôle, largeurs max contenu | Boutons, inputs, shell |
| **Z-index** | Couches nommées (base, sticky, dropdown, modal, toast…) | Superpositions |
| **Breakpoint** | Surfaces responsive nommées | Layouts |
| **Opacité / Disabled** | États désactivés / overlays | Contrôles inertes |

### Règles tokens

1. Toute valeur visuelle runtime doit provenir d’un token (ou d’une primitive qui l’encapsule).
2. Interdit d’introduire une **nouvelle famille** sans amendement D + validation CTO.
3. Changer une **valeur** (nouvelle palette) ne rouvre pas les **rôles** gelés.

---

## 4. Couleurs sémantiques (rôles uniquement)

**Pas de codes hexadécimaux dans D1.4.**  
Les rôles suivants sont officiels et gelés :

### Rôles de marque & action

| Rôle | Usage |
|------|-------|
| **Primary** | Action / accent principal, navigation active, liens forts |
| **Secondary** | Action secondaire, surfaces d’appui |
| **Primary foreground** | Texte / icône sur fond Primary |
| **Secondary foreground** | Texte / icône sur fond Secondary |

### Rôles d’état métier / feedback

| Rôle | Usage |
|------|-------|
| **Success** | État positif / conforme / payé / actif sain |
| **Warning** | Attention / en attente / risque non bloquant |
| **Danger** | Erreur, retard critique, destructif, alerte haute |
| **Info** | Information neutre utile |

Alignés aux tones Badge existants (`neutral`, `success`, `warning`, `danger`, `info`) — les **noms de rôles** priment sur les implémentations actuelles (`teal`/`amber`/`brand`…).

### Rôles de surface & structure

| Rôle | Usage |
|------|-------|
| **Background** | Fond de page (canvas applicatif) |
| **Surface** | Carte, panneau, zone de contenu |
| **Surface elevated** | Surface au-dessus (dropdown, popover) |
| **Border** | Contours, séparateurs |
| **Text** | Texte principal |
| **Text muted** | Texte secondaire / meta |
| **Text inverse** | Texte sur fond saturé |
| **Disabled** | Fond / texte / bordure désactivés |
| **Focus ring** | Indicateur de focus clavier |
| **Overlay** | Voile modal / drawer |

### Règles

1. Un statut métier mappe vers un rôle d’état — jamais vers un hex local.
2. Success / Warning / Danger / Info restent distincts (pas de fusion ad hoc).
3. Les valeurs concrètes pourront évoluer (rebrand) **sans** renommer ces rôles.

---

## 5. Typographie

### Rôles typographiques (hiérarchie gelée)

| Rôle | Intention |
|------|-----------|
| **Display** | Marketing / hero uniquement (hors ERP dense) |
| **Title (H1 page)** | Titre principal de Vue / Fiche |
| **Subtitle (H2)** | Titre de section majeure |
| **Section (H3)** | Titre de `SectionHeader` / sous-bloc |
| **Body** | Texte courant |
| **Body emphasis** | Corps renforcé |
| **Label** | Libellé de champ / meta uppercase contrôlée |
| **Caption** | Aide, horodatage, légende |
| **Code / Mono** | Identifiants techniques rares (debug, IDs) |

### Règles

1. Un seul **Title (H1)** visible pertinent par vue contenu (cohérent DO-010 ; le titre Topbar peut être aligné sans concurrence visuelle).
2. Les écrans ERP n’utilisent **Display** que rarement (idéalement jamais hors Landing).
3. La famille de police concrète n’est **pas gelée** ici — seul le **système de rôles** l’est.
4. Graisses : privilégier une échelle courte (regular / medium / semibold / bold) sans proliferation.

---

## 6. Espacements

### Logique (pas de valeurs)

- Une **échelle unique** d’espacement sert marges, gaps et paddings.
- Distinguer :
  - **Inset** — padding interne d’un composant  
  - **Stack** — espacement vertical entre blocs  
  - **Inline** — espacement horizontal entre éléments  
  - **Section gap** — entre sections de page  
- Les pages métier utilisent des multiples de l’échelle — pas d’espaces « magiques » hors échelle.
- Densité : les listes / outils peuvent utiliser des insets plus compacts que les hubs marketing.

---

## 7. Icônes

| Règle | Détail |
|-------|--------|
| **Quand utiliser** | Renforcer une action, un onglet, un état, un accès rapide — en complément du libellé |
| **Quand éviter** | Remplacer un libellé critique ; décorer sans sens ; multiplier les icônes dans un tableau dense |
| **Taille** | Bornée à un set de tailles tokenisées (alignées au texte adjacent) |
| **Signification** | Stable dans tout le produit (même icône = même concept) |
| **Accessibilité** | Si seule porteuse de sens → `aria-label` ; sinon `aria-hidden` |
| **Style** | Trait cohérent (ex. Lucide stroke) — pas de mélange de familles iconographiques sur ERP |

---

## 8. Illustrations

| Règle | Détail |
|-------|--------|
| **ERP authentifié** | Illustrations **rares** ; Empty / Coming soon restent sobres et textuels en priorité |
| **Marketing / Auth** | Illustrations / visuels autorisés s’ils servent la compréhension ou la marque |
| **Interdit** | Illustrations qui retardent le chargement d’un écran opérationnel critique |
| **Ton** | Cohérent avec la sobriété Somafrik — pas de mascotte envahissante sur les fiches |
| **Accessibilité** | Alternatives textuelles ; ne jamais porter seule une info critique |

---

## 9. Animations / motion

| Utiliser | Ne pas utiliser |
|----------|-----------------|
| Feedback court (hover, focus, ouverture modal) | Distraire pendant une saisie critique |
| Orientation (apparition d’alerte, transition d’onglet légère) | Animations continues type marketing sur ERP |
| Skeleton / reveal de chargement discret | Bloquer l’interaction pendant une animation longue |

### Règles

1. Durées : échelle courte tokenisée (ex. rapide / normale / lente) — **valeurs non fixées ici**.
2. Respecter `prefers-reduced-motion` : réduire ou supprimer les motions non essentielles.
3. La motion **sert la hiérarchie**, jamais le spectacle (cohérent Vision Produit).
4. Les animations `blob` / `float` restent hors écrans ERP métier.

---

## 10. Responsive — surfaces officielles

| Surface | Intention | Notes d’expérience |
|---------|-----------|-------------------|
| **Grand écran** | Productivité maximale | Sidebar + multi-colonnes ; largeur de contenu maîtrisée (`max-w` shell) |
| **Desktop** | Usage principal ERP | Densité complète ; tableaux ; onglets |
| **Laptop** | Desktop compact | Même chrome ; réduire colonnes secondaires avant de casser la nav |
| **Tablette** | Drawer modules ; outils tactiles | Onglets scrollables ; filtres compactés |
| **Mobile** | Une intention à la fois | Résumé d’abord ; cartes vs tableaux denses ; zones tactiles |

Les breakpoints concrets restent des **valeurs de tokens** (non gelées en D1.4) ; les **noms de surfaces** sont gelés.  
Alignement avec D1.2 §7 et D1.3 §9.

---

## 11. Accessibilité — règles minimales

| Domaine | Règle minimale |
|---------|----------------|
| **Contraste** | Texte et états critiques conformes WCAG AA (cible) |
| **Focus** | Focus visible sur tout contrôle interactif ; jamais `outline: none` sans alternative |
| **Clavier** | Parcours complet : nav, onglets, modals, dialogues, menus |
| **ARIA** | Rôles / labels / états quand le HTML sémantique ne suffit pas ; modals nommés |
| **Zones tactiles** | Cible minimale confortable sur mobile / tablette (onglets, icônes Topbar) |
| **Couleur** | Jamais seul canal d’information (AP-005 / DO-004) |
| **Motion** | `prefers-reduced-motion` respecté |
| **Titres** | Hiérarchie logique ; éviter H1 multiples concurrents |

---

## 12. Dark Mode

### Décision

Le Design System **doit pouvoir le supporter** (architecture tokens / rôles),  
mais **ne le productise pas** comme thème ERP obligatoire à ce stade.

| Option | Choix |
|--------|-------|
| Doit le supporter dès maintenant (UI ERP sombre) | ❌ Non |
| **Pourra le supporter** (tokens dual-theme prêts conceptuellement) | ✅ **Oui** |
| Ne le supportera jamais | ❌ Non |

### Justification

1. L’ERP actuel est **clair** et opérationnel ; la priorité est la cohérence light + lisibilité.
2. `darkMode: ["class"]` existe déjà techniquement, sans UI ERP aboutie → dette, pas une promesse produit.
3. Geler les **rôles** (pas les hex) permet d’ajouter un thème sombre plus tard **sans** casser l’architecture.
4. Un dark mode mal contrasté sur données scolaires (notes, alertes) serait plus risqué qu’utile aujourd’hui.

### Règle

Toute nouvelle famille de tokens couleur doit rester **mappable** light (et ultérieurement dark) via les mêmes rôles.

---

## 13. Anti-patterns Design System

Catalogue étendu : [`anti-patterns.md`](./anti-patterns.md).

| ID | Anti-pattern |
|----|--------------|
| **AP-007** | Hardcoder une couleur / taille / ombre hors tokens sur un écran ERP |
| **AP-008** | Inventer un rôle de couleur non catalogué (« purple accent », « soft pink ») |
| **AP-009** | Animation décorative qui retarde ou concurrence la compréhension métier |
| **AP-010** | Mélanger kit ERP et kit secondaire sur le même écran métier |
| **AP-011** | Contrôle interactif sous la taille tactile minimale sur mobile |
| **AP-012** | Casser la hiérarchie typographique (titres concurrents, Display en liste ERP) |

---

## 14. Patterns Produit concernés

D1.4 ne crée pas de nouveau Pattern de page ; il **contraint l’apparence** de tous les Patterns existants.

| Pattern | Impact Design Language |
|---------|------------------------|
| P-001 Résumé métier | Typo Title/Body, rôles Success/Warning/Danger, densité |
| P-002 Liste | Densité tableau, espacements, états Disabled/Empty |
| P-003 Fiche | Hiérarchie, surfaces, focus onglets |
| P-004 / P-005 Dashboards | KPI vivants, sobriété charts |
| P-006 Hub | Cards surface, Title/Caption |
| P-007 Outil | Densité haute, zones tactiles |
| P-008 Assistant | Progression claire, motion discrète |
| P-009 Modal | Élévation, focus trap, overlay |
| P-010 Rapport | Lisibilité export / contraste |

---

## 15. Décisions officielles (Design System)

| ID | Titre |
|----|-------|
| **DO-035** | Design Language officiel Somafrik |
| **DO-036** | Familles de tokens — structure gelée |
| **DO-037** | Rôles de couleurs sémantiques gelés |
| **DO-038** | Hiérarchie typographique gelée |
| **DO-039** | Dark mode : supportable par architecture, non productisé |
| **DO-040** | Un seul kit visuel ERP (renforce DO-011) |
| **DO-041** | Minima accessibilité du Design System |
| **DO-042** | Validation CTO avant implémentation Design System *(levé — D1.4 validé)* |
| **DO-043** | Gouvernance des Éléments gelés |
| **DO-044** | Anti-patterns Design System (AP-007 → AP-012) |
| **DO-045** | Compatibilité ascendante du Design System |
| **DO-046** | Dépréciation contrôlée |

---

## 16. Impact sur les modules existants

Légende : ✅ conforme · ⚠️ écart partiel · ❌ non conforme · — N/A

| Module | Conforme | Écart | Action future |
|--------|----------|-------|---------------|
| Shell (Sidebar / Topbar) | ⚠️ | Tokens ERP utilisés ; pas encore rôles DS documentés ; dual naming brand/primary | D2.x tokens |
| Landing / Auth | ⚠️ | Kit shadcn + motion marketing | Maintenir hors ERP ; ne pas propager |
| Tableau de bord | ⚠️ | Charts + tokens mixtes | D2.x |
| Mon établissement / Élèves | ⚠️ | Kit ERP dominant ; tons Badge OK ; h1 / densités à aligner | D2.x |
| Finances | ⚠️ | KPI + danger/amber ad hoc possibles | D2.x rôles |
| Planning | ⚠️ | CSS planning dédié (`--planning-brand`) parallèle | Audit tokens |
| Administration / Paramètres | ⚠️ | Placeholders + kit ERP | D2.x |
| Reports | ⚠️ | shadcn Card sur surface ERP | DO-040 |
| Mobile web responsive | ⚠️ | Breakpoints Tailwind ; pas de surfaces nommées DS | D2.x |
| Modules futurs | — | — | Appliquer D1.4 dès création |

---

## 17. Dette actuelle (écarts — sans implémentation)

### Incohérences

1. Double système de couleurs (tokens ERP Tailwind vs variables shadcn).
2. Noms historiques (`ink`, `teal`, `amber`) ≠ rôles sémantiques officiels D1.4.
3. Typographie Inter partout sans échelle de rôles documentée.
4. Motion marketing potentiellement réutilisable hors contexte.
5. `--planning-brand` et styles locaux hors catalogue.

### Doublons

1. `primary` (shadcn) ≈ `brand` (ERP).
2. `destructive` ≈ `danger`.
3. Ombres nommées vs utilitaires Tailwind bruts.

### Risques

1. Rebrand impossible sans chasse aux hex si les rôles ne sont pas adoptés.
2. Propagation du kit shadcn dans l’ERP (AP-010).
3. Dark mode activable techniquement mais non conçu → contrastes cassés si activé trop tôt.
4. Densités divergentes entre EntityPage et pages custom.

---

## 18. Éléments gelés

À partir de D1.4, chaque spécification comporte ce chapitre.  
**Gelé** = structure / rôle / décision stable. Les **valeurs d’implémentation** peuvent évoluer sans rouvrir l’architecture.

| Élément | Statut | Peut encore évoluer |
|---------|--------|---------------------|
| Philosophie visuelle (§1) — traits | **Gelé** | Affinages mineurs de wording |
| Principes du Design System (§2) | **Gelé** | — |
| Familles de tokens (§3) | **Gelé** | Ajout de famille = amendement CTO |
| Rôles de couleurs sémantiques (§4) | **Gelé** | **Valeurs** hex / HSL |
| Hiérarchie typographique / rôles (§5) | **Gelé** | Famille de police, tailles px/rem |
| Logique d’espacement (§6) | **Gelé** | Valeurs de l’échelle |
| Règles icônes / illustrations / motion (§7–9) | **Gelé** | Librairie d’icônes, durées exactes |
| Surfaces responsive nommées (§10) | **Gelé** | Breakpoints px |
| Minima accessibilité (§11) | **Gelé** | Outils de mesure |
| Posture Dark Mode (§12) | **Gelé** | Implémentation d’un thème sombre ultérieur |
| Anti-patterns AP-007 → AP-012 | **Gelé** | Nouveaux AP par amendement |
| Catalogue Patterns P-001 → P-010 (D1.3) | **Gelé** (rappel) | Nouveaux P par amendement |
| Types de pages / structures Fiche-Liste (D1.3) | **Gelé** (rappel) | Détails d’implémentation |
| Niveaux de navigation + Contexte (D1.2) | **Gelé** (rappel) | UI des sélecteurs |
| DO-001 → DO-046 | **Gelé** une fois validés | Amendement CTO uniquement |
| Compatibilité ascendante / dépréciation (DO-045, DO-046) | **Gelé** | Plans de migration documentés |

### Ce qui n’est volontairement **pas** gelé

- Codes couleur hex / HSL concrets  
- Famille de police exacte et corps en px  
- Valeurs d’espacement, rayons, ombres  
- Durées d’animation en ms  
- Breakpoints en px  
- Choix d’implémentation Tailwind vs CSS variables (tant que les rôles sont respectés)

---

## 19. Suite recommandée — Phase D2 (hors D1.4)

Ordre indicatif CTO pour l’implémentation progressive :

| Lot | Objectif |
|-----|----------|
| **D2.1** | Fondation des composants (Button, Input, Badge, Card, Modal…) strictement sur D1.4 |
| **D2.2** | Layouts (PageLayout, ListLayout, RecordLayout, DashboardLayout…) |
| **D2.3** | Migration progressive des écrans existants vers Patterns / DS — sans refonte massive |

Chaque lot D2 cite DO / P / AP et respecte DO-045 / DO-046.

---

## 20. Validation CTO

| Critère | Statut |
|---------|--------|
| Philosophie visuelle (sobre, dense, lisible, ERP) | ✅ Validé |
| Structure tokens avant valeurs | ✅ Validé |
| Posture Dark Mode | ✅ Validé |
| Anti-patterns AP-007 → AP-012 | ✅ Validé |
| Éléments gelés (méthode pérenne) | ✅ Validé |
| Dette documentée sans refactor immédiat | ✅ Validé |
| DO-045 Compatibilité ascendante | ✅ Intégré |
| DO-046 Dépréciation contrôlée | ✅ Intégré |
| DO-035 → DO-046 | ✅ Intégrés |

**Décision CTO :** APPROVE WITH COMMENTS — amendements intégrés.  
**Fusion :** autorisée.  
**Phase D1 :** clôturée. **Phase D2 :** recommandée ensuite.
