# Contrat HOTFIX-SYNC-04 — ACK métier Notes + isolation transactionnelle

**Lot :** HOTFIX-SYNC-04  
**Prérequis :** HOTFIX-SYNC-02 / HOTFIX-SYNC-03  
**Statut CTO amont :** erreur backend opaque « Erreur interne Somafrik » après franchissement RBAC

---

## 1. Objectif

1. Ne plus masquer les échecs Notes derrière `Erreur interne Somafrik`
2. Isoler chaque upsert évaluation / note (SAVEPOINT) pour qu’un rejet de note n’abortisse pas toute la TX
3. Garantir que la note retrouve l’évaluation créée dans la même requête via `legacy_json_id` ou UUID canonique

---

## 2. Codes métier obligatoires (`syncAck.rejected`)

| Code | Sens |
|------|------|
| `GRADE_ATTACHMENT_EVALUATION` | Évaluation introuvable / absente |
| `GRADE_ATTACHMENT_STUDENT` | Élève introuvable / hors établissement |
| `GRADE_ATTACHMENT_TEACHER` | Enseignant introuvable |
| `GRADE_VERSION_CONFLICT` | Conflit de version optimiste |
| `GRADE_DUPLICATE` | Doublon (school, evaluation, student) |
| `GRADE_CONTRACT` | Statut / score incohérents (CHECK) |
| `GRADE_SYNC_FAILED` | Échec classifié générique (pas de 500 globale) |

Exemple :

```json
{
  "entity": "notes",
  "id": "NOTE-1",
  "code": "GRADE_ATTACHMENT_STUDENT",
  "error": "Élève introuvable pour la note (…)"
}
```

---

## 3. Transaction

Dans `syncNotesDomainFromBackOffice` :

1. Upsert évaluations (SAVEPOINT par ligne) → enregistrer `legacy_json_id → uuid`
2. Upsert notes (SAVEPOINT par ligne) avec `resolvedEvaluationId` si connu
3. Rejet métier → `ROLLBACK TO SAVEPOINT` → continuer
4. Persister le JSON BO durable + `syncAck`

Une erreur SQL sur une note **ne doit plus** produire HTTP 500 pour les deux mutations.

---

## 4. Tests

- évaluation + note même TX → les deux `accepted`
- élève manquant → note `GRADE_ATTACHMENT_STUDENT`, évaluation `accepted`
- erreur SQL note (CHECK) → `GRADE_CONTRACT`, évaluation conservée, JSON persisté
