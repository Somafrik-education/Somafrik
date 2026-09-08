# PR F — Audit RED : consolidation progressive legacy notifications / annonces

**Date :** 8 septembre 2026  
**Branche :** `cursor/communications-legacy-red-3171`  
**Base :** `origin/develop` après merge #551 (`0c2cba7509fefd2eee593bdf45c0968d8aa94e56`)  
**Périmètre :** audit + tests + documentation. Aucune suppression métier. Aucune migration. Aucun changement Web/Mobile. Pas Ready. Pas merge. Pas main. Pas Render.

STOP obligatoire après ce livrable. La future PR GREEN F **repart de `develop`**, jamais de ce HEAD RED.

---

## 0. Synthèse CTO (lire en premier)

Deux familles **parallèles et vivantes**, plus deux familles d’annonces **distinctes par conception**. Ce n’est pas un silo unique mal nommé : ce sont quatre sources, dont deux partagent le mot « notifications ».

```text
Famille A — inbox opérationnelle établissement
  table   communication_notifications + notification_recipients
  API     /api/backoffice/internal-notifications*
  événements C4 (outbox) → IN_APP puis dispatcher #549 → PUSH Expo / EMAIL SMTP

Famille B — catalogue broadcast plateforme
  table   notifications
  API     /api/backoffice/notifications
  service communicationService.js + platformService.createNotification
  RBAC    ALL_PRIVILEGES | COUNTRY_PRIVILEGES

Famille C — documents annonce établissement (C3)
  tables  announcements + announcement_recipients + announcement_reads
  API     /api/backoffice/announcements*

Famille D — documents annonce plateforme
  tables  platform_announcements + platform_announcement_recipients + platform_announcement_reads
  API     /api/backoffice/platform-announcements*
```

Pas de fusion globale. Canonique recommandé (GREEN ultérieur, pas ici) :

| Famille | Source gelée | Interdit |
|---|---|---|
| A inbox école | C4 | recoller sur `notifications` |
| B catalogue plateforme | `notifications` jusqu’à migration dédiée | absorber dans C4 sans contrat UI |
| C documents école | C3 | supprimer le pointeur inbox C4 sans produit |
| D documents plateforme | `platform_announcements` | fusionner avec C3 (`school_id` obligatoire) |

**Quatre RED légitimes** (preuves source, attendus rouges jusqu’au GREEN F) :

| ID | Trou | Preuve |
|---|---|---|
| **RED-COM-06A** | Double destination pour `finance.payment.recorded` | C4 persiste l’événement ; `paymentWorkflow.ts` injecte encore une `PlatformNotification` dans `state.notifications` |
| **RED-COM-06B** | Web lit encore le legacy sur la surface « Notifications » | `NotificationsPage` mélange C4 et `platformApi` ; `getLiveKpis` école compte `state.notifications` |
| **RED-COM-06C** | Mobile préfère le catalogue legacy | `HomeScreen` route le CTA vers `PlatformNotifications` dès que le privilège plateforme existe |
| **RED-COM-06E** | Unread école peut diverger | Topbar école = C4 `unread-count` ; KPI « Alertes à traiter » = `status === "Non lu"` sur le dataset legacy |

**Non-RED (ne pas inventer) :**

| Candidat | Pourquoi ce n’est pas un trou |
|---|---|
| **06D** | Une annonce école a **deux mécanismes voulus** : document C3 + pointeur C4 `communication.announcement.published`. L’écran `/annonces` fusionne C3 + plateforme **avec tag `source`**. Ce n’est pas la même ligne dupliquée sans origine. |
| **06F** | `POST /backoffice/notifications` écrit hors C4 **parce que** c’est encore la famille B. Ce n’est pas un writer opérationnel école. Le migrer = étape C du plan, pas un défaut caché. |

**Conservation déjà GREEN (ne pas recasser) :** #544 tenant PUSH, #545 fan-out, #547 reset EMAIL, #549 dispatcher, #551 préférences, C1/C2/C3/C4, Platform Announcements, RBAC, isolation tenant, idempotence `delivery_key`.

Architecture fournisseur inchangée : PUSH = Expo + FCM ; EMAIL = SMTP / Brevo-as-SMTP ; Brevo jamais pour PUSH.

---

## 1. Cartographie complète des silos

