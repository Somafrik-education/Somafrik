# R15 — Autorisation et traçabilité des fusions

**Chantier :** AUDIT-REPO-2026 / R15 (P0 gouvernance)
**Statut :** DRAFT / HOLD — rien n'est activé côté GitHub par ce lot.
**Constat d'origine :** [AUDIT-REPO-2026 §4](../audits/AUDIT-REPO-2026.md). 12 PR (#984 à #998) ont été fusionnées sans approbation GitHub, par le compte qui les avait ouvertes, avec un titre « DRAFT / HOLD » ; l'autorisation CTO n'était pas traçable dans les PR.

## 1. Principe

Une fusion vers `develop` ou `main` est légitime seulement si ces six points sont réunis :

1. le périmètre est vérifié ;
2. un diff indépendant a été fait ;
3. la CI requise est verte sur le HEAD exact ;
4. le CTO a donné une autorisation explicite et traçable ;
5. la PR n'est plus en Draft ;
6. l'autorisation porte sur le HEAD exact au moment de la fusion.

Les points 3 à 6 sont contrôlables par GitHub. Les points 1 et 2 relèvent du CTO, qui les atteste en donnant l'autorisation (point 4).

**La garantie réelle vient de GitHub lui-même (Ruleset et review), pas du script.** Le contrôle automatisé (§5) ajoute deux liaisons qu'une review GitHub ne porte pas seule : la liaison explicite à la branche cible et le format du contrat. Il ne remplace pas le Ruleset et ne doit jamais être présenté comme suffisant à lui seul.

## 2. État vérifié des protections GitHub (26/10/2026)

Source : API REST GitHub, lecture seule (`GET /repos/{repo}/rulesets/{id}`, `GET /branches/develop/protection`, liste des collaborateurs).

| Élément | `develop` (Ruleset 19008211, actif) | `main` (Ruleset 19007889, actif) |
|---|---|---|
| PR obligatoire (pas de push direct) | Oui | Oui |
| Approbations requises | **0** | 1 |
| Rejet des approbations obsolètes au push | Non | Oui |
| Approbation du dernier push par un tiers | Non | Oui |
| Approbation des propriétaires de code | Non | Non (aucun `CODEOWNERS` dans le dépôt) |
| Conversations résolues | Oui | Oui |
| Contrôles CI requis | **Aucun** (liste vide, mode strict activé) | `CI`, **sans application source** |
| Force-push / suppression interdits | Oui / Oui | Oui / Oui |
| Acteurs autorisés à contourner | Aucun visible¹ | Aucun visible¹ |
| Protection de branche classique | Absente (404) | non lue |

¹ La liste a été lue sans jeton administrateur ; GitHub peut la masquer. **[À VÉRIFIER]** avec un compte administrateur.

**Constats :**

- **Collaborateurs du dépôt : un seul, `Somafrik`, administrateur.** C'est aussi le compte qu'utilisent les agents (Cursor, Claude Code, Codex). Aucune identité indépendante ne peut donc aujourd'hui approuver une PR : GitHub interdit à l'auteur d'approuver sa propre PR.
- **`develop`** : n'importe quelle PR peut être fusionnée sans approbation et **avec une CI rouge**. Seule la résolution des conversations est exigée.
- **`main`** :
  - aucun workflow déclenché par une PR ne produit de contrôle nommé `CI` : `ci.yml` ne tourne que la nuit, et son job s'appelle « Full regression ». Une PR vers `main` reste donc bloquée de fait.
  - l'approbation exigée ne peut venir que d'un second compte, qui n'existe pas.
  - **Contournement possible :** le contrôle `CI` n'étant lié à aucune application, tout compte ayant le droit d'écriture peut publier lui-même un statut `CI` réussi par l'API.
- Les PR en Draft sont refusées nativement par GitHub, quel que soit le Ruleset (bouton désactivé, API en erreur 405).
- Un administrateur peut toujours modifier ou désactiver un Ruleset. Tant que les agents utilisent un compte administrateur, aucune règle GitHub n'est opposable à un agent malveillant ou mal configuré.

