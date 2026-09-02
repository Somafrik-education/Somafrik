# Tenant revalidation — Enrollment fermé par #432

Sonde HTTP dual-identity `enrollmentTenant.http.pg.test.js` (A leftover `CD-2026-0001` / login `CD-LAC-26-001`, B leftover `BI-2026-0001` / login `BI-BUJ-26-001`).

Base : `develop@2fd8cdb9` (merge #432). ENR-01…ENR-07 sont des **invariants**, plus des findings.

| # | Endpoint / identité | Contrat | Statut |
|---|---------------------|---------|--------|
| ENR-01 | `GET /api/students` Admin School A | émettre `CD-LAC-26-001` | **fermé** |
| ENR-02 | `GET /api/students` user A + JWT leftover B | jamais B ; projection membership A | **fermé** |
| ENR-03 | `POST /api/classes/CLS-BUJ-6A/students` depuis A | 403/404 ; 0 write B | **fermé** |
| ENR-04 | principal school sans `sub` | fail-closed 403/401 | **fermé** |
| ENR-05 | user sans `school_id` | fail-closed 403/401 | **fermé** |
| ENR-06 | membership `login_code` vide | fail-closed 403/401 | **fermé** |
| ENR-07 | POST/PATCH/DELETE A + leftover JWT B | audit sur A ; 0 audit leftover B | **fermé** |

Autorité Enrollment : `principal.sub → users.id → users.school_id → schools.id`. Projection HTTP `schoolCode = schools.login_code`.

`getSchoolByCode` global conserve `school_code OR COALESCE(login_code)` (hors scope Enrollment). Les routes GET/POST/PATCH/DELETE élèves n'utilisent plus `req.principal.schoolCode` comme autorité.
