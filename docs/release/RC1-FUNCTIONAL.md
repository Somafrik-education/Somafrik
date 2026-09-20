# RC1 — Rapport fonctionnel — 2026-09-20

**Commande :** `npm run verify:rc1-gates`  
**Evidence :** [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json)  
**Extra :** [evidence/rc1-requalify-extra-results.json](./evidence/rc1-requalify-extra-results.json)  
**Baseline :** `develop@109fa474`

## Catalogue `verify:rc1-gates`

**21 PASS / 3 FAIL / 24** — `node v22.14.0`. JWT-HEADER est **PASS** (était FAIL sur e457934f).

| ID | Exit | Classification RC1 |
|----|------|--------------------|
| JWT-HEADER | **PASS** | Auth fail-closed + PDF Bearer OK sur backend mémoire. |
| RBAC-ADMIN-01 | FAIL | **P2** — le script attend encore `teachers` writable sur PUT ; LOT 3 a retiré cette clé. Script **stale**, pas une régression PUT métier. |
| NOTES-SYNC | FAIL | **P3 / SKIP env** — 3/4 gardes boot OK ; `initializeRepository` → `STUDENT_CANONICAL_POSTGRES_ALLOCATOR_NOT_READY`. |
| SECRETS | FAIL | **P3** — gitleaks local 76 `generic-api-key`, presque tous dans `docs/audits/evidence/*` historiques. **CI Secrets = SUCCESS** sur cette PR. Pas une fuite runtime reproduite. |

LOT 0–8, RBAC S1.4, mobile-security, android-release, personal-data-deny, auth-sessions, sanitize, branding, help-v1a, db-config, disclosure, audit:ci = **PASS**.

## Extra rejoué (PostgreSQL local 16)

| ID | Résultat |
|----|----------|
| #732 assignment write-path | **PASS** 6/6 |
| Inventaire school-course | **PASS** mémoire + PG |
| Tenant academic-year / users / enrollment / planning / présence | **PASS** + HTTP PG |
| Setup guidé Web/Mobile/backend | **PASS** |
| Création enseignant | **PASS** mémoire + PG |
| Finance management | **PASS** dont FIN-CALC PG |
| #503 deny / erasure | **PASS** |
| Data API lockdown PG | **SKIP** (BYPASSRLS) |
| `verify:e2e-api` UI | **SKIP** |

## Vérifications #719

| Item | Résultat |
|------|----------|
| Suites unitaires (sous-ensemble) | via catalogue + extra |
| Intégration backend PG | **PASS** sur les gates extra ci-dessus |
| Contrats API live préprod | **SKIP** |
| LOT 0–8 | **PASS** |
| Typecheck / lint / build | CI PR Gates (Quality / Core / Required) |
| Permissions live après changement de rôle | **SKIP** UI ; contrats RBAC **PASS** |
| Écriture legacy staff | **PASS** (`legacyPedagogyStaffStateWrite`) |
