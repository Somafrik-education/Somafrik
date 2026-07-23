# Rapport D2.8d3 — Workflow Relations parent-enfant

**Type :** Infrastructure UI D2.8d3  
**Module :** EntityPage (mode `parentChildRelations` + chemin relation unitaire)  
**Sous-périmètre :** Plans métier Relations parent ↔ élèves uniquement  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire les **plans métier Relations parent-enfant** hors de `EntityPage`, sur le même modèle que D2.8d1 / D2.8d2 (deps injectées, JSX modales conservé, un workflow par module).

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/parentChildRelationWorkflow.ts` | Bundle submit/delete, relation unitaire, helpers formulaire |
| `parentChildRelationWorkflow.test.ts` | 8 scénarios ciblés |
| `EntityPage.tsx` | Orchestrateur + JSX picker élèves |

---

## 3. API extraite

| Fonction | Rôle |
|----------|------|
| `buildParentChildBundleSubmitPlan` | Validation, permissions, sync, audit create/update |
| `buildParentChildBundleDeletePlan` | Retrait bundle + audit (`entityId = fromContactId`) |
| `buildRelationPreSubmitPlan` | prepare / validate (chemin unitaire) |
| `buildRelationPostMergePlan` | PE-005 principal unique + audit |
| `buildRelationDeleteAuditEntry` | Delete unitaire (`entityId = row.id`) |
| Helpers formulaire | draft, sélection élèves, change parent, add/remove |

**Injecté :** `createRelationId`, `showToast`, `state`, `scopeUser`.

---

## 4. Hors lot

- Paiements (lot isolé ultérieur)
- Contacts & Comptes (D2.8d2)
- Affectations (D2.8d1)
- JSX modales / picker (reste EntityPage)
- Domaine `lib/relations.ts` (non déplacé)

---

## 5. Quirks préservés

- Bundle bypass `mergeEntityIntoState` ; écrit via `syncParentChildRelations` sur **toutes** les relations
- Audit bundle : `entityId = fromContactId` (pas l’id de ligne)
- Audit unitaire : `entityId = row.id`
- Messages exacts create vs update / delete bundle
- Changement de parent recharge les élèves liés s’il en existe
- **`buildParentChildBundleDeletePlan` ne contrôle pas scope/permissions** : EntityPage conserve confirm + gates avant appel ; le plan ne doit jamais être invoqué depuis une autre UI sans ces préconditions
- **`buildParentChildBundleDeletePlan` ne contrôle pas scope/permissions** : EntityPage conserve confirm + gates avant appel ; le plan ne doit jamais être invoqué depuis une autre UI sans ces préconditions

---

## 6. Tests

| Suite | Résultat |
|-------|----------|
| `parentChildRelationWorkflow.test.ts` | 8 |
| entity-page + 4 listes D3 | Régression |
| `tsc` / eslint | OK |

---

## 7. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Un seul workflow extrait | Oui (Relations parent-enfant) |
| Hooks / contextes | Non |
| JSX déplacé | Non |
| Paiements / Contacts absorbés | Non |
| Suite | D2.8d4 — Paiements (vigilance renforcée) |
