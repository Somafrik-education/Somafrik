# AUDIT-FICHE-ELEVE-02 — persistance réelle des modifications élève

| Champ | Valeur |
|-------|--------|
| **ID** | `AUDIT-FICHE-ELEVE-02` |
| **Nature** | Second audit indépendant — aucun correctif produit |
| **Base** | `develop` @ `72aea41b15f234afc867530f6728a3a239d1914f` |
| **Indépendance** | Le PATCH #834 (`7e21d376`) n’est pas présumé correct |
| **Statut** | **DRAFT / HOLD — PAS READY — PAS MERGE** |
| **Preuve machine** | [`evidence/audit-fiche-eleve-02.json`](./evidence/audit-fiche-eleve-02.json), complément [`evidence/audit-fiche-eleve-02b.json`](./evidence/audit-fiche-eleve-02b.json) |

> Rapport d’audit pour revue CTO. Il ne valide pas un correctif et n’autorise pas un merge.

---

## 0. Verdict

Les champs d’identité **portés par** `students` (prénom, nom, sexe, date de naissance, lieu, téléphone parent, e-mail parent) **sont écrits en PostgreSQL et relus** par le repository de production sur `develop@72aea41b`, quand l’identifiant est le `student_code`.

La perte encore prouvée sur cette fiche est ailleurs :

1. **`PAYLOAD_DROPPED`** — nationalité, adresse et nom d’usage sont dans le brouillon du formulaire, absents du payload, absents des colonnes `students`, et la carte les relit sur une personne qui n’est jamais remplie.
2. **`LEGACY_PATH`** — les notes administratives passent encore par le repository **mock** en mémoire. Le bandeau de succès ne déclenche aucun `UPDATE`. Un rechargement de page reprend l’ancienne observation du DataContext.
3. **Asymétrie de clé (latente)** — `GET` accepte `student_code` **ou** `id` UUID ; `UPDATE` ne cherche que `student_code`. Un PATCH par UUID répond **404** et n’écrit rien. La fiche Web courante utilise le code, pas l’UUID.

Le complément **AUDIT-FICHE-ELEVE-02B** (section 18) a rejoué le parcours navigateur et le HTTP Express avec JWT sur le SHA audité. Le téléphone, le prénom, le sexe et l’e-mail saisis dans la fiche survivent au PATCH, au SQL, au GET, au rechargement complet et à la réouverture. La date de naissance est stockée au bon jour. Quand l’API la renvoie en `JJ-MM-AAAA`, `parseCivilDate` la relit avec `new Date(...)` : `12-04-2012` s’affiche « 04 décembre 2012 », et `15-03-2015` reste la chaîne brute « 15-03-2015 ».

`AUDIT-FICHE-ELEVE-02B — DRAFT / HOLD — prêt pour nouveau diff CTO indépendant.`

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

Colonnes réelles de `students` : `id`, `school_id`, `student_code`, `first_name`, `last_name`, `gender`, `birth_date`, `birth_place`, `photo_url`, `parent_phone`, `parent_email`, `status`, `created_at`, `updated_at`. Sur la base de cette sonde (`somafrik_p0_data_api_it`), aucun trigger non interne n’était posé sur `students`. Le schéma canonique de `repo.init()`, rejoué en section 18, porte `students_permanent_identity_insert` et `students_permanent_identity_immutable`. Ces triggers ne réécrivent ni le prénom ni le téléphone.

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

La sonde repository n’a pas ouvert de navigateur. La capture Network du complément est en section 18.2.

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

Le complément navigateur (section 18) observe, après le succès identité, un PATCH, puis un GET de la fiche, puis un GET de la liste. Aucun second PATCH n’est émis.

---

## 11. RBAC

`PATCH /api/students/:id` exige `Élèves:UPDATE`, `Gérer élèves` ou `ALL_PRIVILEGES` (`rbacService.js`). L’échec est **403 avant le SQL**. Une lecture hors périmètre (enseignant sans classe) est un **404** via `authorizeStudentReadForPrincipal`, avant l’`UPDATE`.

Aucun chemin lu ne répond 200 en sautant l’`UPDATE`. La section 18.4 rejoue ce contrat en HTTP : enseignant **403**, élève hors établissement **404**, jeton périmé **409**. Aucun de ces trois cas n’est un 200.

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

## 14. Réponses aux cinq questions — sonde repository

