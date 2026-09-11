# PD-07 — Emploi du temps, cartes ExpandableEntityCard

**Date :** 2026-09-11  
**Lot :** EDT / Planning (dernier lot PD)  
**Écran :** `TimetableScreen`  
**Pattern :** P-011 / DO-047  
**Base :** `develop@ac7ffa7cb277477fcf712a0587fe832b030c609e`

## Écart (RED, avant correction)

Chaque créneau exposait cours, classe, enseignant, salle, détail de remplacement et le bouton Remplacer sans déplier. Le tap sur toute la carte lançait `openEdit`. Pas d’`ExpandableEntityCard`, pas d’exclusivité.

```text
npx --yes tsx Mobile/src/lib/progressiveDisclosure.red.test.ts
# EXIT 1
# FAIL [PD-07] … les créneaux n'utilisent pas encore la carte dépliable
# failedIds: ["PD-07"]

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 1/1 PD encore ROUGE (PD-07)
```

## Correction (GREEN)

`ExpandableEntityCard` (primitive inchangée) + `expandedSlotId` + `nextExclusiveExpandedKey(current, item.id)`.

- **Fermée :** `courseName`, `className || classCode`, badge `startTime–endTime`.
- **Ouverte :** classe labellée, enseignant, salle, `replacementsUnverified` / `isReplacement` (copy inchangée), **Modifier** si `canUpdate && !mutationsBlocked` (y compris `compact=true`), **Remplacer** si `canReplace && !compact && !mutationsBlocked`.
- Téléphone : `occurrences.map(item => renderSlotCard(item))`. Tablette : `items.map(item => renderSlotCard(item, true))`.
- `ScrollView`, day chips, colonnes semaine, `DATA_TRUTH_TEST_IDS.planningList` : inchangés.
- Formulaires create/edit/replace, API, RBAC, L1/offline, `executeMutation` : inchangés.

`PD_RED_EXPECTED_IDS = []`. `verify-progressive-disclosure-red.js` accepte EXIT 0 + `failedIds=[]` + `passedIds=[]`.

## Preuves GREEN

```bash
npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
npm --prefix Mobile run verify:progressive-disclosure-red
# OK: 0 PD encore ROUGES — contrat progressive disclosure clos.
```

```bash
npx --yes tsx Mobile/src/lib/planningV2.test.ts
npm --prefix Mobile run verify:mobile-planning-v2
# verify:mobile-planning-v2 OK

npm --prefix Mobile run verify:mobile-network-resilience
# OK: planning hors outbox, retry manuel / 409 non auto-replay
```

`verify:mobile-data-truth` : **OK: planning sans fallback catalog / demo**. Suite source OK ; arrêt tardif `MODULE_NOT_FOUND metro` (environnement agent, hors PD-07).

`verify:mobile-usability` : suites PD + Planning OK ; échec tardif préexistant `name: verify:mobile-usability` dans `ci.yml` nightly — non corrigé ici.

PD encore rouges : **aucun**.
