# Guide utilisateur Somafrik — Web

> Référence fonctionnelle : `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1`  
> Interface : Web React/Vite + API canonique + PostgreSQL.  
> Le BackOffice legacy est exclu de ce guide.

## 1. Se connecter

Ouvrez Somafrik puis choisissez **Connexion**. L'écran **Connexion plateforme** propose trois contextes :

- **Super administrateur** ;
- **Administrateur pays** ;
- **Établissement**.

Pour un compte d'établissement :

1. choisissez **Établissement** ;
2. renseignez **Code établissement** ;
3. renseignez **Identifiant** ;
4. saisissez le **Mot de passe** ;
5. cliquez sur **Se connecter**.

Si Somafrik indique que le mot de passe est temporaire, la fenêtre **Nouveau mot de passe** s'ouvre. Saisissez un mot de passe d'au moins 6 caractères, confirmez-le puis cliquez sur **Enregistrer**.

> Les comptes de démonstration visibles en environnement de développement ne doivent jamais être utilisés comme procédure de production.

**Capture à intégrer :** `assets/web/01-connexion-etablissement.png` — voir `CAPTURES-METIER.md`.

## 2. Comprendre les menus et les droits

Après connexion, Somafrik affiche uniquement les modules autorisés pour votre rôle et vos permissions.

> **Pourquoi je ne vois pas ce bouton ?**  
> Les droits Somafrik sont contrôlés par action. Un utilisateur autorisé à consulter un module peut ne pas avoir le droit de créer, modifier, archiver ou supprimer des données.

Ne cherchez pas à contourner un bouton absent : demandez à l'administrateur habilité de vérifier votre rôle ou vos droits.

## 3. Tableau de bord

Le **Tableau de bord** est le point d'entrée de pilotage. Les indicateurs et raccourcis affichés dépendent du rôle et du périmètre de l'utilisateur.

Utilisez-le pour rejoindre les modules disponibles sans modifier les données directement depuis une autre application ou un ancien écran.

**Capture à intégrer :** `assets/web/02-tableau-de-bord-etablissement.png`.

# Mon établissement

## 4. Classes

Ouvrez **Mon établissement → Classes**.

L'écran affiche notamment : **Nom**, le libellé de **Niveau** configuré pour le pays, le libellé d'orientation pédagogique configuré, le **Groupe**, l'**Année**, l'**Effectif**, le **Statut** et les **Actions**.

### Rechercher ou filtrer

- utilisez **Rechercher dans classes** pour retrouver une classe ;
- utilisez le filtre **Tous les statuts / Actives / Inactives** ;
- cliquez sur **Actualiser** pour recharger la liste.

### Créer une classe

Si votre rôle possède le droit de création :

1. cliquez sur **Ajouter** ;
2. vérifiez l'**Année scolaire** ;
3. choisissez le **Niveau** ;
4. choisissez l'orientation pédagogique proposée si elle s'applique ;
5. choisissez le **Groupe** demandé par l'interface actuelle ;
6. enregistrez.

Les valeurs proposées proviennent du référentiel pédagogique activé pour l'établissement. Ne sélectionnez pas une valeur uniquement parce qu'elle est présélectionnée : vérifiez qu'elle correspond bien à la classe à créer.

### Modifier ou désactiver une classe

Dans **Actions** :

- **Élèves** ouvre les élèves de la classe ;
- **Modifier** permet de changer les champs autorisés ;
- **Désactiver** rend une classe inactive sans la présenter comme une nouvelle classe active.

**Captures à intégrer :** `03-classes-liste.png`, `04-classe-ajout.png`.

## 5. Inscrire un élève

L'annuaire **Mon établissement → Élèves** est une liste de consultation. Il ne contient volontairement pas de bouton général « Ajouter un élève ».

Pour inscrire un élève :

1. ouvrez **Mon établissement → Classes** ;
2. sur la classe voulue, cliquez sur **Élèves** ;
3. utilisez l'action **Inscrire un élève** disponible dans l'écran de la classe ;
4. renseignez les informations demandées ;
5. validez l'inscription ;
6. remettez les identifiants temporaires uniquement à la personne concernée si Somafrik en génère.

Cette règle évite de créer un élève sans inscription scolaire clairement rattachée à une classe.

## 6. Annuaire Élèves et dossier élève

Ouvrez **Mon établissement → Élèves** pour rechercher un élève par nom, prénom, matricule, identifiant ou classe.

La liste affiche notamment :

- **Nom** ;
- **Prénom** ;
- **Matricule** ;
- **Classe** ;
- **Actions**.

Cliquez sur **Dossier** pour ouvrir l'espace de l'élève.

