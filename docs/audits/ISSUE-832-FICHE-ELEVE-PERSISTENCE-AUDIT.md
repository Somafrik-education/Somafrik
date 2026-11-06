# AUDIT #832 — Fiche élève : modifications non appliquées / non persistées

**Gouvernance :** AUDIT ONLY / HOLD. Aucun correctif produit, aucun merge, aucun déploiement dans cette révision.  
**SHA audité :** `30deaacc` (`develop`)  
**Issue :** https://github.com/Somafrik-education/Somafrik/issues/832  
**Exemple cité :** `/etablissement/eleves/CD-ITR-AS-26-00004`

Si un correctif est décidé : **PR Draft séparée** vers `develop`, puis diff GitHub indépendant CTO avant Ready/Merge.

---

## 1. Cause racine (fichier + lignes)

La fiche Web a **deux autorités incompatibles**.

| Rôle | Source | Fichier |
|---|---|---|
| **Lecture affichée** | `GET /api/students/:studentCode` → PostgreSQL | `web/src/hooks/useStudentWorkspace.ts` L63, `web/src/pages/etablissement/StudentWorkspacePage.tsx` L41-45 |
| **Écriture après « validation » C1.7** | `Map` mémoire (`createMockStudentWorkspaceCommandRepository`) | `web/src/hooks/useStudentEditingContext.ts` L77-80, L141-150 de `studentEditingRepository.mock.ts` |
| **Refetch après succès** | `refreshFromStore()` relit le mock, **pas** `GET` | `StudentIdentityTab.tsx` L82, `StudentGuardiansTab.tsx` L66 |
| **PATCH canonique existant, jamais branché** | `studentsApi.update` → `PATCH /api/students/:id` | `web/src/lib/studentsApi.ts` L111-112 — **0 appelant** dans le dépôt |

Incident utilisateur : confirmation ChangeSet → bannière succès → les champs de l’onglet (alimentés par le dossier GET) ne bougent pas → F5 restitue la ligne PostgreSQL inchangée.

Classification principale : **request absente** (identité / responsables / administratif) + **UI-only** (store mock). Ce n’est pas un cache stale après un UPDATE réussi : **l’UPDATE n’est jamais envoyé**.

Preuves machine : `docs/audits/evidence/issue-832-fiche-eleve-persistence.json`.

---

## 2. Chaîne obligatoire (constat)

```
UI (7 onglets)
  → state/form C1.7 (mock Map)          ✅ local
  → requête HTTP PATCH/POST métier      ❌ identité / responsables / admin
  → API / RBAC / tenant                 ⚠️ PATCH existe, non appelé par la fiche
  → PostgreSQL UPDATE/UPSERT            ❌ pour C1.7 ; ✅ pour C18 si id réel
  → refetch GET dossier                 ❌ refresh() du workspace jamais appelé
  → F5                                  GET inchangé
```

Identifiants : `mapStudentRow` pose `id = studentCode` (`backend/db/classStudentsRepository.js` L146-152). L’URL liste utilise `row.studentCode`. **Pas de décalage matricule/UUID sur la lecture GET.** Le piège est ailleurs : l’éditeur C1.8 se seme depuis DataContext (`state.studentEnrollments` vide) via un id **synthétique** `MIGRATION`, alors que l’affichage inscription utilise les UUID `enrollments.id` du GET dossier.

---

## 3. Matrice onglet → champ → endpoint → table → résultat

Légende résultat : **OK lecture** / **request absente** / **payload incorrect** / **UPDATE absent** / **GET stub** / **UI disabled**.

### 3.1 Vue d’ensemble — lecture seule

| Champ affiché | Source | Endpoint | Table | Résultat |
|---|---|---|---|---|
| Identité / classe / responsables / alertes | `workspace` GET | `GET /api/students/:studentCode` | `students` + `enrollments` + `contact_relations` | OK lecture. Aucun Save. |

Fichier : `web/src/components/students/StudentOverviewTab.tsx`.

### 3.2 Identité — Save C1.7 (incident principal)

Affichage : `workspace.*` (GET). Édition : `editing.identity` (mock semé depuis `GET /api/students` **liste** DataContext).

