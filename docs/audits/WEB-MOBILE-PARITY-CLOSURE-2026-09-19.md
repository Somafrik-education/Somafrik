# Clôture chantier — Parité Web ↔ Mobile native

**Date :** 2026-09-19  
**Référence :** #704 (audit maître — **jamais merger**)  
**Déclencheur :** #714 `#5742795627` — LOT 8 clos ; ré-audit global final autorisé  
**Mobile :** Expo / React Native uniquement (le Web responsive n’est pas Mobile)

Aucun code métier dans ce document. Aucun LOT 9. Aucun Ready/merge produit.

## 1. Freeze Git

| Champ | Valeur |
| --- | --- |
| `develop` | `6bc1ceaf6eb597ca39317452bbf076285c5b8e03` |
| Merge LOT 8 | PR **#714** — HEAD `e22295e9d1cba2bcc69806fd36f19b02e5a8d94f` |
| Parents | `3cc55190` (develop pré-merge) + `e22295e9` |
| Signature | GitHub verified |
| CI HEAD LOT 8 | **38/38 GREEN** (PR Gates #1079, Required, Risk-targeted, LOT 0–8, C4) |

Gates rejoués sur ce SHA (local) : `scripts/lot0`…`lot8-parity.test.ts` → **55/55 PASS**.

## 2. Lots 0–8 — tous fusionnés

| Lot | PR | Merge / HEAD | IDs verrouillés | Décision |
| --- | --- | --- | --- | --- |
| 0 Sécurité | #705 | `c9bd8c0e` | 001, 001b, 011, 012, 022 | **CLOS** |
| 1 Référentiels | #706 | merged | 018/019 frontière, 029, 037 | **CLOS** |
| 2 Scolarité | #707 | merged | 013, 014, 031, 032 | **CLOS** |
| 3 Enseignants | #709 | merged | 028 | **CLOS** |
| 4 Finance | #710 | `68077f52` | 015, 016, 080 | **CLOS** |
| 5 Pédagogie | #711 | `58bdf891` | 023, 024, 033, 060 | **CLOS** |
| 6 Communication | #712 | `2a0b4f95` | 034, 026, 055, 068 | **CLOS** |
| 7 Planning / présence | #713 | `3cc55190` | 021, 052, 057, 081, 083 | **CLOS** |
| 8 Legacy | #714 | `6bc1ceaf` | 035, 056, 061, 027, 071 | **CLOS** |

## 3. IDs exécutés — état `develop@6bc1ceaf`

Verdicts : **CLOS** = gap du lot fermé ; **VOLONTAIRE** = asymétrie produit acceptée par le lot.

| ID | Lot | Verdict | Preuve actuelle |
| --- | --- | --- | --- |
| **001 / 001b** | 0 | CLOS | Défaut d’appel Web = Mobile = `Présent`. KPI brouillon incomplet fail-closed. |
| **011** | 0 | CLOS | `ProtectedRoute` lit `mustChangePassword`. |
| **012** | 0 | CLOS | Web + Mobile = `validateAccountSecret` (plus min 6). |
| **022** | 0 | CLOS | Accueil enseignant = `getTodayEstablishmentPresenceKpi`. |
| **018 / 019** | 1 | VOLONTAIRE | Plateforme / hub avancé Web-only. Mobile : 6 cartes opérationnelles. Pas de remount AdminCrud / Pays. |
| **029** | 1 | CLOS | Auto-open setup `NOT_STARTED` Web === Mobile. |
| **037** | 1 | CLOS | `GET /education-reference/catalog` unique. |
| **013** | 2 | CLOS | Fiche Mobile `GET /students/:id` + 6 cartes. |
| **014** | 2 | CLOS | Relations `GET /parents/relations` + link/archive. Pas `backoffice/relations`. |
| **031** | 2 | CLOS | Inscription classe-first, jamais `POST /students`. |
| **032** | 2 | CLOS | C18 REST PostgreSQL. |
| **028** | 3 | CLOS | Création enseignant = Users `/create-teacher`. `POST /teachers` tombstone 403. |
| **015** | 4 | CLOS | Mobile `GET /finance/fee-grids` lecture. Mutations grilles Web-only. |
| **016** | 4 | CLOS | Impayés Mobile : recherche, classe, période, relance, encaissement. |
| **080** | 4 | CLOS | `formatFinanceDate` Web + Mobile = `JJ-MM-AAAA`. |
| **023** | 5 | CLOS | Bulletins Mobile lecture + workflow read-only. |
| **024** | 5 | CLOS | Examens Mobile natifs `/exams`. |
| **033** | 5 | CLOS | Moyenne canonique Web/Mobile/backend. |
| **060** | 5 | CLOS | Stats classe Mobile = contrat Web. |
| **034** | 6 | VOLONTAIRE | Mobile Expo Push + revoke logout. Pas de nouveau fournisseur Web. |
| **026** | 6 | CLOS | Inbox C4 : `Notifications:READ`, plus d’implicite Web. |
| **055** | 6 | CLOS | Préférences `/me/communication-preferences` Topbar Web + drawer Mobile live. |
| **068** | 6 | VOLONTAIRE | Notifs plateforme Web-only. Écran Mobile legacy absent. |
| **021** | 7 | CLOS | `PermissionsScreen` absent. RBAC fail-closed. |
| **052** | 7 | CLOS | Élèves d’une classe déjà fermé LOT 2. |
| **057** | 7 | CLOS | Badge présence = roster attendu + `recorded !== expected`. |
| **081** | 7 | CLOS | Hint naissance `DISPLAY_DATE_HINT` JJ-MM-AAAA. |
| **083** | 7 | CLOS | Masse présence = « Tout présent » Web + Mobile. |
| **035** | 8 | CLOS | GET `role-permissions` lecture compat. PUT interdit. Admin = `rbacApi`. |
| **056** | 8 | CLOS | EntityPage payments = UI Web live. Mobile paiements canoniques. |
| **061** | 8 | CLOS | `AdminCrud` / `SafeAdminCrud` / `Menu` / `PlatformNotifications` / `Permissions` absents. `PD_DEAD_SCREENS` noms-only. |
| **027** | 8 | CLOS | Catalogue PG autorité. `CRUD_PERMISSION_MODULES` / `getSuperadminMatrixModules*` absents. |
| **071** | 8 | CLOS | `GradeBookService` Mobile + helper mort absents. Formules Notes inchangées. |

## 4. IDs hors lots 0–8 — re-audit actuel

Ces IDs figuraient dans #704 mais **n’ont jamais été dans un lot exécuté**. Ce ne sont **pas** des régressions LOT 0–8.

### Volontaires (produit / canal / frontière)

| ID | Sujet | Verdict | Note |
| --- | --- | --- | --- |
| **010** | Canaux login | VOLONTAIRE | Web `POST /backoffice/login` ; Mobile `/identify` + `/login`. |
| **050** | Identify pré-login | VOLONTAIRE | Mobile-only. |
| **051** | Mapping 423 | CLOS* | Les deux clients affichent le message serveur. Pas de branche 423 dédiée. |
| **054** | Conception bulletins | VOLONTAIRE | Web Grapes / config. Mobile lecture PDF (LOT 5). |
| **059** | Tuile Parents & élèves | VOLONTAIRE | Web hub établissement. Mobile = fiche élève (LOT 2). |
| **062** | Strip Pays CREATE/DELETE | CLOS | API + Web. Mobile sans UI Pays. |
| **063** | Onglet Frais | VOLONTAIRE | Web CRUD grilles. Mobile lecture (LOT 4). |
| **064** | Onglet Rôles layout | VOLONTAIRE | Matrice Superadmin Web-only (LOT 1/7/8). |
| **065** | Offline / sync / support | VOLONTAIRE | L1 Mobile-first. |
| **066** | TZ Accueil enseignant | CLOS | Web + Mobile = TZ école. |
| **067** | UX rôles plateforme | VOLONTAIRE | Web onglets + matrice. Mobile codes magiques. |
| **070** | Logout push / outbox | VOLONTAIRE | Mobile revoke + block outbox. Web N/A. |
| **085** | Libellés KPI | CLOS | Mêmes constantes. Layout = 086. |
| **086** | Cartes vs tables | VOLONTAIRE | UX, pas métier. |

### Ouverts résiduels (hors périmètre lots 0–8)

Aucun de ces écarts n’était dans un lot fusionné. Ils restent des **reliquats d’audit**, pas des HOLD LOT 8.

| ID | Gravité #704 | Écart actuel | Priorité clôture |
| --- | --- | --- | --- |
| **017** | P1 | Planning Web = hub (EDT / classe / enseignant / salles / remplacements / conflits). Mobile = `TimetableScreen` hebdo + mutations inline. Pas de `projection=diagnostics`. | Produit — pas lancé |
| **020** | P1 | Charts configurables + KPI relations Web-only. Accueil Mobile = 4 cartes rôle. | Produit — pas lancé |
| **025** | P1 | Documents / conformité / export Web-only. Pas d’écran Documents Mobile. | Produit — pas lancé |
| **030** | P1 | Refresh 401 : Web conserve `sessionStorage` ; Mobile clear SecureStore. | Intégrité session |
| **036** | P1 | `MobilePayment` reste coquille MVP (MM/carte P2). Encaissement live = `StudentPayments` / LOT 4. | Produit parent |
| **053** | P2 | Pas de pages Mobile dédiées salles / remplacements / conflits. | Lié 017 |
| **058** | P2 | Fiche Web sans taux inline ; deep-link `?student=` inerte. Mobile fiche = count, sous-écran = %. | UX fiche |
| **069** | P2 | CRUD salles Web-only. Mobile GET pour affectation slot. | Lié 017 |
| **082** | P3 | Cooldown relance Web `unpaidModule` = locale courte ; le reste Finance = JJ-MM-AAAA. | Cosmétique |
| **084** | P3 | `SubscriptionOffersPage` préremplit encore `countries[0]`. Autres pickers Superadmin fail-closed. | Cosmétique |

## 5. Comptage vs audit #704 (18/09)

| Indicateur #704 | Alors | Maintenant (`6bc1ceaf`) |
| --- | --- | --- |
| Fonctionnalités inspectées | 96 | même inventaire IDs |
| Alignées | 38 | **lots 0–8 + volontaires documentés** |
| P0 ouvert | 2 assertions (1 défaut racine) | **0** — 001 / 001b CLOS |
| Lots proposés | 0–8 non lancés | **0–8 fusionnés** |
| Écrans Mobile morts | 5 | **0 fichier** (noms verrouillés `PD_DEAD_SCREENS`) |
| Catalogue CRUD divergents | 27 / 21 / 30 | **1 autorité PG** + subset mutations Mobile |

## 6. Ce que ce chantier n’est pas

- Pas un pixel-perfect Web = Mobile.
- Pas une copie du hub plateforme / Superadmin / conception bulletins / documents sur Expo.
- Pas un nouveau moteur Finance ou Notes.
- Pas une réactivation legacy (`role-permissions` PUT, AdminCrud, PermissionsScreen, MenuScreen).
- **Pas un LOT 9.** Tout reliquat §4 exige un **nouveau GO CTO** avec IDs verrouillés.

## 7. Recommandation

**Chantier de parité séquentielle LOT 0–8 : CLOS.**

#704 reste l’audit de référence. Ne jamais la merger.

Reliquats §4 = backlog éventuel, pas des blockers de clôture du chantier lancé.

STOP produit. Rapport seulement.
