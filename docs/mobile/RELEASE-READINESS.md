# LOT 7 — Release readiness Expo / EAS / Google Play

PR Draft uniquement. **Aucun upload Google Play. Aucun `eas submit`. Aucun merge Ready.**

## Décision CNG / natif

Inventaire **avant** retrait (LOT 7) :

| Surface | État constaté | Décision |
| ------- | ------------- | -------- |
| `Mobile/app.json` + `app.config.js` | Source Expo (package `com.somafrik.app`, versionCode 13, plugins) | Conservée — source de vérité |
| `Mobile/android/` | Dossier natif commité (applicationId `com.somafrik.app`, versionCode 13, cleartext/backup hérités) | **Retiré du Git après inventaire** |
| `Mobile/ios/` | Absent | Android-first ; iOS non versionné |
| Prebuild | Plugin `withSomafrikAndroidSecurity` + `expo-build-properties` + image-picker | **CNG / prebuild reproductible** |

Stratégie : **Continuous Native Generation**. `android/` et `ios/` sont gitignorés. EAS Build et `npx expo prebuild --platform android` régénèrent le natif à partir de la config + plugins (permissions, backup, network security, cleartext). Plus de mode hybride involontaire : EAS n’ignore plus `app.config.js` à cause d’un `android/` commité.

Package Android **stable** : `com.somafrik.app` (identique préprod / prod). Même listing Play, tracks différents. Préproduction identifiable par le nom affiché `Somafrik Préprod` + badge in-app. Pas de changement de package.

## 4 environnements

| Profil | API | Package | Nom affiché | Distribution | Artefact | Google Play |
| ------ | --- | ------- | ----------- | ------------ | -------- | ----------- |
| development | `EXPO_PUBLIC_API_URL` / LAN (HTTP local autorisé) | `com.somafrik.app` | Somafrik + badge Développement | internal | APK / dev client | Non |
| preview | `https://somafrik-api-preprod.onrender.com` | `com.somafrik.app` | Somafrik QA + badge | internal | APK | Non — voir [PREVIEW-APK.md](./PREVIEW-APK.md) |
| **preproduction** | **`https://somafrik-api-preprod.onrender.com`** (Render, déjà dans `docs/preproduction.md`) | `com.somafrik.app` | Somafrik Préprod + badge | store | **AAB** | **Internal testing** |
| production | `https://api.somafrik.app` | `com.somafrik.app` | Somafrik | store | AAB | Production |

Preview et préproduction partagent l’API Render préprod : **aucune URL QA distincte n’existe dans le dépôt**. La séparation Play vs APK interne reste obligatoire. `preproduction ≠ production`.

Render héberge l’API et le Web. Le Mobile Preview est distribué via Expo/EAS et ne constitue pas un service Render. Parcours APK sideload : [PREVIEW-APK.md](./PREVIEW-APK.md).

`EXPO_PUBLIC_DEMO_PIN` est omis de tous les profils `eas.json` : EAS CLI 22 refuse une valeur d’environnement vide (`""`). Le PIN démo reste interdit en preview / préprod / prod.

Fail-closed : preview / préprod / prod refusent URL absente, HTTP, localhost, `10.0.2.2`, `192.168.*`. Aucun `API_URL \|\| "http://localhost:5000"` sur ces profils. Le profil `preview` doit cibler **exactement** `https://somafrik-api-preprod.onrender.com`.

Variables publiques (URLs seulement, jamais un secret) :

```text
EXPO_PUBLIC_API_URL_DEV
EXPO_PUBLIC_API_URL_PREVIEW
EXPO_PUBLIC_API_URL_PREPRODUCTION
EXPO_PUBLIC_API_URL_PRODUCTION
EXPO_PUBLIC_RELEASE_PROFILE
```

## Versioning

Contrat Play pour **un seul** `applicationId` `com.somafrik.app` (préprod Internal testing + production) :

| Champ | Rôle |
| ----- | ---- |
| `cli.appVersionSource` | **`remote`** — source de vérité EAS pour `android.versionCode` |
| `preproduction.autoIncrement` | `true` — chaque AAB store consomme N+1 |
| `production.autoIncrement` | `true` — même compteur remote Android |
| `version` (user-facing) | `1.2.1` dans `app.json` (piloté localement) |
| `android.versionCode` dans `app.json` | Baseline Git **13** pour prebuild local uniquement. **Ignoré par EAS Build** dès que le remote est initialisé. |

**Interdit :** `appVersionSource: local` + `autoIncrement` sur préprod et prod. Expo ne persiste l’incrément local que si le changement est commité, ce qui est ingérable en CI et peut produire deux AAB avec le même `versionCode` Play.