Les réponses ci-dessous décrivent la sonde repository. Les réponses du parcours navigateur et HTTP sont en section 18.9.

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

La classification ci-dessous est celle de la sonde repository. Le complément HTTP et navigateur est en section 18 : il confirme ces causes et ajoute `READ_MODEL` sur la date de naissance.

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
| `AUTHZ_SCOPE` | non retenu comme cause du symptôme | section 18.4 : 403 enseignant, 404 hors établissement, sans écriture |
| `FRONTEND_STATE` / `CACHE_OR_STALE_STATE` | non retenu pour les champs persistables | section 18 : téléphone, prénom, sexe et e-mail restent affichés après rechargement |
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

Cette PR ne contient que le rapport et les JSON de preuve. Aucun correctif, aucun refactor, aucun schéma, aucun contrat API.

## 18. AUDIT-FICHE-ELEVE-02B — complément navigateur et HTTP

Décision CTO sur #892 : le diff documentaire est conforme, la clôture fonctionnelle est refusée tant que le reload n’est pas observé. Ce complément ne corrige rien.

### 18.1 Préproduction hébergée

| Surface | Constat |
|---------|---------|
| API | `GET https://api-preprod.somafrik.app/api/health` → 200, `database=postgresql`, `gitSha=e25dd98973828ad443e5cfb07662549c08678ebd` |
| Web | `https://preprod.somafrik.app`, `last-modified` `Wed, 07 Oct 2026 13:57:57 GMT`, bundle `StudentWorkspacePage-CoOLmp4V.js` |
| Contrat dans le bundle | le chunk contient `expectedUpdatedAt`, `parentPhone`, `Modifier l'identité`, `Non persisté` |
| SHA Git du bundle | absent |
| Fichiers d’identité `e25dd989` vs `72aea41b` | `git diff` vide sur `studentIdentityHttp.ts`, la fiche, le formulaire, les hooks dossier, `classStudentsRepository.js`, `classStudentsManagement.js` |
| Compte établissement de préproduction | **absent de cet environnement**. Aucun essai de mot de passe n’a été fait |

Le clic n’a donc pas été fait sur `preprod.somafrik.app`. Il a été fait sur le source audité `72aea41b`, servi par Vite, contre un Express local et une base PostgreSQL isolée créée puis détruite (`somafrik_fiche02b`). Le schéma appliqué est celui de `repo.init()`, triggers `students_permanent_identity_insert` et `students_permanent_identity_immutable` compris. L’élève jetable reçoit le code canonique `QX-AUD-EL-26-001` (`login_code` = `student_code`). Aucun élève réel n’a été modifié. Aucun secret n’est dans les preuves.

### 18.2 Chaîne navigateur — téléphone et prénom

Compte : admin établissement jetable, rôle `Admin School`, 89 permissions, dont `Élèves:UPDATE`. Fiche `/etablissement/eleves/QX-AUD-EL-26-001/identite`.

La réponse capturée sur le clic de connexion est un **204** (prévol). La navigation aboutit à `/bienvenue-etablissement`. L’autorisation du parcours est le PATCH 200 qui suit.

Le titre de page est « Élèves ». Le titre de la fiche (`StudentWorkspaceHeader`, second `h1`) est le nom affiché.

| Étape | UI téléphone | UI nom | Payload | Réponse PATCH | SQL | GET | UI après |
|-------|--------------|--------|---------|---------------|-----|-----|----------|
| Avant | `+243800000001` | Diallo Awa | — | — | `Awa` / `+243800000001` | `12-04-2012` côté API | carte « 04 décembre 2012 » |
| Enregistrer | saisie `+243822222222` et `Kadi` | — | `parentPhone=+243822222222`, `firstName=Kadi`, `birthDate=2012-04-12`, `gender=Féminin`, `expectedUpdatedAt` présent | **200**, `firstName=Kadi`, `parentPhone=+243822222222`, `birthDate=12-04-2012` | — | **200**, mêmes valeurs | bandeau `student-edit-success`, téléphone `+243822222222`, titre **Diallo Kadi** |
| Rechargement complet | — | — | — | — | — | — | téléphone `+243822222222`, titre **Diallo Kadi** |
| Fermeture puis réouverture | — | — | — | — | `first_name=Kadi`, `parent_phone=+243822222222` | — | téléphone `+243822222222`, titre **Diallo Kadi** |

Clés du payload : `expectedUpdatedAt`, `firstName`, `lastName`, `gender`, `birthDate`, `birthPlace`, `parentPhone`, `parentEmail`. Nationalité, adresse et nom d’usage sont absents.

