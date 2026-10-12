# NFC-ENC-01 — suite audit CTO #908

DRAFT / HOLD — NO READY — NO MERGE — NO PRODUCTION. Référence auditée : 95e5b48cc790d20bedbd83437edc48d0e5626e48, base 1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f.

## Causes racines confirmées sur GitHub

1. Android release readiness, run 38297210072 / job 114971068284 : `scripts/verify-android-release-readiness.js:218` exige encore `["CAMERA"]`. La nouvelle permission NFC provoque l'assertion. Correctif : exactement CAMERA + NFC Android ; dépendance NFC auditée, plugin Android canonique, feature facultative et absence d'accès NFC iPhone contrôlés. Les autres permissions restent interdites.
2. PR Gates / Risk-targeted, run 38297210255 / job 114971150535 : `backend/lib/studentAccessCards.pg.test.js:212` liste `nfc_uid` parmi les colonnes interdites. L'UID physique est maintenant une métadonnée autorisée ; retrait de cette seule colonne de la liste. Identités élève, dette, JWT, token/secret clair restent interdits. Les nouveaux tests SQL vérifient type/format/uniqueness/tenant/rotation/confirmation atomique.
3. Mobile Preview Windows SUCCESS ne prouve aucun APK : ses étapes sont npm ci, tests spawn, expo config et vérification core. Aucun assembleRelease ni artifact APK.

## Interaction #891 (HEAD b2aaa6151468b9398b1644299f4bdc081ccb050c)

Simulation locale `git merge-tree --write-tree 95e5b48c b2aaa615` sans merge effectif : trois conflits.

| Fichier | Résolution requise avant une éventuelle intégration du lecteur |
|---|---|
| Mobile/app.json | Conserver la configuration Android de #908. Retirer le plugin générique NFC de #891 qui ajoute des entitlements iOS ; iPhone est hors scope. Une seule dépendance NFC, une seule permission NFC. |
| Mobile/scripts/verify-mobile-security.js | Conserver les contrôles Android de #908 et ajouter les assertions lecteur #891 ; aucun double plugin ni entitlement iOS. |
| Mobile/scripts/verify-native-prebuild.js | Conserver permission NFC Android + feature required=false + interdictions iPhone de #908 ; adapter les preuves du lecteur sans réactiver iOS. |

Les changements `app.config.js` et `withSomafrikAndroidSecurity.js` sont identiques pour le retrait du blocage NFC et la feature facultative. package.json/package-lock fusionnent techniquement avec la même version 4.0.0-beta.10 ; contrôler l'unicité de l'entrée après rebase. Scanner QR, backend capabilities et parsing du lecteur restent à rejouer après adaptation de #891. #891 demeure inchangée ; aucune fusion de son code dans #908.

## Preuve PostgreSQL et APK

Workflow dédié `.github/workflows/nfc-encoding-preprod.yml` : checkout du HEAD exact de la PR. Premier job : vraie instance PostgreSQL 16 dans un conteneur jetable, base `nfc_encoding_test`. Le runner NFC utilise uniquement `SOMAFRIK_NFC_TEST_DATABASE_URL` ; schéma transactionnel jetable et rollback. Aucun accès Supabase/Render/production, aucune utilisation de la DATABASE_URL applicative.

Le job APK dépend du succès PostgreSQL. JDK17, SDK Android, Node22.12, `expo prebuild android` profil preview, Gradle `:app:assembleRelease`, ABI arm64-v8a. Bundle JS/Hermes embarqué : APK autonome sans Metro. Certificat Android Debug de test uniquement ; aucun secret de signature production et aucun upload Play/EAS/Render. Nom d'artifact lié au HEAD complet.

Le validateur inspecte le ZIP produit : `assets/app.config` profil preview, apiUrl **https://api-preprod.somafrik.app**, demoMode false et package canonique. Il contrôle le bundle embarqué, les permissions réellement fusionnées, la feature NFC facultative, backup/cleartext désactivés, la signature et les motifs de secrets serveur dans assets/DEX. La présence des constantes d'URL production dans le code partagé ne signifie pas un endpoint actif : le profil et l'API embarqués déterminent la liaison de cet APK.

Résultats de compilation et d'exécution PostgreSQL : à renseigner depuis les jobs du nouveau HEAD. Tant que l'artifact vérifié n'existe pas, ne pas déclarer « APK prêt pour smoke physique ».

## Limites à conserver

- Signature de test distincte de Play, même package com.somafrik.app. Installation sur un appareil de test ; remplacer une installation Play nécessite de la désinstaller. Aucun remplacement automatique de la prod.
- ARM64 uniquement pour ce smoke ; pas un APK universel/store-ready.
- Les fonctions d'encodage doivent rencontrer les endpoints du nouveau HEAD sur le backend préproduction. Cette PR n'est pas mergée et aucun backend n'est déployé par le workflow ; un backend préproduction resté sur develop ne connaît pas nfc-confirm/nfc-retry. Test physique bloqué tant que le backend correspondant n'est pas disponible.
- Cartes livrées au format NDEF attendu ; aucune mise au format brute de puces non-NDEF. Une carte QR déjà active ne reçoit pas d'UID via ce parcours.
- État locked = observation client habilité, pas attestation anti-clonage. Révocation serveur reste nécessaire.
- UID historique réservé ; aucune réaffectation silencieuse à un autre élève.
- Smoke physique et preuve Android du contenu réellement réinscriptible avant lock restent obligatoires. Le verrouillage ne sera testé qu'en dernier, sur action explicite.
