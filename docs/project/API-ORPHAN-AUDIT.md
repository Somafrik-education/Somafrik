# Audit API orphelines / doublons

## Objectif

Établir une correspondance vérifiable entre :

`handler Express ↔ clé RBAC ↔ consommateur Web/Mobile`

Le scanner `scripts/audit-api-orphans.js` classe chaque route en :

- `ACTIVE` — handler + RBAC + client détectés ;
- `ACTIVE_NO_RBAC_KEY` — handler et client, sans clé RBAC statique détectée ;
- `SERVER_RBAC_NO_CLIENT` — handler + RBAC, aucun consommateur Web/Mobile statique ;
- `ORPHAN` — handler sans client ni clé RBAC détectée ;
- `RBAC_ONLY` — permission déclarée sans handler détecté ;
- `CLIENT_ONLY` — appel client sans handler détecté.

## Exécution

```bash
node scripts/audit-api-orphans.js
node scripts/audit-api-orphans.js /tmp/somafrik-api-audit.json
```

## Constats manuels déjà confirmés sur la baseline

1. Le client Web Comptes utilisateurs consomme `/api/backoffice/users` et ses sous-routes dédiées.
2. La matrice RBAC contient encore une clé `GET /api/users` historique en parallèle de `GET /api/backoffice/users` ; elle doit être classifiée par le scanner puis revue avant suppression.
3. L'endpoint racine de l'API publie encore une liste historique de routes qui contient des doublons et anciennes familles ; cette liste n'est pas une preuve d'usage client.
4. Les routes E2E, debug, health, auth, export et intégrations externes peuvent légitimement n'avoir aucun consommateur Web/Mobile : elles doivent être marquées `INTERNAL/E2E/EXTERNAL` après revue, jamais supprimées automatiquement.

## Règle de suppression

Aucune route n'est supprimée sur le seul résultat du scanner. Une suppression exige :

- absence de consommateur Web ;
- absence de consommateur Mobile ;
- absence d'intégration externe documentée ;
- absence d'usage ops/E2E ;
- vérification RBAC ;
- test de non-régression ;
- diff CTO indépendant avant merge.

## Livrable attendu après exécution CI/local

Le JSON produit devient la base du tableau final :

| Route | Handler | RBAC | Web | Mobile | Classification | Décision |
|---|---:|---:|---:|---:|---|---|

Les candidats `RBAC_ONLY`, `CLIENT_ONLY`, `ORPHAN` et `SERVER_RBAC_NO_CLIENT` doivent tous être expliqués individuellement avant tout chantier de suppression.
