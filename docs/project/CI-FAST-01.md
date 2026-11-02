# CI-FAST-01 — validation des PR plus rapide, sans retrait de protection

Statut : **PR Draft, HOLD** — aucune modification de Ruleset, de produit, de base de données, de Render ou de Cloudflare.

## 1. Audit (avant)

### 1.1 Durées observées (PR récentes)

| PR / SHA | Workflow le plus long | Durée | PR Gates | Remarque |
|---|---|---|---|---|
| #1035 `c20839b` | Backend test baseline (MONO-T0) | 43,5 min | 4,9 min | succès |
| #1035 `2d01856` | Backend test baseline (MONO-T0) | 33,6 min | 4,5 min | échec (corrigé ensuite) |
| #1040 `84fe3f9` | Backend test baseline (MONO-T0) | 43,4 min | 4,9 min | succès |
| #1042 `6698977` | Backend test baseline (MONO-T0) | 25,0 min | 13,9 min | annulé (nouvelle poussée) |
| #1042 `1796fb1` | Backend test baseline (MONO-T0) | 43,3 min (job PG 21:43:41 → 22:26:58) | 11,9 min | succès |

Les ≈ 40 autres workflows de PR durent chacun 0,3 à 7 min (Communications C4 : 4,5 à 7,1 min) et tournent en parallèle : **le délai de validation d'une PR backend est fixé par la baseline MONO-T0**.

### 1.2 Où passe le temps de la baseline PostgreSQL

