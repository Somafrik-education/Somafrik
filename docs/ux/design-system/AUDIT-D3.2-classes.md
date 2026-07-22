# Audit — D3.2 Classes (métier)

**Statut :** descriptif (pré-migration) — **aucune modification de code avant ce document**  
**Module :** Classes métier (`/etablissement/classes`)  
**Date :** 2026-07-22  
**Référence DS :** Design System Somafrik (`@/design-system`)  
**Hors périmètre explicite :** configuration Classes D2.5 (`ConfigurationPage` / structure), fiche Élève (D3.1), Enseignants, Présences, Notes, Emplois du temps, Finance

---

## 1. Synthèse exécutive

| Constat | Détail |
|---------|--------|
| **Fiche Classe** | **Absente** — confirmé par le code et par [architecture-pages-metier.md](../architecture-pages-metier.md) (« Liste ; pas de fiche classe ») |
| **Liste Classes** | `EntityPage entity="classes"` — monolithe partagé (~2600 LOC) |
| **Membres / élèves de classe** | `ClassStudentsPage` → `EntityPage entity="students" classScope=…` |
| **Composants dédiés** | Aucun `components/classes/**` |
| **Écran générique** | **Oui** — `EntityPage` est le cœur du module |
| **Migration DS sûre sans produit** | **Non** pour une fiche (n’existe pas) ; **Non** pour la liste sans extraire / toucher `EntityPage` (même risque que liste Élèves différée en D3.1) |

**Recommandation d’audit :** verrouiller le périmètre UI de D3.2 ; découper en sous-lots **après** décision produit (fiche Classe) ou PR dédiée EntityPage (liste). Ne pas inventer de fiche ni migrer silencieusement d’autres modules.

---

## 2. Routes concernées

| Route | Guard | Composant | Nature produit | Périmètre D3.2 |
|-------|-------|-----------|----------------|----------------|
| `/etablissement/classes` | `PermissionRoute view="classes"` | `EntityPage entity="classes"` | Liste CRUD métier | Candidat **D3.2b** (bloqué EntityPage) |
| `/etablissement/classes/:className/eleves` | `PermissionRoute view="students"` | `ClassStudentsPage` | Liste élèves filtrée + retour classes | Candidat **D3.2c** (couplé Élèves / EntityPage) |
| `/classes` | — | `Navigate` → `/etablissement/classes` | Alias | Navigation seule |
| `/parametres/structure` (section Classes config) | Paramètres | `ConfigurationPage` | Config pédagogique | **Hors périmètre** (D2.5) |
| `/etablissement/eleves/:id…` | students | `StudentWorkspacePage` | Fiche élève | **Hors périmètre** (D3.1) |
| Planning / présences / notes filtrés par classe | — | pages dédiées | Outils transverses | **Hors périmètre** |

Fichiers de routage : `web/src/App.tsx`, nav `web/src/pages/etablissement/MonEtablissementLayout.tsx`, tuile overview `EtablissementOverviewPage.tsx`.

---

## 3. Pages et composants

### 3.1 Pages

| Fichier | Rôle |
|---------|------|
| `web/src/pages/EntityPage.tsx` | UI + logique liste / CRUD / modales pour `entity="classes"` (et autres entités) |
| `web/src/pages/etablissement/ClassStudentsPage.tsx` | Wrapper 14 LOC : décode `className`, redirige si vide, rend `EntityPage` students + `classScope` |
| `web/src/lib/entityModules.ts` | Définition module `classes` (champs, colonnes, labels, feature) |

### 3.2 Composants locaux Classes

**Aucun.** Pas de `ClassWorkspacePage`, pas de dossier `components/classes/`.

### 3.3 Branches Classes dans `EntityPage` (extrait)

- Colonnes + colonne calculée **Effectif** (`studentCount` via élèves scopés)
- Action ligne **Élèves** → `/etablissement/classes/:name/eleves` (si `students.canRead`)
- Validation unicité nom (`validateUniqueClassName`)
- Suppression via `removeSchoolClassFromState` + audit `classes.delete`
- Options `classNames` filtrées (disponibles / non déjà utilisées)
- Lien « ← Retour aux classes » quand `classScope` est actif (vue élèves de classe)

### 3.4 Définition métier (champs existants)

Depuis `entityModules` clé `classes` :

- `name`, `level`, `track`, `cycle`, `schoolYear`, `capacity`, `mainRoom`, `status` (Active / Archivée)
- Colonnes liste : `name`, `level`, `track`, `status` (+ effectif calculé en UI)

Pas de champ « enseignant principal » dédié en module classes (affectations côté enseignants / assignments).

---

## 4. Hooks, API, permissions, validations

