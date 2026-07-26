# Bilan — Rejeu consolidé post-merge HOTFIX-PRE-E1-02B

**Date :** 2026-07-26  
**Base code :** `develop` @ `fc953883` (merge PR #90)  
**Head fusionné :** `85ff0fe4`  
**Commande :** `npm run verify:pre-e1-hotfix-02b`  
**Preuve machine (dédiée) :** [`evidence/pre-e1-hotfix-02b-rejeu-post-merge-results.json`](./evidence/pre-e1-hotfix-02b-rejeu-post-merge-results.json)  

**Ce document n’est pas une validation CTO.**  
**HOTFIX-02 n’est pas clos** par ce rejeu — requalification réservée au CTO.

---

## 1. Contexte

| Élément | État |
|---------|------|
| PR #90 | **MERGÉE** |
| HOTFIX-PRE-E1-02B | Mergé et techniquement accepté (diff CTO) |
| HOTFIX-02 | **À REQUALIFIER** |
| Audit Pré-E1 | **OUVERT** |
| V2 / E1 | **BLOQUÉE** / **NO-GO** |
| PR #84 | Draft |
| Dette PRE-E1-IDENTITY-LIFECYCLE | **OUVERTE** |

---

## 2. Critères CTO — résultats observés

| Critère | Gate | Résultat |
|---------|------|----------|
| `teacher_code` = `TEACHERS-*` | `PG-TEACHER-CODE` | ✅ |
| `teachers.user_id` non null + lié au bon user BO | `PG-TEACHER-USER` + `02B-LINK-01` | ✅ |
| `teacher_assignments` active | `PG-ASSIGN` | ✅ |
| `grantedBy = class:pg_teacher_assignment+evaluation:pg_teacher_assignment` | `POST-PG-AUTHZ` | ✅ |
| POST après neutralisation BO | `BO-NEUTRALIZED` + `POST-WITHOUT-BO` | ✅ |
| `TEACHER_USER_ROLE_CONFLICT` observé | `02B-ROLE-01` | ✅ |
| `TEACHER_USER_TENANT_CONFLICT` observé | `02B-TENANT-01` | ✅ |
| Aucune fuite `syncAck` concurrente | `02B-ACK-ISOLATION-01` | ✅ |
| Idempotence / replay | `02B-REPLAY-01` | ✅ |
| Fallback BO encore documenté (observé) | `FALLBACK-DOC` | ✅ `fallbackUsed=true` |

**Résumé harness :** 13/13 (preuve machine ci-dessus — ≠ clôture CTO).

---

## 3. Hors scope

- Nouveau correctif fonctionnel
- Clôture HOTFIX-02 / audit Pré-E1
- Ouverture V2 / E1
- Convergence d’identité `TEACHER-*` / `TEACHERS-*` (dette lifecycle)
- Modification des preuves historiques PR #84 / #89

---

## 4. Décision attendue (CTO)

Rejeu consolidé fourni pour **requalification** HOTFIX-02.  
Sans arbitrage CTO explicite : Audit **OUVERT**, HOTFIX-02 **non clos**, V2 **BLOQUÉE**, E1 **NO-GO**.
