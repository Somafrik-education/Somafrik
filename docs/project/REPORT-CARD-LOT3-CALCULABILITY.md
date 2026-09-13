# LOT 3 — Calculabilité (consommation LOT 1.1)

**Statut :** P0-1 levé après merge #632 (`develop@d1aa3c6b`). LOT 3 consomme `AcademicRuleProfile` LOT 1.1.  
**Règle :** aucune convention inventée dans `reportCardEngine.js`. Profil historique / incomplet = fail-closed.

Helpers utilisés exclusivement : `weightedContribution`, `percentageFromWeighted`, `assignRanks`, `isCalculablePassRule`, `assertScoreBounds`, constantes `AGGREGATION_MODE_V1` / `PERCENTAGE_MODE_V1` / `ROUNDING_STAGE_V1` / `RANKING_METRIC_V1` / `PASS_RULE_METRIC_V1`.

| Slot | Contrat + contexte | Sinon |
|---|---|---|
| `PERIOD_POINTS` / `PERIOD_MAX` | Agrégation calculable **et** `period_id` colonne/section | historique → `CALCULABILITY_COEFFICIENT_AGGREGATION` ; sans période → `INVALID_SLOT_CONTEXT` |
| `ANNUAL_POINTS` / `ANNUAL_MAX` | Agrégation calculable, `annual !== false`, **sans** `period_id` | historique → `CALCULABILITY_*` ; contradiction → `INVALID_SLOT_CONTEXT` |
| `TOTAL` | Points période si `period_id`, sinon points annuels si `annual` | `INVALID_SLOT_CONTEXT` si ni période ni annuel |
| `SUBTOTAL` | Points du sous-ensemble : `period_id` et/ou `score_component_id` | `INVALID_SLOT_CONTEXT` si aucun des deux |
| `PERCENTAGE` | `100 × points / max_points` via helpers LOT 1.1, scope colonne | fail-closed historique / `WEIGHTED_MAX_ZERO` |
| `RANK` disabled | `NOT_APPLICABLE` / `RANKING_DISABLED` | — |
| `RANK` enabled | `ranking.metric = PERCENTAGE` + agrégation + **`cohort` explicite obligatoire**. `assignRanks` sur pourcentage **interne**. Aucun tie-break ID/ordre. | `CALCULABILITY_RANKING_METRIC` / `COHORT_REQUIRED` / `COHORT_INCOMPLETE` |
| `DECISION` | `isCalculablePassRule` ; `passed = internal >= threshold` (figé) ; métrique `PERCENTAGE` interne | `CALCULABILITY_PASS_RULE_SCALE` pour `{ min_average }` historique |

Arrondi `display_only` : ranking et décision lisent `internal` ; `exposed` est l’affichage.

Résultat canonique si profil calculable : `period_aggregates[]` et `annual.{points,max_points}` en plus des slots.

Profils historiques sans LOT 1.1 : **HOLD** calculabilité — le moteur refuse les slots d’agrégat / `DECISION` / `RANK` activé.

**LOT 4 interdit.**
