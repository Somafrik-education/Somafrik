# SETTINGS-01 — Audit fonctionnel complet des Paramètres Somafrik

**Lot :** SETTINGS-01  
**Branche :** `audit/settings-01-functional`  
**Base `origin/develop` :** `9bec93f7e6fd518486ded690b646e9619157687d`  
**Date d’audit :** 2026-08-30  
**Working tree à la création de branche :** propre  

**Périmètre :** lecture du code réellement présent sur `develop`. Aucune nouvelle fonctionnalité métier, aucun changement de schéma, de RBAC ni d’activation `ComingSoon`. Les anomalies sont **documentées**, pas corrigées.

**Sources de vérité :** routes (`web/src/App.tsx`), hub (`web/src/pages/parametres/SettingsHubPage.tsx`), pages UI, `web/src/lib/permissions.ts`, APIs backend, schéma PostgreSQL, tests existants, `docs/user-guides/KNOWN-ISSUES.md`.

---

## 1. Executive summary

Le hub Paramètres déclare **14 cartes** dans `SETTING_CARDS`. Trois sont correctement marquées **Bientôt** (`ComingSoonState`) : Notifications, Apparence, Intégrations. Les autres portent le badge **Disponible**, ce qui ne signifie pas « configuration complète et mutable ».

**Ce qui est réellement opérationnel côté établissement (Admin School) :**

- **Profil** — identité, contacts, responsable légal ; code / ville / pays immuables.
- **Année scolaire** — création, dates, année courante, périodes (trimestre / semestre / personnalisées), barème, types d’évaluation. **Sans année scolaire, la création de classes est bloquée.**
- **Structure** — activation d’un sous-ensemble du référentiel national + cours établissement. Les **classes se créent dans Mon établissement**, pas ici.
- **Rôles et droits** — **lecture seule** du catalogue (vérité métier, pas un bug). La matrice CRUD se configure uniquement en Superadmin (`/administration/permissions`). L’attribution d’un rôle se fait dans **Comptes utilisateurs**.
- **Finances** — grilles tarifaires, types de frais, moyens de paiement, devise canonique. **Pénalités / réductions établissement non livrées.**
- **Données** — export CSV d’extrait affiché + export JSON versionné. **Restore indisponible.**
- **Mon abonnement** — lecture plan / factures / paiements. Les écrans « changer d’offre » et « résiliation » existent mais **n’écrivent pas** (clés plateforme stripées du PUT client).
- **Sécurité** — session + bullets statiques mot de passe/PIN + journal d’audit client. **Aucune politique mutable.**

**Plateforme uniquement :** politique d’abonnement par pays (Superadmin + Admin Pays, ce dernier peut modifier si `Abonnements:UPDATE`), graphiques dashboard (Superadmin). La carte **Documents** ouvre l’éditeur bulletin GrapesJS **Superadmin**, mais elle est **absente des hubs Superadmin et école** (filtre de chemins / `bulletinDesign`). Recus, attestations et en-têtes promis par la carte **n’existent pas** dans cette UI.

**HELP :** documenter lecture + navigation + écriture seulement là où le code mute vraiment (Profil, Année, Structure/cours, Finances grilles, Utilisateurs/Affectations, Planning cœur). Interdit : Notifications / Apparence / Intégrations comme disponibles ; pénalités ; restore ; modification de la matrice par l’établissement ; écriture Notes enseignant (P1 toujours documenté) ; changer d’offre / résiliation comme parcours abouti.

**Notes enseignant P1 :** **toujours présent** dans `KNOWN-ISSUES.md` §18. `write_notes` gate toujours `POST /api/evaluations` et `POST /api/notes`. Les defaults Enseignant incluent désormais `Affectations:READ` / `Notes:CREATE|UPDATE`, et le Préfet a `Notes:CREATE|UPDATE` — **ne pas retirer la réserve sans scénario runtime**.

---

## 2. Matrice des cartes

Hub : 14 cartes. Filtrage :

- Superadmin : uniquement `/abonnements`, `/graphiques`, `/securite`, `/donnees`.
- Admin Pays : `/abonnements`, `/donnees`.
- École : `canReadView(card.view)` — `configuration` = Admin School (pas Préfet/Direction même avec `Paramètres Établissement:READ`).

