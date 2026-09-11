# Communication — preuve GREEN

**Branche :** `cursor/communication-web-mobile-parity-7447`  
**Base :** `develop@193c5df3e7b3049bb02f70d53106b0889f95fd0d`  
**RED :** `docs/audits/parite-web-mobile-communication-red-2026-09-10.md` (14/14 rouge avant correction)

## Commande de caractérisation

```bash
npm run test:parite-communication-red
```

## Résultat après correction

### Web — 6 vert / 0 rouge / 6 cas

| ID | Correction |
| --- | --- |
| COM-01 | Topbar `useMessagesUnreadCount` → `GET /backoffice/messages/unread-count` |
| COM-02 | `LoadingState` / `ErrorState` + Réessayer / `EmptyState` |
| COM-03 | `EntityListSearch` « Rechercher » sur la liste conversations |
| COM-04 | `audienceLabel` API affiché dans la liste Annonces |
| COM-05 | Chrome module **Communication** (Messages / Annonces / Notifications) + titre AppLayout |
| COM-06 | Filtre Tous / Non lus sur `unreadCount` des conversations |

### Mobile — 8 vert / 0 rouge / 8 cas

| ID | Correction |
| --- | --- |
| COM-10 | Liste `getCanonicalConversations` (`GET /backoffice/conversations`) |
| COM-11 | Filtres `parentPhone` / `direction` retirés de la liste |
| COM-12 | `getMessagesUnreadCount` / `useMessagesUnreadCount` |
| COM-13 | KPI Accueil Messages = unread-count |
| COM-14 | C4 compteur = `useInternalNotificationsUnreadCount` |
| COM-15 | `listInternalNotifications(..., { cursor })` + « Charger plus » |
| COM-16 | Entrée Messages dans `MenuScreen` |
| COM-17 | `CommunicationChrome` + filtre Non lus |

## Non-régression ciblée

| Contrôle | Résultat |
| --- | --- |
| `npm --prefix web test` | 187 fichiers / **1016 tests** OK |
| `npm run typecheck:web` | OK |
| `npm run typecheck:mobile` | OK |
| `npm --prefix web run lint` | 0 erreur (warnings préexistants hors périmètre) |
| `npm --prefix web run build` | OK (`VITE_API_URL` requis comme en CI) |
| `verify:mobile-domain-hydration` | OK (annonces/conversations scopées + Messages) |
| `verify:mobile-cta-rbac-alignment` | OK |
| `verify:mobile-home-data-truth` | OK |
| `verify:mobile-ux-v1` | OK (Home n'importe pas `CommunicationHeaderIcons`) |
| `verify:mobile-no-catalog-runtime-data` | OK |
| `verify:ui-french-copy` | OK |
| `verify-communications-c2/c3` source guards | OK (HTTP PG ignoré : pas de `DATABASE_URL` local) |
| `verify-communications-c4` source guards | OK ; suite dispatcher `RED-COM-04` hors lot (préexistant) |

`verify:mobile-usability` : assertions Messages OK ; l'échec final `name: verify:mobile-usability` dans `ci.yml` nightly est **préexistant** (L0), hors périmètre.

## Smoke UX

Maquette HTML : `docs/audits/parite-web-mobile-communication-maquette.html`  
Captures : `docs/audits/evidence/communication_*.png`

| Viewport | Support | Contrôle |
| --- | --- | --- |
| 1440 | Web live Messages / Annonces / Notifications | chrome, liste dense, CTA, recherche, Tous/Non lus |
| 1024 | Web live | titre Topbar tronqué « Comm… » (P2 layout existant) ; chrome page lisible |
| 390 / 360 | Web responsive | sous-nav, recherche, CTA accessibles ; widget Aide peut recouvrir le composer (préexistant) |
| 390 / 360 | Maquette native | listes denses, tabbar, empty/erreur + Réessayer |

## P0 / P1 restants

| ID | Priorité | Statut |
| --- | --- | --- |
| Fuite tenant / mauvaise audience | P0 | **aucun écart serveur introduit** ; isolation C2/C3/C4 inchangée |
| Notifications plateforme Mobile | P1 hors lot | #577 volontaire |
| `RECIPIENT_KIND_FALLBACK` à la création d'annonce | P2 | préexistant, create only |
| Titre Topbar « Communication » tronqué à 1024 | P2 | largeur Topbar existante |
| Widget Aide vs composer | P2 | HelpHost préexistant |
| PATCH annonce UI / search serveur C2 | — | non inventé |

**STOP :** PR Draft, pas Ready, pas de merge. Verdict CTO requis.
