# Rapport HOTFIX-SYNC-04 — ACK métier Notes + SAVEPOINT

**Type :** Hotfix sync Notes  
**Prérequis :** HOTFIX-SYNC-02 / 03  
**Roadmap fonctionnelle :** toujours suspendue  

**Contrat :** [CONTRAT-HOTFIX-SYNC-04.md](./CONTRAT-HOTFIX-SYNC-04.md)

---

## 1. Constat

Après franchissement RBAC (SYNC-03), l’UI affichait :

`2 enregistrements en échec de synchronisation : Erreur interne Somafrik`

Cause probable : une erreur SQL sur l’upsert note **abortissait la transaction PostgreSQL** ; le catch métier ne suffisait pas → la persistance suivante levait une 500 opaque. Les deux mutations outbox (évaluation + note) basculaient en `failed` avec le message générique.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `gradeAttachment.js` | Codes `GRADE_*` + mapping erreurs PG |
| `postgresRepository` | `withSavepoint` · map `legacy→uuid` · upsertGrade structuré · résolution élève BO |
| `gradesBoPersistence` | `syncErrorCode` sur lignes rejetées |
| `syncOutbox` | Affiche `CODE: message` depuis `syncAck.rejected` |
| Tests | `gradeAttachment.test.js` · `gradeSyncRepository.test.js` |

---

## 3. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Plus de 500 opaque sur rejet note | Oui (SAVEPOINT) |
| Note → évaluation même TX | Oui (`resolvedEvaluationId` / `legacy_json_id`) |
| `syncAck.rejected[].code` | Oui |
| Élève BO → `student_code` | Oui (`queryStudentWithClass`) |
| Roadmap D3.7 | Toujours suspendue |

---

## 4. Correction revue CTO (upsert partiel)

`mergeTeacherOwnedRows` ne traite plus l’absence d’une ligne enseignant dans un PUT partiel comme une suppression. Comportement : upsert par id uniquement (remplacement / ajout), conservation de toutes les autres lignes (même enseignant + autres).

## 5. Validation préprod

1. Enseignant : créer évaluation + saisir note → Enregistrer  
2. Succès attendu : outbox vide, pas d’« Erreur interne Somafrik »  
3. Si rejet : message du type `GRADE_ATTACHMENT_STUDENT: …` (pas 500)  
4. Note rejetée → ACK `GRADE_*` ciblé, pas de 500 globale, autres lignes de la TX OK
