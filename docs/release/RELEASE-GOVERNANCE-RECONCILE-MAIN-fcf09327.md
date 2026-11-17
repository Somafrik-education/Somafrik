# Réconciliation Release Governance — `main@fcf09327`

**Mandat :** CTO « Clôture technique AUDIT-SETUP-GUIDED-10-01 », priorité 2.

**Constat.** `verify:release-governance` échoue en fail-closed : `origin/main a bougé (fcf09327…)`. Le pin vivant `CURRENT_MAIN` vaut encore `ef8bc951`, l'état d'avant la promotion v25.

**Changement.** Dans `scripts/verify-release-governance.js` uniquement :
- `CURRENT_MAIN` passe de `ef8bc951` à `fcf09327` ;
- `CURRENT_MAIN_ONLY` passe de 11 à 30 commits, recalculés par `git rev-list --reverse origin/develop..origin/main` ;
- le libellé du journal est mis à jour.

**Inchangé :**
- le core historique `scripts/verify-release-governance-core.js` : blob `3d7b2381b5412bbc7395b61592ed2199a2ca3035`, toujours vérifié en fail-closed ;
- tous les remplacements exacts (`replaceExactlyOnce`) ;
- tous les tests négatifs (`RG-NEG-*`) ;
- le workflow.

## 1. État Git vérifié

| Référence | SHA | Tree |
|---|---|---|
| `origin/main` | `fcf09327d2716967ffcd10a69347f06c2fbffb7a` | `1ddccac2baa7be1470dbee15b3f52e40c0a52c53` |
| `origin/develop` | `4560495b457980b438f50b2be5674bda7826a1e1` | `1ddccac2baa7be1470dbee15b3f52e40c0a52c53` (**identique**) |
| `develop..main` | 30 commits | — |
| `main..develop` | 0 commit | — |

## 2. Les 11 commits main-only déjà autorisés (inchangés)

`372b7aac`, `295c044e`, `cb1b79c7`, `f1102d47`, `a8af4bd2`, `aaf6e5ce`, `60feff04`, `376f17a4`, `8d981efe`, `24e1eb8e`, `ef8bc951`.

Il s'agit des promotions AAB v24 (#799, #801, #802, #803) et des promotions #823, #825 et #827.

## 3. Les 19 nouveaux commits main-only, vérifiés un par un

**Règle de vérification.** Chaque parent est classé comme commit de `develop` (ancêtre de `origin/develop`) ou comme main-only déjà listé. Pour un parent de `develop`, on mesure le nombre de fichiers qui diffèrent entre le commit et ce parent (`git diff --name-only`). Aucun parent « autre » n'est accepté.

| # | Commit | Parent `develop` (fichiers différents) | Parent main-only | Objet |
|---|---|---|---|---|
| 1 | `d7b35fe1` | `6f0afae7` (0) | `ef8bc951` | chore(release): reconcile main history into Somafrik Android v25 candidate |
| 2 | `bedefe4d` | `834c6545` (0) | `d7b35fe1` | chore(release): refresh v25 candidate after School Code V2 gate fix |
| 3 | `63286380` | `4f60f2c3` (0) | `bedefe4d` | chore(release): reconcile v25 after blocking School Code V2 CI fix |
| 4 | `e00a2bb4` | `48b1e728` (0) | `63286380` | chore(release): reconcile v25 candidate after mobile refresh contract fix |
| 5 | `963f769b` | `9d164c06` (0) | `e00a2bb4` | chore(release): reconcile v25 after named mobile CI gates |
| 6 | `bd9978dc` | `ac123502` (0) | `963f769b` | chore(release): reconcile v25 after FormField Mobile fixes |
| 7 | `4e7d12a3` | `c875e379` (0) | `bd9978dc` | chore(release): reconcile v25 after Security FormField gate fix |
| 8 | `700d9658` | `e336e0fb` (0) | `4e7d12a3` | chore(release): reconcile v25 after catalog type-only verifier fix |
| 9 | `4edb4f42` | `eaad54eb` (0) | `700d9658` | chore(release): reconcile v25 after CI stabilization #1156 #1157 |
| 10 | `51d3fa54` | `f268fb12` (0) | `4edb4f42` | chore(release): reconcile v25 after Gradle Java and PG test fixture fixes |
| 11 | `0a7969e0` | `f3c8499e` (0) | `51d3fa54` | chore(release): reconcile v25 after Docker Puppeteer postinstall fix |
| 12 | `8124d331` | `b925ba9a` (0) | `0a7969e0` | chore(release): reconcile v25 after APPEL-NAV-01 NFC/QR fix (#1161) |
| 13 | `738e2873` | `c2d5938d` (0) | `8124d331` | chore(release): reconcile v25 after GO-PROD-G5-01 docs (#1165) |
| 14 | `27e53778` | `8faa002b` (0) | `738e2873` | chore(release): reconcile v25 after NFC release gate (#1168, #1166) |
| 15 | `351a2137` | `99cb7915` (0) | `27e53778` | chore(release): sync v25 candidate with develop after G6 docs and AUTH-MOBILE-01 |
| 16 | `773dccc0` | `7e80cced` (0) | `351a2137` | chore(release): reconcile v25 after pagination cursor precision fix (#1170) |
| 17 | `c8263b9b` | — | `ef8bc951` + `773dccc0` | release: promote qualified Somafrik v25 candidate to main (#1145) |
| 18 | `0759547b` | `4560495b` (0) | `c8263b9b` | chore(release): integrate post-smoke fix #1171 into v25 release candidate |
| 19 | `fcf09327` | — | `c8263b9b` + `0759547b` | merge(release): v25 post-smoke corrections (#1173) |

Les deux merges sans parent `develop` sont des merges GitHub du propriétaire. Leur tree est contrôlé :
- `c8263b9b` (#1145) a le tree de `773dccc0` (`2e258056`) ;
- `fcf09327` (#1173) a le tree de `0759547b` (`1ddccac2`), qui est le tree de `develop@4560495b`.

**Conclusion.** Aucun des 19 commits n'introduit de contenu absent de `develop` : chaque parent `develop` a 0 fichier de différence, et chaque merge GitHub a le tree d'un commit déjà vérifié. Le contenu de `main` est exactement celui de `develop@4560495b`.

## 4. Preuves d'exécution

Les trois exécutions ont lieu avec les refs du workflow (`main`, `develop`, PR gelées 295 à 355).

| Exécution | Résultat |
|---|---|
| `develop@4560495b`, sans le changement | **Échec (fail-closed)** : `origin/main a bougé (fcf09327…)`. Le contrôle refuse bien un `main` non reclassé. |
| Avec le changement | **exit 0**, 34 `PASS`, dont `RG-MAIN-ONLY live pin fcf09327 ; 30 commits`, `RG-POS-main-pinned-main-only` et les négatifs `RG-NEG-unexpected-main-only-commit`, `RG-NEG-main-sha-differs-from-live-pin`, `RG-NEG-core-blob-unauthorized-change` |
| Core historique | blob `3d7b2381…` vérifié, identique |

Le gate reste fail-closed :
- tout nouveau commit sur `main`, ou tout `main` différent de `fcf09327`, le refait échouer ;
- aucune promotion `develop` → `main` n'est autorisée par ce changement.