Le téléphone et le prénom restent affichés après reload. Le bandeau suit un PATCH 200 dont le `SELECT` final contient les nouvelles valeurs.

### 18.3 Sexe, date de naissance, e-mail

Second enregistrement, même fiche, après le premier : sexe `Masculin`, date `15-03-2015`, e-mail `nouveau@audit.invalid`. La raison exigée pour la date sensible a été saisie. Le bouton Confirmer était actif.

| Étape | Sexe | Date | E-mail |
|-------|------|------|--------|
| UI avant | Féminin | carte « 04 décembre 2012 » ; SQL `2012-04-12` | `awa@audit.invalid` |
| Payload PATCH | `gender=Masculin` | `birthDate=2015-03-15` | `parentEmail=nouveau@audit.invalid` |
| Réponse PATCH | **200** `Masculin` | **200** `15-03-2015` | **200** `nouveau@audit.invalid` |
| GET suivant | `Masculin` | `15-03-2015` | `nouveau@audit.invalid` |
| SQL après le parcours | `Masculin` | `2015-03-15` | `nouveau@audit.invalid` |
| Carte après succès | Masculin | `15-03-2015` | `nouveau@audit.invalid` |
| Carte après rechargement | Masculin | `15-03-2015` | `nouveau@audit.invalid` |

Le sexe et l’e-mail restent ceux qui ont été envoyés. La date SQL est le 15 mars 2015. La carte n’affiche pas « 15 mars 2015 » : elle affiche la chaîne API `15-03-2015`.

### 18.3.1 Date de naissance — `READ_MODEL`

Avant toute édition de date, le SQL est `birth_date=2012-04-12` (12 avril 2012). Le GET et le payload du premier enregistrement portent `12-04-2012` / `2012-04-12`. La carte Identité affiche **« 04 décembre 2012 »**.

`parseCivilDate` (`web/src/lib/studentWorkspaceDates.ts`) ne reconnaît que `YYYY-MM-DD`. Pour `12-04-2012`, il appelle `new Date("12-04-2012")`, qui vaut le **4 décembre 2012** dans ce runtime. `formatCivilDateLabel` produit alors « 04 décembre 2012 ».

Contrôle du parseur, même runtime :

| Chaîne API | `new Date(...)` | Carte |
|------------|-----------------|-------|
| `12-04-2012` | 4 décembre 2012 | « 04 décembre 2012 » (observé avant édition) |
| `04-12-2012` | 12 avril 2012 | libellé long du 12 avril |
| `15-03-2015` | date invalide | chaîne brute `15-03-2015` (observé après enregistrement et après reload) |
| `2012-04-12` | 12 avril 2012 | le formulaire d’édition, lui, envoie bien `2012-04-12` |

Une date dont le jour et le mois sont tous deux ≤ 12 est donc réaffichée sur un autre jour, alors que PostgreSQL a la bonne valeur. Une date dont le jour est ≥ 13 perd le libellé long et réapparaît en `JJ-MM-AAAA`. Dans les deux cas l’`UPDATE` a réussi.

Le HTTP hors calendrier donne le même stockage : PATCH `birthDate=2015-03-15`, `gender=Masculin`, `parentEmail=nouveau@audit.invalid` → SQL `2015-03-15` / `Masculin` / ce courriel, GET `15-03-2015`.

### 18.4 HTTP Express avec JWT

Tous les appels passent par `POST /api/backoffice/login` puis `PATCH`/`GET /api/students/:id`. Aucun jeton n’est archivé.

| Cas | HTTP | Effet SQL |
|-----|------|-----------|
| PATCH téléphone + prénom, jeton frais, corps contenant aussi nationalité, adresse, nom d’usage | **200** | `Amina`, `+243811111111` ; pas de colonne pour les trois champs ignorés |
| GET ensuite | **200** | mêmes valeurs, `birthDate=12-04-2012` |
| PATCH sexe `Masculin`, naissance `2015-03-15`, e-mail | **200** | les trois sont en base et dans le GET |
| PATCH avec l’ancien `expectedUpdatedAt` | **409** « Conflit de modification… » | le téléphone n’est pas remplacé |
| PATCH d’un élève d’un autre établissement | **404** « Élève introuvable. » | la ligne de l’autre établissement reste `Bora` |
| PATCH par UUID | **404** | le prénom SQL reste celui du code ; le GET par UUID répond **200** |
| PATCH avec seulement nationalité et adresse | **400** « Aucun champ modifiable fourni. » | — |
| PATCH enseignant (`Enseignant`, login 200) | **403** « Permission insuffisante pour cette fonctionnalité. » | prénom inchangé |

