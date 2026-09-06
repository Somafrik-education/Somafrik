# Audit d’implémentation — `contact@somafrik.app`

**Mandat CTO** — AUDIT UNIQUEMENT  
**Projet :** Somafrik  
**Date :** 2026-09-01  
**Branche d’audit :** `cursor/contact-email-audit-1534`  
**Base :** `origin/develop`  
**SHA de base :** `78228be06286b464afd9e691fb227d16be95a63a`  
**Périmètre :** inventaire des adresses e-mail de contact / support / transactionnel / sécurité / facturation.  
**Hors périmètre :** toute modification métier, tout merge, toute implémentation de formulaire, tout branchement SMTP.

**Révision CTO** (REQUEST CHANGES PR #449) : §10.5 métadonnées Git / historique ; P1 EMAIL-P1-003b ; PR F = fichiers + identité Git future (pas de rewrite) ; `main` = historique/stale (Vercel live non sourcé).

```text
AUCUN READY
AUCUN MERGE
AUCUNE MODIFICATION MÉTIER
```

Cloudflare Email Routing (état externe connu, hors dépôt) :

```text
contact@somafrik.app  →  somafrik@outlook.fr
```

Cette configuration est de **réception**. Elle n’est **pas** un fournisseur d’envoi SMTP.

---

## 0. Ancrage Git

```text
git fetch origin develop
git checkout -b cursor/contact-email-audit-1534 origin/develop
HEAD origin/develop = 78228be06286b464afd9e691fb227d16be95a63a
ahead / behind origin/develop (avant ce document) = 0 / 0
working tree = clean
```

| Champ | Valeur |
|---|---|
| Repo | `Somafrik-education/Somafrik` |
| Visibilité GitHub | **PUBLIC** |
| Branche cible | `develop` |
| `main` observé | `b5074565b08472217702d8ff848f5a398d08831c` — branche **historique/stale** (snapshot develop du 27 juillet, **pas** le HEAD `develop` actuel). `docs/vercel.md` *documente* un mapping « production Vercel = `main` » ; **aucune preuve GitHub Deployments indépendante** n’établit que ce SHA est le site live `somafrik.app` (les deployments GitHub visibles sont des previews **Render** `somafrik-api-preprod`). |
| Fichier livré | `docs/audits/contact-email-implementation-audit-2026-09-01.md` |

Méthode : recherche exhaustive dans le monorepo (`web/`, `Mobile/`, `backend/`, `scripts/`, `docs/`, `packages/`, `BackOffice/`, `.github/`, `.env*.example`) sur `@somafrik`, `outlook`, `gmail`, `mailto:`, `noreply`, `replyTo`, `SMTP`, `MAIL_`, `EMAIL_`, `RESEND`, `SENDGRID`, `BREVO`, `POSTMARK`, `SES`, `Cloudflare`, `support`, `contact`. Complément : `git log origin/develop --format='%ae%n%ce'` (métadonnées d’auteur / committer, distinctes des fichiers). Aucun `node_modules` n’est cité comme source de vérité.

---

## 1. Executive summary

**`contact@somafrik.app` n’est aujourd’hui l’adresse publique affichée nulle part sur `develop`.**

Elle existe déjà dans le code, mais pour un usage **opposé** à l’identité publique : c’est une adresse **générique d’établissement** ignorée par la détection de doublons (`GENERIC_EMAILS`). Les tests d’établissements l’utilisent comme e-mail fictif d’école, pas comme contact Somafrik.

Sur `develop` :

- la vitrine **interdit** explicitement « Nous contacter » et `support@somafrik.app` (`LandingPage.test.tsx`) ;
- il n’existe **aucun** `mailto:` ;
- il n’existe **aucune** page légale (mentions, confidentialité, CGU/CGV, cookies) ;
- il n’existe **aucun** formulaire de contact ;
- il n’existe **aucun** fournisseur d’envoi (pas de nodemailer, Resend, SendGrid, Brevo, Postmark, SES, SMTP applicatif) ;
- les notifications métier sont **in-app** (`senderName = "Somafrik"`), pas des e-mails ;
- la réinitialisation de mot de passe est **opérateur → mot de passe temporaire à l’écran**, jamais un e-mail « forgot password ».

Sur la branche `main` **historique/stale** (`b5074565`) :

- le pied de page affiche encore `support@somafrik.app` **sans** `mailto:` ;
- le BackOffice legacy affiche la même adresse.

`somafrik@outlook.fr` n’apparaît **pas** dans le produit. Elle est **codée en dur** dans `docs/project/SECURITY.md` (politique de divulgation) **et** dans les **métadonnées Git publiques** : le HEAD de `develop` (`78228be0`, merge PR #446) a `author.email = somafrik@outlook.fr` (committer = `noreply@github.com`). Retirer l’adresse de `SECURITY.md` **ne la fait pas disparaître** de l’historique Git déjà publié. Verdict fuite Outlook : **C — exposée publiquement = anomalie** (gravité P1, pas P0 : ce n’est pas un secret SMTP). Surfaces distinctes : fichiers / UI / Git futur / historique (voir §10.5).

**Risque d’architecture principal (le mandat le vise explicitement) :** coller `contact@somafrik.app` à la fois comme identité humaine, destinataire de formulaire, FROM des mots de passe, FROM des notifications et FROM système. **Aujourd’hui ce mélange n’est pas implémenté** (il n’y a pas d’envoi). Il serait **très facile** de le commettre à la première PR « on branche l’e-mail ». Ce rapport fige la séparation **avant** toute mise en production d’un canal sortant.

**Verdict CTO : GO SOUS CONDITIONS.**  
L’adoption de `contact@somafrik.app` comme identité **publique générale** est possible et souhaitable. Elle ne doit **pas** devenir l’identité d’expédition transactionnelle. `somafrik@outlook.fr` reste destination Cloudflare uniquement.

---

## 2. État actuel

### 2.1 Identité publique

| Surface | `develop` (cible) | `main` (historique/stale) |
|---|---|---|
| Adresse publique affichée | **aucune** | `support@somafrik.app` (footer vitrine + BackOffice) |
| `contact@somafrik.app` affichée | non | non |
| Lien `mailto:` | aucun | aucun |
| CTA « Nous contacter » | **interdit par tests** | absent (adresse en texte brut) |
| Pages légales | `marketingLegalRoutes = []` | faux liens `#securite` (« Confidentialité », « Conditions ») |
| Formulaire de contact | **n’existe pas** | n’existe pas |
| Métadonnées / JSON-LD / `contactPoint` | absents | absents |

### 2.2 Canaux e-mail

| Canal | État réel |
|---|---|
| Réception `contact@somafrik.app` | Cloudflare Email Routing → Outlook (hors code, état externe connu) |
| Envoi applicatif | **absent** — aucune dépendance, aucune variable `MAIL_` / `SMTP` / `RESEND` |
| Notifications | in-app PostgreSQL (COM-C4) ; `senderName = "Somafrik"` |
| Relances impayés « Email (si configuré) » | UI présente ; **aucun envoi SMTP** ; journalisation locale uniquement |
| Reset mot de passe | `POST /api/users/:id/reset-password` — mot de passe temporaire **retourné à l’opérateur** |
| Invitations / première connexion | même modèle : secret affiché dans l’UI, pas d’e-mail |
| SPF / DKIM / DMARC | **non documentés** dans le dépôt |

### 2.3 Confusion d’usages déjà observable

1. **`contact@somafrik.app` = e-mail générique d’école** (`GENERIC_EMAILS`), pas contact plateforme.
2. **`support@somafrik.app`** est l’adresse historique de vitrine (`main`) et la valeur citée pour le listing Play (`docs/mobile/RELEASE-READINESS.md`), alors que `develop` l’a **retirée** et que les tests **interdisent** de la réafficher.
3. **« Contactez Somafrik »** (abonnement) et **« Contactez l’administration de l’établissement »** (auth, Mobile Support) n’ont **aucun canal**.
4. Relances finance proposent un canal `email` **sans fournisseur**.

Ces quatre points sont des **précurseurs** du mélange contact / support / transactionnel / établissement.

---

## 3. Inventaire des adresses

Légende **usage** :

| Code | Sens |
|---|---|
| `PUBLIC_CONTACT` | Identité publique générale Somafrik |
| `SUPPORT` | Support utilisateurs produit |
| `SECURITY` | Divulgation de vulnérabilité |
| `BILLING` | Facturation / abonnement plateforme |
| `TRANSACTIONAL` | Envoi automatique (reset, invitation, notif) |
| `INTERNAL` | Destination technique / ops, non affichée |
| `SCHOOL_GENERIC` | Adresse plateforme utilisée comme e-mail d’école **à ignorer** (doublons) |
| `FIXTURE` | Seed / test / démo — pas une identité publique |
| `SCHOOL_RECORD` | E-mail d’un établissement ou d’un utilisateur métier |
| `DOC_STALE` | Documentation qui ne correspond plus à `develop` |

**Visible utilisateur** = rendu dans une UI Web / Mobile / PDF / e-mail destinés à un humain hors équipe.

### 3.1 Adresses réelles (hors fixtures E2E massives)

| Fichier | Ligne | Valeur actuelle | Usage | Visible utilisateur | Environnement | Recommandation |
|---|---|---|---|---|---|---|
| `web/src/lib/schoolModule.ts` | 94 | `contact@somafrik.app` | `SCHOOL_GENERIC` — denylist doublons établissements | non (logique métier) | tous | **Conserver** dans la denylist. **Ne pas** y voir une source d’affichage. Brancher la constante publique **à part**. |
| `web/src/lib/schoolModule.ts` | 95 | `info@somafrik.app` | `SCHOOL_GENERIC` | non | tous | Conserver denylist. Ne pas afficher sans décision produit. |
| `web/src/lib/schoolModule.ts` | 96 | `hello@somafrik.app` | `SCHOOL_GENERIC` | non | tous | Idem. |
| `web/src/lib/schoolModule.ts` | 97 | `admin@somafrik.app` | `SCHOOL_GENERIC` | non | tous | Idem. **Ne pas** confondre avec `superadmin@` bootstrap. |
| `backend/lib/schoolModule.js` | 18–21 | mêmes 4 adresses | `SCHOOL_GENERIC` (miroir) | non | tous | Dédupliquer vers une source canonique (PR A). |
| `web/src/lib/schoolModule.test.ts` | 19, 28 | `contact@somafrik.app` | `FIXTURE` école Kanyosha / Baraka | non | test | OK comme preuve « e-mail générique ignoré ». Après PR A, importer la constante. |
| `backend/lib/schoolModule.test.js` | 23, 32 | idem | `FIXTURE` | non | test | Idem. |
| `backend/lib/schoolsRepository.pg.test.js` | 503, 517 | idem | `FIXTURE` | non | test | Idem. |
| `backend/scripts/verify-establishment-e2e.js` | 253, 267 | idem | `FIXTURE` | non | test | Idem. |
| `web/src/pages/LandingPage.test.tsx` | 59, 108 | interdit `Nous contacter` et `support@somafrik.app` | garde-fou vitrine | n/a | test `develop` | **Inverser / affiner en PR B** : interdire Outlook et `support@` comme contact général ; **exiger** `contact@somafrik.app` + `mailto:`. |
| `web/src/data/marketingContent.ts` | 326–327 | `marketingLegalRoutes = []` | pages légales absentes | n/a | `develop` | PR B : ajouter routes légales **réelles**, y placer `contact@`. |
| `web/src/data/marketingContent.test.ts` | 31, 121 | routes légales vides ; interdit « Nous contacter » | garde-fou | n/a | test | Coordonner avec PR B. |
| `web/src/components/marketing/MarketingFooter.tsx` | 43–49 | pas d’e-mail ; légal conditionnel vide | footer vitrine | oui (sans adresse) | `develop` | PR B : afficher `contact@somafrik.app` via constante, `mailto:`. |
| `web/index.html` | 1–41 | SEO title/description, **pas** d’e-mail | métadonnées | oui | web | Plus tard : `Organization.contactPoint` **après** pages légales. |
| `docs/project/SECURITY.md` | 162 | `somafrik@outlook.fr` | `SECURITY` + `INTERNAL` codé en dur | **oui** (repo GitHub public) | docs | **P1 fichiers.** Remplacer par `security@somafrik.app` (PR F). **Insuffisant** à lui seul : l’adresse reste dans l’historique Git (§10.5). |
| `docs/mobile/RELEASE-READINESS.md` | 177 | `support@somafrik.app` « présent landing web » | `DOC_STALE` / `SUPPORT` | docs internes | docs | **P1 doc.** Faux sur `develop`. Play listing : décider `support@` vs `contact@`. |
| `packages/help-catalog/test/catalog.test.js` | 254 | interdit « Nous contacter » | garde-fou aide | n/a | test | Garder l’interdiction **dans l’aide in-app** si le canal public est le footer. Ne pas coller un mailto Somafrik dans le catalogue HELP-V1. |
| `web/src/pages/abonnements/MonAbonnementPage.tsx` | 45 | « Contactez Somafrik ou votre Administrateur pays » | `BILLING` sans adresse | oui | web authentifié | PR G : canal `facturation@` **ou** `contact@` selon décision, jamais Outlook. |
| `Mobile/src/screens/MvpUtilityScreens.tsx` | 263–278 | Support MVP : « contactez l’administration de l’établissement » | support **établissement**, pas Somafrik | oui | Mobile | Conserver le canal établissement. Ajouter un second canal optionnel Somafrik (`support@` ou `contact@`) sans fusionner. |
| `backend/lib/userAccountRules.js` | 46, 52 | « Contactez l’administration de votre établissement » | auth / lockout | oui | API | **Ne pas** remplacer par `contact@somafrik.app`. Reset = opérateur école. |
| `backend/services/authService.js` | 337 | « Contactez l’administration de l’établissement » | login | oui | API | Idem. |
| `web/src/lib/subscriptionAccessClient.ts` | 44 | « Contactez l’administration » | abonnement bloqué | oui | web | Distinguer admin école vs Somafrik facturation. |
| `web/src/pages/finances/FinanceUnpaidPage.tsx` | 44–48 | canal `email` « si configuré » | `TRANSACTIONAL` école→famille **non branché** | oui (UI) | web | **Ne jamais** envoyer ces relances depuis `contact@`. Canal dédié établissement / `notifications@` plus tard. |
| `web/src/pages/parametres/SettingsPlaceholders.tsx` | 9–16, 29–35 | ComingSoon SMTP / e-mail / SMS | placeholder | oui | web | Laisser placeholder. SMTP établissement ≠ SMTP plateforme. |
| `backend/lib/communicationsNotificationsService.js` | 29 | `SYSTEM_SENDER_NAME = "Somafrik"` | notif in-app | oui (nom, pas e-mail) | tous | Conserver. Ce n’est **pas** un From SMTP. |
| `backend/lib/platformAnnouncementsService.js` | 30 | `SYSTEM_SENDER_DISPLAY_NAME = "Somafrik"` | annonces système in-app | oui (nom) | tous | Idem. |
| `backend/scripts/verify-communications-c4.js` | 152 | garde : pas `smtp` / `sendgrid` | contrat COM-C4 | n/a | test | **Conserver.** L’e-mail sortant est un chantier **séparé**. |
| `backend/lib/superadminBootstrap.js` | 43 | `superadmin@somafrik.app` défaut | `FIXTURE` / bootstrap | non (compte interne) | preprod/dev | Ne pas afficher. Pas un contact public. |
| `.env.preproduction.example` | 56 | `BOOTSTRAP_SUPERADMIN_EMAIL=superadmin@somafrik.app` | bootstrap | non | preprod | OK interne. |
| `backend/data.js` / `Mobile/src/data/catalog.ts` | divers | `superadmin@`, `admin.rdc@`, `jean.kabeya@somafrik.cd`, `contact@unikin.somafrik`, `@somafrik.demo` | `FIXTURE` démo | UI démo seulement si seed | dev | Ne pas promouvoir en identité publique. |
| `origin/main:web/src/pages/LandingPage.tsx` | 392 | `support@somafrik.app` | `SUPPORT` affiché, **pas** `mailto:` | **oui** dans le tree `main` | `main` historique/stale | À la prochaine promo `develop → main` : remplacer par `contact@` (contact général). Décider si `support@` reste listing Play. Ne **pas** affirmer que ce tree est le déploiement Vercel live sans preuve Deployments. |
| `origin/main:BackOffice/index.html` | 193 | `support@somafrik.app` | legacy | oui si ce tree est encore servi | `main` | Hors `develop`. Ne pas réintroduire. |
| métadonnées Git `origin/develop` HEAD `78228be0` | n/a | `author.email = somafrik@outlook.fr` | `INTERNAL` comme identité Git publique | **oui** (`git log`, GitHub commit UI) | tous les clones publics | **P1 Git.** Stopper l’usage futur (noreply GitHub). **Ne pas** réécrire l’historique. |

### 3.2 Occurrences volontairement **non** inventoriées ligne à ligne

Centaines d’e-mails `*@somafrik.app` / `@test.cd` / `@example.com` dans `scripts/verify-e2e-*.js`, `backend/scripts/verify-*.js`, `docs/audits/evidence/*.json`. Ce sont des **identifiants de comptes de test**, pas des adresses de contact Somafrik.

Aucun `gmail.com`, `hotmail`, `yahoo`, `icloud`, `live.com` trouvé comme adresse de contact **dans les fichiers versionnés** du tree `develop`.

Aucun `mailto:` dans tout le dépôt `develop`.

### 3.3 Métadonnées Git (hors fichiers)

Preuve au HEAD `develop` :

```text
git log -1 --format='author=%an <%ae>%ncommitter=%cn <%ce>' origin/develop
# author=Somafrik <somafrik@outlook.fr>
# committer=GitHub <noreply@github.com>
# commit=78228be06286b464afd9e691fb227d16be95a63a
# subject=Merge pull request #446 …
```

Sur `origin/develop` (1504 commits) :

| Identité | Auteur (`%ae`) | Committer (`%ce`) |
|---|---|---|
| `somafrik@outlook.fr` | **690** | **392** |
| `cursoragent@cursor.com` | 699 | 697 |
| `noreply@github.com` | 0 | 378 (merges GitHub) |
| `206951365+cursor[bot]@users.noreply.github.com` | 78 | 0 |
| `baudouinbring@gmail.com` | 33 | 33 |

`main@b5074565` a le même schéma : `author=Somafrik <somafrik@outlook.fr>`, `committer=GitHub <noreply@github.com>`.

Ces occurrences **ne sont pas** dans le diff d’un fichier. `git grep somafrik@outlook.fr` ne les voit pas. Elles restent visibles via `git log`, l’UI GitHub (commit / merge) et tout clone public.

---

## 4. Web

### 4.1 Vitrine (`/`)

Fichiers : `web/src/pages/LandingPage.tsx`, `web/src/data/marketingContent.ts`, `web/src/components/marketing/*`.

- Navbar : Produit, Fonctionnalités, Web et mobile, Sécurité, CTA **Connexion** uniquement.
- Footer : tagline + copyright + ancres + « Se connecter ». **Pas d’e-mail.**
- Tests (`LandingPage.test.tsx`) :
  - hrefs autorisés = `/` ou `/connexion` uniquement → **un `mailto:` ferait échouer CI** aujourd’hui ;
  - `Nous contacter` interdit ;
  - `support@somafrik.app` interdit ;
  - `marketingLegalRoutes` doit rester de longueur 0.
- Responsive : header sticky + menu mobile testés ; **aucun** bloc contact à vérifier en 360/390 tant qu’il n’existe pas.
- SEO (`web/index.html` + `marketingSeo`) : title/description/OG/Twitter. **Pas** de `contactPoint`, pas d’e-mail.

**Écart P1 :** la vitrine `develop` n’a pas d’identité e-mail publique, et la CI **empêche** d’en ajouter sans changer les tests.

### 4.2 Connexion (`/connexion`)

`web/src/pages/LoginPage.tsx` : identifiant + mot de passe + modal premier changement. **Pas** de « mot de passe oublié », **pas** de lien contact Somafrik. C’est cohérent avec le modèle actuel (reset opérateur). **Ne pas** y coller `contact@` comme self-service reset.

### 4.3 Aide in-app

`HelpHost` dans `AppLayout` (session authentifiée). Interdit sur la vitrine. Le catalogue **interdit** « Nous contacter ». HELP-V1 : pas de ticket, pas d’Intercom, pas d’e-mail prérempli (`docs/audits/help-assistant-web-mobile.md` §15).

### 4.4 Abonnement / facturation

- `MonAbonnementPage.tsx:45` : « Contactez Somafrik » **sans** adresse ni `mailto:`.
- `CancellationRequestPage.tsx` : demande **in-app** (état local), pas d’e-mail.
- `subscriptionAccessClient.ts` : « Contactez l’administration » (école, pas Somafrik).

### 4.5 Paramètres établissement

`EstablishmentProfilePage.tsx` : champ **e-mail de l’école** (`school.email`) et e-mail du responsable. C’est un **SCHOOL_RECORD**, pas l’identité Somafrik. Risque : un opérateur pourrait saisir `contact@somafrik.app` comme e-mail d’école — d’où `GENERIC_EMAILS`. **Garder** ce filtre.

### 4.6 Impayés

Canal UI `email` / `sms` / `whatsapp` « si configuré ». Backend `unpaidService.sendReminder` écrit un journal + éventuellement une notif **app**. **Aucun SMTP.**

### 4.7 Intégrations

`/parametres/integrations` et `/parametres/notifications` = `ComingSoonState` (SMTP annoncé, non implémenté).

### 4.8 Erreurs

`ErrorState` : message générique, pas de contact. Auth lockout : administration **établissement**.

---

## 5. Mobile

| Écran | Fichier | E-mail Somafrik | Commentaire |
|---|---|---|---|
| À propos | **absent** | — | Pas d’écran About dédié. |
| Support | `MvpUtilityScreens.tsx` `SupportScreen` | non | Renvoie vers **l’administration de l’établissement**. Promet un journal P1. |
| Aide | catalogue partagé `packages/help-catalog` | non | Même interdiction « Nous contacter ». |
| Paramètres | profils métier | e-mails **école / users** | Pas d’identité plateforme. |
| Connexion | `LoginScreen.tsx` | clavier e-mail possible pour l’identifiant | Pas de mailto, pas de forgot-password. |
| Récupération de compte | absente | — | Aligné Web : reset opérateur. |
| Erreurs réseau / auth | messages établissement | — | Ne pas y coller `contact@`. |
| `app.json` / `app.config.js` | pas de `privacy` URL, pas d’e-mail support Expo | — | Listing Play : voir §5.1. |
| `Linking.openURL` | pièces jointes / PDF | pas de `mailto:` | |

Web et Mobile **ne présentent pas** aujourd’hui une identité e-mail Somafrik. Ils sont cohérents **par l’absence** sur `develop`. Ils **divergent** du tree `main` historique/stale (footer = `support@`).

### 5.1 Google Play

`docs/mobile/RELEASE-READINESS.md` :

- e-mail support déclaré = `support@somafrik.app` « landing web » → **faux sur `develop`**, vrai sur `main` stale ;
- privacy policy URL **absente** (P0 Store, déjà identifié, hors mandat e-mail mais **bloquant** pour afficher un contact Store) ;
- account deletion **absente**.

Décision à trancher **avant** soumission : listing Play = `support@somafrik.app` (recommandé) **ou** `contact@somafrik.app`. Ne pas inventer une troisième adresse.

---

## 6. Backend

Classification de chaque usage réel :

| Usage | Classe | Preuve | From / To / Reply-To |
|---|---|---|---|
| Doublons établissements `GENERIC_EMAILS` | `SCHOOL_GENERIC` | `backend/lib/schoolModule.js:17-22` | n/a |
| Login / lockout / compte inactif | message humain établissement | `userAccountRules.js`, `authService.js` | n/a — **pas d’e-mail** |
| Reset password | opérateur | `POST /api/users/:id/reset-password` | **pas d’e-mail** ; secret dans la réponse UI |
| Invitations / création user / enseignant | opérateur | `temporaryPassword` UI | **pas d’e-mail** |
| Notifications internes C4 | `TRANSACTIONAL` **in-app** | `communicationsNotificationsService.js` | From logique = `"Somafrik"` (nom), pas une adresse |
| Annonces plateforme | in-app | `SYSTEM_SENDER_DISPLAY_NAME` | idem |
| Relances impayés | journal + notif app si canal `notification` | `unpaidService.js:199-269` | canal `email` **n’envoie rien** |
| Messages / annonces établissement | messagerie interne PG | COM-C2/C3 | pas SMTP |
| Alertes techniques / ops | **absentes** | pas de mailer | — |
| Destinataire formulaire contact | **N/A** | pas d’endpoint | — |
| SMTP / API | **absent** | `backend/package.json` : cors, dotenv, express, mongoose, pg, puppeteer, qrcode | — |
| Rate limit | login + push self-test | `backend/lib/rateLimit.js` ; `server.js:105-111` | réutilisable plus tard pour un POST contact |
| Cloudflare | `pg-cloudflare` (driver `pg`) uniquement | `backend/package-lock.json` | **pas** Email Routing, **pas** Email Sending |
| Bootstrap superadmin | `INTERNAL` / `FIXTURE` | `superadmin@somafrik.app` | ne pas afficher |

**Aucune adresse personnelle** (`@gmail`, etc.) dans le backend de production.  
**Outlook :** absent du backend.  
**Le code ne suppose pas** que Cloudflare Email Routing permet l’expédition.

Garde-fou utile à **conserver** : `verify-communications-c4.js` refuse `smtp|sendgrid` dans le service C4.

---

## 7. Formulaires

### 7.1 Formulaire de contact Somafrik

**N’existe pas.** Pas de page `/contact`, pas de composant, pas d’API `POST /api/contact` / `/api/public/contact`, pas de captcha, pas de destinataire.

Ne pas l’implémenter dans cette phase (mandat).

### 7.2 Formulaires qui **ressemblent** à du contact (à ne pas confondre)

| Formulaire | Rôle | Chaîne | Destinataire |
|---|---|---|---|
| Vitrine | aucun | — | — |
| Préinscription publique | **contrat docs seulement** | `docs/domain/public-pre-enrollment.md` — « aucune route publique n’est exposée » | futur, pas Somafrik contact |
| Création école / profil établissement | e-mail **de l’école** | Web → API schools | fiche `schools.email` |
| Contacts / parents / enseignants / users | e-mails **personnes** | EntityPage, enrollment | fiches métier |
| Relance impayé | message libre + canal | Web → `unpaidService` | journal ; pas d’e-mail réel |
| Résiliation abonnement | motif in-app | `requestSubscriptionCancellation` | état abonnement |
| Aide | articles embarqués | pas de ticket | — |

### 7.3 Si un formulaire public est ouvert plus tard (PR D — conception seulement)

| Couche | Exigence |
|---|---|
| Frontend | validation e-mail, longueurs, pas d’HTML libre, honeypot, **aucun secret** |
| API | `POST` public isolé, **pas** les routes ERP |
| Backend | sanitization, pas de HTML dans le mail, logs sans PII superflue |
| Envoi | fournisseur **SMTP/API sortant** (à choisir). **To** = `contact@somafrik.app`. **From** = `noreply@` / `notifications@`. Cloudflare Routing **n’envoie pas**. Alternative plus sûre V1 : persister en base ops **sans** SMTP |
| Anti-spam | `createRateLimiter` + captcha/turnstile |
| Données perso | minimisation ; pas de journal brut du message en CI |

---

## 8. Transactionnel

**État : non implémenté.** C’est une **bonne nouvelle** pour ce mandat : on peut encore séparer les identités.

| Flux | Aujourd’hui | From interdit | From futur |
|---|---|---|---|
| Mot de passe oublié / reset | UI opérateur | `contact@` | `noreply@` ou `notifications@` **si** un e-mail est un jour envoyé |
| Invitation / première connexion | mot de passe temporaire à l’écran | `contact@` | idem |
| Notifs notes / absences / paiements | C4 in-app + push Android (Expo) | `contact@` | rester in-app / push ; e-mail = chantier séparé |
| Relances impayés familles | journal | `contact@` | e-mail **établissement** ou `notifications@`, jamais contact public |
| Annonces | in-app | — | — |
| Alertes ops / sécurité | néant | — | `security@` / canal privé, pas la vitrine |

`SYSTEM_SENDER_NAME = "Somafrik"` est un **libellé d’application**. Ce n’est pas une adresse RFC 5322. Ne pas le « corriger » en `contact@somafrik.app`.

PDF bulletins (`backend/templates/bulletin/report-card.html`) : pied `Document généré automatiquement par Somafrik.` — **pas d’e-mail**.

---

## 9. Configuration

| Fichier | Variables e-mail |
|---|---|
| `.env.example` | aucune `MAIL_` / `SMTP` / `EMAIL_` d’envoi |
| `.env.production.example` | idem |
| `.env.preproduction.example` | `BOOTSTRAP_SUPERADMIN_EMAIL` seulement |
| `web/.env.example` | `VITE_API_URL`, flags démo — **pas** d’e-mail public |
| `Mobile/.env.example` | API Expo — pas d’e-mail |
| `docker-compose*.yml` | pas de service mail (Mailhog, etc.) |
| `.github/workflows/*` | pas d’envoi d’e-mail CI |
| `Mobile/app.json` | pas de support URL / e-mail |

**Constante publique recommandée (non secrète) :**

```text
PUBLIC_CONTACT_EMAIL=contact@somafrik.app
```

À **ne pas** mettre dans `.env` secrets. À **ne pas** dupliquer dans 15 composants. Module partagé (voir §10 / architecture).

---

## 10. Sécurité

### 10.1 Secrets SMTP / API

| Contrôle | Résultat |
|---|---|
| Frontend | **aucun** token mail |
| Mobile | **aucun** |
| Git | **aucun** secret SMTP/API e-mail commité |
| Bundle | N/A (pas de client mail) |
| Docs publiques | pas de token Cloudflare |
| Gitleaks | `.gitleaks.toml` défaut + allowlist L1 ; rien d’e-mail |

### 10.2 Authentification e-mail du domaine

SPF, DKIM, DMARC, Reply-To, fournisseur d’envoi : **non documentés**. Normal tant qu’il n’y a pas d’envoi. **Obligatoire avant** tout FROM `@somafrik.app`.

### 10.3 Outlook dans un dépôt public — quatre surfaces

`docs/project/SECURITY.md:162` publie `somafrik@outlook.fr` comme contact de divulgation.

- Ce n’est **pas** un mot de passe.
- C’est la destination interne Cloudflare.
- Gravité mandat : **P1** (Outlook visible publiquement), pas P0 (pas de secret exploitable).

Pas de `SECURITY.md` à la racine GitHub (fichier standard de politique de vulnérabilité).

**Retirer Outlook de `SECURITY.md` ne permet PAS d’affirmer qu’Outlook devient « hors dépôt public ».** Voir §10.5.

### 10.4 Injection / HTML e-mail

Sans mailer, pas de surface d’injection MIME. Les champs `email` métier sont validés (longueur, format) pour des **fiches**, pas pour un transport SMTP.

### 10.5 Métadonnées Git / historique

Quatre couches **distinctes** :

| Couche | État actuel | Correction | L’historique déjà publié disparaît-il ? |
|---|---|---|---|
| **Produit / UI** | Outlook **absent** (Web, Mobile, PDF) | Ne jamais l’afficher (`mailto:`, footer, légal, Store) | n/a |
| **Fichiers versionnés** | Outlook dans `docs/project/SECURITY.md` seulement | PR F : remplacer par `security@somafrik.app` | Le blob ancien reste dans les commits qui ont porté ce fichier |
| **Métadonnées Git futures** | Le compte « Somafrik » pose `user.email` / `author.email` = `somafrik@outlook.fr` (y compris merges GitHub : auteur Outlook, committer `noreply@github.com`) | Configurer l’adresse **GitHub noreply officielle** du compte Somafrik comme `user.email` (Settings → Emails → *Keep my email addresses private* → `{id}+{login}@users.noreply.github.com`). Plus aucun commit / merge avec `author.email=somafrik@outlook.fr` | Non — seuls les **nouveaux** objets Git changent |
| **Historique Git déjà publié** | 690 auteurs + 392 committers `somafrik@outlook.fr` sur `develop` ; HEAD `78228be0` inclus | **Ne PAS** réécrire l’historique (`filter-repo` / `filter-branch` / BFG) par défaut | **Non.** Une réécriture casserait SHA, PR, tags, branches, audits et signatures. L’adresse n’est pas un secret. Accepter l’exposition historique ; arrêter l’exposition **future**. |

Mesure corrective **par défaut** (PR F, gouvernance) :

1. Compte GitHub Somafrik : e-mail de commit = noreply GitHub (`ID+login@users.noreply.github.com` ou équivalent affiché dans Settings → Emails).
2. `git config --global user.email` (et la config org / machine de merge) alignés sur ce noreply — **pas** sur Outlook, **pas** sur `contact@somafrik.app`.
3. Documenter la règle dans `docs/project/CONTRIBUTING.md` ou `SECURITY.md` : « identité Git ≠ destination Cloudflare ≠ contact public ».
4. Optionnel : scanner CI des **nouveaux** commits (`git log -1 --format=%ae` du HEAD de PR) pour échouer si `%ae` / `%ce` matche `outlook.fr` — sans réécrire le passé.
5. **Interdit comme correctif par défaut :** `git filter-repo`, force-push de `develop`/`main`, squash de tout l’historique.

Note connexe (pas le P1 CTO) : 33 commits portent `baudouinbring@gmail.com` comme auteur/committer. Même logique : stop futur si encore utilisé ; pas de rewrite. Ce n’est **pas** une adresse de contact plateforme dans les fichiers.

---

## 11. Cloudflare

| Sujet | Verdict |
|---|---|
| Email Routing `contact@` → Outlook | réception **connue**, hors code, **à conserver** comme destination technique |
| Email Routing = SMTP sortant ? | **non**. Le code ne le suppose pas. |
| Cloudflare Email Sending | **absent** du dépôt |
| Token Cloudflare | **absent** (ne jamais en commiter) |
| `pg-cloudflare` | driver PostgreSQL, hors sujet e-mail |
| Confusion future | un formulaire « envoyer à contact@ » **nécessite un From** chez un ESP. Routing livre ensuite à Outlook. Deux systèmes distincts. |

Schéma cible :

```text
Humain  --mailto / formulaire-->  contact@somafrik.app
                                      │
                                      │ Cloudflare Email Routing (réception)
                                      ▼
                               somafrik@outlook.fr   (jamais affiché)

App Somafrik  --ESP (Resend/SES/…)-->  From: noreply@ ou notifications@
                                       Reply-To: selon flux (souvent none / support@)
                                       To: user ou contact@
```

---

## 12. Tests à identifier (future PR, **ne pas écrire maintenant**)

| ID | Objet | Où |
|---|---|---|
| T-WEB-01 | Vitrine affiche `contact@somafrik.app` | `LandingPage.test.tsx` |
| T-WEB-02 | Lien `mailto:contact@somafrik.app` | footer + CTA |
| T-WEB-03 | **Absence** de `somafrik@outlook.fr` dans le DOM vitrine / login / légal | scanner UI |
| T-WEB-04 | **Absence** de `support@` comme contact **général** si décision = contact@ only | vitrine |
| T-WEB-05 | Pages légales listent `contact@` | nouvelles routes |
| T-WEB-06 | hrefs vitrine : `/`, `/connexion`, `mailto:`, routes légales — plus la restriction actuelle | inverser `LandingPage.test.tsx:117-122` |
| T-MOB-01 | Support établissement inchangé | `SupportScreen` |
| T-MOB-02 | Si canal Somafrik ajouté : `contact@` ou `support@` selon décision, jamais Outlook | Mobile |
| T-BE-01 | `GENERIC_EMAILS` contient toujours `contact@somafrik.app` | schoolModule tests |
| T-BE-02 | C4 ne gagne **pas** de SMTP | `verify-communications-c4.js` |
| T-BE-03 | Pas de From `contact@` dans un futur mailer | scanner / contrat |
| T-DOC-01 | `SECURITY.md` (et racine GitHub) sans Outlook | grep CI sur le **tree HEAD** |
| T-GIT-01 | HEAD de PR : `%ae` / `%ce` ≠ `*outlook.fr` | check CI optionnelle **forward-looking** |
| T-SCAN-01 | Scanner anti-adresse personnelle / Outlook dans `web/src`, `Mobile/src` (hors tests fixtures) | CI optionnelle |
| T-FORM-01 | Si formulaire : rate limit, validation, pas de secret client | PR D seulement |

`T-GIT-01` ne doit **pas** faire échouer le dépôt à cause des commits historiques. Il ne s’applique qu’au commit **introduit par la PR**.

Les tests **actuels** qui **bloquent** l’adoption :

- `web/src/pages/LandingPage.test.tsx` (`Nous contacter`, `support@`, hrefs, `marketingLegalRoutes`)
- `web/src/data/marketingContent.test.ts`
- `web/src/data/marketingDocument.test.ts`
- `packages/help-catalog/test/catalog.test.js` (`Nous contacter` dans l’aide — à **garder** si l’aide n’est pas le canal public)

---

## 13. Dette technique

1. **Duplication** `GENERIC_EMAILS` web ↔ backend.
2. **Collision sémantique** : `contact@somafrik.app` = denylist école **et** future identité publique.
3. **Garde-fous vitrine trop larges** : ils ont retiré `support@` (bien) mais interdisent aussi tout contact public.
4. **`main` historique/stale** affiche encore `support@` ; `develop` n’affiche rien — identité du tree `main` ≠ cible. Mapping Vercel live **non prouvé** dans cet audit.
5. **RELEASE-READINESS** décrit un landing qui n’existe plus sur `develop`.
6. **Pas de module d’identité publique** (centralisation absente).
7. **Pas de `SECURITY.md` GitHub** racine.
8. **Faux liens légaux** sur `main` (`#securite` pour Confidentialité / CGU).
9. **Canal `email` impayés** dans l’UI sans transport — dette produit qui invitera un branchement précipité.
10. **BackOffice legacy** (`main`) encore porteur de `support@`.
11. **Identité Git** du compte Somafrik = Outlook ; historique public irréversible sans rewrite (non recommandé).

---

## 14. Risques

| ID | Gravité | Risque | Scénario |
|---|---|---|---|
| EMAIL-P0 | — | **Aucun P0** constaté | Pas de secret SMTP, pas de mailer exploitable, pas d’adresse personnelle type Gmail dans le produit |
| EMAIL-P1-001 | P1 | Mauvaise / absente adresse publique sur `develop` | Prospect / école / chercheur sécurité n’a aucun canal vitrine |
| EMAIL-P1-002 | P1 | CI **interdit** l’identité publique | PR « ajouter contact@ » rouge sans lot tests |
| EMAIL-P1-003 | P1 | Outlook dans **fichiers** publics | `SECURITY.md` indexé ; destination interne devenue contact de divulgation |
| EMAIL-P1-003b | P1 | Outlook dans **métadonnées Git** publiques | HEAD `develop` `author.email=somafrik@outlook.fr` ; 690 auteurs / 392 committers. Une PR F fichiers-seule **ne ferme pas** cette surface |
| EMAIL-P1-004 | P1 | Tree `main` = `support@` ; cible = `contact@` | Double identité jusqu’à une promo `develop → main`. *Non établi* que `main` = site Vercel live |
| EMAIL-P1-005 | P1 | Doc Play = `support@` « sur la landing » alors que `develop` l’a retirée | Listing Store mensonger |
| EMAIL-P1-006 | P1 | Mélange futur contact / transactionnel | Première PR mailer utilise `contact@` en From reset / relances |
| EMAIL-P1-007 | P1 | « Contactez Somafrik » abonnement sans canal | CTA mort facturation |
| EMAIL-P2-001 | P2 | Duplication / pas de source canonique | 15 littéraux `contact@somafrik.app` divergents |
| EMAIL-P2-002 | P2 | Fixtures écoles = `contact@somafrik.app` | Confusion revue de code (« c’est déjà le contact public ») |
| EMAIL-P2-003 | P2 | SPF/DKIM/DMARC absents | Bloquant **avant** tout envoi, pas avant l’affichage mailto |
| EMAIL-P2-004 | P2 | Aide / catalogues interdisent « Nous contacter » | À coordonner, pas à casser à l’aveugle |
| EMAIL-P2-005 | P2 | Formulation « `main` = production Vercel » non sourcée | `docs/vercel.md` est une intention ; GitHub Deployments observés = Render preprod, pas Vercel `somafrik.app` |
| EMAIL-P2-006 | P2 | `baudouinbring@gmail.com` dans l’historique Git | 33 commits ; personnelle historique ; stop futur, pas de rewrite |
| EMAIL-P3-001 | P3 | Support Mobile sans mailto Somafrik | Acceptable V1 si footer web porte l’identité |
| EMAIL-P3-002 | P3 | Footer sans `mailto:` même quand l’adresse sera affichée | Accessibilité |

**Non-risque important :** Cloudflare Routing n’est **pas** pris pour un SMTP dans le code actuel.

---

## 15. Plan de correction

**Ne pas créer ces PR automatiquement.** Lots atomiques. Ordre privilégié CTO : **F → A → B**, puis C/G, puis D/E.

### PR F — Divulgation sécurité **et** gouvernance d’identité Git *(premier lot)*

Fichiers :

- `security@somafrik.app` (Routing vers la même boîte interne si besoin).
- Remplacer Outlook dans `docs/project/SECURITY.md`.
- Ajouter `SECURITY.md` racine GitHub pointant vers `security@`.
- Outlook **uniquement** dans un runbook ops **privé** (hors repo public) si encore nécessaire.

Identité Git **future** (obligatoire dans le même lot F, hors rewrite) :

- Compte GitHub Somafrik : commit email = **noreply GitHub officiel** (`{id}+{login}@users.noreply.github.com`, valeur exacte lue dans Settings → Emails).
- Plus de `user.email=somafrik@outlook.fr` sur les commits / merges produits par ce compte.
- Documenter : identité Git ≠ `contact@` ≠ destination Cloudflare Outlook.
- Check optionnelle forward-looking `T-GIT-01` (HEAD de PR seulement).
- **Ne pas** proposer `git filter-repo` / force-push d’historique comme correction.

### PR A — Canonicalisation identité e-mail publique *(après F)*

- Module partagé (ex. `packages/public-identity` **ou** un fichier unique consommé web + backend).
- Exporter au minimum :
  - `PUBLIC_CONTACT_EMAIL = "contact@somafrik.app"`
  - `PUBLIC_CONTACT_MAILTO`
  - `PLATFORM_GENERIC_SCHOOL_EMAILS` (inclut `contact@`, `info@`, `hello@`, `admin@`, et plus tard `support@`)
- `schoolModule` web/backend **importe** la denylist — plus de copie manuelle.
- **Aucun** affichage UI dans ce lot si les tests vitrine ne sont pas encore adaptés (ou A+B fusionnés si trop petit).
- **Interdit** : Outlook dans le module. **Interdit** : `FROM_EMAIL = contact@`.

### PR B — Web + documents légaux

- Footer / éventuellement CTA discret : `contact@somafrik.app` + `mailto:`.
- **Réécrire** les tests vitrine : autoriser `mailto:` et routes légales ; **exiger** `contact@` ; **interdire** Outlook ; interdire `support@` **comme contact général** si le CTO confirme.
- Pages légales **réelles** (mentions, confidentialité a minima) citant `contact@`. Ne pas recréer les faux `#securite` de `main`.
- JSON-LD `contactPoint` seulement si les pages existent.
- Responsive 360/390 : le mailto reste un lien texte, pas un FAB « Nous contacter » mort.

### PR C — Mobile + listing Store (docs)

- `SupportScreen` : garder le canal **établissement**.
- Ajouter un bloc distinct « Somafrik » avec l’adresse décidée (`support@` pour le Store **ou** `contact@` si un seul canal humain).
- Mettre à jour `RELEASE-READINESS.md` (plus de « présent landing » mensonger).
- Privacy URL reste un **P0 Store** séparé (PR légales B).

### PR D — Formulaire de contact sécurisé (**plus tard**)

- Seulement après A+B.
- Rate limit, anti-bot, pas de secret client.
- **To** `contact@` ; **From** transactionnel. Ou persist DB sans SMTP V1.
- Ne pas réutiliser les routes ERP.

### PR E — Infrastructure e-mail transactionnelle (**plus tard, chantier séparé**)

- Choisir ESP (Resend / SES / autres). **Pas** Cloudflare Email Routing.
- `MAIL_FROM=notifications@somafrik.app` ou `noreply@somafrik.app`.
- SPF/DKIM/DMARC documentés.
- **Contrat test :** From ≠ `contact@somafrik.app`.
- Reset password par e-mail = **décision produit explicite** ; aujourd’hui le modèle opérateur suffit.

### PR G — Facturation

- Remplacer le CTA mort « Contactez Somafrik » par `facturation@` **ou** `contact@` (si un seul canal humain au début).
- Ne pas mélanger avec relances **familles** (impayés élèves).

### Hors lots / non-objectifs

- Ne pas merger `develop → main` dans ces PR.
- Ne pas « tout remplacer » par `contact@`.
- Ne pas brancher C4 sur SMTP.
- Ne pas mettre de token Cloudflare dans Git.
- **Ne pas** réécrire l’historique Git pour masquer Outlook.

---

## 16. Verdict CTO

### Séparation des identités (décision à figer)

| Adresse | Rôle | Affichage public | Envoi (From) | Réception |
|---|---|---|---|---|
| `contact@somafrik.app` | **PUBLIC_CONTACT** canonique | **oui** (vitrine, légal, éventuellement Mobile) | **non** | Cloudflare → Outlook |
| `support@somafrik.app` | **SUPPORT** utilisateurs / Play | oui **si** canal support distinct ; non si un seul canal humain = contact@ | non | à router (même boîte ou autre) |
| `notifications@somafrik.app` | **TRANSACTIONAL** notifs | non | **oui** (futur ESP) | optionnel |
| `noreply@somafrik.app` | **TRANSACTIONAL** système / reset | non | **oui** (futur ESP) | bounce uniquement |
| `security@somafrik.app` | **SECURITY** | docs sécurité / GitHub Advisory | non | à router |
| `facturation@somafrik.app` | **BILLING** | écrans abonnement si canal dédié | non | à router |
| `somafrik@outlook.fr` | **INTERNAL** destination Cloudflare + **ancienne** identité Git | **jamais** (UI) ; historique Git déjà public | jamais | boîte technique actuelle |
| `superadmin@somafrik.app` | bootstrap | **jamais** | n/a | n/a |
| `info@` / `hello@` / `admin@` | denylist école | non | non | n/a |

**Règle d’or :** `contact@somafrik.app` = humains qui écrivent à Somafrik.  
Les machines qui écrivent aux humains utilisent `notifications@` / `noreply@`.  
Outlook n’existe pas dans le produit **ni** comme `user.email` Git futur.  
L’historique Git déjà publié conservant Outlook **n’est pas** « nettoyé » par une PR de fichiers.

### Conditions du GO

1. **PR F d’abord** : `SECURITY.md` + identité Git noreply **future**. Pas de rewrite.
2. Puis **PR A** (constante publique) puis **PR B** (vitrine + légal) avant toute communication marketing « écrivez à contact@ ».
3. Interdiction contractuelle (test) : jamais `contact@` en From.
4. Ne pas affirmer « Outlook hors dépôt public » après F fichiers-seule : dire « hors **tree HEAD** et hors UI ; historique Git inchangé ».
5. Formulaire (PR D) et ESP (PR E) **après** l’identité publique, pas avant.
6. Ne pas casser le modèle reset-opérateur en collant un faux « mot de passe oublié » mailto.
7. `GENERIC_EMAILS` **conserve** `contact@somafrik.app`.
8. Harmoniser `main` seulement via le processus de release existant — **pas** dans cet audit. Ne pas traiter `main` comme preuve de déploiement Vercel sans Deployments.

### Verdict

**GO SOUS CONDITIONS**

L’adresse cible est déjà réservée côté réception (Cloudflare) et déjà présente dans la denylist métier. Le produit `develop` n’a simplement **pas** d’identité publique. Le danger n’est pas l’absence d’ESP : c’est de combler le vide en faisant de `contact@somafrik.app` le From universel. Outlook reste destination Cloudflare et **historique Git** ; il ne doit plus être ni affiché, ni `user.email` des commits futurs.

**AUCUN READY. AUCUN MERGE.**
