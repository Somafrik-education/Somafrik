# RC2 Offline Read Smoke — 2026-08-27

**Type :** validation RC2 lectures L1 hors ligne (Android physique)  
**PR :** Draft dédiée — **aucun Ready / aucun merge sur CI seule**  
**Outbox / écriture offline / RC3 :** hors scope

## Identité

```text
Base develop exact : 874f9415cda8c1e3df1339001b8f0f437149f38d
                     (merge #352 Native SQLCipher APK smoke)
HEAD PR            : (commit de cette branche — renseigné après push)
Appareil physique  : HOLD — transcript Android requis
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
RC2_L1_READ resource=classes source=l1-cache status=success rows=4
RC2_L1_READ resource=students source=l1-cache status=success rows=87
RC2_L1_READ resource=assignments source=l1-cache status=success rows=12
RC2_L1_READ resource=school-courses source=l1-cache status=success rows=18
RC2_L1_READ resource=course-schedules source=l1-cache status=success rows=24
RC2_OFFLINE_BOOT permissions=ready_offline
RC2_OFFLINE_READ_SMOKE OK
```

Interdit dans ces lignes : JWT, clé SQLCipher, email, téléphone, nom d'élève, ID utilisateur.

`RC2_OFFLINE_READ_SMOKE OK` n'est émis qu'après `RC2_OFFLINE_BOOT permissions=ready_offline` **et** les 5 ressources vues en `source=l1-cache` avec `status=success|empty`.

## Scénario physique obligatoire

1. **Online** — compte établissement autorisé ; charger Classes, Élèves, Affectations, Structure pédagogique/Cours, Planning ; attendre sync L1 ; relever quelques identités métier (code classe, matricule, cours, créneau) **hors logs RC2**.
2. **Offline réel** — couper Wi-Fi + données mobiles ; conserver USB + `adb reverse 8081` pour Metro uniquement ; aucune API Somafrik accessible.
3. **Kill / relaunch**

   ```text
   adb shell am force-stop com.somafrik.app
   adb shell am start -W -n com.somafrik.app/.MainActivity
   ```

4. **Bootstrap offline** — session restaurée ; `permissionsBootstrap = ready_offline` ; aucun GET métier obligatoire avant L1.
5. **Classes** — `source=l1-cache` ; bannière hors ligne ; recherche locale ; navigation élèves ; CREATE/UPDATE/DELETE bloqués.
6. **Élèves** — liste L1 ; matricule / nom / classe corrects ; recherche locale ; fiche élève ; L2 présence/paiement en échec **ne détruit pas** Students L1 et **n'invente pas** `0` (`Indisponible`).
7. **SchoolCourses** — cours synchronisés visibles ; cohérence classe/cours/discipline ; pas de mutation offline.
8. **CourseSchedules** — planning SQLite ; jours/horaires/classes/cours ; création/édition/suppression/remplacement bloqués ; remplacements non L1 = **non vérifiés**, jamais absence confirmée.
9. **Enseignant (sécurité)** — seulement `teacherUserId === session.user.id` ; absent / null / mismatch ⇒ zéro affectation ; **aucun** fallback `teacherCode` / `teacherId`.

Capturer :

```text
adb logcat -d | grep -E "RC2_L1_READ|RC2_OFFLINE_BOOT|RC2_OFFLINE_READ_SMOKE"
```

## Checklist de preuve

| Critère | Statut | Preuve |
| --- | --- | --- |
| HEAD exact | HOLD | SHA PR + base `874f9415` |
| Appareil physique | HOLD | modèle / Android à coller |
| Package / version | OK (repo) | `com.somafrik.app` 1.2.1 / versionCode 13 |
| 5 ressources L1 | OK (code) | `L1_RESOURCES` + 5 loaders `AdminDataContext` |
| Online sync | HOLD | transcript |
| Internet coupé | HOLD | Wi-Fi + data off, USB + `adb reverse 8081` only |
| Kill / relaunch | HOLD | `am force-stop` + `am start -W` |
| `ready_offline` | HOLD | `RC2_OFFLINE_BOOT permissions=ready_offline` |
| Classes | HOLD | `RC2_L1_READ resource=classes source=l1-cache` + bannière + recherche |
| Students | HOLD | L1 lisible ; L2 présence/paiement ≠ faux `0` |
| Assignments teacher scope | HOLD | session enseignant, `teacherUserId` only |
| SchoolCourses | HOLD | `RC2_L1_READ resource=school-courses source=l1-cache` |
| CourseSchedules | HOLD | planning L1 ; remplacements `unverified` |
| Mutations bloquées | OK (code) / HOLD (device) | `shouldBlockUnsupportedMutations` + `networkRequired` |
| Aucune donnée L2 inventée | OK (code) / HOLD (device) | `metricLabelFromSnapshot` → `Indisponible` si error/offline vide |
| Aucune fuite cross-tenant | OK (tests) / HOLD (device) | partition `userId+schoolId` ; `ready` only |

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

## Transcript Android physique

```text
(à coller — logcat RC2_* uniquement, zéro PII)

RC2_OFFLINE_BOOT permissions=ready_offline
RC2_L1_READ resource=classes source=l1-cache status=… rows=…
RC2_L1_READ resource=students source=l1-cache status=… rows=…
RC2_L1_READ resource=assignments source=l1-cache status=… rows=…
RC2_L1_READ resource=school-courses source=l1-cache status=… rows=…
RC2_L1_READ resource=course-schedules source=l1-cache status=… rows=…
RC2_OFFLINE_READ_SMOKE OK
```

## Verdict

```text
RC2 OFFLINE READ SMOKE: HOLD
```

Pas de Ready, pas de merge, tant que le transcript Android physique ci-dessus n'est pas collé sur cette PR Draft.

Prochain chantier **après GO RC2** : SQLite Outbox + exactly-once replay / **RC3 Offline Write**.
