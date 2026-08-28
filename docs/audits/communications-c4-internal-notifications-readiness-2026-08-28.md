# COM-C4 — Notifications internes production-ready

Date : 2026-08-28  
Base de travail : `develop@5e150db5e2c2e042c5e82f6e684af05515dd554e`  
Périmètre : notifications internes Somafrik, sans fournisseur SMS/WhatsApp/push externe.

## Verdict de chantier

**État : PR Draft candidate — validation CI obligatoire avant GO CTO.**

COM-C4 sépare désormais deux domaines qui étaient auparavant confondus :

- les **notifications plateforme** historiques, réservées aux opérations Superadmin/Admin Pays ;
- les **notifications internes métier**, destinées aux utilisateurs d'un établissement et générées à partir d'événements métier ou d'une création humaine autorisée.

Aucune notification interne n'utilise la table plateforme historique comme source de vérité.

## Architecture canonique

### Outbox transactionnelle

`communication_event_outbox` enregistre dans la même transaction PostgreSQL que l'événement métier les événements suivants :

- `communication.message.created` ;
- `communication.announcement.published` ;
- `attendance.student.absent` ;
- `pedagogy.grade.published` ;
- `finance.payment.recorded`.

Les triggers font `ON CONFLICT (event_key) DO NOTHING`. Le dispatcher traite les événements avec verrouillage `FOR UPDATE SKIP LOCKED`. Une reprise après échec ne doit donc pas produire de doublon métier.

### Notifications et destinataires

`communication_notifications` porte la notification canonique : événement source, titre, contenu, expéditeur, horodatages ISO, navigation et métadonnées.

`notification_recipients` porte le destinataire individuel et son état :

- `read_at` ;
- `archived_at` ;
- contexte de résolution du destinataire.

La lecture et l'archive sont donc **par utilisateur**. Une archive n'efface pas physiquement l'historique de la notification.

## Politique des destinataires

### Nouveau message

Les destinataires proviennent exclusivement des participants actifs de la conversation. L'expéditeur du nouveau message est exclu de la notification générée pour son propre envoi.

### Nouvelle annonce

Les destinataires reprennent **exactement** le snapshot canonique `announcement_recipients` produit par COM-C3. Contrairement au message, aucun retrait implicite de l'auteur n'est effectué : si l'auteur appartient au snapshot publié, il reçoit la notification.

### Absence

Une absence canonique notifie les parents actifs réellement liés à l'élève par `contact_relations`.

### Note publiée

Une note publiée notifie les parents actifs liés et le compte élève canonique lorsqu'il existe. Le corps de notification n'expose pas automatiquement la valeur de la note.

### Paiement enregistré

Un paiement `paid` notifie les parents actifs liés à l'élève. Les autres comptes du même établissement ne sont pas considérés comme destinataires par simple appartenance au tenant.

## Expéditeur et horodatage

Notification automatique :

- `senderType = system` ;
- `senderUserId = null` ;
- `senderName = Somafrik`.

Notification créée par un humain :

- `senderType = user` ;
- `senderUserId` vient du principal authentifié ;
- `senderName` vient du compte PostgreSQL canonique ;
- un identifiant d'expéditeur fourni par le client n'est pas une autorité.

Les dates canoniques restent des timestamps ISO complets ; l'affichage localisé appartient au client Web/Mobile.

## Pièces jointes

Les notifications internes réutilisent le sous-système sécurisé `communication_attachments` avec `entity_type = notification` :

- upload contrôlé ;
- rattachement à la notification ;
- accès authentifié ;
- contrôle tenant ;
- contrôle destinataire ou gestionnaire autorisé ;
- refus IDOR inter-école et même-école pour un non-destinataire ;
- l'accès est à nouveau contrôlé par le RBAC live au téléchargement.

Une URL publique arbitraire n'est pas utilisée comme frontière de sécurité.

## RBAC et isolation

Les routes internes utilisent les permissions live suivantes :

