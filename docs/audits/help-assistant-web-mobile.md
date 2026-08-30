# HELP-01 — Audit assistant utilisateur / « Besoin d’aide ? » (Web + Mobile)

Date : 2026-08-30  
Branche : `audit/help-assistant-web-mobile`  
Base : `develop@b53c691221e859221b70c89efc600448a3744485`  
Type : **AUDIT UNIQUEMENT** — aucune implémentation fonctionnelle

```text
HELP-01     DRAFT
Ready       NON
Merge       NON
HELP-V1     NON OUVERT
```

Aucune API IA, aucun service support externe, aucune table DB, aucune modification backend métier dans ce lot.

---

## 1. Résumé exécutif

Somafrik **n’a pas** aujourd’hui d’outil flottant « Besoin d’aide ? » ni d’assistant in-app Web. La chaîne `help` / `aide` / `chatbot` / `faq` / `Intercom` / `Crisp` / `Zendesk` / `Besoin d’aide` est absente de `web/src`.

Mobile expose un écran **Support** statique (`SupportScreen`), gated par un alias RBAC `Support → Messages`, qui oriente vers l’administration de l’établissement et annonce un « centre d’assistance P1 » non livré.

Les guides utilisateurs (`docs/user-guides/`) sont une source de vérité **hors runtime** : la vitrine interdit `/docs/` et aucun WebView d’aide n’embarque ces Markdown.

**Verdict :** **GO sous conditions** pour un **HELP-V1 sans IA** :

- bouton flottant authentifié uniquement ;
- aide contextualisée par **écran + rôle + permissions effectives** ;
- recherche locale dans un **sous-ensemble** des guides déjà documentés ;
- Web + Mobile, UX cohérente sans UI identique ;
- architecture prête pour un assistant conversationnel plus tard, **sans** l’ouvrir maintenant.

Conditions bloquantes avant HELP-V1 : ne pas monter l’aide sur la vitrine ni la connexion ; ne pas réutiliser l’alias Mobile `Support: Messages` comme produit d’aide ; filtrer tout article par RBAC ; interdire les actions métier automatiques.

---

## 2. État actuel

| Surface | Aide produit ? | Preuve |
|---|---|---|
| Web authentifié | Non | Shell `AppLayout` : sidebar + topbar + `Outlet` uniquement (`web/src/components/layout/AppLayout.tsx:63-76`) |
| Vitrine `/` | Non, et tests l’interdisent | Nav marketing limitée (`web/src/data/marketingContent.ts:32-36`) ; `Nous contacter` interdit (`web/src/pages/LandingPage.test.tsx:59,100-108`) ; hrefs = `/` ou `/connexion` (`LandingPage.test.tsx:111-119`) ; pas de `/docs/` (`LandingPage.test.tsx:183`) |
| Connexion Web | Non | Route isolée hors `AppLayout` (`web/src/App.tsx:81-82`) ; modal mot de passe temporaire (`web/src/pages/LoginPage.tsx:351-355`) |
| Mobile | Écran Support MVP uniquement | `Mobile/src/screens/MvpUtilityScreens.tsx:263-280` ; stack `AppNavigator.tsx:323` ; drawer `roleDrawerPreferences.ts:61` |
| Chat / FAB d’aide | Non | Aucun FAB Material ; « floating » Mobile = tab bar (`Mobile/src/lib/screenLayout.ts:16-32`) |
| SDK support | Non | Aucune dépendance Intercom/Crisp/Zendesk dans `web/package.json` ni dans `Mobile/src` |

Le libellé « Besoin d’aide ? » **n’existe pas** dans le code produit. Ne pas le présupposer.

---

## 3. Inventaire Web

### 3.1 Coques

Trois coques distinctes :

| Coque | Route | Layout | Preuve |
|---|---|---|---|
| Vitrine | `/` | `LandingPage` | `web/src/App.tsx:81` |
| Authentification | `/connexion` | `LoginPage` | `web/src/App.tsx:82` |
| Application | `ProtectedRoute` → `AppLayout` | Sidebar + Topbar + main | `web/src/App.tsx:83-92`, `AppLayout.tsx:47-78` |

`ProtectedRoute` redirige vers `/connexion` si non authentifié (`web/src/components/ProtectedRoute.tsx:5-10`).

### 3.2 Navigation et contexte d’écran

