# Rapport D3.2 — Classes (métier)

**Type :** Migration D3.2 (audit + verrouillage de périmètre)  
**Module :** Classes métier  
**Sous-périmètre :** Audit complet ; **aucune migration UI** (fiche absente ; liste = `EntityPage` partagé)  
**Pattern(s) :** P-002 (liste cible) · P-003 + P-001 (fiche cible, non existante)  
**Layout(s) :** Aucun appliqué — cibles documentées : `ListLayout` / `RecordLayout`  
**DO concernés :** DO-001, DO-005, DO-010, DO-023, DO-024, DO-028, DO-040, DO-045  
**Anti-patterns vérifiés :** AP-002 (fiche sans résumé — N/A, pas de fiche) · AP liés inventaire KPI — évités  
**Impact runtime :** Non — documentation uniquement  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

**Audit préalable :** [AUDIT-D3.2-classes.md](./AUDIT-D3.2-classes.md)

---

## 1. Périmètre exact

### Inclus

- Audit des routes, pages, hooks, API, permissions, états, legacy et dépendances
- Découpage explicite D3.2a / D3.2b / D3.2c
- Mise à jour du suivi officiel
- Recommandation CTO : ne pas ouvrir D3.3 avant validation ; ne pas inventer de fiche

### Exclus (et non touchés)

- `EntityPage` (toutes entités)
- `ClassStudentsPage` (wrapper students)
- Configuration Classes (D2.5)
- Fiche Élève, Enseignants, Présences, Notes, Planning, Finance
- Toute nouvelle route ou résumé métier inventé

---

## 2. Routes et fichiers

| Élément | Fichier | Action D3.2 |
|---------|---------|-------------|
| Liste | `App.tsx` → `EntityPage entity="classes"` | Documenté, non migré |
| Élèves de classe | `ClassStudentsPage.tsx` | Documenté, non migré |
| Module fields | `entityModules.ts` (`classes`) | Documenté, non modifié |
| Docs | `AUDIT-D3.2-classes.md`, `RAPPORT-D3.2-classes.md`, `SUIVI-MIGRATIONS.md` | Créés / mis à jour |

**Fichiers applicatifs migrés :** aucun.

---

## 3. Layouts utilisés

Aucun en runtime.

| Cible future | Layout | Condition |
|--------------|--------|-----------|
| Fiche Classe | `RecordLayout` | Création produit préalable (D3.2a) |
| Liste Classes | `ListLayout` | Extraction hors monolithe (D3.2b) |
| Membres | `ListLayout` | Après stratégie EntityPage students (D3.2c) |

---

## 4. Primitives utilisées

Aucune nouvelle adoption DS sur écran Classes (pas de surface dédiée migrable sans produit ou EntityPage).

Primitives **déjà** disponibles via runtime EntityPage / D2.6 (re-exports) : Modal, Table, Button, Card, SectionHeader, Toast — hors scope de « migration Classes » propre.

---

## 5. États utilisés

Aucun remplacement d’état legacy sur une page Classes dédiée.

| Classification | Exemples existants (EntityPage) |
|----------------|----------------------------------|
| **États système** | PermissionRoute, busy, empty liste générique, toast réseau |
| **États métier** | Toast validation unicité nom ; refus suppression (`removeSchoolClassFromState`) ; classe archivée (règles inscriptions) |

---

## 6. Composants legacy supprimés

Aucun.

---

## 7. Composants legacy conservés

| Composant | Raison |
|-----------|--------|
| `EntityPage` | Monolithe partagé — même dette que liste Élèves (D3.1) |
| `ClassStudentsPage` | Wrapper students ; migration isolée sans valeur DS |
| Config structure Classes | Hors module métier ; déjà D2.5 |

---

## 8. Dépendances transversales non migrées

Élèves (effectif, ClassStudentsPage), Enseignants/Affectations, Présences, Notes, Emplois du temps, Année scolaire / listes académiques, Overview établissement.

---

## 9. Régressions fonctionnelles

Aucune — aucun code runtime modifié.

---

## 10. Différences visuelles intentionnelles

Aucune.

---

## 11. Dette restante

