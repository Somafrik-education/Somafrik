# Planning / Présences / Sync E2E — revalidation #427

Baseline : `develop@30dd5db9199f6f46e213995b846b168328feb9fe`.
Sonde HTTP dual-identity `planningPresenceSyncRevalidation.http.pg.test.js` (91 checks).

Fixture obligatoire :

```text
A  : school_code=CD-2026-0001  login_code=CD-LAC-26-001
B  : school_code=BI-2026-0001  login_code=BI-BUJ-26-001
A2 : school_code=CD-2026-0002  login_code=CD-LAC-26-002   (même pays CD)
```

**Aucun runtime métier modifié dans ce lot.** La gate n'a pas été assouplie pour verdir.
RC3 SQLCipher / offline exactly-once (#354 / #355) = **HORS_RELEASE**.
Smoke appareil physique / kill-relaunch offline = **MANUAL BLOCKER** (impossible via CI).

Résultat local HEAD de cette PR : **78 PASS / 13 FAIL**. La gate `verify:planning-presence-sync-revalidation` **échoue** (contrat).

## HOLD historiques inspectés

| ID | Domaine | Statut audit #400 | Revalidation HEAD | Preuve |
|----|---------|-------------------|-------------------|--------|
| GP-014 | Planning V1 créneau PG | HOLD | **HOLD** — P0 lecture leftover JWT + fail-closed + projection | HTTP `GET/POST/PATCH/DELETE /api/course-schedules` |
| GP-015 | Présences enseignant / IDs | HOLD | **HOLD** — P0 lecture leftover JWT + fail-closed + projection | HTTP `GET/POST /api/presences` |
| GP-020 | Sync E2E L1 baseline | HOLD | **HOLD** partiel — isolation A/B L1 **FERMÉE** ; `login_code` vide **HOLD** | HTTP `/api/mobile-sync/l1/{classes,students,assignments,school-courses,course-schedules}` |

`verify:sync-end-to-end` historique login leftover `CD-2026-0001` n'est **pas** relâché : preuve canonique = leftover ≠ login_code, pas rematch leftover-cohérent.

## Matrice observée (ne pas assouplir)

### Isolation leftover-vs-leftover (JWT = leftover A) — FERMÉ

| # | Endpoint / identité | Observé |
|---|---------------------|---------|
| PL-01 | `GET /api/course-schedules` Admin A leftover A | 200, créneau A, **jamais B**, **jamais A2** |
| PL-03 | header / query `schoolCode=B` depuis A | jamais B (`ignoreClientScope` / JWT A) |
| PL-04 | `POST /api/course-schedules` course B + body `schoolCode=B` depuis A | **404**, 0 write B |
| PL-05 | `PATCH`/`DELETE` slot B depuis A | **404**, état B inchangé |
| PL-09 | GET B | 200, jamais A (projection leftover B, voir FAIL) |
| PL-12 | A vs A2 même pays | frontière établissement OK |
| PL-13 | enseignant A | 200, jamais B |
| PL-10 | Superadmin global | 200 |
| PR-01 | `GET /api/presences` A | 200, présence A, jamais B/A2 (projection leftover, voir FAIL) |
| PR-03 | header B depuis A | jamais B |
| PR-04 | `POST /api/presences` élève B depuis A leftover A | **404**, 0 write B |
| PR-05 | JWT leftover B `POST` élève B | **404**, 0 write B |
| PR-09 / PR-10 / PR-11 | B / Admin Pays / enseignant write B | isolation write OK |
| SY-01…SY-05 | Sync L1 A | 200, jamais B, jamais A2 |
| SY-06 | JWT leftover B depuis user A sur 5 ressources L1 | 200, **jamais B** (scope live vide sur école B) |
| SY-07 | Sync sans `sub` | **400** fail-closed |
| SY-09 | Superadmin sync classes | 400 (schoolCode `*` requis) |
| SY-10 | Admin Pays CD sync | jamais BI |

### FAIL reproduits — garder HOLD, correctif étroit dédié (pas ce lot)

| # | Endpoint / identité | Contrat | Observé exact |
|---|---------------------|---------|----------------|
| **PL-02** | `GET /api/course-schedules` user A + JWT leftover B | jamais B | **200, liste B** — `principal.schoolCode` leftover fait autorité |
| **PR-02** | `GET /api/presences` user A + JWT leftover B | jamais B | **200, liste B** — `listCanonicalStudentsForPrincipal(principal.schoolCode)` leftover |
| **PL-14** | projection Planning | `schoolCode=login_code` | émet leftover `CD-2026-0001` |
| **PR-01** | projection Présences | `schoolCode=login_code` | émet leftover `CD-2026-0001` |
| **PL-09** | projection B | `BI-BUJ-26-001` | leftover `BI-2026-0001` |
| **PL-06** | Planning sans `sub` | fail-closed | **200** (JWT leftover A suffit) |
| **PL-07** | Planning user sans `school_id` | fail-closed | **200** |
| **PR-06** | Présences sans `sub` | fail-closed | **200** |
| **PR-07** | Présences sans `school_id` | fail-closed | **200** |
| **PL-08** | Planning `login_code` vide | fail-closed, pas de fallback leftover | **200** via `school_code=CD-2026-0099` |
| **PR-08** | Présences `login_code` vide | fail-closed | **200** |
| **SY-08** | Sync L1 classes `login_code` vide | fail-closed | **200** |
| **PL-11** | Admin Pays CD `GET /course-schedules` | jamais BI | **fuite B** (liste globale si `schoolCode=*`) |

## Source map (autorité actuelle)

- Planning `resolveSchoolContext` / `listCourseSchedules` : `principal.schoolCode` + `pedagogyPgStore.getSchoolByCode` leftover-only (`WHERE school_code = $1`).
- Présences GET : `listCanonicalStudentsForPrincipal(req.principal.schoolCode)` leftover.
- Présences POST : `assertPrincipalStudentTenant` leftover ; body `schoolCode` ignoré → 0 write B depuis JWT A (PR-04 FERMÉ).
- Sync L1 : `principal.schoolCode` puis membership live `user_id+school_id` — JWT leftover B **ne fuit pas** (SY-06 FERMÉ) car rôles live absents sur B.
- `postgresRepository.getSchoolByCode` conserve `school_code OR COALESCE(login_code)` (lookup global, hors correctif de ce lot).

## Correctifs étroits proposés (lots suivants, 1 PR chacun)

1. **Planning GET/list membership UUID** — `principal.sub → users.school_id` ; JWT leftover B ne sélectionne plus B ; projection `login_code` ; fail-closed sans sub / sans school_id / login_code vide ; Admin Pays filtré par pays.
2. **Présences GET membership UUID** — même contrat que Enrollment #432 sur `listCanonicalStudentsForPrincipal` / projection.
3. Ne **pas** mega-refactor JWT global / #404. Ne pas toucher RC3.

Gate : `npm run verify:planning-presence-sync-revalidation`.
Échec volontaire tant que les 13 FAILs ci-dessus existent.
