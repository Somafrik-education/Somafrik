# Architecture de navigation Somafrik — D1.2

**Statut :** normatif (sous réserve validation CTO)  
**Phase :** D1.2  
**Nature :** spécification uniquement — aucune implémentation dans cette étape  
**Références :** [Vision](./vision-produit.md) · [Principes](./principes-ux.md) · [Glossaire](./glossaire.md) · [Décisions](./decisions-officielles.md) · [Inventaire D1.1](./inventaire-ui.md)

Cette spécification définit l’**architecture officielle de navigation** de Somafrik.  
Elle doit rester valide plusieurs années et s’appliquer à tous les modules (Éducation, Finance, RH, Bibliothèque, Communication, Administration, modules futurs).

**Aucune modification runtime n’est autorisée tant que le CTO n’a pas validé ce document.**

---

## 0. Constat de l’existant (audit code)

Analyse réalisée sur le frontend `web/` (branche `develop`, React Router 6).

### Shell actuel

| Zone | Fichiers | Comportement observé |
|------|----------|----------------------|
| Application | `AppLayout.tsx` | Sidebar + Topbar + `main` (`max-w-6xl`) |
| Sidebar | `Sidebar.tsx`, `AppNavContent.tsx` | Visible dès `lg` ; groupes issus de `NAV_ITEMS` |
| Mobile | `MobileNavDrawer.tsx` | Drawer `< lg`, même contenu que la sidebar |
| Header | `Topbar.tsx` | Titre dérivé du path, recherche, refresh, accès rapides, profil, déconnexion |
| Recherche | `GlobalSearch.tsx` | Visible dès `md` ; renvoie vers des listes, pas vers les fiches |
| Onglets module | `TabNav.tsx` | Variants `primary` (module) / `sub` (sous-vue) |
| Contexte établissement | `ActiveSchoolContext.tsx` | Scope données présent ; **sélecteur global absent** |
| Année scolaire | `/parametres/annee-scolaire` | Configuration locale ; **pas de sélecteur shell** |
| Breadcrumb | — | **Absent** |

### Profondeur réellement utilisée aujourd’hui

```
Application (shell)
  └─ Module (entrée sidebar, ex. /etablissement, /planning, /finances)
       └─ Sous-module / onglet (ex. /etablissement/eleves, /planning/emploi-du-temps)
            └─ Sous-vue OU Liste OU Fiche
                 • Sous-vue : /planning/emploi-du-temps/par-classe
                 • Liste    : EntityPage (classes, élèves, paiements…)
                 • Fiche    : /etablissement/eleves/:studentId[/:section]
                      └─ Onglet de fiche (Vue d’ensemble, Identité, …)
                           └─ Section (blocs Card / SectionHeader)
```

Profondeur maximale observée : **4 segments d’URL** (`/etablissement/classes/:className/eleves`) + **onglet de fiche** en segment optionnel (`…/eleves/:id/identite`).

### Patterns de module observés (hétérogènes)

| Pattern | Exemples | Mécanisme |
|---------|----------|-----------|
| Module à onglets URL | Mon établissement, Finances, Planning, Administration, Abonnements | Layout + `TabNav` + `Outlet` |
| Module à sous-onglets | Emploi du temps, Mon abonnement | `TabNav` variant `sub` |
| Module hub cartes | Paramètres | Hub `/parametres` + pages filles |
| Pages plates sidebar | Présences, Notes, Examens, Bulletins | Une route = un écran |
| Accès hors sidebar | Messages, Annonces, Notifications | Icônes Topbar uniquement |
| Fiche workspace | Dossier élève | Header + nav sections + contenu |

---

## 1. Niveaux de navigation (officiels)

Les niveaux suivants constituent le **modèle canonique**.  
Tout nouveau module doit s’y mapper. Les niveaux entre parenthèses sont optionnels.

```
Application
  ↓
Module
  ↓
Sous-module
  ↓
Vue (Liste | Hub | Outil)
  ↓
Fiche
  ↓
Onglet de fiche
  ↓
Section
```

### Définitions

