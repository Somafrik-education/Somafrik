# AUDIT PUSH ANNONCES & NOTIFICATIONS — HOLD CTO

**Date :** 29 septembre 2026  
**Mandat :** identifier pourquoi la chaîne Push fonctionne pour les **messages directs** mais pas pour les **annonces** ni les **notifications métier**. Aucune correction spéculative.  
**Témoin positif imposé :** le message direct Push déjà reçu sur le même appareil (Android 13, `POST_NOTIFICATIONS=granted`). Expo / FCM / OS ne sont **pas** le diagnostic.

---

## Livrable CTO

| # | Item | Valeur |
|---|---|---|
| 1 | SHA exact de `develop` audité | `97473c187ec59988460298b91a2be567ec15ccd2` (`fix(mobile): restaurer le roster Appel 1ère/2ème Primaire A (#829)`) |
| 2 | Branche utilisée | `cursor/audit-push-annonces-notifications-ddd0` |
| 3 | Architecture Push actuelle | Worker C4 unique → dispatcher → fan-out → Expo (voir §3) |
| 4 | Chaîne Message direct | Fonctionnelle — référence canonique (§4) |
| 5 | Chaîne Annonce | Câblée mais **coupée au filtrage Lot I** pour l’audience défaut « Tous » (§5) |
| 6 | Chaîne Notification métier | **Deux familles** : auto Lot I (Push possible) vs manuelle / plateforme (Push jamais appelé) (§6) |
| 7 | Premier point de divergence démontré | `resolveAllowedChannels` Lot I + `recipient_kind=school` sur store worker sans rôles (§7) |
| 8 | Cause racine avec preuves | Fichiers/lignes + 17 tests GREEN `communicationsPushWitness.audit.test.js` (§8) |
| 9 | Risques cross-tenant | Contrôlés sur le fan-out device (`school_id` + `user_id` + `APP_ENV`) ; pas de fuite dans les tests témoins |
| 10 | Tests manquants avant cet audit | Worker-shaped store (sans `listUserRoleKeys`) jamais exercé pour l’annonce « Tous » |
| 11 | Proposition de correctif minimal | Snapshot des catégories réelles à la persist C4 + fan-out `createManual` (§11) — **non appliqué** |
| 12 | Fichiers qui seraient modifiés | Voir §12 |
| 13 | Impact DB | **NON** (pas de migration ; `recipient_context` est déjà JSONB) |
| 14 | Impact Mobile | **NON** (réception / deep-link déjà câblés) |
| 15 | Impact Web | **NON** (UI Annonces / Notifications inchangée) |
| 16 | Impact Backend | **OUI** (eventSpec + `createManual` + éventuellement worker store) |

**Statut PR :** Draft / HOLD. Pas Ready. Pas de merge. Pas de déploiement.

`AUDIT TERMINÉ — HOLD CTO`

---

## 3. Architecture Push actuelle

Trois familles de contenu, **un seul** pipeline Expo :

```text
écriture métier PG
  → trigger / sweep → communication_event_outbox
  → communicationsNotificationsWorker.runOnce
       1. drainOutbox / processOneEvent
            → communication_notifications + notification_recipients  (IN_APP)
       2. dispatchProcessedEvents
            → enqueue communication_channel_deliveries PUSH|EMAIL
            → drainChannelDeliveries
                 → dispatchPush
                      → mobile_push_devices.listActiveForUser(user, school, APP_ENV)
                      → expoPushService.sendToTokens → exp.host
```

| Composant | Fichier |
|---|---|
| Worker | `backend/lib/communicationsNotificationsWorker.js` |
| Persist IN_APP | `backend/lib/communicationsNotificationsService.js` `processOneEvent` |
| Politique canaux | `backend/lib/communicationsDispatcher.js` + `backend/lib/schoolNotificationPolicy.js` |
| Fan-out Expo | `backend/lib/communicationChannelFanout.js` `dispatchPush` |
| Provider | `backend/lib/expoPushService.js` |
| Devices | `backend/db/mobilePushDevicesStore.js` |
| Boot | `backend/server.js` `startCommunicationsNotificationsWorker` + `startExpoPushReceiptsWorker` |

