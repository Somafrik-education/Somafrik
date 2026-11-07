# NFC-PRES-LOCAL-PR0 — Audit de faisabilité et contrat de sécurité offline-first

**Statut : AUDIT / DRAFT / HOLD — NO READY / NO MERGE / NO DEPLOY.**
Document seul : aucun code produit, aucune migration exécutée, aucun déploiement.

| Élément | Valeur |
| --- | --- |
| Dépôt | `Somafrik-education/Somafrik` |
| Base lue | `develop@4185c88bc813d50cd71bd9e2466287e4290833fb` (audit du code) ; branche mise à jour avec `develop@604a0eb6` en révision 3 |
| Références | #1098 (mandat), #921 (physique NFC), #911 (transactionnel), PR #1099 (audit physique), PR #1100 (audit offline) |
| Anciennes PR | #912, #922, #925 : Draft/HOLD, divergentes, **non réutilisées** |

Ce document **complète** les audits #1099 et #1100 sans les répéter : il prend les blocages P0-A à P0-E de #1100 comme acquis et fournit les **décisions d'architecture** manquantes (cryptographie, modèle local, contrat batch, idempotence, découpage).

### Révision 2 — corrections demandées par la revue CTO du 2026-11-07 (HEAD revu `6601cfd7`)

| Point de revue | Correction | Section |
| --- | --- | --- |
| P0-1 Preuve et flags | `medium` authentifié dans la preuve et le digest ; encodage canonique `LP` à longueurs préfixées au lieu du séparateur `\|` ; cohérence support/carte ; limites de l'attestation NFC vs QR ; vecteurs partagés | §3.2, §3.3, §9 |
| P0-2 Pack signé | Contenu signé complet, Ed25519 sur JCS, trousseau par environnement, rotation, rejet fail-closed, portée indicative | §4 |
| P0-3 Idempotence | Ordre exécution/verrous en 13 étapes, journal lu avant l'autorisation, `ack_body` figé, règles révision vs renvoi identique, envois concurrents identiques sans 409, rejeu > 24 h | §6 |
| P0-4 Cloisonnement local | Modèle de menace, une base et une clé par compte, crypto-effacement, clé perdue/quarantaine, logout ; pas de promesse d'effacement mémoire en JS | §3.4, §5 |
| P1-5 Produit et conservation | V1 journalière, `excused` hors appel ; durées justifiées par fuseau d'établissement et calculées serveur ; PII du pack ; limites anti-clonage | §3.6, §4.5, §5.5, §8 |
| P1-6 Tests | Tests pack falsifié/cross-tenant, altération du support, ACK/digest contradictoires, timeout après COMMIT, concurrence, droits révoqués, corruption, `token_hash` jamais exposé | §10 |

Aucun test PostgreSQL ni Android n'est exécuté ou revendiqué pour la nouvelle architecture.

### Révision 3 — corrections demandées par la revue CTO R2 (HEAD revu `fb81473e`)

| Point de revue | Correction | Section |
| --- | --- | --- |
| P0 Rejeu avant autorisation | Deux gardes distinctes : **R** (lire son propre résultat : identité, établissement résolu en base et égal au `schoolId` authentifié du lot, rôle `TEACHER` actif, permission live) exécutée **avant toute lecture** d'`idempotency_keys` ou du journal, via une option additive `guard` de `withIdempotency` ; **W** (nouvel enregistrement : en plus affectation, flags, abonnement, date). Réponses exactes ; refus R indépendant de l'existence de la session | §6.2, §6.3, §6.4, §6.5 |
| Refus après succès historique | `sessionState: "not_recorded"` émis seulement après lecture du journal sous verrou ; seule condition d'une nouvelle révision ; état Mobile `unconfirmable` (« État serveur non confirmable actuellement ») sans révision ; protocole R-1 à R-10 | §6.8, §6.9, §7 |
| P1-1 JCS | Bibliothèque unique `canonicalize@2.0.0`, validateur de types, pas de normalisation Unicode ; équivalence générale avec `stableSerialize` retirée (divergence démontrée, J-10) ; vecteurs J-1 à J-10 | §4.1, §9 |
| P1-2 Rotation | Clés `active` + `standby` dès la première APK, liste de révocation monotone, rotation urgente sans mise à jour instantanée des APK, refus fail-closed, récupération | §4.2 |
| P1-3 Déconnexion | Clé conservée seulement pour le même compte ; compte retiré ; purge par échéance sans ouvrir la base | §5.3, §5.5 |
| P1-4 403/404 | Séparation `403 REPLAY_FORBIDDEN` (incertain) / codes W avec `not_recorded` (définitif) | §6.5, §6.8 |

