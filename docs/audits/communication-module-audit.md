# Audit module Communication

**Mandat :** audit fonctionnel, technique et de non-régression — Web + Mobile natif Expo/React Native.  
**Cette PR reste un dossier d’audit.** Lot A (#628) est mergé sur `develop` ; les lots B–D ne sont pas implémentés ici.  
**Décision :** HOLD — #625 Draft. Aucun merge. Aucun Lot B tant que cette réconciliation n’est pas validée par un diff CTO.

| Élément | Valeur |
| --- | --- |
| Audit ID | `AUDIT-COM-MODULE-2026-09-13` |
| Branche | `audit/communication-module` |
| Base | `develop` |
| Base d'origine (constats initiaux) | `1bf4a057817cb009120042a9bb7b23ba211e2269` |
| Base de validation (diff CTO / rebase) | `a42c079d4a18b4a56277f1cd2f553329e416d3d1` |
| Preuve Lot A | PR #628, merge `a42c079d4a18b4a56277f1cd2f553329e416d3d1` |
| PR | https://github.com/Somafrik-education/Somafrik/pull/625 |
| Date | 13 septembre 2026 |
| Périmètre | Messages (C2), Annonces (C3), Notifications internes (C4), préférences canal, frontière notifications. Hors correction Finance / Scolarité / Pédagogie / Paramètres / Auth. |

**Synthèse**

| Classe | Ouverts |
| --- | ---: |
| **P0** | 0 |
| **P1** | 1 |
| **P2** | 5 |
| **P3** | 2 |

L’API PostgreSQL C2/C3/C4 est isolée par `school_id`, persistante, et déjà couverte par les tests HTTP PG. **COM-F-04 / AUDIT-COM-RED-01 est GREEN** (composer de réponse dans le modal Mobile, Lot A #628). Les écarts ouverts restants sont **côté clients** : bouton **Ouvrir** Mobile limité au paiement, pagination C2/C3 ignorée, badge non-lu Web stale après ouverture, push Mobile incapable d’ouvrir Communication.

---

## 1. Gouvernance

- Branche dédiée `audit/communication-module` créée depuis `develop@1bf4a057` (base d'origine des constats).
- Rebase de validation sur `develop@a42c079d` (merge Lot A #628 — base contrôlée pour le diff GitHub `develop...HEAD`). Aucun fichier métier ajouté par cette réconciliation.
- PR Draft uniquement. **Aucun merge. Aucun Lot B pendant cette réconciliation.**
- Aucun changement hors dossier d’audit / tests RED / gate CI.
- Aucune migration PostgreSQL.
- Aucun contournement RBAC.
- Aucun test existant désactivé ou affaibli.
- Tests RED ouverts = preuve du défaut (`RED → preuve`). Ils doivent échouer tant que le défaut n’est pas corrigé dans un lot ultérieur. Ensemble attendu : **AUDIT-COM-RED-02…06**.
- `AUDIT-COM-RED-01` est **GREEN** (Lot A #628, merge `a42c079d`). Le gate échoue si RED-01 redevient rouge.
- **Aucun merge sans diff GitHub indépendant CTO.**

Contrôle CTO avant Ready/Merge futur :

1. HEAD SHA figé.
2. CI verte (après lots GREEN, pas sur cette PR RED).
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
| COM-F-07 | Messages — lu / non-lu | PARTIAL | PASS | PASS | PASS | PASS | FAIL | PARTIAL |
| COM-F-08 | Messages — recherche et filtre Tous/Non lus | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-09 | Messages — pagination serveur nextCursor | FAIL | FAIL | PASS | PASS | PASS | FAIL | FAIL |
| COM-F-10 | Messages — persistance après refresh | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-11 | Annonces — liste | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-12 | Annonces — ouverture détail | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-13 | Annonces — création / publication | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-14 | Annonces — archivage | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-15 | Annonces — audience / destinataires | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-16 | Annonces — pièces jointes | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-17 | Annonces — lu / non-lu | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-18 | Annonces — recherche et filtre | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | PASS |
| COM-F-19 | Annonces — pagination serveur nextCursor | FAIL | FAIL | PASS | PASS | PASS | FAIL | FAIL |
| COM-F-20 | Annonces — modification titre/corps (PATCH) | MISSING | MISSING | PASS | PASS | PASS | PASS | MISSING |
| COM-F-21 | Messages / Annonces — suppression hard DELETE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE |
| COM-F-22 | Notifications internes C4 — liste | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-23 | Notifications internes — action Ouvrir / Lire | PASS | FAIL | PASS | PASS | PASS | FAIL | FAIL |
| COM-F-24 | Notifications internes — création manuelle | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-25 | Notifications internes — archivage | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-26 | Notifications internes — pagination nextCursor | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-27 | Notifications internes — pièces jointes | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-28 | Chrome module Communication | PASS | PARTIAL | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | PARTIAL |
| COM-F-29 | Isolation établissement school_id | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-30 | RBAC Messages / Annonces / Notifications | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-31 | Événement notification depuis message créé | PASS | PARTIAL | PASS | PASS | PASS | PASS | PARTIAL |
| COM-F-32 | Événement notification depuis annonce publiée | PASS | PARTIAL | PASS | PASS | PASS | PASS | PARTIAL |
| COM-F-33 | Deep link / push vers Communication | PASS | FAIL | PASS | NOT_APPLICABLE | PASS | FAIL | FAIL |
| COM-F-34 | Cohérence Web → Mobile (même SoT PostgreSQL) | PASS | PARTIAL | PASS | PASS | PASS | PARTIAL | PARTIAL |
| COM-F-35 | Cohérence Mobile → Web (création / réponse) | PASS | PARTIAL | PASS | PASS | PASS | PARTIAL | PARTIAL |
| COM-F-36 | Préférences canal IN_APP / PUSH / EMAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-37 | Annonces plateforme | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| COM-F-38 | Notifications plateforme (catalogue legacy) | PASS | MISSING | PASS | PASS | PASS | PASS | MISSING |
| COM-F-39 | États loading / empty / error + API 401/403/404 | PARTIAL | PASS | PASS | NOT_APPLICABLE | PASS | PARTIAL | PARTIAL |
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

### AUDIT-COM-P1-02 — COM-F-23 — Ouvrir Mobile ne mène pas au message / à l’annonce

| | |
| --- | --- |
| Sévérité | **P1** |
| Test RED | `AUDIT-COM-RED-02` |
| Attendu | Après expansion, **Ouvrir/Lire** navigue vers la ressource (`conversation` → Messages + `conversationId`, `announcement` → Annonces + `announcementId`). Web le fait via `resolveNotificationDestination`. |
| Observé | Mobile `resolveInternalNotificationNavigationTarget` n’accepte que `finance_obligation`. Pas de bouton **Ouvrir** / **Lire**. Seul **Voir le paiement** apparaît, et uniquement si RBAC paiements. Une notification `communication.message.created` (C4-01, `navigationTarget.type === "conversation"`) n’ouvre pas le fil. |
| Reproduction | 1. Parent A, école A. 2. Admin A envoie un message au parent (C4 crée la notif). 3. Mobile → Notifications → déplier. 4. Aucun Ouvrir vers Messages. |
| Rôle | `PARENT` + `Notifications:READ` |
| Tenant | `SCH-C4-A` (jeu C4) |
| Endpoint | `GET /api/backoffice/internal-notifications` ; cible `navigationTarget` |
| Code | `Mobile/src/lib/pushNotificationDestinations.ts` ; `Mobile/src/screens/InternalNotificationsScreen.tsx` ; Web `web/src/lib/notificationNavigation.ts` |
| Reco | Lot B — aligner le résolveur Mobile sur les types Web (`conversation`, `announcement`, …) et exposer Ouvrir/Lire. |

### AUDIT-COM-P2-01 — COM-F-33 — Push Mobile ne peut pas ouvrir Communication

| | |
| --- | --- |
| Sévérité | **P2** |
| Test RED | `AUDIT-COM-RED-03` |
| Attendu | Un tap push lié à un message/annonce ouvre Messages / Annonces / Notifications internes (allowlist explicite). |
| Observé | `ALLOWED_PUSH_DESTINATIONS = ["Home", "StudentPayments"]`. Toute autre destination retombe sur **Home**. Perte de contexte Communication. |
| Reproduction | Push avec `somafrikDestination=Messages` → `resolvePushDestination` renvoie `Home`. |
| Rôle | utilisateur avec device Expo enregistré |
| Tenant | `user_id + school_id + backend_environment` (fan-out existant) |
| Endpoint | livraison PUSH C4 (non modifié) |
| Code | `Mobile/src/lib/pushNotificationDestinations.ts` |
| Reco | Lot B — étendre l’allowlist **uniquement** aux routes Communication déjà RBAC, sans réactiver le système global de notifications. |

### AUDIT-COM-P2-02 — COM-F-07 — Badge non-lu Web stale après ouverture du fil

| | |
| --- | --- |
| Sévérité | **P2** |
| Test RED | `AUDIT-COM-RED-04` |
| Attendu | Ouvrir un fil marque les messages lus **et** la liste / le chrome reflètent `unreadCount` à jour (sans F5). |
| Observé | `loadThread` appelle `messagesApi.markRead` puis **ne** rappelle **pas** `loadConversations`. La carte conserve son badge jusqu’au prochain chargement manuel. L’API et PostgreSQL (`school_message_reads`) sont corrects (C2-04). |
| Reproduction | 1. Admin, conversation avec unreadCount ≥ 1. 2. Cliquer la conversation. 3. Le fil se charge, mark-read part. 4. Le badge liste reste inchangé. 5. Refresh navigateur → badge OK. |
| Rôle | `Messages:UPDATE` (mark-read) |
| Tenant | école courante |
| Endpoint | `PATCH /api/backoffice/messages/:id/read` |
| Code | `web/src/pages/MessagesConversationsPage.tsx` `loadThread` |
| Reco | Lot C — après mark-read, `loadConversations()` + refresh unread-count Topbar. |

### AUDIT-COM-P2-03 — COM-F-09 — Pagination Messages ignorée Web et Mobile

| | |
| --- | --- |
| Sévérité | **P2** |
| Test RED | `AUDIT-COM-RED-05`, `AUDIT-COM-RED-06` |
| Attendu | Si `nextCursor` est renvoyé, l’UI charge la page suivante (comme C4). |
| Observé | L’API C2 pagine (`communicationsMessagesService.listConversations`). Web `listConversations("")` et Mobile `getCanonicalConversations` n’envoient pas `cursor`. Conversations au-delà de la première page **invisibles**. |
| Reproduction | Jeu > limite serveur de conversations. Première page seulement. |
| Rôle | `Messages:READ` |
| Tenant | école courante |
| Endpoint | `GET /api/backoffice/conversations?cursor=` |
| Code | `MessagesConversationsPage.tsx`, `MessagesScreen.tsx`, `domainHydrationApi.ts` |
| Reco | Lot C — bouton « Charger les conversations plus anciennes » branché sur `nextCursor`. |

### AUDIT-COM-P2-04 — COM-F-19 — Pagination Annonces ignorée Web et Mobile

| | |
| --- | --- |
| Sévérité | **P2** |
| Test RED | `AUDIT-COM-RED-05`, `AUDIT-COM-RED-06` |
| Attendu | Même contrat que C4 / C2. |
| Observé | `communicationsAnnouncementsService` expose `nextCursor`. `AnnouncementsPage` et `AnnouncementsScreen` / `getCanonicalAnnouncements` l’ignorent. |
| Reproduction | Publier plus d’annonces que la limite de page. |
| Rôle | `Announcements:READ` |
| Tenant | école courante |
| Endpoint | `GET /api/backoffice/announcements?cursor=` |
| Code | `web/src/pages/AnnouncementsPage.tsx`, `Mobile/src/screens/AnnouncementsScreen.tsx` |
| Reco | Lot C — même pattern que C4. |

### AUDIT-COM-P2-05 — COM-F-34 / COM-F-35 — Parité Web ↔ Mobile partielle

| | |
| --- | --- |
| Sévérité | **P2** |
| Test RED | `AUDIT-COM-RED-02` (Ouvrir) ; pagination RED-05/06 |
| Attendu | Même titre, contenu, auteur, destinataires, date, état, thread après création Web ou Mobile et après refresh. |
| Observé | **SoT unique PostgreSQL : OK** (mêmes endpoints C2/C3/C4). Une création Web est relue par Mobile (`GET /conversations`). Une création Mobile (`POST /messages`) est relue par Web. **Écarts restants :** (1) Ouvrir C4 Web ouvre le fil, Mobile non ; (2) pagination asymétrique vs volume. Réponse in-thread Mobile : **GREEN** (Lot A #628). Pas de second état métier. |
| Reproduction | Scénario A : créer conversation Web, pull-to-refresh Mobile → mêmes champs. Scénario B : répondre depuis le modal Mobile → impossible (P1-01). |
| Rôle | `Messages:READ` + `CREATE` |
| Tenant | même `school_id` |
| Endpoint | `GET/POST /conversations`, `POST /messages` |
| Code | pages/écrans C2 cités |
| Reco | Lots A+B+C. Pas de nouveau backend. |

### AUDIT-COM-P3-01 — COM-F-28 — `CommunicationHeaderIcons` non monté

| | |
| --- | --- |
| Sévérité | **P3** |
| Test RED | (couverture parité COM-16/17 déjà GREEN pour Menu + chrome ; pas de nouveau RED : le chrome écran existe) |
| Attendu | Raccourcis Messages / Annonces / Notifications visibles (Web Topbar oui). |
| Observé | Mobile : chrome **sur les 3 écrans** + Menu + drawer. Le composant `CommunicationHeaderIcons` n’est **pas** monté dans le header live (une cloche unique). Pas de no-op visible. |
| Reproduction | Ouvrir n’importe quel écran hors Communication : pas de trio d’icônes. |
| Rôle | school roles |
| Code | `Mobile/src/components/CommunicationHeaderIcons.tsx` |
| Reco | Lot D optionnel — monter le trio ou supprimer le composant mort. Pas un P1. |

### AUDIT-COM-P3-02 — COM-F-39 — 401/403/404 sans branche UI dédiée (Web)

| | |
| --- | --- |
| Sévérité | **P3** |
| Attendu | Messages utilisateur FR distincts pour 401/403/404/409/500. |
| Observé | Messages/Annonces/C4 : Loading / Empty / Error + **Réessayer** en français. Les codes HTTP sont aplatis en `ApiError.message` (souvent FR API). Pas de branche visuelle par statut. Plateforme notifications : toast seulement, pas de bandeau loading. |
| Reproduction | Forcer 403 sur `GET /conversations` → ErrorState « … » + Réessayer, pas « Accès refusé » générique dédié. |
| Code | pages Communication Web |
| Reco | Lot D — cartographie des codes déjà renvoyés par l’API (C2 400/403/404) vers copies FR stables. |

### PARTIAL connexes (pas de nouveau défaut causal)

- **COM-F-31 / COM-F-32 :** l’outbox C4 **crée** bien la notification (C4-01, C4-02 PG). La lecture inbox Mobile fonctionne. Seule la **navigation** vers la ressource Communication échoue (P1-02). Pas de notification orpheline sans communication métier détectée sur le chemin C2/C3 câblé.
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
| Notifications | `InternalNotificationsCenter.navigation.red.test.tsx` (Web Ouvrir), `communicationsNavigation*.test.js` | Web only pour Ouvrir Communication |
| Cet audit | `scripts/communication-module-audit.inventory.test.js` (GREEN), `scripts/communication-module-audit.red.test.js` (RED lock) | inventaire + preuves P1/P2 |

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
| Mobile → Web | POST /messages persisté ; réponse in-thread **non** |
| Action Ouvrir | Web PASS ; Mobile **RED-02** |
| Bouton no-op critique | aucun CTA primaire Messages/Annonces/C4 Web sans handler ; Mobile **absence** de Répondre/Ouvrir (pas un no-op, une omission) |

---

## 6. Zones sans couverture

- Pas d’E2E Playwright Web Communication (création → refresh → lecture).
- Pas d’E2E Expo runtime (hors `recette/communicationUxSmoke.ts`, non branché sur `App.tsx` production).
- Pas de test automatique **live** Web→Mobile sur un même jeu PG (uniquement contrat de sources + HTTP PG).
- Pagination C2/C3 UI : aucun test GREEN (RED-05/06).
- Reply Mobile UI : **GREEN** (`AUDIT-COM-RED-01`, Lot A #628).
- Ouvrir Mobile conversation/annonce : aucun test GREEN (RED-02).
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
| Bouton notification ne menant pas au message | **FAIL Mobile** (P1-02). **PASS Web** (Ouvrir/Lire). |
| Mauvais destinataire | C4 snapshot = C3 recipients ; message → participants hors expéditeur. Isolation B testée. |
| Doublon | `event_key` UNIQUE + C4-13 retry sans doublon. |
| Perte de contexte | Push allowlist → Home (P2-01). |
| Deep link cassé | Web `notificationNavigation.ts` types `conversation` / `announcement` OK. Mobile résolveur finance-only. |

Lot I : 9/9 événements ont désormais un producteur (L1–L5 GREEN). Hors périmètre de correction de cet audit.

---

## 8. Lots de correction

**Aucun lot n’est implémenté ici.** Proposition pour décision CTO :

| Lot | Sévérité | Contenu | Hors lot |
| --- | --- | --- | --- |
| **A** | P1 | Composer de réponse dans le modal fil Mobile — **mergé** #628 (`a42c079d`) | |
| **B** | P1/P2 | Ouvrir/Lire Mobile + allowlist push Messages/Annonces/InternalNotifications + deep params `conversationId`/`announcementId` | réécriture dispatcher, SMTP, prefs école |
| **C** | P2 | Pagination C2/C3 Web+Mobile ; refresh liste unread après mark-read Web | PATCH UI annonces |
| **D** | P3 | Header icons Mobile ; copies 403/404 Web ; loading plateforme | fusion inbox, plateforme Mobile (#577) |

Ordre recommandé : **A (fait) → B → C → D**. Lot B : PR séparée, uniquement après GO CTO sur cette réconciliation. Pas de merge #625 sans diff CTO.

---

## 9. Preuves d’exécution

Les tests d’inventaire et le lock RED sont dans `scripts/`. Les HTTP PG C2/C3/C4 s’exécutent dans `.github/workflows/communication-module-audit.yml` (Postgres 16).

Résultats machine : `docs/audits/evidence/communication-module-audit-test-results.json` (généré par `npm run verify:communication-module-audit`).

Matrice : `docs/audits/evidence/communication-module-audit-matrix.json`.

Exécution locale (13 sept. 2026, sans PostgreSQL) :

| Suite | Résultat |
| --- | --- |
| Inventaire audit (9 tests) | **9 PASS** |
| Parité COM-01…06 Web + COM-10…17 Mobile | **14 PASS / 0 FAIL** |
| UX Communication Mobile | **PASS** (tsx) |
| UX Communication Web (vitest) | non exécuté localement (pas de `web/node_modules`) — CI |
| RED AUDIT-COM-RED-01 | **PASS / GREEN** (Lot A #628) |
| RED AUDIT-COM-RED-02…06 | **5 FAIL** (preuve, attendu) |
| C2 / C3 / C4 HTTP PG | CI uniquement (`DATABASE_URL`) |

Environnement d’audit agent : pas de Docker / PostgreSQL local. Les preuves UI runtime Expo et navigateur 1440/1024/390/360 n’ont **pas** été rejouées ici ; la maquette existante reste `docs/audits/parite-web-mobile-communication-ux-maquette.md`. Les défauts P1/P2 sont **reproductibles par inspection du code livré** (tests RED) et par les suites HTTP PG déjà présentes.

---

## 10. Décision

**HOLD. STOP.**

#625 reste Draft. Aucun merge. Aucun Lot B tant que le diff CTO de cette réconciliation n’est pas GO.

Aucun merge sans diff GitHub indépendant CTO.
