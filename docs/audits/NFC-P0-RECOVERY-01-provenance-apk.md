# NFC-P0-RECOVERY-01 — Provenance des APK de test et identification sur appareil

**Statut : DRAFT / HOLD / NO MERGE.** Enquête menée en lecture seule sur GitHub Actions et dans le dépôt, le 17 octobre 2026. Aucun téléphone n'a été manipulé.

## 1. Constats prouvés

### 1.1 Seul un workflow GitHub publie des APK installables

| Workflow | Déclencheur | Produit un APK installable ? |
| --- | --- | --- |
| `nfc-encoding-preprod.yml` | PR vers `develop` touchant `Mobile/**` | **Oui** — artefact `nfc-preview-<sha>`, conservé 14 jours |
| `mobile-preview-windows.yml` | PR `Mobile/**` | Non (vérifications sans artefact) |
| `mobile-e2e-runtime.yml` | Manuel | Non (artefacts Maestro) |
| `ci.yml` | Nuit / manuel | Non |
| `eas-production-aab.yml` | `main` / manuel | AAB de production (Play Store), pas d'APK de test |

**Hors GitHub, non traçable depuis le dépôt :** les builds EAS du profil `preview` ou `development` (`eas.json`, `buildType: apk`) lancés depuis un poste, et les compilations locales. Ils doivent être déclarés par les personnes concernées (§4, question 2).

### 1.2 Exécutions inventoriées

`nfc-encoding-preprod.yml` : **95 exécutions** au total (toutes lues), dont **55 réussies** couvrant **54 commits distincts**. Pour chacun de ces 54 commits, le code `Mobile/src` a été inspecté.

### 1.3 Trois APK contiennent la commande de verrouillage irréversible

