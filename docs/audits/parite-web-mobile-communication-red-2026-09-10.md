# Communication — preuve RED

**Base :** `develop@193c5df3e7b3049bb02f70d53106b0889f95fd0d`  
**Commande :** `npm run test:parite-communication-red`

## Résultat exact (avant implémentation)

### Web — 0 vert / 6 rouge / 6 cas

| ID | Motif |
| --- | --- |
| COM-01 | Topbar compte les messages via `scopedMessages` DataContext, pas `GET unread-count` |
| COM-02 | Messages n'expose pas d'état de chargement |
| COM-03 | pas de champ Rechercher |
| COM-04 | liste Annonces sans `audienceLabel` (seulement au détail) |
| COM-05 | Notifications n'affiche pas le titre module Communication |
| COM-06 | pas de filtre Non lus |

### Mobile — 0 vert / 8 rouge / 8 cas

| ID | Motif |
| --- | --- |
| COM-10 | hydrate `GET /backoffice/messages` plat, pas `/conversations` |
| COM-11 | masque encore des fils via `parentPhone` |
| COM-12 | non lus via `MessageService` local |
| COM-13 | Accueil ne lit pas `GET /messages/unread-count` |
| COM-14 | C4 n'utilise pas le compteur serveur |
| COM-15 | ignore `nextCursor` |
| COM-16 | Menu sans entrée Messages |
| COM-17 | Messages sans filtre Non lus |

Aucun `assert(false)`. Les échecs reproduisent le code livré.
