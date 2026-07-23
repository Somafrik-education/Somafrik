# Rapport D2.8a — Extraction des colonnes EntityPage

**Type :** Infrastructure UI D2.8a  
**Module :** EntityPage (transversal)  
**Sous-périmètre :** Colonnes et rendu des cellules  
**Impact runtime :** Structurel uniquement — comportement / visuel inchangés  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire la construction des colonnes hors du monolithe `EntityPage`, sans toucher aux wrappers D3 ni aux handlers/modales.

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/entityColumns.tsx` | `buildEntityColumns` + helpers/libellés |
| `web/src/pages/entity-page/entityColumns.test.tsx` | Tests ciblés colonnes |
| `EntityPage.tsx` | Appelle `buildEntityColumns` avec deps injectées |

**API :**

```ts
buildEntityColumns(ctx: BuildEntityColumnsContext): Column<EntityRow>[]
```

Deps injectées : module, mode parent-enfant, permissions d’actions, rows de lookup (users/students/assignments), callbacks `onEdit` / `onDelete` / `onAssignTeacher` / payments.

Aucun contexte React dans le module extrait.  
`EntityListTable` et son contrat : **inchangés**.  
Wrappers D3 : **inchangés**.

---

## 3. Non inclus (lots suivants)

- Options de formulaire (D2.8b)
- Handlers CRUD (D2.8c)
- Modales (D2.8d)
- Nouveau composant Design System

---

## 4. Tests

| Suite | Résultat |
|-------|----------|
| `entityColumns.test.tsx` | Classes, Enseignants, Dossier Élèves, parent-enfant, permissions |
| 4 listes D3 (25 tests) | Régression |
| Suite DS | Verte |
| `tsc` / lint | OK |

---

## 5. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement visuel | Aucun intentionnel |
| CRUD / API / permissions | Inchangés |
| Wrappers D3 touchés | Non |
| Nouveau composant DS | Non |
| Second monolithe évité | Oui — un fichier colonnes + callbacks |
| Difficulté | **Moyenne** |
| Suite | D2.8b — options de formulaire |

---

## 6. Inventaire

Voir [AUDIT-D2.8-entitypage-remainder.md](./AUDIT-D2.8-entitypage-remainder.md).