```text
Événement métier école
→ transaction
→ communication_event_outbox
→ processOneEvent → communication_notifications + notification_recipients
→ dispatcher mince → fan-out PUSH/EMAIL
→ Web InternalNotificationsCenter / Mobile InternalNotificationsScreen

Catalogue Superadmin / Admin Pays
→ POST /api/backoffice/notifications
→ INSERT notifications
→ DataContext.notifications / AdminDataContext.notificationsData
→ NotificationsPage (mode plateforme) / PlatformNotificationsScreen

Annonce établissement
→ POST /api/backoffice/announcements
→ announcements + recipients + reads
→ trigger C4 communication.announcement.published (pointeur inbox)
→ Web AnnouncementsPage (source=school) / Mobile AnnouncementsScreen

Annonce plateforme Superadmin
→ POST /api/backoffice/platform-announcements
→ platform_announcements*
→ Web AnnouncementsPage (source=platform, même liste taguée)
→ PAS de outbox C4
```

`communicationService.js` reste un filtre/enrich in-memory du catalogue B. `getScopedNotifications` / `getUnreadCount` ne sont plus appelés hors définition : dead code, suppression **après** extinction des readers B.

---

## 2. Tables PostgreSQL

| Table | Famille | SoT actuelle |
|---|---|---|
| `notifications` | B | catalogue plateforme (school_id nullable, channel défaut `app`) |
| `communication_event_outbox` | A | file d’événements C4 |
| `communication_notifications` | A | inbox in-app |
| `notification_recipients` | A | read/archive par destinataire |
| `communication_channel_deliveries` | A | PUSH/EMAIL durables |
| `user_communication_preferences` | A | #551 |
| `announcements` | C | document école (`school_id NOT NULL`) |
| `announcement_recipients` / `announcement_reads` | C | ciblage + unread C3 |
| `platform_announcements` | D | document plateforme (pas de school_id obligatoire) |
| `platform_announcement_recipients` / `_reads` / `_attachments` | D | ciblage + unread plateforme |

C4 **n’ouvre jamais** `FROM notifications` / `INTO notifications` (`verify-communications-c4` + `AUDIT-COM-06-MAP-E`).

---

## 3. APIs et routes

**Écriture famille B (legacy) :**

- `GET/POST /api/backoffice/notifications`
- `PATCH /api/backoffice/notifications/:notificationId`

**Lecture/écriture famille A (C4) :**

- `GET /api/backoffice/internal-notifications`
- `GET /api/backoffice/internal-notifications/unread-count`
- `POST /api/backoffice/internal-notifications` (manuel scoped)
- `PATCH .../read` et `.../archive`
- pièces jointes

**C3 / D :** `/api/backoffice/announcements*` et `/api/backoffice/platform-announcements*` (list, get, unread-count, read, archive, attachments).

RBAC déjà séparé : catalogue B = privilèges plateforme ; C4 = `Notifications:READ` ; un Admin School **n’hydrate pas** le domaine DataContext `notifications` (`domainPermissions.ts`).

---

## 4. Writers

| Writer | Destination | Famille |
|---|---|---|
| triggers SQL C4 (message, announcement, absence, note, paiement) | outbox → C4 | A |
| `processOneEvent` | `communication_notifications` + recipients | A |
| `passwordResetNotification` #547 | `communication_channel_deliveries` EMAIL | A (auth) |
| `platformService.createNotification` | `INSERT INTO notifications` | B |
| seed `postgresRepository` / `seed-platform-bulk` | `INSERT INTO notifications` | B |
| `paymentWorkflow.ts` | **mémoire Web** `state.notifications` | **trou 06A** |
| `communicationsAnnouncementsService` | `announcements*` + trigger C4 | C + pointeur A |
| `platformAnnouncementsService` | `platform_announcements*` | D, hors C4 |

---

## 5. Readers

| Reader | Source |
|---|---|
| `communicationsNotificationsService.list/unreadCount/get` | A |
| `GET /backoffice/notifications` + `listPlatformProjection` | B |
| `CommunicationService.enrich/filterByAudience` | B (in-memory) |
| `scopedNotifications` / `domainLoaders.notifications` | B |
| `getLiveKpis` école « Alertes à traiter » | B **alors que le badge est A** |
| `dashboardChartPeriod` (KPI pays « Notifications ») | B, cohérent avec la famille B |
| C3 unread-count / `announcementsApi` | C |
| `platformAnnouncementsApi` | D |
| `useAnnouncementsUnreadCount` | **C + D additionnés** (un badge, deux familles, taguées) |

---

## 6. Consumers Web

