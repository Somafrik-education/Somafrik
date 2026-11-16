# GO-PROD-G6-01 / G6-02 / G6-03 — Rapport de préparation G6, Somafrik v25

| Champ | Valeur |
|---|---|
| Mandats | GO-PROD-G6-01, G6-02 puis G6-03, 16/11/2026 (#720, #719, #1145, #1165, #921 ; décisions CTO #720#issuecomment-6916895891 et #720#issuecomment-6917128162) |
| Candidate | **`738e28730c49fc6dfbee29b0f7357421655e44c5`** (PR #1145, `release/go-prod-v25-reconciled`) |
| `develop` | `5bdc25606d9008b7a6f63f8cde735f0d18fb05c0` (après merge de #1168 par le CTO ; `c2d5938` au moment de la réconciliation de la candidate) |
| `main` | `ef8bc9517ffc94aa770743713d0f561f92a9fc1e` |
| Correctif NFC hors candidate | PR Draft #1166 **`f49ff264a26134ae90d9e6f5fb54578b58be8c6c`**, en qualification, non mergée (verrou NFC, §7) |
| Exception CI L4-09 | PR #1168 **mergée** par le CTO dans `develop@5bdc2560` |
| Exécutant | Claude Code (conteneur cloud : aucun accès réseau à Render, Supabase, Google Play, `*.somafrik.app`, `exp.host` ; aucun identifiant ni clé d'upload) |
| **Décision proposée** | **HOLD**, puis GO conditionnel dès que les conditions du §11 sont levées |

Légende : **PASS** = vérifié sur le SHA indiqué. **NOT VERIFIED** = non exécuté ou inaccessible, jamais compté comme PASS. **WAIVED** = risque accepté par décision CTO. **FAIL** = défaut constaté.

## 1. Synthèse G0–G6

| Phase | Résultat | Résumé |
|---|---|---|
| G0 — Git baseline | **PASS** | Tree candidate = tree `develop` ; `main` ancêtre ; diff produit nul depuis `8124d331` |
| G1 — RC1 | **PASS (CI 35/35) / NOT VERIFIED (préprod, perf, appareil)** | CI terminale verte sur `738e2873` (§3). E2E préprod, performance, mobile physique non exécutés |
| G2 — Builds | **PASS (Web, image backend, boot PG 17) / NOT VERIFIED (AAB)** | §4 |
| G3 — Préproduction | **NOT VERIFIED** | Hôtes préprod injoignables depuis le conteneur |
| G4 — Android / Play | **FAIL (signature) / NOT VERIFIED (Play, 16 KB, SHA-256)** | Config conforme ; signature d'upload absente |
| G5 — PostgreSQL / Render | **WAIVED partiel + PASS technique + NOT VERIFIED (Render)** | **Sauvegarde des données fictives : WAIVED sur décision du propriétaire.** PG 17 et migrations PASS ; AutoDeploy non neutralisé (GO requis) |
| G6 — GO/NO-GO | **HOLD** | Blocages opérationnels uniquement, aucun P0/P1 de code reproduit (§10, §11) |

## 2. G0 — Baseline Git (LOT A)

| Contrôle | Résultat | Statut |
|---|---|---|
| SHAs relevés à nouveau (16/11, 13:03 UTC) | Candidate `738e2873`, `develop` `c2d5938`, `main` `ef8bc951` : inchangés | PASS |
| Après #1168 (16/11) | `develop` = `5bdc2560` : +1 commit, uniquement `scripts/verify-school-setup-lot4-red.ts` (+57, gate CI). **La candidate n'a plus exactement le tree de `develop`** ; écart sans fichier produit. Réconciliation prévue avec l'intégration de #1166, sur décision CTO | Constat |
| Réconciliation | `738e2873` = merge de `8124d331` + `develop@c2d5938` (#1165, 4 docs). Aucun conflit, aucun force-push | PASS |
| Git tree candidate = `develop` | `79af41be3bb6b3f79658cec83e38d1d97ca4a78c` | PASS |
| `develop...candidate` / `main...candidate` | 24 / 0 ; 402 / 0 | PASS |
| Diff produit `8124d331 → 738e2873` | 0 fichier hors `docs/release/` | PASS |

## 3. CI finale du HEAD exact `738e2873` (LOT A)

**35 checks / 35 SUCCESS / 0 échec / 0 en cours / 0 ignoré**, relevé le 16/11 après 13:36 UTC, tous sur `head_sha = 738e28730c49fc6dfbee29b0f7357421655e44c5`, `run_attempt 1`.

| Workflow | Run | Jobs | Statut |
|---|---|---|---|
| PR Gates | [43870631539](https://github.com/Somafrik-education/Somafrik/actions/runs/43870631539) | Scope, Secrets, Quality, Core tests, Backend unit (fast), **Risk-targeted**, LOT 0–8 parity, Backend PostgreSQL shards 1–3, shards complete, **Required** | SUCCESS (fin 13:11 UTC) |
| Release gate | [43870631683](https://github.com/Somafrik-education/Somafrik/actions/runs/43870631683) | Resolve candidate SHA, Full backend baseline (unit + **PostgreSQL**), **Full regression** (domain regression, build image backend préprod, bootstrap runtime guard), Release gate | SUCCESS (fin 13:36 UTC) |
| Autres | voir #1145 | RBAC HTTP live API, NFC SQLite, Demo contract / entry-api / web-runtime / vitrine, Branding, UI French copy, MIG-WORKERS POC / CLOUD | SUCCESS |

Aucun check n'a été désactivé, relancé ni contourné.

Rappel : le code produit est identique à `8124d331`, où **33/33 checks étaient SUCCESS** (Release gate [43849660056](https://github.com/Somafrik-education/Somafrik/actions/runs/43849660056), PR Gates [43849659302](https://github.com/Somafrik-education/Somafrik/actions/runs/43849659302)).

## 4. G2 — Builds

| Build | Preuve | Statut |
|---|---|---|
| Web (`vite build`) | Job Quality et Full regression | PASS (CI) |
| Image backend préprod (`backend/Dockerfile`) | Étape « Build preproduction backend image » | PASS (CI, §3) |
| Backend sur PostgreSQL 17 | Validation à blanc (§6) | PASS à vide |
| AAB production local | §5 | NOT VERIFIED (non construit) |

## 5. G4 — Android v25 (LOT E)

Méthode : `expo prebuild --platform android --clean --no-install`, profil `production`, avec les variables exactes de `Mobile/scripts/build-android-aab.js`, sur une copie de `738e2873`. Lecture du projet natif généré et de `expo config --type public`. **Aucun build Gradle et aucun AAB produits** : SDK Android absent, Java 21 seulement (la CI fixe Java 17), clé d'upload absente.

| Contrôle | Valeur constatée | Statut |
|---|---|---|
| Package | `applicationId` / `namespace` `com.somafrik.app` | PASS (config) |
| versionCode effectif (chemin local) | `25`, garde native = canonique dans `build-android-aab.js` | PASS (config) |
| versionCode supérieur au maximum Play | Play Console inaccessible | **NOT VERIFIED** |
| versionName | `1.2.1` | PASS (config) |
| Target SDK 36 | `targetSdk 36`, `compileSdk 36`, `minSdk 24`, `buildTools 36.0.0` (défauts React Native 0.81.5) | PASS (config) |
| Permissions minimales | Effectives : `CAMERA`, `INTERNET`, `NFC`, `VIBRATE`. Retirées par `tools:node="remove"` : stockage (`READ/WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`), `RECORD_AUDIO`, localisation, `CALL_PHONE`, `READ_CONTACTS`, `SYSTEM_ALERT_WINDOW`. `android.hardware.nfc` `required="false"` | PASS (manifeste source) ; manifeste **fusionné** de l'AAB NOT VERIFIED (#499) |
| API production | `extra.apiUrl = https://api.somafrik.app`, seule URL de la config publique | PASS (config) |
| HTTPS obligatoire | `httpsOnly: true`, `usesCleartextTraffic="false"` | PASS (config) |
| Absence de secrets embarqués | Config publique sans clé de type secret, token, password ou private ; `EXPO_PUBLIC_*` = `API_URL`, `DEMO_MODE`, `DEMO_PIN` (vide), `RELEASE_PROFILE` ; `PASS AR-SECRETS` | PASS (config) ; bundle JS final NOT VERIFIED |
| **Signature d'upload Play** | Après prebuild, `release` utilise `signingConfigs.debug` / `debug.keystore`. `build-android-aab.js` n'injecte aucune clé ; `aabEvidence.js` refuserait l'artefact (`androiddebugkey` → `REFUSED`) | **FAIL (P1)**. Clé d'upload inaccessible ici |
| Alignement 16 KB | NDK `27.1.12297006` (16 KB par défaut), `useLegacyPackaging=false`. Les `.so` tiers ne se contrôlent que sur l'AAB (`zipalign -c -P 16`) | **NOT VERIFIED** |
| SHA-256 de l'AAB final | Aucun AAB | **NOT VERIFIED** |
| Vérificateurs du dépôt | `verify:android-release-readiness` : 16 PASS, 2 HOLD (API live injoignable), 5 MANUAL_BLOCKER (appareil). `verify:mobile-security` : SUCCESS. `verify:mobile-release-readiness` : contrôles locaux OK, échec d'`expo-doctor` faute d'accès à `exp.host` (environnement) | PASS / NOT VERIFIED |

## 6. G5 — PostgreSQL 17 et Render (LOT B)

### WAIVED

**Sauvegarde des données fictives : WAIVED sur décision du propriétaire.** La restauration l'est aussi. Aucun audit du caractère fictif n'a été fait (consigne). Ce point n'est **pas** un FAIL.

### PASS — vérifications techniques réussies

Sources : `docs/release/GO-PROD-G5-01-*.md` (#1165, mergée), validation à blanc du 16/11 sur `postgres:17.12`, base vide. Le code produit est inchangé depuis.

| Contrôle | Résultat |
|---|---|
| Boot v25 sur PostgreSQL 17 (`NODE_ENV=production`, réseau Docker interne) | `init()` réussi en environ 3,2 s ; `/api/health` → `ok` |
| 17 migrations automatiques | Appliquées au boot, objets attendus présents. **Aucune migration destructrice** : pas de `DROP TABLE/COLUMN`, pas de changement de type, pas de `NOT NULL` sans défaut sur une table existante |
| Rollback applicatif `main@ef8bc95` sur schéma migré | Boot OK, `/api/health` → `ok` (à vide) |
| 4 migrations manuelles exclues du déploiement | `20261104_report_card_catalog`, `20261105_report_card_class_scope` (exclue par décision CTO), `20261105_report_card_official_assets_privileges`, `20261106_report_card_official_assets`. Aucune n'est exécutée au boot (code et validation à blanc) |
| Stockages du healthcheck | `SOMAFRIK_COMMUNICATION_STORAGE` et `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` obligatoires, hors `/tmp`, sinon `/api/health` répond 503 (constaté) |

### Render (LOT B) — état réel NOT VERIFIED, procédure prête, STOP avant modification

| Point | Statut |
|---|---|
| Configuration des services API `srv-dac22v8jo6nc739b3t9g` et Web `srv-dac39n8u01pc73flept0` | NOT VERIFIED par Claude (Render inaccessible). Déclaré CTO : `main`, `autoDeploy=yes`, déclencheur `commit` |
| Commits actuellement déployés | NOT VERIFIED. Lecture possible sans dashboard : `GET https://api.somafrik.app/api/health` → `gitSha` (`RENDER_GIT_COMMIT`, déjà présent sur `main`) |
| Montage des deux stockages sur l'API prod | NOT VERIFIED |
| Désactivation de l'AutoDeploy sans interruption | NOT VERIFIED. À constater avant/après : instance et commit live inchangés, aucun nouveau deploy, health OK |
| Procédures | **Prêtes** : `GO-PROD-G5-01-RENDER-RUNBOOK.md` §2 (relevé), §3 (`autoDeploy` → `no` par dashboard ou `PATCH /v1/services/{id}` `{"autoDeploy":"no"}`), §4 (deploy manuel du SHA exact, API puis Web), §5 (rollback Render vers `ef8bc951`, valable car `20261105` est exclue) |

**Aucune modification Render effectuée. GO CTO requis** pour l'exécution des §2 et §3 par un détenteur de l'accès.

## 7. NFC #921 — confinement pour la release (LOT D)

| Vérification | Constat sur la candidate `738e2873` | Statut |
|---|---|---|
| Flags NFC désactivés par défaut | `student_card_enabled`, `_qr_`, `_nfc_`, `_attendance_`, `_finance_check_`, `_offline_roll_call_` : `BOOLEAN NOT NULL DEFAULT FALSE` (`backend/db/schoolSettingsSchema.js:16-21`) | PASS |
| Backend fail-closed si le NFC est désactivé | `assertNfcEnabled` exige `studentCardEnabled && studentCardNfcEnabled`, sinon 404 `STUDENT_CARD_NFC_DISABLED` (`studentCardsNfcEncoding.js:21-26`), appelé par le cycle de vie (`studentCardsNfcLifecycle.js:49`) et le diagnostic (`studentCardsNfcDiagnosis.js:230`). Seul `true` booléen active (`coerceFailClosedBoolean`) | PASS |
| **Aucun établissement ne peut activer l'encodage** | **FAIL sur la candidate** : tout principal avec `Paramètres Établissement:UPDATE`, `Gérer planning académique` ou `ALL_PRIVILEGES` peut passer `studentCardNfcEnabled` à `true` (`assertSchoolSettingsWrite`). Aucun verrou plateforme | **FAIL → correctif proposé** |
| Pas de contournement RBAC | L'écriture est gardée par `assertSchoolSettingsWrite` ; les endpoints NFC par le RBAC Élèves (CI : suites `studentCardsNfc*`, `rbacMatrix`) | PASS (CI) |
| Fonctionnalités non NFC utilisables | QR, présences et finance ne dépendent pas du flag NFC (`isStudentCardCapabilityEnabled` par capacité) | PASS (code) |
| APPEL-GLOBAL-01 | Non touché | PASS |

**Correctif minimal — PR Draft [#1166](https://github.com/Somafrik-education/Somafrik/pull/1166)**, HEAD `f49ff264a26134ae90d9e6f5fb54578b58be8c6c`, base et merge-base `develop@5bdc2560`, ahead 3 / behind 0, 3 fichiers, +234 / −1 : `studentCardNfcReleaseGate.js` (nouveau), son test (nouveau) et le câblage dans `schoolSettingsManagement.js` (+16/−1). **En qualification, non mergée.**

Le gate L4-09 bloquait la première version. Il a été traité par l'exception ancrée à liste fermée **#1168, mergée par le CTO**, sans neutraliser aucun contrôle.

En `NODE_ENV=production`, sans `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true` :
- lecture : `studentCardNfcEnabled` est forcé à `false`, valeurs déjà en base comprises ;
- écriture : `true` est refusé en 409 `STUDENT_CARD_NFC_NOT_HOMOLOGATED`.

QR et hors production inchangés. Tests locaux sur `f49ff264` :
- verrou 14/14 (déjà actif en base, encodage 404, admin 409, capacités, hors connexion, QR) ; RED sur `develop` : 6 échecs ;
- unitaires carte, NFC, paramètres : 163/0 ;
- PostgreSQL via l'exécuteur officiel (22 fichiers) : 114/0/0 ;
- L4-09 PASS.

Le 409 est prouvé au niveau du parseur commun aux deux routes `PATCH …/school-settings` ; il n'y a pas d'appel HTTP en `NODE_ENV=production` (le harnais impose `test`). CI GitHub du HEAD exact : voir le rapport de livraison G6-03.

**Décision CTO requise :** intégrer #1166 à la candidate (nouveau HEAD, CI complète et diff indépendant), ou accepter le risque d'activation administrative.

## 8. Workflow EAS automatique (LOT C)

| Point | Constat | Statut |
|---|---|---|
| Déclencheurs | `workflow_dispatch` + `push` sur `main` filtré `paths: .github/workflows/eas-production-aab.yml` | PASS (lu) |
| Effet exact d'un merge #1145 | Le fichier diffère entre `main` et la candidate (1 ligne : contrôle de permissions `CAMERA,android.permission.NFC`). Le push du merge sur `main` **déclenche** donc le job `build-aab` : `eas-cli@23.2.0 build --platform android --profile production --non-interactive`, `autoIncrement` avec `appVersionSource: remote` (le compteur EAS s'incrémente et peut produire un versionCode ≠ 25), puis téléchargement de l'AAB en artefact GitHub (30 jours). **Aucun `eas submit` : pas de publication Play.** Requiert le secret `EXPO_TOKEN` (échec immédiat s'il est absent) | Risque **P1** confirmé |
| Autres workflows sur `main` | Aucun (analyse des blocs `on:` des 50+ workflows) | PASS |
| Désactivation temporaire (préparée, **non exécutée**) | Interface : *Actions → « EAS Production AAB » → … → Disable workflow*. API : `PUT /repos/Somafrik-education/Somafrik/actions/workflows/eas-production-aab.yml/disable`. Contrôle : `GET …/actions/workflows/eas-production-aab.yml` → `"state": "disabled_manually"` | Prête, GO requis |
| Réactivation ultérieure | *Enable workflow* ou `PUT …/enable` → `"state": "active"`. La réactivation **ne rejoue pas** les push passés : aucun build rétroactif. Pendant la désactivation, `workflow_dispatch` est aussi bloqué | Prête |
| `eas.json` | Non modifié (consigne) | — |

Ordre recommandé : **désactiver le workflow, vérifier `disabled_manually`, puis merger.**

## 9. Qualification métier minimale (LOT F)

Réutilisation des preuves CI sur le même code produit. Aucun smoke préprod n'est exécutable depuis le conteneur.

| # | Parcours | Statut | Preuve |
|---|---|---|---|
| 1 | Authentification et droits | PASS (CI) | `monoT1.authSessions`, `secAuth03/04/05`, `secJwt01`, `monoT1.rbacMatrix`, `RBAC HTTP live API`. JWT HS256 : P2 accepté |
| 2 | Administration des établissements | PASS (CI) | `schoolSetupStatus`, `schoolSetupFinalize`, `secTenant01/02`, `monoT1.subscriptionAccess` |
| 3 | Classes et élèves | PASS (CI) | `monoT1.students`, `enrollmentTenant`, `classStudents*` |
| 4 | Présences | PASS (CI) | `monoT1.notesPresences`, `presenceTenant`, `attendanceStatusValidation` |
| 5 | Notes et bulletins | PASS (CI) | `monoT1.notesPresences`, `reportCardPublish01`, `reportCardUi01`, `reportCardClassScopeL1–L3` |
| 6 | Finances | PASS (CI) | `monoT1.finance`, `financeLiveRbac`, `financeCollectionLock` |
| 7 | Parent / Élève | PASS (CI) | `parentAttendanceIsolation`, `studentBulletinScope` |
| 8 | Communication | PASS (CI) | `monoT1.communication`, `communicationsC2/C3/C4` |
| 9 | Cohérence Web / API / Mobile | PASS (CI) | LOT 0–8 parity, `financeWebMobileConvergence`, `verify:mobile-*` |
| 10 | Healthchecks préproduction | **NOT VERIFIED** | Hôtes injoignables |
| — | E2E UI → API → PostgreSQL sur préprod, performance p95, smoke appareil | **NOT VERIFIED** | Opérateur requis |

## 10. P0 / P1

| ID | Gravité | Élément | État |
|---|---|---|---|
| R1 | **P0** | `autoDeploy=yes` sur la prod + 17 migrations au boot : un merge dans `main` met en production sans étape humaine | Ouvert. Levée : §6, GO CTO + opérateur Render |
| R2 | **P1** | Merge #1145 → build EAS production automatique (§8) | Ouvert. Levée : désactivation du workflow, GO CTO |
| R3 | **P1** | AAB signé debug par le chemin local ; clé d'upload absente | Ouvert. Levée : procédure de signature hors dépôt et empreinte comparée à Play Console |
| R4 | **P1 (confinement)** | NFC #921 activable par un admin d'établissement sur la candidate | Correctif #1166 (`f49ff264`) en qualification ; #1168 (gate) mergée. Levée : merge de #1166 par le CTO puis réconciliation de #1145 |
| R5 | P0 (tracker) | #921 encodage physique non homologué | Accepté par le CTO **si le NFC reste désactivé** : conditionné à R4 |
| R6 | P0 (tracker) | #499 permissions de stockage | Retirées dans le manifeste source ; manifeste fusionné NOT VERIFIED (avec l'AAB) |
| R7 | P1 | Stockages persistants Render, condition du healthcheck | Montage en prod NOT VERIFIED |

Aucune issue ouverte ne porte les labels `P0` ou `P1` (recherche du 16/11). R5 et R6 portent « P0 » dans leur titre. #730 (DNS préprod, 20/09) : la config candidate utilise `api-preprod.somafrik.app`, runtime NOT VERIFIED.

## 11. G6 — Recommandation : **HOLD**, GO conditionnel

Le code candidat ne présente **aucun P0/P1 de code reproduit**, hors confinement NFC corrigé par #1166. Les blocages restants sont **opérationnels**. GO G7 proposé dès que ces conditions sont levées et prouvées dans #720 :

1. CI terminale verte sur le HEAD final : **acquise sur `738e2873` (35/35)** ; à refaire sur le nouveau HEAD après intégration de #1166.
2. **Décision CTO sur #1166** : intégration (recommandée) ou acceptation du risque d'activation.
3. **AutoDeploy `no`** sur les deux services Render, avec preuve avant/après (GO + opérateur).
4. **Workflow « EAS Production AAB » désactivé** (`disabled_manually`) avant le merge.
5. Pour la publication Play (G4/G7, lot séparé) : clé d'upload, versionCode > maximum Play, contrôle 16 KB, SHA-256 de l'AAB.

Le smoke préprod et le smoke mobile natif restent NOT VERIFIED. Je recommande de les exécuter juste après le deploy manuel, avant toute ouverture aux utilisateurs.

`GO-PROD-G6-03 — #1166 DRAFT / HOLD — STOP POUR DIFF CTO INDÉPENDANT.`
**PAS READY. PAS MERGE MAIN. PAS DÉPLOIEMENT PRODUCTION. PAS UPLOAD PLAY.**
