# Rapport D2.8d2 — Workflow Contacts & Comptes

**Type :** Infrastructure UI D2.8d2  
**Module :** EntityPage (Contacts / comptes utilisateurs liés)  
**Sous-périmètre :** Plans métier Contacts & Comptes uniquement  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire les **plans métier Contacts & Comptes** hors de `EntityPage`, sur le même modèle que D2.8d1 (deps injectées, pas de JSX modale, pas de monolithe multi-workflows).

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/contactAccountWorkflow.ts` | Plans pré-submit, post-merge, import, audit, fiche, reset gate |
| `contactAccountWorkflow.test.ts` | 12 scénarios ciblés |
| `EntityPage.tsx` | Orchestrateur : confirm/prompt/persist + JSX modales |

---

## 3. API extraite

| Fonction | Rôle |
|----------|------|
| `buildContactPreSubmitPlan` | schoolCode, doublons, rôle si accès |
| `buildContactPostMergePlan` | revoke / promote / liaison fiche + messages |
| `buildContactMutationAuditEntries` | `contact.*`, `user.role.assign`, fiche |
| `buildContactDeleteAuditEntry` | `contact.delete` (singulier) |
| `buildContactImportPlan` | import depuis lignes parsées |
| `buildContactPasswordResetGate` | préconditions reset MDP |
| `buildCreateFicheFromSelectionPlan` | user ou contact → fiche |
| `defaultNewContactDraft` / `contactDisplayLabel` | helpers |

**Injecté :** `syncSingleUserToTeachers`, `showToast`, `state`, `scopeUser`.  
**Confirm / prompt / I/O fichier / JSX** restent dans `EntityPage`.

---

## 4. Hors lot

- Relations parent-enfant (audit relations reste inline)
- Paiements
- Affectations (D2.8d1)
- Déplacement du JSX des modales
- Réactivation route Contacts filtrée dans `SCHOOL_ENTITY_MODULES`

---

## 5. Quirks préservés

- Promote sur `state` brut ; revoke sur `state + patch`
- Submit fiche : `schoolCode` ; modale fiche : `effectiveSchoolCode`
- Priorité message succès : fiche opérationnelle > promotion
- Audit entityType singulier (`contact`, `user`, `teacher`/`student`)

---

## 6. Tests

| Suite | Résultat |
|-------|----------|
| `contactAccountWorkflow.test.ts` | 12 |
| entity-page + 4 listes D3 | Régression |
| `tsc` / eslint | OK |

---

## 7. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Un seul workflow extrait | Oui (Contacts & Comptes) |
| Hooks / contextes | Non |
| JSX modales déplacé | Non |
| Relations / Paiements absorbés | Non |
| Suite | D2.8d3 — Relations parent-enfant |
