# Contrat HOTFIX-RBAC-ADMIN-01 — Classes / enseignants sans auditLog client

**Lot :** HOTFIX-RBAC-ADMIN-01  
**Priorité :** hotfix bloquant avant reprise roadmap  
**Cause :** `PUT /backoffice/state` avec `{ classes, auditLog }` → 403 `Permission insuffisante…`

---

## 1. Objectif

Débloquer la création / modification de **classes** et **enseignants** pour l’Admin établissement, sans élargir les droits d’écriture sur `auditLog`.

---

## 2. Règles

### Client

Payload attendu pour une classe :

```json
{ "classes": [ /* … */ ] }
```

Interdit :

```json
{ "classes": [ /* … */ ], "auditLog": [ /* … */ ] }
```

Même règle pour les enseignants (`teachers`, éventuellement `users` / `contacts` / `assignments`) : **aucun `auditLog` client**.

### Serveur

- `auditLog` reste **non writable** client (403 si présent) — inchangé S1.4
- L’audit métier classes / enseignants / affectations est produit via `auditService.record` (principal authentifié, `schoolCode` session)
- Impossible à falsifier depuis le navigateur

---

## 3. Tests d’acceptation

| Cas | Attendu |
|-----|---------|
| Admin établissement + sa propre école + `classes` | 200 |
| Admin établissement + sa propre école + `teachers` | 200 |
| Admin établissement + `auditLog` client | 403 explicite |
| Admin établissement + autre école | ligne hors scope non persistée / non visible |
| Enseignant + `classes` / `teachers` | 403 |
| Superadmin + `classes` | 200 |

Commande :

```bash
npm run verify:rbac-admin-01
```

---

## 4. Hors périmètre

- Refonte complète de tous les workflows Finance / Contacts encore porteurs d’`auditLog` (filet DataContext déjà en place)
- Roadmap D3.x
