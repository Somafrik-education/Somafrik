# Contrat Notes — D3.6b

**Lot :** D3.6b — Contrat Notes et persistance PostgreSQL canonique  
**Statut :** normatif  
**Base :** tag `d3.6a` · décisions CTO [AUDIT-D3.6 §11](./AUDIT-D3.6-notes.md#11-décisions-cto--arbitrages-du-gate)  
**Hors lot :** ToolLayout / chrome DS · refonte `/notes` · onglet Résultats fiche Élève · classements avancés · Bulletins / D3.7 · D3.6c

---

## 1. Surfaces

| Surface | Rôle |
|---------|------|
| Web `/notes` | Gestion évaluations, saisie, verrouillage, publication (contrat inchangé UI) |
| Mobile enseignant | Saisie terrain sur évaluations `open` — **même contrat API** |
| Mobile parent / élève | Lecture des évaluations `published` uniquement |
| Fiche Élève « Résultats » | 🔒 Hors D3.6b |
| Bulletins | 🔒 D3.7 — publication ≠ bulletin |

---

## 2. Évaluation (entité distincte)

**Table PG `evaluations`** — champs minimaux :

`id`, `school_id`, `class_id`, `subject_id`, `teacher_id`, `term_id`, `title`, `type`, `evaluation_date`, `max_score`, `coefficient`, `status`

| Statut PG | Signification |
|-----------|---------------|
| `draft` | Préparation |
| `open` | Saisie autorisée |
| `locked` | Saisie fermée, corrections contrôlées |
| `published` | Visible élèves / parents |
| `archived` | Hors activité courante |

`max_score > 0` · `coefficient > 0`  
Barème et coefficient appartiennent à l’évaluation, pas à la note.

Compat UI : les libellés FR (`Brouillon`, `Ouverte`, `Validée`, `Publiée`, `Annulée`) sont projetés en lecture / acceptés en écriture.

---

## 3. Note

**Table PG `grades`** (contrat cible) :

`id`, `school_id`, `evaluation_id`, `student_id`, `score`, `status`, `comment`, `version`, `created_by`, `updated_by`, `created_at`, `updated_at`

| Statut PG | Score |
|-----------|-------|
| `graded` | obligatoire |
| `absent` | `null` |
| `excused` | `null` |
| `not_submitted` | `null` |
| `exempt` | `null` |

Règles : `0 <= score <= evaluation.max_score` · pas de zéro implicite pour absence.

**Clé d’unicité :**

```sql
UNIQUE (school_id, evaluation_id, student_id)
```

Upsert **idempotent**. Concurrence : colonne `version` (409 si conflit).

---

## 4. Granularité

```
une évaluation × un élève = une note
```

Évaluation ∈ établissement → année scolaire → période (`term_id`) → classe → matière.  
Pas de `grade_sessions` dans D3.6b.

---

## 5. Persistance

| Store | Rôle |
|-------|------|
| **PostgreSQL `evaluations` + `grades`** | Source d’autorité canonique |
| JSON BackOffice `evaluations` / `notes` | Transitoire / secours **mémoire uniquement** |

En moteur `postgresql` :
- `POST /api/notes` n’écrit **pas** de JSON durable (fallback mémoire seulement) ;
- `saveBackOfficeState` synchronise d’abord vers PG puis **persiste `notes: []` / `evaluations: []`** dans le blob JSON (pas de seconde autorité durable).

### Migration bases legacy

Ordre obligatoire au démarrage du repository :

1. Schéma non bloquant (`schema.sql` — **sans** index unique global bloquant)  
2. Inventaire évaluations JSON → création / résolution PG (`legacy_json_id`)  
3. Rattachement des notes (`evaluation_id`)  
4. Inventaire anomalies (note sans évaluation résoluble — **pas** de rattachement silencieux)  
5. Déduplication déterministe : `version DESC`, `updated_at DESC`, `created_at DESC`, `id DESC`  
6. Contrôle post-migration  
7. Création de `uq_grades_school_evaluation_student`  
8. Bascule des écritures  

La clause UNIQUE du CREATE (si présente) s’applique aux **nouvelles** bases ; les bases legacy passent par l’index créé après dédup.

---

## 6. Calcul canonique

Moteur normatif : `backend/services/gradeBookService.js` (+ helpers `gradesCanonical`).

```
normalized_score = score / max_score
weighted_average = sum(normalized_score × coefficient) / sum(coefficients éligibles)
```

Conversion `/20` uniquement pour affichage / format attendu.  
Exclus du dénominateur : `absent`, `excused`, `not_submitted`, `exempt`.  
Arrondi **uniquement** à l’affichage.

---

## 7. API

`POST /api/notes` : upsert par clé `(school, evaluation, student)` — PG canonique.  
`GET /api/notes`, `GET /api/students/:id/notes` : lecture ; parent/élève → évaluations `published` uniquement.  
Évaluations : persistence PG via merge runtime + migration / upsert repository (pas de seconde autorité JSON durable).

Publication d’une évaluation → visibilité des notes · **ne fabrique pas** de bulletin (D3.7).
