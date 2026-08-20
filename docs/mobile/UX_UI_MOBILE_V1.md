# Somafrik Mobile — Spécification UX/UI V2

Statut : **cible produit adoptée — coque Accueil unique (référence Préfet)**  
Portée : application Mobile Somafrik (Web/Backend inchangés)  
Référence ergonomique : principes de hiérarchie mobile grand public (header clair, actions essentielles, navigation basse stable), **sans reproduire l’identité visuelle d’un produit tiers**.

## 0. V2 — même architecture pour tous les rôles

Le dashboard **Préfet des études** est le modèle visuel de tous les Accueils. Même structure, même hiérarchie, même style de cartes ; le contenu métier (KPI, actions, onglets) est injecté par configuration et **filtré par les permissions existantes**. Un KPI ou une action Accueil **disparaît** si le droit de la route de destination n’existe pas (fail-closed) : par exemple `courses` élève exige `Timetable`, `studentPayments` exige `StudentPayments`. Les matrices métier ne sont pas élargies pour peupler l’Accueil.

Implémentation : un layout commun `RoleDashboardLayout` + `roleHomeConfig`. **Pas d’écran React Native dupliqué par rôle.**

Ordre visuel :

1. **Header compact commun** — menu, nom d’établissement, sync, recherche, notifications.
2. **Carte identité** — nom/prénom, établissement (ou classe), `Espace …`.
3. **Bannière métier colorée** — mission principale du rôle.
4. **Vue métier** — 4 KPI maximum, réellement pertinents ; lien **Matrice sécurité** si autorisé.
5. **Actions rapides** sous les KPI.
6. **Bottom nav** adaptée au rôle, sans module non autorisé.

Exemple `school_admin` :

- identité : `KIBWIJA TATA` / `INSTITUT NURU` / `Espace administrateur`
- bannière : *Gestion de l'établissement, utilisateurs, finances et organisation scolaire.*
- KPI : Utilisateurs · Classes · Élèves · Paiements
- actions : Comptes · Classes · Enseignants · Frais · Annonces (si droit)

Viewport de validation : **~360×800 dp**, plus **320 / 360 / 390 / 412 dp** et **fontScale 1.0 / 1.3**.

**Preuve bundle :** badge `Développement · V2.0` **sous** la barre système. Sans `V2.0`, le bundle n’est pas ce HEAD (`expo start --clear`, Reload).

Interdits V2 :
- duplication de `CommunicationHeaderIcons` sur Home ;
- JSX Accueil recopié par rôle ;
- plus de 4 KPI dans Vue métier ;
- libellés bottom tronqués (`Utilisate…`, `Enseigna…`) ou `adjustsFontSizeToFit` agressif ;
- onglet bottom « Menu » ;
- capsule flottante pour la bottom nav ;
- modification des permissions métier pour « faire tenir » un KPI.

`school_admin` — libellés courts : `Accueil / Classes / Frais / Comptes / Profs`.

Les overlays Expo Go / système (`↻`, `...`) ne sont **pas** des composants Somafrik.

Cibles tactiles : **>= 44 dp**.

## 1. Principes produit

1. **Le header sert aux actions globales.**
   - gauche : menu latéral global ;
   - centre : établissement / contexte courant (prioritaire, une ligne) ;
   - droite : synchronisation, recherche, notifications selon permissions.
2. **La bottom navigation sert uniquement aux tâches quotidiennes du rôle.**
   - aucun onglet « Menu » ;
   - 5 entrées maximum au total, Accueil compris ;
   - les actions secondaires restent dans le menu latéral.
3. **Le menu latéral est la navigation étendue.**
   - accès aux modules secondaires, paramètres, support, synchronisation détaillée et déconnexion ;
   - contenu filtré par RBAC et tenant ;
   - aucune route legacy ne doit être réintroduite.
4. **La synchronisation est explicite.**
   - icône `sync` / `refresh`, pas de globe ;
   - l’utilisateur doit comprendre l’état local, le dernier rafraîchissement et les erreurs réseau ;
   - la synchronisation ne doit jamais masquer une erreur canonique PostgreSQL derrière une donnée locale inventée.
