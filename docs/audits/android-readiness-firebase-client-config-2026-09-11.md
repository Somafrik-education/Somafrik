# Android readiness — Firebase client config

**Date :** 2026-09-11

Le gate `Android release readiness GO-PROD` classait historiquement `Mobile/google-services.json` avec les secrets privés et échouait dès que ce fichier était versionné.

Décision CTO : `google-services.json` est une configuration cliente Android nécessaire au SDK Firebase, distincte des credentials privés.

La gate conserve l'interdiction stricte des keystores, `credentials.json`, comptes de service Firebase, APK/AAB et `Mobile/android/`. Elle valide désormais explicitement que `Mobile/google-services.json` existe, est un JSON valide, contient un `project_id` et cible le package canonique `com.somafrik.app` via `ANDROID_PACKAGE`.

Aucune clé Firebase n'est recopiée dans cette preuve. Gitleaks reste actif ; l'exception historique est gérée séparément par fingerprint exact.
