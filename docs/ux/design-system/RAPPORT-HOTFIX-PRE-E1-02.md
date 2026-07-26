# Rapport HOTFIX-PRE-E1-02 — Cohérence affectations / évaluations / notes

**Type :** Hotfix pré-E1 (Correctif 2)  
**Décision CTO :** HOTFIX-02 autorisé · V2 bloquée · E1 NO-GO · PR #84 Draft  
**Contrat :** [CONTRAT-HOTFIX-PRE-E1-02.md](./CONTRAT-HOTFIX-PRE-E1-02.md)  
**Prérequis :** HOTFIX-PRE-E1-01 mergé (`develop`)

---

## 1. Constat

Après HOTFIX-01, les élèves sont en PG mais :

- `POST /api/notes` → **403** « élève hors classe affectée » ;
- `evaluations.teacher_id` reste `NULL` ;
- notes PUT → **0** `grades`.

### Cause racine du 403

1. Login BackOffice sans `assignedClasses` → JWT `classNames` vide.  
2. Double identité enseignant (`TEACHER-…` session vs `TEACHERS-…` affectation).  
3. `upsertGrade` : garde `.includes(classNames)` sans fallback affectation.  
4. `teachers` / `teacher_assignments` non synchronisés depuis le BO.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `pedagogyStaffBoPersistence.js` | Mapping stable teachers/assignments + merge ACK |
| `postgresRepository` | Sync teachers/assignments ; gardes établissement/classe/matière ; ensure teacher évaluations |
| `evaluationAttachment.js` | ensureTeacher + affectation non ambiguë |
| `teacherNotesWriteAccess.js` | Préférer fiche enseignant liée aux affectations |
| `server.js` | Enrichissement session BackOffice + change-password ; merge teachers BO/PG AuthService |
| Docs | Contrat + ce rapport |
| Tests | `npm run verify:pre-e1-hotfix-02` |

---

## 3. Tableau CTO

| Objectif | Résultat |
|----------|----------|
| Cause racine 403 corrigée sans affaiblir RBAC | Oui (classe + matière + établissement) |
| Cohérence PG assignments / enrollments / evaluations | Oui |
| `evaluations.teacher_id` alimenté | Oui |
| Notes PUT → `grades` | Oui |
| JSON notes = PG grades (scénario V1) | Oui (smoke local 33/33) |
| Isolation multi-tenant | Oui (ISO-02 403) |
| Suite `verify:pre-e1-hotfix-02` | Oui |
| **DUP-01** | **Oui — prouvé** : double POST `Idempotency-Key` → HTTP 201/201 et **2** grades (pas de duplication) |
| V2 / E1 / preuves V1 | **Toujours bloqués / non modifiées** |

---

## 4. Smoke V1 (local, non historique)

Exécuté sur le code de cette branche (preuve **non** écrite dans `pre-e1-v1-results.json`) :

```
npm run verify:pre-e1-v1
→ 33/33 passés · 0 anomalie BLOCKER/CRITICAL
```

Les preuves historiques (PR #84 + re-run HOTFIX-01) restent intactes.

---

## 5. Arrêt

Livraison Correctif 2 en **PR Draft** — **revue CTO requise** avant undraft / merge.  
Malgré le smoke 33/33, **V2 et E1 restent bloqués** jusqu’à arbitrage explicite.
