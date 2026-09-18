# HELP — couverture des routes Web protégées (#702)

**Base `develop` :** `dcabfc30f8eacc229c70e6ca633dbc674b5fa011` (#701 merge)  
**Préprod observée :** `https://preprod.somafrik.app` (bundle `help-catalog-DOjhCSoe.js`, HTML `last-modified` 2026-09-18 12:35:42 UTC)

## Diagnostic préprod

Le chunk d’aide déployé **contient déjà** le mapping #701 `/bulletins` → `REPORT_CARDS` et l’article `help/report-cards/consult`. Il **ne contient pas** `/examens`.

Conséquence :

| Route | Code `develop@dcabfc30` | Bundle préprod | Lecture |
| --- | --- | --- | --- |
| `/examens` | `resolveWebScreen` → `null` | absent du mapping | **bug code** — le bouton est masqué |
| `/bulletins` (+ `/historique`, `/modele`) | → `REPORT_CARDS` | mapping présent | **pas un trou de mapping**. Si le bouton manque encore en recette, chercher un autre état runtime (bootstrap permissions, `mustChangePassword`, overlay) — pas un second mapping |

## Recette Bulletins (HOLD #703)

Hard reload cache-bust du 2026-09-18 ~13:13 UTC : HTML `index-BGpLHa2Y.js`, chunk `help-catalog-DOjhCSoe.js`.

- `startsWith("/bulletins")` → `REPORT_CARDS` : **présent**
- `help/report-cards/consult` : **présent**
- `startsWith("/examens")` : **absent** (corrigé dans cette PR, pas encore déployé)

Hypothèse plausible de l’absence observée : SPA restée sur un bundle antérieur à #701. Un hard reload (sans cache) charge le chunk ci-dessus, où le mapping Bulletins existe déjà.

`HelpHost` n’était pas inspectable quand le bouton est masqué (`return null`). Une sonde cachée non sensible (`data-help-bootstrap`, `data-help-ready`, `data-help-must-change-password`, `data-help-role`, `data-help-screen`) est désormais rendue dans ce cas. Aucun token, session ou identifiant.

Protocole après hard reload, même session Administrateur d’établissement :

1. Route connue avec bouton (ex. `/tableau-de-bord` ou `/etablissement/classes`) : trigger `data-help-available="true"`.
2. `/bulletins` : même trigger, `data-help-screen="report-cards"`.
3. Si absent : lire uniquement `#help-unavailable-probe` (ou `[data-testid=help-unavailable-probe]`).

La recette authentifiée live n’est pas réalisable depuis cet agent (pas de session préprod).

## Règle anti-omission

Toute `path="/…"` absolue dans `web/src/App.tsx` doit être classée dans `packages/help-catalog/test/web-route-coverage.test.js` :

1. **Aide attendue** → `resolveWebScreen` retourne un écran, `isHelpAvailable` vrai pour un rôle authentifié.
2. **Route publique / auth** → écran `null` (vitrine, connexion, essai, confidentialité, suppression, verify public).
3. **Alias `Navigate` sans séjour** → exclusion explicite (mapping non exigé).

Une nouvelle route protégée oubliée fait échouer le test d’inventaire.

## Examens ≠ Notes

`HELP_SCREEN.EXAMS` est distinct de `GRADES`. L’article `help/exams/sessions` décrit le suivi de sessions (planification dans Planning de cours). Il n’est pas un clone de Notes.

## Console plateforme

`/pays`, `/etablissements`, `/referentiels-pedagogiques`, `/abonnements*`, `/marketplace` mappent vers `HELP_SCREEN.PLATFORM` (opérateur). `/etablissements` (pluriel) est résolu **avant** `/etablissement` (singulier) pour ne pas hériter du dashboard établissement.

## Alias Navigate (exclusion)

`/classes`, `/eleves`, `/enseignants`, `/communication`, `/documents`, etc. redirigent immédiatement. Pas d’écran de séjour ; un `null` y est justifié. `/administration/contacts` et `/parametres-graphiques` restent préfixe-mappés pendant le flash.
