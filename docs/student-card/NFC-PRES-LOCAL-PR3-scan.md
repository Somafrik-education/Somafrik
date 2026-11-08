# NFC-PRES-LOCAL-PR3 — Scanner NFC/QR hors connexion et interface d'appel

Statut : **DRAFT / HOLD / NO MERGE**. Le flag `studentCardOfflineRollCallEnabled` est **désactivé par défaut** et n'est activé pour aucun établissement. Contrat : PR0 (#1111), PR1a/b/c (#1112, #1114, #1120), PR2 (#1123).

PR3 réalise l'**acquisition et la clôture locales**. La transmission au serveur relève de PR4 : aucun écran n'affiche « Synchronisé ».

## 1. Flag établissement (Backend puis Mobile)

| Couche | Changement |
| --- | --- |
| PostgreSQL | `school_settings.student_card_offline_roll_call_enabled BOOLEAN NOT NULL DEFAULT FALSE` (migration `20261109_…`, `schoolSettingsSchema.js`, `schema.sql`) |
| Paramètres | sixième entrée de `STUDENT_CARD_FLAG_FIELDS` : même lecture fail-closed, même fusion, même validation et même permission d'écriture que les cinq flags carte. Aucun système parallèle. |
| Capacités | `GET /api/student-cards/capabilities` expose `studentCardOfflineRollCallEnabled` (même RBAC, même résolution d'établissement) |
| Pack (PR1b) | flag coupé → `404 ROLL_CALL_OFFLINE_DISABLED`, aucun pack ni aucune donnée d'élève |
| Synchronisation (PR1c) | garde W : flag coupé → `404 ROLL_CALL_OFFLINE_DISABLED` + `sessionState: "not_recorded"`, rien d'écrit. La garde R (relecture d'un ACK déjà enregistré) reste indépendante des flags (test R-3). |
| Web | interrupteur « Appel hors connexion (NFC / QR) » dans la section Carte élève existante, neutralisé par le flag maître |
| Mobile | `isStudentCardOfflineRollCallEnabled` = maître ∧ pointage présence ∧ flag ∧ (NFC ∨ QR), fail-closed |

## 2. Parcours

1. **Présences → classe** : le bouton « Démarrer l'appel NFC/QR » n'apparaît que pour l'enseignant, avec le droit de modifier les présences, le flag, une classe sélectionnée, sur Android ou iOS, et au moins un support utilisable. L'appel en ligne existant est inchangé.
2. **Préparation** :
   - base SQLCipher du compte authentifié ;
   - un appel déjà clôturé aujourd'hui → « en attente de synchronisation », pas de second appel ;
   - téléchargement du pack si le réseau le permet ; sinon pack préchargé ; sinon **mode dégradé** explicite, avec son motif ;
   - reprise du brouillon de la classe et du jour, **avec son propre pack d'origine**.
3. **Écran** : classe, date, élèves, présents, restants, scans à vérifier, état local, liste des élèves, clôture explicite.
4. **NFC** : boucle et adaptateur natifs existants (`createRollCallNfcLoop`, `scanNfcCardToken`, mode lecteur conservé), NDEF `somafrik:card:<publicId>.<secret>`. L'UID n'est jamais lu.
5. **QR** : caméra existante, même traitement, `medium = qr`.
6. **Traitement d'une lecture** (`processCard`) :
   - format strict ;
   - K = SHA-256(secret) ;
   - preuve HMAC liée au support ;
   - rapprochement (`cardRef` + `verifier`) avec le pack **vérifié** ;
   - transaction SQLCipher ; résultat affiché **après COMMIT** ;
   - aucune requête réseau.
7. **Doublons** : « Carte déjà scannée », compteur inchangé, lecture continue. Une deuxième carte du même élève est enregistrée, mais l'élève n'est compté qu'une fois.
8. **Corrections** : Présent, Retard ou Absent. « Justifié » n'est jamais saisissable. Un statut du jour déjà enregistré (présent, retard ou justifié) est protégé : un scan ne l'écrase pas et une correction est refusée.
9. **Clôture** :
   - récapitulatif (élèves, présents, retards, absents, scans à vérifier, avertissement en mode dégradé) puis confirmation explicite ;
   - aucune clôture automatique ;
   - lot du contrat PR0 §6.1, absents déduits, `operationId`, `payloadDigest`, corps figé, `draft → closed` dans une transaction ;
   - message : « Appel enregistré sur ce téléphone — en attente de synchronisation. »

## 3. Comptes et cycle de vie (`rollCall/runtime`)

