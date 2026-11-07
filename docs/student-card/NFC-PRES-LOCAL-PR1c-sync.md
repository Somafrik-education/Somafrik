# NFC-PRES-LOCAL-PR1c — Synchronisation transactionnelle des appels hors ligne

Statut : **DRAFT / HOLD**. Aucune activation, aucun déploiement. Aucun code Mobile.

Contrat : `docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md` (§6). Code : `backend/lib/rollCallOfflineSync.js`.

## 1. Route

`POST /api/student-cards/roll-call/offline/v1/sync` — `Idempotency-Key: <operationId>` obligatoire, `Cache-Control: no-store`.

Permission : `Présences:CREATE` ou `Présences:UPDATE` (comme `/validate`), refus plateforme (`PLATFORM_PERSONAL_DATA_DENIED`).

Corps : contrat PR0 §6.1, validé **strictement** avant toute lecture en base :
- champs exacts (aucun champ manquant ni supplémentaire, au niveau du lot, de chaque scan et de chaque marque) ;
- `contractVersion = rc-offline-1`, `mode = teacher`, `complete = true`, `revision` entier ≥ 1 ;
- UUID en minuscules, `packId` UUID ou `null` (mode dégradé), date calendaire réelle ;
- `medium ∈ {nfc, qr}`, statuts manuels `present | late | absent` (jamais `excused`) ;
- au plus 300 scans et 300 marques, `scans` triés strictement par `scanId`, `manual` par `studentId` (doublons refusés) ;
- `scannedAt` au format ISO-8601 UTC, informatif uniquement ;
- `Idempotency-Key` strictement égale à `operationId` (`400 ROLL_CALL_OPERATION_KEY_REQUIRED`) ;
- `payloadDigest` recalculé : `SHA-256(JCS(corps sans payloadDigest))` via `rollCallOfflineProof.computePayloadDigest` (validateur de types, `jcs.js`, plafond 256 Kio) ; écart → `400 ROLL_CALL_DIGEST_MISMATCH`.

## 2. Ordre d'exécution (une transaction PostgreSQL, READ COMMITTED)

