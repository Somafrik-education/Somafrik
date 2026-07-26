# Contrat HOTFIX-PRE-E1-02B — Matérialisation réelle affectations / identités enseignant PG

**Lot :** HOTFIX-PRE-E1-02B  
**Prérequis :** HOTFIX-PRE-E1-02 mergé · inspection causalité (#89) mergée  
**Base :** `develop` — PR Draft **distincte** de #89  
**Hors périmètre :** clôture audit Pré-E1 · V2 · E1 · modification preuves historiques · suppression immédiate du fallback BO  

---

## 1. Contexte (causalité établie)

Le POST 201 de HOTFIX-02 était autorisé par :

`grantedBy = class:bo_assignment_match+evaluation:bo_assignment`

et **non** par `teacher_assignments` PostgreSQL.  
Promesse technique de #87 (sync PG des affectations) **non satisfaite**.

---

## 2. Objectifs

1. `teachers.teacher_code` canonique = id pédagogique `TEACHERS-*` (pas écrasé par ENS `publicId`).
2. `teachers.user_id` **non null** (utilisateur PG matérialisé).
3. `teacher_assignments` PG : `school` / `class` / `subject` / `status=active`.
4. `POST /api/notes` avec  
   `grantedBy = class:pg_teacher_assignment+evaluation:pg_teacher_assignment`.
5. Test décisif : après **neutralisation** de l’affectation BO, POST reste 201 **via PG**.
6. Documenter le comportement si assignment PG absente et BO conservée (fallback encore actif).

---

## 3. Correctifs autorisés

- Dedupe BO teachers : ne pas fusionner `TEACHERS-*` / `TEACHER-*` via `identifier` login.
- `resolveStableTeacherCode` : préférer `TEACHERS-*`.
- `ensurePgUserForBackOfficeTeacher` avant insert teacher.
- Isolation multi-tenant de l’upsert user (voir §3.1).
- Suite `npm run verify:pre-e1-hotfix-02b`.

**Interdit :** affaiblir RBAC ; clôturer l’audit ; ouvrir V2 ; élargir à la refonte IDENTITY complète.

### 3.1 Isolation `ensurePgUserForBackOfficeTeacher` (bloquant CTO)

| Cas | Comportement |
|-----|--------------|
| Utilisateur inexistant | `INSERT` (role `TEACHER`) |
| Même établissement | `UPDATE` contrôlé (noms/email/phone) — **jamais** forcer `role` / `status` / déplacer `school_id` |
| Autre établissement | **REJET** `TEACHER_USER_TENANT_CONFLICT` |
| Match soft `identifier` / email | **scopé** au même `schoolCode` ; `record.userId` prime toujours |

---

## 4. Gate

```
npm run verify:pre-e1-hotfix-02b
npm run verify:pre-e1-hotfix-02
npm run check
```

### 4.1 Contrôles isolation obligatoires

| Id | Attendu |
|----|---------|
| `02B-TENANT-01` | Même `user_code` école B → aucun déplacement du compte école A ; sync rejetée / sans lien |
| `02B-ROLE-01` | Compte existant non enseignant → rôle non écrasé |
| `02B-REPLAY-01` | Plusieurs sync identiques → 1 user, 1 teacher, 1 assignment |
| `02B-LINK-01` | `teacher.user_id` = user BO attendu |

Preuve machine : `docs/audits/evidence/pre-e1-hotfix-02b-results.json`
