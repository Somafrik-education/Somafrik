# Contrat UX textuel — Lots 0 et 1 (maquette Admin établissement)

**Statut :** contrat de test L0/L1 — **pas** une parité pixel Web/Mobile (#577 §8).  
**Surfaces concernées :** Accueil établissement, drawer school_admin, KPI finance « Impayés » s’il reste affiché, Documents/Rapports s’ils restent visibles.  
**Fichier maquette d’origine :** `somafrik-admin-content-screens-v2.html` (Admin établissement). Les règles ci-dessous sont les exigences **textuelles** applicables à L0/L1, versionnées pour les tests.

Constantes machine : `Mobile/src/lib/pariteL0L1UxContract.ts`.

---

## 1. Ce que la maquette impose (texte, pas pixels)

### Accueil établissement

- Coque unique : identité → mission → **Vue métier** (≤ 4 KPI) → actions rapides → navigation basse.
- Un KPI disparaît s’il n’a pas de permission / destination réelle (fail-closed). Aucun KPI « pour faire joli ».
- Chaque KPI cliquable a un **rôle bouton** et un **libellé accessible** (valeur + nom métier). La couleur seule ne code pas l’état (AP-005 / P12).
- Cibles tactiles **≥ 44 dp**.
- Viewports de recette L0/L1 : **360 / 390 / 430 dp** (complément 320/412 déjà dans la spec Mobile V2).

### Navigation

- P14 : l’utilisateur sait où il est, ce qu’il peut faire, comment revenir.
- Une entrée drawer est soit **opérationnelle** (API canonique), soit **explicitement non opérationnelle** (placeholder distinct empty/forbidden — type Placeholder D1.3), soit **absente**.
- Interdit : CTA qui a l’air d’un succès métier (`Disponible`, compteur cache) sans API.

### Finance — Impayés (si le mot reste à l’écran)

- Le signal « Impayés » désigne le **ledger d’obligations** (reste dû), pas les reçus `pending`.
- 401 → état non authentifié, pas un `0` succès.
- 403 → état interdit, pas un `0` succès.
- Empty ledger → empty explicite, distinct de l’erreur.
- Isolation : uniquement l’établissement du principal (header / contexte école).
- Neutralité de solution #577 : **brancher ce ledger** ou **retirer le libellé** ; les tests n’imposent pas l’URL dans les écrans.

### Documents / Rapports (L0)

- #577 : retrait, masquage, **ou** état non opérationnel explicite.
- Interdit : « Disponible » / « Centre MVP » / totaux cache présentés comme rapport canonique.

---

## 2. Ce que la maquette n’impose pas

- Reproduction pixel du Web.
- Superadmin / Admin Pays Mobile (Web-only).
- PSP / Mobile Money (hors L1).
- Lots L2…L9.

---

## 3. Mapping tests

| Règle | Test |
|---|---|
| Entrées plateforme / MVP non opérationnelles | L0-01…L0-10 |
| Documents : 3 options #577 | L0-04 |
| A11y KPI | L0-11 |
| 360/390/430 Accueil | L0-12 |
| Impayés ≠ reçus **ou** libellé retiré | L1-01, L1-02, L1-04, L1-09 |
| Client unpaid dans la couche API seulement si le libellé reste | L1-05 |
| 401/403 simulés | L1-06 |
| Isolation établissement simulée | L1-07 |
| 360/390/430 si Impayés reste | L1-10 |
| Écran dédié Impayés / navigation / états UX | L1-UX-01…L1-UX-10 |
