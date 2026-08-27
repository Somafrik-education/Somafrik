# Finance F3 — Correctif concurrence apply grille ↔ transfert

Date : 2026-08-27

## Constat

Le transfert de classe était sérialisé par `SELECT ... FOR UPDATE`, mais `applyFeeGrid` pouvait encore avoir lu une inscription 6A avant un transfert 6A→6B, puis reprendre après le commit du transfert avec ce snapshot applicatif devenu obsolète.

Le cas dangereux concernait surtout un type de frais présent seulement dans l'ancienne classe : l'obligation 6A future pouvait être archivée par le transfert puis recréée par l'ancien apply, car l'index UNIQUE F3 ne protège que les obligations actives.

## Correctif retenu

La sérialisation est renforcée au dernier point d'autorité PostgreSQL : toute nouvelle obligation active `class_id != NULL` verrouille l'inscription active correspondante par `FOR UPDATE OF e` avant l'INSERT.

La garde est implémentée par :

- fonction `student_fee_obligations_assert_active_enrollment_scope()` ;
- trigger `trg_student_fee_obligations_active_enrollment_scope` ;
- même définition dans la migration F3 et dans `FINANCE_SCHEMA_SQL`.

Si l'inscription n'existe plus dans l'année demandée ou si sa classe courante ne correspond plus à `NEW.class_id`, l'écriture devient un skip idempotent via SQLSTATE `23505`, déjà géré par `insertObligationIfAbsent`. Aucune dette stale n'est créée.

L'archivage historique reste autorisé : la garde retourne immédiatement quand `archived_at` est non NULL. Les obligations explicitement school-wide (`class_id IS NULL`) restent hors de cette garde class-scoped.

## Test PostgreSQL déterministe

`backend/lib/financeObligationApplyTransferRace.pg.test.js` force l'interleaving suivant :

1. l'apply 6A lit l'inscription 6A puis est suspendu ;
2. le transfert daté 6A→6B commit ;
3. l'apply 6A reprend avec son snapshot JS stale ;
4. la garde DB revalide l'inscription sous lock et empêche toute recréation future 6A.

Le scénario contient :

- Scolarité septembre/octobre en 6A ;
- Transport futur uniquement en 6A ;
- Scolarité septembre/octobre en 6B.

Assertions finales : enrollment 6B, aucune obligation future 6A active, aucun Transport 6A recréé, aucune double dette active, historique `CLASS_TRANSFER` conservé.

## Gate

`verify:finance-obligation-lifecycle` vérifie désormais statiquement la présence du trigger, du `FOR UPDATE OF e`, du fail-closed de classe et exécute le nouveau test PostgreSQL de course apply↔transfert.

## Scope

Aucun changement F4/F5/F6/F7. Aucun Ready. Aucun merge dans ce correctif.
