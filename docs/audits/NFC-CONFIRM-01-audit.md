# NFC-CONFIRM-01 — Confirmation NFC non aboutie

**Statut : `NFC-CONFIRM-01 — DRAFT / HOLD — AUCUN CORRECTIF — AUCUNE PROGRAMMATION — AUCUNE MUTATION DE RÉSERVATION.`**

Mesure en lecture seule sur `develop` `5478f8ea80e0da237e55ece5e594bf453c810f40`, le commit servi par `somafrik-api-preprod`. Aucune requête PostgreSQL, aucun appel Render, aucune écriture GitHub sur les PR déjà ouvertes. SMOKE-NFC-02 reste **FAIL**. La PR #927 reste **Draft / HOLD**.

La réservation Preview QA du 14 octobre 2026, encore `issued` / `pending` à 13 h 21, expiration 13 h 29 min 59 s, n’est ni supprimée, ni révoquée, ni réécrite.

---

## 1. Faits déjà établis hors de ce dépôt

| Contrôle | Résultat rapporté |
| --- | --- |
| Service | `somafrik-api-preprod`, branche `develop` |
| Fenêtre | 14 octobre 2026, 13 h 00 – 13 h 30 |
| Journaux de confirmation | aucun |
| Journaux HTTP exploitables | aucun |
| PostgreSQL à 13 h 21 | `issued` / `pending` |
| Audit d’activation | 0 |
| Révocation | non |
| Expiration | 13 h 29 min 59 s |

Ce document n’a pas rejoué ces contrôles. Il explique ce que le code de `develop` permet, et ne permet pas, d’en conclure.

## 2. Le parcours a atteint l’appel de confirmation

`NFC_PHASE_COPY.confirmation` vaut exactement « Activation en cours ». `confirmRead` pose cette phase après une relecture NDEF identique au contenu écrit, et seulement ensuite appelle `POST /api/student-cards/:id/nfc-confirm`.

Une phrase affichée avant cette phase (`NFC_READBACK`, `NFC_FOREIGN`, `NFC_REWRITE_REQUIRED`, etc.) est donc hors du cas observé. L’échec se situe dans l’appel HTTP, dans la lecture de sa réponse, ou dans le refus métier qui suit.

Si cet appel ne se termine pas par une carte `active` reconnue par `assertActive`, la transaction d’activation n’est pas committée. PostgreSQL reste `issued` / `pending`, et aucune ligne `student_card_nfc_encoded` ou `student_card_nfc_locked` n’est écrite. C’est l’état observé à 13 h 21.

L’expiration qui révoque la réservation écrit `student_card_nfc_reservation_expired` puis refuse avec `STUDENT_CARD_NFC_EXPIRED`. Cet enchaînement n’a pas eu lieu à 13 h 21 : la carte n’était pas révoquée et l’audit de confirmation était vide. L’expiration d’horloge de 13 h 29 min 59 s est un autre moment ; elle ne doit pas être forcée.

## 3. Les deux familles restent indistinguables

### 3.1 Le serveur ne journalise pas un refus 4xx

`POST /api/student-cards/:id/nfc-confirm` n’écrit pas de journal d’accès. Le middleware d’erreur final :

- répond en JSON `{ message, code }` lorsqu’une erreur porte `statusCode` ;
- n’appelle `console.error` que si `statusCode >= 500`, ou si l’erreur n’a pas de `statusCode` ;
- pour un 500 sans `statusCode`, le corps est `{ message: "Erreur interne Somafrik" }` sans `code`, et le `detail` est omis en production.

Un refus de validation (400, 403, 404, 409) est donc silencieux dans les journaux Render, et la transaction est annulée. L’absence de ligne « nfc-confirm » ne prouve pas que la requête n’est pas arrivée.

Les refus possibles avant l’audit d’activation, tous compatibles avec `issued` / `pending` et zéro confirmation :

| Code | Statut | Origine |
| --- | --- | --- |
| `STUDENT_CARD_TENANT_DENIED` | 403 | droit ou établissement |
| `STUDENT_CARD_NFC_INVALID` | 400 | UID, modèle, ou `locked` non booléen |
| `STUDENT_CARD_NFC_DISABLED` | 404 | encodage NFC désactivé dans la transaction |
| `STUDENT_CARD_NOT_FOUND` | 404 | carte absente du périmètre |
| `STUDENT_CARD_NFC_MISMATCH` | 409 | UID, modèle ou élève différent de la réservation |
| `STUDENT_CARD_NFC_OPERATION_REQUIRED` | 400 | `operationId` absent ou non UUID |
| `STUDENT_CARD_NFC_OPERATION_MISMATCH` | 409 | `operationId` différent de la réservation |
| `STUDENT_CARD_INVALID_STATE` | 409 | état qui n’est plus `issued` / `pending` |
| `STUDENT_CARD_ACTIVE_ALREADY_EXISTS` | 409 | une autre carte active bloque la bascule |
| `STUDENT_CARD_NFC_UID_EXISTS` | 409 | contrainte d’unicité de l’UID |
| `STUDENT_CARD_NFC_POSTGRES_REQUIRED` | 503 | transaction ou audit indisponible |
| `STUDENT_CARD_NFC_EXPIRED` | 409 | seulement après révocation commitée — exclu à 13 h 21 |

