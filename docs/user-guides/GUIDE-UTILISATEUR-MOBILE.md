# Guide utilisateur Somafrik — Mobile

> Référence fonctionnelle : `develop@3be39cfee2718157cfd54993b2745b4aa2dd1fb1`  
> Interface : application Expo/React Native + API canonique + PostgreSQL.  
> Les menus sont filtrés par rôle et permissions.

## 1. Se connecter

L'application Mobile adapte l'écran de connexion au contexte choisi.

Pour un compte d'établissement :

1. choisissez/rejoignez votre établissement ;
2. saisissez votre **Identifiant** ;
3. Somafrik identifie le rôle lorsque le flux le permet ;
4. saisissez le **Mot de passe** ou le **PIN** demandé ;
5. appuyez sur **Se connecter**.

Les comptes Parent/Élève utilisent le champ PIN lorsque ce mode est associé au rôle. Les autres profils utilisent le mot de passe prévu par leur compte.

### Première connexion

Si un secret temporaire a été utilisé, la fenêtre **Nouveau mot de passe** apparaît :

1. saisissez le nouveau mot de passe ;
2. confirmez-le ;
3. appuyez sur **Valider**.

Le nouveau mot de passe doit contenir au moins 6 caractères et les deux valeurs doivent correspondre.

**Capture à intégrer :** `assets/mobile/01-connexion-etablissement.png`.

## 2. Navigation Mobile

Somafrik utilise plusieurs niveaux de navigation :

- **Accueil** ;
- jusqu'à quatre onglets métier visibles en bas selon le rôle ;
- un menu de navigation complémentaire ;
- des raccourcis sur l'Accueil pour les fonctions non présentes dans les onglets.

Toutes les entrées sont filtrées par les permissions de la session. Le même rôle peut donc voir un menu différent si la matrice de droits a été adaptée.

> **Pourquoi un bouton manque-t-il ?**  
> La présence d'un écran dans l'application ne donne pas automatiquement le droit d'y accéder ou de le modifier. Somafrik applique les permissions avant d'afficher les actions.

# Parcours Admin établissement / équipe administrative

## 3. Menu métier

Pour les rôles d'établissement internes, le catalogue Mobile actuel peut proposer, selon les droits :

- **Élèves** ;
- **Classes** ;
- **Enseignants** ;
- **Utilisateurs** ;
- **Paramètres** ;
- **Structure pédagogique** ;
- **Paiements** ;
- **Présences** ;
- **Notes** ;
- **Emploi du temps** ;
- **Bulletins** ;
- **Annonces** ;
- **Messages** ;
- **Documents** ;
- **Rapports** ;
- **Synchronisation** ;
- **Mode hors ligne** ;
- **Support**.

Cette liste est un catalogue : les éléments sans droit de lecture sont retirés avant affichage.

## 4. Classes

Ouvrez **Classes**.

L'écran affiche :

- le nombre de **Classes actives** ;
- le nombre d'**Élèves inscrits** ;
- la **Liste des classes** ;
- le taux de présence de chaque classe ;
- le code de classe lorsqu'il existe ;
- le professeur principal lorsqu'il est connu.

Utilisez la recherche pour retrouver une classe par nom ou code.

### Créer une classe

Si **Créer une classe** est visible :

1. appuyez sur **Créer une classe** ;
2. vérifiez l'**Année scolaire** ;
3. choisissez le **Niveau** ;
4. choisissez l'orientation pédagogique si nécessaire ;
5. choisissez le **Groupe** demandé par l'interface actuelle ;
6. enregistrez.

Si aucune année scolaire n'est chargeable, l'application indique de la configurer sur le Web avant de réessayer.

> Vérifiez les valeurs présélectionnées avant validation. Elles proviennent du catalogue pédagogique actif de l'établissement.

### Modifier ou désactiver

Si votre rôle le permet, une classe propose **Modifier** et **Désactiver**. La désactivation demande confirmation avant l'écriture serveur.

**Captures à intégrer :** `02-classes-liste.png`, `03-classe-creation.png`.

## 5. Élèves

Ouvrez **Élèves** ou ouvrez une classe puis sa liste d'élèves.

