# RC2 Offline Read Smoke — 2026-08-27

**Type :** validation RC2 lectures L1 hors ligne (Android physique)  
**PR :** [#353](https://github.com/Somafrik-education/Somafrik/pull/353) Draft dédiée — **aucun Ready / aucun merge sur CI seule**  
**Outbox / écriture offline / RC3 :** hors scope

## Identité

```text
Base develop exact : 874f9415cda8c1e3df1339001b8f0f437149f38d
                     (merge #352 Native SQLCipher APK smoke)
HEAD PR            : (pointe de #353 — correctif DB connexion exclusive SQLCipher)
Appareil physique  : Xiaomi E6QCAIAIC6LJIBXG
Package            : com.somafrik.app
Version            : 1.2.1 (versionCode 13)
```

## Ressources L1 couvertes

```text
Classes
Students
Assignments
SchoolCourses
CourseSchedules
```

Lecteur unique : `readL1Resource` / `loadL1BackedSnapshot`.  
SQLite lu seulement si `meta.state === "ready"`, partition exacte `userId + schoolId`.  
Fallback cache seulement pour `NETWORK_UNAVAILABLE`.  
`ready_offline` : aucun GET métier avant affichage L1.

## Instrumentation (logcat, non sensible)

```text
RC2_L1_SYNC_START resource=classes
RC2_L1_STAGE resource=classes stage=meta_start
RC2_L1_STAGE resource=classes stage=meta_ok
RC2_L1_STAGE resource=classes stage=reconcile_start
RC2_L1_STAGE resource=classes stage=reconcile_ok
RC2_L1_STAGE resource=classes stage=fetch_start
RC2_L1_PAGE resource=classes mode=full hasMore=false page=1
RC2_L1_STAGE resource=classes stage=apply_start
RC2_L1_STAGE resource=classes stage=apply_ok
RC2_L1_SYNC resource=classes outcome=ready
```

`stage` (marqueur) ∈ `meta_start` | `meta_ok` | `reconcile_start` | `reconcile_ok` | `fetch_start` | `apply_start` | `apply_ok`.  
`mode` ∈ `full` | `delta` | `full_required` | `unavailable`.  
`hasMore` ∈ `true` | `false`. `page` = entier.

Exception inattendue (try/catch **par étape**, jamais le message brut) :

```text
RC2_L1_SYNC_EXCEPTION resource=classes stage=reconcile reason=unexpected
```

`stage` (exception) ∈ `meta` | `reconcile` | `fetch` | `apply` uniquement.  
Aucun `error.message`, SQL, cursor, scopeHash, userId, schoolId, token ou contenu métier.

Un HTTP classifié (`NETWORK_UNAVAILABLE`, 5xx, `SYNC_ERROR`, …) reste `RC2_L1_SYNC outcome=error` : ce n'est pas une `SYNC_EXCEPTION`.

Chaque ressource est journalisée **dès sa fin**, pas après les cinq.

Au refus de lecture (whitelist stricte) :

```text
RC2_L1_REFUSAL resource=students reason=metadata_absent
```

`reason` ∈ `empty` | `reconciling` | `blocked_authorization` | `metadata_absent` | `partition_mismatch` | `sqlcipher_unavailable` | `partition_unresolved`.

`outcome` ∈ `ready` | `blocked_authorization` | `discarded` | `network_preserved` | `error`.  
`code` optionnel, allowlist moteur uniquement (`UNAUTHORIZED`, `PERMISSION_DENIED`, `NETWORK_UNAVAILABLE`, …). Jamais de JWT, clé SQLCipher, nom d'élève, ID utilisateur.

`RC2_OFFLINE_READ_SMOKE OK` n'est émis qu'après `RC2_OFFLINE_BOOT permissions=ready_offline` **et** les 5 ressources vues en `source=l1-cache` avec `status=success|empty`.

## Cause racine (tentative 3 — confirmée)

```text
RC2_L1_STAGE resource=classes stage=meta_start
RC2_L1_STAGE resource=classes stage=meta_ok
RC2_L1_STAGE resource=classes stage=reconcile_start
RC2_L1_SYNC_EXCEPTION resource=classes stage=reconcile reason=unexpected
```

`getMeta` sur la connexion principale keyée : OK. Premier write transactionnel (`markResourceState` reconciling) : KO.

Expo `withExclusiveTransactionAsync` crée une **nouvelle connexion** (`useNewConnection: true`) qui n'exécute pas `PRAGMA key`. SQLCipher library présente (`cipher_version=4.7.0` persist=ok) ; la connexion exclusive n'est pas déverrouillée.

## Correctif DB (cette révision)

Sans affaiblir SQLCipher, **sans fallback plaintext** :

- plus d'appel à `db.withExclusiveTransactionAsync` ni `withTransactionAsync`
- nouvelle connexion `{ useNewConnection: true }`
- **même `PRAGMA key`** immédiatement (clé en closure mémoire uniquement)
- `PRAGMA cipher_version` non vide, sinon échec fermé
- `BEGIN EXCLUSIVE TRANSACTION` / `COMMIT` / `ROLLBACK`
- `closeAsync` dans `finally`
- `writeTail`, `isCurrent()`, rollback `L1_TX_STALE` inchangés

## Scénario physique — tentative 4 (correctif DB, Internet ON)

```text
RC2 tentative 4 : HOLD
Internet : rester ON
Offline kill/relaunch : NE PAS TESTER tant que 5× outcome=ready
Ready/merge #353 : INTERDIT
```

Attendu :

```text
RC2_L1_SYNC_START resource=classes
RC2_L1_STAGE resource=classes stage=meta_ok
RC2_L1_STAGE resource=classes stage=reconcile_start
RC2_L1_STAGE resource=classes stage=reconcile_ok
RC2_L1_STAGE resource=classes stage=fetch_start
RC2_L1_PAGE resource=classes ...
RC2_L1_SYNC resource=classes outcome=ready
```

puis students / assignments / school-courses / course-schedules.

```text
adb logcat -d | findstr /I "RC2_L1_STAGE RC2_L1_SYNC_START RC2_L1_PAGE RC2_L1_SYNC RC2_L1_SYNC_EXCEPTION"
```

## Preuve Android physique — tentative 1

Online, les écrans métier ont chargé depuis le réseau :

```text
RC2_L1_READ resource=course-schedules source=network status=success rows=1/2
RC2_L1_READ resource=students source=network status=success rows=6
RC2_L1_READ resource=classes source=network status=success rows=6
RC2_L1_READ resource=assignments source=network status=success rows=9
```

Après Wi-Fi + data OFF, USB + `adb reverse tcp:8081 tcp:8081`, puis cold relaunch :

```text
L1_SQLCIPHER_SMOKE cipher_version=4.7.0 community
L1_SQLCIPHER_SMOKE persist=ok
RC2_OFFLINE_BOOT permissions=ready_offline
RC2_L1_READ resource=students source=none status=offline rows=0
RC2_L1_READ resource=classes source=none status=offline rows=0
RC2_L1_READ resource=classes source=none status=offline rows=0
```

Constats UI :
- boot hors ligne : OK ;
- SQLCipher persistant : OK ;
- présence/paiement non inventés : OK ;
- remplacements affichés non vérifiés : OK ;
- Students L1 indisponible : NO-GO ;
- CourseSchedules L1 indisponible : NO-GO ;
- aucun `RC2_OFFLINE_READ_SMOKE OK`.

Le transcript montre que le lecteur refuse le cache en offline, mais l'instrumentation de la tentative 1 ne révélait pas encore si la cause est `metadata_absent`, `reconciling`, `blocked_authorization`, `partition_mismatch` ou autre. Les marqueurs online `source=network` ne prouvent pas que `syncL1Cache` a atteint `outcome=ready`.

## Hors scope de ce correctif RC2

Warning observé : `Value being stored in SecureStore is larger than 2048 bytes`.  
Ce n'est pas la clé SQLCipher (32 octets / 64 hex) : SQLCipher continue après ce warning. **Audit séparé**, pas dans le correctif RC2 principal.

## Correctif diagnostique (révisions précédentes, conservé)

Sans changer la logique métier (boucle `full_required`/`unavailable` jusqu'à 500 pages **inchangée**) :

- try/catch **par étape** (`meta` / `reconcile` / `fetch` / `apply`)
- `RC2_L1_STAGE` + `RC2_L1_SYNC_EXCEPTION … stage=… reason=unexpected`

## Checklist de preuve

| Critère | Statut | Preuve |
| --- | --- | --- |
| HEAD exact | HOLD | pointe de #353 après ce correctif diagnostique |
| Appareil physique | OK | Xiaomi `E6QCAIAIC6LJIBXG` |
| Package / version | OK | `com.somafrik.app` 1.2.1 / versionCode 13 |
| 5 ressources L1 | OK (code) | `L1_RESOURCES` + 5 loaders `AdminDataContext` |
| Online écrans réseau | OK | transcript `source=network` |
| Online sync SQLite ready | HOLD | 5× START + STAGE + PAGE + `outcome=ready` |
| Sync L1 classes | P1 confirmée | `stage=reconcile` — connexion exclusive Expo non keyée |
| Internet coupé | OK (t1) / ne pas retester | Wi-Fi + data off, USB + `adb reverse 8081` only |
| Kill / relaunch | OK (t1) / ne pas retester | cold relaunch Android |
| `ready_offline` | OK | `RC2_OFFLINE_BOOT permissions=ready_offline` |
| SQLCipher / boot natif | OK | `cipher_version=4.7.0` persist=ok |
| Classes | NO-GO | `source=none status=offline rows=0` |
| Students | NO-GO | `source=none status=offline rows=0` |
| Assignments teacher scope | HOLD | test device après cache ready |
| SchoolCourses | HOLD | test device après cache ready |
| CourseSchedules | NO-GO UI | planning indisponible offline |
| Mutations bloquées | OK observé/code | mode hors ligne actif |
| Aucune donnée L2 inventée | OK observé | `Indisponible` / `—` |
| Aucune fuite cross-tenant | OK tests / HOLD device | à revalider après cache ready |

## NO-GO immédiat

RC2 échoue si :

- écran vide alors que cache `ready` ;
- un écran ouvre SQLite directement ;
- cache d'un autre user/school visible ;
- mutation réseau possible offline ;
- `teacherCode` / `teacherId` contourne `teacherUserId` ;
- présence / paiement / note devient artificiellement `0` ;
- l'app ne redémarre pas après kill sans Internet ;
- une ressource `reconciling`, `blocked_authorization` ou sans metadata est quand même affichée.

## Tests automatisés (CI — pas un GO terrain)

```text
npm --prefix Mobile run test:l1-offline-reads
npm --prefix Mobile run verify:mobile-l1-sqlite-cache
npm --prefix Mobile run verify:mobile-rc2-offline-read-smoke
```

Le vérificateur RC2 sort `BLOCKED_NATIVE_RC2_OFFLINE_READ_SMOKE` (exit 0) sans appareil physique. **Ce n'est pas un GO.**

## Verdict

```text
#353 : DRAFT
RC2 OFFLINE READ SMOKE: HOLD
RC2 : HOLD
Cause racine : connexion exclusive Expo non keyée SQLCipher
P1 : CONFIRMÉE
Correctif métier DB requis (cette révision)
SQLCipher : OK (connexion principale)
boot natif : OK
Internet : rester ON
offline relaunch : ne pas retester
Ready : NON
Merge : NON
```

Pas de Ready, pas de merge. Internet ON. Retester online jusqu'aux cinq `outcome=ready` avant toute coupure réseau.
