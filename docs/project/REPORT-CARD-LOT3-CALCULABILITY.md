# LOT 3 — Calculabilité (consommation LOT 1.1)

**Statut :** P0-1 levé après merge #632 (`develop@d1aa3c6b`). LOT 3 consomme `AcademicRuleProfile` LOT 1.1.  
**Règle :** aucune convention inventée dans `reportCardEngine.js`. Profil historique / incomplet = fail-closed.

| Slot demandé | Contrat LOT 1.1 présent | Sinon |
|---|---|---|
| `PERCENTAGE` | `aggregation.mode` + `percentage = points_over_max_100` + `rounding.stage = display_only` ; `PERCENTAGE = 100 × points / max_points` via `weightedContribution` / `percentageFromWeighted`. Identité `section_id + column_id + period_id`. | `CALCULABILITY_PERCENTAGE_WITHOUT_MAX` ou `CALCULABILITY_COEFFICIENT_AGGREGATION` |
| `PERIOD_*` / `ANNUAL_*` / `TOTAL` / `SUBTOTAL` | Réservés : pas de sémantique slot distincte au-delà du pourcentage période. Fail-closed. | `CALCULABILITY_COEFFICIENT_AGGREGATION` |
| `RANK` enabled | `ranking.metric = PERCENTAGE` + agrégation calculable. | `CALCULABILITY_RANKING_METRIC` |
| `RANK` disabled | `NOT_APPLICABLE` / `RANKING_DISABLED` (identité structurée). | — |
| `DECISION` | `isCalculablePassRule` (metric PERCENTAGE + threshold + aggregation). | `CALCULABILITY_PASS_RULE_SCALE` (`min_average` historique non calculable) |

## Ce qui reste déterminable sans invention

- Cellules `period × composante` : N/A ≠ 0 ; `0` NUMERIC ; bornes via `assertScoreBounds`.
- Doublon de faits `(student_id, subject_id, period_id, score_component_id)` → `DUPLICATE_FACT`.
- Présence structurée : section / column / row / identity_fields / metadata_fields, sans indexation par seul `id`.
- `per_subject` exige `subject_applicable` booléen explicite.
- Profil/schema toujours revalidés (pas de confiance sur `layer`).
- Déterminisme / ordre d’entrée / tenant envelope / interdiction country-school.

Profils historiques sans LOT 1.1 : **HOLD** calculabilité — le moteur refuse les slots d’agrégat / `DECISION` / `RANK` activé.

**LOT 4 interdit.**
