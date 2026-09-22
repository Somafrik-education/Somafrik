# DEMO-CONFIG — Environnement 1 : PostgreSQL Démo

Issue de gouvernance : #661

## Objectif

Créer une base PostgreSQL dédiée à l'environnement public Démo de Somafrik. Cette base ne partage ni URL, ni credentials, ni données avec la production ou la préproduction.

## Ressource attendue

- Type : PostgreSQL managé Render
- Nom logique recommandé : `somafrik-demo-db`
- Nom de base recommandé : `somafrik_demo`
- Région : la même que le futur service API Démo
- Données : exclusivement fictives
- Sauvegarde : non critique pour les données métier ; la source de vérité reste le seed versionné + reset déterministe

## Variables du service API Démo

Les valeurs réelles sont configurées dans Render, jamais dans Git.

| Variable | Valeur / règle |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ENV` | `demo` |
| `SOMAFRIK_ENV` | `demo` |
| `DATABASE_URL` | URL interne/externe du PostgreSQL Démo uniquement |
| `SOMAFRIK_DB_REQUIRED` | `true` |
| `SOMAFRIK_SKIP_DEMO_SEED` | `true` |
| `SOMAFRIK_DEMO_DATABASE_URL_MARKER` | `somafrik_demo` |
| `JWT_SECRET` | secret unique Démo, >= 32 caractères |

`SOMAFRIK_DEMO_RESET_CONFIRM=RESET_DEMO_DATA` n'est ajouté que pour l'exécution contrôlée d'un reset puis retiré.

## Garde-fous obligatoires

1. `DATABASE_URL` doit pointer vers une ressource créée exclusivement pour la Démo.
2. L'URL doit contenir le marqueur `somafrik_demo` pour que `demo:reset` puisse être autorisé.
3. Aucun secret PROD/PREPROD ne doit être copié vers la Démo.
4. Aucun dump contenant des données réelles n'est importé.
5. La DB Démo est initialisée uniquement par migrations + seed fictif versionné.
6. Le reset doit refuser de fonctionner si `APP_ENV != demo`, si le marqueur DB est absent, ou si la confirmation destructive n'est pas fournie.

## Provisionnement Render — action infrastructure

Cette étape doit être réalisée dans le compte Render Somafrik :

1. créer un PostgreSQL séparé nommé `somafrik-demo-db` ;
2. utiliser une base nommée `somafrik_demo` si Render permet de choisir le nom ;
3. conserver l'URL générée dans les secrets du futur service API Démo ;
4. ne jamais coller l'URL dans GitHub, une issue, un log ou un rapport ;
5. relever uniquement dans le rapport final : identifiant de ressource, région, date de création et statut de connexion, sans credential.

## Critères de GO ENV-1

ENV-1 est GO quand :

- le datastore PostgreSQL Démo existe ;
- sa chaîne de connexion est distincte de PROD et PREPROD ;
- le nom/URL satisfait le marqueur de sécurité attendu ;
- une connexion depuis le futur service API Démo est possible ;
- migrations + seed/reset peuvent être exécutés sans donnée réelle ;
- aucune modification n'a été faite sur les ressources PROD/PREPROD.

## État actuel

Configuration Git prête. Le provisionnement réel Render reste une action d'infrastructure externe au dépôt tant qu'aucune connexion Render n'est active dans cette session.
