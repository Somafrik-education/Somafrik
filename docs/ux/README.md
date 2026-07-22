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

### Extension D1.3 (spécification — validation CTO requise)

7. [Architecture des pages métier](./architecture-pages-metier.md) — types de pages, fiche, liste, dashboards, résumé, actions, surfaces, états
8. [Patterns Produit](./patterns-produit.md) — catalogue P-001 → P-010 (bibliothèque de référence)

## Statut

| Document | Nature | Modifiable sans revue CTO |
|----------|--------|---------------------------|
| Vision, Principes, Glossaire, Décisions | Normatif | Non |
| Architecture de navigation (D1.2) | Normatif — validé CTO | Non |
| Architecture des pages métier (D1.3) | Normatif (sous réserve validation CTO) | Non |
| Patterns Produit | Normatif (sous réserve validation CTO avec D1.3) | Non (ajout de Pattern = revue CTO) |
| Inventaire UI | Descriptif (constat D1.1) | Oui (mises à jour factuelles) |

## Périmètre documentation Phase D

- Documentation uniquement pour D1.1, D1.2 et D1.3
- Aucun changement CSS, composants, navigation runtime, API, permissions ou backend dans ces lots
- Implémentation : lots D2.x+ citant les DO et Patterns

## Méthode à partir de D1.2 / D1.3

Chaque spécification D contient :

1. Un chapitre **« Impact sur les modules existants »** (Module / Conforme / Écart / Action future)
2. Une section **« Patterns Produit »** (à partir de D1.3) — déclaration des P-00X concernés

## Gouvernance des DO et Patterns

Les **DO-xxx** et les **Patterns Produit (P-00X)** sont des exigences d’acceptation des PR UI.

En revue, on peut écrire :

- `Conforme à DO-028.`
- `Non conforme à DO-031.`
- `Pattern: P-003 (+ P-001).`
- `Conforme à P-002.`

## Usage en revue de PR

1. Vérifier la conformité aux [Décisions officielles](./decisions-officielles.md) (DO-xxx).
2. Contrôler l’alignement avec les [Principes UX](./principes-ux.md).
3. Utiliser le [Glossaire](./glossaire.md) pour les libellés et concepts.
4. Navigation : [Architecture de navigation](./architecture-navigation.md) · DO-013 → DO-024.
5. Pages métier : [Architecture des pages métier](./architecture-pages-metier.md) · DO-025 → DO-033.
6. Déclarer le [Pattern Produit](./patterns-produit.md) (DO-032).
7. **DO-033 :** pas d’implémentation structures de pages D1.3 tant que non validé CTO.