| Niveau | Définition | Exemple | Adressable URL ? |
|--------|------------|---------|------------------|
| **Application** | Shell authentifié : sidebar, header, contexte global | `AppLayout` | Non (contenant) |
| **Module** | Domaine métier de premier niveau, entrée du menu principal | Éducation / Mon établissement, Finances, Planning | Oui (`/finances`) |
| **Sous-module** | Partition stable d’un module, exposée en navigation locale | Élèves, Paiements, Emploi du temps | Oui (`/etablissement/eleves`) |
| **Vue** | Écran de travail du sous-module : liste, hub, calendrier, outil | Liste élèves, calendrier planning | Oui |
| **Fiche** | Vue détaillée d’une entité métier (workspace / dossier) | Fiche élève | Oui (`…/eleves/:id`) |
| **Onglet de fiche** | Partition thématique d’une fiche | Identité, Médical, Documents | Oui (`…/eleves/:id/medical`) |
| **Section** | Bloc thématique à l’intérieur d’un onglet / d’une vue | « Synthèse médicale », tableau responsables | Non (ancre optionnelle) |

### Règles de profondeur

1. Une navigation métier **ne doit pas dépasser 6 niveaux routables** (Module → … → Onglet de fiche).  
   La Section n’est pas un niveau de route obligatoire.
2. Entre le Module et la Fiche, on tolère au plus **un** niveau de sous-vue supplémentaire (ex. Emploi du temps → Par classe).
3. Si un parcours dépasse cette profondeur, c’est un signal de **mauvaise découpe module / sous-module**, pas une invitation à ajouter un 7ᵉ niveau d’URL.
4. Les redirections d’anciennes URLs sont autorisées ; elles ne comptent pas comme niveaux officiels.

### Mapping glossaire

| Terme glossaire | Niveau |
|-----------------|--------|
| Module applicatif | Module |
| Sous-module / onglet de module | Sous-module |
| Liste / Hub / Outil | Vue |
| Fiche / Workspace / Dossier | Fiche |
| Onglet / Module de fiche | Onglet de fiche |
| Section | Section |

---

## 2. Navigation globale

La navigation globale vit dans le shell Application.  
Elle est **commune à tous les modules** et ne doit pas être redéfinie localement.

### 2.1 Sidebar

| Attribut | Spécification |
|----------|---------------|
| Rôle | Accès aux **Modules** (et, si pertinent, à une entrée Tableau de bord) |
| Contenu | Entrées groupées par domaine métier (cycle de vie établissement) |
| État actif | Module courant (et seulement lui) |
| Desktop (`≥ lg`) | Persistante, visible |
| Mobile / tablette (`< lg`) | Remplacée par le drawer |
| Interdit | Sous-modules, listes, fiches, actions métier ponctuelles |

### 2.2 Header (Topbar)

| Attribut | Spécification |
|----------|---------------|
| Rôle | Orientation immédiate + actions transverses |
| Contenu obligatoire | Titre de contexte, accès menu (si drawer), contexte établissement / année (cf. 2.6–2.7), zone profil |
| Contenu recommandé | Recherche, notifications / accès rapides, rafraîchissement données |
| Titre | Reflète le niveau le plus pertinent : Module, Vue, ou **entité de fiche** quand une fiche est ouverte (DO-009) |
| Interdit | Remplacer la sidebar ; héberger la navigation locale complète d’un module |

### 2.3 Recherche

| Attribut | Spécification |
|----------|---------------|
| Rôle | Raccourci transverse vers des **entités** ou des **vues** autorisées |
| Portée | Multi-entités, filtrée par permissions |
| Cible | Priorité aux **fiches** quand elles existent ; sinon à la liste pertinente préfiltrée |
| Hors scope D1.2 runtime | Amélioration des deep-links (dette actuelle : renvoi liste uniquement) |

### 2.4 Notifications

| Attribut | Spécification |
|----------|---------------|
| Rôle | Signal d’attention transverse (badges + centre de notifications) |
| Placement | Header (accès rapide), pas sidebar |
| Navigation | Ouvre une vue Notifications adressable (`/notifications`) |

### 2.5 Profil utilisateur