| PR | Commit | Exécution | Construit le (UTC) | `apkSha256` | Artefact expire le |
| --- | --- | --- | --- | --- | --- |
| [#908](https://github.com/Somafrik-education/Somafrik/pull/908) NFC-ENC-01 | `c3db71cbaa6e77e761576d439562336c4d6791e6` | [38300236809](https://github.com/Somafrik-education/Somafrik/actions/runs/38300236809) | 2026-10-12 20:03 | `4fbf6dcb8145dac090f6605628da6454f15668aa27df98a72bdb1d07448616db` | **2026-10-26** |
| [#909](https://github.com/Somafrik-education/Somafrik/pull/909) NFC-RECON-02 | `91c2af5c5a6255f010fbbbf7f3b5f85a5d04cb22` | [38368481589](https://github.com/Somafrik-education/Somafrik/actions/runs/38368481589) | 2026-10-13 08:32 | `066a1ea8883952f672c888f282cf513de4f0c2783abad00274efa66e24be285c` | **2026-10-27** |
| [#912](https://github.com/Somafrik-education/Somafrik/pull/912) NFC-PROG-02 | `c6f5eaaa23711e4c797f1dac6a764a49f5039096` | [38415265990](https://github.com/Somafrik-education/Somafrik/actions/runs/38415265990) | 2026-10-13 14:51 | `805de3a3854f7d553f1a201665901ffec709ea3dc8865e8dfbd72a33bf8e120b` | **2026-10-27** |

Dans ces trois commits, `StudentCardNfcEnrollmentPanel.tsx` affiche un bouton **« Verrouiller définitivement »** sur toute carte `active/encoded`. Ce bouton appelle `NfcManager.ndefHandler.makeReadOnly()` après une alerte de confirmation (`studentCardNfcEncoderNative.ts:75-79`, `studentCardNfcEncoding.ts:87`). Le verrouillage n'est **jamais automatique** : il exige deux actions explicites de l'opérateur.

Les 51 autres commits construits, ainsi que `develop`, ne contiennent **aucun** appel `makeReadOnly` hors tests.

**Ce qui n'est pas prouvé :** que l'un de ces APK ait été téléchargé, installé ou utilisé. GitHub ne fournit pas de journal des téléchargements d'artefacts.

### 1.4 Les APK sont indiscernables par les réglages Android

Les 3 APK à risque et `develop` partagent :

| Attribut | Valeur |
| --- | --- |
| Paquet | `com.somafrik.app` |
| Version | `1.2.1` (versionCode 13) |
| Signature | Certificat de test « Android Debug » |
| API | `https://api-preprod.somafrik.app` |

**« Paramètres → Applications → Somafrik » ne permet donc pas de savoir quel APK est installé.** Seules l'empreinte du fichier et les repères d'interface (§2) le permettent.

## 2. Procédure d'identification sur un appareil (lecture seule)

À appliquer à **chaque téléphone ayant pu servir à encoder des cartes**. Aucune action ne désinstalle, ne met à jour ou ne lance d'encodage.

### Étape 0 — Mise sous séquestre

- Ne pas mettre à jour ni désinstaller Somafrik sur ces téléphones avant la fin de la vérification.
- Étiqueter chaque téléphone (TEL-01, TEL-02…) et noter son modèle et sa version d'Android.
- **Archiver les 3 artefacts de la table §1.3 avant leur expiration (26-27 octobre)**, dans un stockage restreint. Ce sont les seules références d'empreinte disponibles.

### Étape 1 — Empreinte de l'APK installé (méthode décisive)

Prérequis : ordinateur avec `adb`, débogage USB activé temporairement par le propriétaire du téléphone.

```bash
adb devices                                          # le téléphone doit apparaître
adb shell dumpsys package com.somafrik.app | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime"
adb shell pm path com.somafrik.app                   # ex. package:/data/app/~~…/base.apk
adb pull <chemin base.apk> TEL-01-base.apk          # copie locale, lecture seule côté téléphone
sha256sum TEL-01-base.apk                            # (macOS : shasum -a 256)
```

Interprétation :

| Résultat `sha256sum` | Conclusion |
| --- | --- |
| = une des 3 empreintes §1.3 | **APK à risque installé** : toutes les cartes manipulées avec ce téléphone sont à vérifier pour un verrouillage (CC page 3, 4e octet = `0F`) |
| = l'empreinte d'un autre build CI (résumé du job « NFC APK preview exact HEAD ») | APK sans verrouillage, provenance établie |
| Aucune correspondance | Build EAS ou local : provenance **inconnue**, appliquer l'étape 2 |

`lastUpdateTime` ne prouve rien seul, mais une date de mise à jour comprise entre le 12/10 20:03 UTC et la réinstallation suivante est un indice à consigner.

### Étape 2 — Repères d'interface (sans carte, sans écriture)

Ouvrir Somafrik → fiche d'un **élève de test** → section carte NFC, sans approcher de carte.

| Repère observé | APK à risque (#908/#909/#912) | Code actuel (`develop`) |
| --- | --- | --- |
| Bouton pour un élève sans carte active | **« Lire l'UID d'une carte vierge »** | « Programmer une carte NFC » |
| Ligne de chaque carte | Affiche **« UID 04… »** | N'affiche pas l'UID |
| Carte active encodée | Bouton **« Verrouiller définitivement »** | Absent |
| Libellé de l'état `locked` | « Verrouillée définitivement » | « En lecture seule » |

Vérifié dans le code : sur les 54 commits construits et `develop`, ces libellés n'existent **que** dans les 3 commits à risque.
**Ne jamais appuyer sur ces boutons pendant la vérification.** Faire une capture d'écran, recadrée pour masquer nom et UID.

### Étape 3 — Consignation

Pour chaque téléphone : identifiant, modèle et Android, `versionName`/`versionCode`, `lastUpdateTime`, empreinte, correspondance (§1.3, autre build, inconnue), repères d'interface, et liste des cartes manipulées (numéros d'inventaire). Ces informations rejoignent le registre restreint (colonne `Telephone_APK`).

## 3. Conséquences pour le diagnostic des cartes

- Si **aucun** téléphone ne porte un APK à risque, et qu'aucun build EAS ou local n'est déclaré : la cause CR-6 (verrouillage) devient **improbable**. Elle reste à confirmer carte par carte via la page 3.
- Si un téléphone porte un APK à risque : prioriser la lecture de la page 3 des cartes qu'il a manipulées. Un CC `E1 10 12 0F` signe un verrouillage NDEF **irréversible** (catégorie F).

## 4. Questions aux équipes (sans réponse dans le dépôt)

1. Qui a téléchargé les artefacts `nfc-preview-c3db71c…`, `…91c2af5…`, `…c6f5eaa…` ?
2. Des builds EAS (`preview`/`development`) ou locaux ont-ils été installés depuis les branches #908, #909 ou #912 ?
3. Le bouton « Verrouiller définitivement » a-t-il été utilisé, même une fois ?

**NFC-P0-RECOVERY-01 — DRAFT / HOLD — DIAGNOSTIC À VALIDER PAR LE CTO.**
