# Audit CTO — Référentiel pédagogique pays → création des classes

**Repo :** Somafrik-education/Somafrik  
**Branche :** `cursor/country-academic-class-reference-audit-92b2`  
**Base :** `develop` actuel après merge **#235**  
**Gouvernance :** PR **DRAFT AUDIT-ONLY** — aucun Ready — aucun merge — **STOP CTO**  
**Périmètre :** cartographie uniquement. Aucune correction métier. Aucune migration destructive. Aucun hardcode RDC/Burundi comme vérité globale. Aucun nouveau JSON comme source d’autorité.

**Diff GitHub indépendant obligatoire avant toute PR corrective.**

---

## Verdict

**NO-GO** pour l’intégrité « catalogue national → offre établissement → POST /classes ».

Le référentiel pays **existe déjà** en PostgreSQL (`education_levels`, `education_streams`, `school_levels`, `school_streams`). L’activation établissement **existe déjà** en PostgreSQL. La création de classe **n’en consomme aucune**.

Un Admin School peut aujourd’hui :

```http
POST /api/classes
{ "name": "Toto classe", "academicYearName": "2026-2027", "level": "NIVEAU INVENTÉ", "section": "XYZ" }
```

et **réussir**, dès lors qu’il a `Classes:CREATE` et qu’une année `academic_years.name` existe. Aucune FK vers le catalogue. Aucune vérification d’offre activée.

**GO** pour ouvrir des PR correctives **après validation explicite de ce rapport**.

---

## Réponse obligatoire (école secondaire RDC)

> Pour une école secondaire en RDC, qui définit que « 4ème », « Scientifique » et les groupes A/B/C sont autorisés, où ces valeurs sont stockées en PostgreSQL, comment l’établissement les active, et comment POST /classes empêche une valeur inventée ?

### Aujourd’hui (état réel, post-#235)

