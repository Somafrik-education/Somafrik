# Pédagogie L3 — preuve RED

**Base :** `develop` (branche `cursor/pedagogie-parite-l3-06a4`)  
**Commande :** `npm run test:parite-l3-pedagogie`

## Résultat exact (avant implémentation)

### Web — 0 vert / 6 rouge / 6 cas

| ID | Motif |
| --- | --- |
| PED-L3-01 | liste Évaluations sans CTA « Saisir les notes » |
| PED-L3-02 | `EvaluationFormModal` n'attache pas `classId` |
| PED-L3-03 | `GradeEntryGrid` libellé « Enregistrer tout » ≠ Mobile |
| PED-L3-04 | colonnes Date / Enseignant / progression absentes |
| PED-L3-05 | roster saisie filtré uniquement par `className` |
| PED-L3-06 | page Notes n'importe pas le contrat de vocabulaire |

### Mobile — 5 vert / 10 rouge / 15 cas

| ID | Résultat | Motif |
| --- | --- | --- |
| PED-L3-10 | ROUGE | CTA « Créer une évaluation » |
| PED-L3-11 | ROUGE | pas de champ Coefficient à la création |
| PED-L3-12 | ROUGE | carte sans coef / enseignant / progression N/M |
| PED-L3-13 | ROUGE | pas de filtres période/statut |
| PED-L3-14 | ROUGE | `loadNotes` absent du focus liste |
| PED-L3-15 | ROUGE | roster ignore `className` si `classId` vide |
| PED-L3-16 | ROUGE | sous-titre « saisie seulement après validation » |
| PED-L3-17 | ROUGE | pas de Modifier / Publier |
| PED-L3-18 | ROUGE | « Valider l'évaluation » ≠ « Valider » |
| PED-L3-20 | ROUGE | `coefficient` matière (4) utilisé comme poids d'évaluation |
| PED-L3-21 | VERT | normalizeEvaluation conserve les identifiants API |
| PED-L3-22 | VERT | `stripEvaluationClientScope` |
| PED-L3-23 | VERT | `canValidate && !teacher` |
| PED-L3-24 | VERT | `data/notes.ts` non importé |
| PED-L3-25 | VERT | `MIN_TOUCH_TARGET_DP` |

Aucun `assert(false)`. Les échecs reproduisent le code livré.