Vous pouvez rechercher un élève par nom ou matricule. Une fiche affiche notamment son nom, son matricule, sa classe et un indicateur de présence.

Appuyez sur la ligne d'un élève pour ouvrir sa fiche lorsque votre rôle possède le droit correspondant.

### Inscrire un élève

Si le bouton **Inscrire un élève** est visible :

1. appuyez sur **Inscrire un élève** ;
2. choisissez la **Classe** ;
3. saisissez le **Prénom** ;
4. saisissez le **Nom** ;
5. renseignez éventuellement le **Téléphone du parent** ;
6. enregistrez.

Après une inscription réussie, Somafrik ouvre **Remettre les identifiants élève**. Ces informations sont affichées pour être remises à la personne concernée. Ne fermez pas cette étape avant d'avoir transmis les identifiants par un canal sûr.

Le même numéro de parent peut être utilisé pour plusieurs frères et sœurs lorsque le workflow le permet.

### Modifier ou retirer

Les actions de ligne sont regroupées dans le menu d'actions de l'élève lorsque votre rôle possède UPDATE/DELETE. Une suppression demande confirmation avant l'appel serveur.

**Captures à intégrer :** `04-eleves-liste.png`, `05-eleve-inscription.png`, `06-eleve-identifiants.png`.

## 6. Enseignants

Ouvrez **Enseignants**.

La liste affiche notamment :

- nom ;
- identifiant enseignant ;
- cours ;
- classes affectées ;
- statut ;
- téléphone lorsqu'il est renseigné.

### Créer un enseignant sur Mobile

Lorsque **Créer un enseignant** est visible :

1. saisissez **Prénom** et **Nom** ;
2. renseignez éventuellement **Téléphone**, **Email** et **Date de naissance** ;
3. saisissez le **Mot de passe temporaire** ;
4. enregistrez ;
5. remettez les identifiants depuis la fenêtre **Remettre les identifiants enseignant**.

Le contrôle Mobile utilise le workflow canonique de création d'identité enseignant côté serveur. La modification de la **matrice des droits** reste Web-only.

### Affectations

L'écran contient également le contrôle d'affectation lorsque le rôle est habilité. Les cours, classes et matières proviennent des données canoniques disponibles pour l'établissement.

### Modifier / Archiver

Si votre rôle le permet :

- **Modifier** met à jour les données autorisées ;
- **Archiver** désactive l'accès de l'enseignant côté serveur après confirmation.

**Captures à intégrer :** `07-enseignants.png`, `08-enseignant-creation.png`.

## 7. Utilisateurs

Ouvrez **Utilisateurs**.

Chaque carte peut afficher : identité, identifiant, rôles actifs, statut, établissement, e-mail et téléphone.

### Créer un utilisateur

Si **Créer un utilisateur** est visible :

1. saisissez **Prénom** et **Nom** ;
2. renseignez l'e-mail et/ou le téléphone si nécessaire ;
3. saisissez un **Mot de passe temporaire** ;
4. enregistrez ;
5. remettez les identifiants depuis **Remettre les identifiants utilisateur**.

### Attribuer le rôle Enseignant

Pour un compte qui ne possède pas déjà ce rôle, l'action **Attribuer Enseignant** peut être proposée si votre session est autorisée :

1. appuyez sur **Attribuer Enseignant** ;
2. vérifiez le compte concerné ;
3. confirmez **Attribuer** ;
4. rechargez la liste et vérifiez **Rôles actifs**.

La gestion complète des rôles et de la matrice de permissions reste disponible sur le Web.

**Captures à intégrer :** `09-utilisateurs.png`, `10-utilisateur-creation.png`, `11-utilisateur-role-enseignant.png`.

## 8. Paiements

Ouvrez **Paiements**.

L'écran affiche notamment :

- **Frais de scolarité estimés** ;
- **Reste estimé** ;
- **Montant encaissé** ;
- nombres de paiements **Payés** et **Impayés** ;
- **Reçus récents**.

### Saisir un paiement

Si **Saisir un paiement** est visible :

