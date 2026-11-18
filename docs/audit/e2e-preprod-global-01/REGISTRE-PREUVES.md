# E2E-PREPROD-GLOBAL-01 — Registre des preuves

**Natures de preuve :**
- **[E2E préprod]** : exécuté contre la préproduction ;
- **[Auto]** : tests automatisés, locaux ou CI ;
- **[Code]** : analyse statique.

Seules les preuves [E2E préprod] peuvent fonder un PASS E2E.

## 1. [E2E préprod], 2026-11-17

| Réf. | Contenu | SHA visé | Fichier / lien |
|---|---|---|---|
| E2E-000 | `GET /api/health` → 200, `status=ok`, `database=postgresql`, `gitSha=93f98e44746607ba53c6997d76bbf1e126601e85` | API `93f98e44` | `preuves/E2E-000-api-health.json` |
| E2E-000 | Web `GET /` → 200 ; le chunk `UsersPage-C2E58jRW.js` contient le libellé de #1183 | Web ⊇ `93f98e44` | `RESULTATS-WEB.md` |
| E2E-009 | 138 routes GET protégées sans jeton → 401 | API `93f98e44` | `preuves/E2E-009-unauth-sweep.tsv` |
| E2E-009 | 196 routes d'écriture protégées sans jeton → 401 | API `93f98e44` | `preuves/E2E-009-unauth-write-sweep.tsv` |
| E2E-009 | `/api/debug/notes-authz-trace` → 404 (route absente) | API `93f98e44` | idem |

## 2. [Auto] Non-régression locale

Exécutée sur l'arbre `develop@763d9bd8`, sauf mention contraire. #1183 (`93f98e44`) ne touche que `web/src/pages/UsersPage.tsx` et son test.

Le détail se trouve dans `RESULTATS-API-POSTGRESQL.md` §2. Les journaux bruts sont conservés hors dépôt (scratchpad de session) ; seuls les résumés sont versionnés.

## 3. [Auto] CI native Android (hors E2E fonctionnel)

| Run | SHA | Résultat | Rétention |
|---|---|---|---|
| [44062901882](https://github.com/Somafrik-education/Somafrik/actions/runs/44062901882) | #1175 `473e6ccd` | Hermes S13 27/27, SQLCipher, PR3, PR4 PASSED | Artifact 30 j (jusqu'au 2026-12-17) |
| [44059656372](https://github.com/Somafrik-education/Somafrik/actions/runs/44059656372) | #1182 `8593d479` | Idem | 30 j |

## 4. [Code]

| Document | Contenu |
|---|---|
| `INVENTAIRE-FONCTIONNALITES.md` | 497 entrées sur `develop@93f98e44` |
| `SECURITE-RBAC-TENANT.md` §1–4 | Surface non authentifiée, routes sans entrée RBAC, isolation multi-tenant |

## 5. Rétention

- Les artefacts GitHub Actions expirent après la durée indiquée : ce ne sont **pas** des preuves permanentes.
- Les fichiers `preuves/*` versionnés dans cette PR sont permanents. Ils ne contiennent ni jeton, ni secret, ni donnée personnelle : uniquement des chemins de routes, des codes HTTP et des messages d'erreur génériques.