- Items canoniques : `NAV_ITEMS` (`web/src/lib/constants.ts:115-146`) — tableau de bord, plateforme, établissement, pédagogie, finances, administration, paramètres.
- Visibilité RBAC : `useVisibleNavItems` filtre via `canReadView` (`web/src/components/layout/useVisibleNavItems.ts:14-18`).
- Titre de page dérivé du `pathname` (`AppLayout.tsx:49-57`) — déjà un **point d’accroche** pour un `HelpContext.screen`.
- Routes métier : `PermissionRoute` + `canReadView` (`web/src/components/PermissionRoute.tsx:10-42`).

| Domaine | Route principale | Preuve |
|---|---|---|
| Dashboard | `/tableau-de-bord` | `App.tsx:94-100` |
| Classes | `/etablissement/classes` | `App.tsx` (layout `/etablissement/*`) |
| Élèves | `/etablissement/eleves` | idem |
| Enseignants | `/etablissement/enseignants` | idem |
| Présences | `/presences` | `constants.ts:130` |
| Notes / évaluations | `/notes` | `constants.ts:131` |
| Finance | `/finances` | `constants.ts:136` |
| Utilisateurs | `/etablissement/comptes-utilisateurs`, `/administration` | `AppLayout.tsx:25`, `constants.ts:142` |
| Paramètres | `/parametres` | `constants.ts:145` |
| Référentiels | `/referentiels-pedagogiques` | `constants.ts:121` |
| Notifications | `/notifications` (cloche Topbar, pas sidebar) | `AppLayout.tsx:43-44` |

### 3.3 Overlays existants (réutilisables, pas de l’aide)

| Système | Rôle | Preuve |
|---|---|---|
| Toast global | Bas **centre**, `z-50` | `web/src/design-system/feedback/Toast.tsx:61-67` |
| Modal | `fixed inset-0 z-40` | `web/src/design-system/overlays/Modal.tsx:40-50` |
| Confirm / Prompt | Providers dans `main.tsx` | `web/src/main.tsx` (Toast + Confirm + Prompt + Auth) |
| Drawer mobile | Overlay navigation | `web/src/components/layout/MobileNavDrawer.tsx` |
| Topbar | Messages, annonces, notifications, déconnexion | `web/src/components/layout/Topbar.tsx` |

Aucun bouton `fixed bottom-… right-…` d’aide.

### 3.4 Faux positifs (ne pas compter comme aide)

- `payment-student-help` : hint de champ (`web/src/components/payments/QuickPaymentModal.tsx:367-372`).
- « Support prioritaire » : flag d’offre d’abonnement (`web/src/lib/subscriptionModule.ts`).
- « Contactez Somafrik… » : empty state abonnement (`web/src/pages/abonnements/MonAbonnementPage.tsx:45`).
- Tooltips RBAC / Recharts : pas un système d’aide.

---

## 4. Inventaire Mobile

### 4.1 Navigation

| Couche | Fichier | Rôle |
|---|---|---|
| Root | `Mobile/App.tsx:52-65` | `SafeAreaProvider` → Auth → Outbox → L1 cache → `AppNavigator` → `EnvironmentBadge` |
| Stack | `Mobile/src/navigation/AppNavigator.tsx` | Welcome / RoleSelection / Login hors session ; Home + écrans métier gated |
| Tabs | `Mobile/src/navigation/BottomTabsNavigator.tsx:72-77` | Tab bar flottante, `safeAreaInsets` tab = 0 |
| Drawer | `Mobile/src/components/RoleNavigationDrawer.tsx` | Menu hamburger ; item Support `roleDrawerPreferences.ts:61` |

Tabs par rôle : `Mobile/src/navigation/roleTabCatalog.ts` (Parent/Élève, Enseignant, admin établissement, plateforme).

### 4.2 Support existant — ce n’est pas HELP-V1

```263:280:Mobile/src/screens/MvpUtilityScreens.tsx
export function SupportScreen() {
  ...
        detail="Contactez l'administration de l'etablissement ..."
        detail="Les demandes support seront journalisees dans le centre d'assistance lors de l'evolution P1."
```

- Enregistrement stack : `AppNavigator.tsx:323` (`canReadRoute(session, "Support")`).
- Alias dangereux pour un futur produit d’aide : `Support: "Messages"` (`Mobile/src/domain/security/permissions.ts:122`). Un utilisateur sans `Messages:READ` **ne voit pas** Support.
- `MenuScreen.tsx` contient encore des liens Support mais n’est plus le navigateur V1.2 (drawer).

### 4.3 FAB / collisions

