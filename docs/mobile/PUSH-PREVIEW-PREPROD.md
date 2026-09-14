# Push Android — preview / préproduction

Diagnostic et contrat P0 (#645). Aucun secret n’est modifié depuis le dépôt.

## Cible

| Élément | Valeur |
| ----- | ------ |
| Profil EAS | `preview` |
| Backend | `APP_ENV=preproduction` |
| API preview | `https://api-preprod.somafrik.app` |
| Channel Android | `somafrik-default-v2` |
| Plateforme N1 | Android uniquement |

Le profil Mobile `preview` est une métadonnée acceptée par le backend préproduction. Il n’est pas une autorité d’environnement.

## Enregistrement device

`POST /api/mobile/push-devices` lie l’appareil à la session (user + école + `APP_ENV` + `appProfile`).

Un échec d’enregistrement (permission, ProjectId EAS, HTTP) doit être journalisé via `safeLogger` (`push device registration failed`) et inspectable (`getLastPushRegistrationOutcome`). Aucun jeton Expo/FCM complet dans les logs.

## Auto-test

`POST /api/mobile/push-devices/test` :

- interdit en production ;
- en préproduction : **`SOMAFRIK_PUSH_SELFTEST_ENABLED=true`** **et** permission `Push:TEST` / Superadmin ;
- le défaut compose / `.env.preproduction.example` reste `false` (fail-closed).

Cursor / le code **ne changent pas** la variable Render. Action opérateur si le self-test recette est requis :

1. Vérifier la valeur sur le service API préprod (`somafrik-api-preprod` / équivalent).
2. Passer `SOMAFRIK_PUSH_SELFTEST_ENABLED=true` uniquement si le diagnostic recette est autorisé.
3. Redéployer / relancer le service selon la procédure habituelle.
4. Un 403 « Auto-test push désactivé dans cet environnement » confirme que le flag est absent ou faux.

La réponse autorisée contient une **preuve** (`proof.tickets`, `proof.pendingReceipts`, `proof.channelId`) sans jeton. Un ticket Expo `ok` n’est pas une livraison : le worker de receipts (`ok` / `DeviceNotRegistered`) reste la preuve différée.

## Android 13+ et channel

- Permission runtime : `requestPermissionsAsync` (plugin `expo-notifications`, pas de `POST_NOTIFICATIONS` dupliqué dans le plugin sécurité).
- Channel créé côté client : `somafrik-default-v2` (importance HIGH).
- Transport Expo : même channel, `priority: high`. Un appelant qui passe encore `somafrik-default` est ignoré.

## Credentials FCM V1 / EAS — hors dépôt

`google-services.json` et les clés FCM V1 EAS ne sont pas dans git (exemple seulement).

Si le code et les tests unitaires sont verts mais **aucune notification système** n’arrive sur un APK preview :

1. Expo Dashboard → projet Somafrik → credentials Android → **FCM V1** service account présent et valide.
2. EAS : `eas credentials` / Google Service Account pour `preview` — **ne pas** committer la clé.
3. Rebuild `eas build --platform android --profile preview` après correction FCM.
4. **STOP code** : ne pas contourner une credential absente ou invalide.

## Hors périmètre

Web Push, UI Communication métier, Bulletins, Finance, secrets Render, déploiement.
