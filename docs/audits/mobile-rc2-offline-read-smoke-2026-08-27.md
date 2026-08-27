# RC2 Offline Read Smoke — 2026-08-27

**Type :** validation RC2 lectures L1 hors ligne sur Android physique  
**PR :** #353  
**Base exacte :** `develop@874f9415cda8c1e3df1339001b8f0f437149f38d`  
**Outbox / écriture offline / RC3 :** hors scope

## Appareil et build

```text
Appareil physique : Xiaomi E6QCAIAIC6LJIBXG
Package           : com.somafrik.app
Version           : 1.2.1 (versionCode 13)
SQLCipher         : 4.7.0 community
```

## Ressources L1 couvertes

```text
Classes
Students
Assignments
SchoolCourses
CourseSchedules
```

PostgreSQL reste l'autorité. SQLite/SQLCipher n'est qu'une projection locale jetable, partitionnée par `userId + schoolId` et lisible uniquement lorsque la metadata de ressource est `ready`.

## Incident rencontré et correction

La première tentative RC2 échouait au premier write transactionnel : Expo `withExclusiveTransactionAsync` ouvrait une nouvelle connexion native non keyée SQLCipher.

Le correctif conserve le fail-closed :

- nouvelle connexion `{ useNewConnection: true }` ;
- application immédiate du même `PRAGMA key` ;
- `PRAGMA cipher_version` obligatoire et non vide ;
- `BEGIN EXCLUSIVE TRANSACTION` / `COMMIT` / `ROLLBACK` ;
- fermeture en `finally` ;
- aucun fallback plaintext ;
- aucune clé ou donnée sensible journalisée.

Un blocage indépendant côté préproduction Render a ensuite été identifié : les routes L1 retournaient 404 parce que les déploiements backend échouaient sur `CANONICAL_SCHOOL_COURSE_AMBIGUOUS`.

L'inventaire PostgreSQL a isolé un unique `school_course` actif pour `2ème A / Technologie`, avec `teacher_id = NULL`, alors qu'une unique `teacher_assignment` active pointait vers l'enseignant actif `CD-2026-0001-ENS-0007`. La réparation préprod a renseigné uniquement ce `teacher_id`, sous transaction et garde-fous, sans suppression ni recréation.

Après redéploiement de `develop`, les cinq routes L1 ont répondu `401` sans authentification au lieu de `404`, prouvant leur présence côté API.

## Preuve physique — synchronisation Internet ON

Les cinq ressources ont atteint une page valide puis `outcome=ready` :

```text
RC2_L1_SYNC resource=classes outcome=ready
RC2_L1_SYNC resource=students outcome=ready
RC2_L1_SYNC resource=assignments outcome=ready
RC2_L1_SYNC resource=school-courses outcome=ready
RC2_L1_SYNC resource=course-schedules outcome=ready
```

Les traces montrent pour chaque ressource la séquence :

```text
meta_start -> meta_ok
reconcile_start -> reconcile_ok
fetch_start
RC2_L1_PAGE ... mode=full hasMore=false page=1
apply_start -> apply_ok
meta_start -> meta_ok
outcome=ready
```

La réussite des cinq `reconcile_ok` valide également physiquement la correction des connexions transactionnelles SQLCipher keyées.

## Preuve physique — cold boot Internet OFF

Wi-Fi et données mobiles ont été coupés, puis l'application a subi `force-stop` + cold launch.

Boot autorisé depuis le snapshot local :

```text
RC2_OFFLINE_BOOT permissions=ready_offline
```

Les cinq ressources ont ensuite été réellement relues depuis la projection L1 locale :

```text
RC2_L1_READ resource=classes source=l1-cache status=success rows=3
RC2_L1_READ resource=students source=l1-cache status=success rows=6
RC2_L1_READ resource=assignments source=l1-cache status=success rows=9
RC2_L1_READ resource=school-courses source=l1-cache status=success rows=18
RC2_L1_READ resource=course-schedules source=l1-cache status=success rows=2
RC2_OFFLINE_READ_SMOKE OK
```

Le marqueur `RC2_OFFLINE_READ_SMOKE OK` n'est émis qu'après `ready_offline` et après observation des cinq ressources avec `source=l1-cache` et `status=success|empty`.

## Validation UI physique

Les écrans Classes / Élèves et Emploi du temps restent consultables hors ligne. L'emploi du temps affiche la dernière synchronisation et marque les remplacements comme non vérifiés lorsque la vérification réseau n'est pas possible.

Les métriques L2 non couvertes par RC2, notamment présence et paiements, restent `Indisponible` au lieu d'être inventées.

Le bouton `Inscrire un élève` a été testé physiquement hors ligne : l'application affiche `Cette action nécessite une connexion.` et n'ouvre pas le formulaire. Aucune écriture offline implicite n'est donc introduite par RC2.

## Sécurité / invariants

```text
PostgreSQL autoritaire                : OK
SQLCipher requis / aucun plaintext    : OK
Partition userId + schoolId           : OK
Cold boot sans Internet               : OK
Permissions ready_offline             : OK
5 ressources L1 depuis SQLite         : OK
Aucune donnée L2 inventée             : OK
Mutations offline bloquées            : OK
teacherUserId fail-closed L1          : OK
Aucune fuite de secret dans logs RC2  : OK
Outbox / replay                       : hors scope RC3
```

## Tests automatisés

```text
npm --prefix Mobile run test:l1-offline-reads
npm --prefix Mobile run verify:mobile-l1-sqlite-cache
npm --prefix Mobile run verify:mobile-rc2-offline-read-smoke
```

Le vérificateur CI ne remplace pas le test terrain ; le GO ci-dessous repose sur le smoke Android physique décrit ci-dessus.

## Verdict final

```text
#353 : GO RC2 PHYSIQUE
RC2 OFFLINE READ SMOKE : GO
SQLCipher main             : OK
SQLCipher transactions     : OK
API L1 préprod             : OK
Online sync L1 5/5         : OK
Cold boot offline          : OK
Offline reads L1 5/5       : OK
RC2_OFFLINE_READ_SMOKE OK  : OBSERVÉ
Mutations offline          : BLOQUÉES comme prévu
P0 produit                 : 0 observé
P1 produit RC2             : 0 restant
Ready                      : AUTORISABLE après diff/CI indépendants
Merge                      : AUTORISABLE après diff/CI indépendants
```
