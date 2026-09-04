# P0-2 — Deny plateforme vs données personnelles établissement

**Statut :** correctif serveur + tests ; application préprod sous GO CTO  
**Date :** 2026-09-04  
**Issue :** #503

## Invariant

Super Administrateur Somafrik et Admin Pays **ne peuvent pas** lire ni modifier les données personnelles métier d’un établissement, même avec `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES`, même avec un `schoolCode` valide, même si l’établissement est dans leur pays.

## Contrôle (autorité)

Deux contrôles, dans cet ordre :

1. **`requireAuth`** refuse **avant** `applyEffectiveSchoolScope` (header `X-Somafrik-School-Code`) si le principal est plateforme et que le chemin HTTP matche `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`. Un `schoolCode` invalide ou valide ne peut pas masquer le deny derrière un 400 de scope.
2. **`RbacService.canAccess`** refuse **avant** `requiredPermissions.some(...)` si le principal est `SUPER_ADMIN` / `COUNTRY_ADMIN` (label ou `roleKeys`) et que la route catalogue est interdite.

Source : `backend/lib/platformPersonalDataGuard.js`

`GET /api/data-export` : 403 pour ces rôles (auth HTTP + `canAccess` + `assertDataExportRead`).

Le nettoyage de `role_permissions` / `securityMatrix` / SQL `20260904_p0_platform_personal_data_deny.sql` est une **défense en profondeur**. Il ne constitue pas à lui seul la sécurité.

## Conservé (fonctions plateforme)

Pays, métadonnées établissement, comptes admin établissement (`/api/backoffice/users` hors create-teacher), abonnements, référentiels, RBAC catalogue, annonces **plateforme**, paramètres globaux / structure (classes, matières, planning, grilles de frais), `POST /api/mobile/push-devices/test` (diagnostic push, pas une fiche élève).

Contrats historiques **200/400 Superadmin** sur `GET /api/students`, messages école, notifications internes et paiements élève étaient incompatibles avec l’invariant #503. Les gates Enrollment / Communications / Finance attendent désormais **403**.

## Tests

```bash
npm run verify:platform-personal-data-deny
```

Couvre SUPER_ADMIN et COUNTRY_ADMIN, avec et sans `schoolCode` / header, et le positif Admin School / Enseignant (non 403).
