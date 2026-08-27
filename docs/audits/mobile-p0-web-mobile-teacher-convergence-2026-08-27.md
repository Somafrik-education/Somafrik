# P0 — Convergence Web / Mobile identité enseignant — 2026-08-27

## Base

- `develop`: `f499e15e6c7713933d1dc928e757683bfd2799ca` (merge #358, rollback contrôlé vers RC2 Offline Read)
- Branche: `cto/p0-mobile-web-teacher-convergence`
- Ancienne PR #357: source technique validée mais devenue non mergeable après #358 ; le correctif est reconstruit proprement depuis le `develop` actuel.

## Incident constaté

Compte enseignant KILOMBO SEKE : PostgreSQL/Web portent 4 affectations actives, tandis que Mobile reçoit `GET /api/assignments` en `200` avec `[]`, ce qui fait tomber la vue métier à 0 classe / 0 élève alors que des cours restent visibles via un autre référentiel.

## Cause racine

Au login Mobile, la fusion `users` + `teachers` pouvait laisser `teachers.id` écraser `users.id`. Le JWT était alors émis avec `sub = teachers.id`. Le scope live d'Assignments interroge `user_roles.user_id`, qui référence `users.id` : aucun rôle live n'était retrouvé, donc `scopeKind=none` puis `200 []`.

Une seconde asymétrie existait dans l'identité live Assignments : `getLiveTeacherIdentityForSchool` imposait une correspondance supplémentaire sur `users.school_id`, alors que les lectures Classes/Élèves s'appuient sur `teachers.user_id + teachers.school_id`.

## Correctif

1. Le login conserve l'identité canonique `users.id` après enrichissement par la fiche enseignant.
2. `buildPrincipal` expose `userId = sub` pour éviter les divergences internes.
3. `resolveCanonicalUserIdForSchool` accepte :
   - rang 1 : `principal.sub = users.id` ayant un rôle actif dans le tenant ;
   - rang 2 : ancien jeton `principal.sub = teachers.id` du tenant, résolu vers `teachers.user_id`.
4. Aucun fallback par nom, `teacherCode`, permission élargie ou lecture school-wide.
5. L'identité live enseignant est alignée sur `teachers.user_id + teachers.school_id`, sans dépendre de `users.school_id`.
6. La projection L1 expose `teacher_user_id = teachers.user_id` directement.
7. Une trace non nominative `TEACHER_ASSIGNMENTS_PRINCIPAL_IDENTITY` expose le nombre de rôles, d'affectations autorisées et de lignes finales.

## Régressions reprises

Les tests de #357 sont repris sur la nouvelle base :

- session canonique `users.id` + 4 affectations => GET `/api/assignments` retourne exactement 4 lignes ;
- ancien JWT `sub = teachers.id` => récupération vers le même `users.id` et mêmes 4 lignes ;
- utilisateur enseignant sans fiche `teachers.user_id` correspondante => `[]` fail-closed ;
- aucune fuite d'affectations inter-enseignant / inter-tenant ;
- L1 `teacherUserId` vient de `teachers.user_id`.

Le HEAD source #357 (`f553a90d394d78a8d6becf4fb440bb09384123d4`) avait déjà passé `Architecture Audit`, `Admin User Creation E2E` et `PR Gates`. La nouvelle branche doit repasser ses propres gates sur la base post-rollback.

## Gate métier avant Ready / merge

Aucun Ready / merge tant que le déploiement de préprod ne montre pas, avec le compte KILOMBO :

```text
GET /api/assignments 200
rows=4
TEACHER_ASSIGNMENTS_PRINCIPAL_IDENTITY ... scopeKind=assigned ... assignmentIds=4 rows=4
```

Puis Mobile doit converger avec le Web pour les classes, élèves et cours réellement affectés.
