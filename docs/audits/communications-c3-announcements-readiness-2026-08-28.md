# Communications C3 — Annonces production-ready

Date : 2026-08-28  
Branche : `fix/communications-c3-announcements-production-ready`  
Base obligatoire : `develop@cef2fb87c7a5ef9c205643f0a8e20bdb754f4a41` (merge COM-C2 #373)

```text
COM-C3      ANNONCES PRODUCTION-READY
PR          DRAFT UNIQUEMENT
Ready       NON
Merge       NON
COM-C4      NON OUVERT
```

Le CTO effectuera un diff GitHub indépendant `develop → HEAD` avant toute autorisation de merge.

Gate : `npm run verify:communications-c3`  
Workflow : `.github/workflows/communications-c3.yml` (`Communications C3`, checkout exact-HEAD)  
Les gates COM-C1 (`verify:communications-e2e`) et COM-C2 (`verify:communications-c2`) restent disponibles.

Le placeholder `/parametres/notifications` est **conservé** (`ComingSoonState`). SMS / e-mail / WhatsApp / push / templates / notifications événementielles hors scope.

---

## 1. Executive summary

La décision structurante de C3 est le **snapshot des destinataires à la publication**.

- **RBAC** (`Announcements:READ|CREATE|UPDATE`) autorise l'usage du module.
- **Audience** résolue en PostgreSQL au `POST` → table `announcement_recipients`.
- **Lecture** individuelle → table `announcement_reads` (plus de stockage navigateur comme SoT).
- **Tenant** = établissement request-scoped (`requireSchool` / `communicationSchoolScope`, contrat COM-C2).

Un jeton `Announcements:READ` ne donne **pas** toutes les annonces de l'école. Un utilisateur de la même école hors snapshot reçoit 404 sur GET direct (pas de fuite titre / auteur / audience). `school_id` identique n'est jamais une autorisation de lecture.

Auteur = `principal.sub` uniquement, résolu dans `users` du tenant. Un UUID / identité absente de `clients.users` → 403 (la fixture LOT7 crée un Admin School canonique ; pas de synthèse d'auteur depuis un slug JWT).

**Verdict Annonces : GO CONDITIONNEL** — findings COM-C1 d'annonces fermés par E2E C3-01…16. Recette appareil Expo (picker PJ réel) non exécutée dans cet agent. C4 hors scope. Autorisation de merge réservée au diff GitHub CTO.

---

## 2. Architecture finale

```
POST /announcements
  → requireSchool (tenant)
  → Announcements:CREATE (RBAC live PG)
  → auteur = principal.sub (jamais le body)
  → parseAudience (school | roles | classes+kinds)
  → résoudre classes dans l'établissement
  → snapshot recipients (élèves / parents / enseignants / personnel)
  → INSERT announcements + announcement_recipients + attachments
  → Idempotency-Key

GET list / GET :id
  → tenant AND (recipient OR Announcements:UPDATE management)
  → legacy sans snapshot : invisible au destinataire, visible au manager (unresolved)

PATCH :id/read → row announcement_reads (destinataire uniquement)
GET unread-count → published + recipient + not in reads, scoped école
```

Web : `AnnouncementsPage` + `announcementsApi` + `useAnnouncementsUnreadCount`.  
Mobile : `AnnouncementsScreen` + `AnnouncementMutationControls` + même API.

---

## 3. Migrations / tables

Fichiers :

- `backend/db/migrations/20260828_communications_c3_announcements.sql`
- `backend/db/communicationsAnnouncementsSchema.js` (boot `ensureClientsCanonicalBootstrap` après C2)

| Objet | Rôle |
|---|---|
| `announcements.published_by` | FK auteur de publication |
| `announcements.archived_at` / `archived_by` | archive soft |
| `announcements.audience_payload` | JSONB contrat audience |
| `announcement_recipients` | PK `(announcement_id, user_id)` snapshot |
| `announcement_reads` | PK `(announcement_id, user_id)` lecture |

Index :

- `announcement_recipients (user_id, announcement_id)`
- `announcement_recipients (school_id, announcement_id)`
- `announcement_reads (user_id, announcement_id)`
- `announcements (school_id, published_at DESC, id DESC)`
- `communication_attachments (entity_type, entity_id)` (C2)

---

## 4. Endpoints

| Méthode | Chemin | Permission |
|---|---|---|
| GET | `/api/backoffice/announcements` | `Announcements:READ` |
| GET | `/api/backoffice/announcements/unread-count` | `Announcements:READ` |
| GET | `/api/backoffice/announcements/audience-options` | `Announcements:CREATE` |
| GET | `/api/backoffice/announcements/:id` | `Announcements:READ` |
| POST | `/api/backoffice/announcements` | `Announcements:CREATE` + `Idempotency-Key` |
| POST | `/api/backoffice/announcements/attachments` | `Announcements:CREATE` |
| PATCH | `/api/backoffice/announcements/:id` | `Announcements:UPDATE` |
| PATCH | `/api/backoffice/announcements/:id/read` | `Announcements:READ` |
| POST | `/api/backoffice/announcements/:id/archive` | `Announcements:UPDATE` |
| GET | `/api/backoffice/communications/attachments/:id` | `Messages:READ` **ou** `Announcements:READ` + ACL métier |

Pas de DELETE physique d'une annonce publiée.

---

## 5. Modèle d'audience

| Scope | Body | Résolution PG |
|---|---|---|
| Établissement | `audience=Tous` / omis | `users` actifs de l'école |
| Rôle(s) | `recipientKinds` / `audience=Parents` | `user_roles` PARENT / TEACHER / STUDENT / staff |
| Classe(s) + catégories | `classIds` + `recipientKinds` | inscriptions, `contact_relations`, `teacher_assignments` |
| C1 compat | `{audience:"Élèves", targetClassId}` | classes + `student` |

Catégories : `parent`, `teacher`, `student`, `staff`.  
Staff uniquement si demandé. IDs utilisateurs client ignorés. Classe hors établissement → 404.

---

## 6. Snapshot destinataires

À la publication uniquement. `UNIQUE(announcement_id, user_id)`.  
Un changement de classe / un nouveau parent **ne réécrit pas** l'historique (E2E C3-05).  
Audience **immuable** après publication (PATCH audience → 403).

---

## 7. RBAC

Module catalogue : `moduleKey: announcements`, `moduleName: Announcements`.  
Backfill : `reconcileCanonicalAnnouncementsGrants` copie les grants **Notifications** existants vers **Announcements** (can_delete = false), sans hardcoder les libellés de rôles métier.

| Jeton | Effet |
|---|---|
| `Announcements:READ` | liste / détail / mark-read / unread / download si destinataire |
| `Announcements:CREATE` | publier, upload, audience-options |
| `Announcements:UPDATE` | archive, update titre/corps, **vue management** (historique école même hors audience) |
| `Gérer annonces` | alias UPDATE (résolution fonctionnelle) |

Révocation PG : même JWT → 403 immédiat (E2E C3-12).

---

## 8. Tenant / request-scope

Réutilisation stricte de `requireSchool` / `resolveWritableSchoolCode` (COM-C2).  
Superadmin / Admin Pays `schoolCode="*"` sans `effectiveSchoolCode` → **400** sur list, get, post, patch, archive, read, unread, audience-options, upload, download.

---

## 9. Lifecycle

`published` | `archived`. Archive = `status` + `archived_at` + `archived_by`.  
Titre/corps modifiables avec UPDATE + `updated_at` + audit. Pas de recalcul d'audience.

---

## 10. Read / unread

SoT = `announcement_reads`. Compteur = annonces publiées, destinées au principal, absentes des reads, **dans l'école scoped**.  
Web Topbar et Mobile header : `GET unread-count`. Aucune mutation locale définitive avant ACK.

`updateAnnouncement` / `markRead` hydratent la réponse via `hydrateAnnouncementWithTx(tx, …)` dans la **même** transaction (finding **COM-C3-P1-018 FERMÉ**). `PATCH /read` renvoie `readAt` ISO immédiatement ; `PATCH /:id` renvoie title/body/`updatedAt` déjà persistés.

---

## 11. Historique (projection)

`type=announcement`, id, schoolCode, title, content, createdByUserId/Name, publishedByUserId/Name, createdAt/publishedAt/updatedAt/archivedAt ISO 8601, status, audience, recipientCount, readAt, attachments[], audit.  
Management : `readsCount` / `unreadCount`. `unresolved` si legacy sans snapshot.

---

## 12. Attachments

Réutilisation de `communication_attachments`, `entity_type=announcement`.  
0..N, MIME PDF/JPEG/PNG, 10 Mo, filename neutralisé, `storage_key` serveur, cleanup échec DB.  
Upload dédié `POST /announcements/attachments`. Association transactionnelle `attachmentIds[]`.  
Attachment message ou école B : impossible. Download : auth + tenant + **permission live du `entity_type`** + recipient **ou** management.

Le GET générique `/communications/attachments/:id` reste un OR d'entrée (`Messages:READ` | `Announcements:READ`). Après résolution du fichier :

- `entity_type=message` → `Messages:READ` live (même JWT, révocation PG immédiate)
- `entity_type=announcement` → `Announcements:READ` live

Contrats internes : `GET /api/backoffice/messages/attachments/:attachmentId` et `GET /api/backoffice/announcements/attachments/:attachmentId` (`assertEntityTypeDownloadAccess`). Finding **COM-C3-P1-017 FERMÉ**.

---

## 13. Web / Mobile

Composer : titre, message, audience (école / rôles / classes + catégories), PJ, publier.  
États loading / empty / error / retry / submitting. Pas de faux succès.  
Dates affichées `28/08/2026 à 16:27` (locale) depuis ISO API.  
XSS : texte brut, pas d'éditeur HTML.

---

## 14. Performance

Pagination `{ items, nextCursor }` filtrée en SQL. Hydratation attachments / creator / readAt / counts en sous-requêtes, pas de chargement multi-écoles.

---

## 15. Legacy fail-closed

Pas de `if no recipients then allow school`. Annonce historique sans snapshot : invisible au destinataire, visible au manager, `unresolved=true` (E2E C3-15).

---

## 16. Matrice audience (E2E)

| Cas | Voit | Ne voit pas |
|---|---|---|
| C3-01 établissement | utilisateurs école A | école B |
| C3-02 classe A + parents | Parent A | Parent A2, Teacher A, Student A, GET 404 |
| C3-03 classe A + enseignants | Teacher A | Teacher A2, Parent A |
| C3-04 classe A + élèves | Student A | Student A2, Parent A |
| C3-05 snapshot | Parent A après déménagement | nouveau Parent A3 |

---

## 17. Matrice RBAC (E2E C3-12)

| Action | Grant présent | Grant révoqué |
|---|---|---|
| POST | 201 | 403, 0 row |
| GET list | 200 | 403 |
| archive | 200 (si UPDATE) | 403 |

---

## 18. Findings COM-C1 — partie Annonces

| ID | Sujet | Statut C3 |
|---|---|---|
| COM-C1-P1-002 | audience persistée non filtrée | **FERMÉ** (snapshot + SQL) |
| COM-C1-P1-003 | read/unread stockage navigateur | **FERMÉ** (`announcement_reads`) |
| COM-C1-P1-004 | POST non idempotent | **FERMÉ** (`withIdempotency`) |
| COM-C1-P1-010 partie Annonce | historique | **FERMÉ** (projection ISO) |
| COM-C1-P1-011 partie Annonce | expéditeur + timestamp | **FERMÉ** (`createdBy*` + ISO) |
| COM-C1-P1-012 partie Annonce | PJ 0..N | **FERMÉ** (`entity_type=announcement`) |
| COM-C3-P1-017 | ACL PJ par `entity_type` | **FERMÉ** (`assertEntityTypeDownloadAccess`) |
| COM-C3-P1-018 | relecture hors tx | **FERMÉ** (`hydrateAnnouncementWithTx`) |

Messages (C2) et notifications événementielles (C4) hors ce rapport.

---

## 19. Tests C3-01…C3-16

Tous exercés dans `backend/lib/communicationsC3.http.pg.test.js` (DB isolée `somafrik_com_c3_it`, port 19884).

C3-07 : même user, mark-read API → `read_at` PG → GET suivant `readAt` + badge identique (contrat Web/Mobile).  
P1-018 : `PATCH /read` contient `readAt` ISO dans la réponse ; `PATCH /:id` contient title/body/`updatedAt` alignés PG.  
P1-017 : PJ Message vs Annonce, révocation live du module opposé, hors audience, école B, Superadmin request-scoped.  
C3-16 : `<script>alert(1)</script>` stocké/retourné comme texte.

Tests UI/service : `web/src/lib/announcementsC3.test.ts`, `Mobile/src/lib/announcementsC3.test.ts`, alignement RBAC Mobile.

---

## 20. Hors scope (COM-C4+)

Notification automatique après annonce, SMS, e-mail, WhatsApp, push, templates, préférences, écran Paramètres Notifications actif.

---

## 21. Verdict

**GO CONDITIONNEL** pour le domaine Annonces.

Pas de GO inconditionnel : recette appareil Expo PJ Mobile non exécutée ; PR Draft ; merge interdit tant que le CTO n'a pas validé le diff `develop → HEAD`.

Critères NO-GO C3 **non rencontrés** sur le parcours E2E : audience serveur, reads PG, isolation école B, GET hors audience 404, timestamps ISO, creator non spoofable, PJ tenantées, POST idempotent.