| Carte | Route | Rôles autorisés | READ | CREATE | UPDATE | DELETE | Mutation réelle ? | API | PG ? | Web | Mobile | Plateforme | Établissement | État produit | Prérequis | Dépendances | Limites | KNOWN-ISSUES | Documentable HELP ? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mon abonnement | `/parametres/mon-abonnement` | Admin School | `mySubscription` | — | UI, persist. stripée | — | Non (writes) | `DataContext.update` strip plateforme | Offre en PG | Oui | Non | Non | Oui | ACTUEL_PARTIEL | Offre SaaS | Politique pays | Changer offre / résiliation non persistés | P1 writes | Lecture / nav | GO_HELP_READ, GO_HELP_NAVIGATION, HOLD_HELP (write) |
| Profil établissement | `/parametres/profil` | Admin School, Superadmin ciblé | Paramètres Établissement | — | UPDATE + Admin School | — | Oui | `establishmentsApi.update` | Oui | Oui | Oui | Non | Oui | ACTUEL_COMPLET | Établissement actif | — | Code/ville/pays immuables ; logo = URL | — | Oui write | GO_HELP_READ, GO_HELP_WRITE, GO_HELP_NAVIGATION |
| Année scolaire | `/parametres/annee-scolaire` | Admin School | Années Académiques:READ | CREATE | UPDATE | Pas d’UI | Oui | `/api/v2/academic-years`, school-settings | Oui | Oui | Oui | Non | Oui | ACTUEL_COMPLET | Établissement | Classes, notes, bulletins, planning | Pas de suppression/clôture UI | — | Oui write | GO_HELP_READ, GO_HELP_WRITE, GO_HELP_NAVIGATION |
| Structure pédagogique | `/parametres/structure` | Admin School | Paramètres / Matières READ | Cours école ; niveaux = plateforme | Activation + cours | Archivage cours | Oui (activation/cours) | référentiel + subjects | Oui | Oui | Oui | Catalogue national | Activation | ACTUEL_PARTIEL | Référentiel pays | Classes hors carte | Pas de création libre de niveau national | TYPE A classes | Write activation/cours | GO_HELP_READ, GO_HELP_WRITE, GO_HELP_NAVIGATION |
| Rôles et droits | `/parametres/roles-droits` | Admin School | Catalogue assignable | Superadmin only | Superadmin only | Superadmin only | Non (école) | `establishmentRolesApi.listAssignable` | Oui | Oui | Oui (RO) | Configuration | Lecture | LECTURE_SEULE | Catalogue Superadmin | Comptes utilisateurs ASSIGN | Matrice globale non éditable école | **Pas une anomalie** | Read / nav ; WRITE interdit | GO_HELP_READ, GO_HELP_NAVIGATION |
| Documents | `/parametres/documents` | Superadmin | `bulletinDesign` | Templates bulletin | Templates | API templates | Oui (bulletin) | `reportCardTemplatesApi` | Oui | Oui | Non | Oui | Non (carte invisible hub école) | PLATEFORME_UNIQUEMENT | Superadmin | Notes/bulletins | Recus/attestations/en-têtes absents ; carte absente hub Superadmin | TYPE A + C | HOLD / PLATFORM | PLATFORM_ONLY, HOLD_HELP |
| Sécurité | `/parametres/securite` | Admin School, Superadmin, Admin Pays | configuration / hub | — | — | — | Non | auditLog client + CSV | Non (politique) | Oui | Non | Session plateforme | Session école | LECTURE_SEULE | — | — | Politique non configurable | TYPE B | Read / nav | GO_HELP_READ, GO_HELP_NAVIGATION |
| Données et sauvegarde | `/parametres/donnees` | Admin School, Superadmin, Admin Pays | configuration / hub | — | — | — | Non (export only) | `GET /api/data-export` | Lecture | Oui | Non | Export scoped | Export école | ACTUEL_PARTIEL | — | — | Restore = non | Hub déjà honnête | Export only | GO_HELP_READ, GO_HELP_NAVIGATION |
| Finances | `/parametres/finances` | Admin School (+ Comptable si Frais) | Frais & tarifs:READ | CREATE | UPDATE | Désactivation | Oui (grilles/moyens) | `/api/finance/*` | Oui | Oui | Encaissement ailleurs | Non | Configuration | ACTUEL_PARTIEL | Devise canonique | Paiements runtime | Pénalités non opérationnelles | TYPE A hub | Write grilles **sans** pénalités | GO_HELP_READ, GO_HELP_WRITE, GO_HELP_NAVIGATION |
| Notifications | `/parametres/notifications` | Admin School (carte) | ComingSoon | — | — | — | Non | — | Non | Non | Non | — | Placeholder | BIENTOT | — | Réception ≠ config | ComingSoonState | TYPE D | Non | FUTURE |
| Apparence | `/parametres/apparence` | Admin School (carte) | ComingSoon | — | — | — | Non | — | Non | Non | Non | — | Placeholder | BIENTOT | — | Logo = Profil | ComingSoonState | TYPE D | Non | FUTURE |
| Intégrations | `/parametres/integrations` | Admin School (carte) | ComingSoon | — | — | — | Non | — | Non | Non | Non | — | Placeholder | BIENTOT | — | — | ComingSoonState | TYPE D | Non | FUTURE |
| Politique d’abonnement par pays | `/parametres/abonnements` | Superadmin, Admin Pays | Abonnements:READ | Pays ailleurs | Abonnements:UPDATE | — | Oui | `platformApi.updateCountry` | Oui | Oui | Non | Oui | Non | PLATEFORME_UNIQUEMENT | Pays créés | Mon abonnement | Admin Pays : UI `canUpdate` | — | PLATFORM_ONLY | PLATFORM_ONLY |
| Graphiques du tableau de bord | `/parametres/graphiques` | Superadmin | chartSettings | — | Superadmin | — | Oui | `dashboardChartConfig` | Oui | Oui | Non | Oui | Non | PLATEFORME_UNIQUEMENT | Superadmin | Dashboards | — | — | PLATFORM_ONLY | PLATFORM_ONLY |