| Concept | Qui le définit | Où c’est stocké | Comment l’école l’active | POST /classes |
|---|---|---|---|---|
| **4ème** (niveau) | **SUPER_ADMIN uniquement** via `POST /api/backoffice/education-levels` (`countryCode` du pays) | `education_levels` (`country_id`, `level_code`, `name`) | `PUT /api/education-reference/school-activation` → `school_levels` | **Non consommé.** `classes.level` est un **TEXT libre**. |
| **Scientifique** (filière / option / série) | **SUPER_ADMIN uniquement** via `POST /api/backoffice/education-streams` | `education_streams` (`country_id`, `stream_code`, `name`, `stream_type` ∈ `filiere\|serie\|option`, `level_id` nullable) | même PUT → `school_streams` | **Non consommé.** Alias API `track` → colonne `classes.section` **TEXT libre**. |
| **Groupes A / B / C** | **Personne.** Aucun catalogue. | Nulle part en référentiel. Seed démo : lettre dans `classes.name` (`6ème A`) ; le formulaire Web appelle « Section » un champ libre. | Impossible d’activer un groupe. | Saisie libre dans `name` et/ou `section`. |
| **Année 2026-2027** | Admin School (Paramètres, #235) | `academic_years` | n/a (année d’établissement, pas d’offre pédagogique) | Consommée **par nom** (`academicYearName` → lookup `academic_years.name`). Pas d’UUID client. |

**COUNTRY_ADMIN** peut **lire** le catalogue de **son** pays (`COUNTRY_PRIVILEGES` + garde `assertEducationReferenceCountryRead`). Il **ne peut pas** écrire niveaux/streams (`assertSuperAdmin` + POST sans `COUNTRY_PRIVILEGES`). Il **ne peut pas** créer de classe (`POST /api/classes` sans `COUNTRY_PRIVILEGES`). Il **ne peut pas** activer l’offre d’une école (preuve `verify-education-reference-management.js`).

**ADMIN SCHOOL** n’écrit pas le catalogue national. Il peut activer un sous-ensemble (`Paramètres Établissement:UPDATE`). Il crée ensuite des classes **sans lien** avec cette activation.

**Comment POST /classes empêche une valeur inventée ?**  
**Il ne l’empêche pas.** C’est le trou P0 de ce chantier.

### Cible (non implémentée — à valider)

1. SUPER_ADMIN (et, si produit, COUNTRY_ADMIN délégué) écrit `education_levels` / `education_streams` **scopés `country_id`**.
2. L’établissement active un sous-ensemble dans `school_levels` / `school_streams` (déjà le cas).
3. `POST /classes` n’accepte plus `level`/`section` texte : uniquement `academic_year_id` + `level_id` activé + `stream_id` activé nullable + `group_code`.
4. Le libellé `display_name` est composé. `classes.id` UUID reste l’identité. Les groupes A/B/C deviennent un champ **distinct** de la filière.

---

## 1. Base SHA

| | SHA |
|---|---|
| Base `develop` (merge #235) | `957ee644546e3f491054552299b5ff7ad91894ab` |
| Message | `Merge pull request #235 from Somafrik-education/cursor/academic-year-settings-rbac-92b2` |

## 2. Head SHA

| | SHA |
|---|---|
| Head de cette PR (document) | `2fa1d900a9488dd69e4aca3936bee1d2a67db024` |
| Head de branche | voir le dernier commit de `cursor/country-academic-class-reference-audit-92b2` |

Aucun autre fichier n’est modifié dans cette PR.

---

## 3. Schéma actuel — carte de bout en bout

Chaîne **cible produit** :

```
PAYS
  → SYSTÈME ÉDUCATIF
      → CYCLE
          → NIVEAU
              → FILIÈRE / SECTION / OPTION / STREAM / TRACK (facultatif)
                  → NOMMAGE DE CLASSE
                      → ÉTABLISSEMENT (activation)
                          → CLASSE
```

Chaîne **réellement implémentée** :

```
countries
  → education_levels          (country_id, PAS de cycle, PAS de parent_id)
  → education_streams         (country_id, level_id NULLABLE, stream_type filiere|serie|option)
       → school_levels        (PK school_id + level_id)     ← activation
       → school_streams       (PK school_id + stream_id)    ← activation
            ✗  AUCUN LIEN
            classes           (level TEXT, section TEXT, name TEXT libre)
                 → academic_years (school_id, name)         ← année, post-#235
```

**Absent :** `education_systems`, `education_cycles`, `education_tracks`, `parent_id` sur les niveaux, `group_code`, `class_name_template`, `school_education_offerings` (le nom cible ; l’équivalent actuel est `school_levels` + `school_streams`).

**Deux mondes parallèles :**

1. **Catalogue national + activation** — PostgreSQL relationnel, scopé pays, écrit par Superadmin, activé par l’école.
2. **Classes** — PostgreSQL relationnel, mais **découplé** : nom / niveau / section texte. Unicité sur le **nom normalisé**, pas sur (niveau, filière, groupe).

---

## 4. Tables réellement impliquées

Aucune table nouvelle n’est proposée à créer **dans cette PR**. Inventaire.

### 4.1 `countries`

| Colonne | Rôle |
|---|---|
| `id` UUID PK | identité pays |
| `iso_code` UNIQUE | code (CD, BI, …) |
| `name`, `phone_code`, `currency`, `is_active` | métadonnées |

Pas de vocabulaire pédagogique. Pas de template de nommage.

### 4.2 `schools`

| Colonne | Rôle |
|---|---|
| `id` UUID PK | |
| `country_id` UUID NOT NULL FK → `countries` | **seul lien pays de l’établissement** |
| `school_code` UNIQUE | |
| `school_type` TEXT nullable | **non exploité** pour filtrer le référentiel |
| `profile_payload` JSONB | résiduel, pas SoT pédagogique |

### 4.3 `education_levels` — **A. PostgreSQL canonique (catalogue)**

| Colonne | |
|---|---|
| `id` UUID PK | |
| `country_id` UUID NOT NULL FK → `countries` | isolation pays |
| `level_code` TEXT NOT NULL | |
| `name` TEXT NOT NULL | libellé métier (ex. « 4ème ») |
| `display_order` INTEGER | |
| `status` `active` \| `archived` | |
| UNIQUE `(country_id, level_code)` | |

Pas de `school_id`. Pas de `parent_id`. Pas de `type` (primaire/secondaire/université).

### 4.4 `education_streams` — **A. PostgreSQL canonique (catalogue)**

Équivalent fonctionnel de « tracks / filières / options / séries ». **La table `education_tracks` n’existe pas.**

| Colonne | |
|---|---|
| `id` UUID PK | |
| `country_id` UUID NOT NULL FK → `countries` | |
| `level_id` UUID NULL FK → `education_levels` | rattachement **optionnel** à un niveau |
| `stream_code` TEXT NOT NULL | UNIQUE **par pays** `(country_id, stream_code)` — **pas** par niveau |
| `name` TEXT NOT NULL | |
| `stream_type` CHECK `filiere` \| `serie` \| `option` | type **sur la ligne**, pas un label UI pays |
| `display_order`, `status` | |

Un stream « Scientifique » unique par pays peut donc être partagé par plusieurs niveaux, ou lié à un seul `level_id`. Les deux modèles coexistent.

### 4.5 `school_levels` / `school_streams` — **A. PostgreSQL canonique (activation)**

| Table | PK | Autres |
|---|---|---|
| `school_levels` | `(school_id, level_id)` | `status` active\|archived |
| `school_streams` | `(school_id, stream_id)` | idem |

`replaceSchoolActivation` : DELETE toutes les lignes de l’école puis INSERT du sous-ensemble. **Garde pays :** refuse d’activer un `level_id` / `stream_id` dont `country_id` ≠ `schools.country_id` (`COUNTRY_MISMATCH`).

C’est **le** chemin d’activation. Pas du JSON.

### 4.6 `school_academic_configs` — **D. legacy JSONB**

| Colonne | |
|---|---|
| `school_id` UUID PK FK → `schools` | |
| `config_payload` JSONB | |

Les clés `levels` / `tracks` **ne sont plus autorisées en écriture** (`assertNoLegacyAcademicLevelsTracksWrite`). Inventaire au boot ; strip uniquement après inventaire propre. **Ce n’est plus la source d’autorité** des niveaux/filières.

### 4.7 `academic_years` — **A. canonique (post-#235)**

`id`, `school_id`, `name`, dates, `is_current`, `status`, UNIQUE `(school_id, name)`.  
Création uniquement via Paramètres. Les classes **sélectionnent** une année existante.

### 4.8 `classes` — **A. PostgreSQL, contrat métier incomplet**

| Colonne | |
|---|---|
| `id` UUID PK | identité interne réelle |
| `school_id` UUID NOT NULL | |
| `academic_year_id` UUID NOT NULL FK → `academic_years` | |
| `class_code` VARCHAR(64) UNIQUE **global** | identité **publique** API (`mapClassRow` expose `id: classCode`) |
| `name` TEXT NOT NULL | libellé **saisi**, pas généré |
| `level` TEXT nullable | **texte libre** |
| `section` TEXT nullable | **texte libre** ; l’API projette aussi `track = section` |
| `status` active\|inactive | |

**Absent :** `level_id`, `track_id` / `stream_id`, `group_code`, `display_name` distinct.

Unicité métier : index `uq_classes_school_year_normalized_name` sur `(school_id, academic_year_id, lower(btrim(name)))` — migration `20260811_classes_name_uniqueness.sql`.

### 4.9 Tables métier consommatrices (FK `class_id` UUID)

`enrollments`, `teacher_assignments`, `evaluations`, `grades`, `attendance`, `school_courses`, `course_schedule_slots`, `exams`, `report_cards` (nullable), `report_card_templates`, `subject_class_assignments` (nullable + `level` TEXT parallèle).

**Exceptions nom-comme-clé :** `fee_grids.class_name` TEXT sans `class_id` ; `course_schedule_slots.class_name` TEXT **en plus** de `class_id`.

---

## 5. Niveaux

**Stockage canonique :** `education_levels.name` + `level_code`, scopé `country_id`.

**Stockage classe :** `classes.level` TEXT, **aucune FK**, aucune contrainte d’appartenance au pays de l’école.

**Isolation pays (catalogue) :** les listes `listLevelsByCountry` / catalogue école filtrent `el.country_id = school.country_id`. Une école Burundi **ne reçoit pas** les niveaux RDC **via l’API référentiel**.

**Isolation pays (classes) :** **nulle.** Une école BI peut stocker `level = '4ème'` ou `'Licence 1'` sans que le catalogue BI les contienne.

**Web / Mobile :** si `GET /api/academic-config` projette `levels: []` (aucune activation), `getSchoolAcademicLists` **substitue** `DEFAULT_LEVELS = ["1ère"…"6ème"]` — liste de **style congolais/francophone**, identique pour tous les pays. **Fuite multi-pays P0** (fallback client, pas PostgreSQL).

**Test isolation :** le store d’activation refuse un `level_id` d’un autre pays. Les tests `educationReference.pg.test.js` couvrent `COUNTRY_MISMATCH`. **Aucun test** n’interdit `POST /classes` avec un niveau hors catalogue.

---

## 6. Filière / section / option / track / stream

### Vocabulaire aujourd’hui (plusieurs mots, mêmes ou différents concepts)

| Terme | Où | Signifie réellement |
|---|---|---|
| `education_streams` | PG catalogue | filière/série/option nationale |
| `stream_type` | enum ligne | `filiere` \| `serie` \| `option` |
| `tracks` | projection `academic-config`, UI, Mobile `DEFAULT_TRACKS` | **noms** des streams activés |
| `section` (colonne `classes`) | PG classes + formulaire Web | **fourre-tout texte** |
| `track` (API classes) | alias write/read | **même colonne** `classes.section` |
| `option` | uniquement `stream_type` | pas de table dédiée |
| `filiere` / `filière` | UI Superadmin + enum | |
| Groupe A/B/C | seed `buildClassName` → **dans `name`** | pas une colonne |

**P0 de modélisation — réponse explicite §12 / §13 :**

Le champ **« Section » du modal Classes** est un **Input texte libre**. Il **ne distingue pas** :

- un **groupe de classe** (A / B / C) ;
- une **filière / option** (Scientifique / Littéraire) ;
- une **série**.

Preuve seed `bulkPlatformSeed.js` :

- `buildClassName` → `"${level} ${section}"` avec `section = A..E` (**groupe** dans le **nom**) ;
- `classes.push({ …, track: DEMO_TRACKS[…] })` — **filière** dans le champ `track` qui, à l’INSERT PG, atterrit dans `classes.section`.

Donc **un seul champ `section` sert déjà, selon le module, les deux concepts**. C’est un **P0 de modélisation**. Il ne faut **pas** normaliser ce champ tel quel : il faut **le scinder** (track vs group) dans une PR corrective, pas le « nettoyer » en place.

L’enum `stream_type` **n’est pas** un vocabulaire pays configurable : c’est un type technique **global** (`filiere|serie|option`). Un pays ne peut pas afficher « Série » pour le même concept sans que chaque ligne ait `stream_type='serie'`. Ce n’est **pas** un label UI pays.

Université (Faculté / Département / Filière / Option) : **non représentée**. Pas de hiérarchie à 4 niveaux. `schools.school_type` n’oriente pas le catalogue (seed démo : « Université de Kinshasa » reçoit les mêmes `DEMO_LEVELS` 1ère–6ème).

---

## 7. Vocabulaire par pays — recommandation CTO

**Aujourd’hui :** pas de table de labels UI. Le backend utilise `stream` ; le contrat academic-config expose `tracks[]` (noms) ; le Web Superadmin dit « Filière » ; le formulaire Classes dit « Section ».

**Recommandation :**

1. **Concept canonique unique côté modèle :** `LEVEL` + `TRACK` (table actuelle `education_streams`) + `CLASS_GROUP`.
2. **Labels UI par pays** (petite table ou colonnes sur `countries`) : `level_label`, `track_label`, `group_label`.  
   Ex. RDC `track_label = "Option"` ; autre pays `"Filière"` / `"Série"`.  
   **Même backend, libellé configurable.** Ne **pas** créer une table par synonyme.
3. **Ne pas** coder l’enum `filiere|serie|option` comme vérité linguistique mondiale. Le garder éventuellement comme **sous-type métier** (plusieurs tracks de natures différentes **dans un même pays**), distinct du **label d’écran**.
4. Éviter un JSON de traduction comme SoT.

---

## 8. Hiérarchie

**Cible évaluée :** COUNTRY → EDUCATION SYSTEM → CYCLE → LEVEL → TRACK/OPTION facultatif.

**Possible avec le schéma actuel ? Non**, pas sans nouvelles tables ou colonnes.

- COUNTRY : oui (`countries` + `country_id` sur levels/streams).
- EDUCATION SYSTEM : **absent**.
- CYCLE : **absent** (pas de parent de niveau).
- LEVEL : oui, plat par pays.
- TRACK : oui (`education_streams.level_id` nullable) — hiérarchie **max 2** (niveau → stream), pas 4.

Un stream a un code unique **par pays**, pas par niveau : on ne peut pas avoir « Scientifique » avec le même `stream_code` sur 4ème et 5ème en deux lignes distinctes. On peut soit une ligne pays-wide (`level_id` NULL), soit des codes différents (`scientifique_4e`).

**Ne pas implémenter EDUCATION SYSTEM / CYCLE avant validation produit.** Le socle actuel suffit pour secondaire RDC (niveaux + options). Université / formation professionnelle exigera probablement cycle ou `school_type` — **P2 de modèle**, pas un prérequis de la première PR classes.

---

## 9. Nom de classe — production actuelle

`classes.name` est :

- **totalement libre** (saisi dans le modal, max 120) ;
- **non généré** ;
- **unique par école + année** (nom normalisé `lower(btrim(name))`) ;
- **pas unique** par (level, section) : « 4ème A » et « 4e A » sont deux classes ;
- utilisé comme **clé logique** dans de nombreux lecteurs (voir §21).

L’identité technique interne est `classes.id` UUID. L’identité **API Classes** est `class_code` (le mapper pose `id: classCode`). Les élèves / notes / présences PG référencent `class_id` UUID. Les écrans Web filtrent souvent par **`className` string**.

---

## 10. Contrat cible du nom — faisabilité

Architecture visée : sélection Année + Niveau + Option + Groupe → composition `4ème Scientifique A` (ou template pays).

**Faisable avec le modèle actuel ? Non.** Il manque :

- `level_id` / `stream_id` / `group_code` sur `classes` ;
- un composeur serveur ;
- éventuellement `class_name_template` pays (voir §23).

Le modèle **catalogue + activation** est déjà là. Le **trou** est uniquement le contrat `classes` + UI.

---

## 11. Nom métier vs identité technique — dette `className`

### Canonique UUID (`class_id`)

`enrollments`, `teacher_assignments`, `evaluations`, `grades`, `attendance`, `school_courses`, `exams`, `report_cards`.

### P0 — le nom (ou un texte) est encore la clé

| Zone | Preuve |
|---|---|
| `ensureClassForSchool` | INSERT auto par **nom** si absent (`postgresRepository.js`) — contourne le catalogue et `Classes:CREATE` |
| Pédagogie / planning | index `(school_id, class_name, starts_at)` ; conflits sur `class_name` |
| `fee_grids.class_name` | TEXT, **pas** de `class_id` |
| `GET /api/students?className=` | égalité stricte sur le libellé projeté |
| `GET` présences `?className=` | idem |
| Import CSV élèves | valide la classe **par nom** (`importValidationService.js`) |
| JWT enseignant | `classNames` string set |
| Web notes / bulletins / frais | pickers sur `className` |
| `academicConfigs.classNames` | projection de noms (écriture via academic-config **interdite**, lecture encore utilisée) |
| Design bulletin preview | body `className` requis |

### P1 — contrat mixte

APIs acceptent souvent `className` / `classCode` puis résolvent un UUID. Projection `className` en lecture : **acceptable** si l’écriture est UUID. Aujourd’hui l’écriture classes reste texte + nom.

**Règle cible :** notes, élèves, présences, affectations, examens **référencent `class_id`**. Le nom n’est qu’un libellé. `ensureClassForSchool` doit **disparaître** ou devenir lookup-only (même philosophie que #235 sur l’année).

---

## 12. Groupes A / B / C — le champ « Section » du formulaire

**Réponse explicite :**

Le champ **Section** du modal `/etablissement/classes` est un **texte libre**. Il **ne représente pas** un concept unique.

Selon les données observées, il peut être :

- un **groupe** (A, B, C) — tests `classesManagement.test.js` (`section: "A"`) ;
- une **filière** — seed `track: "Sciences"` → colonne `section` ;
- n’importe quelle chaîne — API (`MAX_SECTION_LENGTH`).

**Ce n’est pas** un sélecteur A/B/C. **Ce n’est pas** non plus branché sur `education_streams`.

**Mélange filière + groupe dans un seul champ `section` = P0 de modélisation.**

---

## 13. Distinguer groupe et filière

Le modèle actuel **fait exactement ce qu’il ne faut pas** : un champ `section` (plus alias `track`) pour les deux.

Cible à étudier (non implémentée) :

- LEVEL → `level_id`
- TRACK / OPTION → `stream_id` nullable
- CLASS GROUP → `group_code` (`A`/`B`/`C` ou équivalent pays)
- `display_name` composé

Sans filière (6ème primaire A) : `stream_id` NULL — le schéma `education_streams.level_id` nullable **prépare** déjà le catalogue ; **pas** la table `classes`.

---

## 14. Admin Pays (COUNTRY_ADMIN)

| Capacité | Aujourd’hui |
|---|---|
| Lire niveaux/streams de **son** pays | OUI — GET backoffice + `COUNTRY_PRIVILEGES` + `assertEducationReferenceCountryRead` |
| Lire un autre pays | NON — 403 `COUNTRY_MISMATCH` |
| Créer / modifier / archiver le catalogue | **NON** — `assertSuperAdmin` + POST/PATCH sans `COUNTRY_PRIVILEGES` |
| Activer l’offre d’une école | **NON** (script de vérif) |
| POST /classes | **NON** — pas de `COUNTRY_PRIVILEGES` sur POST |

**Écart produit :** la cible « COUNTRY_ADMIN gère le référentiel de SON pays selon droits Superadmin » **n’est pas livrée**. Aujourd’hui c’est **lecture seule**, même si Superadmin lui accorde `Référentiels pédagogiques:CREATE` dans `role_module_permissions` : le **service** refuse tout de même (rôle hardcodé Superadmin). Double verrou : RBAC route **et** `assertSuperAdmin`.

---

## 15. Superadmin

- Voit tous les pays (sélecteur UI `/referentiels-pedagogiques`).
- Écrit le catalogue **par pays** (`countryCode` dans le body ; `ignoreClientScope` ignore un `countryCode` client sur PATCH mais CREATE l’exige **avant** ignore — CREATE utilise `rawPayload.countryCode`).
- Invariant RBAC : `education_reference` CREATE/READ/UPDATE, DELETE false (archive via UPDATE).
- **Pas** d’injection automatique d’un catalogue global dans tous les pays (pas de seed national unique en PG).  
  **Mais** les fallbacks Web/Mobile `DEFAULT_LEVELS` / `DEFAULT_TRACKS` **simulent** un catalogue global côté client quand l’activation est vide.
- UI : `useState(countries[0]?.code ?? "CD")` — **défaut RDC** à l’ouverture si la liste pays n’est pas encore hydratée. Dette UX / multi-pays, pas une écriture PG.

---

## 16. Admin School — rôle actuel vs cible

| Cible produit | Actuel |
|---|---|
| Ne crée pas les niveaux nationaux | **Respecté** (pas d’API school-scoped d’écriture catalogue) |
| Active les niveaux/options proposés | **Livré** — `SchoolEducationActivationPanel` + PUT activation |
| Crée les classes concrètes | **Livré** — `Classes:CREATE` |
| Choisit groupe A/B/C dans un catalogue | **Non** — texte libre |
| Choisit année académique | **Livré** (#235) — select d’années existantes, plus de création inline |
| Select niveau / filière depuis l’offre | **Non** — Inputs libres, **non branchés** sur le catalogue |

L’activation et la création de classe sont **orthogonales**. On peut activer 1ère–3ème et créer une classe « Terminale Z ».

---

## 17. Activation établissement — chemin exact

**Question :** le pays définit 1ère…6ème, l’école n’en active que 1ère–3ème. Où est le sous-ensemble ?

**Réponse :** PostgreSQL relationnel.

```
PUT /api/education-reference/school-activation
  { "levelIds": ["uuid…", "uuid…"], "streamIds": ["uuid…"] }

→ educationReferenceService.saveSchoolActivation
  → withTransaction
    → educationReferencePgStore.replaceSchoolActivation
      → DELETE FROM school_levels WHERE school_id = $1
      → DELETE FROM school_streams WHERE school_id = $1
      → INSERT school_levels / school_streams (status='active')
      → audit save_school_education_activation (dans la même TX)
```

Permission route : `Paramètres Établissement:UPDATE` **ou** `Référentiels pédagogiques:UPDATE` **ou** `ALL_PRIVILEGES`.  
**Pas** `Référentiels pédagogiques:CREATE`.  
**Pas** `Classes:CREATE`.

Projection lecture : `GET /api/academic-config` appelle `getSchoolEducationActiveLists` → **tableaux de noms** `levels[]` / `tracks[]` (pas d’UUID). C’est une **projection B**, pas la SoT.

**Ce n’est pas** `school_academic_configs.config_payload.levels`.

---

## 18. JSON / SoT — classification obligatoire

| Artefact | Classe | Commentaire |
|---|---|---|
| `education_levels`, `education_streams` | **A. PostgreSQL canonique** | Catalogue pays |
| `school_levels`, `school_streams` | **A. PostgreSQL canonique** | Activation école |
| `classes`, `academic_years`, `school_settings` | **A. PostgreSQL canonique** | Classes / années |
| `GET academic-config` `levels`/`tracks` | **B. projection / cache** | Noms dérivés de l’activation |
| `role_module_permissions` | **A. PostgreSQL canonique** | RBAC live |
| `backend/data.js` `demoLevels` / `demoTracks` | **C. seed** | Démo, style 1ère–6ème |
| `bulkPlatformSeed.js` `DEMO_LEVELS` / `DEMO_TRACKS` | **C. seed** | Idem, **toutes écoles / tous pays** du seed |
| `school_academic_configs.config_payload` clés `levels`/`tracks` | **D. legacy** | Écriture 400 ; strip boot |
| `backoffice_state` classes/levels | **D. legacy** | `ensureClassForSchool` lit encore `getBackOfficeState().classes` |
| `web/.../academicConfig.ts` `DEFAULT_LEVELS` / `DEFAULT_TRACKS` | **E. fallback dangereux** | Si projection vide → liste francophone globale |
| `Mobile/src/data/catalog.ts` mêmes constantes | **E. fallback dangereux** | Idem + `DEFAULT_CLASS_NAMES` |
| `scripts/e2e-class-rules.js` | **E / C** | Même fallback |
| `localStorage` / `sessionStorage` niveaux | **non SoT** | Session auth / école active seulement |
| Nouveau JSON catalogue | **interdit** (mandat) | |

Cible : **A uniquement** pour l’autorité. B acceptable en lecture. E à **supprimer** dans une PR corrective (fail-closed : liste vide ≠ défaut RDC).

---

## 19. APIs

Toutes les routes ci-dessous passent `requireAuth`. Sauf mention, `requirePermission` **rafraîchit** `resolveEffectivePermissions` (RBAC live, pas JWT stale) avant `canAccess`.

### Catalogue Superadmin

| Méthode | Route | Permission route | Scope | Table | Live |
|---|---|---|---|---|---|
| GET | `/api/backoffice/education-levels` | `Référentiels pédagogiques:READ` \| `Contrôler tous les pays` \| `ALL_PRIVILEGES` \| `COUNTRY_PRIVILEGES` | query `countryCode` ; Admin Pays = son pays | `education_levels` | live + garde service |
| POST | idem | `Référentiels pédagogiques:CREATE` \| `ALL_PRIVILEGES` | pays du body | insert | live + **assertSuperAdmin** |
| PATCH | `/api/backoffice/education-levels/:levelId` | `…:UPDATE` \| `ALL_PRIVILEGES` | | update | idem |
| POST | `…/:levelId/archive` | `…:UPDATE` \| `ALL_PRIVILEGES` | | status archived | idem |
| GET/POST/PATCH/archive | `/api/backoffice/education-streams` | même schéma | | `education_streams` | idem |

DELETE HTTP catalogue : **absent** (archive). Module `education_reference.canDelete = false` (invariant Superadmin).

### Activation école

| Méthode | Route | Permission | Table |
|---|---|---|---|
| GET | `/api/education-reference/catalog` | Paramètres READ/UPDATE, `Gérer classes`, `Gérer planning académique`, Référentiels READ, ALL, COUNTRY | lecture `education_*` + `school_*` du pays de l’école |
| PUT | `/api/education-reference/school-activation` | Paramètres UPDATE, Référentiels UPDATE, ALL | `school_levels`, `school_streams` |
| GET/PUT | `/api/backoffice/establishments/:schoolCode/education-reference/…` | même famille, scope `:schoolCode` | idem |

### Academic-config (projection)

| Méthode | Route | Permission | Note |
|---|---|---|---|
| GET | `/api/academic-config` | **auth only** — **pas** `requirePermission` | Dette. Projette `levels`/`tracks` noms. |
| GET | `/api/backoffice/establishments/:schoolCode/academic-config` | Paramètres READ/UPDATE, `Gérer classes`, `Gérer planning`, ALL, COUNTRY | |
| PUT | `/api/academic-config` et backoffice | Paramètres UPDATE, `Gérer planning`, `Gérer classes`, ALL, COUNTRY | **refuse** d’écrire `levels`/`tracks` |

`Gérer classes` reste un **jeton legacy** sur academic-config / catalogue GET. L’autorité Classes CRUD est `Classes:*`.

### Classes

| Méthode | Route | Permission | Table | Legacy |
|---|---|---|---|---|
| GET | `/api/classes` | `Classes:READ` \| `Voir classes` \| `Gérer classes` \| `COUNTRY_PRIVILEGES` \| `ALL_PRIVILEGES` | `classes` | live |
| POST | `/api/classes` | `Classes:CREATE` \| `Gérer classes` \| `ALL_PRIVILEGES` | INSERT texte | **pas de catalogue** |
| PATCH | `/api/classes/:classCode` | `Classes:UPDATE` \| `Gérer classes` \| `ALL_PRIVILEGES` | UPDATE texte | année immuable |

Body create : `name`, `academicYearName` (string), `level?`, `section?` ou `track?`, `status?`.  
**Pas** `academicYearId`, **pas** `levelId`, **pas** `streamId`.

---

## 20. RBAC — module Référentiels pédagogiques

- Catalogue fonctionnel : `moduleKey: "education_reference"`, `moduleName: "Référentiels pédagogiques"`, Web oui, Mobile **non** (`appliesMobile: false`).
- Actions visées : CREATE / READ / UPDATE / DELETE. DELETE UI = non (archive = UPDATE).
- `securityMatrix` de `backend/data.js` : **module absent** (legacy JSON, plus SoT).
- SoT : `role_module_permissions` PostgreSQL. Overlay `requirePermission` live.
- Invariant Superadmin : C/R/U true, D false.
- Défauts `internalRoleDefaults` Admin School : Classes CRUD + Paramètres UPDATE, **aucun** `Référentiels pédagogiques:*`.
- APIs catalogue POST/PATCH : `requirePermission` **et** `assertSuperAdmin` (rôle, pas seulement le jeton CRUD).

**Les APIs classes n’utilisent pas** `Référentiels pédagogiques:*`.  
**Les APIs référentiel n’utilisent pas** `Classes:*` pour écrire le catalogue.  
**Les deux pouvoirs ne sont pas mélangés sur les routes — mais ils ne sont pas non plus chaînés.** C’est l’écart produit : on voulait que Classes:CREATE **consomme** un catalogue déjà créé avec Référentiels:CREATE.

`GET /api/academic-config` : **trou** (auth only).

---

## 21. Classes RBAC vs Référentiels RBAC

Conforme à la cible de **séparation des pouvoirs d’écriture** :

- classe concrète → `Classes:CREATE` ;
- niveau national → `Référentiels pédagogiques:CREATE` (+ Superadmin).

**Non conforme** à la cible d’**intégrité** : `Classes:CREATE` n’exige pas une offre activée.

Jeton legacy `Gérer classes` ouvre encore POST /classes. À traiter dans une PR RBAC (hors audit) : même pattern que #235 (`Gérer classes` retiré de l’autorité années).

---

## 22. Multi-pays

| Contrôle | Statut |
|---|---|
| Catalogue PG filtré `country_id` | OK |
| Activation refuse UUID d’un autre pays | OK |
| Pas de table globale `DEFAULT_LEVELS` en PG | OK |
| Seed `DEMO_LEVELS` identique pour chaque école du bulk (y compris université Kinshasa) | **C. seed**, style unique |
| UI Superadmin défaut `"CD"` | dette |
| Client Web/Mobile `DEFAULT_LEVELS` si activation vide | **E — une école Burundi sans activation voit 1ère–6ème** |
| POST /classes | **aucune** isolation catalogue |

Aucun `countries[0]` côté **INSERT catalogue**. Le défaut `countries[0] ?? "CD"` est **UI Superadmin**.

**Une école Burundi ne reçoit pas les options RDC via PostgreSQL catalogue/activation.**  
**Elle peut les « recevoir » via fallback client, et elle peut les inventer via POST /classes.**

---

## 23. Type d’établissement

`schools.school_type` TEXT nullable (ex. Lycée, Université).  
**Aucune jointure / filtre** avec `education_levels` ou `education_streams`.

Une université peut activer « 6ème » si Superadmin l’a mis au catalogue **du pays** (le catalogue est national, pas par type).  
Filtrage par type = **évolution de modèle** (colonne `school_type` sur levels, ou système éducatif, ou offre typée). **Non exploitable aujourd’hui** sans nouvelle contrainte. Recommandation : P2 après socle classes FK, sauf si le produit universitaire est prioritaire.

---

## 24. Année académique (post-#235)

`academic_years` est canonique. Création de classe :

- **exige** une année existante ;
- **ne crée plus** d’année 01/09–31/08 ;
- consomme **`academicYearName` (string)**, pas `academic_year_id` UUID côté client ;
- lookup exact `academic_years.name` (pas `is_current` forcé).

Écart résiduel vs « consommer `academic_year_id` » : le contrat HTTP reste un **libellé d’année**. Cohérent avec l’unicité `(school_id, name)` mais fragile si renommage (PATCH année n’est pas répercuté comme FK cassée — la FK UUID tient ; le client qui stocke le nom peut diverger).

PR C recommandée : accepter `academicYearId` (UUID) comme contrat d’écriture, garder le nom en projection.

---

## 25. Contraintes `classes` — colonnes à normaliser

| Colonne | Devenir cible |
|---|---|
| `id` UUID | rester PK interne |
| `class_code` | rester identifiant public, **ne plus** servir de PK métier dans le mapper si possible (P1 API) |
| `school_id` | inchangé |
| `academic_year_id` | inchangé ; exposer UUID en write |
| `name` | devenir `display_name` généré (ou colonne générée + garder `name` sync) |
| `level` TEXT | → `level_id` UUID NOT NULL FK `education_levels` + offering |
| `section` TEXT | **scinder** → `stream_id` UUID NULL FK `education_streams` + `group_code` TEXT/CHAR |
| `status` | inchangé |
| alias `track` | supprimer après migration |

---

## 26. Modèle cible minimal (proposition, non implémenté)

Comparer à l’existant **avant** d’inventer `school_education_offerings`.

**Déjà présent (réutiliser) :**

- `education_levels` ≈ cible (ajouter éventuellement `cycle_id` plus tard).
- `education_streams` ≈ `education_tracks` (renommer n’est **pas** nécessaire ; documenter l’alias métier TRACK).
- `school_levels` + `school_streams` ≈ `school_education_offerings` (deux jonctions plutôt qu’une table unique). Une table unique `(school_id, level_id, track_id nullable, active)` permettrait d’exprimer « 4ème Scientifique » comme offre **combinée**. Aujourd’hui l’école active **niveaux** et **streams indépendamment** : on peut activer Scientifique sans 4ème, et inversement.

**Recommandation CTO :**

- **PR A (catalogue) :** conserver les 4 tables. Ajouter labels UI pays. Ouvrir COUNTRY_ADMIN write **si** le produit le confirme. Pas de rename `streams` → `tracks`.
- **PR B (offre) :** soit garder deux jonctions + règle « stream.level_id NULL ou ∈ school_levels » ; soit introduire `school_education_offerings` **seulement** si on veut des combinaisons level×track explicites. Ne pas dupliquer les deux modèles.
- **PR C (classes) :**

```
classes
  id UUID PK
  school_id
  academic_year_id
  level_id NOT NULL FK education_levels
  stream_id NULL FK education_streams
  group_code TEXT NOT NULL          -- 'A' ; pays sans groupe : valeur sentinelle '' ou '—' à trancher
  display_name TEXT NOT NULL        -- composé serveur
  status
```

Garde : `level_id` ∈ `school_levels` actif du même `school_id` et même `country_id` ; `stream_id` NULL ou ∈ `school_streams` + compatibilité `education_streams.level_id`.

**Ne pas créer `education_tracks` en parallèle de `education_streams`.**

---

## 27. Règle de nommage

**Aujourd’hui :** aucune. Le client tape le nom.

**Recommandation :** composeur **déterministe serveur**, pas de mini-language.

Ordre de complexité :

1. **V1 suffisante :** `join` des parties non vides avec espace : `{level.name} {stream.name?} {group_code}`.
2. **V2 si un pays exige un ordre différent :** colonne `countries.class_name_template` avec **placeholders fermés** `{level}` `{track}` `{group}` uniquement (pas d’expressions).
3. Éviter templates Mustache / DSL.

Le composeur vit dans le backend de `POST/PATCH /classes`. Le champ UI est **readonly**. Collision → 409 via UNIQUE structurel (§28), pas via le libellé seul (accents / « 4ème » vs « 4e »).

---

## 28. Unicité classe

**Actuel :** UNIQUE `(school_id, academic_year_id, lower(btrim(name)))`. Deux créations simultanées du **même nom** → une 201, une 409 (`classesRepository.pg.test.js`).  
Deux créations `name` différents, même 4ème / Scientifique / A → **deux succès**.

**Cible proposée :**

```sql
UNIQUE (school_id, academic_year_id, level_id, COALESCE(stream_id, '00000000-0000-0000-0000-000000000000'), group_code)
```

ou index unique PostgreSQL `UNIQUE NULLS NOT DISTINCT` (PG 15+) sur `(school_id, academic_year_id, level_id, stream_id, group_code)`.

Le nom affiché **ne doit plus** être la clé d’unicité (sinon « 4ème Scientifique A » vs « 4e Scientifique A »). On peut **garder** l’index nom comme filet anti-doublon d’affichage (P1), en plus de l’index structurel (P0).

---

## 29. UI cible

Modal visé (aucune correction dans cette PR) :

- Année scolaire — déjà un `<Select>` d’années existantes.
- Niveau — aujourd’hui `<Input>` libre → doit devenir `<Select>` catalogue activé.
- Filière / option — **absent** en select ; « Section » Input → scinder en Track select + Groupe select.
- Nom — aujourd’hui saisi → readonly généré.
- Vocabulaire des labels : selon pays (§7).

Web actuel : `web/src/pages/etablissement/ClassesListPage.tsx`.  
Superadmin catalogue : `web/src/pages/EducationReferencePage.tsx`.  
Activation : `web/src/components/SchoolEducationActivationPanel.tsx` (Paramètres).

---

## 30. Cas sans filière

Catalogue : `education_streams.level_id` déjà nullable ; une école peut n’activer **aucun** stream.  
Classes : `section` nullable aujourd’hui — on peut créer « 6ème A » sans section, mais le groupe est alors **dans le nom**.

Cible : `stream_id` NULL autorisé ; `group_code` reste. Ne **pas** forcer une filière sur le primaire.

---

## 31. Relations métier (consommateurs)

| Domaine | Identité stockée | Filtre / UI |
|---|---|---|
| Enrollments | `class_id` UUID | |
| Teacher assignments | `class_id` UUID | JWT `classNames` |
| Subjects | `subject_class_assignments.class_id` **ou** `level` TEXT | `subjects.level` TEXT parallèle au catalogue |
| Courses | `school_courses.class_id` | API encore `className` |
| Planning | `class_id` + **`class_name` TEXT** | conflits nom |
| Présences | `attendance.class_id` | query `className` |
| Notes / évaluations | `class_id` | pickers `className` |
| Examens | `class_id` | |
| Bulletins | `class_id` nullable | preview `className` |
| Frais | **`fee_grids.class_name` TEXT** | |
| Import CSV | nom | |
| Export snapshot | `class_name` en lecture | |

Les domaines PG « sérieux » sont déjà en UUID. La **création** de classe et une frange finance/planning/import restent en texte. C’est pourquoi la migration colonnes classes est possible **sans** réécrire notes/présences, **à condition** de ne plus résoudre par nom (`ensureClassForSchool`).

---

## 32. Mobile

- Liste : `ClassesScreen` — **lecture**. Pas de formulaire de création (parcours AdminCrud classes retiré / lecture seule).
- Pas de client d’activation `education-reference`.
- `AdminCrudScreen` : si `academicConfig.levels/tracks/classNames` vides → `DEFAULT_LEVELS` / `DEFAULT_TRACKS` / `DEFAULT_CLASS_NAMES`.
- `Mobile/src/data/catalog.ts` : même seed que le Web (1ère–6ème, Générale/Sciences/…).
- Carte configuration « Niveaux et filières » : **sans route** d’activation.

Aucun catalogue local **ne doit survivre** comme SoT. Les constantes Mobile sont aujourd’hui un **catalogue fantôme**.

---

## 33. Import / export

- CSV élèves : colonne `classe` / `className` — **référence par libellé**, rejet si nom inconnu. Cible : accepter UUID ou code public `class_code`, afficher le nom.
- PDF / bulletins : affichage nom — **OK** ; preview design exige `className`.
- `dataExportSnapshot` : projette `class_name`.
- Finance unpaid : query `className`.

Les exports **peuvent** rester nommés. Les imports **doivent** cesser d’être la seule clé.

---

## 34. Migration des classes existantes (diagnostic, pas d’exécution)

Ne rien migrer maintenant.

Critères :

| Cas | Classe | Pourquoi |
|---|---|---|
| `classes.level` **égal exact** (après normalize) à `education_levels.name` du **même** `schools.country_id`, **un seul** match | **mapping sûr** | |
| `level` vide / NULL | **ambigu** | pas de niveau |
| `level` « 4e » vs catalogue « 4ème » | **ambigu** | |
| `level` présent dans **plusieurs** pays mais l’école a un `country_id` : match unique pays | **sûr** si unique dans ce pays | |
| `section` ∈ noms `education_streams` du pays, unique | **sûr vers stream_id** ; groupe inconnu | |
| `section` ∈ `{A,B,C,D,E}` (une lettre) | **sûr vers group_code** ; filière inconnue | |
| `section` qui matche **à la fois** une filière et une lettre (peu probable) | **ambigu** | |
| `section` « Sciences » alors que catalogue « Scientifique » | **ambigu** | |
| nom `6ème A` avec `level=6ème` et `section` filière | **groupe extractible du nom** si suffixe `[A-Z]` **et** level cohérent — **ambigu** dès qu’un nom custom existe (`Toto classe`, `Terminale S2`) | |
| aucune activation école | mapping catalogue pays possible ; **offering** à créer en diagnostic, pas en silencieux | |

**Verdict migration :** on **ne peut pas** mapper sans ambiguïté l’existant. PR E = **rapport SQL de classification** (sûr / ambigu / impossible) + outil d’affectation manuelle. Interdiction de backfill automatique destructif.

Volume : non chiffré ici (audit code, pas dump préprod). La PR E devra compter `COUNT(*)` par seau sur la base cible.

---

## 35. Fail-closed (gardes futures — documentées, non codées)

Après migration, `POST /api/classes` doit **rejeter** tout body `{ level: "NIVEAU INVENTÉ" }` :

1. Refuser `level` / `section` / `track` / `name` libres (400 champs inconnus ou 410 contrat).
2. Exiger `academicYearId`, `levelId`, `groupCode` ; `streamId` optionnel.
3. Résoudre l’année : `academic_years.id` + `school_id` du principal (pas le nom seul).
4. `levelId` ∈ `school_levels` actif **et** `education_levels.country_id = schools.country_id` **et** status active.
5. `streamId` NULL ou ∈ `school_streams` + même pays + (si `education_streams.level_id` NOT NULL, égalité avec `levelId`).
6. `groupCode` ∈ liste pays **ou** charset borné (à trancher : A–Z vs référentiel `education_class_groups`).
7. Composer `display_name` serveur ; ignorer un nom client.
8. UNIQUE structurel ; 409 concurrent.
9. **Pas** de `ensureClassForSchool` INSERT.
10. Même gardes en PATCH.

Aujourd’hui **aucune** de ces gardes n’existe sur POST /classes.

---

## 36. Concurrence

Deux POST « 4ème Scientifique A » **même nom** : une réussite, une 409 (index nom).  
Deux POST noms différents, même structure pédagogique : **deux réussites**.

Cible : l’index `(school_id, academic_year_id, level_id, stream_id, group_code)` avec NULLS NOT DISTINCT.

`class_code` UNIQUE global : collisions retry (5 tentatives) — orthogonal.

---

## 37. Transaction / audit

**Catalogue / activation :** `withTransaction` + `recordAudit` **dans** la TX. Rollback si audit indisponible (`writeEducationAudit` throw 500). **Bon modèle.**

**POST /classes :** `INSERT` puis `auditService.record` **HTTP, hors TX SQL**. Si l’audit échoue, la classe **existe déjà**. Si le process crash après INSERT, pas d’audit. **P1** (même famille que d’autres routes ; enrollments/teachers ont été durcis ailleurs).

Cible : `withTransaction` { validate offering ; INSERT class ; audit } comme l’activation pédagogique.

---

## 38. Synthèse des écarts (index rapide)

Voir sections 1–37. Les blocs 38–41 du mandat sont couverts par : ce document (§1–§2 SHA, §3–§25 état, §26–§28 cible, §34 migration, §27–§28 nommage/unicité, §29 UI, §35 gardes, §39 plan PR, §30 verdict).

---

## 39. Plan de PR correctives (après validation CTO)

**Cette PR (audit) = document uniquement. STOP.**

Les lots A/B du mandat sont **partiellement déjà en production**. Le plan ci-dessous **ne refait pas** le catalogue ni l’activation : il les **branche** et retire les fuites.

### PR A — Catalogue pays (socle restant)

- Labels UI par pays (`level_label` / `track_label` / `group_label`).
- COUNTRY_ADMIN write **si** validation produit (retirer `assertSuperAdmin` au profit de `Référentiels pédagogiques:CREATE` live + scope pays).
- Interdire défaut UI `"CD"` / `countries[0]`.
- Supprimer (ou never-use) `DEFAULT_LEVELS` / `DEFAULT_TRACKS` Web+Mobile+e2e : liste vide = vide.
- `GET /api/academic-config` : `requirePermission` READ Paramètres ou Référentiels.
- **Pas** de nouvelle table `education_tracks`. **Pas** de JSON SoT. **Pas** de hardcode RDC comme catalogue mondial.

### PR B — Offre établissement obligatoire pour créer une classe

- Gardes §35 sur l’activation **avant** INSERT class (peut fusionner avec C).
- Mobile : écran d’activation ou message « configurer sur le Web ».
- Règle stream↔level si `level_id` renseigné sur le stream.
- Décision : jonctions séparées vs `school_education_offerings` combinatoire — **trancher ici**.

### PR C — `classes` structurelles

- Colonnes `level_id`, `stream_id`, `group_code`, `display_name`.
- UNIQUE structurel ; composeur serveur.
- Write `academicYearId`.
- Retirer `ensureClassForSchool` INSERT (lookup-only).
- Audit dans la TX.
- `Gérer classes` retiré de l’autorité POST si encore présent (alignement #235).

### PR D — Web + Mobile sans texte libre

- Modal : selects année / niveau activé / track activé / groupe ; nom readonly.
- Labels selon pays.
- Mobile : plus de `DEFAULT_*` ; pas de création hors contrat (déjà lecture) ; filtres className → `classId`/`classCode` progressivement.

### PR E — Diagnostic / migration existant

- Requête de classification sûr / ambigu / impossible.
- UI Superadmin de rattachement manuel.
- **Aucun** UPDATE de masse sans validation ligne.
- Finance `fee_grids.class_id` ; planning cesser les conflits sur `class_name`.

Ordre : **A (fuites + labels) ∥ C+B (même bascule fail-closed)** puis **D** puis **E**.  
Si on livre D avant C, l’UI selecterait des UUID que POST ignore encore — **interdire**. D dépend de C.

---

## 40. Gouvernance

- Branche créée depuis `develop` @ `957ee644546e3f491054552299b5ff7ad91894ab`.
- PR **DRAFT AUDIT-ONLY**.
- Aucun Ready. Aucun merge.
- **STOP CTO.**
- Toute PR A–E exige **validation explicite de ce rapport**.
- #234 (audit années) reste DRAFT. #235 est mergé (socle années). Ne pas les conflater.

---

## 41. Risques

| Risque | Gravité |
|---|---|
| Admin School invente niveaux/filières → statistiques et bulletins **non comparables** intra-pays | P0 produit |
| Fallback `DEFAULT_LEVELS` affiche un secondaire francophone à une école sans catalogue (y compris université / Burundi) | P0 multi-pays |
| Champ `section` = filière **et** groupe → migration irréversible si on « choisit » trop tôt | P0 modèle |
| `ensureClassForSchool` crée des classes hors RBAC / hors catalogue | P0 intégrité |
| `fee_grids` / import / JWT encore nommés → rename de classe casse la finance et le scope enseignant | P1 |
| COUNTRY_ADMIN ne peut pas tenir le référentiel national (charge Superadmin) | P1 produit |
| Catalogue plat (pas de cycle / type école) insuffisant pour l’université | P2 |
| Audit classe hors TX | P1 |
| `GET /api/academic-config` sans permission CRUD | P1 RBAC |
| Unicité sur le libellé seulement | P1 concurrence métier |

---

## 42. P0 / P1 / P2

### P0

1. `POST /classes` n’applique **aucune** garde catalogue / offering.
2. Modal Classes : nom + niveau + section **texte libre** (préprod `/etablissement/classes`).
3. **Un champ `section` mélange groupe et filière.**
4. Fallbacks `DEFAULT_LEVELS` / `DEFAULT_TRACKS` (Web, Mobile, e2e).
5. `ensureClassForSchool` INSERT par nom.

### P1

1. COUNTRY_ADMIN lecture seule malgré la cible produit.
2. Labels UI non configurables (vocabulaire RDC figé dans l’UI « Filière » / « Section »).
3. `className` encore clé (CSV, fee_grids, querystring, JWT, planning).
4. Contrat année par **nom** et non UUID.
5. Audit classe hors transaction.
6. `GET /api/academic-config` auth-only ; jeton `Gérer classes` encore sur POST.
7. UI Superadmin défaut `CD`.
8. Projection academic-config = noms sans UUID (UI D ne peut pas être fail-closed).

### P2

1. EDUCATION SYSTEM / CYCLE.
2. Filtre `school_type`.
3. Université Faculté / Département.
4. Table `education_class_groups` vs charset A–Z.
5. Rename API `tracks` → `streams` (cosmétique ; stabilité contrat).

---

## 43. Verdict final

**NO-GO** mise en production de la règle « l’Admin School ne fait que consommer le référentiel pays ».

**GO** correctif **séquencé** après **validation écrite** de ce rapport par le CTO.

Ce qui est **déjà solide** (ne pas casser) :

- tables pays-scopées `education_levels` / `education_streams` ;
- activation PG `school_levels` / `school_streams` avec `COUNTRY_MISMATCH` ;
- interdiction d’écrire levels/tracks dans le JSON academic-config ;
- années `academic_years` post-#235 ;
- séparation route `Référentiels:CREATE` ≠ `Classes:CREATE` ;
- RBAC live `requirePermission` + `role_module_permissions` ;
- unicité de **nom** de classe par école/année (insuffisante mais réelle).

Ce qui **bloque** le critère final : le **dernier kilomètre** classe (colonnes texte, UI libre, pas de FK, pas de groupe, fallback client).

---

*Fin de l’audit. Aucune correction dans cette PR. STOP CTO.*
