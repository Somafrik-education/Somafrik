# PD-04 — Utilisateurs, cartes ExpandableEntityCard

**Date :** 2026-09-11  
**Lot :** Utilisateurs (après PD-02)  
**Écran :** `UsersScreen`  
**Pattern :** P-011 / DO-047  
**Base :** `develop@01231e834ceb7ec4a1b0588e3d0c32e8ac87893c`

## Écart (RED, avant correction)

Chaque carte plate exposait nom, identifiant, type métier, rôles d’accès, statut, établissement, email, téléphone et `<UserMutationControls row={user} />` sans déplier. Pas d’`ExpandableEntityCard`, pas d’exclusivité d’ouverture. La création (`UserMutationControls` sans `row`) était déjà dans `ListHeaderComponent`.

```text
npx --yes tsx Mobile/src/lib/progressiveDisclosure.red.test.ts
# EXIT 1
# FAIL [PD-04] … la liste utilisateurs n'utilise pas encore ExpandableEntityCard
# failedIds: PD-04, PD-06, PD-07

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 3/3 PD encore ROUGES (PD-04 inclus)
```

## Correction (GREEN)

Même primitive que Enseignants : `ExpandableEntityCard` + `nextExclusiveExpandedKey(current, user.id)` + `extraData={expandedUserId}`.

- **Fermée :** nom complet (fallback identifiant), sous-titre `identifier || publicId`, badge statut.
- **Ouverte :** type métier, rôles d’accès, établissement, email, téléphone, `<UserMutationControls row={user} />`.
- Création (`UserMutationControls` sans `row`) reste dans l’en-tête, hors cartes.
- Hint Enseignant / matrice Web inchangé.

`useAdminData`, `loadUsers`, `resourceScopeKey`, refresh et règles de `UserMutationControls` : inchangés.

## Preuves GREEN

```bash
npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
# OK Lot 0 UX progressive disclosure : contrat + îlots verts + exceptions CTO

npm --prefix Mobile run verify:progressive-disclosure-red
# OK: exactement 2/2 PD encore ROUGES
# failedIds: PD-06, PD-07
```

`verify:mobile-usability` exécute les suites PD ci-dessus ; un échec tardif `name: verify:mobile-usability` dans `ci.yml` nightly est **préexistant** (hors PD-04) :

- `Mobile/scripts/verify-mobile-usability.js` L240 : `assert.match(ci, /name: verify:mobile-usability/)`
- `.github/workflows/ci.yml` s’appelle `CI Full Nightly` et exécute `npm run verify:mobile-usability` **sans** step `name: verify:mobile-usability`

PD-06, PD-07 restent ROUGES (lots suivants).