Machine-readable : `docs/audits/settings-functional-matrix.json`.

---

## 3. Parcours configuration établissement recommandé

Le code confirme l’ordre du mandat (année avant classes ; structure/cours avant affectations/planning/notes) :

```text
Profil
→ Année scolaire
→ Structure (activation nationale + cours)
→ Cours (même page Structure / SchoolSubjectsPanel)
→ Classes          ← Mon établissement → Classes  (pas Paramètres)
→ Utilisateurs     ← Mon établissement → Comptes utilisateurs
→ Enseignants      ← projection ; identité créée via Utilisateurs
→ Affectations
→ Finances         ← grilles, pas encaissement
→ Planning
→ Notes
```

**Une école peut-elle fonctionner sans année scolaire configurée ?** **Non** pour le parcours nominal.

- `ClassesListPage` : bannière « Aucune année scolaire n'est configurée » + lien `/parametres/annee-scolaire` ; **pas** de bouton « Créer cette année » sur Classes (contrairement à un audit historique `ACADEMIC-YEAR-CANONICAL-INTEGRITY.md`, **obsolète** : `ConfigurationPage` appelle bien `POST /api/v2/academic-years`).
- `classes.academic_year_id` est **NOT NULL**.
- Périodes (`terms`), évaluations, notes, bulletins, affectations enseignants dépendent d’une année / d’un terme.
- Empty state Paramètres : « Créez-la ici avant les classes, les périodes, les notes et les bulletins. »

Fonctions bloquées ou dégradées sans année : création de classes, périodes, notes/évaluations liées au terme, bulletins, affectations année, grilles finance « année » (libellé, pas toujours FK).

---

## 4. Matrice RBAC

Comparaison **defaults** `internalRoleDefaults.ts` + `canReadView` / `canManageEstablishmentSettings` + `rbacService.js`. Les jetons effectifs en production peuvent différer du catalogue Superadmin.