1. appuyez sur **Saisir un paiement** ;
2. choisissez l'**Élève** ;
3. vérifiez/choisissez la **Classe** active associée à l'élève ;
4. saisissez le **Montant** ;
5. choisissez le **Type de frais** : Scolarité, Inscription ou Cantine ;
6. choisissez le **Moyen** : Espèces, Mobile Money ou Virement ;
7. enregistrez ;
8. attendez la confirmation serveur ;
9. contrôlez le reçu dans **Reçus récents**.

Une mutation placée en file d'attente réseau n'est pas présentée comme un paiement confirmé. Ne percevez pas une deuxième fois le même montant simplement parce que la connexion est lente.

**Captures à intégrer :** `12-paiements.png`, `13-paiement-saisie.png`, `14-paiement-recu.png`.

## 9. Présences / Appel

Ouvrez **Présences** ou **Appel** selon le libellé de votre rôle.

### Choisir la classe

L'écran commence par **Mes classes**. Chaque carte affiche la classe, le nombre d'élèves, le cours lorsque disponible et le nombre d'appels déjà enregistrés aujourd'hui.

1. appuyez sur la classe ;
2. vérifiez **Appel de [classe]**, la date et l'heure ;
3. attribuez un statut à chaque élève : **Présent**, **Absent**, **Retard** ou **Justifié** ;
4. utilisez l'action globale de présence uniquement après vérification du roster ;
5. enregistrez l'appel.

Somafrik refuse l'écriture si votre rôle ne possède pas le droit de modifier les présences.

### Réseau faible

Si l'appel est conservé en file d'attente, l'application indique qu'il n'est pas encore confirmé. Après retour du réseau, vérifiez la synchronisation et l'état serveur avant de considérer l'appel comme enregistré.

**Captures à intégrer :** `15-presences-classes.png`, `16-presences-appel.png`.

## 10. Notes et évaluations

Ouvrez **Notes**.

### Nouvelle évaluation

Si votre rôle possède le droit correspondant :

1. ouvrez **Nouvelle évaluation** ;
2. choisissez une **Classe / cours autorisés** ;
3. choisissez la période canonique ;
4. choisissez un type d'évaluation actif ;
5. renseignez la date, le barème et le titre demandés ;
6. créez l'évaluation.

Un enseignant ne choisit pas librement un `teacherId` et ne peut pas forcer une évaluation comme validée à la création.

### Saisir les notes

1. ouvrez une évaluation disponible pour la saisie ;
2. vérifiez le roster ;
3. saisissez la note ou marquez l'élève absent lorsque nécessaire ;
4. vérifiez que les valeurs respectent le barème ;
5. enregistrez ;
6. attendez la confirmation.

Une note placée en file d'attente n'est pas affichée comme définitivement confirmée. La validation d'une évaluation est réservée aux utilisateurs habilités ; un enseignant ne peut pas valider lui-même une évaluation si la politique courante l'interdit.

**Captures à intégrer :** `17-evaluations.png`, `18-evaluation-creation.png`, `19-notes-saisie.png`.

# Parcours Enseignant

## 11. Onglets principaux

Pour un enseignant, le catalogue d'onglets métier est centré sur :

- **Classes** ;
- **Élèves** ;
- **Appel** ;
- **Notes**.

Le menu complémentaire peut aussi proposer, selon les droits :

- **Mes classes** ;
- **Mes élèves** ;
- **Emploi du temps** ;
- **Bulletins** ;
- **Annonces** ;
- **Messages** ;
- **Synchronisation** ;
- **Support**.

Les listes sont limitées au périmètre autorisé de l'enseignant et à ses affectations lorsqu'elles sont disponibles.

## 12. Routine quotidienne enseignant

1. ouvrez **Mes classes** ;
2. vérifiez les élèves de la classe ;
3. ouvrez **Appel** et enregistrez les présences ;
4. ouvrez **Notes** pour les évaluations autorisées ;
5. contrôlez **Emploi du temps** et les messages/annonces si ces entrées sont accessibles.

# Parcours Préfet / Direction

## 13. Préfet, principal, proviseur

Les onglets Mobile utilisent un socle proche du parcours enseignant pour les fonctions quotidiennes, puis le RBAC élargit ou réduit les capacités effectives.

