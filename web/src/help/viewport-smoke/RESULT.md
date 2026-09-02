# HELP-V1B — smoke viewports (Chrome réel)

Exécution : `npm run verify:help-v1b-viewport` (Chrome système + `playwright-core`).

Session mock Admin School, interception locale de `/api/*` (aucun backend). Pages : Dashboard, Classes (`Ajouter`), Profil établissement (`Enregistrer` sticky).

| Viewport | Dashboard | Classes vs Ajouter | Profil vs Enregistrer | Panneau |
| --- | --- | --- | --- | --- |
| 1440 | FAB bas-droite, hors Topbar | Ajouter en tête de liste, FAB en bas — pas de recouvrement | Enregistrer sticky sous la FAB, jeu ~28 px | tiroir 448 px à droite |
| 1024 | idem | idem | jeu conservé | tiroir 448 px |
| 390 | FAB compact `?`, hors hamburger | Ajouter au-dessus, hors FAB | Enregistrer sous la FAB | plein écran 390×844 |
| 360 | idem | idem | jeu ~44 px | plein écran 360×800 |

Mesure Playwright (AABB, padding 4 px) : **0 collision** CTA / Topbar / menu hamburger.

Observation (non bloquante) : sur 360/390, la FAB `fixed` peut recouvrir le bord droit d’un champ du formulaire profil lorsque ce champ se trouve dans la bande basse. Ce n’est pas un CTA métier. Escape ferme le panneau. Aucune correction CSS : pas de collision réelle CTA/Topbar/drawer.

Résultat : **GO visuel**. Aucun changement d’architecture.
