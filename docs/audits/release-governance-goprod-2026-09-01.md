# Release governance GO-PROD — 2026-09-01

Lot unique **G**. Evidence/governance-only. **Aucun merge `main`. Aucun deploy. Aucun EAS/Play.**

Revalidation du baseline après avancement **légitime** de `develop` (#445 gate Lot G, #446 favicon Web). **#447 (icône launcher) n’est pas dans ce lot** : correctif technique OK, HOLD merge tant que cette revalidation n’est pas tranchée.

| | |
|---|---|
| Candidat release (baseline) | `develop@78228be06286b464afd9e691fb227d16be95a63a` (merge #446) |
| Baseline précédent | `5173537d29d31d16039883552f5e2cb506060581` (merge #444) |
| `main` observé | `b5074565b08472217702d8ff848f5a398d08831c` |
| Merge-base | `c2e33cf1c865abd0e9e4f91726d7547b25f039a6` |
| Ahead / behind (`develop`…`main`) | **1271 develop-only / 2 main-only** |
| Décision | **HOLD** — pas `RELEASE_ENGINEERING_READY` |

## Gouvernance avant ouverture

- 1 PR Cursor Go Production à la fois.
- #444 MERGED (`5173537d…`). #445 MERGED (`b9a26cb6…`, audit Lot G). #446 MERGED (`78228be0…`, favicon Web).
- #447 Draft icône launcher : **hors de cette PR** ; ne pas y mélanger le baseline.
- Historiques ouvertes, **non reprises**, **absentes de `develop` et `main`** : #295, #297, #298, #312, #337, #354, #355.
- **Aucune PR `develop → main` ouverte** (serait lisible comme autorisation de merge).

## 1. `develop` vs `main` (git réel)

| Champ | Valeur |
|---|---|
| Default branch | `main` |
| Tree `main` | `5a9c8e47…` = tree de `develop@878e4ab8` (`docs(project): … (#83)`, 2026-07-27) |
| Tree merge-base / `6ff61106` | identiques (`be4eceb0…`) |
| Diffstat `main…develop` | 1687 files, +331406 / −23306 |
| Top catégories | backend 591 · web 356 · Mobile 350 · docs 211 · scripts 49 · `.github` 32 |

`878e4ab8` **est ancêtre** de `develop@78228be0` (et de l’ancien tip `5173537d`). Le tip `main` est un **snapshot develop du 27 juillet**, pas un HEAD release actuel.

## 2. Commits `main`-only (ne pas écraser en silence)

| SHA | Date | Classement | Preuve |
|---|---|---|---|
| `6ff61106` | 2026-07-24 | **stale / graphe dupliqué** | Merge #76 `cursor/c1-8a-enrollment-actions-04b3`. Même branche déjà mergée sur develop comme **#74** (`00f5b9d0`). Tree = merge-base. **Pas un hotfix unique.** |
| `b5074565` | 2026-07-27 | **stale snapshot** | PR **#109** « Develop » : squash/merge d’un develop historique. Tree = `878e4ab8` déjà dans develop. Contenu **attendu déjà présent** plus loin sur develop. **Pas un hotfix à préserver comme delta unique.** |

Aucun commit `main`-only n’apporte un correctif absent de develop. Un `git merge origin/develop` dans `main` **n’est pas fast-forward** : `git merge-tree` → **29 CONFLICT** (ex. `package.json`, `DataContext.tsx`, `userTeacherSync*`, `docs/project/*`).

Stratégie **future** (USER GO uniquement, **non exécutée**) : PR `develop → main` + résolution explicite **préférant develop** (main = snapshot périmé), ou merge orchestré par le CTO. Interdit : reset force de `main`, merge silencieux, inclusion des PR frozen.

## 3. Protections / rulesets (observable)

API `branches/*/protection` : **403** (token intégration, non admin). Rulesets listables :

| Ruleset | Cible | Enforcement | Règles (texte) |
|---|---|---|---|
| `develop` id `19008211` | `refs/heads/develop` | **disabled** | PR required (0 approving reviews), `required_review_thread_resolution=false`, required check **`CI`**, `strict_required_status_checks_policy=true`, `non_fast_forward`, `deletion` |
| `main` id `19007889` | `refs/heads/main` | **disabled** | PR required (0 approving reviews), `required_review_thread_resolution=true`, required check **`CI`**, same FF/deletion |

`current_user_can_bypass`: `never` — **sans effet** tant que `enforcement=disabled`.

Le check GitHub nommé **`CI`** est **stale** : le workflow actuel s’appelle **CI Full Nightly** (cron/`workflow_dispatch`, `ref: develop`) et n’est pas un required PR check. Les checks convention CTO (PR Gates, tenant, smokes) **ne sont pas required par GitHub** sur ces rulesets disabled.

## 4. Checks sur le HEAD release (`develop@78228be0`)

**Required GitHub (enforced) :** aucun (rulesets disabled ; protection 403).

**Convention CTO (observés verts sur #444 HEAD `d68af291`) :** PR Gates (Required), Android release readiness, Web smoke, GP-002/003/014/015/020, tenant revalidation, D revalidation, Enrollment, Mobile Push N1, etc.

Workflows **seulement sur develop** (absents de `main`) : 30 fichiers dont `pr-gates.yml`, `web-smoke.yml`, `android-release-readiness.yml`, gates tenant. `main` n’a que `ci.yml` + `security.yml` historiques.

`pr-gates.yml` et `ui-french-copy.yml` écoutent aussi `main` **si** une PR cible `main`. Les autres gates Lot A–F n’écoutent que `develop` — un merge `develop → main` **ne rejouerait pas** Web smoke / Android readiness / tenant gates sauf dispatch manuel.

## 5. PR historiques hors release

Aucune des PR #295 / #297 / #298 / #312 / #337 / #354 / #355 n’a de merge commit sur `origin/develop` ni `origin/main`. Elles **n’entrent pas** dans un `develop → main` tant qu’elles restent ouvertes/non mergées. RC3 #354/#355 = **OUT_OF_RELEASE**.

## 6. Versions / metadata (constat, pas de cleanup)

| Surface | Valeur | Note |
|---|---|---|
| Mobile `app.json` | `1.2.1` / versionCode **13** | Play / Expo |
| `Mobile/package.json` | `1.2.0` | npm ≠ app.json — observation Lot F |
| `web/package.json` | `1.0.0` | non aligné Mobile |
| `backend/package.json` | `1.0.0` | idem |
| root `package.json` | pas de `version` | workspace |

## 7. Blockers connus non levés

| ID | Statut | Source |
|---|---|---|
| Web hébergé SHA | **MANUAL BLOCKER** `ENVIRONMENT_COMMIT_UNVERIFIED` | Lot E #443 |
| `api.somafrik.app` DNS | **MANUAL BLOCKER** | Lots E + F |
| Android APK/AAB exact-SHA | **MANUAL BLOCKER** | Lot F #444 |
| Install / login / nav / kill-relaunch device | **MANUAL BLOCKER** | Lot F |
| Privacy policy URL | **P0 Store** absente | LOT 7 |
| Account deletion | **P0 Store** absente | LOT 7 |
| RC3 SQLCipher / appel physique | **OUT_OF_RELEASE** | #354/#355 |
| Merge `develop → main` | **HOLD graphe** | 29 conflits `merge-tree` |

## 8. Forme de PR `develop → main` (non ouverte)

Titre possible plus tard : `release: develop@78228be0 → main` (ou le SHA develop du jour).  
Base `main`, head `develop`. Draft + USER GO + stratégie de conflits **documentée**. **Cette PR n’existe pas.** L’ouvrir maintenant serait interprété comme autorisation de merge.

## 9. Décision

**HOLD** — causes exactes :

1. Blockers runtime/hosting/device/DNS/Store ci-dessus encore ouverts.
2. `main` n’est pas fast-forwardable ; 2 commits main-only stale + 29 conflits.
3. Rulesets `main`/`develop` **disabled** ; check required `CI` stale ; 0 required GitHub enforced.
4. Candidat `78228be0` sain **comme tip develop**, pas comme tip `main`. `5173537d` reste un ancêtre (#444).

Le lot G peut merger comme **audit** sans lever le HOLD release.

## 10. Revalidation baseline (2026-09-01, après #445 / #446)

Le gate `assert.equal(originDevelop, baseline)` a échoué **volontairement** dès que #445 a atterri : le freeze #444 (`5173537d`) n’était plus le tip. Avancement **audité**, pas un drift inconnu :

| SHA | PR | Nature |
|---|---|---|
| `b9a26cb6` | #445 | audit Lot G (ce gate) |
| `78228be0` | #446 | favicon Web uniquement |

#447 (icône mobile) est **1 ahead / 0 behind** ce tip, Draft, PR Gates verts — **non mergée**, **non rejouée ici**.

Contrat inchangé : `origin/develop` **doit** égaler le baseline. Après merge de **cette** PR d’audit, le tip `develop` bougera à nouveau ; le HOLD se réactivera jusqu’à une revalidation du SHA de merge. C’est le mécanisme, pas un contournement de #447.

## Gate

`npm run verify:release-governance`

Échoue si `origin/develop` **≠** `78228be0…` (tip avancé → STOP rebase), si `origin/main` bouge, ou si une PR frozen est ancêtre de HEAD / citée en sujet merge ou squash `(#n)`. Ne merge pas `main`. Ne déploie pas.

P1 Codex #445 : le tip `develop` est comparé **directement** au baseline (plus un `hasAncestor` qui restait vert) ; l’exclusion frozen couvre squash/cherry-pick, pas seulement `Merge pull request #n`. P2 : `Mobile/app.json` + `Mobile/package.json` dans `paths` — d’où le rouge de #447 tant que le baseline n’est pas revalidé.