## 3. Contrat d'autorisation CTO

L'autorisation est **une review GitHub « Approve »** déposée sur la PR par le compte personnel du CTO. Son corps contient, sur une ligne seule et sans mise en forme :

```
CTO-GO-MERGE PR=#NNN HEAD=<SHA complet, 40 caractères> TARGET=develop
```

**Règles :**

1. **HEAD et cible.** L'autorisation vaut pour un seul HEAD et une seule branche cible.
   - La review doit avoir été déposée sur ce HEAD : son `commit_id` est fixé par GitHub et ne peut pas être modifié.
   - Les champs `PR`, `HEAD` et `TARGET` doivent correspondre à l'état courant de la PR.
2. **Nouveau commit.** Tout nouveau commit annule l'autorisation : le HEAD change, la review ne porte plus sur lui, et le Ruleset cible rejette aussi l'approbation obsolète.
3. **Cible `main`.** `TARGET=develop` n'autorise jamais une fusion vers `main`. Changer la branche cible d'une PR après autorisation invalide l'autorisation.
4. **Textes libres.** « approved », « ready », « authorised by CTO », un simple commentaire ou une review « Comment » ne valent rien.
5. **Comptes exclus.**
   - Le compte partagé `Somafrik`, les bots et l'auteur de la PR sont refusés, même s'ils recopient la chaîne exacte.
   - Seuls les logins listés dans `.github/governance/merge-authorizers.json` **de la branche cible** sont habilités. Une PR ne peut donc pas s'ajouter elle-même à la liste.
   - La liste est livrée **vide** : aucune PR n'est autorisable tant que le CTO n'y a pas inscrit son compte personnel.
6. **Titre.** Il doit refléter l'état réel : un titre contenant encore DRAFT, HOLD ou NO MERGE est refusé.
7. **Révocation.** Si l'autorisateur dépose ensuite « Request changes » ou si sa review est rejetée, l'autorisation tombe.

**Pourquoi une review et non un commentaire.** L'auteur d'une review est authentifié par GitHub, sa review est attachée à un commit, et GitHub interdit l'auto-approbation. Un commentaire n'est lié à aucun commit et peut être rédigé par n'importe quel compte ayant accès à la PR, y compris le compte partagé des agents.

## 4. Fichiers livrés

| Fichier | Rôle |
|---|---|
| `scripts/governance/mergeAuthorization.mjs` | Décision pure, sans réseau |
| `scripts/governance/verify-merge-authorization.mjs` | Collecte les faits GitHub, applique la décision, publie le statut `governance/merge-authorization` sur le HEAD (fail-closed) |
| `scripts/governance/mergeAuthorization.test.mjs` | 24 tests (`npm run verify:governance-r15`, branchés dans PR Gates · Core tests) |
| `.github/workflows/merge-authorization.yml` | Déclenche l'évaluation |
| `.github/governance/merge-authorizers.json` | Autorisateurs (vide), comptes refusés, cibles protégées, CI requise par cible |
| `docs/governance/rulesets/*.proposed.json` | Rulesets proposés, **non appliqués** |
| `docs/governance/CODEOWNERS.proposed` | Modèle, **non actif** |

## 5. Contrôle automatisé : fonctionnement et garanties réelles

**Déclencheurs :**
- **`pull_request`** (ouverture, nouveau commit, passage Draft ↔ Ready, modification du titre ou de la cible), sur les PR vers `develop` ou `main`.
- **`pull_request_review`** (review déposée, modifiée ou rejetée).
- Pour ces deux événements, **GitHub exécute la version du YAML présente dans la PR** (merge ref), constaté en recette (§5.1). Le YAML extrait le script de la **branche cible**, pas celui de la PR. Mais une PR qui modifie ce YAML peut modifier ce comportement : voir §7.
- **`workflow_dispatch`** : réévaluation manuelle. Elle n'est disponible qu'une fois le workflow présent sur la branche par défaut (`main`).

### 5.1 Recette des déclencheurs (PR #1001, 26/10/2026)

