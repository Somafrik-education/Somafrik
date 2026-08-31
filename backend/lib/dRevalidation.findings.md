# Lot D revalidation — Planning / Présences / Sync L1

Revalidation evidence/test-only après merges **#435** (Planning), **#436** / **#439** (Présences), **#437** (Sync L1 SY-08).

Baseline : `develop@58407d8c1beb9dd37a83db7b302350292295fc93` (merge #439).

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

## Contrats

| ID | Domaine | Contrat | Statut |
|----|---------|---------|--------|
| PL-01 / PL-02 / PL-14 | Planning lecture | A jamais B ; leftover B jamais B ; projection `login_code` | **fermé** (gate GP-014) |
| PL-04 / PL-05 | Planning write | 0 write B | **fermé** |
| PL-06 / PL-07 / PL-08 | Planning fail-closed | sans `sub` / `school_id` / `login_code` vide | **fermé** |
| PL-11 | Planning Admin Pays | CD jamais BI | **fermé** |
| PR-01 / PR-02 | Présences lecture | A jamais B ; leftover B jamais B ; projection `login_code` | **fermé** (gate GP-015) |
| PR-04 / PR-05 / PR-11 | Présences write | 0 write B | **fermé** |
| PR-06 / PR-07 / PR-08 | Présences fail-closed | sans `sub` / `school_id` / `login_code` vide | **fermé** |
| PR-audit | Présences write-audit | user A + leftover B → audit A, jamais B | à confirmer sur ce HEAD |
| PR-scope-teacher | Présences scope | enseignant non affecté n'élargit pas l'école | à confirmer sur ce HEAD |
| PR-scope-parent | Présences scope | parent sans élève n'élargit pas l'école | à confirmer sur ce HEAD |
| SY-01 / SY-06 / SY-07 / SY-08 | Sync L1 | A jamais B ; leftover B jamais B ; sans `sub` ; `login_code` vide fail-closed | **fermé** (gate GP-020) |
| SY-02 | Sync L1 students | B jamais A | à confirmer |
| SY-09 | Sync L1 enseignant révoqué | 200 `items: []` (pas 403 global) | à confirmer |
| SY-10 | Sync L1 Admin Pays CD | jamais BI | à confirmer |

Gate : `npm run verify:d-revalidation`.
Échoue sur fuite cross-tenant, mutation étrangère, leftover JWT, fail-closed manquant, audit leftover ou scope élève élargi.
