# RC1 — Rapport sécurité (défensif) — 2026-09-19

**Périmètre :** préprod / isolé / statique. Aucune attaque destructive. Aucun scan de production.

## Auth / session

| Contrôle | Résultat | Preuve |
|----------|----------|--------|
| Algorithme | **HS256** (HMAC), pas RS256 | `backend/services/tokenService.js` |
| TTL access | **900 s max production** | `backend/lib/authTokenPolicy.js` `MAX_PRODUCTION_ACCESS_TTL_SECONDS` |
| Refresh / reuse grace | politique versionnée | `REFRESH_REUSE_GRACE_MS = 15s` + `verify:auth-sessions` |
| JWT en query | interdit (contrat) | `verify:jwt-header` |
| Secrets dans réponses | contrat sanitizer | `verify:sanitize-user-responses` |

Écart vs checklist #719 « JWT RS256 » : l’architecture actuelle est **HS256 + TTL 15 min**. Ce n’est pas une régression nouvelle. Classé **P2 documentation / cible crypto**, pas un P0 d’auth contournable prouvé.

## Autorisation

| Contrôle | Résultat |
|----------|----------|
| RBAC S1.4 / ADMIN-01 | gates catalogue |
| Deny Superadmin / Admin Pays données perso | `verify:platform-personal-data-deny` |
| IDOR / cross-school live | **SKIP** (besoin dual-identity PG) |
| Élévation de privilège live | **SKIP** |

## API

| Contrôle | Résultat |
|----------|----------|
| Injection SQL destructive | **non exécutée** (mandat : non destructive ; pas d’API PG) |
| XSS stocké live | **SKIP** |
| CORS / headers live préprod | **SKIP** |
| Rate limiting live | **SKIP** |
| ZAP baseline | **non ajouté** (pas d’API isolée stable) |

## Dépendances / secrets

| Contrôle | Résultat |
|----------|----------|
| Gitleaks binaire | **absent** de l’environnement agent |
| `verify:secrets` | catalogue |
| `audit:ci` (critical omit=dev) | catalogue |
| Mobile `npm audit` complet | 20 vulns (16 high / 4 moderate) — RQ-510 **P3** |
| `google-services.json` | absent du tree (exemple only) |

## Mobile

| Contrôle | Résultat |
|----------|----------|
| SecureStore / HTTPS | `verify:mobile-security` |
| HelpHost hors navigator | **FAIL produit P0** — RQ-717 |
| Storage legacy AAB | source **PASS** — AAB store **SKIP** |
| Push token révocable live | **SKIP** |

## Findings

| ID | Sévérité | Statut |
|----|----------|--------|
| RQ-717 HelpHost crash | P0 | OPEN |
| RQ-645 Push mobile non prouvé | P0 | OPEN (runtime) |
| RQ-646 Web Push absent | P1 | OPEN |
| RQ-503 preuves live / umbrella | P1 | OPEN |
| RQ-499 AAB re-proof | P2 | OPEN process |
| JWT HS256 vs RS256 checklist | P2 | accepté architecture actuelle |
| RQ-510 Expo audit | P3 | OPEN dette |