Aucun de ces refus n’est un 200, et aucun n’a modifié la ligne relue. Ces quatre refus ont été observés en HTTP, sans rejouer le clic du formulaire. Le bandeau `student-edit-success` du parcours identité n’est apparu qu’après un PATCH 200. Le code de confirmation n’appelle le succès que si `result.success`.

Le faux succès observé à l’écran est celui des notes administratives : le bandeau est présent, et le compteur de PATCH de cette action est 0 (section 18.5, DEFECT-02).

La date de naissance est un champ sensible (`SENSITIVE_STUDENT_FIELDS`). Le bouton Confirmer reste désactivé tant que la raison est vide.

### 18.5 Défauts

**DEFECT-01 — adresse, nationalité, nom d’usage.** Gravité : contrat de fiche. Impact : la carte montre « Non renseigné » après reload ; les trois champs sont désactivés avec la mention « Non persisté ». Ils ne sont pas des colonnes de `students`. Architecture recommandée : les porter par le modèle personne / contact canonique déjà utilisé pour les responsables, pas par de nouvelles colonnes `students`. Tant que ce modèle n’est pas branché, le formulaire doit rester en lecture seule et un PATCH qui ne contient qu’eux doit rester un 400 (déjà le cas côté API).

**DEFECT-02 — notes administratives.** Gravité : faux succès. Impact : le bouton « Modifier les détails administratifs » est visible pour `Admin School`. Le parcours navigateur a affiché le bandeau de succès (`successBeforeReload=true`) et n’a émis **aucun** PATCH pendant cette action (`patchCount=0`). L’écriture reste le repository mock. Architecture recommandée : retirer le succès tant qu’il n’existe pas d’écriture, ou persister dans un agrégat déjà canonique. Pas de colonne ajoutée dans cette PR.

**DEFECT-03 — UUID / `student_code`.** Gravité : moyenne, hors URL actuelle de la fiche. Impact : GET par UUID 200, PATCH par UUID 404, zéro ligne modifiée. Sur le schéma canonique, le trigger aligne `login_code` et `student_code`, et la fiche Web utilise ce code. Architecture recommandée : le `WHERE` de `updateByStudentCode` doit accepter la même clé que le GET (`student_code` ou `id::text`).

**DEFECT-04 — affichage de la date de naissance.** Gravité : haute pour le symptôme « la date a changé après enregistrement ». Impact : `READ_MODEL`. PostgreSQL et le GET sont justes ; `formatCivilDateLabel` déplace le jour quand la chaîne API est `JJ-MM-AAAA` et que les deux nombres sont ≤ 12. Architecture recommandée : parser `JJ-MM-AAAA` comme date civile, au même endroit que `YYYY-MM-DD`, dans `web/src/lib/studentWorkspaceDates.ts`. Aucune migration.

### 18.6 Matrice des champs visibles sur l’onglet Identité

| Champ | Lecture | Écriture | Modifiable | Backend | Après reload |
|-------|---------|----------|------------|---------|--------------|
| Prénom | dossier `firstName`, titre `Diallo` + prénom | PATCH `firstName` | oui | oui | **Diallo Kadi** après reload et réouverture |
| Nom | dossier `lastName` | PATCH `lastName` | oui | oui | conservé (`Diallo`) |
| Nom d’usage | brouillon local, toujours vide côté dossier | aucune | non | non | reste vide, absent du payload |
| Sexe | dossier `gender` | PATCH `gender` | oui | oui | **Masculin** après reload |
| Date de naissance | `formatCivilDateLabel(dossier.birthDate)` | PATCH `birthDate` `YYYY-MM-DD` | oui, raison obligatoire | oui | SQL `2015-03-15` ; carte `15-03-2015` (chaîne brute). Avant édition, SQL `2012-04-12` s’affichait « 04 décembre 2012 » |
| Lieu | dossier `birthPlace` | PATCH `birthPlace` | oui | oui | conservé (`Kinshasa`) |
| Nationalité | `person.nationality` uniquement | aucune | non | non | « Non renseigné » |
| Téléphone | `parentPhone` | PATCH `parentPhone` | oui | oui | `+243822222222` après reload et réouverture |
| E-mail | `parentEmail` | PATCH `parentEmail` | oui | oui | `nouveau@audit.invalid` après reload |
| Adresse | `person.address` uniquement | aucune | non | non | « Non renseigné » |
| Notes administratives | mock / `student.observations` | mock | oui | non | bandeau de succès, `patchCount=0` |

