# Communications C1 — Audit transversal Messages / Annonces / Notifications

Date : 2026-08-28  
Branche : `audit/communications-messages-announcements-notifications`  
Base obligatoire : `develop@bf9a22903d3f86241d2d1f86d9d9a13c4fecd8fc`

```text
COM-C1      AUDIT DE CLÔTURE COMMUNICATION
PR          DRAFT UNIQUEMENT
Ready       NON
Merge       NON
COM-C2      NON OUVERT
```

Le CTO effectuera un diff GitHub indépendant `develop → HEAD` avant toute autorisation de merge.

Gate : `npm run verify:communications-e2e`  
Workflow : `.github/workflows/communications-c1.yml` (`Communications C1`)

---

## 1. Executive summary

Somafrik possède déjà une **messagerie PostgreSQL canonique** (conversations, participants, messages, reads) et des **annonces établissement** persistées. Les **notifications plateforme** existent comme CRUD Superadmin / Admin Pays, pas comme hub événementiel métier. L'écran préprod `/parametres/notifications` est un **placeholder volontaire** (`ComingSoonState` « Bientôt disponible ») : aucun canal e-mail / SMS / WhatsApp / push n'est branché.

Ce qui **marche réellement** (HTTP + PostgreSQL) :

- Admin A envoie un message à Parent A → rows `school_conversations` / `participants` / `school_messages`.
- Parent A le voit, `PATCH …/read` persiste `school_message_reads.read_at`.
- École B ne voit pas les messages ni les annonces de A (filtre tenant `schoolCode`).
- `POST /messages` enveloppe `withIdempotency` ; le sender vient du principal, jamais du body.

Ce qui **bloque une Release Candidate Communication** :

| ID | Gravité | Sujet |
|---|---|---|
| COM-C1-P0-001 | P0 | GET messages staff / enseignant affecté : pas scoped participants |
| COM-C1-P0-002 | P0 | Destinataire accepté dès qu'il a le même `school_id` (pas de lien parent↔élève) |
| COM-C1-P1-001 | P1 | Chaque POST crée une **nouvelle** conversation (pas de thread) |
| COM-C1-P1-002 | P1 | Audience d'annonce (`target_class_id`) persistée mais **non filtrée** à la lecture |
| COM-C1-P1-003 | P1 | Badge annonces = `localStorage`, pas de read destinataire en PG |
| COM-C1-P1-004 | P1 | POST announcements **sans** `withIdempotency` |
| COM-C1-P1-005 | P1 | `mark-read` pose `school_messages.status = read` **global** |
| COM-C1-P1-009 | P1 | Parent sans `studentIds` JWT → GET messages vide (y compris ses fils) |
| COM-C1-E2E-6 | — | Notification interne événementielle : **NOT_IMPLEMENTED** |

**Verdict : NO-GO** pour une clôture Communication / RC globale. Isolation inter-écoles A↔B tient. Le RBAC live via `resolveEffectivePermissions` refuse bien la mutation après révocation PG (E2E 7). Les P0 restants (liste non participant-scoped, destinataire = userId école) + l'absence de notifications événementielles interdisent de retirer le placeholder Paramètres.

Le placeholder `/parametres/notifications` est **conservé**.

---

## 2. Architecture actuelle

Trois sous-domaines distincts (ne pas les fusionner) :

| Domaine | Définition | SoT actuelle |
|---|---|---|
| **MESSAGE** | Communication ciblée entre utilisateurs / participants | `school_conversations` + `school_conversation_participants` + `school_messages` + `school_message_reads` via `clientsService.sendMessage` |
| **ANNONCE** | Diffusion à une audience d'établissement | table `announcements` via `createAnnouncement` |
| **NOTIFICATION** | Information événementielle / système générée par Somafrik | table `notifications` = **CRUD plateforme**, pas de triggers métier |

Couches :

```text
Web EntityPage / NotificationsPage / Topbar
Mobile MessagesScreen / AnnouncementsScreen / PlatformNotificationsScreen
        │
        ▼
API /api/backoffice/{messages,announcements,notifications}
        │
        ▼
clientsService / platformService
        │
        ▼
PostgreSQL clients + platform stores
```

`CommunicationService` (`backend/services/communicationService.js`) est **LEGACY** : enrichissement / filtre audience in-memory pour le back-office, pas le chemin d'écriture canonique.

---