- Pas de FAB d’aide. CTAs « Créer / Inscrire / Enregistrer » sont **dans le header de liste**, pas flottants (`ClassMutationControls`, `StudentMutationControls`, `PaymentMutationControls`, etc.).
- Tab bar **absolute** bas (`screenLayout.ts:27-32`) + safe-area Android (`screenLayout.ts:17`).
- Cible tactile min. 44 dp (`Mobile/src/lib/mobileUsability.ts:8`).
- Modales : `CanonicalMutationModal`, bottom sheet `OverflowActions`, drawer latéral.
- Clavier : `KeyboardAwareScreen` (login, messages, notes).
- `EnvironmentBadge` : overlay haut, `pointerEvents="none"` (`EnvironmentBadge.tsx:8-20`).
- Offline : `OfflineBanner` dans le shell authentifié ; outbox limitée à `messages`, `presences`, `notes` (`Mobile/src/lib/outbox.ts:10-11`).
- Pas de toast Snackbar ; feedback via `Alert.alert`.

### 4.4 `google-services.json`

Fichier runtime **non versionné** à ce HEAD ; template `Mobile/google-services.json.example` uniquement. HELP-01 ne le touche pas.

---

## 5. Documentation existante

Source : `docs/user-guides/` — **pas servie au runtime**.

| Artefact | Rôle | Preuve |
|---|---|---|
| Index | Guides Web/Mobile + captures + KNOWN-ISSUES | `docs/user-guides/README.md:8-13` |
| Principe | Documenter uniquement l’UI canonique vérifiée | `README.md:15-19` |
| RBAC disclaimer | Deux utilisateurs voient des boutons différents | `README.md:21-23` |
| SHA guides | `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1` | `README.md:3` — **antérieur** à `b53c691` |
| Captures Web | W01–W06 `VALIDÉE` ; W07–W16 `À CAPTURER` | `CAPTURES-METIER.md:19-34` |
| Captures Mobile | M01–M10, M12–M23 `VALIDÉE` ; M11 `À REVALIDER` | `CAPTURES-METIER.md:40+`, `KNOWN-ISSUES.md:7-9` |
| Parent-enfant | Route Web existante, **pas** de parcours d’écriture publié | `KNOWN-ISSUES.md:34-36` |
| Identifiants école | `login_code` public ≠ `school_code` chrome | `KNOWN-ISSUES.md:94-104` |

**Couverture forte (procédure + capture runtime) :** connexion établissement, dashboard Web, classes, élèves (annuaire/inscription Mobile), enseignants Mobile, utilisateurs Mobile, paiements Mobile, présences/notes enseignant Mobile, parent/élève accueil, sync.

**Couverture faible / absente des guides :** W07–W16 Web (enseignants → paiements), planning avancé, CRM contacts/relations, frais/impayés détaillés, plateforme (pays, abonnements), référentiels, conception bulletins, export/sauvegarde, parcours Secrétaire / Comptable / Surveillant / Directeur adjoint.

**Implication HELP-V1 :** n’indexer que les articles dont la procédure est dans les guides **et** non contredite par `KNOWN-ISSUES.md`. Ne pas inventer des steps à partir du code seul.

Structure canonique `help/{classes,students,…}` : **pertinente à recommander**, **non créée** dans ce lot.

---

## 6. Matrice écrans / rôles

### 6.1 Rôles réels (pas « personnel »)

« Personnel » n’est **pas** un `role_key`. C’est une audience d’annonces / un terme UX.

Autorité labels → DB (`backend/lib/clientsManagement.js:38-52`) :

| Terme métier | Label stocké | `role_key` |
|---|---|---|
| Superadmin | Super Administrateur Somafrik | `SUPER_ADMIN` |
| Administrateur pays | Admin Pays | `COUNTRY_ADMIN` |
| Administrateur établissement | Admin School | `SCHOOL_ADMIN` |
| Enseignant | Enseignant | `TEACHER` |
| Parent | Parent | `PARENT` |
| Élève | Élève / Étudiant | `STUDENT` |
| + établissement | Secrétaire, Comptable, Préfet des études, Proviseur, Directeur, Surveillant | `SECRETARY`, `ACCOUNTANT`, `PREFET_ETUDES`, `PROVISEUR`, `PRINCIPAL`, `SUPERVISOR` |

Libellés UI Web : `displayRoleName` / `ROLE_LABELS` (`web/src/lib/format.ts:20-39,76-79`) — « Administrateur d’établissement », « Administrateur pays ».