| Champ formulaire | Affichage fiche | HTTP actuel | Si PATCH était appelé | Table/colonnes PG | Résultat |
|---|---|---|---|---|---|
| `firstName` / `lastName` | en-tête `displayName` (GET) | **aucune** | `PATCH /api/students/:code` `{ firstName, lastName, expectedUpdatedAt }` | `students.first_name`, `last_name` | **request absente** |
| `gender` / `birthDate` / `birthPlace` | `workspace.genderLabel` etc. | **aucune** | idem | `students.gender`, `birth_date`, `birth_place` | **request absente** |
| `phone` / `email` | `parentPhone` / `parentEmail` via `toDomainStudent` L79-80 | **aucune** | PATCH attend `parentPhone` / `parentEmail`, pas `phone` / `email` | `students.parent_phone`, `parent_email` | **request absente** + **payload incorrect** (mapping) |
| `preferredName` / `nationality` / `address` | `person.*` (absent du GET) | **aucune** | **rejetés** par `validateUpdateStudentInput` (clés hors contrat) | pas de colonnes dans ce PATCH | **UPDATE absent** |

Handler Save : `StudentEditingPanel.confirm` → `executeStudentUpdateCommand` → `repository.updateStudentIdentity` → `store.identities.set` (`studentEditingRepository.mock.ts` L141-150).  
Auth PATCH (non utilisé) : `Élèves:UPDATE` (`backend/services/rbacService.js`).  
`expectedUpdatedAt` est **obligatoire** côté API (`classStudentsManagement.js` L301-306) ; le mock C1.7 utilise un `version` dérivé de timestamp, jamais envoyé.

Reproduction logique (sans runtime) :

| Étape | Valeur |
|---|---|
| Avant | GET dossier (ex. prénom PostgreSQL) |
| Saisie | nouveau prénom dans le modal |
| Request payload | **aucune** `PATCH` ; 0 site `studentsApi.update` |
| Status / response | succès **local** `{ success: true, newVersion }` |
| DB après | inchangée |
| Refetch | non déclenché (`refreshFromStore` seulement) |
| F5 | GET initial |

### 3.3 Inscription — C18 HTTP partiel, id d’éditeur faux

| Action | Endpoint | Table | Résultat |
|---|---|---|---|
| Affichage statut / classe | GET dossier `enrollments[]` | `enrollments`, `classes`, `academic_years` | OK lecture |
| Valider / affecter / transférer / clôturer | `POST /api/students/:studentId/enrollments/:enrollmentId/{validate,assign-class,transfer,close}` | `UPDATE enrollments` (`studentEnrollmentC18.js` L339+) | **payload incorrect** si l’éditeur envoie l’id `ENROLLMENT-{studentCode}-…` source `MIGRATION` (`studentEnrollment.ts` L268-285) |
| Overlay après succès mock | rejeté si `source === "MIGRATION"` | — | `StudentWorkspacePage.tsx` L35-37 |
| Seed C18 depuis `GET …/enrollments` | `studentEnrollmentC18Api.list` | — | **0 appelant Web** |
| Permissions | `student.enrollments.*` | — | le bridge `Élèves:UPDATE` **n’accorde pas** C18 (`studentEditingPermissions.ts` L47-51, L68-69) |

Si les boutons C18 sont visibles et cliqués : HTTP part, mais `enrollmentId` synthétique → 404 / transition refusée. Ce n’est pas le même symptôme « succès silencieux » que C1.7.

### 3.4 Responsables

| Surface | Source | HTTP | Table | Résultat |
|---|---|---|---|---|
| Cartes / tableau | GET dossier `guardians[]` | lecture seule | `contact_relations` ⋈ `contacts` | OK lecture (champs urgence / pickup **non lus** : `mapGuardianRow` L291-303) |
| « Modifier le contact » | mock `state.guardians` / `state.studentGuardianRelations` | **aucune** | — | DataContext **n’hydrate pas** ces agrégats (`domainLoaders.ts`) → éditeur souvent vide |
| PATCH contact | clients `contacts` | pas branché sur la fiche | `contacts.phone/email` | **request absente** / **UPDATE absent** côté fiche |

### 3.5 Médical

