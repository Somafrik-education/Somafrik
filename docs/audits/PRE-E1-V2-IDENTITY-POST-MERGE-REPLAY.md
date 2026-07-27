# Rejeu post-merge develop — FIX V2.1 IDENTITY

**Statut :** **FIX V2.1 IDENTITY — CLÔTURÉ TECHNIQUEMENT** par décision CTO après rejeu post-merge sur `develop@3fd7790f`  
**Merge code :** PR #99 → `develop` @ `3fd7790f` (head validé `0b1131ec`)  
**Décision CTO clôture :** 2026-07-27  
**Date rejeu :** 2026-07-27

## Décision CTO — clôture technique V2.1

| Élément | Statut |
|---------|--------|
| `PRE-E1-IDENTITY-LIFECYCLE` — caractérisation | **TERMINÉE** |
| Correctif préventif nouvelles identités | **VALIDÉ POST-MERGE** |
| Alignement nouvelles évaluations | **VALIDÉ POST-MERGE** |
| Non-régression V1 / HOTFIX-02B | **VALIDÉE** |
| **Clôture technique V2.1** | **AUTORISÉE / PRONONCÉE** |

### Périmètre exactement clôturé

- aucune nouvelle identité parallèle `TEACHER-*` sur le flux nominal ;
- canon `TEACHERS-*` déterministe ;
- alignement des nouvelles affectations et évaluations ;
- refus structuré en cas d’ambiguïté ;
- préservation des comportements historiques.

### Hors clôture (dette séparée — NON AUTORISÉE)

| Élément | Statut |
|---------|--------|
| Fusion des jumeaux historiques | **NON FAITE / NON AUTORISÉE** |
| Backfill `evaluations.teacher_id` | **NON FAIT / NON AUTORISÉ** |
| Contrainte `UNIQUE` PG | **NON FAITE** |
| Suppression du multi-match historique | **NON FAITE** |

## Périmètre rejoué (11 PASS / 0 FAIL)

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

## Gouvernance après clôture

| Élément | Statut |
|---------|--------|
| Audit V2 | **TOUJOURS OUVERT** |
| V2.1 `PRE-E1-IDENTITY-LIFECYCLE` | **CLOS TECHNIQUEMENT** |
| Dette historique de consolidation | **DIFFÉRÉE / NON AUTORISÉE** |
| Prochain sujet V2 | **PEUT ÊTRE OUVERT PAR MANDAT CTO** |
| E1 | **NO-GO** |
| HOTFIX-01 / 02 / 02B | **CLOS** |

**Prochaine étape autorisée :** contrat d’audit du prochain sujet V2 — **pas** une consolidation des identités historiques.
