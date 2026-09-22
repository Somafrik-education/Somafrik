# Audit module Communication

**Mandat :** audit fonctionnel, technique et de non-régression — Web + Mobile natif Expo/React Native.

**Cette PR reste un dossier d’audit.** Lots A (#628), B (#633) et C/P3 (#637) sont mergés sur `develop`. Aucun nouveau lot métier.

**Décision :** HOLD — #625 Draft. Aucun merge de ce dossier sans diff GitHub indépendant CTO.

| Élément | Valeur |
| --- | --- |
| Audit ID | `AUDIT-COM-MODULE-2026-09-13` |
| Branche | `audit/communication-module` |
| Base | `develop` |
| Base d'origine (constats initiaux) | `1bf4a057817cb009120042a9bb7b23ba211e2269` |
| Base de validation (diff CTO / rebase) | `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Preuve Lot A | PR #628, merge `a42c079d4a18b4a56277f1cd2f553329e416d3d1` |
| Preuve Lot B | PR #633, merge `2e7e8e5333ede408c4cb861f3cea16f4ce7c65fa` |
| Preuve Lot C / P3 | PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| PR | https://github.com/Somafrik-education/Somafrik/pull/625 |
| Date | 14 septembre 2026 |
| Périmètre | Messages (C2), Annonces (C3), Notifications internes (C4), préférences canal, frontière notifications. Hors correction Finance / Scolarité / Pédagogie / Paramètres / Auth. |

**Synthèse**

| Classe | Ouverts |
| --- | ---: |
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 0 |
| **P3** | 0 |

L’API PostgreSQL C2/C3/C4 est isolée par `school_id`, persistante, et déjà couverte par les tests HTTP PG. **AUDIT-COM-RED-01…06 sont GREEN** : Lot A #628 (réponse modal Mobile), Lot B #633 (Ouvrir/Lire Mobile + allowlist push), Lot C/P3 #637 (unread Web, pagination C2/C3 Web+Mobile, header trio Mobile, copies HTTP Web). Restent **volontairement hors chantier** : COM-F-20 MISSING (PATCH annonce UI), COM-F-21 NOT_APPLICABLE (hard DELETE), COM-F-38 MISSING (catalogue plateforme Mobile, #577).

---

## 1. Gouvernance

- Branche dédiée `audit/communication-module` créée depuis `develop@1bf4a057` (base d'origine des constats).
- Rebase de validation sur `develop@871e93ee` (socle courant : Lot A #628 + Lot B #633 + Lot C/P3 #637). Aucun fichier métier Communication ajouté dans cette PR.
- PR Draft uniquement. **Aucun merge de #625 sans diff GitHub indépendant CTO.** Aucun nouveau lot métier.
- Aucun changement hors dossier d’audit / tests RED / gate CI.
- Aucune migration PostgreSQL.
- Aucun contournement RBAC.
- Aucun test existant désactivé ou affaibli.
- Tests RED ouverts : **aucun** (`matrix.redTests = []`). `AUDIT-COM-RED-01…06` sont **GREEN**. Le gate échoue si l’un redevient rouge.
- `AUDIT-COM-RED-01` GREEN (Lot A #628, merge `a42c079d`). `AUDIT-COM-RED-02` / `AUDIT-COM-RED-03` GREEN (Lot B #633, merge `2e7e8e53`). `AUDIT-COM-RED-04` / `AUDIT-COM-RED-05` / `AUDIT-COM-RED-06` GREEN (Lot C #637, merge `871e93ee`).
- **Aucun merge sans diff GitHub indépendant CTO.**

Contrôle CTO avant Ready/Merge futur :

1. HEAD SHA figé.
2. CI verte (inventaire + RED-01…06 GREEN + C2/C3/C4).
3. PR mergeable.
4. Périmètre = audit Communication uniquement.
5. Diff GitHub indépendant `develop...HEAD`.
6. Contrôle des tests et fichiers.
7. GO explicite CTO.

---

## 2. Cartographie fonctionnelle

Quatre familles, inchangées depuis les audits H→K :

| Famille | SoT PostgreSQL | API | UI Web | UI Mobile Expo |
| --- | --- | --- | --- | --- |
| **C2 Messages** | `school_conversations`, `school_conversation_participants`, `school_messages`, `school_message_reads`, `communication_attachments` | `/api/backoffice/conversations`, `/messages`, recipients, unread-count, attachments | `MessagesConversationsPage` — liste + **fil** | `MessagesScreen` — liste + **modal fil** |
| **C3 Annonces** | `announcements`, `announcement_recipients`, `announcement_reads` | `/api/backoffice/announcements` | `AnnouncementsPage` — liste + panneau | `AnnouncementsScreen` — cartes expansibles |
| **C4 Inbox interne** | `communication_event_outbox`, `communication_notifications`, `notification_recipients`, `communication_channel_deliveries` | `/api/backoffice/internal-notifications` | `InternalNotificationsCenter` | `InternalNotificationsScreen` |
| **Plateforme** | `platform_announcements` + table legacy `notifications` | `/platform-announcements`, `/notifications` | Annonces SA + `PlatformNotificationsPage` | Annonces plateforme fusionnées ; catalogue legacy **hors graphe** (#577) |

Chaîne d’écriture Messages :

`UI Web reply/create ou Mobile POST /messages → communicationsMessagesService.sendOrCreate (TX) → school_conversations + participants + school_messages → trigger outbox communication.message.created → C4 inbox + fan-out PUSH/EMAIL`

Chaîne Annonces :

`UI publish → publish() TX → announcements + announcement_recipients snapshot → trigger communication.announcement.published → C4`

**Messages = fil + modal (Mobile) / fil panneau (Web)** — conforme à la maquette UX. Le modal Mobile inclut un composer de **réponse** (Lot A #628).

---

## 3. Matrice fonctionnelle

| ID | Fonction | Web | Mobile | API | PostgreSQL | RBAC | Tests | Verdict |
| -- | -------- | --- | ------ | --- | ---------- | ---- | ----- | ------- |
| COM-F-01 | Messages — chargement et liste conversations | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-02 | Messages — ouverture fil / modal | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-03 | Messages — création valide | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-04 | Messages — réponse au fil | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-05 | Messages — destinataires autorisés / interdits | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-06 | Messages — pièces jointes | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-07 | Messages — lu / non-lu | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-08 | Messages — recherche et filtre Tous/Non lus | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-09 | Messages — pagination serveur nextCursor | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-10 | Messages — persistance après refresh | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-11 | Annonces — liste | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-12 | Annonces — ouverture détail | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-13 | Annonces — création / publication | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-14 | Annonces — archivage | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-15 | Annonces — audience / destinataires | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-16 | Annonces — pièces jointes | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-17 | Annonces — lu / non-lu | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-18 | Annonces — recherche et filtre | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-19 | Annonces — pagination serveur nextCursor | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-20 | Annonces — modification titre/corps (PATCH) | MISSING | MISSING | PASS | PASS | PASS | PASS | MISSING |
| COM-F-21 | Messages / Annonces — suppression hard DELETE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE |
| COM-F-22 | Notifications internes C4 — liste | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-23 | Notifications internes — action Ouvrir / Lire | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-24 | Notifications internes — création manuelle | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-25 | Notifications internes — archivage | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-26 | Notifications internes — pagination nextCursor | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-27 | Notifications internes — pièces jointes | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-28 | Chrome module Communication | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-29 | Isolation établissement school_id | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-30 | RBAC Messages / Annonces / Notifications | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-31 | Événement notification depuis message créé | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-32 | Événement notification depuis annonce publiée | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-33 | Deep link / push vers Communication | PASS | PASS | PASS | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-34 | Cohérence Web → Mobile (même SoT PostgreSQL) | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-35 | Cohérence Mobile → Web (création / réponse) | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-36 | Préférences canal IN_APP / PUSH / EMAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-37 | Annonces plateforme | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-38 | Notifications plateforme (catalogue legacy) | PASS | MISSING | PASS | PASS | PASS | PASS | MISSING |
| COM-F-39 | États loading / empty / error + API 401/403/404 | PASS | PASS | PASS | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-40 | Validation champs obligatoires (message / titre) | PASS | PASS | PASS | PASS | PASS | PASS | PASS |

---

## 4. Anomalies FAIL/PARTIAL

### AUDIT-COM-P1-01 — COM-F-04 — Réponse au fil absente du modal Mobile — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P1** (clos) |
| Test RED | `AUDIT-COM-RED-01` |
| Statut | **GREEN** — Lot A PR #628, merge `a42c079d4a18b4a56277f1cd2f553329e416d3d1` |
| Attendu | Depuis un fil ouvert, l’utilisateur autorisé (`Messages:CREATE`) peut répondre. Web : composer du panneau. Mobile : **fil + modal** avec composer. |
| Observé (après Lot A) | Le modal `MessagesScreen` expose `FormField` Réponse + **Envoyer** (`replyInThread` → `POST /backoffice/conversations/:id/messages`). Confirmation d’envoi séparée du refresh ; refresh KO n’affiche plus « Envoi impossible ». |
| Reco | Clos. Ne pas rouvrir dans un lot B. |

### AUDIT-COM-P1-02 — COM-F-23 — Ouvrir Mobile ne mène pas au message / à l’annonce — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P1** (clos) |
| Test RED | `AUDIT-COM-RED-02` |
| Statut | **GREEN** — Lot B PR #633, merge `2e7e8e5333ede408c4cb861f3cea16f4ce7c65fa` |
| Attendu | Après expansion, **Ouvrir/Lire** navigue vers la ressource (`conversation` → Messages + `conversationId`, `announcement` → Annonces + `announcementId`). Web le fait via `resolveNotificationDestination`. |
| Observé (après Lot B) | Mobile `resolveInternalNotificationNavigationTarget` accepte `conversation`, `announcement` et `finance_obligation`. `InternalNotificationsScreen` expose **Ouvrir** / **Lire**. Cold-start push Communication utilise le même helper que le tap chaud. |
| Reco | Clos. Ne pas rouvrir dans un lot C. |

### AUDIT-COM-P2-01 — COM-F-33 — Push Mobile ne peut pas ouvrir Communication — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P2** (clos) |
| Test RED | `AUDIT-COM-RED-03` |
| Statut | **GREEN** — Lot B PR #633, merge `2e7e8e5333ede408c4cb861f3cea16f4ce7c65fa` |
| Attendu | Un tap push lié à un message/annonce ouvre Messages / Annonces / Notifications internes (allowlist explicite). |
| Observé (après Lot B) | `ALLOWED_PUSH_DESTINATIONS` inclut `Home`, `StudentPayments`, `Messages`, `Announcements`, `InternalNotifications`. Fan-out mappe conversation/annonce vers ces destinations Expo. |
| Reco | Clos. Ne pas étendre l’allowlist au-delà des routes Communication déjà RBAC. |

### AUDIT-COM-P2-02 — COM-F-07 — Badge non-lu Web stale après ouverture du fil — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P2** (clos) |
| Test RED | `AUDIT-COM-RED-04` |
| Statut | **GREEN** — Lot C PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Attendu | Ouvrir un fil marque les messages lus **et** la liste / le chrome reflètent `unreadCount` à jour (sans F5). |
| Observé (après #637) | `loadThread` appelle `messagesApi.markRead` puis `loadConversations({ silent: true })` et `notifyMessagesUnreadChanged()`. Dépendances : `[canUpdate, schoolScope, selfId, loadConversations]`. Les hooks unread Web conservent le dernier compteur connu en cas d’échec de refresh. |
| Reco | Clos. Ne pas affaiblir le lock RED-04 (deps sans `loadConversations`). |

### AUDIT-COM-P2-03 — COM-F-09 — Pagination Messages ignorée Web et Mobile — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P2** (clos) |
| Test RED | `AUDIT-COM-RED-05`, `AUDIT-COM-RED-06` |
| Statut | **GREEN** — Lot C PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Attendu | Si `nextCursor` est renvoyé, l’UI charge la page suivante (comme C4). |
| Observé (après #637) | Web `MessagesConversationsPage` et Mobile `MessagesScreen` consomment `nextCursor`. Fusion des conversations par id. Scope école préservé (`withCommunicationSchoolScope` Mobile ; pas de `effectiveSchoolCode` sur le chemin plateforme). |
| Reco | Clos. |

### AUDIT-COM-P2-04 — COM-F-19 — Pagination Annonces ignorée Web et Mobile — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P2** (clos) |
| Test RED | `AUDIT-COM-RED-05`, `AUDIT-COM-RED-06` |
| Statut | **GREEN** — Lot C PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Attendu | Même contrat que C4 / C2. |
| Observé (après #637) | `AnnouncementsPage` et `AnnouncementsScreen` consomment `nextCursor`. Fusion par `source-id` / `${source}-${id}`. |
| Reco | Clos. |

### AUDIT-COM-P2-05 — COM-F-34 / COM-F-35 — Parité Web ↔ Mobile partielle — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P2** (clos) |
| Test RED | pagination `AUDIT-COM-RED-05` / `AUDIT-COM-RED-06` |
| Statut | **GREEN** — Lot C PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Attendu | Même titre, contenu, auteur, destinataires, date, état, thread après création Web ou Mobile et après refresh. |
| Observé (après #637) | SoT unique PostgreSQL inchangé. Réponse in-thread Mobile GREEN (#628). Ouvrir C4 Mobile GREEN (#633). Pagination C2/C3 Web+Mobile GREEN (#637). Pas de second état métier. |
| Reco | Clos. Les E2E runtime Expo / Playwright restent hors couverture automatique (volontaire). |

### AUDIT-COM-P3-01 — COM-F-28 — `CommunicationHeaderIcons` non monté — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P3** (clos) |
| Statut | **GREEN** — P3 PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Attendu | Raccourcis Messages / Annonces / Notifications visibles (Web Topbar oui). |
| Observé (après #637) | `CommunicationHeaderIcons` monté dans le `MobileAppHeader` live (`variant="header"`). Trio Messages / Annonces / InternalNotifications. Compact slot 44 + 3×36 (`HEADER_ACTIONS_SLOT_DP`). Home **n’importe pas** `CommunicationHeaderIcons` (#577 : InternalNotifications-only, pas `canPlatformNotifications`). |
| Reco | Clos. Ne pas réactiver le catalogue plateforme Mobile. |

### AUDIT-COM-P3-02 — COM-F-39 — 401/403/404 sans branche UI dédiée (Web) — **CORRIGÉ / GREEN**

| | |
| --- | --- |
| Sévérité | **P3** (clos) |
| Statut | **GREEN** — P3 PR #637, merge `871e93ee27add59673c54d7af4fd3be08e2ceb07` |
| Attendu | Messages utilisateur FR distincts pour 401/403/404/409/500. |
| Observé (après #637) | `communicationHttpError.ts` + `CommunicationHttpErrorState` : copies FR distinctes, `HTTP nnn` visible + `data-http-status`. 403/401 → `ForbiddenState` « Accès refusé ». Câblé Messages, Annonces, InternalNotificationsCenter. `PlatformNotificationsPage` affiche `LoadingState` « Chargement des notifications plateforme… » pendant le loading DataContext. Mobile `PlatformNotifications` **non** réactivé (#577). |
| Reco | Clos. |

### PARTIAL connexes (pas de nouveau défaut causal)

- **COM-F-31 / COM-F-32 :** l’outbox C4 **crée** bien la notification (C4-01, C4-02 PG). La lecture inbox Mobile fonctionne. La **navigation** vers la ressource Communication est **GREEN** (Lot B #633). Pas de notification orpheline sans communication métier détectée sur le chemin C2/C3 câblé.
- **COM-F-20 MISSING :** `PATCH /announcements/:id` existe (titre/corps, audience immutable). **Aucune UI** Web/Mobile — volontaire, déjà hors lot parité. Ne pas inventer l’édition.
- **COM-F-21 NOT_APPLICABLE :** pas de DELETE métier ; archive C3/C4 seulement. Ne pas inventer.
- **COM-F-38 MISSING :** notifications plateforme Mobile hors graphe live, décision #577. Écran orphelin encore dans le repo.

---

## 5. Tests existants

Classement (aucun n’est désactivé par cet audit) :

| Famille | Fichiers | Couverture |
| --- | --- | --- |
| Backend HTTP PG | `communicationsC2.http.pg.test.js`, `C3`, `C4`, `communicationsReadiness.http.pg.test.js` | création, reply, destinataires, PJ, read, isolation tenant, RBAC révocation, idempotence, XSS brut |
| Backend API / services | `communicationsAnnouncements.unit.test.js`, `communicationsAttachments.test.js`, dispatcher / fanout / delivery / preferences | canaux, retry, health |
| PostgreSQL outbox | lots L1–L5 `*Late*`, `*ReportCard*`, `*PaymentDue*`, `*Timetable*`, `*TeacherReplacement*` | 9/9 événements Lot I **câblés** (les GREEN de septembre 2026 ont comblé le P1 « 4/9 » de l’audit final) |
| RBAC / tenant | C2-01/02/10/12/13/14, C3 école B, C4 IDOR `notification_recipients` | isolation `school_id` |
| Web | `pariteCommunication.red.ts` COM-01…06 (GREEN), UX compacte, deeplink Ouvrir, C4 counter/navigation | liste, chrome, unread-count, Ouvrir Web |
| Mobile | `pariteCommunication.red.test.ts` COM-10…17 (GREEN), UX fil+modal, C4 cursor, school scope | conversations, menu, chrome |
| E2E scripts | `verify-communications-c2/c3/c4/e2e.js` | gates CI existantes |
| Notifications | `InternalNotificationsCenter.navigation.red.test.tsx` (Web Ouvrir), `communicationsNavigation*.test.js`, `financeNotificationNavigation.test.ts`, `announcementsOpenById.test.ts` | Web + Mobile Ouvrir Communication (Lot B) |
| Cet audit | `scripts/communication-module-audit.inventory.test.js` (GREEN), `scripts/communication-module-audit.red.test.js` (RED-01…06 GREEN) | inventaire + preuves Lots A+B+#637 |

Scénarios du mandat §11 vs couverture :

| Scénario | Couverture |
| --- | --- |
| Chargement Communication | COM-F-01, chrome, COM-02 |
| Affichage liste | C2/C3/C4 list + parité |
| Ouverture | COM-F-02, COM-F-12, Web Ouvrir |
| Création valide | C2-06, C3-01, UI Envoyer/Publier |
| Données obligatoires manquantes | API 400 + UI « Message/Titre obligatoire » |
| Destinataire valide / interdit | C2-02, C2-13 |
| Lecture détail | GET conversation/messages, GET announcement |
| Réponse | C2-03 API + Web UI ; **Mobile UI RED-01 GREEN** (#628) |
| Persistance après refresh | PG rows C2-03 + GET ; UI reload on focus/mount |
| Isolation établissement | C2-12, C3-01 B, C4-02 B |
| Refus RBAC | C2-10 révocation |
| API error handling | 400/403/404 C2 ; UI Réessayer |
| État vide | `Aucune conversation/annonce/notification` |
| Web → Mobile | même GET conversations (contrat) ; runtime Expo non rejoué ici |
| Mobile → Web | POST /messages persisté ; réponse in-thread **GREEN** |
| Action Ouvrir | Web PASS ; Mobile **RED-02 GREEN** (#633) |
| Bouton no-op critique | aucun CTA primaire Messages/Annonces/C4 Web sans handler ; Mobile Répondre/Ouvrir **présents** (Lots A+B) |

---

## 6. Zones sans couverture

- Pas d’E2E Playwright Web Communication (création → refresh → lecture).
- Pas d’E2E Expo runtime (hors `recette/communicationUxSmoke.ts`, non branché sur `App.tsx` production).
- Pas de test automatique **live** Web→Mobile sur un même jeu PG (uniquement contrat de sources + HTTP PG).
- Pagination C2/C3 UI : **GREEN** (`AUDIT-COM-RED-05` / `AUDIT-COM-RED-06`, Lot C #637).
- Reply Mobile UI : **GREEN** (`AUDIT-COM-RED-01`, Lot A #628).
- Ouvrir Mobile conversation/annonce : **GREEN** (`AUDIT-COM-RED-02`, Lot B #633).
- Push Mobile destinations Communication : **GREEN** (`AUDIT-COM-RED-03`, Lot B #633).
- Copies HTTP 401/403/404/409/500 Web Communication : **GREEN** (P3-02, #637).
- 401 refresh token sur pages Communication : client global, pas de test de page.
- `PATCH` annonce UI : volontairement non couvert.
- Catalogue plateforme Mobile : hors graphe, tests d’exclusion (#577) seulement.

---

## 7. Notifications

Frontière **respectée** : cet audit ne réactive ni ne modifie le dispatcher, SMTP, Expo fan-out, ni les préférences école.

| Cas | Verdict |
| --- | --- |
| Communication créée mais notification absente | **Non observé** sur C2 message / C3 publish (C4-01/02 écrivent outbox + inbox). |
| Notification générée sans communication | Manual POST C4 possible (inbox directe, hors outbox) — comportement existant, pas une fuite tenant. |
| Bouton notification ne menant pas au message | **PASS Mobile** (P1-02 GREEN, Lot B #633). **PASS Web** (Ouvrir/Lire). |
| Mauvais destinataire | C4 snapshot = C3 recipients ; message → participants hors expéditeur. Isolation B testée. |
| Doublon | `event_key` UNIQUE + C4-13 retry sans doublon. |
| Perte de contexte | Push allowlist Communication **GREEN** (P2-01, Lot B #633). |
| Deep link cassé | Web `notificationNavigation.ts` types `conversation` / `announcement` OK. Mobile résolveur aligné (conversation / announcement / finance_obligation). |

Lot I : 9/9 événements ont désormais un producteur (L1–L5 GREEN). Hors périmètre de correction de cet audit.

---

## 8. Lots de correction

**Aucun lot n’est implémenté ici.** Lots métier mergés sur `develop` via des PR séparées :

| Lot | Sévérité | Contenu | Hors lot |
| --- | --- | --- | --- |
| **A** | P1 | Composer de réponse dans le modal fil Mobile — **mergé** #628 (`a42c079d`) | |
| **B** | P1/P2 | Ouvrir/Lire Mobile + allowlist push Messages/Annonces/InternalNotifications + deep params `conversationId`/`announcementId` — **mergé** #633 (`2e7e8e53`) | réécriture dispatcher, SMTP, prefs école |
| **C** | P2 | Pagination C2/C3 Web+Mobile ; refresh liste unread après mark-read Web — **mergé** #637 (`871e93ee`) | PATCH UI annonces |
| **P3** | P3 | Header icons Mobile ; copies 403/404 Web ; loading plateforme — **mergé** dans la même #637 (`871e93ee`) | fusion inbox, plateforme Mobile (#577) |

Ordre réalisé : **A → B → C/P3**. Chantier produit Communication **terminé**. Cette PR #625 ne contient que le dossier d’audit. Pas de merge #625 sans diff CTO. PAS de nouveau lot métier.

---

## 9. Preuves d’exécution

Les tests d’inventaire et le lock RED sont dans `scripts/`. Les HTTP PG C2/C3/C4 s’exécutent dans `.github/workflows/communication-module-audit.yml` (Postgres 16).

Résultats machine : `docs/audits/evidence/communication-module-audit-test-results.json` (généré par `npm run verify:communication-module-audit`).

Matrice : `docs/audits/evidence/communication-module-audit-matrix.json`.

Exécution locale (14 sept. 2026, sans PostgreSQL) :

| Suite | Résultat |
| --- | --- |
| Inventaire audit (9 tests) | **9 PASS** |
| Parité COM-01…06 Web + COM-10…17 Mobile | **14 PASS / 0 FAIL** |
| UX Communication Mobile | **PASS** (tsx) |
| UX Communication Web (vitest) | **PASS** |
| RED AUDIT-COM-RED-01 | **PASS / GREEN** (Lot A #628) |
| RED AUDIT-COM-RED-02 | **PASS / GREEN** (Lot B #633) |
| RED AUDIT-COM-RED-03 | **PASS / GREEN** (Lot B #633) |
| RED AUDIT-COM-RED-04 | **PASS / GREEN** (Lot C #637) |
| RED AUDIT-COM-RED-05 | **PASS / GREEN** (Lot C #637) |
| RED AUDIT-COM-RED-06 | **PASS / GREEN** (Lot C #637) |
| C2 / C3 / C4 HTTP PG | CI uniquement (`DATABASE_URL`) |

Environnement d’audit agent : pas de Docker / PostgreSQL local. Les preuves UI runtime Expo et navigateur 1440/1024/390/360 n’ont **pas** été rejouées ici ; la maquette existante reste `docs/audits/parite-web-mobile-communication-ux-maquette.md`. Les preuves RED-01…06 sont des **locks de non-régression** sur le code livré (#628, #633, #637).

---

## 10. Décision

**HOLD. STOP.**

#625 reste Draft. Chantier produit Communication **terminé** (#637 mergée). Cette PR ne contient que le dossier d’audit réconcilié. Aucun nouveau lot métier. Aucun merge de #625 sans diff GitHub indépendant CTO. Aucun Bulletin.

Aucun merge sans diff GitHub indépendant CTO.
