# Communication — matrice de parité Web ↔ Mobile

**Base :** `develop@193c5df3e7b3049bb02f70d53106b0889f95fd0d`  
**Branche :** `cursor/communication-web-mobile-parity-7447`  
**GREEN :** `docs/audits/parite-web-mobile-communication-green-2026-09-10.md` (14/14 cas de parité verts)  
**Règle :** même donnée métier canonique PostgreSQL → même identifiant, auteur, établissement, audience, titre, contenu, date, statut, lu/non lu. Pas de copie pixel. Pas de second état métier.

Contrat UX : `docs/audits/parite-web-mobile-communication-ux-maquette.md`

## Inventaire (audit, sans correction)

| Surface | Backend canonique | Web | Mobile |
| --- | --- | --- | --- |
| Messages (C2) | `GET/POST /backoffice/conversations`, fil `/conversations/:id/messages`, `POST /messages`, `PATCH …/read`, `GET …/unread-count`, destinataires, PJ | `MessagesConversationsPage` via `messagesApi` (conversations) | `MessagesScreen` via `GET /backoffice/messages` plat + filtres locaux `parentPhone` / `direction` |
| Annonces (C3) | `GET/POST /backoffice/announcements`, audience-options, mark-read, archive, PJ ; plateforme `platform-announcements` | `AnnouncementsPage` liste unifiée école + plateforme | `AnnouncementsScreen` même APIs via `getCanonicalAnnouncements` |
| Notifications internes (C4) | `GET /backoffice/internal-notifications` (cursor), unread-count, mark-read, archive, create, PJ | `InternalNotificationsCenter` + pagination `nextCursor` + compteur serveur | `InternalNotificationsScreen` 1re page seulement ; compteur = lignes chargées |
| Notifications plateforme | `GET/POST/PATCH /backoffice/notifications` | `PlatformNotificationsPage` ( Super / Pays ) | écran orphelin, **hors graphe live** (#577, volontaire) |
| Préférences canal | `GET/PUT /me/communication-preferences` | panneau Topbar | `CommunicationPreferencesSheet` |
| Navigation chrome | — | Topbar Messages / Annonces / Notifications | drawer + Menu Annonces/Notifications ; Messages absent du Menu ; `CommunicationHeaderIcons` non monté |

Aucune suppression de surface existante. Plateforme Notifications reste Web-only (#577).

## Matrice fonctionnelle

| Fonction | Backend | Web | Mobile | Écart | Action |
| --- | --- | --- | --- | --- | --- |
| Consultation liste Messages | C2 conversations + liste plate | conversations | liste plate + filtre rôle | **Web ≠ Mobile** | Mobile : même `GET /conversations` |
| Détail / fil | C2 thread | oui | modal d’un message, regroupement client `conversationId` | **incohérent** | Mobile : fil `GET …/messages` |
| Création / réponse | POST conversations / messages | conversations create/reply | `POST /messages` (même persistance) | écriture équivalente | conserver POST messages Mobile (déjà canonique) |
| Modification | C3 titre/corps uniquement | non exposé | non exposé | aucun | ne pas inventer |
| Suppression | aucun DELETE | — | — | aucun | ne pas inventer |
| Archive | C3 + C4 | oui | oui | OK | conserver |
| Audience | C3 snapshot `audience` / `audienceLabel` | détail seulement | liste + détail | **Web < Mobile** | afficher `audienceLabel` en liste Web |
| Recherche | pas de search serveur C2 | absente | texte local sur messages plats | **Mobile > Web** + source différente | filtre client **sur la liste canonique** Web et Mobile |
| Filtres | unreadCount conversation / readAt | aucun | reçus/envoyés locaux | **incohérent** | Tous / Non lus sur la liste canonique |
| Statut | C3 `published`/`archived` ; C2/C4 lu | C3 détail | badge C3 | OK C3 | conserver |
| Lecture / non lu | `unread-count` + `readAt` par utilisateur | Annonces/C4 : API ; **Messages Topbar = DataContext legacy** | Messages = `MessageService` + `status === "Nouveau"` ; C4 = page locale | **P1** | brancher `GET …/unread-count` |
| Navigation | — | Topbar 3 icônes | Menu sans Messages | **Web > Mobile** | entrée Messages au Menu ; chrome Communication |
| RBAC | Messages/Announcements/Notifications :READ/CREATE/UPDATE | PermissionRoute + flags page | `canReadRoute` / `canAccessMessagesRoute` | OK (pas de mutation RBAC) | ne pas élargir |
| Loading / error / empty | — | Annonces/C4 OK ; **Messages toast seulement** | QueryStateView Messages/Annonces ; C4 spinner | **Messages Web** | LoadingState / ErrorState / EmptyState |
| Tenant / school_id | JWT + `effectiveSchoolCode` | `communicationSchoolScope` | idem | OK backend | ne pas toucher au serveur |
| Pagination C4 | `nextCursor` | oui | ignoré | **Web > Mobile** | passer `cursor` |
| Donnée mock fallback | interdit | `RECIPIENT_KIND_FALLBACK` à la **création** si audience-options échoue | thèmes catalogue composer seulement | P2 create | kinds API ou formulaire bloqué ; **pas de liste métier fictive** |

## Classification

| ID | Priorité | Type | Constat |
| --- | --- | --- | --- |
| COM-01 | P1 | Web ≠ Mobile | Badge Messages Web = `scopedMessages` DataContext, pas `GET /messages/unread-count` |
| COM-02 | P1 | Web | Messages : pas d’état chargement / erreur + Réessayer |
| COM-03 | P1 | Web < Mobile | Recherche absente sur la liste conversations |
| COM-04 | P1 | Web < Mobile | Audience C3 absente de la liste Web |
| COM-05 | P1 | UX | Pas de chrome module **Communication** (titre + sous-nav) |
| COM-06 | P1 | Web | Pas de filtre Tous / Non lus |
| COM-10 | P1 | Mobile ≠ Web | Liste Messages = `/messages` plat, pas `/conversations` |
| COM-11 | P0/P1 | Mobile | Filtres `parentPhone` / `direction` peuvent masquer une conversation dont l’utilisateur est participant |
| COM-12 | P1 | Mobile ≠ Web | Non lu Messages = heuristique `MessageService`, pas l’API |
| COM-13 | P1 | Mobile | KPI Accueil Messages = `status === "Nouveau"` + direction, pas `unread-count` |
| COM-14 | P1 | Mobile ≠ Web | Compteur C4 = `rows.filter(!readAt)` (page), pas l’API |
| COM-15 | P1 | Mobile < Web | `nextCursor` C4 ignoré |
| COM-16 | P1 | Mobile < Web | Menu sans Messages |
| COM-17 | P1 | UX Mobile | Pas de chrome Communication sur les 3 écrans |

## Hors lot (volontaire)

| Sujet | Pourquoi |
| --- | --- |
| Notifications plateforme Mobile | #577 Web-only |
| Dispatcher / SMTP / Expo / préférences école | lots Communications déjà GREEN, hors parité UI |
| PATCH annonce (titre/corps) côté UI | backend existe, **aucune UI actuelle** — ne pas inventer l’édition |
| Search serveur C2 | `listConversations` n’accepte pas `query` |
| Nouveau canal / audience | interdit par mandat |
| Backend / migrations / RBAC serveur | aucun écart serveur P0 identifié sur l’isolation déjà testée C2/C3/C4 |

## Décision de lot

Corriger uniquement les écarts de **données** et d’**UX de liste** sur C2/C3/C4 déjà exposés. Écriture : conserver les endpoints déjà utilisés (conversations Web, `POST /messages` Mobile). Aucun fallback métier, aucun second état.

**GREEN livré :** conversations Mobile = C2 ; unread-count API Web/Mobile/Accueil ; C4 cursor + compteur serveur ; chrome Communication ; recherche/filtre client sur listes canoniques ; `audienceLabel` en liste Web. Hors lot inchangé (plateforme Mobile, PATCH UI, search serveur).
