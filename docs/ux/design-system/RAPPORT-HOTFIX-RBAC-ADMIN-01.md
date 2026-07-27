# Rapport HOTFIX-RBAC-ADMIN-01 — Classes / enseignants sans auditLog client

**Type :** Hotfix RBAC Admin établissement  
**Contrat :** [CONTRAT-HOTFIX-RBAC-ADMIN-01.md](./CONTRAT-HOTFIX-RBAC-ADMIN-01.md)

---

## 1. Constat

Création de classe (ex. « 2ème A ») rejetée en **403** :

`Permission insuffisante pour modifier ces données.`

Payload observé : `{ classes, auditLog }`. L’Admin School peut écrire `classes`, mais `auditLog` est interdit côté client (S1.4). Même défaut que Notes (SYNC-03) : l’UI construisait un journal client falsifiable.

La classe restait visible localement (merge optimiste) sans confirmation serveur.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `web/src/lib/stripClientAuditLog.ts` | Filet : retire `auditLog` du PUT |
| `web/src/context/DataContext.tsx` | Applique le strip avant `api.put` |
| `web/src/pages/EntityPage.tsx` | Suppression classe sans `auditLog` |
| `web/src/pages/entity-page/entityCrudCore.ts` | `classes` / `teachers` / `assignments` hors audit client |
| `web/src/pages/entity-page/teacherAssignmentWorkflow.ts` | Patchs sans `auditLog` |
| `backend/server.js` | Audit serveur `classes` / `teachers` / `assignments` |
| `backend/scripts/verify-rbac-admin-01.js` | Matrice + HTTP d’acceptation |

---

## 3. Tableau CTO

| Critère | Résultat |
|---------|----------|
| Admin + classes → 200 | Oui (sans auditLog) |
| Admin + teachers → 200 | Oui |
| Admin + auditLog client → 403 | Oui (refus explicite conservé) |
| Enseignant + classes/teachers → 403 | Oui |
| Superadmin autorisé | Oui |
| Audit serveur non falsifiable | Oui (`auditService.record`) |
