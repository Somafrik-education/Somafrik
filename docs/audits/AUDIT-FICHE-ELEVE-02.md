# AUDIT-FICHE-ELEVE-02 — persistance réelle des modifications élève

| Champ | Valeur |
|-------|--------|
| **ID** | `AUDIT-FICHE-ELEVE-02` |
| **Nature** | Second audit indépendant — aucun correctif produit |
| **Base** | `develop` @ `72aea41b15f234afc867530f6728a3a239d1914f` |
| **Indépendance** | Le PATCH #834 (`7e21d376`) n’est pas présumé correct |
| **Statut** | **DRAFT / HOLD — PAS READY — PAS MERGE** |
| **Preuve machine** | [`evidence/audit-fiche-eleve-02.json`](./evidence/audit-fiche-eleve-02.json) |

> Rapport d’audit pour revue CTO. Il ne valide pas un correctif et n’autorise pas un merge.

---

## 0. Verdict

Les champs d’identité **portés par** `students` (prénom, nom, sexe, date de naissance, lieu, téléphone parent, e-mail parent) **sont écrits en PostgreSQL et relus** par le repository de production sur `develop@72aea41b`, quand l’identifiant est le `student_code`.

La perte encore prouvée sur cette fiche est ailleurs :

1. **`PAYLOAD_DROPPED`** — nationalité, adresse et nom d’usage sont dans le brouillon du formulaire, absents du payload, absents des colonnes `students`, et la carte les relit sur une personne qui n’est jamais remplie.
2. **`LEGACY_PATH`** — les notes administratives passent encore par le repository **mock** en mémoire. Le bandeau de succès ne déclenche aucun `UPDATE`. Un rechargement de page reprend l’ancienne observation du DataContext.
3. **Asymétrie de clé (latente)** — `GET` accepte `student_code` **ou** `id` UUID ; `UPDATE` ne cherche que `student_code`. Un PATCH par UUID répond **404** et n’écrit rien. La fiche Web courante utilise le code, pas l’UUID.

Le symptôme « le téléphone / le prénom / le sexe / la date reviennent à l’ancienne valeur après reload » **n’a pas été reproduit** sur ce SHA au niveau SQL + `getByStudentCode`.

Ce qui n’a **pas** été exécuté, et empêche de clore l’audit :

- aucun clic dans le navigateur (pas de session authentifiée) ;
- aucun panneau Network ;
- la route Express `PATCH` / `GET /api/students/:id` n’a pas été invoquée (pas de JWT) ;
- le rechargement React de `StudentIdentityTab` n’a pas été observé.

`AUDIT-FICHE-ELEVE-02 — DRAFT / HOLD — audit non clos, aucun correctif autorisé.`

---

## 1. Périmètre et méthode

Établissement de test : base locale `somafrik_p0_data_api_it` (schéma `students` réel, **0 élève** avant la sonde). La base `somafrik` du `DATABASE_URL` par défaut n’a pas de table `students`.

Aucun élève préexistant n’était disponible. La sonde a donc inséré un élève jetable déjà renseigné, lu la ligne, appliqué le **builder de payload de production** (`buildIdentityPatchPayload`, bundle esbuild de `web/src/lib/studentIdentityHttp.ts`) puis `updateByStudentCode` / `getByStudentCode` du repository de production, relu le SQL, puis **supprimé** le pays `ZZF2`, l’établissement `AUDIT-F2` et l’élève `AUDIT-F2-ELEVE`. Contrôle final : 0 ligne résiduelle.

| Repère | Valeur |
|--------|--------|
| `schoolCode` | `AUDIT-F2` |
| `student_code` | `AUDIT-F2-ELEVE` |
| UUID | `a79ec00a-5804-4046-a2dd-49152be564c7` |
| Rôle | aucun — le repository est appelé directement |
| `updated_at` avant | `2026-08-25 16:21:38.644244+00` |

La fiche Web montée est `StudentWorkspacePage` sur `/etablissement/eleves/:studentId` (`web/src/App.tsx`). `EntityPage` n’est pas montée pour les élèves.

---

## 2. Chaîne réellement exécutée par la fiche Identité

