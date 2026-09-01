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

Le freeze #444 (`5173537d`) a échoué **volontairement** dès que #445 a atterri. Avancement **audité**, pas un drift inconnu :

| SHA | PR | Nature |
|---|---|---|
| `b9a26cb6` | #445 | audit Lot G (ce gate) |
| `78228be0` | #446 | favicon Web uniquement |

#447 (icône mobile) est **1 ahead / 0 behind** ce tip, Draft, PR Gates verts — **non mergée**, **non rejouée ici**.

### Contrat anti-boucle + garde pré-merge (gouvernance-only)

`BASELINE` = dernier tip `develop` métier/release explicitement validé (`78228be0`).

Deux contrôles **indépendants** :

**A. Drift déjà sur `develop`** — `git diff --name-only BASELINE..origin/develop`

1. `origin/develop === BASELINE` → **PASS**
2. sinon diff ⊆ fichiers de gouvernance uniquement → **PASS**
3. tout autre fichier (ex. `Mobile/app.json`) → **FAIL**

**B. Diff de la PR courante** — `pull_request.base.sha...pull_request.head.sha` (hors CI : `origin/develop...HEAD`)

- ⊆ fichiers de gouvernance → **PASS**
- sinon → **FAIL avant merge**

Fichiers de gouvernance autorisés :

- `scripts/verify-release-governance.js`
- `docs/audits/release-governance-goprod-2026-09-01.md`
- `docs/audits/release-checklist-goprod-2026-09-01.md`
- `docs/audits/release-approved-candidates-2026-09-01.json`

Conséquences :

- merge **#448** : drift `develop` = gouvernance-only → A vert ; B de #448 vert
- CI pré-merge **#447** avant merge de **#451** : B voit `Mobile/*` sans autorisation → **rouge avant merge**
- CI pré-merge **#447** après merge de **#451** : B peut PASS seulement si l’autorisation versionnée correspond encore (voir §11)
- le HOLD n’attend plus un `workflow_dispatch` post-merge

## 11. Autorisation contrôlée d’un candidat métier (fail-closed)

Le contrôle B reste **fail-closed**. Il n’existe **aucun** bypass env (`SKIP_RELEASE_GOVERNANCE` ignoré), aucun wildcard `Mobile/*` / `scripts/*` / `docs/*`, aucune autorisation par numéro de PR seul ni par nom de branche.

Deux modes, exclusifs :

1. **PR gouvernance-only** — tous les fichiers ∈ allowlist ci-dessus → **PASS** automatique.
2. **Candidat métier** — au moins un fichier hors allowlist → **PASS uniquement** après décision **CTO_GO** versionnée dans `docs/audits/release-approved-candidates-2026-09-01.json`, et seulement si **toutes** les conditions suivantes tiennent :
   - le numéro de PR est explicitement listé ;
   - le diff réel (`git diff --name-only pull_request.base.sha...pull_request.head.sha`) est en **égalité stricte d’ensemble** avec `files[]` (aucun fichier en plus, aucun fichier manquant) ;
   - **et** l’une des deux identités suivantes :
     - `headSha` du manifeste === `pull_request.head.sha` **et** `diffSha256` identique (snapshot audité) ;
     - **rebase-equivalent** : `headSha` a changé (rebase après merge gouvernance) **mais** `diffSha256` est strictement identique.

Toute divergence (HEAD différent **et** identité de contenu différente, fichier extra/manquant, PR absente du manifeste, `decision ≠ CTO_GO`) → **FAIL CLOSED**. Un nouveau HEAD n’est jamais autorisé implicitement.

### Empreinte `diffSha256` (anti-boucle rebase)

Ce n’est **pas** un hash de `git diff` ni du merge commit GitHub. Pour chaque chemin trié du diff réel :

`path<TAB>sha256(blob au merge-base)<TAB>sha256(blob au HEAD)`

puis SHA-256 UTF-8 des lignes jointes par `\n` (pas de newline final). Fichier absent d’un côté = `ABSENT`.

Conséquence après merge futur de **#451** (cette PR de gouvernance ; #449 est un autre chantier email, déjà occupé) :

