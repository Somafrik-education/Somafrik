# Somafrik Mobile — Spécification UX/UI V1

Statut : **cible produit adoptée**  
Portée : application Mobile Somafrik (Web/Backend inchangés)  
Référence ergonomique : principes de hiérarchie mobile grand public (header clair, actions essentielles, navigation basse stable), **sans reproduire l’identité visuelle d’un produit tiers**.

## 1. Principes produit

1. **Le header sert aux actions globales.**
   - gauche : menu latéral global ;
   - centre : établissement / contexte courant ;
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

`[☰]  [Nom établissement / contexte]        [Sync] [Recherche] [Notifications]`

Contraintes :
- cible tactile >= 44 dp ;
- le nom établissement est prioritaire et peut être tronqué sur une ligne ;
- une ligne secondaire peut afficher ville, année scolaire ou rôle ;
- maximum 3 actions à droite ;
- les actions non autorisées par RBAC ne sont pas affichées.

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

## 3. Navigation par rôle

La liste effective reste filtrée par les permissions existantes. Lorsqu’un rôle n’a pas droit à un module, l’onglet disparaît au lieu d’être désactivé.

### Administrateur établissement

Priorité :
1. Accueil
2. Classes
3. Frais / Paiements
4. Utilisateurs
5. Enseignants

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

Ordre recommandé :
1. contexte établissement / utilisateur ;
2. message de bienvenue ;
3. KPI réellement chargés depuis l’API ;
4. actions rapides du rôle ;
5. alertes / activité récente ;
6. état offline / synchronisation si nécessaire.

Interdits :
- KPI inventés pendant un échec réseau ;
- faux `0` pour masquer une erreur ;
- duplication d’une même action dans trois zones différentes ;
- tuiles purement décoratives sans destination métier.

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
- respecter le grossissement de texte autant que possible ;
- aucun CTA important masqué par la barre système ou le clavier.

## 10. Critères d’acceptation V1

La V1 est considérée conforme lorsque :
- l’onglet bottom « Menu » n’existe plus ;
- la bottom nav contient au plus 5 entrées visibles ;
- un burger ouvre le drawer gauche ;
- le header affiche le contexte établissement ;
- sync / recherche / notifications sont permission-aware ;
- le drawer est filtré par RBAC ;
- les routes legacy ne sont pas réintroduites ;
- les écrans existants restent atteignables ;
- TypeScript et les vérifications Mobile existantes restent vertes ;
- les parcours Maestro critiques restent possibles après adaptation des sélecteurs si nécessaire.

## 11. Déploiement progressif

La refonte est livrée en plusieurs incréments dans la même direction produit :
1. shell global : header + drawer + bottom nav ;
2. dashboards par rôle ;
3. listes et fiches métier ;
4. synchronisation / offline UX ;
5. tests utilisateurs terrain et ajustements.

Aucun changement backend ou schéma PostgreSQL n’est requis pour l’incrément shell UX/UI.
