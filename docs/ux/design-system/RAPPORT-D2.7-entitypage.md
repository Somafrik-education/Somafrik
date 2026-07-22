# Rapport D2.7 — Décomposition EntityPage

**Type :** Infrastructure UI (jalon architecture, au même titre que D2.1 / D2.2)  
**Module :** EntityPage (transversal)  
**Sous-périmètre :** Chrome liste → patterns `entity-list` + composition `ListLayout`  
**Pattern(s) :** P-002 (Liste)  
**Layout(s) :** `ListLayout` (via `EntityListShell`)  
**DO concernés :** DO-005, DO-010, DO-023, DO-024, DO-040, DO-045, DO-046  
**Anti-patterns vérifiés :** pas d’invention de KPI ; pas de déplacement métier  
**Impact runtime :** Oui — UI structurelle sur toutes les routes EntityPage  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non (API `EntityPage` préservée)  
**Navigation :** Inchangée  

Docs : [AUDIT](./AUDIT-D2.7-entitypage.md) · [ARCHITECTURE](./ARCHITECTURE-D2.7-entitypage.md)

---

## 1. Objectif atteint

Réduire la responsabilité UI de `EntityPage` en extrayant des briques DS réutilisables, sans réécrire le monolithe métier, pour débloquer les futures migrations de listes (D3.2b Classes, D3.1b Élèves, D3.3 Enseignants…).

---

## 2. Composants extraits (nouveaux)

| Brique | Chemin | Rôle |
|--------|--------|------|
| `EntityListShell` | `design-system/patterns/entity-list/` | Compose `ListLayout` |
| `EntityListSearch` | idem | Filtre recherche |
| `EntityListTable` | idem | Table + defaults 25 / sortable |
| `EntityListForbidden` | idem | `ForbiddenState` module |

Export public : `@/design-system` → `patterns`.

---

## 3. Restant dans le monolithe (dette assumée)

- Handlers CRUD, validations, audit, pedagogy, payments, contacts
- Builders de colonnes et actions ligne
- Modales form / contact / teacher assignment / payment
- Option builders select
- `PrintButton`, `Field`/`DatePicker`/`PromptDialog` (coexistence)

---

## 4. Cartographie des dépendances EntityPage

| Module | Utilise EntityPage | Niveau de dépendance | Impact migration |
|--------|--------------------|----------------------|------------------|
| Élèves — liste | Oui (`entity="students"`) | **Élevé** | D3.1b |
| Élèves — par classe | Oui (`ClassStudentsPage` → students + `classScope`) | **Élevé** | D3.2c / D3.1b |
| Classes | Oui (`entity="classes"`) | **Élevé** | D3.2b |
| Enseignants | Oui (`entity="teachers"`) | **Moyen** | D3.3 |
| Relations parent-enfant | Oui (`mode="parentChildRelations"`) | **Moyen** | Lot relations dédié |
| Relations (admin) | Oui (`entity="relations"`) | **Moyen** | Lot relations |
| Paiements | Oui (`entity="payments"`) | **Élevé** (modales métier) | Finance ops |
| Messages | Oui (`entity="messages"`) | **Faible** | Communication |
| Annonces | Oui (`entity="announcements"`) | **Faible** | Communication |
| Examens | Oui (`entity="exams"`, planningManaged) | **Moyen** | Examens / Planning |
| Bulletins | Oui (`entity="bulletins"`) | **Faible** | Documents |
| Documents (admin) | Oui (`entity="documents"`) | **Faible** | Admin |
| Contacts | Code path oui ; route redirigée | **Faible** (latent) | Comptes |
| Cours / Affectations | Code path oui ; routes redirigées | **Moyen** (latent) | Enseignants / Planning |
| Présences / Notes | Non (pages dédiées) | — | Hors EntityPage |
| Fiche Élève | Non (`StudentWorkspacePage`) | — | D3.1 ✅ |

**Lecture :** toute extraction de chrome (ce lot) impacte **immédiatement** toutes les lignes « Oui ». Les extractions futures de modales/colonnes doivent être lues avec le niveau de dépendance pour calibrer le risque.

---

## 5. Différences visuelles intentionnelles

| Avant | Après | Intention |
|-------|-------|-----------|
| Liste dans `Card` bordée | `ListLayout` sans Card enveloppante | Alignement P-002 / layouts D2.2 |
| Actions dans `SectionHeader` | Primary / Secondary séparés dans header ListLayout | DO-002 / structure slots |
| Denial texte dans Card | `ForbiddenState` | DO-005 / DO-031 |
| Bannières `<p>` custom | `InlineAlert` info / warning | Feedback D2.4 |

Comportement métier (CRUD, filtres, permissions, liens) : **inchangé**.

---

## 6. Tests

| Suite | Résultat |
|-------|----------|
| `entity-list.test.tsx` | Pass (shell, search, table, forbidden) |
| Suite `src/design-system` | Pass (42 tests) |
| `tsc --noEmit` | Pass (après correctif unused) |

Aucun test EntityPage historique à conserver (couverture absente avant D2.7).

---

## 7. Tableau de résultat CTO

| Élément | Résultat |
|---------|----------|
| Layout(s) utilisé(s) | `ListLayout` via `EntityListShell` |
| Primitives / patterns | Button, Modal, InlineAlert, ForbiddenState, Table, EntityList* |
| États utilisés | ForbiddenState (liste) |
| Nouveaux composants DS | Oui — patterns `entity-list` |
| Responsabilité EntityPage | Réduite (chrome liste externalisé) |
| Logique métier déplacée | Non |
| API EntityPage | Préservée |
| Modules existants | Continuent via même API |
| Legacy restant | Handlers, colonnes, modales, Field/Print/Prompt |
| Régressions fonctionnelles | Aucune intentionnelle |
| Différences visuelles | Oui — ListLayout sans Card (documenté) |
| DO / Patterns / AP | Oui / P-002 / Aucun introduit |
| Temps estimé | Effort moyen (infra, surface large) |
| Difficulté | **Moyenne** (chrome) ; future extraction modales = élevée |
| Leçons DS | Patterns au-dessus des layouts = voie pour EntityPage ; ne pas attendre une migration métier pour extraire le chrome |

---

## 8. Stratégie de migration suivante

1. **Validation CTO D2.7** (ce lot).
2. Lots infra optionnels : EntityFormDialog, row actions shell.
3. **Puis** reprendre **D3.2b Liste Classes** / **D3.1b Liste Élèves** en s’appuyant sur `EntityList*` (risque réduit).
4. **Ne pas ouvrir D3.3 Enseignants** avant validation CTO.

---

## 9. Critères d’acceptation

| Critère | Statut |
|---------|--------|
| Responsabilité EntityPage réduite | Oui |
| Briques réutilisables | Oui (`@/design-system`) |
| Aucune logique métier déplacée | Oui |
| Modules existants fonctionnels | Oui (API stable) |
| Tests passent | Oui |
| Documentation complète + cartographie | Oui |
