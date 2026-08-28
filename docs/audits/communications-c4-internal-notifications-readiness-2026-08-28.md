# COM-C4 — Notifications internes production-ready

Date : 2026-08-28  
Branche : `fix/communications-c4-internal-notifications-production-ready`  
Base de travail : `develop@5e150db5e2c2e042c5e82f6e684af05515dd554e`  
Périmètre : notifications internes Somafrik, sans fournisseur SMS/WhatsApp/push externe.

## Verdict de chantier

**GO CONDITIONNEL** — uniquement pour une recette appareil Expo non exécutée.

Le backend, l'outbox, les triggers, le RBAC live, le tenant, les pièces jointes et les E2E PostgreSQL C4-01…C4-16 sont portés au contrat production-ready. Aucun défaut backend / tenant / RBAC / outbox n'est laissé ouvert volontairement.

**AUCUN :**
- SMS
- WhatsApp
- email
- push
- provider externe

dans COM-C4.

## Architecture

COM-C4 sépare deux domaines qui étaient auparavant confondus :

- les **notifications plateforme** historiques (`notifications`, `/backoffice/notifications`), réservées aux opérations Superadmin/Admin Pays ;
- les **notifications internes métier** (`communication_notifications` + `notification_recipients`), destinées aux utilisateurs d'un établissement.

`/parametres/notifications` reste **ComingSoon** (`Bientôt disponible`). COM-C4 n'active aucun canal externe.

### Schéma

- `communication_event_outbox` : outbox transactionnelle, `event_key` UNIQUE
- `communication_notifications` : enregistrement canonique
- `notification_recipients` : destinataire individuel (`read_at`, `archived_at`)

La table plateforme `notifications` n'est ni lue ni écrite par le service C4.

### Outbox

Les triggers écrivent dans **la même transaction** que la mutation métier :

```
INSERT … ON CONFLICT (event_key) DO NOTHING
```

Le dispatcher claim via `FOR UPDATE SKIP LOCKED`, y compris reprise des lignes `processing` abandonnées (> 2 min). Colonnes : `processed_at`, `attempts` (compteur de retry), `last_error`, `available_at`. Un événement en erreur n'est pas supprimé ; un event invalide n'interrompt plus le drain des suivants. Le worker est désactivable (`COMMUNICATION_NOTIFICATIONS_WORKER=disabled` / `NODE_ENV=test`) et s'arrête proprement sur SIGTERM/SIGINT.

### Triggers / event catalog

| Event | Table | Condition d'émission |
| --- | --- | --- |
| `communication.message.created` | `school_messages` | INSERT uniquement |
| `communication.announcement.published` | `announcements` | INSERT/UPDATE **vers** `published` ; pas de réémission si déjà published |
| `attendance.student.absent` | `attendance` | INSERT/UPDATE **vers** `absent` ; pas de réémission si déjà absent |
| `pedagogy.grade.published` | `grades` | INSERT/UPDATE **vers** `published` ; pas de réémission si déjà published ; un UPDATE de score d'une note déjà published n'ajoute pas d'event |
| `finance.payment.recorded` | `payments` | INSERT/UPDATE **vers** `paid` non cancelled ; pas de réémission si déjà paid |

`event_key` est stable : `{event_type}:{source_entity_id}`. Idempotence garantie même si un trigger se réexécute.

Point de vigilance CTO : les UPDATE d'une note déjà published, d'un paiement déjà `paid` ou d'une annonce déjà published **ne génèrent pas** de nouvelle notification. Couvert par E2E C4-02 / C4-04 / C4-05.

### Destinataires

- Message : participants actifs **sauf** l'expéditeur
- Annonce : **exactement** `announcement_recipients` (l'auteur reste destinataire s'il est dans le snapshot)
- Absence : parents liés via `contact_relations`
- Note publiée : parents liés + compte élève canonique ; le body n'expose pas le score
- Paiement `paid` : parents liés

### Sender

- Auto : `senderType=system`, `senderUserId=null`, `senderName=Somafrik`
- Humain : `senderType=user`, `senderUserId=principal.sub`, `senderName` canonique PostgreSQL. Un body `senderUserId` / `senderName` est ignoré.

### Read / unread / archive / historique

État individuel sur `notification_recipients`. Aucun DELETE physique. Archive utilisateur : la ligne `communication_notifications` reste. SoT Web/Mobile = API `unread-count`, pas localStorage/AsyncStorage.

### Attachments

Réutilisation stricte C2/C3 (`communication_attachments`, `entity_type=notification`). Download : `Notifications:READ` live + tenant + recipient (ou gestionnaire `Notifications:UPDATE` / privilèges élevés). Pas d'OR croisé Messages/Announcements/Notifications. P1-017 C3 non régressé : un `entity_type` étranger est refusé par la route de l'autre domaine.

