# HELP USER GUIDE — État actuel « Besoin d’aide ? » (Web + Mobile)

**Lot :** mise à jour du guide utilisateur in-app  
**Branche de travail :** `cursor/help-user-guide-refresh-06a2`  
**Base `origin/develop` :** `4959bbc9419da37c2882412d0d2dbbdd5c0fceaf`  
**Date d’audit :** 2026-09-18  
**Type :** **AUDIT RED** — diagnostic avant correction. Aucune règle métier n’a été modifiée pour coller à la documentation.

**Sources de vérité :** runtime Web (`web/src`), Mobile Expo (`Mobile/src`), catalogue `@somafrik/help-catalog`, RBAC live, `docs/user-guides/KNOWN-ISSUES.md`.  
En cas d’écart : **l’application actuelle prime**. Les incohérences fonctionnelles sont signalées ici ; elles ne sont pas « corrigées » dans le produit.

**Web ≠ Mobile.** Le responsive Web n’est pas l’application native Expo.

---

## 1. Résumé exécutif

Somafrik dispose déjà d’un système d’aide in-app **HELP-V1A (catalogue)** + **HELP-V1B (Web)** :

- bouton flottant **« Besoin d’aide ? »** (Web authentifié) ;
- panneau latéral, recherche locale, suggestions d’écran, filtrage rôle + permissions ;
- **47 articles** dans `packages/help-catalog/src/articles.js`.

Ce système **n’est plus aligné sur le produit livré** (LOTs configuration établissement, professeur principal, notifications Paramètres, bulletins, compte).

| Surface | Aide produit runtime | Écart majeur |
| --- | --- | --- |
| Web authentifié | Oui — `HelpHost` / `HelpPanel` | Pas de catégories métier ; contenus manquants (setup, PP, auth, bulletins, assistance) |
| Vitrine `/` et `/connexion` | Non (volontaire) | Conforme — l’aide ne doit pas s’y monter |
| Mobile Expo | **Non** | Aucun `Mobile/src/help` ; écran **Support** ≠ catalogue d’aide |
| Guides Markdown `docs/user-guides/` | Hors runtime | Captures PNG **absentes du dépôt** ; notes enseignant plus optimistes que le P1 runtime |

**HELP-V1A / HELP-V1B** sont encore présents et utiles. Ils ne sont pas du legacy à supprimer. Ils sont **incomplets** vis-à-vis de l’état produit 2026-09.

**HELP-V1C Mobile** (annoncé dans des scripts) **n’a jamais été livré**. `scripts/verify-help-v1b-web.js` **interdit** même `Mobile/src/help`.

---

## 2. Inventaire technique

### 2.1 Web

| Fichier | Rôle |
| --- | --- |
| `web/src/help/HelpHost.tsx` | Montage après bootstrap permissions ; masqué si `mustChangePassword` |
| `web/src/help/HelpTrigger.tsx` | FAB « ? » / « Besoin d’aide ? » |
| `web/src/help/HelpPanel.tsx` | Panneau : recherche, 3 suggestions écran, guides populaires, article + navigation |
| `web/src/help/buildWebHelpContext.ts` | Contexte sans PII / JWT |
| `web/src/components/layout/AppLayout.tsx` | `lazy(HelpHost)` |
| `web/src/pages/LoginPage.helpAbsence.test.tsx` | Garde : pas d’aide sur `/connexion` |

**Routes d’aide :** aucune API `/api/help`. Recherche 100 % locale.

### 2.2 Mobile

| Fichier | Rôle |
| --- | --- |
| `Mobile/src/screens/MvpUtilityScreens.tsx` → `SupportScreen` | Contact **administration de l’établissement** ; texte « centre d’assistance P1 » **non livré** |
| Menu / drawer | Entrée **🆘 Support** (alias RBAC historique `Support → Messages`) |
| `Mobile/src/help` | **Absent** |
| Consommation `@somafrik/help-catalog` | **Interdite** par le gate HELP-V1A |

### 2.3 Catalogue et tests

| Fichier | Rôle |
| --- | --- |
| `packages/help-catalog/src/articles.js` | 47 articles immuables |
| `packages/help-catalog/src/query.js` | `filter` / `search` / `suggest` (max 3) / `popular` |
| `packages/help-catalog/src/screens.js` | Mapping pathname Web / routeName Mobile |
| `packages/help-catalog/src/context.js` | Fail-closed rôle + permissions |
| `scripts/verify-help-v1a-catalogue.js` | Gate catalogue |
| `scripts/verify-help-v1b-web.js` | Gate Web ; **bloque Mobile/src/help** |
| `scripts/verify-help-settings.js` | Alignement Paramètres SETTINGS-01 |
| `.github/workflows/help-v1a.yml` / `help-v1b-web.yml` / `help-settings.yml` | CI |

**Schéma article actuel :** `id`, `title`, `summary`, `roles`, `permissions`, `platforms`, `routeKeys`, `keywords`, `steps`, `relatedArticles`, `captureIds`, `navigate`.  
**Manquant pour la maintenabilité demandée :** `category`, `order` explicite, regroupement UI.

