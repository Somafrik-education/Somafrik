# Audit — D3.5 Présences (métier)

**Lot :** D3.5a — Audit et verrouillage du périmètre  
**Statut :** descriptif — **aucun changement de code applicatif**  
**Module :** Présences / Appels (`/presences` + mobile Appel)  
**Date :** 2026-07-23  
**Base de revue :** `develop` @ `5749e9b5` (tags `d2.8e`, `d3.2a`, `d3.4a`, `d3.4b`)  
**Référence DS :** Design System Somafrik (`@/design-system`) · Pattern P-007 (Outil)  
**Prérequis clos :** D2.8 (EntityPage) · D3.1 / D3.1b (Élèves) · D3.2 (Classes) · D3.3 (Enseignants) · D3.4a/b (Parents identité)

**Numérotation :** prochain domaine métier = **D3.5 — Présences**.  
**D3.4** reste Parents / Responsables (clos). Notes / Évaluations restent hors D3.5a.

**Hors périmètre explicite :** Notes / Bulletins / Évaluations, Finance, Chrome DS Parents, Fiche Parent / Liste Parents, réouverture EntityPage (D2.8), inventaire d’une fiche Présence produit, implémentation notifications parents, exports PDF/Excel avancés, migration UI `web/src/**`

---

## 1. Synthèse exécutive

| Constat | Détail (post-`d3.4b`) |
|---------|------------------------|
| **Surface web d’appel** | `PresencesPage` @ `/presences` — outil roll-call legacy (~456 LOC) |
| **Surface mobile d’appel** | `TeacherAttendanceScreen` — Appel (~599 LOC) → même API `POST /api/presences` |
| **Lecture parent / élève** | Mobile `StudentPresencesScreen` + `GET /api/students/:id/presences` |
| **Fiche élève web (onglet Présences)** | Module catalogué (`attendance`) mais **non navigable / non implémenté** |
| **Design System** | 🔒 0 % — `ToolLayout` (P-007) **non consommé** |
| **Granularité** | **Journée** uniquement (upsert student + date) |
| **Statuts runtime** | Enum 4 valeurs : `Présent` · `Absent` · `Retard` · `Justifié` |
| **Doubles chemins** | PG `attendance` **ou** fallback état BackOffice JSON |
| **Notifications parents** | Promesse UI mobile uniquement — **pas** d’envoi backend |
| **Exigences non couvertes** | `attendance_sessions`, demi-journée / séance, sortie anticipée, année académique sur attendance |

**Recommandation D3.5a :** verrouiller le périmètre et les décisions §10 **avant** tout commit métier (D3.5b).  
Ne pas migrer le chrome DS tant que le **contrat de données** (statuts, granularité, surface canonique, persistance) n’est pas figé.  
Ne pas ouvrir Notes sous bannière Présences.

---

## 2. Routes concernées

| Route / nav | Guard | Composant | Nature | Périmètre D3.5 |
|-------------|-------|-----------|--------|----------------|
| `/presences` | `view="presences"` | `PresencesPage` | Outil appel web | **Cœur — surface admin/enseignant** |
| Nav « Appels & présences » | `constants.NAV_ITEMS` | → `/presences` | Entrée latérale pédagogie | Navigation |
| Mobile stack `TeacherAttendance` | Feature Présences | `TeacherAttendanceScreen` | Outil appel | **Cœur mobile écriture** |
| Mobile tab / menu Appel | Rôles enseignant | idem | Entrée rapide | Navigation |
| Mobile `StudentPresences` | Lecture | `StudentPresencesScreen` | Historique enfant / élève | **Lecture** |
| `GET/POST /api/presences` | Auth + droits | `backend/server.js` | API batch | Contrat API |
| `GET /api/students/:id/presences` | Auth scoped | idem | Historique élève | Contrat API |
| `/etablissement/eleves/:id` section attendance | — | **Inexistant** (slug non branché) | — | **🔒 décision produit** |
| Dashboard charts présence | Pilotage | `dashboardCharts*` | Agrégats | **Hors** migration outil (consommation) |
| Notes / Bulletins | — | — | — | **Hors D3.5** |

Fichiers nav : `web/src/App.tsx`, `web/src/lib/constants.ts`, `Mobile/src/navigation/AppNavigator.tsx`, `roleTabPreferences.ts`.

---

## 3. Inventaire pages et composants

### 3.1 Surfaces d’appel / lecture

| Fichier | LOC (approx.) | Rôle | DS |
|---------|---------------|------|----|
| `web/src/pages/PresencesPage.tsx` | ~456 | Roll-call web (classe → statuts → save batch) | Legacy `components/ui` |
| `web/src/lib/presenceMetrics.ts` | ~107 | Statuts, stats, dates, id API élève | Lib partagée |
| `Mobile/src/screens/TeacherAttendanceScreen.tsx` | ~599 | Roll-call mobile | Legacy RN |
| `Mobile/src/screens/StudentPresencesScreen.tsx` | ~100 | Historique + taux | Legacy RN |
| `web/src/design-system/layout/ToolLayout.tsx` | — | Cible P-007 | **Non utilisé** par Présences |

