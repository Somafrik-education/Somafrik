# Audit frère — POST /api/notes JWT stale (hors correctif Présences)

**PR Présences live :** `cursor/prefet-presences-rbac-live-92b2`  
**Statut :** AUDIT UNIQUEMENT. Le correctif Présences n’élargit pas Notes.

## Constat

`POST /api/notes` (`backend/server.js`) :

```
requireAuth
→ requireSchoolSubscriptionFeature("write_notes")
→ assertCanManageNotes(req.principal)
```

Pas de `requirePermission`. `assertCanManageNotes` lit `principal.permissions` (claims JWT).

`requirePermission` overlaye `repository.resolveEffectivePermissions` ; `requireAuth` ne le fait pas.

C’est le **même trou** que POST présences avant ce correctif.

## Gate actuel

Accepte : `ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES`, `Modifier notes`, `Notes:CREATE`, `Notes:UPDATE`, `Notes:CRUD`, `Evaluations:CRUD`.

403 : `{ message: "Permission insuffisante pour modifier les notes." }` — pas de `code`.

`GET /api/notes` : `requireAuth` seulement (Parent/Élève lisent via filtre lié).

## Pourquoi pas dans le correctif Présences

Le mapping canonique Notes n’est pas audité ici (CREATE vs UPDATE vs « Modifier notes », parcours Parent/Élève GET). Overlay générique dans `requireAuth` corrigerait Notes **et** toutes les routes hors `requirePermission`, mais changerait le comportement global.

Correctif Notes recommandé (PR dédiée) :

- `POST /api/notes` → `Notes:CREATE` **ou** `Notes:UPDATE` + `requirePermission`
- GET : vérifier Parent/Élève `Notes:READ` avant durcissement
- `PERMISSION_DENIED`
- tests grant/revoke live même JWT

**Verdict Notes :** NO-GO dans cette PR. Incident frère confirmé, à traiter après revalidation Présences.
