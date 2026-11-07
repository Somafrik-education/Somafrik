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
        une transaction PostgreSQL, ordre de verrous fixe (§6.2)
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
    "expiresAt": "ISO-8601 UTC",
    "syncDeadline": "ISO-8601 UTC (indicatif ; le serveur recalcule au sync)",
    "students": [{ "matchKey": "…", "studentId": "uuid", "studentCode": "…", "firstName": "…", "lastName": "…", "existingStatus": null }],
    "cards": [{ "cardRef": "…", "matchKey": "…", "verifier": "…" }]
  },
  "signature": { "alg": "Ed25519", "keyId": "rc-pack-<env>-<n>", "value": "base64url" }
}
```

- `students` triés par `matchKey`, `cards` par `cardRef`. Tout le contenu de `pack` est signé : établissement, acteur, mode, classe, date, `packId`, versions, horodatages et listes complètes.
- Message signé : `utf8("somafrik.rc-offline.pack.v1\n") || utf8(JCS(pack))`, JCS = RFC 8785. Pour les types du contrat (chaînes, entiers, booléens, `null`, tableaux, objets), JCS coïncide avec `stableSerialize` de `idempotencyService.js` ; les flottants sont interdits dans le pack.
- `matchKey` = HMAC serveur (clé dérivée HKDF du secret roll-call existant, étiquette `student-card-roll-call:offline-match:v1`) sur `LP(packId, studentId)` : pas de corrélation d'un pack à l'autre.

### 4.2 Algorithme et clés

- Ed25519 (signature déterministe, clé publique de 32 octets). Côté Mobile : vérification par une bibliothèque pure JS auditée (`@noble/curves`), choix à confirmer en PR2.
- Clé privée : secret Render par environnement (`ROLL_CALL_PACK_SIGNING_KEY`, PKCS#8), jamais dans le dépôt, les logs ni les réponses. Absente ou invalide → la route pack répond 503 et le mode dégradé s'applique.
- Clés publiques : trousseau `{ keyId → clé publique }` embarqué dans l'APK **par environnement** (préprod ≠ production), via la configuration de build.
- Rotation : publier la nouvelle clé publique dans une version de l'application, puis basculer le serveur ; l'ancienne reste dans le trousseau jusqu'à la version minimale suivante. Compromission de la clé privée : impact limité (le pack n'autorise rien), retrait par mise à jour de l'application.

### 4.3 Vérification et rejet fail-closed

Le Mobile vérifie au téléchargement **et à chaque chargement depuis SQLCipher** (détection de corruption) :
1. `alg = Ed25519`, `keyId` présent dans le trousseau de l'environnement ;
2. signature valide sur le message exact ;
3. `contractVersion` et `packVersion` supportés ;
4. `schoolId` et `actorUserId` égaux au compte ouvert ; `classId`, `date`, `mode` égaux à la session ;
5. horloge appareil dans `[issuedAt − 10 min ; expiresAt]`.

Un échec à n'importe quelle étape → pack supprimé, message « Liste hors ligne indisponible », **mode dégradé** : scans conservés en `unknown_local` (« à vérifier »), aucune carte présentée comme reconnue. Jamais d'utilisation partielle d'un pack.

### 4.4 Portée

Le pack est **indicatif uniquement**. Il sert au retour visuel, au compteur provisoire et à l'affichage des noms. Il n'accorde aucun droit : le serveur ne lit pas le pack au sync et revalide rôle, affectation, flags, tenant, cartes et inscriptions. La signature protège contre la corruption et l'altération du stockage par un tiers, pas contre une application compromise (même conclusion que §3.3).

### 4.5 Durées (fuseau de l'établissement)

Fuseau : `schools.profile_payload->>'timezone'`, résolu par `resolveSchoolTimeZone` (déjà utilisé par `studentCardEntry.js`). Toutes les échéances sont calculées par le serveur.

| Échéance | Règle | Justification |
| --- | --- | --- |
| Dates de pack acceptées | `date ∈ {J, J+1}` en heure locale de l'établissement | préchargement la veille au soir, quand le réseau est disponible |
| `expiresAt` | `min(issuedAt + 18 h ; fin du jour local date)` (pour J+1, `issuedAt` est la veille) | un pack ne sert que le jour de l'appel ; 18 h couvre une journée scolaire sans dépasser le jour |
| Scans | uniquement si la date locale de l'appareil = `date` (contrôle UX ; le serveur ne fait pas confiance à l'horloge) | — |
| `syncDeadline` | fin du jour local `date + 3` | couvre un week-end (appel du vendredi synchronisé le lundi) et une coupure réseau de plusieurs jours |
| Contrôle au sync | le serveur recalcule l'échéance à partir de `date` et du fuseau **courant** ; il ignore la valeur envoyée | le serveur fait foi |

Ces durées sont des valeurs par défaut à valider par le CTO ; elles seront des constantes serveur, testées aux bornes (fuseau ≠ UTC, passage de minuit).

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
| Connexion | ouverture de la base du compte, si elle existe ; reprise des sessions |
| Changement de compte ou d'établissement | fermeture de la base courante, ouverture de celle du nouveau compte ; rien n'est déplacé |
| Déconnexion sans appel en attente | crypto-effacement (clé puis fichier) |
| Déconnexion avec appel en attente | confirmation explicite ; base **fermée et conservée** (`blocked_logout`), rouverte seulement par le même compte |
| Échéance dépassée sur une base fermée | au démarrage, purge des sessions expirées (§5.5) ; base vide → crypto-effacement |
| Clé absente (réinstallation, SecureStore effacé) ou base illisible ou corrompue | aucune recréation par-dessus : fichier renommé en `.quarantine`, message « N appel(s) local(aux) illisible(s) : saisissez-les manuellement », journal d'incident sans PII, quarantaine supprimée après 7 jours |
| Échec d'écriture (disque plein, `SQLITE_FULL`, `SQLITE_CORRUPT`) | scan refusé visiblement, compteur inchangé, aucune confirmation |

### 5.4 Tables (migration locale v1)

```sql
rc_meta (key PRIMARY KEY, value)                    -- version de schéma, accountId, environmentId
rc_packs (pack_id PRIMARY KEY, class_id, roll_call_date, expires_at, signed_payload BLOB NOT NULL)
rc_sessions (
  session_id PRIMARY KEY, user_id, school_id, class_id, roll_call_date,
  mode CHECK (mode = 'teacher'), pack_id NULL,
  state CHECK (state IN ('draft','closed','syncing','synced','failed_retryable',
                         'failed_action_required','expired','blocked_logout')),
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
- un trigger `BEFORE UPDATE` refuse toute modification de `frozen_body`, `operation_id` et `payload_digest` tant que `state ∈ ('closed','syncing','failed_retryable')`.

### 5.5 Données personnelles et purge

Le pack contient des **données nominatives** (nom, prénom, code élève, identifiant, statut du jour) de la classe de l'enseignant affecté, et seulement de celle-ci. Pas de photo, pas de donnée de paiement.

| Donnée | Purge |
| --- | --- |
| Pack | à `expiresAt`, ou dès la synchronisation de la session qui l'utilise |
| Preuves (`rc_scans.proof`) | dans la transaction locale qui passe la session à `synced` |
| `frozen_body` | idem |
| Session `synced` | résumé de compteurs conservé 7 jours, puis suppression |
| Session non synchronisée après `syncDeadline` | état `expired` : preuves, corps figé et noms supprimés ; compteurs conservés jusqu'à acquittement par l'utilisateur, au plus 7 jours |
| Brouillon | jamais purgé silencieusement avant l'échéance |

---

## 6. Contrat de synchronisation et idempotence (correction P0-3)

### 6.1 `POST /api/student-cards/roll-call/offline/v1/sync`

En-tête `Idempotency-Key: <operationId>` obligatoire, égal au champ du corps.

```json
{
  "contractVersion": "rc-offline-1",
  "operationId": "uuid", "sessionId": "uuid", "revision": 1,
  "classId": "uuid", "date": "YYYY-MM-DD", "mode": "teacher", "packId": "uuid|null",
  "complete": true,
  "scans":  [{ "scanId": "uuid", "publicId": "…", "proof": "…", "medium": "nfc|qr", "scannedAt": "…" }],
  "manual": [{ "studentId": "uuid", "status": "present|late|absent" }],
  "payloadDigest": "hex(SHA-256(JCS(corps sans payloadDigest)))"
}
```

`scans` triés par `scanId`, `manual` par `studentId` (ordre canonique, digest stable). Limites : 300 scans, 300 marques, corps ≤ 256 Ko, limiteur de débit par utilisateur. `scannedAt` est informatif.

### 6.2 Ordre d'exécution et des verrous

Le gestionnaire s'exécute dans `withIdempotency` → `withIdempotencyTransaction` (une seule transaction PostgreSQL, isolation READ COMMITTED). Ordre **fixe** :

| # | Étape | Hors / dans transaction | Échec |
| --- | --- | --- | --- |
| 0 | Authentification JWT, format, `contractVersion`, `Idempotency-Key = operationId`, recalcul de `payloadDigest` | hors | 400 `INPUT_INVALID` / `DIGEST_MISMATCH` |
| 1 | `pg_advisory_xact_lock(cacheId)` de `withIdempotencyTransaction` (clé, route, principal, établissement) | dans | — |
| 2 | Rejeu `idempotency_keys` (< 24 h) : même hash → ACK stocké ; hash différent → 409 `IDEMPOTENCY_KEY_REUSED` | dans | — |
| 3 | `pg_advisory_xact_lock(hashtext('rc-offline-session'), hashtext(schoolId ‖ ':' ‖ sessionId))` | dans | — |
| 4 | **Lecture du journal** `attendance_roll_calls (school_id, session_id)`, après le verrou 3 (nouvel instantané READ COMMITTED) | dans | voir §6.3 |
| 5 | Autorisation **live** : rôle TEACHER relu en base, affectation active, gate `write_presence`, flags (maître, présences, NFC/QR selon `medium`) | dans | 403 / 404, rien n'est écrit |
| 6 | Fenêtre de date recalculée (fuseau courant) | dans | 409 `OFFLINE_EXPIRED` |
| 7 | `lockRollCallDay(schoolId, date)` (verrou existant, partagé avec `/validate`) | dans | — |
| 8 | Cartes `FOR SHARE` triées par `id` ; preuves ; statut ; support ; propriétaire | dans | 409 `CARD_INVALID` / 400 `PROOF_INVALID` |
| 9 | `lockEnrolledRoster` `FOR SHARE` ; contrôle de liste complète | dans | 409 `ROSTER_CHANGED` |
| 10 | Présences `FOR UPDATE` triées par élève ; `attendanceTransition` ; `upsertSchoolAttendanceBatch` avec gardes | dans | 409 `CONCURRENT_UPDATE` après 3 essais |
| 11 | Insertion journal (`source = 'offline'`, `operation_id`, `payload_digest`, `ack_body`) ; absence de ligne insérée = erreur interne (impossible sous le verrou 3) | dans | 500, ROLLBACK |
| 12 | Audit ; puis `service.store` de `withIdempotency` (même transaction) | dans | ROLLBACK |
| 13 | COMMIT ; réponse | — | — |

Ordre global des verrous : idempotence (1) → session (3) → jour (7) → cartes (8) → inscriptions (9) → présences (10). La route `/validate` en ligne prend 1 → 7 → 8 → 9 → 10 : ordre compatible, sans inversion. Toute erreur levée aux étapes 2 à 12 annule la transaction : **un 4xx garantit l'absence de COMMIT**.

### 6.3 Décision à l'étape 4 (journal)

| Journal trouvé | Condition | Réponse |
| --- | --- | --- |
| Non | — | poursuivre (étapes 5 à 13), 201 |
| Oui | même `operation_id` et même `payload_digest`, même auteur canonique | **200 + `ack_body` stocké**, sans écriture ni revalidation des droits |
| Oui | même `operation_id`, auteur différent | 404 (aucune information divulguée) |
| Oui | `operation_id` ou `payload_digest` différent | 409 `ROLL_CALL_SESSION_CONFLICT` (session déjà validée avec un autre contenu) |
| Oui | `source = 'online'` | 409 `ROLL_CALL_SESSION_CONFLICT` |

Pourquoi l'étape 4 précède l'autorisation : après un timeout où la première tentative a été validée, un enseignant dont l'affectation ou un flag a changé entre-temps doit recevoir l'ACK, pas un 403 qui ferait croire que rien n'est enregistré.

### 6.4 ACK

```json
{ "rollCallId": "uuid", "sessionId": "uuid", "operationId": "uuid", "revision": 1,
  "payloadDigest": "hex", "validatedAt": "ISO", "created": 0, "corrected": 0, "unchanged": 0,
  "protected": 0, "protectedScanIds": ["uuid"], "protectedManualIndexes": [0],
  "invalidScanIds": [], "counts": { "present": 0, "late": 0, "absent": 0, "excused": 0, "enrolled": 0 } }
```

- Aucun identifiant d'élève dans l'ACK : seulement des `scanId` et des index du lot.
- `ack_body` est figé au COMMIT et renvoyé à l'identique par toute relecture (étape 2 ou 4) : les compteurs ne sont pas recalculés après coup. Une relecture ajoute seulement `idempotentReplay: true` (comportement existant de `withIdempotency`) ; le Mobile compare les champs de l'ACK, pas les octets de la réponse.
- Le Mobile ne passe `synced` que si `operationId`, `revision` et `payloadDigest` de l'ACK égalent ceux du lot figé ; sinon `failed_action_required` (`ACK_MISMATCH`), jamais `synced`.

### 6.5 Migration additive (PR1c)

```sql
ALTER TABLE attendance_roll_calls
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS operation_id UUID,
  ADD COLUMN IF NOT EXISTS payload_digest TEXT,
  ADD COLUMN IF NOT EXISTS ack_body JSONB;
-- contrainte : source IN ('online','offline') ; offline ⇒ operation_id, payload_digest, ack_body NOT NULL
```

Pas de suppression, pas de réécriture des lignes existantes, pas de durée de rétention nouvelle sur `idempotency_keys`.

### 6.6 Règles Mobile : révision ou renvoi à l'identique

| Réponse reçue | Classe | Action |
| --- | --- | --- |
| 201 / 200 avec ACK conforme | définitive, succès | `synced` |
| 400, 403, 404 (flag), 409 `CARD_INVALID` / `ROSTER_CHANGED` / `OFFLINE_EXPIRED` / `SESSION_CONFLICT` / `PROOF_INVALID` | **définitive, sans COMMIT garanti** | `failed_action_required` ; correction possible → `revision + 1`, **nouvel** `operationId`, même `sessionId` |
| Erreur réseau, timeout, 408, 429, 5xx, réponse illisible | **incertaine** | `failed_retryable` ; renvoi du `frozen_body` **octet pour octet**, même `operationId` ; modification, réouverture et nouvelle révision interdites |
| 2xx avec ACK non conforme, ou 409 `IDEMPOTENCY_KEY_REUSED` | anomalie (ACK incohérent ou corps altéré localement) | `failed_action_required`, incident journalisé, pas de nouvel envoi automatique |

Une révision n'est possible qu'à partir d'un état dont la dernière réponse est définitive. Deux appareils du même enseignant sur la même classe et le même jour produisent deux `sessionId` différents : chacun est traité par `attendanceTransition` ; le second voit les statuts du premier comme existants (protégés ou inchangés), jamais écrasés.

---

## 7. Machine d'état Mobile

```
draft ──clôture explicite──▶ closed (frozen_body, operationId, digest) ──▶ syncing
syncing ──2xx + ACK conforme──▶ synced                (seul chemin vers « Synchronisé »)
syncing ──réponse incertaine──▶ failed_retryable ──backoff──▶ syncing (même octets)
syncing ──4xx définitif──▶ failed_action_required ──correction──▶ draft (revision + 1)
{draft, closed, failed_*} ──syncDeadline dépassée──▶ expired
{closed, failed_*} ──déconnexion confirmée──▶ blocked_logout ──reconnexion même compte──▶ état précédent
```

Libellés : « Brouillon local », « À synchroniser », « Synchronisé », « Échec à résoudre ». Aucune clôture automatique, même à 0 restant. Le runner de synchronisation réutilise `networkResilience` (`executeMutation`, `classifyMutationFailure`), `connectivity` et le cycle de vie d'`OutboxRuntime` ; seul le stockage diffère (SQLCipher par compte).

---

## 8. Décisions produit V1 (arrêtées par le CTO)

- **Présence journalière** : une présence par élève et par jour (`uq_attendance_school_student_date`), comme aujourd'hui. Pas d'appel par séance en V1.
- **« Justifié » (`excused`)** : reste exclusivement dans le flux de justification existant ; non saisissable dans l'appel ; jamais écrasé.
- Durées de conservation : proposées en §4.5 et §5.5, **à valider**.

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
| V-10 | signature du pack de test | `F95JTgvkGrVWytegiJRIoMkghgEQGjCRd4LVBQJTMgjlUPRLhisAUc6Qxsoel_oZcP-sT9_l4fCQ7l5W8f2vDw` ; vérifie = `true` ; même signature sur pack dont `classId` est modifié = `false` |
| V-11 | `payloadDigest` du lot de test | `cf9d63b448edef12309b47f9e3b2e0dd26c94c54ee5562aa1d6633bd82d88b50` |
| V-12 | `payloadDigest` du même lot, `medium` passé à `qr` | `5fb1951cc9284c0508a17adbaf3f4d8b0633d2dc58eda325be2396c26ba0370a` ≠ V-11 |

Ces valeurs ont été calculées avec `node:crypto` (Node 22) dans l'environnement de rédaction. Le pack de test et le lot de test complets figurent dans le JSON ; V-10 et V-11 ont été recalculés depuis ce JSON avec `stableSerialize` de `backend/services/idempotencyService.js` (résultat identique), ce qui confirme l'équivalence JCS / `stableSerialize` pour ces types. Elles ne prouvent rien sur le code Backend ou Mobile, qui n'existe pas encore : elles en seront l'oracle.

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
| 12b | Rôle ou flag révoqué **après** COMMIT puis renvoi | PR1c | PG réel | ACK rejoué (étape 4 avant étape 5) |
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
| S12 | Échéances aux bornes (fuseau ≠ UTC, minuit, J+1, J+3) | PR1b/PR1c | unitaire + PG réel | conformes à §4.5 |

Physique (#921, PR5) : NTAG213 et NTAG216, 30+ scans, `active/encoded`, présence vérifiée dans PostgreSQL — **NOT RUN** depuis l'environnement Claude ; procédure opérateur fournie en PR5.

---

## 11. Risques

**P0**
- **P0-1** Sans pack, pas de retour « reconnu » hors ligne : préchargement J/J+1 dès que le réseau est présent ; sinon mode dégradé explicite.
- **P0-2** Faux « Synchronisé » : seul un ACK conforme y mène (§6.4) ; tests S7 et 7 bloquants en PR4.
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
- **P1-8** Dépendances cryptographiques Mobile (`@noble/hashes`, `@noble/curves`) à valider ; les vecteurs §9 sont l'oracle commun.

---

## 12. Découpage des PR

Chaque PR : branche issue du `develop` courant, Draft/HOLD, base/HEAD/merge-base/ahead-behind, diff complet pour revue CTO indépendante. **Aucune PR produit avant nouvelle revue CTO de ce contrat.**

| PR | Branche | Contenu | Dépend de |
| --- | --- | --- | --- |
| **PR1a** | `feat/nfc-pres-local-pr1a-proof` | Module pur Backend : `LP`, `cardRef`, `verifier`, `proof`, digest JCS ; tests sur vecteurs §9 ; aucune route | PR0 accepté |
| **PR1b** | `feat/nfc-pres-local-pr1b-pack` | `GET …/offline/v1/pack`, signature Ed25519, échéances par fuseau, RBAC/flags/tenant ; tests PG S5, S6, S12 | PR1a |
| **PR1c** | `feat/nfc-pres-local-pr1c-sync` | Migration additive ; `POST …/offline/v1/sync` selon §6.2 ; extraction sans changement de comportement du moteur `writeTeacherRollCall` ; tests PG 3, 8–13, S1–S4, S8, S9 | PR1a |
| **PR2** | `feat/nfc-pres-local-pr2-store` | Base SQLCipher par compte, migrations, triggers d'immutabilité, purge, quarantaine ; vérification de pack ; tests 2, 5, 6, 14, S5, S11 | PR1a (vecteurs) |
| **PR3** | `feat/nfc-pres-local-pr3-scan` | Boucle NFC/QR locale, HMAC Mobile, compteurs, corrections, UX, flag d'établissement `studentCardOfflineRollCallEnabled` (défaut off) | PR2, PR1b |
| **PR4** | `feat/nfc-pres-local-pr4-sync` | Runner de synchronisation, machine d'état, règles §6.6, ACK, `blocked_logout` ; tests 7, S7 | PR1c, PR3 |
| **PR5** | `test/nfc-pres-local-pr5-recette` | Intégration, APK préprod, Maestro, procédure opérateur NTAG213/216, preuves | PR4, #921 |

Le flag d'établissement (PR3) est le seul nouveau flag : le parcours en ligne actuel reste le comportement par défaut.

---

## 13. Décisions demandées au CTO (révision 2)

1. Valider l'encodage `LP`, les étiquettes et le support authentifié (§3.2, §3.3) à partir des vecteurs §9.
2. Valider la spécification du pack signé (§4) et la distribution des clés.
3. Valider l'ordre d'exécution et des verrous (§6.2), la règle « journal avant autorisation » (§6.3) et l'`ack_body` figé.
4. Valider le cloisonnement par compte et les risques résiduels P1-3 (§5).
5. Valider les durées (§4.5, §5.5).

---

**NFC-PRES-LOCAL-PR0 — DRAFT / HOLD — EN ATTENTE DU DIFF CTO INDÉPENDANT.**
