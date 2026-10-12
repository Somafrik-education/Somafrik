# NFC-ENC-01 — encodage, UID et verrouillage NTAG213 / NTAG216

Statut : DRAFT / HOLD. Pas de déploiement, pas de merge. Base : develop@1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f.

## Audit indépendant de l'existant

- develop possède `student_access_cards`, émission/révocation/remplacement, flags établissement, QR Mobile et scan backend.
- #891 (HEAD b2aaa6151468b9398b1644299f4bdc081ccb050c) est OPEN/DRAFT. Le lecteur NFC métier n'est pas dans develop. Son correctif Navigo ne réalise ni encodage ni liaison UID.
- Ce lot étend la table canonique. Aucune table `student_nfc_cards`, aucun nouveau module RBAC.
- La nouvelle instruction du 12 octobre autorise la reprise du chantier pour l'encodage des NTAG213/216. #891 n'est ni modifiée ni mergée.

## Parcours livré

Android → Fiche élève → Carte élève NFC. Un membre du personnel doit posséder Élèves:READ et Élèves:UPDATE. Backend : droits existants Élèves:UPDATE + établissement issu du principal authentifié ; refus explicite Superadmin/Admin Pays.

1. Lire l'UID et le modèle (GET_VERSION, réponse complète NXP ; seuls NTAG213 et NTAG216).
2. Vérifier l'élève affiché et l'UID. Encoder et affecter : réserver l'UID dans le backend existant et générer la capability révocable.
3. Représenter la même carte. Écrire un seul record NDEF Text `somafrik:card:<publicId.secret>`, après vérification UID/capacité/état et refus d'un contenu étranger.
4. Retirer puis représenter la carte : nouvelle découverte NFC et relecture physique du NDEF avant confirmation backend (évite le cache NDEF Android beta.10). `nfc_encoding_state=pending` bloque le scan backend, y compris QR/presence/finance utilisant ce token.
5. Choisir séparément Verrouiller définitivement. Confirmation utilisateur, relecture de la carte, validation serveur de la capability AVANT la commande native irréversible.
6. Nouvelle découverte de la même carte après verrouillage : vérifier lecture seule et contenu inchangé. Confirmer l'état observé au serveur.

L'UID usine n'est pas programmable et n'est jamais utilisé comme secret d'autorisation. Sur NTAG213/216 : UID 7 octets, préfixe fabricant 04. Aucun nom, matricule, donnée de paiement ou JWT dans la puce. Le token n'est ni loggé, ni stocké dans SQLite/outbox/SecureStore, ni affiché dans l'interface. Seul son hash reste côté serveur. Le lien UID–élève et les dates d'encodage/verrouillage sont dans PostgreSQL.

Le verrouillage NDEF définitif empêche la modification du contenu ; il n'apporte pas une protection cryptographique contre la copie. L'état SQL `locked` est une observation remontée par le client habilité, pas une attestation matérielle. La révocation applicative reste possible après verrouillage.

## Invariants et reprise

- UID globalement unique, y compris dans l'historique révoqué/perdu ; aucune réaffectation silencieuse.
- Au plus une carte active par élève : invariant existant. Une réservation en cours occupe ce créneau ; sa capability est inutilisable jusqu'à confirmation.
- Flags `studentCardEnabled` et `studentCardNfcEnabled` strictement vrais requis ; arrêt sinon. Tous restent désactivés par défaut.
- Encodage et verrouillage sont distincts. Aucun verrouillage automatique après émission.
- Coupure après écriture : Relire et confirmer récupère la capability depuis la carte et valide côté serveur ; pas de nouvelle émission.
- Coupure avant écriture / réponse d’émission perdue : Reprendre l’encodage relit l’UID et renouvelle le secret de la même réservation pending. Ancien secret invalidé. Réécriture autorisée uniquement pour une carte vide ou un ancien NDEF du même publicId. Aucune rotation si déjà encoded/locked.
- Cartes livrées au format NDEF usine attendues (NTAG213/216). Le formatage brut d'une puce sans NDEF et l'écrasement de données préexistantes sont refusés dans ce lot.
- Carte QR déjà active : l'encodage d'une capability QR existante n'est pas fourni ici ; ce parcours émet une nouvelle carte NFC pour un élève sans carte active.

## Test physique obligatoire en préproduction