Mesure job `125519105206` (PR #1040), 149 fichiers `*.pg.test.js` exécutés en série (`--test-concurrency=1`) :

| Poste | Durée |
|---|---|
| `monoT1.rbacMatrix.http.pg.test.js` (un seul test) | **1 463 s = 24,4 min** |
| 112 autres fichiers chronométrés | 7,8 min |
| 36 fichiers restants + démarrage, couverture | ≈ 2 min |

La matrice RBAC envoie ≈ 2 000 requêtes une par une. Profil local : **≈ 700 ms par requête refusée** (contre 1,6 ms pour `/api/health`) : `requireAuth` relit l'état back-office complet à chaque requête (`getAuthoritativeBackOfficeState`). C'est du code produit, **non modifié ici** ; mais les requêtes sont indépendantes, et 4 requêtes simultanées divisent le temps par requête par ≈ 3 (758 → 261 ms).

### 1.3 Constats

| # | Constat | Effet |
|---|---|---|
| A1 | La baseline MONO-T0 n'est **pas** dans `Required` (PR Gates) : un échec ne bloque pas l'agrégat. | protection plus faible qu'elle n'en a l'air |
| A2 | 85 des 149 fichiers PostgreSQL de la baseline sont aussi lancés par les scripts `verify:*` de PR Gates (Core / Risk-targeted). | doublons (non retirés ici, voir §6) |
| A3 | La baseline série de 43 min tourne sur chaque PR backend, puis encore la nuit. | délai |
| A4 | 37 workflows de PR n’ont pas de `concurrency` : une nouvelle poussée laisse tourner les anciennes exécutions. | file d’attente des runners |
| A5 | Ruleset `develop` (19008211) : aucun contrôle requis. Ruleset `main` (19007889) : contrôle requis `CI`, qu'aucun workflow de PR ne produit. Les Rulesets proposés (`docs/governance/rulesets/*.proposed.json`) exigent `Required` + `governance/merge-authorization`. | constaté, **non modifié** |
| A6 | `CI Full Nightly` teste toujours `develop` : rien ne valide le SHA exact candidat à une release. | pas de niveau C |
| A7 | Sur les 60 dernières fusions dans `develop`, 22 ne touchent ni le backend ni ce qui l'exécute ; le filtre de chemins de la baseline les excluait déjà. | le gain vient du temps d'une PR backend, pas du filtrage |

## 2. Les trois niveaux (après)

### A — PR FAST (bloquant, `PR Gates` → contrôle `Required`)

Inchangé : Scope, Quality, Secrets, Core tests (dont la *Security baseline*), Risk-targeted, LOT 0–8.

Ajouté :

| Job | Quand | Contenu |
|---|---|---|
| `Backend unit (fast)` | toute PR backend (`backend=true`) | gardes de l'exécuteur, tests des outils CI-FAST-01, inventaire MONO-T1 `--check`, **tous** les tests unitaires backend |
| `Backend PostgreSQL (shard K/3)` | `pg_mode` = `full` ou `targeted` | la sélection PostgreSQL découpée en 3 lots, **chaque lot sur son propre cluster PostgreSQL éphémère** |
| `Backend PostgreSQL shards complete` | idem | contrôle d'agrégation : chaque fichier sélectionné a été exécuté par exactement un lot |

`Required` devient strict : un job **planifié** par Scope doit finir en `success` ; `skipped` n'est accepté que pour un job que Scope n'a pas planifié ; `Scope` doit réussir et ses sorties être valides. Un vert ne peut donc reposer ni sur un test ignoré, ni sur un lot non déclenché.

### B — FULL CI (quotidien, échecs visibles)

* `Backend test baseline (MONO-T0)` : baseline **complète, série, avec couverture**, chaque nuit (02:45 UTC), après chaque fusion dans `develop` touchant le backend, et à la demande (`ref` libre). Elle ne tourne plus sur chaque PR (le niveau A l'a remplacée).
* `CI Full Nightly` : inchangée (01:30 UTC, `develop`).
* `FULL CI failure report` (`workflow_run`) : un échec de nuit ou post-fusion ouvre ou commente l'issue `ci:full-failure`. Workflow séparé, pour que les workflows testés gardent un jeton en lecture seule. (Un `workflow_run` ne s'active que depuis la branche par défaut.)

### C — RELEASE GATE (SHA candidat exact)

`release-gate.yml`, sur toute PR vers `main` et à la demande avec un SHA de 40 caractères :

1. le SHA testé est la **tête** de la PR (pas un commit de fusion recalculé) et doit contenir `origin/main` ;
2. baseline backend complète (appel de `backend-test-baseline.yml` avec `ref` = SHA) ;
3. régression complète (appel de `ci.yml` avec `ref` = SHA) ;
4. contrôle `Release gate` : vert seulement si tout est `success` (aucun `skipped` accepté).

## 3. Déclenchement intelligent (`scripts/ci-pg-select.js`)

Chemins vérifiés dans le dépôt. **En cas de doute : tout.**

| Fichiers modifiés | `backend` | `pg_mode` |
|---|---|---|
| Rien sous `backend/`, `packages/`, `package*.json` racine, exécuteur (`scripts/backend-test-baseline*`, `scripts/fixtures/backend-test-baseline/`, `scripts/ci-*`), inventaire / matrice MONO-T1, `pr-gates.yml`, `backend-test-baseline.yml`, `release-gate.yml` | false | `none` |
| Uniquement des `backend/**/*.test.js` et/ou `backend/**/*.md` | true | `targeted` : tests PostgreSQL modifiés **+ socle sécurité** |
| Tout autre fichier backend (code, migrations, fixtures JSON, dépendances, exécuteur, workflows ci-dessus) | true | `full` |

Le socle sécurité est défini **par motif** (tout nouveau test qui suit la convention est inclus d'office) : `sec*`, `*Tenant*`, `*Isolation*`, `*Rbac*` / `*rbac*` (dont la matrice MONO-T1), `*Scope*`, `monoT1.authSessions`, `monoT1.anomaly.*`, `bulletinSec01`, `platformPersonalData*` — 31 fichiers aujourd’hui. Le mode ciblé n'existe que si aucun code exécuté par les autres tests n'a changé ; les tests unitaires restent tous exécutés.

## 4. Optimisations

| Optimisation | Détail |
|---|---|
| Matrice RBAC parallèle | `MONO_T1_RBAC_MATRIX_PARALLELISM` (défaut 4, 1 = série). Mêmes cellules, même ordre du document, même comparaison à la référence ; contrôle ajouté : aucune cellule non sondée. Jetons renouvelés entre lots de 64 requêtes. **Local : 1 168 s → 366 s**, référence identique. Mutation (une cellule de la référence inversée) : le test échoue. |
| Lots PostgreSQL | `--select=<fichier>` et `--shard=K/N` dans `scripts/backend-test-baseline.js` ; découpage déterministe par poids mesurés (`scripts/backend-test-baseline.weights.json`, recalcul : `scripts/ci-baseline-weights.js`) ; `plan.json` par lot ; `scripts/ci-baseline-shards-verify.js` vérifie l'union. Isolation : un cluster par lot, exécution série dans chaque lot comme avant. |
| Installation | jobs backend : `npm ci` racine + `backend` seulement (pas web / Mobile), cache npm `setup-node`. |
| Concurrence | `concurrency` ajouté à 36 des 37 workflows de PR qui n’en avaient pas : une nouvelle poussée annule l’exécution précédente de la même PR ; push, nuit et appels ne sont jamais annulés. Exception : `release-governance.yml`, dont le contenu est figé par empreinte SHA-256 (`verify-release-governance-core.js`) — inchangé. |
| Délais | **aucun `timeout-minutes` augmenté** (jobs de lot : 30 min, contre 60 pour l'ancien job série). |

### Mesures (après) — CI de cette PR, en mode `full` (149 fichiers PostgreSQL)

Run PR Gates `41539996950`, SHA `4fea742` :

| Job | Durée | Résultat |
|---|---|---|
| Scope (dont sélection) | 0,4 min | success — `pg_mode=full` |
| Backend unit (fast) | 1,1 min | success |
| Backend PostgreSQL (shard 1/3) — matrice RBAC seule | 10,5 min (tests : 9,7 min) | success |
| Backend PostgreSQL (shard 2/3) | 6,5 min | success |
| Backend PostgreSQL (shard 3/3) | 6,4 min | success |
| Backend PostgreSQL shards complete | 0,2 min | success |
| Risk-targeted (inchangé) | ≈ 12 min | success |
| **Required** | vert **15,0 min** après la poussée (dont ≈ 2,3 min d'attente de runners) | success |

| Scénario | Avant | Après |
|---|---|---|
| PR backend (code, migrations, dépendances) | baseline série **43,3–43,5 min**, non bloquante | baseline complète en lots **≈ 10,5 min**, bloquante ; PR Gates vert en 15 min (chemin critique : Risk-targeted) |
| PR de tests backend seuls | 43 min | tests modifiés + socle sécurité (31 fichiers, dont la matrice) : ≈ 10,5 min |
| PR web / mobile / docs / workers | pas de baseline (filtre de chemins) | pas de baseline ; `Required` vérifie qu'aucun job backend n'était planifié |
| Matrice RBAC seule (CI) | 1 463 s | 580 s (× 2,5) |
| Nuit / post-fusion (niveau B, série + couverture) | ≈ 43 min | ≈ 28 min attendus (matrice parallèle) |


## 5. Protection GitHub (non modifiée)

Constat (§1.3 A5) : rien n'est modifié. Les contrôles proposés restent compatibles avec les filtres :

* `Required` est **toujours produit** sur chaque PR (pas de filtre de chemins sur PR Gates), et ne passe que si chaque job planifié a réussi : c'est le contrôle stable et bloquant à exiger.
* Décision CTO proposée (non appliquée) : Ruleset `develop` → exiger `Required` + `governance/merge-authorization` (déjà dans `develop.proposed.json`) ; Ruleset `main` → remplacer `CI` (jamais produit) par `Required` + `Release gate` + `governance/merge-authorization`.
* Ne jamais exiger un contrôle de workflow filtré par chemins (ex. `Backend PostgreSQL (shard 1/3)`) : absent, il bloquerait la PR ; c'est `Required` qui l'agrège.

## 6. Hors périmètre (recommandé ensuite)

* Doublons PR Gates / baseline (A2) : maintenant que la baseline bloque, les `verify:*` PostgreSQL dupliqués de Risk-targeted pourraient être retirés quand `pg_mode=full` — à décider fichier par fichier, non fait ici.
* Coût par requête de `requireAuth` (§1.2) : chantier produit distinct.
