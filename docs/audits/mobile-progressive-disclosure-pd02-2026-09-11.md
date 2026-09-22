# PD-02 — Évaluations en progressive disclosure

**Date :** 2026-09-11  
**Lot :** Évaluations (après PD-03)  
**Écran :** `TeacherGradesScreen`  
**Pattern :** P-011 / DO-047 — **Option A** (CTA `Saisir` / `Consulter` visible carte fermée)  
**Base :** `develop@91f9d9c62414a0ec1fce3b38fc67225e9cb64e41`  
**Contrat canonique PED-L3-12 :** `Mobile/src/lib/pariteL3Pedagogy.red.test.ts` (id `"PED-L3-12"`)

## 1. Amendement PED-L3-12 (contract-first, avant UI)

Le contrat exigeait coef / enseignant / date / progression tous visibles sur la carte. Amendé **sans suppression** : progression + titre + `classe • cours` + statut + `Saisir`/`Consulter` **fermés** ; coefficient, enseignant, date, `Modifier` / `Valider` / `Publier` **uniquement dépliés**.

Exécuté sur l’ancienne UI (`TeacherGradesScreen` à `91f9d9c6`, liste plate `ScrollView` + `.map`) :

```text
npx --yes tsx Mobile/src/lib/pariteL3Pedagogy.red.test.ts
# EXIT 1
# FAIL [PED-L3-12] Carte évaluation : progression fermée ; coef, enseignant, date dépliés
#     la liste évaluations n'utilise pas ExpandableEntityCard
# failedIds: ["PED-L3-12"]
# (PED-L3-10, 11, 13–18, 20–26 restent PASS)
```

## 2. Preuve RED PD-02 (avant modification UI)

Même ancienne UI ; `PD_RED_EXPECTED_IDS` incluait encore PD-02 :

```text
npx --yes tsx Mobile/src/lib/progressiveDisclosure.red.test.ts
# EXIT 1
# FAIL [PD-02] … la liste évaluations n'utilise pas encore la carte dépliable
# failedIds: PD-02, PD-04, PD-06, PD-07

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 4/4 PD encore ROUGES (PD-02 inclus)
```

## 3. Correction (GREEN)

- Primitive `ExpandableEntityCard` + prop optionnelle `summaryActions` (hors toggle, hors `children`) pour l’Option A.
- **Fermée :** titre, `classe • cours`, badge statut, progression (`N/M` ou `N note(s)`), CTA **Saisir les notes** / **Consulter**.
- **Ouverte :** période, date, barème, coefficient, enseignant, **Modifier** / **Valider** / **Publier**.
- Exclusivité : `expandedEvaluationId` + `nextExclusiveExpandedKey` + `extraData` FlatList. Fermé par défaut. `accessibilityState.expanded` sur la primitive. Touch ≥ 44 dp.
- `openGrades` / `canEditEvaluationFields` / `canValidate` / mutations / navigation saisie : inchangés.

## 4. Preuves GREEN

```bash
npx --yes tsx Mobile/src/lib/pariteL3Pedagogy.red.test.ts
# EXIT 0 — PASS PED-L3-12 (16/16)

npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
# OK Lot 0 UX progressive disclosure : contrat + îlots verts + exceptions CTO

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 3/3 PD encore ROUGES
# failedIds: PD-04, PD-06, PD-07
```

PD encore ROUGES : **PD-04, PD-06, PD-07**.

`npm --prefix Mobile run verify:mobile-evaluations-v2` : OK (métier Notes inchangé).

`npm run verify:mobile-usability` : suites PD + Notes OK, puis **échec tardif préexistant** :

- `Mobile/scripts/verify-mobile-usability.js` L240 : `assert.match(ci, /name: verify:mobile-usability/)`
- `.github/workflows/ci.yml` s’appelle `CI Full Nightly` et exécute `npm run verify:mobile-usability` (L90) **sans** step `name: verify:mobile-usability`
- Hors périmètre PD-02 ; déjà constaté Lot 0 / PD-01 / PD-03 / PD-05. **Non corrigé ici.**