Légende : READ / CREATE / UPDATE / DELETE / ASSIGN / NO_ACCESS / PLATFORM_ONLY.

| Fonction | Superadmin | Admin Pays | Admin établissement | Direction (Proviseur/Directeur) | Préfet | Secrétaire | Comptable | Surveillant | Enseignant | Parent | Élève |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hub Paramètres | 4 cartes plateforme | 2 cartes | Oui (`settings`) | NO_ACCESS hub | NO_ACCESS hub | NO_ACCESS | NO_ACCESS | NO_ACCESS (legacy BO seulement) | NO_ACCESS | NO_ACCESS | NO_ACCESS |
| Année scolaire | PLATFORM / ciblage école | NO_ACCESS `configuration` | CREATE/UPDATE si jetons Années | NO_ACCESS page Paramètres | READ Paramètres Établissement **sans** opérateur Web/Mobile | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS |
| Structure | Référentiel national CRUD | Référentiel pays (`educationReference`) | Activation + cours | NO_ACCESS Paramètres | NO_ACCESS Paramètres | NO_ACCESS | NO_ACCESS | NO_ACCESS | Matières:READ | NO_ACCESS | NO_ACCESS |
| Rôles et droits | CONFIGURATION `/administration/permissions` | NO_ACCESS matrice | LECTURE_SEULE catalogue | NO_ACCESS page | NO_ACCESS page | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS |
| Utilisateurs | PLATFORM_ONLY tenants | CREATE Admin Pays / école | CRUD + ASSIGN | READ (Directeur) | READ | READ | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS |
| Finances (grilles) | PLATFORM | Catalogue READ via COUNTRY_PRIVILEGES | Frais CRUD | NO_ACCESS Frais (Directeur defaults) | NO_ACCESS Frais | NO_ACCESS Frais | READ/CREATE/UPDATE Frais | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS |
| Planning | Selon ciblage | NO_ACCESS school | CRUD Planning | READ (Directeur) ; Proviseur READ | CRUD (defaults) | NO_ACCESS | NO_ACCESS | NO_ACCESS | READ | NO_ACCESS | NO_ACCESS |
| Notes | ciblage | NO_ACCESS | READ (pas CREATE notes defaults Admin School) | READ ; validate si rôle directeur/proviseur | READ/CREATE/UPDATE + validate | NO_ACCESS Notes | NO_ACCESS | NO_ACCESS | READ/CREATE/UPDATE **saisie** ; **pas** validate/publish | READ enfant | READ soi |
| Notifications (Paramètres) | — | — | FUTURE ComingSoon | — | — | — | — | — | Réception ≠ config | Réception | Réception |
| Documents (carte Paramètres) | Éditeur bulletin | NO_ACCESS | NO_ACCESS hub | Bulletins:READ runtime | Bulletins CRUD runtime | Documents runtime | Documents:READ | — | Documents:READ | Bulletins:READ | Bulletins:READ |
| Sauvegarde / export | Hub oui | Hub oui | Export oui | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS | NO_ACCESS |

**Règle officielle confirmée par le code :**

```text
Rôles et droits :
Établissement = LECTURE_SEULE
Superadmin = CONFIGURATION
```

Mobile `isSchoolSettingsOperator` : Superadmin ou Admin School uniquement — un Préfet avec `Paramètres Établissement:READ` **n’est pas** opérateur Paramètres.

**Surveillant :** présent dans `backend/data.js` (legacy « Gérer appels ») ; **absent** de `INTERNAL_ROLE_DEFAULT_PERMISSIONS`. Ne pas documenter un hub Paramètres Surveillant.

---

## 5. Web / Mobile

