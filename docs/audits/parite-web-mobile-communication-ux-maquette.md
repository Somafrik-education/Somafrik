# Contrat UX textuel — Communication Web ↔ Mobile

**Statut :** contrat de test Communication — **pas** une parité pixel.  
**Surfaces :** Messages (C2), Annonces (C3), Notifications internes (C4).  
**Hors contrat :** Notifications plateforme (#577 Web-only), Préférences canal (déjà paritaires), Paramètres école.

Constantes machine : `web/src/lib/pariteCommunicationUxContract.ts` et `Mobile/src/lib/pariteCommunicationUxContract.ts`.

Maquette HTML : `docs/audits/parite-web-mobile-communication-maquette.html`.  
Captures maquette : `docs/audits/evidence/communication_maquette_{1440,1024,390,360}.png`.  
Captures live Web : `docs/audits/evidence/communication_web_{messages,annonces,notifications}_{1440,1024,390,360}.png`.

---

## 1. Identité

Les trois surfaces partagent un chrome **Communication**.

- Titre module : **Communication**
- Sous-navigation (droits réels uniquement) : **Messages** · **Annonces** · **Notifications**
- Compteur éventuel = `GET …/unread-count` de la surface active, jamais un décompte local de la page
- Action principale si `CREATE` (Nouvelle conversation / Publier / Nouvelle notification)
- Recherche client sur la **liste déjà chargée** (le backend conversations n’offre pas `query`)
- Filtre : **Tous** | **Non lus** (dérivé de `unreadCount` / `readAt` API)
- Liste dense (rangées, pas de grosses cartes empilées)
- États distincts : chargement, erreur + **Réessayer**, vide métier

## 2. Rangée de liste (données réellement disponibles)

| Surface | Titre | Extrait | Auteur | Audience | Date | Statut / lu |
| --- | --- | --- | --- | --- | --- | --- |
| Messages | correspondant ou `subject` | `lastMessage.body` | `lastMessage.senderName` | n/a (participants) | `lastMessage.sentAt` | badge `unreadCount` |
| Annonces | `title` | `content`/`message` tronqué | `createdByName` / expéditeur plateforme | **`audienceLabel` API** | `publishedAt` | Lu / Non lu ; `published`/`archived` |
| Notifications | `title` | `body` tronqué | `senderName` | n/a (DTO sans audience) | `publishedAt` | Lu / Non lu |

Interdit d’inventer un canal, une audience ou un auteur absent de l’API.

## 3. Détail

**Titre**  
Métadonnées : auteur · date · audience (C3) · statut.  
**Contenu**  
Actions autorisées (répondre / archiver / marquer lu / pièces jointes).

Web : panneau à droite ≥ 1024 px. Mobile : écran ou feuille, zones tactiles ≥ 44 dp, Safe Area, clavier (composer Messages déjà `KeyboardAvoidingContainer`).

## 4. Viewports

| Support | Cibles |
| --- | --- |
| Web | **1440 px** (principal), **1024 px** (minimum) |
| Mobile | **360 px**, **390 px** |

## 5. Ce que la maquette n’impose pas

- Reproduction pixel Web → Mobile
- Fusion des trois inbox en une seule liste backend
- Notifications plateforme sur Mobile
- Nouveau search serveur
- Édition d’annonce / hard delete

## 6. Mapping tests

| Règle | IDs |
| --- | --- |
| Badge Messages = unread-count | COM-01, COM-12, COM-13 |
| Messages loading/error/empty | COM-02 |
| Recherche + filtre non lus | COM-03, COM-06, COM-18 via chrome |
| Audience C3 en liste | COM-04 |
| Chrome Communication | COM-05, COM-17 |
| Liste C2 = conversations | COM-10 |
| Pas de filtre parentPhone/direction | COM-11 |
| C4 unread + pagination | COM-14, COM-15 |
| Navigation Messages Mobile | COM-16 |
