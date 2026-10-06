# GATE-QR-STORES — revue caméra et QR Mobile

**Statut de ce dossier : DRAFT / HOLD. Pas clos. Pas un GO de merge.**

**Conclusion technique : GO PR7**, sous les conditions figées ci-dessous.

PR7 (scanner QR Mobile) reste **interdite** tant que ce gate n’est pas clos par diff GitHub indépendant CTO puis mergé dans `develop`. Ce document ne l’implémente pas. CARTE-PR8 / NFC reste hors scope et reste bloqué par GATE-NFC-STORES.

Baseline opérationnelle actuelle : `develop@e493a0881843cb3c52396a0d478249d36dc0f77b`.

Ce replay s’appuie sur :

- #886, qui a livré CARTE-PR6 ;
- #888 / CI-MOB-01, qui a corrigé `verify:mobile-release-readiness` ;
- GATE-QR-STORES désormais rejoué avec ce garde corrigé.

Le premier dépôt du gate était `develop@37dbfc676869c9d91e583cb05987e1e908894faa` (merge CARTE-PR6 #886). Les décisions techniques ci-dessous sont inchangées.

Nature : **documentaire uniquement**. Aucune dépendance installée. Aucun écran scanner. Aucune permission runtime ajoutée. Aucun fichier `Mobile/`, `backend/`, `web/`, migration, RBAC ou `school_settings` modifié.

## 1. État réel de départ

Relevé sur la baseline, sans changement de produit.

| Élément | État | Preuve |
| --- | --- | --- |
| Expo SDK | `~54.0.37` | `Mobile/package.json` |
| React Native | `0.81.5` | `Mobile/package.json` |
| `expo-camera` | **absent** | `Mobile/package.json` |
| Caméra actuelle | photo de compte via `expo-image-picker` `~17.0.8` | `Mobile/package.json`, `Mobile/app.json` |
| `android.permissions` | `["CAMERA"]` uniquement | `Mobile/app.json` |
| Texte caméra iOS / plugin | `Somafrik utilise l'appareil photo pour prendre la photo du compte.` | `Mobile/app.json` `expo-image-picker.cameraPermission` |
| `RECORD_AUDIO` | bloqué | `Mobile/app.config.js` `blockedPermissions`, `Mobile/plugins/withSomafrikAndroidSecurity.js` |
| `READ_MEDIA_IMAGES` | bloqué / filtré | `app.config.js` et le filtre `permissions` |
| NFC Android | bloqué | `blockedPermissions` contient `android.permission.NFC` |
| Micro image-picker | `microphonePermission: false` | `Mobile/app.json` |
| Inventaire Play | photo de compte seulement | `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` |

La chaîne actuelle ne couvre pas le scan des cartes élève. Elle devient insuffisante dès qu’un scanner est livré.

## 2. Décision librairie

**Retenu : `expo-camera`.**

Version cible SDK 54, retenue et non installée ici :

```text
~17.0.10
```

Commande future PR7, **non exécutée dans ce gate** :

```bash
npx expo install expo-camera
```

`npx expo install` doit résoudre la plage du SDK. Interdit d’installer le dist-tag npm `latest` : au moment de cette revue, `latest` pointe `57.0.6` (SDK 57), incompatible avec l’application Expo 54.

### Pourquoi cette librairie

| Critère | `expo-camera` | `react-native-vision-camera` / scanner natif tiers / QR propriétaire / lib NFC |
| --- | --- | --- |
| Écosystème Expo | Module officiel du SDK | Stack parallèle ou hors sujet |
| CNG / prebuild | Config plugin officiel | Prebuild et permissions à réinventer |
| Android et iOS | Documentés « Android (device only), iOS (device only) » | Variable, souvent un second pipeline caméra |
| QR natif | `CameraView` + `barcodeScannerSettings` + `onBarcodeScanned` | Souvent une seconde dépendance |
| SDK 54 | Plage officielle `~17.0.10` | Non aligné sur `bundledNativeModules.json` de la branche `sdk-54` |
| Seconde stack caméra | Non : même permission `CAMERA` déjà déclarée | Oui, ou NFC hors gate |

Somafrik a déjà `expo-image-picker` pour la photo de compte. Le scan réutilise la même permission technique. Il n’ajoute pas une seconde famille de permission caméra, ni une librairie NFC.

## 3. Licence et maintenance

Sources primaires lues pour cette revue, pas une affirmation générique.

| Champ | Valeur | Source |
| --- | --- | --- |
| Version publiée retenue | `17.0.10` | `packages/expo-camera/package.json` sur la branche Git `sdk-54` ; `npm view expo-camera@17.0.10` |
| Plage SDK 54 | `~17.0.10` | `packages/expo/bundledNativeModules.json` sur `sdk-54` |
| Licence | **MIT** | même `package.json` (`"license": "MIT"`) et le registre npm |
| Auteur / mainteneur | 650 Industries, Inc. ; mainteneurs npm du compte Expo | `package.json` `author` ; `npm view` `maintainers` |
| Dépôt | `https://github.com/expo/expo` répertoire `packages/expo-camera` | `package.json` `repository` |
| Documentation | [Expo Camera SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/camera/) | docs.expo.dev |

MIT est compatible avec Somafrik. Aucune licence incompatible n’est retenue.

## 4. API QR à utiliser en PR7

Documentation SDK 54, page Camera :

- composant `CameraView` ;
- `barcodeScannerSettings={{ barcodeTypes: ["qr"] }}` ;
- `onBarcodeScanned` fournit `BarcodeScanningResult` ;
- le champ utile est `data` (chaîne encodée) et `type`.

Types acceptés par le SDK, à ne **pas** ouvrir : `aztec`, `ean13`, `ean8`, `pdf417`, `upc_e`, `datamatrix`, `code39`, `code93`, `itf14`, `codabar`, `code128`, `upc_a`. Surface PR7 : **`qr` seul**.

`Camera.scanFromURLAsync` lit une image déjà fournie. PR7 ne l’utilise pas : ce serait un chemin galerie / fichier, hors du flux live.

La doc Expo rappelle qu’une seule preview caméra peut être active et qu’il faut démonter le composant quand l’écran n’est plus focalisé. PR7 démonte ou arrête la caméra quand l’écran est quitté, l’app passe en arrière-plan, le scan est terminé, ou la permission est refusée.

## 5. Android — CAMERA, nouvelle finalité

`Mobile/app.json` déclare déjà :

```text
android.permissions = ["CAMERA"]
```

Le plugin `expo-camera` ajoute aussi `android.permission.CAMERA` (`packages/expo-camera/plugin/src/withCamera.ts` sur `sdk-54`). C’est **la même permission technique**, pas une seconde permission à inventer.

PR7 ne crée pas une permission caméra supplémentaire et ne demande pas localisation, galerie large, contacts, téléphone, ni NFC.

Le scanner est néanmoins une **nouvelle finalité** de la caméra. La photo de compte et le scan carte ne sont pas le même traitement de données. La liste technique Play et la fiche Data safety restent deux déclarations distinctes (section 10).

## 6. Android — RECORD_AUDIO interdit

Le plugin officiel, lu sur `sdk-54` :

```ts
recordAudioAndroid = true
```

et :

```ts
recordAudioAndroid && 'android.permission.RECORD_AUDIO'
```

La documentation SDK 54 confirme le défaut : `recordAudioAndroid` default `true`, « determines whether to enable the `RECORD_AUDIO` permission on Android ».

Somafrik n’enregistre pas d’audio pour lire un QR. Décision figée pour PR7 :

```js
recordAudioAndroid: false
```

Après prebuild, `RECORD_AUDIO` **absent** reste un invariant. La blocklist actuelle de `app.config.js` reste en place. Elle ne remplace pas `recordAudioAndroid: false` : le plugin ne doit pas réintroduire la permission pour que la blocklist la retire ensuite. Les guards `verify-native-prebuild` et `verify-mobile-security` continuent d’échouer si `RECORD_AUDIO` est accordée. PR7 ne les affaiblit pas.

## 7. iOS — micro également désactivé

Le même plugin pose par défaut `NSMicrophoneUsageDescription` (`Allow $(PRODUCT_NAME) to access your microphone`) lorsque `microphonePermission` n’est pas fourni.

Le JSON minimal « camera + recordAudioAndroid » **ne suffit pas** : l’omission de `microphonePermission` laisse le défaut iOS. PR7 doit donc aussi poser :

```js
microphonePermission: false
```

C’est le même schéma que `expo-image-picker` aujourd’hui. Sans cette clé, le scanner introduirait un usage micro. Ce serait un NO-GO (section 16).

## 8. NFC inchangé

Ce gate n’autorise pas :

```text
android.permission.NFC
NFCReaderUsageDescription
Core NFC entitlement
react-native-nfc-manager
expo-nfc
```

NFC reste bloqué par **GATE-NFC-STORES**. PR8 ne démarre pas avec PR7.

## 9. Chaîne canonique caméra

Texte actuel, photo de compte seulement :

```text
Somafrik utilise l'appareil photo pour prendre la photo du compte.
```

Texte canonique figé pour PR7, deux finalités, une seule formulation :

```text
Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.
```

Cette chaîne est la valeur de `NSCameraUsageDescription`. Apple exige une explication réelle du motif dans `NSCameraUsageDescription` ([documentation Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)). Le texte limité à la photo de compte ne décrit pas le scan.

## 10. Un seul texte, deux plugins

PR7 aura en même temps `expo-image-picker` et `expo-camera`. Les deux écrivent la permission caméra. Interdit :

```text
image-picker → photo du compte seule
camera → scanner QR seul
```

Le résultat ne doit pas dépendre de l’ordre des plugins. Les deux `cameraPermission` sont **identiques** et égales à la chaîne canonique de la section 9.

Cible future, non appliquée dans ce gate :

```json
[
  "expo-image-picker",
  {
    "photosPermission": "Somafrik utilise vos photos pour ajouter la photo du compte.",
    "cameraPermission": "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.",
    "microphonePermission": false
  }
]
```

```json
[
  "expo-camera",
  {
    "cameraPermission": "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.",
    "microphonePermission": false,
    "recordAudioAndroid": false
  }
]
```

`microphonePermission: false` sur `expo-camera` est obligatoire à cause du défaut du plugin (section 7). `photosPermission` reste la phrase galerie actuelle : le scan n’élargit pas l’accès photos.

PR7 vérifie le **natif généré** (`AndroidManifest.xml`, `Info.plist`), pas seulement `app.json`.

## 11. Permission runtime

La permission caméra du scanner est demandée **quand l’utilisateur ouvre explicitement le scanner QR**.

Interdit : au login, au boot, sur Home, au démarrage de l’écran Présences, en arrière-plan.

Si la caméra est refusée : le scanner QR est indisponible, l’appel manuel reste disponible.

Si l’OS indique que la permission ne peut plus être redemandée : une explication peut mener aux réglages système lorsque l’API Expo le permet. L’appel manuel n’est jamais conditionné à l’autorisation caméra.

## 12. Invariant Présences

```text
Carte / QR désactivé = comportement Présences actuel inchangé
```

Parcours manuels canoniques, inchangés par ce gate et devant le rester en PR7 :

```text
Web PresencesPage
Mobile TeacherAttendanceScreen
POST /api/presences
```

PR7 ne remplace pas `TeacherAttendanceScreen`. Le bouton scanner est additif. Aucune suppression de Présent, Absent, Retard, Justifié, Enregistrer.

Non-régression exigée de PR7, verte avec `student_card_enabled = false` et avec `student_card_enabled = true` :

```text
Mobile/maestro/07-attendance.yaml
Mobile/maestro/12-attendance-mutation.yaml
presenceTenant.http.pg.test.js
parcours Web PresencesPage
```

## 13. Google Play — permissions, Data safety, image

Trois couches distinctes. Les assimiler serait une erreur de déclaration.

| Couche | Ce que c’est | Caméra QR |
| --- | --- | --- |
| Permission technique Android | Entrée du manifeste (`CAMERA`) | Déjà présente pour la photo de compte. Le scan la réutilise. |
| Déclaration Play Console | Liste des permissions du binaire | Doit continuer à montrer `CAMERA` et à ne pas montrer `RECORD_AUDIO`, NFC, médias larges, localisation, contacts. |
| Data safety | Formulaire rempli par l’éditeur sur les données collectées, partagées et leur finalité | **N’est pas déduite** de la seule présence de `CAMERA`. [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) est distinct de la liste des permissions. |

Traitement prévu, et seulement prévu :

```text
flux caméra live
→ détection locale du QR
→ payload QR (capability)
→ POST API Somafrik en HTTPS
```

L’image caméra n’est pas une donnée collectée : pas de photo de scan, pas de frame sauvée, pas d’écriture galerie, pas d’upload d’image, pas de cache applicatif volontaire des frames. Le scanner ne garde que le flux nécessaire à la lecture.

Le capability QR, lui, **quitte l’appareil**. C’est une donnée d’identification de carte envoyée au backend pour résolution. Ce n’est pas une photo.

`docs/mobile/PLAY-STORE-DATA-INVENTORY.md` décrit uniquement le client réellement livré. **Ce gate ne le modifie pas.** PR7 devra y ajouter une ligne, au minimum :

```text
Identifiant carte élève / QR
Source : caméra
Finalité : identifier l’élève lors du scan autorisé
Image caméra : traitement local uniquement
QR capability : transmis au backend HTTPS pour résolution
Stockage local : aucun
Tracking : aucun
```

La case exacte du formulaire Play (type de donnée, collecte, partage) est confirmée au diff PR7, quand le payload réel du `POST` est dans le code. Ni surdéclaration « photo collectée », ni sous-déclaration du capability envoyé.

`READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` et `WRITE_EXTERNAL_STORAGE` restent absents. Le QR ne les justifie pas.

## 14. App Store Privacy

L’accès caméra local ne suffit pas à conclure qu’une donnée est collectée. PR7 réévalue la fiche App Privacy selon ce qui est réellement envoyé :

```text
caméra utilisée localement
QR capability transmise au serveur
identité élève reçue en réponse
```

L’identité renvoyée par l’API scan est une donnée scolaire déjà couverte par le contrat backend. La fiche doit nommer le nouveau chemin (scan), pas inventer une collecte d’image.

## 15. Tracking et secret

PR7 n’introduit aucun tracking. Interdit : ATT, `NSUserTrackingUsageDescription`, analytics du scanner, analytics du payload QR, breadcrumb Sentry contenant le token, publicité, SDK marketing.

Le payload QR est le capability carte, donnée sensible. PR7 interdit :

```text
console.log(scanned.data)
safeLogger(scanned.data)
analytics(scanned.data)
toast du token
clipboard
AsyncStorage
SecureStore
SQLite
outbox
```

Transit autorisé :

```text
CameraView
→ mémoire volatile
→ API scan HTTPS
→ effacement
```

Le Mobile ne parse pas une identité métier dans le QR. Il transmet `scanningResult.data` au contrat backend. Interdit : matricule local, `studentId` ou `schoolCode` lus dans le QR, JSON de PII, URL externe, `Linking.openURL` automatique. Un QR n’est jamais ouvert comme un lien. La doc Expo dit que `data` est « often a URL » : ce n’est pas le cas du capability Somafrik, et ce n’est pas une instruction de navigation.

## 16. Online-only, rafale, finance, rôles

D7 est figé : QR V1 = online-only. Sans réseau : pas de résolution locale, pas d’identité en cache prise pour vérité, pas de finance offline, pas de pointage offline déclenché par le QR. Message d’erreur réseau, appel manuel disponible.

Déduplication : le premier QR accepté suspend le scanner, l’appel API se termine, le réarmement est explicite. Pas de rafale de `POST /api/student-cards/scan`.

Le badge finance éventuel vient du backend déjà livré (PR5). Interdit dans le QR ou le cache scanner : finance offline, montant, dette, solde.

Le gate ne redéfinit pas le RBAC. L’autorité reste le backend PR3–PR5. PR7 n’utilise pas `role === "TEACHER"` ni `role === "SECRETARY"` comme sécurité. Parent et Élève ne font pas de scan staff. Superadmin et Admin Pays restent exclus des données scolaires personnelles, comme le backend le fait déjà.

## 17. Prebuild, guards, release

PR7 exécute un vrai prebuild et lit le manifeste généré :

```bash
npx expo prebuild --platform android --clean --no-install
```

Attendus Android :

```text
CAMERA présente
RECORD_AUDIO absente
NFC absente
READ_MEDIA_IMAGES absente
LOCATION absente
CONTACTS absents
```

iOS CNG, même si la release courante est Android-first :

```text
NSCameraUsageDescription = chaîne canonique duale
pas de NFCReaderUsageDescription
pas de tracking usage description
pas de microphone introduit par le scanner
```

`verify-native-prebuild` et `verify-mobile-security` restent verts. Les contrôles actuels ne sont pas retirés pour faire passer Expo Camera. `verify:mobile-security` continue d’exiger `CAMERA` seule dans `app.json`.

PR7 rejoue `npm run verify:mobile-release-readiness` et `npm run verify:mobile-native-aab`, ou leurs équivalents courants, sur le natif généré.

Ce gate ne construit aucun AAB et ne lance aucun `eas submit`. PR7 prouve que `expo-camera` ne casse pas le prebuild preproduction / production, le package `com.somafrik.app`, HTTPS only, ni les permissions bloquées.

Taille : PR7 mesure AAB ou APK avant et après `expo-camera`, et le delta. Pas de plafond arbitraire sans baseline. Un accroissement anormal est expliqué avant merge.

## 18. Fichiers que PR7 devra toucher

Ce gate ne les modifie pas. Tableau exact du diff futur :

| Fichier | Modification PR7 |
| --- | --- |
| `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` | Ligne « Identifiant carte élève / QR » (section 13). Pas avant que le scan existe. |
| `docs/mobile/RELEASE-READINESS.md` | Noter la finalité scan, `recordAudioAndroid: false`, micro iOS désactivé, prebuild revu. |
| `Mobile/app.json` | Plugin `expo-camera` et chaîne caméra canonique identique sur `expo-image-picker`. |
| `Mobile/package.json` | Dépendance `expo-camera` via `npx expo install`. |
| `Mobile/package-lock.json` | Lock de cette dépendance. |
| `Mobile/scripts/verify-native-prebuild.js` | Conserver CAMERA oui, RECORD_AUDIO non, NFC non, READ_MEDIA_IMAGES non. Adapter seulement si le plugin change la forme du manifeste, sans retirer les interdits. |
| iOS / Android générés | Preuves de prebuild, non commises comme arborescence native permanente si le projet reste en CNG. |

## 19. Conditions et verdict

### GO PR7

Tous les points suivants sont documentés ici :

```text
lib scanner choisie : expo-camera
compatibilité Expo 54 confirmée : ~17.0.10
licence vérifiée : MIT
CAMERA seule permission nécessaire
RECORD_AUDIO explicitement interdit
microphone iOS explicitement interdit
NFC toujours bloqué
NSCameraUsageDescription duale définie
permission runtime au moment du scan
refus caméra non bloquant pour l’appel manuel
Data safety diff PR7 défini
App Privacy réévaluation définie
aucune frame stockée
QR token jamais loggé ni persisté
scan online-only
prebuild Android requis
prebuild iOS requis
tests présence non-régression définis
AAB / release readiness définis
```

### NO-GO si PR7 exigeait

```text
RECORD_AUDIO
READ_MEDIA_IMAGES
LOCATION
NFC
tracking
nouveau stockage média
upload d’image caméra
SDK tiers opaque
parsing PII depuis le QR
scan offline fondé sur un cache local
suppression de l’appel manuel
```

`expo-camera` configuré comme en section 10 n’exige aucun de ces points. Le défaut non configuré du plugin (`recordAudioAndroid: true` et micro iOS) serait un NO-GO : PR7 n’a pas le droit de livrer ce défaut.

**Verdict : GO PR7.**

Ce GO est une décision de revue. Il n’ouvre pas PR7. Il ne marque pas ce gate clos. La clôture est le merge après diff CTO indépendant.

## 20. Sources primaires

- [Expo Camera, SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/camera/) — installation, `CameraView`, `barcodeScannerSettings`, `onBarcodeScanned`, défaut `recordAudioAndroid: true`.
- [Expo config plugins](https://docs.expo.dev/config-plugins/introduction/) — CNG / prebuild.
- Branche Git `sdk-54` : `packages/expo/bundledNativeModules.json` (`expo-camera` `~17.0.10`) et `packages/expo-camera/package.json` (version `17.0.10`, licence MIT) ainsi que `packages/expo-camera/plugin/src/withCamera.ts`.
- Registre npm `expo-camera@17.0.10` (licence MIT, dépôt Expo).
- [Apple NSCameraUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription).
- [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) — déclaration éditeur, distincte de la liste technique des permissions ([aide permissions](https://support.google.com/googleplay/answer/11416267)).
- Repo Somafrik à `37dbfc676869c9d91e583cb05987e1e908894faa` : `Mobile/package.json`, `Mobile/app.json`, `Mobile/app.config.js`, `Mobile/plugins/withSomafrikAndroidSecurity.js`, `docs/mobile/PLAY-STORE-DATA-INVENTORY.md`.