| Domaine | Web | Mobile | Parité | Commentaire |
|---|---|---|---|---|
| Hub Paramètres | Oui | Partiel (5 cartes école) | Non | Mobile : Profil, Année, Structure, Rôles RO, Utilisateurs. Pas Finances/Sécurité/Données/Abonnement/ComingSoon |
| Profil | Oui | Oui | Oui | Même API établissements |
| Année scolaire | Oui | Oui | Oui | `SchoolYearSettingsScreen` |
| Structure | Oui | Oui | Oui | Activation + cours |
| Rôles | Oui RO | Oui RO | Oui | Volontaire |
| Documents Paramètres | Superadmin | Non | Non | Volontaire plateforme |
| Sécurité | Oui RO | Non | Non | |
| Données / export | Oui | Non | Non | |
| Finances config | Oui | Non (ops paiements ailleurs) | Non | Volontaire |
| Notifications config | ComingSoon | Non | Oui (absent des deux) | |
| Apparence | ComingSoon | Non | Oui | |
| Intégrations | ComingSoon | Non | Oui | |
| Politique pays | Oui | Non | Non | Plateforme |
| Graphiques | Oui | Non | Non | Superadmin |
| Utilisateurs | Oui | Oui | Partiel | |
| Créer enseignant | Pas de bouton liste | Bouton dédié | **Non, volontaire** | KNOWN-ISSUES §4 |
| Affectations | Oui | Oui | Partiel | |
| Planning | Cœur hebdo | Partiel | Non | Vue salle ComingSoon Web |
| Notes | Oui | Oui | Partiel | P1 écriture enseignant |

L’absence de parité **n’est pas un bug** quand le produit scinde volontairement Web (admin) / Mobile (ops) ou Superadmin / école.

---

## 6. Fonctions futures

Ne pas présenter comme disponibles :

- Configuration Notifications établissement (push, e-mail, SMS, WhatsApp, modèles, déclencheurs note/absence/impayé).
- Apparence (couleur, thème, nom affiché dédié) — le **logo URL** existe déjà au Profil.
- Intégrations établissement : Orange Money, MTN, Airtel, SMS, WhatsApp API, SMTP, stockage cloud, NFC, webhooks.
- Pénalités de retard et barème de réductions **établissement**.
- Restore / import / rollback / backup automatisé.
- Recus, attestations, en-têtes dans la carte Documents.
- Configuration mutable de la politique mot de passe, PIN, session, MFA, lockout.
- Changement d’offre et résiliation **persistés**.
- Emploi du temps **par salle** (`PlanningPlaceholders`).
- Création libre de niveau/filière nationale depuis l’établissement.

Réception de messages / annonces / push **existe ailleurs** : ce n’est pas la carte Paramètres Notifications.

---

## 7. P0 / P1 / P2

Aucune correction métier dans cette PR.

### P0

Aucun bloqueur P0 **spécifique Paramètres** identifié qui empêcherait l’usage nominal Admin School (profil, année, structure, finances grilles, export).

### P1

| Id | Fichier | Route | Rôle | Attendu | Observé | Impact | Correction recommandée | Lot |
|---|---|---|---|---|---|---|---|---|
| N1 | `KNOWN-ISSUES.md` §18, `rbacService.js`, `schoolSubscriptionAccessService.js` | Notes / évaluations | Enseignant | Voir cours/périodes, créer évaluation, saisir | P1 documenté : `GET /api/assignments` historiquement Affectations/Enseignants READ ; `POST /evaluations` `write_notes` ; M19 = QA. Defaults Enseignant ont maintenant `Affectations:READ` — **non certifié runtime** | Parcours notes enseignant non HELP-write | Scénario runtime puis éventuellement fix RBAC/abonnement | NOTES / HELP |
| N2 | `ChangeOfferPage.tsx`, `CancellationRequestPage.tsx`, `stripClientPlatform.ts` | `/parametres/mon-abonnement/changer-offre`, `/resiliation` | Admin School | Demande persistée | `update()` strip `subscriptions` / `subscriptionOffers` | Fausse promesse « Disponible » | API dédiée ou retirer les écrans write | ABONNEMENT |
| N3 | `KNOWN-ISSUES.md` §19 | Parent | Parent | Enfant lié | Seed / liaison non certifiée | Hors Paramètres ; HOLD HELP parent-enfant | Lot parent | PARENT |
| N4 | `KNOWN-ISSUES.md` §11 | Boot démo | QA | Seed reproductible | P1 seed | Hors Paramètres | Lot data | DATA |

### P2

