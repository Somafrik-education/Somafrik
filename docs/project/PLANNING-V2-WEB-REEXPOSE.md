# Planning V2 — réexposition Web contrôlée

## Mandat

Le moteur hebdomadaire (#261) est mergé. Cette PR **réouvre le menu Web** `Planning de cours` dans PÉDAGOGIE, sans réintroduire l’autorité `className + subject`, sans mélanger les examens, sans salles V2, sans remplacements, sans Mobile.

**Draft uniquement. Aucun Ready. Aucun merge.** Revalidation CTO GitHub indépendante obligatoire.

## Flag

```ts
export const PLANNING_WEB_UI_ENABLED = true;
```

Le garde `canReadView("planning")` **reste branché** :

```ts
if (viewName === "planning" && !PLANNING_WEB_UI_ENABLED) return false;
```

Rollback UI = remettre le flag à `false`. Les grants API ne suffisent pas à eux seuls.

## Qui voit le menu

| Rôle | Menu `/planning` |
| --- | --- |
| Admin School / Préfet avec `Planning de cours:READ` | **oui** |
| Enseignant avec `Planning de cours:READ` | **oui** (écritures UI gated `CREATE/UPDATE/DELETE`) |
| Sans jeton `Planning de cours:READ` | non |
| Parent / Secrétaire (pas de grant) | non |
| Super Admin | non (`schoolOnly` + vues plateforme) |

`NAV_ITEMS` contenait déjà l’entrée. Elle n’était masquée que par le flag.

## Écritures Web

`pedagogyPlanningSync` n’envoie plus `className` / `subject` / `start` / `end` comme autorité.

Payload POST/PATCH :

```json
{ "schoolCourseId", "academicYearId", "dayOfWeek": 1, "startTime": "08:00", "endTime": "09:00", "room?": "…" }
```

- Cours choisi dans le catalogue `school_courses` de la classe (UUID)
- Année lue sur la classe (`academicYearId`)
- Jour 1–7 (dimanche = 7)
- DELETE API = **annulation logique** (`cancelled`) ; le bouton UI dit « Annuler le créneau »

## Hors lot (volontaire)

- Salles / remplacements / EDT par salle : `ComingSoonState` inchangé
- Mobile Timetable : **non modifié**
- Examens : **non planifiés** depuis `/planning` (module Examens)
- Backfill historique / bouton « Corriger les données » qui inventait des créneaux : **retiré**
- Pas de `term_id` / `valid_from`

## Calendrier

La projection d’occurrences utilise `dayOfWeek` + `TIME` et la plage de vue (période affichée). Elle n’invente plus le jour métier via `Date.getDay()` d’un timestamp d’ancrage.

## Tests / CI

- `npm run verify:planning-v2-web`
- `npm run verify:planning-v2-weekly` (flag désormais `true`, garde conservé)
- Intégré dans `.github/workflows/ci.yml` et `security.yml`
