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
| Handlers CRUD génériques (noyau) | id, scope, merge/delete, persist+busy, audit commun | **D2.8c** ✅ |
| Workflow affectations enseignants | submit / delete plan modale Enseignants | **D2.8d1** ✅ |
| Workflow Contacts & Comptes | pré-submit, promote/revoke, import, fiche, audit | **D2.8d2** ✅ |
| Workflow Relations parent-enfant | bundle submit/delete, relation unitaire, helpers | **D2.8d3** ✅ |
| Workflow Paiements | cancel, reçu, create persist | **D2.8d4** ✅ |
| Nettoyage final | assemblage EntityPage / modales restantes | D2.8e |
| Chrome liste | déjà EntityList* (D2.7) | ✅ |
| État / permissions / scope assembleur | reste dans EntityPage | D2.8e nettoyage |

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
3. **D2.8c** Noyau CRUD transversal ✅ — [RAPPORT](./RAPPORT-D2.8c-crud-entitypage.md)  
4. **D2.8d1** Affectations enseignants ✅ — [RAPPORT](./RAPPORT-D2.8d1-affectations-enseignants.md)  
5. **D2.8d2** Contacts & Comptes ✅ — [RAPPORT](./RAPPORT-D2.8d2-contacts-comptes.md)  
6. **D2.8d3** Relations parent-enfant ✅ — [RAPPORT](./RAPPORT-D2.8d3-relations-parent-enfant.md)  
7. **D2.8d4** Paiements ✅ — [RAPPORT](./RAPPORT-D2.8d4-paiements.md)  
8. D2.8e Nettoyage final  