| Attribut | Spécification |
|----------|---------------|
| Rôle | Identité de session, rôle, déconnexion, accès aux réglages personnels |
| Placement | Header |
| Contenu minimal | Nom, rôle, action de déconnexion |
| Extension | Menu profil (préférences, sécurité) sans charger la sidebar |

### 2.6 Changement d’établissement

| Attribut | Spécification |
|----------|---------------|
| Rôle | Définir le **périmètre de données** actif pour les rôles multi-établissements |
| Placement officiel | Shell global (Header), visible uniquement si `requiresSelection` ou multi-écoles |
| Effet | Recalcule le scope ; conserve le Module/Sous-module si toujours autorisé ; sinon bascule vers la vue par défaut autorisée |
| Interdit | Sélecteurs locaux dispersés qui divergent du contexte global |

### 2.7 Sélecteur d’année scolaire

| Attribut | Spécification |
|----------|---------------|
| Rôle | Définir l’**année de travail** active (filtre transverse des vues scolaires) |
| Placement officiel | Shell global (Header), pour les rôles établissement |
| Effet | Filtre les listes / fiches dépendantes de l’année ; ne change pas la hiérarchie de navigation |
| Distinction | La **configuration** des années (création, périodes) reste dans Paramètres → Année scolaire |

### 2.8 Accès rapide

| Attribut | Spécification |
|----------|---------------|
| Rôle | Entrées fréquentes **hors arborescence module** (Communication, Notifications) |
| Placement | Header |
| Règle | Une entrée d’accès rapide pointe vers une Vue adressable ; elle ne crée pas un second système de modules |
| Exemples actuels | Messages, Annonces, Notifications |

---

## 3. Navigation locale

La navigation locale guide l’utilisateur **à l’intérieur d’un Module**.

### Schéma type (Éducation / Mon établissement)

```
Module : Mon établissement
  ↓
Sous-module : Élèves
  ↓
Vue : Liste
  ↓
Fiche : Élève (workspace)
  ↓
Onglets de fiche : Vue d’ensemble · Identité · Inscription · …
  ↓
Sections : blocs thématiques de l’onglet actif
```

### Règles

1. **Un Module = une intention métier** (gérer l’établissement, financer, planifier, administrer…).
2. Les **Sous-modules** d’un Module sont exposés via une navigation locale unique (`TabNav` primary ou équivalent), pas via de nouvelles entrées sidebar.
3. La navigation locale reste **visible sur les Vues (listes)** du Module.
4. Sur une **Fiche**, la navigation locale de Module peut :
   - soit rester visible si elle n’entre pas en conflit d’orientation ;
   - soit être allégée / masquée si une double barre d’onglets nuit à la compréhension (cas dossier élève — dette connue).  
   Dans tous les cas, l’orientation Module → Sous-module → Fiche doit rester compréhensible (breadcrumb + titre).
5. Les **Onglets de fiche** n’apparaissent que sur la Fiche ; ils ne remplacent jamais les Sous-modules.
6. Les Modules « pages plates » (Présences, Notes…) sont des Modules sans Sous-module : la Vue est directement l’écran d’outil. Ce pattern est autorisé pour les outils mono-intention.
7. Le pattern **Hub** (Paramètres) est réservé aux Modules de configuration dense, non opérationnels au quotidien.

### Règles d’entrée de Module

| Situation | Comportement |
|-----------|--------------|
| Module avec Sous-modules | L’entrée sidebar ouvre le Sous-module par défaut (index → redirect) |
| Module hub | L’entrée sidebar ouvre le hub |
| Module mono-vue | L’entrée sidebar ouvre directement la Vue |

---

## 4. Breadcrumb

### Rôle

Compléter l’orientation (DO-009) en exposant le chemin hiérarchique cliquable.

### Où il apparaît

- Dans la zone de contenu principal, **au-dessus** du titre de Vue / Fiche.
- Dès que la profondeur utile est ≥ **Module + Sous-module + (Vue ou Fiche)** — typiquement à partir d’une liste imbriquée ou d’une fiche.

### Quand il disparaît

