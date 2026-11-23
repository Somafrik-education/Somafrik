# PARITÉ-SAFE-02 — Réconciliation sans régression : corrections et décisions

**Date :** 2026-11-23 · **Statut :** CORRECTIONS PRÊTES POUR DIFF CTO / DRAFT / HOLD / NO MERGE
**Références :** #1192, #1193, #1195, #1196, #1141 · Rapport d'audit précédent : `PARITE-SAFE-01.md` (rectifié, voir §1)

Légende : **CONFIRMÉ** · **NON VÉRIFIÉ** · **HYPOTHÈSE**.

---

## 1. SHA recalculés (clone complet, `git fetch --unshallow`)

| Réf. | SHA |
|---|---|
| `origin/develop` | `70071390cc36e88444012bf23ea8afee16e6fea2` |
| `origin/main` | `e223e30e9e195dabff01e66a81afdf0164486dc2` |
| merge-base | `8467944526563b956bfd50370079af9e9355b533` |
| ahead / behind (`develop...main`) | **1 / 32**, identique avec `--cherry-pick` |
| Diff de contenu | 1 fichier : `docs/audits/AUDIT-PARITE-WEB-MOBILE-PROD-01.md` |

**Rectificatif de PARITÉ-SAFE-01.** Les chiffres « 1 / 2755 » et le « ré-enracinement de `develop` » venaient du clone superficiel de l'environnement d'audit (`.git/shallow` = `6d15187f8`). `6d15187f8` a un parent (`604a0eb67`). Les 32 commits propres à `main` correspondent ligne à ligne à `CURRENT_MAIN_ONLY` de #1196. CONFIRMÉ.

## 2. P0 — Champs Parent Mobile

### Préservation (règle §3 du mandat)

| Élément | Comportement sur `develop` | Origine | Persistance | Tests existants |
|---|---|---|---|---|
| Formulaire de liaison (fiche Élève, carte « Responsables ») | Prénom, Nom, Téléphone du parent ; bouton « Lier un responsable » | LOT 2 C18 `5989f1ff9` (2026-09-18) ; libellés #900 `b74536480` (2026-10-12) ; FormField `93074fec8` | `POST /api/parents/link` → `contacts`, `contact_relations`, `user_roles` PARENT | `verify:parent-linking` (mémoire + PG), `studentFicheGuardians.test.ts` |
| Autorisation | `canLinkParentMobile` : `Relations:CREATE` ou « Gérer utilisateurs » ; refus explicite pour Superadmin et Admin pays | `parentLinkingAccess.ts` | — | `mobileParentP0.security` |
| Inscription / modification d'un élève | Téléphone du parent seul | `StudentMutationControls` | `parentPhone` | `verify:mobile-form-fields` |

### Ce que la LOT 3 de #1195 change, et ce qui est corrigé