| Id | Fichier | Écart | Impact HELP |
|---|---|---|---|
| L1 | `SettingsHubPage.tsx` Documents | Promesse bulletins+reçus+attestations+en-têtes ; livré = bulletin Superadmin ; carte invisible sur les hubs filtrés | TYPE A + C — ne pas documenter pour l’école |
| L2 | Hub Finances | Mention « pénalités » alors que page : différées V1 | TYPE A — corriger libellé (lot copy, pas SETTINGS-01) |
| L3 | Hub Sécurité | Badge Disponible + « politique » alors que lecture seule | TYPE B |
| L4 | Hub Rôles | « Pilotage des habilitations » alors que lecture seule école | TYPE B attendu métier — ajuster copy, pas le comportement |
| L5 | Hub Structure | « … et classes » alors que création = Mon établissement | TYPE A navigation |
| L6 | Documents hors `SUPERADMIN_SETTING_PATHS` | Superadmin n’a pas la carte Documents dans son hub | Accès URL directe `/parametres/documents` seulement |
| L7 | Audit ACADEMIC-YEAR-CANONICAL-INTEGRITY.md | Décrit une UI Classes « Créer année » **plus vraie** | Ne pas réutiliser cet audit comme vérité |

**Proposition de libellés (non appliquée) :**

- Documents : « Modèles de bulletins (Superadmin) » ou retirer du hub école.
- Finances : retirer « et pénalités ».
- Sécurité : « Consultation session, politique affichée et journal (lecture seule) ».
- Rôles : « Catalogue des rôles affectables (lecture seule) ».
- Structure : « Niveaux/filières activés et cours. Classes : Mon établissement. »

---

## 8. Écarts de libellé

| Type | Carte | Titre / badge | Réalité |
|---|---|---|---|
| A | Documents | Recus, attestations, en-têtes, QR | Bulletin GrapesJS + QR Superadmin |
| A | Finances | Pénalités | Alerte différées V1 |
| A | Structure | Classes dans la description | Projection RO ; création ailleurs |
| B | Sécurité | Disponible / configurer | LECTURE_SEULE |
| B | Rôles | Disponible / « Configurer → » / pilotage | LECTURE_SEULE école (**attendu**) |
| B | Mon abonnement | Changement d’offre et résiliation | UI sans persistance |
| C | Documents | Carte établissement | Superadmin only + absente hub Superadmin |
| D | Notifications, Apparence, Intégrations | Bientôt | ComingSoonState — **correct** |
| E | Profil, Année, Politique pays, Graphiques, Données (export honnête) | Alignés | OK |

Toutes les cartes « Bientôt » du hub utilisent `ComingSoonState` dans `SettingsPlaceholders.tsx`. Aucune n’a été activée.

---

## 9. Parcours documentables HELP

| Parcours | Niveau HELP |
|---|---|
| Ouvrir Paramètres (Admin School) | GO_HELP_NAVIGATION |
| Profil : lire / modifier champs mutables ; expliquer immuables | GO_HELP_READ, GO_HELP_WRITE |
| Année : créer, dates, courante, périodes, barème, types d’évaluation | GO_HELP_READ, GO_HELP_WRITE |
| Structure : activer catalogue national ; gérer cours ; **ne pas** créer un niveau national | GO_HELP_READ, GO_HELP_WRITE |
| Classes depuis Mon établissement, après année | GO_HELP_NAVIGATION |
| Rôles : consulter catalogue | GO_HELP_READ, GO_HELP_NAVIGATION |
| Utilisateurs : Nouvel utilisateur, MDP temporaire, Attribuer (≠ matrice) | GO_HELP_READ, GO_HELP_WRITE, GO_HELP_NAVIGATION |
| Enseignant Web : Utilisateurs → rôle Enseignant → Enseignants → Affecter un cours | GO_HELP_NAVIGATION (deux procédures Web/Mobile, §4) |
| Affectations | GO_HELP_WRITE |
| Finances : grilles, moyens, devise **sans** pénalités | GO_HELP_READ, GO_HELP_WRITE |
| Données : export CSV/JSON, **pas** restore | GO_HELP_READ |
| Mon abonnement : consulter plan/factures | GO_HELP_READ |
| Planning cœur hebdo (permissions, prérequis année/classe/cours/enseignant) | GO_HELP_READ, GO_HELP_WRITE (cœur) ; pas vue salle |
| Notes : consultation | GO_HELP_READ |