Si votre rôle possède le droit correspondant, **Archiver** retire l'élève de l'annuaire actif. L'archivage n'est pas présenté comme une suppression physique des données scolaires.

**Captures à intégrer :** `05-eleves-annuaire.png`, `06-eleve-dossier.png`.

## 7. Enseignants

Ouvrez **Mon établissement → Enseignants**.

La liste permet de consulter l'identité, l'identifiant enseignant, le contact, la spécialité et les affectations.

### Modifier un enseignant

Si autorisé, cliquez sur **Modifier**, corrigez les informations puis enregistrez.

### Affecter un cours

Si votre rôle possède le droit sur les affectations :

1. cliquez sur **Affecter un cours** ;
2. choisissez une classe active ;
3. choisissez un cours/matière disponible ;
4. enregistrez l'affectation.

### Créer l'identité d'un enseignant

Sur le Web, l'écran **Enseignants** n'est pas le point de création d'identité. La création se fait depuis **Mon établissement → Comptes utilisateurs**, puis le rôle **Enseignant** est attribué selon les droits disponibles.

### Archiver

L'action affichée comme **Supprimer** dans la liste conduit au cycle d'archivage serveur : le compte d'accès est désactivé. Vérifiez l'identité avant de confirmer.

**Captures à intégrer :** `07-enseignants-liste.png`, `08-enseignant-affectation.png`.

## 8. Comptes utilisateurs

Ouvrez **Mon établissement → Comptes utilisateurs** ou, selon votre rôle, **Administration → Utilisateurs**.

Un compte Somafrik contient une identité et peut recevoir un ou plusieurs rôles actifs. **Identité utilisateur** et **rôle** sont deux notions distinctes.

Selon vos permissions, vous pouvez :

- créer un utilisateur ;
- consulter sa fiche ;
- modifier son identité ;
- attribuer ou retirer des rôles autorisés ;
- suspendre ou réactiver un compte ;
- réinitialiser un mot de passe lorsque cette action est autorisée ;
- pour les rôles plateforme, gérer le périmètre pays/établissement selon les règles affichées.

### Créer un utilisateur

1. cliquez sur l'action de création ;
2. renseignez les champs d'identité demandés ;
3. choisissez uniquement un rôle que votre propre compte est autorisé à attribuer ;
4. définissez/remettez le secret temporaire selon le workflow affiché ;
5. enregistrez ;
6. communiquez les identifiants par un canal sécurisé.

### Attribuer des rôles

Utilisez l'action d'attribution des rôles. Somafrik applique les différences entre les rôles existants et la nouvelle sélection : les nouveaux rôles sont accordés et les rôles retirés sont révoqués.

La **matrice globale des droits par rôle** se gère sur le Web dans les écrans dédiés ; elle n'est pas modifiable depuis le Mobile.

**Captures à intégrer :** `09-utilisateurs-liste.png`, `10-utilisateur-roles.png`.

# Vie scolaire

## 9. Présences / Appel

Ouvrez **Présences**.

1. choisissez une classe dans votre périmètre ;
2. vérifiez la date et la classe affichées ;
3. pour chaque élève, choisissez **Présent**, **Absent**, **Retard** ou **Justifié** ;
4. utilisez **Tous présents** uniquement après avoir vérifié le roster ;
5. cliquez sur **Enregistrer l'appel** ;
6. attendez le message confirmant l'enregistrement.

L'écran affiche le taux de présence et les nombres de présents, absents, retards et justifiés. **Changer de classe** permet de revenir au choix du roster.

Un utilisateur sans droit de modification peut consulter l'écran sans obtenir les actions d'écriture.

**Captures à intégrer :** `11-presences-classes.png`, `12-presences-appel.png`.

## 10. Notes et évaluations

Ouvrez **Notes**. Le module Web comporte les onglets :

- **Évaluations** ;
- **Saisie des notes** ;
- **Par classe** ;
- **Par élève** ;
- **Statistiques**.

### Créer ou modifier une évaluation

Les actions de création/modification n'apparaissent que pour les utilisateurs habilités. Choisissez la classe, le cours, la période et les paramètres demandés par le formulaire.

### Saisir les notes

1. ouvrez **Saisie des notes** ;
2. sélectionnez une classe et une évaluation autorisées ;
3. saisissez les notes ;
4. vérifiez le barème et les élèves ;
5. enregistrez ;
6. ne quittez pas l'écran si Somafrik signale des **notes non enregistrées**.

La validation est réservée aux rôles habilités (par exemple préfecture/administration selon la matrice active). Une évaluation déjà validée ou publiée suit des règles plus strictes de correction.

