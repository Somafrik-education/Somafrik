# PD-01 — Enseignants, cartes ExpandableEntityCard

**Date :** 2026-09-11  
**Lot :** Enseignants (après Lot 0 + PD-05)  
**Écran :** `TeachersScreen`  
**Pattern :** P-011 / DO-047  
**Base :** `develop@06983b175720beb31add1bd688a5018bad7d6cd7`

## Écart (RED, avant correction)

La liste rendait un `View` plat : nom, code, cours, classes, téléphone, statut et `TeacherMutationControls row=` étaient tous visibles sans déplier. Pas d’`ExpandableEntityCard`, pas d’exclusivité d’ouverture.

```text
npx --yes tsx Mobile/src/lib/progressiveDisclosure.red.test.ts
# EXIT 1
# FAIL [PD-01] … la liste enseignants n'utilise pas encore ExpandableEntityCard
# failedIds: PD-01, PD-02, PD-03, PD-04, PD-06, PD-07

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 6/6 PD encore ROUGES (PD-01 inclus)
```

## Correction (GREEN)

Même primitive que Scolarité : `ExpandableEntityCard` + `nextExclusiveExpandedKey(current, teacher.id)` + `extraData={expandedTeacherId}`.

- **Fermée :** nom, code enseignant (sous-titre), badge statut.
- **Ouverte :** cours, classes, téléphone, `TeacherMutationControls row=` (Modifier / Archiver).
- Création (`TeacherMutationControls` sans `row`) et `AssignmentMutationControls` restent dans l’en-tête (formulaires, exception contrat).

Aucun changement API, RBAC, navigation, ni autre écran.

## Preuves GREEN

```bash
npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
npm --prefix Mobile run verify:progressive-disclosure-red
```

PD-02, PD-03, PD-04, PD-06, PD-07 restent ROUGES (lots suivants).