| Surface | Source | HTTP | Table | Résultat |
|---|---|---|---|---|
| Allergies / traitements / consignes | GET `medical: emptyMedicalProfile()` | — | **aucune table lue** | **GET stub** (`classStudentsRepository.js` L237-246, L883) |
| Boutons Modifier / Valider / Ajouter certificat | disabled | — | — | **UI disabled** + **UPDATE absent** |

Même un F5 ne peut pas montrer un profil médical PostgreSQL : la lecture le force à vide.

### 3.6 Documents

| Surface | Source | HTTP | Table | Résultat |
|---|---|---|---|---|
| Liste / conformité | GET `student_documents` (si relation présente) | lecture | `student_documents` | OK lecture conditionnelle |
| Téléverser / Vérifier / Supprimer | disabled | — | — | **UI disabled** ; pas de PATCH élève-document sur cette fiche |

### 3.7 Historique

| Surface | Source | HTTP | Table | Résultat |
|---|---|---|---|---|
| Timeline | projection C1.6 depuis inscriptions / responsables / docs | aucun store d’événements | dérivé | lecture dérivée (`studentHistory.ts` L9-11) |
| Exporter / Auditer | disabled | — | — | **UI disabled** |
| Audit C1.7 mock | `store.auditLog` mémoire | jamais projeté | — | perdu au F5 |

---

## 4. Preuves réseau / API / DB

### 4.1 Runtime de cet agent

Pas de PostgreSQL, pas d’API, pas de `.env`. La reproduction live (payload, status, `SELECT`, refetch, F5) sur `CD-ITR-AS-26-00004` **n’a pas été exécutée ici**. Elle reste à capturer sur préprod (DevTools + SQL) une fois le HOLD levé pour un test non destructif, ou dans la PR de correctif.

### 4.2 Preuve d’absence de requête (Web)

```
studentsApi.update          → 0 appelant (web + monorepo)
studentEditingRepository.mock.ts → aucun fetch / api.patch / api.post
useStudentWorkspace.refresh → jamais appelé par les onglets après Save
studentEnrollmentC18Api.list → 0 appelant Web
```

### 4.3 Preuve que l’API + PostgreSQL savent écrire **quand** PATCH est appelé

Contrats déjà dans le dépôt (non ré-exécutés sans PG) :

- HTTP : `backend/scripts/verify-students-legacy-cleanup.js` L222-231 — `PATCH /students/:code` `{ parentPhone, expectedUpdatedAt }` → 200 et `parentPhone` renvoyé.
- SQL : `backend/db/classStudentsRepository.js` L937-953 — `UPDATE students SET first_name… parent_phone… WHERE id = $8 AND school_id = $9 AND updated_at = $10`.
- Occupancy 409 : `backend/lib/classStudentsRepository.pg.test.js` L1039-1096.
- Route + RBAC : `backend/server.js` L2208-2243 ; permission `PATCH /api/students/:id` = `Élèves:UPDATE`.

### 4.4 Replay attendu (préprod, non destructif) — à coller dans l’issue après capture CTO

Pour **Identité / téléphone parent** (champ réellement persistable) :

1. GET `/api/students/CD-ITR-AS-26-00004` → noter `parentPhone`, `updatedAt`.
2. Modifier le téléphone dans Identité → Continuer → Confirmer.
3. Onglet Réseau : **0** `PATCH /api/students/…` attendu **aujourd’hui**.
4. `SELECT parent_phone, updated_at FROM students WHERE student_code = 'CD-ITR-AS-26-00004';` inchangé.
5. F5 : même GET.

Contrôle positif Mobile (même API) : `StudentMutationControls.tsx` L140 appelle déjà ce PATCH.

---

## 5. Impacts Web / Mobile (code partagé)

| Client | Écriture identité | Impact #832 |
|---|---|---|
| **Web fiche** | mock C1.7 | cassé (objet de l’issue) |
| **Mobile liste / overflow** | `PATCH /students/:id` réel | **non cassé** pour prénom / nom / `parentPhone` |
| **Web + Mobile lecture** | même `GET /students/:code` | cohérent |
| **C18** | `backend/lib/studentEnrollmentC18.js` partagé | Web : id éditeur faux ; Mobile fiche LOT2 a des testids C18 — à revalider séparément, hors HOLD |
| **Médical** | stub GET des deux côtés | profil toujours vide en lecture API |

