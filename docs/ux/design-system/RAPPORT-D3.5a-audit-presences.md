# Rapport D3.5a — Audit et verrouillage Présences

**Type :** Audit / scope lock (documentation uniquement)  
**Module :** Présences / Appels  
**Sous-périmètre :** D3.5a — inventaire post-`d3.4b` + verrouillage sous-lots  
**Impact runtime :** Non  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit :** [AUDIT-D3.5-presences.md](./AUDIT-D3.5-presences.md)  
**Base :** `develop` @ `5749e9b5` · tags `d2.8e`, `d3.2a`, `d3.4a`, `d3.4b`

**Numérotation :** D3.5 = Présences · D3.4 = Parents (clos) · Notes hors lot

---

## 1. Objectif

Ouvrir le jalon Présences dans la stratégie **audit → décisions → implémentation incrémentale → validation → tag**, sans écrire de code applicatif tant que le gate §10 n’est pas levé.

Pourquoi Présences avant Notes : fondations Élèves / Classes / Parents stables ; Notes/Bulletins consommeront ensuite les présences sans dette prématurée.

---

## 2. Livrable

| Document | Action |
|----------|--------|
| `AUDIT-D3.5-presences.md` | Créé |
| `RAPPORT-D3.5a-audit-presences.md` | Créé |
| `SUIVI-MIGRATIONS.md` / `README.md` | Alignés |

**Fichiers `web/src/**`, `backend/**`, `Mobile/**` :** aucun.

---

## 3. Constats clés

| Élément | Statut |
|---------|--------|
| Outil web `/presences` | Présent — legacy P-007 non DS |
| Appel mobile | Présent — même API batch |
| Onglet fiche Élève web | Catalogué, non implémenté |
| Granularité | Journée seule |
| Statuts | Présent / Absent / Retard / Justifié |
| Persistance | PG `attendance` + fallback JSON BO |
| Notifications parents | Non implémentées (promesse UI) |
| `attendance_sessions` / demi-journée | Absents |
| Chrome DS | 🔒 0 % |

---

## 4. Périmètre verrouillé

| Sous-lot | Décision |
|----------|----------|
| D3.5a Audit | ✅ Livré (docs) |
| Gate §10 (surface / statuts / granularité / notifs / exports) | 🔒 Décision CTO |
| D3.5b Migration incrémentale | 🔒 Après §10 |
| Notes / Bulletins | 🔒 Hors D3.5a |
| EntityPage / D3.1–D3.4 | 🔒 Clos — ne pas rouvrir |

---

## 5. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Changement fonctionnel | Non |
| Code applicatif modifié | Non |
| Audit Présences ouvert | Oui (D3.5a) |
| Sous-lots verrouillés | Oui |
| Suite | Arbitrages §10 → tag `d3.5a` → D3.5b uniquement sur instruction |