Permissions live Web : `GET /api/auth/effective-permissions` hydraté dans la session (`web/src/context/AuthContext.tsx:93-107`). Le client n’utilise pas la matrice `rolePermissions` locale (`usePermissionContext.ts:12`).

### 6.2 Matrice d’affichage de l’aide (recommandation)

| Écran | Web | Mobile | Affichage aide V1 | Commentaire |
|---|---|---|---|---|
| Vitrine `/` | oui | n/a | **Absent** | Tests vitrine : pas de contact/support (`LandingPage.test.tsx:59,108,111-119`) |
| Connexion | `/connexion` | `Login` / `RoleSelection` / `Welcome` | **Absent** | Hors `AppLayout` / hors `HomeTabs` ; flux secret |
| Changement de mot de passe | Modal login (`LoginPage.tsx:351-355`) | Modal login | **Absent** | Écran de sécurité |
| Permissions bootstrap / erreur | `PermissionRoute` loading/error (`PermissionRoute.tsx:22-35`) | `PermissionsBootstrapScreen` | **Absent** | État technique |
| Dashboard | `/tableau-de-bord` | Tab Accueil | **Oui** | W02 + home Mobile |
| Classes | `/etablissement/classes` | `Classes` | **Oui** | Guides + captures |
| Élèves | `/etablissement/eleves` | `Students` | **Oui** | Filtrer steps « Inscrire » si pas `Élèves:CREATE` |
| Enseignants | `/etablissement/enseignants` | `Teachers` | **Oui** avec prudence | Web W07–W08 non capturés |
| Présences | `/presences` | `TeacherAttendance` | **Oui** | Mobile fort ; Web W11–W12 à capturer |
| Notes / évaluations | `/notes` | `TeacherGrades` | **Oui** | Idem W13–W14 |
| Finance / paiements | `/finances/*` | `Payments` | **Oui** | Mobile M12–M14 ; Web W15–W16 à capturer |
| Utilisateurs | `/etablissement/comptes-utilisateurs` | `Users` | **Oui** si `Utilisateurs:READ` | Interdit aux rôles sans droit |
| Paramètres | `/parametres` | `Configuration` | **Oui** limité | Catalogue guide §15, peu de procédures |
| Référentiels | `/referentiels-pedagogiques` | — | **Optionnel** | Superadmin / pays ; pas de guide pas-à-pas |
| Notifications | `/notifications` | Internal/Platform | **Oui** léger | Communication, pas procédure métier lourde |
| Messages / annonces | Topbar | Drawer | **Oui** léger | Ne pas confondre avec Support alias |
| Planning | `/planning` | Timetable si exposé | **Oui** limité | Guide texte, pas de captures |
| Parent / Élève accueil | n/a (Mobile) | Home + tabs Profil/Notes/Présences/Frais | **Oui** | M20–M21 ; pas de procédure parent-enfant (`KNOWN-ISSUES.md:34-36`) |
| Support (écran actuel) | n/a | `Support` | Remplacer / juxtaposer plus tard | Stub P1 (`MvpUtilityScreens.tsx:278`) |
| Écran ConfigurationError / hors config | n/a | `ConfigurationErrorScreen` | **Absent** | Technique |

Règle unique : **si `canReadView` / `canReadRoute` est faux, l’article et la suggestion sont absents** — y compris « Créer un utilisateur » pour un enseignant.

---

## 7. Architecture actuelle : compatible ou non

**Compatible** comme *points d’insertion* :

- Web : un seul enfant authentifié `AppLayout` (`App.tsx:83-92`) — un FAB/panneau monté ici couvre toutes les routes métier.
- Web : `location.pathname` déjà lu (`AppLayout.tsx:49-57`).
- Web/Mobile : permissions effectives déjà en session.
- Mobile : `navigation` + route name React Navigation ; tabs + stack déjà séparés.
- Overlays Web déjà globaux (Modal/Toast) — un panneau d’aide peut suivre le même primitive.

**Non compatible / à ne pas réutiliser tel quel :**

- Écran Mobile Support + alias `Messages` (`permissions.ts:122`) : ce n’est pas un catalogue d’aide et ça exclut les rôles sans messagerie.
- `docs/` n’est pas un runtime (`LandingPage.test.tsx:183`).
- Outbox n’accepte pas un domaine `help` (`outbox.ts:10-11`) — ne pas y brancher des tickets V1.
- Vitrine volontairement sans support (`marketingContent.ts:32-36`, `LandingPage.test.tsx:59`).