### RBAC / request-scope / tenant

Routes internes toutes request-scoped. Superadmin `schoolCode=*` sans `effectiveSchoolCode` → 400. Isolation école B et IDOR non-destinataire → 403/404. Révocation PostgreSQL `Notifications:READ` avec JWT inchangé → list/get/download 403, alors que `Messages:READ` / `Announcements:READ` restent et **ne** débloquent **pas** la PJ notification.

### API

- `GET /api/backoffice/internal-notifications`
- `GET /api/backoffice/internal-notifications/unread-count`
- `GET /api/backoffice/internal-notifications/:notificationId`
- `POST /api/backoffice/internal-notifications`
- `PATCH …/:notificationId/read`
- `PATCH …/:notificationId/archive`
- `POST …/attachments`
- `GET …/attachments/:attachmentId`

Pagination SQL curseur `(created_at, id)` sur la liste.

### Web

`InternalNotificationsCenter` sur `/notifications` dès qu'un établissement concret est actif. Badge Topbar via `GET unread-count`, rafraîchi après read/archive/create, au focus, et toutes les 30 s. La page historique plateforme reste pour `schoolCode=*`. `/parametres/notifications` inchangé (ComingSoon).

### Mobile

Écran `InternalNotifications` enregistré, exposé dans le drawer des rôles établissement, le menu, et le header (badge serveur). Le domaine plateforme reste `PlatformNotifications`. Aucune SoT AsyncStorage.

### Performance / observabilité

Claim `SKIP LOCKED`, index partiel outbox pending/failed, drain borné (max 500). Erreurs worker journalisées sans body privé (`message` tronqué 300/500). Event invalide : `status=failed` + backoff 5 s, drain continue.

## E2E C4-01…C4-16

Assertions produit PostgreSQL réel (`backend/lib/communicationsC4.http.pg.test.js`) :

| Cas | Contrat |
| --- | --- |
| C4-01 | POST message → 1 outbox, Parent A notifié, expéditeur exclu, sender system, navigation conversation, retry sans doublon |
| C4-02 | Snapshot `announcement_recipients` exact, auteur inclus s'il y figure, Parent A2 / école B exclus, UPDATE déjà published sans nouvel event |
| C4-03 | Absence → parent lié uniquement ; UPDATE absent identique idempotent |
| C4-04 | Note published → parent + élève, score absent du body ; draft sans notif ; UPDATE déjà published sans nouvel event |
| C4-05 | Paiement `paid` → parent lié ; pending sans notif ; UPDATE déjà paid sans doublon |
| C4-06 | PATCH read → `readAt` ISO immédiat, unread-count -1, autre destinataire inchangé |
| C4-07 | Même notification / readAt / unread via l'API unique Web-Mobile |
| C4-08 | Sender system exact sur event auto |
| C4-09 | Sender humain = principal ; spoof body ignoré |
| C4-10 | PDF recipient 200 ; non-recipient / école B 403/404 ; `.exe`, MIME interdit, trop gros, path traversal refusés |
| C4-11 | Revoke `Notifications:READ` live → 403 ; Messages/Announcements conservés ne débloquent pas la PJ |
| C4-12 | Superadmin `*` : list/get/read/archive/upload/download 400 sans scope ; OK avec SCH-C4-A ; SCH-C4-B 403/404 |
| C4-13 | `event_key` + Idempotency-Key + drains concurrents → 1 notification, 1 recipient/user |
| C4-14 | ROLLBACK métier → 0 outbox ; event commité puis drain ultérieur → 1 notification |
| C4-15 | IDOR GET/read/archive/PJ 403/404, aucune mutation |
| C4-16 | Archive logique, historique physique conservé, pas de DELETE |

## Limitations

- Recette visuelle Expo sur appareil réel non exécutée dans cet environnement (d'où GO CONDITIONNEL).
- Compteur `retry_count` implémenté comme colonne `attempts`.
- Pas de digest / cadence / WebSocket : hors périmètre C4.
- Les E2E notes / paiements / absences / annonces valident les **triggers** (INSERT/UPDATE SQL métier) plutôt que chaque façade HTTP de ces domaines, afin de rester non-régressifs vis-à-vis des contrats Attendance / Pedagogy / Finance.

## Critères de GO CTO avant merge

Le merge ne peut être envisagé qu'après :

1. diff GitHub indépendant `develop -> HEAD` ;
2. branche `0 behind` et merge-base égal au `develop` courant ;
3. aucun conflit ;
4. workflow `Communications C4` vert sur le HEAD exact ;
5. PR Gates standard verts sur le HEAD exact ;
6. absence de dérive de périmètre ;
7. revalidation complète si le HEAD ou `develop` bouge.

Aucun Ready. Aucun merge depuis cet agent.