Un champ encore éditable et silencieusement ignoré : aucun sur cet onglet. Les trois champs hors contrat sont désactivés. Les notes administratives sont un autre bouton, et leur succès ne produit pas de PATCH.

### 18.7 Causes

Prouvées :

- `READ_MODEL` pour la date de naissance affichée (`12-04-2012` → « 04 décembre 2012 » ; `15-03-2015` → chaîne brute).
- `PAYLOAD_DROPPED` pour nationalité, adresse, nom d’usage.
- `LEGACY_PATH` pour les notes administratives, avec bandeau de succès et zéro PATCH.
- Lookup UUID : GET et PATCH ne cherchent pas la même clé.

Non reproduites sur ce SHA, avec preuve UI → PATCH → SQL → GET → reload :

- le retour à l’ancien téléphone ;
- le retour à l’ancien prénom (le titre reste « Diallo Kadi ») ;
- le retour à l’ancien sexe ;
- le retour à l’ancien e-mail ;
- un `expectedUpdatedAt` périmé qui répondrait 200 ;
- un PATCH enseignant ou hors établissement qui répondrait 200.

La perte « la fiche revient en arrière » n’est pas reproduite pour les champs déjà persistables. Le décalage visible concerne le libellé de la date, pas la ligne PostgreSQL.

### 18.8 Plan minimal et nombre de PR

Ne pas figer l’ordre avant validation CTO. Quatre PR ciblées suffisent, chacune sans mélange :

1. **DEFECT-04** — parser civil `JJ-MM-AAAA` dans `web/src/lib/studentWorkspaceDates.ts`, avec un test sur `12-04-2012` → 12 avril 2012 et `15-03-2015` → 15 mars 2015. C’est le correctif qui explique le symptôme de date.
2. **DEFECT-03** — `backend/db/classStudentsRepository.js`, même clé de lecture et d’écriture.
3. **DEFECT-02** — `useStudentEditingContext.ts` et le mock administratif : plus de succès sans `UPDATE`.
4. **DEFECT-01** — décision de modèle personne, pas une colonne `students` ajoutée par défaut. Fichiers de fiche déjà listés en section 16.

Un test de non-régression HTTP PostgreSQL (login, PATCH, `SELECT`, GET, second PATCH, 409, 404 UUID, 403 enseignant) reste à écrire dans une de ces PR, pas dans l’audit.

Ce découpage est une estimation après le replay Web et HTTP. Aucune de ces PR n’est ouverte.

### 18.9 Réponses 02B aux cinq questions

1. **Le frontend envoie-t-il les nouvelles valeurs ?** Oui pour prénom, nom, sexe, date, lieu, téléphone et e-mail : le payload du clic est capturé. Non pour nationalité, adresse et nom d’usage. Aucun appel pour les notes administratives.
2. **Le backend reçoit-il ces valeurs ?** Oui. La route Express, avec JWT, répond 200 et renvoie les valeurs persistables. Ce n’est pas un appel direct au repository.
3. **PostgreSQL les conserve-t-il ?** Oui pour ces champs. Le `SELECT` après le PATCH navigateur contient `Kadi`, `Masculin`, `2015-03-15`, `+243822222222`, `nouveau@audit.invalid`.
4. **Le GET de la fiche les retourne-t-il ?** Oui. Le GET HTTP qui suit le PATCH porte les mêmes valeurs, et la fiche les réaffiche après rechargement, avec le décalage de libellé de la date décrit en 18.3.1.
5. **Pourquoi certaines valeurs semblent anciennes ?** Le téléphone, le prénom, le sexe et l’e-mail ne reviennent pas en arrière sur ce SHA. La date du 12 avril 2012 s’affiche « 04 décembre 2012 » à cause de `parseCivilDate`. Nationalité et adresse restent « Non renseigné » parce qu’elles ne sont pas dans le contrat d’écriture. Les notes administratives affichent un succès sans PATCH.

`AUDIT-FICHE-ELEVE-02B — DRAFT / HOLD — prêt pour nouveau diff CTO indépendant.`

