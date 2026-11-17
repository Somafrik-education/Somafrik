# E2E-PREPROD-GLOBAL-01 — Résultats API et PostgreSQL

## 1. [E2E préprod] API `api-preprod.somafrik.app`, `gitSha=93f98e44`

| Réf. | Résultat |
|---|---|
| E2E-000 | `/api/health` → 200, `status=ok`, `database=postgresql` |
| E2E-009 | 334 routes protégées sans jeton → 401 (138 GET, 196 écritures) ; route de diagnostic absente (404) |
| Tous les autres scénarios API authentifiés | **BLOCKED (BLK-AUTH)** |
| Vérifications PostgreSQL de préproduction | **BLOCKED (BLK-PG)** : aucun rôle en lecture seule fourni. Aucune requête n'a été exécutée sur la base de préproduction. |

## 2. [Auto] Non-régression locale (2026-11-17)

Arbre `develop@763d9bd8`. #1183 (`93f98e44`), arrivé ensuite, ne modifie que `web/src/pages/UsersPage.tsx` et son test.

Base : PostgreSQL 16 jetable local, **pas la base de préproduction**.

| Suite | Résultat | Durée |
|---|---|---|
| Baseline backend unit (`backend-test-baseline.js unit`) | **2958 PASS / 0 FAIL / 3 SKIP** (préexistants) | 37 s |
| Baseline backend PostgreSQL, complète (`backend-test-baseline.js pg`) | **489 PASS / 0 FAIL / 0 SKIP** | 993 s |
| Web Vitest (complet) | **339 fichiers, 1928 tests PASS** | 174 s |
| LOT 0 à LOT 8 parity | **9 / 9 OK** | — |
| `verify:school-setup-guided-green` | Backend 58, Web 63, Mobile 21 : OK | — |
| Gate LOT 4 (L4-09) | OK | — |
| `verify:release-governance` | OK (pin `main` `fcf09327`, 30 commits autorisés) | — |
| Mobile `test:rollcall-offline` | 157 / 0 | — |
| Mobile `test:school-settings-access` | OK | — |
| `verify:mobile-security`, `mobile-cta-rbac-alignment`, `mobile-data-truth` | OK | — |
| Audit fonctionnel des paramètres, copie française | OK | — |
| Audit d'architecture (alias legacy, routes orphelines) | OK | — |
| `tsc` Web et Mobile | 0 erreur | — |

**Rappel (mandat §1 et §4) :** ces résultats sont des preuves **automatisées**. Ils ne constituent ni une recette E2E ni une vérification de la base de préproduction.

## 3. CI GitHub de référence

- **Develop** : #1174, #1176, #1177, #1182 et #1183 ont été fusionnés après CI verte, contrôlée par le CTO.
- **#1175** (`473e6ccd`) : 31 checks PASS, 3 SKIP, 0 FAIL, dont `Required`, `release-governance` et Hermes / SQLCipher Android.
