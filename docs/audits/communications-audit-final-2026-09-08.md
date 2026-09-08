# AUDIT-COM-FINAL — Communications avant GO production

**Date :** 8 septembre 2026  
**Baseline exclusive :** `develop@a9400c26acd89d102b551edad8025df37efc325e` (merge #562 Lot K)  
**Branche :** `cursor/communications-audit-final-3171`  
**Périmètre :** docs + tests d’inventaire. **Aucune modification métier.**

STOP : PR Draft. Pas de GREEN dans cette PR. Pas `main`. Pas Render. Pas production.

Si un P0/P1 d’envoi ou d’isolation apparaît plus tard, GREEN séparé depuis `origin/develop`.

---

## 0. Verdict CTO (lire en premier)

| Question | Verdict |
|---|---|
| Chaîne Lots H → K cohérente ? | **Oui** |
| P0 (envoi double, fuite tenant, PII diagnostic, SMS/WhatsApp) | **Aucun** |
| P1 bloquant l’envoi C4 / isolation pays / idempotence | **Aucun** |
| **Communications domaine** | **GO** — intégrable au plan global GO production |
| Promotion `main` / Render | **HOLD** — hors de cette PR ; seulement après GO global Somafrik |

Les P2 et la dette acceptée sont listés en §8. Ils ne justifient pas un HOLD du domaine Communications.

---

## 1. Chaîne mergée (H → K)

| Lot | PR GREEN | Objet |
|---|---|---|
| A/B | #544 / #545 | Expo tenant + fan-out découplé |
| C | #547 | EMAIL reset mot de passe |
| D | #549 | Dispatcher unique |
| H / E | #551 | Préférences utilisateur |
| I | settings école | Politique établissement AND |
| G | trial SMTP | EMAIL essai durable |
| J / F | #560 | Inbox C4 vs catalogue B ; KPI C4 |
| K | #562 | Retry, `dead_letter`, reclaim, diagnostic |

`develop` actuel = merge #562. RED historiques **#552** et **#554** : fermés **sans merge**.

---

## 2. Architecture des 4 familles (distinctes)

```text
Événement métier
→ communication_event_outbox
→ processOneEvent (IN_APP : communication_notifications + notification_recipients)
→ worker drainOutbox
→ dispatchProcessedEvents (unique caller)
→ fanOutNotificationChannels
     PUSH = Expo + FCM (jamais Brevo)
     EMAIL = SMTP / Brevo-as-SMTP
```

| Famille | SoT | Inbox Web | Mobile |
|---|---|---|---|
| **C4** | `communication_notifications` + recipients | `/notifications` | `InternalNotifications` si contexte école |
| **B plateforme** | `notifications` | `/notifications-plateforme` | `PlatformNotifications` si contexte `*` |
| **C3 école** | `announcements` + recipients | `/annonces` (API école) | `Announcements` (C3) |
| **Annonces plateforme** | `platform_announcements` | `/annonces` (branche plateforme) | même écran, API distincte |

C3 `announcement.published` **pointe** vers l’inbox C4 ; ce n’est pas une fusion des SoT.

`processOneEvent` reste sans Expo/SMTP (`AUDIT-COM-01`).

---

## 3. PUSH / EMAIL — pas de second chemin d’envoi C4

| Surface | Envoi fournisseur |
|---|---|
| Fan-out C4 | `communicationChannelFanout.js` uniquement |
| Dispatcher | délégation, **aucun SDK** |
| Reset mot de passe | `ensureDelivery` EMAIL → **même drain** |
| Essai SMTP | `ensureDelivery` EMAIL → **même drain** |
| Self-test Expo | `sendSelfTest` — hors C4 deliveries |
| `unpaidService` | écrit **catalogue B mémoire**, pas Expo/SMTP |

`AUDIT-COM-05` : unique `await fanOutNotificationChannels` runtime = dispatcher ; unique `dispatchProcessedEvents` = worker.

Canaux fan-out : `PUSH`, `EMAIL` seulement. SMS / WhatsApp / Twilio / SDK Brevo : absents du fan-out.

---

## 4. Destinataires → prefs → école → deliveries

1. Recipients C4 (`recipient_kind` + `recipient_context.kinds`).
2. Prefs `user_communication_preferences` (défaut = tout allumé).
3. Lot I `school_notification_settings` **AND** prefs pour les eventTypes mappés.
4. `auth.password.reset` : EMAIL **mandatory** (bypass prefs/école, enqueue dédié).
5. `delivery_key` UNIQUE ; `claimDue` `pending`/`failed` SKIP LOCKED ; `MAX_ATTEMPTS=8` ; backoff 5 s → 15 min ; `dead_letter` à l’épuisement.
6. Reclaim : `dispatch_started_at IS NULL` → `failed` / `stale_lease_reclaimed` ; sinon skip at-most-once.

---

## 5. RBAC / isolation

| Rôle | Diagnostic deliveries |
|---|---|
| Superadmin | global |
| Admin Pays | **un seul** iso parmi `countryCode` / `countryScope` / `platformContext.countryCode` ; `CD`+`BI` → 403 ; JOIN `schools`/`countries.iso_code` |
| Admin School | `school_id` / `effectiveSchoolId` ; absent → 403 |
| Parent / autres | 403 |

Expo : `user_id + school_id + backend_environment`. EMAIL tenant : email user+school, `payload.to` ignoré.

---

## 6. PII

`summarizeChannelDeliveryHealth` : compteurs, tentatives, `last_error` sanitizé. Pas d’email, token Expo, payload, `delivery_key`.  
Logs fan-out : `eventKey` / UUID / `message` tronqué — pas le body.

---

## 7. Migrations / boot

Appliquées via `ensureClientsCanonicalBootstrap` → `applyCommunicationsC4Schema` (`COMMUNICATIONS_C4_SCHEMA_SQL`).

Migrations : C4 `20260828`, deliveries `20260907`, reliability `20260908`, prefs `20260910`, trial EMAIL `20260911`, école `20260912`.

---

## 8. Matrice P0 / P1 / P2 / dette acceptée

### P0 — aucun

### P1 — aucun (envoi / isolation / idempotence)

### P2 — connus, non bloquants

| ID | Résidu |
|---|---|
| **P2-K-WINDOW** | Crash entre `markDispatchStarted` et Expo/SMTP → `skipped`, envoi éventuellement perdu (at-most-once). |
| **P2-PREFS-FAIL-OPEN** | Erreur de lecture prefs non `*_unavailable` → enqueue des canaux politique. |
| **P2-HEALTH-SCHOOL** | Diagnostic Admin School exige `schoolId` / `effectiveSchoolId` (souvent via scope requête) ; JWT `schoolCode` seul → 403. Superadmin / Admin Pays OK. |
| **P2-LOT-I-MAP** | Tous les eventKeys Lot I ne sont pas mappés C4 (`STUDENT_LATE`, `PAYMENT_DUE`, …) : pas d’AND école sur ces absences. |

### Dette acceptée (volontaire)

| Item | Motif |
|---|---|
| Table `notifications` + `/notifications-plateforme` | Catalogue B distinct de l’inbox C4 |
| C3 + `platform_announcements` | Deux SoT annonces |
| `unpaidService` → `state.notifications` | Relance impayé ≠ `finance.payment.recorded` ; pas d’Expo/SMTP |
| `dispatchCommunication` | Entrée tests ; production = worker uniquement |
| Types UI `sms`/`whatsapp` relances | Catalogue B ; aucun Twilio dans le fan-out |

---

## 9. Parcours Web / Mobile

- Web établissement : `/notifications` = `InternalNotificationsCenter` (C4).
- Web plateforme : `/notifications-plateforme`.
- Topbar : école active → C4 ; `*` → catalogue.
- Mobile : `resolveNotificationsInboxRoute(session, activeSchoolCode)`.
- KPI « Alertes à traiter » : unread C4, pas `state.notifications`.
- Paiement enregistré : plus d’injection catalogue B (`J-01`).

---

## 10. GO production Communications — conditions

1. Ce HEAD d’audit (docs/tests) peut être mergé en Draft→Ready **sans** changer le runtime.
2. **Ne pas** merger vers `main` depuis cette PR.
3. Intégrer Communications au **plan global GO production** seulement avec ce verdict GO domaine.
4. P2-K-WINDOW reste à citer dans le GO global (compromis at-most-once).

Tests de gel : `backend/lib/communicationsAuditFinal.test.js` (`AUDIT-COM-FINAL-*`).
