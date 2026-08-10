# API Somafrik V2

Cette application sera l'adaptateur HTTP de Somafrik V2.

## Règles de fondation

- dépendre des capacités exposées par `packages/`, jamais des fichiers de `backend/` ;
- appliquer l'authentification et le tenant scope avant tout appel métier ;
- exposer des routes métier explicites, pas un état JSON global ;
- rester inactive en production tant que son lot de migration n'a pas franchi la parité et le gate CTO.

Le premier endpoint sera ajouté dans un lot séparé après le contrat identité/authentification V2.