```text
StudentIdentityTab
  → useStudentEditingContext(workspace.studentId, { dossier, onIdentityPersisted })
  → StudentEditingPanel (brouillon complet, pas un diff)
  → executeStudentUpdateCommand
  → wrapRepositoryWithHttpIdentity   (actif hors MODE test / VITEST)
  → buildIdentityPatchPayload
  → studentsApi.update  →  PATCH /api/students/:studentCode
  → server.js requireAuth + requirePermission("PATCH /api/students/:id")
  → getSchoolStudentByCode + authorizeStudentReadForPrincipal
  → repository.updateSchoolStudentByCode
  → classStudentsRepository.updateByStudentCode
  → UPDATE students … RETURNING id
  → getByStudentCode
  → JSON enrollmentApiStudent
  → onIdentityPersisted = refresh() GET + refreshDomains(["students"])
  → StudentIdentityTab relit workspace.*Label depuis le dossier GET
```

Composant d’édition : `web/src/components/students/editing/StudentEditingPanel.tsx`, formulaire `StudentIdentityEditForm.tsx`.

`shouldUseHttpStudentIdentityRepository()` retourne `false` seulement si `import.meta.env.VITEST` ou `MODE === "test"`. En exécution navigateur, le wrapper HTTP est donc celui qui est appelé. Les tests `studentIdentityHttp.test.ts` **mockent** `studentsApi.update` : ils ne prouvent pas PostgreSQL.

---

## 3. Tableau champ par champ

Valeurs initiales SQL : Awa / Diallo / Féminin / `2012-04-12` / Kinshasa / `+243800000001` / `awa@test.local`.

| Champ | Saisie sonde | Payload | SQL après | Retour repository | GET repository | Carte après reload UI |
|-------|----------------|---------|-----------|-------------------|----------------|------------------------|
| Téléphone (F2-01) | `+243811111111` | `parentPhone` | `+243811111111` | idem | idem | **non observé** (pas de navigateur) |
| Téléphone + e-mail + naissance + sexe (F2-02) | `+243822222222`, `nouveau@test.local`, `15-03-2015`, `M` | `parentPhone`, `parentEmail`, `birthDate=2015-03-15`, `gender=Masculin` | les quatre | `birthDate` affiché `15-03-2015` | les quatre | **non observé** |
| Prénom (F2-03) | `Amina` | `firstName` + jeton renouvelé | `Amina`, téléphone F2-02 conservé | `Amina` | non relu séparément ; SQL confirmé | **non observé** |
| Nom | inchangé `Diallo` | envoyé car le panneau poste le brouillon entier | `Diallo` | conservé | conservé | — |
| Lieu | `Kinshasa` | `birthPlace` | inchangé | — | — | — |
| Adresse | `12 avenue Audit` puis `ne doit pas partir` | **absent** | pas de colonne | absent | absent | carte = `person.address`, jamais fourni par le dossier → « Non renseigné » |
| Nationalité | `RD Congo` puis `France` | **absent** | pas de colonne | absent | absent | `person.nationality` uniquement → « Non renseigné » |
| Nom d’usage | `Awa D.` puis `ignore` | **absent** | pas de colonne | absent | absent | hors carte d’identité |
| Notes administratives | non soumises à SQL | **aucun PATCH** | aucune écriture | succès mock seulement | le GET élève ne porte pas ce champ | perdu au rechargement de page (re-seed DataContext) |

Colonnes réelles de `students` : `id`, `school_id`, `student_code`, `first_name`, `last_name`, `gender`, `birth_date`, `birth_place`, `photo_url`, `parent_phone`, `parent_email`, `status`, `created_at`, `updated_at`. Triggers non internes sur `students` : **aucun**.

---

## 4. Front-end

Le panneau envoie **tout le brouillon** comme `changes` (`StudentEditingPanel.continueReview`), pas uniquement les champs modifiés.

`buildIdentityPatchPayload` copie seulement : `firstName`, `lastName`, `gender` (F/M/OTHER → Féminin/Masculin/Autre), `birthDate` via `toApiDate`, `birthPlace`, `phone` → `parentPhone`, `email` → `parentEmail`, plus `expectedUpdatedAt` obligatoire.

Nationalité, adresse et nom d’usage sont **retirés sans erreur** dès qu’un autre champ persistable est présent. S’ils sont les seuls changements, le builder refuse (`Aucun champ persistable…`) et aucun PATCH ne part.

