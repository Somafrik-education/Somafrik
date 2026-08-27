# RC3-1 — SQLite Outbox + replay exactly-once — 2026-08-27

**Type :** moteur d’écriture offline durable (outbox SQLCipher) + replay crash-safe  
**PR :** Draft dédiée, non Ready, non merge  
**Base exacte :** `develop@fc259bf3590c0b7a30da92a6d519a83503c5f4fc`  
**Branche :** `cursor/rc3-sqlite-outbox-exactly-once-9855`  
**Écriture offline branchée aux écrans / smoke physique :** hors scope — **RC3-2**

## SHA

```text
Base develop : fc259bf3590c0b7a30da92a6d519a83503c5f4fc
HEAD         : (commit de cette PR)
```

## Verdict

```text
SQLite Outbox durable          OK
SQLCipher                      OK
Stable idempotency key         OK
Crash-safe replay              OK (tests moteur)
Concurrent worker protection   OK
Cross-user isolation           OK
Cross-school isolation         OK
401/403 preservation           OK
Server TTL compatible          OK (POST /api/presences = 35 j)
Exactly-once tests             OK (A–S)
Physical offline write         PAS ENCORE — RC3-2
Ready                          NON
Merge                          NON
```

## Architecture

```text
Action métier (non branchée dans cette PR)
    ↓
génération idempotency_key
    ↓
SQLCipher INSERT outbox  → COMMIT local AVANT réseau
    ↓
Replay worker (claim/lease exclusive)
    ↓
Idempotency-Key stable + même payload
    ↓
API Somafrik  POST /presences
    ↓
PostgreSQL transaction
    ├── mutation métier
    └── idempotency_keys
    ↓
2xx ou idempotentReplay=true
    ↓
SQLite ACK (state=acked)
```

Sémantique visée, **dans l’horizon de replay supporté** :

```text
transport at-least-once
+ idempotence PostgreSQL existante
= exactly-once BUSINESS EFFECT
```

Aucun second moteur d’idempotence serveur n’est introduit. Le client réutilise `IdempotencyService` / `withIdempotency` déjà en production.

## Schéma SQLCipher

Même fichier que RC2 : `somafrik-l1-v1.db`, clé `somafrik.l1DbKeyV1` dans SecureStore.  
`L1_LOCAL_SCHEMA_VERSION = 2`. Migration versionnée `SCHEMA_MIGRATION_V2` : table `l1_outbox`.

