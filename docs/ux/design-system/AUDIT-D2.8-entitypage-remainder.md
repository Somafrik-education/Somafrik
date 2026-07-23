# Audit — D2.8 reste EntityPage (post listes D3)

**Date :** 2026-07-23  
**Contexte :** listes D3 stabilisées (Classes, Enseignants, Élèves, Membres classe)  
**Fichier :** `web/src/pages/EntityPage.tsx` (~2500+ LOC après D2.7 chrome)

---

## 1. Inventaire des responsabilités restantes

| Zone | Contenu | Lot cible |
|------|---------|-----------|
| Construction colonnes + cellules + actions ligne | Headers, rendus spécialisés, liens | **D2.8a** |
| Résolution options de champs | `getSelectOptionsForField`, teacher assignment options | **D2.8b** ✅ |
| Handlers CRUD génériques (noyau) | id, merge/delete, persist+busy, audit commun | **D2.8c** |
| Modales & workflows spécialisés | form, contact, assignments, payments, règles métier | D2.8d |
| Chrome liste | déjà EntityList* (D2.7) | ✅ |
| État / permissions / scope | reste dans EntityPage assembleur | D2.8e nettoyage |

---

## 2. Colonnes (périmètre D2.8a)

Candidats extraits :

- `PARENT_CHILD_*` constants
- `relationColumnHeader`
- `renderSeparatedStudentNames`
- mapping `displayColumns` → `Column[]`
- colonne calculée `studentCount` (classes)
- colonne `actions` (liens, permissions, callbacks)

**Non extraits (restent EntityPage) :** handlers `setEditing` / delete / payments (injectés en callbacks).

---

## 3. Risques

| Risque | Mitigation |
|--------|------------|
| Second monolithe colonnes | Un fichier ; pas de DS générique ; callbacks injectés |
| Régression listes D3 | 25 tests listes + tests unitaires colonnes |
| Import contextes React | Interdit — deps explicites |

---

## 4. Ordre D2.8

1. **D2.8a** Colonnes ✅  
2. **D2.8b** Options de formulaire ✅  
3. **D2.8c** Noyau CRUD transversal (sans workflows métier)  
4. D2.8d Modales / workflows spécialisés  
5. D2.8e Nettoyage final  
