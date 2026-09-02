# P0 — Cours planifiables Planning (Préfet / Enseignant)

**Base :** `develop` post-#263  
**Gouvernance :** PR **DRAFT** — aucun Ready — aucun merge.

## Symptôme

Le cours de 2ème A existe en PostgreSQL. Le Préfet a `Planning de cours` CRUD (#263) et ouvre `/planning`, mais « Planifier un cours » échoue :

`classCourses` était lu uniquement depuis `state.courses`, domaine Web filtré par `canReadView("courses")` → **`Matières:READ`**.

Sans ce grant historique, le loader élimine `courses`. Le toast « Créez-le dans Mon établissement » est trompeur.

## Correctif

Projection canonique, gated **`Planning de cours:READ`** uniquement :

```
GET /api/course-schedules?projection=course-options
```

| Rôle | Résultat |
| --- | --- |
| Préfet / Admin School | cours actifs de l’établissement (classe filtrable) |
| Enseignant | uniquement ses `school_courses` / affectations |
| Parent / Secrétaire | 403 — pas d’exposition supplémentaire |

La page `/planning` consomme cette projection. Elle **ne charge plus** le domaine `courses` (Matières). Aucun CRUD Matières n’est donné à l’Enseignant.

Toast vide : diagnostic « ne le recréez pas », plus « Créez-le dans Mon établissement ».

## Tests

```bash
npm run verify:planning-course-options
```