PR de recette `recette/r15-head` → `recette/r15-base`, sans Ruleset. La branche de base porte un pas qui affiche `YAML=BASE`, la tête affiche `YAML=PR-HEAD`, et chaque exécution affiche le commit du script extrait.

**Première version (`pull_request_target`, HEAD R15 `7d613aad`) :**

| Événement | Exécution | Résultat |
|---|---|---|
| Ouverture, nouveau commit, titre, Draft ↔ Ready | **Aucune** (0 exécution `pull_request_target` dans tout le dépôt) | Le statut n'est jamais publié |
| Review « Comment » (run 40341694684) | `YAML=PR-HEAD`, `workflow_sha` = merge ref `eed31249`, script extrait de la base `8da7a41e` | Statut `failure` publié sur le HEAD **courant**. Motifs : liste d'autorisateurs vide, Draft, cible hors périmètre, review du compte `Somafrik` refusée |
| Review « Approve » par le compte auteur | Rejetée par GitHub : « Can not approve your own pull request » | — |

**Cause.** Depuis le 08/12/2025, GitHub exécute `pull_request_target` depuis la **branche par défaut** (`main` ici), et non depuis la base de la PR ([changelog GitHub](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/)). De plus, les dépôts publics recevront une politique désactivant `pull_request_target` par défaut, appliquée à partir du 02/12/2026 ([changelog](https://github.blog/changelog/2026-09-17-workflow-execution-protections-in-github-actions-generally-available/)).

**Correction.** Remplacement par `pull_request`. Le résultat de la seconde recette est consigné dans la PR #1000.

**Décision.** Elle est refusée si l'un des points suivants n'est pas satisfait :
- PR ouverte et non Draft ;
- cible protégée ;
- titre sans marqueur HOLD ;
- configuration valide, avec au moins un autorisateur ;
- CI requise (`Required` pour `develop` et `main`) **terminée et verte** sur le HEAD (le dernier passage compte) ;
- autorisation valide au sens du §3.

**Publication.** Le résultat est publié comme statut sur le **HEAD exact** :
- `success` ou `failure`, avec le motif ;
- le détail figure dans le résumé du job.

**Fail-closed :**
- toute erreur d'API, de permission ou de configuration donne un statut `failure` ;
- si le statut ne peut pas être publié, le job échoue et le HEAD reste sans statut ;
- un contrôle requis absent bloque la fusion.

**Moment de la vérification.** Le statut reflète l'état au moment de la dernière évaluation.
- **Nouveau commit :** nouvelle évaluation, refus.
- **Review déposée :** nouvelle évaluation.
- **Fin de la CI :** aucun événement ne relance l'évaluation, car GitHub ne déclenche pas de workflow sur la fin d'un autre workflow, sauf via `workflow_run` exécuté depuis `main`. **Procédure :** le CTO approuve après la CI verte. Sinon, modifier le titre ou la description relance l'évaluation (`edited`).

**Permissions minimales :** `contents: read`, `pull-requests: read`, `checks: read`, `statuses: write`.

## 6. Activation de la protection effective (actions manuelles, sur décision CTO séparée)

**Aucune de ces actions n'est réalisée par R15.** L'ordre compte : appliquer le point 4 avant les points 1 à 3 bloquerait toutes les fusions.

1. **Séparer les identités.**
   - Créer ou désigner le compte GitHub **personnel** du CTO.
   - L'inviter avec le rôle *Admin* ou *Maintain*.
   - Faire travailler les agents sous une identité **sans droit d'administration** : rôle *Write* sur `Somafrik`, ou GitHub App dédiée.
   - Réserver l'administration au CTO.
2. **Déclarer l'autorisateur.** Une PR ajoute le login du CTO à `authorizers` dans `.github/governance/merge-authorizers.json`, puis est fusionnée avec la procédure actuelle.
3. **Propriétaires de code.** Renommer `docs/governance/CODEOWNERS.proposed` en `.github/CODEOWNERS`, avec le login réel du CTO.
4. **Rulesets.** Importer `docs/governance/rulesets/develop.proposed.json` et `main.proposed.json` (Settings → Rules → Rulesets → Import, ou API), ou modifier les Rulesets existants à l'identique :
   - approbation 1 et approbation des propriétaires de code ;
   - rejet des approbations obsolètes ;
   - approbation du dernier push ;
   - conversations résolues ;
   - contrôles requis `Required` et `governance/merge-authorization`, liés à l'application **GitHub Actions** (`integration_id` 15368) ;
   - aucun acteur autorisé à contourner.

   Pour `main`, remplacer le contrôle `CI` sans source par ces deux contextes.
5. **Démonstration** (critère de réussite R15), sur une PR documentaire de test :

   | Étape | Résultat attendu |
   |---|---|
   | a. Fusion tentée par le compte agent, sans review | Refusée par GitHub (approbation et statut manquants) |
   | b. Review « Approve » sans la ligne de contrat | Statut `failure`, fusion refusée |
   | c. Review « Approve » avec la ligne exacte, CI verte | Statut `success`, fusion possible |
   | d. Nouveau commit après c | Approbation rejetée et statut `failure`, fusion refusée |
   | e. Changement de la cible vers `main` | Statut `failure` |
   | f. Statut `governance/merge-authorization` publié à la main par l'API avec un jeton personnel | Ignoré par le Ruleset (source différente de GitHub Actions) |

   **Consigner les réponses de l'API ou des captures dans la PR de démonstration.** Tant que cette démonstration n'est pas faite, R15 n'est pas terminé.
6. **Journalisation.**
   - Consulter l'historique des Rulesets (Settings → Rules → Rulesets → History) après chaque modification.
   - Sur un compte d'organisation, le journal d'audit enregistre les événements `repository_ruleset.*`.
   - **[À VÉRIFIER]** Disponibilité selon le plan GitHub.

## 7. Limites de sécurité (à lire avant toute décision)

1. **Administrateurs.** Tout administrateur peut désactiver un Ruleset. La protection ne vaut que si les agents n'ont pas ce rôle (§6.1).
2. **Statut falsifiable depuis le dépôt.** Lier le contrôle à GitHub Actions écarte les statuts publiés avec un jeton personnel. En revanche, **tout workflow du dépôt** dispose de la même identité GitHub Actions. Exemple : un compte en écriture pousse sur une branche quelconque un workflow déclenché au push, qui publie `governance/merge-authorization = success` sur n'importe quel SHA.

   Le statut R15 est donc une **défense en profondeur**. La barrière non falsifiable est la **review GitHub d'un compte distinct**, avec approbation des propriétaires de code et du dernier push (§6.3–6.4).
3. **YAML contrôlé par la PR.** Pour `pull_request` et `pull_request_review`, le YAML exécuté est celui de la PR (constaté en recette, §5.1). Une PR qui modifie `merge-authorization.yml` ou le script peut donc altérer le statut qu'elle reçoit. Aucun déclencheur GitHub ne permet aujourd'hui d'éviter cela sans passer par la branche par défaut.
   - **Garde-fou :** l'obligation d'approbation CTO sur le dernier push, et les propriétaires de code sur `.github/` et `scripts/governance/`. Le CTO doit relire tout changement sous ces chemins.
   - **Alternative plus robuste, à décider :** une GitHub App, ou un `pull_request_target` une fois le workflow sur `main`, avec une politique d'événements explicitement autorisée pour ce workflow.
4. **CI terminée après l'approbation :** pas de réévaluation automatique (§5).
5. **Branche à jour exigée (mode strict).** Chaque avancée de `develop` impose de mettre la PR à jour, ce qui produit un nouveau HEAD et exige une nouvelle autorisation. C'est voulu, mais coûteux en séquence.
6. **Lectures non vérifiées.** Les acteurs de contournement et le journal d'audit n'ont pas pu être lus avec des droits administrateur depuis cet environnement.
7. **Tests.** Les tests unitaires prouvent la logique de décision, **pas** l'application par GitHub (§6.5).