Le HTTP de création **ne pousse pas**. Le Push est asynchrone (poll ~5 s). Une ligne visible dans l’UI **Annonces** ou **Notifications** ne prouve pas un envoi Expo.

---

## 4. Chaîne A — Message direct (référence fonctionnelle)

```text
POST /api/backoffice/messages | conversations | conversations/:id/messages
  → communicationsMessagesService.sendOrCreate
  → INSERT school_messages
  → trigger trg_c4_message_event
  → event_type = communication.message.created
  → processOneEvent : participants actifs SAUF expéditeur
  → dispatchProcessedEvents → PUSH+EMAIL
  → listActiveForUser → Expo
  → Mobile tap : somafrikDestination=Messages + conversationId
```

Preuves clés :

- Trigger : `backend/db/communicationsNotificationsSchema.js` L93–101.
- Destinataires : `communicationsNotificationsService.js` L582–596 (`add()` exclut `actor_user_id`).
- **Hors Lot I** : `mapDispatcherEventToLotI("communication.message.created") === null` (`schoolNotificationPolicy.js` L48–58, L239–240). Seules les préférences user s’appliquent. Store worker sans `all()` ⇒ 0 ligne prefs ⇒ **tous canaux ON**.
- Expo : `communicationChannelFanout.js` L583–613.
- Test témoin GREEN : `Test 1 — Message direct → même device → sendToTokens atteint`.

C’est pourquoi le téléphone reçoit déjà les Push de messages : worker, token, `APP_ENV`, Expo et permission Android sont **vivants**.

---

## 5. Chaîne B — Annonce (défaillante sur le chemin produit défaut)

```text
POST /api/backoffice/announcements
  → communicationsAnnouncementsService.publish
  → INSERT announcements + announcement_recipients
  → trigger trg_c4_announcement_event (status=published)
  → event_type = communication.announcement.published
  → processOneEvent recopie le snapshot C3
  → dispatchProcessedEvents → Lot I ANNOUNCEMENT_PUBLISHED
  → (souvent) 0 canal PUSH → Expo jamais appelé
```

UI défaut Web **et** Mobile : `scopeType = "school"` / `audience = "Tous"` :

- `web/src/pages/AnnouncementsPage.tsx` L104, L343–344
- `Mobile/src/components/AnnouncementMutationControls.tsx` L37, L159
- Snapshot C3 : `add(..., "school", { scope: "school" })` — `communicationsAnnouncementsService.js` L309–312

C4 recopie `recipient_kind=school` et `kinds=["school"]` — `communicationsNotificationsService.js` L597–617 — **sans** résoudre PARENT/TEACHER/STUDENT/SCHOOL_ADMIN.

**Annonces plateforme** (`POST /api/backoffice/platform-announcements`) : **aucun** outbox, **aucun** fan-out. Pull UI seulement.

Une annonce **ciblée rôle `parent`** (pas « Tous ») **atteint** Expo sur le même device (test GREEN). Le trou n’est donc pas Expo : c’est l’audience établissement.

---

## 6. Chaîne C — Notifications métier

### C.1 Événements auto câblés (présence, pédagogie, finance, planning)

| event_type | Producteur | Destinataires C4 | Push policy |
|---|---|---|---|
| `attendance.student.absent` | trigger `attendance` | parents via `listParentUserIdsForStudent` | Lot I `STUDENT_ABSENT` |
| `attendance.student.late` | trigger `attendance` | parents | `STUDENT_LATE` |
| `pedagogy.grade.published` | trigger `grades` | parents + élève user | `GRADE_PUBLISHED` |
| `pedagogy.report_card.published` | trigger `report_cards` | parents + élève user | `REPORT_CARD_PUBLISHED` |
| `finance.payment.recorded` | trigger `payments` | parents | `PAYMENT_RECEIVED` |
| `finance.payment.due` | sweep worker | parents + admins | `PAYMENT_DUE` |
| `planning.timetable.changed` | trigger weekly slots **UPDATE** (pas INSERT) | enseignants + admins | `TIMETABLE_CHANGED` |
| `planning.teacher.replacement` | fonction dédiée | enseignants, parents classe, admins | `TEACHER_REPLACEMENT` |

