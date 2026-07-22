# Framework UI/UX Somafrik

Documentation **normative** de l’expérience utilisateur Somafrik (Phase D).

Elle joue, pour l’interface, le même rôle que le framework métier de la Phase C :
toute PR UI/UX doit s’y conformer.

## Ordre de lecture

### Socle D1.1 (validé)

1. [Vision Produit](./vision-produit.md) — pourquoi l’UI Somafrik existe
2. [Principes UX](./principes-ux.md) — règles de conception applicables (dont P14)
3. [Inventaire UI](./inventaire-ui.md) — état actuel, patterns, dette (audit D1.1)
4. [Glossaire](./glossaire.md) — vocabulaire officiel
5. [Décisions officielles](./decisions-officielles.md) — référentiel DO-xxx pour les revues de PR

### Extension D1.2 (validée CTO)

6. [Architecture de navigation](./architecture-navigation.md) — niveaux, contexte actif, shell, locale, breadcrumb, onglets, responsive, états, impact modules

## Statut

| Document | Nature | Modifiable sans revue CTO |
|----------|--------|---------------------------|
| Vision, Principes, Glossaire, Décisions | Normatif | Non |
| Architecture de navigation (D1.2) | Normatif — validé CTO | Non |
| Inventaire UI | Descriptif (constat D1.1) | Oui (mises à jour factuelles) |

## Périmètre documentation Phase D

- Documentation uniquement pour D1.1 et D1.2
- Aucun changement CSS, composants, navigation runtime, API, permissions ou backend dans ces lots
- Implémentation navigation : lots D2.x+ citant les DO

## Méthode à partir de D1.2

Chaque spécification D se termine par un chapitre **« Impact sur les modules existants »**  
(tableau Module / Conforme / Écart / Action future) — indicateur de maturité du Framework UI/UX.

## Gouvernance des DO (exigences d’acceptation)

À partir de D1.2, chaque **Décision Officielle (DO-xxx)** est une exigence d’acceptation des PR UI, sur le modèle des règles métier Phase C.

En revue, on peut écrire :

- `Conforme à DO-017.`
- `Non conforme à DO-021.`
- `Conforme à DO-024.`

## Usage en revue de PR

1. Vérifier la conformité aux [Décisions officielles](./decisions-officielles.md) (DO-xxx).
2. Contrôler l’alignement avec les [Principes UX](./principes-ux.md) (dont P14).
3. Utiliser le [Glossaire](./glossaire.md) pour les libellés et concepts.
4. Pour toute évolution de navigation : respecter l’[Architecture de navigation](./architecture-navigation.md) et DO-013 → DO-024.
5. Ne pas introduire de pattern contradictoire avec l’inventaire sans décision DO explicite.
