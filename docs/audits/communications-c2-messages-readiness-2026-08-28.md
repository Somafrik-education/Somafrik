# Communications C2 — Messages production-ready

Date : 2026-08-28  
Branche : `fix/communications-c2-messages-production-ready`  
Base obligatoire : `develop@5b9064779f54c4e3aaa05ef60f309f100035614e`

```text
COM-C2      MESSAGES PRODUCTION-READY
PR          DRAFT UNIQUEMENT
Ready       NON
Merge       NON
COM-C3      NON OUVERT
COM-C4      NON OUVERT
```

Le CTO effectuera un diff GitHub indépendant `develop → HEAD` avant toute autorisation de merge.

Gate : `npm run verify:communications-c2`  
Workflow : `.github/workflows/communications-c2.yml` (`Communications C2`)  
Le gate COM-C1 (`verify:communications-e2e`) reste disponible.

---

## 1. Executive summary

RBAC autorise l'usage du module Messages. La relation métier PostgreSQL autorise le destinataire. La participation active à `school_conversation_participants` autorise l'accès au fil. « Même établissement » ne suffit plus.

Le placeholder `/parametres/notifications` est **conservé**. Annonces et notifications événementielles hors scope.

**Verdict Messages : GO CONDITIONNEL** — P0-001 et P0-002 fermés par E2E PostgreSQL ; thread, read par utilisateur, ISO, `senderName`, PJ 0..N authentifiées et live-RBAC prouvés. Limitations : pas de Centre transversal (C4), pas de PJ Mobile native (upload Web/API), pas d'annonces.

---

## 2. P0 fermés

| ID | Sujet | Preuve |
|---|---|---|
| COM-C1-P0-001 | GET messages / conversation / mark-read scoped participation active | E2E C2-01 : Teacher A affecté, non participant → thread absent, GET 403/404 |
| COM-C1-P0-002 | Destinataires résolus depuis PG (parent lié / affectation enseignant) | E2E C2-02 : Admin A et Teacher A autorisés ; Teacher A2, Parent A2, école B refusés |

## 3. P1 Messages fermés

| ID | Sujet | Preuve |
|---|---|---|
| P1-001 / P1-008 | API conversation/thread | `GET/POST /conversations`, `GET/POST /conversations/:id/messages` ; E2E C2-03 une conversation, 3 messages |
| P1-005 | Read par utilisateur (`school_message_reads`) | E2E C2-04 : pas de `school_messages.status = read` global |
| P1-006 | Web `Idempotency-Key` | `messagesApi` + `clientsApi.sendMessage` |
| P1-007 | XSS : stockage texte, UI React/RN sans HTML | E2E C2-11 + `MessagesConversationsPage` texte React (pas `dangerouslySetInnerHTML`) |
| P1-009 | Parent participant sans `studentIds` JWT | E2E C2-05 |
| P1-010 | Historique message (type, expéditeur, ISO, PJ, lecture, audit) | Projection `mapHistoryMessage` |
| P1-011 | `senderUserId` + `senderName` + `sentAt` ISO | E2E C2-06 |
| P1-012 | `communication_attachments` 0..N, upload/download ACL | E2E C2-07 / C2-08 |

## 4. P1 reportés C3/C4

- Audience / reads / PJ annonces (C3)
- Notifications événementielles, auteur FK, historique transversal, `/parametres/notifications` (C4)
- SMS / WhatsApp / e-mail / push / templates

## 5. Matrice destinataires (création)

| Expéditeur | Destinataire autorisé | Refus |
|---|---|---|
| Admin établissement / staff | Utilisateurs du même `school_id` | Autre école |
| Parent lié | Staff établissement + enseignants des classes de ses élèves | Parent A2 non lié ; élève hors relation |
| Enseignant affecté | Parents des élèves de ses classes + staff | Teacher A2 hors affectation ; autre école |

Sender = `principal.sub` exclusivement.

## 6. Matrice RBAC

| Route | Permission |
|---|---|
| GET conversations / messages / unread-count / attachments | Messages:READ |
| POST conversations / messages / attachments | Messages:CREATE |
| PATCH messages/:id/read | Messages:UPDATE |

RBAC ≠ accès au fil. Participation active requise ensuite. E2E C2-10 : révocation PG → 403 même JWT.

## 7. Endpoints

- `GET/POST /api/backoffice/conversations`
- `GET /api/backoffice/conversations/:conversationId`
- `GET/POST /api/backoffice/conversations/:conversationId/messages`
- `GET /api/backoffice/messages` (liste participation-scoped, compat)
- `POST /api/backoffice/messages` (nouvelle conversation, ou reply si `conversationId`)
- `GET /api/backoffice/messages/:messageId`
- `PATCH /api/backoffice/messages/:messageId/read`
- `GET /api/backoffice/messages/unread-count`
- `POST /api/backoffice/communications/attachments`
- `GET /api/backoffice/communications/attachments/:attachmentId`

## 8. Migration DB

`backend/db/migrations/20260828_communications_c2_messages.sql`  
Boot : `ensureClientsCanonicalBootstrap` → `COMMUNICATIONS_C2_SCHEMA_SQL`

- `school_conversation_participants.status` (`active` / `left` / `removed`)
- `communication_attachments`
- indexes `(conversation_id, sent_at, id)`, participant user, reads, attachments

## 9. Tests

- `backend/lib/communicationsAttachments.test.js`
- `backend/lib/clientsSecurity.test.js`
- `backend/lib/communicationsC2.http.pg.test.js` (C2-01 … C2-12)
- `web/src/pages/MessagesConversationsPage.tsx` (texte React, pas `dangerouslySetInnerHTML`)
- Gate C1 conservé

## 10. Limitations

- Upload Mobile natif (picker) non branché ; reply/thread/outbox oui
- Pas de projection transversale message\|annonce\|notification
- Superadmin `schoolCode=*` conserve le listage global explicitement prévu

## 11. Verdict

**GO CONDITIONNEL** pour le domaine Message.

Pas de GO inconditionnel tant que C3/C4 et le Centre de communications ne sont pas faits — hors scope C2.

Aucun Ready. Aucun merge depuis cet agent.