## 3. Tables PostgreSQL

### CANONIQUE

| Table | Rôle | PK | Tenant | Sender / recipient | Read | Soft delete | Audit |
|---|---|---|---|---|---|---|---|
| `school_conversations` | Fil | `id` | `school_id` NOT NULL, `country_id` | `created_by_user_id` | — | `status` | `created_at` / `updated_at` + `audit_logs` |
| `school_conversation_participants` | Membres | `id` UNIQUE(conversation, user) | `school_id` | `user_id`, `participant_role` | — | CASCADE | `joined_at` |
| `school_messages` | Corps | `id` | `school_id`, `country_id` | `sender_user_id` | via `school_message_reads` ; `status` global | non | `sent_at`, `profile_payload.audit` |
| `school_message_reads` | Lecture | `(message_id, user_id)` | indirect | `user_id` | `read_at` | — | — |
| `announcements` | Diffusion établissement | `id` | `school_id` NOT NULL, `country_id` | `created_by` | **absent** | `status` (archivé) | `created_at` / `updated_at` + audit |
| `contacts` / `contact_relations` | Destinataires parents | `id` | `school_id`, `country_id` | `user_id` / `student_id` | — | `status` | timestamps |
| `notifications` | In-app plateforme | `id` | `school_id` **nullable** | `user_id` peu utilisé ; audience dans JSON | `read_at` | archive = DELETE | timestamps + audit |
| `payment_reminders` | Journal relance Finance | `id` | `school_id` | `recipient` texte | — | — | `sent_at`, `triggered_by` |
| `audit_logs` | Traçabilité clients/platform | `id` | `school_id` | `user_id` | — | — | `action`, `entity_*`, IP |

### ABSENT / NON UTILISÉ

- `notification_preferences`
- `message_templates` / `notification_templates`
- `notification_triggers`
- `delivery_logs`
- config provider SMTP / SMS / WhatsApp / FCM

Classification par objet : voir §18.

---

## 4. API actives

| Méthode | Path | Permission JWT | Idempotency | Notes |
|---|---|---|---|---|
| GET | `/api/backoffice/messages` | `Messages:READ` | — | Liste **toute l'école** via `listClientsProjection` + `filterRows` |
| POST | `/api/backoffice/messages` | `Messages:CREATE` | **oui** | Crée une **nouvelle** conversation à chaque appel |
| PATCH | `/api/backoffice/messages/:messageId/read` | `Messages:UPDATE` | — | Exige participant (sauf Superadmin) |
| GET | `/api/backoffice/announcements` | `Notifications:READ` | — | Liste école, **pas** d'audience serveur |
| POST | `/api/backoffice/announcements` | `Notifications:CREATE` | **non** | Publie immédiatement (`status=published`) |
| PATCH | `/api/backoffice/announcements/:id` | `Notifications:UPDATE` | — | |
| POST | `/api/backoffice/announcements/:id/archive` | `Notifications:UPDATE` | — | |
| GET/POST/PATCH | `/api/backoffice/notifications` | `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` | POST non vérifié C1 | Plateforme uniquement |

**Absentes :** GET conversation, GET message, POST message-in-thread, préférences, templates, triggers, delivery, unread-count dédié.

---

## 5. Messages

Cycle réel :

`POST /messages` → `ignoreClientScope` → `resolveWritableSchoolCode(principal)` → `assertParticipantsInSchool` (même `school_id`) → **insertConversation** → insertParticipant(s) → insertMessage (`sender_user_id = principal.sub`).

Constat E2E :

