# GO-PROD-G6 (01 → 05) — Rapport de préparation G6, Somafrik v25

| Champ | Valeur |
|---|---|
| Mandats | GO-PROD-G6-01 → G6-05, 16/11/2026 (#720, #719, #1145, #1165, #921 ; décisions CTO #720#issuecomment-6916895891 et #720#issuecomment-6917128162) |
| Candidate | **`27e53778efa3c8e4fd5999cf0bf14694142dcbb2`** (PR #1145, `release/go-prod-v25-reconciled`), tree `2f48f9a4892c2d8739eda69bc52aeb315358497e` |
| `develop` | `8faa002b74a4b2b564463859eb21185b2d98dfdd` (après les merges CTO de #1168 puis #1166) |
| `main` | `ef8bc9517ffc94aa770743713d0f561f92a9fc1e` |
| Verrou NFC | PR #1166 **mergée** par le CTO (`develop@8faa002b`, tree identique au HEAD qualifié `f49ff264`) ; **inclus dans la candidate** |
| Exception CI L4-09 | PR #1168 **mergée** par le CTO (`develop@5bdc2560`) ; incluse dans la candidate |
| Exécutant | Claude Code (conteneur cloud : aucun accès réseau à Render, Supabase, Google Play, `*.somafrik.app`, `exp.host` ; aucun identifiant ni clé d'upload) |
| **Décision proposée** | **HOLD**, puis GO conditionnel dès que les conditions du §11 sont levées |

Légende : **PASS** = vérifié sur le SHA indiqué. **NOT VERIFIED** = non exécuté ou inaccessible, jamais compté comme PASS. **WAIVED** = risque accepté par décision CTO. **FAIL** = défaut constaté.

## 1. Synthèse G0–G6

| Phase | Résultat | Résumé |
|---|---|---|
| G0 — Git baseline | **PASS** | Tree candidate `27e53778` = tree `develop@8faa002b`. **Diff indépendant CTO : 0 fichier** entre candidate et `develop`. `main` ancêtre |
| G1 — RC1 | **PASS (CI) / NOT VERIFIED (préprod, perf, appareil)** | CI du HEAD `27e53778` : §3. E2E préprod, performance, mobile physique non exécutés |
| G2 — Builds | **PASS (Web, image backend, boot PG 17) / NOT VERIFIED (AAB)** | §4 |
| G3 — Préproduction | **NOT VERIFIED** | Hôtes préprod injoignables depuis le conteneur |
| G4 — Android / Play | **FAIL (signature) / NOT VERIFIED (Play, 16 KB, SHA-256)** | Config conforme ; signature d'upload absente |
| G5 — PostgreSQL / Render | **WAIVED partiel + PASS technique + Render vérifié CTO (risque ouvert)** | **Sauvegarde des données fictives : WAIVED sur décision du propriétaire.** PG 17 et migrations PASS. Render API et Web : `main`, `autoDeploy=yes` (vérifié CTO) ; neutralisation à exécuter (GO) |
| G6 — GO/NO-GO | **HOLD** | Blocages opérationnels uniquement, aucun P0/P1 de code reproduit (§10, §11) |

## 2. G0 — Baseline Git (G6-04 LOT A)

| Contrôle | Résultat | Statut |
|---|---|---|
| SHAs relevés avant action (16/11, G6-04) | `develop` `8faa002b`, `main` `ef8bc951`, candidate `738e2873`, #1167 `36de4494` : conformes au mandat | PASS |
| Contenu de `develop` intégré | #1168 (`5bdc2560`, `scripts/verify-school-setup-lot4-red.ts` +57) et #1166 (`8faa002b`, `studentCardNfcReleaseGate.js` +40, son test +178, `schoolSettingsManagement.js` +16/−1). Tree de `develop@8faa002b` **identique** au HEAD qualifié de #1166 `f49ff264` | PASS |
| Réconciliation | `27e53778efa3c8e4fd5999cf0bf14694142dcbb2` = merge de `738e2873` + `develop@8faa002b`. Aucun conflit, aucun force-push | PASS |
| Git tree candidate = `develop` | `2f48f9a4892c2d8739eda69bc52aeb315358497e` des deux côtés | PASS |
| Merge-base `develop` / candidate | `8faa002b` ; ahead 25 / behind 0 | PASS |
| Merge-base `main` / candidate | `ef8bc951` ; ahead 405 / behind 0 ; 1 361 fichiers, +197 530 / −7 198 (1 355 validés + 4 docs G5 + 2 fichiers NFC ; script L4-09 et `schoolSettingsManagement.js` déjà dans la liste) | PASS |
| Diff `738e2873 → 27e53778` | 4 fichiers, +291 / −1 : uniquement #1168 et #1166 | PASS |
| Diff indépendant CTO (G6-05) | **0 fichier** entre candidate `27e53778` et `develop@8faa002b` | PASS (CTO) |

## 3. CI du HEAD exact `27e53778` (G6-04 LOT B)

**En cours** au moment de cette révision ; statut terminal publié dans la révision suivante. Aucun échec observé.

Historique : `738e2873` (sans #1166) : **35/35 SUCCESS** (PR Gates [43870631539](https://github.com/Somafrik-education/Somafrik/actions/runs/43870631539), Release gate [43870631683](https://github.com/Somafrik-education/Somafrik/actions/runs/43870631683)). #1166 seule sur `f49ff264` : 19 SUCCESS / 7 ignorés par Scope / 0 échec.

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

### Render — état vérifié directement par le CTO (G6-05)

| Point | Statut |
|---|---|
| API `srv-dac22v8jo6nc739b3t9g` | Branche `main`, **`autoDeploy=yes`** : **vérifié directement par le CTO** |
| Web `srv-dac39n8u01pc73flept0` | Branche `main`, **`autoDeploy=yes`** : **vérifié directement par le CTO** |
| Disque persistant API | **`/var/data`, 1 Go** : vérifié par le CTO. Les chemins `SOMAFRIK_COMMUNICATION_STORAGE` et `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` doivent pointer sous ce disque (hors `/tmp`), sinon `/api/health` répond 503 (constaté à blanc) : à contrôler à l'étape G7-1 |
| Derniers déploiements / commit live | À relever à l'étape G7-1 (dashboard, ou `GET https://api.somafrik.app/api/health` → `gitSha`) |
| `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED` en production | À contrôler à l'étape G7-2 : absente ou différente de `true` |
| Neutralisation de l'AutoDeploy | **Non exécutée** ; procédure prête (`GO-PROD-G5-01-RENDER-RUNBOOK.md` §3) ; **GO CTO requis** |
| Accès de Claude | Aucun (Render injoignable depuis le conteneur) : Claude ne vérifie ni ne modifie Render |

## 7. NFC #921 — confinement pour la release (LOT D)

| Vérification | Constat sur la candidate `27e53778` (verrou #1166 inclus) | Statut |
|---|---|---|
| Flags NFC désactivés par défaut | `student_card_enabled`, `_qr_`, `_nfc_`, `_attendance_`, `_finance_check_`, `_offline_roll_call_` : `BOOLEAN NOT NULL DEFAULT FALSE` (`backend/db/schoolSettingsSchema.js:16-21`) | PASS |
| Backend fail-closed si le NFC est désactivé | `assertNfcEnabled` exige `studentCardEnabled && studentCardNfcEnabled`, sinon 404 `STUDENT_CARD_NFC_DISABLED` (`studentCardsNfcEncoding.js:21-26`), appelé par le cycle de vie (`studentCardsNfcLifecycle.js:49`) et le diagnostic (`studentCardsNfcDiagnosis.js:230`). Seul `true` booléen active (`coerceFailClosedBoolean`) | PASS |
| **Aucun établissement ne peut activer l'encodage** | **Corrigé par #1166** : en `NODE_ENV=production` sans `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true`, le NFC est lu `false` même si la base contient `true`, et l'activation reçoit **409 `STUDENT_CARD_NFC_NOT_HOMOLOGATED`** pour tout rôle, y compris un administrateur d'établissement (RBAC inchangé). Vérifié sur `27e53778` : 14/14 tests du verrou ; contrôle direct en production sans clé → `allowed=false`, `studentCardNfcEnabled=false`, `studentCardQrEnabled=true`, PATCH → 409 | **PASS** |
| Pas de contournement RBAC | L'écriture est gardée par `assertSchoolSettingsWrite` ; les endpoints NFC par le RBAC Élèves (CI : suites `studentCardsNfc*`, `rbacMatrix`) | PASS (CI) |
| Fonctionnalités non NFC utilisables | QR, présences et finance ne dépendent pas du flag NFC (`isStudentCardCapabilityEnabled` par capacité) | PASS (code) |
| APPEL-GLOBAL-01 | Non touché | PASS |

**Verrou #1166, mergé et inclus.** Fichiers : `backend/lib/studentCardNfcReleaseGate.js`, `backend/lib/studentCardNfcReleaseGate.test.js`, câblage dans `backend/lib/schoolSettingsManagement.js`.

Lecture et écriture des flags passent par ce point unique : capacités HTTP, `assertNfcEnabled` (réservation, confirmation, réessai, récupération, diagnostic → 404 `STUDENT_CARD_NFC_DISABLED`), pack et synchronisation d'appel hors connexion, et les deux routes `PATCH …/school-settings`.

QR, présences, finance et autres paramètres sont inchangés. Hors production : inchangé. #921 (NFC physique) n'est pas repris.

Tests sur `27e53778` :
- verrou 14/14 ;
- unitaires carte, NFC, paramètres 163/0 ;
- L4-09 PASS ;
- PostgreSQL (exécuteur officiel, 22 fichiers) 114/0/0 sur `f49ff264`, de tree identique.

Limite : le 409 est prouvé au niveau du parseur commun, pas par un appel HTTP en production (le harnais impose `NODE_ENV=test`).

**Consigne d'exploitation :** `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED` doit rester **absente** (ou différente de `true`) sur le service API de production tant que #921 n'est pas homologuée. Contrôle à faire au relevé Render (§12, étape 1).

## 8. Workflow EAS automatique (LOT C)

| Point | Constat | Statut |
|---|---|---|
| Déclencheurs | `workflow_dispatch` + `push` sur `main` filtré `paths: .github/workflows/eas-production-aab.yml` | PASS (lu) |
| Effet exact d'un merge #1145 | Le fichier diffère entre `main` et la candidate (1 ligne : contrôle de permissions `CAMERA,android.permission.NFC`). Le push du merge sur `main` **déclenche** donc le job `build-aab` : `eas-cli@23.2.0 build --platform android --profile production --non-interactive`, `autoIncrement` avec `appVersionSource: remote` (le compteur EAS s'incrémente et peut produire un versionCode ≠ 25), puis téléchargement de l'AAB en artefact GitHub (30 jours). **Aucun `eas submit` : pas de publication Play.** Requiert le secret `EXPO_TOKEN` (échec immédiat s'il est absent) | Risque **P1** confirmé |
| Autres workflows sur `main` | Aucun (analyse des blocs `on:` des 50+ workflows) | PASS |
| Désactivation temporaire (préparée, **non exécutée : neutralisation encore à réaliser**) | Interface : *Actions → « EAS Production AAB » → … → Disable workflow*. API : `PUT /repos/Somafrik-education/Somafrik/actions/workflows/eas-production-aab.yml/disable`. Contrôle : `GET …/actions/workflows/eas-production-aab.yml` → `"state": "disabled_manually"` | Prête, GO requis |
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
| R1 | **P0** | `autoDeploy=yes` sur API et Web (vérifié CTO) + 17 migrations au boot : un merge dans `main` met en production sans étape humaine | Ouvert. Levée : G7-3 et G7-5, GO CTO |
| R2 | **P1** | Merge #1145 → build EAS production automatique (§8) | Ouvert. Levée : désactivation du workflow, GO CTO |
| R3 | **P1** | AAB signé debug par le chemin local ; clé d'upload absente | Ouvert. Levée : procédure de signature hors dépôt et empreinte comparée à Play Console |
| R4 | ~~P1~~ **levé** | NFC #921 activable par un admin d'établissement | **Levé** : #1166 mergée et incluse dans `27e53778` (§7). Reste la consigne d'exploitation sur `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED` |
| R5 | P0 (tracker) | #921 encodage physique non homologué | **Accepté par le CTO**, NFC désactivé en production par le verrou (R4 levé) |
| R6 | P0 (tracker) | #499 permissions de stockage | Retirées dans le manifeste source ; manifeste fusionné NOT VERIFIED (avec l'AAB) |
| R7 | P1 | Stockages persistants : condition du healthcheck | Disque API `/var/data` 1 Go vérifié CTO ; variables de chemin à contrôler (G7-1) |

Aucune issue ouverte ne porte les labels `P0` ou `P1` (recherche du 16/11). R5 et R6 portent « P0 » dans leur titre. #730 (DNS préprod, 20/09) : la config candidate utilise `api-preprod.somafrik.app`, runtime NOT VERIFIED.

## 11. G6 — Recommandation : **HOLD**, GO conditionnel

Le code candidat `27e53778` ne présente **aucun P0/P1 de code reproduit**. Le confinement NFC est levé (R4). Les blocages restants sont **opérationnels** (R1, R2, R3, R7). GO G7 proposé dès que ces conditions sont levées et prouvées :

1. CI terminale verte sur `27e53778` (§3).
2. **AutoDeploy `no`** sur les deux services Render, avec preuve avant/après, et relevé de l'environnement API (stockages montés, `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED` absente). GO CTO + opérateur Render.
3. **Workflow « EAS Production AAB » désactivé** (`disabled_manually`) avant le merge.
4. Mise en production Web/API possible **indépendamment** de la publication Android. La publication Play (R3 : signature d'upload, versionCode > maximum Play, 16 KB, SHA-256) est un lot G7-Android séparé.

Le smoke préprod et le smoke mobile natif restent NOT VERIFIED (§12, étape 8).

## 12. Checklist d'exécution G7 (G6-05 LOT C)

**Préparée, rien n'est exécuté dans G6-05.** Les étapes 3, 4, 7 et 9 exigent un GO CTO explicite. Claude n'a aucun accès à Render ni aux paramètres GitHub Actions. Ordre impératif : chaque étape suppose la précédente prouvée.

| # | Action | Comment | Preuve à consigner | GO |
|---|---|---|---|---|
| 1 | **Contrôler Render** : derniers deploys et variables du healthcheck | Dashboard API et Web (lecture) ; `GET https://api.somafrik.app/api/health` | Commit live (`gitSha`), statut des 3 derniers deploys, `SOMAFRIK_COMMUNICATION_STORAGE` et `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` sous `/var/data`, health `ok` | Lecture |
| 2 | **Vérifier `SOMAFRIK_STUDENT_CARD_NFC_ALLOWED`** sur l'API prod | Variables d'environnement du service API | Absente, ou différente de `true` | Lecture |
| 3 | **Désactiver AutoDeploy**, API puis Web | *Settings → Build & Deploy → Auto-Deploy : Off*, ou `PATCH /v1/services/{id}` `{"autoDeploy":"no"}` | Avant/après : `autoDeploy=no`, aucun nouveau deploy, commit live inchangé, health `ok` | **Oui** |
| 4 | **Désactiver « EAS Production AAB »** | *Actions → EAS Production AAB → … → Disable workflow*, ou `PUT /repos/Somafrik-education/Somafrik/actions/workflows/eas-production-aab.yml/disable` | `GET …/actions/workflows/eas-production-aab.yml` → `"state": "disabled_manually"` | **Oui** |
| 5 | **Vérifier les deux désactivations** avant tout merge | Relire Render (×2) et l'état du workflow | Les trois états capturés | — |
| 6 | **Diff CTO final** de #1145 | GitHub | HEAD exact `27e53778`, CI terminale verte | CTO |
| 7 | **Merger #1145 dans `main`** | GitHub | SHA du merge sur `main` | **Oui** |
| 8 | **Vérifier l'absence de déclenchement** | Render *Events* (API, Web) ; GitHub *Actions* | Aucun deploy Render, aucun run « EAS Production AAB » après le merge | — |
| 9 | **Déployer manuellement** l'API, puis le Web, au commit exact | *Manual Deploy → Deploy a specific commit*, ou `POST /v1/services/{id}/deploys` `{"commitId":"<SHA main>"}` | Logs de boot jusqu'à la fin de `init()`, `/api/health` → `ok` avec `gitSha` = SHA déployé ; Web servi | **Oui** |
| 10 | **Smokes essentiels**, documentés | Web et API, comptes fictifs | Login par rôle ; présences, notes, bulletins, finance, communication ; capacité NFC `false`, QR OK | — |

**Rollback applicatif** (si un smoke est bloquant) : Render *Rollback* vers `ef8bc951`, API puis Web. Valable car le schéma v25 est additif et `20261105_report_card_class_scope` n'est pas appliquée.

**Hors G7 Web/API :**
- publication Android (lot séparé : signature d'upload, versionCode Play, 16 KB, SHA-256 de l'AAB) ;
- réactivation d'AutoDeploy et d'EAS ;
- les 4 migrations manuelles.

`GO-PROD-G6-05 — DRAFT / HOLD — PAS MERGE MAIN / PAS PROD / PAS PLAY.`