---

## 10. Parcours interdits HELP

| Sujet | Raison |
|---|---|
| Notifications / Apparence / Intégrations comme disponibles | FUTURE / BIENTOT |
| Modifier la matrice RBAC depuis l’établissement | WRITE interdit |
| Recus / attestations / en-têtes Paramètres Documents | Non livré |
| Configurer longueur MDP, MFA, lockout, durée session | LECTURE_SEULE / inexistant |
| Restore, import, rollback, backup complet | Indisponible |
| Pénalités / barème réductions établissement | Différé |
| Mobile Money / SMS / WhatsApp / SMTP **par établissement** | Placeholder |
| Changer d’offre / résilier comme parcours abouti | Writes stripées |
| Notes enseignant : créer évaluation / saisir comme procédure garantie | **P1 présent** |
| Parent-enfant write | KNOWN-ISSUES §19 |
| « Créer un enseignant » bouton Web | N’existe pas (`primaryActions={null}`) |
| Planning par salle | ComingSoon |
| Préfet opérateur Paramètres Web/Mobile | Exclu par `canReadView("configuration")` / `isSchoolSettingsOperator` |
| Graphiques / politique pays / éditeur bulletin comme config école | PLATFORM_ONLY |

---

## Détail par carte (preuves code)

### 6. Profil établissement

| Champ | Lecture | Modifiable | Rôle write | API | Persisté |
|---|---|---|---|---|---|
| Nom | Oui | Oui | Admin School `canManageEstablishmentSettings` | `establishmentsApi.update` | Oui |
| Type | Oui | Oui | idem | idem | Oui |
| Code | Oui | **Non** (readOnly, hint unique) | — | Backend Superadmin-only pour code/pays | Oui (immuable école) |
| Pays | Oui | **Non** UI | Superadmin ailleurs | — | Oui |
| Ville | Oui | **Non** UI | — | — | Affiché |
| Adresse | Oui | Oui | Admin School | patch | Oui |
| Téléphone | Oui | Oui | Admin School | patch | Oui |
| E-mail | Oui | Oui | Admin School | patch | Oui |
| Logo | Oui (URL + aperçu) | Oui (URL, pas upload) | Admin School | `logoUrl` | Oui |
| Responsable légal | Oui | Oui | Admin School | `principalName` | Oui |
| Téléphone responsable | Oui | Oui | Admin School | `principalPhone` | Oui |
| E-mail responsable | Oui | Oui (défaut = e-mail établissement) | Admin School | `principalEmail` | Oui |

### 7. Année scolaire

PostgreSQL `academic_years` : `UNIQUE (school_id, name)` ; `is_current` ; `terms` UNIQUE `(academic_year_id, name)`.

Workflow UI `ConfigurationPage` section `annee-scolaire` : créer (nom, début, fin, courante) → liste → « Définir comme courante » (`PATCH`) → périodes trimestre/semestre/personnalisées (période active **selon la date du jour**) → barème → types d’évaluation (`EvaluationTypesPanel`). Mode bulletin (période/annuel/personnalisé) : UI Superadmin `canDesignBulletins` seulement.

### 8. Structure pédagogique

- **Référentiel national :** `EducationReferencePage` `/referentiels-pedagogiques` — Superadmin / Admin Pays (`Référentiels pédagogiques`). Niveaux, filières/séries, groupes.
- **Activation école :** `SchoolEducationActivationPanel` — « création libre n’est plus autorisée ».
- **Classes :** point d’entrée `Mon établissement → Classes` ; Paramètres = projection RO.
- **Cours :** `SchoolSubjectsPanel` — création, code, coefficient, lien classes ; enseignants via Affectations ; planning / évaluations consomment le cours canonique.

### 9. Finances — séparation

| Couche | État |
|---|---|
| Configuration établissement | Grilles (classe, année libellé, type, montant, échéance), moyens, activation/désactivation, devise lecture |
| Encaissement | Module Paiements, **pas** cette carte |
| Intégration opérateur | Carte Intégrations = BIENTOT |