`recipient_kind` canonique (`parent` / `teacher` / …) **n’a pas besoin** de `user_roles` au fan-out. Sur le store worker réel, **Test 3 GREEN** : absence → même device → `sendToTokens` atteint.

Si un parent témoin ne reçoit pas ces Push, la cause n’est **pas** le même trou que l’annonce « Tous ». Causes restantes, **données** (non vérifiables ici, `DATABASE_URL` absent) :

- `contacts.user_id` NULL / autre compte que celui du DM ;
- 0 destinataire → outbox marqué `processed` **sans** notification (`processOneEvent` L873–898) ;
- statut présence `excused` / `justifié` : **pas** d’event (`toAttendanceStatus` + trigger absent/late seulement).

### C.2 Notification créée dans l’UI « Nouvelle notification »

`POST /api/backoffice/internal-notifications` → `createManual` :

- persist IN_APP uniquement ;
- **aucun** outbox, **aucun** `dispatchProcessedEvents` ;
- `notification.manual` **absent** de `EVENT_EXTERNAL_CHANNEL_POLICY` ;
- payload Web/Mobile = `{ title, body, attachmentIds }` → audience défaut **school** (même kind que l’annonce Tous).

L’inbox C4 affiche la ligne (lecture via `tx` qui **a** `listActiveUserRoleKeysForSchool`). L’appareil ne reçoit rien.

### C.3 Catalogue plateforme `notifications`

Hors chaîne C4. Pas de Push.

---

## 7. Diff fonctionnel (Message direct vs Annonce vs Métier)

| Étape | Message direct | Annonce (Tous) | Notification métier auto | Notification métier manuelle | Écart |
|---|---|---|---|---|---|
| Événement déclenché | `communication.message.created` | `communication.announcement.published` | Lot I (absent, note, paiement, …) | **aucun outbox** | Manuel : pas d’event |
| Fonction Push appelée | `dispatchPush` → `sendToTokens` | **non** (0 delivery PUSH) | `sendToTokens` si destinataire kind canonique + device | **jamais** | Annonce Tous / manuel |
| After-commit | trigger PG + worker ~5 s | idem | idem | HTTP sync IN_APP only | |
| `school_id` | message.school_id | announcement.school_id | source.school_id | school session | OK |
| `user_id` Push | participant conversation | snapshot `announcement_recipients` | `listParentUserIdsForStudent` / enseignants / admins | `listSchoolActiveUserIds` | DM ≠ parents contacts |
| Rôle destinataire | `participant` (hors Lot I) | **`school`** | `parent`/`teacher`/… | **`school`** | Lot I fail-closed |
| Résolution parent/enseignant | non requise | **requise au fan-out, échoue** | figée à la persist | figée `school` | |
| Device / token / plateforme / env | `listActiveForUser` | jamais atteint | atteint si delivery créée | jamais | |
| Déduplication | `event_key` + `delivery_key` | idem | idem | `notification.manual:school:idempotency` | |
| Préférence user | défaut ON (store sans `all`) | non évaluée (canaux déjà []) | défaut ON | n/a | |
| Filtre école Lot I | **non mappé** | `ANNOUNCEMENT_PUBLISHED` | mappé | n/a | **1er écart structurel** |
| Payload titre/body | « Nouveau message » | « Nouvelle annonce » + titre | spécifique événement | titre/body saisis | |
| `data` / deep-link | Messages + conversationId | Announcements + id **si** envoyé | Home (sauf finance_obligation) | n/a | Métier auto : tap Home |
| Appel Expo | oui | non (Tous) | oui si kind canonique | non | |
| Ticket / erreur Expo | tickets + receipts worker | n/a | idem DM | n/a | |

