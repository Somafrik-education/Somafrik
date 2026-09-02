# P1 REMOVE-LEGACY-SYNC-CORE

## Objectif

Supprimer les derniers mécanismes legacy qui peuvent entretenir une divergence entre les interfaces Somafrik et PostgreSQL. La cible reste exclusivement :

`Web + Mobile -> API métier dédiée -> PostgreSQL canonique`.

Le BackOffice historique ne fait plus partie de l'architecture cible.

## PR1 — suppression physique de l'UI BackOffice legacy

Cette première PR retire les fichiers exécutables et statiques de l'ancienne application `BackOffice/` :

- `BackOffice/index.html`
- `BackOffice/styles.css`
- anciens logos/assets du BackOffice
- ancienne implémentation `BackOffice/app.js`

Un fichier `BackOffice/app.js` minimal et inerte est conservé temporairement comme **tombstone** parce que les scripts racine historiques `check` et `typecheck:backend` exécutent encore `node --check BackOffice/app.js`. Il ne contient aucun bootstrap UI, aucun accès réseau et aucun appel API.

Le canal global de données reste fail-closed :

- `GET /api/backoffice/state` -> endpoint supprimé / Gone
- `PUT /api/backoffice/state` -> endpoint supprimé / Gone

Le gate `scripts/verify-remove-legacy-sync-core.js` bloque en CI et Security toute réintroduction des fichiers UI historiques ou de logique dans le tombstone.

## Écarts backend encore actifs — PR2

`backend/server.js` conserve encore l'agrégat de transition `getAuthoritativeBackOfficeState()`. Il compose un runtime puis superpose des projections PostgreSQL (`clients`, `platform`, `pedagogy`, `finance`, `residual`). Plusieurs routes métier l'utilisent encore pour leur lecture, leur scoping ou leur enrichissement.

La PR2 devra migrer ces usages route par route vers les repositories PostgreSQL directs, sans régression RBAC/tenant :

- `/api/courses`
- `/api/course-schedules`
- `/api/assignments`
- `/api/users` et reset-password
- `/api/announcements`
- routes établissements
- impayés / rappels finance
- subscription-access
- auth Parent/Enseignant et refresh de session
- rapports/bulletins historiques encore dépendants du runtime global
- helpers de permissions/subscription qui reconstruisent encore l'état global

Une suppression globale de `getAuthoritativeBackOfficeState()` ne doit être faite qu'après disparition de tous ses appelants actifs et couverture contractuelle équivalente.

### Fallback à supprimer

`listCanonicalStudentsForPrincipal()` utilise `repository.listSchoolStudents()` pour un établissement concret mais retombe encore sur le runtime lorsque `schoolCode` est vide ou `*`. La PR2 doit remplacer ce fallback par une requête PostgreSQL explicitement scopée plateforme/pays ou refuser le scope quand la route exige un établissement.

## Écarts Mobile — PR3

`Mobile/src/context/AdminDataContext.tsx` recharge déjà plusieurs domaines via les API dédiées, mais certaines mutations restent optimistes :

- notes
- présences
- lecture de notifications

La PR3 doit imposer le contrat :

`mutation API -> ACK serveur -> refetch canonique / remplacement local avec la réponse serveur`.

Une mutation rejetée ne doit jamais rester affichée comme persistée. Les IDs canoniques doivent toujours venir du serveur.

## Gates du chantier

Les vérifications suivantes doivent rester vertes pendant tout le chantier :

- `verify:canonical-state-convergence`
- `verify:sync-end-to-end`
- `verify:backoffice-state-removal`
- `verify:remove-legacy-sync-core`
- CI
- Security

Chaque PR du chantier reste Draft jusqu'à revalidation CTO et diff GitHub indépendant.
