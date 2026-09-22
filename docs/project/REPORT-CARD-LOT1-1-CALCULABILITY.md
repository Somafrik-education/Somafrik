# LOT 1.1 — Contrat de calculabilité `AcademicRuleProfile`

**Statut :** contrat v1 pour débloquer LOT 3.  
**Ticket :** #631. **Interdit :** hardcode dans `reportCardEngine.js`, LOT 3 code, LOT 4.

Les profils historiques LOT 1 restent lisibles. Les clés nouvelles n’existent que sur de **nouvelles versions**. Absent = non calculable, jamais une formule implicite.

## Agrégation `weighted_sum`

```json
{ "aggregation": { "mode": "weighted_sum", "coefficient_default": 1, "percentage": "points_over_max_100" } }
```

- `weight = component.coefficient ?? coefficient_default` (`coefficient_default` **explicite**, v1 = `1`)
- points = `numeric_score × weight` ; max_points = `max × weight` si `max` existe
- `NOT_APPLICABLE` exclu des points **et** du dénominateur ; `0` NUMERIC contribue
- `PERCENTAGE = 100 × points / max_points` seulement si tous les `max` applicables existent ; `max_points = 0` → `WEIGHTED_MAX_ZERO`

## Pass rule typé

`{ "metric": "PERCENTAGE", "threshold": 50 }` — échelle 0–100.  
`{ "min_average": number }` historique : lisible, **non calculable** pour `DECISION`. Pas de conversion `10` → `50%`.

## Arrondi

`rounding.stage = display_only` obligatoire sur un profil calculable. Ranking et décision lisent la valeur **interne**. Pas d’arrondi intermédiaire.

## Ranking

Si `enabled === true` sur un profil calculable : `metric = PERCENTAGE` (ordre décroissant, valeur interne).

| `ties` | Séquence (ex. 10, 9, 9, 8) |
|---|---|
| `competition` | `1,2,2,4` |
| `dense` | `1,2,2,3` |
| `min` | `1,2,2,4` (alias figé de `competition`) |

## Bornes

Note numérique ≥ 0 ; si `max` défini, ≤ `max` ; dépassement rejeté, jamais clampé. Sans `max`, pas de plafond inventé.
