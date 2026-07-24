# CI/CD Security — Somafrik (S2.4)

Documentation des contrôles automatiques de sécurité exécutés à chaque Pull Request.

## Objectif

Empêcher automatiquement :

- une régression de sécurité (scripts `verify:*`) ;
- une fuite de secrets (Gitleaks) ;
- un code qui ne typecheck / ne compile pas ;
- un lint en échec ;
- un audit npm avec vulnérabilité **critical** ;
- un merge sans revue (via branch protection GitHub — à activer manuellement).

## Workflows

| Fichier | Rôle |
|---------|------|
| [`.github/workflows/security.yml`](../.github/workflows/security.yml) | Jobs Security / TypeScript / Lint / Tests / Audit / Secrets |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint + build web + smoke backend (historique) |

### Déclenchement (`security.yml`)

- Pull Request vers `develop` ou `main`
- Push sur `develop` ou `main`

### Jobs et noms de checks GitHub

Ces noms doivent être cochés comme **required status checks** dans la protection de branche :

| Check | Contenu |
|-------|---------|
| **Secrets** | Gitleaks `8.24.3` (échec si fuite) |
| **Security** | `npm run verify:db-config` + `npm run verify:mobile-security` |
| **TypeScript** | `npm run typecheck` + `cd Mobile && npx tsc --noEmit` |
| **Lint** | `npm run lint` (web ESLint) |
| **Tests** | Suite verify existante (jwt, rbac, sanitize, db-config, mobile-security, `npm run check`) — fail-fast |
| **Audit** | `npm run audit:ci` (`npm audit --omit=dev`, fail si critical) |
| **Lint et build** | Job existant de `ci.yml` (recommandé aussi en required) |

### Version Node

**Fixe :** `22.12.0` (alignée sur `.nvmrc`).

Aucune version flottante (`22`, `22.x`, `lts/*`) n’est utilisée dans `security.yml`.

### Installation

Toujours `npm ci` via :

```bash
npm run ci:install
```

Jamais `npm install` en CI.

## Prérequis locaux

- Node.js **22.12.0** (`nvm use` / `.nvmrc`)
- Dépendances installées avec `npm run ci:install` (ou `npm run install:all` en local)
- Pour le scan secrets : binaire [Gitleaks](https://github.com/gitleaks/gitleaks) version **8.24.3** sur le `PATH`

## Commandes locales équivalentes

```bash
# Installation propre
npm run ci:install

# Sécurité applicative S2
npm run verify:db-config
npm run verify:mobile-security

# TypeScript / syntaxe
npm run typecheck
cd Mobile && npx tsc --noEmit

# Lint
npm run lint

# Suite verify (tests automatisés existants, hors e2e lourds)
npm run verify:jwt-header
npm run verify:rbac-s1-4
npm run verify:sanitize-user-responses
npm run check

# Audit dépendances (bloque critical uniquement)
npm run audit:ci
# équivalent manuel :
npm audit --omit=dev
npm audit --omit=dev --audit-level=critical

# Secrets
npm run verify:secrets
```

Orchestration locale complète (hors Gitleaks si absent) :

```bash
npm run ci:security
```

## Conditions de réussite d’une PR

1. La PR n’est **pas** en Draft (règle branch protection).
2. Au moins **1 approbation** de revue.
3. Conversations de revue **résolues**.
4. Tous les checks required (**Secrets**, **Security**, **TypeScript**, **Lint**, **Tests**, **Audit**, et idéalement **Lint et build**) sont **verts**.
5. Merge uniquement via Pull Request (pas de push direct sur `develop` / `main`).
6. Pour `main` : merge uniquement depuis `develop` (politique d’équipe + règle « restrict who can push » / ruleset).

## Branch protection — paramètres à appliquer sur GitHub

> Ces réglages sont **documentés** ici ; ils doivent être appliqués par un admin GitHub (Settings → Branches / Rulesets). La CI seule ne peut pas les activer.

### Branche `develop`

| Paramètre | Valeur |
|-----------|--------|
| Require a pull request before merging | Oui |
| Required approving reviews | ≥ 1 |
| Dismiss stale reviews | Recommandé |
| Require conversation resolution | Oui |
| Require status checks to pass | Oui |
| Required checks | Secrets, Security, TypeScript, Lint, Tests, Audit (+ Lint et build) |
| Require branches to be up to date | Recommandé |
| Do not allow bypassing the above settings | Oui (admins inclus si possible) |
| Restrict pushes that create files | — |
| Allow force pushes | Non |
| Allow deletions | Non |
| Block force pushes | Oui |
| Require linear history | Recommandé |
| Require merge queue | Optionnel |
| **Draft PR** | Ne pas autoriser le merge des Draft (GitHub : « Draft pull requests » non mergeables tant que non Ready ; activer aussi « Require pull request » ) |

Équivalent Ruleset recommandé :

- Target : `develop`
- Restrict deletions / force pushes
- Require PR : 1 approval, conversation resolution
- Require status checks (liste ci-dessus)
- Require linear history

### Branche `main`

Mêmes règles que `develop`, **plus** :

| Paramètre | Valeur |
|-----------|--------|
| Push direct | Interdit |
| Source de merge | Uniquement depuis `develop` (revue humaine + convention ; Ruleset : limiter les acteurs autorisés à merger) |
| Deploy / release | Uniquement après CI verte |

## Limitations connues (hors périmètre S2.4)

- Les suites **e2e** Playwright / scripts `verify:e2e-*` nécessitent services Docker/API et ne sont **pas** exécutées dans `security.yml` (trop lourdes / flaky pour un gate PR systématique). Le smoke backend reste dans `ci.yml`.
- Aucune suite `npm test` unitaire Jest/Vitest n’existe encore dans le monorepo ; le job **Tests** exécute les scripts `verify:*` existants.
- Le backend n’a pas de `tsconfig` : `typecheck:backend` = contrôle syntaxique `node --check` (pas de TypeScript backend).
- L’activation réelle de la **branch protection** est une action admin GitHub (non versionnable entièrement sans GitHub Rulesets API / org settings).
- `npm audit` ne bloque que le niveau **critical** ; moderate/low/high sont signalés dans les logs.
- Certificate pinning mobile et CI mobile native (EAS) restent hors S2.4.

## Références

- Mission S2.1–S2.3 : JWT header, DB config, Mobile hardening
- Scripts : `backend/scripts/verify-db-config.js`, `Mobile/scripts/verify-mobile-security.js`,
  `backend/scripts/verify-jwt-header.js` (assertions PDF alignées SecureStore / `Bearer ${token}`)
