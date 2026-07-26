# Rapport D3.2a — Audit et verrouillage Classes métier

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Classes métier  
**Sous-périmètre :** D3.2a — inventaire post-D2.8e + verrouillage sous-lots  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.2-classes.md](./AUDIT-D3.2-classes.md)  
**Base :** `develop` @ `4a5684b8` · tag `d2.8e`

---

## 1. Objectif

Actualiser l’audit Classes après clôture D2.8 et livraison D3.2b/c, puis **verrouiller** le périmètre : aucun changement UX / API / métier dans ce lot.

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.2-classes.md` | Réécrit (état runtime actuel) |
| `RAPPORT-D3.2a-audit-classes.md` | Créé |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Fiche Classe | Absente — 🔒 produit |
| Liste (`ClassesListPage`) | ✅ D3.2b |
| Membres (`ClassStudentsPage`) | ✅ D3.2c |
| `components/classes/**` | Absent |
| EntityPage résiduel Classes | Modales / validations / classScope (assembleur) |
| Planning / Notes « par classe » | Hors périmètre D3.2 |

---

## 4. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.2a Audit | ✅ Livré (docs) |
| Fiche Classe | 🔒 Pas d’UI inventée |
| D3.2b / D3.2c | ✅ Clos — ne pas rouvrir |
| D2.8 / EntityPage infra | 🔒 Clos (`d2.8e`) |
| Suite UI Classes | 🔒 Attente instruction CTO / produit |

---

## 5. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit à jour post-D2.8e | Oui |
| Sous-lots verrouillés | Oui |
| Suite | **D3.2 clos** (tag `d3.2a` @ `045ef54e`) — prochain lot roadmap sur instruction CTO |
