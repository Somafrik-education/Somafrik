# PARITE-WEB-MOBILE-RECOVERY-01 — Rapport de validation

- **Mandat** : CTO, PR unique Draft / HOLD. Suivi : issue #1192. Audit de référence : #1193.
- **Base** : `develop` @ `70071390cc36e88444012bf23ea8afee16e6fea2`
- **Branche** : `fix/parite-web-mobile-recovery-01`
- **Statut** : DRAFT / HOLD.
  - Aucun merge, aucun déploiement, aucune modification de `main`, aucune publication Play Store.
  - Aucune donnée financière supprimée.
  - #1126 / #1127 (gelés) et #1141 non modifiés.
- **Résultats du smoke Android et registre de l'APK de validation** : ils dépendent du HEAD exact et figurent dans la description de la PR.

---

## 1. Synthèse

| Lot | Priorité | Résultat |
|---|---|---|
| 1, navigation Élève Android | P0 | **Cause racine reproduite sur Android natif et corrigée (backend)** ; frontière d'erreur par écran ajoutée |
| 2, traçabilité APK/AAB | P0 | Provenance embarquée dans chaque binaire, vérificateur de registre, contrôles CI, identification sans ADB |
| 3, formulaires Parent | P1 | Terminologie CTO identique Web et Mobile, e-mail et validation sur Mobile, badge « Principal ». Badges légal / financier **non faits faute de donnée** |
| 4, Finances #1041 | P1 | Dernières surfaces corrigées : exports CSV/Excel, messages d'invariant visibles |
| 5, provenance Web / API | P1 | `build-info.json` et meta SHA, contrôle de cohérence Web / API, garde-fou de branche (opt-in), plan de redéploiement |
| 6, identité Élève | P1 | Une route ne remplace jamais l'identité authentifiée (comparaison indépendante de #1141) |
| 7, requêtes hors droits | P2 | Plus de lecture refusée émise pour Élève / Parent ; états d'erreur d'écran explicites |

---

## 2. LOT 1 — Navigation Élève Android (P0)

