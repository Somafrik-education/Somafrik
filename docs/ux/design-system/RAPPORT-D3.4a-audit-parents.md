# Rapport D3.4a — Audit et verrouillage Parents / Responsables

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Parents / Responsables  
**Sous-périmètre :** D3.4a — inventaire post-`d3.2a` + verrouillage sous-lots  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.4-parents.md](./AUDIT-D3.4-parents.md)  
**Base :** `develop` @ `045ef54e` · tags `d2.8e`, `d3.2a`

**Numérotation :** D3.3 = Enseignants (déjà livré). Le prochain bloc métier Parents est **D3.4**.

---

## 1. Objectif

Ouvrir le jalon Parents dans la stratégie officielle **audit → verrouillage → migration incrémentale → validation → tag**, sans écrire de code applicatif tant que le choix produit n’est pas arrêté.

Alignement roadmap CTO :

| Priorité | Module | Décision D3.4a |
|----------|--------|----------------|
| 1 | Parents | **Audit / lock** (ce lot) |
| 2 | Présences | Hors — plus tard |
| 3 | Notes / Évaluations | Hors — plus tard |
| — | Fiche Classe | Reste 🔒 produit (D3.2) |

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.4-parents.md` | Créé |
| `RAPPORT-D3.4a-audit-parents.md` | Créé |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**`, `backend/**`, `Mobile/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Liste Parents dédiée / entité `parents` | Absente |
| Parents & élèves (`ParentChildRelationsPage`) | Wrapper EntityPage mode bundle |
| Workflow D2.8d3 | ✅ Extrait — JSX picker reste assembleur |
| Fiche Parent | Absente — 🔒 produit |
| Responsables fiche Élève (C1.3) | Présent — modèle parallèle aux `relations` |
| Identité `fromContactId` | Divergence web (`users.id`) vs backend (`contactId`) + legacy phone |
| E2E UI web liaisons | Absent ; 0012 seed double |

---

## 4. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.4a Audit | ✅ Livré (docs) |
| Surface / modèle canonique | 🔒 Décision produit + tech |
| Fiche Parent | 🔒 Pas d’UI inventée |
| D3.4b chrome liste (éventuel) | 🔒 Après décisions |
| Présences / Notes / Finance familles | 🔒 Hors D3.4 |
| D2.8 / EntityPage infra | 🔒 Clos (`d2.8e`) |
| D3.1–D3.3 | 🔒 Clos — ne pas rouvrir |

---

## 5. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit Parents ouvert | Oui (D3.4a) |
| Sous-lots verrouillés | Oui |
| Collision numérotation D3.3 | Évitée (Parents = D3.4) |
| Suite | Instruction CTO explicite après décisions §10 de l’audit |