### 2.4 Contenu hors runtime

- `docs/user-guides/GUIDE-UTILISATEUR-WEB.md` / `GUIDE-UTILISATEUR-MOBILE.md`
- `docs/user-guides/CAPTURES-METIER.md` — W01–W06 / M01–M23 référencés
- `docs/user-guides/assets/` — **aucune image versionnée** (README seulement)
- `docs/audits/help-assistant-web-mobile.md` — audit HELP-01 (2026-08-30), **obsolète** (décrit l’absence du FAB qui existe désormais)

### 2.5 Captures

Les articles citent `W02`…`M23`. Les fichiers PNG ne sont pas dans git. Les captures **ne peuvent pas** servir de source d’explication. Aucune capture personnelle n’est embarquée dans le runtime d’aide (le panneau est texte).

---

## 3. Matrice module × canaux

Légende conformité : **Oui** = documenté et aligné produit ; **Partiel** = existe mais incomplet / libellés ou rôles à corriger ; **Non** = absent du guide in-app.

| Module | Web | Mobile | Documentation existante | Conforme | Obsolète | Manquant |
| --- | --- | --- | --- | --- | --- | --- |
| **Aide in-app (coque)** | FAB + panneau | Support ≠ aide | HELP-V1A/B | Web : partiel | Audit HELP-01 (FAB absent) | UI Mobile catalogue ; catégories ; « Je n’ai pas trouvé » |
| **Démarrage — première connexion** | `/connexion` (3 profils, MDP temporaire **Enregistrer**) | Login identifiant / MDP ou PIN, **Valider** | Guides MD §1 ; **0 article catalogue** | Non | — | Articles première connexion + différences Web/Mobile |
| **Démarrage — tableau de bord** | `/tableau-de-bord` | `Home` / hub Scolarité | `help/dashboard/overview` | Partiel | — | Widget **Configuration rapide** |
| **Démarrage — config. initiale** | Assistant + auto-open Admin School si `NOT_STARTED` | Écran `SchoolSetup` ; **pas** d’auto-open login | 0 article | Non | Parcours Paramètres 1→12 sans assistant | Assistant, étapes, **Plus tard**, complétude optionnelle |
| **Démarrage — navigation** | Sidebar + topbar comm. | Tabs + drawer + Menu | Guides MD ; 0 article dédié | Non | — | Différences Web/Mobile |
| **Établissement — profil / année / périodes / structure** | Paramètres | Paramètres (sous-ensemble) | `help/settings/*` | Oui (cœur) | `coming-soon` inclut encore **Notifications** | Carte **Configuration de l’établissement** |
| **Établissement — notifications Paramètres** | `/parametres/notifications` **Disponible** (interrupteurs) | Applique les règles backend ; pas d’écran config | Catalogue → coming-soon | Non | Article « Bientôt » pour Notifications | Consulter / modifier les canaux |
| **Établissement — apparence / intégrations** | Badge **Bientôt** | Absent | `help/settings/coming-soon` | Oui | Mentions Notifications dans le même article | — |
| **Utilisateurs et accès** | Comptes utilisateurs | Utilisateurs | `help/users/*`, RBAC | Oui | — | Article dédié reset MDP ; première connexion |
| **Scolarité — classes / inscription** | Inscription **depuis la classe** ; pas d’ajout global | Idem | `help/classes/*`, `help/students/enroll` | Oui | Ancien « Ajouter un élève » **non réintroduit** (correct) | — |
| **Scolarité — fiche élève** | **Dossier** Web | **Fiche élève** Mobile | `help/students/record` Web only | Partiel | — | Fiche Mobile |
| **Scolarité — professeur principal** | Colonne + **Affecter un professeur principal** | Carte classe, mêmes libellés | **0 article** | Non | — | Consultation + affectation (droits `Classes:UPDATE` / `Affectations:*`) |
| **Enseignants** | Création via Comptes utilisateurs | **Créer un enseignant** | Articles Web/Mobile distincts | Oui | — | Lien vers professeur principal |
| **Présences** | Défaut **Présent** ; **Tous présents** | Défaut **null** ; **Tout présent** | `help/attendance/*` | Partiel | Fusion des libellés masse sans défaut | Clarifier défaut Web vs Mobile |
| **Pédagogie — notes** | Onglets évaluations / saisie | `TeacherGrades` | Consultation only (catalogue) ; guides MD plus optimistes | Catalogue : prudent (correct) | Guide MD write comme parcours normal | Ne **pas** publier create-evaluation / saisir (P1 §18) |
| **Pédagogie — bulletins** | `/bulletins`, modèle, vérif. publique | `ReportCards` lecture | 0 article | Non | — | Consultation publications ; pas de write « garanti » |
| **Pédagogie — planning** | `/planning` | Emploi du temps | `help/planning/overview` | Oui | — | — |
| **Finance — paiements** | Finances → Paiements | Paiements ; bouton saisie masqué si liste vide | `help/payments/*` | Partiel | — | Écran **Impayés** / **Total restant** (montants exemples = fictifs) |
| **Finance — grilles** | Paramètres → Finances | Non (Web) | `help/settings/finance*` | Oui | — | — |
| **Communication** | Messages / Annonces / Notifications (topbar) | Routes dédiées | 3 articles | Partiel | — | Push **Android natif seulement** ; ne pas affirmer Expo Go/web |
| **Compte et sécurité** | Topbar **Déconnexion** ; pas de « Mon profil » user ; légal `/confidentialite`, `/suppression-compte` | Menu **Déconnexion**, confidentialité, suppression (URL somafrik.app) | Settings sécurité lecture seule | Non | — | Auth, logout, confidentialité, suppression |
| **Assistance** | Pas de contact dans le panneau | Support = admin établissement | Test catalogue **interdit** « Nous contacter » | Non | Texte Mobile « centre P1 » | Section **Je n’ai pas trouvé la réponse** (mécanisme réel = administration établissement) |
| **Recherche** | Locale, accent-insensitive, RBAC | Absente | `searchHelpArticles` | Web : oui ; Mobile : non | — | Brancher Mobile sur le même moteur |
| **Aide contextuelle** | Suggestions `routeKeys` (max 3) | Absente | `suggestHelpArticles` | Web : oui | — | Mapper setup / bulletins / notifications ; UI catégories |
| **Superadmin / plateforme** | Aide montée si écran mappé ; articles établissement filtrés par rôle | Tabs plateforme limitées | `help/rbac/missing-action` + export/sécurité si rôle | Oui (fail-closed) | — | Ne pas exposer doc plateforme aux rôles établissement |
| **Parent / élève** | Web peu centré famille | Accueil onglets Profil / Notes / Présence / Frais | Articles Mobile only | Partiel | Parent seed sans enfant (P1 §19) — **ne pas** inventer un suivi enfant | Parité Web si écrans existent ; pas de write parent-enfant (KI §6) |