| Domaine | Mécanisme actuel | Note migration |
|---------|------------------|----------------|
| **État / API** | `useData()` → `state.classes` + `update` / `persistPatch` | Ne pas modifier contrats |
| **Auth / école** | `useAuth`, `useActiveSchool` | Contexte établissement |
| **Permissions** | `getEntityFeaturePermissions` + feature « Classes » ; vue `classes` ; action Élèves sous perm. students | Inchangées |
| **Validations** | `validateUniqueClassName` ; règles suppression `removeSchoolClassFromState` ; CLASSE-003 (archivée hors nouvelles inscriptions côté autres entités) | Ne pas réécrire |
| **Audit** | `AUDITED_ENTITY_KEYS` inclut `classes` | Conserver |
| **Hooks dédiés classes** | Aucun hook `useClass*` isolé | Logique dans EntityPage + libs |

---

## 5. Navigation, overlays, tableaux, badges

| Élément | État actuel |
|---------|-------------|
| **Navigation** | Onglet Mon établissement → Classes ; deep-link élèves de classe ; retour lien brand dans EntityPage si `classScope` |
| **Overlays** | Modale create/edit EntityPage (Modal runtime déjà DS via D2.6 re-exports) |
| **Tableau** | `Table` EntityPage (re-export DS) |
| **Badges / statuts** | Statut texte colonne (`Active` / `Archivée`) — pas de `StatusBadge` dédié classes observé |
| **Recherche / filtres** | Recherche EntityPage générique — ne pas ajouter de filtres |
| **Pagination** | Comportement EntityPage existant |

---

## 6. États loading / error / empty / forbidden

| État | Classes métier aujourd’hui | Classification |
|------|----------------------------|----------------|
| Chargement / busy | `busy` EntityPage + toasts | Système (UI générique) |
| Erreur persist / validation | `showToast(..., "error")` | Métier si message validation ; système si réseau |
| Liste vide | Empty EntityPage (pattern générique) | Système d’écran liste |
| Accès refusé | `PermissionRoute` + permissions feature | Système / auth |
| Classe introuvable (URL élèves) | Redirect si `className` vide ; sinon scope nom | Métier navigation |

Pas d’usage direct de `LoadingState` / `ErrorState` / `EmptyState` / `ForbiddenState` DS sur une page Classes dédiée (tout passe par EntityPage).

---

## 7. Composants legacy

| Composant | Usage Classes | Action D3.2 |
|-----------|---------------|-------------|
| `EntityPage` | Liste + CRUD + élèves scoped | **Conserver** — extraction = autre lot |
| `ClassStudentsPage` | Wrapper | **Conserver** (no-op DS seul) |
| `components/ui/*` via EntityPage | Indirect (souvent re-export DS) | Dette coexistence D2.6 |
| `StatusBadge` | Non spécifique classes | N/A |
| Config Classes textarea | Paramètres structure | Hors périmètre (déjà D2.5) |

---

## 8. Dépendances transversales (non migrées)

| Module | Couplage | Décision |
|--------|----------|----------|
| **Élèves** | Effectif ; `ClassStudentsPage` ; liens dossiers | Hors D3.2 UI ; ne pas migrer fiche/liste élèves |
| **Enseignants / Affectations** | Options et règles liées aux classes | Hors périmètre |
| **Emplois du temps** | Filtres par classe | Hors périmètre |
| **Présences / Notes** | Sélection de classe | Hors périmètre |
| **Années scolaires / Structure** | `schoolYear`, levels, tracks, classNames config | Config déjà D2.5 ; ne pas rouvrir |
| **Overview établissement** | Compteur classes | Hors périmètre (tuile hub) |

---

## 9. Layouts attendus (si migration un jour)

| Sous-lot | Layout | Pattern | Prérequis |
|----------|--------|---------|-----------|
| **D3.2a — Fiche Classe** | `RecordLayout` | P-003 + P-001 | **Création produit** d’une fiche (hors simple migration visuelle) |
| **D3.2b — Liste Classes** | `ListLayout` | P-002 | Extraction chrome / page dédiée **sans** migrer toutes les entités EntityPage |
| **D3.2c — Membres** | `ListLayout` (liste élèves scoped) | P-002 + DO-024 retour | Après ou avec liste élèves / EntityPage students |

`DashboardLayout` / `ToolLayout` : **non applicables** à l’existant Classes métier (pas de pilotage ni outil dédié).

---

## 10. Risques si on force une migration UI maintenant

1. **Inventer une fiche** → extension fonctionnelle + risque KPI/alertes inventés (interdit).
2. **Migrer tout `EntityPage`** → effet de bord Élèves, Enseignants, Paiements, etc. (interdit silencieusement).
3. **Wrapper ListLayout autour d’EntityPage** → double en-tête / régression chrome.
4. **Toucher uniquement ClassStudentsPage** → gain DS quasi nul ; permissions students ; hors cœur « Classes ».

---

## 11. Décision de périmètre pour la PR D3.2

| Sous-périmètre | Statut proposé | Justification |
|----------------|----------------|---------------|
| Audit + documentation | ✅ Livré | Obligatoire |
| D3.2a Fiche | 🔒 Bloqué produit | Aucune fiche à migrer |
| D3.2b Liste | ⏳ Différé | Même monolithe que liste Élèves |
| D3.2c Membres | ⏳ Différé | EntityPage students + classScope |

**Aucun changement métier / backend / API / permissions / logique dans cette PR.**