- Sur le Tableau de bord.
- Sur le premier écran d’un Module mono-vue (profondeur 1).
- Sur le hub Paramètres (le lien « Tous les paramètres » joue déjà ce rôle ; le breadcrumb peut le remplacer ultérieurement, pas le doubler).
- Sur les écrans d’auth / marketing (hors shell).

### Profondeur maximale affichée

- **5 segments visibles** maximum (ex. Établissement › Élèves › Liste › [Nom] › Identité).
- Si le chemin est plus long, tronquer au milieu avec `…` en conservant Module, parent immédiat et feuille.

### Contenu des segments

| Segment | Source |
|---------|--------|
| Module | Libellé sidebar |
| Sous-module | Libellé TabNav |
| Vue / Liste | Libellé de la vue (« Élèves », « Par classe »…) |
| Fiche | Identifiant lisible (nom élève, nom classe…) |
| Onglet de fiche | Libellé d’onglet |

### Comportement mobile

- Affichage compact : dernier segment + parent immédiat, avec expansion au tap.
- Pas de wrap multi-lignes agressif ; privilégier truncation + menu « chemin complet ».
- Le breadcrumb ne remplace pas le bouton **Retour à la liste** sur les fiches (complémentaire).

---

## 5. Navigation par onglets

Deux familles distinctes (ne pas les confondre — voir Glossaire) :

1. **Onglets de module** (`TabNav` primary) = Sous-modules  
2. **Onglets de fiche** = partitions d’un workspace  
3. **Sous-onglets** (`TabNav` sub) = variantes d’une même Vue (ex. Par classe / Par enseignant)

### Quand utiliser des onglets

| Utiliser des onglets si… | Exemples |
|--------------------------|----------|
| Les partitions partagent le même objet / même contexte | Finances : Paiements / Frais / Impayés |
| L’utilisateur alterne souvent sans changer de « mission » | Dossier élève : Identité / Médical |
| Les écrans sont des facettes d’un même Module | Planning : EDT / Salles / Conflits |

### Quand utiliser une page séparée (entrée sidebar ou hub)

| Utiliser une page / entrée séparée si… | Exemples |
|----------------------------------------|----------|
| L’intention métier est distincte et durable | Présences vs Notes vs Finances |
| La charge cognitive ou le volume d’onglets explose | Trop de sous-domaines hétérogènes |
| Il s’agit d’un outil transverse ou d’un accès rapide | Notifications, Messages |
| C’est de la configuration stable | Paramètres (hub) |

### Nombre maximum recommandé

| Type | Maximum recommandé | Au-delà |
|------|--------------------|---------|
| Onglets de module | **7** | Scinder le Module ou passer en hub |
| Sous-onglets de vue | **5** | Revoir le modèle de Vue |
| Onglets de fiche | **8** visibles | Regrouper, progressive disclosure, ou onglets secondaires |

> Le dossier élève prévoit davantage de modules métier côté modèle ; seuls les modules **navigables et autorisés** doivent apparaître. Les modules « à venir » ne gonflent pas indéfiniment la barre.

### Comportement responsive

- Défilement horizontal autorisé ; conserver l’onglet actif visible (scroll into view).
- Hauteur tactile minimale alignée sur la nav dossier (`min-h-11`) pour tout nouvel onglet.
- Éviter **deux** barres d’onglets scrollables empilées sur mobile ; si inévitable, la barre de fiche prime, la barre de module se simplifie.

### URL

- Chaque onglet de module / sous-onglet / onglet de fiche **a une URL propre** (segment de path).
- Pas d’état d’onglet uniquement en mémoire ou en query `?tab=` pour les partitions stables.
- L’index d’un Module redirige vers l’onglet / sous-module par défaut.
- Les deep-links et le rafraîchissement restaurent l’onglet exact.

### Accessibilité

- Conteneur `nav` avec `aria-label` distinct (« Onglets », « Sous-onglets », « Sections du dossier… »).
- Focus visible ; navigation clavier entre onglets.
- L’onglet actif est exposé (état `aria-current="page"` via `NavLink` actif ou équivalent).
- Ne pas s’appuyer uniquement sur la couleur pour l’état actif.

---

## 6. Navigation contextuelle

### 6.1 Retour à la liste

