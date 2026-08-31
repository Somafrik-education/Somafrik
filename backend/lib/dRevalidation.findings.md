# Lot D revalidation — Planning / Présences / Sync L1

Revalidation evidence/test-only après merges **#435** (Planning), **#436** (Présences), **#437** (Sync L1 SY-08).

Baseline : `develop@c2b9b2ebc8a7dcefbd556bde3e5080e81057c15b`.

Sondes HTTP dual-identity :

- `planningTenant.http.pg.test.js` (GP-014)
- `presenceTenant.http.pg.test.js` (GP-015)
- `mobileSyncTenant.http.pg.test.js` (GP-020 / SY-08)
- `dRevalidation.http.pg.test.js` (PR-audit, PR-scope, SY-02 / SY-09 / SY-10)

Fixture A/B (leftover JWT ≠ `login_code`) :

```text
A  : school_code=CD-2026-0001  login_code=CD-LAC-26-001
B  : school_code=BI-2026-0001  login_code=BI-BUJ-26-001
A2 : school_code=CD-2026-0002  login_code=CD-LAC-26-002
```

**Aucun runtime métier modifié dans ce lot.** La gate n'est pas assouplie pour verdir.
RC3 SQLCipher / offline (#354 / #355) = **HORS_RELEASE**.
Smoke appareil / kill-relaunch offline = **MANUAL BLOCKER**.

Preuve locale extras : **5 PASS / 3 FAIL**. Les gates Planning / Présences / Sync L1 rejouées sont **vertes**.

## Contrats rejoués — FERMÉS

| ID | Domaine | Contrat | Statut |
|----|---------|---------|--------|
| PL-01 / PL-02 / PL-14 | Planning lecture | A jamais B ; leftover B jamais B ; projection `login_code` | **fermé** (`verify:planning-tenant` OK) |
| PL-04 / PL-05 | Planning write | 0 write B | **fermé** |
| PL-06 / PL-07 / PL-08 | Planning fail-closed | sans `sub` / `school_id` / `login_code` vide | **fermé** |
| PL-11 | Planning Admin Pays | CD jamais BI | **fermé** |
| PR-01 / PR-02 | Présences lecture | A jamais B ; leftover B jamais B ; projection `login_code` | **fermé** (`verify:presence-tenant` OK) |
| PR-04 / PR-05 / PR-11 | Présences write | 0 write B | **fermé** |
| PR-06 / PR-07 / PR-08 | Présences fail-closed | sans `sub` / `school_id` / `login_code` vide | **fermé** |
| SY-01 / SY-06 / SY-07 / SY-08 | Sync L1 | A jamais B ; leftover B jamais B ; sans `sub` ; `login_code` vide fail-closed | **fermé** (`verify:sync-l1-tenant` OK) |
| SY-02 | Sync L1 students | B jamais A | **fermé** |
| SY-09 | Sync L1 enseignant révoqué | 200 `items: []` (pas 403 global) ; `scopeKind` absent du body courant | **fermé** (contrat actuel préservé) |
| SY-10 | Sync L1 Admin Pays CD | 400 / jamais BI | **fermé** |

## Findings #437 reproduits — HOLD, aucun correctif dans cette PR

| ID | Contrat | Observé exact sur ce develop | Statut |
|----|---------|------------------------------|--------|
| **PR-audit** | user école A + JWT leftover B qui écrit A → `audit_logs` rattaché à A, jamais B | POST `/api/presences` **201** sur l'élève A (`schoolCode=CD-LAC-26-001` dans le body métier). `upsert_attendance_batch` a **aussi** une ligne `school_code=BI-2026-0001` / `login_code=BI-BUJ-26-001`. Source : `pedagogyService.upsertAttendanceBatch` audite `principal.schoolCode` leftover. | **OUVERT** |
| **PR-scope-teacher** | enseignant non affecté → GET Présences n'élargit pas toute l'école | GET `/api/presences` **200**, `count=3`, `expanded=true` (voit les présences A). Fallback `studentIds.size ? byStudents : scopedPresences` dans `server.js`. | **OUVERT** |
| **PR-scope-parent** | parent sans élève autorisé → GET Présences n'élargit pas toute l'école | GET `/api/presences` **200**, `count=3`, `expanded=true`. Même fallback. | **OUVERT** |

**STOP métier.** Ne pas corriger dans cette PR. Correctifs étroits dédiés uniquement après GO CTO, **1 PR à la fois**.

Gate : `npm run verify:d-revalidation`.
Échec volontaire tant que PR-audit / PR-scope sont ouverts.
