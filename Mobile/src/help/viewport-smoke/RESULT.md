# HELP-V1C — smoke viewports Mobile

Exécution : `npm run verify:help-v1c-viewport` (Chrome + `playwright-core`).

Géométrie identique au host : FAB ≥ 44 dp, réserve CTA 72 dp, tabs 60 dp. Screens : Dashboard, Classes (`Créer une classe`), Profil (`Enregistrer`), Année scolaire, Structure, clavier ouvert.

| Viewport | Dashboard | Classes vs Créer | Profil vs Enregistrer | Clavier | Panneau |
| --- | --- | --- | --- | --- | --- |
| 360 (Android) | FAB au-dessus des tabs | CTA en tête, FAB en bas — pas de recouvrement | Enregistrer hors FAB | trigger masqué | plein écran |
| 390 (Android / iPhone) | idem | idem | idem | trigger masqué | sheet ~85 % |
| iPhone 390×844 | idem | idem | idem | trigger masqué | sheet ~85 % |

Mesure AABB (padding 4 px) : **0 collision** CTA / bottom tabs / clavier.

Résultat : **GO visuel**.