- Toute Fiche expose une action explicite **Retour à la liste** (ou au parent immédiat).
- Cible : la Vue liste du Sous-module (ex. `/etablissement/eleves`), en préservant si possible les filtres via état de navigation ultérieur.
- Le breadcrumb et le retour liste sont complémentaires.

### 6.2 Ouverture d’une fiche

- Depuis une liste : action claire (« Dossier », « Ouvrir ») → navigation vers l’URL de fiche.
- La fiche s’ouvre sur l’onglet par défaut (**Vue d’ensemble** / résumé) sauf deep-link vers un onglet.
- Les modales d’édition restent autorisées pour les CRUD légers ; elles ne remplacent pas une fiche riche (workspace).

### 6.3 Navigation entre fiches

- Optionnelle : précédent / suivant dans le contexte de liste filtré.
- Ne doit pas casser l’URL de la fiche courante.
- Hors MVP : non bloquant ; à spécifier par module lors de l’implémentation.

### 6.4 Changement d’année scolaire

- Via sélecteur global (spécifié §2.7).
- Les listes se rafraîchissent sur l’année active.
- Si la fiche ouverte n’existe plus dans la nouvelle année : état **ressource absente** + retour liste (pas d’écran blanc).
- Ne pas changer silencieusement d’entité.

### 6.5 Changement d’établissement

- Via sélecteur global (spécifié §2.6).
- Même règle : conserver la position dans l’arborescence si autorisée et si la ressource existe ; sinon fallback safe.
- Les données affichées après bascule appartiennent exclusivement au nouvel établissement.

---

## 7. Responsive — expérience par surface

Les breakpoints de référence (Tailwind actuels) :

| Surface | Breakpoint | Expérience de navigation |
|---------|------------|--------------------------|
| **Desktop** | `≥ lg` (1024+) | Sidebar persistante + Header complet + onglets horizontaux + recherche visible |
| **Tablette** | `md`–`< lg` (768–1023) | Drawer pour les Modules ; Header avec recherche ; onglets scrollables ; densités de liste adaptées |
| **Mobile** | `< md` (< 768) | Drawer Modules ; Header compact (icônes) ; recherche accessible (entrée dédiée ou expansion) ; fiches en colonnes empilées ; breadcrumb compact |

### Principes d’expérience (pas seulement « réduire la largeur »)

1. **Desktop** — orientation maximale : sidebar + titre + (breadcrumb) + onglets. Productivité et multi-contextes.
2. **Tablette** — même information, chrome réduit : le drawer remplace la sidebar ; les accès rapides restent dans le Header.
3. **Mobile** — une intention à la fois : éviter les doubles barres d’onglets ; privilégier fiche lisible ; actions primaires accessibles au pouce ; pas de perte de fonctions critiques (menu, retour, notifications).

### Interdits responsive

- Masquer définitivement un Module uniquement parce que l’écran est petit (il reste dans le drawer).
- Rendre une fiche inaccessible sur mobile.
- Dupliquer des navigations incompatibles (ex. bottom-bar + sidebar + tabs) sans décision DO.

---

## 8. États de navigation

Les états système (DO-005) s’appliquent **sans perdre l’orientation** (shell + contexte).

| État | Comportement de navigation | Contenu attendu |
|------|----------------------------|-----------------|
| **Loading** | Shell conservé ; zone contenu en chargement | Message explicite ; pas de remplacement total par écran blanc |
| **Erreur** | Shell conservé ; zone contenu en erreur | Message + action de retry si pertinent ; lien de repli (liste / module) |
| **Permission refusée** | Ne pas exposer l’entrée si prévisible ; si URL directe : écran forbidden ou redirection vers défaut autorisé | Message clair + issue (retour zone autorisée) — cohérent DO-005 / DO-006 |
| **Ressource absente** | URL de fiche invalide / entité supprimée | État « introuvable » + retour liste parent |
| **Conflit** | Édition concurrente ou état obsolète sur fiche | Rester sur la fiche ; bannière de conflit ; actions Recharger / Réappliquer (pattern édition contrôlée élève) |

### Règles transverses

