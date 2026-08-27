# RC3-2 — Physical offline write / Présences — 2026-08-27

**Type :** branchement Appel / Présences sur l’outbox SQLCipher RC3-1  
**PR :** Draft stackée sur #354  
**Base technique :** `e51a8da96fba3d564d8950190ff77c74c3716a51`  
**Branche :** `cursor/rc3-physical-offline-presence-9855`  
**Base GitHub de la PR :** `cursor/rc3-sqlite-outbox-exactly-once-9855` (pas `develop`)

## SHA

```text
Base moteur RC3-1 : e51a8da96fba3d564d8950190ff77c74c3716a51
develop           : fc259bf3590c0b7a30da92a6d519a83503c5f4fc
```

## Périmètre

#354 n’est pas modifié. Cette PR branche **uniquement** `TeacherAttendanceScreen` :

```text
intention Appel
→ enqueueOutboxOperation("presence.upsert", payload, partition)
→ COMMIT SQLCipher
→ drainOutbox (POST /presences + même Idempotency-Key)
```

Interdit : POST direct puis fallback outbox.  
Les autres mutations (notes, messages, paiements) restent sur l’outbox JSON historique.

## UI

- Saisie d’appel autorisée hors ligne.
- Après enqueue non ACK : **En attente de synchronisation** (`ROLL_CALL_COPY.queued`).
- Succès serveur / « Appel synchronisé » uniquement si `state=acked` (ACK SQLite réel).
- Jamais de succès local déguisé en PostgreSQL.

`PresenceOutboxRuntime` rejoue la file SQLCipher au cold boot et au retour réseau (partition `userId+schoolId`).

## Logs (non sensibles)

```text
RC3_OUTBOX enqueue
RC3_OUTBOX claim
RC3_OUTBOX send
RC3_OUTBOX retry / reclaim
RC3_OUTBOX ack
RC3_PHYSICAL_PRESENCE_SMOKE empty | pending | OK
```

Pas de payload, JWT, Authorization, identifiants bruts, clé SQLCipher.

## Smoke Android physique (Xiaomi) — procédure

PostgreSQL reste l’autorité. Vérifier **une** mutation métier et **une** ligne `idempotency_keys` pour la clé rejouée.

1. **Internet ON** — login, charger classe/élèves, `RC3_PHYSICAL_PRESENCE_SMOKE empty`.
2. **Internet OFF** — appel réel de test. Preuves : `RC3_OUTBOX enqueue` + `pending`, aucun POST 2xx, puis **kill**.
3. **Cold relaunch OFF** — même `outbox_id`, même `idempotency_key`, état `pending` (ou reclaim de lease).
4. **Internet ON** — drain : `claim` → `send` → `POST /presences` même clé → `ack` → `state=acked` → `RC3_PHYSICAL_PRESENCE_SMOKE OK`.
5. **Rejeu volontaire même clé** — réponse idempotente, pas de second effet métier.
6. **PostgreSQL** — exactement une mutation présence + une identité idempotente.
7. **Kill critique** — serveur commit, pas d’ACK client, kill, relaunch, replay même clé, `acked`, toujours 1 effet PostgreSQL.

## Verdict

```text
Offline enqueue durable        (CI moteur + branchement) OK
Kill/relaunch persistence      À PROUVER sur device
Stable Idempotency-Key         OK (moteur + même intention)
Replay after reconnect         À PROUVER sur device
Crash before ACK               OK tests moteur / À PROUVER device
PostgreSQL single effect       À PROUVER sur device
RC3 physical smoke             HOLD — GO physique requis
Ready                          NON
Merge                          NON
```

Le GO physique n’est pas simulé par CI. Après GO, merger #354 puis retargeter/rebaser cette PR sur `develop`.