5. **La donnée métier reste canonique.**
   - PostgreSQL / API restent la source de vérité ;
   - les caches locaux servent à la résilience, pas à créer une deuxième vérité métier.

## 2. Architecture visuelle cible

### Header permanent

Ordre :

`[☰]  [Nom établissement]        [Sync] [Recherche] [Notifications]`

Contraintes :
- Safe Area haute réelle ; `headerStatusBarHeight: 0` côté navigator (pas de double inset) ;
- slots : burger 44 dp à gauche, 3 actions 132 dp à droite ; nom d’établissement lisible au centre ;
- cible tactile >= 44 dp ;
- le nom établissement est prioritaire, une ligne, **sans** ligne secondaire ville/rôle ;
- maximum 3 actions à droite ;
- les actions non autorisées par RBAC ne sont pas affichées ;
- le badge d’environnement reste **sous** la barre système (bande `HEADER_BADGE_BAND_DP` dans le header), jamais dans l’horloge / réseau / batterie ;
- le badge non-production affiche la version de spec (`Développement · V2.0`) pour authentifier le bundle.

### Menu latéral gauche

Le menu s’ouvre depuis le burger du header. Il contient :
- identité utilisateur et rôle ;
- établissement / contexte courant ;
- Accueil ;
- modules secondaires autorisés ;
- Synchronisation / mode hors ligne si autorisé ;
- Support ;
- Déconnexion.

Le menu ne doit pas dupliquer inutilement les actions principales, mais peut fournir un accès secondaire aux modules pour la découvrabilité.

### Bottom navigation

Règle : **Accueil + 4 onglets métier maximum**.

Le menu latéral remplace totalement l’ancien onglet bottom « Menu ».

Libellés courts, barre **dockée bord à bord** (pas de capsule flottante), hauteur de contenu **52 dp** + inset bas, libellés **10 sp** lisibles à fontScale 1.3 **sans** `adjustsFontSizeToFit`. Icônes ~20 dp. Barre claire, état actif primaire Somafrik.

Responsive 320 / 360 / 390 / 412 dp, zéro ellipsis.

## 3. Navigation par rôle

La liste effective reste filtrée par les permissions existantes. Lorsqu’un rôle n’a pas droit à un module, l’onglet disparaît au lieu d’être désactivé.

### Administrateur établissement

Priorité :
1. Accueil
2. Classes
3. Frais
4. Comptes
5. Profs

Le menu latéral héberge notamment : Élèves, présences, notes, emploi du temps, bulletins, annonces, messages, rapports, configuration, synchronisation et support selon droits.

### Enseignant / personnel pédagogique

Priorité :
1. Accueil
2. Classes
3. Élèves
4. Appel
5. Notes

Le menu latéral héberge : emploi du temps, bulletins, annonces, messages, synchronisation et support selon droits.

### Secrétariat

Priorité :
1. Accueil
2. Élèves
3. Appel
4. Frais

Le cinquième emplacement reste libre tant qu’aucun besoin métier plus fréquent n’est validé.

### Parent

Priorité :
1. Accueil
2. Enfant / Profil
3. Notes
4. Présences
5. Frais

Le menu latéral héberge : bulletins, messages, annonces, paiement mobile, mode hors ligne et support selon droits.

### Élève

Priorité :
1. Accueil
2. Profil
3. Notes
4. Présences
5. Frais

Le menu latéral héberge : emploi du temps, bulletins, messages, annonces et mode hors ligne selon droits.

### Superadmin / Admin pays

La navigation basse doit rester courte et orientée pilotage. La navigation étendue (établissements, abonnements, utilisateurs, configuration, droits, notifications, audit) reste dans le drawer tant que les priorités d’usage terrain ne sont pas validées par des tests utilisateurs.

## 4. Dashboard / Accueil

Tous les rôles passent par `RoleDashboardLayout` :

