# Rapport HOTFIX-PRE-E1-02B — Matérialisation PG affectations / identités enseignant

**Type :** Correctif suite inspection causalité (#89)  
**Contrat :** [CONTRAT-HOTFIX-PRE-E1-02B.md](./CONTRAT-HOTFIX-PRE-E1-02B.md)  
**Gouvernance :** Audit Pré-E1 **OUVERT** · HOTFIX-02 **NON CLOS** (partiellement réussi) · V2 **BLOQUÉE** · E1 **NO-GO** · PR #84 Draft  

---

## 1. Cause du manquement HOTFIX-02

1. Dedupe BO fusionnait `TEACHERS-*` et jumeau ENS/`TEACHER-*` via `identifier` login.  
2. `teacher_code` préférait `publicId` ENS.  
3. Aucune matérialisation user PG → `teachers.user_id` null.  
4. Assignments orphelines → soft-reject → ALLOW via fallback BO.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `backofficeDedupe.js` | Clé teachers par id `TEACHERS-*` / `TEACHER-*` |
| `pedagogyStaffBoPersistence.js` | `teacher_code` canonique `TEACHERS-*` |
| `postgresRepository.js` | `ensurePgUserForBackOfficeTeacher` |
| Tests | `backofficeDedupe.teachers.test.js` + assertions stub |
| Gate | `npm run verify:pre-e1-hotfix-02b` |

---

## 3. Résultats gate (base propre)

| Contrôle | Résultat |
|----------|----------|
| `teacher_code` TEACHERS-* | ✅ |
| `user_id` non null | ✅ |
| `teacher_assignments` active | ✅ |
| POST `grantedBy=class:pg_teacher_assignment+evaluation:pg_teacher_assignment` | ✅ |
| POST après neutralisation BO (PG seul) | ✅ 201 via PG |
| Sans PG + BO conservé | **Documenté** : fallback BO encore ALLOW (volontairement non fermé ici) |

Preuve : `docs/audits/evidence/pre-e1-hotfix-02b-results.json`

---

## 4. Arrêt

Livraison en **PR Draft** — revue CTO.  
**N’autorise pas** clôture audit / V2 / E1.
