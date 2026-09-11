# PD-06 — Bulletins, cartes ExpandableEntityCard

**Date :** 2026-09-11  
**Lot :** Bulletins (après PD-04)  
**Écran :** `ReportCardsScreen`  
**Pattern :** P-011 / DO-047  
**Base :** `develop@c9f3d687a78d79816464a8d3a2ba8760fc5812a1`

## Écart (RED, avant correction)

Chaque carte plate exposait élève, période, statut, **Moyenne / Rang / Publié le** et **Visionner le bulletin** sans déplier. Pas d’`ExpandableEntityCard`, pas d’exclusivité d’ouverture.

```text
npx --yes tsx Mobile/src/lib/progressiveDisclosure.red.test.ts
# EXIT 1
# FAIL [PD-06] … la liste bulletins n'utilise pas encore la carte dépliable
# failedIds: PD-06, PD-07

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 2/2 PD encore ROUGES (PD-06 inclus)
```

## Correction (GREEN)

Même primitive que Utilisateurs : `ExpandableEntityCard` + `nextExclusiveExpandedKey(current, card.id)` + `extraData={expandedReportCardId}`.

- **Fermée :** nom élève, période (sous-titre), badge statut.
- **Ouverte :** Moyenne, Rang, Publié le, CTA **Visionner le bulletin**.
- `openPdf` / `downloadReportCardPdf` / `Linking.openURL(localUri)` : inchangés.
- `resolveMobileStudentScope` / `filterRowsByStudentScope` / `loadReportCards` : inchangés.

## Preuves GREEN

```bash
npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
# OK Lot 0 UX progressive disclosure : contrat + îlots verts + exceptions CTO

npm --prefix Mobile run verify:progressive-disclosure-red
# OK: exactement 1/1 PD encore ROUGE
# failedIds: PD-07

npm run verify:mobile-data-truth
# OK: bulletins sans liste fictive  (loadReportCards, emptyBulletins, pas de catalog)
# Suite source OK jusqu'au graphe production ; arrêt tardif MODULE_NOT_FOUND metro
# (dépendance absente de cet environnement agent — hors PD-06, non corrigé ici)
```

`verify:mobile-usability` exécute les suites PD ci-dessus ; un échec tardif `name: verify:mobile-usability` dans `ci.yml` nightly est **préexistant** (hors PD-06) :

- `Mobile/scripts/verify-mobile-usability.js` L240 : `assert.match(ci, /name: verify:mobile-usability/)`
- `.github/workflows/ci.yml` s’appelle `CI Full Nightly` et exécute `npm run verify:mobile-usability` **sans** step `name: verify:mobile-usability`

PD-07 reste ROUGE (lot EDT suivant).