1. Rebase #447 sur le nouveau `develop` (gouvernance-only : script + audits + manifeste).
2. Le HEAD de #447 change probablement.
3. Les 8 fichiers métier de #447 **ne sont pas** touchés par #451 → les blobs avant/après restent identiques → **même `diffSha256`** → le GO reste valide **sans réémettre `headSha`**.
4. Si un rebase (ou un commit supplémentaire) change le contenu d’un fichier autorisé, ou si `develop` a avancé sur l’un de ces 8 chemins, `diffSha256` change → **GO annulé automatiquement**. Il faut alors **réémettre** l’entrée (nouveau `headSha` + nouveau `diffSha256` + même revue CTO).

`baseSha` dans le manifeste est documentaire (tip `develop` au moment de l’audit). Il n’est **pas** exigé égal au `pull_request.base.sha` futur — l’exiger recréerait la boucle. L’identité de contenu porte la contrainte.

### Candidat initial — PR #447

| Champ | Valeur |
|---|---|
| PR | `#447` |
| `headSha` audité | `6b4370e4879d399f668463ef3e8cf3fe385e31ab` |
| `baseSha` documentaire | `develop@1f5fc0d6594b45434a216ae461df99fd97bec86c` |
| `diffSha256` | `5e704e7bd40233d1f70c6707f23d805e07c4bc8d8ae76902ab2ce7da7f1422e8` |
| `decision` | `CTO_GO` |

Périmètre exact (8 fichiers, **aucun** wildcard) :

```text
Mobile/app.json
Mobile/assets/somafrik-android-adaptive-foreground.png
Mobile/assets/somafrik-app-icon.png
Mobile/package.json
Mobile/scripts/generate-launcher-icons.py
Mobile/scripts/verify-mobile-branding.js
Mobile/scripts/verify-mobile-release-readiness.js
scripts/verify-android-release-readiness.js
```

Cette PR de gouvernance **ne modifie pas** #447. Ready / merge de #447, merge `develop → main`, EAS submit / Play restent interdits ici.

### Workflow `paths:` (bootstrap one-shot #451)

Le YAML `.github/workflows/release-governance.yml` **reste hors allowlist** du contrôle B (test `RG-NEG-workflow-not-governance-only`). Une modification **arbitraire** du workflow continue de **FAIL CLOSED** (`RG-NEG-workflow-arbitrary-change-forbidden`).

Cette PR **#451** porte une **migration bootstrap one-shot** : ajout **exact** de `docs/audits/release-approved-candidates-2026-09-01.json` aux `paths:` du workflow, pin SHA-256 du fichier YAML :

`ee5886ae55848257da713f6f71740e7c78aa4ff14613129cfb44b141e1f9e321`

Conditions de l’exception (pas une allowlist permanente) :

- en CI : `pull_request.number === 451` **et** SHA-256 du YAML au HEAD identique au pin ;
- après merge / en local : le pin de contenu suffit pour le drift `BASELINE..origin/develop` (sinon le merge de #451 casserait le contrôle A) ;
- tout autre numéro de PR, ou tout autre contenu YAML → **FAIL**.

Une PR qui ne modifie **que** le manifeste CTO_GO déclenche désormais le gate. Toute réémission d’autorisation n’a plus besoin de toucher le script « pour faire passer le trigger ».

## Gate

`npm run verify:release-governance`

Échoue si `origin/develop` avance **hors** fichiers de gouvernance, si le diff de la **PR courante** n’est ni gouvernance-only ni un candidat `CTO_GO` exact (PR + HEAD/identité + ensemble de fichiers), si `origin/main` bouge, ou si une PR frozen est ancêtre de HEAD / citée en sujet merge ou squash `(#n)`. Ne merge pas `main`. Ne déploie pas.

P1 Codex #445 : exclusion frozen squash/cherry-pick. P2 : `Mobile/app.json` + `Mobile/package.json` dans `paths`. P3 : exception gouvernance-only sur le drift `develop`. P4 : le même allowlist s’applique au candidat PR (`base...head`) pour HOLD pré-merge. P5 : candidat métier explicitement autorisé (PR + HEAD + fichiers + `diffSha256` rebase-equivalent). P6 : manifeste CTO_GO dans les `paths:` du workflow via bootstrap one-shot #451 (YAML hors allowlist ; contenu piné).
