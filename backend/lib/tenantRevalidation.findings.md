# Tenant revalidation — findings Enrollment

Sonde HTTP dual-identity `enrollmentTenant.http.pg.test.js` (A leftover `CD-2026-0001` / login `CD-LAC-26-001`, B leftover `BI-2026-0001` / login `BI-BUJ-26-001`).

Runtime inchangé dans ce lot. Correctif étroit dédié requis.

| # | Endpoint / identité | Effet observé | Contrat |
|---|---------------------|---------------|---------|
| ENR-01 | `GET /api/students` Admin School A | `schoolCode=CD-2026-0001` (leftover) | émettre `CD-LAC-26-001` |
| ENR-02 | `GET /api/students` user A + JWT leftover B | **200 liste B** | jamais B |
| ENR-03 | `POST /api/classes/CLS-BUJ-6A/students` depuis A | 400 (0 write B) | 403/404 |
| ENR-04 | principal school sans `sub` | 200 | fail-closed |
| ENR-05 | user sans `school_id` | 200 | fail-closed |
| ENR-06 | membership `login_code` vide | 200 | fail-closed |

Cause source : `server.js` GET/POST/PATCH students lit `req.principal.schoolCode` ; `postgresRepository.getSchoolByCode` fait `school_code OR COALESCE(login_code, '')`.

Non-régressions observées dans la même sonde : A leftover A ne liste pas B ; header `X-Somafrik-School-Code=B` depuis A ne liste pas B ; PATCH élève B depuis A sans mutation ; B ne liste pas A ; Admin Pays CD ne liste pas BI.
