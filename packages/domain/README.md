# Domaine Somafrik V2

Le domaine contient les invariants métier indépendants des frameworks, de PostgreSQL et des interfaces.

## Premier invariant : tenant scope

Toute opération V2 reçoit un scope explicite :

- `platform` : plateforme globale, sans pays ni établissement ;
- `country` : un pays obligatoire, aucun établissement ;
- `school` : un pays et un établissement obligatoires.

Une combinaison incomplète ou ambiguë est rejetée. Cet objet ne donne aucun droit à lui seul : l'autorisation sera ajoutée dans `packages/auth` et restera fail-closed.
