# RC2 Offline Read Smoke — 2026-08-27

**Type :** validation RC2 lectures L1 hors ligne (Android physique)  
**PR :** [#353](https://github.com/Somafrik-education/Somafrik/pull/353) Draft dédiée — **aucun Ready / aucun merge sur CI seule**  
**Outbox / écriture offline / RC3 :** hors scope

## Identité

```text
Base develop exact : 874f9415cda8c1e3df1339001b8f0f437149f38d
                     (merge #352 Native SQLCipher APK smoke)
HEAD PR            : (pointe de #353 — correctif diagnostique SYNC/REFUSAL)
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
RC2_L1_SYNC resource=classes outcome=ready
RC2_L1_SYNC resource=students outcome=ready
RC2_L1_SYNC resource=assignments outcome=ready
RC2_L1_SYNC resource=school-courses outcome=ready
RC2_L1_SYNC resource=course-schedules outcome=ready
RC2_L1_READ resource=classes source=l1-cache status=success rows=4
RC2_L1_READ resource=students source=l1-cache status=success rows=87
RC2_L1_READ resource=assignments source=l1-cache status=success rows=12
RC2_L1_READ resource=school-courses source=l1-cache status=success rows=18
RC2_L1_READ resource=course-schedules source=l1-cache status=success rows=24
RC2_OFFLINE_BOOT permissions=ready_offline
RC2_OFFLINE_READ_SMOKE OK
```

Au refus de lecture (whitelist stricte) :

```text
RC2_L1_REFUSAL resource=students reason=metadata_absent
```

`reason` ∈ `empty` | `reconciling` | `blocked_authorization` | `metadata_absent` | `partition_mismatch` | `sqlcipher_unavailable` | `partition_unresolved`.

`outcome` ∈ `ready` | `blocked_authorization` | `discarded` | `network_preserved` | `error`.  
`code` optionnel, allowlist moteur uniquement (`UNAUTHORIZED`, `PERMISSION_DENIED`, `NETWORK_UNAVAILABLE`, …). Jamais de JWT, clé SQLCipher, email, téléphone, nom d'élève, ID utilisateur.

`RC2_OFFLINE_READ_SMOKE OK` n'est émis qu'après `RC2_OFFLINE_BOOT permissions=ready_offline` **et** les 5 ressources vues en `source=l1-cache` avec `status=success|empty`.

## Scénario physique — tentative 2 (après ce correctif)

**Ne pas couper Internet** tant que logcat n'a pas les cinq :

```text
RC2_L1_SYNC resource=classes outcome=ready
RC2_L1_SYNC resource=students outcome=ready
RC2_L1_SYNC resource=assignments outcome=ready
RC2_L1_SYNC resource=school-courses outcome=ready
RC2_L1_SYNC resource=course-schedules outcome=ready
```

Si l'un donne `error` ou `blocked_authorization`, corriger cette cause avant de refaire RC2.

Ensuite seulement : Wi-Fi + data OFF, USB + `adb reverse 8081`, kill/relaunch, `ready_offline`, 5× `RC2_L1_READ source=l1-cache`.

Capturer :

```text
adb logcat -d | grep -E "RC2_L1_SYNC|RC2_L1_REFUSAL|RC2_L1_READ|RC2_OFFLINE_BOOT|RC2_OFFLINE_READ_SMOKE"
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

## Correctif diagnostique (cette révision)

Sans changer la logique métier :

- `L1CacheRuntime` consomme le tableau `L1SyncResult[]` et émet `RC2_L1_SYNC resource=… outcome=…` (code allowlisté optionnel).
- `readL1Resource` émet `RC2_L1_REFUSAL resource=… reason=…` sur chaque refus whitelisté.

Tentative 2 : attendre les cinq `outcome=ready` **avant** toute coupure réseau. Si `error` ou `blocked_authorization`, corriger la cause d'abord.

## Checklist de preuve

| Critère | Statut | Preuve |
| --- | --- | --- |
| HEAD exact | HOLD | pointe de #353 après ce correctif diagnostique |
| Appareil physique | OK | Xiaomi `E6QCAIAIC6LJIBXG` |
| Package / version | OK | `com.somafrik.app` 1.2.1 / versionCode 13 |
| 5 ressources L1 | OK (code) | `L1_RESOURCES` + 5 loaders `AdminDataContext` |
| Online écrans réseau | OK | transcript `source=network` |
| Online sync SQLite ready | HOLD | attendre 5× `RC2_L1_SYNC outcome=ready` |
| Internet coupé | OK | Wi-Fi + data off, USB + `adb reverse 8081` only |
| Kill / relaunch | OK | cold relaunch Android |
| `ready_offline` | OK | `RC2_OFFLINE_BOOT permissions=ready_offline` |
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
RC2 OFFLINE READ SMOKE: HOLD / NO-GO PHYSIQUE
```

Pas de Ready, pas de merge. Prochaine tentative seulement après cinq `RC2_L1_SYNC outcome=ready` online, puis kill/relaunch hors ligne.

Prochain chantier **après GO RC2** : SQLite Outbox + exactly-once replay / **RC3 Offline Write**.
