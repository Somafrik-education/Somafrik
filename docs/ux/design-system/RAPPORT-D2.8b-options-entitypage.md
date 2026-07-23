# Rapport D2.8b — Extraction des options de formulaire EntityPage

**Type :** Infrastructure UI D2.8b  
**Module :** EntityPage (transversal)  
**Sous-périmètre :** Résolution des options de champs select  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire `getSelectOptionsForField` / `getTeacherAssignmentFieldOptions` hors du monolithe, avec dépendances explicites, **sans** extraire le rendu des formulaires ni les handlers CRUD.

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/entitySelectOptions.ts` | `resolveEntitySelectOptions` · `resolveTeacherAssignmentFieldOptions` |
| `entitySelectOptions.test.ts` | Tests ciblés (levels, classNames Classes, CLASSE-003, selectOptions, affectation) |
| `EntityPage.tsx` | Thin wrappers locaux qui injectent le contexte |

**Aucun** hook / contexte React dans le module.  
**Aucun** changement wrappers D3, colonnes (D2.8a), modales UI, handlers.

---

## 3. Règles métier préservées

- CLASSE-003 (archivée hors nouvelles inscriptions, conservée si valeur courante)
- Disponibilité des noms de classe (module Classes)
- Subjects scopés par classe (courses / assignments)
- Options contacts / relations / périodes / teachers

---

## 4. Tests

| Suite | Résultat |
|-------|----------|
| `entitySelectOptions.test.ts` | 6 scénarios |
| Colonnes D2.8a + 4 listes D3 | Régression |
| `tsc` / lint / DS | OK |

---

## 5. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Fonction sans hooks/contextes | Oui |
| Deps explicites | Oui |
| Extraction formulaire / CRUD | Non (hors lot) |
| Wrappers D3 | Inchangés |
| Difficulté | **Faible à moyenne** |
| Suite | D2.8c — handlers CRUD génériques |