---

## 8. Options A / B / C

### Option A — 100 % frontend / documentation embarquée

Catalogue JSON/TypeScript compilé depuis un sous-ensemble des guides (pas de copie runtime de `/docs`). Recherche locale. Filtre `roles` / `permissions` / `routeKeys` / `platforms`.

| Critère | Évaluation |
|---|---|
| Avantages | Pas de backend, offline Mobile naturel, pas de fuite réseau, délai court |
| Inconvénients | Mise à jour = release app ; pas d’admin métier du contenu |
| Coût | Faible |
| Complexité | Faible–moyenne (contrat d’articles + filtres RBAC) |
| Offline | Excellent (articles dans le bundle) |
| Sécurité | Bonne si le contexte envoyé nulle part et le filtre RBAC est local |
| Maintenance | Liée aux releases ; risque de dérive vs guides Markdown |
| Web/Mobile | Un même catalogue partagé (package ou copie contrôlée) |
| Délai | Compatible HELP-V1 |

### Option B — frontend + catalogue d’aide backend

API lecture `GET /api/help/articles?screen=&platform=` scoped tenant-optional (contenu global) + cache L1 plus tard.

| Critère | Évaluation |
|---|---|
| Avantages | Contenu administrable sans store release ; analytics serveur |
| Inconvénients | Nouveau contrat API, authz, cache, hors scope HELP-01 ; Mobile offline à concevoir |
| Coût | Moyen |
| Complexité | Moyenne |
| Offline | Faible sans cache dédié (L1 actuel = données métier, pas KB) |
| Sécurité | Risque si l’API renvoie des articles non filtrés par permissions |
| Maintenance | Meilleure à moyen terme |
| Web/Mobile | Un backend, deux clients |
| Délai | HELP-V2 |

### Option C — assistant IA / RAG sur documentation Somafrik

Utilisateur → contexte minimal → retrieval guides versionnés → réponse. **Étude uniquement.**

| Critère | Évaluation |
|---|---|
| Avantages | Questions libres ; potentiel V4 |
| Inconvénients | Hallucinations, coût, PII, dépendance externe, hors politique V1 |
| Coût | Élevé |
| Complexité | Élevée |
| Offline | Quasi nul |
| Sécurité | P0 si le prompt embarque dossier élève / finance nominative |
| Maintenance | Index + versioning docs + garde-fous |
| Web/Mobile | Même backend IA |
| Délai | Après V2/V3 uniquement |

**HELP-01 recommande A pour V1**, B pour V2, C interdit jusqu’à V4 et seulement sur corpus versionné.

---

## 9. UX recommandée

**Web (authentifié) :** bouton fixe bas-droite `[ ? ]` / « Besoin d’aide ? » (libellé long ≥ `sm`). Ouverture : **panneau latéral droit** (pas un modal plein écran qui tue le contexte métier). Escape + focus trap + retour du focus. `z-index` > toast (`z-50`, `Toast.tsx:65`) ou toast décalé.

**Mobile (authentifié, hors login) :** pastille `[ ? ]` **au-dessus** de la tab bar flottante (`screenLayout.ts:16-32`) + `insets.bottom`. Ouverture : **bottom sheet** (pattern déjà connu via `OverflowActions`) plutôt qu’une nouvelle stack opaque. Ne pas masquer le CTA « Ajouter » des listes ni les tabs.

Contenu du panneau (maquette, non implémentée) :

1. Titre « Besoin d’aide ? »
2. Champ « Rechercher dans l’aide »
3. « Suggestions pour cet écran » (3 max, déjà filtrées RBAC)
4. « Guides populaires » (liste courte, même filtre)
5. Pas de « Contacter le support Somafrik » en V1 (la vitrine l’interdit publiquement ; Mobile Support actuel reste le fallback établissement)

Absent : vitrine, connexion, reset mot de passe, bootstrap permissions.

---

## 10. Sécurité / RBAC / tenant

### 10.1 Verdict actions

| Niveau | V1 | Motif |
|---|---|---|
| **LECTURE** | Autorisée | Afficher des steps déjà documentés |
| **NAVIGATION** | Autorisée **si** `canReadView` / `canReadRoute` | Deep-link Web `navigate(path)` / Mobile `navigation.navigate(name)` uniquement vers une route déjà visible |
| **ACTION** (créer/modifier/supprimer) | **Interdite** | Contournement CRUD/RBAC (`PermissionRoute.tsx:38-40`, `useVisibleNavItems.ts:14-18`) |

