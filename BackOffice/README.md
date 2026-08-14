# BackOffice (retiré — LOT 8)

L'application autonome `BackOffice/` est **dépréciée et retirée**.

- Plus de `GET /api/backoffice/state` (lecture globale supprimée).
- Plus de `PUT /api/backoffice/state` (écriture globale supprimée depuis LOT 8).
- Plus de polling ni de synchronisation snapshot côté client.

## Remplacement

- **Web** : `/web/` (React)
- **Mobile** : application React Native
- **APIs métier** : routes dédiées par domaine (`/api/backoffice/establishments`, `/api/students`, etc.)

Cette page statique redirige vers `/web/` pour les anciennes URL.
