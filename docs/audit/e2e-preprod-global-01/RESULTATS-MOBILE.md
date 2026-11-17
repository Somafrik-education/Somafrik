# E2E-PREPROD-GLOBAL-01 — Résultats Mobile (APK Preview → préproduction)

**Statut : 0 scénario Mobile exécuté.** Tous les scénarios M sont **BLOCKED** :
- **BLK-MOBILE :** aucun appareil ni émulateur Android exploitable dans ce conteneur (pas de `/dev/kvm`) ;
- **BLK-AUTH :** aucun compte de test ;
- **BLK-PERM :** interaction avec la préproduction refusée.

**Preuves natives disponibles (CI, hors E2E préproduction) :** sur `#1175@473e6ccd`, le workflow Hermes S13 + SQLCipher sur émulateur Android a réussi ([run 44062901882](https://github.com/Somafrik-education/Somafrik/actions/runs/44062901882), artifact `rc-native-proof-473e6ccd…`, rétention 30 jours) :
- `HERMES_S13_PASSED 27/27` ;
- `ANDROID_SQLCIPHER_PASSED` ;
- `PR3_PIPELINE_PASSED` ;
- `PR4_SYNC_PASSED`.

Ces preuves portent sur le stockage hors connexion et la cryptographie de l'appel, **pas** sur les parcours fonctionnels reliés à la préproduction.

**Pour exécuter la recette Mobile :**
- un APK Preview relié à `api-preprod.somafrik.app`, avec son SHA ;
- un appareil réel ou un émulateur avec accélération matérielle ;
- les comptes de test ;
- un enregistrement vidéo par scénario.