---

## 4. Écarts fonctionnels détectés (hors correction produit)

Ces écarts sont **signalés**, pas corrigés dans ce chantier (règle mandat) :

1. **Notes enseignant P1** (`KNOWN-ISSUES.md` §18) — `GET /api/assignments` / `write_notes` peuvent bloquer création d’évaluation et saisie. Le catalogue a raison de ne pas publier ces procédures. Le guide Markdown Web/Mobile § notes est trop optimiste.
2. **Parent–enfant** — pas de parcours d’écriture certifié (KI §6, §19).
3. **Paiement Mobile** — **Saisir un paiement** masqué tant qu’aucun reçu n’est chargé (KI §16). Déjà mentionné dans `help/payments/record`.
4. **Codes établissement** public vs interne (KI §12).
5. **Tableau de bord** effectifs éventuellement désalignés de l’annuaire (KI §13).
6. Menu Mobile enseignant : libellé **Profil enseignant** ouvre `Support` — confusion Support ≠ aide produit (à ne pas documenter comme profil).

---

## 5. Contenu interdit / legacy à ne pas réintroduire

- Bouton global **Ajouter un élève** (workflow retiré ; inscription depuis la classe uniquement).
- `help/grades/create-evaluation`, `help/grades/enter`.
- Intercom / Crisp / Zendesk / OpenAI / `GET /api/help`.
- Fusionner l’aide produit avec l’écran Mobile **Support**.
- Aide sur vitrine ou écran de connexion.
- Parcours d’écriture parent–enfant.
- Restauration complète / pénalités automatiques / matrice RBAC établissement en écriture.
- Données personnelles dans des captures.

---

## 6. Recherche — termes demandés (état avant correction)

Corpus **Admin School Web**, moteur actuel :

| Terme | Résultat actuel | Verdict |
| --- | --- | --- |
| élève | Annuaire / inscription | OK |
| paiement | Consulter / saisir | OK |
| présence | Appel | OK (token `présences`) |
| professeur | Faible (enseignants, pas « professeur ») | À renforcer |
| mot de passe | Settings sécurité / create user | Pas de parcours « changer mon MDP » |
| bulletin | Mention dans périodes seulement | Article bulletins manquant |
| message | `help/communication/messages` | OK |
| classe | Liste / création | OK |

---

## 7. Décisions d’implémentation (après ce diagnostic)

Sans élargir hors du guide « Besoin d’aide ? » et sans refonte disproportionnée :

1. Étendre le catalogue (catégorie + ordre + articles manquants alignés libellés réels).
2. UI Web : catégories + conservation recherche et suggestions contextuelles + section assistance.
3. UI Mobile : consommer **le même catalogue** (HelpHost), distinct de Support.
4. Tests RED→GREEN sur route, catégories, rôles, legacy interdit, contextuel, recherche, Web/Mobile.
5. PR **Draft** — pas de Ready, pas de merge.

**Production :** aucun déploiement ni écriture directe.

---

## 8. Preuves de fichiers (inventaire)

Web help : `web/src/help/*`  
Mobile help runtime : **aucun**  
Catalogue : `packages/help-catalog/**`  
Guides : `docs/user-guides/**`  
Audits antérieurs : `docs/audits/help-assistant-web-mobile.md` (HELP-01, 2026-08-30)
