# Rapport D3.6a — Audit et verrouillage Notes

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Notes / Évaluations  
**Sous-périmètre :** D3.6a — inventaire post-`d3.5b` + verrouillage sous-lots  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.6-notes.md](./AUDIT-D3.6-notes.md)  
**Base :** `develop` @ `b533652c` · tags `d2.8e`, `d3.2a`, `d3.4a`, `d3.4b`, `d3.5a`, `d3.5b`

**Numérotation :** D3.6 = Notes · D3.5 = Présences (clos) · Bulletins = **D3.7** (hors lot)

---

## 1. Objectif

Ouvrir le jalon Notes dans la stratégie **audit → décisions → implémentation incrémentale → validation → tag**, sans écrire de code applicatif tant que le gate §11 n’est pas levé.

Pourquoi Notes après Présences : le socle Élèves / Classes / Enseignants / Parents / Présences est stable ; Notes pourra ensuite alimenter les Bulletins (D3.7) sans revenir modifier les contrats précédents.

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.6-notes.md` | Créé |
| `RAPPORT-D3.6a-audit-notes.md` | Créé |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**`, `backend/**`, `Mobile/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Outil web `/notes` | Présent — `GradesEvaluationsPage` legacy P-007 non DS |
| Saisie mobile | Présent — `POST /api/notes` |
| Lecture parent / élève | Présent — filtre évaluations Publiée |
| Onglet fiche Élève « Résultats » | Catalogué, non implémenté |
| Modèle typé | `Evaluation` + `StudentGrade` (NE-*) |
| Persistance | Dual PG `grades` + JSON BO `notes`/`evaluations` |
| Unicité PG | Absente (intégrité JSON seulement) |
| Calculs | Triple GradeBookService non aligné |
| Bulletins | Sync opportuniste + EntityPage — **D3.7** |
| Chrome DS | 🔒 0 % |

---

## 4. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.6a Audit | ✅ Livré (docs) |
| Gate §11 (contrat / granularité / source / calculs / interfaces) | 🔒 Décision CTO |
| D3.6b Contrat + persistance canonique | 🔒 Après §11 |
| D3.6c Migration écrans Notes | 🔒 Après D3.6b |
| Bulletins (D3.7) | 🔒 Hors D3.6 |
| ToolLayout Notes / Présences · D3.5c | 🔒 |
| EntityPage / D3.1–D3.5 | 🔒 Clos — ne pas rouvrir |

---

## 5. Gate CTO (à lever)

Avant D3.6b, figer :

1. Contrat de la note (valeur, barème, coefficient, type d’évaluation, statuts)  
2. Granularité (évaluation, matière, période / trimestre-semestre)  
3. Source canonique (une seule table de notes ; sort des évaluations JSON)  
4. Règles de calcul (moyennes, pondérations, arrondis, exclusions)  
5. Interfaces (enseignant, administration, parent/élève)  
6. Interfaces futures avec Bulletins, classements, statistiques  

Détail et propositions audit : [AUDIT §11](./AUDIT-D3.6-notes.md#11-questions-produit-à-trancher-gate-avant-code).

---

## 6. Séquence recommandée

```
D3.6a  Audit Notes (docs only)          ← ce lot
        ↓
Validation CTO (§11)
        ↓
D3.6b  Contrat Notes + persistance canonique
        ↓
D3.6c  Migration des écrans Notes
        ↓
D3.7   Bulletins
```

---

## 7. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit Notes ouvert | Oui (D3.6a) |
| Sous-lots verrouillés | Oui |
| Suite | Arbitrages §11 → tag `d3.6a` → D3.6b uniquement sur instruction |