| Surface | Comportement actuel |
|---|---|
| `/notifications` + école | `InternalNotificationsCenter` (C4) |
| `/notifications` + plateforme (`*` / pas d’école) | CRUD `platformApi` sur table `notifications` |
| Topbar cloche | école → C4 unread ; plateforme → `scopedNotifications` status ≠ Lu |
| `/annonces` | liste unifiée C3 + D, `source: school \| platform` |
| Dashboard KPI école | encore B (`getLiveKpis`) |
| `/parametres/notifications` | ComingSoon (inchangé, hors F) |
| `paymentWorkflow` | writer mémoire B |

---

## 7. Consumers Mobile

| Surface | Comportement actuel |
|---|---|
| `InternalNotificationsScreen` | C4 |
| `PlatformNotificationsScreen` | `GET /backoffice/notifications` (B), gated privilège plateforme |
| `HomeScreen` CTA Notifications | **B d’abord** si `canReadView(PlatformNotifications)` |
| `CommunicationHeaderIcons` / `MobileAppHeader` | école → C4 ; hors école → B |
| Drawer school_admin | InternalNotifications seulement (déjà GREEN) |
| Drawer superadmin | les deux routes, volontaire |
| `AnnouncementsScreen` | snapshot canonique C3 + D (`announcement.source`) |

---

## 8. Unread / read

```text
École, cloche Web/Mobile     → GET internal-notifications/unread-count
                               PATCH .../read  (recipient.read_at)
Catalogue B                  → PATCH /backoffice/notifications/:id  (status Lu)
C3                           → PATCH /announcements/:id/read
Plateforme D                 → PATCH /platform-announcements/:id/read
Badge Annonces Web           → C3.count + D.count
KPI école « Alertes »        → state.notifications Non lu   ← 06E
Paiement Web optimistic       → Non lu local                 ← 06A + 06E
```

Pas de double **badge cloche** : un seul compteur, branché selon le scope. La divergence est **KPI / optimistic vs cloche**, pas deux pastilles.

---

## 9. Announcement flow

1. Publish C3 → document + recipients + **un** event outbox `communication.announcement.published`.
2. C4 crée une notification « Nouvelle annonce » avec `navigationTarget.announcementId`.
3. L’utilisateur voit le document dans `/annonces` **et** un item inbox C4. C’est un pointeur, pas une seconde table document.
4. Publish plateforme → famille D uniquement. Pas d’outbox C4.

---

## 10. Doublons réels

| Cas | Doublon ? | Action GREEN |
|---|---|---|
| Paiement → C4 + `state.notifications` | **oui** | supprimer l’injection Web (06A) |
| Même route `/notifications` C4 + CRUD B | **oui, UX** | scinder les routes (06B) |
| Home Mobile C4 vs catalogue | **oui, routage** | C4 d’abord si lisible (06C) |
| KPI vs unread C4 | **oui, compteur** | KPI école lit C4 ou abandonne les notifs B (06E) |
| C3 + item C4 « Nouvelle annonce » | non (pointeur) | conserver |
| Liste `/annonces` C3+D | non (tag `source`) | conserver |
| Catalogue B vs C4 pour un grade/absence | **non en PG** : C4 n’écrit pas `notifications` | — |

---

## 11. Risques

| ID | Sévérité | Risque |
|---|---|---|
| 06A / 06E | **P1** | Un admin école croit qu’une alerte paiement n’est pas lue (KPI) alors que C4 est lu, ou l’inverse après optimistic Web |
| 06C | **P1** | Superadmin / privilège plateforme avec école ouverte n’ouvre pas l’inbox C4 depuis Home |
| 06B | **P1** | Même URL Web = deux produits ; régression UI si on « nettoie » sans scinder |
| Fusion C3 ↔ D | **P0 si GREEN mal cadré** | casse Platform Announcements et `school_id NOT NULL` |
| Suppression table `notifications` trop tôt | **P0** | casse Web mode plateforme + Mobile `PlatformNotifications` + seed |
| Pointer C4 announcement retiré trop tôt | **P1** | casse le contrat C4-02 / inbox « nouvelle annonce » |
| PR G avant F | P2 | SMTP essai reste un silo, mais hors notifications user |

**P2 :** `communicationService.js` / `getScopedNotifications` morts ; seed `platformNotifications` avec `school_id` du seed.

---

## 12. RED légitimes

Fichiers : `backend/lib/communicationsLegacy.red.test.js` (attendu rouge) + `backend/lib/communicationsLegacy.audit.test.js` (vert, inventaire).

`verify:communications-c4` exécute l’inventaire puis les RED. Le job C4 de cette Draft **doit rester rouge** sur 06A/06B/06C/06E.