Un article « Créer un utilisateur » ne s’affiche que si le rôle a `Utilisateurs:CREATE` (ou équivalent live). Un enseignant (`internalRoleDefaults` enseignant ≠ users admin) ne l’a pas.

### 10.2 Tenant

Contenu d’aide **global** (procédures produit) : pas de `schoolId` dans la KB.

Interdit : recherche inter-établissements, procédures Superadmin exposées à un Admin School, fuite de `school_code` / listes élèves dans le contexte d’aide.

Isoler via le tenant déjà porté par le JWT / `schoolCode` (`web/src/types.ts` annotation tenant ; `tenantScopeService` côté API métier — l’aide V1 ne parle pas à ces APIs).

### 10.3 Alias Support Mobile

Ne **pas** attacher HELP-V1 à `Support: "Messages"` (`Mobile/src/domain/security/permissions.ts:122`). L’aide produit doit être visible dès qu’il existe une session authentifiée (éventuellement une permission dédiée plus tard, ex. `Aide:READ` globale).

---

## 11. Confidentialité

Contexte acceptable (conceptuel, pas de code) :

```text
HelpContext {
  platform: "web" | "mobile"
  screen: "payments" | "attendance" | ...
  module: "finances" | "pedagogie" | ...
  role: "TEACHER" | ...
  permissions: string[]   // tokens déjà en session, jamais le JWT
}
```

**Ne jamais** envoyer par défaut : mot de passe, token, JWT, identité complète d’élève, notes individuelles, dossier médical, lignes de paiement nominatives, secrets, `google-services`.

Web : le pathname suffit (`/finances/paiements` → `screen=payments`).  
Mobile : `route.name` + tab active, **sans** params `studentId`.

Télémétrie V1 (si un jour) : `help_opened`, `help_search`, `help_article_opened`, `help_search_no_result` — **sans** payload scolaire.

---

## 12. Accessibilité

**Web (à exiger en V1) :** `aria-label` « Ouvrir l’aide » / `aria-expanded` ; focus trap du panneau ; Escape ; restore focus ; contraste AA (footer vitrine déjà corrigé VITRINE-04 — même discipline) ; le bouton ne doit pas voler le focus du Topbar.

**Mobile :** `accessibilityLabel` / `accessibilityRole="button"` ; hit target ≥ `MIN_TOUCH_TARGET_DP` (44) (`mobileUsability.ts:8`) ; TalkBack / VoiceOver ; ne pas poser le bouton dans la zone tab bar (`screenLayout.ts:16-32`).

Le toast Web est `aria-live="polite"` (`Toast.tsx:61-63`) : le panneau d’aide ne doit pas le recouvrir sans alternative.

---

## 13. Offline

| Disponible offline (V1, Option A) | Nécessite réseau |
|---|---|
| Articles embarqués | Recherche serveur (V2) |
| Suggestions contextuelles | Tickets / « contacter Somafrik » |
| FAQ courte | Assistant IA |
| | Sync de catalogue distant |

L1 cache (`L1CacheRuntime`) et outbox (`messages|presences|notes`) **ne couvrent pas** une KB. Ne pas étendre l’outbox à des tickets en V1.

Stratégie : V1 = 100 % embarqué ; V2 = cache articles + fallback bundle.

---

## 14. Performance

- Bouton : composant statique dans `AppLayout` / header Mobile — **pas** de graphe docs au boot.
- Panneau : **lazy** (`React.lazy` Web déjà utilisé pour les pages, `App.tsx` + `Suspense`).
- Articles : chunk séparé (`help-catalog`) ; pas de base64 ; pas de `/docs/` runtime.
- IA : chunk et feature-flag ultérieurs, jamais dans le bundle initial.
- Landing chunk actuel déjà surveillé (~23 kB) : l’aide **ne doit pas** entrer dans `LandingPage`.

---

## 15. Support humain

Aujourd’hui : Mobile dit « contactez l’administration de l’établissement » (`MvpUtilityScreens.tsx:272`) et promet un journal P1 (`:278`). Web n’a **pas** d’équivalent. La vitrine interdit « Nous contacter » (`LandingPage.test.tsx:59`).

HELP-V1 : **pas** de ticket, pas d’Intercom, pas d’e-mail prérempli vers Somafrik.

Futur (audit seulement), payload d’une demande :

- autorisé : écran, version app, plateforme, rôle, `schoolCode` interne **côté serveur déjà connu**, timestamp ;
- interdit : mot de passe, JWT, notes, finance nominative, dossier élève.