### 10–12. Notifications / Apparence / Intégrations

`ComingSoonState` exclusif. Verdict **BIENTOT** / **FUTURE**.

Intégrations annoncées (Orange, MTN, Airtel, SMS, WhatsApp, SMTP, cloud, NFC, webhooks) : **pas d’UI de configuration établissement, pas production-ready via cette carte**. Ne pas confondre avec un secret serveur ou un paiement runtime ailleurs.

### 13. Documents

**La carte ne correspond pas à la promesse affichée.** Livré : éditeur bulletin Superadmin (GrapesJS, templates, PDF, QR). Futur dans cette carte : reçus, attestations, en-têtes établissement, modèles par classe côté école.

### 14. Sécurité

Consultation : session (utilisateur, rôle, canal, école, portée), bullets MDP (≥8, lettre, chiffre, changement 1re connexion), PIN 6 chiffres mobile, journal d’audit filtrable + CSV. **Pas de configuration** longueur, complexité, session, PIN, lockout, MFA, historique. État : **LECTURE_SEULE**.

### 15. Données et sauvegarde

```text
Export disponible ?          Oui (CSV extrait + JSON versionné GET /api/data-export)
Backup complet disponible ?  Non
Restore disponible ?         Non
```

Domaines CSV UI : élèves, enseignants, classes, cours, affectations, paiements, notes, présences, bulletins, documents. JSON : domaines canoniques PG, **pas** hash/jeton/mot de passe. Ne pas assimiler JSON à un backup/restore.

### 16. Mon abonnement vs 17. Politique pays

Établissement : lecture offre. Plateforme : barème Essentiel / Standard / Premium, mensuel / annuel, devise par pays. Admin Pays : `Abonnements` CRUD dans `backend/data.js` ; UI `useFeaturePermissions("Abonnements").canUpdate`.

### 18. Graphiques

Superadmin uniquement (`canManageRolePermissions`). Persistance `dashboardChartConfig`. Impact : `OverviewPage` / `applyChartTypeOverrides`.

---

## Parcours connexes (A–E)

**A. Utilisateur** — `/etablissement/comptes-utilisateurs` → Nouvel utilisateur. `Utilisateurs:CREATE`. Prénom, nom, téléphone, e-mail, identifiant serveur, MDP temporaire. École : **aucun rôle à la création**, puis **Attribuer**. Compte sans rôle possible. Suspension / reset password (`canResetUserPassword`). **Création utilisateur ≠ modification RBAC.**

**B. Enseignant Web** — pas de « Créer un enseignant » sur `TeachersListPage`. Chaîne : Comptes → identité → rôle Enseignant → Enseignants → Affecter un cours. Mobile a un bouton dédié.

**C. Affectation** — classe, cours, `POST /api/assignments`, `Affectations:CREATE`, PG `teacher_assignments`. Enseignant defaults : `Affectations:READ` (pas CREATE). Consommé par planning et notes.

**D. Planning** — **ACTUEL_PARTIEL**. Chaîne : année → structure → cours → classe → enseignant → affectation → planning → planifier. Web : calendrier hebdo, jour/horaires, salle, occurrence, drag/resize, substitutions, conflits **lecture**. Vue « par salle » = ComingSoon. Mobile : pas de parité complète.

**E. Notes**

- Consultation : `Notes:READ`.
- Création évaluation : `Notes:CREATE` + `write_notes` abonnement (`full`/`limited`).
- Saisie : CREATE/UPDATE.
- Validation / publication : `canValidateGrades` / `canPublishGrades` — préfet, proviseur, directeur, admin (pas enseignant pur).
- Correction : mêmes rôles validate.

**P1 Notes enseignant : toujours présent** (doc + `write_notes`). Ne pas retirer la réserve sans runtime.

---

## Base SHA (discipline §2)

```text
Base SHA develop : 9bec93f7e6fd518486ded690b646e9619157687d
Date             : 2026-08-30
Working tree     : clean at branch creation
```

Merge `develop` à cette SHA : HELP-V1B (`#398`).
