# Inventaire Web Push — `develop` 3ff88495 (2026-09-14)

Ticket : #646. Base d’inventaire : `origin/develop` HEAD `3ff88495e499f1e9beaad7c439e095da695d0433`
(Merge pull request #642 — LOT 7 bulletins). Aucune brique Web Push navigateur n’était présente
sur ce SHA. Le centre de notifications in-app et la chaîne Mobile Expo existent déjà.

## Préalable #645

Le lot P0 Mobile Push #645 est traité par un agent dédié, hors de cette PR. Ce lot #646
ne modifie pas `expoPushService`, les routes `/api/mobile/push-devices`, le store Mobile,
ni les écrans Mobile. Le hook partagé est uniquement le fan-out canal `PUSH` déjà existant.

## Matrice des briques (avant implémentation)

| Brique | Statut sur `develop` 3ff88495 | Preuve |
|---|---|---|
| Permission navigateur `Notification.requestPermission` | **ABSENTE** | aucun usage dans `web/` |
| Service worker push | **ABSENT** | aucun `sw.js` / `service-worker` / Workbox / PWA |
| PushManager / Firebase Messaging Web | **ABSENT** | aucun `PushManager`, `firebase-messaging`, `getMessaging` |
| VAPID | **ABSENT** | aucune variable `VAPID_*` dans `.env*.example` |
| Stockage subscription backend | **ABSENT** | table `mobile_push_devices` uniquement (Expo) |
| Envoi serveur Web Push | **ABSENT** | `dispatchPush` → Expo `sendToTokens` seulement |
| Click routing Web Push | **ABSENT** | deep-link in-app Web existe ; pas de `notificationclick` |
| Centre de notifications in-app | **PRÉSENT** | `InternalNotificationsCenter` + C4 PostgreSQL |
| Deep-link allowlist Web | **PRÉSENT** | `web/src/lib/notificationNavigation.ts` (9 types) |
| Push Mobile Expo | **PRÉSENT** (hors périmètre) | `/api/mobile/push-devices` + Expo |

## Surfaces déjà présentes à réutiliser

- Inbox C4 : `GET /backoffice/internal-notifications`, cloche Topbar, poll unread.
- Destinations Web : `resolveNotificationDestination()` — jamais d’URL libre.
- Sanitation tenant des cibles : `backend/lib/communicationsNavigationTargets.js`.
- Fan-out canal `PUSH` : `communicationChannelFanout.dispatchPush` (Expo aujourd’hui).
- Isolation session : `principal.sub` + `principal.schoolCode` → `school_id` (jamais depuis le client).

## Décision d’implémentation (minimum)

1. Contrat subscription Web : `endpoint` + `keys.p256dh` + `keys.auth` ; identité session uniquement.
2. Permission navigateur + `web/public/sw.js` (Chrome/Edge).
3. Table `web_push_subscriptions` scoped `user_id` + `school_id` + `backend_environment`.
4. Envoi Web Push parallèle à Expo dans `dispatchPush`, sans changer le payload Mobile.
5. Clic : `navigationTarget` allowlisté ; tout `url` / `href` arbitraire ignoré.
6. 404/410 → révocation ; `DELETE` unsubscribe.
7. Aucun secret VAPID dans le dépôt. Voir `docs/audits/web-push-operator-vapid-2026-09-14.md`.
