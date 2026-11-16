# NFC-PROG-03 — Android — Programmation individuelle sécurisée

Date : 13 octobre 2026. **DRAFT / HOLD — DIFF CTO REQUIS — NO MERGE.**

## Provenance et périmètre

Branche isolée : `codex/nfc-prog-03-android-individual`, créée depuis le HEAD
contrôlé de #912 : `c6f5eaaa23711e4c797f1dac6a764a49f5039096`.
La base GitHub reste `develop`, merge-base contrôlée :
`1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`.
Le HEAD de livraison, l'inventaire définitif, les statistiques du diff et la CI
au SHA exact sont publiés dans la description de la PR.

Références vérifiées directement avant modification :

| Référence | Nature / statut | HEAD |
| --- | --- | --- |
| #909 | PR ouverte, Draft, non mergée | `91c2af5c5a6255f010fbbbf7f3b5f85a5d04cb22` |
| #910 | PR ouverte, Draft, non mergée | `c0230910b97a3c6aeb43ac7bd7a5c3b102e77231` |
| #911 | Issue ouverte de suivi, aucune PR | sans objet |
| #912 | PR ouverte, Draft, non mergée | `c6f5eaaa23711e4c797f1dac6a764a49f5039096` |

Le diff CTO propre à ce chantier est **#912 HEAD → HEAD de cette PR**.
Le diff contre `develop` inclut les 64 fichiers hérités de #909 et #912.
Les branches sources restent intactes. Aucun fichier Backend, SQL, registre,
lecteur, QR, présence, finance, transport ou configuration iOS n'est modifié
par l'incrément NFC-PROG-03. Aucune dépendance npm n'est ajoutée.

## Parcours et garanties

La fiche élève utilise déjà un panneau NFC et une clé de montage combinant
le périmètre authentifié et l'identité canonique de l'élève. Ce panneau reçoit
READ/UPDATE et l'état de blocage des mutations. Les rôles plateforme, parents
et élèves ne reçoivent pas ces droits via `ALL_PRIVILEGES`.

La liste canonique doit être obtenue, le flag doit être exactement `true`,
Android doit être utilisé et le matériel NFC doit être disponible et activé.
Un échec de chargement empêche toute programmation. Le téléphone est vérifié
à nouveau au début de chaque opération. L'API vérifie indépendamment le RBAC,
les flags et le tenant à chaque mutation.

1. L'utilisateur choisit **Programmer une carte NFC**, ou confirme explicitement
   **Remplacer la carte active**. Le Mobile recharge d'abord les cartes.
2. Il inspecte l'UID et le modèle par GET_VERSION, puis vérifie le NDEF vierge
   et l'absence de verrouillage. Le Backend #912 exige cette identité physique
   dans la demande de réservation : cette lecture préalable est nécessaire,
   contrairement à une réservation avant toute présentation de carte.
3. Un UUID d'intention est généré via le mécanisme UUID existant, puis envoyé
   au Backend. Aucun publicId, secret ou identifiant de registre n'est généré
   sur le téléphone. La réponse doit correspondre à l'opération, l'UID,
   le modèle et, le cas échéant, l'ancienne carte.
4. La réservation est `issued/pending`, non active, TTL serveur 30 minutes.
   Le Mobile écrit un seul enregistrement texte NDEF
   `somafrik:card:<publicId>.<secret>`, sans données personnelles.
5. Le pont natif vérifie le statut inscriptible et la capacité finie, écrit,
   puis annule la découverte et exige une **nouvelle découverte du même UID**.
   Cela évite de vérifier le cache Android de `react-native-nfc-manager` beta.10.
   L'utilisateur doit retirer et représenter la carte lorsque demandé.
6. Le contenu relu doit correspondre exactement au contenu attendu. La validité
   de l'opération est contrôlée avant et après chaque attente asynchrone,
   puis avant confirmation. L'état NFC inconnu refuse la confirmation.
7. Le Backend confirme transactionnellement. La réponse doit être la même
   réservation, avec le même UID/modèle/opération, `active` et `encoded/locked`.
   Alors seulement apparaît **Carte NFC programmée et activée avec succès.**

Le parcours ne possède aucune commande de verrouillage irréversible : le
bouton, l'aide de verrouillage, la méthode d'encodeur et le flux de verrouillage
hérités ont été retirés. Une carte déjà physiquement en lecture seule peut être
relue et confirmée ; `locked` est une observation, jamais une commande.

Les phases visibles couvrent préparation, attente NFC, écriture, vérification,
activation serveur, succès, erreur, expiration et reprise. Les deux verrous
UI/contrôleur empêchent les doubles clics et confirmations concurrentes.