Un 5xx non typé serait journalisé, mais le texte journalisé ne contient pas le chemin de la route. Une recherche limitée à `nfc-confirm` peut le manquer. Ce document ne réinterprète pas les journaux déjà lus.

### 3.2 L’écran n’affiche pas le code

`nfcErrorCopy` ne reprend ni `error.message`, ni le statut HTTP. Il affiche une phrase française si `error.code` est dans sa table, sinon :

> Résultat non confirmé. Vérifiez la connexion, relisez l’état puis reprenez l’opération existante.

Le panneau fait `setMessage(nfcErrorCopy(error))`. Le code métier n’apparaît pas.

Codes de confirmation qui ont une phrase propre : `STUDENT_CARD_TENANT_DENIED` (et tout HTTP 403), `STUDENT_CARD_NFC_OPERATION_REQUIRED`, `STUDENT_CARD_NFC_OPERATION_MISMATCH`, `STUDENT_CARD_NFC_EXPIRED`, `STUDENT_CARD_INVALID_STATE`, `STUDENT_CARD_NFC_UID_EXISTS`, `NFC_RESPONSE_INVALID`.

Codes qui tombent dans la phrase générique, et qui empêchent de trancher :

| Code | Sens |
| --- | --- |
| `TIMEOUT` | délai de 20 s (`REQUEST_TIMEOUT_MS`), pas de statut HTTP |
| `NETWORK_UNAVAILABLE` | échec réseau local, statut 0 |
| `BACKEND_UNREACHABLE` | autre échec de transport, pas de statut HTTP |
| `STUDENT_CARD_NFC_INVALID` | corps refusé avant la transaction |
| `STUDENT_CARD_NFC_MISMATCH` | carte physique ou élève différent |
| `STUDENT_CARD_NOT_FOUND` | jeton ou carte non reconnu dans le périmètre |
| `STUDENT_CARD_NFC_DISABLED` | fonctionnalité coupée |
| `STUDENT_CARD_ACTIVE_ALREADY_EXISTS` | autre carte active |
| `STUDENT_CARD_NFC_POSTGRES_REQUIRED` | 503 |
| *(aucun code)* | HTTP d’erreur non JSON, ou 500 sans `code` |

`TIMEOUT`, `NETWORK_UNAVAILABLE` et `BACKEND_UNREACHABLE` décrivent une requête non aboutie. Les codes `STUDENT_CARD_*` décrivent un refus reçu. La phrase générique couvre les deux. Le résultat terminal n’est pas conservé autrement que dans cet état React, perdu si l’écran est quitté.

## 4. Les journaux Android de 13 h 15 ne peuvent pas combler ce trou sur l’APK preview

Le client enregistre déjà, dans `http_audit`, le chemin sans query, la méthode, le statut et `errorCode`. Il n’enregistre pas le corps. Cette ligne passe par `safeLogger.info`.

`safeLogger.info` et `safeLogger.debug` ne font rien lorsque `__DEV__` est faux. Le profil EAS `preview` n’est pas un client de développement (`developmentClient` est absent). L’APK preview qui parle à `https://api-preprod.somafrik.app` est donc un binaire release : la ligne `http_audit` de 13 h 15 n’a pas été écrite.

Récupérer logcat sur cet APK ne fournira ni le chemin, ni le statut, ni le code. Un client `development` branché sur Metro aurait pu les montrer ; ce n’est pas le profil de la recette preview.

`safeLogger.warn` et `safeLogger.error` restent actifs en release, et le filtre retire jeton, secret et capacité NDEF. Ils ne sont pas utilisés pour `http_audit`.

## 5. Décision

Aucun correctif dans cette PR. Aucune nouvelle programmation. Aucune modification de la réservation.

La prochaine correction, si elle est demandée, reste côté Mobile et se limite au résultat terminal :

- conserver la phrase française sûre ;
- y ajouter uniquement le code stable (`TIMEOUT`, `NETWORK_UNAVAILABLE`, `BACKEND_UNREACHABLE`, ou le `code` JSON) ;
- journaliser en release, par `safeLogger.warn`, seulement la méthode, le chemin, le statut HTTP et ce code.

Hors de ce journal : UID, jeton NFC, secret, enregistrement NDEF, corps de requête et corps de réponse. Le Backend n’a pas à être modifié pour départager les deux familles : il renvoie déjà `code` sur les erreurs `statusCode`. Le manque est l’affichage et la trace release côté Mobile.

Tant que ce code n’est pas visible, une nouvelle activation ne dira pas si l’échec est le transport ou un refus de validation.