### 3.2 Domaine / backend

| Fichier | Rôle |
|---------|------|
| `backend/db/schema.sql` (`attendance`) | Persistance PG |
| `backend/db/postgresRepository.js` | `upsertAttendance` / mapping statuts |
| `backend/lib/dataIntegrityRules.js` | `validatePresenceWrite`, doublons jour |
| `backend/server.js` | Routes + fallback `savePresencesViaBackOfficeState` |
| `web/src/lib/entityModules.ts` (bloc `presences`) | Métadonnées entité (route dédiée ≠ EntityPage) |
| `Mobile/src/models/Presence.ts` + `data/presences.ts` | **Stale** (démo) vs `catalog.PresenceItem` |

### 3.3 Absents / non livrés (confirmés)

- Onglet Présences fiche Élève web (catalogué, non branché)
- `attendance_sessions` (exigence SOM-DATA-002)
- Demi-journée / séance / `hour` persisté
- Statut « sortie anticipée »
- Notifications absences automatiques
- Export Excel / PDF dédié (seulement `PrintButton` web)
- Tests unitaires `presenceMetrics` / `PresencesPage`

---

## 4. Cartographie API

| Méthode | Path | Comportement |
|---------|------|--------------|
| `GET` | `/api/presences` | Filtre `className`, `date` ; scope locataire / enfants parent |
| `POST` | `/api/presences` | Batch upsert `{ className, date, hour?, items[] }` ; droit `write_presence` |
| `GET` | `/api/students/:id/presences` | Historique élève autorisé |
| Indirect | `GET /api/classes` | `presenceRate` agrégé |
| Indirect | BackOffice state | Tableau `presences` (merge / fallback) |

**Pas** de `PUT`/`PATCH`/`DELETE` unitaire — upsert par élève + jour.

---

## 5. Modèle de données actuel

### 5.1 Document runtime (JSON / API)

| Champ | Notes |
|-------|--------|
| `id` / `publicId` | Souvent `PRE-{date}-{studentApiId}` |
| `schoolCode` | Établissement |
| `studentId` | Matricule / publicId préférés |
| `className` | Libellé classe (couplage string) |
| `date` | UI `DD-MM-YYYY` ; PG ISO |
| `status` | Voir §5.2 |
| `present` | `true` si Présent ou Retard |
| `reason` | Partiel (web « Justifié » / mobile « Maladie ») |
| `hour` | Envoyé au POST — **non persisté** PG |
| `savedAt` | Fallback état BO |

### 5.2 Statuts

| UI / JSON | PG | Compté « présent » (taux) |
|-----------|-----|---------------------------|
| `Présent` | `present` | Oui |
| `Retard` | `late` | Oui |
| `Absent` | `absent` | Non |
| `Justifié` | `excused` | **Non** (statut exclusif, pas « Absent + flag ») |

### 5.3 Postgres `attendance`

Colonnes : `id`, `school_id`, `student_id`, `class_id`, `teacher_id`, `attendance_date`, `status`, `reason`, audit timestamps.  
Index `(student_id, attendance_date)` — **pas** de contrainte UNIQUE explicite ; upsert = élève + date.

### 5.4 Écarts vs langage produit / exigences

| Attendu produit / SOM-* | État code |
|-------------------------|-----------|
| Absence justifiée / non justifiée (deux axes) | Un seul enum `Justifié` |
| Sortie anticipée | Absente |
| Séance / demi-journée / `attendance_sessions` | Absentes |
| `academic_year_id` sur attendance | Absent |
| Justificatifs structurés | `reason` libre / hardcodé |

---

## 6. Doublons et risques d’intégrité

1. **Double persistance** — PG upsert **ou** fallback JSON BackOffice.  
2. **Deux UIs d’écriture** — web vs mobile (UX et `reason` divergents).  
3. **Libs métriques dupliquées** — `presenceMetrics.ts` ≈ `Mobile/.../schoolMetrics.ts`.  
4. **Règles d’unicité divergentes** — intégrité (élève+jour+classe) vs PG/BO (élève+jour).  
5. **Formats de date** — `DD-MM-YYYY` vs ISO (mitigé par normalize).  
6. **Seeds** — `Present` EN / `present:true` sur Justifié possibles → biais taux.  
7. **Notification parents** — message UI sans backend.  
8. **Entity module vs page dédiée** — métadonnées EntityPage résiduelles.

---

## 7. Dépendances transversales