Sur ce SHA, ces trois inputs sont `disabled` avec le libellé « Non persisté (hors contrat PATCH PostgreSQL). » Un utilisateur de **cette** fiche ne peut pas les saisir. Un client plus ancien, ou un brouillon qui les contient encore, les perd en silence.

Champs vides : téléphone / e-mail / lieu / date peuvent partir à `null` et **écraser** la colonne, parce que le brouillon complet est envoyé. Le sexe `null` (genre vide) est écrit tel quel (`patch.gender !== undefined`).

`expectedUpdatedAt` vient de `current.updatedAt` relu par `getStudentIdentity` **au moment du PATCH**, pas du brouillon. Sur l’onglet Identité, cette identité est `toEditableStudentIdentityFromDossier(dossier)` : jeton = `dossier.updatedAt` du GET (chaîne ISO).

La carte (`StudentIdentityTab`) n’affiche pas le state du formulaire. Elle affiche `workspace.phoneLabel`, `genderLabel`, etc., dérivés de `useStudentWorkspace` → `studentsApi.get` → `buildStudentWorkspaceFromDossier` → `buildStudentWorkspaceOverview`.

Dans cet overview :

- téléphone = `person.phone ?? student.phone`, et `toDomainStudent` met `phone = dossier.parentPhone` **sans** `person` ;
- e-mail = `person.email ?? student.email` (`parentEmail`) ;
- nationalité et adresse = **uniquement** `person.*`, jamais le dossier.

Donc, après un GET correct, prénom / sexe / date / téléphone / e-mail de la carte suivent PostgreSQL. Nationalité et adresse restent « Non renseigné » même si le SQL est à jour.

---

## 5. Requête réseau

Non capturée dans un navigateur.

Contrat que le wrapper appelle : `PATCH /api/students/:id` via `studentsApi.update(command.studentId, payload)`.

Payload F2-01 réellement construit par le builder de production :

```json
{
  "expectedUpdatedAt": "2026-08-25T16:21:38.644Z",
  "firstName": "Awa",
  "lastName": "Diallo",
  "gender": "Féminin",
  "birthDate": "2012-04-12",
  "birthPlace": "Kinshasa",
  "parentPhone": "+243811111111",
  "parentEmail": "awa@test.local"
}
```

`address`, `nationality`, `preferredName` : absents.

Le succès UI n’est affiché que si `result.success` (`StudentEditingPanel.confirm`). Un 409 devient `VERSION_CONFLICT` et ne ferme pas le formulaire. Un 404 devient `NOT_FOUND`. Il n’y a pas de toast de succès sur un PATCH jamais envoyé **pour l’identité HTTP**. Exception : les notes administratives (section 8) affichent un succès sans HTTP.

---

## 6. Backend et SQL

Route : `app.patch("/api/students/:id")` dans `backend/server.js`. `schoolCode` vient du principal d’inscription, pas du corps. Réponse : `enrollmentApiStudent(updated)` sur la ligne relue, pas un catalogue mémoire.

Validation `validateUpdateStudentInput` : `expectedUpdatedAt` obligatoire ; allowlist `firstName`, `lastName`, `gender`, `birthDate`, `birthPlace`, `parentPhone`, `parentEmail` (alias snake_case et `phone` à l’enrôlement, pas sur l’update pour le téléphone — l’update lit `parentPhone` / `parent_phone`). Classe, code, id dans le corps → 400. Aucune clé adresse / nationalité n’est acceptée : elles sont ignorées parce qu’elles ne sont pas lues, pas parce qu’elles sont rejetées.

SQL exécuté (texte capturé, `rowCount = 1` sur F2-01, F2-02, F2-03 et le cas microsecondes) :

```sql
UPDATE students
SET first_name = $1, last_name = $2, gender = $3, birth_date = $4,
    birth_place = $5, parent_phone = $6, parent_email = $7,
    updated_at = GREATEST(
      date_trunc('milliseconds', clock_timestamp()),
      date_trunc('milliseconds', updated_at) + INTERVAL '1 millisecond'
    )
WHERE id = $8 AND school_id = $9
  AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz)
RETURNING id
```

La recherche préalable est `WHERE st.student_code = $1 AND st.school_id = $2`. Zéro ligne au `SELECT` → **404** « Élève introuvable. » Zéro ligne au `UPDATE` (`db.one` sans ligne) → **409**, pas un 200. La sonde n’a pas observé de faux succès SQL.

