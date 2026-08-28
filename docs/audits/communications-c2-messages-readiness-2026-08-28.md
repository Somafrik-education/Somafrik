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

**Contrat Superadmin (Option B, certifié)** : Communications **toujours request-scoped**. `schoolCode="*"` n'ouvre aucune vue globale. Un `effectiveSchoolCode` (query ou body) est obligatoire. Aucun bypass de participation.

**Stockage PJ** : `SOMAFRIK_COMMUNICATION_STORAGE` = répertoire durable. Production sans variable → fail-closed 503. test/dev → tmp autorisé.

**Verdict Messages : GO CONDITIONNEL** — P0 fermés ; P1-013/014/015/016 fermés par E2E/unit/payload. Recette appareil Expo PJ reste une condition de GO inconditionnel. C3/C4 hors scope.

---

## 2. P0 fermés

| ID | Sujet | Preuve |
|---|---|---|
| COM-C1-P0-001 | GET messages / conversation / mark-read scoped participation active | E2E C2-01 |
| COM-C1-P0-002 | Destinataires résolus depuis PG | E2E C2-02 |

## 3. P1 Messages fermés

| ID | Sujet | Preuve |
|---|---|---|
| P1-001 / P1-008 | API conversation/thread | E2E C2-03 |
| P1-005 | Read par utilisateur | E2E C2-04 |
| P1-006 | Web `Idempotency-Key` | `messagesApi` + `clientsApi.sendMessage` |
| P1-007 | XSS texte | E2E C2-11 |
| P1-009 | Parent sans `studentIds` JWT | E2E C2-05 |
| P1-010 | Historique message | `mapHistoryMessage` |
| P1-011 | sender + ISO | E2E C2-06 |
| P1-012 | PJ 0..N API/Web ACL | E2E C2-07 / C2-08 |
| **P1-013** | Endpoint destinataires canoniques | `GET /messages/recipients` ; Web/Mobile SoT ; E2E C2-13 |
| **P1-014** | Superadmin request-scoped | Option B ; E2E C2-14 `schoolCode=*` |
| **P1-015** | Stockage durable / fail-closed prod | unit attachments + cleanup orphelin |
| **P1-016** | PJ Mobile picker/upload/download | `MessagesScreen` + `messageAttachments.test.ts` |

P1-012 côté **appareil Expo** : recette manuelle restante → GO CONDITIONNEL, pas GO.

## 4. P1 reportés C3/C4

- Audience / reads / PJ annonces (C3)
- Notifications événementielles, historique transversal, `/parametres/notifications` (C4)
- SMS / WhatsApp / e-mail / push / templates

## 5. Matrice destinataires (création **et** `GET /messages/recipients`)

| Expéditeur | Destinataire autorisé | Refus |
|---|---|---|
| Admin / staff | Utilisateurs du même `school_id` | Autre école |
| Parent lié | Staff + enseignants des classes de ses élèves | Parent A2 ; enseignant hors contexte ; école B |
| Enseignant affecté | Parents de ses élèves + staff | Parent hors affectation ; autre école |
| Superadmin `*` | Uniquement après `effectiveSchoolCode` réel | Sans école → 400 ; autre école → 403/404 |

Sender = `principal.sub` exclusivement.

Web et Mobile n'utilisent plus `/backoffice/users`, Contacts:READ ni Relations:READ pour découvrir un destinataire.

## 6. Matrice RBAC

| Route | Permission |
|---|---|
| GET conversations / messages / unread-count / attachments | Messages:READ |
| GET messages/recipients | Messages:READ **ou** Messages:CREATE |
| POST conversations / messages / attachments | Messages:CREATE |
| PATCH messages/:id/read | Messages:UPDATE |

RBAC ≠ accès au fil. E2E C2-10 / C2-13 : révocation PG → 403 même JWT.

## 7. Endpoints

- `GET /api/backoffice/messages/recipients`
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

Superadmin / Admin Pays : query ou body `effectiveSchoolCode` obligatoire si le JWT n'a pas d'école réelle.

## 8. Migration DB / stockage

`backend/db/migrations/20260828_communications_c2_messages.sql`

Variable d'environnement :

- `SOMAFRIK_COMMUNICATION_STORAGE` : racine locale durable (mount disque). Pas de fournisseur cloud propriétaire.
- `NODE_ENV=production` sans cette variable : refus 503.
- `NODE_ENV=test|development` sans variable : tmp autorisé.
- Échec DB après écriture fichier : `removeStoredAttachment`.

## 9. Tests

- `backend/lib/communicationsAttachments.test.js` (tmp, prod fail-closed, durable, cleanup)
- `backend/lib/communicationsC2.http.pg.test.js` (C2-01 … C2-14)
- `Mobile/src/lib/messageAttachments.test.ts`
- Gate C1 conservé

## 10. Limitations

- Recette appareil Expo (picker réel) non exécutée dans cet agent → GO CONDITIONNEL
- Pas de projection transversale message\|annonce\|notification
- Superadmin : **pas** de listage global `schoolCode=*`

## 11. Verdict

**GO CONDITIONNEL** pour le domaine Message.

Pas de GO inconditionnel : recette appareil PJ Mobile + C3/C4 hors scope.

Aucun Ready. Aucun merge depuis cet agent.
