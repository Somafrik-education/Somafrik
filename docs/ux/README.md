# Framework Produit / UI-UX Somafrik

Documentation **normative** de l’expérience utilisateur Somafrik (Phase D).

Elle joue, pour l’interface, le même rôle que le framework métier de la Phase C :
toute PR UI/UX doit s’y conformer.

## Phase D1 — Socle validé ✅

| Lot | Document | Statut |
|-----|----------|--------|
| **D1.1** | Vision Produit + Principes UX | ✅ Validé |
| **D1.2** | Architecture de navigation | ✅ Validé |
| **D1.3** | Architecture des pages métier + Patterns + Anti-patterns | ✅ Validé |
| **D1.4** | Design Language & Design System | ✅ Validé |

Ces quatre documents constituent le **Framework Produit Somafrik** — base des développements des prochaines années.

## Phase D2 — Implémentation progressive (recommandée)

| Lot | Objectif |
|-----|----------|
| **D2.1** | Fondation des composants (Button, Input, Badge, Card, Modal…) sur D1.4 |
| **D2.2** | Layouts (PageLayout, ListLayout, RecordLayout, DashboardLayout…) |
| **D2.3** | Migration progressive des écrans — sans refonte massive |

## Ordre de lecture

1. [Vision Produit](./vision-produit.md)
2. [Principes UX](./principes-ux.md)
3. [Inventaire UI](./inventaire-ui.md)
4. [Glossaire](./glossaire.md)
5. [Décisions officielles](./decisions-officielles.md) — DO-001 → DO-046
6. [Architecture de navigation](./architecture-navigation.md)
7. [Architecture des pages métier](./architecture-pages-metier.md)
8. [Patterns Produit](./patterns-produit.md) — P-001 → P-010
9. [Anti-patterns](./anti-patterns.md) — AP-001 → AP-012
10. [Design Language & Design System](./design-language.md)

## Quatre axes de revue UI (gouvernance mature)

Toute PR UI est évaluée selon :

1. **Décisions Officielles (DO)**  
2. **Patterns Produit (P)**  
3. **Anti-patterns (AP)** — absence requise  
4. **Design Language (D1.4)** — rôles, tokens, sobriété, a11y  

Vérification explicite en revue :

- Respect des DO  
- Respect des Patterns Produit  
- Absence d’Anti-patterns  

## Méthode des spécifications

1. **Impact sur les modules existants**  
2. **Patterns Produit** (si pertinent)  
3. **Anti-patterns**  
4. **Éléments gelés** (depuis D1.4)  

## Checklist de conformité — Phase D2+

- [ ] Conforme aux **DO** (dont DO-045 / DO-046 si évolution DS) ?
- [ ] Conforme aux **Patterns Produit** (P-00X) ?
- [ ] Aucun **Anti-pattern** (AP-00X) ?
- [ ] Respect **Design Language** / rôles / tokens ?
- [ ] Respect **accessibilité** (DO-010 / DO-041) ?
- [ ] Respect **navigation** (D1.2) ?
- [ ] Respect **résumé métier** (DO-028 / P-001) ?
- [ ] Respect **contexte actif** (DO-023) ?