Le GET fiche (`getByStudentCode`) utilise `(st.student_code = $1 OR st.id::text = $1)`.

Preuve UUID : `updateByStudentCode(<uuid>)` → 404, aucune écriture ; `getByStudentCode(<uuid>)` retourne encore `Amina`.

---

## 7. `expectedUpdatedAt`

| Étape | Observation |
|-------|-------------|
| Origine UI | `dossier.updatedAt` du GET, sérialisé JSON (`Date.toISOString` côté pg → `…644Z`) |
| PostgreSQL avant | `2026-08-25 16:21:38.644244+00` |
| Pré-contrôle | `occupancyTimestampsMatch` : `Date.parse` des deux côtés, égalité à la milliseconde |
| SQL | `date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10)` |
| Décalage | 409 explicite, formulaire non fermé |
| F2-03 | jeton `2026-10-09T21:03:21.270Z` issu du GET précédent ; `updated_at` avance à `2026-10-09 21:03:21.289+00` ; le téléphone F2-02 n’est pas écrasé |
| Microsecondes `.644600+00` | le JSON reste `2026-08-25T16:21:38.644Z` ; l’UPDATE **réussit** (`rowCount` 1, téléphone `+243833333333`). Pas de 0 ligne silencieuse sur cet arrondi |

`EXPECTED_UPDATED_AT` et `SQL_ZERO_ROW` ne sont pas la cause observée sur ces jetons.

---

## 8. Notes administratives — faux succès

`wrapRepositoryWithHttpIdentity` ne remplace que `updateStudentIdentity`. `updateAdministrativeDetails` reste celui du mock (`studentEditingRepository.mock.ts`) : écriture dans une `Map` module, version locale, `success: true`.

`StudentIdentityTab` passe `canUpdateAdministrative` et `administrative` au même panneau. Un rôle avec `Élèves:UPDATE` (bridge vers `student.administrative.update`) peut enregistrer des notes. `onIdentityPersisted` n’est pas appelé. Aucune colonne `administrative_notes` n’existe. Au rechargement, le seed reprend `student.observations` du DataContext, qui n’a pas été patché.

C’est un succès UI sans `UPDATE`. Classification : **`LEGACY_PATH`**.

---

## 9. Double source de vérité

| Source | Écriture identité | Lecture carte Identité |
|--------|-------------------|------------------------|
| `students` | oui, PATCH | oui, via dossier GET pour nom, sexe, date, lieu, téléphone, e-mail |
| `contacts` / `contact_relations` | non (responsables) | non pour la carte Identité ; téléphone du responsable primaire est un autre libellé |
| `persons` du modèle Web | non | nationalité et adresse **uniquement** ; le dossier ne crée pas cette personne |
| Mock d’édition | notes administratives, et identité **si** le wrapper HTTP est désactivé (tests) | formulaire, pas la carte, après seed |
| `EntityPage` + `stripClientStudentsFromPutPayload` | fusion locale puis suppression de `students` du PUT `/backoffice/state` | route **non montée** pour les élèves |

Hypothèse « le PATCH écrit A et le GET identité lit B » : **éliminée** pour prénom, nom, sexe, naissance, lieu, téléphone parent, e-mail parent. Les deux passent par `students`.

Hypothèse **retenue** pour nationalité et adresse : la carte lit `person`, que `toDomainStudent` ne remplit pas. Ce n’est pas une seconde table élève ; c’est un champ d’affichage sans colonne.

---

## 10. Réécriture après coup

Sur la sonde : pas de second `UPDATE` entre le PATCH et le `SELECT`. Aucun trigger sur `students`. Le téléphone écrit en F2-02 est encore là après F2-03. Pas de seed relancé (fixture supprimée seulement en `finally`, après les lectures).

Non prouvé : un effet React ou un second PATCH navigateur. Le code de succès identité enchaîne un GET (`refresh`), pas un second PATCH.

---

## 11. RBAC

`PATCH /api/students/:id` exige `Élèves:UPDATE`, `Gérer élèves` ou `ALL_PRIVILEGES` (`rbacService.js`). L’échec est **403 avant le SQL**. Une lecture hors périmètre (enseignant sans classe) est un **404** via `authorizeStudentReadForPrincipal`, avant l’`UPDATE`.

Aucun chemin lu ne répond 200 en sautant l’`UPDATE`. Ce comportement **n’a pas été rejoué** avec un JWT de directeur, de scolarité ou d’enseignant.