**Premier point de divergence démontré (après le témoin DM) :**

1. Structurel : `communication.message.created` n’est pas Lot I ; annonce + métier auto le sont (`schoolNotificationPolicy.js` L48–58, L235–259).
2. Fonctionnel produit : l’annonce défaut écrit `recipient_kind=school` ; le worker résout les catégories sur la **façade** `getClientsStore()` qui n’expose ni `all` ni `listActiveUserRoleKeysForSchool` (`clientsPgStore.js` façade ~L1590 ; worker L10–12, L33–38). `resolveAllowedChannels` avec `recipientCategories=[]` **retourne `[]`** (L248–249) y compris PUSH.

Les tests historiques passaient un adapter mémoire avec `listUserRoleKeys` : ils **masquaient** le trou de production.

---

## 8. Cause racine — preuves

### 8.1 Annonces « Tous » — Push jamais préparé

```248:259:backend/lib/schoolNotificationPolicy.js
  if (explicitCats) {
    if (!explicitCats.length) return [];
    return CHANNELS.filter((channel) => {
      if (!user.has(channel)) return false;
      return explicitCats.some((cat) => events[lotI]?.[cat]?.[channel] !== false);
    });
  }
  // ...
      if (isSchoolWideRecipientKind(recipient)) return [];
```

```33:38:backend/lib/communicationsNotificationsWorker.js
    await dispatchProcessedEvents({
      store,          // = getClientsStore() façade
      repository,
      processed,
      logger,
    });
```

Test : `GAP Annonce — audience établissement (kind=school) via store worker n'atteint PAS sendToTokens`  
Contrôle positif : `Annonce rôles (kind=parent) via store worker ATTEINT sendToTokens — même device`

### 8.2 Notifications métier UI — Push jamais branché

```451:519:backend/lib/communicationsNotificationsService.js
async function createManual(...) {
  // INSERT communication_notifications + notification_recipients
  // pas d'outbox, pas de dispatcher
}
```

Test : `Notification métier manuelle (createManual) n'appelle jamais le dispatcher`  
+ `createManual audience défaut = school`

### 8.3 Ce qui n’est PAS la cause

- Permission Android / AppOps — DM reçu sur le même téléphone.
- Expo / FCM globalement cassés — `sendToTokens` atteint pour DM et pour absence parent.
- Token inactif / mauvais `APP_ENV` — même device témoin dans les trois tests.
- Absence de trigger annonce — l’outbox et l’IN_APP C4 existent ; c’est le **fan-out PUSH** qui est filtré.

### 8.4 Catch silencieux (observabilité)

| Site | Comportement |
|---|---|
| `communicationsNotificationsWorker.runOnce` L40–44 | log + `return []` |
| `drainOutbox` L923–927 | log + continue |
| `fanOutNotificationChannels` L762–766 | log + `return []` — **outbox déjà `processed`, pas de retry fan-out** |
| `dispatchPush` sans device | `skipped: no_active_devices` (pas d’erreur) |
| Worker interval | `void runOnce(...)` |

Une erreur Push ne rollback ni le message, ni l’annonce, ni la notification IN_APP. C’est voulu. En revanche un skip Lot I ne laisse **aucune** ligne `communication_channel_deliveries`.

---

## 9. Risques cross-tenant

Contrôles existants (conservés, tests GREEN) :

- devices : `user_id` + `school_id` + `backend_environment` (`mobilePushDevicesStore.listActiveForUser`, `scopedDevices`) ;
- parents métier : JOIN `contacts.user_id` **et** `users.school_id = students.school_id` (`listParentUserIdsForStudent`) ;
- enseignants planning : JOIN `users.school_id = teachers.school_id` (`resolveTenantTeacherUserId`) ;
- delivery unique `event_key:user_id:CHANNEL`.

