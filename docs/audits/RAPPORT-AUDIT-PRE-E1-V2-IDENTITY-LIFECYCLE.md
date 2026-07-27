# Rapport d’audit Pré-E1 V2.1 — Caractérisation `PRE-E1-IDENTITY-LIFECYCLE`

**Type :** caractérisation (audit) — **aucune implémentation**  
**Contrat :** [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md)  
**Décision contrat :** ACCEPTÉ CTO · caractérisation autorisée  
**Base code :** `develop` @ `6ca0ec62` (post-merge PR #94 · post-`094d5017`)  
**Preuve machine :** [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json)  
**Commande :** `npm run verify:pre-e1-v2-identity`  
**Date preuve :** 2026-07-27  

---

## 0. Mandat et limites

| Règle | Respect |
|-------|---------|
| Harness / script de preuve dédié | ✅ `scripts/verify-pre-e1-v2-identity-lifecycle.js` |
| Artefact machine V2.1 | ✅ |
| Classement Q1–Q7 et ID-01…ID-06 | ✅ |
| Synthèse factuelle de la dette | ✅ |
| Correctif / fusion / suppression d’identités | ❌ absent |
| Migration / logique métier modifiée | ❌ absent |
| Plan correctif présenté comme autorisé | ❌ absent (`noCorrectivePlanAuthorized: true`) |
| ID-06 décision `student_code` | ❌ hors scope (contexte seulement) |

---

## 1. Méthode exécutée

1. Base PostgreSQL dédiée `somafrik_pre_e1_v2_identity` (reset schéma).  
2. Backend local API-only + trace authz.  
3. Établissement + chaîne Classe → Élèves → Contact enseignant/user → fiches `TEACHERS-*` + jumeau `TEACHER-*` → affectation → PUT notes → `POST /api/notes`.  
4. Snapshots JSON BO / JWT / `users` / `teachers` / `teacher_assignments` / `evaluations`.  
5. Classification selon contrat : **confirmé** · **infirmé** · **indéterminé** · **contexte** (ID-06).

**Lecture des classes :** pour les questions d’écart (Q1, Q4, Q7), « confirmé » = **écart ou multiplicité reproductible**. Pour les faits d’alignement local (Q3, Q5, Q6, ID-02, ID-05), « confirmé » = **fait observé** (pas une anomalie à elle seule). Le détail est dans la preuve machine (`extra.meaning`).

---

## 2. Scénarios ID-01…ID-06

| Id | Classification | Constat factuel |
|----|----------------|-----------------|
| **ID-01** | **confirmé** | Sync staff observable : fiches JSON multi-ids + `teachers` PG + `user_id` non null sur le canonique `TEACHERS-*`. |
| **ID-02** | **confirmé** | `assignment.teacherId` JSON = `TEACHERS-*` ; `teacher_assignments` PG active sur le même `teacher_code`. |
| **ID-03** | **confirmé** | Login enseignant (`identifier` type `ENS-*`) ; `POST /api/notes` **201** ; `grantedBy=class:pg_teacher_assignment+evaluation:pg_teacher_assignment` ; `evaluations.teacher_id` résolu côté PG. |
| **ID-04** | **confirmé** | Après re-PUT / dedupe : coexistence stable de **plusieurs** fiches `TEACHER-*` **et** `TEACHERS-*` pour le même `userId` / `identifier` — **pas de fusion**. |
| **ID-05** | **confirmé** | Replay sync ×2 : compteurs `teachers_canonical=1`, `users=1`, `assignments=1` stables (idempotence sur l’identité d’affectation). |
| **ID-06** | **contexte** | `student` JSON id/matricule alignés sur `students.student_code` PG dans ce run. **Aucune** décision sur l’unicité `student_code` ; transmis éventuel à un contrat V2 dédié. |

---

## 3. Questions Q1–Q7

| Id | Classification | Réponse factuelle (preuve) |
|----|----------------|----------------------------|
| **Q1** | **confirmé** | **≥ 3** ids enseignant JSON pour un même user opérationnel (`TEACHER-*` ×2 + `TEACHERS-*`) + 1 `users` + plusieurs rows `teachers` PG. |
| **Q2** | **confirmé** | Points d’écriture observés : PUT state (users/contacts) · PUT teachers (canonique + jumeau) · PUT assignments → sync PG · login JWT · POST notes / `evaluations.teacher_id`. |
| **Q3** | **confirmé** | Canonique **de fait** pour l’affectation / `teacher_assignments` : id `TEACHERS-*` (post-02B). Cela **n’élimine pas** les jumeaux JSON. |
| **Q4** | **confirmé** | Oui — jumeaux `TEACHER-*` / `TEACHERS-*` **restent** après sync/dedupe. |
| **Q5** | **confirmé** | `teachers.teacher_code` PG du row d’affectation = id pédagogique BO `TEACHERS-*`. |
| **Q6** | **confirmé** | Le `teachers.user_id` du row canonique pointe vers le `users` dont `user_code` = user BO de session du POST. |
| **Q7** | **confirmé** *(écart)* | JSON : `assignment.teacherId` et `evaluation.teacherId` = **`TEACHERS-*`**. PG : `evaluations.teacher_id` résout vers un row dont `teacher_code` = **`TEACHER-*`**. **Divergence JSON ↔ PG sur l’évaluation.** |

### Extrait machine (Q7)

```text
assignment.teacherId  = TEACHERS-…
evaluation.teacherId  = TEACHERS-…
pgEval.teacher_code   = TEACHER-…     ← écart
grantedBy             = class:pg_teacher_assignment+evaluation:pg_teacher_assignment
POST                  = 201
```

---

## 4. Schéma des cycles observés

```text
Contact enseignant + compte user (identifier ENS-*)
        │
        ├─► users BO / users PG          (user_code USERS-*)
        │
        ├─► teachers JSON TEACHERS-*     (fiche pédagogique + affectation)
        │         └─► teachers PG (teacher_code TEACHERS-*) + teacher_assignments
        │
        ├─► teachers JSON TEACHER-*      (jumeau / sync — non fusionné)
        │         └─► teachers PG (teacher_code TEACHER-*)  ← aussi cible evaluations.teacher_id
        │
        └─► JWT session (identifier ENS-*) → POST /api/notes
                  └─► evaluations.teacher_id → row TEACHER-* (observé)
```

**Points d’écriture multiples** pour un même acteur enseignant : c’est le cœur factuel de `PRE-E1-IDENTITY-LIFECYCLE`.

---

## 5. Synthèse factuelle de la dette

| Champ | Valeur |
|-------|--------|
| ID | `PRE-E1-IDENTITY-LIFECYCLE` |
| Sévérité documentée antérieure | MAJOR |
| Caractérisation V2.1 | **Maintenue MAJOR — confirmée** |
| Anomalies / écarts démontrés | (1) Multiplicité stable `TEACHER-*` / `TEACHERS-*` sans fusion · (2) Divergence `evaluation.teacherId` JSON (`TEACHERS-*`) vs `evaluations.teacher_id` PG (`TEACHER-*`) |
| Faits non pathologiques observés | Affectation PG alignée `TEACHERS-*` · `user_id` session cohérent · POST notes 201 via `pg_teacher_assignment` · idempotence sync canonique |
| `PRE-E1-STUDENT-CODE-SCOPE` | **Non tranché** (ID-06 contexte) |
| Correctif | **Non démarré** · **non autorisé** par ce rapport |

### Formulation retenue

La dette d’identité enseignant est **empiriquement confirmée** sur `develop` post-HOTFIX-02B / post-contrat V2.1 : plusieurs cycles d’identité coexistent ; une identité canonique **d’affectation** (`TEACHERS-*`) coexiste avec des identités `TEACHER-*` encore matérialisées en PG et référencées par les évaluations.

Ce rapport **ne propose pas** et **n’autorise pas** de plan correctif. Toute proposition de correction minimale devra faire l’objet d’un dossier séparé soumis à **validation CTO explicite**.

---

## 6. Hors livrable (rappel)

- Fusion / suppression d’identités  
- Migration schéma  
- Modification logique métier / fallback BO  
- Ouverture E1  
- Réouverture HOTFIX-01 / 02 / 02B  

---

## 7. Références

| Artefact | Rôle |
|----------|------|
| [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md) | Contrat accepté |
| [`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md) | Phase V2 |
| `npm run verify:pre-e1-v2-identity` | Harness |
| [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json) | Preuve |

**Fin du rapport de caractérisation V2.1 — aucun correctif.**
