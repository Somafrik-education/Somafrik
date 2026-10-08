# GATE-NFC-STORES — revue NFC Android / iOS avant CARTE-PR8

**Statut de ce dossier : OPEN / DRAFT.** Revue documentaire uniquement.

**Conclusion technique : GO CARTE-PR8**, sous les conditions figées ci-dessous.

**CARTE-PR8 ne doit pas être ouverte tant que ce gate n’est pas mergé.** Aucune dépendance NFC n’est installée ici. Aucune permission n’est débloquée ici.

Baseline obligatoire : `develop@ed16f3b3bf5be8de4a001ea9e29dd9029b80ff0c` (merge **#889** / CARTE-PR7).

Nature du gate : **documentation / audit**. L’implémentation native (permission, plugin, scan) appartient à **CARTE-PR8**, lot distinct, à ouvrir seulement après merge de ce dossier et ordre CTO.

## 1. État réel de départ

Relevé sur la baseline, sans changement de produit.

| Élément | État | Preuve |
| --- | --- | --- |
| Expo SDK | `~54.0.37` | `Mobile/package.json` |
| React Native | `0.81.5` | `Mobile/package.json` |
| React | `19.1.0` | `Mobile/package.json` |
| `react-native-reanimated` | `~4.1.1` (New Architecture) | `Mobile/package.json` |
| `expo-camera` | `~17.0.10` (QR de secours, PR7 mergé) | `Mobile/package.json` |
| `react-native-nfc-manager` | **absent** | `Mobile/package.json` |
| `expo-nfc` | **absent** | `Mobile/package.json` |
| Android `NFC` | **bloquée** | `Mobile/app.config.js` `blockedPermissions`, `Mobile/plugins/withSomafrikAndroidSecurity.js` |
| Asserts natifs | échec si NFC apparaît | `Mobile/scripts/verify-native-prebuild.js` (`NFC présent`), `verify-mobile-security.js` |
| iOS `NFCReaderUsageDescription` | **absent** | `verify-native-prebuild.js`, `verify-mobile-security.js` |
| Entitlement Core NFC | **absent** | pas de `.entitlements` NFC versionné (CNG, `ios/` gitignoré) |
| Code NFC produit | **aucun** | `verify-student-card-qr.js` refuse `react-native-nfc-manager` / `expo-nfc` / `NDEFReader` |
| QR | canal de secours **déjà livré** | CARTE-PR7 #889 |
| Inventaire Play | « pas de NFC dans ce lot » | `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` |

C’est exactement le point de départ prévu par AUDIT-CARTE-01 §12.2.

## 2. Décision librairie

**Retenu : `react-native-nfc-manager`.**

Ce n’est **pas** un module officiel du SDK Expo. Le SDK 54 n’expose aucun package NFC (`docs.expo.dev/versions/v54.0.0` : pas de `expo-nfc` dans le catalogue). `expo-nfc` sur npm est un stub `0.0.0` (2021–2022, 0 dépendance, pas de README) — **rejeté**.

Version cible, **non installée ici** :

```text
New Architecture (cas Somafrik) : 4.0.0-beta.10
Old Architecture seulement     : 3.17.5
```

Somafrik est sur **New Architecture** : Expo 54 l’active par défaut ; `react-native-reanimated@~4.1.1` l’exige ; `app.json` ne pose pas `newArchEnabled: false`.

`v3.x` ne supporte que l’ancienne architecture. L’installer sur ce dépôt serait un NO-GO de build. `v4` est encore **beta** (série `4.0.0-beta.x`, dernière lue : `4.0.0-beta.10` du 2026-10-03). C’est le seul chemin NDEF maintenu pour RN 0.81 + New Architecture + plugin Expo.

Commande future PR8, **non exécutée dans ce gate** :

```bash
npm --prefix Mobile install react-native-nfc-manager@4.0.0-beta.10
```

Ne pas installer le dist-tag `latest` : au moment de cette revue, `latest` pointe la ligne **v3** (`3.17.5`), old-arch only.

### Comparaison

| Critère | `react-native-nfc-manager` | `expo-nfc` (npm) | module Expo officiel | Vision / scanner caméra / HCE |
| --- | --- | --- | --- | --- |
| Lecture NDEF NTAG21x | Oui (Ndef + NfcA / MifareUltralight) | Stub vide | Inexistant au SDK 54 | Hors sujet |
| Android + iOS | Documenté | Non | — | — |
| Config plugin Expo / CNG | Oui (`plugins: ["react-native-nfc-manager"]`) | Non | — | — |
| Expo Go | **Non** — native module | Non | — | — |
| Development build / APK | **Obligatoire** | — | — | Déjà le modèle Somafrik |
| Licence | MIT | n/a | — | — |
| Maintenance 2026 | Active (v3.17.5 + v4 beta, RN 0.81) | Morte depuis 2022 | — | — |
| New Architecture | **v4 beta uniquement** | — | — | — |

Aucune autre librairie NDEF React Native n’est maintenue au même niveau pour Expo CNG. Un module natif maison est hors minimum V1.

## 3. Licence et maintenance

Sources primaires, pas une affirmation générique.

| Champ | Valeur | Source |
| --- | --- | --- |
| Paquet | `react-native-nfc-manager` | [npm](https://www.npmjs.com/package/react-native-nfc-manager) |
| Licence | **MIT** | registre npm, `package.json` upstream |
| Dépôt | `https://github.com/revtel/react-native-nfc-manager` | homepage npm |
| v3 latest | `3.17.5` (2026-10-03) — **legacy architecture** | GitHub Releases |
| v4 lue | `4.0.0-beta.10` (2026-10-03) — **New Architecture** | GitHub Releases |
| Plugin Expo | wiki [Expo Go](https://github.com/revtel/react-native-nfc-manager/wiki/Expo-Go) — « cannot be used in Expo Go » | wiki officiel |
| Peer `@expo/config-plugins` | `*` depuis `3.17.1` (PR #796) | compatible SDK 54 |

MIT est compatible avec Somafrik.

**Risque figé :** v4 reste beta. PR8 doit prouver prebuild Android + iOS et un smoke lecture NTAG **avant** Ready. Si la beta casse le prebuild Somafrik, le fallback produit reste le QR déjà livré ; on ne force pas v3 sur New Architecture.

## 4. API NFC à utiliser en PR8

Usage conceptuel (documentation upstream) :

1. `NfcManager.start()` une fois le scanner NFC ouvert (pas au boot, pas au login).
2. `NfcManager.isSupported()` / `isEnabled()` — hardware et réglage système.
3. `NfcManager.requestTechnology(NfcTech.Ndef)` au moment du scan.
4. `NfcManager.getTag()` / `ndefHandler.getNdefMessage()` — extraire **uniquement** le capability.
5. `NfcManager.cancelTechnologyRequest()` à la fermeture, arrière-plan, erreur, ou succès.

Surface V1 : **NDEF seulement**. Ne pas ouvrir IsoDep, FeliCa, ISO7816 AID, HCE, paiement.

Le `cardToken` lu est le **même** que le QR (`publicId.secret`). Même `POST /api/student-cards/scan`. Même carte logique D8 (`nfc_qr`).

## 5. Android — ce que PR8 devra faire

### 5.1 Permission unique à débloquer

Retirer **uniquement** `android.permission.NFC` de :

- `Mobile/app.config.js` `blockedPermissions`
- `Mobile/plugins/withSomafrikAndroidSecurity.js` `BLOCKED_PERMISSIONS`

Le plugin `react-native-nfc-manager` déclare `android.permission.NFC`. Sans ce retrait, `tools:node="remove"` continue de l’effacer au merge Gradle.

**Conserver bloqués, sans modification dans ce gate ni comme élargissement PR8 :**

```text
android.permission.RECORD_AUDIO
android.permission.SYSTEM_ALERT_WINDOW
android.permission.WRITE_EXTERNAL_STORAGE
android.permission.READ_EXTERNAL_STORAGE
android.permission.READ_MEDIA_IMAGES
android.permission.ACCESS_FINE_LOCATION
android.permission.ACCESS_COARSE_LOCATION
android.permission.READ_CONTACTS
android.permission.CALL_PHONE
```

`NFC` Android est une permission **normale** (install-time), pas dangereuse : pas de dialogue runtime. « Session au moment du scan » = démarrer / arrêter `NfcManager`, pas une permission Play runtime.

### 5.2 Feature hardware optionnelle

**Recommandé, obligatoire en PR8 :**

```xml
<uses-feature android:name="android.hardware.nfc" android:required="false" />
```

Sans `required="false"`, Play peut **exclure** les appareils sans NFC. Le QR de secours doit rester utilisable sur ces téléphones. Le plugin ne le pose pas toujours : PR8 doit le garantir (plugin props ou `expo-build-properties` / config plugin Somafrik), puis `verify-native-prebuild` doit l’exiger.

### 5.3 Asserts natifs à inverser en PR8 seulement

Aujourd’hui `verify-native-prebuild.js` échoue si `android.permission.NFC` est accordée. PR8 inverse **cet** assert (NFC attendu, `tools:node=remove` interdit pour NFC) et **conserve** les asserts des autres permissions bloquées. Ce gate ne touche pas ces scripts.

### 5.4 Comportements appareil

| Situation | Comportement V1 |
| --- | --- |
| Pas de puce NFC | `isSupported() === false` → NFC indisponible, **QR proposé**, appel manuel intact |
| NFC off dans les réglages | `isEnabled() === false` → message pour activer NFC **ou** bascule QR ; pas de crash |
| NFC on, pas de tag | timeout / cancel → réessai ou QR |
| Tag illisible / non NDEF | erreur locale, pas d’appel backend, QR possible |
| Tag NDEF Somafrik | même flux que QR (`runStudentCardScanFlow`) |

## 6. iOS

| Point | Décision |
| --- | --- |
| Entitlement | `com.apple.developer.nfc.readersession.formats` = `NDEF` (capability Xcode *Near Field Communication Tag Reading*). Le config plugin pose `includeNdefEntitlement` (défaut true). |
| Usage description | `NFCReaderUsageDescription` / `nfcPermission` du plugin. Chaîne figée ci-dessous. |
| Formats V1 | **NDEF uniquement**. Pas d’AID ISO7816, pas de FeliCa `systemCodes`. |
| iPhone sans Core NFC (iPad, anciens iPhone) | `isSupported() === false` → QR |
| Session | `NFCTagReaderSession` / requestTechnology **uniquement** à l’ouverture du scan |
| Fallback | QR obligatoire, identique Android |

Chaîne iOS figée pour PR8 :

```text
Somafrik utilise la puce NFC pour lire la carte élève de l’établissement.
```

Apple exige une explication réelle ([NFCReaderUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nfcreaderusagedescription)). Ne pas réutiliser la chaîne caméra. Ne pas mentionner paiement, tracking, ni contacts.

`includeNdefEntitlement: false` n’est un recours que si la validation App Store signale un entitlement NDEF invalide. Défaut PR8 : **true**.

## 7. Expo Go / CNG / builds

| Canal | NFC |
| --- | --- |
| Expo Go | **Non supporté** (module natif) |
| Development build / `expo run:android` / APK Preview | **Requis** pour tester |
| EAS prebuild CNG | Plugin dans `app.json` + prebuild Android **et** iOS |
| AAB preprod / prod existants | Rebuild après PR8 ; même `com.somafrik.app` |

Somafrik est déjà hors Expo Go (SQLCipher, camera, notifications). NFC n’ajoute pas un nouveau modèle de distribution.

Le plugin documente `minSdk` Android 31. Expo 54 compile déjà `compileSdk` / `targetSdk` 36 : pas d’abaissement.

## 8. QR = secours obligatoire

Invariant produit, inchangé :

1. Une carte logique active par élève / établissement (D8) — médias `nfc` + `qr` = même capability.
2. NFC principal **si** hardware + réglage + flag `student_card_nfc_enabled`.
3. QR toujours proposé si NFC absent, off, refusé, ou en échec.
4. Appel manuel Web/Mobile **jamais** retiré (AUDIT-CARTE-01 §10.0).
5. Master `student_card_enabled` off ⇒ aucun scan NFC/QR.

PR8 n’ouvre pas un second contrat HTTP. Il réutilise `getStudentCardCapabilities` / `runStudentCardScanFlow` / `POST /api/student-cards/scan`.

## 9. Stores / confidentialité

Activer NFC **n’ajoute aucune collecte**. Le capability est le même que le QR déjà déclaré.

| Store | Impact PR8 |
| --- | --- |
| Google Play — permissions | Déclarer `NFC` : identification scolaire (carte élève), pas paiement. |
| Google Play — Data safety | **Pas** de nouvelle catégorie. Mettre à jour `PLAY-STORE-DATA-INVENTORY.md` : « Identifiant carte élève / QR **ou NFC** » ; transit HTTPS ; pas de stockage local du secret ; pas de tracking. |
| App Store — Privacy | NFC n’est pas un type de données tracking. Réévaluer « Device ID » seulement si on persistait l’UID — **interdit**. |
| App Store — review | Usage description + entitlement NDEF. Motif : lire une carte scolaire NDEF. |
| Tracking | Aucun `NSUserTrackingUsageDescription`. Aucun SDK pub. |

Ce gate ne soumet rien. PR8 met à jour l’inventaire **quand** le scan NFC existe, comme PR7 l’a fait pour le QR.

## 10. Sécurité — contrat V1 inchangé

| Règle | Conséquence PR8 |
| --- | --- |
| NFC = identification scolaire, pas authentification forte | Ne pas vendre « infalsifiable » |
| NTAG213 / 21x clonable | Clone marche jusqu’à révocation serveur |
| UID NFC **jamais** secret | Interdit : login par UID, allowlist UID, HMAC UID |
| Capability serveur révocable | `lost` / `revoked` / `replaced` invalident le secret |
| V1 online-only | Pas de cache local du token ; fail-closed hors réseau |
| Aucun bit finance sur le tag | Interdit : dette, montant, « IMPAYÉ », téléphone, email, naissance, JWT, `school_id` interne, matricule seul |

**Autorisé sur la puce :** URI / texte NDEF = même `cardToken` que le QR, éventuellement préfixé `somafrik:card:`.

Le DTO scan, le hash SHA-256, et l’absence de secret en outbox / SecureStore / SQLite restent ceux de PR3–PR7.

## 11. Hardware NTAG213 PVC

Cible V1 : cartes PVC **NTAG213** (NXP NTAG21x, ISO 14443-A, Type 2).

| Point | Décision |
| --- | --- |
| Lecture NDEF | **Oui — cœur de PR8** |
| Écriture / encodage | **Hors scan PR8.** L’émission (PR2/PR6) produit le capability. L’encodage physique (imprimante / encodeur / écran staff dédié) est un lot distinct. Le scanner enseignant **lit**. |
| Mémoire utile NTAG213 | 144 octets NDEF (180 octets user) |
| Payload V1 | `somafrik:card:` + `publicId.secret` (base64url) |
| Taille estimée | `publicId` 16 octets → ~22 chars ; `secret` 32 octets → ~43 chars ; préfixe 14 ; NDEF URI ~90–110 octets — **tient** dans 144 |
| Verrouillage pages | Optionnel à l’encodage (hors PR8). La révocation serveur reste l’autorité même si le tag est réécrit |
| UID | Identifiant usine seulement — **jamais** d’auth |

NTAG215/216 sont acceptés en lecture (plus de mémoire). V1 ne les exige pas.

## 12. Plugin Expo — configuration figée pour PR8

```json
[
  "react-native-nfc-manager",
  {
    "nfcPermission": "Somafrik utilise la puce NFC pour lire la carte élève de l’établissement.",
    "includeNdefEntitlement": true
  }
]
```

Pas de `selectIdentifiers` ISO7816. Pas de `systemCodes` FeliCa.

Après prebuild attendu :

```text
Android : android.permission.NFC accordée (pas tools:node=remove)
Android : uses-feature android.hardware.nfc required=false
Android : RECORD_AUDIO / LOCATION / CONTACTS / CALL_PHONE / stockage large toujours retirés
iOS : NFCReaderUsageDescription = chaîne figée
iOS : entitlement NDEF présent
iOS : pas de NSUserTrackingUsageDescription
```

## 13. Tests requis pour PR8

| # | Test |
| --- | --- |
| 1 | `isSupported() === false` → UI NFC indisponible, QR visible, appel manuel intact |
| 2 | `isEnabled() === false` → pas de crash, bascule QR |
| 3 | NDEF `somafrik:card:publicId.secret` → même `runStudentCardScanFlow` que QR, **aucun teacherId** en session Enseignant |
| 4 | Tag vide / non NDEF / capability invalide → pas d’upsert présence |
| 5 | Master / NFC flag off → pas de session NFC |
| 6 | Offline → fail-closed (déjà D7) |
| 7 | Prebuild Android : NFC oui ; blocklist restante intacte ; `hardware.nfc` `required=false` |
| 8 | Prebuild iOS : usage description + entitlement NDEF ; pas de tracking |
| 9 | `verify:mobile-security` / `verify-student-card-qr` adaptés : NFC **autorisé** sans ouvrir micro / galerie / localisation |
| 10 | Non-régression Présences manuelles (carte on et carte off) |
| 11 | Smoke physique NTAG213 + téléphone sans NFC |

Aucun de ces tests n’est exécuté dans ce gate.

## 14. Fichiers que PR8 devra toucher

Ce gate ne les modifie pas.

| Fichier | Modification PR8 |
| --- | --- |
| `Mobile/package.json` / lock | `react-native-nfc-manager@4.0.0-beta.10` |
| `Mobile/app.json` | plugin NFC + chaîne `nfcPermission` |
| `Mobile/app.config.js` | retirer **seulement** `android.permission.NFC` de `blockedPermissions` |
| `Mobile/plugins/withSomafrikAndroidSecurity.js` | retirer **seulement** NFC de `BLOCKED_PERMISSIONS` |
| `Mobile/scripts/verify-native-prebuild.js` | NFC attendu ; autres interdits inchangés ; feature `required=false` |
| `Mobile/scripts/verify-mobile-security.js` | cesser d’interdire la dépendance NFC ; garder CAMERA + blocklist |
| `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` | NFC = même capability que QR, pas de collecte nouvelle |
| Scanner Présences | session NFC au tap, cancel au close, fallback QR |

Interdit en PR8 : backend, web, migrations, RECORD_AUDIO, LOCATION, CONTACTS, CALL_PHONE, galerie large.

## 15. Conditions et verdict

### GO CARTE-PR8 si PR8 respecte

```text
bibliothèque : react-native-nfc-manager
version New Architecture : 4.0.0-beta.10 (pas latest v3)
config plugin Expo + CNG
Expo Go : non supporté — APK / development build
Android : retirer NFC de la blocklist uniquement
Android : uses-feature nfc required=false
iOS : NFCReaderUsageDescription figée + entitlement NDEF
session NFC au scan seulement
QR fallback obligatoire
même cardToken / même scan HTTP que PR7
UID jamais secret
aucun PII / finance / JWT sur la puce
V1 online-only
lecture NDEF seulement (pas d’encodage dans le scanner)
Data safety : pas de nouvelle collecte
prebuild Android + iOS verts
```

### NO-GO si PR8 exigeait

```text
expo-nfc stub
react-native-nfc-manager@latest (v3) sur New Architecture
android.hardware.nfc required=true
élargir RECORD_AUDIO / LOCATION / CONTACTS / CALL_PHONE / galerie
auth par UID
écriture finance / PII sur le tag
scan offline fondé sur un cache token
supprimer le QR ou l’appel manuel
ouvrir CARTE-PR8 avant le merge de ce gate
```

**Verdict : GO CARTE-PR8.**

Ce GO est une **autorisation de revue**, pas un Ready, pas un merge de code NFC, pas une ouverture de PR8 dans ce lot.

## 16. Décisions figées (si GO)

| Décision | Valeur |
| --- | --- |
| Bibliothèque | `react-native-nfc-manager` |
| Version | `4.0.0-beta.10` (New Architecture Somafrik) |
| Android | retirer `android.permission.NFC` de la blocklist uniquement ; `uses-feature` `android.hardware.nfc` `required=false` |
| iOS | entitlement NDEF + `NFCReaderUsageDescription` figée |
| Fallback | QR obligatoire ; appel manuel intact |
| Format NFC V1 | NDEF `somafrik:card:` + `publicId.secret` (même capability QR) |
| Stores | Play : permission NFC identification scolaire ; Data safety / App Privacy : pas de collecte nouvelle ; inventaire mis à jour en PR8 |
| Encodage NTAG | hors scanner PR8 |
| Tests | §13 |

## 17. Sources primaires

- npm `react-native-nfc-manager` (licence MIT, v3.17.5 latest, peer `@expo/config-plugins` `*`).
- GitHub Releases : `3.17.5`, `4.0.0-beta.10` (2026-10-03) ; notes New Architecture vs legacy.
- Wiki [Expo](https://github.com/revtel/react-native-nfc-manager/wiki/Expo-Go) — Expo Go unsupported, config plugin, `nfcPermission`, `includeNdefEntitlement`.
- [Expo SDK 54 package list](https://docs.expo.dev/versions/v54.0.0/) — aucun module NFC officiel.
- npm `expo-nfc@0.0.0` — stub rejeté.
- [Apple NFCReaderUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nfcreaderusagedescription).
- [Apple NFCTagReaderSession](https://developer.apple.com/documentation/corenfc/nfctagreadersession).
- NXP NTAG213 : 144 octets NDEF.
- Repo Somafrik @ `ed16f3b3bf5be8de4a001ea9e29dd9029b80ff0c` : `Mobile/package.json`, `Mobile/app.config.js`, `Mobile/plugins/withSomafrikAndroidSecurity.js`, `Mobile/scripts/verify-native-prebuild.js`, `docs/mobile/PLAY-STORE-DATA-INVENTORY.md`, `backend/lib/studentAccessCardsManagement.js` (`PUBLIC_ID_BYTES=16`, `SECRET_BYTES=32`).