---

## 13. Tests GREEN existants réutilisés (ne pas casser)

- `communicationsC4.http.pg.test.js` (C4-01…C4-16, dont announcement.published idempotent)
- `communicationsC3.http.pg.test.js`
- `verify-platform-announcements.js` / `announcementsPlatform.test.ts`
- `web/src/lib/internalNotificationsC4.test.ts`
- `Mobile/src/lib/internalNotificationsC4.test.ts`
- `communicationsGlobalArchitecture.audit.test.js` (#544/#545)
- `communicationsDispatcher*.test.js` / `communicationsPreferences*.test.js`
- `web/src/lib/rbacParity.schoolAdmin.test.ts` (H : école ≠ GET `/notifications`)
- `web/src/lib/scope.otherDomains.audit.test.ts` (#456 catalogue B)
- `communicationsChannelFanout.red-com-01.test.js`
- `communicationsPasswordReset.red.test.js`

Le GREEN F devra rejouer **exactement** ces périmètres, plus les 4 RED une fois retournés au vert, plus Web build et Mobile `tsc`.

---

## 14. Plan de migration par étapes (GREEN futur, hors cette PR)

**A. Figer une source canonique par famille** (doc + gardes, pas de drop)

- A = C4, B = `notifications`, C = C3, D = platform_announcements.
- Interdire tout nouveau writer opérationnel vers `state.notifications` / table `notifications`.

**B. Migrer les lecteurs** (contrat UI inchangé)

1. `paymentWorkflow` : ne plus patcher `notifications`.
2. `getLiveKpis` école : ne plus compter le dataset B (0, ou unread C4 si un appel existe déjà).
3. Scinder Web : `/notifications` = C4 uniquement ; catalogue B sur une route plateforme dédiée.
4. Mobile Home : CTA « Notifications » → InternalNotifications dès que la route C4 est lisible ; garder `PlatformNotifications` comme entrée **libellée catalogue**.

**C. Migrer les écrivains**

- Aucun writer école restant hors outbox après B.1.
- Catalogue B : **ne pas** basculer vers C4 dans la même PR. Soit rester B, soit un lot ultérieur « platform broadcasts → C4/eventType dédié » avec contrat UI Superadmin.

**D. Vérifier convergence**

- Unread cloche = KPI école.
- Un paiement n’apparaît plus que dans C4.
- Superadmin école : Home ouvre C4 ; le catalogue reste accessible ailleurs.
- C3-02 / C4-02 / platform announcements / prefs / dispatcher / fan-out restent verts.

**E. Supprimer legacy seulement plus aucun consumer**

---

## 15. Ordre exact des suppressions (après E, PRs ultérieures)

1. Injection `paymentWorkflow` / `buildParentPaymentNotification` (plus de reader école sur B).
2. KPI `getLiveKpis` notifications école.
3. Branche legacy de `NotificationsPage` **après** extraction de route plateforme.
4. Routage Home Mobile (réordonner, ne pas supprimer l’écran catalogue tant que Superadmin l’utilise).
5. `CommunicationService.getUnreadCount` / `getScopedNotifications` (déjà morts).
6. `communicationService.js` entier **quand** plus aucun `enrichNotifications`.
7. Table `notifications` + `POST/GET /backoffice/notifications` **en dernier**, après extinction Web DataContext domaine `notifications`, Mobile `PlatformNotificationsScreen`, seed, tests #456.
8. **Ne jamais** drop C3, C4, platform_announcements, outbox, deliveries, prefs dans F.

Hors F : SMTP demande d’essai = **PR G** (delivery EMAIL durable, pas `setImmediate`).

---

## 16–20. Gouvernance Git

| # | Champ | Valeur |
|---|---|---|
| 16 | PR Draft URL | à compléter après `create_pr` |
| 17 | Base SHA | `0c2cba7509fefd2eee593bdf45c0968d8aa94e56` (#551) |
| 18 | HEAD SHA | à compléter après commit |
| 19 | ahead/behind | à compléter vs `origin/develop` |
| 20 | diffstat | à compléter après commit |

**Rappel #548 / #550 :** cette branche RED reste indépendante. GREEN F = `git checkout -b cursor/communications-legacy-green-3171 origin/develop` puis rejouer tests/docs utiles. Vérifier qu’aucun HEAD RED n’est ancêtre du HEAD GREEN.

STOP. Pas Ready. Pas merge. Pas main. Pas Render. Pas production. Pas PR G dans cette branche.
