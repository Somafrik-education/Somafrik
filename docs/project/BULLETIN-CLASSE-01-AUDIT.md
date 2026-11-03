# BULLETIN-CLASSE-01 — audit d'architecture et de compatibilité

Statut : **Draft / HOLD — audit documentaire seul.** Aucun code, schéma, migration, déploiement ni intervention Supabase dans cette PR. L1 ne s'ouvre qu'après clôture et fusion autorisée de #1054.
Base : `develop` @ `c27a7b9e` (#1051, #1052, #1053 inclus).

Objectif : chaque classe, pour son année scolaire, dispose de sa propre configuration de bulletin (matières, maxima, règles d'évaluation, en-tête, signatures), sans effet sur les autres classes ni sur les bulletins déjà publiés.

## 1. Décisions CTO intégrées

| # | Décision | Traduction dans l'architecture |
|---|---|---|
| D1 | Portée `school_id + model_key + academic_year_id + class_id`, approuvée sous conditions | §4 : clé technique `id`, index uniques partiels, FK composite classe ↔ année, `model_key` et `report_card_id` inchangés, UPSERT compatibles, migration idempotente et rollback contrôlé. Pas de suppression « simple » de la PK : remplacement justifié (§4.2). |
| D2 | Héritage établissement approuvé | §5 : résolution classe → établissement (lecture seule) → `MODEL_NOT_BOUND` ; une classe peut remplacer l'héritage par une configuration propre ; C1 sans effet sur C2. |
| D3 | Brouillon : informations actuelles ; publié : informations officielles figées | §6 : en-tête versionné dans le gabarit (sélection et disposition fermées) ; identité officielle figée dans le contenu signé des **nouvelles** publications ; anciens bulletins inchangés. |
| D4 | Copie entre classes reportée | Hors lots initiaux. Une copie future créera des versions et une liaison **propres** à la classe destinataire, jamais une liaison partagée. |
| D5 | PostgreSQL 17.6 en préproduction et en production | Index partiels, FK composites, `gen_random_uuid()` : disponibles. La migration reste compatible ≥ 12 (CI : 16). |

## 2. Constat : stockage canonique actuel

| Élément | Table | Clé actuelle | Portée |
|---|---|---|---|
| Demande de configuration | `report_card_configuration_requests` | `id` ; `uq_report_card_configuration_one_active (school_id, model_key) WHERE status = 'ACTIVE'` | établissement |
| Profil (matières, maxima, sources) | `academic_rule_profiles` + `_versions` | `(school_id, profile_key)` = `catalog-<modèle>` | établissement |
| Schéma | `report_card_schemas` + `_versions` | `(school_id, schema_key)` | établissement |
| Gabarit (style, signatures, intitulés) | `report_card_rendering_templates` + `_versions` (trigger `RENDERING_TEMPLATE_VERSION_IMMUTABLE`) | `(school_id, template_key)` | établissement |
| **Liaison active** | `report_card_active_bindings` | **PK `(school_id, model_key)`** ; FK `(request_id, school_id)` → demandes | établissement |
| Bulletin publié | `report_card_published_snapshots` (octets canoniques signés) | `(school_id, report_card_id, version)` | élève × classe × année × modèle × période |

Accès SQL à la liaison : `upsertBinding` (`INSERT … ON CONFLICT (school_id, model_key) DO UPDATE`) et `getBinding` (`SELECT * … WHERE school_id = $1 AND model_key = $2`), dans `reportCardConfigurationPgStore.js`. **Aucune table ne référence** `report_card_active_bindings` par clé étrangère.

Chemins de lecture :

- **Publication d'une classe** : point de résolution unique `resolveBoundBundle(configuration, schoolId, modelKey)` (`reportCardClassPublication.loadBundle`).
- **Identité d'un bulletin** : `report_card_id = sha256({school, class, year, model_key, scope, student})`.
- **Idempotence** : `content_sha256` couvre tout le contenu publié (`engine_id, provenance, school_id, class_id, academic_year_id, model_key, period_scope, student`) ; même contenu → `ALREADY_PUBLISHED`, contenu différent → conflit / correction.
- **Correction officielle** : recalcul sur les versions **épinglées** de la provenance (`pinned`), indépendant de la liaison courante.
- **Consultation et PDF publiés** : gabarit lu par `provenance.template {id, version, spec_sha256}` (empreinte vérifiée), profil par `provenance.profile`.
- **Libellés affichés** (établissement, classe, année, élèves, matières) : lus **en direct** (`reportCardPresentationLabelsStore`). Le PDF n'affiche pas de logo aujourd'hui.
- **Contrat de snapshot** : seuls `report_card_id`, `published_snapshot_version`, `school_id`, `published_at` sont obligatoires ; un champ supplémentaire est admis.
- **Assistant école** : toutes les matières actives de l'établissement, aucune classe. **Mobile natif** : consultation seule, sans en-tête configurable ni signatures.

## 3. Contraintes de compatibilité

1. `model_key` historique conservé ; `report_card_id` jamais modifié. La portée classe/année vit dans la **résolution de la liaison**, pas dans la clé du modèle.
2. Snapshots, versions, PDF et QR publiés : jamais modifiés ni réécrits ; toute évolution passe par de **nouvelles versions** immuables.
3. Liaisons établissement existantes (#1051) conservées et fonctionnelles sans action.
4. Une classe appartient à une année (`classes.academic_year_id NOT NULL`) : année déduite de la classe côté serveur, contrôlée en base.
5. Tenant : `school_id` partout, FK composites `(…, school_id)`.
6. Superadmin : administrateur de plateforme seulement (disponibilité des modèles par pays) ; aucun accès à la configuration pédagogique d'une classe.
7. Protections du catalogue #1053 (RLS, rôle applicatif, aucun accès `anon`/`authenticated`) inchangées.

## 4. Schéma cible (lot L1) — extension du stockage canonique

### 4.1 Options

| Option | Principe | Verdict |
|---|---|---|
| **A. Étendre la liaison et les demandes canoniques** | colonnes de portée, clé technique, index uniques partiels | **Retenue** |
| B. `model_key` par classe | `catalog-colombiere@<classe>` | Rejetée : change `report_card_id`, doublons officiels possibles |
| C. Table parallèle de liaisons par classe | nouvelle table | Rejetée : extension possible (gouvernance) |

### 4.2 Pourquoi la PK actuelle doit être remplacée (et comment, sans perte de garantie)

La PK `(school_id, model_key)` interdit, par construction, plusieurs liaisons pour un même modèle : elle est **incompatible** avec D1 (une liaison par classe et par année). La conserver impose les options B ou C, rejetées. Elle n'est référencée par aucune clé étrangère. Son invariant (« une liaison établissement par modèle ») est **conservé exactement** par un index unique partiel créé **avant** le remplacement, dans la même transaction : l'unicité ne disparaît à aucun instant.

`report_card_active_bindings` :

```sql
ALTER TABLE report_card_active_bindings
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS academic_year_id UUID,
  ADD COLUMN IF NOT EXISTS class_id UUID;
UPDATE report_card_active_bindings SET id = gen_random_uuid() WHERE id IS NULL;   -- lignes existantes
ALTER TABLE report_card_active_bindings ALTER COLUMN id SET NOT NULL;

-- Portée : classe et année ensemble ou aucune des deux.
ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_scope_pair
  CHECK ((class_id IS NULL) = (academic_year_id IS NULL));                          -- (si absente)

-- Invariant historique conservé : une liaison établissement par modèle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_active_bindings_school
  ON report_card_active_bindings (school_id, model_key) WHERE class_id IS NULL;
-- Nouvel invariant : une liaison par modèle, classe et année.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_active_bindings_class
  ON report_card_active_bindings (school_id, model_key, academic_year_id, class_id) WHERE class_id IS NOT NULL;

-- Cohérence classe ↔ année ↔ établissement garantie en base.
ALTER TABLE classes ADD CONSTRAINT classes_id_year_school UNIQUE (id, academic_year_id, school_id);  -- (si absente)
ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_class_tenant
  FOREIGN KEY (class_id, academic_year_id, school_id) REFERENCES classes (id, academic_year_id, school_id); -- (si absente)

-- Remplacement de la PK (si la PK d'origine existe encore), après création des index ci-dessus.
ALTER TABLE report_card_active_bindings DROP CONSTRAINT report_card_active_bindings_pkey;
ALTER TABLE report_card_active_bindings ADD CONSTRAINT report_card_active_bindings_pkey PRIMARY KEY (id);
```

- La FK existante `report_card_active_bindings_request_tenant (request_id, school_id)` est **conservée**.
- FK composite `MATCH SIMPLE` : ignorée pour les lignes établissement (`class_id` NULL), active pour les lignes de classe. Une classe d'un autre établissement ou d'une autre année est **refusée par la base**.
- `classes_id_year_school` est trivialement satisfaite (`id` est déjà clé primaire) ; vérification préalable par le préflight.

`report_card_configuration_requests` :

```sql
ALTER TABLE report_card_configuration_requests
  ADD COLUMN IF NOT EXISTS academic_year_id UUID, ADD COLUMN IF NOT EXISTS class_id UUID;
-- même CHECK de paire et même FK composite vers classes
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active_school
  ON report_card_configuration_requests (school_id, model_key) WHERE status = 'ACTIVE' AND class_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active_class
  ON report_card_configuration_requests (school_id, model_key, academic_year_id, class_id) WHERE status = 'ACTIVE' AND class_id IS NOT NULL;
DROP INDEX IF EXISTS uq_report_card_configuration_one_active;  -- remplacé, après création des deux index
```

Idempotence : chaque étape est conditionnée (`IF NOT EXISTS`, test de `pg_constraint` / `pg_index` dans un bloc `DO`). Exécution : jamais au démarrage, `psql --single-transaction`, `lock_timeout` court. Aucune ligne existante n'est modifiée en dehors du remplissage de `id`.

### 4.3 Conséquences sur les requêtes et les UPSERT

| Accès | Aujourd'hui | Après migration | Lot |
|---|---|---|---|
| `upsertBinding` (établissement) | `ON CONFLICT (school_id, model_key)` | `ON CONFLICT (school_id, model_key) WHERE class_id IS NULL` (inférence de l'index partiel) | **L1** |
| `upsertBinding` (classe) | — | `ON CONFLICT (school_id, model_key, academic_year_id, class_id) WHERE class_id IS NOT NULL` | L2 |
| `getBinding` | `WHERE school_id AND model_key` | `… AND class_id IS NULL` (établissement) ; variante classe | **L1** / L2 |
| `getActiveByPair`, demande ouverte du catalogue | `(school_id, model_key)` | filtrés par portée (`class_id IS NULL` ou classe donnée) | **L1** / L2 |

**Risque d'ordonnancement** : sans ces adaptations, l'UPSERT historique échouerait dès l'application de la migration (`no unique or exclusion constraint matching the ON CONFLICT specification`) et `getBinding` pourrait renvoyer une liaison de classe. **L1 livre donc, avec la migration, les adaptations minimales du store** (filtre `class_id IS NULL`, cible d'UPSERT), compatibles avec le schéma avant et après migration (détection de la colonne). Ordre de mise en service : code L1 déployé, puis migration appliquée manuellement.

### 4.4 Vérification de l'esquisse (base jetable, PostgreSQL 16)

L'esquisse §4.2 a été exécutée sur une base jetable reproduisant la PK actuelle, sans aucun accès à la préproduction : remplacement de la PK en une transaction ; UPSERT établissement via l'index partiel ; UPSERT de classe (deux passes, une seule ligne) ; **l'UPSERT historique sans prédicat échoue** après migration (`no unique or exclusion constraint matching the ON CONFLICT specification`), ce qui confirme le risque d'ordonnancement §4.3 ; classe d'un autre établissement et année incohérente refusées par la FK composite ; classe sans année refusée par le `CHECK`. La migration réelle et ses tests PostgreSQL sont livrés en L1.

### 4.5 Rollback contrôlé

Fichier `…rollback.sql`, jamais automatique. Bloquant si une liaison ou une demande de classe existe (préflight NO-GO ; on ne supprime jamais de configuration). Sinon, dans une transaction : recréer la PK `(school_id, model_key)` et l'index `uq_report_card_configuration_one_active`, supprimer les index partiels, contraintes et colonnes ajoutés. Les snapshots ne sont jamais concernés.

## 5. Résolution, activation et isolation (lot L2)

**Ordre de résolution** à la publication d'une classe C (année Y déduite de C) :

1. liaison `(school, model_key, Y, C)` ;
2. sinon liaison établissement `(school, model_key, NULL, NULL)` — **lecture seule** dans le nouvel assistant ;
3. sinon `MODEL_NOT_BOUND`.

Point d'implémentation unique : `resolveBoundBundle` (et `loadBundle`). Les corrections (`pinned`) ne passent pas par la résolution : inchangées.

**Remplacer l'héritage** : la première activation pour C crée la liaison de classe ; la liaison établissement reste intacte pour les autres classes.

**Clés de versions propres à chaque classe** : profil, schéma et gabarit d'une classe utilisent la clé `<model_key>.<class_id>` (ex. `catalog-colombiere.3f2c…`, ≤ 64 caractères ; format accepté par les stores à vérifier en L2). Activer une version pour C1 ne change ni le statut ni le contenu des versions liées à C2 ou à l'établissement.

**Isolation et RBAC** :

- classe obligatoire ; classe vérifiée comme appartenant à l'établissement du jeton (et par la FK composite) ; incohérence classe/année refusée (`CLASS_YEAR_MISMATCH`) ;
- seules la demande et la liaison de C sont écrites ; aucune écriture sur la liaison établissement depuis l'assistant de classe ;
- permissions inchangées : `REPORT_CARD_SCHOOL_APPROVE_TEMPLATE` (admin établissement) pour enregistrer / activer ; enseignant en lecture ; parent refusé ; **Superadmin refusé** sur toutes les routes de configuration de classe ;
- le modèle doit rester disponible dans le pays (#1051) ; RLS du catalogue (#1053) inchangée.

**Matières de la classe** : le contexte de l'assistant ne propose que les matières ayant un cours actif dans la classe (`school_courses.class_id`, `status = 'active'`), avec la matière principale des sous-matières affectées pour le modèle Berceau. Une matière sans cours dans la classe est refusée (`SUBJECT_NOT_IN_CLASS`). Les deux modèles (Colombière, Berceau) et leurs structures (TJ/EX, note unique) sont conservés.

## 6. En-tête, signatures et informations officielles (lot L3, D3)

**Paramétrage versionné** : nouvelle clé optionnelle `presentation.header` du gabarit (même mécanisme que `signatures`, `period_labels` ; absente ⇒ spec et empreinte des gabarits existants inchangées) :

```json
"header": {
  "layout": "logo_left",
  "show": ["logo", "establishment_name", "establishment_address", "country", "academic_year", "class", "period", "student_name", "student_code"],
  "lines": ["République démocratique du Congo", "Ministère de l'Enseignement primaire, secondaire et technique"],
  "title": "Bulletin scolaire"
}
```

- `layout` : liste fermée (`logo_left`, `logo_center`, `no_logo`) ; `show` : liste fermée et ordonnée ; ≤ 4 lignes libres de 80 caractères ; titre ≤ 60. Pas d'éditeur libre, pas de HTML.
- Identifiants neutres (la spec refuse les clés `school*` / `country*`).
- **Signatures** : `presentation.signatures` (≤ 4) dans la même étape, inchangé.

**Brouillon et aperçu** : valeurs **actuelles** de l'établissement (nom, logo, adresse), lues en direct.

**Bulletin officiel publié — identité figée** : pour toute publication dont le gabarit épinglé contient `presentation.header`, le contenu signé reçoit un champ `official_identity` :

```json
"official_identity": { "establishment_name": "…", "establishment_address": "…", "country": "…", "logo_sha256": "…" }
```

- Le logo est figé par empreinte : l'octet exact est conservé dans le stockage adressé par contenu existant des artefacts (`reportCardSourceStorage`, jamais supprimé) ; le rendu vérifie l'empreinte avant affichage.
- Signé avec le reste du snapshot : toute réimpression reproduit l'en-tête d'origine, même si l'établissement change ensuite de nom, de logo ou d'adresse.
- **Compatibilité** : le champ n'est ajouté **que** pour les gabarits avec `header` (nouvelles configurations de classe). Les liaisons établissement et les bulletins existants gardent exactement leur contenu, leur `content_sha256` (idempotence) et leur rendu actuel (libellés vivants).
- Aucun snapshot historique n'est modifié ni réécrit.

**Rendu** : Web (`ReportCardPresentationTable`), PDF (`reportCardPdf`) et Mobile (`ReportCardPresentationView`) lisent le même en-tête depuis la présentation calculée : `official_identity` pour un bulletin publié, valeurs actuelles pour un brouillon. Mobile ajoute l'en-tête et le bloc signatures (consultation seule).

## 7. Parcours UX cible (lot L4)

1. **Classe et structure d'évaluation** : classe obligatoire (classes de l'établissement connecté, année scolaire affichée) ; TJ/EX ou note unique ; mention « hérite de la configuration établissement » le cas échéant.
2. **Matières et maxima** : uniquement les matières enseignées dans la classe.
3. **Calcul des notes** : types d'évaluation, mode de calcul, périodes.
4. **En-têtes et signatures** : éléments affichés, disposition, lignes et titre limités, signataires.
5. **Aperçu** : rendu fidèle au bulletin final (moteur réel, données fictives, informations actuelles de l'établissement).
6. **Récapitulatif et activation** : activation confirmée, limitée à la classe sélectionnée.

La classe et l'année restent visibles à chaque étape et au récapitulatif. Gestion des bulletins : après le choix de la classe, seuls les modèles liés à cette classe ou hérités sont proposés.

## 8. Matrice de compatibilité

| Élément existant | Effet |
|---|---|
| Snapshots, versions, signatures, QR | Aucun (immuables, provenance épinglée) |
| PDF historiques | Aucun (gabarit épinglé ; pas de `official_identity` ⇒ rendu actuel conservé) |
| Corrections officielles | Aucun (versions épinglées) |
| Liaisons établissement (#1051) | Conservées, invariant d'unicité conservé, utilisées en repli |
| `model_key`, `report_card_id`, `content_sha256` des liaisons existantes | Inchangés |
| FK existantes | Conservées |
| Catalogue par pays, RLS (#1051/#1053) | Inchangés |
| Permissions et Superadmin | Inchangés |
| Routes MONO-T1 | Paramètre `classId` ajouté aux routes de configuration ; inventaire régénéré (L2) |

## 9. Lots

| Lot | Périmètre | Dépend de | Risques principaux | Critères d'acceptation |
|---|---|---|---|---|
| **L1** | Migration §4 (bindings, demandes, contrainte `classes`), préflight lecture seule, rollback, adaptations minimales du store (§4.3), tests PostgreSQL | #1054 fusionnée | UPSERT / `getBinding` cassés si le store n'est pas adapté ; verrou sur `classes` | Migration idempotente (2 passes) sur base vierge et sur base #1051 avec liaisons ; invariants d'unicité testés ; FK composite refuse classe/année incohérente ou autre établissement ; activation établissement inchangée avant et après migration ; rollback OK sans liaison de classe, NO-GO sinon ; préflight GO/NO-GO ; jamais au démarrage |
| **L2** | Résolution classe → établissement → erreur, assistant scopé classe, matières de la classe, clés par classe, activation, isolation, RBAC, MONO-T1 | L1 | régression de publication ; clé de version trop longue | Isolation A/B, C1/C2, Y1/Y2 ; aucune propagation ; repli établissement ; `report_card_id` identique avant/après passage d'une classe à sa propre liaison ; Superadmin refusé |
| **L3** | `presentation.header`, signatures, `official_identity`, rendu Web/PDF/Mobile, logo figé | L2 | idempotence (`content_sha256`) ; stockage du logo | Empreinte des gabarits sans `header` inchangée ; publications existantes octet pour octet identiques ; réimpression fidèle après changement de nom/logo/adresse ; brouillon = valeurs actuelles |
| **L4** | Assistant Web 6 étapes, gestion des bulletins filtrée par classe, consultation Mobile (en-tête, signatures) | L2, L3 | cohérence Web / Mobile | Tous états UI (chargement, vide, erreur, refus, héritage) ; tests Vitest et Mobile ; accessibilité |
| **L5** | E2E réel, PDF, captures bureau/tablette/mobile, procédure et smoke préproduction | L1–L4 | environnement préproduction | E2E vert ; PDF comparés ; procédure validée CTO ; aucune intervention en production |

## 10. Tests obligatoires (répartis sur L1–L5)

- Isolation établissement A / B ; classe C1 / C2 ; année Y1 / Y2.
- Refus d'une classe extérieure à l'établissement ; refus d'une incohérence classe / année (API **et** base).
- Aucune propagation d'une modification de C1 vers C2 ou vers la liaison établissement.
- Liaisons historiques préservées ; repli établissement fonctionnel.
- `model_key` et `report_card_id` inchangés.
- Snapshots publiés inchangés (octets, empreinte, signature) ; `content_sha256` des liaisons existantes inchangé.
- Corrections officielles sur versions épinglées.
- PDF historiques préservés ; réimpression fidèle des nouvelles publications après changement d'identité de l'établissement.
- Cohérence Web / Backend / Mobile natif.
- Protections du catalogue #1053 (RLS, rôle applicatif, `anon`/`authenticated`) préservées.

## 11. Risques résiduels et arbitrages

| Sujet | État |
|---|---|
| Remplacement de la PK de la liaison | Justifié (§4.2), invariant conservé ; à valider par le diff CTO de L1 |
| Ordre de mise en service L1 (code puis migration) | À inscrire dans la procédure préproduction |
| Stockage du logo figé (artefacts adressés par contenu) | Proposé ; à confirmer en L3 (volume, rétention illimitée) |
| Format des clés de versions par classe | À vérifier en L2 contre les validations des stores |
| Contrainte ajoutée sur `classes` (verrou bref) | Préflight : transactions longues ; fenêtre validée |
| Copie entre classes | Reportée (D4) |
