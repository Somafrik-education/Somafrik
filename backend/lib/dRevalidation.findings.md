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

Preuve locale extras : **8 PASS / 0 FAIL**. Gates Planning / Présences / Sync L1 **vertes**.

## Contrats — tous fermés sur ce HEAD

| ID | Domaine | Contrat | Statut |
|----|---------|---------|--------|
| PL-01 / PL-02 / PL-14 | Planning lecture | A jamais B ; leftover B jamais B ; projection `login_code` | **fermé** |
| PL-04 / PL-05 | Planning write | 0 write B | **fermé** |
| PL-06 / PL-07 / PL-08 | Planning fail-closed | sans `sub` / `school_id` / `login_code` vide | **fermé** |
| PL-11 | Planning Admin Pays | CD jamais BI | **fermé** |
| PR-01 / PR-02 | Présences lecture | A jamais B ; leftover B jamais B ; projection `login_code` | **fermé** |
| PR-04 / PR-05 / PR-11 | Présences write | 0 write B | **fermé** |
| PR-06 / PR-07 / PR-08 | Présences fail-closed | sans `sub` / `school_id` / `login_code` vide | **fermé** |
| PR-audit | Présences write-audit | user A + leftover B → audit A uniquement (`leftoverB=0`) | **fermé** (#439) |
| PR-scope-teacher | Présences scope | enseignant non affecté GET **200 count=0** | **fermé** (#439) |
| PR-scope-parent | Présences scope | parent sans élève GET **200 count=0** | **fermé** (#439) |
| SY-01 / SY-06 / SY-07 / SY-08 | Sync L1 | A jamais B ; leftover B jamais B ; fail-closed | **fermé** |
| SY-02 | Sync L1 students | B jamais A | **fermé** |
| SY-09 | Sync L1 enseignant révoqué | 200 `items: []` (pas 403) ; `scopeKind` absent du body | **fermé** |
| SY-10 | Sync L1 Admin Pays CD | 400 / jamais BI | **fermé** |

Gate : `npm run verify:d-revalidation`.