---

## 12. Web et Mobile

| | Web fiche | Mobile `StudentMutationControls` |
|--|-----------|----------------------------------|
| Endpoint | `PATCH /api/students/:id` | le même |
| Id | `studentCode` (liste et dossier) | `row.id` |
| Id renvoyé par l’API | `student_code` (`login_code` / `identity_code` ne sont pas dans `STUDENT_SELECT_COLUMNS`) | donc le PATCH mobile nom/téléphone vise le même `WHERE student_code` |
| Champs | prénom, nom, sexe, naissance, lieu, téléphone, e-mail, `expectedUpdatedAt` | prénom, nom, `parentPhone`, `expectedUpdatedAt` seulement |
| Sexe, date, e-mail | envoyés | **non envoyés** par cet écran |

Le défaut nationalité / adresse est Web. Mobile ne prétend pas les enregistrer sur cet écran. Aucun correctif Mobile dans cette PR.

---

## 13. Rétrospective #834 (`7e21d376`, mergé)

Objectif annoncé : brancher l’éditeur C1.7 sur `PATCH /api/students/:id`, `expectedUpdatedAt`, mapping téléphone/e-mail, refetch GET. Le corps de PR indiquait que le replay Network / SQL / F5 n’avait pas été fait.

| Changement | Effet réel sur la fiche actuelle | Limite |
|------------|-----------------------------------|--------|
| `studentIdentityHttp.ts` + wrapper dans `useStudentEditingContext` | **utilisé** par `StudentIdentityTab` hors tests | les tests mockent l’API |
| Mapping phone → `parentPhone`, email → `parentEmail`, sexe, date | **exercé** par la sonde SQL : les valeurs survivent | ne couvre pas adresse / nationalité / nom d’usage |
| Désactivation de ces trois champs | empêche la saisie sur ce SHA | le drop reste silencieux si le brouillon les contient avec un autre champ |
| `onIdentityPersisted` → `refresh()` | le code relit le GET | reload navigateur non observé ici |
| Notes administratives | **non touchées** par #834 | toujours le mock |
| Lookup UUID | **non couvert** | GET ok, PATCH 404 |
| `demoSeedSubscriptions` / catalogue mobile dans le même commit | hors identité | ne réécrit pas `students` |

Le test repository `classStudentsRepository.pg.test.js` touche déjà PostgreSQL (téléphone + jeton microsecondes). Il n’enchaîne pas la route HTTP ni le reload React. Il ne suffit pas, seul, comme preuve de fiche.

---

## 14. Réponses aux cinq questions

1. **Le frontend envoie-t-il les nouvelles valeurs ?**  
   Pour prénom, nom, sexe, date, lieu, téléphone, e-mail : **oui**, le builder de production les met dans le payload (preuve F2-01 / F2-02 / F2-03). Pour nationalité, adresse, nom d’usage : **non**. Pour les notes administratives : **aucun appel réseau**.

2. **Le backend reçoit-il ces valeurs ?**  
   Le repository de production, qui est la fonction appelée par la route après authz, **reçoit** le payload persistable et l’écrit. La route HTTP elle-même **n’a pas été appelée**. Les champs droppés n’arrivent pas. Les notes administratives n’arrivent pas.

3. **PostgreSQL les conserve-t-il après le PATCH ?**  
   **Oui** pour les champs persistables (`rowCount` 1, `SELECT` immédiat). **Non** pour le reste : ils n’atteignent pas la table (**cas A**).

4. **Le GET utilisé par la fiche retourne-t-il ces valeurs ?**  
   `getByStudentCode`, qui est le GET de la fiche, **oui** pour les champs persistables (téléphone, e-mail, sexe, date `JJ-MM-AAAA`, prénom). Nationalité et adresse ne sont pas dans cette réponse. Le GET HTTP Express n’a pas été rejoué.

5. **Pourquoi la fiche réaffiche-t-elle les anciennes valeurs ?**  
   - Nationalité et adresse : elles ne sont ni envoyées ni stockées, et la carte lit `person`, vide.  
   - Notes administratives : succès mémoire, puis re-seed.  
   - Prénom, nom, sexe, date, téléphone, e-mail : **perte non reproduite** sur ce SHA entre SQL et GET repository. Sans reload UI, on ne peut pas affirmer que l’écran les réaffiche anciennes.

