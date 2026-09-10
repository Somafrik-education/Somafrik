# Scolarité L0 — preuve RED

**Base :** `develop@193c5df3e7b3049bb02f70d53106b0889f95fd0d`  
**Commande :** `npm run test:parite-scolarite-l0`

## Résultat exact (avant implémentation)

### Web — 0 vert / 5 rouge / 5 cas

| ID | Motif observé |
| --- | --- |
| SCO-01 | `EtablissementOverviewPage` n’utilise pas `filterCanonicalClasses` ; compte via `scopedClasses` (synthèse `CLASS-${nom}` + dédup nom) |
| SCO-02 | pas de titre `Scolarité` ; pas de `academicYearsApi` |
| SCO-03 | actions Année scolaire / Structure absentes du hub |
| SCO-04 | modal Classes pointe `/configuration` ; statuts `active`/`inactive` ; vide générique |
| SCO-05 | annuaire sans colonne année ni statut |

### Mobile — 0 vert / 4 rouge / 4 cas

| ID | Motif observé |
| --- | --- |
| SCO-01-M | Accueil : `rows.length \|\| unique className` |
| SCO-02-M | `SchoolingHubScreen.tsx` absent |
| SCO-04-M | `ClassesScreen` n’appelle pas `filterCanonicalClasses` |
| SCO-05-M | `StudentsScreen` n’affiche pas le statut élève |

Aucun `assert(false)`. Les échecs reproduisent le code livré.
