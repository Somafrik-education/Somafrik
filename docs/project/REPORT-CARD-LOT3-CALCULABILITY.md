# LOT 3 — P0 PRE-GATE calculabilité (LOT 1)

**Statut :** HOLD — 5 points non déterminables depuis `AcademicRuleProfile` LOT 1.  
**Base :** `develop@9fb6124a9f5fd0be3cc17abb96eb4fe0243281f0`  
**Règle :** le moteur LOT 3 n’invente aucune convention absente de LOT 1. Pas de micro-correctif LOT 1 silencieux.

Le pré-gate #629 exige de figer sans ambiguïté cinq points **avant** une GREEN complète des agrégats / ranking / décision. Inspection du contrat LOT 1 (`backend/lib/reportCard/academicRuleProfile.js`) :

| # | Question | Ce que LOT 1 fournit | Écart | Comportement LOT 3 |
|---|---|---|---|---|
| 1 | Formule points/max avec `coefficient` | `coefficient` numérique optionnel par composante ; `max` optionnel. Aucune clé `aggregation`, `points = score * coefficient` vs moyenne pondérée, ni règle si `coefficient` est omis. | **Non déterminable.** | `CALCULABILITY_COEFFICIENT_AGGREGATION` dès qu’un slot `PERIOD_POINTS` / `PERIOD_MAX` / `ANNUAL_*` / `TOTAL` / `SUBTOTAL` est demandé. |
| 2 | `PERCENTAGE` si `max` absent | `max` est optionnel. Aucune échelle par défaut, aucun `percentage_base`. | **Non déterminable.** Même avec `max` présent, le numérateur dépend du gap #1. | `CALCULABILITY_PERCENTAGE_WITHOUT_MAX` si une composante applicable n’a pas de `max` ; `CALCULABILITY_COEFFICIENT_AGGREGATION` si le schema demande `PERCENTAGE`. |
| 3 | Échelle de `pass_rule.min_average` | `{ min_average: number ≥ 0 }` uniquement. Pas de `scale`, `unit`, `metric` (pourcentage vs /20 vs points). | **Non déterminable.** Interdit d’interpréter `10` comme 10/20. | `CALCULABILITY_PASS_RULE_SCALE` si `DECISION` est demandé. |
| 4 | Ranking / décision sur valeur interne vs arrondie | `rounding.{decimals,mode}` existe. Aucun `rounding.stage`, `rank_on`, `decide_on`. | **Non déterminable.** | `CALCULABILITY_ROUNDING_STAGE` si ranking activé **ou** `DECISION` demandé. L’arrondi **exposé** des cellules NUMERIC reste possible (modes LOT 1 explicites). |
| 5 | Ties `competition` vs `min` vs `dense` | Trois identifiants autorisés. Aucune sémantique (1224 vs 1334 vs 1223). `competition` et `min` sont souvent synonymes ailleurs, donc les garder distincts sans définition est ambigu. Aucune métrique à classer (`ranking.metric`). | **Non déterminable.** | Si `ranking.enabled === false` : aucun rang métier inventé. Si activé : `CALCULABILITY_RANKING_METRIC` (et pas d’invention de ties). |

## Ce qui EST déterminable (implémentable sans convention inventée)

- `componentApplies` / `resolveScoreCell` : N/A ≠ 0 ; `0` NUMERIC.
- Intersection `period_id × score_component_id` du schema LOT 2.
- `presence.when` limité à `period_id` / `score_component_id` / `slot` (évaluation déclarative, pas d’eval JS).
- Modes d’arrondi `half_up` / `half_even` / `down` + `decimals` **sur une valeur de cellule déjà numérique**.
- `ranking.enabled === false` ⇒ pas de `RANK` métier.
- Déterminisme / ordre d’entrée / tenant envelope / fail-closed faits invalides / interdiction country-school.

## Décisions CTO demandées (micro-correctif LOT 1 ou note contractuelle)

Sans ces décisions, LOT 3 ne produira **pas** `PERIOD_POINTS`, `PERCENTAGE`, `RANK` (si enabled) ni `DECISION`.

1. Formule canonique : `points = numeric * coefficient` et `max_points = max * coefficient`, avec `coefficient` omis = 1 ? Ou moyenne `sum(score*c)/sum(c)` ?
2. `PERCENTAGE = 100 * points / max_points` uniquement si tous les `max` applicables sont présents, sinon fail-closed ?
3. `min_average` comparé à quelle métrique, sur quelle échelle (ex. même unité que `max` de composante, ou pourcentage 0–100) ?
4. Ranking et `pass_rule` lisent-ils `internal` ou `exposed` (arrondi) ?
5. Définition exacte `competition` / `dense` / `min`, et métrique classée (points période, annuel, pourcentage) ?

**LOT 4 interdit** tant que ce HOLD calculabilité n’est pas tranché et que LOT 3 n’est pas fusionné.
