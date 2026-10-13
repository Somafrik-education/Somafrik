# NFC-PROG-02 — Backend/PostgreSQL — programmation NFC sécurisée

**DRAFT / HOLD — NO READY — NO MERGE.** Aucun déploiement ni smoke physique.
Le CTO reporte la recette physique après le développement des lots #02–05.
Ce lot porte uniquement le cycle de vie backend ; aucune programmation en série
et aucun changement Mobile ne sont ajoutés.

## Base, dépendances et diff isolé

Vérification GitHub du 13 octobre 2026 :

| Référence | SHA | État au démarrage |
| --- | --- | --- |
| develop | `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f` | Cible finale |
| #909 | `91c2af5c5a6255f010fbbbf7f3b5f85a5d04cb22` | Open / Draft, non mergée |
| #910 | `c0230910b97a3c6aeb43ac7bd7a5c3b102e77231` | Open / Draft, non mergée |
| #911 recherché avant création | — | API GitHub 404 ; aucun correctif disponible à réconcilier |

Branche dédiée : `codex/nfc-prog-02-backend-postgres`, issue directement du HEAD
#909 vérifié, conformément au mandat autorisant une branche dépendante. Le lot
réutilise les commits de #909 sans les recopier ni modifier sa branche. #909
contient l'encodeur et le singleton natif ; ce lot ne les réimplémente pas.

La PR cible develop mais son diff total inclut la dépendance non mergée #909.
Le **diff incrémental à relire pour NFC-PROG-02** compare le SHA #909 ci-dessus au
HEAD de ce lot. Les deux diffs, les SHA complets, merge-base, ahead/behind, liste
de fichiers, CI et URL de livraison figurent dans la description GitHub.
Après intégration autorisée de #909, réappliquer seulement les commits propres
au lot sur develop vérifié et rejouer les validations nécessaires.
Ne demander aucun merge tant que cette dépendance n'est pas résolue.

## Contrat backend implémenté

### Réservation physique

`POST /api/student-cards` avec `medium=nfc` ou `nfc_qr` et identité NFC :

```json
{
  "studentId": "<UUID canonique élève>",
  "medium": "nfc",
  "nfc": { "uid": "<UID NXP normalisé de sept octets>", "tagType": "NTAG216" },
  "operationId": "<UUID aléatoire propre à cette opération>"
}
```

Le serveur réserve une ligne **issued/pending**, génère la capability canonique,
et calcule une expiration de **30 minutes** à partir de l'heure PostgreSQL.
Le client ne choisit ni le délai, ni le hash, ni le statut. Le scan refuse toute
réservation non active, même si le NDEF a déjà été écrit physiquement.
L'UUID d'opération est requis pour la réservation et pour une rotation pending.
Le format reste `somafrik:card:<publicId>.<secret>` ; le secret est une capability
de carte révocable, jamais un identifiant de connexion utilisateur.

Première réponse : référence de carte, `status=issued`, `nfc.state=pending`,
`nfc.operationId`, `nfc.expiresAt`, `nfc.replacesCardId`, token volatil et
`tokenAvailable=true`. La réponse est no-store.

Même opération et mêmes paramètres : même carte, `idempotentReplay=true`,
`tokenAvailable=false`, **aucun token restitué**. Un UUID réutilisé pour un autre
élève, UID, modèle, support, remplacement ou auteur est refusé. Une réservation
révoquée/expirée ne peut pas être réactivée par replay.

Le secret n'est pas conservé en clair pour fabriquer une réponse identique après
perte réseau. L'idempotence garantit la référence et les effets, pas la répétition
d'un secret plaintext. Aucun cache générique d'idempotence ne reçoit ces réponses.

### Confirmation, expiry et reprise

Séquence : **réserver → écrire → relire → confirmer → activer**.
`POST /api/student-cards/:id/nfc-confirm` conserve UID, tagType, cardToken et
`locked` booléen du contrat #909. `studentId`, s'il est fourni, doit correspondre
à l'élève canonique de la carte.

Chaque confirmation, y compris un replay, revérifie rôle UPDATE, scope école,
master/NFC flags, carte/élève tenant, token/hash, UID/modèle et état.
L'élève est verrouillé avec FOR NO KEY UPDATE, puis les cartes impliquées sont
verrouillées. Les paramètres d'école sont lus sous FOR SHARE jusqu'au commit.
Le prédicat d'activation vérifie aussi la date PostgreSQL au moment de l'UPDATE.

