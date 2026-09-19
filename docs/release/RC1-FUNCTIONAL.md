# RC1 — Rapport fonctionnel — 2026-09-19

**Commande :** `npm run verify:rc1-gates`  
**Evidence :** [evidence/rc1-functional-results.json](./evidence/rc1-functional-results.json)

## Catalogue exécuté (sans Docker / sans `DATABASE_URL`)

Gates listées dans `scripts/rc1/run-rc1-gates.js` :

- sécurité statique / contrat : disclosure, JWT header, db-config, mobile-security, android-release, secrets, sanitize, auth-sessions, personal-data-deny, audit:ci
- métier contrat : RBAC S1.4 / ADMIN-01, notes-sync, parité LOT 0–8, help-v1a, branding

## Hors catalogue (volontaire)

Toute gate `*.pg.test.js` / E2E API / Playwright / web-smoke hébergé.  
Elles restent **à rejouer** sur un environnement isolé avec PostgreSQL.

## Vérifications fonctionnelles #719

| Item | Résultat |
|------|----------|
| Suites unitaires existantes (sous-ensemble) | via catalogue |
| Intégration backend PG | **SKIP** |
| Contrats API live | **SKIP** sauf JWT header mémoire si le gate démarre un backend éphémère |
| Composants Web / Mobile (parité LOT 0–8) | via catalogue |
| Typecheck / lint / build | **SKIP** dans ce runner (durée) ; CI PR Gates à lire sur la PR G1 |
| Empty / loading / offline / error states | **SKIP** UI |
| Permissions live après changement de rôle | **SKIP** runtime |
| Écran mort / route legacy | **STATIC** — LOT 8 fermé sur `develop` ; pas de recette UI |

## Résultat runner (cette VM)

**20 PASS / 4 FAIL / 24** — rejoué sur `develop@e457934f` (`node v22.14.0`, pas de Docker, pas de `DATABASE_URL`). Les 4 FAIL restent classés P2/P3/SKIP (pas des P0).

| ID | Exit | Classification RC1 |
|----|------|--------------------|
| JWT-HEADER | FAIL | **P2** — HTTP JWT query fail-closed OK ; `report.pdf` Bearer → 500 sur backend mémoire (Puppeteer/PDF). Pas un contournement auth. |
| RBAC-ADMIN-01 | FAIL | **P2** — gate historique encore attend `teachers` writable sur PUT ; LOT 3 a retiré cette clé (PG). Script **stale**, pas une régression métier PUT. |
| NOTES-SYNC | FAIL | **P3 / SKIP env** — 3/4 gardes boot OK ; 4e sous-test appelle `initializeRepository` → `STUDENT_CANONICAL_POSTGRES_ALLOCATOR_NOT_READY` sans PG. |
| SECRETS | FAIL | **P3 / SKIP env** — `gitleaks` absent du PATH. |

LOT 0–8, RBAC S1.4, mobile-security, android-release (config), personal-data-deny, auth-sessions, sanitize, branding, help-v1a, db-config, disclosure, audit:ci = **PASS**.
