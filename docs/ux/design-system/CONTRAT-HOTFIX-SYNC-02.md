# Contrat HOTFIX-SYNC-02 — Rattachement évaluations PostgreSQL

**Lot :** HOTFIX-SYNC-02  
**Prérequis :** tag `hotfix-sync-01` (non-perte silencieuse)  
**Statut HOTFIX-SYNC-01 :** non validé en production fonctionnelle tant que les ACK accepted ne deviennent pas la norme  

---

## 1. Objectif

Transformer les rejets `sync_failed` dus au rattachement en **écritures PG réussies** lorsque les données métier existent ou peuvent être assurées (ensure) de façon sûre.

---

## 2. Résolution obligatoire

Pour chaque évaluation synchronisée :

| Rattachement | Stratégie |
|--------------|-----------|
| Établissement | `schoolCode` → get / ensure depuis BO |
| Classe | id / code / nom → ensureClassForSchool |
| Matière | id / code / nom → ensureSubjectForSchool |
| Année | getCurrentAcademicYear (crée si absente) |
| Période / term | ensureTerm |
| Enseignant | teacher_code ou premier enseignant école (nullable) |

Erreurs structurées (`EVAL_ATTACHMENT_*`) avec message exact exposé en `syncError` / toast / InlineAlert.

---

## 3. Test bout en bout obligatoire

```
enseignant crée une évaluation
→ PUT /backoffice/state
→ ACK accepted
→ ligne présente dans PostgreSQL evaluations
→ refresh depuis une autre session
→ évaluation visible
→ outbox vide
```

---

## 4. UI

- Ne jamais afficher « Évaluation créée » si la sync a échoué.
- Afficher `syncError` (toast + InlineAlert + colonne Sync).
- Proposer `retryFailedSync`.
