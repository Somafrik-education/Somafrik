# Catalogue d’aide Somafrik — HELP-V1A

Catalogue embarqué Option A (HELP-01) : articles compilés depuis un sous-ensemble des guides utilisateurs, filtrés par plateforme, écran, rôle et permissions live.

Ce lot **ne monte aucun bouton**, aucun panneau, aucune API, aucune IA.

## API publique

- `HELP_CATALOG` — liste immuable d’articles ;
- `createHelpContext(input)` — contexte minimal, sans PII / JWT / identifiants élèves ;
- `resolveHelpScreen({ platform, pathname, routeName, role })` — écran canonique ou `null` (pas d’aide) ;
- `filterHelpArticles(context)` — corpus autorisé pour la session ;
- `searchHelpArticles(context, query)` — recherche locale dans le corpus filtré ;
- `suggestHelpArticles(context, { limit })` — 3 suggestions max pour l’écran courant ;
- `isHelpAvailable(context)` — faux sur vitrine, connexion, reset mot de passe, Support.

## Contrat d’article

`id`, `title`, `roles`, `permissions`, `platforms`, `routeKeys`, `keywords`, `summary`, `steps`, `relatedArticles`.

- **LECTURE** : autorisée ;
- **NAVIGATION** : optionnelle, seulement si la permission de la cible est portée ;
- **ACTION** métier : interdite (aucun article ne crée / modifie / supprime).

## Hors périmètre HELP-V1A

FAB / panneau Web / bottom sheet Mobile, backend `GET /api/help`, Intercom / Crisp / Zendesk, RAG / OpenAI, alias Mobile `Support → Messages`, vitrine, `google-services.json`, parcours d’écriture parent-enfant.
