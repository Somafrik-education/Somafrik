# Rejeu post-merge develop — FIX V2.1 IDENTITY

**Statut :** rejeu produit — **clôture technique V2.1 NON déclarée** (décision CTO requise)  
**Merge :** PR #99 → `develop` @ `3fd7790f` (head validé `0b1131ec`)  
**Date :** 2026-07-27

## Périmètre rejoué

| Gate | Artefact |
|------|----------|
| Units sync + eval | inclus dans le rapport agrégé |
| Historique V1 (script inchangé) | `pre-e1-v1-post-merge-develop-results.json` |
| Historique HOTFIX-02B (script inchangé) | `pre-e1-hotfix-02b-post-merge-develop-results.json` |
| Adapted 02B | `pre-e1-v2-identity-fix-adapted-02b-post-merge-develop-results.json` |
| Adapted V1 | `pre-e1-v2-identity-fix-adapted-v1-post-merge-develop-results.json` |
| Rapport agrégé | `pre-e1-v2-identity-fix-post-merge-develop-results.json` |

Commande : `npm run verify:pre-e1-v2-identity-post-merge`

## Invariants conservés

- Preuves historiques V1 / HOTFIX-02B **non réécrites** (hash vérifié avant/après)
- Pas de migration / backfill / fusion / DELETE
- E1 reste **NO-GO**

## Demande CTO

Sur la base de ce rejeu post-merge, décision attendue : **clôturer ou non** `PRE-E1-IDENTITY-LIFECYCLE` / correctif V2.1.
