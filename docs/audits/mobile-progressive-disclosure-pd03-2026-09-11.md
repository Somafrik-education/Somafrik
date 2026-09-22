# PD-03 — Appel élèves, détails secondaires hors résumé

**Date :** 2026-09-11  
**Lot :** Présences / Appel (après PD-01)  
**Écran :** `TeacherAttendanceScreen`  
**Pattern :** P-011 / DO-047 — **exception roll-call** (pas d’accordéon Entity sur P/A/R/J)  
**Base :** `develop@8a622871dd17e796782caf93f27e8eb7f3534337`

## Écart (RED, avant correction)

La ligne élève exposait matricule, heure d’arrivée, motif et source dans `studentIdentity`, sans interaction. Les 4 boutons `ATTENDANCE_ACTIONS` étaient déjà visibles.

```text
npx --yes tsx Mobile/src/lib/progressiveDisclosure.red.test.ts
# EXIT 1
# FAIL [PD-03] … l'heure d'arrivée reste exposée dans l'identité par défaut
# failedIds: PD-02, PD-03, PD-04, PD-06, PD-07

npm --prefix Mobile run verify:progressive-disclosure-red
# EXIT 0 — exactement 5/5 PD encore ROUGES (PD-03 inclus)
```

## Correction (GREEN)

Roll-call compact, **sans** `ExpandableEntityCard` :

- **Toujours visible :** nom, statut courant, **Présent / Absent / Retard / Justifié** (`minHeight`/`minWidth` ≥ 44 dp).
- **Tap identité :** une seule fiche détail exclusive (`nextExclusiveExpandedKey` + `extraData={expandedStudentId}`) — matricule, arrivée, motif, source, CTA « Ouvrir la fiche ».
- **Tap P/A/R/J :** `setAttendanceStatus` uniquement — ne bascule pas le détail ; pas de cycle `N→N+1`.
- Sélection de classe : nom + nombre d’élèves + appels du jour ; cours pédagogique retiré du résumé du picker.

`ATTENDANCE_ACTIONS`, `submitProtectedMutation`, outbox, `loadPresences`, Tout présent, KPI, Enregistrer : inchangés.

## Preuves GREEN

```bash
npx --yes tsx Mobile/src/lib/progressiveDisclosureUx.test.ts
npm --prefix Mobile run verify:progressive-disclosure-red
```

`verify:mobile-usability` exécute les suites PD ci-dessus ; un échec tardif `name: verify:mobile-usability` dans `ci.yml` nightly est **préexistant** (hors PD-03).

PD-02, PD-04, PD-06, PD-07 restent ROUGES.
