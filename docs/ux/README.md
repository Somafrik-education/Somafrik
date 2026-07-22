# Framework Produit / UI-UX Somafrik

Documentation **normative** de l’expérience utilisateur Somafrik (Phase D).

Elle joue, pour l’interface, le même rôle que le framework métier de la Phase C :
toute PR UI/UX doit s’y conformer.

## Socle Framework Produit

| Lot | Document | Statut |
|-----|----------|--------|
| **D1.1** | Vision Produit + Principes UX | ✅ Validé |
| **D1.2** | Architecture de navigation | ✅ Validé |
| **D1.3** | Architecture des pages métier + Patterns + Anti-patterns | ✅ Validé |
| **D1.4** | Design Language & Design System | ⏳ Spécification — validation CTO |

## Ordre de lecture

1. [Vision Produit](./vision-produit.md)
2. [Principes UX](./principes-ux.md)
3. [Inventaire UI](./inventaire-ui.md) — constat D1.1
4. [Glossaire](./glossaire.md)
5. [Décisions officielles](./decisions-officielles.md) — DO-001 → DO-044
6. [Architecture de navigation](./architecture-navigation.md) — D1.2
7. [Architecture des pages métier](./architecture-pages-metier.md) — D1.3
8. [Patterns Produit](./patterns-produit.md) — P-001 → P-010
9. [Anti-patterns](./anti-patterns.md) — AP-001 → AP-012
10. [Design Language & Design System](./design-language.md) — D1.4

## Statut des documents

| Document | Nature | Modifiable sans revue CTO |
|----------|--------|---------------------------|
| Vision, Principes, Glossaire, Décisions | Normatif | Non |
| Architecture navigation / pages (D1.2 / D1.3) | Normatif — validé CTO | Non |
| Patterns / Anti-patterns | Normatif — validé CTO | Non (ajout = revue CTO) |
| Design Language (D1.4) | Normatif (sous réserve validation CTO) | Non |
| Inventaire UI | Descriptif | Oui (mises à jour factuelles) |

## Méthode des spécifications (à partir de D1.4)

Chaque spécification D contient :

1. **Impact sur les modules existants** — Module / Conforme / Écart / Action future  
2. **Patterns Produit** — P-00X concernés (si pertinent)  
3. Vérification **Anti-patterns** (AP-00X)  
4. **Éléments gelés** — ce qui est stable vs ce qui peut encore évoluer (valeurs)  

## Checklist de conformité — dès D2.x

- [ ] Conforme aux **DO** ?
- [ ] Conforme aux **Patterns Produit** (P-00X) ?
- [ ] Aucun **Anti-pattern** (AP-00X) introduit ?
- [ ] Respect de l’**accessibilité** (DO-010 / DO-041) ?
- [ ] Respect de la **navigation** (D1.2) ?
- [ ] Respect du **résumé métier** (DO-028 / P-001) ?
- [ ] Respect du **contexte actif** (DO-023) ?
- [ ] Respect du **Design Language** / tokens / rôles (D1.4) — après validation CTO ?

## Périmètre documentation Phase D (D1.x)

- Lots D1.1–D1.4 = documentation normative dans leurs PR
- **Aucune** modification runtime dans D1.4 (DO-042)
- Implémentation visuelle / tokens = lots **D2.x+** après validation CTO
