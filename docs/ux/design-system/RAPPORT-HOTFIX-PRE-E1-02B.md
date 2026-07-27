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
| `postgresRepository.js` | `ensurePgUserForBackOfficeTeacher` + isolation tenant/rôle |
| Tests | unitaires + gate `verify:pre-e1-hotfix-02b` (TENANT/ROLE/REPLAY/LINK) |
| Gate | `npm run verify:pre-e1-hotfix-02b` |

### 2.1 Correctif isolation (revue CTO)

L’upsert `ON CONFLICT (user_code) DO UPDATE` pouvait déplacer `school_id`, forcer `role=TEACHER` et réactiver le statut.  
Remplacé par : lookup global → INSERT / UPDATE contrôlé même tenant + rôle `TEACHER` / **REJET** `TEACHER_USER_TENANT_CONFLICT` / **REJET** `TEACHER_USER_ROLE_CONFLICT` (compte non enseignant — pas de `teachers.user_id`).  
Match soft `identifier` (ex. `ENS-0001`) **scopé** établissement ; `record.userId` prioritaire.  
`PUT /api/backoffice/state` rattache `saved.syncAck` (contexte requête) — **sans** fallback `repository.lastSyncAck`.

---

## 3. Résultats gate (base propre)

| Contrôle | Résultat |
|----------|----------|
| `teacher_code` TEACHERS-* | ✅ |
| `user_id` non null | ✅ |
| `teacher_assignments` active | ✅ |
| POST `grantedBy=class:pg_teacher_assignment+evaluation:pg_teacher_assignment` | ✅ |
| `02B-LINK-01` | ✅ |
| `02B-REPLAY-01` | ✅ |
| `02B-ROLE-01` | ✅ PARENT inchangé + pas de lien + `TEACHER_USER_ROLE_CONFLICT` observé |
| `02B-TENANT-01` | ✅ A inchangé + pas de lien B + `TEACHER_USER_TENANT_CONFLICT` observé |
| `02B-ACK-ISOLATION-01` | ✅ PUT concurrent A/B — réponse B sans ACK-A |
| POST après neutralisation BO (PG seul) | ✅ 201 via PG |
| `FALLBACK-DOC` | ✅ `fallbackUsed=true` (observé, pas vert inconditionnel) |

Preuve : `docs/audits/evidence/pre-e1-hotfix-02b-results.json`

---

## 4. Dette ouverte

- **PRE-E1-IDENTITY-LIFECYCLE** : `TEACHER-*` et `TEACHERS-*` restent deux fiches (déduplication volontaire, pas de convergence d’identité). **N’empêche pas** la clôture HOTFIX-02.
- Audit Pré-E1 **OUVERT** · V2 **BLOQUÉE** · E1 **NO-GO**.

---

## 5. Post-merge et clôture

PR #90 **mergée** (`fc953883`) · PR #91 **mergée** (`45f55a9e`).

Bilan : [`BILAN-PRE-E1-HOTFIX-02B-REJEU-POST-MERGE.md`](../../audits/BILAN-PRE-E1-HOTFIX-02B-REJEU-POST-MERGE.md)  
Décision CTO : [`DECISION-CTO-CLOTURE-HOTFIX-02.md`](../../audits/DECISION-CTO-CLOTURE-HOTFIX-02.md)

**HOTFIX-PRE-E1-02B : CLOS.**  
**HOTFIX-02 : CLOS.**  
Audit **OUVERT** · V2 **BLOQUÉE** · E1 **NO-GO** · dette IDENTITY **OUVERTE**.
