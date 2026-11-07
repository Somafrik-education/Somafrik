# NFC-PRES-LOCAL-PR0 — Audit de faisabilité et contrat de sécurité offline-first

**Statut : AUDIT / DRAFT / HOLD — NO READY / NO MERGE / NO DEPLOY.**
Document seul : aucun code produit, aucune migration exécutée, aucun déploiement.

| Élément | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Base lue | `develop@4185c88bc813d50cd71bd9e2466287e4290833fb` (HEAD courant au 2026-11-07) |
| Références | #1098 (mandat), #921 (physique NFC), #911 (transactionnel), PR #1099 (audit physique), PR #1100 (audit offline) |
| Anciennes PR | #912, #922, #925 : Draft/HOLD, divergentes, **non réutilisées** |

Ce document **complète** les audits #1099 et #1100 sans les répéter : il prend les blocages P0-A à P0-E de #1100 comme acquis et fournit les **décisions d'architecture** manquantes (cryptographie, modèle local, contrat batch, idempotence, découpage).

---

## 1. Audit du code actuel — matrice existant / réutilisable / manquant

Lecture directe sur `develop@4185c88`.

### 1.1 Backend

| Module | Existe | Réutilisable tel quel | Manque pour l'offline | Risque de régression |
| --- | --- | --- | --- | --- |
| `backend/lib/studentCardRollCall.js` — `scanRollCallDraft` | Reçu AES-256-GCM (`rc1`), TTL 4 h, dedupKey HMAC session/élève | Non : exige le réseau à chaque carte | Preuve générée **sans** serveur | Nulle si la route n'est pas modifiée |
| idem — `validateRollCall` / `writeTeacherRollCall` | Revalidation rôle live, affectation, flags, cartes `FOR SHARE`, `lockRollCallDay`, `attendanceTransition`, `complete:true` + `ROSTER_CHANGED`, journal | **Oui** : le moteur d'écriture (transitions, verrous, journal, audit, comptage) est la bonne base | Entrée « preuves offline » au lieu de « reçus » ; ACK rejouable au-delà de 24 h | Moyen si on modifie la fonction : extraire sans changer le comportement (tests existants verts) |
| idem — `rollCallRoster` | Liste, statut existant, `matchKey` par session | Partiellement | Données de vérification locale des cartes (§3) | Faible (nouvelle route) |
| `backend/lib/studentAccessCardsManagement.js` — `scanStudentCard` | Jeton `publicId.secret`, `token_hash = sha256(secret)`, comparaison à temps constant, refus `pending`/inactif | Oui (règles d'état) | Vérification d'une preuve HMAC dérivée de `token_hash` | Nulle |
| `backend/lib/studentCardAttendance.js` | Flag `studentCardAttendanceEnabled`, pointage individuel | Oui | — | Nulle |
| `services/idempotencyService.js` — `withIdempotency` | Transaction + verrou, empreinte `sha256(stableSerialize(body))`, TTL **24 h**, 409 `IDEMPOTENCY_KEY_REUSED` | Oui | Rejeu au-delà de 24 h (un téléphone peut rester hors ligne plusieurs jours) | Nulle |
| `attendance_roll_calls` (migration `20261016`) | Unicité `(school_id, session_id)` | Oui | Colonnes `operation_id`, `payload_digest`, `source` pour un ACK rejouable | Migration **additive** uniquement |
| Index `uq_attendance_school_student_date` | Une présence par élève et par **jour** | Oui | — | Note : le modèle est journalier, pas par séance (§9, P1-4) |
| Flags `schoolSettingsManagement` | `studentCardEnabled`, `…QrEnabled`, `…NfcEnabled`, `…AttendanceEnabled` | Oui | Les routes roll-call **ne vérifient pas** `studentCardNfcEnabled` / `…QrEnabled` | À ajouter sur la nouvelle route uniquement |
| Routes `server.js:2670-2730` | `/scan`, `/roster`, `/validate`, `/overview` ; `rollCallHttpPrincipal` (gate `write_presence`) ; `platformPersonalDataGuard` | Oui (chaîne d'authentification) | Nouvelles routes versionnées à enregistrer dans `requirePermission` et `platformPersonalDataGuard` | Faible |

### 1.2 Mobile

| Module | Existe | Réutilisable | Manque | Risque |
| --- | --- | --- | --- | --- |
| `lib/studentCardRollCall.ts` | Brouillon **en RAM** (`receipt`, `dedupKey`), `createRollCallNfcLoop` (une lecture à la fois, réarmement) | Boucle NFC : **oui** ; brouillon : non | `submit(token)` doit devenir local (≈ ms) au lieu d'un appel HTTP | Faible si le parcours en ligne reste derrière un flag |
| `lib/studentCardClassRollCall.ts` | Appel complet, absents provisoires, statuts protégés, `complete:true` | Règles pures : **oui** | Persistance | Faible |
| `lib/studentCardRollCallSession.ts` | UUID session = Idempotency-Key | Oui | Stocker la session en base | Nulle |
| `services/studentCardRollCallApi.ts` | Client des 3 routes | Oui | Client de la route batch v1 | Nulle |
| `lib/studentCardNfcNative.ts`, `nfcSession*.ts` | Mode lecteur conservé entre deux cartes (NFC-REG-01), bail unique | **Oui** | — | Nulle |
| `lib/studentCardNfc.ts` | Parse NDEF `somafrik:card:<publicId>.<secret>` ; UID jamais utilisé comme identité | Oui | — | Nulle |
| `lib/studentCardNfcAttendanceScanner.ts` | Scan **individuel** à écriture immédiate | Non concerné | — | Hors périmètre, non-régression |
| `lib/outbox.ts` | File persistante `presences`, statuts `pending/sending/sent/failed/blocked_*`, verrou d'intention, fail-closed | Primitives (classification, verrou, `blocked_logout`) : **oui** | **Stockage = JSON en clair** dans `documentDirectory` : inadapté aux preuves et aux identifiants d'élèves | Élevé si on y met le lot |
| `lib/attendanceOffline.ts` / `attendanceTruth` | Overlay `queued/failed/postgres` | Oui (badges d'état) | Source = base roll-call | Faible |
| `offline/l1/*` | SQLCipher obligatoire (pas de repli en clair), clé 256 bits dans SecureStore, fichier/clé **par environnement**, file d'écriture sérialisée, migrations | Primitives d'ouverture : **oui** | L1 est un cache **jetable**, purgé au logout / changement de partition : ne doit pas porter des intentions non synchronisées | Élevé si on ajoute les tables dans L1 |
| Dépendances | `expo-sqlite` (SQLCipher), `expo-secure-store`, `expo-crypto` (SHA-256, UUID), `react-native-nfc-manager` | Oui | **HMAC-SHA256** non fourni par `expo-crypto` : construire HMAC sur `digest` ou ajouter `@noble/hashes` (décision PR2) | Faible |

### 1.3 Base de tests relevée (non-régression, sur ce HEAD)

| Commande | Résultat |
| --- | --- |
| `node --test backend/lib/studentCardRollCall.test.js backend/lib/studentCardAttendance.test.js` | PASS 17/17 |
| `npx tsx Mobile/src/lib/studentCardRollCall.test.ts` | PASS 9/9 |
| `npx tsx Mobile/src/lib/studentCardClassRollCall.test.ts` | PASS 11/11 |
| `npx tsx Mobile/src/lib/attendanceOffline.test.ts` | PASS |
| Tests `*.http.pg.test.js` roll-call (PostgreSQL réel) | NOT RUN dans PR0 (aucune dépendance installée ; exigés dès PR1) |

---

## 2. Schéma de circulation des données

```
 OUVERTURE (réseau requis une fois, ou pack préchargé)
 Mobile ──GET /roll-call/offline/v1/pack?classId&date──▶ Backend
        ◀── pack signé : packId, expiresAt, élèves (matchKey, nom, statut existant),
            cartes (cardRef, verifier, matchKey) ── aucun secret, aucun publicId
        ▶ SQLCipher « rollcall » : rc_packs / rc_pack_students / rc_pack_cards

 SCAN (zéro réseau)
 NTAG ──NDEF somafrik:card:<publicId>.<secret>──▶ RAM
        h      = SHA256(secret)                         (RAM, jamais stocké)
        ref    = SHA256("rc-ref:v1|" + packId + "|" + publicId)
        verif  = HMAC(h, "rc-verify:v1|" + packId + "|" + publicId)   → comparaison locale
        proof  = HMAC(h, "rc-proof:v1|" + school|class|date|session|scanId|publicId)
        effacement de secret et h
        BEGIN IMMEDIATE → INSERT rc_scans(publicId, proof, statut local) → UPSERT rc_marks → COMMIT
        ── uniquement après COMMIT : bip + compteur

 CORRECTIONS (zéro réseau) : rc_marks présent / retard / absent ; statuts protégés non modifiables

 CLÔTURE EXPLICITE : lot figé (révision, operationId, payloadDigest) → état « à synchroniser »

 SYNCHRONISATION
 Mobile ──POST /roll-call/offline/v1/sync  (Idempotency-Key = operationId)──▶ Backend
        transaction unique : flags, rôle live, affectation, date, preuves, cartes FOR SHARE,
        inscriptions, roster complet, attendanceTransition, journal, audit
        ◀── 201 ACK { rollCallId, operationId, payloadDigest, counts, protected… }
        ▶ état « synchronisé » + purge des preuves ; aucun autre chemin vers « synchronisé »
```

---

## 3. Architecture cryptographique — décision

### 3.1 Options comparées

| | A. Stocker le `cardToken` chiffré (SQLCipher) puis le rejouer vers `scanStudentCard` | B. Preuve de possession liée à la session (HMAC clé = `token_hash`) | C. B + pack de vérification locale |
| --- | --- | --- | --- |
| Secret de carte sur disque | **Oui** (chiffré) : capability permanente et réutilisable pour toute la classe | **Non** | **Non** |
| Impact d'une extraction du téléphone | Clonage possible des cartes de la classe, pour tous les usages futurs | Rejeu limité à **cette** session (déjà unique) | Idem B ; les `verifier` sont liés au pack et ne révèlent pas le secret (256 bits) |
| Vérification serveur | Réutilise `scanStudentCard` | Nouvelle vérif HMAC, temps constant | Idem B |
| Retour immédiat « carte reconnue » hors ligne | Non | Non (tout reste « à vérifier ») | **Oui** (provisoire) |
| Complexité | Faible | Moyenne | Moyenne + |
| Conformité mandat (« jamais de secret NFC en clair sur disque ») | Limite | Oui | Oui |

### 3.2 Recommandation : **option C**

1. **Le secret ne quitte jamais la RAM.** `h = SHA256(secret)` est calculé au scan ; `secret` et `h` sont effacés de l'objet de lecture après calcul (même règle que `holdCardToken`/`releaseCardToken`).
2. **Preuve stockée** = `HMAC-SHA256(h, "rc-proof:v1|" schoolId|classId|date|sessionId|scanId|publicId)` en base64url. Elle n'est valable que pour ce tuple ; `scanId` (UUID v4) est unique par scan.
3. **Vérification serveur** : carte trouvée par `publicId` **dans l'établissement**, recalcul avec `token_hash` stocké, `crypto.timingSafeEqual`. Échec → scan invalide (jamais d'identité révélée).
4. **Pack de vérification locale** (option C) : pour chaque carte `active` et encodée des élèves de la classe, le serveur fournit `cardRef = SHA256("rc-ref:v1|" packId|publicId)` et `verifier = HMAC(token_hash, "rc-verify:v1|" packId|publicId)`. Le téléphone calcule les mêmes valeurs à partir de la carte lue et obtient un statut **provisoire** :
   - `verified_local` : carte reconnue au moment du pack → compte dans « scannés » ;
   - `unknown_local` : référence absente (carte émise après le pack, autre classe, autre établissement) → compteur séparé « à vérifier », jamais compté présent localement ;
   - `forged_local` : référence connue mais `verifier` faux → refus immédiat, rien n'est stocké.
5. **Ce que le local ne décide jamais** : la validité finale. Révocation, remplacement, inscription, rôle, affectation, flags et tenant sont relus au moment de la synchronisation (§5.3).
6. **UID NFC** : jamais une preuve. Il n'est ni stocké ni envoyé dans PR1–PR4. (Option ultérieure de défense en profondeur : comparer à `nfc_uid`, sans valeur d'authentification.)
7. **QR** : même format de jeton, même calcul ; le support est noté `medium` et contrôlé par le flag correspondant.

### 3.3 Compromis assumés (à arbitrer CTO)

- **P1-1 — `token_hash` devient un vérificateur** : avec B/C, qui détient `token_hash` peut forger une preuve. Aujourd'hui `token_hash` seul ne permet pas de scanner. Mitigation : séparation de domaine stricte, `token_hash` déjà dans `FORBIDDEN_AUDIT_KEYS`, jamais exposé par une API, test dédié « aucune route ne renvoie `token_hash` ». L'alternative (clé dérivée stockée en colonne séparée) exige une réémission ou un réencodage de toutes les cartes : rejetée.
- **P1-2 — Rejeu dans la même session** : la preuve est rejouable par le titulaire du téléphone, uniquement dans sa propre session, qu'il peut déjà remplir manuellement. Acceptable.
- **Anti-clonage** : non couvert (comme aujourd'hui, #1100). Une copie du NDEF reste valide tant que la carte n'est pas révoquée.

---

## 4. Modèle SQLite et politique de conservation

### 4.1 Base dédiée

- Fichier **séparé** `somafrik-rollcall-v1-<environmentId>.db`, clé `somafrik.rollCallDbKeyV1.<environmentId>` dans SecureStore, ouvert par les primitives de `offline/l1/database.ts` (SQLCipher obligatoire, `cipher_version` non vide, aucun repli en clair).
- Pourquoi pas dans L1 : L1 est un cache jetable purgé au logout et au changement de partition ; un appel non synchronisé est une intention utilisateur.
- Pourquoi pas dans `outbox.ts` : fichier JSON en clair.

### 4.2 Tables (migration locale v1)

```sql
rc_packs (pack_id PK, user_id, school_id, class_id, roll_call_date, issued_at, expires_at, signature)
rc_pack_students (pack_id, match_key, student_id, student_code, first_name, last_name,
                  existing_status, PRIMARY KEY (pack_id, match_key))
rc_pack_cards (pack_id, card_ref, match_key, verifier, PRIMARY KEY (pack_id, card_ref))

rc_sessions (
  session_id PK, env_id, user_id, school_id, school_code, class_id, roll_call_date,
  mode CHECK (mode = 'teacher'), pack_id NULL,
  state CHECK (state IN ('draft','closed','syncing','synced','failed_retryable',
                         'failed_action_required','expired')),
  revision INTEGER NOT NULL DEFAULT 1, operation_id NULL, payload_digest NULL,
  opened_at, closed_at, synced_at, server_roll_call_id, last_error_code,
  attempt_count, next_attempt_at, sync_deadline)
rc_scans (scan_id PK, session_id, public_id, proof, medium CHECK (medium IN ('nfc','qr')),
          scanned_at, local_status CHECK (local_status IN ('verified_local','unknown_local')),
          match_key NULL, removed_at NULL)
  UNIQUE INDEX (session_id, public_id) WHERE removed_at IS NULL     -- même carte = une ligne
rc_marks (session_id, match_key, status CHECK (status IN ('present','late','absent')),
          source CHECK (source IN ('card','manual','existing','default')), updated_at,
          PRIMARY KEY (session_id, match_key))                       -- un élève = une marque
rc_sync_attempts (session_id, attempt, started_at, http_status, error_code)  -- aucune PII
```

Règles :
- **Une transaction par scan** (`BEGIN IMMEDIATE` … `COMMIT`) ; le retour visuel/sonore n'est émis qu'après `COMMIT`. Échec SQLite → message d'erreur, compteur inchangé.
- Plusieurs cartes du même élève → plusieurs `rc_scans`, une seule `rc_marks` (`match_key`).
- Un appel ouvert au plus par `(user_id, school_id, class_id, roll_call_date)` en état `draft` (index unique partiel).
- Toutes les lectures sont filtrées par `(env_id, user_id, school_id)`.

### 4.3 Conservation, expiration, purge

| Donnée | Durée | Purge |
| --- | --- | --- |
| Pack | jusqu'à `expires_at` = fin du jour scolaire de `date` (max 18 h) | à expiration ou à la synchro de la session |
| Brouillon `draft` | scans autorisés seulement le jour `date` | jamais silencieuse ; passe `expired` après `sync_deadline` |
| Lot `closed` / `failed_*` | `sync_deadline` = `date` + 72 h (défaut, serveur fait foi) | après `sync_deadline` : preuves effacées, résumé compteurs conservé, action utilisateur « saisir manuellement » |
| Preuves (`rc_scans.proof`) | jusqu'à ACK | effacées dans la même transaction que le passage `synced` |
| Session `synced` | résumé 7 jours (pour l'historique local) | purge automatique |
| Logout | sessions non synchronisées conservées en `blocked_logout` (modèle outbox), visibles du même utilisateur uniquement ; confirmation explicite avant logout | purge à `sync_deadline` |
| Clé SecureStore absente / base illisible | — | fail-closed : appel offline indisponible, message explicite, **jamais** de recréation silencieuse qui masquerait des lots perdus (journal d'incident sans PII) |

---

## 5. Contrat API batch (PR1)

Nouvelles routes, versionnées, **sans modifier** `/scan`, `/roster`, `/validate`.

### 5.1 `GET /api/student-cards/roll-call/offline/v1/pack?classId&date`

Autorisation identique à `rollCallRoster` (rôle live TEACHER, affectation active, flags maître + présences + NFC ou QR). Réponse `Cache-Control: no-store` :

```json
{
  "contractVersion": "rc-offline-1",
  "packId": "uuid", "classId": "uuid", "date": "2026-11-09",
  "issuedAt": "…", "expiresAt": "…", "syncDeadline": "…",
  "students": [{ "matchKey": "…", "studentId": "uuid", "studentCode": "…",
                 "firstName": "…", "lastName": "…", "existingStatus": null }],
  "cards": [{ "cardRef": "base64url", "matchKey": "…", "verifier": "base64url" }]
}
```

`matchKey` = HMAC serveur `(packId, studentId)` ; jamais de `publicId`, `token_hash`, UID ni secret.

### 5.2 `POST /api/student-cards/roll-call/offline/v1/sync`

En-tête `Idempotency-Key: <operationId>` (obligatoire, égal au champ du corps).

```json
{
  "contractVersion": "rc-offline-1",
  "operationId": "uuid", "sessionId": "uuid", "revision": 1,
  "classId": "uuid", "date": "2026-11-09", "mode": "teacher", "packId": "uuid|null",
  "complete": true,
  "scans":  [{ "scanId": "uuid", "publicId": "…", "proof": "base64url",
               "medium": "nfc", "scannedAt": "…" }],
  "manual": [{ "studentId": "uuid", "status": "present|late|absent" }],
  "payloadDigest": "sha256 hex du corps canonique sans payloadDigest"
}
```

Limites : 300 scans, 300 marques, corps ≤ 256 Ko, limiteur de débit par utilisateur. `scannedAt` est informatif (horloge non fiable).

### 5.3 Validation serveur (une transaction, tout ou rien)

1. Format, `contractVersion`, `operationId` = Idempotency-Key, digest recalculé.
2. Rôle **live** TEACHER, affectation active à la classe, établissement du principal, gate `write_presence`.
3. Flags **au moment de la synchro** : maître, présences, NFC (si scan `nfc`), QR (si scan `qr`). Flag coupé → 404 fail-closed, rien n'est écrit.
4. Date ∈ [aujourd'hui − 72 h ; aujourd'hui] (fuseau établissement) → sinon `ROLL_CALL_OFFLINE_EXPIRED`.
5. Pour chaque scan : carte par `publicId` dans l'établissement (`FOR SHARE`), preuve HMAC à temps constant, statut `active`, encodage ≠ `pending`, élève inscrit dans la classe. Carte révoquée / remplacée / perdue **même après le scan** → refus (l'horloge du téléphone ne fait pas foi).
6. Déduplication par élève (plusieurs cartes, plusieurs scans → une présence).
7. Réutilisation du moteur existant : `lockRollCallDay`, `lockEnrolledRoster` + `ROSTER_CHANGED`, `attendanceTransition` (aucun `excused` écrasé, présent → absent refusé), `upsertSchoolAttendanceBatch` avec gardes, journal `attendance_roll_calls`, audit.

Codes d'erreur (ajoutés à `ROLL_CALL_ERROR`) : `ROLL_CALL_PROOF_INVALID`, `ROLL_CALL_OFFLINE_EXPIRED`, `ROLL_CALL_DIGEST_MISMATCH`, `ROLL_CALL_SESSION_CONFLICT` ; réutilisés : `CARD_INVALID` (avec `invalidScanIds` et motif générique), `ROSTER_CHANGED` (avec `missingStudentIds` / `unexpectedStudentIds`, déjà connus de l'enseignant affecté), `ROLE_FORBIDDEN`, `CLASS_FORBIDDEN`.

### 5.4 ACK

`201` : `{ rollCallId, sessionId, operationId, payloadDigest, validatedAt, created, corrected, unchanged, protected, protectedStudentIds, counts }`. Le Mobile ne passe `synced` que si `operationId` et `payloadDigest` de l'ACK égalent ceux du lot.

---

## 6. Stratégie d'idempotence PostgreSQL

| Situation | Comportement |
| --- | --- |
| Retry < 24 h, même corps | `withIdempotency` rejoue l'ACK (`idempotentReplay: true`) |
| Retry > 24 h (clé expirée) | Journal trouvé par `(school_id, session_id)` avec même `operation_id` et `payload_digest` → `200` ACK reconstruit depuis le journal, aucune écriture |
| Même session, digest différent, déjà validée | `409 ROLL_CALL_SESSION_CONFLICT` → « échec à résoudre » |
| Double envoi simultané | verrou `withIdempotencyTransaction` + `lockRollCallDay` + unicité journal : une seule écriture, l'autre rejoue |
| Timeout après COMMIT | le Mobile reste `syncing`/`failed_retryable` et renvoie **le même corps** ; il ne peut ni modifier ni rouvrir le lot tant qu'aucune réponse définitive n'est reçue |
| Refus définitif (4xx) | rien n'est stocké côté idempotence ; correction locale → `revision + 1`, nouvel `operationId`, même `sessionId` |
| Conflit avec un autre appareil | `attendanceTransition` ; statuts protégés renvoyés, jamais écrasés |

Migration additive (PR1) : `ALTER TABLE attendance_roll_calls ADD COLUMN IF NOT EXISTS operation_id UUID, payload_digest TEXT, source TEXT DEFAULT 'online'` + contrainte `CHECK (source IN ('online','offline'))`. Pas de suppression, pas de réécriture.

---

## 7. Machine d'état Mobile

```
draft ──clôture explicite──▶ closed (lot figé, digest) ──▶ syncing
syncing ──2xx ACK conforme──▶ synced            (seul chemin vers « synchronisé »)
syncing ──réseau/timeout/5xx/429──▶ failed_retryable ──backoff──▶ syncing (même corps)
syncing ──4xx définitif──▶ failed_action_required ──correction──▶ draft (revision+1)
closed/failed_* ──sync_deadline dépassée──▶ expired
```

Libellés : « Brouillon local », « À synchroniser », « Synchronisé », « Échec à résoudre ». Aucune clôture automatique, même à 0 restant. Le runner de synchro réutilise `networkResilience` (`executeMutation`, `classifyMutationFailure`), `connectivity` et le cycle de vie d'`OutboxRuntime` ; seul le stockage diffère (SQLCipher).

---

## 8. Matrice de tests

| # | Scénario | PR | Niveau | Attendu |
| --- | --- | --- | --- | --- |
| 1 | 35 scans rapides | PR3 | unitaire + bench + Android | 35 marques, 0 appel HTTP, p95 écriture < 50 ms |
| 2 | Double lecture | PR2/PR3 | unitaire | 1 ligne, retour « déjà scannée » |
| 3 | Plusieurs cartes, même élève | PR1/PR2 | PG réel + unitaire | 1 présence |
| 4 | Mode avion avant / pendant | PR3/PR5 | Android | pack préchargé requis avant ; pendant : aucun impact |
| 5 | Arrêt forcé après N scans | PR2/PR5 | Android natif | N scans retrouvés |
| 6 | Redémarrage et reprise | PR2 | Android natif | brouillon intact |
| 7 | Coupure à la validation | PR4 | intégration | `failed_retryable`, jamais `synced` |
| 8 | Timeout après COMMIT PG | PR1/PR4 | PG réel | rejeu = ACK, 0 doublon |
| 9 | Double envoi simultané | PR1 | PG réel concurrent | 1 journal, 1 écriture |
| 10 | Changement de classe / établissement | PR1/PR2 | PG réel + unitaire | `CLASS_FORBIDDEN` / partition isolée, `ROSTER_CHANGED` |
| 11 | Révocation / remplacement avant synchro | PR1 | PG réel | `CARD_INVALID` + `invalidScanIds` |
| 12 | Expiration cache / perte de rôle ou d'affectation | PR1/PR4 | PG réel | 403 / `OFFLINE_EXPIRED`, rien n'est écrit |
| 13 | Conflit autre appareil | PR1 | PG réel | statut protégé conservé et signalé |
| 14 | Échec SQLite / corruption / clé absente | PR2 | unitaire + natif | fail-closed visible, compteur non incrémenté |
| 15 | Non-régression manuel + QR + routes en ligne | PR1–PR5 | suites existantes | inchangées |
| S1 | Preuve forgée / autre session / autre tenant | PR1 | PG réel | `PROOF_INVALID`, aucun indice d'existence |
| S2 | Aucun secret / `token_hash` / preuve dans logs, PR, fixtures | PR1–PR4 | test statique + `safeLogger` | 0 occurrence |
| S3 | Flags NFC/QR coupés entre scan et synchro | PR1 | PG réel | refus fail-closed |

Physique (#921, PR5) : NTAG213 et NTAG216, 30+ scans, `active/encoded`, présence vérifiée dans PostgreSQL — **NOT RUN** depuis l'environnement Claude ; procédure opérateur fournie en PR5.

---

## 9. Risques

**P0**
- **P0-1** Aucun pack ⇒ aucun retour « reconnu » hors ligne : le préchargement doit être déclenché à l'ouverture de l'application/du planning tant que le réseau est présent ; sinon mode dégradé (tout « à vérifier »).
- **P0-2** Faux « synchronisé » : seul l'ACK conforme (§5.4) y mène ; test bloquant en PR4.
- **P0-3** Perte de lots au logout ou à la purge L1 : base séparée + `blocked_logout` (§4.3).
- **P0-4** Secrets sur disque : interdit par construction (§3.2) ; test statique S2.
- **P0-5** Dépendance #921 : aucune recette physique de présence tant que l'encodage n'est pas prouvé.

**P1**
- **P1-1** `token_hash` vérificateur (§3.3).
- **P1-2** Rejeu intra-session (§3.3).
- **P1-3** Plusieurs utilisateurs sur un même appareil : clé de base commune à l'appareil ; isolation logique par `user_id`.
- **P1-4** Modèle journalier : `uq_attendance_school_student_date` = une présence par élève et par jour. Un appel « par séance » (#1098) n'est pas représentable sans évolution du modèle Présences — hors périmètre, décision CTO requise.
- **P1-5** « Justifié » : #1098 propose la correction en « Justifié » avant clôture ; les règles actuelles réservent `excused` à la justification. **Décision retenue : règles actuelles conservées**, `excused` non saisissable dans l'appel.
- **P1-6** Révocation après le scan refusée : un élève réellement présent peut être refusé ; l'enseignant le repointe manuellement (révision + 1).
- **P1-7** HMAC côté Mobile : implémentation à choisir (HMAC sur `expo-crypto` vs `@noble/hashes`) avec vecteurs de test RFC 4231 communs Backend/Mobile.

---

## 10. Découpage définitif des PR

Chaque PR : branche issue du `develop` courant, Draft/HOLD, base/HEAD/merge-base/ahead-behind, diff complet pour revue CTO indépendante.

| PR | Branche | Contenu | Dépend de |
| --- | --- | --- | --- |
| **PR1a** | `feat/nfc-pres-local-pr1a-proof` | Module pur `studentCardOfflineProof.js` (ref, verifier, proof, vecteurs de test partagés JSON) ; aucune route | PR0 accepté |
| **PR1b** | `feat/nfc-pres-local-pr1b-pack` | `GET …/offline/v1/pack` + RBAC/flags/tenant + tests PG | PR1a |
| **PR1c** | `feat/nfc-pres-local-pr1c-sync` | Migration additive journal ; `POST …/offline/v1/sync` ; extraction sans changement du moteur `writeTeacherRollCall` ; ACK rejouable ; tests PG réels 3, 8–13, S1, S3 | PR1a |
| **PR2** | `feat/nfc-pres-local-pr2-store` | Base SQLCipher roll-call, migrations, repository transactionnel, purge, fail-closed ; tests 2, 5, 6, 14 | PR1a (vecteurs) |
| **PR3** | `feat/nfc-pres-local-pr3-scan` | Boucle NFC locale (`submit` local), HMAC Mobile, compteurs, corrections, UX, derrière un flag d'établissement `studentCardOfflineRollCallEnabled` (défaut off) | PR2, PR1b |
| **PR4** | `feat/nfc-pres-local-pr4-sync` | Runner de synchro, machine d'état, retries, conflits, ACK, `blocked_logout` | PR1c, PR3 |
| **PR5** | `test/nfc-pres-local-pr5-recette` | Intégration, APK préprod, Maestro, procédure opérateur NTAG213/216, preuves | PR4, #921 |

Le flag d'établissement (PR3) est le seul ajout de flag : il garantit que le parcours en ligne actuel reste le comportement par défaut et permet un déploiement progressif.

---

## 11. Gates et décisions demandées au CTO

1. Valider l'option **C** (§3.2) et les compromis P1-1 / P1-2.
2. Valider les durées : pack ≤ fin du jour scolaire, `sync_deadline` = date + 72 h.
3. Valider la base SQLCipher séparée et le refus d'étendre `outbox.ts` pour ce domaine.
4. Trancher P1-4 (séance vs jour) et confirmer P1-5 (`excused` hors appel).
5. Valider le découpage PR1a → PR5.

---

**NFC-PRES-LOCAL-PR0 — DRAFT / HOLD — EN ATTENTE DU DIFF CTO INDÉPENDANT.**
