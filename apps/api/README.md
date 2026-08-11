# API Somafrik V2

Cette application sera l'adaptateur HTTP de Somafrik V2.

## Règles de fondation

- dépendre des capacités exposées par `packages/`, jamais des fichiers de `backend/` ;
- appliquer l'authentification et le tenant scope avant tout appel métier ;
- exposer des routes métier explicites, pas un état JSON global ;
- rester inactive en production tant que son lot de migration n'a pas franchi la parité et le gate CTO.

## Lot V2.1j

Adaptateur pur `authorizationDecisionToHttpStatus(decision)` :

- `AUTHORIZED` → 200 ;
- `UNAUTHENTICATED` → 401 ;
- `FORBIDDEN` → 403 ;
- décision inconnue ou invalide → 401 fail-closed.

## Lot V2.1k

Extraction stricte `extractBearerCredential(authorizationHeader)` :

- schéma `Bearer` insensible à la casse ;
- exactement un espace ASCII avant le credential ;
- credential RFC Bearer exact, sans normalisation ;
- entrée invalide ou hostile → `null`.

Aucun middleware, route, JWT ou corps HTTP n'est introduit dans ces lots.