| Module | Couplage | Décision D3.5a |
|--------|----------|----------------|
| **Élèves** | Id API, blocage archivés, historique | Consommation — ne pas migrer fiche |
| **Classes** | Appel par `className` ; taux classe | Consommation D3.2 stable |
| **Enseignants** | Scope affectations ; `teacher_id` PG | Consommation D3.3 |
| **Parents** | Lecture enfants (D3.4b identité) | Lecture seule ; notif 🔒 |
| **Notes / Bulletins** | Aucun feed attendance aujourd’hui | **Hors** — après Présences stabilisées |
| **Dashboard** | Donuts / rates | Hors outil (agrégats) |
| **Abonnements** | Feature `write_presence` | Conserver |

---

## 8. Design System

| Surface | État |
|---------|------|
| Outil web Présences | Legacy — cible théorique `ToolLayout` (P-007) |
| Mobile Appel / Mes présences | Legacy RN |
| SUIVI consolidé | Présences 🔒 0 % |
| Migration chrome DS | **Interdite** tant que §10 non levé (D3.5b+) |

---

## 9. Sous-lots D3.5 — verrouillage

| Sous-lot | Statut | Justification |
|----------|--------|---------------|
| **D3.5a — Audit / verrouillage** | ✅ Ce lot (docs) | Gate avant tout code |
| **Décisions produit §10** | 🔒 Gate CTO | Surface, statuts, granularité, notifs, exports |
| **D3.5b — Migration incrémentale** | 🔒 | Seulement après §10 |
| **Onglet Présences fiche Élève** | 🔒 Produit | Non implémenté — ne pas inventer |
| **Séances / demi-journées** | 🔒 | Extension modèle — décision explicite |
| **Notifications parents** | 🔒 | Hors tant que non décidé |
| **Notes / Bulletins** | 🔒 | Domaine suivant, pas D3.5a |
| **Réouverture EntityPage** | 🔒 | Clos (`d2.8e`) |
| **D3.1–D3.4** | 🔒 | Clos — ne pas rouvrir |

---

## 10. Questions produit à trancher (gate avant code)

Sans réponses → **aucun lot D3.5b / migration UI / refactor API ouvert**.

### 10.1 Surface canonique

1. L’outil d’écriture canonique est-il **web `/presences` + mobile Appel** (même registre API), ou une seule surface prioritaire ?  
2. L’onglet Présences fiche Élève web entre-t-il dans D3.5 ou reste-t-il 🔒 ?  
3. Les vues lecture (parent mobile, dashboard) restent-elles des **consommateurs** hors migration chrome ?

### 10.2 Modèle de statuts

4. Conserver l’enum 4 valeurs (`Présent` / `Absent` / `Retard` / `Justifié`) pour D3.5b, **ou** passer à Absent × justifié/non justifié + éventuelle sortie anticipée ?  
5. Que signifie `Justifié` pour les taux et les bulletins futurs ?  
6. Rôle et schéma de `reason` / justificatifs ?

### 10.3 Granularité temporelle

7. D3.5 reste-t-il **journée seule** (état actuel) ?  
8. Demi-journée / séance / `attendance_sessions` : 🔒 différé ou inclus ?  
9. Que faire de `hour` (accepté puis droppé) et `arrivalTime` mobile local ?

### 10.4 Relations & persistance

10. Identifiant classe : rester sur `className` string ou migrer vers id classe ?  
11. Persistance canonique : **PG only** vs conservation du fallback JSON BO ?  
12. Clé d’unicité officielle : élève+jour vs élève+jour+classe ?

### 10.5 Impacts futurs (scope in / out)

13. Notifications parents absences : **out** de D3.5b ?  
14. Stats avancées / exports PDF-Excel : **out** sauf print existant ?  
15. Alimentation bulletins : **out** (Notes ultérieures) ?

---

## 11. Risques si on force une migration maintenant

1. Migrer vers `ToolLayout` sans figer les statuts → refonte UI puis refonte modèle.  
2. Ajouter séances / demi-journées dans le même lot → explosion de scope.  
3. « Activer » les notifications promises en UI → dette produit + perimètre non cadré.  
4. Unifier PG/JSON sans décision → risque de perte ou double écriture.  
5. Ouvrir Notes « parce que liés » → réintroduire de la dette transversale.  
6. Inventer l’onglet fiche Élève sans besoin produit → écran creux.

---

## 12. Livrable D3.5a et merge gate

**Inclus :** ce document, rapport D3.5a, mise à jour suivi / README.  
**Exclus :** tout fichier sous `web/src/**`, `backend/**`, `Mobile/**`, scripts runtime.

| Gate | Attente |
|------|---------|
| Draft PR | Oui |
| Revue CTO | Diff docs + verrou §9–10 |
| CI / Security | Verts (docs-only) |
| UX / API / métier runtime | Aucun changement |

**Suite après validation CTO :** intégrer les arbitrages §10 (section Décisions CTO), tag `d3.5a`, **puis seulement** ouvrir D3.5b (migration incrémentale), sans réouvrir EntityPage ni Notes.
