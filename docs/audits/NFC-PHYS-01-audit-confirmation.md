# NFC-PHYS-01 — Audit de la confirmation NDEF

Statut : **AUDIT / HOLD**. Aucun correctif produit, aucun merge, aucune activation, aucune écriture PostgreSQL et aucune réécriture de carte.

Alias public : `NFC-TEST-01`. Ce document ne contient ni nom d’élève, ni jeton, ni NDEF complet, ni hash, ni UID.

Issue de suivi : [#921](https://github.com/Somafrik-education/Somafrik/issues/921).

## Base lue

| Référence | Valeur |
| --- | --- |
| `develop` | `7acfbe595fd0f3abfbfee17a332e4ed66f51bbc6` |
| Commit NFC de la recette | `36bb96249af79abf5119348939761b6c7f700ced` |
| APK de recette | `c74d3a8cc18fd5eb6e1e569bd74ea3b67d8f55bd` |
| Arbre Git de l’APK et du squash #920 | identique (`d57f185b0ec9ac39463619351e68240152c4e1f1`) |
| Écart `develop` depuis ce squash | un document finance, `docs/audits/FIN-SIMPLE-01-AUDIT.md` |
| Environnement de cet audit | lecture du code, plus les preuves assainies rapportées par le CTO |

L’APK preview et le squash #920 portent le même arbre NFC. Le commit finance ajouté ensuite sur `develop` ne change pas ce code. L’écart à expliquer n’est pas une différence de source entre l’APK et le NFC de la recette.

## Verdicts

| Contrôle | Résultat |
| --- | --- |
| Détection NTAG216 et création de réservations `issued` / `pending` | Observé en recette physique, hors de cet agent |
| Confirmation `active` / `encoded` | Absente en recette. Dans le code, seul `POST /api/student-cards/:id/nfc-confirm` réussi fait cette transition |
| Association PostgreSQL carte–réservation `NFC-TEST-01` | **Confirmée** par le CTO en préproduction. Une réservation `issued` / `pending` a été identifiée, puis révoquée |
| Cause Android de l’arrêt avant `/nfc-confirm` | **Non démontrée.** Le code peut s’arrêter après `writeNdefMessage`. Le journal du téléphone reste absent |
| `AppState` pendant l’encodage individuel | **FAIL de conception prouvé** : quitter `active` annule l’opération et peut effacer le code d’erreur |
| `writeText` → `reset` → `openNdef` | **Mécanisme prouvé dans le code**, essai téléphone **NOT RUN** |
| `/nfc-confirm` : jeton, UID, élève, UUID, 30 minutes, RBAC | **Contrats prouvés dans le code et les tests existants**. Réponse HTTP réelle de la recette : **NOT RUN** |
| Corrélation préproduction carte–élève–établissement | **FAITE** par le CTO dans Somafrik-preprod, second contrôle PostgreSQL indépendant. Preuves assainies ci-dessous. Cet agent n’a pas relu les lignes |
| NTAG213, présence, QR | **NOT RUN** |
| Révocation du jeton exposé | **FAITE** en préproduction. Motif `nfc_abandoned`. NDEF physique non modifié. Production non touchée |
| SMOKE-NFC-01 | **FAIL** |
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

Un lecteur externe qui affiche `somafrik:card:` prouve qu’une écriture a été conservée sur la puce. Il ne prouve ni la relecture par Somafrik ni l’appel de confirmation. L’appartenance de la réservation à `NFC-TEST-01` vient de la corrélation PostgreSQL du CTO.

## Où la chaîne peut s’arrêter

La corrélation PostgreSQL confirme la réservation de `NFC-TEST-01` : elle était `issued` / `pending`, puis elle a été révoquée. « Rupture après écriture et avant confirmation » reste une **hypothèse sur la cause Android**, pas une causalité démontrée. Le journal du téléphone n’a pas été fourni. L’arrêt peut encore venir de la session Android ou d’un refus backend non journalisé.

Trois chemins restent compatibles avec « NDEF présent sur la puce, réservation non passée à `active` / `encoded` ». Aucun n’est démontré comme la cause de cette recette.

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

## Preuves assainies de préproduction

Le CTO a corrélé la carte et révoqué la réservation dans Somafrik-preprod. La transaction SQL a réussi. Un second contrôle PostgreSQL, fait par le CTO, confirme l’état ci-dessous. Cet agent n’a pas exécuté la requête et n’a pas reçu le jeton, le hash, l’UID ni le `publicId`.

| Contrôle | Résultat |
| --- | --- |
| Environnement | Somafrik-preprod |
| Établissement | Institut Nuruyetu |
| Carte | NTAG216, alias `NFC-TEST-01`, classe de test 2ème A |
| Ancien statut | `issued` / `pending` |
| Nouveau statut métier | `revoked` |
| `nfc_encoding_state` | reste `pending` : état d’encodage historique, pas une activation |
| Motif | `nfc_abandoned` |
| Réservations révoquées | 1 |
| Événement d’audit | 1 |
| Réservations NFC encore `issued` / `pending` pour cet élève | 0 |
| Cartes `active` pour cet élève | 0 |
| Élève, inscription, classe | conservés |
| NDEF physique | non modifié |
| Somafrik-prod | aucune opération |

Le jeton de cette réservation ne peut plus activer la carte : une confirmation sur un statut `revoked` est refusée. Le NDEF peut encore être lu sur la puce. SMOKE-NFC-01 reste FAIL.

La sonde précédente de cet agent reste vraie et insuffisante : `GET /api/health` était HTTP 200 sur `36bb9624`, et la lecture des cartes sans JWT était HTTP 401.

## Identifiants : ce que le code garantit

Invariants du code, désormais confrontés à l’état final rapporté par le CTO :

- Après révocation, il ne reste aucune réservation `issued` / `pending` et aucune carte `active` pour `NFC-TEST-01`. Cela est compatible avec l’index `student_access_cards_one_pending_nfc_per_student`.
- `nfc_encoding_state=pending` avec `status=revoked` est l’historique d’encodage, pas une carte activée. `markRevoked` ne change pas cet état.
- Une confirmation de cette ligne doit échouer avec `STUDENT_CARD_INVALID_STATE`. Le motif `nfc_abandoned` n’est pas le motif d’expiration, donc le code n’est pas `STUDENT_CARD_NFC_EXPIRED`.
- L’index unique sur `nfc_uid` continue d’interdire une nouvelle émission pour la même puce tant que la ligne révoquée conserve l’UID.
- Le NDEF physique n’a pas été effacé. Une reprise qui lirait ce texte et tenterait de confirmer la réservation révoquée doit être refusée, sans réécriture.

## Correctif minimal

Pas de patch dans cette branche. Le correctif est [#925](https://github.com/Somafrik-education/Somafrik/pull/925), Draft/HOLD, HEAD `5e74a5659e246f967361fa1a18a5b029391c70c0`. Il arme le mode lecteur avant l’invite de re-présentation, conserve le premier diagnostic d’interruption après `writing`, `verification` ou `confirmation`, et vérifie le refus d’une carte `revoked` / `nfc_abandoned`. Le message dit que le contenu NFC peut déjà être présent, sans affirmer que l’écriture est terminée. Le `reset()` après écriture reste. SMOKE-NFC-01 reste FAIL. Le téléphone n’a pas rejoué le parcours.

## Jeton exposé

La capture contient une capability complète. Elle n’est pas reproduite ici. La réservation correspondante a été révoquée en préproduction avec le motif `nfc_abandoned`. Le contenu NDEF de la puce n’a pas été modifié. Aucune opération de production n’a été faite.

Ne pas reprogrammer cette NTAG216 tant qu’un smoke physique n’a pas réussi sur une autre carte de test. Ne pas lancer NFC-INT-02.

## Correctif

Cette PR reste documentaire. Le correctif est isolé dans #925. SMOKE-NFC-01 reste FAIL tant qu’un téléphone n’a pas rejoué le parcours sur une autre NTAG216 de test.

## Décision

**HOLD BLOQUANT.** #922 n’est pas prête pour merge. La corrélation PostgreSQL et la révocation préproduction sont confirmées. La cause Android de la recette physique n’est pas démontrée. NFC-INT-02 reste suspendu. Aucune autorisation de production.