---

## 15. Classification

| Cause | Retenue | Preuve |
|-------|---------|--------|
| `PAYLOAD_DROPPED` | **oui** — nationalité, adresse, nom d’usage | `addressInPayload: false` alors que le brouillon les contient |
| `LEGACY_PATH` | **oui** — notes administratives mock ; `EntityPage` élèves non montée mais encore dans le code | `updateAdministrativeDetails` non wrappé ; route `eleves` = `StudentWorkspacePage` |
| `READ_MODEL` | **oui** — carte nationalité / adresse | `studentWorkspaceOverview.ts` lit seulement `person` |
| `EXPECTED_UPDATED_AT` | non sur les jetons sondés | `.644244` et `.644600` → UPDATE `rowCount` 1 |
| `SQL_ZERO_ROW` | non sur `student_code` | `rowCount` 1 ; 0 ligne serait un 409 |
| `DATABASE_WRITE` | non pour les champs de `students` | SELECT après UPDATE |
| `DUAL_SOURCE_OF_TRUTH` | non pour l’identité `students` | même table en écriture et en GET |
| `POST_SAVE_OVERWRITE` | non observé | pas de second UPDATE, pas de trigger |
| `AUTHZ_SCOPE` | non prouvé comme cause du symptôme | 403/404 explicites dans le code, non rejoués |
| `FRONTEND_STATE` / `CACHE_OR_STALE_STATE` | non prouvé pour les champs persistables | pas de reload React |
| `API_VALIDATION` / `BACKEND_MAPPING` | le mapping phone/email/sexe/date **fonctionne** sur la sonde | F2-02 |
| UUID `GET` ≠ `UPDATE` | défaut prouvé, hors chemin fiche si l’URL est le `student_code` | 404 sans écriture |

---

## 16. Correctif recommandé (PR séparée, après CTO)

Ne pas l’implémenter dans cette PR.

1. Conserver nationalité, adresse et nom d’usage hors enregistrement **ou** les persister (cela demande un schéma — décision CTO). Tant qu’ils ne sont pas des colonnes, un brouillon qui ne change qu’eux doit rester en échec explicite (déjà le cas), et un brouillon mixte ne doit pas laisser croire qu’ils ont été enregistrés.
2. Retirer le succès des notes administratives tant qu’aucun `UPDATE` n’existe, ou ajouter un contrat d’écriture dédié. Ne pas réutiliser un PUT backoffice qui strip `students`.
3. Aligner le `WHERE` de `updateByStudentCode` sur le GET (`student_code` **ou** `id::text`) si un client peut envoyer l’UUID.
4. Test de non-régression **PostgreSQL réel**, pas un mock : créer ou lire un élève, lire `updatedAt`, PATCH, `SELECT`, GET, second PATCH avec le nouveau jeton, et un cas « seuls nationalité/adresse » qui n’écrit rien. Étendre plutôt `backend/lib/classStudentsRepository.pg.test.js` ou un test de route, sans masquer `pg`.

Fichiers qu’un futur correctif toucherait, selon l’option retenue :

- `web/src/lib/studentIdentityHttp.ts`
- `web/src/components/students/editing/StudentIdentityEditForm.tsx`
- `web/src/components/students/StudentIdentityTab.tsx`
- `web/src/hooks/useStudentEditingContext.ts`
- `web/src/lib/studentEditingRepository.mock.ts` (notes administratives)
- `web/src/lib/studentDossierFromApi.ts`
- `web/src/lib/studentWorkspaceOverview.ts`
- `web/src/lib/studentEditingAdapters.ts`
- `backend/db/classStudentsRepository.js` (lookup UUID)
- `backend/lib/classStudentsManagement.js` seulement si le contrat d’update change
- `Mobile/src/components/StudentMutationControls.tsx` seulement si le périmètre Mobile inclut sexe, date ou e-mail

Pas de migration dans la PR d’audit. Pas de changement RBAC : RBAC n’est pas la cause prouvée.

---

## 17. Confirmation de périmètre

Cette PR ne contient que ce rapport et le JSON de preuve. Aucun correctif, aucun refactor, aucun schéma, aucun contrat API.

`AUDIT-FICHE-ELEVE-02 — DRAFT / HOLD — audit non clos, aucun correctif autorisé.`
