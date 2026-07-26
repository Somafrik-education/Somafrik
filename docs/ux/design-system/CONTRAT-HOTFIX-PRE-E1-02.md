# Contrat HOTFIX-PRE-E1-02 — Cohérence PG affectations, évaluations et notes

**Lot :** HOTFIX-PRE-E1-02  
**Autorisation CTO :** Correctif 2 (post HOTFIX-PRE-E1-01)  
**Base :** `develop` — PR Draft **distincte**  
**Hors périmètre :** V2 · E1 Bulletins · migration générale `className`/`subject` · preuves V1 historiques  

---

## 1. Objectifs

1. Corriger la cause racine du `403` « élève hors classe affectée » **sans affaiblir le RBAC**.
2. Garantir la cohérence PG entre `teacher_assignments`, `enrollments`, `evaluations` et l’utilisateur enseignant.
3. Alimenter `evaluations.teacher_id` par identifiant stable ou affectation **non ambiguë**.
4. Synchroniser les notes acceptées via `PUT /api/backoffice/state` vers `grades`.
5. Obtenir **JSON notes = PG grades** pour le scénario V1.
6. Maintenir isolation multi-tenant et atomicité transactionnelle.
7. Suite `npm run verify:pre-e1-hotfix-02`.

---

## 2. Cause racine du 403 (Correctif 2)

| Facteur | Constat |
|---------|---------|
| Login BackOffice | Session enseignant sans `assignedClasses` → `principal.classNames = []` |
| `upsertGrade` | Garde trop étroite : `.includes(classNames)` sans fallback affectation PG/BO |
| PG staff | `teachers` / `teacher_assignments` non matérialisés depuis le BO |

**Correctifs autorisés :**

- Enrichir la session enseignant BackOffice avec affectations par **IDs stables** (pas de recherche nominale).
- Remplacer la garde `upsertGrade` par `teacherCanAccessStudentClass` (même règle que présences : classNames normalisés + PG `teacher_assignments` + BO).
- Sync BO → PG des enseignants et affectations avant sync évaluations/notes.

**Interdit :** supprimer ou court-circuiter la garde RBAC ; autoriser un enseignant non affecté.

---

## 3. Mapping stable

| Concept | Source BO | Cible PG |
|---------|-----------|----------|
| Enseignant | `publicId ?? id` | `teachers.teacher_code` |
| Affectation | `teacherId` + `className` + `subject/course` + `schoolCode` | `teacher_assignments` (UNIQUE composite) |
| Évaluation.enseignant | `teacherId` stable ou affectation unique classe+matière | `evaluations.teacher_id` |
| Note | `evaluationId` + `studentId` stables | `grades` |

---

## 4. Ordre transactionnel `saveBackOfficeState`

```
students (HOTFIX-01)
  → teachers + assignments (HOTFIX-02)
  → evaluations + notes (HOTFIX-SYNC-01)
  → persist JSON durable
  → syncAck fusionné
```

Échec infra ⇒ ROLLBACK. Rejets métier ⇒ `syncAck.rejected` sans perte JSON.

---

## 5. DUP-01 / idempotence

`DUP-01` n’est déclaré corrigé **que si** une preuve automatisée démontre :

1. `POST /api/notes` utilisable (201) ;
2. double soumission avec la même `Idempotency-Key` ;
3. **aucune** duplication de grade (compteur stable attendu pour l’évaluation).

**Statut Correctif 2 :** critère rempli sur smoke `verify:pre-e1-v1` (HTTP 201/201, `grades=2` pour 2 élèves — pas d’explosion).  
Preuve historique V1 non modifiée.

---

## 6. Tests minimums

```bash
npm run verify:pre-e1-hotfix-02
```

Couverture :

1. Helpers mapping / ACK  
2. Repository : teachers + assignments + `evaluations.teacher_id` + grades  
3. Garde RBAC : affecté OK / non affecté KO  
4. Conflit tenant enseignant  

---

## 7. Garde-fous

- Pas de recherche nominale enseignant pour notes/évaluations  
- Pas de développement Bulletins / V2  
- Pas de modification des preuves V1 (`pre-e1-v1-results.json`, re-run HOTFIX-01)  
- PR #84 reste Draft  
