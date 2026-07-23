# Rapport D3.5a — Audit et verrouillage Présences

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Présences / Appels  
**Sous-périmètre :** D3.5a — inventaire post-`d3.4b` + décisions CTO  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.5-presences.md](./AUDIT-D3.5-presences.md)  
**Base :** `develop` @ `5749e9b5` · tags `d2.8e`, `d3.2a`, `d3.4a`, `d3.4b`

**Numérotation validée CTO :** D3.5 = Présences · Notes / Bulletins hors D3.5

---

## 1. Objectif

Clôturer D3.5a : audit + **arbitrages produit/tech du gate §10**, sans code applicatif.  
Prochain lot autorisé : **D3.5b — Contrat Présences et persistance canonique** (pas de chrome DS).

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.5-presences.md` | Créé puis amendé (Décisions CTO §10) |
| `RAPPORT-D3.5a-audit-presences.md` | Aligné |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**`, `backend/**`, `Mobile/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Surface web canonique | `/presences` (appel / correction admin) |
| Mobile enseignant | Appel terrain — même contrat API |
| Lecture parent / élève | Historique mobile |
| Onglet fiche Élève | 🔒 Hors D3.5b |
| Statuts D3.5 | Présent / Absent / Retard / Justifié (= absence justifiée) |
| Granularité | Journée · clé `établissement + élève + date` |
| Persistance cible | PostgreSQL canonique · JSON BO transitoire |
| Unicité cible | `UNIQUE (school_id, student_id, attendance_date)` |

---

## 4. Décisions CTO (gate levé)

| # | Sujet | Décision |
|---|-------|----------|
| 1 | Surface | `/presences` + mobile Appel (même API) ; fiche Élève / dashboard hors écriture |
| 2 | Statuts | Enum 4 ; Justifié = absence justifiée ; pas de sortie anticipée / double axe |
| 3 | Granularité | Journée seule ; `hour` non persisté ; séances 🔒 |
| 4 | Persistance | PG canonique + contrainte UNIQUE ; JSON BO non autorité durable |
| 5 | D3.5b in/out | Contrat/upsert/alignement/tests **in** ; notifs/exports/bulletins/Notes/chrome **out** |

Détail : [AUDIT §10](./AUDIT-D3.5-presences.md#10-décisions-cto--arbitrages-du-gate).

---

## 5. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.5a Audit + décisions | ✅ Livré (docs) |
| D3.5b Contrat + persistance | 🔓 Prochain — draft après tag `d3.5a` |
| ToolLayout / chrome DS | 🔒 Hors D3.5b |
| Notes / Bulletins | 🔒 Hors D3.5 |
| EntityPage / D3.1–D3.4 | 🔒 Clos |

---

## 6. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit Présences | Oui (D3.5a) |
| Gate §10 | ✅ Décisions intégrées |
| Suite | Tag `d3.5a` → ouvrir D3.5b draft (pas Notes) |