- Sender spoofing (`senderUserId` / `schoolCode` body) **refusé** : principal + école du JWT.
- Message vide → 400.
- HTML/`<script>` **persisté tel quel** (pas d'échappement serveur ; risque XSS affichage).
- Pièce jointe : colonne `attachment_url` acceptée, pas de scan/stockage dédié audité ici.
- Pas d'API de suppression ; pas d'archivage message.

---

## 6. Conversations

Le modèle PG est un vrai thread. L'API **n'expose pas** les conversations :

- pas de GET `/conversations`
- `conversationId` dans le body d'un POST est **ignoré**
- une « réponse » Parent A → Admin A crée un **second** fil

Pagination : `sendList` ne pagine que si `?page=` ; défaut = tableau complet. Liste messages = `ORDER BY sent_at DESC` global école, pas par conversation.

---

## 7. Annonces

Création = publication immédiate (pas de brouillon métier distinct).  
`target_role` / `target_class_id` / `profile.audience` sont stockés.  
GET liste = toutes les annonces de l'école du principal. Une annonce « 6ème A » est visible à Parent A2 (même école, hors classe) — **audience UI only**.

Read/unread : `web/src/lib/announcementsRead.ts` et équivalent Mobile = **localStorage**. Multi-appareil / Web↔Mobile divergent par construction.

Isolation A↔B : OK (E2E 4). Archive depuis B : 403/404.

---

## 8. Notifications

Table `notifications` + `platformService.createNotification` : diffusion Superadmin / Admin Pays (`channel` défaut `app`).

**Aucun trigger métier observé** pour :

- note publiée
- absence / retard
- paiement / impayé (hors journal `payment_reminders`, canal `notification` **simulé**)
- annonce publiée
- nouveau message

E2E 6 : après envoi message + création annonce, `SELECT count(*) FROM notifications` = **0**.  
Marqué **NOT_IMPLEMENTED** — pas de faux succès badge.

`CommunicationService.getUnreadCount` compte des objets in-memory `status !== Lu`. Le Topbar Web compte `scopedNotifications` / `scopedMessages` / `countUnreadAnnouncements` (localStorage).

---

## 9. Paramètres Notifications

`web/src/pages/parametres/SettingsPlaceholders.tsx` → `SettingsNotificationsPage` :

- titre « Paramètres Notifications »
- badge « Bientôt disponible »
- copy : push, e-mail, SMS, WhatsApp, modèles, déclencheurs

Hub : `status: "soon"`. **Non retiré** (fonctionnalité non exploitable).

### Matrice canaux

| Canal | Backend | Provider | Secrets | Préférences user | Templates | Delivery | Retry | Coût | Statut |
|---|---|---|---|---|---|---|---|---|---|
| Interne (messages) | `clientsService` PG | — | — | non | non | `status` message | non | — | **partiel** (privé leak) |
| Interne (annonces) | `announcements` PG | — | — | localStorage | non | non | non | — | **partiel** |
| Interne (notif plateforme) | `notifications` CRUD | — | — | `read_at` | non | `channel=app` | non | — | **partiel** / hors établissement |
| E-mail | absent | absent | absent | absent | absent | absent | — | — | **absent** |
| SMS | copy UI + `payment_reminders.channel` | absent | absent | absent | absent | journal seulement | — | — | **placeholder** |
| WhatsApp | copy UI | absent | absent | absent | absent | — | — | — | **placeholder** |
| Push | copy UI | absent | absent | absent | absent | — | — | — | **placeholder** |

---

## 10. RBAC

Modules live catalogue : `messages`, `notifications`. **Pas de module `announcements`** : les routes annonces réutilisent `Notifications:*`.

| Permission | Lecture | Création | Réponse | Diffusion | Modification | Archivage | Paramètres |
|---|---|---|---|---|---|---|---|
| `Messages:READ` | liste école | | | | | | |
| `Messages:CREATE` | | POST message | POST (nouveau fil) | | | | |
| `Messages:UPDATE` | | | | | mark-read | | |
| `Notifications:READ` | liste annonces école | | | | | | |
| `Notifications:CREATE` | | | | POST annonce | | | |
| `Notifications:UPDATE` | | | | | PATCH annonce | archive | |
| `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` | notif plateforme | POST notif | | | PATCH / archive | | **seul hub « notifications »** |

Hardcode `role === "Teacher"` : non sur le chemin d'écriture `sendMessage`. Mobile CTA compose staff exige `Contacts:READ` + `Relations:READ` (`mobileCtaRbacAlignment.ts`) — fail-closed UI, **pas** le même garde-fou serveur (`assertParticipantsInSchool` = même école seulement).

Live RBAC : les routes non-Finance passent par `repository.resolveEffectivePermissions` (E2E 7 : révocation PG `messages` → même JWT POST **403**, aucune ligne). Pas de module `announcements` dédié.

---

## 11. Tenant isolation

| Action | École B vs ressource A | Résultat E2E |
|---|---|---|
| GET liste messages | absente de la liste | OK |
| GET `/messages/:id` | pas de route | 404 |
| GET `/conversations/:id` | pas de route | 404 |
| POST message `conversationId=A` | aucune row ajoutée au fil A | OK (fil ignoré) |
| PATCH mark-read message A | 403 (pas participant) | OK |
| GET liste annonces | absente | OK |
| POST archive annonce A | 403/404 | OK |
| Préférences notif B | n/a (table absente) | — |

IDOR **inter-école** : fail-closed sur les mutateurs existants.  
IDOR **intra-école** : GET liste = fuite (P0-001). Pas de GET by id donc pas de fuite métadonnée par UUID direct, mais la liste fuit le corps complet.

`listClientsProjection` charge **toutes** les écoles puis `filterRows` en mémoire — P2 perf / surface si filtre raté.

---

## 12. Web

| Écran | Route | État |
|---|---|---|
| Liste / envoi messages | `/messages` (`EntityPage`) | CRUD générique, pas de vue thread |
| Annonces | `/annonces` | CRUD générique |
| Notifications plateforme | `/notifications` | compose / lu / archive — **privilèges plateforme** |
| Paramètres notifications | `/parametres/notifications` | **PLACEHOLDER** conservé |
| Intégrations | `/parametres/integrations` | PLACEHOLDER SMS/WhatsApp/SMTP |
| Badges | `Topbar.tsx` | compteurs client sur état hydraté ; annonces = localStorage |

Loading / empty / error : EntityPage générique (pas recetté navigateur dans cet agent). Français : libellés métier OK. Aucun faux succès serveur identifié sur POST messages (idempotency Web à confirmer vs Finance — `clientsApi.sendMessage` **sans** `Idempotency-Key` dans l'API client).

P1 UX : Web n'envoie pas la clé d'idempotence sur messages (Mobile outbox oui).

---

## 13. Mobile

| Écran | Fichier | Contrat |
|---|---|---|
| Messages | `MessagesScreen.tsx` | GET liste, POST via **outbox** `domain: messages`, PATCH read |
| Annonces | `AnnouncementsScreen.tsx` | GET/POST/archive ; **outbox: false** |
| Notif plateforme | `PlatformNotificationsScreen.tsx` | ALL/COUNTRY priv. |
| Badges | `CommunicationHeaderIcons.tsx` | même famille que Topbar |

`OUTBOX_ALLOWED_DOMAINS` inclut `messages` (pas announcements / notifications).  
Cache SQLite L1 : **pas** de domaine communication.  
Composer staff : destinataires via contacts/relations (UI). Le serveur n'applique pas cette relation.

---

## 14. E2E métier

Commande : `npm run verify:communications-e2e`  
DB isolée `somafrik_com_c1_it`. Fixtures `SCH-COM-A` / `SCH-COM-B`, Admin/Teacher/Parent A, Parent A2, Admin/Parent B, relation Parent A ↔ Élève A.

| Scénario | Résultat |
|---|---|
| E2E 1 Message + read_at | **PASS** (PG conversation / participants / message / reads) |
| E2E 2 Réponse + B aveugle | **PASS** visibilité A/B ; thread = nouveau fil (note P1) |
| E2E 3 IDOR | **PASS** inter-école ; GET by id 404 (route absente) |
| E2E 4 Annonce A vs B | **PASS** |
| E2E 5 Audience classe | `target_class_id` persisté ; GET non filtré (note P1) |
| E2E 6 Notification | **NOT_IMPLEMENTED** (`notifications` vide) |
| E2E 7 RBAC live | **PASS** : révocation PG → 403, aucune ligne |
| E2E 8 Idempotency messages | **PASS** ; annonces : doublon possible (note P1) |

`clientsSecurity.test.js` déjà : participant hors école → 403.

---

## 15. Findings P0

### COM-C1-P0-001 — Liste messages non scoped aux participants

- **Fichier :** `GET /api/backoffice/messages` + `tenantScopeService.filterByRoleOwnership`
- **Scénario :** Enseignant A affecté (`classNames`) GET messages d'un fil Admin↔Parent auquel il n'est pas participant
- **Attendu :** 0
- **Observé :** le message sans `className` passe (`return true`) — communication privée exposée au staff
- **Parent A2** (autre `studentIds`) ne voit **pas** le fil si `studentId` est posé sur le message
- **Parent sans `studentIds` JWT** : liste vide (P1-009), y compris ses propres messages

### COM-C1-P0-002 — Destinataire = n'importe quel userId de l'école

- **Fichier :** `assertParticipantsInSchool`
- **Attendu :** relation métier (parent lié, enseignant de la classe, etc.)
- **Observé :** `user.school_id === school.id` suffit
- **Impact :** message privé vers un parent non lié / un pair

RBAC live (révocation PG, même JWT) : **non-finding** — `resolveEffectivePermissions` appliqué hors Finance.

---

## 16. Findings P1

| ID | Sujet |
|---|---|
| COM-C1-P1-001 | Pas de thread API : 1 POST = 1 conversation |
| COM-C1-P1-002 | Audience classe/rôle non appliquée au GET annonces |
| COM-C1-P1-003 | Unread annonces = localStorage (Web/Mobile divergents) |
| COM-C1-P1-004 | POST announcements sans `withIdempotency` |
| COM-C1-P1-005 | `updateMessageStatus(read)` global : un lecteur marque le message Lu pour tous |
| COM-C1-P1-006 | Web `clientsApi.sendMessage` sans `Idempotency-Key` (Mobile outbox oui) |
| COM-C1-P1-007 | HTML brut persisté (XSS stocké si l'UI n'échappe pas) |
| COM-C1-P1-009 | Parent sans `studentIds` JWT : GET messages vide (ses propres fils inclus) |

---

## 17. Findings P2

| ID | Sujet |
|---|---|
| COM-C1-P2-001 | Placeholder Paramètres Notifications (attendu tant que C2 n'existe pas) |
| COM-C1-P2-002 | `listProjection` charge toutes les écoles en mémoire |
| COM-C1-P2-003 | Unread messages = `status !== Lu` client, pas un COUNT tenanté indexé |
| COM-C1-P2-004 | EntityPage générique : pas de conversation UI |
| COM-C1-P2-005 | `CommunicationService` / `validationNotifications.js` LEGACY |
| COM-C1-P2-006 | Relances Finance canaux SMS/WhatsApp en copy seulement |
| COM-C1-P2-007 | N+1 `school_message_reads` subquery dans listProjection |
| COM-C1-P2-008 | Recette navigateur/appareil non jouée dans cet agent |

---

## 18. Capacités absentes

- Préférences utilisateur par canal
- Templates (absence, note, impayé, annonce, nouveau message)
- Triggers événementiels
- Delivery logs / retry / coût
- Providers e-mail, SMS, WhatsApp, push
- API conversations / pagination réelle / pièces jointes sécurisées
- Notification interne « nouveau message » / « annonce publiée »
- Lecture cache L1 communication
- Outbox announcements (refus explicite hors messages)

Offline : messages peuvent entrer en outbox Mobile (domaine autorisé). Annonces / notifications : pas d'outbox — la mutation doit échouer réseau, pas afficher un succès serveur fictif (à recetter appareil). Lecture cache L1 : non prévue.

---

## 19. Plan de correction (COM-C2+, hors cette PR)

Ordre recommandé, sans implémenter ici :

1. **P0-001** — GET messages scoped `EXISTS participant` (staff y compris enseignant affecté).
2. **P0-002** — résoudre destinataires via contacts/relations / affectations, refuser un `userId` nu.
3. **P1-009** — hydrater `studentIds` à l'auth **ou** lister par participation, pas seulement par élève.
4. **P1-001** — POST dans `conversationId` existant + GET thread paginé.
5. **P1-002 / P1-003** — audience serveur ; `announcement_reads` PG ; retirer localStorage comme SoT.
6. **P1-004 / P1-006** — idempotency annonces + header Web.
7. **P1-005** — ne plus globaliser `status=read` ; dériver unread de `school_message_reads`.
8. Ensuite seulement : écran Paramètres Notifications (préférences internes), puis canaux externes.

Ne pas ouvrir SMS/WhatsApp/push tant que l'interne n'est pas isolé et live-RBAC.

---

## 20. Verdict

**NO-GO**

Conditions pour un futur GO CONDITIONNEL (COM-C2) :

1. P0-001, P0-002 corrigés + E2E rouge→vert.
2. Diff GitHub CTO `develop → HEAD`.
3. Placeholder Paramètres conservé jusqu'à préférences **réellement** persistées.
4. Recette Web/Mobile humaine (thread, badge, offline outbox messages).

`GO PRODUCTION` Communication refusé.  
Aucun COM-C2 dans cette PR. Aucun Ready. Aucun merge depuis cet agent.