Une première confirmation passe issued/pending à active/encoded et écrit l'audit
dans **la même transaction PostgreSQL**. Un replay valide renvoie l'état actuel
sans seconde association ni second audit de transition. Une panne d'audit SQL
rollbacke activation, bascule de remplacement et audits déjà tentés.
Une capability active confirmée ne devient pas expirée quand l'ancien délai
de préparation passe ; elle reste soumise aux états lost/revoked/replaced.

Une réservation expirée est refusée avec `STUDENT_CARD_NFC_EXPIRED`. La transition
vers revoked et son audit sont commités avant ce refus. Le nettoyage est **paresseux** :
à confirmation/retry d'une réservation expirée et à une nouvelle réservation
valide du même élève. Aucun job d'expiration n'est ajouté. Une ligne expirée
encore issued ne peut jamais être scannée ou activée ; la sécurité ne dépend
pas du passage d'un cleanup. Une requête échouée/rollbackée peut conserver
la ligne issued expirée jusqu'à une opération ultérieure.

Reprise après écriture : lire le token sur la carte puis confirmer la réservation
valide ; aucune rotation requise si ce contenu est encore valide. Si la réponse
de réservation a été perdue avant écriture, retrouver sa référence par replay
ou liste, puis envoyer un `operationId` nouveau à `/nfc-retry` pour tourner le
secret de la même ligne. Le TTL original n'est jamais prolongé.
Le même UUID de retry, même ancien après une rotation plus récente, ne tourne
plus le secret et ne duplique pas son audit ; il renvoie uniquement la référence
et l'état. Les UUID de retry déjà traités sont conservés sur la carte canonique,
sans aucun secret. Un token obsolète est refusé à confirmation.

L'abandon utilise la révocation existante : `/revoke`, raison `nfc_abandoned`.
Les états issued et active NFC peuvent être révoqués transactionnellement ;
répéter la révocation ne crée pas de second audit. Une perte concerne active.
L'UID reste réservé dans l'historique après abandon, expiration, perte ou révocation.
Aucun recyclage automatique ni réparation de NDEF partiel n'est implémenté.

### Remplacement sécurisé

`POST /api/student-cards/:ancienneId/replace` avec `nfc` et `operationId` prépare
une nouvelle ligne issued/pending ; la réponse est une carte réservée à la racine,
et non le couple previous/card du remplacement QR immédiat.
L'ancienne carte active reste utilisable pendant programmation et relecture.
À confirmation, la même transaction marque l'ancienne replaced avec le lien
historique, puis active la nouvelle et écrit les audits.
Une ancienne carte lost peut être remplacée sans jamais être réactivée.
Une ancienne carte déjà revoked/replaced à confirmation refuse la bascule.

Les contraintes PostgreSQL interdisent deux actives et deux réservations NFC
ouvertes pour un élève, les UID dupliqués et les liens de remplacement entre
élèves/établissements. Deux appareils préparant le même remplacement ne créent
pas deux réservations ouvertes.

Le remplacement immédiat existant est conservé pour les cartes QR sans lien UID.
Pour une carte physiquement associée NFC, appeler ce chemin sans nouvelle identité
est refusé (`STUDENT_CARD_NFC_REPLACEMENT_REQUIRED`) afin de ne pas contourner la
préparation sécurisée. Les champs internes de tests, dont failAfterInsert, ne
sont pas exposés par le contrôleur HTTP.

### QR, présence, finance et verrouillage

L'émission QR et nfc_qr sans identité physique conserve le contrat historique,
y compris remplacement/impression QR ; une émission pure nfc exige désormais
une identité et un UUID d'opération. Les fixtures de cycle de vie/résolution
historiques utilisant nfc sans identité passent à nfc_qr pour tester le chemin QR
inchangé. Les comportements NFC transactionnels sont vérifiés sur PostgreSQL réel,
en remplacement des anciennes mutations simulées de #909.

Aucune logique de présence, finance ou transport n'est modifiée. La résolution
canonique accepte une carte confirmée et refuse pending/inactive. Les flags de
présence/finance et leurs droits restent indépendants. Les routes canoniques et
le deny plateforme sont réutilisés ; aucun nouveau rôle ni accès plateforme.