Le lot de synchronisation porte désormais `schoolId` (comparé, jamais utilisé pour résoudre l'établissement) : V-11 et V-12 sont recalculés. Aucun test PostgreSQL ni Android n'est exécuté ou revendiqué.

### Révision 4 — correction demandée par la revue CTO R3 (HEAD revu `9e1a9066`)

| Point de revue | Correction | Section |
| --- | --- | --- |
| Pack préchargé expirant avant la fin de la journée scolaire | `expiresAt = min(issuedAt + 18 h ; fin du jour local)` remplacé par une fenêtre d'utilisation = jour local de l'appel (`notBefore` = `D 00:00`, `expiresAt` = `D+1 00:00`, instants UTC signés) ; émission bornée à `[D−1 12:00 ; D+1 00:00[` ; détention ≤ 36 h (35–37 h au changement d'heure) ; rafraîchissement à l'ouverture si en ligne ; alternative du rafraîchissement obligatoire le matin documentée et écartée | §4.1, §4.3, §4.5 |
| Horloge fausse | `lastTrustedTime` (issu des réponses serveur), refus au-delà de 10 min de recul, fuseau de l'appareil sans effet, aucune prolongation possible | §4.5 |
| Tests | S12 (bornes serveur, deux changements d'heure, fuseau modifié) et S16 (fenêtre locale, horloge en avance, en retard, reculée) | §10 |

Le pack de test contient désormais `notBefore` : V-10 (signature) est recalculé. Le changement de durée est **explicite** et soumis à validation ; aucun smoke offline n'est déclaré PASS.

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
 OUVERTURE (réseau requis une fois, ou pack préchargé la veille)
 Mobile ──GET /roll-call/offline/v1/pack?classId&date──▶ Backend
        ◀── { pack, signature }  Ed25519 sur JCS(pack) ; aucun secret, aucun publicId, aucun UID
        vérification de la signature, du compte, de la classe, de la date et de l'expiration
        ▶ base SQLCipher du compte : rc_packs.signed_payload (blob signé, revérifié à chaque chargement)

 SCAN (zéro réseau)
 NTAG / QR ──somafrik:card:<publicId>.<secret>──▶ RAM (durée de vie minimale, §3.4)
        K        = SHA-256(utf8(secret))                     — égal à hex_decode(token_hash)
        cardRef  = SHA-256(LP(tag_ref, schoolId, classId, packId, publicId))
        verifier = HMAC(K, LP(tag_verif, schoolId, classId, packId, publicId))   → comparaison locale
        proof    = HMAC(K, LP(tag_proof, contractVersion, schoolId, actorUserId, classId, date,
                              mode, sessionId, packId, scanId, publicId, medium))
        références au secret et à K abandonnées
        BEGIN IMMEDIATE → INSERT rc_scans → UPSERT rc_marks → COMMIT
        ── uniquement après COMMIT : bip + compteur

 CORRECTIONS (zéro réseau) : présent / retard / absent ; statuts existants protégés non modifiables

 CLÔTURE EXPLICITE : lot figé (revision, operationId, payloadDigest) → « À synchroniser »

 SYNCHRONISATION
 Mobile ──POST /roll-call/offline/v1/sync  (Idempotency-Key = operationId)──▶ Backend
        une transaction PostgreSQL, gardes R/W et ordre de verrous fixe (§6.2, §6.3)
        ◀── 201 ACK (ou 200 ACK rejoué) : mêmes champs pour une même opération
        ▶ « Synchronisé » + purge des preuves ; aucun autre chemin vers « Synchronisé »
```

`LP(...)` est l'encodage canonique défini en §3.2.

---

## 3. Architecture cryptographique

### 3.1 Options comparées

| | A. Stocker le `cardToken` chiffré puis le rejouer vers `scanStudentCard` | B. Preuve de possession liée à la session (HMAC, clé dérivée de `token_hash`) | C. B + pack signé de vérification locale |
| --- | --- | --- | --- |
| Secret de carte sur disque | **Oui** (chiffré) : capability permanente pour toute la classe | Non | Non |
| Impact d'une extraction du téléphone | Clonage des cartes de la classe pour tous les usages futurs | Rejeu limité à **cette** session | Idem B ; `verifier` liés au pack, sans valeur hors du pack |
| Retour « carte reconnue » hors ligne | Non | Non (tout « à vérifier ») | Oui, **indicatif** |
| Conformité mandat | Limite | Oui | Oui |

Recommandation maintenue : **option C**, avec les corrections ci-dessous. Décision CTO actuelle : HOLD jusqu'à revue de cette révision.

### 3.2 Encodage canonique `LP` (correction P0-1)

La concaténation par `|` est abandonnée : elle est ambiguë (`"a|b" + "|" + "c"` et `"a" + "|" + "b|c"` donnent la même chaîne `a|b|c`, voir vecteur V-6).

`LP(f1, …, fn)` = concaténation, pour chaque champ, de `uint32_big_endian(len(utf8(fi))) || utf8(fi)`.

- Nombre et ordre des champs **fixes** par étiquette ; le premier champ est toujours l'étiquette de domaine versionnée.
- Normalisation avant encodage : UUID en minuscules, date `YYYY-MM-DD`, `medium ∈ {"nfc","qr"}`, `mode = "teacher"`, `packId = ""` (longueur 0) en mode dégradé sans pack.
- Tout champ hors format → refus, jamais de normalisation silencieuse côté serveur.

Étiquettes de domaine (aucune ne peut produire la sortie d'une autre) :

| Valeur | Étiquette | Clé | Champs après l'étiquette |
| --- | --- | --- | --- |
| `cardRef` | `somafrik.rc-offline.cardref.v1` | — (SHA-256) | schoolId, classId, packId, publicId |
| `verifier` | `somafrik.rc-offline.verifier.v1` | K | schoolId, classId, packId, publicId |
| `proof` | `somafrik.rc-offline.proof.v1` | K | contractVersion, schoolId, actorUserId, classId, date, mode, sessionId, packId, scanId, publicId, **medium** |

`K` = 32 octets bruts de `SHA-256(utf8(secret))`, c'est-à-dire `hex_decode(student_access_cards.token_hash)` côté serveur (même calcul que `generateCardSecrets`). Sorties HMAC/SHA-256 complètes (32 octets), encodées en base64url sans remplissage ; comparaison serveur par `crypto.timingSafeEqual` sur les octets décodés.

### 3.3 Support NFC / QR authentifié (correction P0-1)

- `medium` fait partie de la preuve : un scan enregistré `nfc` ne peut pas être présenté `qr` (ni l'inverse) après coup sans invalider la preuve (vecteurs V-4/V-5). Il fait aussi partie de `payloadDigest`.
- Le serveur sélectionne les flags à partir de ce champ authentifié : `nfc` exige `studentCardNfcEnabled`, `qr` exige `studentCardQrEnabled`, en plus du flag maître et de `studentCardAttendanceEnabled`.
- Contrôle de cohérence avec la carte : `medium = nfc` exige `card.medium ∈ {nfc, nfc_qr}` et `nfc_encoding_state ∈ {encoded, locked}` ; `medium = qr` exige `card.medium ∈ {qr, nfc_qr}`.
- **Limite explicite** : l'authentification protège le champ contre une altération **après** le scan (base locale, transit, rejeu modifié). Elle n'atteste pas le capteur. La même capability `publicId.secret` est écrite dans le QR et dans le NDEF : une application modifiée ou un appareil compromis peut lire un QR et déclarer `nfc`. Aucune attestation matérielle du support n'existe avec NTAG213/216. Conséquence : un établissement « NFC seul » ne peut pas exclure techniquement une lecture QR par un appareil compromis ; le flag reste un contrôle de politique pour les clients honnêtes.

### 3.4 Secret en mémoire (correction P0-4)

Aucune promesse d'effacement physique : en JavaScript, les chaînes sont immuables, copiées et libérées par le ramasse-miettes, et la couche native `react-native-nfc-manager` détient aussi les octets NDEF. Engagements vérifiables à la place :
- le secret et `K` ne sont jamais persistés (SQLite, SecureStore, fichiers, état React persistant), journalisés (`safeLogger` les masque déjà), envoyés au réseau ni conservés dans une fermeture ou un état global ;
- les références sont abandonnées dès le calcul de la preuve ; aucune mise en cache du dernier jeton lu ;
- test statique et test unitaire : aucun champ `secret`, `cardToken`, `token_hash` ni `K` dans `rc_*`, dans les payloads ou dans les journaux.

### 3.5 `token_hash` (décision CTO)

`token_hash` est désormais un **secret d'authentification secondaire** : qui le détient peut fabriquer une preuve. Règles : jamais renvoyé par une API, jamais journalisé, jamais dans une fixture réelle ; test « aucune réponse HTTP ne contient `token_hash` ni une valeur de 64 hex égale à un `token_hash` » sur toutes les routes Carte Élève.

### 3.6 Limites anti-clonage (P1)

Le NDEF NTAG213/216 est lisible par n'importe quel téléphone NFC et ne porte aucune authentification cryptographique de la puce. Une copie reste valable jusqu'à la révocation. L'offline **n'élargit pas** cette fenêtre : la révocation est relue à la synchronisation et un scan d'une carte révoquée entre-temps est refusé (§5.3). Une protection anti-clonage réelle exigerait des puces à authentification (ex. NTAG 424 DNA) : hors périmètre.

---

## 4. Pack signé (correction P0-2)

### 4.1 Contenu authentifié

Réponse de `GET /api/student-cards/roll-call/offline/v1/pack?classId&date` :

```json
{
  "pack": {
    "contractVersion": "rc-offline-1",
    "packVersion": 1,
    "keyId": "rc-pack-<env>-<n>",
    "packId": "uuid",
    "schoolId": "uuid",
    "actorUserId": "uuid (identifiant canonique relu en base)",
    "mode": "teacher",
    "classId": "uuid",
    "date": "YYYY-MM-DD",
    "timeZone": "IANA, fuseau de l'établissement",
    "issuedAt": "ISO-8601 UTC",
    "notBefore": "ISO-8601 UTC (début du jour local D)",
    "expiresAt": "ISO-8601 UTC (début du jour local D+1, exclusif)",
    "syncDeadline": "ISO-8601 UTC (indicatif ; le serveur recalcule au sync)",
    "students": [{ "matchKey": "…", "studentId": "uuid", "studentCode": "…", "firstName": "…", "lastName": "…", "existingStatus": null }],
    "cards": [{ "cardRef": "…", "matchKey": "…", "verifier": "…" }]
  },
  "signature": { "alg": "Ed25519", "keyId": "rc-pack-<env>-<n>", "value": "base64url" }
}
```

- `students` triés par `matchKey`, `cards` par `cardRef`. Tout le contenu de `pack` est signé : établissement, acteur, mode, classe, date, `packId`, versions, horodatages et listes complètes.
- Message signé : `utf8("somafrik.rc-offline.pack.v1\n") || utf8(JCS(pack))`, JCS = RFC 8785.
- **Canonicalisation (révision 3)** : une bibliothèque unique, `canonicalize@2.0.0` (implémentation de référence RFC 8785, pure JS, version exacte figée), utilisée **telle quelle** côté Backend (Node) et côté Mobile (React Native/Hermes). `stableSerialize` n'est **pas** utilisé pour le pack ni pour `payloadDigest` : il diverge de JCS au moins sur `undefined` (vecteur J-10), et l'absence d'autres écarts n'est pas démontrée en général.
- Types admis avant canonicalisation (validateur strict, sinon refus) : chaînes, entiers sûrs (`Number.isSafeInteger`, `-0` interdit), booléens, `null`, tableaux, objets à clés chaînes. Interdits : flottants, `undefined`, `NaN`/`Infinity`, `Date`, `BigInt`, objets à `toJSON`.
- **Pas de normalisation Unicode** : les chaînes sont signées telles qu'émises par le serveur (J-2 montre que NFC et NFD donnent deux empreintes différentes) ; le Mobile ne modifie jamais une chaîne reçue avant vérification.
- Les octets canoniques doivent être identiques entre Node et Hermes : les vecteurs J-1 à J-9 (Unicode, paires de substitution, échappements, tri des clés en unités UTF-16, entiers, objets imbriqués) sont exécutés des deux côtés en PR1a et PR2.
- `matchKey` = HMAC serveur (clé dérivée HKDF du secret roll-call existant, étiquette `student-card-roll-call:offline-match:v1`) sur `LP(packId, studentId)` : pas de corrélation d'un pack à l'autre.

### 4.2 Algorithme, clés et rotation

- Ed25519 (signature déterministe, clé publique de 32 octets). Côté Mobile : vérification par une bibliothèque pure JS auditée (`@noble/curves`), version figée en PR2.
- Clés privées : secrets Render par environnement, jamais dans le dépôt, les logs ni les réponses. Absente ou invalide → la route pack répond 503 et le mode dégradé s'applique.
- Trousseau embarqué dans l'APK **par environnement** : `{ keyId → { publicKey, status } }`, avec **dès la première version deux clés** : `active` (signe) et `standby` (clé de secours, privée conservée hors ligne dans un coffre distinct, jamais déployée tant qu'elle n'est pas activée).
- Liste de révocation : `revokedPackKeyIds`, servie par une route authentifiée en ligne (configuration mobile existante ou route dédiée, à fixer en PR1b), mise en cache dans la base du compte, **monotone** (une révocation n'est jamais annulée par une réponse ultérieure).

Rotation planifiée : (1) publier une APK dont le trousseau contient la nouvelle clé ; (2) attendre l'adoption (version minimale) ; (3) basculer la signature serveur ; (4) l'ancienne clé passe `retired` à la version minimale suivante.

Rotation urgente (clé compromise), **sans supposer de mise à jour instantanée des APK** :
1. le serveur cesse immédiatement de signer avec la clé compromise et signe avec la clé `standby` déjà présente dans toutes les APK supportées ;
2. le `keyId` compromis est ajouté à `revokedPackKeyIds` ;
3. une APK qui a reçu la révocation refuse tout pack signé par ce `keyId`, y compris un pack déjà stocké : suppression puis nouveau téléchargement ;
4. une APK hors ligne qui n'a pas encore reçu la révocation peut accepter un pack frauduleux signé par la clé compromise : conséquence limitée à un affichage « reconnu » erroné, car le pack n'accorde aucun droit (§4.4) et tout est revalidé au sync ;
5. une APK dont toutes les clés connues sont révoquées ou retirées refuse tous les packs : mode dégradé (« à vérifier »), jamais d'acceptation par défaut ; la récupération passe par la mise à jour de l'APK ;
6. une nouvelle clé `standby` est générée et livrée par APK.

### 4.3 Vérification et rejet fail-closed

Le Mobile vérifie au téléchargement **et à chaque chargement depuis SQLCipher** (détection de corruption) :
1. `alg = Ed25519`, `keyId` présent dans le trousseau de l'environnement ;
2. signature valide sur le message exact ;
3. `contractVersion` et `packVersion` supportés ;
4. `schoolId` et `actorUserId` égaux au compte ouvert ; `classId`, `date`, `mode` égaux à la session ;
5. horloge appareil dans `[notBefore ; expiresAt[` et non antérieure à `lastTrustedTime − 10 min` (§4.5).

Un échec à n'importe quelle étape → pack supprimé, message « Liste hors ligne indisponible », **mode dégradé** : scans conservés en `unknown_local` (« à vérifier »), aucune carte présentée comme reconnue. Jamais d'utilisation partielle d'un pack.

### 4.4 Portée

Le pack est **indicatif uniquement**. Il sert au retour visuel, au compteur provisoire et à l'affichage des noms. Il n'accorde aucun droit : le serveur ne lit pas le pack au sync et revalide rôle, affectation, flags, tenant, cartes et inscriptions. La signature protège contre la corruption et l'altération du stockage par un tiers, pas contre une application compromise (même conclusion que §3.3).

### 4.5 Durées et fenêtre d'utilisation (révision 4)

Fuseau : `schools.profile_payload->>'timezone'`, résolu par `resolveSchoolTimeZone` (déjà utilisé par `studentCardEntry.js`). Toutes les bornes sont calculées **par le serveur**, puis transmises dans le pack signé sous forme d'**instants UTC** : le téléphone compare des instants, il ne fait aucun calcul de fuseau et son propre fuseau n'a aucun effet.

**Correction de la révision 3.** La règle `expiresAt = min(issuedAt + 18 h ; fin du jour local)` était incohérente avec le préchargement : un pack du lendemain téléchargé à 17 h expirait à 11 h le jour de l'appel. La durée depuis l'émission est remplacée par une **fenêtre d'utilisation** égale au jour local de l'appel, et l'émission est bornée. Ce changement est explicite et soumis à validation ; il remplace le plafond « 18 h » accepté en R2.

| Borne | Règle | Justification |
| --- | --- | --- |
| Émission autorisée | pack pour la date `D` émis seulement si l'heure locale serveur ∈ `[D−1 12:00 ; D+1 00:00[`, sinon `409 ROLL_CALL_PACK_DATE_OUT_OF_RANGE` | préchargement la veille après-midi ou soir, ou le jour même ; pas de pack plus ancien |
| `notBefore` | `D 00:00` local, en UTC | aucun scan sous ce pack avant le jour de l'appel |
| `expiresAt` (exclusif) | `D+1 00:00` local, en UTC | le pack couvre **toute** la journée scolaire `D`, y compris l'après-midi |
| Fenêtre d'utilisation | `[notBefore ; expiresAt[` = 1 jour local : 24 h, **23 h ou 25 h** les jours de changement d'heure | jamais plus d'un jour d'appel |
| Durée de détention maximale | de `D−1 12:00` à `D+1 00:00` : **36 h** (35 h ou 37 h avec changement d'heure) | plafond borné et vérifiable |
| Rafraîchissement | à l'ouverture d'une session, si le réseau est disponible, un pack neuf est téléchargé et remplace le pack préchargé ; une session déjà ouverte garde son pack | limite l'ancienneté de la liste quand c'est possible, sans en dépendre |
| Hors ligne le jour `D` | le pack préchargé est utilisé ; l'écran affiche « Liste préparée le <date> à <heure> » | le scénario principal (pas de réseau à l'école le matin) reste couvert |
| `syncDeadline` | `D+4 00:00` local (fin du jour `D+3`) | couvre un week-end et une coupure de plusieurs jours |
| Contrôle au sync | fenêtre recalculée par le serveur à partir de `D` et du fuseau **courant** ; la valeur du pack est ignorée | le serveur fait foi |

Alternative écartée : imposer un rafraîchissement le matin du jour `D`. Elle ferait échouer précisément le cas visé (école sans réseau le matin). Elle reste possible par établissement si le CTO la préfère : il suffit de restreindre l'émission à `[D 00:00 ; D+1 00:00[`.

Exemples calculés (instants UTC) :

| Fuseau | `D` | `notBefore` | `expiresAt` | Utilisation | Émission dès | Détention max | `syncDeadline` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Africa/Kinshasa | 2026-11-09 | 2026-11-08T23:00Z | 2026-11-09T23:00Z | 24 h | 2026-11-08T11:00Z | 36 h | 2026-11-12T23:00Z |
| Africa/Lubumbashi | 2026-11-09 | 2026-11-08T22:00Z | 2026-11-09T22:00Z | 24 h | 2026-11-08T10:00Z | 36 h | 2026-11-12T22:00Z |
| Europe/Paris (passage à l'heure d'été) | 2026-03-29 | 2026-03-28T23:00Z | 2026-03-29T22:00Z | 23 h | 2026-03-28T11:00Z | 35 h | 2026-04-01T22:00Z |
| Europe/Paris (passage à l'heure d'hiver) | 2026-10-25 | 2026-10-24T22:00Z | 2026-10-25T23:00Z | 25 h | 2026-10-24T10:00Z | 37 h | 2026-10-28T23:00Z |

Cas concret corrigé : pack du 9 novembre téléchargé le 8 à 17 h (Kinshasa) → utilisable du 9 à 00:00 au 10 à 00:00, donc pour un appel à 15 h le 9.

**Horloge de l'appareil** (jamais une source d'autorité ; ces contrôles ne protègent que l'interface, le serveur revalide tout) :
- le téléphone conserve `lastTrustedTime` = maximum des `issuedAt` des packs vérifiés et des en-têtes `Date` des réponses HTTPS du serveur, dans la base du compte ;
- horloge en retard (`now < lastTrustedTime − 10 min`) ou recul détecté → pack inutilisable, mode dégradé, message « Heure de l'appareil incorrecte » ;
- `now < notBefore` → « Liste pas encore valide » ; `now ≥ expiresAt` → « Liste expirée » ; dans les deux cas, mode dégradé ;
- une horloge en avance ou en retard ne peut ni prolonger un pack (bornes signées) ni étendre la synchronisation (calculée par le serveur) ;
- le fuseau de l'appareil n'intervient dans aucune borne.

Risque assumé (P1-11) : un pack préchargé peut avoir jusqu'à 36 h (37 h au changement d'heure). Une carte révoquée après l'émission peut donc apparaître « reconnue » localement. C'est sans conséquence sur les droits : le pack reste indicatif et la révocation est appliquée au sync (§6.3, étape 9 ; test 11).

---

## 5. Stockage local et cloisonnement (correction P0-4)

### 5.1 Modèle de menace

| Menace | Couvert | Mécanisme |
| --- | --- | --- |
| Lecture du fichier hors application (sauvegarde ADB, copie de stockage) | Oui | SQLCipher, clé dans SecureStore (Android Keystore), `allowBackup` à vérifier en PR2 |
| Bug de filtre exposant les brouillons d'un compte à un autre compte sur le même téléphone | Oui | **une base et une clé par compte** : un autre compte n'ouvre jamais la base |
| Effacement d'un compte sans toucher aux autres | Oui | crypto-effacement : suppression de la clé du compte puis du fichier |
| Application modifiée, appareil rooté, accès au processus | **Non** | SecureStore appartient à l'application, pas à l'utilisateur ; un code exécuté dans l'application lit toutes les clés |
| Second utilisateur autorisé de l'application lisant les données d'un premier | Partiel | isolation applicative (aucune interface ne liste un autre compte), pas cryptographique contre un code modifié |

Un cloisonnement cryptographique contre l'application elle-même exigerait une clé enveloppée par un secret propre à l'utilisateur (code PIN, clé serveur). Aucun n'existe hors ligne aujourd'hui : **hors périmètre V1**, risque résiduel documenté (P1-3).

### 5.2 Partitionnement par compte

- `accountId = base64url(HMAC-SHA256(deviceSalt, LP("somafrik.rc-offline.account.v1", environmentId, userId, schoolId)))[0..22]`, `deviceSalt` = 32 octets aléatoires dans SecureStore. Aucun identifiant utilisateur en clair dans les noms de fichiers.
- Fichier : `somafrik-rollcall-v1-<environmentId>-<accountId>.db`.
- Clé : 256 bits aléatoires, SecureStore `somafrik.rollCallDbKeyV1.<environmentId>.<accountId>`, accès « appareil déverrouillé, cet appareil seulement ».
- Ouverture par les primitives de `offline/l1/database.ts` (SQLCipher obligatoire, `cipher_version` non vide, pas de repli en clair). Une seule base ouverte à la fois : celle du compte authentifié.
- Les colonnes `user_id`/`school_id` restent dans les tables, en défense en profondeur, et sont vérifiées à chaque lecture.

### 5.3 Cycle de vie

| Événement | Comportement |
| --- | --- |
| Connexion | dérivation de `accountId` à partir de l'identité **authentifiée** (`environmentId`, `userId`, `schoolId` renvoyés par le serveur) ; ouverture de la base de ce compte seulement, si elle existe |
| Changement de compte ou d'établissement | fermeture de la base courante, ouverture de celle du nouveau compte ; aucune donnée déplacée ni affichée d'un compte à l'autre ; aucune mention de l'existence d'appels d'un autre compte |
| Déconnexion sans appel en attente | crypto-effacement (clé puis fichier) |
| Déconnexion avec appel en attente | confirmation explicite ; base **fermée**, clé **conservée uniquement pour une reconnexion du même compte** (`blocked_logout`) ; aucun autre compte ne peut calculer son `accountId` ni ouvrir sa base par l'interface |
| Reconnexion du même compte | réouverture, reprise des envois (mêmes octets, §6.8) |
| Compte retiré, désactivé ou ayant perdu l'établissement (constaté par le serveur à la connexion de ce compte : 401/403 de compte) | sessions passées en `unconfirmable` (« État serveur non confirmable actuellement ») ; aucune nouvelle révision ; purge à l'échéance ci-dessous |
| Compte qui ne se reconnecte jamais | le téléphone ne peut pas l'apprendre sans ses identifiants : purge **par échéance**, au démarrage de l'application quel que soit le compte connecté, sans ouvrir la base (métadonnée d'échéance non sensible stockée hors base : `accountId`, date de purge) |
| Échéance de purge d'une base fermée | `max(syncDeadline des sessions) + 7 jours` ; puis crypto-effacement |
| Clé absente (réinstallation, SecureStore effacé) ou base illisible ou corrompue | aucune recréation par-dessus : fichier renommé en `.quarantine`, message « N appel(s) local(aux) illisible(s) : saisissez-les manuellement », journal d'incident sans PII, quarantaine supprimée après 7 jours |
| Échec d'écriture (disque plein, `SQLITE_FULL`, `SQLITE_CORRUPT`) | scan refusé visiblement, compteur inchangé, aucune confirmation |

Limite (rappel §5.1, P1-3) : la clé d'une base conservée reste dans le SecureStore de l'application ; l'isolation entre comptes est applicative et par fichier, pas cryptographique contre une application modifiée.

### 5.4 Tables (migration locale v1)

```sql
rc_meta (key PRIMARY KEY, value)                    -- version de schéma, accountId, environmentId
rc_packs (pack_id PRIMARY KEY, class_id, roll_call_date, expires_at, signed_payload BLOB NOT NULL)
rc_sessions (
  session_id PRIMARY KEY, user_id, school_id, class_id, roll_call_date,
  mode CHECK (mode = 'teacher'), pack_id NULL,
  state CHECK (state IN ('draft','closed','syncing','synced','failed_retryable',
                         'failed_action_required','unconfirmable','expired','blocked_logout')),
  revision INTEGER NOT NULL DEFAULT 1, operation_id NULL, payload_digest NULL,
  frozen_body BLOB NULL,                               -- corps exact envoyé, immuable une fois écrit
  opened_at, closed_at, synced_at, server_roll_call_id, ack_digest, last_error_code,
  attempt_count, next_attempt_at, sync_deadline)
rc_scans (scan_id PRIMARY KEY, session_id, public_id, proof, medium CHECK (medium IN ('nfc','qr')),
          scanned_at, local_status CHECK (local_status IN ('verified_local','unknown_local')),
          match_key NULL, removed_at NULL)
  UNIQUE INDEX (session_id, public_id) WHERE removed_at IS NULL
rc_marks (session_id, match_key, status CHECK (status IN ('present','late','absent')),
          source CHECK (source IN ('card','manual','existing','default')), updated_at,
          PRIMARY KEY (session_id, match_key))
rc_sync_attempts (session_id, operation_id, attempt, started_at, http_status, error_code)  -- aucune PII
```

Règles :
- une transaction par scan (`BEGIN IMMEDIATE … COMMIT`) ; retour visuel/sonore seulement après `COMMIT` ;
- plusieurs cartes d'un même élève → plusieurs `rc_scans`, une seule `rc_marks` ;
- un seul appel `draft` par `(class_id, roll_call_date)` dans la base du compte (index unique partiel) ;
- un trigger `BEFORE UPDATE` refuse toute modification de `frozen_body`, `operation_id` et `payload_digest` tant que `state ∈ ('closed','syncing','failed_retryable','unconfirmable')` ; le passage à `draft` (nouvelle révision) n'est accepté que si `last_session_state = 'not_recorded'` (colonne ajoutée, recopiée de la dernière réponse serveur).

### 5.5 Données personnelles et purge

Le pack contient des **données nominatives** (nom, prénom, code élève, identifiant, statut du jour) de la classe de l'enseignant affecté, et seulement de celle-ci. Pas de photo, pas de donnée de paiement.

| Donnée | Purge |
| --- | --- |
| Pack | à `expiresAt`, ou dès la synchronisation de la session qui l'utilise |
| Preuves (`rc_scans.proof`) | dans la transaction locale qui passe la session à `synced` |
| `frozen_body` | idem |
| Session `synced` | résumé de compteurs conservé 7 jours, puis suppression |
| Session non synchronisée après `syncDeadline` | état `expired` : preuves, corps figé et noms supprimés ; compteurs conservés jusqu'à acquittement par l'utilisateur, au plus 7 jours. **Exception** : une session `unconfirmable` garde son `frozen_body` jusqu'à la purge de la base (§5.3), pour qu'un renvoi identique puisse encore retrouver l'ACK |
| Brouillon | jamais purgé silencieusement avant l'échéance |

---

## 6. Contrat de synchronisation et idempotence (correction P0-3)

### 6.1 `POST /api/student-cards/roll-call/offline/v1/sync`

En-tête `Idempotency-Key: <operationId>` obligatoire, égal au champ du corps.

```json
{
  "contractVersion": "rc-offline-1",
  "operationId": "uuid", "sessionId": "uuid", "revision": 1, "schoolId": "uuid",
  "classId": "uuid", "date": "YYYY-MM-DD", "mode": "teacher", "packId": "uuid|null",
  "complete": true,
  "scans":  [{ "scanId": "uuid", "publicId": "…", "proof": "…", "medium": "nfc|qr", "scannedAt": "…" }],
  "manual": [{ "studentId": "uuid", "status": "present|late|absent" }],
  "payloadDigest": "hex(SHA-256(JCS(corps sans payloadDigest)))  — JCS = canonicalize@2.0.0"
}
```

`scans` triés par `scanId`, `manual` par `studentId` (ordre canonique, digest stable). `schoolId` n'est **jamais** utilisé pour déterminer l'établissement : il est seulement comparé à l'établissement résolu en base (garde R, §6.2) ; il est déjà authentifié dans chaque preuve. Limites : 300 scans, 300 marques, corps ≤ 256 Ko, limiteur de débit par utilisateur. `scannedAt` est informatif.

### 6.2 Deux autorisations distinctes

| | Garde **R** — lire le résultat de son propre appel | Garde **W** — effectuer un nouvel enregistrement |
| --- | --- | --- |
| Quand | **avant toute lecture** d'`idempotency_keys` ou du journal | après la lecture du journal, si aucun appel n'est enregistré pour la session |
| Identité | JWT valide ; `userId` canonique (`resolveCanonicalUserIdForSchool`) | idem |
| Établissement | `schoolId` résolu **en base** (`users.school_id` via `attachEnrollmentMembershipScope`, relu sans réutiliser une valeur déjà attachée au principal) ; jamais dérivé d'un champ du client ; rôles plateforme refusés. Le `schoolId` du lot (authentifié par les preuves et le digest) doit être **égal** à l'établissement résolu, sinon refus R | idem |
| Appartenance | rôles actifs relus en base pour cet établissement (`listActiveUserRoleKeysForSchool`, `status = 'active'`, `revoked_at IS NULL`) : **au moins `TEACHER`** | `TEACHER` |
| Permission | permission effective live de la route (`requirePermission`, `resolveEffectivePermissions`) | idem |
| Affectation à la classe | **non requise** (un enseignant désaffecté peut confirmer ce qu'il a déjà enregistré) | **requise** (affectation active) |
| Flags établissement | **non requis** (la confirmation d'un enregistrement passé ne crée rien) | maître, présences, NFC/QR selon `medium` |
| Gate abonnement `write_presence` | non requis | requis |
| Fenêtre de date | non requise | requise |
| Échec | `403 ROLL_CALL_REPLAY_FORBIDDEN`, corps sans détail, **identique que la session existe ou non** | code W + `"sessionState": "not_recorded"` (§6.5) |

Le refus de R ne dit rien de l'existence d'un appel : R ne dépend que du principal, jamais de la session.

### 6.3 Ordre d'exécution et des verrous

Le gestionnaire s'exécute dans `withIdempotency` → `withIdempotencyTransaction` (une seule transaction PostgreSQL, READ COMMITTED). PR1c ajoute à `withIdempotency` une option **additive** `guard`, exécutée dans la transaction **avant** `findReplay` ; sans cette option, le comportement des routes existantes est inchangé (tests de non-régression de `idempotencyService`).

| # | Étape | Où | Échec |
| --- | --- | --- | --- |
| 0 | `requireAuth`, `requirePermission` (permission live), format, `contractVersion`, `Idempotency-Key = operationId`, recalcul de `payloadDigest` | hors transaction | 401 / 403 générique / 400 `INPUT_INVALID` / `DIGEST_MISMATCH` |
| 1 | `pg_advisory_xact_lock(cacheId)` (clé, route, principal, établissement) | transaction | — |
| 2 | **Garde R** (`guard`) | transaction | 403 `REPLAY_FORBIDDEN`, ROLLBACK, aucune lecture effectuée |
| 3 | Rejeu `idempotency_keys` (< 24 h) : même hash → ACK stocké ; hash différent → 409 `IDEMPOTENCY_KEY_REUSED` | transaction | — |
| 4 | `pg_advisory_xact_lock(hashtext('rc-offline-session'), hashtext(schoolId ‖ ':' ‖ sessionId))` | transaction | — |
| 5 | Lecture du journal `(school_id, session_id)` après le verrou 4 (nouvel instantané) — §6.4 | transaction | — |
| 6 | **Garde W** | transaction | code W + `not_recorded` |
| 7 | Fenêtre de date recalculée (fuseau courant) | transaction | 409 `OFFLINE_EXPIRED` + `not_recorded` |
| 8 | `lockRollCallDay(schoolId, date)` (partagé avec `/validate`) | transaction | — |
| 9 | Cartes `FOR SHARE` triées par `id` ; preuves ; statut ; support ; propriétaire | transaction | 409 `CARD_INVALID` / 400 `PROOF_INVALID` + `not_recorded` |
| 10 | `lockEnrolledRoster` `FOR SHARE` ; liste complète | transaction | 409 `ROSTER_CHANGED` + `not_recorded` |
| 11 | Présences `FOR UPDATE` triées par élève ; `attendanceTransition` ; `upsertSchoolAttendanceBatch` avec gardes | transaction | 409 `CONCURRENT_UPDATE` + `not_recorded` |
| 12 | Insertion journal (`source = 'offline'`, `operation_id`, `payload_digest`, `ack_body`) ; aucune ligne insérée = erreur interne | transaction | 500, ROLLBACK |
| 13 | Audit ; `service.store` de `withIdempotency` | transaction | ROLLBACK |
| 14 | COMMIT ; réponse | — | — |

Ordre global des verrous : idempotence (1) → session (4) → jour (8) → cartes (9) → inscriptions (10) → présences (11). La route `/validate` en ligne prend 1 → 8 → 9 → 10 → 11 : ordre compatible. Toute erreur levée aux étapes 2 à 13 annule la transaction.

`not_recorded` n'est émis qu'aux étapes 6 à 11, c'est-à-dire **après** avoir constaté sous le verrou de session qu'aucun appel n'est enregistré pour ce `sessionId` : c'est une attestation serveur, pas une déduction du code HTTP.

### 6.4 Décision à l'étape 5 (journal)

| Journal trouvé | Condition | Réponse |
| --- | --- | --- |
| Non | — | étapes 6 à 14, 201 |
| Oui | même `operation_id`, même `payload_digest`, même auteur canonique | **200 + `ack_body`**, sans écriture (garde R déjà passée) |
| Oui | auteur différent | 409 `ROLL_CALL_SESSION_CONFLICT`, sans ACK ni détail |
| Oui | `operation_id` ou `payload_digest` différent | 409 `ROLL_CALL_SESSION_CONFLICT` |
| Oui | `source = 'online'` | 409 `ROLL_CALL_SESSION_CONFLICT` |

Le rejeu `idempotency_keys` (étape 3) passe par la même garde R. Il est en outre limité par construction au même principal et au même établissement (`cacheId`).

### 6.5 Réponses d'échec exactes

| Statut | Code | `sessionState` | Signification pour le Mobile |
| --- | --- | --- | --- |
| 400 | `ROLL_CALL_INPUT_INVALID`, `ROLL_CALL_DIGEST_MISMATCH` | absent | anomalie locale (corps invalide) |
| 401 | — | absent | incertain : se reconnecter puis renvoyer à l'identique |
| 403 | générique `requirePermission` | absent | incertain |
| 403 | `ROLL_CALL_REPLAY_FORBIDDEN` | absent | **incertain** : « État serveur non confirmable actuellement » |
| 403 | `ROLL_CALL_ROLE_FORBIDDEN`, `ROLL_CALL_CLASS_FORBIDDEN`, abonnement | `not_recorded` | définitif : rien n'est enregistré |
| 404 | `STUDENT_CARD_DISABLED`, `STUDENT_CARD_ATTENDANCE_DISABLED`, flag NFC/QR | `not_recorded` | définitif |
| 404 | autre (route inconnue, proxy) | absent | incertain |
| 409 | `OFFLINE_EXPIRED`, `CARD_INVALID`, `ROSTER_CHANGED`, `CONCURRENT_UPDATE` | `not_recorded` | définitif |
| 400 | `ROLL_CALL_PROOF_INVALID` | `not_recorded` | définitif |
| 409 | `ROLL_CALL_SESSION_CONFLICT` | `conflict` | anomalie : session déjà enregistrée autrement |
| 409 | `IDEMPOTENCY_KEY_REUSED` | absent | anomalie |
| 408, 429, 5xx, réseau, timeout, réponse illisible | — | absent | incertain |

Corps d'erreur : `{ "code", "message", "sessionState"?, "details"? }`. `details` ne contient que des `scanId` ou des index du lot, jamais d'identifiant d'élève ni d'information sur un autre utilisateur.

### 6.6 ACK

```json
{ "rollCallId": "uuid", "sessionId": "uuid", "operationId": "uuid", "revision": 1,
  "payloadDigest": "hex", "validatedAt": "ISO", "created": 0, "corrected": 0, "unchanged": 0,
  "protected": 0, "protectedScanIds": ["uuid"], "protectedManualIndexes": [0],
  "invalidScanIds": [], "counts": { "present": 0, "late": 0, "absent": 0, "excused": 0, "enrolled": 0 } }
```

- Aucun identifiant d'élève dans l'ACK : seulement des `scanId` et des index du lot.
- `ack_body` est figé au COMMIT et renvoyé à l'identique par toute relecture (étapes 3 ou 5) ; une relecture ajoute seulement `idempotentReplay: true` (comportement existant). Le Mobile compare les champs de l'ACK, pas les octets de la réponse.
- Le Mobile ne passe `synced` que si `operationId`, `revision` et `payloadDigest` de l'ACK égalent ceux du lot figé ; sinon anomalie `ACK_MISMATCH`, jamais `synced`.

### 6.7 Migration additive (PR1c)

```sql
ALTER TABLE attendance_roll_calls
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS operation_id UUID,
  ADD COLUMN IF NOT EXISTS payload_digest TEXT,
  ADD COLUMN IF NOT EXISTS ack_body JSONB;
-- contrainte : source IN ('online','offline') ; offline ⇒ operation_id, payload_digest, ack_body NOT NULL
```

Pas de suppression, pas de réécriture des lignes existantes, pas de nouvelle durée de rétention sur `idempotency_keys`.

### 6.8 Règles Mobile : révision ou renvoi à l'identique

| Réponse | Action |
| --- | --- |
| 2xx + ACK conforme | `synced` |
| Erreur portant `sessionState: "not_recorded"` | `failed_action_required` ; correction possible → `revision + 1`, **nouvel** `operationId`, même `sessionId` |
| 403 `REPLAY_FORBIDDEN`, 401, 403/404 sans `sessionState` | `unconfirmable` : « État serveur non confirmable actuellement » (jamais « non enregistré ») ; **aucune révision** ; renvoi du `frozen_body` à l'identique après reconnexion ou rétablissement des droits |
| Réseau, timeout, 408, 429, 5xx, réponse illisible | `failed_retryable` ; renvoi à l'identique avec backoff |
| `SESSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `ACK_MISMATCH`, 400 sans `sessionState` | `failed_action_required` **sans révision possible** ; incident journalisé ; orientation vers la direction (supervision `/overview`) |

**Règle unique** : une nouvelle révision n'est autorisée que si la dernière réponse reçue pour l'`operationId` courant porte `sessionState: "not_recorded"`. Un refus d'accès ne l'autorise jamais : il ne peut donc pas produire une seconde écriture après un enregistrement réussi.

Deux appareils du même enseignant sur la même classe et le même jour produisent deux `sessionId` différents ; chacun passe par `attendanceTransition`, le second voit les statuts du premier comme existants (protégés ou inchangés), jamais écrasés.

### 6.9 Protocole de test du rejet et du rejeu de l'ACK (PR1c, PostgreSQL réel)

Préparation commune : enseignant T affecté à la classe C de l'établissement E ; flags actifs ; envoi du lot L (`operationId` O) → 201, ACK A. Pour chaque cas, deux variantes : **< 24 h** (ligne `idempotency_keys` présente) et **> 24 h** (ligne supprimée ou `expires_at` dépassé).

| # | Changement après le 201, puis renvoi de L à l'identique | Attendu (les deux variantes) |
| --- | --- | --- |
| R-1 | aucun | 200, ACK = A |
| R-2 | désaffectation de T de C | 200, ACK = A (garde R n'exige pas l'affectation) |
| R-3 | flag présences ou NFC coupé | 200, ACK = A |
| R-4 | rôle `TEACHER` révoqué dans E (T garde un compte) | 403 `REPLAY_FORBIDDEN`, aucun ACK, aucune écriture |
| R-5 | T retiré de E (tous rôles révoqués, `users.school_id` changé vers E2) | 403 `REPLAY_FORBIDDEN` (lot `schoolId = E` ≠ E2), aucun ACK, aucune écriture, jamais `not_recorded` |
| R-6 | R-4 puis rôle rétabli | 200, ACK = A |
| R-7 | même O et même corps envoyés par l'enseignant T2 de E | 409 `SESSION_CONFLICT` sans ACK (> 24 h) ; < 24 h : `cacheId` différent, même résultat |
| R-8 | même O et même corps envoyés par un principal d'un autre établissement | 403 tenant ou `REPLAY_FORBIDDEN`, aucune lecture du journal de E |
| R-9 | réponse de R-4 comparée à celle d'un principal identique sans aucun appel enregistré | réponses identiques (statut, code, corps) |
| R-10 | 5 renvois concurrents identiques pendant le premier envoi | une écriture ; 1×201 + 4×200, mêmes champs ACK ; aucun 409 |

Contrôles de chaque cas : nombre de lignes `attendance` et `attendance_roll_calls` inchangé après le 201 initial ; audit sans nouvelle entrée d'écriture ; corps de refus sans `rollCallId`, compteurs, `scanId` ni nom.

Côté Mobile (PR4, unitaire) : R-4 → `unconfirmable`, révision refusée ; R-6 → `synced` ; erreur W avec `not_recorded` → révision autorisée ; 403 sans `sessionState` → `unconfirmable`.

---

## 7. Machine d'état Mobile

```
draft ──clôture explicite──▶ closed (frozen_body, operationId, digest) ──▶ syncing
syncing ──2xx + ACK conforme──────────────▶ synced          (seul chemin vers « Synchronisé »)
syncing ──réseau / timeout / 5xx / 429────▶ failed_retryable ──backoff──▶ syncing (mêmes octets)
syncing ──401 / 403 / 404 sans sessionState▶ unconfirmable ──reconnexion / droits──▶ syncing (mêmes octets)
syncing ──erreur avec not_recorded────────▶ failed_action_required ──correction──▶ draft (revision + 1)
syncing ──conflit / anomalie──────────────▶ failed_action_required (sans révision)
{draft, closed, failed_*, unconfirmable} ──syncDeadline dépassée──▶ expired
{closed, failed_*, unconfirmable} ──déconnexion confirmée──▶ blocked_logout ──même compte──▶ état précédent
```

Libellés : « Brouillon local », « À synchroniser », « Synchronisé », « État serveur non confirmable actuellement », « Échec à résoudre ». Aucune clôture automatique, même à 0 restant. Une session `expired` qui était `unconfirmable` garde son `frozen_body` jusqu'à la purge de la base (§5.3) : un renvoi reste possible, le journal étant lu avant la fenêtre de date. Le runner de synchronisation réutilise `networkResilience`, `connectivity` et le cycle de vie d'`OutboxRuntime` ; seul le stockage diffère.

---

## 8. Décisions produit V1 (arrêtées par le CTO)

- **Présence journalière** : une présence par élève et par jour (`uq_attendance_school_student_date`), comme aujourd'hui. Pas d'appel par séance en V1.
- **« Justifié » (`excused`)** : reste exclusivement dans le flux de justification existant ; non saisissable dans l'appel ; jamais écrasé.
- Durées : synchronisation jusqu'à la fin de J+3 **acceptée** par le CTO comme plafond V1. Pack : fenêtre d'utilisation = jour local de l'appel, émission dès la veille 12:00, détention ≤ 36 h (35–37 h au changement d'heure) — **révision 4, à valider** (remplace le plafond 18 h, incohérent avec le préchargement). Sous réserve des tests S12/S16 et du refus serveur des états obsolètes.

---

## 9. Vecteurs de test partagés

Valeurs **fictives**, à faible entropie, réservées aux tests. Le fichier `NFC-PRES-LOCAL-PR0-vectors.json` (même dossier) contient les mêmes données ; PR1a et PR2 devront les utiliser tels quels côté Backend et côté Mobile.

Entrées : `publicId = "AAAAAAAAAAAAAAAAAAAAAA"`, `secret = "TEST-VECTOR-ONLY-00000000000000000000000000"`, `schoolId = …0001`, `actorUserId = …0002`, `classId = …0003`, `date = 2026-11-09`, `sessionId = …0004`, `packId = …0005`, `scanId = …0006` (UUID `00000000-0000-4000-8000-00000000000N`), `contractVersion = rc-offline-1`, `mode = teacher`.

| # | Valeur | Résultat attendu |
| --- | --- | --- |
| V-1 | hex(K) (= `token_hash` de test) | `7a66b11beabb2d88d8d2ac5a289fa136e3b436990a58f397561caa7caa352e0f` |
| V-2 | `cardRef` | `x8f3EcDGI48SI2LPP6CxbY0iQmt-OW6zDwa2UxYmXcQ` |
| V-3 | `verifier` | `msXEii9Kl0mBSoUYfDw5a3SZjrQLt-jvqrDoycDAaZg` |
| V-4 | `proof`, `medium = nfc` | `6DuAdjcRC-Zd1VArIq0hYkQtyjp2vZjeba4BYZkr1gg` |
| V-5 | `proof`, `medium = qr` (altération de support) | `PrtFtQE7qYUFSX22gK0vWIJr8_66U60htRB4vUrEmMY` ≠ V-4 |
| V-6 | ambiguïté du séparateur : `("a\|b","c")` vs `("a","b\|c")` | même chaîne naïve `a\|b\|c` ; `LP` = `00000003617c620000000163` vs `000000016100000003627c63` |
| V-7 | `LP("ab","","c")` | `000000026162000000000000000163` |
| V-8 | `proof`, `medium = nfc`, `packId = ""` (dégradé) | `cGqNVh0qcoMt68upA4i5N6GI-jsBK2HzzGtbmbRugRw` |
| V-9 | pack de test, clé Ed25519 de test (graine = 32 octets `0x01`), clé publique brute | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w` |
| V-10 | signature du pack de test (avec `notBefore`, révision 4) | `C-NE1ehClk-J-MYFfjqhHT0UWsFdbk-55knRbr36muPRS9PE029v3NeBoVM7NdpYxtAV3N4KQsETVzdP0rESCw` ; vérifie = `true` ; même signature sur pack dont `classId` est modifié = `false` |
| V-11 | `payloadDigest` du lot de test (avec `schoolId`, révision 3) | `50603c4e23b60e2665d647198900031184da5a00863196bf8e54d00ab706fbfb` |
| V-12 | `payloadDigest` du même lot, `medium` passé à `qr` | `e08c8218407451aa3a63d7584c908a91ce83567c26dc72e7ab70160b37f65d4c` ≠ V-11 |

Ces valeurs ont été calculées avec `node:crypto` (Node 22) dans l'environnement de rédaction. Le pack de test et le lot de test complets figurent dans le JSON. V-10 et V-11 ont été recalculés depuis ce JSON avec `canonicalize@2.0.0` (résultat identique). Elles ne prouvent rien sur le code Backend ou Mobile, qui n'existe pas encore : elles en seront l'oracle.

**Vecteurs JCS (révision 3)** — sortie de `canonicalize@2.0.0` et SHA-256 des octets UTF-8 ; entrées et sorties complètes dans le JSON (`jcs`).

| # | Cas | SHA-256 attendu | `stableSerialize` identique ? |
| --- | --- | --- | --- |
| J-1 | accents NFC | `758405076dbbec331910fdf8d34fed16bcb020bebf785b5bca075655ae2272cf` | oui |
| J-2 | mêmes accents en NFD (non normalisés) | `84df14cd3a944e7822523710b257899b29eb640db96b4fff049dd69d92d33ff6` (≠ J-1) | oui |
| J-3 | emoji (paire de substitution) | `d3e54b11635291b9829749f9fbbbf3f2c4a9590e8806464567f15416f188fc3b` | oui |
| J-4 | guillemet, barre oblique inverse, `\n`, `\t`, U+0001, U+001F, U+007F, U+2028, U+2029 | `fc2a3738f089a0c729fad95247e443bfa2b0f741b8e430bcf5d6291a9b073f9c` | oui |
| J-5 | tri des clés en unités UTF-16 (`B`, `a`, `z`, `é`, emoji, `ﬁ`) | `4114f48a1dffa20708aec2e1ee94ecc91478504ffa67994dee091fdd9ff919a6` | oui |
| J-6 | entiers 0, −1, 2^53−1, 300 | `7d8de0381baef2d7802d0ca8a258972c1580e41501307a0f15b66b08a9815dd2` | oui |
| J-7 | objets et tableaux imbriqués, vides | `34ea9e93e556ed19cf1bc3f03f68c81156f9b63236010f0544d9f70e4559c79f` | oui |
| J-8 | `-0` (interdit par le validateur) | — | — |
| J-9 | flottants (interdits par le validateur) | — | — |
| J-10 | `undefined` dans un objet (interdit) | — | **non** (`{"b":1}` contre `{"a":null,"b":1}`) |

J-8 à J-10 ne sont pas des vecteurs de conformité : ils documentent pourquoi ces types sont refusés avant canonicalisation.

---

## 10. Matrice de tests

Aucun de ces tests n'est exécuté dans PR0. Les tests « PG réel » s'exécutent sur une base PostgreSQL isolée (CI `Backend PostgreSQL`).

| # | Scénario | PR | Niveau | Attendu |
| --- | --- | --- | --- | --- |
| 1 | 35 scans rapides | PR3 | unitaire + bench + Android | 35 marques, 0 appel HTTP, p95 écriture < 50 ms |
| 2 | Double lecture | PR2/PR3 | unitaire | 1 ligne, retour « déjà scannée » |
| 3 | Plusieurs cartes, même élève | PR1c/PR2 | PG réel + unitaire | 1 présence |
| 4 | Mode avion avant / pendant | PR3/PR5 | Android | avant : pack préchargé ou mode dégradé ; pendant : aucun impact |
| 5 | Arrêt forcé après N scans | PR2/PR5 | Android natif | N scans retrouvés |
| 6 | Redémarrage et reprise | PR2 | Android natif | brouillon intact |
| 7 | Coupure à la validation | PR4 | intégration | `failed_retryable`, jamais `synced` |
| 8 | **Timeout après COMMIT** (hook `setIdempotencyBeforeStoreHook` / coupure de connexion client après COMMIT) | PR1c/PR4 | PG réel | renvoi identique → mêmes champs ACK, 0 doublon |
| 9 | **N envois identiques concurrents** (N = 5) | PR1c | PG réel concurrent | 1 journal, 1 écriture, N réponses ACK identiques, **aucun 409** |
| 9b | Deux révisions concurrentes de la même session | PR1c | PG réel concurrent | une 201, l'autre 409 `SESSION_CONFLICT` |
| 9c | **Rejeu > 24 h** (ligne `idempotency_keys` expirée ou supprimée) | PR1c | PG réel | 200 + `ack_body` identique au 201 initial |
| 10 | Changement de classe / d'établissement | PR1b/PR1c/PR2 | PG réel + unitaire | `CLASS_FORBIDDEN` ; autre compte n'ouvre pas la base |
| 11 | Révocation / remplacement avant synchro | PR1c | PG réel | `CARD_INVALID` + `invalidScanIds` |
| 12 | Rôle, affectation ou flag révoqué **avant** sync | PR1c | PG réel | 403/404, rien n'est écrit |
| 12b | Droits modifiés **après** COMMIT puis renvoi (< 24 h et > 24 h) | PR1c | PG réel | protocole R-1 à R-10 (§6.9) |
| 12c | Refus d'accès après succès historique | PR4 | unitaire | `unconfirmable`, révision refusée ; renvoi identique après rétablissement → `synced` |
| 13 | Conflit avec un autre appareil (deux sessions, même classe, même jour) | PR1c | PG réel concurrent | statuts protégés conservés et signalés, aucun écrasement |
| 14 | Échec SQLite, disque plein, corruption, clé absente | PR2 | unitaire + natif | fail-closed visible, quarantaine, compteur non incrémenté |
| 15 | Non-régression manuel, QR, routes en ligne `/scan` `/validate` | PR1–PR5 | suites existantes | inchangées |
| S1 | Preuve forgée, preuve d'une autre session, d'un autre tenant, d'un autre acteur | PR1a/PR1c | unitaire + PG réel | `PROOF_INVALID`, aucun indice d'existence de la carte |
| S2 | **Altération du support** (`nfc` → `qr` et inverse, après scan) | PR1a/PR1c | vecteurs V-4/V-5/V-12 + PG réel | `PROOF_INVALID` ou `DIGEST_MISMATCH` |
| S3 | Support incohérent avec la carte (`nfc` sur carte `qr`, `nfc` sur encodage `pending`) | PR1c | PG réel | `CARD_INVALID` |
| S4 | Flags NFC/QR coupés entre scan et sync | PR1c | PG réel | 404 fail-closed |
| S5 | **Pack falsifié** (signature, champ modifié, `keyId` inconnu, pack d'un autre environnement) | PR1b/PR2 | vecteur V-10 + unitaire | pack rejeté, mode dégradé |
| S6 | **Pack cross-tenant / autre acteur / autre classe / autre date / expiré** | PR1b/PR2 | PG réel + unitaire | refus serveur à l'émission ; rejet local à la vérification |
| S7 | **ACK contradictoire** (digest, operationId ou revision différent) | PR4 | unitaire | `failed_action_required`, jamais `synced` |
| S8 | **Digest contradictoire** (corps modifié avec même `operationId`) | PR1c | PG réel | 400 `DIGEST_MISMATCH` ou 409 `IDEMPOTENCY_KEY_REUSED` |
| S9 | **`token_hash` jamais exposé** | PR1a–PR1c | test HTTP sur toutes les routes Carte Élève + test statique | 0 occurrence |
| S10 | Aucun secret, `K`, preuve ou jeton dans logs, fixtures, PR | PR1–PR4 | test statique + `safeLogger` | 0 occurrence |
| S11 | Deux comptes sur un même téléphone | PR2 | unitaire + natif | fichiers et clés distincts ; aucun brouillon visible de l'autre compte |
| S12 | Bornes serveur du pack : émission à `D−1 11:59:59` refusée et `D−1 12:00` acceptée ; émission à `D+1 00:00` refusée ; `notBefore`/`expiresAt` exacts pour Africa/Kinshasa, Africa/Lubumbashi, Europe/Paris aux deux changements d'heure 2026 (table §4.5) ; `syncDeadline` exact ; fuseau modifié entre pack et sync (le serveur applique le fuseau courant) ; date invalide | PR1b/PR1c | unitaire + PG réel | conformes à §4.5 ; état obsolète refusé par le serveur |
| S16 | Fenêtre locale du pack : pack D téléchargé la veille à 17 h utilisable à `D 15:00` ; refusé à `notBefore − 1 s` et à `expiresAt` ; horloge de l'appareil en avance (après `expiresAt`), en retard (avant `notBefore`), reculée sous `lastTrustedTime − 10 min` ; fuseau de l'appareil ≠ fuseau de l'établissement sans effet ; rafraîchissement à l'ouverture si en ligne, pack conservé pour une session ouverte | PR2/PR3 | unitaire (horloge injectée) + Android | mode dégradé avec le message prévu dans chaque cas de refus ; jamais de prolongation |
| S13 | Canonicalisation J-1 à J-7 identique Node / Hermes ; J-8 à J-10 refusés par le validateur | PR1a/PR2 | unitaire des deux côtés | octets identiques |
| S14 | `keyId` révoqué (pack neuf et pack déjà stocké) ; trousseau entièrement révoqué ; liste de révocation non monotone | PR1b/PR2 | unitaire | pack refusé, mode dégradé ; révocation jamais annulée |
| S15 | Purge par échéance d'une base `blocked_logout` d'un compte qui ne se reconnecte pas, sans l'ouvrir | PR2 | unitaire + natif | crypto-effacement à l'échéance ; aucun autre compte n'y accède |

Physique (#921, PR5) : NTAG213 et NTAG216, 30+ scans, `active/encoded`, présence vérifiée dans PostgreSQL — **NOT RUN** depuis l'environnement Claude ; procédure opérateur fournie en PR5.

---

## 11. Risques

**P0**
- **P0-1** Sans pack, pas de retour « reconnu » hors ligne : préchargement dès la veille 12:00 et rafraîchissement à l'ouverture si le réseau est présent ; sinon mode dégradé explicite.
- **P0-2** Faux « Synchronisé » : seul un ACK conforme y mène (§6.6) ; tests S7 et 7 bloquants en PR4.
- **P0-3** Perte de lots au logout ou à la purge L1 : base séparée par compte + `blocked_logout` (§5.3).
- **P0-4** Secrets sur disque : interdits par construction (§3.4) ; test S10.
- **P0-5** Dépendance #921 : aucune recette physique de présence tant que l'encodage n'est pas prouvé.

**P1**
- **P1-1** `token_hash` secret d'authentification secondaire (§3.5).
- **P1-2** Rejeu intra-session par le titulaire du téléphone : limité à sa propre session, qu'il peut déjà remplir manuellement.
- **P1-3** Pas de cloisonnement cryptographique contre l'application elle-même ni un appareil rooté (§5.1).
- **P1-4** Support NFC/QR non attesté matériellement (§3.3).
- **P1-5** Anti-clonage NDEF absent, inchangé par l'offline (§3.6).
- **P1-6** Révocation après le scan refusée : un élève présent peut être refusé ; l'enseignant le repointe manuellement (révision + 1).
- **P1-7** Données nominatives stockées localement (pack) : minimisées et purgées (§5.5).
- **P1-8** Dépendances cryptographiques Mobile (`@noble/hashes`, `@noble/curves`) et `canonicalize@2.0.0` à valider (versions exactes, audit, licence) ; les vecteurs §9 sont l'oracle commun.
- **P1-9** Fenêtre d'acceptation d'un pack signé par une clé compromise sur une APK hors ligne qui n'a pas encore reçu la révocation (§4.2) : effet limité à l'affichage, aucun droit.
- **P1-10** Un enseignant désaffecté peut encore relire l'ACK de **son** appel passé (garde R) : validé par le CTO en R3, sans écriture ni donnée d'un autre utilisateur.
- **P1-11** Ancienneté d'un pack préchargé jusqu'à 36 h (37 h au changement d'heure) : une carte révoquée après l'émission peut apparaître « reconnue » localement ; aucun effet sur les droits, révocation appliquée au sync (§4.5).

---

## 12. Découpage des PR

Chaque PR : branche issue du `develop` courant, Draft/HOLD, base/HEAD/merge-base/ahead-behind, diff complet pour revue CTO indépendante. **Aucune PR produit avant nouvelle revue CTO de ce contrat.**

| PR | Branche | Contenu | Dépend de |
| --- | --- | --- | --- |
| **PR1a** | `feat/nfc-pres-local-pr1a-proof` | Module pur Backend : `LP`, `cardRef`, `verifier`, `proof`, validateur de types + `canonicalize@2.0.0`, digest ; tests sur vecteurs V et J ; aucune route | PR0 accepté |
| **PR1b** | `feat/nfc-pres-local-pr1b-pack` | `GET …/offline/v1/pack`, signature Ed25519, clés `active`/`standby`, liste de révocation, échéances par fuseau, RBAC/flags/tenant ; tests PG S5, S6, S12, S14 | PR1a |
| **PR1c** | `feat/nfc-pres-local-pr1c-sync` | Migration additive ; option additive `guard` de `withIdempotency` ; `POST …/offline/v1/sync` selon §6.2–§6.5 ; extraction sans changement de comportement du moteur `writeTeacherRollCall` ; tests PG 3, 8–13, protocole R-1 à R-10, S1–S4, S8, S9 | PR1a |
| **PR2** | `feat/nfc-pres-local-pr2-store` | Base SQLCipher par compte, migrations, triggers d'immutabilité, purge, quarantaine ; vérification de pack ; tests 2, 5, 6, 14, S5, S11 | PR1a (vecteurs) |
| **PR3** | `feat/nfc-pres-local-pr3-scan` | Boucle NFC/QR locale, HMAC Mobile, compteurs, corrections, UX, flag d'établissement `studentCardOfflineRollCallEnabled` (défaut off) | PR2, PR1b |
| **PR4** | `feat/nfc-pres-local-pr4-sync` | Runner de synchronisation, machine d'état, règles §6.8, état `unconfirmable`, ACK, `blocked_logout` ; tests 7, S7 | PR1c, PR3 |
| **PR5** | `test/nfc-pres-local-pr5-recette` | Intégration, APK préprod, Maestro, procédure opérateur NTAG213/216, preuves | PR4, #921 |

Le flag d'établissement (PR3) est le seul nouveau flag : le parcours en ligne actuel reste le comportement par défaut.

---

## 13. Décisions demandées au CTO (révision 4)

Acquis en principe (revues R2 et R3) : preuves HMAC liées à la session et au support, LP + `canonicalize@2.0.0`, pack Ed25519, SQLCipher par compte, synchronisation transactionnelle, gardes R/W, révision seulement après `not_recorded`, ACK relisible après désaffectation ou flag coupé tant que le rôle `TEACHER` et la permission sont conservés, V1 journalière, `excused` hors appel, synchronisation jusqu'à la fin de J+3.

**Révision 4 — décision restante** : valider la fenêtre du pack (§4.5) : utilisation = jour local `D`, émission dès `D−1 12:00`, détention ≤ 36 h (35–37 h au changement d'heure), rafraîchissement à l'ouverture si en ligne, alternative « rafraîchissement obligatoire le matin » écartée. Les points 1 à 5 ci-dessous sont ceux de la révision 3, validés en R3.

1. Valider les deux gardes R et W (§6.2), l'ordre en 15 étapes avec la garde R avant toute lecture d'ACK (§6.3), les réponses exactes (§6.5) et le protocole R-1 à R-10 (§6.9).
2. Valider la règle « révision uniquement après `sessionState: not_recorded` » et l'état `unconfirmable` (§6.8, §7).
3. Valider le périmètre de la garde R : affectation et flags non requis pour relire son propre ACK (P1-10).
4. Valider `canonicalize@2.0.0` comme bibliothèque JCS unique et le validateur de types (§4.1).
5. Valider la rotation planifiée et urgente des clés (§4.2) et la purge par échéance des bases conservées (§5.3).

---

**NFC-PRES-LOCAL-PR0 — DRAFT / HOLD — EN ATTENTE DU DIFF CTO INDÉPENDANT.**
