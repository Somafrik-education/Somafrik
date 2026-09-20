# RC1 — Rapport sécurité (défensif) — 2026-09-20

**Périmètre :** isolé + statique + lecture seule préprod health. Aucune attaque destructive. Aucun write production.

Requalification **#503 contre le code actuel** (`develop@109fa474`), pas contre son état AAB v20 historique.

## Auth / session

| Contrôle | Résultat | Preuve |
|----------|----------|--------|
| Algorithme | **HS256** (HMAC), pas RS256 | `backend/services/tokenService.js` — écart checklist **P2** architecture |
| TTL access | **900 s max production** | `authTokenPolicy.js` |
| Refresh / reuse / logout | **PASS** | `verify:auth-sessions` |
| JWT en query | **PASS** | `verify:jwt-header` |
| Secrets dans réponses | **PASS** | `verify:sanitize-user-responses` |
| Lockout | contrat dans auth-sessions | non rejoué UI préprod |

## Autorisation

| Contrôle | Résultat |
|----------|----------|
| RBAC S1.4 | **PASS** |
| Deny Superadmin / Admin Pays données perso | **PASS** `verify:platform-personal-data-deny` (9/9) |
| Cross-tenant JOIN assignments | **PASS** `SELECT_ASSIGNMENT` exige `school_id` |
| IDOR / dual-identity HTTP live | **SKIP** (pas de stack dual-identity) |
| Élévation live après changement de rôle | **SKIP** runtime UI |

## API / Data API / erasure

| Contrôle | Résultat |
|----------|----------|
| Data API lockdown (unité) | **PASS** |
| Data API lockdown PG | **PASS** — `residualGrants=0` tables sensibles |
| Erasure (implémenté, testable) | **PASS** `verify:privacy-erasure` 12/12 (self-execute, deny Superadmin, cross-school) |
| Probe #503 local | **PASS** `verify:preprod-503-local` |
| Injection SQL destructive | **non exécutée** |
| ZAP | **non ajouté** |

## Dépendances / secrets

| Contrôle | Résultat |
|----------|----------|
| Gitleaks 8.24.3 | **PASS** — 2194 commits, 0 leak |
| `audit:ci` | **PASS** |
| Mobile `npm audit` | 20 vulns (16 high / 4 moderate) — RQ-510 **P3** |
| `google-services.json` | absent du tree |

## Mobile

| Contrôle | Résultat |
|----------|----------|
| SecureStore / HTTPS | **PASS** `verify:mobile-security` |
| Android release readiness | **PASS** (config source) |
| Storage AAB store | **SKIP** re-proof — RQ-499 P2 |
| Push tap | hors gate #737 |

## Findings

| ID | Sévérité | Statut |
|----|----------|--------|
| Cross-tenant / auth contournable | P0 | **non reproduit** |
| Plateforme → données établissement | P0 | **PASS** deny |
| Data API grants | P0 | **PASS** residual 0 |
| #503 umbrella GitHub | — | OPEN process ; **pas de P1 sécurité critique reproduit** |
| JWT HS256 vs RS256 | P2 | architecture actuelle |
| RQ-499 AAB | P2 | source OK, store SKIP |
| RQ-510 Expo | P3 | dette |