- `Notifications:READ` pour consulter une notification et modifier **son propre état destinataire** (`read_at`, `archived_at`) ;
- `Notifications:CREATE` pour créer une notification humaine et téléverser ses pièces jointes ;
- `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` restent des privilèges de gestion selon le périmètre canonique.

Le marquage lu et l'archivage ne nécessitent volontairement pas `Notifications:UPDATE` : ce sont des mutations de l'état personnel du destinataire, et non une modification du contenu canonique de la notification. Exiger `UPDATE` empêcherait notamment un parent autorisé en lecture d'archiver sa propre notification.

Les tests C4 imposent notamment :

- révocation PostgreSQL `Notifications:READ` puis réutilisation du même JWT => `403` ;
- téléchargement de pièce jointe également refusé après révocation ;
- tenant B incapable de lire ou télécharger une ressource du tenant A ;
- utilisateur du tenant A non destinataire incapable de lire directement une notification A ;
- Superadmin `schoolCode=*` obligé de fournir un `effectiveSchoolCode` pour les ressources établissement.

## Web et Mobile

COM-C4 ajoute un centre de notifications internes distinct sur Web et Mobile :

- liste canonique serveur ;
- badge non-lu calculé côté serveur ;
- marquage lu persistant PostgreSQL ;
- archive utilisateur persistante ;
- pièces jointes ;
- date/heure ;
- expéditeur ;
- navigation vers la ressource métier quand le contexte existe.

Les compteurs ne dépendent pas de `localStorage`.

La page historique de notifications plateforme reste présente pour les fonctions plateforme ; COM-C4 ne transforme pas cette table en historique métier.

## Paramètres de notifications

Le chantier COM-C4 **n'active pas** de fournisseur externe et ne transforme pas `/parametres/notifications` en panneau de configuration SMS/WhatsApp/push. Cette étape reste hors périmètre tant que les canaux externes ne sont pas implémentés et audités séparément.

## E2E PostgreSQL réel

La fixture C4 respecte aussi le contrat d'identité V2 : la ligne `students` canonique est créée avant le compte utilisateur élève, et `users.user_code` reprend exactement `students.student_code`. Le test ne désactive ni ne contourne `STUDENT_CANONICAL_IDENTIFIER_REQUIRED`.

`backend/lib/communicationsC4.http.pg.test.js` couvre notamment :

- C4-01 : POST Message réel -> outbox -> notification destinataire ;
- C4-02 : annonce -> snapshot exact C3, y compris auteur s'il est destinataire ;
- C4-03 : absence -> parent lié uniquement ;
- C4-04 : note publiée -> parent + élève ;
- C4-05 : paiement `paid` -> parent lié ;
- C4-06 : read/unread individuel ;
- C4-09/10 : création humaine + pièce jointe sécurisée ;
- C4-11 : révocation RBAC live avec JWT inchangé ;
- C4-12 : Superadmin request-scoped ;
- C4-13 : idempotence dispatcher et création humaine ;
- C4-14 : rollback transactionnel => aucun événement orphelin ;
- C4-15 : blocage IDOR ;
- C4-16 : archive logique avec conservation physique de l'historique.

Le gate permanent `.github/workflows/communications-c4.yml` exécute PostgreSQL 16 réel, `npm run verify:communications-c4`, le build Web et le typecheck Mobile.

## Points volontairement hors périmètre

- SMS ;
- WhatsApp ;
- email transactionnel externe ;
- push Expo/FCM/APNs ;
- préférences utilisateur multi-canal ;
- cadence/digest externe ;
- délivrabilité fournisseur.

Ces éléments doivent faire l'objet d'un chantier ultérieur distinct avec consentement, préférences, sécurité, coûts et observabilité propres.

## Critères de GO CTO avant merge

Le merge ne peut être envisagé qu'après :

1. diff GitHub indépendant `develop -> HEAD` ;
2. branche `0 behind` et merge-base égal au `develop` courant ;
3. aucun conflit ;
4. workflow `Communications C4` vert sur le HEAD exact ;
5. PR Gates standard verts sur le HEAD exact ;
6. absence de dérive de périmètre ;
7. revalidation complète si le HEAD ou `develop` bouge.