1. Un état système **ne change pas** le Module actif dans la sidebar sans raison.
2. Les redirections silencieuses vers le tableau de bord sont réservées aux wildcards / absences totales de permission — pas aux erreurs métier de fiche.
3. Forbidden ≠ Empty ≠ Error ≠ Coming soon.

---

## 9. Décisions officielles (navigation)

Les décisions suivantes sont ajoutées au référentiel [DO-xxx](./decisions-officielles.md).  
Résumé pour lecture D1.2 :

| ID | Titre |
|----|-------|
| **DO-013** | Hiérarchie officielle à 7 niveaux (Application → … → Section) |
| **DO-014** | Toute fiche métier est adressable par URL stable |
| **DO-015** | Les partitions stables (onglets) sont des segments d’URL |
| **DO-016** | Breadcrumb obligatoire dès Module + Sous-module + (Vue\|Fiche) |
| **DO-017** | Établissement actif et année scolaire active vivent dans le shell |
| **DO-018** | La sidebar n’expose que Modules (+ tableau de bord) |
| **DO-019** | Plafonds d’onglets (7 / 5 / 8) et critères onglet vs page |
| **DO-020** | Sur fiche, une seule barre d’onglets « primaire » à la fois sur mobile |
| **DO-021** | Les états système préservent le shell et l’orientation |
| **DO-022** | Validation CTO avant toute implémentation de navigation D1.2 |

---

## 10. Dette actuelle (constat — sans plan de développement)

### Incohérences

1. Trois patterns de Module coexistent (onglets, hub, pages plates) sans contrat écrit — D1.2 fixe le contrat ; l’existant diverge encore.
2. Double barre d’onglets sur le dossier élève (établissement + fiche) + titres `h1` concurrents (Topbar / Module / Fiche).
3. Titre Topbar souvent calé sur le Sous-module (« Élèves ») alors qu’une Fiche est ouverte.
4. Filtrage des onglets par permission inégal (présent sur Mon établissement, absent sur Finances / Planning / Administration).
5. `UsersPage` monté à deux endroits (`/etablissement/comptes-utilisateurs` et `/administration/utilisateurs`).
6. Relations parent-enfant présentes sous Établissement **et** Relations génériques sous Administration.
7. Commentaire `constants.ts` : Paramètres décrits comme « module à onglets » alors que l’UI est un hub.

### Doublons

1. Titres empilés (Topbar + header de Module + `SectionHeader` de page).
2. Accès Communication hors sidebar **et** anciennes routes `/communication/*` redirigées — OK fonctionnellement, mais le modèle mental « module Communication » n’est pas officialisé.
3. Sélecteurs d’établissement locaux (ex. conception bulletins / config) vs `ActiveSchoolContext` global non exposé.

### Risques

1. **Orientation** — perte de contexte sur fiches profondes (DO-009).
2. **Responsive** — double scroll d’onglets sur mobile.
3. **Deep-link recherche** — résultats élèves/utilisateurs n’ouvrent pas la fiche.
4. **Contexte manquant** — absence de sélecteurs globaux établissement / année → erreurs de périmètre pour rôles plateforme.
5. **Scalabilité modules futurs** (RH, Bibliothèque…) — sans cette architecture, risque de nouveaux patterns ad hoc.
6. **Accessibilité** — `aria-label` présents sur TabNav / drawer, mais hiérarchie de titres et focus modal encore fragiles (inventaire D1.1).

---

## 11. Périmètre futur (hors D1.2 implémentation)

Ordre indicatif après validation CTO — chaque lot = PR séparée :

1. Exposer sélecteurs **établissement** / **année** dans le shell (DO-017).
2. Introduire le **breadcrumb** selon DO-016.
3. Aligner titres Topbar sur la Fiche ouverte (DO-009).
4. Traiter la densité des doubles onglets sur workspace (DO-020).
5. Deep-links Recherche → fiches.
6. Harmoniser filtrage permission des onglets de module.
7. Étendre le modèle aux modules futurs (RH, Bibliothèque…) sans nouveau pattern.

---

## 12. Impact sur les modules existants

Tableau d’alignement architectural.  
Légende conformité : ✅ conforme · ⚠️ écart partiel · ❌ non conforme · — non développé / N/A

