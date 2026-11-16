# GO-PROD-G6-01 — Rapport de préparation G6, Somafrik v25

| Champ | Valeur |
|---|---|
| Mandat | GO-PROD-G6-01, 16/11/2026 (#720, #719, #1145, #1165 ; dérogation CTO #720#issuecomment-6916895891) |
| Candidate | **`738e28730c49fc6dfbee29b0f7357421655e44c5`** (PR #1145, branche `release/go-prod-v25-reconciled`) |
| Candidate précédente | `8124d331e3ef1a39ceea150e3c96e3e65a88ce7c` |
| `develop` | `c2d5938d5cbd74ae523837465129df56e646606b` |
| `main` | `ef8bc9517ffc94aa770743713d0f561f92a9fc1e` |
| Exécutant | Claude Code (conteneur cloud : aucun accès réseau à Render, Supabase, Google Play, `*.somafrik.app`, `exp.host` ; aucun identifiant) |
| **Décision proposée** | **HOLD** : GO conditionnel dès que les 5 conditions du §9 sont levées |

Légende : **PASS** = vérifié directement sur le SHA indiqué. **NOT VERIFIED** = non exécuté ou inaccessible. **WAIVED** = risque accepté par décision CTO. **FAIL** = défaut constaté.

## 1. G0 — Baseline Git (LOT A)

| Contrôle | Résultat | Statut |
|---|---|---|
| #1145 inchangée depuis le dernier contrôle | HEAD était `8124d331` | PASS |
| Commits ajoutés à `develop` depuis | 1 seul : `c2d5938` (#1165), 4 fichiers `docs/release/GO-PROD-G5-01-*.md`, +631 / −0, **aucun fichier produit** | PASS |
| Réconciliation | Commit de merge `738e2873`, parents `8124d331` + `develop@c2d5938`. Aucun conflit. Poussé sans force | PASS |
| Git tree candidate = Git tree `develop` | `79af41be3bb6b3f79658cec83e38d1d97ca4a78c` des deux côtés | PASS |
| `develop...candidate` | ahead 24 / behind 0 | PASS |
| `main...candidate` | ahead 402 / behind 0 (`main` ancêtre) | PASS |
| Diff produit `8124d331 → 738e2873` | 0 fichier hors `docs/release/` | PASS |
| Inventaire `main → candidate` | 1 355 fichiers produit (validé par le CTO sur `8124d331`) + 4 docs G5 = 1 359 | PASS |

## 2. G1 — CI et RC1 (LOT E)

### CI sur le HEAD exact `738e2873`

| Workflow | Run | Statut |
|---|---|---|
| PR Gates | [43870631539](https://github.com/Somafrik-education/Somafrik/actions/runs/43870631539) | En cours au 16/11 12:58 UTC (aucun échec observé) |
| Release gate (Full backend baseline unit + PostgreSQL, Full regression, image Docker préprod, Bootstrap runtime guard) | [43870631683](https://github.com/Somafrik-education/Somafrik/actions/runs/43870631683) | En cours au 16/11 12:58 UTC (Resolve SHA et Backend unit SUCCESS) |
| Autres checks PR (RBAC HTTP live, NFC SQLite, démos, branding, UI French copy, MIG-WORKERS) | voir #1145 | SUCCESS au 16/11 12:58 UTC |

Rappel : le code produit de `738e2873` est identique à celui de `8124d331`, où **33/33 checks étaient SUCCESS** (Release gate [43849660056](https://github.com/Somafrik-education/Somafrik/actions/runs/43849660056), PR Gates [43849659302](https://github.com/Somafrik-education/Somafrik/actions/runs/43849659302)). Le CTO en a relevé 35/35.

### RC1 (#719)

| Famille | Preuve disponible | Statut |
|---|---|---|
| Fonctionnel automatisé (unitaires, PostgreSQL, LOT 0–8, contrats, Quality, Web build, typecheck mobile, domain regression) | CI ci-dessus | PASS (sous réserve CI terminale) |
| Sécurité / RBAC / isolation établissements (automatisée) | Secrets (gitleaks), RBAC HTTP live API, suites `secTenant*`, `secAuth*`, `monoT1.rbacMatrix`, Risk-targeted | PASS (CI) |
| Authentification | `secAuth03/04/05`, `secJwt01`, sessions, révocation (CI) | PASS (CI). **JWT signé en HS256** (`backend/services/tokenService.js`) : dette **P2 acceptée** par le CTO (#719, 20/09) |
| E2E métier UI → API → PostgreSQL sur préprod | Dernière qualification RC1 sur `develop@109fa474` / `080cc8d7` (septembre). La baseline RC1 `afa01321` est à **720 commits** de la candidate. Le CTO a déclaré le 21/09 « l'audit repart de zéro » | **NOT VERIFIED** sur la candidate |
| Performance PostgreSQL préprod (p50/p95/p99) | Aucune mesure sur la candidate | **NOT VERIFIED** |
| Smoke Mobile natif (APK/AAB sur appareil) | `verify:android-release-readiness` : `MANUAL_BLOCKER` AR-PHYSICAL, AR-INSTALL, AR-LOGIN-DEVICE, AR-OFFLINE-DEVICE | **NOT VERIFIED** |

## 3. G2 — Builds candidats

| Build | Preuve | Statut |
|---|---|---|
| Web (`vite build`) | Job Quality / Full regression | PASS (CI) |
| Image backend préprod (`backend/Dockerfile`) | Étape « Build preproduction backend image » de Full regression | PASS sur `8124d331` ; sur `738e2873` voir CI |
| Backend sur PostgreSQL 17 | Validation à blanc (§6) | PASS à vide |
| AAB production local | Voir §5 | **NOT VERIFIED** (non construit) |

## 4. G3 — Smoke préproduction

| Contrôle | Statut |
|---|---|
| Commit déployé sur `api-preprod` / `preprod` | **NOT VERIFIED** : hôtes injoignables depuis le conteneur (`verify:android-release-readiness` : `HOLD AR-API-preprod-live ENOTFOUND`). Moyen sans dashboard : `GET https://api-preprod.somafrik.app/api/health` → champ `gitSha` |
| Smoke Superadmin, Admin Pays, Directeur, Secrétaire, Enseignant, Parent/Élève | **NOT VERIFIED** |
| Présences, finance, notes, bulletins, communication, notifications, NFC/QR existant | **NOT VERIFIED** |

## 5. G4 — Android / Google Play (LOT D)

Méthode : `expo prebuild --platform android --clean --no-install`, profil `production`, exécuté exactement comme dans `Mobile/scripts/build-android-aab.js`, sur une copie de `738e2873`. Lecture du projet natif généré et de `expo config --type public`. **Aucun build Gradle et aucun AAB produits** : SDK Android absent, Java 21 seulement (la CI fixe Java 17), clé d'upload absente.

| Contrôle | Valeur constatée | Statut |
|---|---|---|
| Package | `applicationId 'com.somafrik.app'`, `namespace 'com.somafrik.app'` | PASS (config) |
| versionCode produit par le chemin local | `25` (`android/app/build.gradle`, garde native = canonique dans `build-android-aab.js`) | PASS (config) |
| versionCode vs maximum réel sur les pistes Play | Play Console inaccessible | **NOT VERIFIED** |
| versionName | `1.2.1` | PASS (config) |
| Target / compile / min SDK | `targetSdk 36`, `compileSdk 36`, `minSdk 24`, `buildTools 36.0.0` (défauts React Native 0.81.5, aucune surcharge `expo-build-properties`) | PASS (config) |
| Compatibilité 16 KB | NDK `27.1.12297006` (alignement 16 KB par défaut), `expo.useLegacyPackaging=false`. **Les `.so` tiers précompilés ne peuvent être vérifiés que sur l'AAB** (`zipalign -c -P 16`) | **NOT VERIFIED** |
| Permissions effectives | `CAMERA`, `INTERNET`, `NFC`, `VIBRATE`. **Retirées** (`tools:node="remove"`) : `READ/WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, `RECORD_AUDIO`, `ACCESS_*_LOCATION`, `CALL_PHONE`, `READ_CONTACTS`, `SYSTEM_ALERT_WINDOW`. `android.hardware.nfc` `required="false"` | PASS (manifeste source). Manifeste **fusionné** de l'AAB : NOT VERIFIED (#499) |
| Caméra / QR | Permission `CAMERA`, plugin `expo-camera` sans micro (`recordAudioAndroid: false`) | PASS (config) |
| Réseau | `usesCleartextTraffic="false"`, `allowBackup="false"` | PASS (config) |
| URL API production | `extra.apiUrl = https://api.somafrik.app`, `httpsOnly: true`, `demoMode: false`. Seule URL présente dans la config publique | PASS (config) |
| Secrets embarqués | Config publique : aucune clé de type secret, token, password ou private. Variables `EXPO_PUBLIC_*` utilisées : `API_URL`, `DEMO_MODE`, `DEMO_PIN` (vide en production), `RELEASE_PROFILE`. `verify:android-release-readiness` : `PASS AR-SECRETS` | PASS (config) ; bundle JS final NOT VERIFIED |
| **Signature d'upload** | `signingConfig signingConfigs.debug` / `debug.keystore` pour `release` après prebuild. `build-android-aab.js` n'injecte aucune clé ; `aabEvidence.js` refuserait l'artefact (`androiddebugkey` → `REFUSED`) | **FAIL tant qu'aucune procédure de signature n'est décidée (P1)** |
| SHA-256 de l'AAB | Aucun AAB construit | **NOT VERIFIED** |
| Vérifications du dépôt | `verify:android-release-readiness` : 16 PASS, 2 HOLD (API live injoignable), 5 MANUAL_BLOCKER (appareil, installation). `verify:mobile-security` : SUCCESS. `verify:mobile-release-readiness` : tous les contrôles locaux OK, puis `expo-doctor` échoue faute d'accès à `exp.host` et React Native Directory (environnement, non reproductible comme défaut de code) | PASS / NOT VERIFIED |
| Chemin EAS distant | Non utilisé (décision CTO). **Mais voir le risque R2 au §8** | — |

## 6. G5 — PostgreSQL 17, rollback, AutoDeploy (LOT B, LOT C)

### WAIVED

| Élément | Décision |
|---|---|
| Sauvegarde et restauration des données de production | **WAIVED** : données fictives selon le propriétaire, risque accepté (dérogation CTO du 16/11). Aucune vérification supplémentaire de ce caractère fictif n'a été faite (consigne) |

### PASS (vérifications techniques réellement réussies)

Sources : `docs/release/GO-PROD-G5-01-*.md` (#1165), validation à blanc du 16/11 sur `postgres:17.12`, base vide. Le code produit n'a pas changé depuis (§1).

| Contrôle | Résultat |
|---|---|
| Boot v25 sur PostgreSQL 17 (`NODE_ENV=production`, réseau Docker interne) | `init()` réussi en environ 3,2 s à vide ; `/api/health` → `ok` |
| 17 migrations automatiques | Appliquées au boot ; objets attendus présents ; aucun `DROP TABLE/COLUMN`, aucun changement de type, aucun `NOT NULL` sans défaut sur une table existante. Liste et SHA-256 : `GO-PROD-G5-01-MIGRATIONS.md` §3 |
| Ancienne API `main@ef8bc95` sur schéma migré | Boot OK, `/api/health` → `ok` (à vide) |
| 4 migrations manuelles **exclues** de la procédure | `20261104_report_card_catalog`, `20261105_report_card_class_scope` (exclusion décidée par le CTO), `20261105_report_card_official_assets_privileges`, `20261106_report_card_official_assets`. Aucune n'est exécutée au boot (vérifié dans le code et à blanc : tables absentes) |
| Incompatibilité `20261105_report_card_class_scope` ↔ API `main` | Confirmée à l'exécution, donc exclusion justifiée |
| Stockages requis par le healthcheck | `SOMAFRIK_COMMUNICATION_STORAGE` et `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` obligatoires, hors `/tmp`, sinon `/api/health` répond **503** (constaté à l'exécution) |

### NOT VERIFIED (contrôles techniques encore manquants)

| Contrôle | Raison |
|---|---|
| Durée des index non concurrents sur `students` / `subjects` avec volumétrie réelle | Base vide uniquement. Données fictives : le risque de verrou est faible, mais la volumétrie n'est pas mesurée |
| Montage effectif des deux stockages sur le service API de production | Render inaccessible |
| Configuration Render réelle des deux services | Render inaccessible ; valeurs déclarées par le CTO : `main`, `autoDeploy=yes`, `commit` |
| Neutralisation de l'AutoDeploy | **Non exécutée (STOP mandaté)** : GO CTO requis |
| Désactivation de l'AutoDeploy sans arrêt du service | À constater avant/après (procédure `GO-PROD-G5-01-RENDER-RUNBOOK.md` §3) |

### Préparation Render (LOT C) — prête, en attente de GO

Procédure complète : `docs/release/GO-PROD-G5-01-RENDER-RUNBOOK.md`.
- §2 : relevé avant modification.
- §3 : passage `autoDeploy` à `no` sur `srv-dac22v8jo6nc739b3t9g` (API) et `srv-dac39n8u01pc73flept0` (Web), par dashboard ou `PATCH /v1/services/{id}` `{"autoDeploy":"no"}`, avec preuve avant/après (commit live inchangé, aucun nouveau deploy, health OK).
- §4 : deploy manuel du commit exact, API puis Web.
- §5 : rollback (Render *Rollback* vers `ef8bc951` ; valable car `20261105` est exclue).

**Demande de GO CTO :** autoriser un détenteur de l'accès Render à exécuter le §2 puis le §3 du runbook Render, et publier la preuve avant/après dans #720.

## 7. P0 / P1

| ID | Gravité | Élément | État |
|---|---|---|---|
| R1 | **P0** | `autoDeploy=yes` sur les services prod **et** 17 migrations au boot : un merge dans `main` met en production sans étape humaine | Ouvert. Levée : §6 Render, sur GO |
| R2 | **P1 (nouveau)** | `.github/workflows/eas-production-aab.yml` se déclenche sur `push` vers `main` quand ce fichier change, et **il change dans #1145** (contrôle de permissions `CAMERA,android.permission.NFC`). Le merge lancerait donc un **build EAS production** (`eas build --profile production`, `autoIncrement`, compteur distant), contraire à la décision CTO de ne pas utiliser EAS. Pas de `submit` Play. Aucun autre workflow ne réagit à `main` | Ouvert. Levée proposée : **désactiver ce workflow** dans GitHub (*Actions → EAS Production AAB → Disable workflow*), sans changement de code, avant le merge ; ou PR séparée retirant le déclencheur `push`, sur décision CTO |
| R3 | **P1** | AAB non signé avec la clé d'upload par le chemin local | Ouvert. Décision CTO sur le mode de signature (Gradle hors dépôt ou `jarsigner`) et contrôle de l'empreinte du certificat Play |
| R4 | **P0 (tracker)** | #921 NFC-PHYS-01 ouvert : écriture NDEF → confirmation `active/encoded` non prouvée sur carte physique | Ouvert, sans preuve de clôture. **Atténuation vérifiée** : tous les drapeaux carte (`student_card_enabled`, `_qr_`, `_nfc_`, `_attendance_`, `_finance_check_`, `_offline_roll_call_`) valent **`DEFAULT FALSE`** par établissement (`backend/db/schoolSettingsSchema.js:16-21`). La fonction reste inactive tant qu'un établissement ne l'active pas. **Classification CTO requise** : bloquant ou accepté avec NFC désactivé en production |
| R5 | P0 (tracker) | #499 permissions de stockage | Correctif présent (`tools:node="remove"`, vérifié sur le manifeste source). Manifeste fusionné de l'AAB final : NOT VERIFIED. Clôturable à la construction de l'AAB |
| R6 | P0 (tracker) | #730 DNS préprod non canonique (20/09) | Ancien ; config candidate : `api-preprod.somafrik.app` (`eas.json`, `releaseEnvironments.js`). Statut runtime NOT VERIFIED |
| R7 | P1 | Stockages persistants Render : condition du healthcheck, hors sauvegarde PostgreSQL | Montage en production NOT VERIFIED. Données fictives : la perte de fichiers est couverte par la dérogation, pas leur montage |

Aucune issue ouverte ne porte les labels `P0` ou `P1` (recherche GitHub du 16/11). R4 à R6 portent « P0 » dans leur titre.

## 8. Risques résiduels et dépendances

- **Accès opérateur requis** : Render (R1, R7, G3), Google Play Console (versionCode max, signature), appareil Android physique (smoke natif, #921), préprod HTTP (G3).
- **RC1 non requalifié** sur la candidate pour l'E2E UI → PostgreSQL et la performance.
- **JWT HS256** : P2 accepté.
- **PostgreSQL 16 en CI / 17 en production** : boot validé à vide sur 17.
- **`develop` diverge à nouveau** si ce rapport est fusionné (docs uniquement). Reconcilier ou figer la candidate sur décision CTO.

## 9. G6 — Décision proposée : **HOLD**, GO conditionnel

Le code candidat ne présente **aucun P0/P1 de code reproduit** : CI verte sur le même code produit, PostgreSQL 17 validé à vide, migrations non destructives, manuelles exclues. Les blocages restants sont **opérationnels**. GO G7 proposé dès que les 5 conditions suivantes sont levées et prouvées dans #720 :

1. **CI terminale verte** sur `738e2873`, ou sur le HEAD final si réconcilié.
2. **AutoDeploy `no`** sur les deux services Render, avec preuve avant/après (GO CTO, opérateur Render).
3. **Workflow `EAS Production AAB` désactivé**, ou déclencheur retiré, avant le merge (R2).
4. **Décision CTO sur #921** : NFC désactivé en production (drapeaux par défaut conservés), ou preuve physique.
5. **Décision CTO sur la signature AAB** (R3). La publication Play reste un lot G4/G7 séparé, avec versionCode vérifié dans Play Console.

Le smoke préproduction (G3) et le smoke mobile natif restent NOT VERIFIED. Je recommande de les exécuter juste après le deploy manuel, avant toute communication d'ouverture, faute de pouvoir le faire avant.

`GO-PROD-G6-01 — DRAFT / HOLD — STOP POUR DIFF CTO INDÉPENDANT.`
**PAS READY. PAS MERGE MAIN. PAS DÉPLOIEMENT PRODUCTION. PAS UPLOAD PLAY.**
