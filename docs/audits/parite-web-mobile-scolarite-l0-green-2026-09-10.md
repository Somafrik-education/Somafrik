# Scolarité L0 — preuve GREEN

**Base RED :** `develop@193c5df3e7b3049bb02f70d53106b0889f95fd0d`  
**Commit RED :** `7c1b0194` — `test(red): SCO-L0 parité Scolarité hub/classes/élèves`  
**Branche :** `cursor/schooling-web-mobile-parity-53ab`  
**Commande lot :** `npm run test:parite-scolarite-l0`  
**Ready / merge :** interdits sans GO CTO

PostgreSQL/Supabase reste la source canonique. Aucun nouveau DataContext. L1 Mobile conservé (hors-ligne seulement). RBAC serveur inchangé.

## Résultat exact (après implémentation)

### Web — 5 vert / 0 rouge / 5 cas

| ID | Motif GREEN |
| --- | --- |
| SCO-01 | `EtablissementOverviewPage` compte via `filterCanonicalClasses(state.classes)` ; plus de `scopedClasses(` |
| SCO-02 | titre `Scolarité` ; `academicYearsApi` (`GET /v2/academic-years`) ; onglet `label: "Scolarité"` |
| SCO-03 | actions Classes, Élèves, Inscriptions, Structure (`/parametres/structure`), Année (`/parametres/annee-scolaire`) |
| SCO-04 | lien `/parametres/structure` ; plus de `to="/configuration"` ; libellés Actif/Inactif ; vide explicite |
| SCO-05 | colonnes `Statut` (`displayStatusName`) et `Année` (`academicYearName`) |

### Mobile — 4 vert / 0 rouge / 4 cas

| ID | Motif GREEN |
| --- | --- |
| SCO-01-M | Accueil : `filterCanonicalClasses(rows).length` ; plus de fallback `unique className` |
| SCO-02-M | `SchoolingHubScreen` + route `Schooling` + drawer `Scolarité` + année active |
| SCO-04-M | `ClassesScreen` filtre `filterCanonicalClasses` ; vide « Aucune classe n'est encore créée… » |
| SCO-05-M | `StudentsScreen` affiche `displayStatusName(student.status)` ; vide « Aucun élève inscrit… » |

## Architecture retenue

Copie alignée `web/src/lib/schoolingTruth.ts` ↔ `Mobile/src/lib/schoolingTruth.ts` :

- `filterCanonicalClasses` / `countCanonicalClasses` — refuse les ids `CLASS-` ;
- `selectCurrentAcademicYear` — `isCurrent` puis statut courant, sans année inventée ;
- `countStudentsWithoutClass` — alerte effectif ;
- `SCOLARITE_COPY` — labels FR partagés.

Le hub Web lit `state.classes` déjà hydraté (même `GET /classes` que la liste). Le hub Mobile filtre le résultat de `scopedClassesForSession` pour retirer les synthèses, sans changer `scopedClasses` global (planning / notes hors lot).

## Legacy conservé (documenté)

| Mécanisme | Décision |
| --- | --- |
| `scopedClasses` planning / notes / EntityPage | non touché |
| DataContext élèves Web | conservé (même GET /students que l’annuaire) |
| L1 SQLite Mobile | conservé ; en ligne = GET métier |
| Transfert C18 | reporté (pas d’API REST) |

## Commandes GREEN

```
npm run test:parite-scolarite-l0
→ parite L0 Scolarité Web — 5 vert / 0 rouge / 5 cas
→ parite L0 Scolarité Mobile — 4 vert / 0 rouge / 4 cas

npm --prefix web run test -- src/lib/schoolingTruth.test.ts \
  src/lib/establishmentStudents.audit.test.ts \
  src/pages/etablissement/EtablissementOverviewPage.students.test.tsx \
  src/pages/etablissement/EtablissementOverviewPage.bootstrap.test.tsx \
  src/pages/etablissement/ClassesListPage.test.tsx \
  src/pages/etablissement/etablissementStudentsCanonical.test.tsx \
  src/pages/etablissement/ClassStudentsPage.test.tsx \
  src/lib/dashboardKpiTruth.test.ts
→ 8 files / 49 tests passed (rejoué après correction navigation KPI)

npx tsx Mobile/src/lib/schoolingTruth.test.ts → OK
npx tsx Mobile/src/lib/roleNavigationPreferences.test.ts → OK
npm --prefix packages/help-catalog test → 45 pass
npm --prefix web run typecheck → tsc --noEmit OK
npm --prefix web run lint → 0 error (warnings préexistants, non traités)
```

Smoke visuel : `VITE_API_URL=https://api.somafrik.app npm --prefix web run build && node scripts/scolarite-l0-viewport-smoke.js`

```
scolarite-l0-viewport-smoke: GO (0 overflow(s))
viewports 1440 / 1024 / 390 / 360 × hub / classes / élèves
```

Note : 360/390 = Web responsive (tables desktop conservées). L’app Expo native n’a pas été lancée dans cet environnement ; le hub Mobile est `SchoolingHubScreen` (cartes).
Le bandeau « Accès limité — Abonnement » vient du chrome abonnement (mock smoke sans offre) — hors lot.
Le bouton HELP peut recouvrir un KPI à 360 px — chrome HELP hors lot.
