# P1 — Teacher canonical identity (KILOMBO SEKE) — 2026-08-27

**Type :** audit PostgreSQL read-only + alignement identité live Assignments  
**PR :** Draft dédiée, **indépendante de #354 / #355**  
**Branche :** `cursor/p1-teacher-canonical-identity-9855`  
**Base :** `develop@fc259bf3590c0b7a30da92a6d519a83503c5f4fc`

## Contexte Mobile

```text
students     source=network success rows=6
classes      source=network success rows=3
assignments  source=network empty   rows=0
```

GET Classes / Élèves enseignant passent par `teachers.user_id = session.userId`.  
GET Assignments L1 passait par `getLiveTeacherIdentityForSchool`, qui **joignait aussi** `users.school_id = teachers.school_id`. Si `users.school_id` est NULL, Classes reste peuplé et Assignments renvoie `[]` (fail-closed). Ce n’est pas un fallback Mobile par nom.

Le `403 /teachers` n’est pas corrigé ici : un enseignant n’a pas à lire l’annuaire.

## Inventaire preprod (READ ONLY) — KILOMBO SEKE

Cible : `PREPROD_DATABASE_URL` (Supabase EU). Aucune écriture.

```text
users.id              c81b0ec1-b8dd-4f09-8357-6775586920ff
user_code             USR-2026-00007
user_roles            TEACHER active / CD-2026-0001
teachers.id           cd866ff1-92f5-4bf6-9086-dce64f903717
teachers.user_id      c81b0ec1-b8dd-4f09-8357-6775586920ff
teachers.school_id    3b11f338-38a9-43ba-9321-ebfc526b21af
school_code           CD-2026-0001
teacher_code          CD-2026-0001-ENS-0001
affectations actives  4
  1ère A  Mathématiques
  2ème A  Géographie
  2ème A  Mathématiques
  2ème C  Mathématiques
```

Contrat :

```text
users.id                    === teachers.user_id     ✅
teachers.id                 === teacher_assignments.teacher_id  ✅
même school_id              ✅
```

**Verdict preprod : `CANONICAL`. Aucune mutation appliquée.**

SQL live `getLiveTeacherIdentityForSchool(c81b0ec1…, 3b11f338…)` : HIT (teacher_id `cd866ff1…`).

## Correctif code (sans toucher aux données)

`getLiveTeacherIdentityForSchool` est aligné sur `listLiveTeacherClassAssignmentsForSync` :

```text
teachers.user_id  = session userId
teachers.school_id = schoolId JWT / getSchoolByCode
```

Plus de `JOIN users u ON u.school_id = t.school_id` (ce JOIN faisait diverger Assignments vs Classes).  
Toujours aucun matching par `first_name` / `teacherCode`.

Log non sensible si scope enseignant sans identité :

```text
TEACHER_CANONICAL_IDENTITY unresolved resource=assignments scopeKind=assigned
```

Outil ops (read-only par défaut) :

```text
PREPROD_DATABASE_URL=… npm run audit:teacher-canonical-identity -- --name "KILOMBO SEKE"
# --apply uniquement si verdict=REPAIRABLE_UNLINKED (1 user + 1 teacher.user_id NULL + N affectations)
```

## Régression attendue après déploiement API

```text
RC2_L1_READ resource=assignments source=network status=success rows=4
```

Puis accueil enseignant : classes / élèves du périmètre réellement affecté (pas 0/0 si le JWT `sub` est `c81b0ec1…`).

Si Assignments reste à 0 alors que ce log `unresolved` apparaît, le `sub` JWT n’est pas `teachers.user_id` — nouvel inventaire `--user-id` du compte de connexion, **pas** de matching par nom côté API.

## Hors scope

- #354 / #355 (RC3) : inchangés, Draft/HOLD
- Grant `Teachers:READ` / `Enseignants:READ` à l’enseignant
- Fallback Mobile par nom `KILOMBO SEKE` ou `teacherCode`
- Mutation preprod KILOMBO (déjà canonique)

## Verdict

```text
Preprod KILOMBO lien canonique     OK — pas de UPDATE
Asymétrie Classes vs Assignments   CORRIGÉE (identité = teachers.user_id)
Apply data                         NON (preprod CANONICAL)
Ready                              NON tant que régression rows=4 non vue sur device
Merge                              NON
RC3-2 smoke                        HOLD
```
