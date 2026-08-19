# P0 — Teacher / Course canonical reconciliation

**Base :** `develop@7a0e183ea0fd69b3847281090e8e047fb0802144` (#264)  
**Gouvernance :** PR **DRAFT** — aucun Ready — aucun merge.

## Symptôme

#264 a corrigé le **chargement** du sélecteur Planning (`GET /course-schedules?projection=course-options` lit `school_courses` actifs).  
Cela ne répare pas la **donnée historique** : une `teacher_assignment` n’implique pas un `school_courses` correspondant.

Cas Seke (reproduit) :

```text
teacher Seke
teacher_code = ENS-0001          ← code public legacy, pas le format canonique
2 teacher_assignments            ← relation pédagogique déjà vraie
classe 2ème A ✅
matière affectée ✅
school_courses correspondant ❌
→ Planning : aucun cours enregistré
```

Interdit : recréer Seke, recréer la classe, demander à l’utilisateur de recréer le cours.

## Règle officielle des codes enseignant

Source unique, déjà dans le dépôt — **aucune invention de format** :

`backend/lib/teacherCodeAllocation.js`

```text
login identifier : ENS-####
teacherCode / userCode / publicId : {schoolCode}-ENS-####
```

Exemple : `ENS-0001` → `CD-2026-0001-ENS-0001`.  
`teachers.id` UUID **jamais** modifié. Les FK `teacher_id` (affectations, cours, notes, présences) **jamais** réécrites.

## Correctif

Bootstrap PostgreSQL idempotent `ensureTeacherCourseCanonicalReconcile()` après le schéma pédagogie.

### A — Identifiant enseignant

| Avant | Après |
| --- | --- |
| `teachers.teacher_code = ENS-0001` | `CD-2026-0001-ENS-0001` |
| — | `legacy_teacher_code = ENS-0001` (alias login temporaire) |
| `users.user_code = ENS-0001` | **inchangé** (alias de connexion) |
| `teachers.id` UUID | inchangé |

Si le code canonique cible appartient déjà à un autre UUID : **STOP** `CANONICAL_TEACHER_CODE_CONFLICT`.

Les lookups (notes, présences, pédagogie, login `ENS-0001`) acceptent le code court, l’alias `legacy_teacher_code` et le suffixe du code technique.

### B — Affectation → `school_courses`

Pour chaque `teacher_assignment` actif (`school_id`, `teacher_id`, `class_id`, `subject_id`, `academic_year_id`) :

- références UUID présentes, même établissement, année de la classe = année de l’affectation ;
- compter les `school_courses` actifs `(school_id, class_id, subject_id, teacher_id)` ;
- **0** et aucun cours actif classe+matière (autre enseignant) → **un** `INSERT` (`generateCourseCode` officiel `{schoolCode}-CRS-####`) ;
- **1** déjà aligné → no-op ;
- **>1** ou cours actif classe+matière avec un autre `teacher_id` → **STOP** `CANONICAL_SCHOOL_COURSE_AMBIGUOUS`.

Aucun choix silencieux. Aucun match sur libellé. Idempotent :

```text
bootstrap #1 → crée les school_courses manquants
bootstrap #2 → +0 ligne
```

## Inventaire Seke (fixture)

| | Avant boot | Après boot |
| --- | --- | --- |
| `teachers` | 1, `ENS-0001` | 1, même UUID, `CD-2026-0001-ENS-0001` |
| `teacher_assignments` | 2 | 2, mêmes UUID |
| `school_courses` | 0 | 2 (Mathématiques + Français, `teacher_id` = Seke) |
| Login | `ENS-0001` | `ENS-0001` |

`GET /course-schedules?projection=course-options` → `schoolCourseId` réconcilié.  
E2E Préfet : Planning → 2ème A → cours de Seke → lundi 08:00–09:00 → weekly créé, sans doublon `school_courses`.

## Tests

```bash
npm run verify:teacher-course-canonical-reconcile
```

PostgreSQL + HTTP + Playwright. Branché CI et Security.
