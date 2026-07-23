# Rapport D3.6b — Contrat Notes et persistance PostgreSQL canonique

**Type :** Contrat données + persistance (pas de chrome DS)  
**Module :** Notes / Évaluations  
**Impact runtime :** Oui  
**Migration chrome DS / ToolLayout :** Non  
**Bulletins / D3.7 / D3.6c :** Hors lot  

**Contrat :** [CONTRAT-D3.6b-notes.md](./CONTRAT-D3.6b-notes.md)  
**Prérequis :** tag `d3.6a`

---

## 1. Objectif

Appliquer les décisions CTO D3.6a §11 : évaluation distincte, note liée, UNIQUE school+eval+student, PG canonique, calcul unique, migration legacy déterministe, JSON mémoire-only.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `CONTRAT-D3.6b-notes.md` | Contrat normatif |
| `schema.sql` | Table `evaluations` · colonnes grades canoniques · score nullable · indexes |
| `gradesCanonical.js` | Statuts, validation score/barème, calcul pondéré, dédup JS |
| `gradeUniqueness.js` | SQL count / dédup / UNIQUE partiel |
| `postgresRepository` | Migration BO→PG · upsert évaluation/note · mapEvaluation/mapGrade · sync save BO |
| `server.js` | Fallback JSON **mémoire seulement** · filtre `published` |
| `saveBackOfficeState` | Transaction sync PG fail-fast → strip JSON ; échec ⇒ pas de vide silencieux |
| `gradesBoPersistence` | Helpers + tests perte silencieuse / normalisation contraintes |
| `gradeBookService.js` | Moteur calcul canonique + exclusions |
| `web/mobile gradeBook` | Consommateurs alignés (exclusions D3.6b, pas de zéro implicite) |
| `dataIntegrityRules` | Contrat note + unicité eval×élève |
| Tests | `noteContract` · `gradeUniqueness` · `gradesMigrationOrder` |

**Interdit (respecté) :** ToolLayout · GradesEvaluationsPage refonte · onglet Résultats · Bulletins / D3.7 · D3.6c.

---

## 3. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Table PG `evaluations` | Oui |
| Contrat PG notes + `version` | Oui |
| `UNIQUE (school_id, evaluation_id, student_id)` | Oui (après dédup) |
| Statuts eval / note | Oui |
| Validation score / barème | Oui |
| Migration legacy déterministe | Oui |
| Anomalies `evaluation_id` manquant | Oui (warn, pas de fusion silencieuse) |
| Calcul pondéré canonique | Oui |
| JSON non durable en mode PG | Oui (fallback mémoire + strip BO) |
| Calcul web/mobile aligné | Oui (exclusions, pas moteur divergent) |
| Filtre parent/élève published | Oui |
| Chrome DS / Bulletins | Non |