1. header commun ;
2. carte identité (nom, établissement/classe, `Espace …`) ;
3. bannière mission du rôle ;
4. Vue métier (≤ 4 KPI, vérité API, sans `meta` de remplissage) ;
5. Matrice sécurité si `canReadView(Permissions)` ;
6. actions rapides filtrées par RBAC ;
7. footer optionnel (annonce parent, sélecteur plateforme).

Les KPI et actions **disparaissent** si le rôle n’a pas le droit — on ne change pas la matrice de sécurité pour peupler la grille.

## 5. Synchronisation et mode local

Le bouton header « Synchroniser » ouvre le centre de synchronisation lorsqu’il existe pour le rôle. La cible ultérieure est une interaction courte :
- état `À jour` ;
- état `Synchronisation…` ;
- état `Modifications en attente` ;
- état `Échec` avec action de reprise.

Une synchronisation complète ne doit pas réintroduire `backoffice_state`, `refreshBackOfficeState` ou tout snapshot legacy global.

## 6. Recherche

La recherche du header doit conduire au meilleur écran de recherche disponible pour le rôle :
- admin : élèves / utilisateurs / classes selon permissions ;
- enseignant : élèves / classes ;
- parent / élève : la recherche globale peut être absente jusqu’à ce qu’un vrai cas d’usage soit validé.

Une vraie recherche globale multi-entités pourra être introduite plus tard, sans bloquer cette V1.

## 7. Notifications

L’action notifications du header pointe vers la source pertinente autorisée : notifications plateforme, annonces ou messages selon le rôle et les permissions. Les badges ne doivent compter que des éléments réellement non lus.

## 8. Design system minimal

- Fond principal : clair, neutre, contraste élevé.
- Couleur primaire Somafrik : utilisée pour les CTA et l’état actif, pas comme remplissage massif de tous les composants.
- Succès, alerte et erreur ont des couleurs distinctes et toujours un libellé texte.
- Icônes : Ionicons, cohérentes dans toute l’application.
- Rayon : cohérent et modéré.
- Espacement : grille 4/8 dp.
- Cibles tactiles : >= 44 dp.
- Texte métier d’abord, jargon technique interdit dans l’UI utilisateur.

## 9. Accessibilité

- `accessibilityRole` sur les actions ;
- `accessibilityLabel` explicite pour les boutons icon-only ;
- ne jamais transmettre l’information uniquement par couleur ;
- respecter le grossissement de texte autant que possible (fontScale 1.3) ;
- aucun CTA important masqué par la barre système ou le clavier.

## 10. Critères d’acceptation V2

La V2 est **CODE READY** lorsque :
- tous les Accueils utilisent `RoleDashboardLayout` + `roleHomeConfig` ;
- `school_admin` affiche identité + bannière `Espace administrateur` + Vue métier ≤ 4 KPI ;
- l’onglet bottom « Menu » n’existe plus ;
- la bottom nav contient au plus 5 entrées visibles, dockée, libellés courts ;
- un burger ouvre le drawer gauche ;
- `measureHomeShell` tient sur 320/360/390/412 × fontScale 1.0/1.3 ;
- les permissions métier ne sont pas élargies pour peupler l’Accueil ;
- un KPI ou une action Accueil disparaît si la route de destination n’est pas lisible (`courses` élève → `Timetable`, `studentPayments` → `StudentPayments`, `profile`/`notes`/`presences` idem) ;
- TypeScript et les vérifications Mobile existantes restent vertes ;
- les parcours Maestro critiques restent possibles (`home-admin-dashboard`, onglets Accueil / Classes / Frais / Comptes / Profs).

La V2 est **GO visuel** uniquement avec une capture device du HEAD (badge `V2.0`) montrant la coque Préfet sur `school_admin`.

## 11. Déploiement progressif

La refonte est livrée en plusieurs incréments dans la même direction produit :
1. shell global : header + drawer + bottom nav ;
2. dashboards par rôle (densité V1.2) ;
3. listes et fiches métier ;
4. synchronisation / offline UX ;
5. tests utilisateurs terrain et ajustements.

Aucun changement backend ou schéma PostgreSQL n’est requis pour l’incrément shell UX/UI.
