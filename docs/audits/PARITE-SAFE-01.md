# PARITÉ-SAFE-01 — Rapport d'audit non destructif

**Date :** 2026-11-23 · **Mode :** AUDIT / HOLD / NO MERGE · **Aucune écriture Git distante, aucun déploiement.**

Légende : **CONFIRMÉ** (preuve reproductible ci-dessous) · **NON VÉRIFIÉ** (accès impossible) · **HYPOTHÈSE** (plausible, non prouvée).

---

## 1. SHA et merge-base (après `git fetch origin --prune`)

| Réf. | SHA | Statut |
|---|---|---|
| `origin/develop` | `70071390cc36e88444012bf23ea8afee16e6fea2` | CONFIRMÉ, inchangé depuis l'audit CTO |
| `origin/main` | `e223e30e9e195dabff01e66a81afdf0164486dc2` | CONFIRMÉ, inchangé |
| merge-base | `8467944526563b956bfd50370079af9e9355b533` (#1189) | CONFIRMÉ |
| tree `main` | `c0e6cd9e22d1…` | égal au tree de `develop^` (#1189) |
| tree `develop` | `3d9cdacfb750…` | tree de `main` + 1 document |

## 2. Ahead / behind

- `git rev-list --left-right --count origin/develop...origin/main` → **1 / 32**, identique avec `--cherry-pick`. Valeur obtenue sur un clone complet (`git fetch --unshallow`).
- Les 32 commits propres à `main` sont des merges de promotion et de réconciliation (#1145, #1173, #1191, `f56344de`…), dont le tree est égal à un état de `develop`. Ils correspondent exactement à la liste `CURRENT_MAIN_ONLY` de #1196 (vérifié ligne à ligne).
- **Rectificatif (PARITÉ-SAFE-02).** La première version de ce rapport indiquait « 1 / 2755 » et un « ré-enracinement de `develop` sur `6d15187f8` ». C'était un **artefact du clone superficiel** de l'environnement d'audit : `.git/shallow` contenait `6d15187f8`, qui a en réalité un parent (`604a0eb67`). `develop` compte 3131 commits. Aucune réécriture d'historique n'a eu lieu.

## 3. Différences réelles

| Type | Résultat | Statut |
|---|---|---|
| Historique | 32 merges de promotion et de réconciliation sur `main` | CONFIRMÉ, **Cas G** |
| Contenu | **1 seul fichier** : `docs/audits/AUDIT-PARITE-WEB-MOBILE-PROD-01.md` (présent sur `develop`, absent de `main`) | CONFIRMÉ |
| Fonctionnel (code) | **Aucune.** Web, Mobile, Backend, migrations et workflows sont identiques octet pour octet | CONFIRMÉ (`git diff --name-status`) |
| `git diff --check` | Vide | CONFIRMÉ |
| Artefacts | Divergent (voir §6) | CONFIRMÉ en partie |
| Configuration | versionCode : le dépôt indique 25, EAS la valeur distante 27 (voir §6) | CONFIRMÉ |

## 4. Matrice de préservation

Puisque `main` et `develop` ont le même tree hors un document, les 16 modules du mandat sont au même état sur les deux branches : Auth, Dashboard, Utilisateurs/rôles, Enseignants, Élèves, Parents, Notes, Présences, EDT, Bulletins, Finance, Communication, Paramètres, Carte NFC/QR, Transport, Superadmin. Aucune fonctionnalité n'est présente sur une seule des deux branches.

| Module | Fonction | develop | main | Artefact observé | Origine | Décision |
|---|---|---|---|---|---|---|
| Parents | Prénom du parent (fiche Élève → carte « Responsables ») | Présent | Présent (blob `bec785d5`) | NON VÉRIFIÉ sur appareil | #900 (`b74536480`, 2026-10-12), puis `93074fec8` (FormField) | **Conserver** |
| Parents | Nom du parent | Présent | Présent | NON VÉRIFIÉ | idem | **Conserver** |
| Parents | Téléphone du parent (fiche) | Présent | Présent | NON VÉRIFIÉ | idem | **Conserver** |
| Parents | Téléphone du parent (inscription/édition, `StudentMutationControls`) | Présent | Présent (blob `45afa8a2`) | NON VÉRIFIÉ | antérieur à `6d15187f8` | **Conserver** |
| Parents | Prénom/Nom du parent dans le formulaire d'inscription | **Absent des deux branches** (seul le téléphone existe) | Absent | — | — | Pas une régression : ce champ n'a jamais existé dans ce formulaire |
| Carte NFC | Motifs de révocation #1189 (Web) | Présent | Présent | **Absent du Web préprod** | #1189 | Conserver ; artefact à réaligner (Cas A) |
| Documentation | Audit #1193 | Présent | Absent | — | #1193 | Cas B, promotion docs-only à la prochaine release |

## 5. Diagnostic des champs Parent Mobile

**Code (CONFIRMÉ).** Sur les deux branches, `StudentDetailScreen.tsx:483-500` affiche Prénom / Nom / Téléphone du parent. Trois conditions doivent être réunies pour les voir :
1. **Écran** : fiche Élève (`StudentDetail`), carte **« Responsables »**. Cette carte est **repliée par défaut** (`ExpandableEntityCard`, `defaultExpanded = false`) : les champs n'apparaissent qu'après l'avoir dépliée.
2. **Permission** : `canLinkParentMobile(session)` (`Mobile/src/lib/parentLinkingAccess.ts:27`) exige `Relations:CREATE` ou « Gérer utilisateurs ». La fonction renvoie toujours `false` pour Superadmin et Admin pays. Sinon, le texte « Vous n'avez pas l'autorisation de lier un parent… » remplace les champs.
3. **Formulaire** : le formulaire « Ajouter / Modifier un élève » (`StudentMutationControls`) ne propose **que** le téléphone du parent, sur les deux branches.

**Causes possibles de la différence observée :**
- **HYPOTHÈSE forte : APK construit depuis une branche de PR.** Le job « NFC APK preview exact HEAD » (`nfc-encoding-preprod.yml`) construit des APK de test depuis la tête de chaque PR, dont la dernière exécution sur #1195 (`22bf5c1e`, run 44502799713). Or la LOT 3 de **#1195 renomme ces champs** en « Prénom », « Nom », « Téléphone », ajoute « E-mail », renomme la carte en « Parents et responsables », et son test `parentFormParity.test.ts:64` **interdit** les libellés « Prénom du parent » et « Nom du parent ». Un APK issu de #1195 n'affiche donc plus ces libellés, alors que les champs existent toujours.
- **CONFIRMÉ : plusieurs binaires portent l'étiquette « v25 ».** Le dépôt indique `versionCode 25` (`app.json`, `config/releaseEnvironments.js:21`), mais EAS utilise `appVersionSource: remote` + `autoIncrement`. Le dernier AAB issu de `e223e30` porte le **versionCode 27**, et le log EAS précise que la valeur 25 reste visible via `expo-constants`. La version affichée dans l'app ne permet donc pas de savoir quel commit a produit le binaire.
- HYPOTHÈSE : compte de test sans `Relations:CREATE`, ou connecté en Superadmin (comportement voulu, fail-closed).
- HYPOTHÈSE : carte « Responsables » non dépliée, ou observation faite sur le formulaire d'inscription.
- Rejeté : il n'y a **pas de perte de code** entre `develop` et `main` (blobs identiques).

**Pour conclure, il faut sur l'appareil observé :** le `versionCode` système (`adb shell dumpsys package com.somafrik.app | grep version`), le SHA256 de l'APK, le rôle et les permissions du compte, et une capture de la carte « Responsables » dépliée.

## 6. Artefacts Web et Android

| Artefact | SHA source | Date | Workflow / profil | versionName / Code | API | Statut |
|---|---|---|---|---|---|---|
| API préprod | `78a7749ae` (tête de la branche `fix/nfc-p0-r3-3-prevention`, **pas un ancêtre de `develop`**) | — | Render | 1.0.0 | — | CONFIRMÉ via `/api/health`. **Tree identique à `main`** (`c0e6cd9e`), mais déployé depuis une branche de PR |
| Web préprod | inconnu (`index-DnYpqg8G.js`) | — | — | — | api-preprod | CONFIRMÉ : **#1189 absent** (aucun des 144 chunks ne contient `nfc_reservation_expired`, « Signaler une carte NFC suspecte » ni « Motif obligatoire »). Le Web est en retard sur l'API |
| API prod | — | — | Render | — | api.somafrik.app | **NON VÉRIFIÉ** (hôte refusé par le proxy ; API Render en 401) |
| Web prod | — | — | — | — | — | **NON VÉRIFIÉ** (hôte refusé) |
| AAB prod run #3 | `e223e30` | 2026-11-17 22:51Z | `eas-production-aab.yml`, profil `production`, EAS build `1f91fca1…` | 1.2.1 / **27** | api.somafrik.app | CONFIRMÉ. SHA256 `e236ddcf356b1d3e…fd89`, keystore EAS « gVVTCcLJMH ». Artefact GitHub 14378610942, expire 30 jours après le build |
| AAB prod run #2 | `e223e30` | 2026-11-17 21:11Z | idem | 1.2.1 / 26 (déduit de « 26 → 27 » au run #3) | idem | Partiellement vérifié |
| AAB distribué sur Google Play | — | — | — | — | — | **NON VÉRIFIÉ** (pas d'accès à la Play Console). Le message de #1191 dit « no Play publication authorized » |
| APK de test | têtes de PR (ex. `22bf5c1e` pour #1195) | — | `nfc-encoding-preprod.yml`, profil preview | — | api-preprod | Workflow CONFIRMÉ ; APK installé sur l'appareil **NON VÉRIFIÉ** |
| `mobile-release-build.yml` | — | — | — | — | — | 0 exécution |
| `Mobile/build-apk-log.txt` (versionné) | — | — | build local Windows, **API LAN `http://10.45.100.170:5000`**, v1.2.0 | — | — | Résidu obsolète : le script `build-apk.js` n'existe plus et la build avait échoué |

## 7. Régressions confirmées

- **Aucune régression de code entre `develop` et `main`.**
- **R-ART-1 (CONFIRMÉ)** : le Web préprod ne contient pas #1189, alors que l'API préprod l'exécute. Désalignement d'artefact, Cas A.

## 8. Risques

| Niv. | Risque |
|---|---|
| **P0** | Le binaire Android réellement distribué ou installé n'est pas identifié : versionCode 25 dans le dépôt, 26 et 27 côté EAS, plus des APK de test issus de branches de PR |
| **P0** | Production Web et API : NON VÉRIFIÉ |
| **P1** | **#1195 LOT 3** renomme les libellés Parent et **interdit par test** « Prénom du parent » et « Nom du parent ». Le fichier `parentFormCopy.ts` affirme une « terminologie validée par le CTO (#1192) », alors que la décision CTO du 18/11 sur #1192 dit « Terminologie Parent/Responsable **à valider** » et demande une coordination avec #1126/#1127 (gelés). Affirmation non étayée : **Cas F** |
| **P1** | **#1195 LOT 6 et #1141** modifient les mêmes lignes de `canonicalStudentIdentity.ts`, avec une logique identique. Doublon et conflit textuel garantis si les deux sont intégrées |
| **P1** | L'API préprod est déployée depuis une branche de PR, pas depuis `develop` : traçabilité rompue, même si le contenu est identique |
| **P2** | `versionCode` du dépôt ignoré par EAS (remote), mais exposé via `expo-constants` : affichage trompeur |
| **P2** | `Mobile/build-apk-log.txt` versionné, avec une IP LAN et un chemin de poste Windows |
| **P2** | L'artefact AAB GitHub expire vers le 2026-12-17 : à archiver si c'est la preuve de release |

## 9. PR ouvertes concernées

| PR | Base | Ahead / behind | Fichiers | Chevauchement | Recommandation |
|---|---|---|---|---|---|
| #1195 Recovery | `develop@7007139` | 14 / 0 | 53 | Fiche Parent (LOT 3) ; identité Élève (LOT 6 = #1141) ; workflows | Découper : isoler LOT 3 en attente de l'arbitrage terminologie ; retirer LOT 6 ou fermer #1141 |
| #1196 Gouvernance | `develop@7007139` | 1 / 0 | 2 | Aucun | Indépendante |
| #1194 Carte NFC | `develop@7007139` | 2 / 0 | 2 (`studentCardEnrollmentAccess*`) | Aucun avec #1195 | Indépendante |
| #1141 Identité Élève | `develop@8e2e1cc` | 3 / **51** | 2 | Identique à #1195 LOT 6 | Choisir une seule implémentation |

Toutes sont en Draft. Aucune n'est considérée comme livrée.

## 10. Plan de correction minimal et non destructif (propositions, rien d'exécuté)

1. **Cas G, historique** : aucune action de code. Documenter la relation de release (`main` = `develop` qualifié, réconcilié par merge) dans #1196.
2. **Cas B, doc #1193** : promotion docs-only vers `main` lors de la prochaine release. Aucun impact fonctionnel.
3. **Cas A, Web préprod** : redéployer le Web préprod depuis `develop@7007139`, avec un smoke NFC #1189, après accord CTO (P1-A).
4. **Cas A, API préprod** : redéployer depuis `develop` (contenu identique, la traçabilité seule change), après accord CTO.
5. **P0-B, artefacts** : relever sur l'appareil versionCode, SHA256 et signature ; vérifier la Play Console ; aligner le versionCode du dépôt sur la valeur distante EAS, ou retirer la valeur locale (PR Draft dédiée, hors #1195).
6. **Cas F, libellés Parent** : arbitrage CTO entre « Prénom du parent » (actuel, validé) et « Prénom » (#1195). Tant qu'il n'a pas eu lieu, **retirer l'assertion `doesNotMatch` de `parentFormParity.test.ts:64`**. L'ajout du champ e-mail (Cas D, additif) peut être conservé séparément.
7. **Doublon #1141 / #1195 LOT 6** : garder une seule PR (#1141 est antérieure et ciblée) et la rebaser sur `develop`.
8. **P2** : retirer `Mobile/build-apk-log.txt` dans une PR d'hygiène.

## 11. Tests nécessaires

**Champs Parent, sur appareil Android réel avec un binaire identifié par SHA :**
- ouvrir la fiche Élève et déplier « Responsables » ;
- saisir prénom, nom et téléphone, puis lier ;
- recharger la fiche et vérifier la persistance PostgreSQL (`parent_relations`) ;
- tester les rôles Admin école et Secrétaire (champs visibles), Enseignant, Parent et Superadmin (message de refus) ;
- vérifier l'isolation multi-tenant (élève d'une autre école → 404).

**Pour chaque PR de correction :** tests unitaires et ciblés, `tsc`, lint, build Web et Mobile, les gates CI requis (`pr-gates`, `security`, `android-release-readiness`), et un test de non-régression garantissant qu'aucun champ Parent existant ne disparaît. Assertion **positive** de présence des trois champs.

**Non exécuté dans cet audit** : aucune correction n'a été proposée en code, et les dépendances Mobile ne sont pas installées dans l'environnement.

## 12. Verdict CTO proposé

- **Parité de code `develop` / `main` : CONFORME.** Aucune perte de fonctionnalité, seul un document diffère.
- **Parité des artefacts : NON CONFORME.** Le Web préprod n'a pas #1189, l'API préprod provient d'une branche, et le binaire Android n'est pas identifié.
- **Champs Parent : non perdus dans Git.** L'écart observé vient très probablement d'un artefact (APK de PR #1195, ou binaire non identifié) ou des conditions d'affichage. À confirmer sur l'appareil.
- **NO GO Production maintenu.**

`PARITÉ-SAFE-01 — AUDIT TERMINÉ / CORRECTIONS PROPOSÉES / HOLD / NO MERGE`
