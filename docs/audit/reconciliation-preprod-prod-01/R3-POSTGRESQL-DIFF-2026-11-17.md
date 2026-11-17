# R3 — Réconciliation PostgreSQL : audit indépendant de préprod et production

**Date :** 17 novembre 2026 · **Mandat CTO :** [#1187](https://github.com/Somafrik-education/Somafrik/issues/1187) · **PR documentaire :** #1188 · **Décision :** R3 lecture SQL **EXÉCUTÉE**, réconciliation physique **HOLD**.

## 0. Cadre et sources de preuve

Accès direct par connecteur Supabase aux deux projets distincts, identifiés par métadonnées et leur nom : **Somafrik-preprod** (`scdrdxqqshmvmogcmmdw`, région `eu-central-1`, PostgreSQL 17.6) et **Somafrik-prod** (`loyubruyrxcaeshonkwp`, région `eu-west-1`, PostgreSQL 17.6). États : `ACTIVE_HEALTHY`. La base Render `somafrik-demo-db` n'a pas été interrogée. **Aucun mot de passe, URL de connexion, numéro d'élève, dossier ou identifiant de personne relevé.**

Méthodes : **SELECT uniquement**, via `information_schema`, `pg_catalog`, `supabase_migrations.schema_migrations` et **six `COUNT(*)` métier** ; définition et signature MD5 des fonctions/migrations, sans lecture des lignes nominatives. Les statistiques portent sur la structure observée, non sur la validation d'une migration prête à appliquer. Les liens effectifs `DATABASE_URL` utilisés par les deux services Render **n'ont pas été vérifiés directement** : le rapprochement des bases nommées avec chaque service reste à confirmer par métadonnées expurgées.

## 1. Inventaire et delta structurel

| Objet public | Préproduction | Production | Écart |
|---|---:|---:|---:|
| Tables de base (`information_schema`) | **127** | **119** | **+8 préprod** |
| Tables + vues recensées par `information_schema.columns` | 129 | 121 | +8 |
| Colonnes public | **1398** | **1338** | **+60** |
| Contraintes public | **631** | **603** | +28 |
| Index public | **379** | **365** | +14 |
| Déclarations événements de triggers public | **69** | **67** | +2 |
| Fonctions public | **227** | **226** | +1 |
| Tables avec RLS activée | **4** | **0** | +4 |
| Politiques RLS | **8** | **0** | +8 |

**Huit tables de base présentes uniquement en préproduction :**
1. `maintenance_duplicate_backups`
2. `report_card_catalog_availability`
3. `report_card_catalog_availability_audit`
4. `report_card_catalog_models`
5. `report_card_engine_facts`
6. `report_card_official_assets`
7. `teacher_dedupe_recovery`
8. `web_push_subscriptions`

**Aucune table de base propre à la production** dans ce comparatif.

### Colonnes et compatibilité

La comparaison sémantique par **nom de colonne, type, nullabilité et valeur par défaut** n'a montré **que cinq colonnes présentes en préprod et absentes en prod** :
- `report_card_active_bindings.id` (uuid, obligatoire, `gen_random_uuid()`)
- `report_card_active_bindings.academic_year_id` (uuid, nullable)
- `report_card_active_bindings.class_id` (uuid, nullable)
- `report_card_configuration_requests.academic_year_id` (uuid, nullable)
- `report_card_configuration_requests.class_id` (uuid, nullable)

Aucune colonne propre à la production ni de différence sémantique constatée sur les colonnes communes des 12 tables comparées. **Attention :** les signatures par table remontent 12 différences lorsque l'ordre physique des colonnes change ; les cinq champs ci-dessus sont les différences de colonnes établies par identité et propriétés, sans prouver la compatibilité des requêtes SQL ou des contraintes.

## 2. Deltas de contraintes / index à risque

**Les divergences ne vont pas toutes dans le sens « ajouter les objets préprod ».** Des protections existent **en production seulement**, et toute migration naïve pourrait les supprimer.

| Objet | Préprod | Production | Risque / garde |
|---|---|---|---|
| `attendance` contrainte `attendance_school_id_student_id_attendance_date_key` | **ABSENTE** | **UNIQUE (school_id, student_id, attendance_date)** | **P1 potentiel :** risque de doublons de présence en préprod ; vérifier les règles métier et les doublons avant de choisir la contrainte canonique |
| `grades.grades_score_non_negative` | ABSENTE | **CHECK score >= 0 (ou NULL)** | **P1 potentiel :** saisie de note négative à vérifier dans les deux environnements |
| `grades.grades_score_check` | `score <= max_score` | `score IS NULL OR score <= max_score` | Sémantique SQL potentiellement équivalente pour NULL ; confirmer par tests contractuels |
| `report_card_correction_commands` | 2 checks version **absents** | **CHECK source_version >= 1** et **result_version >= 1** | **P1/P2 potentiel :** versioning de corrections de bulletin ; vérifier les écritures légitimes |
| `classes.classes_id_year_school_unique` | UNIQUE (id, academic_year_id, school_id) | ABSENTE | Requis côté préprod pour les FK composites tenant des bulletins |
| `report_card_active_bindings` | **PK (id)** ; index uniques conditionnels par établissement/classe ; FK composite `(class_id,academic_year_id,school_id)` vers classes | **PK (school_id,model_key)** ; pas de class scope | **INCOMPATIBILITÉ structurelle** de la clé et de la granularité : promotion exige analyse de données et de dépendances, migration séparée et plan de retour arrière |
| `report_card_configuration_requests` | champs classe/année, `scope_pair` et FK composite ; unicité active filtrée `class_id IS NULL` | unicité active `(school_id,model_key)` sans scoping de classe | Risque de modèles/classes multiples ; contrôler les consommateurs du schéma |
| `report_card_official_assets` | Table, trigger et fonction `report_card_official_assets_protect()` | ABSENTS | Schéma documentaire officiel et ses protections à auditer avant promotion |

Les contraintes et index de `teacher_assignments` et `enrollments` **sont de même forme** entre les deux bases et n'imposent **pas** l'égalité `school_id` avec l'établissement des classes, matières, enseignants, élèves et années référencés.

## 3. Issue #1178 — six contrôles d'intégrité sur les données actuelles

Requêtes de comptage avec jointures par identifiant et comparaison `school_id IS DISTINCT FROM` (pas de valeurs personnelles retournées).

| Contrôle | Préprod : violations | Production : violations |
|---|---:|---:|
| `teacher_assignments` → `classes` | 0 | 0 |
| `teacher_assignments` → `subjects` | 0 | 0 |
| `teacher_assignments` → `teachers` | 0 | 0 |
| `enrollments` → `classes` | 0 | 0 |
| `enrollments` → `students` | 0 | 0 |
| `enrollments` → `academic_years` | 0 | 0 |

**Verdict : aucune incohérence existante détectée sur ces six relations et cette requête, dans les deux bases.** Cela **ne clôt pas** #1178 : les contraintes de FK sont unitaires et n'empêchent pas de nouvelles références cross-tenant incorrectes. Les lignes orphelines, autres chemins d'écriture, transactions concurrentes et accès API ne sont pas couverts par ces six comptages. **Correction indépendante nécessaire**, avec tests RED/GREEN et examen des écritures avant migration.

## 4. Historique des migrations Supabase

Inventaire read-only de `supabase_migrations.schema_migrations` (versions, noms et MD5 du texte des statements, pas de texte des migrations récupéré).

| Projet | Nombre d'entrées | Dernière version |
|---|---:|---|
| Préprod | **6** | `20261105212757` — `bulletin_official_assets_restrict_service_role` |
| Production | **1** | `20260905131234` — `rgpd_p0_revoke_data_api_public_roles` |

**Préprod-only :**
- `20260904182059` — `rgpd_p0_revoke_data_api_public_roles`
- `20260904182206` — `rgpd_p0_revoke_postgres_default_privileges`
- `20261011203907` — `fiche_fix_03_student_identity_supplemental`
- `20261105212621` — `bulletin_classe_01_l1_class_scope`
- `20261105212659` — `bulletin_classe_01_l3_official_assets`
- `20261105212757` — `bulletin_official_assets_restrict_service_role`

**Prod-only :** `20260905131234` — `rgpd_p0_revoke_data_api_public_roles`. Même nom RGPD que préprod mais version/empreinte différente ; ne pas présumer du contenu équivalent sans examen de la migration.

**Mise en garde :** les schémas métier peuvent aussi être créés par bootstrap de l'application et non historisés par Supabase ; ces six/une lignes ne recensent donc pas nécessairement toutes les migrations effectivement appliquées.

## 5. RLS et droits d'accès — vérification de surface

RLS activée **uniquement sur quatre tables spécifiques en préproduction** : `report_card_catalog_availability`, `report_card_catalog_availability_audit`, `report_card_catalog_models`, `report_card_official_assets` (8 policies). Ces quatre tables sont absentes en production ; le chiffre « 0 RLS prod » **ne suffit pas à conclure à une faille**, puisque le backend peut être seul à accéder aux tables métier.

`information_schema.role_table_grants` : aucun grant direct remonté pour les rôles `anon` et `authenticated` sur les tables public des deux projets ; `service_role` dispose des privilèges observés. **Ces résultats ne remplacent pas une analyse exhaustive des privilèges effectifs, DEFAULT PRIVILEGES, views, fonctions SECURITY DEFINER et Data API.**

Les extensions présentes parmi les index/versions interrogés ne présentent pas de différence signalée dans le sous-ensemble comparé. Une revue sécurité séparée est requise avant migration des objets de bulletin/stockage.

## 6. Priorités et plan R3 proposé (AUCUNE exécution de migration)

1. **P1 prévention :** régler #1178 au niveau de la base et de toutes les écritures métier, dans une PR Backend isolée ; commencer par tests PG RED/GREEN en environnement de test, inspecter les FK/contraintes composites et leur compatibilité avec les opérations de remplacement/inscription.
2. **P1/P2 diagnostic :** analyser les contraintes absentes de préprod sur `attendance`, `grades`, `report_card_correction_commands`; réaliser comptages de valeurs invalides/doublons (read-only) avant de concevoir un correctif.
3. **P1/P2 schémas de bulletins :** construire un diff de migrations exhaustif pour `report_card_active_bindings`, `report_card_configuration_requests`, leurs contraintes et dépendances ; pas de `DROP` automatique sur données prod. Tester sur copie isolée anonymisée ou jeu synthétique.
4. **R3 compatibilité :** rapprocher les 8 tables préprod-only des fonctionnalités disponibles, notamment push Web, cartes officielles et archivage de maintenance ; aucune copie de leurs données entre environnements.
5. **R3 historique :** analyser les migrations RGPD de même nom/versions distinctes ; vérifier la configuration réelle des projets et la correspondance aux services Render (métadonnées anonymisées).
6. **Gates avant toute écriture production :** backup et restauration testée, scripts idempotents, dry-run reproductible, contrôles de régression, CI verte, rollback documenté et **GO CTO explicite par lot**.

## 7. Statuts et décision CTO

- **R3 audit de métadonnées + six comptages multi-tenant : PASS (exécutés)**.
- **R3 schéma à promouvoir : HOLD** — écarts non triviaux, historiques migrations divergents, protection #1178 absente.
- **Lien effectif base ↔ service Render : à confirmer** sans exposer secrets.
- **Validation de toutes contraintes et absence de données invalides : INCOMPLÈTE** ; ne pas conclure à la conformité générale depuis six contrôles.
- **Écritures SQL / migrations / DDL exécutées : 0.** Aucun merge / déploiement / export de données personnelles. `main` et `develop` inchangés.

**NO MERGE / NO DEPLOY / NO DB WRITE / NO DATA COPY.**
