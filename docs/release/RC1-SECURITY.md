# RC1 — Rapport sécurité (défensif) — 2026-09-20

**Périmètre :** isolé + PostgreSQL local. Aucune attaque destructive. Aucun scan de production.  
**Baseline :** `develop@109fa474`  
**#503 requalifié contre le code actuel**, pas contre l’état historique du ticket.

## Auth / session

| Contrôle | Résultat | Preuve |
|----------|----------|--------|
| Algorithme | **HS256** (HMAC), pas RS256 | `backend/services/tokenService.js` ; `verify` refuse `alg` autre / `none` |
| TTL access | **900 s max production** | `verify:auth-sessions` |
| Refresh / logout / reuse grace | **PASS** | 28/28 + script OK |
| JWT en query | interdit | `verify:jwt-header` **PASS** |
| Secrets dans réponses | contrat sanitizer | `verify:sanitize-user-responses` PASS |

Écart checklist #719 « JWT RS256 » : architecture actuelle **HS256 + TTL 15 min**. **P2 documentation**, pas un P0 d’auth contournable.

## Autorisation / #503

| Contrôle | Résultat |
|----------|----------|
| Deny Superadmin / Admin Pays données perso | **PASS** `verify:platform-personal-data-deny` |
| Privacy erasure (demande / self-execute / cross-school deny) | **PASS** `verify:privacy-erasure` |
| Data API lockdown (statique) | **PASS** 3/3 |
| Data API lockdown PG live | **SKIP** (CREATE ROLE BYPASSRLS) — pas une fuite reproduite |
| Cross-tenant leftover JWT | **PASS** suites tenant HTTP PG (users, enrollment, planning, présence, academic-year) |
| IDOR / élévation live préprod | **SKIP** (pas de dual-identity préprod) |

Aucun accès cross-tenant ni élévation plateforme **reproduit**. #503 n’est donc **pas** un P1 de qualification sur ce tree.

## API

| Contrôle | Résultat |
|----------|----------|
| Injection SQL destructive | **non exécutée** |
| XSS stocké live | **SKIP** |
| CORS / headers / rate-limit préprod | **SKIP** |
| ZAP baseline | **non ajouté** |

## Dépendances / secrets

| Contrôle | Résultat |
|----------|----------|
| CI Secrets (PR) | **SUCCESS** |
| `verify:secrets` local (historique git) | 76 `generic-api-key` surtout `docs/audits/evidence/*` — **P3** |
| `audit:ci` | **PASS** |
| Mobile `npm audit` | 20 vulns — RQ-510 **P3** |
| `google-services.json` | clé client Firebase dans le tree (clé publique restreinte côté Google). Pas un secret serveur. |

## Mobile

| Contrôle | Résultat |
|----------|----------|
| SecureStore / HTTPS | `verify:mobile-security` PASS |
| HelpHost | **PASS** — #717 CLOSED |
| Storage AAB | source **PASS** — AAB store **SKIP** (#499 P2 G4) |
| Push token live | **SKIP** / hors gate |

## Findings

| ID | Sévérité | Statut |
|----|----------|--------|
| P0 reproduits | — | **0** |
| P1 reproduits | — | **0** |
| RQ-503 code | — | **PASS** ; live AAB = P2 process |
| RQ-646 / RQ-737 | P2 | hors gate |
| RQ-499 AAB | P2 | G4 Store |
| JWT HS256 vs RS256 | P2 | architecture actuelle |
| RQ-510 Expo audit | P3 | dette |
