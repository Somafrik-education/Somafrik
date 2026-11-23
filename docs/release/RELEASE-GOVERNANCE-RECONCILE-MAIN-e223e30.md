# Réconciliation Release Governance — `main@e223e30e` (GOV-RELEASE-01)

**Mandat :** revue CTO de la PR #1195. Une PR distincte doit actualiser la référence approuvée de `main`, conserver les interdictions de promotion non autorisée et vérifier le comportement du gate face à un déplacement inattendu de `main`.

**Constat.** `release-governance` échoue en fail-closed : `origin/main a bougé (e223e30e…)`. Le pin vivant `CURRENT_MAIN` vaut encore `fcf09327`, l'état d'avant la promotion v25 #1191 du 2026-11-17. Le même échec se reproduit sur `develop@70071390` sans aucune autre modification ; toute PR qui touche les chemins du workflow le rencontre.

**Changement.** Dans `scripts/verify-release-governance.js` uniquement :
- `CURRENT_MAIN` passe de `fcf09327` à `e223e30e` ;
- `CURRENT_MAIN_ONLY` passe de 30 à 32 commits, recalculés par `git rev-list --reverse origin/develop..origin/main` sur un clone **complet** (un clone partiel donne un décompte faux) ;
- le libellé du journal et le commentaire de provenance sont mis à jour.

**Inchangé :**
- le core historique `scripts/verify-release-governance-core.js` : son blob est toujours vérifié en fail-closed ;
- tous les remplacements exacts ;
- tous les tests négatifs (`RG-NEG-*`) ;
- le workflow.

## 1. État Git vérifié (clone complet)

| Référence | SHA | Tree |
|---|---|---|
| `origin/main` | `e223e30e9e195dabff01e66a81afdf0164486dc2` | `c0e6cd9e…` |
| `develop@84679445` (#1189, candidat promu) | `8467944526563b956bfd50370079af9e9355b533` | `c0e6cd9e…` (**identique**) |
| `origin/develop` | `70071390cc36e88444012bf23ea8afee16e6fea2` | `develop@84679445` + rapport d'audit #1193 (documentation) |
| `develop..main` | 32 commits | — |
| `main..develop` | 1 commit (`70071390`, docs #1193) | — |

## 2. Les 30 commits main-only déjà autorisés (inchangés)
La liste, l'ordre et les SHA sont identiques au pin précédent. Preuve : `RELEASE-GOVERNANCE-RECONCILE-MAIN-fcf09327.md`.

## 3. Les 2 nouveaux commits main-only, vérifiés un par un

Règle de vérification : chaque parent est soit un commit de `develop` (ancêtre de `origin/develop`), soit un main-only déjà listé. Aucun parent « autre » n'est accepté.

| # | Commit | Parent `develop` (fichiers différents) | Parent main-only | Tree | Objet |
|---|---|---|---|---|---|
| 31 | `f56344de` | `84679445` (**0**) | `fcf09327` | `c0e6cd9e` = `develop@84679445` | chore(release): reconcile main history with develop candidate v25 |
| 32 | `e223e30e` | — | `fcf09327` + `f56344de` | `c0e6cd9e` = `develop@84679445` | release(v25): promote qualified develop candidate to main (#1191) |

`e223e30e` est le merge GitHub du propriétaire (#1191). Son tree est identique à celui du candidat `develop@84679445`. Aucun contenu de `main` n'est absent de `develop`.

## 4. Comportement du gate (exécution locale, clone complet)

| Scénario | Résultat |
|---|---|
| `origin/main` = `e223e30e` (état réel) | **PASS** (`RG-POS-main-pinned-main-only`, `rc=0`) |
| `origin/main` déplacé vers un commit non autorisé (`d27afa2f`) | **FAIL** : `origin/main a bougé (d27afa2f…). STOP : reclasser les main-only.` (`rc=1`) |
| `origin/main` revenu à l'ancien pin `fcf09327` | **FAIL** : `origin/main a bougé (fcf09327…)` (`rc=1`) |
| Tests négatifs intégrés (`RG-NEG-unexpected-main-only-commit`, `RG-NEG-main-sha-differs-from-live-pin`, `RG-NEG-core-blob-unauthorized-change`, `RG-NEG-main-promotion-without-authorization`) | PASS |

Pour les scénarios FAIL, la référence locale `origin/main` a été déplacée temporairement puis restaurée. Aucune référence distante n'a été modifiée.

## 5. Gouvernance
- PR distincte, Draft / HOLD. Aucun merge, aucune promotion vers `main`, aucun déploiement.
- Toute nouvelle promotion vers `main` refera échouer le gate tant que le pin n'aura pas été réactualisé dans une PR de gouvernance validée par le CTO.
