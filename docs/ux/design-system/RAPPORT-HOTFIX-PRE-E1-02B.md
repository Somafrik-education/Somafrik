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
`PUT /api/backoffice/state` rattache `syncAck` à la réponse pour rendre les rejets observables.

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
| `02B-ROLE-01` | ✅ |
| `02B-TENANT-01` | ✅ |
| POST après neutralisation BO (PG seul) | ✅ 201 via PG |
| Sans PG + BO conservé | **Documenté** : fallback BO encore ALLOW (volontairement non fermé ici) |

Preuve : `docs/audits/evidence/pre-e1-hotfix-02b-results.json`

---

## 4. Dette ouverte

- **PRE-E1-IDENTITY-LIFECYCLE** : `TEACHER-*` et `TEACHERS-*` restent deux fiches (déduplication volontaire, pas de convergence d’identité).
- HOTFIX-02 **NON CLOS** tant que revue CTO / undraft non autorisés.
- Audit Pré-E1 **OUVERT** · V2 **BLOQUÉE** · E1 **NO-GO**.

---

## 5. Arrêt

Livraison en **PR Draft** — **CHANGEMENTS REQUIS** traités ; re-diff pour autorisation merge CTO.  
**N’autorise pas** clôture audit / V2 / E1 / undraft sans validation CTO.
