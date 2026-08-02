# Audit read-only — doublons historiques enseignants

- Généré : 2026-08-02T23:54:42.845Z
- Source : postgres:backoffice_state@2026-08-02T23:53:59.735Z
- Hash snapshot SHA-256 : `b1527114366733de7afdd07109fa13806bb9e89765523e805f528539612f9740`
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
