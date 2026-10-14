# NFC-PHYS-01 — Audit de la confirmation NDEF

Statut : **AUDIT / HOLD**. Aucun correctif produit, aucun merge, aucune activation, aucune écriture PostgreSQL et aucune réécriture de carte.

Alias public : `NFC-TEST-01`. Ce document ne contient ni nom d’élève, ni jeton, ni NDEF complet, ni hash, ni UID.

Issue de suivi : [#921](https://github.com/Somafrik-education/Somafrik/issues/921).

## Base lue

| Référence | Valeur |
| --- | --- |
| `develop` | `36bb96249af79abf5119348939761b6c7f700ced` |
| APK de recette | `c74d3a8cc18fd5eb6e1e569bd74ea3b67d8f55bd` |
| Arbre Git des deux commits | identique (`d57f185b0ec9ac39463619351e68240152c4e1f1`) |
| Environnement de cet audit | lecture du code uniquement |

L’APK preview et le squash #920 portent le même arbre. L’écart à expliquer n’est pas une différence de source entre l’APK et `develop`.

## Verdicts

| Contrôle | Résultat |
| --- | --- |
| Détection NTAG216 et création de réservations `issued` / `pending` | Observé en recette physique, hors de cet agent |
| Confirmation `active` / `encoded` | Absente en recette. Dans le code, seul `POST /api/student-cards/:id/nfc-confirm` réussi fait cette transition |
| Écriture NDEF puis relecture puis confirmation, pour la puce photographiée | **Hypothèse, non prouvée.** Le code peut s’arrêter après `writeNdefMessage` et avant `/nfc-confirm`. Sans lien entre le préfixe public de cette puce et une réservation de `NFC-TEST-01`, ce n’est pas la cause de cette recette |
| `AppState` pendant l’encodage individuel | **FAIL de conception prouvé** : quitter `active` annule l’opération et peut effacer le code d’erreur |
| `writeText` → `reset` → `openNdef` | **Mécanisme prouvé dans le code**, essai téléphone **NOT RUN** |
| `/nfc-confirm` : jeton, UID, élève, UUID, 30 minutes, RBAC | **Contrats prouvés dans le code et les tests existants**. Réponse HTTP réelle de la recette : **NOT RUN** |
| Corrélation préproduction carte–élève–établissement | **NOT RUN**, revérifié le 14 octobre 2026. L’API préproduction est joignable sur le SHA fusionné ; la lecture des cartes répond 401 sans JWT. Aucun `DATABASE_URL` préproduction n’est disponible ici |
| NTAG213, présence, QR | **NOT RUN** |
| Révocation du jeton exposé | **NON EXÉCUTÉE** |
| NFC-INT-02 | suspendu |

## Chronologie que le code exécute

Programmation individuelle, `createIndividualNfcFlow` dans `Mobile/src/lib/studentCardNfcEncoding.ts` :

1. `inspect` lit l’UID et le modèle, puis ferme la session.
2. `openNdef` refuse un NDEF déjà présent ou une carte en lecture seule, puis ferme encore la session.
3. `POST /api/student-cards` crée la réservation `issued`, `nfc_encoding_state=pending`, expiration à 30 minutes, et renvoie le jeton une seule fois.
4. `encodeNfcCard` rouvre le NDEF, compare le texte, puis `writeText`.
5. `writeText` écrit, **annule** la session native, puis redemande une découverte pour la relecture.
6. La relecture doit égaler le texte écrit. Le préfixe public du texte doit égaler `publicId` de la réservation.
7. `isReadOnly` observe le verrou. Le code n’appelle pas `makeReadOnly()`.
8. `POST /api/student-cards/:id/nfc-confirm` active la carte seulement si toutes les vérifications passent.

Un lecteur externe qui affiche `somafrik:card:` prouve qu’une écriture a été conservée sur la puce. Il ne prouve ni la relecture par Somafrik, ni l’appel de confirmation, ni l’appartenance à `NFC-TEST-01`.

## Où la chaîne peut s’arrêter

Pour la puce photographiée et les deux réservations déjà vues, « rupture après écriture et avant confirmation » est une **hypothèse de diagnostic**, pas une causalité démontrée. Une écriture NDEF Somafrik a été observée sur une carte. Rien ne prouve encore que ce NDEF est celui d’une réservation de `NFC-TEST-01`, ni que l’échec de cette réservation vient de la session Android plutôt que du backend.

Trois issues restent compatibles avec « NDEF présent quelque part, réservations affichées non passées à `active` / `encoded` ». Aucune n’est la cause de cette recette.

1. **Prouvée comme chemin possible.** Après l’écriture, `studentCardNfcEncoderNative.ts` appelle `session.reset()`, qui exécute `NfcManager.cancelTechnologyRequest()`, puis `openNdef` redemande le tag. Pendant cet intervalle le mode lecteur est relâché. Android peut remettre le tag à une autre application. C’est le moment où un lecteur externe peut s’ouvrir et afficher le NDEF.
2. **Prouvée comme effet d’interface.** Si Somafrik passe à `inactive` ou `background`, le panneau d’encodage incrémente `generation`, ferme le matériel, et `valid()` devient faux. L’erreur `NFC_CANCELLED` ou `NFC_SESSION_CANCELLED` est alors ignorée par le `catch`, parce qu’il n’affiche le message que si `valid()` est encore vrai. La confirmation n’est pas appelée.
3. **Hypothèse non observée.** La relecture ou `nfc-confirm` a échoué pour expiration, UUID, UID, hash ou établissement, et le code a été affiché ou perdu. Aucun journal HTTP de la recette n’a été fourni à cet audit.

Le message visible « Opération interrompue… » du bouton Annuler dit qu’aucune activation locale n’est confirmée. Cette phrase est exacte pour le serveur. Elle ne dit pas que le NDEF peut déjà être sur la puce. Le bouton n’est rendu que pendant `working`. Après un passage en arrière-plan, `finally` remet `working` à faux : l’opérateur ne voit plus Annuler, et le dernier texte (« Écriture en cours » ou l’invite de relecture) peut rester, parce que l’effet de rafraîchissement ne remplace pas `message`.

## Session Android et `AppState`

Fichier : `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx`.

- Tout état autre que `active` ferme le hardware et invalide la génération en cours.
- Le retour au premier plan ne fait que relire la liste des cartes.
- Le code d’erreur n’est conservé nulle part hors de l’état React déjà invalidé.
- `AuthContext` relance aussi un rafraîchissement des permissions au retour au premier plan. Ce rafraîchissement n’est pas la cause prouvée de l’annulation : l’écouteur du panneau suffit.

Le lot classe, `StudentCardNfcBatchControl.tsx`, suspend par `pause()` et affiche « Session suspendue. Reprenez explicitement les opérations incomplètes. » Ce n’est pas le même silence que la fiche élève. La recette décrite correspond à la programmation d’une carte pour un élève, donc au panneau individuel.

`decideNfcScannerForeground` dans `studentCardNfc.ts` concerne le lecteur de présence, pas l’encodeur. Il annule aussi hors de `active`, mais il ne programme pas la puce.

## `writeText` → `reset` → `openNdef`

`Mobile/src/lib/studentCardNfcEncoderNative.ts`, lignes 61 à 71 :

- `writeNdefMessage(..., { reconnectAfterWrite: true })`.
- Le commentaire du code dit que `getNdefMessage` de `react-native-nfc-manager@4.0.0-beta.10` relit le cache du tag. Une nouvelle découverte est exigée.
- `session.reset()` garde le bail logiciel (`stop(false)`) mais annule la requête technologique native.
- `openNdef` vérifie que l’UID inspecté est encore celui attendu, puis rappelle `requestTechnology` avec le mode lecteur A et B.

Conséquence : la relecture n’est pas une lecture de la session qui vient d’écrire. Elle dépend d’une seconde présentation, faite après avoir rendu le tag au système. Cet essai n’a pas été refait sur téléphone dans cet audit (**NOT RUN**).

`createNfcSessionManager` refuse le résultat d’une découverte annulée (`assertOwner` après l’opération). Un `close()` concurrent, déclenché par `AppState`, met `release` à vrai et fait échouer le `reset` ou la redécouverte avec `NFC_SESSION_CANCELLED`. L’écriture déjà envoyée à la puce n’est pas annulée.

## `/nfc-confirm`

Route : `POST /api/student-cards/:id/nfc-confirm` dans `backend/server.js`. Corps JSON : `{ message, code }` pour une erreur métier. Les statuts 500 ne renvoient pas le corps de l’exception au client. Le client mobile journalise le chemin, la méthode, le statut et `code`, pas le corps de la requête.

RBAC, `backend/services/rbacService.js` : émission et confirmation exigent le même droit, `Élèves:UPDATE` ou `Gérer élèves`, plus l’établissement du principal. Un enseignant qui a pu créer la réservation a le droit d’appeler la confirmation. L’échec observé ne s’explique pas par un droit plus strict sur la confirmation.

Contrôles de `confirmStudentCardNfc`, dans cet ordre :

| Condition | Code | HTTP |
| --- | --- | --- |
| Droit ou établissement | `STUDENT_CARD_TENANT_DENIED` | 403 |
| `locked` n’est pas un booléen | `STUDENT_CARD_NFC_INVALID` | 400 |
| UUID d’opération absent ou invalide alors que la ligne en a un | `STUDENT_CARD_NFC_OPERATION_REQUIRED` | 400 |
| UUID différent de `nfc_operation_id` stocké | `STUDENT_CARD_NFC_OPERATION_MISMATCH` | 409 |
| Préfixe public ou hash du secret différent | `STUDENT_CARD_NOT_FOUND` | 404 |
| UID ou modèle différent, ou élève du corps différent | `STUDENT_CARD_NFC_MISMATCH` | 409 |
| Réservation expirée | `STUDENT_CARD_NFC_EXPIRED` | 409 |
| État autre que `issued` + `pending`, hors rejeu déjà `active` | `STUDENT_CARD_INVALID_STATE` | 409 |

Le délai est `issued_at + 30 minutes`, colonne `nfc_reservation_expires_at`. L’expiration est évaluée avec `clock_timestamp()` au moment de la confirmation. Un long détour par une application externe peut donc faire expirer une réservation déjà écrite sur la puce. Le retry ne prolonge pas cette échéance : il change le hash et conserve le `publicId` et la même date.

Le hash et le jeton ne sont pas recopiés dans le message d’erreur. Le test HTTP existant vérifie que la réponse d’erreur ne contient ni le jeton, ni le secret, ni l’UID, ni l’UUID d’opération.

Une confirmation réussie met `status=active` et `nfc_encoding_state` à `encoded`, ou `locked` si le téléphone a **observé** une puce déjà en lecture seule. Aucune commande de verrouillage n’est envoyée.

## Identifiants : ce que le code garantit, et ce qui n’a pas été lu

La corrélation préproduction reste **NOT RUN** après une seconde tentative, le 14 octobre 2026.

| Contrôle | Résultat |
| --- | --- |
| `GET https://api-preprod.somafrik.app/api/health` | HTTP 200, `database=postgresql`, `gitSha=36bb96249af79abf5119348939761b6c7f700ced` |
| `GET /api/students/:id/cards` sans JWT | HTTP 401, message d’authentification uniquement |
| Base locale de cet agent | `nfc_encoding_test` sur localhost, ce n’est pas la préproduction |
| Fichier `.env.preproduction` | absent. Seul `.env.preproduction.example` est dans le dépôt |
| `publicId` photographié et UID physique | absents de l’issue #921 et de cet espace de travail |

Aucune association carte–élève–établissement n’est affirmée. Le jeton et son hash n’ont pas été lus. Les étapes suivantes du mandat — code d’erreur Android, appel réel de `/nfc-confirm`, révocation contrôlée, correctif — restent bloquées par cette corrélation.

Invariants du code sur `develop@36bb9624`, à vérifier plus tard dans le canal sécurisé, en lecture seule :

- Une écriture acceptée par `encodeNfcCard` utilise un jeton dont le préfixe public est égal au `publicId` de la réponse d’émission. Un NDEF dont le préfixe public ne correspond à aucune des deux réservations vues à l’écran ne peut pas être le jeton de ces deux lignes, sauf erreur de lecture du texte (préfixe de langue NDEF pris pour l’identifiant, ou comparaison avec un autre champ).
- `student_access_cards_one_pending_nfc_per_student` interdit deux lignes `issued` + `pending` pour le même couple établissement–élève. Deux réservations encore simultanément `pending` pour `NFC-TEST-01` indiqueraient que cette migration n’est pas en place en préproduction, ou que les deux lignes n’ont pas le même `student_id`.
- L’index unique sur `nfc_uid` interdit une seconde réservation vivante pour le même UID. Une deuxième émission pour la même puce échoue avec `STUDENT_CARD_NFC_UID_EXISTS` ou `STUDENT_CARD_NFC_RESERVATION_EXISTS` tant que la première est `pending` et non expirée.
- Un renouvellement (`nfc-retry`) conserve `publicId` et remplace le secret. Il peut expliquer un NDEF ancien refusé à la confirmation (404, hash différent). Il n’explique pas un préfixe public différent.
- Une nouvelle émission, possible seulement après expiration et révocation paresseuse de la précédente, crée un nouveau `publicId`. La puce peut encore porter l’ancien texte. La reprise compare le préfixe lu au `publicId` de la réservation **courante** et répond `NFC_FOREIGN` s’ils diffèrent. L’ancienne capability n’est alors pas activée, et elle n’est pas non plus invalidée.

Reprise prévue, toujours sans écrire ces valeurs dans GitHub : dans le tenant de test, compter les lignes de `NFC-TEST-01` par `status` et `nfc_encoding_state`, noter la présence d’un UUID d’opération et l’échéance, et comparer hors dépôt le préfixe du record Text au `public_id`. Ne pas sélectionner `token_hash`.

## Correctif minimal proposé, non appliqué

Pas de patch dans cette branche. Le correctif n’est pas autorisé tant que le CTO n’a pas clos cet audit.

Changement d’interface seulement, sans assouplir `/nfc-confirm` :

1. Extraire la décision `AppState` du panneau d’encodage. Hors de `active`, après que la phase a atteint `writing`, `verification` ou `confirmation`, conserver un code fixe `NFC_SESSION_CANCELLED` et l’afficher au retour, même si `valid()` est devenu faux. Le rafraîchissement de la liste ne doit pas effacer ce code.
2. Si l’annulation intervient avant `writing`, conserver le comportement actuel : rien n’a été envoyé à la puce, aucune nouvelle réservation ne doit être créée.
3. Remplacer la phrase du bouton Annuler, une fois l’écriture commencée, par une phrase qui distingue « activation serveur non faite » et « la puce peut déjà contenir un NDEF ; la seule suite est Relire et confirmer ».
4. Ne pas créer de seconde réservation depuis cet écran tant qu’une ligne `pending` non expirée existe. C’est déjà le cas côté serveur et côté `program()`.
5. Ne pas modifier le mode lecteur dans ce premier correctif. Supprimer le `reset` entre écriture et relecture changerait le contournement documenté du cache beta.10. Cet essai reste un test téléphone séparé, après GO.

Tests de régression à ajouter avec ce correctif, pas dans cette PR :

- Décision pure : `AppState` non `active` en phase `writing` produit annulation, fermeture, et un message conservé au retour. Aucun appel `nfc-confirm`.
- La même interruption en phase `initial` ou `reservation` n’affirme pas qu’un NDEF a pu être écrit.
- `encodeNfcCard` : `writeText` réussit, la redécouverte lève `NFC_SESSION_CANCELLED`, `confirm` n’est pas appelé, la réservation reste `issued` / `pending`.
- Reprise : texte relu égal à la réservation courante, confirmation appelée une fois.
- Reprise : préfixe public différent de la réservation courante, code `NFC_FOREIGN`, confirmation non appelée.
- Les tests déjà présents de `/nfc-confirm` (UUID, expiration 30 minutes, hash, UID, absence du secret dans la réponse) restent la borne de non-régression serveur.

## Jeton exposé

La capture contient une capability complète. Elle n’est pas reproduite ici. Aucune révocation n’a été exécutée.

Avant toute nouvelle programmation de cette NTAG216 : corrélation en lecture seule, puis révocation contrôlée de la ligne dont le `public_id` correspond au record Text, par le parcours de révocation déjà existant, avec accord CTO. Ne pas réécrire la puce avant cette révocation. Ne pas lancer NFC-INT-02.

## Décision

**HOLD BLOQUANT.** La conformité documentaire ne clôt pas NFC-PHYS-01. La première zone de code à investiguer reste l’intervalle écriture, fermeture de la requête NFC, nouvelle présentation, confirmation. Elle n’est pas la cause prouvée de la réservation `NFC-TEST-01`.

Ordre restant, non exécuté ici : corrélation lecture seule en préproduction, puis phase NFC et code d’erreur assaini, puis révocation contrôlée du jeton photographié, puis seulement un correctif isolé dans une autre PR Draft/HOLD. Pas de troisième programmation. Pas de changement de message d’erreur dans cette branche. NFC-INT-02 reste suspendu. Aucune autorisation de production.