Séquence attendue (même package, même compteur remote) :

```text
eas build --profile preproduction  → versionCode N
eas build --profile production     → versionCode N+1
```

Pas de `Date.now()` / random. Ne pas réutiliser un versionCode déjà uploadé sur Play.

### Initialisation humaine — ne pas inventer le versionCode Play

Le remote EAS n’est **pas** initialisé par cette PR (aucune valeur Play n’est inventée).

```bash
cd Mobile
eas build:version:set
# Platform : Android
# « What version would you like to initialize it with? »
# → le dernier versionCode RÉELLEMENT présent sur Google Play Console
#    pour com.somafrik.app.
```

- Si un AAB a déjà été uploadé : coller **exactement** ce versionCode Play.
- Si Play n’a encore **aucun** AAB : le constater dans la Console, puis seulement initialiser (souvent à partir de la baseline Git 13). Ne pas inventer un numéro « au cas où ».

Référence Expo : [App version management](https://docs.expo.dev/build-reference/app-versions/).

```bash
eas build:version:sync   # optionnel : recopier le remote vers un prebuild local
```

## Cleartext / network security

- `android.usesCleartextTraffic` **retiré du schéma Expo** (`app.json`).
- Cleartext uniquement via `expo-build-properties` pour `development`.
- Release versionnée : `usesCleartextTraffic=false` + `network_security_config` `cleartextTrafficPermitted=false`.
- Overlay debug : cleartext true (dev client / `assembleDebug` seulement).

## Permissions (avant → après)

| Permission | Avant | Après | Source | Justification | Runtime | Play Store |
| ---------- | ----: | ----: | ------ | ------------- | ------: | ---------- |
| INTERNET | ✅ | ✅ | système | API HTTPS | Non | Standard |
| CAMERA | ✅ | ✅ | `expo-image-picker` | Photo de compte | Oui | Photos |
| READ_MEDIA_IMAGES | ✅ | ✅ | `expo-image-picker` | Galerie photos | Oui | Photos |
| RECORD_AUDIO | ✅ | ❌ | image-picker défaut | Micro non utilisé (`microphonePermission: false`) | — | Retiré |
| SYSTEM_ALERT_WINDOW | ✅ (main) | debug only | overlay RN | Inutile en release | — | Retiré du main |
| READ_EXTERNAL_STORAGE | ✅ | ❌ | legacy | Remplacé par READ_MEDIA_IMAGES | — | Retiré |
| WRITE_EXTERNAL_STORAGE | ✅ | ❌ | legacy | Non utilisé | — | Retiré |
| VIBRATE | ✅ | ✅ | `expo-notifications` | Channel push Android N1 | Oui | Notifications |
| NFC | ❌ | ❌ | — | Hors LOT | — | Non ajouté |
| POST_NOTIFICATIONS | ❌ | ✅ | `expo-notifications` | Push Android N1 | Oui | Notifications |
| ACCESS_FINE/COARSE_LOCATION | ❌ | ❌ | — | Non utilisé | — | Non |
| READ_CONTACTS / CALL_PHONE | ❌ | ❌ | — | Non utilisé | — | Non |

## Backup Android

`android:allowBackup=false` + `fullBackupContent` / `dataExtractionRules` qui excluent files, databases, sharedpref. Les jetons SecureStore ne doivent pas être restaurés sur un autre appareil.

## Stockage local

| Donnée | Stockage | Chiffré | Persisté | Logout | Verdict |
| ------ | -------- | ------- | -------- | ------ | ------- |
| Access token | SecureStore | Keystore/Keychain device-only | Oui | Supprimé | ✅ |
| Refresh token | SecureStore | Idem | Oui | Supprimé | ✅ |
| Mot de passe | aucun | — | Non | — | ✅ |
| PIN | aucun (PIN démo env dev only) | — | Non | — | ✅ |
| Outbox | fichier `somafrik-mutation-outbox.json` | Non (pas de secret) | Oui | `blocked_logout` | ✅ LOT 5 |
| userId / schoolScope | mémoire + champs outbox | Non | Outbox only | Bloqué | ✅ |
| Profil session | SecureStore | Device-only | Oui | Supprimé | ✅ |

## Source maps / OTA

- Bundles de preuve générés **sans** source map (`sourceMap: false`).
- Artefacts `.map` non publiés, non commités.
- `updates.enabled: false`. **EAS Update non activé — décision volontaire.** Pas de `channel` OTA.

## Keystore / credentials

Interdit dans Git : `*.jks`, `*.keystore`, `credentials.json`, mot de passe keystore, upload key.

Signing Play : **EAS Credentials** (étape humaine si le coffre n’existe pas encore) :

```bash
eas credentials -p android
eas build --platform android --profile preproduction
eas build --platform android --profile production
```

Ne pas lancer `eas submit`.

`android/app/build.gradle` release local pointe encore sur le **debug keystore** Expo — normal tant que le keystore Play n’est pas injecté par EAS. Un AAB Play Store réel exige les credentials EAS ; ce n’est pas un secret à inventer dans le dépôt.

## AAB

`eas.json` `android.buildType: app-bundle` **n’est pas une preuve de compilation**. La preuve native est :

1. `npx expo prebuild --platform android --clean --no-install` pour `preproduction` puis `production`
2. Inspection du natif généré (package, nom, cleartext, backup, permissions)
3. Si SDK Android : `./gradlew bundleRelease` et présence d’un `.aab` sous `android/app/build/outputs/bundle/release/`
4. Le `.aab` est **supprimé en fin de job**, jamais commité, jamais uploadé

| Profil | Commande EAS (humaine, après credentials) | Artefact | Upload |
| ------ | ---------------------------------------- | -------- | ------ |
| preproduction | `eas build -p android --profile preproduction` | `.aab` | **NON effectué** — Play Console → Testing → Internal testing |
| production | `eas build -p android --profile production` | `.aab` | **NON effectué** — Play Console → Production |

Job CI isolé : `Mobile AAB preproduction` (`SOMAFRIK_REQUIRE_AAB=1` + Android SDK). Si ce job ne peut pas Gradle, un **EAS Build preproduction réussi** (sans submit) reste requis avant GO CTO.

Local sans SDK : `verify:mobile-release-readiness` inspecte quand même le prebuild ; il ne considère pas `app-bundle` comme GO.

## Google Play — support listing

| Champ | Valeur dans le dépôt | État |
| ----- | -------------------- | ---- |
| Site | `https://somafrik.app` (`docs/preproduction.md`) | Présent (web prod) |
| E-mail support | `support@somafrik.app` (landing web) | Présent comme contact marketing, **pas** une URL Play Console versionnée |
| Privacy policy URL | **Absente** du dépôt (le footer web ancre `#securite`, ce n’est pas une politique hébergée) | **P0 avant soumission Play Store** — ne pas inventer |
| Account deletion URL / in-app | **Absente** (aucun endpoint self-delete audité) | **P0 Store avant publication réelle** |

## Compte EAS

Si `eas build` échoue sans login / sans credentials Android :

1. `eas login` (compte Expo du projet `47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5`)
2. `eas credentials -p android` — créer la keystore d’upload Play
3. Relancer `eas build --platform android --profile preproduction` puis `production`
4. **Ne pas** `eas submit`

## Logs

Les parcours auth / API passent par `safeLogger` (redaction JWT / Authorization). Interdit : logger un token, un mot de passe, un payload personnel complet.

## Gate de publication

| Gate | État | Preuve | Bloquant |
| ---- | ---- | ------ | -------- |
| Expo Doctor | Cible 18/18 | `npx expo-doctor` via `verify:mobile-release-readiness` | Oui |
| Package Android | `com.somafrik.app` stable | `app.json` + `build.gradle` | Oui |
| Preprod API | Render HTTPS | `eas.json` + bundles | Oui |
| Prod API | `https://api.somafrik.app` | `eas.json` + bundles | Oui |
| HTTPS only | preview/préprod/prod | fail-closed + network security | Oui |
| Permissions | CAMERA + READ_MEDIA_IMAGES (+ INTERNET système) | matrice ci-dessus | Oui |
| Preview APK | internal APK → API préprod, jamais prod / localhost | `verify:mobile-preview-apk` + [PREVIEW-APK.md](./PREVIEW-APK.md) | Oui (sideload, pas Play) |
| Bundle préprod | URL préprod, pas prod / localhost | Metro minify | Oui |
| AAB préprod | prebuild inspecté + Gradle `.aab` si SDK / EAS | `verify-native-prebuild` + job CI isolé | Oui (compilation, pas l’upload) |
| Bundle production | URL prod, pas préprod / demo PIN | Metro minify | Oui |
| AAB production | prebuild inspecté ; Gradle si `SOMAFRIK_REQUIRE_AAB` | job isolé / EAS | Oui (compilation) |
| Demo credentials | absents des bundles store | scan bundle | Oui |
| Secrets | absents Git + bundles | gitignore + scan | Oui |
| Privacy policy | **Absente** | mandat | P0 Store, pas cette PR |
| Account deletion | **Absente** | audit API | P0 Store, pas cette PR |
| Play Store Internal upload | **NON effectué** | mandat | Non |
| Play Store Production upload | **NON effectué** | mandat | Non |
