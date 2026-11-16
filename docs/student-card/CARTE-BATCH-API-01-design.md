# CARTE-BATCH-API-01 — Début d'implémentation et gate livraison

**DRAFT / HOLD — précontrôle PostgreSQL exposé via GET sécurisé ; aucune route de mutation ni émission ajoutée.**

## État observé

Le Backend émet actuellement un jeton `publicId.secret` dans la réponse initiale, n'en conserve que `token_hash` ensuite et rend la carte active. Une nouvelle requête ne peut pas récupérer le secret. L'endpoint `nfc-provision` permet d'attacher la NFC à la **même carte** en conservant l'ID, l'ID public et le hash.

## Livré dans cette étape

`GET /api/classes/:classCode/student-cards/preflight` : route lecture seule, authentification et permission cartes existante, scope établissement, réponse `no-store`. Smoke HTTP/PostgreSQL local PASS le 23 octobre 2026 sur HEAD `822fb2a80ea78ab22754baf83e36d059bc579de5` avant cette mise à jour documentaire ; 17 scénarios PASS, zéro mutation de carte.

`backend/lib/studentCardBatchPlan.js` : classifie un ensemble d'élèves déjà autorisés et vérifiés par le Backend : candidats à une première émission, cartes déjà actives non réexportables, non éligibles ; refuse les doublons d'identité. **Ne jamais utiliser les booléens fournis par le navigateur** : les appeler uniquement avec des lignes serveur contrôlées.

## Gate P0 non levé — perte de réponse

Une garantie strictement atomique entre commit PostgreSQL et réception d'un PDF côté navigateur est impossible dans une transaction HTTP classique. **Il serait incorrect d'émettre toutes les cartes actives avant d'avoir assuré la délivrance.**

Design à valider avant API de mutation :
1. Séparer **prévisualisation d'un plan de lot** (sans mutation) et **émission**, tous deux sous autorisation école / RBAC et vérification de classe.
2. Étudier un protocole en plusieurs phases où le destinataire possède déjà les matériaux imprimables localement avant activation, avec preuve explicite d'activation ; les cartes non activées doivent être clairement indiquées comme non scannables. Prévoir les retours réseau et conflits.
3. Ne pas stocker les secrets en clair sur serveur. Un éventuel mécanisme de reprise doit être documenté, limité dans le temps et réévalué en sécurité. Ne pas créer de fausse « idempotence » qui promet de récupérer un secret non stocké.
4. Exiger un test de coupure réseau **entre chaque phase**. Bloquer le lancement de toute émission de masse sans validation de ce contrat par le CTO.

## Prochain lot
Le précontrôle PostgreSQL et la route **GET sans effet de bord** sont raccordés et ont fait l'objet d'un smoke HTTP/PostgreSQL local. Définir et faire approuver le protocole de délivrance PDF avant tout endpoint POST. Aucun export de carte active ancienne n'est prévu.
