# Bilan V1 — Re-run post HOTFIX-PRE-E1-02

**Date :** 2026-07-26  
**Base code :** `develop` @ `f8999ebe` (merge PR #87 HOTFIX-PRE-E1-02)  
**Commande :** `SOMAFRIK_PRE_E1_EVIDENCE_FILE=pre-e1-v1-rerun-hotfix-pre-e1-02-results.json npm run verify:pre-e1-v1`  
**Preuve machine (nouvelle) :** [`evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json`](./evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json)  
**Preuves historiques intactes :**
- PR #84 : `docs/audits/evidence/pre-e1-v1-results.json` (si présente sur branche audit)
- Re-run HOTFIX-01 : `docs/audits/evidence/pre-e1-v1-rerun-hotfix-pre-e1-01-results.json` — **non modifiée**

---

## 1. Gates HOTFIX-PRE-E1-02 (pré-merge PR #87)

| Gate | Résultat |
|------|----------|
| `npm run verify:pre-e1-hotfix-02` | ✅ |
| `npm run verify:students-sync` | ✅ |
| `npm run verify:notes-sync` | ✅ |
| `npm run check` | ✅ |
| CI (PR #87 @ `36b2f62c`) | ✅ |
| Security (PR #87 @ `36b2f62c`) | ✅ |
| Branche à jour avec `develop` | ✅ |
| Conversations de revue bloquantes | Aucune |
| Preuves V1 historiques | Intactes |
| RBAC | Non assoupli |

PR #87 undraftée puis **mergée** dans `develop` (`f8999ebe`).

---

## 2. Résumé re-run V1

| Métrique | V1 historique | Re-run HOTFIX-01 | Re-run HOTFIX-02 |
|----------|---------------|------------------|------------------|
| Passés | 27/33 | 28/33 | **33/33** |
| Échoués | 6 | 5 | **0** |
| Anomalies BLOCKER/CRITICAL | 6 | 5 | **0** |
| Harness « V2 AUTORISABLE » | non | non | oui (technique) |
| Décision produit CTO | — | bloquer | **V2 / E1 restent bloqués** jusqu’à arbitrage |

---

## 3. Clôture des anomalies ciblées

| Anomalie | Résultat attendu CTO | Obtenu |
|----------|----------------------|--------|
| **V1-POST-01** | clôturée, POST autorisé pour l’affectation correcte | ✅ **201** |
| **V1-PG-01b** | `evaluations.teacher_id` non null | ✅ `cc989622-d69b-45a3-95ec-0c833e07c0a6` |
| **V1-PG-02** | deux grades PostgreSQL | ✅ **2** |
| **V1-SOT-01** | JSON et PostgreSQL cohérents | ✅ `json=2 pg=2` |
| **V1-DUP-01** | aucun grade supplémentaire après rejeu | ✅ voir §4 |
| Isolation A/B | toujours bloquée | ✅ ISO-02 **403** établissement hors périmètre |
| Élève hors classe | toujours 403 | ✅ NEG-03 **403** |
| Matière non affectée | toujours 403 | ✅ NEG-04 **403** |

---

## 4. Preuve DUP-01 (idempotence sans ambiguïté)

Évaluation PG : `455d09bb-bfdc-4d6a-957f-7a7e73bec3c4`  
`Idempotency-Key` : `pre-e1-v1-1785076226951`

| Étape | HTTP | Nb grades | IDs des lignes |
|-------|------|-----------|---------------|
| **Avant** double POST | — | **2** | `b41eed44-7636-4d28-bcc0-c87299d609e9`, `e0d7cfeb-a4bd-43c5-b44f-ccc8d6640224` |
| Après **1er** POST (même clé) | **201** | **2** | mêmes IDs (score cible mis à 15) |
| Après **2e** POST (même clé) | **201** | **2** | mêmes IDs — **aucune ligne supplémentaire** |
| Rejeu **sans** `Idempotency-Key` | **201** | **2** | mêmes IDs — **aucune ligne supplémentaire** |

Lecture : l’effectif reste **2** (un grade par élève de la chaîne). Les rejeux (avec clé puis sans clé) **ne créent pas** de 3ᵉ ligne ; les identifiants de grades sont stables. Un total « grades=2 » seul ne suffisait pas ; les comptages avant/après et la conservation des IDs lèvent l’ambiguïté.

---

## 5. Dette documentée (sans refactor)

| ID | Sévérité | Constat |
|----|----------|---------|
| **PRE-E1-STUDENT-CODE-SCOPE** | MAJOR | `student_code` globalement UNIQUE (HOTFIX-01) |
| **PRE-E1-IDENTITY-LIFECYCLE** | **MAJOR** | Identités BackOffice ↔ utilisateur/session ↔ PostgreSQL (`teachers` / `teacher_assignments`) : plusieurs cycles de création/modification. V2 devra définir les identifiants et points d’écriture canoniques pour enseignants, élèves, utilisateurs associés, et références JSON ↔ PG. |

---

## 6. Décision / arrêt

| Item | Statut |
|------|--------|
| HOTFIX-PRE-E1-02 | Livré & mergé `develop` (`f8999ebe`) |
| Re-run V1 post-merge | **33/33** — preuve dédiée créée |
| V2 | **Bloquée** jusqu’au prochain arbitrage CTO |
| E1 Bulletins | **NO-GO** jusqu’à décision V7 |
| PR #84 (audit) | Draft — preuves historiques intactes |

**Arrêt après ce re-run V1** — nouvel arbitrage CTO requis. Le harness technique peut signaler « V2 AUTORISABLE » ; la **gouvernance CTO** maintient le blocage V2 / E1.
