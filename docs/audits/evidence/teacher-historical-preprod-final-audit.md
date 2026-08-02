# Audit read-only — doublons historiques enseignants

- Généré : 2026-08-02T23:39:38.185Z
- Source : postgres:backoffice_state@2026-08-02T23:39:22.472Z
- Hash snapshot SHA-256 : `484dd9610e395ff967ad09fb5ac0122d7b455af45895bd3f08b52c2d25c74448`
- Mode : **DRY-RUN READ-ONLY**

## Synthèse

- Fiches Backoffice : **59**
- Fiches PostgreSQL : **59**
- Union auditée : **59**
- Fiches enseignants : **59**
- Groupes suspects : **0**
- Groupes SAFE_DUPLICATE : **0**
- Fiches doublons sûres : **0**
- Groupes AMBIGUOUS : **0**
- Groupes HOMONYM_POSSIBLE : **0**
- Groupes avec références réparties : **0**
- Fiches ORPHAN : **0**

## Groupes

Aucun groupe suspect détecté.

## Plan de réconciliation proposé

Aucune réconciliation automatique proposée.


## Phase A2 — arbitrage assisté read-only


## Résultat du dry-run

- teachers : 59 → 59
- références simulées à déplacer : 0
- assignments : 4 → 4
- grades : 1 → 1
- attendance/presences : 16 → 16
- evaluations : 5 → 5
- références pendantes après simulation : 0

Aucune mutation n'a été exécutée. Toute exécution préproduction nécessite une validation CTO séparée.