Pas de régression Mobile à attendre d’un futur branchement Web sur `studentsApi.update`, **si** le payload reste `{ firstName, lastName, gender, birthDate, birthPlace, parentPhone, parentEmail, expectedUpdatedAt }`.

---

## 6. Régressions récentes (contexte, pas une nouvelle cause)

| Commit | Effet |
|---|---|
| `2e26e4d5` C1.7 « read-scoped writes » | cadre d’édition **volontairement** hors agrégats |
| `40b247e0` consolidation fiche PostgreSQL | lecture GET canonique |
| `be543c32` / `82de8a9a` | overlay C18, **interdit** le fallback `MIGRATION` sur l’affichage |
| LOT 8 ADR | plus de `PUT /backoffice/state` élèves |

Le décalage lecture PG / écriture mock n’a **jamais** été refermé après la consolidation GET.

---

## 7. Correctif minimal proposé (ne pas implémenter dans cette PR)

Ordre recommandé, une PR Draft produit séparée :

1. **Identité persistable** — repository HTTP réel : après ChangeSet, `studentsApi.update(studentCode, { …, expectedUpdatedAt: dossier.updatedAt })` ; mapper `phone`→`parentPhone`, `email`→`parentEmail` ; ignorer `preferredName` / `nationality` / `address` tant que le schéma PATCH ne les porte pas (les retirer de l’UI ou les marquer non persistés).
2. **Refetch** — `await studentsApi.get` + `DataContext.refresh(["students"])` ; ne plus afficher le mock comme vérité.
3. **Semer l’éditeur depuis le dossier GET**, pas depuis la liste DataContext (évite `student.phone` vide alors que `parentPhone` est affiché).
4. **Inscription C18** — semer `editing.enrollments` depuis `workspace` / `GET …/enrollments` (UUID réels) ; ne plus dériver `MIGRATION`.
5. **Responsables** — hors lot minimal, ou PATCH `contacts` dédié ; ne pas laisser un succès mock.
6. **Médical / documents** — laisser disabled **ou** retirer les boutons « à venir » pour ne plus suggérer une écriture.

Hors scope du lot minimal : nationalité, adresse, nom d’usage, notes administratives, canal préféré, allergies (pas de colonnes PATCH actuelles).

---

## 8. Tests à ajouter (PR produit)

| Niveau | Cas |
|---|---|
| Unitaire Web | `confirmSubmit` identité appelle `studentsApi.update` avec `expectedUpdatedAt` ; 0 écriture mock en `MODE !== test` |
| Unitaire Web | mapping `phone` → `parentPhone` ; champs hors contrat absents du body |
| Garde | `rg studentsApi.update` ≥ 1 appelant hors `studentsApi.ts` |
| Intégration API/PG | déjà présents : étendre au parcours fiche (GET → PATCH → GET, même `parent_phone`) |
| E2E Web | Identité : changer `parentPhone` non destructif → Network PATCH 200 → UI refetch → F5 |
| E2E Web | Inscription : `enrollmentId` UUID du GET, pas `ENROLLMENT-…` |
| Mobile | non-régression `updateSchoolStudent` (déjà class A) |

---

## 9. Risques / rollback

| Risque | Mitigation |
|---|---|
| 409 occupancy si `expectedUpdatedAt` mal arrondi | réutiliser le jeton JSON du GET (déjà testé microsecondes PG) |
| PATCH partiel écrase un champ omis | n’envoyer que les clés changées (contrat `validateUpdateStudentInput`) |
| C18 avec mauvais id | 404 aujourd’hui ; après fix, transitions réelles → ** irreversibles** : valider / clôturer seulement en Draft + élève test |
| Médical toujours vide en lecture | correctif lecture séparé si une table métier existe plus tard |

Rollback : revert de la PR produit uniquement. Cette PR d’audit n’a aucun effet runtime.

---

## 10. Verdict

**Cause confirmée.** Pas un cache, pas un UUID d’URL, pas un échec silencieux de `UPDATE students`.

La fiche Web **affiche PostgreSQL** et **enregistre un mock navigateur**. L’API `PATCH /api/students/:id` et l’`UPDATE students` sont sains et déjà utilisés par le Mobile. Tant que C1.7 n’appelle pas ce PATCH (puis GET), toute « validation » d’Identité / Responsables / Administratif restera non persistée après F5.