## Contrat API effectivement utilisé

Toutes les routes passent par le client HTTP authentifié existant, son header
canonique d'établissement et son timeout. Aucun outbox ni cache de réponse
contenant la capability n'est introduit.

| Appel | Corps / résultat |
| --- | --- |
| `GET /api/students/:studentId/cards` | `{cards, nfcEnabled}` ; métadonnées de réservation et d'opération, aucun token |
| `POST /api/student-cards` | `{studentId, medium:"nfc", nfc:{uid,tagType}, operationId}` ; première réponse : carte plate `issued/pending`, `cardToken`, `tokenAvailable:true` |
| `POST /api/student-cards/:previousId/replace` | même corps ; nouvelle réservation plate, `nfc.replacesCardId` référence l'ancienne carte |
| `POST /api/student-cards/:id/nfc-confirm` | `{uid, tagType, cardToken, locked, studentId, operationId}` ; réponse canonique de la carte active |
| `POST /api/student-cards/:id/nfc-retry` | `{uid, tagType, operationId}` ; même réservation/UID/publicId, secret renouvelé une seule fois par UUID de retry, expiration inchangée |

`nfc.operationId`, `nfc.expiresAt` et `nfc.replacesCardId` viennent du Backend.
Les cartes actives encodées antérieures aux réservations, dont ces métadonnées
sont nulles, peuvent encore être relues/confirmées sans aucune rotation.
L'UUID de retry est distinct de l'UUID de réservation et représente une nouvelle
intention explicite. Un retry technique HTTP 401 réutilise le même corps.

**Limite du contrat #912 :** la confirmation reçoit `operationId` pour la
corrélation Mobile, mais le service actuel ne valide pas ce champ du payload.
Il lie la confirmation par l'id de réservation dans la route, l'établissement,
l'élève canonique transmis, l'UID/modèle et le hash du secret. L'idempotence
vient de l'état transactionnel de cette même réservation. Cette PR n'ajoute
aucune route de consultation d'opération ni nouvelle architecture Backend.
Le CTO doit examiner ce point lors du diff des dépendances.

## Reprises, interruptions et résultat inconnu

- Les erreurs sont traduites par une liste de codes en messages fixes. Aucun
  texte d'erreur natif/Backend, payload NFC ou secret ne peut être interpolé
  dans l'interface. Aucun secret n'est rendu, journalisé ou persisté.
- Le token reçu lors de la première réservation existe seulement dans la pile
  de l'opération en cours. Il n'est placé ni dans React state/ref, ni dans un
  store persistant. Après interruption, on relit la capability sur la puce.
- Après timeout de confirmation, on recharge la liste, inspecte la même carte,
  relit et confirme cette même réservation. Aucune écriture ni rotation ne se
  produit dans cette reprise. Une réponse active déjà confirmée est normale.
- Après perte de réponse de réservation, les métadonnées d'intention restent
  en RAM. La reprise interroge la liste ; si aucune ligne n'est visible, elle
  réutilise **exactement le même UUID/UID/contexte**. Aucun nouvel UUID de
  réservation n'est généré automatiquement.
- Un replay sans `cardToken`, avec `tokenAvailable:false`, est normal : lecture
  physique et confirmation. Une puce vierge demande une réécriture explicite.
- Après fermeture complète de l'application, la fiche retrouve les réservations
  via la liste canonique. Le Mobile ne dispose pas d'un journal durable d'intention
  avant visibilité de la ligne serveur. Les contraintes #912 interdisent une
  deuxième réservation en attente pour le même élève et la réutilisation d'UID.
- **Renouveler et réécrire avec confirmation** est une action distincte avec
  dialogue explicite. Elle recharge l'état, refuse une réservation inactive,
  un autre UID/modèle/publicId ou une puce verrouillée, puis demande un retry
  explicite et écrit sur cette même carte. Elle ne prolonge pas le TTL.
- La perte d'une réponse de retry n'entraîne pas un retry automatique. On revient
  à la relecture ; une nouvelle rotation exige une nouvelle confirmation explicite.
- Une expiration serveur/refus/revocation interdit l'activation. Une révocation
  canonique visible résout l'intention incertaine sans nouvelle émission automatique.
  L'UID reste historisé ; il faut une autre carte vierge pour une nouvelle émission.
- L'annulation ferme la session NFC et conserve la réservation pour reprise/expiration.
  Elle n'appelle aucune révocation : une confirmation serveur dont la réponse est
  perdue pourrait avoir déjà activé la carte. Les révocations métier existantes
  restent hors de ce parcours.
