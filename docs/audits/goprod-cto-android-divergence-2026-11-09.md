# GO-PROD — Contrôle CTO indépendant de divergence Android (09-11-2026)

**Statut : AUDIT PARTIEL / NO-GO / DRAFT-HOLD / AUCUN MERGE.**  
Gouvernance : [#720](https://github.com/Somafrik-education/Somafrik/issues/720). Qualification : [#719](https://github.com/Somafrik-education/Somafrik/issues/719).

## Nature de la preuve

Contrôle GitHub indépendant de deux branches, via comparaison des commits et lecture directe de quatre fichiers à leurs refs respectives. Ce document **n'est pas** le rapport complet Cursor annoncé (`docs/audits/goprod-parity-audit-2026-11-09.md`, commit local `5b4fa7e9`), qui reste à publier et contre-vérifier. Les tests CI, builds, APK, AAB, Play Console, Render et PostgreSQL n'ont **pas** été exécutés dans le cadre du présent contrôle.

## Baseline GitHub observée

- `develop@677b1dd2e087d0f7ba79b0e3a1515f7ab77d6f00`
- `main@ef8bc9517ffc94aa770743713d0f561f92a9fc1e`
- merge-base `dd46ad17753738b68412e008baaf8c9017333885`
- Compare main → develop : 354 commits ahead, 11 behind (branches diverged).
- Compare develop → main : 11 commits ahead, 354 behind ; quatre fichiers listés :
  - `Mobile/app.json` (+1/-1)
  - `Mobile/config/releaseEnvironments.js` (+1/-1)
  - `Mobile/scripts/build-android-aab.js` (+48/-1)
  - `Mobile/scripts/build-android-env.js` (+1/-0)
- Attention : la réponse GitHub Compare main → develop est tronquée à 300 fichiers ; il faut un diff local exhaustif pour qualifier le delta global.

## Matrice source des écarts

| Fichier | develop | main | Conséquence / action |
| --- | --- | --- | --- |
| `Mobile/app.json` | `android.versionCode=13` ; plugin NFC + permission NFC présents | `android.versionCode=24` ; NFC absent | Éviter un retour à l'ancienne configuration : conserver NFC, aligner version release après vérification Play Console |
| `Mobile/config/releaseEnvironments.js` | `ANDROID_VERSION_CODE=13` | `ANDROID_VERSION_CODE=24` | Unifier la source canonique et la configuration Expo/natif |
| `Mobile/scripts/build-android-aab.js` | Gradle `bundleRelease` sans prebuild/contrôle version native | `expo prebuild --clean --no-install` puis comparaison version native/canonique avant `bundleRelease` | Reporter les protections de validation sans écraser les plugins NFC ni la configuration native |
| `Mobile/scripts/build-android-env.js` | `ensureLocalProperties` prépare le chemin SDK sans `mkdirSync(androidDir)` préalable | Crée d'abord `androidDir` | Vérifier nécessité/effets et adapter minimalement |

Les URLs canoniques API sont identiques dans le fichier de configuration examiné : préprod `https://api-preprod.somafrik.app`, prod `https://api.somafrik.app`. Cela ne démontre pas la disponibilité DNS ou réseau.

## Décisions CTO

1. **GO-P0-01 : HOLD.** Ne pas fusionner `main` vers `develop` en bloc. Réconcilier uniquement les changements nécessaires dans une PR de correctif séparée et ciblée.
2. Ne pas supposer que `24` est le prochain `versionCode` publiable : vérifier la version maximale effectivement utilisée dans Play Console, puis choisir une valeur supérieure pour une nouvelle publication.
3. Vérifier le résultat du `expo prebuild --clean`, la présence du plugin NFC, les permissions Android, et le versionCode natif. Construire ensuite un AAB sur le HEAD exact et inspecter son manifeste (y compris les permissions de stockage : [#499](https://github.com/Somafrik-education/Somafrik/issues/499)).
4. Ne pas publier d'AAB, ne pas modifier Render, secrets ou bases de production sans GO explicite.
5. Les chantiers sécurité [#993](https://github.com/Somafrik-education/Somafrik/pull/993) et [#987](https://github.com/Somafrik-education/Somafrik/pull/987) restent en attente de preuves spécifiques de recette ; aucun PASS par simple lecture de leur description.
6. Poursuivre l'audit exhaustif G0–G6 (parité native, CI complète, PostgreSQL, migration/rollback, préprod réelle, sécurité et performance), puis décider GO/NO-GO sur SHAs, artefacts et preuves exacts.

## Contrat d'acceptation de la future PR GO-P0-01

- Base et HEAD exacts, merge-base, ahead/behind et diff Github indépendant.
- Tous changements du code limités aux scripts/configurations Android justifiés.
- `ANDROID_VERSION_CODE`, `app.json`, `build.gradle` cohérents après prebuild.
- NFC conservé lorsque requis par le profil, aucune permission sensible inattendue.
- Préproduction et production isolées, aucun secret embarqué.
- Tests de build, CI et vérification manifeste AAB documentés.
- PR initialement **DRAFT / HOLD** ; re-diff CTO obligatoire après tout nouveau HEAD.

**Verdict final de cette preuve partielle : NO-GO.**
