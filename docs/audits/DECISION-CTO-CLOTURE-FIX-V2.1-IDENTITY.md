# Décision CTO — Clôture technique FIX V2.1 IDENTITY

**Type :** décision de gouvernance (documentaire)  
**Date :** 2026-07-27  
**Sujet :** `PRE-E1-IDENTITY-LIFECYCLE` / FIX V2.1 IDENTITY  
**Base :** rejeu post-merge sur `develop@3fd7790f` (PR #99, head validé `0b1131ec`)  
**Preuve agrégée :** [`evidence/pre-e1-v2-identity-fix-post-merge-develop-results.json`](./evidence/pre-e1-v2-identity-fix-post-merge-develop-results.json) · [`PRE-E1-V2-IDENTITY-POST-MERGE-REPLAY.md`](./PRE-E1-V2-IDENTITY-POST-MERGE-REPLAY.md)

---

## Décision

**FIX V2.1 IDENTITY — CLÔTURÉ TECHNIQUEMENT** par décision CTO après rejeu post-merge sur `develop@3fd7790f`.

| Élément | Statut |
|---------|--------|
| Caractérisation | **TERMINÉE** |
| Correctif préventif nouvelles identités | **VALIDÉ POST-MERGE** |
| Alignement nouvelles évaluations | **VALIDÉ POST-MERGE** |
| Non-régression V1 / HOTFIX-02B | **VALIDÉE** |
| Clôture technique V2.1 | **AUTORISÉE** |

Rejeu post-merge : **11 PASS / 0 FAIL**.

---

## Périmètre clôturé

1. Aucune nouvelle identité parallèle `TEACHER-*` sur le flux nominal  
2. Canon `TEACHERS-*` déterministe  
3. Alignement des nouvelles affectations et évaluations  
4. Refus structuré en cas d’ambiguïté  
5. Préservation des comportements historiques  

---

## Hors périmètre (dette séparée)

| Élément | Statut |
|---------|--------|
| Fusion des jumeaux historiques | **NON FAITE / NON AUTORISÉE** |
| Backfill `evaluations.teacher_id` | **NON FAIT / NON AUTORISÉ** |
| Contrainte `UNIQUE` PG | **NON FAITE** |
| Suppression du multi-match historique | **NON FAITE** |

---

## État de gouvernance

| Élément | Statut |
|---------|--------|
| Audit V2 | **TOUJOURS OUVERT** |
| V2.1 `PRE-E1-IDENTITY-LIFECYCLE` | **CLOS TECHNIQUEMENT** |
| Dette historique de consolidation | **DIFFÉRÉE / NON AUTORISÉE** |
| Prochain sujet V2 | **PEUT ÊTRE OUVERT PAR MANDAT CTO** |
| E1 | **NO-GO** |
| HOTFIX-01 / 02 / 02B | **CLOS** |

**Prochaine étape autorisée :** contrat d’audit du prochain sujet V2 — **pas** une consolidation des identités historiques.
