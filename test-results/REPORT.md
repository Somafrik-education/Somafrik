# Rapport de vérification Somafrik — 12 juillet 2026

Séquence exécutée depuis la racine du projet.  
**Non exécuté (sur demande) :** `cleanup:e2e`, `db:wipe-*`, `bootstrap:e2e-superadmin`.

---

## 1. Installations

| Étape | Résultat | Log |
|-------|----------|-----|
| `npm install` | OK | `00-root-install.log` |
| `npm --prefix backend install` | OK | `00-backend-install.log` |
| `npm --prefix web install` | OK | `00-web-install.log` |
| `npm --prefix Mobile install` | OK | `00-mobile-install.log` |

---

## 2. Vérifications statiques

| Commande | Exit | Détail |
|----------|------|--------|
| `npm run check` | **0** | Syntaxe backend + BackOffice + `tsc` Mobile OK |
| `npm run web:build` | **0** | Build web OK (correction TS `EntityPage.tsx` appliquée pendant la session) |

---

## 3. Tests backend

| Commande | Exit | Détail |
|----------|------|--------|
| `npm --prefix backend run test:unit` | **0** | 19/19 tests |
| `npm --prefix backend test` | **0** | 162/162 tests (29 suites) |
| `npm --prefix backend run test:auth` | **0** | OK |
| `npm --prefix backend run test:roles` | **0** | OK |
| `npm --prefix backend run test:integrity` | **0** | OK |

Logs : `03-backend-unit.log`, `03-backend-tests.log`, `03b-auth.log`, `03c-roles.log`, `03d-integrity.log`

---

## 4. Docker

| Commande | Exit | Détail |
|----------|------|--------|
| `npm run docker:up` | **0** | Stack reconstruite et démarrée |
| `docker compose ps` | — | postgres, backend, web-dev, mobile **Up/healthy** |

Services actifs :
- **backend** : `localhost:5000`
- **web-dev** : `localhost:5173`
- **postgres** : `localhost:5433`
- **mobile** : `localhost:8083`

Logs : `06-docker-up.log`, `06-docker-status.log`, `07-backend-logs.log`

---

## 5. Contrôles d'intégration

| Commande | Exit | Détail |
|----------|------|--------|
| `npm run check:api` | **1** | Login superadmin 401 — mot de passe incorrect |
| `npm run check:suspension` | **0** | 13/13 scénarios OK |
| `npm run verify:data-integrity` | **1** | Échec login superadmin (401) |
| `npm run audit:integrity` | **1** | 1 critique : référence paiement dupliquée `CD-2026-0001-2026-PAY-0001` |
| `npm run audit:sql-integrity` | **0** | OK |
| `npm run audit:ids` | **0** | OK |
| `npm run audit:contacts-orphans` | **0** | OK (aucun orphelin) |

**Cause racine API / E2E API :** le compte `superadmin` en base n'accepte plus les mots de passe de démo (`1234`, `change-me-now`). Les scripts recommandent :

```bash
npm run bootstrap:e2e-superadmin
npm run verify:e2e-preflight
```

---

## 6. Scénarios E2E

| Script | Exit | Log |
|--------|------|-----|
| verify:e2e-onboarding | 1 | e2e-01-onboarding.log |
| verify:e2e-0001 | 1 | e2e-02-0001.log |
| verify:e2e-0002 | 1 | e2e-03-0002.log |
| verify:e2e-0003 | 1 | e2e-04-0003.log |
| verify:e2e-0004 | 1 | e2e-05-0004.log |
| verify:e2e-0005 | 1 | e2e-06-0005.log |
| **verify:e2e-0006** | **0** | e2e-07-0006.log |
| verify:e2e-0008 | 1 | e2e-08-0008.log |
| verify:e2e-0009 | 1 | e2e-09-0009.log |
| **verify:e2e-0010** | **0** | e2e-10-0010.log |
| verify:e2e-0011 … 0027 | 1 | e2e-11 … e2e-26 |

**Bilan E2E : 2 réussites / 26 échecs**

- **0006** (affectation enseignant) et **0010** (écran mobile welcome) : scripts autonomes ou sans login API complet.
- **24 autres** : échec typique `login superadmin: 401 Identifiant ou mot de passe incorrect`.

Résumé CSV : `e2e-summary.csv`

---

## 7. Anomalie package.json (signalée, non corrigée)

Décalage entre numéros npm et noms de fichiers :

| Script npm | Fichier réellement exécuté |
|------------|----------------------------|
| `verify:e2e-0023` | `verify-e2e-0022-mobile-student-subscreens-journey.js` |
| `verify:e2e-0024` | `verify-e2e-0023-mobile-long-students-list.js` |

**Recommandation :** renommer les fichiers pour aligner 0023/0024, ou documenter explicitement ce mapping dans `package.json` (commentaire).

---

## 8. Correction appliquée pendant la session

- **`web/src/pages/EntityPage.tsx`** : cast `Contact[]` via `unknown` pour débloquer `web:build` (erreurs TS2352).

---

## 9. Actions recommandées

1. **Rétablir les identifiants E2E** (sans wipe) :
   ```bash
   npm run bootstrap:e2e-superadmin
   npm run verify:e2e-preflight
   ```
2. **Relancer** `check:api`, `verify:data-integrity` et la suite E2E API.
3. **Investiguer** le doublon paiement `CD-2026-0001-2026-PAY-0001` (audit:integrity).
4. **Relancer** `npm run web:build` après toute modification web.

---

## 10. Fichiers de log principaux

```
test-results/
  01-check.log
  02-web-build.log
  03-backend-tests.log
  04-api.log
  05-integrity.log
  06-docker-status.log
  07-backend-logs.log
  e2e-summary.csv
  e2e-*.log (26 scénarios)
  REPORT.md (ce fichier)
```
