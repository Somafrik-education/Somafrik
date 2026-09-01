# Web smoke GO-PROD — 2026-09-01

Lot unique après merge **#441**. Evidence/test-only. **Aucun déploiement déclenché.**

| | |
|---|---|
| Baseline obligatoire | `develop@58ef7b67d6c815aa85d1066b17394e68c15fd174` (merge #441) |
| Runtime relié au SHA | **local** (cette checkout + backend mémoire + Vite preview `index-CiPV4gTP.js`) |
| Hébergements sondés | `preprod.somafrik.app`, `somafrik-web-preprod.onrender.com`, `somafrik.app` → HTTP 200, bundle **`index-J4_5WK6-.js`**, `Last-Modified: Mon, 31 Aug 2026 22:01:39 UTC` |
| API préprod | `api-preprod.somafrik.app` et `somafrik-api-preprod.onrender.com` → `/api/health` 200 PostgreSQL, **aucun git SHA** |
| `api.somafrik.app` | **injoignable** (DNS) |
| SHA hébergé | **non vérifiable** et bundle ≠ local (`index-J4_5WK6-.js` ≠ `index-CiPV4gTP.js`) |
| Décision hébergé | **MANUAL BLOCKER** — pas de claim GO-PROD sur préprod/prod tant que ce SHA n'y est pas déployé par le CTO |

## Gouvernance (constat GitHub avant ouverture)

- 1 PR Cursor Go Production à la fois.
- #441 MERGED (`58ef7b67…`) ; #442 CLOSED / non mergée (doublon/stale).
- #438 / #440 CLOSED ; #434 CLOSED historique.
- PR ouvertes hors chaîne : #295, #297, #298, #312, #337, #354, #355 — non reprises.
- Hors périmètre : JWT global/#404, RC3 #354/#355, Android Play, `main`, secrets, deploy.

## MANUAL BLOCKER — action utilisateur exacte

Pour un smoke **hébergé** relié à `develop@58ef7b67d6c815aa85d1066b17394e68c15fd174` :

1. CTO/utilisateur déploie explicitement ce SHA vers le frontend préprod (`preprod.somafrik.app` / Render web) **et** l'API préprod (`api-preprod.somafrik.app`) ;
2. confirmer le SHA déployé (`/api/health` ne le porte pas aujourd'hui) ;
3. fournir un compte smoke non-secret (démo désactivée sur l'hébergé) ;
4. relancer le smoke hébergé.

**L'agent n'a pas déclenché et ne déclenchera pas ce deploy.**

Le smoke **local** de cette PR est le seul runtime prouvé sur le baseline.

Aucun login n'a été tenté sur les hébergements (pas de secrets, seed démo off).

## Matrice locale — SHA-linked (backend mémoire + Web preview)

Connexion établissement `CD-IN-26-001` / `admin` / démo locale. Pages métier rendues. Listes vides = seed mémoire sans classes/élèves, pas une fuite school-wide.

| ID | Parcours | Statut | Preuve |
|----|----------|--------|--------|
| WS-HOSTED-* | Préprod/prod HTML + health | **MANUAL BLOCKER** | 200 sans SHA ; bundle ≠ HEAD |
| WS-HOSTED-api-prod | `api.somafrik.app` | **HOLD DNS** | resolve failed |
| WS-API-login | POST `/api/backoffice/login` | **PASS** | 200 ; session OK |
| WS-API-classes | GET `/api/classes` | **PASS** | 200 count=0 |
| WS-API-students | GET `/api/students` | **PASS** | 200 count=0 |
| WS-API-presences | GET `/api/presences` | **PASS** | 200 count=0 |
| WS-API-evaluations | GET `/api/evaluations` | **PASS** | 200 count=0 |
| WS-API-schedules | GET `/api/course-schedules` | **PASS** | 200 count=0 |
| WS-API-payments | GET `/api/payments` | **PASS** | 200 count=0 |
| WS-API-permissions | GET `/api/auth/effective-permissions` | **PASS** | 200 |
| WS-UI-login | `/connexion` → session | **PASS** | toast « Connexion réussie », `/etablissement/vue-ensemble` |
| WS-UI-dashboard | `/tableau-de-bord` | **PASS** | Vue d'ensemble, KPIs |
| WS-UI-classes | `/etablissement/classes` | **PASS** | titre Classes, liste vide |
| WS-UI-students | `/etablissement/eleves` | **PASS** | page Élèves |
| WS-UI-presences | `/presences` | **PASS** | « Aucune classe dans votre périmètre » (pas school-wide) |
| WS-UI-notes | `/notes` | **PASS** | module Notes |
| WS-UI-planning | `/planning/emploi-du-temps/calendrier` | **PASS** | calendrier Planning |
| WS-UI-finance | `/finances/paiements` | **PASS** | Paiements |

**0 FAIL** sur le runtime local relié au SHA. **0 correctif métier** dans cette PR.

## Observations (ne bloquent pas le smoke local)

- Projection UI locale : périmètre affiché `CD-2026-0001` (leftover mémoire) après login avec `login_code` `CD-IN-26-001`. Non corrigé ici (hors runtime, seed mémoire ≠ PostgreSQL canonique des lots A–D).
- Console navigateur : 401/403/501 sur hydratations secondaires du seed mémoire (listes vides). Les écrans métier ciblés restent rendus.
- Seed mémoire : 50 enseignants sans affectation, 0 classe / 0 élève.

## Gate

`npm run verify:web-smoke`

La gate échoue si le login local ou un écran critique ne rend pas. Elle ne masque pas le MANUAL BLOCKER hébergé et ne déclenche aucun deploy.