### Reproduction (Android natif)
- **Plateforme** : émulateur Android 12 (API 31) x86_64, en émulation logicielle (aucune accélération matérielle disponible dans l'environnement).
- **APK** : `preview`, construit depuis `develop` @ `7007139`, même configuration que la v25 : `https://api-preprod.somafrik.app`, Hermes, R8, release.
  - La table de chaînes UTF-16 est identique au bundle v25 (855/855).
  - L'hôte préprod est résolu vers une API locale réelle (PostgreSQL 16, données de démo) par un DNS et une AC de test, **dans l'émulateur jetable uniquement**.
- **Compte** : Élève `CD-IN-EL-26-001` (Université de Kinshasa).

| Étape | Observation |
|---|---|
| Connexion Élève (mot de passe) | OK : tableau de bord affiché (2/3 présences, notes, annonces) |
| Fiche élève juste après la connexion | OK : identité, inscription, responsables, notes, présences, paiements |
| Application fermée puis rouverte (session restaurée, jeton expiré) | Environ 30 requêtes en 401, puis `POST /api/auth/refresh` 200, puis nouvelles tentatives |
| Fiche élève après restauration | **« Élève introuvable »** : `GET /api/students/<uuid de l'élève>` → **404**, alors que cet identifiant est bien celui de l'élève connecté |
| Logcat (`ReactNativeJS`, `AndroidRuntime`) | Aucune exception JS : l'écran est vide **par absence de données**, pas par plantage |

### Cause racine
Le jeton d'accès émis par `POST /api/auth/refresh` (`issueRefreshedAccessToken`, `backend/server.js`) **ne contenait plus le claim `studentIds`**. Le jeton de connexion le contient : `[uuid, code]`.

Le serveur restreint les données Élève à ce claim. Après le premier rafraîchissement, l'élève sort donc de son propre périmètre.

| Endpoint | Jeton de connexion | Jeton rafraîchi (avant correctif) | Jeton rafraîchi (après correctif) |
|---|---|---|---|
| `GET /students/<son id>` | 200 | **404** | 200 |
| `GET /students` | 1 ligne | **0** | 1 |
| `GET /presences` | 3 | **0** | 3 |
| `GET /payments` | 3 | **0** | 3 |
| `GET /classes` | 1 | **0** | 1 |

Sur un téléphone, le jeton expire dès que l'application est rouverte plus tard. Toutes les rubriques Élève (Notes, Présences, Paiements, Profil, Bulletins…) s'affichent alors **sans contenu**, ce qui correspond aux « écrans blancs » signalés, alors que le tableau de bord, chargé avant ou depuis le cache, reste affiché.

Ce défaut existait avant #1169. Il était masqué parce qu'aucun Élève ne pouvait se connecter sur Mobile avant #1169.

### Correctif
- `backend/lib/refreshStudentScope.js` recalcule `studentIds` au refresh avec **la même résolution que la connexion** :
  - `AuthService.buildManagedMobileUser` → `linkedStudent` → `getPrincipalStudentIds`, sur l'état autoritatif courant ;
  - sans fiche liée, le périmètre reste vide (fail-closed), comme à la connexion.
- `issueRefreshedAccessToken` fusionne ce périmètre dans le jeton. Rien d'autre ne change dans la rotation : session, révocation, abonnement, rôles relus en direct.
- **Autres profils vérifiés** (comparaison jeton de connexion / jeton rafraîchi) :
  - Enseignant : résultats identiques ; `classIds`, `classCodes` et `assignments` étaient déjà conservés.
  - Parent : résultats identiques, grâce à l'hydratation par requête existante.
- **Frontière d'erreur par écran** (pile racine et onglets, `screenLayout`) :
  - une exception de rendu est journalisée (`SCREEN_RENDER_ERROR` avec sa pile) ;
  - elle est affichée avec l'écran concerné, la nature de l'erreur et le build, et les boutons Réessayer / Retour, au lieu d'un écran blanc global ;
  - elle ne masque rien : sans erreur, l'écran est rendu tel quel.

### Tests
- `backend/lib/refreshStudentScope.test.js` (4 tests) : studentIds identiques à la connexion, fail-closed sans liaison, autres rôles inchangés, câblage dans `issueRefreshedAccessToken`.
- Tests backend de refresh et de session existants : 48/48 ; `verify:auth-sessions`, `sec-auth-04`, `sec-auth-05`, `sec-tenant-02`, `jwt-header` OK.
- `Mobile/src/lib/screenErrorBoundary.test.ts` : message borné et sans donnée personnelle, journalisation, câblage pile et onglets.

---

## 3. LOT 2 — Traçabilité APK/AAB (P0)

- **Constat** : tous les builds hors EAS héritaient du versionCode statique 25, alors qu'EAS utilise un compteur distant (24, 27, et des builds 25/26 hors CI). « v25 » désignait plusieurs binaires.
- **Provenance embarquée** : `Mobile/config/buildProvenance.js`.
  - Contenu : `extra.buildProvenance` = commit, branche, profil, canal (`eas`, `github-actions`, `local`) et origine du versionCode.
  - Ordre de résolution : EAS → `SOMAFRIK_GIT_SHA` → git local (arbre compilé) → `GITHUB_SHA`. Le SHA de merge synthétique d'un `pull_request` ne prime jamais.
- **versionCode hors EAS** : inchangé par défaut. Il peut être surchargé par `SOMAFRIK_ANDROID_VERSION_CODE` (entier validé).
- **Sans ADB** : l'écran Support affiche « Version de l'application » : version, versionCode, build (8 caractères) et profil.
- **Vérificateur** : `scripts/verify-android-artifact-provenance.js`.
  - Produit l'entrée commit → versionCode → versionName → profil → SHA-256 → signature → canal.
  - Refuse un binaire sans provenance, issu d'un autre commit, ou signé « Android Debug » sur un canal Play.
  - Essai réel sur l'APK v25 `99cb791` : refusé (`PROVENANCE_ABSENTE`), versionCode, profil, SHA-256 et signature extraits correctement.
- **CI** :
  - `eas-production-aab.yml` : contrôle de l'AAB avec le versionCode distant, entrée de registre archivée ;
  - `nfc-encoding-preprod.yml` : contrôle de l'APK preview ;
  - `android-release-readiness.yml` : tests des vérificateurs.
- **Registre initial** : `docs/release/ANDROID-ARTIFACT-REGISTRY.md`.

---

## 4. LOT 3 — Formulaires Parent (P1)

**Terminologie de référence (CTO)**, partagée par `PARENT_FORM_COPY`. Les fichiers `web/src/lib/parentFormCopy.ts` et `Mobile/src/lib/parentFormCopy.ts` sont identiques, ce que vérifie un test.

| Élément | Avant (Web / Mobile) | Après (Web et Mobile) |
|---|---|---|
| Section | « Parents et tuteurs liés » / « Responsables » | **Parents et responsables** |
| Action | « Lier un parent », « Créer ou lier le parent » / « Lier un responsable » | **Créer ou lier un parent** |
| Champs | Prénom, Nom, Téléphone, E-mail / Prénom du parent, Nom du parent, Téléphone du parent (**pas d'e-mail**) | **Prénom, Nom, Téléphone, E-mail** |
| Validation | Web : téléphone ou e-mail / Mobile : aucune | **Téléphone ou e-mail**, même message |
| Liste | Web : badge « Principal », téléphone et e-mail / Mobile : nom et un contact | **Badge « Principal »**, principal en tête, téléphone et e-mail |
| Inscription élève | « Téléphone parent », « Email parent » / « Téléphone du parent » (pas d'e-mail) | **« Téléphone du parent », « E-mail du parent »** des deux côtés (contexte élève : précision nécessaire) |
| Liste vide | « Aucun parent ou tuteur lié » / « Aucun responsable lié » | **Aucun parent ou responsable lié** |

- En modification, l'e-mail n'est envoyé que s'il a été changé : une ligne de liste sans `parentEmail` n'efface jamais l'e-mail enregistré.
- **Non fait, faute de donnée** : les badges « Responsable légal » et « Responsable financier ».
  - L'API `/parents/relations` n'expose et ne persiste **aucun** attribut légal ou financier par relation (seulement `isPrincipal`).
  - Le `isLegalGuardian: true` de `classStudentsRepository.js` est une constante.
  - Les afficher reviendrait à inventer l'information. Il faut d'abord **décider d'un modèle de données** : schéma, saisie, migration.
- Hors périmètre : consultation et modification fines d'un parent existant, parents liés à plusieurs élèves ; aucun écart nouveau constaté.

---

## 5. LOT 4 — Finances « Imputé / Non imputé » (P1)

- **Décision appliquée** : #1041, affichage uniquement. Statuts persistés, champs API, écritures et règles comptables inchangés.
- **Surfaces encore concernées et corrigées** :
  - **export CSV/Excel des paiements** : il partait des lignes brutes. Il utilise maintenant les mêmes libellés que le tableau (`web/src/lib/financeExportValues.ts`), sans modifier les lignes source ;
  - **messages d'invariant visibles** (HTTP 400) : « Les montants affectés aux frais dépassent le paiement. » et « Paiement incohérent : montant affecté aux frais + montant non affecté ≠ montant total. ». Codes, statuts et règle de conservation inchangés.
- **Déjà conformes, vérifiés** : écrans Web et Mobile, reçus, historique, badges, Web préprod déployé, APK `99cb791`.
- **Observation hors lot (P2)** : l'export des bulletins (EntityPage) a le même écart tableau / export (`reportCardStatusLabel`). Non modifié.

---

## 6. LOT 5 — Cohérence Web / API (P1)

- Le build Web publie `build-info.json` (SHA complet, branche, source) et `<meta name="somafrik-build-sha">`. Vérifié sur `vite build`.
- **Garde-fou de branche** : avec `SOMAFRIK_ALLOWED_DEPLOY_BRANCHES=develop` (préprod) ou `main` (production), un build Render d'une autre branche échoue. Il est **opt-in** pour n'interrompre aucun déploiement sans décision.
- `scripts/verify-web-api-provenance.js --web … --api … [--expect <sha>] [--marker "…"]` compare le SHA Web et le `gitSha` de l'API, puis vérifie les marqueurs de correctifs dans les chunks servis.
  - Essai réel sur la préprod actuelle : `WEB_BUILD_INFO_INDISPONIBLE` (build antérieur) et marqueur #1189 absent, ce qui confirme l'audit #1193.

### Plan de redéploiement préprod (à exécuter après autorisation, hors de cette PR)
1. Merger cette PR après revue indépendante du CTO.
2. Render, Static Site `somafrik-web-preprod` : branche `develop`, variable `SOMAFRIK_ALLOWED_DEPLOY_BRANCHES=develop`, déploiement du HEAD de `develop`.
3. Render, Web Service `somafrik-api-preprod` : remettre la branche suivie sur `develop` (elle exécute aujourd'hui une branche de PR), puis déployer le même HEAD.
4. Contrôle :
   ```bash
   node scripts/verify-web-api-provenance.js --web https://preprod.somafrik.app --api https://api-preprod.somafrik.app --expect <HEAD develop> --marker "Confirmer la révocation de sécurité" --marker "Créer ou lier un parent"
   ```
5. Construire l'APK préprod depuis ce HEAD, le vérifier avec `verify-android-artifact-provenance.js`, l'inscrire au registre, puis faire le smoke Android.

---

## 7. LOT 6 — Identité Élève (P1)

- Pour `student`, `resolveParentSafeStudentId` et `sessionStudentAliasKeys` utilisent **uniquement** `session.user.linkedStudent.studentId`. Une route (deep link, notification) ou une sélection obsolète est ignorée. Sans liaison : `null` (fail-closed).
- **Comparaison avec #1141** : même sémantique, implémentation et tests propres, #1141 non modifiée.
  - Vérification ajoutée : tous les écrans appelants transmettent `user` ; sinon le périmètre Élève serait vide.
- Test existant M7 adapté aux conditions réelles (identité issue de `user.linkedStudent`) ; régression canonique 18/18.

---

## 8. LOT 7 — Requêtes hors droits et états (P2)

- **Constat (reproduction)** : une session Élève émettait des lectures systématiquement refusées : `/teachers`, `/courses`, `/assignments`, `/backoffice/users`, `/backoffice/subscriptions`, `/backoffice/countries`, `/backoffice/establishments/:id`, `/v2/school-setup/guided`.
  - Dans `refreshBackOfficeState`, un seul 403 faisait échouer tout le lot (`Promise.all`), notes et présences comprises.
- **Correctif** : pour `student` et `parent_student` uniquement, une lecture n'est émise que si `canReadEntity` l'autorise. Les autres rôles sont strictement inchangés.
  - Le setup guidé n'est appelé que pour l'administration scolaire.
  - Aucun droit élargi.
- **États** : chargement, vide, erreur réseau et refus existaient déjà par écran (`QueryStateView`, états des responsables). La frontière d'erreur du LOT 1 couvre le cas restant (exception de rendu). Session expirée : rafraîchissement transparent, désormais sans perte de périmètre.

---

## 9. Matrice des écarts traités (audit #1193)

| ID | Écart | Lot | Statut | Preuve |
|---|---|---|---|---|
| APW-001 | Écrans Élève vides/blancs sur Android | 1 | **Corrigé** (cause racine) | §2 ; `refreshStudentScope.test.js` |
| APW-002 | Web préprod sans #1189 | 5 | Outillé ; **redéploiement à autoriser** | §6 ; `verify-web-api-provenance.js` |
| APW-003 | Déploiement depuis une branche de PR, Web sans SHA | 5 | Corrigé (SHA, contrôle, garde-fou opt-in) | §6 |
| APW-004 | versionCode ambigus, binaires non traçables | 2 | Corrigé | §3 ; registre |
| APW-005 | « Imputé » encore visible | 4 | Corrigé (exports) | §5 ; `financeExportValues.test.ts` |
| APW-006 | Message backend avec « imputé » | 4 | Corrigé | `financeDisplayVocabulary.test.js` |
| APW-007 | Pas d'e-mail ni de validation Parent sur Mobile | 3 | Corrigé | `parentFormParity.test.ts` |
| APW-008 | Libellés Parent divergents | 3 | Corrigé (terminologie CTO) | `parentFormParity.test.ts` |
| APW-009 | Badges responsables absents sur Mobile | 3 | « Principal » corrigé ; **légal / financier : donnée inexistante** | §4 |
| APW-010 | Champs parent à l'inscription | 3 | E-mail ajouté sur Mobile ; nom du parent non accepté par l'API d'inscription (passe par « Créer ou lier un parent ») | §4 |
| APW-011 | #1189 absent d'artefacts | 2 / 5 | Outillé (provenance et marqueurs) ; livraison à autoriser | §3, §6 |
| APW-012 | Identité Élève par route | 6 | Corrigé | `studentRouteIdentity.test.ts` |
| APW-013 | Requêtes hors droits Élève | 7 | Corrigé | `roleScopedHydration.test.ts` |

---

## 10. Contrôles exécutés (HEAD de la PR, avant le commit de rapport)

| Contrôle | Résultat |
|---|---|
| TypeScript Mobile (`tsc --noEmit`) | 0 erreur |
| TypeScript Web (`tsc --noEmit`) | 0 erreur |
| Lint Web (`npm run lint`) | 0 erreur ; 94 avertissements, **identiques à `develop`** (aucun nouveau) |
| Build Web (`vite build`) | OK ; `build-info.json` et meta au SHA exact |
| Tests Web (`npm --prefix web test`) | 341 fichiers, **1 946 / 1 946** |
| Backend unit (fast), commande CI | **2 964 tests : 2 961 OK, 0 échec, 3 ignorés** |
| Backend refresh et sessions + `verify:auth-sessions` / `sec-auth-04/05` / `sec-tenant-02` / `jwt-header` | 48/48 ; 5/5 OK |
| Contrats Mobile (`verify-mobile-*` : sécurité, RBAC live, hydratation, data-truth, no-false-writes, CTA RBAC, permissions live, transport scope, résilience réseau, champs, utilisabilité, UX v1) | 12/12 OK |
| `npm run test:parite-recovery-01` | OK |
| `npm run test:artifact-provenance` | OK (11 + 2) |
| Secrets | Aucun secret ajouté ; contrôle CI « Secrets » sur la PR |

## 11. Points restant non vérifiés
- **Appareil Android physique** : la reproduction et le smoke sont faits sur émulateur (x86_64, émulation logicielle). Le smoke sur le téléphone du testeur reste à faire avec l'APK ARM64 de validation.
- **Données de préproduction réelles** : la reproduction utilise l'API locale avec les données de démo, avec la même logique serveur.
- **Production Web / API** : non accessible depuis l'environnement (politique réseau).
- **Canal Play et builds EAS 25/26** : non vérifiés ; à identifier sur les consoles EAS et Play.
- **Frontière d'erreur** : comportement garanti par le mécanisme React standard. Aucune erreur de rendu n'a été provoquée sur l'appareil (aucune n'a été rencontrée).
- **Badges légal / financier** : décision sur le modèle de données requise.

## 12. Revue CTO indépendante de #1195 — compléments

### 12.1 Vérificateur APK/AAB (`scripts/verify-android-artifact-provenance.js`)
- `--expect-sha` complet (40 hex) **obligatoire** : sinon `EXPECT_SHA_MANQUANT`, et la CLI sort en code 2 avant toute inspection.
- Empreinte SHA-256 du certificat **obligatoire** (64 hex) : une signature non extraite donne `SIGNATURE_ABSENTE`, jamais un succès.
- Registre écrit **uniquement après** succès.
- Effet constaté en CI sur d27afa2 : le job « NFC APK preview exact HEAD » a échoué avec `SIGNATURE_ABSENTE`. Les runners sélectionnent build-tools 37, dont `apksigner` imprime `V2 Signer: certificate SHA-256 digest:` au lieu de `Signer #1 certificate SHA-256 digest:`. Le contrôle durci a donc correctement refusé.
  - Correctif aed0c94 : `parseApksignerCerts` gère les deux formats. La règle est la même que dans `Mobile/scripts/verify-student-card-nfc-apk.py` : un seul certificat, sinon échec.
  - Échec reproduit puis corrigé localement avec build-tools 37.0.0. Job vert sur aed0c94.

### 12.2 Gouvernance release
Le pin `CURRENT_MAIN` périmé (rouge aussi sur `develop`) est traité dans **une PR distincte, #1196 (GOV-RELEASE-01)** :
- référence approuvée actualisée à `e223e30e` ;
- interdictions conservées ;
- échec vérifié si `main` se déplace de façon inattendue.

#1196 est entièrement verte. Le contrôle `release-governance` de #1195 restera rouge tant que #1196 n'est pas validée. Le workflow n'a été ni désactivé ni contourné.

### 12.3 Smoke Android rejoué (APK x86_64 du code d27afa2 ; aed0c94 ne modifie que `scripts/`)
Conditions :
- émulateur Android 12 ;
- API locale du même commit ;
- jeton d'accès de 180 s ;
- « refresh » = application fermée, attente de 200 s (> durée de vie du jeton), réouverture.

| Compte | Écrans | Avant refresh | Après refresh |
|---|---|---|---|
| Élève seul (CD-IN-EL-26-002) | Accueil, Fiche, Notes, Présence, Frais ; classe « 6ème A » (fiche, frais, `/classes` 304) ; Bulletins | Données affichées, 0 erreur JS | Identique ; `/auth/refresh` 200, `/students/<id>` 304, listes 304 ; 0 erreur JS |
| Parent (lié via « Créer ou lier un parent ») | Accueil, Enfant, Notes, Présence, Paiements | Données de l'enfant, 0 erreur JS | — |
| Parent sans enfant lié | idem | « Aucun enfant lié » explicite, 0 erreur JS | — |
| Administrateur | Accueil + 4 onglets | OK, 0 erreur JS | — |
| Secrétaire | Accueil + 4 onglets | OK, 0 erreur JS | — |
| Enseignant | Accueil, Classes (5ème B, 6ème A), Appel, Évaluations | OK, 0 erreur JS | — |
| Multirôle Élève + Parent (CD-IN-EL-26-001) | Accueil + 4 onglets | Espace Parent (pas de choix de rôle), états explicites, 0 erreur JS | — |

- L'Élève n'a pas d'écran « Classes » dans son menu : la classe est affichée sur la fiche.
- Bulletins (Élève) : état explicite « Bulletin introuvable » + « Réessayer ». Le 404 vient de l'environnement local : le service de publication des bulletins n'y est pas configuré, et la route répond `REQUEST_NOT_FOUND` avant tout contrôle de périmètre.

### 12.4 Multirôle incluant Élève — `studentIds`
**Jeton (correctif d27afa2).** Le rôle de session vient de `sess.role AS session_role` : `users.role` ne masque plus le rôle choisi à la connexion. Mesures sur l'API :

| Session | Connexion | Refresh |
|---|---|---|
| Élève seul | studentIds = [uuid, matricule] | identiques |
| Multirôle, session Élève | studentIds = [uuid, matricule] | identiques |
| Multirôle, session Parent | studentIds = [] | absent |

Pour la session Parent, la valeur absente n'élargit rien : `hydrateParentPrincipal` réécrit `studentIds` à chaque requête.

**Défaut préexistant, non corrigé ici (décision CTO requise).**
- Constat : un compte Élève + Parent connecté **comme Élève** voit ses données vides **dès la connexion**, sans aucun refresh : fiche 404, listes vides.
- Cause : `principalIsParent` (`backend/lib/parentScope.js`, depuis ea3ae91c1, 2026-09-21) renvoie vrai dès que `roleKeys` contient PARENT. `hydrateParentPrincipal` remplace alors les `studentIds` Élève du jeton par les enfants du parent.
- Facteur aggravant : au refresh, le libellé de rôle du jeton devient `Parent` (REFRESH-R1, préexistant).
- Pourquoi pas dans cette PR : le correctif touche le périmètre Parent, qui est sensible pour la sécurité. Il sort du LOT 1.
- Proposition :
  1. Dans `principalIsParent`, s'appuyer sur le rôle de session plutôt que sur l'ensemble des `roleKeys`.
  2. Conserver au refresh le libellé du rôle de session.
  3. Ajouter un choix de rôle à la connexion mobile multirôle.

---

## Réconciliation PARITÉ-SAFE-02 (2026-11-23, décision CTO)

Cette branche (`fix/parite-recovery-01-reconciled`, **PR #1199**, créée depuis `develop@7007139`) reprend #1195 **sans** deux lots repris dans des PR spécialisées :

| Lot | Commit #1195 | Repris par | Motif |
|---|---|---|---|
| LOT 3, formulaires Parent | `594bcb560` | #1197 (PARITÉ-SAFE-02) | Libellés explicites « … du parent », titre « Responsables » et bouton « Lier un responsable » restaurés ; e-mail et validation conservés |
| LOT 6, identité Élève | `f5d034795` | #1141 (canonique) | Code identique hors commentaires ; `studentRouteIdentity.test.ts` ajouté à #1141 |

Les lots 1, 2, 4, 5 et 7, leurs tests et leurs corrections de revue sont repris à l'identique (cherry-pick `-x`). L'écart avec la tête de #1195 (`22bf5c1e`) est **exactement** le contenu des deux commits retirés.

`test:parite-recovery-01` n'exécute plus `parentFormParity.test.ts` ni `studentRouteIdentity.test.ts`. Ces tests sont désormais exécutés par #1197 (`test:parent-labels-safe-02`) et par #1141 (`verify:user-role-lifecycle`).

HEAD des PR spécialisées au moment de la réconciliation : #1197 `fa4b61ff4`, #1141 `20b534da8`, #1196 `9e523c87e`. Une intégration combinée simulée de #1196, #1197, #1141, #1199, #1194 et #1198 sur `develop` ne produit aucun conflit. Résultats : `verify:release-governance` 34 PASS ; Web 341 fichiers et 1946 tests verts.