Canal V1 acceptable : laisser l’écran Support Mobile tel quel (établissement) **à côté** du nouveau bouton d’aide produit, sans les fusionner.

---

## 16. Assistant IA — faisabilité uniquement

Faisable plus tard **si et seulement si** :

1. Corpus = guides versionnés + `KNOWN-ISSUES` (interdiction d’inventer le produit) ;
2. Retrieval filtré par `HelpContext` (rôle/permissions/écran) ;
3. Aucune donnée nominative dans le prompt ;
4. Réponse citant l’article source ;
5. Feature flag + chunk séparé ;
6. Pas d’ACTION métier.

**Ne pas implémenter.** Pas d’OpenAI/Anthropic. Pas de table embeddings dans ce lot.

Risque principal : l’IA « complète » une procédure Web non capturée (W07–W16) et pousse une action fausse — P1 produit, P0 si elle ignore le RBAC.

---

## 17. Risques P0 / P1 / P2 / P3

### P0

| Risque | Preuve | Impact | Scénario | Recommandation |
|---|---|---|---|---|
| Aide qui propose une procédure hors RBAC | `PermissionRoute.tsx:38-40` ; `useVisibleNavItems.ts:14-18` | Contournement perçu / tentative d’action interdite | Enseignant lit « Créez un utilisateur » | Filtrer chaque article sur `session.user.permissions` |
| Alias Support = Messages | `Mobile/src/domain/security/permissions.ts:122` | Aide absente ou confondue avec la messagerie | Parent sans Messages ne voit rien ; admin croit que Support = chat | Permission d’aide distincte ou « session authentifiée » |
| Contexte trop riche vers un futur IA | `AuthContext.tsx:93-107` (permissions + user) | Fuite tenant / PII | Prompt = objet session complet | `HelpContext` minimal §11 |
| Widget sur la vitrine | `LandingPage.test.tsx:59,111-119` | CTA mort + politique commerciale | FAB « Besoin d’aide » sur `/` | Interdit V1 |

### P1

| Risque | Preuve | Impact | Scénario | Recommandation |
|---|---|---|---|---|
| Procédure non validée présentée comme officielle | `CAPTURES-METIER.md:26-34` (W07–W16 À CAPTURER) ; `KNOWN-ISSUES.md:34-36` | Mauvaise action métier | Article « Lier un parent » alors que le guide refuse le parcours | Gate contenu = guide + pas dans KNOWN-ISSUES |
| Confusion login_code / school_code | `KNOWN-ISSUES.md:94-104` | Échec de connexion via l’aide | Article « saisissez CD-2026-0001 » | Distinguer code public vs périmètre interne |
| ACTION automatique | CRUD listes (`ClassesListPage` pattern canCreate) | Mutation non voulue | « Créer la classe pour moi » | ACTION interdite V1 |

### P2

| Risque | Preuve | Impact | Scénario | Recommandation |
|---|---|---|---|---|
| Collision tab bar Mobile | `screenLayout.ts:16-32` | Bouton métier / tabs masqués | FAB à 16 px du bas | Offset = `tabBarOccupiedHeight` + gap |
| Collision toast Web | `Toast.tsx:65` `bottom-6` centre | Toast illisible | Aide ouverte + erreur save | z-index et offset bas-droite |
| Collision Modal / drawer | `Modal.tsx:40` `z-40` | Double overlay | Aide + QuickPayment | Fermer l’aide ou `z` strict + inert |
| Petit écran 360 | shell vitrine `overflow-x-clip` (Landing) ; AppLayout `px-4` | Overflow / focus | FAB + Topbar mobile | `[ ? ]` compact ; tester 360/390 |
| Clavier Mobile | `KeyboardAwareScreen` + `DEFAULT_ANDROID_KEYBOARD_HEIGHT` 260 (`mobileUsability.ts:10`) | Sheet d’aide sous le clavier | Recherche aide | Ajuster sheet avec keyboard insets |
| Guides SHA ≠ HEAD | `docs/user-guides/README.md:3` vs base `b53c691` | Doc obsolète | Article planning vs UI actuelle | Revalider le corpus avant indexation V1 |

### P3

