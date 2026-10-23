# CARTE-BATCH-API-02 — Préparation et activation des cartes QR par classe

**DRAFT / HOLD — protocole HTTP et PostgreSQL. Aucune fusion, aucun déploiement.**

Le précontrôle de classe est déjà livré (`GET /api/classes/:classCode/student-cards/preflight`). Ce lot ajoute la préparation, l'accusé de réception et l'activation. Il ne produit pas le PDF (CARTE-BATCH-PDF-02) et n'ajoute pas le bouton de classe (CARTE-BATCH-WEB-01). L'encodage NFC d'une carte QR déjà active reste un parcours ultérieur, sur la même carte (`POST /api/student-cards/:id/nfc-provision`).

## Phases

| Phase | Statut | Effet |
| --- | --- | --- |
| Préparation | `prepared` | Cartes `issued`, support `qr`, non scannables. Secret et nonce renvoyés une seule fois. |
| Réception technique | `received` | Le corps HTTP de préparation est arrivé. Le PDF n'est pas encore déclaré sauvegardé. Aucune activation. |
| Sauvegarde | `saved` | L'opérateur représente les secrets qu'il détient (document imprimable). Aucune activation. |
| Activation | `activated` | Les cartes `issued` du lot passent `active`. Même `id`, `public_id` et `token_hash`. NFC toujours vide. |
| Abandon | `aborted` | Cartes encore `issued` révoquées (`batch_delivery_aborted`). |
| Expiration | `expired` | Au-delà de 30 minutes, avant activation : même révocation (`batch_delivery_expired`). |

Une carte déjà `active` dans la classe n'est ni remplacée, ni révoquée, ni réexportée. Si une carte active apparaît entre la préparation et l'activation, la carte préparée est révoquée (`batch_superseded_by_active`) et la carte active existante est laissée intacte.

Le corps de `POST .../batches` est ignoré. Le plan est reconstruit côté serveur (roster, titulaire, carte active).

## Secrets

Le secret QR et le nonce de livraison ne sont jamais écrits en clair : uniquement `token_hash` et `delivery_nonce_hash` (SHA-256). Ils ne figurent pas dans l'audit, les lignes de lot, ni une clé d'idempotence. Il n'y a pas d'idempotence HTTP sur ces routes : une réponse perdue ne peut pas être rejouée depuis le serveur pour retrouver un secret non stocké.

La réponse de préparation est le seul message qui contient `deliveryNonce` et `cardToken`. Les lectures, accusés, activations et abandons répondent `secretsIncluded: false`.

## Reprise après coupure

| Situation | Ce que le client possède | Comportement |
| --- | --- | --- |
| Réponse de préparation perdue, accusé technique non enregistré | Rien | Un nouvel essai répond `409 STUDENT_CARD_BATCH_PENDING` avec `batchId`, `publicIds` et `secretsRecoverable: false`. Aucun nouveau secret. Abandon explicite (audité, sans nonce), puis nouvelle préparation. L'ancien QR ne s'active jamais. |
| Accusé technique commis, réponse perdue, nonce encore en mémoire | Nonce | Réessayer `kind: technical`. |
| Accusé technique commis, nonce perdu, secrets encore dans le document | Secrets du document + `batchId` du 409 | `kind: saved`, puis activation. Le nonce n'est pas dans le document. |
| Document sauvegardé sans accusé technique | Secrets seuls | Activation refusée (`STUDENT_CARD_BATCH_RECEIPT_REQUIRED`). Abandon puis réimpression. La réception technique ne se déduit pas du fichier. |
| Activation commise, réponse perdue | Secrets | Réessayer l'activation. Même carte, aucun second jeton, aucune seconde ligne. |
| Deux opérateurs | — | Le second reçoit 409. Pas de réémission silencieuse : il faut abandonner le lot ouvert. |

La sauvegarde déclarée par l'opérateur et la réception technique du message HTTP sont deux preuves différentes. L'activation en exige les deux, et redemande les secrets.

## Autorisation

Même permission que l'émission unitaire (`Élèves:UPDATE` / `Gérer élèves`), scope établissement, année courante, titulaire déterminé, cartes et QR activés. `Cache-Control: no-store`. Un administrateur plateforme reçoit `403 PLATFORM_PERSONAL_DATA_DENIED` avant tout accès aux données de l'établissement.