Colonnes : `outbox_id` PK, `idempotency_key` UNIQUE, `user_id`, `school_id`, `operation_type`, `payload_json`, `payload_hash`, `state`, `attempt_count`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_error_code`, `created_at`, `updated_at`, `acked_at`.

États : `pending | in_flight | blocked_authorization | failed_terminal | acked`.

Interdit dans la table : JWT, access/refresh token, mot de passe, Authorization, URL arbitraire.  
Le payload est **immuable** dès l’enqueue (les `UPDATE` ne touchent pas `payload_json` / `payload_hash` / `idempotency_key`).

Aucun second fichier SQLite plaintext. SQLCipher absent ⇒ fail closed (`L1_SQLCIPHER_REQUIRED`).

## Registre d’opérations

Registre fermé. Le moteur reçoit `enqueue(operationType, payload, partition)`, jamais `(url, method, body)`.

Première opération RC3 :

```text
presence.upsert  →  POST /presences
```

Toute `operation_type` inconnue ⇒ `OUTBOX_UNKNOWN_OPERATION` (fail closed).  
L’inscription élève n’est **pas** enregistrée : son contrat exactly-once n’est pas l’objet de ce chantier.

Les écrans métier (dont `TeacherAttendanceScreen`) restent sur l’outbox JSON historique `Mobile/src/lib/outbox.ts`. Cette PR ne les branche pas.

## Enqueue atomique

Séquence obligatoire, y compris online :

```text
intention
→ génération idempotency_key
→ transaction SQLCipher INSERT
→ COMMIT
→ drain immédiat (réseau)
```

Interdit : envoi direct puis fallback queue. Un crash après commit serveur et avant enqueue rendrait l’exactly-once irrejouable.

API interne (écrans = 0 SQLite) :

- `enqueueOutboxOperation`
- `drainOutbox`
- `claimNextOutboxOperation`
- `ackOutboxOperation`
- `releaseForRetry`
- `blockForAuthorization`
- `markTerminalFailure`
- `reclaimExpiredLeases`

Auth au replay : SecureStore / session live uniquement. Jamais persistée dans l’outbox.

## State machine / erreurs

| Classification | État | Retry | Suppression |
|---|---|---|---|
| 2xx / `idempotentReplay=true` | `acked` | non | non |
| NETWORK_UNAVAILABLE / TIMEOUT / BACKEND_UNREACHABLE / 5xx | `pending` + backoff | oui, **même clé** | non |
| 401 après refresh / 403 | `blocked_authorization` | non (jusqu’à réauth live même partition) | non |
| 400 métier | `failed_terminal` | non | non |
| 409 `IDEMPOTENCY_KEY_REUSED` | `failed_terminal` P0 | non, **jamais de nouvelle clé** | non |
| horizon dépassé | `failed_terminal` / `OUTBOX_HORIZON_EXPIRED` | non | non |

Une lease expirée (`in_flight` + `lease_expires_at` dépassé) est reclaimée en `pending`. Aucune ligne ne reste `in_flight` définitivement.

Claim transactionnel, ordre `created_at ASC, outbox_id ASC`. Deux workers : une seule claim (writeTail + `BEGIN EXCLUSIVE`).

## Scénario critique (serveur commit → téléphone meurt avant ACK)

1. Enqueue SQLCipher (clé K, payload P).
2. Worker claim → `in_flight` + lease.
3. POST avec `Idempotency-Key: K` et payload P.
4. PostgreSQL applique la mutation et stocke le résultat idempotent.
5. Le client meurt avant `ACK` SQLite.
6. Redémarrage : lease expirée reclaimée, même ligne `pending`, **même K**.
7. Replay : le serveur renvoie le résultat mémorisé (`idempotentReplay` et/ou 2xx).
8. Aucun second effet métier. SQLite passe `acked`.

Couvert par le test C (moteur) : `mutations === 1` après crash-before-ack + replay.

## Isolation tenant / session

Partition stricte `userId + schoolId`.

- Login utilisateur B : 0 replay de l’outbox A (test J).
- Même user, autre établissement : 0 replay (test K).
- Logout : la queue n’est pas transférée (claim filtrée par la partition courante).
- Réauth du même user + même school : reprise possible après revalidation live des permissions ; les lignes `blocked_authorization` ne sont pas drainées tant qu’elles ne sont pas remises `pending`.

## Horizon exactly-once (P0 TTL)

Constat audit : TTL serveur par défaut = **24 h**, paiements = 7 j. Une outbox multi-jours ne peut pas garantir l’exactly-once si le replay dépasse le TTL.

Contrat RC3-1 :

```text
OUTBOX_REPLAY_HORIZON          = 30 jours
SERVER_OFFLINE_IDEMPOTENCY_TTL = 35 jours   (POST /api/presences uniquement)
```

Le TTL **global** 24 h et le TTL paiements 7 j sont inchangés.  
`ttlForRoute("POST /api/presences")` = 35 jours. Les autres routes (notes, students, …) restent à 24 h.

Au-delà de l’horizon : `failed_terminal` / `OUTBOX_HORIZON_EXPIRED`, **jamais** rejoué avec une nouvelle clé.

**L’exactly-once est garanti uniquement dans cet horizon supporté.**

## Logs

Tag `RC3_OUTBOX`. Allowlist : `operationType`, `state`, `attemptCount`, `classification`, `retry`.  
Interdit : `payload_json`, JWT, refreshToken, Authorization, noms, téléphones, schoolId/userId bruts, clé SQLCipher, body HTTP.

## Tests A–S

Fichier : `Mobile/src/offline/outbox/sqliteOutbox.test.ts`

| # | Cas | Preuve |
|---|---|---|
| A | persist close/reopen SQLCipher | fake SQLCipher + `outboxStoreFor` |
| B | kill avant send | `pending`, 0 mutation |
| C | commit serveur puis crash avant ACK | même clé, 1 effet métier, puis `acked` |
| D | même key + même payload | replay succès, 1 mutation |
| E | même key + payload différent | 409 `IDEMPOTENCY_KEY_REUSED`, `failed_terminal`, clé inchangée |
| F | NETWORK_UNAVAILABLE | `pending` conservé |
| G | TIMEOUT | même clé au retry |
| H | 5xx | `pending` |
| I | 401/403 | `blocked_authorization`, ligne conservée |
| J | autre userId | 0 replay |
| K | autre schoolId | 0 replay |
| L | stale lease | reclaim → `pending` |
| M | 2 workers | une seule claim |
| N | rollback SQLite | insert non visible |
| O | ordre déterministe | `created_at ASC, outbox_id ASC` |
| P | pas de secrets stockés/loggés | registry + logs allowlist + schéma |
| Q | SQLCipher indisponible | fail closed, pas de plaintext |
| R | opération inconnue | refus |
| S | horizon expiré | aucun replay, pas de nouvelle clé |

## CI

```text
verify:mobile-sqlite-outbox
test:mobile-sqlite-outbox
```

Branchés dans `.github/workflows/pr-gates.yml` → job Targeted → **Mobile safety**.

Le vérificateur prouve notamment : SQLCipher obligatoire, `idempotency_key` persistée, aucune URL arbitraire, aucune Authorization persistée, aucun écran `expo-sqlite` / `offline/outbox`, partition user+school, lease/reclaim, même clé réutilisée, 401/403 ne supprime pas, TTL serveur présences 35 j > horizon 30 j.

## Limites (volontaires)

- Aucun bouton métier n’appelle encore ce moteur. RC3-2 branchera **l’Appel / Présences** uniquement.
- L’outbox JSON `Mobile/src/lib/outbox.ts` n’est pas retirée dans cette PR.
- `idempotentReplay` n’est attaché par le serveur que si le body est un objet (les tableaux présences restent 2xx rejouables). Le client ACK sur tout HTTP 2xx **et** sur `idempotentReplay=true`.
- Exactly-once hors horizon 30 j : **non garanti** (entrée `failed_terminal`).
- Smoke physique `Internet OFF → saisie → kill → Internet ON → une seule ligne PostgreSQL` : **RC3-2**.
