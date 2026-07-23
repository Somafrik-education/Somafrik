# Rapport D3.4a — Audit et verrouillage Parents / Responsables

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Parents / Responsables  
**Sous-périmètre :** D3.4a — inventaire post-`d3.2a` + verrouillage + décisions CTO  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.4-parents.md](./AUDIT-D3.4-parents.md)  
**Base :** `develop` @ `045ef54e` · tags `d2.8e`, `d3.2a`

**Numérotation validée CTO :** D3.3 = Enseignants · D3.4 = Parents / Responsables

---

## 1. Objectif

Clôturer le jalon D3.4a : audit + **arbitrages produit/tech du gate §10**, sans code applicatif.  
Prochain lot autorisé : **D3.4b — Contrat d’identité Parents et convergence des relations** (pas de chrome DS).

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.4-parents.md` | Créé puis amendé (Décisions CTO §10) |
| `RAPPORT-D3.4a-audit-parents.md` | Aligné |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**`, `backend/**`, `Mobile/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Liste Parents dédiée / entité `parents` | Absente — 🔒 non retenue |
| Parents & élèves (`ParentChildRelationsPage`) | Surface admin **canonique** à court terme |
| Workflow D2.8d3 | ✅ Extrait — JSX picker reste assembleur |
| Fiche Parent | Absente — 🔒 D3.4 |
| Responsables fiche Élève (C1.3) | Surface distincte (élève-centrée) |
| Identité `fromContactId` | Divergence actuelle → contrat cible `contact.id` (D3.4b) |
| E2E 0012 | Seed double à corriger en D3.4b |

---

## 4. Décisions CTO (gate levé)

| # | Sujet | Décision |
|---|-------|----------|
| 1 | Surface primaire | **Parents & élèves** (admin liaisons) ; Responsables / Comptes distincts ; pas de nouvelle liste |
| 2 | Fiche Parent | 🔒 Aucune dans D3.4 |
| 3 | Identité | `relations.fromContactId = contact.id` · `user.contactId = contact.id` · `user.id` ≠ clé métier |
| 4 | `parentName` / `parentPhone` | Fallback lecture temporaire → dépréciation ; pas de liaison téléphone-only |
| 5 | D3.4b | **Contrat d’identité + convergence** — interdits : liste / fiche / chrome DS / EntityPage |

Détail normatif : [AUDIT §10](./AUDIT-D3.4-parents.md#10-décisions-cto--arbitrages-du-gate).

---

## 5. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.4a Audit + décisions | ✅ Livré (docs) |
| D3.4b Contrat identité | 🔓 Prochain — draft après tag `d3.4a` |
| Liste / fiche Parent | 🔒 |
| Chrome DS Parents | 🔒 Hors D3.4b |
| Présences / Notes / Finance familles | 🔒 Hors D3.4 |
| D2.8 / EntityPage infra | 🔒 Clos (`d2.8e`) |
| D3.1–D3.3 | 🔒 Clos |

---

## 6. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit Parents | Oui (D3.4a) |
| Gate §10 | ✅ Décisions intégrées |
| Suite | Tag `d3.4a` → ouvrir D3.4b draft (identité, pas UI) |