| # | Étape | Échec |
| --- | --- | --- |
| 1 | `requireAuth`, permission effective, validation stricte, digest | 401 / 403 / 400 |
| — | Gate d'abonnement `write_presence` **évalué** hors transaction (comme les routes existantes), **appliqué** seulement à l'étape 7 | — |
| 2 | Verrou d'idempotence (`withIdempotencyTransaction`) | — |
| 3 | **Garde R** (option additive `guard` de `withIdempotency`, avant `findReplay`) | `403 ROLL_CALL_REPLAY_FORBIDDEN` |
| 4 | Rejeu `idempotency_keys` (mémoire puis base) | 200 ACK / `409 IDEMPOTENCY_KEY_REUSED` |
| 5 | Verrou de session `pg_advisory_xact_lock('rc-offline-session', schoolId:sessionId)` | — |
| 6 | Journal `(school_id, session_id)` lu sous verrou | 200 ACK figé / `409 ROLL_CALL_SESSION_CONFLICT` |
| 7 | **Garde W** : rôle, flags maître et présences, flag de chaque support utilisé, classe et affectation, abonnement | 403 / 404 + `not_recorded` |
| 8 | Fenêtre `[D 00:00 ; D+4 00:00[` (fuseau courant de l'établissement) | `409 ROLL_CALL_OFFLINE_EXPIRED` + `not_recorded` |
| 9 | `lockRollCallDay` | — |
| 10 | Cartes `FOR SHARE` (ordre `id`), preuves HMAC, état, support, titulaire inscrit | `400 PROOF_INVALID` / `409 CARD_INVALID` + `not_recorded` |
| 11–13 | `applyTeacherMarks` (moteur partagé avec `/validate`) : `lockEnrolledRoster`, appel complet, présences `FOR UPDATE`, `attendanceTransition`, écritures gardées | `409 ROSTER_CHANGED` / `CONCURRENT_UPDATE` + `not_recorded` |
| 14 | Journal (`source = offline`, `operation_id`, `payload_digest`, `ack_body`) | 500, rollback |
| 15 | Audit `student_card_roll_call_offline_sync`, puis stockage d'idempotence | 500, rollback |
| 16 | COMMIT, réponse 201 | — |

## 3. Gardes R et W

**R (relire son propre ACK)** — `guardReplayAccess` : identité du JWT, utilisateur canonique (`resolveCanonicalUserIdForSchool`), `users.school_id` **relu en base** égal à l'établissement résolu et au `schoolId` du lot, compte `active`, rôle `TEACHER` actif relu en base, aucun rôle plateforme. Ni affectation, ni flags, ni abonnement, ni fenêtre de date. Refus uniforme, **indépendant de l'existence de la session**.

Constat : un transfert d'établissement (`users.school_id` modifié) révoque déjà la session à l'authentification (`401 SESSION_SCHOOL_ATTACHMENT_MISSING`) ; un établissement suspendu est refusé avant la garde R. Ces refus n'ont pas d'attestation (« État serveur non confirmable » côté Mobile). La garde R reste la défense explicite, testée unitairement.

**W (nouvel enregistrement)** : uniquement si aucun appel n'est enregistré pour la session (étape 6). Toute erreur 4xx de W porte `sessionState: "not_recorded"`, émis **après** la lecture du journal sous verrou ; la transaction est annulée. Un 5xx ne porte jamais d'attestation.

## 4. Décisions d'implémentation

- **Pointage manuel prioritaire** : pour un élève à la fois scanné et pointé, la marque manuelle fait foi (correction explicite) ; le scan est tout de même vérifié.
- **Absents** : le serveur ne crée jamais d'absence en silence. L'appel complet doit couvrir tous les inscrits (marque envoyée ou statut déjà présent ce jour-là), sinon `409 ROLL_CALL_ROSTER_CHANGED` ; le Mobile envoie `absent` pour les élèves non scannés à la clôture.
- **Carte inconnue ou preuve fausse** → `PROOF_INVALID` (aucun indice d'existence) ; **preuve valide mais carte inutilisable** (révoquée, remplacée, perdue, NFC en attente, support incohérent, titulaire désinscrit) → `CARD_INVALID`. `details.invalidScanIds` ne contient que des `scanId`.
- **Ordre des verrous** : idempotence → session → jour → cartes (`FOR SHARE`) → inscriptions → présences. `/validate` prend cartes → jour → … : verrous partagés sur les cartes, aucune inversion bloquante.
- **ACK figé** : construit dans la transaction (compteurs exacts après écriture), inséré avec le journal ; rejoué tel quel (`idempotentReplay: true`), jamais recalculé depuis l'état courant des présences.
- **`replayStatusCode: 200`** (option additive de `withIdempotency`) : tout rejeu répond 200 ; le cache mémoire conserve le statut d'origine.
- **`sessionState`** est ajouté par le gestionnaire d'erreurs global uniquement si l'erreur le porte (seule cette route le pose).

## 5. Migration

`backend/db/migrations/20261108_attendance_roll_calls_offline_sync.sql`, appliquée par `ensureAttendanceRollCallsSchema` après la migration d'origine (source SQL unique). Additive et idempotente : colonnes `source` (défaut `online`), `operation_id`, `payload_digest`, `ack_body` ; contraintes `attendance_roll_calls_source_check` et `attendance_roll_calls_offline_shape_check` (hors ligne : `mode = teacher`, opération, empreinte hexadécimale de 64 caractères et ACK objet, avec `IS NOT NULL` explicites ; en ligne : aucun de ces champs). Unicité `(school_id, session_id)` inchangée. Aucune suppression ni réécriture.

## 6. Risques résiduels

- Le gate d'abonnement est évalué juste avant la transaction : une suspension intervenant pendant la requête n'est vue qu'à la requête suivante (comme les routes existantes).
- `scannedAt` et l'horloge du téléphone ne servent jamais d'autorisation : un enseignant peut synchroniser jusqu'à la fin de J+3 un appel de J ; les preuves restent liées à la date, la session et l'acteur.
- Le pack (PR1b) n'est pas lu : une carte reconnue localement peut être refusée au sync (`CARD_INVALID`), l'enseignant corrige et renvoie une nouvelle révision (`not_recorded`).
