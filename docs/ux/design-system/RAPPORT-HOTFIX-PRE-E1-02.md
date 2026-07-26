# Rapport HOTFIX-PRE-E1-02 — Cohérence affectations / évaluations / notes

**Type :** Hotfix pré-E1 (Correctif 2)  
**Décision CTO :** HOTFIX-02 validé fonctionnellement · PR #87 approuvée sous conditions · V2 bloquée · E1 NO-GO · PR #84 Draft  
**Contrat :** [CONTRAT-HOTFIX-PRE-E1-02.md](./CONTRAT-HOTFIX-PRE-E1-02.md)  
**Prérequis :** HOTFIX-PRE-E1-01 mergé (`develop`)  
**Commit tête (gates) :** `43e99ff1` (+ commits documentation / preuve DUP-01)

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
| Preuve DUP-01 | Comptages grades avant / après chaque POST (clé + sans clé) dans `verify:pre-e1-v1` |

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
| **DUP-01** | Voir §3.1 — pas seulement « 2 grades » |
| V2 / E1 / preuves V1 | **Toujours bloqués / non modifiées** |

### 3.1 Preuve DUP-01 (clarification)

Un total de **2 grades** après double POST n’est **pas** suffisant à lui seul (1 grade × 2 élèves). La preuve exige :

| Étape | Attendu |
|-------|---------|
| Grades **avant** le double POST | N (baseline, typiquement 2 = 1/élève) |
| Après **1er** POST (même `Idempotency-Key`) | N inchangé ; mêmes `id` de lignes |
| Après **2e** POST (même `Idempotency-Key`) | N inchangé ; HTTP 201/200 ; pas de ligne supplémentaire |
| Rejeu **sans** `Idempotency-Key` | N inchangé ; upsert in-place ; pas de ligne supplémentaire |
| Identifiants | Documentés dans `evidence.postgresSnapshots.afterIdempotency` |

Le harness `verify:pre-e1-v1` enregistre désormais ces comptages et IDs explicitement.

---

## 4. Gates pré-merge (dernier commit PR #87)

| Gate | Résultat |
|------|----------|
| `npm run verify:pre-e1-hotfix-02` | ✅ |
| `npm run verify:students-sync` | ✅ |
| `npm run verify:notes-sync` | ✅ |
| `npm run check` | ✅ |
| CI (PR #87) | ✅ |
| Security (PR #87) | ✅ |
| Branche à jour avec `develop` | ✅ (`develop` ancestor) |
| Conversations de revue bloquantes | Aucune |
| Preuves V1 historiques | Intactes |
| RBAC | Non assoupli (établissement + classe + matière) |

---

## 5. Smoke V1 (local, non historique)

Exécuté sur le code de cette branche (preuve **non** écrite dans `pre-e1-v1-results.json`) :

```
npm run verify:pre-e1-v1
→ 33/33 passés · 0 anomalie BLOCKER/CRITICAL
```

Les preuves historiques (PR #84 + re-run HOTFIX-01) restent intactes.

---

## 6. Dette architecturale conservée (hors scope PR #87)

| ID | Sévérité | Constat |
|----|----------|---------|
| **PRE-E1-STUDENT-CODE-SCOPE** | MAJOR | `student_code` globalement UNIQUE (HOTFIX-01) |
| **PRE-E1-IDENTITY-LIFECYCLE** | **MAJOR** | Les identités BackOffice, utilisateur/session et PostgreSQL possèdent encore plusieurs cycles de création/modification. V2 devra définir les identifiants et points d’écriture canoniques pour enseignants, élèves, utilisateurs associés, et références JSON ↔ PostgreSQL ; et réduire les doubles points de création/modification. |

Le hotfix corrige la chaîne opérationnelle (sync teachers/assignments, gardes, notes) **sans** résoudre cette architecture générale. **Ne pas élargir PR #87** pour ce sujet.

---

## 7. Post-merge

PR #87 undraftée puis mergée dans `develop` (`f8999ebe`).

Re-run V1 depuis `develop` :

- Preuve : [`docs/audits/evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json`](../../audits/evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json)
- Bilan : [`docs/audits/BILAN-PRE-E1-V1-RERUN-HOTFIX-02.md`](../../audits/BILAN-PRE-E1-V1-RERUN-HOTFIX-02.md)
- Résultat : **33/33** · 0 anomalie BLOCKER/CRITICAL

**V2 et E1 restent bloqués** jusqu’à arbitrage CTO explicite. PR #84 reste Draft.