APK natif depuis cette branche (Expo Go ne contient pas le module). Deux cartes de test : une NTAG213 et une NTAG216, deux élèves de test du même établissement. L'app doit posséder les permissions et les flags NFC de cet établissement. Ne pas effectuer ce test sur la production.

| Cas | Résultat attendu |
|---|---|
| Téléphone sans NFC / NFC éteint | Message clair ; aucune réservation/écriture |
| Navigo, puis NTAG215 | Refus explicite ; fiche reste ouverte ; aucune présence, aucun paiement |
| NTAG213 vierge | UID/modèle exacts ; écriture/relecture ; affectation au bon élève après recharge |
| NTAG216 vierge | Même fonctionnement ; payload compatible avec le lecteur prévu #891 |
| Présenter une autre carte à la seconde étape | Refus avant écriture |
| Tenter un UID déjà affecté avec un autre élève/établissement | Conflit contrôlé, aucune seconde affectation |
| Contenu NDEF étranger / carte déjà verrouillée vide | Refus, aucun écrasement |
| Coupure réseau après écriture avant confirmation | Pending, aucun faux succès ; Relire et confirmer récupère l'affectation |
| Annuler l'alerte de verrouillage | Carte encore inscriptible |
| Confirmer le verrouillage puis nouvelle présentation | Même UID, même NDEF, lecture seule vérifiée ; état locked après recharge |
| App mise en arrière-plan / élève ou compte changé | Session NFC annulée ; aucun token persisté |
| Superadmin / Admin Pays / parent / élève | Aucun droit d'encodage ; plateforme refusée par API |

Préserver au moins une carte inscriptible avant de tester le verrouillage irréversible. Le succès d'une simulation ne remplace pas le test matériel.

## Validation locale

- Backend : tests existants cartes/schéma/capabilities/platform guard + nouveaux tests NFC.
- Mobile : tests comportementaux NFC, tests QR existants, TypeScript, sécurité, guard QR et LOT4.
- SQL : migrations appliquées deux fois, contraintes/nulls, collision UID, isolation tenant, confirmation monotone, compatibilité QR sur PostgreSQL via PGlite local isolé. Le runner PostgreSQL `SOMAFRIK_NFC_TEST_DATABASE_URL` est également fourni ; pas d'accès à la base applicative.
- Prebuild preview/préproduction/production Android + iOS inspectés : NFC Android facultatif, aucun entitlement NFC iOS.
- Pas de SDK Android dans cet environnement : APK/AAB et smoke matériel non réalisés. HOLD jusqu'au test physique.

## Suite

Le lecteur métier, le multi-scan et la validation de l'appel, les impayés, le bus scolaire et iPhone sont hors de cette PR. Réconcilier les fichiers natifs/guards avec #891 avant un éventuel merge de cette PR existante ; aucun merge automatique de #891.

## Lot de 100 NTAG216 — allocation des cartes de test

Réserver cinq NTAG216 identifiées T216-01 à T216-05. Les 95 autres restent vierges. T216-01 : premier encodage et association élève, sans verrouillage. T216-02 : carte changée entre phases et doublon UID. T216-03 : perte réseau/reprise avant et après écriture. T216-04 : révocation et cas négatifs. T216-05 : seule carte dédiée au premier verrouillage irréversible, en dernier. Une NTAG213 séparée permet la vérification du deuxième modèle ; sans cette carte, noter NOT_RUN, jamais PASS.

Chaque essai conserve : APK SHA256, HEAD Mobile et backend préproduction, Android/modèle téléphone, UID, modèle GET_VERSION, élève/établissement de test, étapes et résultat. Avant lock de T216-05 : encodage, retrait réel du champ NFC, nouvelle présentation, lecture, confirmation backend, puis annulation du premier dialogue (doit rester inscriptible). Nouvelle action explicite seulement ensuite pour verrouiller, retirer/représenter, relire, vérifier l'état lecture seule et la persistance après recharge.

Prérequis backend : l'APK seul ne déploie pas les endpoints #908. Vérifier que le backend préproduction utilise le même candidat et possède sa migration, avec les flags établissement activés pour l'école de test. Les endpoints nfc-confirm/nfc-retry ne sont pas disponibles sur develop tant que le code n'y a pas été intégré. Aucun smoke positif ne peut être déclaré contre un backend non équipé.
