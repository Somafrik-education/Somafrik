# GOV-PAUSE-02 — Suspension temporaire de R15 pendant le développement

**Statut :** DRAFT / HOLD — NO MERGE. Proposition soumise à décision CTO.
**Base :** `develop@12eb98fa9c653484c9cc156ad2a429a4fe205dd7`.
**Branche :** `chore/gov-pause-02-suspend-r15`.

## 1. Objet

Suspendre la publication automatique du statut `governance/merge-authorization` (R15) tant que l'identité CTO indépendante n'est pas en place (GOV-01/GOV-02), **sans** affaiblir les gates techniques, le code produit, les droits utilisateurs ni les Rulesets GitHub.

## 2. Ce que fait la proposition

| Commit | Fichier | Effet |
|---|---|---|
| `a8af8851` (initial) | `.github/workflows/pr-gates.yml` | Retirait `npm run verify:governance-r15` de « Core tests ». **Ne suspendait pas R15** : ce script lance seulement les tests unitaires de la logique R15 (`scripts/governance/mergeAuthorization.test.mjs`). Le statut rouge est publié par `merge-authorization.yml`, non modifié par ce commit. |
| revert de `a8af8851` | `.github/workflows/pr-gates.yml` | Rétablit `verify:governance-r15` : Core tests reste complet. |
| suspension | `.github/workflows/merge-authorization.yml` | Désactive (commente) les déclencheurs `pull_request` et `pull_request_review`. Le workflow ne s'exécute plus sur les PR : aucun statut R15 n'est publié, ni `success` ni `failure`. `workflow_dispatch` est conservé (inopérant tant que le workflow n'est pas sur `main`). |
| documentation | `docs/governance/GOV-PAUSE-02.md` | Ce document. |

Inchangés : `scripts/governance/*`, `.github/governance/merge-authorizers.json`, Rulesets, droits, code produit.

**Option écartée :** publier un statut `success` « suspendu ». Un faux vert deviendrait une autorisation de fusion dès que GOV-03 exigera ce contexte. La suspension proposée est **fail-closed** : l'absence de statut bloque toute fusion si un Ruleset l'exige.

## 3. Conséquences

### Ce qui ne change pas

- **Aucune capacité de fusion n'est ajoutée.** Le statut R15 n'est exigé par aucun Ruleset aujourd'hui (lecture API du 26/10/2026) :
  - `develop` (id 19008211) : 0 approbation requise, **liste de checks requis vide** ;
  - `main` (id 19007889) : 1 approbation + check `CI` sans source ; aucun workflow ne publie `CI` : **`main` reste gelé**, avec ou sans R15.
- Le contrat `CTO-GO-MERGE`, le script et ses tests restent en place et testés.

### Ce qui change

- Plus de verdict R15 automatique sur les PR : le refus « aucun autorisateur configuré » disparaît des PR, ainsi que tout contrôle automatisé du contrat `CTO-GO-MERGE` (HEAD exact, branche cible, review du CTO).
- `mergeable_state` d'une PR ne sera plus « unstable » à cause de R15. **Risque de lecture :** une PR sans croix rouge n'est pas pour autant autorisée. Pendant la suspension, l'autorisation de fusion reste **la décision CTO écrite et le diff indépendant**, comme dans le processus actuel.
- Comme pour toute PR qui modifie ce workflow, la PR GOV-PAUSE-02 exécute sa propre version du YAML (`docs/governance/MERGE-AUTHORIZATION.md` §7.3) : elle ne recevra elle-même aucun statut R15.

## 4. Protections qui restent actives

Toutes continuent de s'exécuter. **Attention : aucune n'est exigée par le Ruleset `develop` actuel** (liste vide) ; elles informent mais ne bloquent pas une fusion tant que GOV-03 n'est pas réalisé.

| Gate | Déclenchement | Contenu |
|---|---|---|
| PR Gates → **Required** | toute PR vers `develop`/`main` | agrège Scope, Quality, Secrets, Core tests, Risk-targeted, LOT 0–8 (échec si l'un n'est ni `success` ni `skipped`) |
| **Quality** | code ou workflows modifiés | lint, typecheck, build Web |
| **Secrets** | code ou workflows modifiés | Gitleaks 8.24.3 |
| **Core tests** | code ou workflows modifiés | `verify:v2-foundation` + Security baseline : JWT, sessions, SEC-TENANT-01/02, SEC-AUTH-03/04/05, SEC-JWT-01, PDF, RGPD, **`verify:governance-r15`**, `verify:rbac-s1-4`, deny données personnelles plateforme, Supabase, `search_path`… |
| **Risk-targeted** + LOT parity | selon les chemins modifiés | régressions par domaine |
| Isolation tenant | filtrés par chemins | `users-tenant`, `presence-tenant`, `enrollment-tenant`, `planning-tenant`, `sync-l1-tenant`, `academic-year-tenant`, `tenant-revalidation` |
| RBAC | filtré par chemins | `RBAC HTTP live API` |
| Nocturnes | planifiés | `CI Full Nightly`, `Security Nightly` |

## 5. Procédure de réactivation

À réaliser **avant** que GOV-03 ajoute `governance/merge-authorization` aux checks requis, sinon toutes les PR seraient bloquées (statut absent = refus).

1. Prérequis : compte CTO personnel opérationnel (GOV-01) et autorisateur enregistré (GOV-02), ou décision CTO de réactiver sans autorisateur (statut `failure` attendu).
2. PR dédiée : retirer les `#` des cinq lignes de déclencheurs dans `.github/workflows/merge-authorization.yml` (ou `git revert` du commit de suspension), et supprimer l'en-tête GOV-PAUSE-02.
3. Contrôle sur cette PR : un statut `governance/merge-authorization` est publié sur son HEAD exact (`failure` tant qu'aucune review CTO valide).
4. Fusion selon la procédure en vigueur, puis vérification sur une PR de test qu'une review sans ligne de contrat donne `failure` et que la ligne exacte `CTO-GO-MERGE PR=#… HEAD=… TARGET=develop` donne `success` (scénarios b/c de `MERGE-AUTHORIZATION.md` §6.5).
5. Seulement ensuite : GOV-03 (Rulesets).

## 6. Rollback

`git revert` du commit de suspension. Aucun état externe (Ruleset, droit, variable, secret) n'est modifié par GOV-PAUSE-02.
