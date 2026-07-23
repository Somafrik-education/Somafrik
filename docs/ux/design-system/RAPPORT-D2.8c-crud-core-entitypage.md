# Rapport D2.8c — Noyau CRUD transversal EntityPage

**Type :** Infrastructure UI D2.8c  
**Module :** EntityPage (transversal)  
**Sous-périmètre :** Handlers CRUD **génériques uniquement** (pas les workflows métier)  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire le **noyau CRUD transversal** hors du monolithe, avec dépendances explicites, **sans** absorber les workflows métier spécialisés (recommandation CTO : éviter un nouveau monolithe `entityCrudHandlers`).

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/entityCrudCore.ts` | Noyau : id, merge/delete scopés, persist+busy+toasts, audit générique |
| `entityCrudCore.test.ts` | Tests unitaires du noyau |
| `EntityPage.tsx` | Thin wrappers / appels ; workflows métier restent inline |

**Aucun** hook / contexte React dans le module.  
**Aucun** changement wrappers D3, colonnes (D2.8a), options (D2.8b), modales UI.

---

## 3. API extraite (périmètre strict)

| Fonction | Rôle |
|----------|------|
| `newEntityId` | Préfixe + UUID / timestamp |
| `prepareEntityRowForSave` | Assigne l’id à la création (sans règles élèves/enseignants) |
| `mergeEntityIntoState` | Ajout / remplacement scopé |
| `deleteEntityFromState` | Suppression générique scopée |
| `persistEntityPatch` | Busy + `update(partial)` + toasts succès / échec |
| `appendGenericMutationAudit` / `appendGenericDeleteAudit` | Audit pour `classes` / `students` / `teachers` / `assignments` |
| `auditEntityLabel` / `entityMutationSuccessMessage` | Libellés transversaux |

---

## 4. Explicitement **hors** D2.8c (EntityPage / D2.8d)

- Paiements (annulation, reçus)
- Contacts / promotion utilisateur / reset mot de passe
- Relations parent-enfant
- Affectations enseignants (modale + synchro pédagogique)
- Règles spécifiques Élèves (matricule, grilles), Classes (`removeSchoolClassFromState`), Enseignants (identifiants, suppression liée)
- Export / import CSV

---

## 5. Tests

| Suite | Résultat |
|-------|----------|
| `entityCrudCore.test.ts` | Scénarios noyau (id, merge/delete scope, audit, persist) |
| Options D2.8b + colonnes D2.8a + 4 listes D3 | Régression |
| `tsc` / lint | OK |

---

## 6. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Fonction sans hooks/contextes | Oui |
| Deps explicites | Oui |
| Workflows métier extraits | Non (volontaire) |
| Wrappers D3 | Inchangés |
| Difficulté | **Moyenne** (périmètre volontairement réduit) |
| Suite | D2.8d — modales / workflows spécialisés |
