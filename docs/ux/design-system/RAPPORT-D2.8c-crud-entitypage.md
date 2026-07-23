# Rapport D2.8c — Extraction du noyau CRUD transversal EntityPage

**Type :** Infrastructure UI D2.8c  
**Module :** EntityPage (transversal)  
**Sous-périmètre :** Noyau CRUD générique uniquement  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire le **noyau CRUD transversal** hors de `EntityPage`, avec dépendances explicites et **sans** absorber les workflows métier spécialisés.

Le module s’appelle volontairement `entityCrudCore.ts` (et non un unique `entityCrudHandlers.ts` massif) pour éviter un second monolithe métier.

---

## 2. Noyau CRUD extrait

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/entityCrudCore.ts` | Helpers purs / quasi purs + persist injecté |
| `entityCrudCore.test.ts` | Tests ciblés du noyau |
| `EntityPage.tsx` | Orchestrateur : branches métier + appels au noyau |

### API

| Fonction | Rôle |
|----------|------|
| `newEntityId` | Préfixe + UUID / timestamp |
| `prepareEntityRowForSave` | Identifiant à la création |
| `applyEntitySchoolScope` | Scope établissement (délègue à `applySchoolScopeToItem`) |
| `mergeEntityIntoState` | Ajout / remplacement scopé |
| `deleteEntityFromState` | Suppression générique scopée |
| `persistEntityPatch` | Busy + `update(partial)` + toasts succès / échec |
| `appendGenericMutationAudit` / `appendGenericDeleteAudit` | Audit pour clés déjà communes |
| `auditEntityLabel` / `entityMutationSuccessMessage` | Libellés transversaux |

**Aucun** hook / contexte React. Toutes les deps (update, toast, busy) sont injectées.

---

## 3. Workflows métier encore présents (hors D2.8c)

Restent dans `EntityPage` pour **D2.8d** :

| Workflow | Pourquoi hors lot |
|----------|-------------------|
| Paiements / annulations / reçus | Règles finance + modales |
| Contacts + liaison Élève / Enseignant | Promotion / révocation comptes |
| Relations parent-enfant | Bundle + validations dédiées |
| Affectations enseignants | Modale + conflits + synchro |
| Synchros pédagogiques | `buildPedagogyPatch`, AFF-001 |
| Règles Classes / Élèves / Enseignants | Matricules, `removeSchoolClassFromState`, validation suppression |
| Import / export CSV-Excel | Hors noyau CRUD |
| Rendu formulaires / modales | UI, pas handlers génériques |

---

## 4. Responsabilités restant dans EntityPage

- Orchestration submit / delete (branches `if module.key === …`)
- Permissions, confirmations, prompts
- État local (`editing`, `busy`, modales)
- Appels au noyau après validations métier
- Wrappers D2.8a colonnes / D2.8b options (inchangés)
- Wrappers listes D3 (inchangés)

---

## 5. Candidats D2.8d

1. Modale formulaire générique (rendu champs)
2. Workflow contacts / promotion / liaison fiches
3. Workflow relations parent-enfant
4. Workflow affectations enseignants
5. Workflow paiements (annulation, reçu)
6. Branches Classes / Élèves / Enseignants spécifiques
7. Import / export si isolable sans risque

---

## 6. Tests

| Suite | Couverture |
|-------|------------|
| `entityCrudCore.test.ts` | Création, modification, suppression, scope, fusion multi-établissements, audit, erreur persist, non-mutation source |
| D2.8a / D2.8b / 4 listes D3 | Régression |
| DS + `tsc` + lint | OK |

---

## 7. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Fonctions sans hooks/contextes | Oui |
| Deps explicites | Oui |
| Workflows métier extraits | Non (volontaire) |
| Wrappers D3 / D2.8a / D2.8b | Inchangés |
| Changement fonctionnel / visuel | Non |
| Difficulté | **Moyenne** (périmètre réduit) |
| Suite | D2.8d1 — workflow affectations enseignants |
