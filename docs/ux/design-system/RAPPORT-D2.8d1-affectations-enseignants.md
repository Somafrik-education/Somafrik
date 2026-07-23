# Rapport D2.8d1 — Workflow affectations enseignants

**Type :** Infrastructure UI D2.8d1  
**Module :** EntityPage (modale Enseignants → Affectations)  
**Sous-périmètre :** Workflow d’affectations enseignants uniquement  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire le **plan métier** submit / delete de la modale d’affectations hors de `EntityPage`, sans regrouper les autres workflows spécialisés dans un module unique.

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/teacherAssignmentWorkflow.ts` | Plans submit / delete + helpers AFF-001 |
| `teacherAssignmentWorkflow.test.ts` | Tests ciblés |
| `EntityPage.tsx` | Thin wrappers + UI modale + `buildPedagogyPatch` injecté |

**Aucun** hook / contexte React dans le module.  
**Aucun** changement wrappers D3, D2.8a/b/c hors câblage.

---

## 3. API extraite

| Fonction | Rôle |
|----------|------|
| `resolveLinkedTeacher` | Résolution enseignant (id / publicId / …) |
| `emptyEditingAssignment` | Formulaire vide post-création / retrait |
| `reapplyAssignmentPeriodRoom` | AFF-001 après synchro pédagogique |
| `buildTeacherAssignmentSubmitPlan` | Validation → merge → patch + audit |
| `buildTeacherAssignmentDeleteConfirmCopy` | Libellés confirm |
| `buildTeacherAssignmentDeletePlan` | Delete scopé + embed teacher + audit |

`buildPedagogyPatch` reste dans `EntityPage` et est **injecté** (partagé avec le submit générique teachers/courses/assignments).

---

## 4. Reste dans EntityPage

- JSX modale affectations
- `useState` (`teacherAssignmentContext`, `editingAssignment`)
- Permissions / `confirm` / `persistPatch`
- `buildPedagogyPatch`
- Options select (D2.8b) via wrappers existants

---

## 5. Hors lot (futurs D2.8d*)

- Paiements / annulations / reçus
- Contacts / promotion
- Relations parent-enfant
- Règles spécifiques Classes / Élèves / Enseignants (hors affectations)
- Extraction de `buildPedagogyPatch` elle-même
- Import / export

---

## 6. Tests

| Suite | Résultat |
|-------|----------|
| `teacherAssignmentWorkflow.test.ts` | 10 scénarios |
| Noyau D2.8c + options + colonnes + 4 listes D3 | Régression |
| `tsc` / lint | OK |

---

## 7. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Un seul workflow extrait | Oui (affectations) |
| Pas de monolithe multi-workflows | Oui |
| Hooks / contextes | Non |
| Deps injectées (`buildPedagogyPatch`, toast, state) | Oui |
| UI modale déplacée | Non |
| Suite | D2.8d2 — Contacts & Comptes |
