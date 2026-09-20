# RC1 — Rapport sécurité (défensif) — 2026-09-20

**Périmètre :** isolé / statique / PG local. Aucune attaque destructive. Aucun scan de production.  
**#503 requalifié contre le code actuel**, pas contre l’état de septembre.

## Auth / session

| Contrôle | Résultat | Preuve |
|----------|----------|--------|
| Algorithme | **HS256** (HMAC), pas RS256 | `backend/services/tokenService.js` + `verify:auth-sessions` |
| TTL access | **900 s max production** | `verify:auth-sessions` |
| Refresh / rotation / grâce | **PASS** | `verify:auth-sessions` + `verify:preprod-503-local` |
| Refresh reuse destructif | **SKIP** (non-destructive default) | opérateur `--apply-reuse` |
| JWT en query | interdit | `verify:jwt-header` **PASS** |
| Secrets dans réponses | contrat sanitizer | `verify:sanitize-user-responses` **PASS** |

Écart vs checklist #719 « JWT RS256 » : architecture actuelle **HS256 + TTL 15 min**. **P2** documentation / cible crypto, pas un P0 d’auth contournable.

## Autorisation / #503

| Contrôle | Résultat |
|----------|----------|
| Deny Superadmin / Admin Pays données perso | **PASS** `verify:platform-personal-data-deny` |
| Data API lockdown | **PASS** PG local — 0 grant résiduel (`contacts`, `users`, `teachers`, `students`, `mobile_push_devices`, `payments`, `audit_logs`, `sessions`) |
| Routes `/confidentialite` `/suppression-compte` | **STATIC** présentes (`web/src/App.tsx`) |
| Erasure execute | **SKIP** non-destructif (`verify:preprod-503-local`) |
| Cross-tenant live dual-identity | **SKIP** (pas de comptes A/B seedés HTTP) |
| CORS / rate-limit préprod | **SKIP** |

Pas de risque sécurité **critique reproduit** sur cette baseline. Les manques live/AAB sont **P2 opérateur**, pas un P1 métier.

## Dépendances / secrets

| Contrôle | Résultat |
|----------|----------|
| Gitleaks 8.24.3 | **PASS** — 0 leak |
| `audit:ci` | **PASS** |
| Mobile `npm audit` | 20 vulns (16 high / 4 moderate) — RQ-510 **P3** |
| `google-services.json` | absent du tree (exemple only) |

## Mobile

| Contrôle | Résultat |
|----------|----------|
| SecureStore / HTTPS | **PASS** |
| Storage legacy AAB (config) | **PASS** source — AAB store **SKIP** |
| HelpHost | **CLOSED** #717 |
| Push / tap | #645 **CLOSED** ; #737 **P2 hors gate** |

## Findings

| ID | Sévérité | Statut |
|----|----------|--------|
| RQ-733 / #732 sync school_course | — | **CLOSED / PASS** |
| RQ-717 HelpHost | — | **CLOSED / PASS** |
| RQ-645 Mobile Push | — | **CLOSED** |
| RQ-646 Web Push | P2 | hors gate |
| RQ-737 tap Push | P2 | hors gate |
| RQ-503 live / AAB | P2 | opérateur |
| RQ-499 AAB re-proof | P2 | opérateur |
| JWT HS256 vs RS256 | P2 | accepté architecture actuelle |
| RQ-510 Expo audit | P3 | dette |