- **Démarrage et reprise** : `runStartupMaintenance` (purges, quarantaines), sans ouvrir de base.
- **Changement de compte ou d'établissement** : la base ouverte est fermée immédiatement. Aucune base n'est créée pour un compte qui n'ouvre pas l'appel hors connexion.
- **Déconnexion** (`runtime/logoutFlow.ts`) — contrat MP-011 préservé : la décision est **synchrone** et ne lit pas SQLite ; elle s'appuie sur le dernier état vérifié du compte (calculé au changement de session, à l'ouverture de l'appel et après chaque écriture locale) :
  - aucun appel en attente connu (Parent et tout profil sans appel NFC, enseignant sans appel, vérification en cours) → session vidée **immédiatement** (`clearAuthenticatedState`, `logoutSession` / SecureStore), puis traitement du stockage : effacement uniquement si le gestionnaire compte 0 appel sous son verrou ; un appel apparu entre-temps est conservé en `blocked_logout` ;
  - appel en attente vérifié → confirmation **avant** la déconnexion (« Rester connecté » / « Se déconnecter »), puis `blocked_logout`, reprise par le même compte uniquement ;
  - lecture ou ouverture SQLCipher en échec → jamais interprétée comme « 0 en attente » : confirmation « Vérification impossible », rien n'est effacé, base fermée ;
  - une seule demande à la fois (double clic) ; une confirmation donnée après un changement de session est ignorée ; une vérification terminée après la déconnexion referme la base ;
  - session expirée → aucun effacement d'appel en attente.
- Rien n'est stocké dans l'Outbox JSON.

## 4. Clés de pack : état réel

Les trousseaux embarqués de préproduction et de production sont **vides**. Les clés n'ont pas été générées, et ce dépôt ne contient ni ne doit contenir aucune clé privée. Conséquences :
- en préproduction comme en production, tout pack est refusé (`RC_PACK_REVOCATIONS_INVALID` / `RC_PACK_KEY_UNKNOWN`) et l'appel fonctionne **en mode dégradé** : cartes enregistrées « à vérifier », sans nom ni absences déduites ;
- la reconnaissance locale avec pack est prouvée par les tests Node (signataire Backend PR1b) et sur Android avec la **clé de test V-9**, présente uniquement dans l'APK de recette (absente du bundle de production, contrôle §6) ;
- avant toute activation : générer `active` et `standby` par environnement (procédure PR1b), configurer les secrets Backend, publier les clés **publiques** dans `pack/keyring.ts`, vérifier la séparation préproduction / production.

## 5. Cas hors connexion et preuves

| Cas | Preuve |
| --- | --- |
| Mode avion avant l'ouverture (pack préchargé la veille) | `offlineRollCall.test.ts` « mode avion », « pack préchargé la veille » |
| Coupure pendant ou après des scans | aucun réseau par scan (le téléchargement n'a lieu qu'à la préparation) ; scans validés un par un |
| Fermeture, arrêt forcé, redémarrage, reprise | « fermeture puis réouverture », `rollCallCrash.test.ts` (SIGKILL), recette Android (`pr3_persist=ok`) |
| Carte scannée deux fois, cartes multiples, carte inconnue | « appel complet avec pack » |
| Pack expiré ou falsifié, trousseau vide | « pack falsifié ou expiré » |
| Changement de compte, déconnexion avec brouillon | `rollCallRuntime.test.ts`, `logoutFlow.test.ts` (Parent immédiat, enseignant sans / avec appel, annuler / valider, échec de lecture et d'ouverture SQLCipher, session forcée, changement de compte, double clic, course) |
| COMMIT refusé (disque plein) | « échec d'écriture » : carte non comptée, message explicite |
| Lot accepté par le serveur | `readSyncBody` (PR1c) valide chaque lot clôturé ; `verifyProof` (PR1a) vérifie chaque preuve et refuse la permutation NFC/QR |
| Hermes Android | recette native : carte vecteur → preuve **V-4** calculée sous Hermes → rapprochement → COMMIT → doublon refusé → clôture → relue après `force-stop` |

## 6. Écarts et décisions

1. **Pack préchargé** : un pack « pas encore valide » n'est plus supprimé au chargement. Il est conservé pour son jour et n'est jamais utilisé avant `notBefore`. C'est un défaut trouvé en PR3 : le préchargement de la veille ne pouvait pas servir.
2. **Mode dégradé** : sans liste, aucune absence n'est déduite. Le serveur répondra probablement `ROLL_CALL_ROSTER_CHANGED` + `not_recorded` à la synchronisation, et une révision sera nécessaire (PR4).
3. **Un appel clôturé non synchronisé** pour la classe et le jour bloque l'ouverture d'un second appel hors connexion sur le téléphone. La correction passera par la révision PR4.
4. **Mandat** : le texte du mandat PR3 reçu s'interrompt au §7 (« Vérifier la séparation préproduction / prod »). Les sections suivantes ont été traitées selon les mandats précédents : tests, CI, preuves natives, rapport.

## 7. Hors périmètre, pour PR4 et PR5

- **PR4** :
  - runner de synchronisation (`beginSyncAttempt` → `POST /api/student-cards/roll-call/offline/v1/sync`, `Idempotency-Key = operationId`, corps figé envoyé à l'identique → `recordSyncOutcome`), backoff, `recordTrustedTime` sur l'en-tête `Date` ;
  - écran « À synchroniser / Synchronisé / Non confirmable » et révision après `not_recorded`.
- **PR5** : recette physique NTAG213/216 sur appareils ARM64, coupure réseau réelle, rotation des clés.
