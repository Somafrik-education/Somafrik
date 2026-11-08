# NFC-PRES-LOCAL-PR2 — Stockage local chiffré, vérification des packs, parité Hermes

Statut : **DRAFT / HOLD** — aucune activation, aucun écran, aucun flag. Contrat : `docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md` (§3 à §7, §9). Backend consommé : PR1a (#1112), PR1b (#1114), PR1c (#1120).

## 1. Reprise de la PR #1123

Une partie de PR2 avait été publiée sur la branche sans cette session (`6d5df7d9`, 39 commits, dossier `Mobile/src/offline/rollCall/`). Une version locale non poussée existait dans `Mobile/src/offline/rollcall/`. Les deux noms ne diffèrent que par la casse : sur Windows et macOS, ils seraient entrés en collision. La réconciliation :

- part du HEAD publié (aucun `push --force`, aucune réécriture d'historique) ;
- fusionne `develop` ;
- garde le dossier publié `rollCall/` ;
- garde une seule implémentation par primitive.

| Module publié | Décision | Justification |
| --- | --- | --- |
| `jcs.ts` (JCS, UTF-8 strict, LP, `canonicalContractJson`) | **conservé**, implémentation unique | Conforme à `jcs.js`. La copie locale a été supprimée, pour ne pas créer de second JCS. |
| `accountPartition.ts` | **conservé**, HMAC remplacé | API et convention de 23 caractères conservées. Le HMAC écrit à la main est remplacé par `@noble/hashes`, déjà utilisé pour les preuves (même sortie, vérifiée contre `node:crypto`). |
| `schema.ts` | **remplacé** par `store/schema.ts` | (1) Un `CHECK` exige `frozen_body` en état `synced` et `rc_scans.proof` est `NOT NULL` : la purge des preuves et du corps figé de PR0 §5.5 est impossible. (2) `rc_marks` n'a pas de `student_id` : le champ `manual[]` (absents exigés, PR1c §3 ter) ne peut pas être construit. (3) Aucune machine d'état : toute transition est permise. (4) Ni identité de session immuable, ni état `conflict`, ni conservation du corps des sessions `unconfirmable`. |
| `localStore.ts` | **remplacé** par `store/repository.ts` | Pas de construction du lot à la clôture, ni de règles de synchronisation (§6.8), de purge, de déconnexion ou de rapprochement d'élève. Sa règle des **compteurs figés dans la transaction** est reprise. |
| `secureManager.ts` | **remplacé** par `store/database.ts` et `store/accountManager.ts` | Une mauvaise clé lève une erreur sans quarantaine, et l'en-tête du fichier n'est pas vérifié. Il n'y a ni registre d'échéances, ni purge, ni `blocked_logout`. Ses décisions fail-closed sont **toutes reprises** (§4). |
| `test-rollcall-*.mjs`, `test-rollcall-schema.cjs` | **reportés** dans les suites `node:test` | Chaque cas est repris : un brouillon par classe et jour, déplacement entre sessions, `excused` refusé, session inconnue, absence de DDL sans `cipher_version`, compteurs concurrents `[1,2,3]`, doublon après clôture, mêmes connexion et compte, clé perdue, `FILE_LOST`, `SALT_LOST`, clé orpheline, ordre clé puis fichier, oracle HMAC, 23 caractères. |

Défaut corrigé pendant la reprise : dans la version locale, le trigger de révision utilisait `=` sur une colonne pouvant être `NULL`. `NOT (NULL)` restant `NULL`, une révision directe depuis `failed_action_required` sans attestation passait. Toutes les comparaisons sur colonne nullable utilisent désormais `IS` ; le mutant M2b le vérifie.

## 2. Bibliothèques (audit avant installation)

| Paquet | Version figée | Licence | Dépendances | Usage | Hermes |
| --- | --- | --- | --- | --- | --- |
| `@noble/hashes` | **2.0.1** (2025-09-22) | MIT | aucune | SHA-256, HMAC-SHA256 | JS pur. N'utilise ni `TextEncoder` (UTF-8 fourni par `jcs.ts`) ni `crypto.getRandomValues` (aucune génération de clé) ; `BigInt` non requis. |
| `@noble/curves` | **2.0.1** (2025-09-22) | MIT | `@noble/hashes` 2.0.1 exacte | Vérification Ed25519 seule | `BigInt` (pris en charge par Hermes de RN 0.81). Mode **RFC 8032 strict** (`zip215: false`), comme OpenSSL côté Backend. Seul `ed25519.js` est importé : `abstract/fft.js` (`new Function`) n'est pas inclus dans le bundle. |

Les deux bibliothèques ont été auditées publiquement (Cure53 pour `hashes`, Trail of Bits et Kudelski pour `curves`). Une version 2.x est publiée en ESM seulement ; Metro (Expo SDK 54) résout les `exports` (bundle de recette vérifié). Aucune clé privée n'est embarquée : l'application ne fait que vérifier.

## 3. Modules (`Mobile/src/offline/rollCall/`)

- `crypto/` : octets et base64url strict (`bytes.ts`) ; primitives du contrat (`primitives.ts`) : `cardRef`, `verifier`, `proof`, `payloadDigest`, message signé du pack et de la révocation, Ed25519 ; suite de parité S13 (`parity.ts`), exécutée sous Node et sous Hermes.
- `pack/` :
  - `keyring.ts` : trousseau public par environnement ;
  - `revocations.ts` : liste monotone (union, séquence maximale, anti-rollback) ;
  - `clock.ts` : `lastTrustedTime`, tolérance de 10 minutes ;
  - `verifyPack.ts` : forme stricte, versions, clé, signature, portée (établissement, enseignant, classe, date), fenêtre ;
  - `packService.ts` : stockage du texte original, revérification à chaque chargement, suppression en cas d'échec.
- `store/` :
  - `schema.ts` : tables PR0 §5.4, `CHECK`, index uniques partiels, triggers de transitions, de révision, d'immutabilité et d'interdiction de suppression ;
  - `database.ts` : SQLCipher par compte, réutilise `applySqlCipherKey` de L1 ;
  - `repository.ts` : une transaction `BEGIN IMMEDIATE` par événement ;
  - `accountManager.ts` : changement de compte, déconnexion, purge, quarantaine ;
  - `nativePlatform.ts` : expo-sqlite, expo-secure-store, expo-crypto, expo-file-system.

Aucun appel réseau, aucun écran, aucun flag. Le module n'est importé par aucun écran : PR3 le branchera.

## 4. Invariants et décisions

- **Transactions** : chaque événement suit `BEGIN IMMEDIATE`, puis l'écriture, puis `COMMIT`. Les compteurs sont lus dans la transaction et remis seulement si le `COMMIT` réussit. Si le `COMMIT` est refusé (test « disque plein au COMMIT »), rien n'est renvoyé et un `ROLLBACK` est fait.
- **Immutabilité, imposée par le moteur** :
  - `frozen_body`, `operation_id` et `payload_digest` sont figés à la clôture ;
  - la révision n'est possible que depuis `failed_action_required` avec `last_session_state IS 'not_recorded'` ;
  - les transitions sont limitées à celles de PR0 §7 ;
  - les scans et marques ne sont modifiables qu'en brouillon ;
  - aucune suppression d'une session non synchronisée.
- **Synchronisation (règles de stockage)** : le passage à `synced` n'a lieu qu'avec un ACK conforme (opération, révision et digest). Dans la même transaction, les preuves, le corps figé et le pack sont purgés. Un `COMMIT` local ne déclare jamais un appel enregistré sur le serveur.
- **Incidents** (décisions publiées, reprises) :

  | Cas | Résultat |
  | --- | --- |
  | Clé perdue | quarantaine, `RC_DATABASE_KEY_LOST` |
  | Fichier illisible, mauvaise clé ou base d'un autre compte | quarantaine (la clé suit sous un nom de quarantaine), `RC_DATABASE_UNREADABLE` |
  | Clé présente, fichier disparu | `RC_DATABASE_FILE_LOST`, clé conservée |
  | Sel d'appareil perdu alors que des bases existent | `RC_ACCOUNT_SALT_LOST`, aucun nouveau sel |
  | Première ouverture échouée | ni clé orpheline ni fichier |

  Ajout de PR2 : les blocages `FILE_LOST` et `SALT_LOST` sont levés à l'échéance par la purge du registre (clé et fichiers effacés), ce qui évite un blocage définitif.
- **Chiffrement** :
  - `cipher_version` non vide exigé avant toute instruction DDL ;
  - clé lisible (`sqlite_master`, `quick_check`) ;
  - l'en-tête du fichier ne doit pas être `SQLite format 3\0`, sinon la base est supprimée et l'erreur est `RC_SQLCIPHER_PLAINTEXT_FILE` ;
  - `allowBackup="false"` (plugin `withSomafrikAndroidSecurity`), SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.

- **État local de sécurité (correctif de la revue CTO sur `b2a3a3ef`)** : la liste de révocation conservée (`pack_revocations`) et l'horloge de confiance (`last_trusted_time_ms`) sont des protections monotones. Elles ne sont jamais remplacées par un état vide.
  - Les deux valeurs sont écrites **à la création** de la base (`{"sequence":0,"revokedKeyIds":[]}` et `"0"`). Leur absence ultérieure est donc une corruption, jamais une base neuve.
  - Lecture stricte : forme exacte, séquence entière ≥ 0 (≥ 1 dès qu'une clé est révoquée), identifiants valides triés sans doublon, horloge en entier décimal canonique. Toute autre valeur produit un refus explicite : `RC_PACK_REVOCATIONS_STATE_CORRUPT` ou `RC_TRUSTED_TIME_STATE_CORRUPT`.
  - En cas de refus, aucun pack n'est utilisable ni téléchargeable. Rien n'est écrit, la valeur corrompue n'est pas écrasée et le pack stocké n'est pas supprimé.
  - Chaque mise à jour (union des révocations, avance de l'horloge) lit, fusionne et écrit dans **une seule transaction** : aucun état intermédiaire après un arrêt brutal ou un `COMMIT` refusé.
  - Triggers SQLite sur `rc_meta`, vérifiés aussi sur SQLCipher Android par la recette native : suppression interdite ; identité du compte immuable ; séquence jamais en recul ; aucune clé révoquée retirée ; horloge jamais en recul.

## 5. Écarts et interprétations du contrat PR0, soumis au CTO

1. **`accountId` de 23 caractères** : `[0..22]` est lu comme un intervalle inclusif. Convention publiée avant cette session et conservée.
2. **Préchargement** : un pack avant `notBefore` peut être **stocké** (préchargement de la veille, §4.5), mais n'est jamais **utilisable** avant `notBefore`. §4.3 (étape 5) ne distinguait pas les deux.
3. **Échéance sans pack** (mode dégradé) : la borne locale de purge est D+4 12:00 UTC, l'instant le plus tardif de la fin de J+3 sur tous les fuseaux. Le serveur reste seul juge.
4. **Liste de révocation absente, invalide ou plus ancienne** : le pack est refusé (fail-closed). Pendant un redéploiement progressif où deux instances auraient des séquences différentes, un pack pourrait être refusé ponctuellement : mode dégradé, aucun droit perdu.
5. **Trousseaux embarqués vides** : les clés de préproduction et de production ne sont pas générées. Tout pack réel est donc refusé (`RC_PACK_KEY_UNKNOWN`), ce qui est fail-closed. Il faudra les clés publiques `active` et `standby` avant PR3.

## 6. Preuves

| Gate | Moyen | État |
| --- | --- | --- |
| Tests unitaires et SQLite (Node) | `npm --prefix Mobile run test:rollcall-offline` : 76 tests (crypto 12, pack 11, stockage 25, état local de sécurité 27, arrêt brutal 1) | PASS |
| Parité Backend (Node) | 27 cas S13, 3 000 valeurs JCS aléatoires, preuves et digest aléatoires contre le code Backend | PASS |
| Arrêt brutal | processus fils tué par `SIGKILL` dans une transaction, fichier SQLite réel | PASS |
| Mutation | 17 mutants (voir les commentaires de PR) | 17 KILLED |
| Hermes S13 **sous Android** | `.github/workflows/nfc-pr2-native-proof.yml` : APK de recette x86_64, émulateur API 34 (KVM), `scripts/run-rc-offline-native-proof.js` | voir le commentaire de PR, au HEAD exact |
| SQLCipher **Android** | même workflow : `cipher_version`, écriture, fermeture, `force-stop`, relecture, mauvaise clé et sans clé refusées, en-tête chiffré | idem |

Les tests Node **ne prouvent ni** le chiffrement SQLCipher (simulé par `rcTestPlatform.testutil.ts`) **ni** Hermes. Sans exécution native réussie au HEAD exact, PR2 reste `HERMES_S13_NOT_RUN` / `ANDROID_SQLCIPHER_NOT_RUN`.

## 7. Risques résiduels

- Isolation entre comptes applicative et par fichier, pas cryptographique contre une application modifiée (P1-3 du contrat).
- Le pack reste indicatif : une clé compromise non encore révoquée sur un téléphone hors ligne n'affecte que l'affichage.
- L'APK de recette n'est exécutée que sur émulateur x86_64. Une recette sur appareil ARM64 physique reste à faire en PR5.
- Le téléchargement de Gradle en CI est sensible au délai réseau (correctif #1128, non fusionné, hors périmètre).

## 8. Étapes suivantes (non autorisées par ce mandat)

- **PR3 (boucle de scan et écran)** :
  - brancher `createRollCallAccountManager` à la connexion, à la déconnexion (confirmation si appels en attente) et au démarrage (`runStartupMaintenance`) ;
  - préparer chaque scan : calculer K, `proof` et `matchCardInPack`, puis abandonner K ;
  - appeler `recordScan` seulement après la lecture NFC/QR, avec retour visuel après `COMMIT` ;
  - écran, compteurs et nouveau flag ;
  - publier les clés publiques des trousseaux.
- **PR4 (synchronisation)** :
  - runner sur `networkResilience`, `connectivity` et `OutboxRuntime` ;
  - `beginSyncAttempt`, puis HTTP `POST …/offline/v1/sync` avec `Idempotency-Key = operationId` et le corps figé à l'identique, puis `recordSyncOutcome` ;
  - backoff `next_attempt_at` ; `recordTrustedTime` sur l'en-tête `Date` ; `markAccountUnconfirmable` sur 401/403 de compte.
- **PR5 (recette physique)** : NTAG213/216, appareils ARM64 réels, réseau coupé, changement d'heure, rotation d'urgence des clés.
