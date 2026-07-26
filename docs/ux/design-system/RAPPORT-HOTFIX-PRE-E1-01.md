# Rapport HOTFIX-PRE-E1-01 — Persistance élèves & inscriptions

**Type :** Hotfix pré-E1 (Correctif 1)  
**Décision CTO :** V1 acceptée comme preuve · V2 bloquée · E1 NO-GO · PR #84 Draft inchangée  
**Contrat :** [CONTRAT-HOTFIX-PRE-E1-01.md](./CONTRAT-HOTFIX-PRE-E1-01.md)

---

## 1. Constat

L’audit V1 a prouvé que les élèves créés via `PUT /api/backoffice/state` restaient uniquement dans le JSON BackOffice : **0 ligne** `students` PG pour la chaîne, donc `POST /api/notes` → **404 Eleve introuvable**.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `studentsBoPersistence.js` | Identifiant stable, validation, merge ACK |
| `postgresRepository` | `syncStudentsDomainFromBackOffice` avant sync notes ; matérialisation + enrollment ; `resolveStudentForGrade` ; garde tenant |
| Docs | Contrat + ce rapport |
| Tests | `studentsBoPersistence.test.js` · `studentsSyncRepository.test.js` |

---

## 3. Tableau CTO

| Objectif | Résultat |
|----------|----------|
| Élèves BO → `students` PG | Oui (sync à chaque PUT touchant `students`) |
| Inscription cohérente `enrollments` | Oui (école + classe + année courante) |
| Mapping IDs stables | Oui (`matricule/publicId/id`) |
| Résolvable `POST /api/notes` | Oui (`resolveStudentForGrade`) |
| Isolation multi-tenant | Oui (filtre école + conflit 409) |
| Tests non-régression | `npm run verify:students-sync` |
| HOTFIX-PRE-E1-02 / Bulletins / V2 | Non démarrés |
| Preuve V1 historique | Non modifiée |

---

## 4. Dette connue (hors Correctif 1 — pas de changement de modèle)

| ID | Sévérité | Constat | Action |
|----|----------|---------|--------|
| **PRE-E1-STUDENT-CODE-SCOPE** | **MAJOR** | Le schéma actuel traite `student_code` comme **globalement unique** (`UNIQUE` sur `students.student_code`). | **V2** devra arbitrer entre unicité globale et unicité composite `(school_id, student_code)`. Aucune migration dans ce hotfix. |

---

## 5. Re-run V1 (post-merge)

Après merge dans `develop`, re-run `npm run verify:pre-e1-v1` :

- Bilan : [`docs/audits/BILAN-PRE-E1-V1-RERUN-HOTFIX-01.md`](../../audits/BILAN-PRE-E1-V1-RERUN-HOTFIX-01.md)
- Preuve machine nouvelle : `docs/audits/evidence/pre-e1-v1-rerun-hotfix-pre-e1-01-results.json`
- Preuve historique V1 (PR #84) : **non modifiée**
- PG-01c ✅ ; POST-01 passe de `404 Eleve introuvable` à `403` (hors Correctif 1)
- V2 / E1 / HOTFIX-PRE-E1-02 : toujours bloqués

---

## 6. Arrêt

Livraison Correctif 1 + bilan re-run V1 — **nouvel arbitrage CTO** avant Correctif 2.