Le correctif proposé (§11) doit **rester** dans ce cadre : résoudre les rôles **dans l’école de l’événement**, jamais `listActiveUserRoleKeys` global.

---

## 10. Tests manquants (avant cet audit) / ajoutés

Manquait : un témoin **même user / même device / chemin worker réel** (façade sans `listUserRoleKeys`).

Ajoutés dans `backend/lib/communicationsPushWitness.audit.test.js` (17 tests GREEN) :

1. Message direct → Push envoyé  
2. Annonce Tous → Push **non** envoyé (GAP prouvé)  
3. Annonce parent → Push envoyé  
4. Absence parent → Push envoyé  
5. `createManual` sans dispatcher + audience school  
6. aucun device / token révoqué / mauvais tenant / non destinataire / multi-devices / multi-destinataires / échec provider / pas de fuite école B  
7. plateforme annonces sans câblage Push  

Branché dans `backend/scripts/verify-communications-c4.js`.

Encore manquant (hors périmètre HOLD, à faire **avec** le correctif) :

- PG HTTP bout-en-bout : `POST /announcements` audience Tous → ligne `communication_channel_deliveries` PUSH + mock Expo ;
- PG : `createManual` → delivery PUSH ;
- preuve `listParentUserIdsForStudent` vs participant DM sur un user réel (lecture prod).

---

## 11. Proposition de correctif minimal (NON appliqué)

Ordre recommandé, une PR GREEN dédiée après autorisation CTO :

1. **Annonce / manuel school-wide** — dans `eventSpec` et `createManual`, tant que `tx.listActiveUserRoleKeysForSchool` est disponible, remplacer `kinds: ["school"]` par les catégories Lot I réelles du user (`PARENT` / `TEACHER` / …). Fail-closed si 0 catégorie. Le fan-out n’a plus besoin de relire `user_roles` sur la façade.
2. **`createManual`** — après persist, appeler `dispatchProcessedEvents` (ou insérer un outbox `notification.manual` + policy PUSH+EMAIL). Sans (1), le fan-out resterait fail-closed pour l’audience défaut.
3. **Défense en profondeur** — `runOnce` passe `store.bind({})` (ou un store exposant `listActiveUserRoleKeysForSchool`) au dispatcher. Ne pas s’y limiter : le snapshot (1) rend la politique déterministe.
4. **Observabilité minimale** (log sans token) : `event_key`, `event_type`, `user_id` hashé/tronqué, `school_id`, `recipient_kind`, `categories[]`, `channels[]`, `skip_reason` (`lot_i_no_categories` / `no_active_devices` / `prefs_off`), `delivery_id`, `ticket_status`. Réutiliser `/communications/deliveries/health`.

Ne **pas** : rotation Expo/FCM, migration destructive, toucher le chemin DM.

---

## 12. Fichiers qui seraient modifiés (correctif futur)

| Fichier | Rôle |
|---|---|
| `backend/lib/communicationsNotificationsService.js` | snapshot catégories ; fan-out `createManual` |
| `backend/lib/communicationsDispatcher.js` | éventuellement `notification.manual` dans la policy |
| `backend/lib/communicationsNotificationsWorker.js` | passer un store bound |
| `backend/lib/communicationsPushWitness.audit.test.js` | inverser le test GAP Annonce → Push envoyé |
| `backend/lib/communicationsC4.http.pg.test.js` | POST annonce Tous + manuel → delivery PUSH |

**Non touchés :** Mobile, Web, migrations, `expoPushService`, `mobile_push_devices`.

---

## 13–16. Impacts

| Surface | Impact correctif | Commentaire |
|---|---|---|
| DB | **NON** | Pas de nouvelle table. `recipient_context` JSONB existant. |
| Mobile | **NON** | Destinations `Announcements` / `Home` déjà mappées. |
| Web | **NON** | Audience « Tous » inchangée côté UI. |
| Backend | **OUI** | Persist C4 + worker + tests. |

---

## Phase 5 — Base de données (lecture seule)

