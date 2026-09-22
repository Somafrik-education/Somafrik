# Pédagogie L3 — preuve GREEN

**Base RED :** `4f97054e` (`test(red): PED-L3 parité Pédagogie…`)  
**Commande :** `npm run test:parite-l3-pedagogie`

## Résultat exact (après implémentation)

### Web — 6 vert / 0 rouge / 6 cas

| ID | Motif GREEN |
| --- | --- |
| PED-L3-01 | CTA **Saisir les notes** sur la ligne d’évaluation → onglet Saisie |
| PED-L3-02 | `EvaluationFormModal` envoie `classId` via `resolveCanonicalClassId` |
| PED-L3-03 | `GradeEntryGrid` : **Enregistrer les notes** |
| PED-L3-04 | colonnes Date, Enseignant, Saisie (progression) |
| PED-L3-05 | roster `classId` prioritaire, sinon `className` |
| PED-L3-06 | contrat `PEDAGOGY_COPY` + libellés Valider / Publier / Nouvelle évaluation |

### Mobile — 15 vert / 0 rouge / 15 cas

| ID | Motif GREEN |
| --- | --- |
| PED-L3-10 | CTA **Nouvelle évaluation** |
| PED-L3-11 | champ Coefficient envoyé dans `buildCreateEvaluationPayload` |
| PED-L3-12 | carte : coef, enseignant, date, progression N/M |
| PED-L3-13 | filtres `periodFilter` / `statusFilter` (Tous, À valider) |
| PED-L3-14 | `loadNotes` au focus de la liste |
| PED-L3-15 | roster repli `className` |
| PED-L3-16 | sous-titre saisie brouillon / ouverte / validée |
| PED-L3-17 | Modifier + Publier |
| PED-L3-18 | `Valider` / `Saisir les notes` / `Enregistrer les notes` alignés |
| PED-L3-20 | `evaluationCoefficient` ≠ coefficient matière |
| PED-L3-21…25 | identifiants API, tenant strip, RBAC enseignant, pas de demo, 44 dp |

## Non-régression exécutée

- `npm --prefix web run typecheck`
- `npm --prefix Mobile run typecheck`
- Vitest Notes : `evaluations`, `GradeEntryGrid`, `EvaluationFormModal`, `GradesEvaluationsPage`, parent notes
- `verify:mobile-evaluations-v2`
- `notesEvaluationsRbacLive` + `evaluationGradeEntry`

Aucun backend / PostgreSQL / matrice RBAC globale modifié.