| Module | Conforme | Écart | Action future |
|--------|----------|-------|---------------|
| Tableau de bord | ⚠️ | Pas de breadcrumb (OK) ; titre/orientation simples | Maintenir ; vérifier DO-009 lors évolutions |
| Mon établissement (Vue d’ensemble) | ⚠️ | Pattern onglets OK ; pas de breadcrumb ; titres dupliqués | D2.x orientation |
| Élèves (liste) | ⚠️ | Sous-module OK ; breadcrumb absent | D2.x breadcrumb |
| Élèves (fiche / workspace) | ⚠️ | URL fiche + onglets OK ; double TabNav ; titre Topbar non entité ; h1 multiples | D2.x orientation fiche |
| Classes | ⚠️ | Liste OK ; liste imbriquée `classes/:className/eleves` profonde | D2.x breadcrumb + revue profondeur |
| Enseignants | ⚠️ | Liste EntityPage ; pas de fiche workspace | Plus tard (fiche enseignant) |
| Parents & élèves | ⚠️ | Sous-module OK ; chevauchement conceptuel avec Administration/Relations | Audit IA / D2.x |
| Comptes utilisateurs (établissement) | ⚠️ | Doublon de montage avec Administration/Utilisateurs | Audit gouvernance nav |
| Planning | ⚠️ | Onglets + sous-onglets conformes à l’esprit DO-015 ; pas de breadcrumb ; tabs non filtrés permission | D2.x |
| Présences | ⚠️ | Module mono-vue autorisé ; pas de sélecteur année shell | D2.x contexte année |
| Notes & évaluations | ⚠️ | Module mono-vue ; idem année | D2.x |
| Examens | ⚠️ | Module mono-vue / EntityPage | Plus tard |
| Bulletins | ⚠️ | Module mono-vue / EntityPage | Plus tard |
| Finances | ⚠️ | Onglets module OK ; tabs non filtrés permission ; pas de fiches URL riches | D2.x |
| Messages | ⚠️ | Accès rapide Header OK ; module Communication non nommé dans sidebar | Décision produit (garder accès rapide) |
| Annonces | ⚠️ | Idem Messages | Idem |
| Notifications | ⚠️ | Accès rapide OK | Maintenir |
| Administration | ⚠️ | Onglets OK ; gate permission racine = `users` ; Relations/Utilisateurs en tension avec Établissement | Audit D2.x |
| Abonnements (plateforme) | ⚠️ | 8 onglets (au-dessus du plafond recommandé de 7) | Revue IA structure |
| Paramètres | ⚠️ | Hub conforme au pattern config ; pas de sélecteur année dans shell (config locale seulement) | D2.x shell année |
| Mon abonnement | ⚠️ | Sous-onglets URL OK | Maintenir |
| Pays / Établissements (plateforme) | ⚠️ | Pages plates ; sélecteur établissement global absent | D2.x DO-017 |
| RH | — | Non développé | N/A — appliquer D1.2 à la création |
| Bibliothèque | — | Non développé | N/A — appliquer D1.2 à la création |
| Communication (module unifié) | — | Éclaté en accès rapides | Décision produit ultérieure |
| Modules futurs | — | — | Conformité D1.2 obligatoire dès la première PR |

### Lecture du tableau

- Aucune ligne ❌ bloquante n’impose une refonte immédiate.
- Les ⚠️ documentent la **dette d’alignement** ; les corrections sont planifiées (D2.x+), pas exécutées dans D1.2.
- Ce tableau constitue le **premier tableau de bord d’alignement** du Framework UI/UX ; il sera mis à jour à chaque spécification D suivante.

---

## 13. Critères de validation CTO

Avant toute PR d’implémentation navigation :

- [ ] Niveaux §1 acceptés
- [ ] Rôles shell §2 acceptés (y compris établissement + année)
- [ ] Règles locales §3 acceptées
- [ ] Contrat breadcrumb §4 accepté
- [ ] Contrat onglets §5 accepté
- [ ] DO-013 à DO-022 intégrés au référentiel
- [ ] Tableau d’impact §12 pris comme baseline de conformité

**Statut demandé :** Validé CTO / Amendé / Reporté