`DATABASE_URL` / `PREPROD_DATABASE_URL` **absents** de cet environnement. Aucune requête exécutée. Aucune mutation.

Checklist **lecture seule** à jouer en préprod/prod sur le **même `user_id`** que le DM reçu :

```sql
-- 1–6. Témoin device (ne jamais sélectionner expo_push_token en clair dans un ticket)
SELECT d.user_id, d.school_id, d.platform, d.backend_environment, d.app_profile,
       left(md5(d.expo_push_token), 8) AS token_hash8,
       d.revoked_at, d.updated_at
FROM mobile_push_devices d
WHERE d.user_id = :user_id AND d.revoked_at IS NULL;

SELECT ur.role_key, ur.school_id, ur.status
FROM user_roles ur
WHERE ur.user_id = :user_id AND ur.revoked_at IS NULL;

-- 7. Annonce récente vs C4 vs PUSH
SELECT a.id, a.title, a.status, r.recipient_kind, r.audience_reason
FROM announcements a
JOIN announcement_recipients r ON r.announcement_id = a.id
WHERE r.user_id = :user_id
ORDER BY a.published_at DESC NULLS LAST
LIMIT 20;

SELECT n.event_key, n.event_type, r.recipient_kind, r.recipient_context
FROM communication_notifications n
JOIN notification_recipients r ON r.notification_id = n.id
WHERE r.user_id = :user_id
  AND n.event_type IN ('communication.announcement.published', 'notification.manual')
ORDER BY n.created_at DESC
LIMIT 20;

SELECT delivery_key, channel, status, last_error, sent_at
FROM communication_channel_deliveries
WHERE user_id = :user_id AND channel = 'PUSH'
ORDER BY created_at DESC
LIMIT 50;

-- 8. Métier auto : destinataire parent lié ?
SELECT c.id AS contact_id, c.user_id AS contact_user_id, r.student_id
FROM contacts c
JOIN contact_relations r ON r.contact_id = c.id AND r.status = 'active'
WHERE c.user_id = :user_id;
```

Attendu si le diagnostic code est juste :

- une delivery PUSH `communication.message.created:…` `status=sent` ;
- une notification C4 annonce `recipient_kind=school` **sans** delivery PUSH ;
- une `notification.manual` **sans** delivery PUSH.

---

## Phase 6 — Observabilité actuelle vs minimale

Aujourd’hui on peut inférer, **si** une delivery existe : pending / processing / sent / failed / skipped / dead_letter (`communication_channel_deliveries` + `/api/backoffice/communications/deliveries/health`).

On **ne peut pas** distinguer sans SQL ad hoc :

```text
notification créée
destinataire résolu
device trouvé
push préparé          ← 0 ligne si Lot I retourne []
push envoyé à Expo
ticket Expo accepté   ← receipts worker, pas inline
ticket Expo rejeté
receipt Expo
notification reçue    ← côté OS, hors backend
```

Proposition (correctif futur, logs sans token) : un événement structuré `[c4-push]` par destinataire avec `skip_reason` et `token_hash8`. Ne jamais logger `ExponentPushToken[…]`.

---

## Conclusion

Les Push Somafrik **ne sont pas globalement cassés**. Le message direct prouve worker + Expo + device.

Les annonces produit (audience **Tous**, défaut UI) et les notifications créées dans l’écran **Nouvelle notification** n’appellent pas Expo : filtrage Lot I fail-closed sur `kind=school` sans rôles (annonces), et absence totale de fan-out (`createManual`).

Les événements métier **auto** avec kind canonique (`parent`, etc.) atteignent Expo dans le code actuel. Un écart terrain restant est un écart **données destinataire**, pas un second bug Expo.

Correctif : snapshot des catégories à la persist + brancher `createManual` sur le dispatcher. Backend only. Pas de migration. Pas de Mobile. Pas de Web.

**Pas Ready. Pas merge. Pas déployer.** Diff GitHub indépendant CTO requis.

`AUDIT TERMINÉ — HOLD CTO`
