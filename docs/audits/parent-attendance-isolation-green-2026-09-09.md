# P0 — Isolation Parent / Présences (GREEN)

Branche : `cursor/parent-attendance-isolation-green-d98a`
Base : `develop@1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82`
Preuve RED conservée : PR #574 (`b2752435`), Draft, **HOLD — ne pas merger**.

## Correctifs

1. **`role` et `roleKeys`** — `principalIsParentOrStudent` (`backend/lib/parentScope.js`) reconnaît Parent/Élève par libellé **et** `PARENT` / `STUDENT`. Utilisé par `classStudentsAuthz`, `TenantScopeService`, `hydrateParentPrincipal`, `presenceListStaysStudentScoped`.
2. **Rattachement canonique** — `contacts.user_id` → `contact_relations.student_id`. Le lookup distingue `ok` / `unavailable` / `error`. Dès que PostgreSQL est l’autorité (`ok` ou `error`) : **aucun repli JWT ni back-office**. `ok` + 0 relation (y compris relation supprimée) ⇒ 0 donnée. Erreur de lecture ⇒ fail-closed. Le JWT ne sert que d’alias d’identité des enfants canoniques. Repli JWT uniquement si le store mémoire n’expose pas le lookup live (`unavailable`).
3. **`GET /api/classes`** — Parent : uniquement les classes des enfants liés, `students` = nombre d’enfants liés dans la classe (pas l’effectif camarades). Sans enfant → `[]`.
4. **Roster** — `scopeClassStudentsForPrincipal` + resolveur fail-closed sur les clés liées. `roleKeys` sans `role` ne retombe plus sur `return rows`.
5. **Présences** — même jeu de clés ; liste student-scoped si Parent via `role` ou `roleKeys`.
6. **`TenantScopeService`** — plus de passe-plat `className` / `entityType` pour Parent. Uniquement `rowMatchesStudentScope`.
7. **UI** — `PresencesPage` : mode Parent « Mes enfants », sélecteur d’enfant si plusieurs, pas de cartes de classe, pas de KPI, pas de roster camarades. `buildPresenceClassCards` renvoie `[]` pour Parent.

## Matrice

HTTP PG : 4 GET + Teacher/Admin/cross-school + `contact_relations` sans JWT + JWT camarade rejeté + `roleKeys` seul + **relation supprimée + JWT stale = 0** + **erreur `contact_relations` = fail-closed**.

## Hors périmètre

Notes, Bulletins, Paiements : après clôture de ce P0.
Replay préprod `papa Maeve` : requis avant Ready / merge (JWT non disponible ici).
Ne pas merger #574.