| Risque | Preuve | Impact | Recommandation |
|---|---|---|---|
| MenuScreen orphelin vs drawer | `roleDrawerPreferences.ts:61` vs `MenuScreen` non enregistré | Confusion future | Ne pas brancher HELP sur MenuScreen |
| Empty state « Contactez Somafrik » abonnement | `MonAbonnementPage.tsx:45` | Canal support informel | Harmoniser plus tard avec Support établissement |
| EnvironmentBadge | `EnvironmentBadge.tsx:8-20` | Bruit visuel preprod | Ignorer en prod (`shouldShowEnvironmentBadge`) |

---

## 18. Architecture cible recommandée

```text
[App authentifiée]
    Web: AppLayout          Mobile: HomeTabs + stack
         │                         │
         ▼                         ▼
   HelpTrigger (léger)      HelpTrigger (au-dessus tabs)
         │                         │
         └──────────┬──────────────┘
                    ▼
            HelpPanel (lazy)
                    │
                    ▼
         help-catalog (Option A)
           articles[] filtrés par
           platform + screen + role + permissions
```

Pas de backend HELP en V1.  
Pas d’IA.  
Pas de montage sur `LandingPage` / `LoginPage` / `Welcome` / `RoleSelection`.

Abstraction conceptuelle : `HelpContext` §11.  
Catalogue conceptuel (non créé) : `id`, `title`, `roles`, `permissions`, `platforms`, `routeKeys`, `keywords`, `summary`, `steps`, `relatedArticles`.

---

## 19. Roadmap HELP-V1 → HELP-Vn

Alignée sur le dépôt (pas d’IA d’abord) :

| Lot | Contenu | Dépendances |
|---|---|---|
| **HELP-V1** | Bouton flottant + panneau + suggestions écran/rôle + recherche locale + sous-ensemble guides validés | Option A ; filtres RBAC ; a11y ; collisions tabs/toast |
| **HELP-V2** | Centre d’aide administrable + plus d’articles + captures W07–W16 quand `VALIDÉE` | Option B optionnelle ; encore 0 IA |
| **HELP-V3** | Arbre conversationnel **sans** génération (questions prédéfinies) | Même catalogue ; NAVIGATION seulement |
| **HELP-V4** | RAG sur docs versionnés | Option C ; privacy review ; feature flag |

Parité Web / Mobile :

| Fonction | Web | Mobile | V1 | Plus tard |
|---|---|---|---|---|
| Bouton flottant | bas-droite | bas-droite au-dessus tabs | oui | — |
| Ouverture / fermeture | drawer / panneau | bottom sheet | oui | — |
| Recherche locale | oui | oui | oui | — |
| Suggestions contextuelles | pathname | route name | oui | — |
| Articles | catalogue embarqué | même catalogue | oui | enrichir V2 |
| Navigation vers écran | si permission | si permission | oui limité | — |
| Favoris / récents | — | — | non | V2 |
| Support humain | non | écran Support existant inchangé | coexistence | tickets V2+ |
| IA | non | non | non | V4 |
| Offline | bundle | bundle | oui | sync V2 |
| Analytics | optionnel anonymisé | optionnel | non obligatoire | V2 |

---

## 20. Verdict

**GO sous conditions.**

Somafrik peut et doit commencer par **HELP-V1 sans IA** : bouton flottant, aide contextualisée (écran + rôle + permissions), recherche dans les guides déjà officiels, Web et Mobile, architecture prête pour un assistant conversationnel **ultérieur**.

Ne pas commencer par B, C, D ou E (centre distant, scénarios lourds, chat libre, IA) : le repository n’a ni catalogue runtime, ni Support Web, ni captures Web W07–W16, et la vitrine interdit déjà les CTA support.

**Conditions avant d’ouvrir HELP-V1 :**

1. Périmètre UI = shell authentifié uniquement (`App.tsx:83-92` / `HomeTabs`).
2. Filtrage article = permissions live (`AuthContext.tsx:93-107`), jamais le rôle seul.
3. LECTURE oui, NAVIGATION conditionnelle, ACTION non.
4. Corpus = guides + exclusions `KNOWN-ISSUES.md` ; pas d’article « parent-enfant écriture ».
5. Ne pas réutiliser `Support → Messages`.
6. Ne pas ajouter Intercom/Crisp/Zendesk, ni `/docs` sur la vitrine.
7. Ne pas toucher `Mobile/google-services.json`, backend métier, RBAC, captures marketing.
8. Revue collisions : tab bar Mobile, toast Web, modales, 360 px.

**NO-GO** seulement si le lot glisse vers une IA ou un widget vitrine dans le même PR.

---

*Audit HELP-01. Aucune implémentation. Aucun Ready. Aucun merge.*