| LOT 3 (#1195, `594bcb560`) | Décision | Correction (PR PARENT-LABELS) |
|---|---|---|
| Libellés de liaison réduits à « Prénom », « Nom », « Téléphone » | **Contraire à la décision CTO** | « Prénom du parent », « Nom du parent », « Téléphone du parent », « E-mail du parent » (Web et Mobile) |
| Test `assert.doesNotMatch(... Prénom du parent \| Nom du parent)` | **Supprimé** | Remplacé par des assertions positives, champ par champ |
| Ajout du champ e-mail Parent (fiche + inscription) | Conservé (additif) | — |
| Validation locale téléphone OU e-mail | Conservée | Couverte par test et par mutation |
| Charge utile `buildParentLinkPayload` | Conservée | Couverte par un test PostgreSQL réel |
| Badge « Principal » (donnée `isPrincipal` réelle) | Conservé | Pas de badge légal ou financier simulé |
| Liste des responsables : « Téléphone : … · E-mail : … » | Conservée (libellés courts en affichage) | — |
| Titre de la carte « Responsables » → « Parents et responsables » | **À arbitrer par le CTO** (non tranché) | Inchangé par rapport à la LOT 3 |
| Bouton « Lier un responsable » → « Créer ou lier un parent » | **À arbitrer par le CTO** | Inchangé par rapport à la LOT 3 |
| Commentaire « terminologie validée par le CTO (#1192) » | Affirmation non étayée | Remplacé par la référence PARITÉ-SAFE-02 |

### Preuves (CONFIRMÉ, exécuté le 23/11/2026)

- `npm run test:parent-labels-safe-02` vert. Il est ajouté au gate CI `pr-gates` / « Mobile safety ».
- **Six mutations** font échouer le test :
  - libellé raccourci ;
  - champ Nom supprimé ;
  - téléphone déconnecté de son état ;
  - libellé masqué (`hideVisibleLabel`) ;
  - formulaire retiré aux rôles autorisés ;
  - validation téléphone OU e-mail retirée.
- **PostgreSQL 16 réel** (`parentLinking.pg.test.js`) : la charge utile Mobile exacte passe pour e-mail seul (`phone: ""`) et pour téléphone seul (`email: ""`). Les responsables relus portent prénom et nom. Un compte existant est réutilisé, l'absence de contact est refusée (`PARENT_IDENTITY_REQUIRED`) et les compteurs du compte existant restent inchangés. `verify:parent-linking` (Web compris, 11/11) est vert.
- TypeScript Mobile et Web : 0 erreur. Web : 339 fichiers et 1936 tests verts. Build Vite OK. Lint des fichiers modifiés : 0 erreur (1 warning déjà présent sur `EntityPage.tsx:451`, depuis `6d15187f8`).
- Étape CI « Mobile safety » rejouée en entier (16 commandes) : verte. `verify:mobile-form-fields` et `test:lot2-parity` : verts.
- **NON VÉRIFIÉ** : smoke Android natif sur appareil, aucun appareil ni émulateur dans cet environnement. Les cartes « Responsables » repliée et dépliée, la liaison et la réouverture restent à exécuter par la recette (§6).

## 3. #1195 — revue indépendante des sept lots (HEAD `22bf5c1e`)

Base `develop@7007139`, 14 / 0, 53 fichiers. À sa tête : `test:parite-recovery-01`, `refreshStudentScope`, `financeDisplayVocabulary`, les vérificateurs de provenance Android et Web/API, `buildProvenance` et `tsc` Mobile sont tous **verts** (rejoués ici).

| Lot | Constat | Exigence CTO | Proposition |
|---|---|---|---|
| LOT 1 Session Élève | Le refresh n'ajoute les `studentIds` que si la session a été ouverte comme Élève et que le rôle est toujours attribué (fail-closed). `ScreenErrorBoundary` ajouté | Conforme | Garder ; smoke Android Élève avant/après refresh **NON VÉRIFIÉ** ici |
| LOT 2 Provenance APK/AAB | SHA, versionCode, profil et signature (apksigner build-tools 36/37) | Conforme | Garder |
| LOT 3 Parent | Libellés contraires à la décision CTO | **Non conforme** | Retirer `594bcb560` de #1195 ; remplacé par la PR PARENT-LABELS |
| LOT 4 Finances | Messages d'erreur reformulés et formatage des exports uniquement ; **aucun calcul, contrat ni valeur persistée modifiés** | Conforme | Garder |
| LOT 5 Traçabilité Web/API | SHA exposé dans le build Vite, vérificateur de cohérence Web/API | Conforme | Garder |
| LOT 6 Identité Élève | **Code identique à #1141** (diff vide hors commentaires) | Doublon | Voir §4 |
| LOT 7 Requêtes selon rôle | Ne s'applique qu'aux rôles Élève et Parent ; s'abstient d'appeler `courses`, `assignments`, `users`, `teachers`, `schools`, `countries`, `subscriptions` si le client n'a pas le droit | Conforme pour les rôles par défaut | **P2** : le backend ouvre `GET /api/courses` aussi avec `Voir classes`, alors que le client exige `Matières:READ`. Sans effet sur les rôles par défaut (`Voir classes` n'est attribué qu'au personnel) ; à surveiller pour les rôles personnalisés (HYPOTHÈSE) |

**Simulation d'intégration (CONFIRMÉ).** En retirant uniquement `594bcb560`, les 13 autres commits de #1195 se réappliquent **sans conflit** sur la PR PARENT-LABELS. Le résultat est égal à #1195 plus la seule correction des libellés (8 fichiers). Sans ce retrait, il y a un conflit sur les 5 fichiers de la LOT 3.

## 4. Sécurité identité Élève — #1141 et LOT 6 de #1195

| Critère | #1141 (`1f9cf26c`, 3 commits, base `8e2e1cc`, **51 commits de retard**) | LOT 6 de #1195 (`f5d03479`) |
|---|---|---|
| `sessionStudentAliasKeys` (rôle Élève) | `uuid = linked.studentId` uniquement | Identique |
| `resolveParentSafeStudentId` (rôle Élève) | Renvoie `user.linkedStudent.studentId` ou `null` | Identique |
| Fail-closed sans liaison | Oui | Oui |
| Parent | Inchangé (enfant lié uniquement) | Inchangé |
| Tests | Régression M7 (paiements, sélection forgée) + M7b (route forgée, absence de liaison, parent à trois enfants) | M7 (même modification) + `studentRouteIdentity.test.ts` (route, sélection obsolète, parcours normal, fail-closed, périmètre, **contrôle que les 5 écrans appelants transmettent `user`**) |
| Backend autorité | Inchangé, aucune modification backend | Inchangé |

**Vérification (CONFIRMÉ)** : sur `develop`, le code de #1141 combiné à `studentRouteIdentity.test.ts` de #1195 donne des tests verts (régression 21/21, `studentRouteIdentity` et `mobileParentP0.security` verts).

**Décision proposée au CTO (non intégrée) :**
- **implémentation canonique : #1141**, antérieure, dédiée et ciblée sur #1113 ;
- rebaser #1141 sur `develop` (merge de `develop`, pas de force-push) ;
- y ajouter `studentRouteIdentity.test.ts`, seul test complémentaire de la LOT 6 ;
- retirer `f5d034795` de #1195.

Variante équivalente : garder la LOT 6 et fermer #1141 en reprenant M7b. **Arbitrage CTO requis.** Les deux PR appartiennent à d'autres sessions, je n'ai poussé sur aucune.

## 5. #1196 — gouvernance release

- Diff : `scripts/verify-release-governance.js` (pin `CURRENT_MAIN` `fcf09327` → `e223e30e`, ajout de `f56344de` et `e223e30e` aux 32 commits propres à `main`) et un document de preuve. CONFIRMÉ.
- **Liste des 32 commits propres à `main` égale à la réalité** (`git rev-list --reverse origin/develop..origin/main`, clone complet). CONFIRMÉ.
- Rejoué à sa tête dans les conditions du workflow (`fetch-depth: 0` et têtes de PR gelées) : **34 PASS, rc 0**. Tests négatifs présents et passants :
  - `RG-NEG-unexpected-main-only-commit` ;
  - `RG-NEG-main-sha-differs-from-live-pin` ;
  - `RG-NEG-main-promotion-without-authorization` ;
  - `RG-NEG-production-deploy-without-authorization` ;
  - `RG-NEG-business-pr-self-authorizes-via-manifest`.
- **Fail-closed confirmé** : sur `develop`, le vérificateur échoue (« origin/main a bougé (e223e30e) … Promotion develop→main non autorisée »). Conséquence : le check *Release governance* est **rouge sur toute PR tant que #1196 n'est pas intégrée**. Ce n'est pas un défaut des PR de correction. Le gate n'a pas été désactivé.
- Compatibilité avec #1195 : aucun fichier commun, pas de conflit (merge-tree). Aucune autorisation implicite de déploiement.
- **Avis** : conforme ; peut être proposée en READY après diff CTO.

## 6. Artefacts (état au 2026-11-23 07:48Z)

| Artefact | Constat | Statut |
|---|---|---|
| API préprod | `/api/health` renvoie `gitSha=78a7749a` : tête de `fix/nfc-p0-r3-3-prevention`, tree identique à `main` | CONFIRMÉ ; branche source Render **NON VÉRIFIÉ** (API Render en 401) |
| Web préprod | Bundle `index-DnYpqg8G.js` inchangé. #1189 absent (aucune chaîne de #1189 dans les 144 chunks). Aucun SHA embarqué (la LOT 5 de #1195 l'ajoute) | CONFIRMÉ |
| Web et API prod | Hôtes refusés par le proxy de l'environnement | **NON VÉRIFIÉ** |
| AAB prod | `e223e30`, EAS `1f91fca1`, profil `production`, 1.2.1 / **versionCode 27**, SHA256 `e236ddcf…fd89`, keystore EAS `gVVTCcLJMH` ; run #2 : versionCode 26, même SHA | CONFIRMÉ |
| Google Play | Pas d'accès à la Play Console | **NON VÉRIFIÉ** |
| APK installé sur l'appareil de test | — | **NON VÉRIFIÉ**. À relever : `adb shell dumpsys package com.somafrik.app \| grep -E "versionName\|versionCode"` et `sha256sum` de l'APK |

Aucun redéploiement n'a été effectué.

## 7. Smoke Android natif requis (à exécuter, non fait ici)

Comptes : Administrateur scolaire, Secrétaire, Enseignant, Parent, Élève. L'APK doit être identifié par SHA source, versionCode et SHA256.

1. Ouvrir la fiche Élève, carte « Responsables » repliée puis dépliée. Avec Admin et Secrétaire, les quatre champs (« Prénom du parent », « Nom du parent », « Téléphone du parent », « E-mail du parent ») sont visibles. Avec Enseignant, Parent et Élève, le message de refus s'affiche.
2. Liaison avec téléphone seul, puis avec e-mail seul, puis sans contact (refus). Rouvrir la fiche et vérifier que les responsables listés persistent.
3. Lier à un deuxième élève un parent déjà existant (réutilisation du compte).
4. Élève : rafraîchir la session, puis ouvrir Notes, Présences, Paiements, Bulletins, Cours et Emploi du temps.

Le smoke n'est déclaré réussi que si chaque rubrique a été réellement ouverte.

## 8. Risques

| Niv. | Risque |
|---|---|
| P0 | Binaire Android installé ou distribué non identifié ; production Web, API et Play NON VÉRIFIÉ |
| P1 | Intégrer #1195 en bloc sans retirer `594bcb560` réintroduit les libellés courts et le test qui interdit les libellés explicites |
| P1 | Doublon #1141 / LOT 6 non arbitré |
| P1 | Web préprod sans #1189 ; API préprod déployée depuis une branche de PR |
| P2 | Titre « Parents et responsables » et bouton « Créer ou lier un parent » non arbitrés |
| P2 | LOT 7 : écart entre client (`Matières:READ`) et serveur (`Voir classes`) pour des rôles personnalisés |
| P2 | Check *Release governance* rouge sur toutes les PR jusqu'à l'intégration de #1196 |

## 9. Ordre d'intégration proposé (chaque étape après diff GitHub CTO indépendant)

1. #1196, gouvernance (débloque le check).
2. PR PARENT-LABELS, LOT 3 corrigée.
3. Arbitrage #1141 / LOT 6, puis intégration de la PR canonique.
4. #1195 sans `594bcb560` (et sans `f5d034795` si #1141 est retenue). La simulation montre qu'elle passe sans conflit.
5. #1194, carte NFC (aucun chevauchement).
6. Réalignement préprod Web et API depuis `develop`, smoke NFC #1189, puis smoke Android du §7.

`PARITÉ-SAFE-02 — CORRECTIONS PRÊTES POUR DIFF CTO / DRAFT / HOLD / NO MERGE`