**Captures à intégrer :** `13-evaluations.png`, `14-saisie-notes.png`.

# Finances

## 11. Paiements

Ouvrez **Finances → Paiements**.

Le module permet de consulter les paiements scolaires et, si votre rôle possède le droit de création, de saisir un encaissement via le formulaire métier disponible.

Lors d'une saisie :

1. identifiez l'élève ;
2. vérifiez son contexte scolaire/classe lorsque le formulaire le demande ;
3. sélectionnez le ou les frais concernés ;
4. saisissez le montant et le moyen de paiement ;
5. validez ;
6. ne considérez le paiement comme enregistré qu'après confirmation de Somafrik ;
7. contrôlez le reçu ou la ligne créée après actualisation.

Les modules **Frais** et **Impayés** sont accessibles depuis **Finances** selon les permissions.

**Captures à intégrer :** `15-paiements.png`, `16-paiement-saisie.png`.

# Planning et communication

## 12. Planning

Le menu **Planning** peut donner accès, selon les droits, à :

- **Emploi du temps → Calendrier** ;
- vue **Par classe** ;
- vue **Par enseignant** ;
- vue **Par salle** ;
- **Salles** ;
- **Remplacements** ;
- **Conflits**.

Utilisez uniquement les actions visibles dans votre périmètre. Les affectations pédagogiques d'un enseignant se gèrent depuis l'écran **Enseignants** lorsque l'action est disponible.

## 13. Messages, annonces et notifications

Somafrik distingue :

- **Messages** : échanges ciblés selon le périmètre autorisé ;
- **Annonces** : informations publiées à un ensemble de destinataires ;
- **Notifications** : événements ou informations de plateforme lorsque ce module est disponible.

La visibilité de ces pages dépend du rôle.

# Administration et paramètres

## 14. Administration

Selon les permissions, **Administration** peut donner accès à :

- **Utilisateurs** ;
- **Rôles et droits / Permissions** ;
- **Documents** ;
- **Conformité / Rapports**.

La matrice des droits est une fonction sensible. Ne modifiez un rôle que si vous connaissez l'impact des actions READ/CREATE/UPDATE/DELETE sur les utilisateurs concernés.

## 15. Paramètres

Le module **Paramètres** peut contenir :

- **Profil** ;
- **Année scolaire** ;
- **Structure** ;
- **Rôles et droits** ;
- **Finances** ;
- **Abonnements** ;
- **Notifications** ;
- **Documents / conception des bulletins** ;
- **Graphiques** ;
- **Sécurité** ;
- **Apparence** ;
- **Intégrations** ;
- **Données**.

La liste exacte dépend du rôle et des permissions. Avant toute modification structurelle (année scolaire, référentiel pédagogique, sécurité, données), vérifiez le périmètre de l'établissement actif.

# Administration plateforme

## 16. Super administrateur et Administrateur pays

Les rôles plateforme disposent d'écrans dédiés lorsque leurs permissions le permettent, notamment :

- **Pays** ;
- **Référentiels pédagogiques** ;
- **Établissements** ;
- **Abonnements** ;
- **Notifications** ;
- **Utilisateurs** ;
- **Permissions**.

Un Administrateur pays reste limité au périmètre autorisé de son pays. Un écran présent dans l'application ne signifie pas que toutes ses actions lui sont accordées.

# Dépannage

## 17. Je ne vois pas une action

Vérifiez d'abord votre rôle et vos permissions. Si la consultation fonctionne mais que **Ajouter**, **Modifier**, **Archiver**, **Supprimer**, **Affecter** ou **Enregistrer** n'apparaît pas, votre compte peut ne pas disposer de cette action.

## 18. Les données ne se mettent pas à jour

1. utilisez **Actualiser** lorsqu'il est disponible ;
2. vérifiez l'établissement actif ;
3. vérifiez votre connexion réseau ;
4. si une erreur de permission apparaît, ne répétez pas la mutation : faites vérifier vos droits ;
5. si l'erreur persiste, communiquez au support le module, l'heure, votre rôle et le message affiché, sans transmettre de mot de passe.

## 19. Mon compte est bloqué ou mon mot de passe est oublié

Adressez-vous à un administrateur habilité à gérer ou réinitialiser votre compte. Ne partagez jamais un ancien ou nouveau mot de passe par une conversation publique.

---

## Règle de vérité documentaire

Les procédures de ce guide sont rattachées aux écrans métier réels listés dans `CAPTURES-METIER.md`. Une fonctionnalité non vérifiée ou non exposée par le RBAC ne doit pas être ajoutée au guide sur la seule base d'une maquette, d'une ancienne PR ou du BackOffice legacy.
