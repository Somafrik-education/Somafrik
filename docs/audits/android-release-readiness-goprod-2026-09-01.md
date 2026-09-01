# Android release readiness GO-PROD — 2026-09-01

Lot unique **F** après merge **#443**. Evidence/test-first. **Aucun Play upload, aucun `eas submit`, aucun EAS build distant, aucun déploiement.**

| | |
|---|---|
| Baseline obligatoire | `develop@e215e0d5e1ada618b4f6bb0c7a481922756948b7` (merge #443) |
| Runtime appareil | **absent** (pas d’`adb`, pas d’APK/AAB GitHub, pas d’émulateur) |
| API préprod live | `https://somafrik-api-preprod.onrender.com/api/health` → HTTP 200 PostgreSQL, **aucun git SHA** |
| API prod live | `https://api.somafrik.app` → **DNS fail** (`ENOTFOUND`) — déjà constaté Lot E |
| SHA hébergé / binaire | **non vérifiable** — aucun artefact Android de ce SHA |
| Décision appareil | **MANUAL BLOCKER** — jamais PASS USB/install/login/nav |

## Gouvernance (constat GitHub avant ouverture)

- 1 PR Cursor Go Production à la fois.
- #443 MERGED (`e215e0d5…`) ; aucune autre PR Go-Prod ouverte.
- PR ouvertes hors chaîne : #295, #297, #298, #312, #337, #354, #355 — non reprises.
- Hors périmètre : Play Console, EAS submit, deploy préprod/prod, `main`, secrets, RC3 #354/#355, JWT global/#404.

## P1 reproduit — gate LOT 7 stale (même PR)

`Mobile/scripts/verify-mobile-release-readiness.js` exigeait encore, dans `ci.yml` / `security.yml` :

- un step nommé `verify:mobile-release-readiness` / `verify:mobile-preview-apk` ;
- un job nommé `Mobile AAB preproduction` + `SOMAFRIK_REQUIRE_AAB` + `android-actions/setup-android`.

Réalité sur `develop@e215e0d5` :

| Attendu LOT 7 | État actuel | Preuve |
|---|---|---|
| Step name nightly | Les scripts sont invoqués dans **Full domain regression**, sans ce `name:` | `.github/workflows/ci.yml` |
| Security nightly release-readiness | **absent** — seulement `verify:mobile-security` | `.github/workflows/security.yml` |
| Job AAB dans `ci.yml` | **déplacé** vers `.github/workflows/mobile-release-build.yml` (`name: Android AAB`, `workflow_dispatch`, `ref: develop`) | grep `SOMAFRIK_REQUIRE_AAB` |
| Workflow AAB sur `main` | **absent** (default branch = `main`) → `gh run list --workflow=mobile-release-build.yml` → HTTP 404 | GitHub Actions |

Correctif minimal (cette PR) : retargeter les asserts LOT 7 vers le nightly réel + `mobile-release-build.yml`. **Aucun assouplissement métier.** Fresh CI après correctif.

Ce P1 ne rend pas le code Expo/EAS faux ; il rendait la gate LOT 7 **rouge/stale** si elle était exécutée.

## MANUAL BLOCKER — actions utilisateur exactes

### 1. Install / launch / login / nav physique

Cette VM Cloud n’a pas `adb`. Aucun artefact `*.apk` / `*.aab` n’existe dans les artifacts GitHub inspectés (seulement JSON de gates, pas de binaire Android).

Sur une machine **déjà** autorisée Expo (`eas login`) et un téléphone USB débogage :

```bash
adb devices   # une ligne « device », pas unauthorized
cd Mobile
eas whoami
eas build --platform android --profile preview   # APK interne, API Render préprod
# attendre finished, télécharger l'APK — ne pas eas submit
adb uninstall com.somafrik.app || true
adb install -r /chemin/Somafrik-QA.apk
adb shell monkey -p com.somafrik.app -c android.intent.category.LAUNCHER 1
```

Login : code établissement + identifiant + PIN d’un **compte smoke fourni par le CTO** (pas de secret dans Git ; démo interdite en preview).

Parcours critiques à prouver sur appareil (jamais claim ici) : Accueil, Classes, Élèves, Présences, Notes, Paiement, Comptes, logout. Contrats Maestro : `Mobile/maestro/01-login-admin-school.yaml` … `10-relaunch-no-catalog.yaml` (scaffold seulement dans cette PR).

**L’agent n’a pas lancé et ne lancera pas `eas build` / `eas submit`.**

### 2. API production (`api.somafrik.app`)

Le profil EAS `production` pointe correctement vers `https://api.somafrik.app`. Le DNS ne résout pas (Lot E + ce lot). Pour lever le blocker **infra** (hors de cette PR) : publier le DNS / déployer l’API prod — **pas un deploy agent**.

### 3. AAB de *ce* SHA

`mobile-release-build.yml` checkout **toujours** `ref: develop` (pas le HEAD de PR) et n’existe pas sur `main`. Compiler un AAB de `e215e0d5…` exige un dispatch humain *après* merge, ou un EAS Build humain. `eas.json` `buildType: app-bundle` **n’est pas une preuve de compilation**.

## Matrice

| ID | Surface | Statut | Preuve |
|----|---------|--------|--------|
| AR-CONFIG | applicationId / scheme / splash / icon | **PASS** | `com.somafrik.app` ; scheme `somafrik` ; pas d’`intentFilters` App Links HTTPS ; PNG icon/splash ≥1024 |
| AR-VERSION | versioning | **PASS** | `app.json` + `releaseEnvironments` = `1.2.1` / versionCode **13** ; `eas.cli.appVersionSource=remote` + `autoIncrement` store. Observation : `Mobile/package.json` encore `1.2.0` (npm, pas Play) |
| AR-API | API environment binding | **PASS** (config) | preview/préprod → Render préprod ; production → `https://api.somafrik.app` ; fail-closed HTTPS ; demo PIN omis |
| AR-API-prod-live | DNS / health prod | **MANUAL BLOCKER** | `ENOTFOUND api.somafrik.app` |
| AR-API-preprod-live | health préprod | **MANUAL BLOCKER** (SHA) | 200 PostgreSQL, pas de commit ; ≠ preuve de ce baseline |
| AR-EAS | Expo/EAS profiles | **PASS** | 4 profils ; preview APK internal ; store AAB ; `updates.enabled: false` ; **pas** de `eas.submit` |
| AR-NATIVE | Expo/RN SDK | **PASS** | expo `~54.0.37`, RN `0.81.5`, React `19.1.0`, worklets, expo-build-properties — contrat `package.json` ; `expo-doctor` reste nightly LOT 7 |
| AR-PERMS | permissions Android | **PASS** | CAMERA + READ_MEDIA_IMAGES ; RECORD_AUDIO / location / NFC bloqués ; `allowBackup=false` |
| AR-AUTH-contract | auth/startup automatisable | **PASS** | `loginScreenSpec` + Maestro scaffold + `verify-mobile-ui-e2e-scaffold` (anti-faux-E2E). **Pas** un login runtime |
| AR-GATE | release build/config gate | **PASS** après P1 | nightly `verify:mobile-release-readiness` + `verify:mobile-preview-apk` ; AAB = `mobile-release-build.yml` ; PR Gates = sécurité mobile **sans** le scan lourd ; Lot F = cette gate légère |
| AR-ARTIFACTS | GitHub Android binaries | **MANUAL BLOCKER** | 0 APK/AAB dans les artifacts listés ; 0 fichier suivi |
| AR-INSTALL | install / launch physique | **MANUAL BLOCKER** | pas d’adb / pas de binaire |
| AR-LOGIN | login physique | **MANUAL BLOCKER** | compte smoke + APK requis |
| AR-NAV | navigation critique physique | **MANUAL BLOCKER** | idem |
| AR-OFFLINE | offline / kill-relaunch | **MANUAL BLOCKER** (physique) | RC2 = contrat code + smoke historique #353 ; pas rejoué sur appareil ici |
| AR-RC3 | SQLCipher outbox / appel physique | **OUT_OF_RELEASE** | #354 / #355 frozen ; parked rollback RC2 |
| AR-PLAY | Play Internal / Production upload | **OUT_OF_RELEASE** | mandat ; privacy policy + account deletion toujours P0 Store (docs LOT 7) |
| AR-IOS | iOS | **OUT_OF_RELEASE** | Android-first ; `ios/` gitignoré |

Verdict config automatisable : **ANDROID_CONFIG_PASS** (après correctif P1 gate).  
Verdict device / binaire / prod DNS : **ANDROID_DEVICE_BLOCKED**.

**0 FAIL métier runtime.** **0 changement runtime métier.**

## Gates existantes — ce qu’elles prouvent sur ce baseline

| Gate | Déclencheur | Prouve | Ne prouve pas |
|------|-------------|--------|----------------|
| `verify:mobile-release-readiness` | Nightly `ci.yml` uniquement | Contrat Expo/EAS, branding, bundles Metro preview/préprod/prod, prebuild inspect, plus AAB Gradle | Un AAB de *ce* SHA ; install téléphone ; Play |
| `verify:mobile-preview-apk` | Nightly | Preview ≠ prod, projectId connu, pas de submit | APK réellement buildé |
| `verify:mobile-native-aab` | `mobile-release-build.yml` dispatch | Prebuild + Gradle AAB **si** lancé, **toujours** `develop` tip | HEAD d’une PR ; dispo Actions sur `main` |
| `verify:mobile-ui-e2e-scaffold` | PR Gates (si `Mobile/*`) + nightly | YAML Maestro + anti-faux-vert | Exécution Maestro |
| `verify:mobile-ui-e2e-runtime` | self-hosted `workflow_dispatch` | Device + APK + secrets runner | ubuntu-latest ; ce cloud agent |
| `verify:mobile-rc2-offline-read-smoke` | PR Gates mobile | Contrat lectures L1 RC2 | Kill-relaunch physique de ce SHA |
| `verify:android-release-readiness` | **cette PR** | Matrice Lot F + négatifs + P1 wiring | Physique / Play / EAS payant |

## Deep links

`scheme: somafrik` (Expo génère l’intent `VIEW` `somafrik://` au prebuild). Aucun `android.intentFilters` / App Links `https://somafrik.app` versionné. Suffisant pour custom scheme ; pas de claim Universal Links.

## Observations (non FAIL)

- `Mobile/package.json` `version` = `1.2.0` vs app `1.2.1`.
- Inventaire Play LOT 7 : « pas de FCM » ; `expo-notifications` est branché et `google-services.json` n’est pas commité (gitignoré). Push store = hors preuve login.
- Privacy policy URL et account deletion : toujours absents (P0 Store, pas ce lot).
- Web hébergé toujours `ENVIRONMENT_COMMIT_UNVERIFIED` (Lot E) — hors Android.

## Gate

`npm run verify:android-release-readiness`

Échoue si le contrat config/EAS/API/permissions/wiring CI est faux, ou si un test négatif (prod=préprod, `eas.submit`) ne casse plus.  
Ne masque pas les MANUAL BLOCKER physiques / DNS prod. Ne déclenche aucun build distant.

CI : checkout `fetch-depth: 0` ; accepte l’ancêtre `e215e0d5…` ou `pull_request.base.sha` identique.