Un membre de la direction peut, selon ses droits, consulter davantage de classes ou disposer d'actions de validation qui restent interdites à un enseignant.

Ne déduisez jamais une permission du seul titre du poste : fiez-vous aux actions réellement affichées et aux refus serveur.

# Parcours Secrétaire / Comptable

## 14. Secrétaire et comptable

Le catalogue d'onglets vise principalement :

- **Élèves** ;
- **Appel / Présences** ;
- **Frais / Paiements**.

Les autres entrées du menu sont ajoutées ou retirées par les permissions de la session. Un comptable ne reçoit pas automatiquement des droits pédagogiques et un secrétaire ne reçoit pas automatiquement la gestion complète des comptes.

# Parcours Parent

## 15. Parent

Les onglets parent permettent, selon les droits et données disponibles :

- **Profil** ;
- **Notes** ;
- **Présence** ;
- **Frais**.

Le menu complémentaire peut proposer **Bulletins**, **Messages**, **Annonces**, **Paiement mobile**, **Mode hors ligne** et **Support**.

Le parent ne doit voir que les données des enfants liés à son identité. Si une donnée d'un autre élève apparaît, ne poursuivez pas la consultation et signalez immédiatement l'anomalie au support.

# Parcours Élève

## 16. Élève

Les onglets élève permettent principalement de consulter :

- **Profil** ;
- **Notes** ;
- **Présence** ;
- **Frais**.

Le menu complémentaire peut proposer **Emploi du temps**, **Bulletins**, **Messages**, **Annonces**, **Mode hors ligne** et **Support** selon les permissions.

# Paramètres et structure

## 17. Paramètres Mobile

Pour les rôles internes autorisés, le menu actuel contient des entrées **Paramètres** et **Structure pédagogique**. Elles restent filtrées par les droits de lecture.

Les réglages sensibles restent protégés par les permissions serveur. Une entrée visible ne doit pas être interprétée comme une autorisation de modifier toutes les configurations.

La création d'une année scolaire peut rester nécessaire sur le Web lorsqu'un workflow Mobile indique explicitement : **Configurez-la sur le Web, puis réessayez**.

# Synchronisation et mode hors ligne

## 18. Comprendre les états

Somafrik distingue au minimum trois situations importantes :

- **confirmé** : le serveur a accepté et renvoyé la mutation ;
- **en attente / file d'attente** : la mutation est conservée pour une reprise ultérieure ;
- **échec** : la mutation n'a pas été confirmée.

Une action en file d'attente n'est **pas** un succès serveur.

### Si Internet disparaît

1. ne répétez pas immédiatement une opération sensible (paiement, appel, note) ;
2. lisez le message affiché ;
3. ouvrez **Synchronisation** ou **Mode hors ligne** si votre rôle y a accès ;
4. attendez le retour du réseau ;
5. relancez la synchronisation selon les contrôles disponibles ;
6. rechargez l'écran métier ;
7. vérifiez que la donnée existe réellement côté serveur.

# Sécurité et dépannage

## 19. Je ne vois pas un bouton

Le bouton est probablement filtré par votre rôle/permission. Contactez l'administrateur habilité au lieu d'utiliser un autre compte.

## 20. L'application affiche « Accès refusé »

N'insistez pas sur la mutation. Vérifiez que vous êtes connecté au bon compte et au bon établissement, puis demandez une vérification de vos droits.

## 21. Les données semblent anciennes

- tirez pour actualiser lorsqu'un écran le permet ;
- vérifiez le réseau ;
- vérifiez le contexte établissement ;
- consultez la synchronisation ;
- après une reprise réseau, rechargez le module.

## 22. Identifiants temporaires

Les fenêtres **Remettre les identifiants élève / enseignant / utilisateur** servent à remettre un secret provisoire. Ne publiez pas ces informations dans un groupe de discussion ou dans une capture destinée au guide.

---

## Règle de vérité documentaire

Chaque capture future doit correspondre à un composant réel de `develop` et au rôle indiqué dans `CAPTURES-METIER.md`. Aucun mockup ne peut remplacer une capture runtime de Somafrik.
