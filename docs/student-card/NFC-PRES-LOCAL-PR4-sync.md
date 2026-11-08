# NFC-PRES-LOCAL-PR4 — Synchronisation Mobile des appels hors connexion

Statut : **DRAFT / HOLD / NO MERGE**. Le flag `studentCardOfflineRollCallEnabled` reste **désactivé par défaut**, aucun établissement n'est activé, aucun déploiement. Contrat : PR0 (§6), PR1c (#1120, route et journal), PR2 (#1123, stockage), PR3 (#1129, acquisition et clôture).

## 1. Principe

Un appel clôturé sur le téléphone n'est **jamais** considéré comme enregistré sur le serveur. Seul un ACK conforme fait passer la session à `synced`. Aucune seconde machine d'état : les transitions sont celles de PR2.

| État local | Affichage |
| --- | --- |
| `draft` | Brouillon local |
| `closed` | À synchroniser |
| `syncing` | Synchronisation en cours |
| `synced` | Synchronisé — « Appel synchronisé avec succès. » |
| `failed_retryable` | Nouvelle tentative prévue (avec l'heure prévue) |
| `unconfirmable` | « État serveur non confirmable actuellement. » (jamais « non enregistré ») |
| `failed_action_required` | Échec à résoudre ; « Corriger l'appel » **uniquement** après `not_recorded` |
| `expired` | Appel expiré |

## 2. Runner (`Mobile/src/offline/rollCall/sync/syncRunner.ts`)

Une tentative, toujours dans cet ordre, avec les fonctions PR2 :

1. `listSyncCandidates` (ajout PR4) : sessions du compte en `closed`, `failed_retryable` ou `unconfirmable`, corps figé présent, `sync_deadline` non dépassée, `next_attempt_at` atteinte (sauf demande explicite, réseau retrouvé, retour du même compte) ;
2. `beginSyncAttempt` : COMMIT de `syncing`, lecture du corps figé ;
3. envoi de **la chaîne lue en base**, octet pour octet, `Idempotency-Key = operationId` (`sendOfflineRollCallSync`, route `POST /api/student-cards/roll-call/offline/v1/sync`) ; rien n'est recalculé ni re-sérialisé ;
4. `recordTrustedTime` avec l'en-tête `Date` (monotone : jamais de recul) ;
5. `recordSyncOutcome` → `decideSyncOutcome` ; la purge des preuves, du corps figé et du pack n'a lieu que dans la transaction qui écrit `synced` ; le backoff (`next_attempt_at`) est écrit dans la même transaction.

Garanties :
- **un seul envoi à la fois** par runner ; les déclencheurs simultanés sont regroupés en un seul passage supplémentaire ;
- **isolation des comptes** : une réponse n'est appliquée qu'à la base du compte qui a envoyé, et seulement si elle est toujours ouverte pour lui. Sinon, la session reste `syncing` ; à la réouverture du même compte, `recoverInterruptedSyncs` / `blockSessionsForLogout` la passent en `failed_retryable` (INTERRUPTED) et le renvoi est identique ;
- aucun journal ne contient de preuve, de corps ou d'identifiant : seulement des codes.

### Vérification de l'ACK

2xx ne suffit pas. `operationId`, `revision`, `payloadDigest` **et** `sessionId` doivent correspondre à la session locale. Un ACK absent, non objet, sans `sessionId` ou contradictoire donne `failed_action_required` / `ACK_MISMATCH` : corps et preuves conservés, aucune révision possible (le trigger PR2 exige `not_recorded`).

### Classification (PR0)

| Réponse | État |
| --- | --- |
| pas de connexion, timeout | `failed_retryable` |
| 408, 429, 5xx | `failed_retryable` |
| 2xx + ACK conforme | `synced` |
| 2xx + ACK contradictoire | `failed_action_required` (`ACK_MISMATCH`) |
| 401 / 403 / 404 sans `sessionState` | `unconfirmable` (même opération, même corps, renvoyée plus tard) |
| `sessionState: "not_recorded"` | `failed_action_required`, révision possible |
| `sessionState: "conflict"` | `failed_action_required`, aucune révision |

Backoff borné : 30 s, 2 min, 5 min, 15 min, 30 min, puis 1 h (±10 %). Non confirmable : au moins 15 min. Intervention et succès : aucune tentative automatique. L'échéance J+3 n'est jamais prolongée : après `sync_deadline`, plus aucun envoi ; `runPurge` passe la session en `expired` (avec l'exception PR2 de conservation du corps figé après un état non confirmable).

## 3. Déclencheurs et cycle de vie

| Déclencheur | Backoff |
| --- | --- |
| clôture locale (`closed`) | respecté (aucune tentative antérieure) |
| connexion retrouvée (`online`, transition `subscribeConnectivity`) | ignoré |
| retour du même compte (`login`, `onSessionChanged`) | ignoré |
| reprise de l'application (`resume`) | respecté |
| minuterie au premier plan, toutes les 60 s (`timer`) | respecté |
| « Synchroniser maintenant » (`manual`) | ignoré |

Aucune tâche d'arrière-plan : une application suspendue ou tuée reprend à la prochaine occasion. Le runner n'ouvre jamais la base d'un autre compte. Il n'en crée aucune : la liste des appels n'affiche que la base déjà ouverte du compte.

**Déconnexion** (PR3 inchangé, MP-011 préservé) : le runner est arrêté avant tout traitement du stockage. Un envoi en cours est isolé : sa réponse n'est jamais appliquée. L'appel reste en attente (`blocked_logout`) et il est renvoyé à l'identique au retour du même compte. **Changement de compte** : runner arrêté, base fermée, ACK tardif ignoré. **Session expirée (401)** : gestion existante (`notifySessionExpired` → `forcedLogout`, aucun effacement).

Correction du runtime : `requestSync` et `refreshLogoutGuard` n'agissent plus que sur le compte dont la base est ouverte. Un recalcul tardif ne rouvre jamais l'ancienne base au détriment du compte connecté entre-temps (course trouvée par les tests PR4).

## 4. Correction après `not_recorded`

« Corriger l'appel » → `reviseSession` : même `sessionId`, `revision + 1`, retour en brouillon (marques `default` recalculées). La modale d'appel rouvre le brouillon de la classe et du jour concernés. Le nouveau corps, le digest et un **nouvel** `operationId` ne sont calculés qu'à la nouvelle clôture. Interdite dans tous les autres cas : timeout, réponse perdue, non confirmable, conflit, ACK contradictoire.

## 5. Fichiers

- `sync/syncRunner.ts`, `sync/syncStatus.ts` et leurs tests (`syncRunner.test.ts`, 17 tests) ;
- `store/repository.ts` (ajouts) : `listSyncCandidates`, `listSyncStatus`, option `nextAttemptAt` de `recordSyncOutcome`, refus d'un ACK portant un autre `sessionId` dans `decideSyncOutcome` ;
- `runtime/rollCallRuntime.ts` : runner unique, `requestSync`, `subscribeSync`, arrêt à la déconnexion et au changement de compte ;
- `runtime/RollCallOfflineRuntime.tsx` : connexion retrouvée, reprise, minuterie ;
- `services/rollCallOfflineApi.ts` (`sendOfflineRollCallSync`), `services/httpClient.ts` (option `rawAnyStatus` : corps et en-têtes d'une réponse d'erreur, hors 401) ;
- interface : `components/OfflineRollCallSyncList.tsx`, `OfflineRollCallModal.tsx` (état de l'appel, envoi à la clôture, réouverture après correction), `TeacherAttendanceScreen.tsx` (« Appels hors connexion ») ;
- preuves : `App.rcNativeProof.tsx`, `scripts/run-rc-offline-native-proof.js`, `backend/lib/rollCallOfflineSync.http.pg.test.js` (section D).

## 6. Preuves

| Exigence | Preuve |
| --- | --- |
| Premier envoi, octets identiques, Idempotency-Key | `syncRunner.test.ts` « premier envoi » |
| Timeout avant réception, backoff | « timeout avant réception » |
| Timeout après COMMIT / réponse perdue | « réponse perdue » (simulé) ; PostgreSQL : PR1c (`slowBody`) et D-3 |
| Application arrêtée pendant l'envoi | « application arrêtée » |
| Reconnexions et déclencheurs simultanés | « déclencheurs simultanés » ; PostgreSQL : R-10 et D-4 |
| Renvoi > 24 h | « plus de 24 h » ; PostgreSQL : D-5 et R-1…R-10 (instance B, cache purgé) |
| ACK conforme / contradictoire | « ACK absent, malformé ou contradictoire » ; PostgreSQL : D-2 (`sessionId`, `operationId`, `revision`, `payloadDigest`) |
| Classification HTTP, `unconfirmable` | « erreurs HTTP et réseau » ; PostgreSQL : D-1 (403 sans `sessionState`, rien écrit), R-4, R-5 |
| Révision seulement après `not_recorded` | « not_recorded : Corriger l'appel » |
| Échéance, conservation | « échéance J+3 » |
| Horloge de confiance | « horloge de confiance » |
| Déconnexion, changement de compte, reconnexion | trois tests runtime |
| Statut protégé | PostgreSQL D-2 (justifié conservé), A |
| 35 élèves hors connexion | « appel de 35 élèves » (transport simulé) |
| Hermes + SQLCipher Android | recette native `pr4=ok …` / `pr4_persist=ok` (**transport simulé** : aucun PostgreSQL joignable depuis l'émulateur) |

## 7. Limites et hors périmètre

- La recette Android utilise un **transport simulé**. La preuve PostgreSQL réelle passe par le Backend (section D, octets JCS identiques à ceux du Mobile). Aucune transmission réelle d'un téléphone vers un serveur n'est présentée comme acquise.
- Les clés de pack ne sont pas configurées : en préproduction comme en production, les appels sont en mode dégradé (PR3 §4). Le serveur répondra donc vraisemblablement `ROLL_CALL_ROSTER_CHANGED` + `not_recorded` à un lot sans liste, ce qui mène à « Corriger l'appel ».
- Sans NetInfo natif, la connexion retrouvée est détectée par la connectivité existante (succès HTTP, sonde) ; la minuterie au premier plan sert de filet.
- Hors périmètre : PR1c inchangé (aucune modification serveur), activation des flags, Render, clés, Play Store, recette physique NTAG213/216 (PR5).
