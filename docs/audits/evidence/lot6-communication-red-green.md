# LOT 6 — preuves RED → GREEN (PARITY-034 / 026 / 055 / 068 Communication)

Base : `develop@58bdf8913df999cdee773af008d0c253cfb064b1`  
Branche : `cursor/lot6-communication-parity`  
Mandats : #704 `#5738146391` / `#5741593366`

## Tableau audit 704 → état actuel → gap → décision

| ID | Audit #704 | État `develop@58bdf891` | Gap résiduel | Décision LOT 6 |
| --- | --- | --- | --- | --- |
| **PARITY-034** | Web sans Web Push ; Mobile Expo Push ; backend `/mobile/push-devices` | Mobile : register + `revokeCurrentPushDevice` au logout. Web : aucun `PushManager` / VAPID. Backend : pas de web-push. | Pas de canal Web Push — volontaire. | **Asymétrie de canal** : Mobile = Expo Push ; Web = IN_APP (C4) + EMAIL. Aucun nouveau fournisseur / infra. |
| **PARITY-026** | Divergence possible Notifications:READ | Mobile inbox C4 exige `Notifications:READ`. Web `canReadView("notifications")` ouvrait aussi via `isEstablishmentCommunicationUser` (rôle établissement). Poll C4 déjà fail-closed. | Web UI trop large vs backend/Mobile. | **Fail-closed** : Web établissement = `Notifications:READ` uniquement. Plateforme (Super/Pays) inchangée. |
| **PARITY-055** | Préférences à rendre live des deux côtés | Web Topbar : `CommunicationPreferencesPanel`. Mobile : sheet existante **uniquement** sur `MenuScreen` (hors graphe live). | Mobile live inaccessible. | Brancher `CommunicationPreferencesSheet` dans `RoleNavigationDrawer` (même sémantique PUSH/EMAIL/IN_APP). |
| **PARITY-068** | Écran Mobile orphelin vs Web live | Web `/notifications-plateforme` + `isPlatformCommunicationUser`. Mobile `PlatformNotificationsScreen` mort ; LOT 1 interdit la route live. | Pas de UI Mobile plateforme. | **Web-only volontaire** : catalogue Superadmin/Pays. Ne pas réactiver le legacy Mobile. |

## RED (base `58bdf891`, avant mutation produit)

`npx --yes tsx --test scripts/lot6-parity.test.ts` → **3 fail / 2 pass**

- PASS PARITY-034 : Expo + revoke logout déjà là ; pas de fournisseur Web
- FAIL PARITY-026 : fallback `isEstablishmentCommunicationUser` encore présent
- FAIL PARITY-055 : `RoleNavigationDrawer` sans sheet live
- FAIL PARITY-068 : preuve / décision Web-only absente
- PASS gate : ajoutée avec la suite

Preuve brute : `/tmp/lot6-red.txt`

## GREEN (cette branche)

```
npm run test:lot6-parity
# scripts/lot6-parity.test.ts 5/5
# dashboardPermissions : Notifications:READ obligatoire
```

- Job CI `LOT 6 parity` dans Required, `needs` extensible (`lot6` n'est pas figé comme dernier).

STOP : Draft. Pas Ready. Pas merge. Pas LOT 7/8.
