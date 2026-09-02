# Synchronisation canonique — garde-fou fail-closed

## Problème constaté

`DataContext.update()` retirait silencieusement les domaines PostgreSQL canoniques avant la synchronisation résiduelle. Un appelant Web encore ancien pouvait donc obtenir une promesse résolue alors que sa mutation canonique n'avait jamais été persistée.

Exemple confirmé : le chemin `Établissements → Créer admin établissement` envoie encore `users` via `DataContext.update()` au lieu de `POST /api/backoffice/users` puis `POST /api/backoffice/users/:id/roles/grant`.

## Correctif de cette PR

- toute clé supprimée par les protections canoniques déclenche désormais une erreur explicite avant mutation locale/outbox ;
- aucun domaine PostgreSQL n'est réécrit via le JSON résiduel ;
- le résiduel reste limité à `academicConfigs` via son API dédiée ;
- test unitaire du garde-fou.

## Gate restant avant merge

Cette PR ne doit pas être mergée tant que les appelants Web actifs encore basés sur `DataContext.update()` pour un domaine canonique ne sont pas migrés vers leurs APIs métier dédiées. Le premier appelant confirmé est `SchoolsPage.createSchoolAdmin()`.
