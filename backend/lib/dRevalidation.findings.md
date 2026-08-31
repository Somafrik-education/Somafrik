# Lot D revalidation finale — Planning / Présences / Sync L1

Revalidation evidence/test-only après merges **#435** (Planning), **#436** (Présences), **#437** (Sync L1 SY-08), **#439** (Présences audit + empty student scope).

Baseline : `develop@58407d8c1beb9dd37a83db7b302350292295fc93`.

Sondes HTTP dual-identity :

- `planningTenant.http.pg.test.js` (GP-014)
- `presenceTenant.http.pg.test.js` (GP-015, y compris PR-audit / PR-scope-teacher / PR-scope-parent)
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

Preuve locale PostgreSQL (`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres`) : **gates GP-014 / GP-015 / GP-020 vertes** ; extras **10 PASS / 0 FAIL**.

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
| PR-audit | Présences audit | A + leftover B → métier A (`schoolCode=CD-LAC-26-001`), `upsert_attendance_batch` A uniquement, leftoverB=0 | **fermé** (GP-015 + extra) |
| PR-scope-teacher | Présences scope | enseignant non affecté → 200 `count=0` `expanded=false` | **fermé** (GP-015 + extra) |
| PR-scope-teacher-assigned | Présences scope | enseignant affecté classe A → 200 subset A, jamais B | **fermé** (extra) |
| PR-scope-parent | Présences scope | parent sans élève → 200 `count=0` `expanded=false` | **fermé** (GP-015 + extra) |
| PR-scope-admin-A | Présences scope | admin école A → scope école A, jamais B | **fermé** (extra) |
| SY-01 / SY-06 / SY-07 / SY-08 | Sync L1 | A jamais B ; leftover B jamais B ; sans `sub` ; `login_code` vide fail-closed | **fermé** (`verify:sync-l1-tenant` OK) |
| SY-02 | Sync L1 students | B jamais A (`200`, items B only) | **fermé** |
| SY-09 | Sync L1 enseignant révoqué | 200 `items: []` (pas 403 global) ; `scopeKind` absent | **fermé** (contrat actuel préservé) |
| SY-10 | Sync L1 Admin Pays CD | 400 / jamais BI | **fermé** |

Aucun finding ouvert sur ce baseline. Pas de correctif métier dans cette PR.

Gate : `npm run verify:d-revalidation`.
