# Bilan V1 — Re-run post HOTFIX-PRE-E1-01

**Date :** 2026-07-26  
**Base code :** `develop` @ `27d5f5c0` (merge PR #85 HOTFIX-PRE-E1-01)  
**Commande :** `npm run verify:pre-e1-v1`  
**Preuve machine (nouvelle) :** [`evidence/pre-e1-v1-rerun-hotfix-pre-e1-01-results.json`](./evidence/pre-e1-v1-rerun-hotfix-pre-e1-01-results.json)  
**Preuve historique V1 (intacte, PR #84) :** `docs/audits/evidence/pre-e1-v1-results.json` — **non modifiée**

---

## 1. Gates HOTFIX-PRE-E1-01 (pré-merge)

| Gate | Résultat |
|------|----------|
| `npm run verify:students-sync` | ✅ |
| `npm run verify:notes-sync` | ✅ |
| `npm run check` | ✅ |
| CI (PR #85 @ `adb1e21a`) | ✅ |
| Security (PR #85 @ `adb1e21a`) | ✅ |

PR #85 undraftée puis **mergée** dans `develop` (`27d5f5c0`).

---

## 2. Résumé re-run V1

| Métrique | V1 historique (PR #84) | Re-run post Correctif 1 |
|----------|------------------------|-------------------------|
| Passés | 27/33 | **28/33** |
| Échoués | 6 | **5** |
| Recommandation V2 | BLOQUER V2 | **BLOQUER V2** (inchangée) |
| E1 Bulletins | NO-GO | **NO-GO** |

---

## 3. Comparatif anomalies

| ID | Sévérité | V1 historique | Re-run HOTFIX-01 | Lecture |
|----|----------|---------------|------------------|---------|
| **V1-PG-01c** | BLOCKER | ❌ `0 PG / 0 match` | ✅ `2 PG / 2 match` | **Corrigé par HOTFIX-PRE-E1-01** |
| **V1-POST-01** | BLOCKER | ❌ `404` `Eleve introuvable` | ❌ `403` `élève hors classe affectée` | Élève **résolvable** ; échec basculé vers garde classe/affectation (hors Correctif 1) |
| V1-PG-01b | CRITICAL | ❌ `teacher_id=null` | ❌ `teacher_id=null` | Inchangé — hors Correctif 1 |
| V1-PG-02 | CRITICAL | ❌ `0 grades` | ❌ `0 grades` | Inchangé — hors Correctif 1 |
| V1-DUP-01 | CRITICAL | ❌ POST 404 | ❌ POST 403 | Toujours non prouvable (dépend POST) |
| V1-SOT-01 | CRITICAL | ❌ `json=2 pg=0` | ❌ `json=2 pg=0` | Inchangé — hors Correctif 1 |

---

## 4. Dette documentée (sans changement de modèle)

| ID | Sévérité | Constat |
|----|----------|---------|
| **PRE-E1-STUDENT-CODE-SCOPE** | **MAJOR** | `student_code` est **globalement unique** dans le schéma actuel. V2 devra arbitrer unicité globale vs `(school_id, student_code)`. |

---

## 5. Décision / suite

| Item | Statut |
|------|--------|
| HOTFIX-PRE-E1-01 | Livré & mergé `develop` |
| HOTFIX-PRE-E1-02 | **Interdit** jusqu’à arbitrage CTO |
| V2 | **Bloquée** |
| E1 Bulletins | **NO-GO** |
| PR #84 (audit) | Draft — preuve historique intacte |

**Arrêt après ce re-run V1** — nouvel arbitrage CTO requis.