1. **Pas de fiche Classe** — prérequis produit pour D3.2a (`RecordLayout` + résumé P-001 sur données déjà disponibles uniquement).
2. **Liste Classes dans EntityPage** — D3.2b nécessite extraction ciblée ou stratégie EntityPage globale.
3. **ClassStudentsPage** — D3.2c dépend de la stratégie liste Élèves / EntityPage.
4. Chrome / états EntityPage non alignés 100 % feedback DS (LoadingState, EmptyState dédiés, etc.).

---

## 12. Leçons pour le Design System

1. Un module « métier » sans page dédiée ne peut pas servir de second test `RecordLayout` après Élèves.
2. Documenter tôt « liste seule / pas de fiche » évite les PR qui inventent des surfaces.
3. Les wrappers (`ClassStudentsPage`) ne sont pas des candidats de migration DS autonomes.
4. EntityPage reste le goulot d’étranglement multi-modules : traiter par extraction par entité ou lot dédié, jamais en effet de bord.

---

## 13. Temps de migration estimé

| Lot | Caractérisation d’effort (technique, non calendaire) |
|-----|------------------------------------------------------|
| **D3.2 (cette PR)** | Faible — audit + docs uniquement |
| **D3.2a Fiche** | Élevé — création page produit + wiring données existantes + tests ; hors « pure migration visuelle » |
| **D3.2b Liste** | Élevé — découplage branches `classes` hors EntityPage sans casser autres entités |
| **D3.2c Membres** | Moyen à élevé — dépend liste élèves / permissions students |

---

## 14. Difficulté

| Périmètre | Difficulté |
|-----------|------------|
| Audit D3.2 | **Faible** |
| Migration UI complète Classes aujourd’hui | **Élevée** (blocage structurel) |

---

## 15. États système vs états métier

Voir §5 et audit §6. Règle rappelée : ne pas transformer une erreur métier (ex. unicité de nom, suppression refusée) en `ErrorState` système générique lors des lots futurs.

---

## Tableau de résultat (CTO)

| Élément | Résultat |
|---------|----------|
| Layout(s) utilisé(s) | Aucun (cibles : `ListLayout`, `RecordLayout`) |
| Primitives utilisées | Aucune nouvelle sur surface Classes |
| États utilisés | Aucun remplacement DS sur page Classes |
| Nouveaux composants DS | Non |
| Composants legacy supprimés | Aucun |
| Legacy restant | `EntityPage` classes ; `ClassStudentsPage` ; absence de fiche |
| Régressions fonctionnelles | Aucune |
| Différences visuelles | Aucune intentionnelle |
| DO respectées | Oui (périmètre, non-invention, DO-045) |
| Patterns respectés | Oui — cibles P-002 / P-003 documentées ; non appliquées faute de surface |
| Anti-patterns introduits | Aucun |
| Temps estimé | Audit faible ; migration UI future élevée |
| Difficulté | Audit faible ; migration UI élevée |
| Leçons DS | Pas de fiche = pas de RecordLayout ; EntityPage = lot dédié |

---

## Critères d’acceptation CTO

| Critère | Statut |
|---------|--------|
| Périmètre limité aux Classes métier | Oui (docs ; pas d’élargissement) |
| Aucun changement métier | Oui |
| Backend / API inchangés | Oui |
| Permissions identiques | Oui |
| Layouts = nature des pages | N/A runtime ; cibles correctes documentées |
| Primitives DS | N/A — pas de surface migrée |
| États sans perte sémantique | N/A |
| Contexte navigation préservé | Oui (inchangé) |
| Tests | Inchangés (pas de diff code app) |
| Rapport complet | Oui |
| `SUIVI-MIGRATIONS.md` mis à jour | Oui |
| D3.3 non ouvert | Oui — attendre validation CTO |

---

## Suite recommandée (après validation CTO)

1. **Décision produit** : créer ou non une **fiche Classe** (D3.2a) avec résumé limité aux données existantes (nom, niveau, filière, année, effectif, capacité, statut, actions déjà présentes — **sans** KPI inventés).
2. Ou **D3.2b** : extraire la liste Classes hors EntityPage vers `ListLayout` sans migrer les autres entités.
3. Ne pas démarrer **D3.3 — Enseignants** avant validation explicite CTO de ce lot.
