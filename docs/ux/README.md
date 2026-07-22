# Framework Produit / UI-UX Somafrik

Documentation **normative** de l’expérience utilisateur Somafrik (Phase D).

Elle joue, pour l’interface, le même rôle que le framework métier de la Phase C :
toute PR UI/UX doit s’y conformer.

## Socle validé (Framework Produit)

| Lot | Document | Statut |
|-----|----------|--------|
| **D1.1** | Vision Produit + Principes UX | ✅ Validé |
| **D1.2** | Architecture de navigation | ✅ Validé |
| **D1.3** | Architecture des pages métier + Patterns + Anti-patterns | ✅ Validé |

Ces trois lots forment le **socle de l’expérience utilisateur** Somafrik.

## Ordre de lecture

1. [Vision Produit](./vision-produit.md)
2. [Principes UX](./principes-ux.md) (dont P14)
3. [Inventaire UI](./inventaire-ui.md) — constat D1.1
4. [Glossaire](./glossaire.md)
5. [Décisions officielles](./decisions-officielles.md) — DO-001 → DO-034
6. [Architecture de navigation](./architecture-navigation.md) — D1.2
7. [Architecture des pages métier](./architecture-pages-metier.md) — D1.3
8. [Patterns Produit](./patterns-produit.md) — P-001 → P-010
9. [Anti-patterns](./anti-patterns.md) — AP-001 → AP-006

## Statut des documents

| Document | Nature | Modifiable sans revue CTO |
|----------|--------|---------------------------|
| Vision, Principes, Glossaire, Décisions | Normatif | Non |
| Architecture de navigation (D1.2) | Normatif — validé CTO | Non |
| Architecture des pages métier (D1.3) | Normatif — validé CTO | Non |
| Patterns Produit / Anti-patterns | Normatif — validé CTO | Non (ajout = revue CTO) |
| Inventaire UI | Descriptif | Oui (mises à jour factuelles) |

## Méthode des spécifications

Chaque spécification D (et, lorsque pertinent, chaque **spécification fonctionnelle**) contient :

1. **Impact sur les modules existants** — tableau Module / Conforme / Écart / Action future  
2. **Patterns Produit** — liste des P-00X concernés  
3. (UI) Vérification qu’aucun **Anti-pattern** n’est introduit  

## Checklist de conformité — dès D2.x

Toute nouvelle implémentation UI est revue avec :

- [ ] Conforme aux **DO** ?
- [ ] Conforme aux **Patterns Produit** (P-00X) ?
- [ ] Aucun **Anti-pattern** (AP-00X) introduit ?
- [ ] Respect de l’**accessibilité** (DO-010) ?
- [ ] Respect de la **navigation** (D1.2 / DO-013 → DO-024) ?
- [ ] Respect du **résumé métier** sur les fiches (DO-028 / P-001) ?
- [ ] Respect du **contexte actif** (DO-023) ?

En revue, on peut écrire :

- `Conforme à DO-028.`
- `Pattern: P-003 (+ P-001).`
- `Anti-pattern AP-002 détecté.`
- `Aucun Anti-pattern introduit.`

## Périmètre documentation Phase D (D1.x)

- Lots D1.1–D1.3 = documentation normative
- Implémentation runtime = lots **D2.x+** citant DO / Patterns / Anti-patterns
