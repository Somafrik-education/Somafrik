# P0 — Planning de cours : réconciliation RBAC live Préfet / Enseignant

**Base :** `develop@36b9e2d40ad3bb37b8d2e502e5797af961430b6e`  
**Gouvernance :** PR **DRAFT** — aucun Ready — aucun merge — revalidation CTO GitHub indépendante.  
**Hors lot :** UI Planning (`CoursePlanningPage`, calendrier, flag Web). Elle est déjà correcte.

## Symptôme préprod

Admin School voit le menu Planning. Préfet des études et Enseignant ne le voient pas, alors que le code déclare déjà :

| Rôle | Grants canoniques |
| --- | --- |
| Admin School | `Planning de cours:READ CREATE UPDATE DELETE` |
| Préfet des études | `Planning de cours:READ CREATE UPDATE DELETE` |
| Enseignant | `Planning de cours:READ` |
| Parent / Secrétaire | aucun élargissement |

Le flag Web est déployé (sinon Admin School ne verrait pas le menu). Après reconnexion, si le menu reste absent, ce n’est pas un JWT périmé : les **grants PostgreSQL** n’ont pas été réconciliés.

## Cause

Après le premier bootstrap, l’autorité est `role_module_permissions`, pas la carte JS runtime.

1. `backfillGlobalGrantsFromLegacyMaps` ne s’exécute que si `countActiveGrants() === 0`.
2. `backfillMissingGlobalModuleGrants` n’insère un module **absent** que si le catalogue établissement (souvent périmé) contient encore le jeton.
3. Si Préfet / Enseignant ont déjà d’autres grants (`students`, `grades`, …) mais **pas** `planning`, le fallback synthétique ne s’applique pas (`missingRoleKeys` vide).
4. Admin School continue de marcher : rôle plateforme protégé, union matrice.

Un rôle **déjà présent** avant l’ajout de `Planning de cours:*` ne recevait donc jamais le grant au redéploiement.

## Correctif

`reconcileCanonicalPlanningGrants` (idempotent) :

- UNION des flags canoniques sur le grant global `planning` existant, ou insert s’il manque.
- Cible uniquement `SCHOOL_ADMIN`, `PREFET_ETUDES`, `TEACHER`.
- N’insère jamais Parent / Secrétaire / Élève.
- Appelé à la fin de `ensureFunctionalRbacBootstrap`.

Un grant Planning tout-faux (DENY héritée d’un bootstrap incomplet) est UNION’d vers le canonique : on ne peut pas distinguer un DENY opérateur d’un bootstrap incomplet sur ce module, et le contrat produit est CRUD Préfet / READ Enseignant.

## Tests

```bash
npm run verify:planning-rbac-reconcile
```

- Mémoire : rôle déjà peuplé, catalogue périmé, second bootstrap no-op.
- PostgreSQL isolé : rôles Prefet/Teacher **pré-existants** sans grant `planning`.
- HTTP PG : simule grants périmés, redémarre le backend (bootstrap), vérifie :
  - login Préfet → JWT `Planning de cours:READ/CREATE/UPDATE/DELETE` → GET 200
  - login Enseignant → JWT `Planning de cours:READ` → GET 200, POST/PATCH/DELETE 403
  - Parent / Secrétaire inchangés
- Vitest existant `permissions.planningUi.test.ts` : menu `/planning` visible dès que le JWT a `READ` (aucune modification UI).
