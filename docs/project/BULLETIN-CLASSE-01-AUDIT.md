# BULLETIN-CLASSE-01 — audit d'architecture et de compatibilité (avant toute modification du schéma)

Statut : **Draft / HOLD — audit seul.** Aucun code, aucun schéma, aucune migration dans cette PR.
Base : `develop` @ `c27a7b9e` (#1051, #1052, #1053 inclus).

Objectif du mandat : configuration du bulletin **indépendante par classe et par année scolaire**, avec personnalisation de l'en-tête et des signatures, sans toucher aux bulletins déjà publiés.

## 1. Constat : où vit la configuration aujourd'hui

| Élément | Stockage canonique | Clé actuelle | Portée réelle |
|---|---|---|---|
| Demande de configuration (cycle de vie, audit) | `report_card_configuration_requests` | `id`, `(school_id, model_key)` | établissement |
| Profil de règles (matières, maxima, sources) | `academic_rule_profiles` + `_versions` | `(school_id, profile_key)` = `catalog-<modèle>` | établissement |
| Schéma de bulletin | `report_card_schemas` + `_versions` | `(school_id, schema_key)` | établissement |
| Gabarit de rendu (style, signatures, intitulés) | `report_card_rendering_templates` + `_versions` (versions immuables, trigger) | `(school_id, template_key)` | établissement |
| **Liaison active** (versions épinglées utilisées pour publier) | `report_card_active_bindings` | **PK `(school_id, model_key)`** | **établissement** |
| Bulletin publié | `report_card_published_snapshots` (octets canoniques signés) | `(school_id, report_card_id, version)` | élève × classe × année × modèle × période |

Chemins de lecture :

- **Publication d'une classe** (`reportCardClassPublication.computeClass`) : un seul point de résolution, `resolveBoundBundle(configuration, schoolId, modelKey)` → liaison `(school_id, model_key)`. La classe et l'année sont des paramètres de calcul, **pas** de résolution de configuration.
- **Identité d'un bulletin** : `report_card_id = sha256({school, class, year, model_key, scope, student})`. Le `model_key` fait partie de l'identité.
- **Correction officielle** : recalcul avec les versions **épinglées** dans la provenance du snapshot (`pinned`), indépendant de la liaison courante.
- **Consultation / PDF d'un bulletin publié** : gabarit lu par `provenance.template {id, version, spec_sha256}` (`resolvePublishedTemplate`), empreinte vérifiée ; profil lu par `provenance.profile`. Indépendant de la liaison courante.
- **Libellés affichés** (nom de l'établissement, classe, année, élèves, matières) : lus **en direct** (`reportCardPresentationLabelsStore`), pas dans le snapshot.
- **Assistant école** (`reportCardCatalog.configurationContext`) : propose **toutes** les matières actives de l'établissement ; aucune classe.
- **Mobile natif** : consultation seule des bulletins publiés (`ReportCardPresentationView`) ; identité affichée, **pas de bloc signatures**, pas d'en-tête configurable.

## 2. Contraintes de compatibilité (non négociables)

1. **`model_key` inchangé par classe.** Le changer (ex. `catalog-colombiere-<classe>`) changerait `report_card_id` : une republication de la même période créerait un **second bulletin officiel** au lieu de `PUBLICATION_ALREADY_EXISTS` / correction. La portée classe/année doit donc vivre **à côté** du `model_key`, dans la résolution de la liaison.
2. **Bulletins publiés immuables** : snapshots, versions, PDF et QR ne dépendent que de la provenance épinglée et des versions immuables → toute nouvelle configuration (y compris en-tête) passe par de **nouvelles versions** de gabarit/profil, jamais par modification d'une version existante. Déjà garanti par le trigger de protection des versions.
3. **En-tête** : la sélection des éléments affichés et les textes libres doivent être dans le **gabarit versionné** (bloc `presentation`, optionnel ⇒ empreinte des gabarits existants inchangée). Contrainte existante : la spec refuse les clés `school*`/`country*` (`rejectCountrySchoolKeys`) → identifiants neutres (`establishment_name`, `logo`, …).
4. **Valeurs vivantes** : nom et logo de l'établissement sont lus en direct. Une réimpression d'un PDF historique afficherait le logo/nom **actuel**. Comportement actuel pour le nom ; à trancher pour le logo et l'adresse (décision D3).
5. **Tenant** : toutes les tables portent `school_id` ; les FK composites `(id, school_id)` empêchent les références croisées. `classes` n'a pas de contrainte `UNIQUE (id, school_id)` → nécessaire pour une FK composite vers la classe (ajout additif, trivialement satisfait car `id` est déjà clé primaire).
6. **Une classe appartient à une année** (`classes.academic_year_id NOT NULL`) : l'année se déduit de la classe côté serveur ; toute incohérence classe/année envoyée par le client est refusée.
7. **Superadmin plateforme uniquement** : gère la disponibilité des modèles par pays, jamais la configuration d'une classe ni ses données.

## 3. Options étudiées pour la portée classe × année

| Option | Principe | Historique | Schéma | Verdict |
|---|---|---|---|---|
| **A. Étendre la liaison canonique** | `report_card_active_bindings` + `academic_year_id`, `class_id` (NULL = liaison établissement existante) ; clé unique `(school_id, model_key, année, classe)` ; `report_card_configuration_requests` + mêmes colonnes | `model_key` et `report_card_id` inchangés | colonnes additives ; **remplacement de la clé primaire** `(school_id, model_key)` par un index unique élargi | **Recommandée** |
| B. `model_key` par classe | clé `catalog-colombiere@<classe>` | **casse l'identité** des bulletins déjà publiés (doublons officiels possibles) | aucun | Rejetée |
| C. Table parallèle `report_card_class_bindings` | nouvelle table de liaisons par classe | inchangé | table nouvelle | Rejetée (gouvernance : extension possible) |

### Point unique non strictement additif (décision D1)

La PK `(school_id, model_key)` interdit plusieurs liaisons par modèle. Option A la remplace, dans une transaction idempotente, par :

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_active_bindings_scope
  ON report_card_active_bindings (school_id, model_key,
     COALESCE(academic_year_id, '00000000-0000-0000-0000-000000000000'::uuid),
     COALESCE(class_id,         '00000000-0000-0000-0000-000000000000'::uuid));
-- puis, si la PK d'origine existe encore : ALTER TABLE … DROP CONSTRAINT report_card_active_bindings_pkey;
```

- Aucune donnée modifiée ni supprimée ; les lignes existantes (classe NULL) restent valides et uniques.
- Index d'expression plutôt que `NULLS NOT DISTINCT` : compatible PostgreSQL ≥ 12 (CI 16, préproduction 17.6 ; version de production à confirmer).
- `upsertBinding` (`ON CONFLICT (school_id, model_key)`) doit cibler le nouvel index : changement de code coordonné, couvert par les tests PostgreSQL.
- Retour arrière possible tant qu'aucune liaison de classe n'existe (sinon la PK d'origine ne peut pas être recréée) ; procédure documentée.

## 4. Modèle cible proposé (Option A)

**Résolution de la configuration à la publication** (`resolveBoundBundle`, point unique) :

1. liaison `(school, model_key, année de la classe, classe)` ;
2. sinon liaison établissement historique `(school, model_key, NULL, NULL)` — **compatibilité** des établissements déjà actifs (décision D2) ;
3. sinon `MODEL_NOT_BOUND`.

**Isolation « aucune modification indirecte d'une autre classe »** :

- l'assistant exige une classe dès l'étape 1 ; enregistrer / activer pour la classe C n'écrit **que** la demande et la liaison `(…, C)` ;
- clés de versions distinctes par classe (`catalog-<modèle>.<classe>` pour profil, schéma, gabarit) → l'activation d'une version pour C ne change jamais le statut des versions liées à une autre classe ;
- la liaison établissement historique devient **en lecture seule** dans le nouvel assistant (la modifier changerait toutes les classes qui en héritent) ;
- contrôle serveur : la classe appartient à l'établissement du jeton ; l'année est celle de la classe.

**Matières et cours de la classe** : le contexte de l'assistant devient « matières ayant un cours actif dans la classe » (`school_courses.class_id`), avec les matières principales des sous-matières affectées ; une matière sans cours dans la classe est refusée (`SUBJECT_NOT_IN_CLASS`).

**En-tête** (nouvelle clé optionnelle du bloc `presentation`, versionnée, absente ⇒ empreinte inchangée) :

```json
"header": {
  "show": ["logo", "establishment_name", "establishment_address", "country", "academic_year", "class", "period", "student_name", "student_code"],
  "lines": ["République démocratique du Congo", "Ministère de l'Enseignement primaire, secondaire et technique"],
  "title": "Bulletin scolaire"
}
```

Liste fermée d'éléments, ≤ 4 lignes libres de 80 caractères, titre ≤ 60 ; aperçu dans l'assistant avec le moteur réel (comme aujourd'hui). **Signatures** : le paramétrage existant (`presentation.signatures`, ≤ 4) est repris tel quel dans la même étape.

**Rendu** : Web (`ReportCardPresentationTable`), PDF (`reportCardPdf`) et Mobile (`ReportCardPresentationView`) lisent le même bloc `header` depuis la présentation calculée ; Mobile ajoute l'en-tête et le bloc signatures (consultation seule).

**Gestion des bulletins** : après le choix de la classe, seuls les modèles liés à cette classe (ou hérités) sont proposés.

## 5. Matrice de compatibilité

| Élément existant | Effet de l'Option A |
|---|---|
| Bulletins publiés (snapshots, versions, signatures, QR) | Aucun : provenance épinglée, versions immuables |
| PDF historiques | Aucun pour la mise en page (gabarit épinglé) ; libellés vivants inchangés (comportement actuel) |
| Corrections officielles | Aucun : recalcul sur versions épinglées |
| Liaisons établissement actives (#1051) | Conservées (classe NULL), utilisées en repli (D2) |
| `report_card_id` | Inchangé (`model_key` inchangé) |
| Catalogue par pays (#1051/#1053, RLS) | Inchangé ; un modèle doit rester disponible dans le pays pour configurer une classe |
| Permissions | Inchangées : `REPORT_CARD_SCHOOL_APPROVE_TEMPLATE` (admin établissement) ; enseignant lecture ; parent refusé ; Superadmin sans accès école |
| Routes MONO-T1 | Paramètre `classId` ajouté aux routes catalogue école ; inventaire à régénérer |

## 6. Lots proposés (chacun : PR Draft / HOLD, diff CTO, CI verte)

| Lot | Contenu | Schéma |
|---|---|---|
| **L0 (cette PR)** | Audit, options, décisions | non |
| L1 | Migration additive idempotente (colonnes, `UNIQUE (id, school_id)` sur `classes`, index élargi, remplacement de la PK), préflight lecture seule, rollback, tests PostgreSQL ; jamais exécutée au démarrage | oui |
| L2 | Backend : résolution classe → établissement, assistant scopé classe, matières de la classe, isolation, clés de versions par classe | non |
| L3 | En-tête : `presentation.header` (normalisation, rendu Web/PDF/Mobile, aperçu) + signatures intégrées | non |
| L4 | Web : étape 1 « Classe », gestion des bulletins filtrée ; Mobile : en-tête et signatures | non |
| L5 | E2E réel, captures bureau/tablette/mobile, procédure de migration préproduction | non |

## 7. Plan de tests (lots L1–L5)

- **PostgreSQL** : isolation établissement A/B, classe C1/C2, année Y1/Y2 (activer C1 ne change ni la liaison ni les versions de C2) ; repli établissement ; refus d'une classe d'un autre établissement ou d'une année incohérente ; migration idempotente sur base vierge et sur base #1051 avec liaisons existantes ; rollback sans liaison de classe ; RLS catalogue inchangée.
- **Non-régression historique** : snapshots publiés avant migration octet pour octet identiques ; PDF et présentation inchangés ; correction officielle d'un bulletin historique sur versions épinglées ; `report_card_id` inchangé pour une classe passant de la liaison établissement à une liaison de classe.
- **Backend** : résolution, erreurs par champ (`CLASS_REQUIRED`, `SUBJECT_NOT_IN_CLASS`, `CLASS_YEAR_MISMATCH`), en-tête (liste fermée, limites), empreinte des gabarits sans `header` inchangée.
- **Web / Mobile** : étape classe obligatoire, classes de l'établissement seulement, aperçu d'en-tête, signatures, états vides et erreurs ; Mobile : en-tête et signatures en lecture.

## 8. Décisions CTO requises avant L1

| # | Question | Recommandation |
|---|---|---|
| D1 | Accepter le remplacement de la PK de `report_card_active_bindings` par l'index unique élargi (seule étape non strictement additive) | Oui (Option A) |
| D2 | Une classe sans configuration propre utilise-t-elle la liaison établissement existante ? | Oui, en repli, liaison établissement en lecture seule dans l'assistant |
| D3 | Logo / adresse dans l'en-tête : valeurs vivantes (comme le nom) ou figées dans la version du gabarit ? | Vivantes, comme le nom (pas de donnée d'établissement dans la spec) ; à reconsidérer si exigence légale de figer |
| D4 | Copier la configuration d'une classe vers d'autres classes (même niveau) ? | Hors L2 ; lot ultérieur (copie explicite, jamais lien partagé) |
| D5 | Version PostgreSQL de production | À confirmer (index d'expression compatible ≥ 12) |
