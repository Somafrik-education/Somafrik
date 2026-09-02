# Runbook de capture — Web W01 à W06

Référence produit : `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1`.

Objectif : produire les six premières captures runtime du guide utilisateur Web, sans mockup ni reconstruction graphique.

## Préconditions

- Exécuter une instance Somafrik correspondant au SHA de référence, ou à un SHA ultérieur explicitement revalidé.
- Utiliser uniquement des données fictives.
- Se connecter avec un rôle possédant les permissions nécessaires au scénario.
- Recharger les données depuis le backend avant chaque capture.
- Masquer ou éviter tout secret temporaire, mot de passe, PIN, token ou donnée personnelle réelle.
- Ne jamais utiliser le BackOffice legacy.

## Jeu de données recommandé

- Établissement : `Institut Nouvelle Espérance`
- Classe : une classe réellement active dans le référentiel runtime, par exemple `6e A` si elle existe réellement
- Élève : `Esther Okito`
- Autres élèves fictifs : `Jean Mukendi`, `Amina Ilunga`

Le nom de classe doit provenir de la base/référentiel réellement chargé. Ne pas forcer un libellé uniquement pour la capture.

## W01 — Connexion établissement

**Fichier :** `assets/web/01-connexion-etablissement.png`

**Route :** `/connexion`

**Rôle de référence :** Admin établissement

**État attendu :**

- titre `Connexion plateforme` ;
- profil `Établissement` sélectionné ;
- champ `Code établissement` visible ;
- champ `Identifiant` visible ;
- champ `Mot de passe` visible ;
- bouton `Se connecter` visible ;
- aucun compte démo ou secret réel exposé dans la capture destinée au guide.

**Contrôle source :** `web/src/pages/LoginPage.tsx`.

## W02 — Tableau de bord établissement

**Fichier :** `assets/web/02-tableau-de-bord-etablissement.png`

**Route :** `/tableau-de-bord`

**Rôle de référence :** Admin établissement

**État attendu :**

- session établissement active ;
- établissement fictif identifiable ;
- indicateurs et raccourcis chargés depuis le backend ;
- aucun état de chargement ou erreur réseau ;
- aucun module non autorisé visible.

**Contrôle :** comparer les raccourcis réellement affichés avec les permissions effectives de la session avant capture.

## W03 — Liste des classes

**Fichier :** `assets/web/03-classes-liste.png`

**Route :** `/etablissement/classes`

**Rôle de référence :** Admin établissement

**État attendu :**

- titre `Classes` ;
- recherche `Rechercher dans classes` ;
- filtre de statut ;
- au moins une classe active ;
- colonnes Nom, niveau/libellé pays, orientation le cas échéant, groupe, année, effectif, statut, actions ;
- boutons `Élèves`, `Modifier`, `Désactiver` seulement si le RBAC les autorise ;
- bouton `Ajouter` seulement si `CREATE` est accordé.

**Contrôle source :** `web/src/pages/etablissement/ClassesListPage.tsx`.

## W04 — Ajouter une classe

**Fichier :** `assets/web/04-classe-ajout.png`

**Depuis :** `/etablissement/classes`

**Rôle de référence :** Admin établissement avec droit de création Classes

**État attendu :**

- modal `Ajouter une classe` ouverte ;
- `Année scolaire` visible ;
- `Niveau` visible ;
- orientation/filière visible uniquement si le référentiel la propose ;
- `Groupe` visible ;
- aucune valeur artificiellement injectée pour la capture.

**Important :** vérifier les présélections. Une présélection du premier élément actif n'est pas une recommandation métier.

**Contrôle source :** `web/src/pages/etablissement/ClassesListPage.tsx`.

## W05 — Annuaire Élèves

**Fichier :** `assets/web/05-eleves-annuaire.png`

**Route :** `/etablissement/eleves`

**Rôle de référence :** Secrétaire ou Admin établissement

**État attendu :**

- titre `Élèves` ;
- texte indiquant que l'inscription se fait depuis une classe ;
- recherche visible ;
- colonnes Nom, Prénom, Matricule, Classe, Actions ;
- action `Dossier` visible ;
- `Archiver` visible seulement si DELETE est accordé ;
- aucun bouton global de création d'élève.

**Contrôle source :** `web/src/pages/etablissement/StudentsListPage.tsx`.

## W06 — Dossier élève

**Fichier :** `assets/web/06-eleve-dossier.png`

**Route :** `/etablissement/eleves/:studentId`

**Rôle de référence :** Admin établissement ou rôle autorisé

**État attendu :**

- élève fictif uniquement ;
- identité et contexte scolaire cohérents avec la classe réellement chargée ;
- aucune donnée privée réelle ;
- sections visibles uniquement si le rôle les autorise ;
- aucune information provenant d'un autre établissement.

**Contrôle route :** `StudentWorkspacePage` via `web/src/App.tsx`.

## Validation après chaque capture

Pour chaque image :

1. enregistrer au chemin exact prévu ;
2. vérifier que le SHA/runtime est connu ;
3. vérifier que le rôle correspond au scénario ;
4. vérifier les boutons visibles contre le RBAC ;
5. vérifier qu'aucun secret n'est présent ;
6. vérifier qu'aucun écran legacy n'apparaît ;
7. mettre à jour `CAPTURES-METIER.md` de `À CAPTURER` vers `VALIDÉE` ;
8. intégrer l'image dans `GUIDE-UTILISATEUR-WEB.md` à proximité de la procédure correspondante ;
9. faire un diff GitHub indépendant avant toute autorisation de Ready/Merge.

## Critère de fin du lot W01→W06

Le lot est terminé uniquement lorsque les six PNG sont issus d'une instance Somafrik réellement exécutée, intégrés au guide, marqués `VALIDÉE`, et relus contre le comportement runtime.