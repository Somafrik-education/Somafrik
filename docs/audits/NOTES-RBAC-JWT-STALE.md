# Audit frère — POST /api/notes JWT stale (historique)

**Statut :** CORRIGÉ dans `cursor/notes-evaluations-rbac-live-92b2`.  
Livrable : `docs/audits/NOTES-EVALUATIONS-RBAC-LIVE-P0.md`.

## Diagnostic d’origine (avant overlay live)

`POST /api/notes` :

```
requireAuth
→ requireSchoolSubscriptionFeature("write_notes")
→ assertCanManageNotes(req.principal)
```

`assertCanManageNotes` lisait le JWT (`Modifier notes`, `Notes:CREATE/UPDATE`, `Notes:CRUD`, `Evaluations:CRUD`, privilèges plateforme).  
403 sans `code`. `GET /api/notes` était auth-only.

`requirePermission` overlaye PG ; `requireAuth` ne le fait pas — même trou que POST présences avant #228.

## Correctif (cette PR P0)

- POST `/api/notes` / POST `/api/evaluations` → `Notes:CREATE` OR `Notes:UPDATE` via `requirePermission`
- PATCH `/api/evaluations/:id` → `Notes:UPDATE`
- GET notes (liste + fiche) → `Notes:READ` après audit Parent/Élève
- `assertCanManageNotes` supprimée
- 403 RBAC : `PERMISSION_DENIED`
