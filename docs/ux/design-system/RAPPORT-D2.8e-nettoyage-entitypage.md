# Rapport D2.8e — Nettoyage final EntityPage

**Type :** Infrastructure UI D2.8e  
**Module :** EntityPage (assembleur uniquement)  
**Sous-périmètre :** Nettoyage — aucune nouvelle extraction métier  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Finaliser le lot D2.8 en nettoyant l’assembleur `EntityPage.tsx` après les extractions D2.8a → D2.8d4 : wrappers devenus inutiles, duplications résiduelles, ombrages de noms, commentaires obsolètes et documentation de clôture.

**Interdit dans ce lot :** nouvelle extraction de workflow, déplacement de hooks/contextes/JSX, modification des modules `entity-page/*` métier.

---

## 2. Livrable

| Changement | Détail |
|------------|--------|
| `applyPlan` local | Factorise le pattern persist + toast déjà affiché |
| `closeCancelModal` | Déduplique la fermeture modale annulation paiement |
| Wrappers D2.8b inlinés | `getSelectOptionsForField` / `getTeacherAssignmentFieldOptions` |
| Bundle parent-enfant | Submit inliné dans `handleSubmit` (plus de wrapper dédié) |
| `handleCancelPayment` | Supprimé ; ouverture modale inline dans `onCancelPayment` |
| `emptyEditingAssignment` | Réutilisé aux 2 sites de draft vide |
| Ombrage local | `scopedAssignments` → `existingAssignmentRows` |
| Commentaire EmptyState | Retiré (historique) |

**LOC :** ~1945 → ~1883 (−62).

---

## 3. Hors lot

- Corps des handlers métier (CRUD, pédagogie, contacts, relations, paiements)
- JSX des modales
- Fichiers `entity-page/*.ts` (plans / tests)
- Domaine `lib/*`

---

## 4. Tests

| Suite | Couverture |
|-------|------------|
| entity-page + listes D3 | Régression comportementale |
| `tsc` / eslint | OK |

---

## 5. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Assembleur uniquement | Oui |
| Nouvelle extraction métier | Non |
| Hooks / contextes déplacés | Non |
| JSX déplacé | Non |
| Comportement inchangé | Oui |
| Suite | D2.8 clos ; reprise listes / fiches D3 selon CTO |
