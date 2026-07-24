# Rapport HOTFIX-SYNC-02 — Rattachement évaluations

**Type :** Hotfix persistance Notes  
**Prérequis :** `hotfix-sync-01`  
**Roadmap fonctionnelle :** toujours suspendue  

**Contrat :** [CONTRAT-HOTFIX-SYNC-02.md](./CONTRAT-HOTFIX-SYNC-02.md)

---

## 1. Constat

HOTFIX-SYNC-01 empêche la disparition silencieuse mais laisse les évaluations en `syncStatus=failed` lorsque le rattachement PG échoue. Ce n’est pas une synchronisation réussie.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `evaluationAttachment.js` | Résolution structurée + erreurs `EVAL_ATTACHMENT_*` |
| `postgresRepository` | `ensureSubjectForSchool` · upsert via ensure classe/matière/année |
| `DataContext` | Throw si outbox `failed` après PUT (surface UI) |
| `GradesEvaluationsPage` | Toast/InlineAlert/`syncError` · pas de succès trompeur · retry |
| Tests | `evaluationSyncRepository.test.js` (saveBackOfficeState → PG evaluations → syncAck) · outbox localStorage · anti-doublon matière |

---

## 3. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Message syncError exact | Oui |
| Ensure classe / matière / année | Oui |
| ACK accepted → PG row | Oui (test) |
| Refresh autre session | Oui (test snapshot) |
| Outbox vide après accepted | Oui (test) |
| Roadmap D3.7 | Toujours suspendue |