- Arrière-plan, annulation, changement des droits et fermeture d'écran invalident
  la génération asynchrone et ferment uniquement le lease de cet encodeur.
  Une confirmation déjà envoyée peut encore être validée côté serveur ; sa réponse
  obsolète ne donne pas un succès local. L'état canonique sera relu au retour.
- L'exclusivité, l'attente de fin d'annulation native et la quarantaine après
  échec de fermeture reposent sur le gestionnaire partagé #909, inchangé.

## Remplacement

La carte active est montrée et un dialogue explicite explique la bascule.
La réservation de la nouvelle carte n'entraîne aucune révocation de l'ancienne.
Une erreur d'écriture/lecture ou une interruption avant confirmation laisse
l'ancienne utilisable. Seule la confirmation #912 réalise `ancienne=replaced` et
`nouvelle=active` dans la même transaction avec audit. Le Mobile ne simule
jamais cette bascule et ne révoque jamais l'ancienne carte au préalable.

## Validation automatisée

Commandes locales et CI dédiée :

- `npm --prefix Mobile run test:student-card-nfc-encoding` : **52/52** tests.
  Réservation, activation après relecture/serveur, foreign/UID/modèle, capacité,
  indisponibilité, flag/RBAC, expiration/révocation, réseau, replays sans token,
  réponse perdue, reprise après redémarrage, rotation explicite, remplacement,
  doubles clics, annulation et réponses obsolètes.
- `npm --prefix Mobile run verify:student-card-qr` : PASS. Lecteur, présence et
  QR existants ; **15/15** tests de session/pont natif, dont capacité native
  NTAG213/216, statut/capacité inconnus et nouveau UID après écriture.
- `npm --prefix Mobile run typecheck` : PASS.
- `npm --prefix Mobile run verify:mobile-security` : PASS.
- `npm run verify:school-setup-lot4-red` : **9/9** PASS. Ajout de la seule référence
  exacte à ce rapport dans l'allowlist ; les refus hors périmètre restent testés.
- PostgreSQL 16 jetable local : **35/35** (29 tests SQL/lifecycle réel et 6 unitaires
  NFC), puis **7/7 runners** registre, lifecycle, resolve, présence, finance,
  HTTP de gestion et HTTP de scan. Isolation multi-établissements, RBAC,
  remplacement transactionnel et QR contrôlés par les suites héritées réelles.

La CI ajoute **NFC Android individual contracts** au HEAD candidat, avec
programmation, session native, lecteur/QR, types et sécurité. Le job APK hérité
attend ce contrôle et PostgreSQL. Aucun workflow APK manuel n'est déclenché.
Les résultats CI exacts seront rapportés dans la PR après exécution ; ce rapport
ne préjuge pas de leur réussite.

## Dépendances, risques et recette ultérieure

Revue indépendante CTO de #909 et #912, puis de ce diff incrémental avant Ready
ou merge. #910 fournit le contrat d'audit, #911 reste l'issue de suivi. Après
approbation seulement : déploiement Backend compatible et migration via le
processus autorisé, APK cohérent avec le même HEAD, puis NFC-PROG-05.

**Recette physique NTAG213/216 : NON EXÉCUTÉE.** Les mocks du pont React Native et
la CI ne prouvent pas le comportement RF d'un téléphone réel. Les cartes vierges
formatées NDEF et la découverte GET_VERSION sont requises ; aucun formatage brut
ou effacement de données étrangères n'est ajouté. Les délais natifs RF, les
retraits de carte et l'arrêt forcé Android doivent être vérifiés physiquement.

Prévoir des élèves/cartes de test dédiés : émission puis lecture métier ;
retrait pendant l'écriture ; relecture divergente ; interruption avant/après
confirmation avec réponse perdue ; retour d'arrière-plan et fermeture complète ;
NFC désactivé ; double clic/scan ; lecteur et encodeur concurrents ; TTL dépassé ;
remplacement échoué puis confirmé ; changement des droits/tenant/flags. Relever
modèle Android, version OS, modèle NTAG, SHA Mobile/Backend, ids d'opération et
résultats sans copier le secret. Aucun verrouillage irréversible pendant la recette.

La capability statique peut être clonée ; la possession de la carte n'est pas
une authentification forte. Les contrôles métier restent côté Backend.

Aucune programmation en série, multi-scan, finance, transport, paiement ou iOS.
**Ne pas commencer NFC-PROG-04 avant la revue CTO de NFC-PROG-03.**

**DRAFT / HOLD — DIFF CTO REQUIS — NO MERGE.**
