# Mobile offline sync L1 — protocole Classes

Vertical slice serveur. **PostgreSQL est la seule source de vérité canonique.**
Cette PR valide le protocole (curseur opaque, scopeHash, tombstones, keyset)
sur **Classes uniquement**. Students, Assignments, SchoolCourses, CourseSchedules,
SQLite Mobile, outbox et L2 sont hors scope.

## Endpoint

```
GET /api/mobile-sync/l1/classes
GET /api/mobile-sync/l1/classes?cursor=<opaque>
```

Additif. `GET /api/classes` est inchangé (contrat, RBAC, projection).

RBAC identique à `GET /api/classes` :

`Classes:READ` | `Voir classes` | `Gérer classes` | `COUNTRY_PRIVILEGES` | `ALL_PRIVILEGES`

Le Comptable n’a pas ces permissions aujourd’hui → 403.
Un enseignant n’obtient que les classes de ses **affectations actives** (`classId` / `classCode`), jamais par `className`, jamais l’établissement entier.

Lecture : table `classes` PostgreSQL. **Interdit** : `backoffice_state`, overlay legacy.

## Réponse 200

```json
{
  "resource": "classes",
  "mode": "full | delta",
  "cursorStatus": "ok",
  "scopeHash": "hex-sha256",
  "items": [],
  "nextCursor": "opaque",
  "hasMore": false
}
```

- Sans `cursor` → `mode=full` (cold snapshot autorisé).
- Avec curseur valide, même scopeHash → `mode=delta` (warm).
- `nextCursor` pointe toujours vers le **dernier item réellement envoyé** (ou sentinelle si page vide) pour le warm suivant.
- `hasMore` : page suivante obligatoire si `true`.

## Pagination keyset

- `ORDER BY updated_at ASC, id ASC`
- `updated_at > lastUpdatedAt OR (updated_at = lastUpdatedAt AND id > lastId)`
- Pas d’OFFSET.
- Limite serveur : défaut **200**, max **500** (`?limit=` clampé).
- Fetch `limit+1` pour `hasMore`.

## Curseur opaque

JWT HMAC-SHA256 via `TokenService` existant (`JWT_SECRET`). `typ=mobile-sync-cursor`.
Le client ne fabrique jamais `updatedAt`, `id`, `scopeHash`, offset.

Payload serveur (non contractuel client) :

| Champ | Rôle |
| --- | --- |
| `sv` | schemaVersion (1) |
| `gen` | génération sync (1) — bump = invalidation globale |
| `resource` | `classes` |
| `schoolCode` / `schoolId` | tenant |
| `principalId` | `sub` (fail-closed si autre user) |
| `scopeHash` | périmètre d’autorisation |
| `lastUpdatedAt` / `lastId` | keyset |
| `iat` / `exp` | TTL 30 jours (`MOBILE_SYNC_CURSOR_TTL_SECONDS`) |

Un curseur modifié, d’une autre ressource, d’un autre tenant ou d’un autre principal est **refusé**. Pas de clé hardcodée dédiée.

## scopeHash (P0)

SHA-256 déterministe de :

- `resource=classes`
- tenant (`schoolCode`, `schoolId` si connu)
- `principalId`
- rôles effectifs triés
- permissions Classes effectivement détenues (pas le label de rôle seul)
- `scopeKind` : `school-wide` **ou** `assigned`
- si `assigned` : IDs et codes des affectations **actives**, triés

**School-wide** (Admin School, Préfet, Super Admin, autres rôles `SCHOOL_WIDE_STUDENT_READ_ROLES` qui passent le RBAC) : le hash **ne liste pas** les IDs de classes. Une classe créée reste un delta warm.

**Assigned** (Enseignant) : grant / revoke d’affectation → hash change → `scope_changed`, pas un warm incomplet.

## Tombstones

Statuts SQL réels : `active` | `inactive` uniquement (`classes_status_check`).
Pas de `deleted` / `archived` inventés. L’API Classes ne fait pas de DELETE physique.

Projection item :

`id`, `classCode`, `name`, `academicYearId`, `levelId`, `streamId`, `groupId`, `status`, `updatedAt`, `tombstone`

`tombstone: true` ⇔ `status !== "active"`. Le Mobile retirera / inactivera la ligne locale.

## Erreurs

| Situation | HTTP | `code` | `cursorStatus` |
| --- | --- | --- | --- |
| Curseur illisible / falsifié / autre ressource / autre principal | 400 | `MOBILE_SYNC_CURSOR_INVALID` | — |
| Curseur d’un autre tenant | 403 | `MOBILE_SYNC_CURSOR_INVALID` | — |
| TTL / schemaVersion / génération | 409 | `MOBILE_SYNC_CURSOR_EXPIRED` | `expired` |
| scopeHash A vs B courant | 409 | `MOBILE_SYNC_SCOPE_CHANGED` | `scope_changed` |
| Dépôt mémoire (non PG) | 503 | `MOBILE_SYNC_POSTGRES_REQUIRED` | — |
| Sans JWT | 401 | existant | — |
| Sans Classes:READ | 403 | `PERMISSION_DENIED` | — |

409 `expired` et `scope_changed` imposent `mode=full_required`. Le client **ne continue pas** avec l’ancien curseur : cold sans `cursor`.

## PostgreSQL

Chemin :

```sql
WHERE school_id = $1
  AND (filtre enseignant id/class_code si assigned)
  AND (updated_at, id) > ($lastUpdatedAt, $lastId)
ORDER BY updated_at ASC, id ASC
LIMIT $n
```

Index additif, non destructif :

`idx_classes_school_updated_at_id ON classes (school_id, updated_at, id)`

Les index existants (PK `id`, UNIQUE `class_code`, unicité nom/structure) ne couvrent pas ce keyset. Le verifier PG force `enable_seqscan=off` et exige cet index dans `EXPLAIN`.

## Observabilité

Log JSON `event=mobile_sync_l1` : `resource`, `mode`, `cursorStatus`, `itemCount`, `schoolId` interne, `durationMs`.
Jamais : curseur complet, JWT, données élèves, secrets.

## Extension L1

Réutiliser les mêmes modules (`mobileSyncCursor`, `mobileSyncScope`, erreurs, pagination).
Prochaines ressources, **une PR chacune** : Students → Assignments → SchoolCourses → CourseSchedules.
Chaque ressource a son `resource` dans le curseur (non réutilisable) et son `scopeHash` (filtre autoritatif serveur).
SQLite/SQLCipher Mobile seulement après validation de ce protocole.
