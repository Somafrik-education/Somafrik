# Rapport D3.6a — Audit et verrouillage Notes

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Notes / Évaluations  
**Sous-périmètre :** D3.6a — inventaire post-`d3.5b` + décisions CTO  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.6-notes.md](./AUDIT-D3.6-notes.md)  
**Base :** `develop` @ `b533652c` · tags `d2.8e`, `d3.2a`, `d3.4a`, `d3.4b`, `d3.5a`, `d3.5b`

**Numérotation validée CTO :** D3.6 = Notes · Bulletins = D3.7 · Présences / EntityPage non rouverts

---

## 1. Objectif

Clôturer D3.6a : audit + **arbitrages produit/tech du gate §11**, sans code applicatif.  
Prochain lot autorisé : **D3.6b — Contrat Notes + persistance canonique** (pas de chrome DS, pas de Bulletins).

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.6-notes.md` | Créé puis amendé (Décisions CTO §11) |
| `RAPPORT-D3.6a-audit-notes.md` | Aligné |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**`, `backend/**`, `Mobile/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Surface web canonique | `/notes` (évaluations, saisie, verrouillage, publication) |
| Mobile enseignant | Saisie terrain sur évaluations `open` |
| Lecture parent / élève | Évaluations `published` uniquement |
| Onglet fiche Élève « Résultats » | 🔒 Hors D3.6b |
| Évaluation | Entité distincte · barème + coefficient |
| Note | `evaluation_id` + `student_id` · score selon statut |
| Unicité cible | `UNIQUE (school_id, evaluation_id, student_id)` |
| Persistance cible | PostgreSQL canonique · JSON BO transitoire / mémoire |
| Calcul | Une règle normative backend · web/mobile consommateurs |
| Bulletins | Publication ≠ bulletin · sync actuelle à isoler · **D3.7** |

---

## 4. Décisions CTO (gate §11 levé)

| # | Sujet | Décision |
|---|-------|----------|
| 1 | Évaluation | Entité distincte · statuts `draft/open/locked/published/archived` |
| 2 | Note | Liée à une évaluation · barème/coef sur l’évaluation · UNIQUE school+eval+student |
| 3 | Statuts saisie | `graded/absent/excused/not_submitted/exempt` · pas de zéro implicite |
| 4 | Granularité | évaluation × élève · pas de `grade_sessions` en D3.6b |
| 5 | Persistance | PG canonique (évaluations + notes) · JSON non autorité durable |
| 6 | Migration | Inventaire → résolution eval → dédup → UNIQUE → bascule écritures |
| 7 | Calcul | Une implémentation normative · exclusions 4 statuts · arrondi affichage seul |
| 8 | Interfaces | `/notes` + mobile · fiche Élève / ToolLayout / Bulletins hors D3.6b |
| 9 | Bulletins | Publication ≠ bulletin · sync opportuniste isolée · D3.7 |

Détail : [AUDIT §11](./AUDIT-D3.6-notes.md#11-décisions-cto--arbitrages-du-gate).

---

## 5. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.6a Audit + décisions | ✅ Livré (docs) |
| D3.6b Contrat + persistance | 🔓 Prochain — draft après tag `d3.6a` |
| D3.6c Écrans / ToolLayout | 🔒 Après D3.6b |
| Bulletins (D3.7) | 🔒 Hors D3.6 |
| EntityPage / D3.1–D3.5 / D3.5c | 🔒 Clos |

---

## 6. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit Notes | Oui (D3.6a) |
| Gate §11 | ✅ Décisions intégrées |
| Suite | Tag `d3.6a` → ouvrir D3.6b draft (pas écrans, pas Bulletins) |