Le backend ne commande aucun verrouillage de puce. Pour préserver l'historique
#909, il peut enregistrer l'observation read-only `locked=true` après une lecture
autorisée ; elle est monotone et son audit n'est écrit qu'au changement d'état.
Ce n'est pas une attestation matérielle ni une action native de verrouillage.
Le masquage de l'action native dans le parcours individuel relève de NFC-PROG-03.

## Migration ciblée

`backend/db/migrations/20261013_student_cards_nfc_reservations.sql` dépend du
registre canonique et de la migration NFC de #909. Elle ajoute seulement :

- nfc_operation_id et son unicité par école ;
- nfc_reservation_expires_at ;
- nfc_replaces_card_id et sa FK composite du même élève/tenant ;
- nfc_retry_operation_ids, sans token ;
- CHECK pending non actif et unicité d'une réservation NFC ouverte par élève.

Les anciennes lignes pending de #909 reçoivent un UUID et `issued_at + 30 minutes`.
Celles active/pending deviennent issued/pending. Le temps n'est jamais recalculé
à un redémarrage. Les UID, hashes, auteurs, liens et lignes historiques restent
conservés ; aucune suppression. Les cartes déjà encoded/locked restent inchangées.

Le module de schéma lit la migration comme source SQL unique. schema.sql et le
boot canonique existant restent alignés ; aucune migration request-time n'est
introduite dans un handler. Le SQL a été testé deux fois sur un schéma legacy
isolé. **Aucune migration n'a été exécutée en production/préproduction.**

## Tests et CI

- 55 tests backend ciblés : helpers/flags/RBAC, registre, QR, présence, finance.
- 28 nouveaux tests PostgreSQL lifecycle + 1 test SQL NFC existant, sans skip :
  TTL, non-activation, replay, secret absent, migrations, contraintes/FK, concurrence,
  remplacement, rollback audit SQL, perte/révocation et refus de réactivation.
- 7 runners PostgreSQL historiques : registre, lifecycle, resolve, attendance,
  finance, HTTP et scan HTTP. Le HTTP réel ajoute perte de réponse réservation et
  confirmation, rollback sur trigger d'audit en erreur, RBAC, flags, tenant et
  préparation/bascule de remplacement, avec audits et cache inspectés.
- Guard cartes et LOT4 contrôlé. L'allowlist LOT4 ajoute trois chemins exacts pour
  le module SQL, sa migration et ce document ; aucun wildcard supplémentaire.
- Workflow NFC PostgreSQL étendu aux vrais tests lifecycle/HTTP et régressions,
  sur son PostgreSQL 16 jetable. Aucune URL applicative utilisée : son DATABASE_URL
  est explicitement celle du conteneur CI de test.

La suite nouvelle accepte seulement une URL PostgreSQL locale explicite vers
`nfc_prog_02_test` ou `nfc_encoding_test`, crée un schéma aléatoire et le détruit
après les tests. Les anciens runners effacent leur schéma de base dédié : les
exécuter seulement sur le conteneur jetable, jamais avec une URL applicative.
Les comptes de tests et résultats définitifs CI au HEAD sont consignés dans la PR.

## Incompatibilités restantes et gate d'intégration

**Le Mobile #909 n'est pas encore adapté à ce contrat.** Il envoie actuellement
l'émission sans operationId et attend active dès préparation. NFC-PROG-03 doit
envoyer les UUID, accepter issued/pending, traiter tokenAvailable=false, choisir
relecture ou rotation explicite et gérer expiresAt. Il doit aussi adapter le
remplacement et la présentation des erreurs, sans dupliquer le moteur natif.
NFC-PROG-04 ajoutera la file classe et ses compteurs ; aucun de ces travaux ici.

Un APK CI éventuel de ce HEAD ne constitue donc pas une version de recette NFC
cohérente ; aucun smoke positif n'est annoncé. La physique NTAG216 reste NOT_RUN.
Le NDEF statique demeure copiable et l'observation de relecture est rapportée par
le client autorisé, sans attestation cryptographique de puce. Les UUID historiques
de retry grandissent avec les reprises pendant la fenêtre limitée de préparation.

Ordre : diff CTO indépendant de #909 et de l'incrément #02 → décision sur les
dépendances → adaptation #03 → série #04 → intégration #05 → APK de recette et
smoke physique. Aucun Ready/Merge ni déploiement sans décision CTO.

**NFC-PROG-02 — DRAFT / HOLD — DÉPENDANCE #909 — DIFF CTO REQUIS — NO MERGE.**
