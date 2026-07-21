# Framework UI/UX Somafrik

Documentation **normative** de l’expérience utilisateur Somafrik (Phase D).

Elle joue, pour l’interface, le même rôle que le framework métier de la Phase C :
toute PR UI/UX doit s’y conformer.

## Ordre de lecture (D1.1)

1. [Vision Produit](./vision-produit.md) — pourquoi l’UI Somafrik existe
2. [Principes UX](./principes-ux.md) — règles de conception applicables
3. [Inventaire UI](./inventaire-ui.md) — état actuel, patterns, dette (audit D1.1)
4. [Glossaire](./glossaire.md) — vocabulaire officiel
5. [Décisions officielles](./decisions-officielles.md) — référentiel DO-xxx pour les revues de PR

## Statut

| Document | Nature | Modifiable sans revue CTO |
|----------|--------|---------------------------|
| Vision, Principes, Glossaire, Décisions | Normatif | Non |
| Inventaire UI | Descriptif (constat D1.1) | Oui (mises à jour factuelles) |

## Périmètre D1.1

- Documentation uniquement
- Aucun changement CSS, composants, navigation, API, permissions ou backend

## Usage en revue de PR

1. Vérifier la conformité aux [Décisions officielles](./decisions-officielles.md) (DO-xxx).
2. Contrôler l’alignement avec les [Principes UX](./principes-ux.md).
3. Utiliser le [Glossaire](./glossaire.md) pour les libellés et concepts.
4. Ne pas introduire de pattern contradictoire avec l’inventaire sans décision DO explicite.
