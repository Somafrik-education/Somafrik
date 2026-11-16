# GO-PROD-G5-01 — Inventaire et rollback des migrations SQL

| Champ | Valeur |
|---|---|
| Mandat | GO-PROD-G5-01 (issue #720, candidate #1145) |
| Candidate analysée | `8124d331e3ef1a39ceea150e3c96e3e65a88ce7c` (tree identique à `develop@b925ba9`) |
| Référence production supposée | `main@ef8bc9517ffc94aa770743713d0f561f92a9fc1e` |
| Méthode | Lecture statique du dépôt (`git diff`, lecture des fichiers SQL et du code de démarrage). **Aucune base n'a été interrogée.** |
| Date | 2026-11-16 |

## 1. Ce qui est vérifié, déclaré ou à tester

| Élément | Statut |
|---|---|
| Liste des fichiers ajoutés dans `backend/db/migrations/` entre `main` et la candidate | **Vérifié directement** (`git diff --diff-filter=A`) |
| Aucun fichier de migration existant sur `main` modifié, renommé ou supprimé | **Vérifié directement** (`git diff --diff-filter=MDR` vide) |
| SHA-256 de chaque fichier au SHA candidat | **Vérifié directement** (calculé sur `git show 8124d331:<fichier>`) |
| Mode d'application (boot automatique ou manuel) | **Vérifié directement** dans le code ; voir §2 |
| Migrations réellement appliquées en production | **NOT VERIFIED** : aucun accès à `Somafrik-prod`, et le dépôt ne tient **pas de table de suivi des migrations** |
| Comportement réel (durée, verrous, erreurs) sur PostgreSQL 17 | **NOT VERIFIED** : la CI utilise `postgres:16` (32 occurrences dans `.github/workflows`) ; la production est déclarée en PostgreSQL 17 (MIG-AUD-01, mandat CTO) |

## 2. Recomptage

Le rapport précédent annonçait 26 nouveaux fichiers. **Le chiffre exact est 27** :

- **21 migrations** ;
- **4 scripts `.rollback.sql`** : `20261103`, `20261104`, `20261105_class_scope`, `20261106` ;
- **2 scripts `.preflight.sql`** : `20261104`, `20261105_class_scope`.

72 fichiers de migration existaient déjà sur `main`. Leur application en production n'est pas vérifiée non plus.

### Deux modes d'application : point critique

`PostgresRepository.init()` (`backend/db/postgresRepository.js:123-196`) exécute `schema.sql` puis environ 45 fonctions `ensure*Schema()` **à chaque démarrage de l'API**. Il n'existe pas d'étape de migration séparée (`npm start` = `node server.js`).

- **17 migrations sur 21 sont appliquées automatiquement au boot** : soit leur fichier `.sql` est lu par un module `*Schema.js`, soit leur DDL est dupliqué inline dans `schema.sql` ou dans un `*Schema.js`. Avec `autoDeploy=yes` sur `main`, **un merge applique ces 17 migrations à la production dès le premier démarrage**, sans étape humaine.
- **4 migrations sont manuelles**, exécutées avec `psql` et leur préflight : `20261104_report_card_catalog`, `20261105_report_card_class_scope`, `20261105_report_card_official_assets_privileges`, `20261106_report_card_official_assets`. Le code v25 fonctionne avant et après leur application (états « catalogue non installé », `CLASS_SCOPE_UNAVAILABLE`).

## 3. Inventaire détaillé

Ordre d'exécution = ordre lexicographique des noms de fichiers. Au boot, l'ordre réel est celui des appels dans `init()`.

| # | Migration | SHA-256 | Application | Type | Impact données | Verrou PostgreSQL | API `main` sur schéma migré | Rollback |
|---|---|---|---|---|---|---|---|---|
| 1 | `20261001_establishment_roles_display_label.sql` | `d241500e6372887b33441f409d37025b3d68b492612b8c7804e38fa1d9bace4e` | Boot (`establishmentRolesSchema.js`) | ADD COLUMN nullable sur `establishment_roles` (existante) | Aucune réécriture | ACCESS EXCLUSIVE bref (ADD COLUMN sans défaut volatil) | Compatible (colonne ignorée) | Réversible par DROP COLUMN — **aucun script** |
| 2 | `20261005_school_settings_student_card_flags.sql` | `ff4f46296e06169ffcb98c71b65b8666dd7417f6af985a9baa764d43d3e91ea9` | Boot (`schoolSettingsSchema.js`) | ADD COLUMN sur `school_settings` (existante) | Aucune réécriture | ACCESS EXCLUSIVE bref | Compatible | Aucun script |
| 3 | `20261006_student_access_cards.sql` | `799c938c0442bad48ecd5a85224b3d0f9bebf194f21599fed3396c5fab24f356` | Boot (`studentAccessCardsSchema.js`, DDL inline) | CREATE TABLE `student_access_cards` + **CREATE UNIQUE INDEX non CONCURRENTLY sur `students (school_id, id)`** | Aucune | **SHARE sur `students` pendant la construction de l'index : bloque INSERT/UPDATE/DELETE élèves**, durée ∝ taille de `students` | Compatible | DROP TABLE + DROP INDEX — **aucun script** |
| 4 | `20261010_student_administrative_notes.sql` | `27ef5dade80e45bbe36d60415849a2947626425ac60682e6a4e5033997473125` | Boot (`schema.sql`) | ADD COLUMN + CHECK longueur sur `students` | Aucune (colonne neuve NULL) | ACCESS EXCLUSIVE sur `students` + scan pour valider le CHECK | Compatible | Aucun script |
| 5 | `20261011_student_identity_supplemental.sql` | `68756e1977ec1dcaa5bfd54e6f8559e5472837c5ea1e71195cbb3baafbd50f75` | Boot (`schema.sql`) | 3 ADD COLUMN + 3 CHECK sur `students` | Aucune | ACCESS EXCLUSIVE sur `students` + 3 scans de validation | Compatible | Aucun script |
| 6 | `20261012_student_cards_nfc_encoding.sql` | `b356e7671003f2fe7950dfa713f199de250c62cadd91079a44971094369c177d` | Boot (`studentCardsNfcSchema.js`) | ADD COLUMN/INDEX/CHECK sur `student_access_cards` (table de cette release) | Aucune | Table neuve, négligeable | Compatible | Aucun script |
| 7 | `20261013_student_cards_nfc_reservations.sql` | `e6f908550a80e31d94e1756600efd7c3d5bc71823b7121f37331b69e1b4e278c` | Boot (`studentCardsNfcReservationsSchema.js`) | ADD COLUMN/INDEX/FK sur tables de cette release | Aucune | Négligeable | Compatible | Aucun script |
| 8 | `20261016_attendance_roll_calls.sql` | `87624aa6419e152eb5d77ad4135337487cdf46bdfd5b26953e6edd8f0144d748` | Boot (`attendanceRollCallsSchema.js`) | CREATE TABLE `attendance_roll_calls` + FK vers tables existantes | Aucune | SHARE ROW EXCLUSIVE bref sur tables référencées (création de FK) | Compatible | DROP TABLE — **aucun script** |
| 9 | `20261016_school_entry_events.sql` | `6545a8ea45a1f1c36e1ae216c35e292e4b063933675a31fefaced1b34ed33379` | Boot (`schoolEntryEventsSchema.js`) | CREATE TABLE `school_entry_events` + FK | Aucune | Idem | Compatible | Aucun script |
| 10 | `20261017_student_cards_nfc_recovery.sql` | `c1414116b57351f012b1b041f108926d3e15e1e0c6dda6ac605eacd2fdfab781` | Boot (`studentCardsNfcRecoverySchema.js`) | ADD COLUMN/CHECK sur tables de cette release | Aucune | Négligeable | Compatible | Aucun script |
| 11 | `20261021_school_settings_student_card_holder.sql` | `ddba9f7765e265ab683616276813dd5abc78d8cea8fbabadbe5823b34d8a6c33` | Boot (`schoolSettingsSchema.js`) | ADD COLUMN + CHECK conditionnels (DO) sur `school_settings` | Aucune | ACCESS EXCLUSIVE bref + scan | Compatible | Aucun script |
| 12 | `20261023_student_card_batches.sql` | `f881eb40b7af525313db181d8ed02c67d7e1cd0262960fad2aabec1ad6fc9004` | Boot (`studentCardBatchesSchema.js`) | CREATE TABLE `student_card_batches`, `student_card_batch_items` | Aucune | Négligeable | Compatible | Aucun script |
| 13 | `20261102_finance_collection_lock.sql` | `830f63a0fb5985db5ffb10a668d8a54ec957014ae05c7a19ac663a09644d117e` | Boot (`financeSchema.js`, DDL inline) | FUNCTION + CONSTRAINT TRIGGER DEFERRABLE `AFTER INSERT ON payments` | Aucune réécriture ; **refuse un paiement non couvert** uniquement si la session active `somafrik.enforce_collection_cover=on` (posé par `financePgStore.js:858`) | Bref (CREATE TRIGGER) | Compatible : l'API `main` ne pose pas le flag, donc le trigger est inactif pour elle | DROP TRIGGER/FUNCTION — **aucun script** |
| 14 | `20261103_subject_hierarchy.sql` | `6176d697be7bd492a3f348981685feed69aa34acedbbe14dee1ed98e450b24c9` | Boot (`subjectHierarchySchema.js`) | ADD COLUMN, FK auto-référente, CHECK, **2 index non CONCURRENTLY sur `subjects`**, trigger `BEFORE INSERT OR UPDATE OF parent_subject_id` | Aucune | SHARE sur `subjects` pendant les index | Compatible (le trigger ne joue que si `parent_subject_id` est posé) | **`.rollback.sql` présent** |
| 15 | `20261104_report_card_catalog.sql` | `cd862637371c0a412f218a9b29c5c75c663413d6d2e474d83db9fc4639cde618` | **Manuelle** (préflight `psql`) | 3 CREATE TABLE + RLS/POLICY + GRANT/REVOKE + **INSERT du catalogue** | Insertion de données de référence | Négligeable | Compatible (tables inconnues de `main`) | **`.rollback.sql` + `.preflight.sql`** |
| 16 | `20261105_report_card_class_scope.sql` | `abb072fa91eff6774be88edaee35143dbb53453d87e080eb766640ab3bf0a3e4` | **Manuelle** (`jamais exécutée automatiquement`, `reportCardConfigurationPgStore.js:111`) | ADD COLUMN `id DEFAULT gen_random_uuid()` (**réécriture de table**), UPDATE, SET NOT NULL, **remplacement de la PK `(school_id, model_key)` → `(id)`**, DROP INDEX `uq_report_card_configuration_one_active`, UNIQUE sur `classes`, index partiels | **Réécriture** de `report_card_active_bindings` | ACCESS EXCLUSIVE sur `report_card_active_bindings`, `report_card_configuration_requests`, `classes` (`lock_timeout 5s`) | **INCOMPATIBLE avec l'API `main`** (voir §5.1) | **`.rollback.sql` + `.preflight.sql`** |
| 17 | `20261105_report_card_official_assets_privileges.sql` | `25880cfa1ed16d0c72e7725e9bcc5c847bd3c469d5a50b3a89de0026a6f4806b` | **Manuelle** | REVOKE ALL sur `report_card_official_assets` (service_role, anon, authenticated, PUBLIC) | Aucune | Bref | Sans objet (table inconnue de `main`) | **Aucun script** (ré-GRANT manuel) |
| 18 | `20261106_report_card_official_assets.sql` | `c141034d3a90a5a01383f89555707fe610ce95af6e1fecbb14057e6f1b618c9b` | **Manuelle** | CREATE TABLE + FUNCTION/TRIGGER d'immuabilité + RLS + GRANT/REVOKE | Aucune | Négligeable | Compatible | **`.rollback.sql` présent** |
| 19 | `20261108_attendance_roll_calls_offline_sync.sql` | `5429331444120df0a2b3fa98aefe14c10978efab278f9b6781fbde63bd1091e0` | Boot (`attendanceRollCallsSchema.js`) | ADD COLUMN/CHECK sur `attendance_roll_calls` (table de cette release) | Aucune | Négligeable | Compatible | Aucun script |
| 20 | `20261109_school_settings_student_card_offline_roll_call.sql` | `9b772cdeb5ba2966e7a134992dd177338e4c241facc2f4dbb1a4fc72ef212220` | Boot (`schoolSettingsSchema.js`) | ADD COLUMN sur `school_settings` | Aucune | ACCESS EXCLUSIVE bref | Compatible | Aucun script |
| 21 | `20261110_attendance_roll_calls_staff_mode.sql` | `55b43a646083faa246f9a58af428710ac451717b167c719c5d80bc2ae9ce2867` | Boot (`attendanceRollCallsSchema.js`) | DROP/ADD CHECK (redéfinition) sur `attendance_roll_calls` | Aucune ; **échoue** si des lignes existantes violent la nouvelle contrainte | Bref + scan | Compatible | Aucun script |

| Script annexe | SHA-256 |
|---|---|
| `20261103_subject_hierarchy.rollback.sql` | `1bf723772b1d2882a27a369ac5ccc985a38af5171f24b37611b9742edbb7fa9b` |
| `20261104_report_card_catalog.preflight.sql` | `7327af167398735aa01a837d2431e539d1dbe3b1d32037ba5b4850e512d36f6b` |
| `20261104_report_card_catalog.rollback.sql` | `0c45e02b3f4fc4ca0e9388e458449e778eb87b04e8bf2f6b11a661ef485b6f2b` |
| `20261105_report_card_class_scope.preflight.sql` | `c3eb0753be3a2184d3ac9b61d1a53da5b9eb8c8844e2f34bad63452ff94704f2` |
| `20261105_report_card_class_scope.rollback.sql` | `6d2df2001b4f78186bef4d440adfb70593803eb6fbb0fc475d8a29a5295c7eb2` |
| `20261106_report_card_official_assets.rollback.sql` | `6dbfe5f890e0a4e5f53a7373303f1be89dbf6f351aed64780ccc553434711b45` |

## 4. Risques particuliers (C2)

| Risque | Constat | Gravité |
|---|---|---|
| `DROP TABLE` / `DROP COLUMN` | Aucun dans les 21 migrations. Présents uniquement dans les `.rollback.sql`. | — |
| `ALTER COLUMN` / changement de type | Uniquement `20261105_class_scope` : `report_card_active_bindings.id` `SET DEFAULT` + `SET NOT NULL` (colonne créée par cette même migration). Aucun changement de type. | P2 |
| `NOT NULL` | Aucun `ADD COLUMN … NOT NULL` sans `DEFAULT` sur une table existante. | — |
| `UNIQUE` | `20261006` : `students (school_id, id)`. `20261103` : `subjects (school_id, id)` et `(school_id, parent_subject_id, …)` partiel. `20261105` : `classes (id, academic_year_id, school_id)` plus des index partiels. Ces index ne peuvent pas échouer sur des doublons, car `id` est la PK. Ils prennent cependant des verrous (ligne suivante). | P2 |
| Index bloquants | **`20261006` et `20261103` créent des index sans `CONCURRENTLY` sur `students` et `subjects`**, au boot. Verrou SHARE : les écritures élèves et matières sont bloquées pendant la construction. Durée non mesurée sur le volume de production. | **P1** (à mesurer en restauration isolée) |
| Migrations longues / réécritures | `20261105_class_scope` réécrit `report_card_active_bindings` (`ADD COLUMN … DEFAULT gen_random_uuid()` est volatil). `lock_timeout 5s` posé. Manuelle. | P2 |
| Réécritures de données | `20261104` : INSERT du catalogue (données de référence). `20261105` : `UPDATE … SET id = gen_random_uuid() WHERE id IS NULL`. Aucune réécriture de données métier au boot. | P2 |
| Autorisations | `20261104`, `20261106` : RLS, POLICY, GRANT/REVOKE. `20261105_privileges` : `REVOKE ALL` sur `report_card_official_assets` pour `service_role`, `anon`, `authenticated`, `PUBLIC`. Aucun script inverse pour les privilèges. | P2 |
| Fonctions / triggers | `20261102` : trigger de couverture des paiements, inactif sans le flag de session. `20261103` : trigger de profondeur de hiérarchie des matières. `20261106` : trigger d'immuabilité. | P2 |
| Contraintes `CHECK` redéfinies | `20261010`, `20261011`, `20261021`, `20261110` : `DROP CONSTRAINT IF EXISTS` puis `ADD CONSTRAINT` sans `NOT VALID`. Elles **échouent au boot** si des lignes existantes violent la contrainte, et l'API ne démarre alors pas (`SOMAFRIK_DB_REQUIRED=true`). Le risque est faible pour les colonnes neuves, mais **non prouvé pour `20261110`**, qui redéfinit des contraintes sur des lignes `attendance_roll_calls` peut-être déjà écrites (préprod). | P1 (préprod) / P2 (prod si la table est vide) |
| Compatibilité ancienne / nouvelle API | Voir §5 : **une incompatibilité confirmée** (`20261105_class_scope`). | **P1** |
| Version PostgreSQL | Les migrations ne sont testées que sur PostgreSQL 16 ; la production est en 17. | P2 |

## 5. Plan de rollback (C3)

### 5.1 Rollback applicatif (revenir au backend `main@ef8bc95` en gardant les données)

Analyse statique de `main` exécuté sur un schéma v25 :

- **17 migrations de boot : compatible a priori.** Elles sont additives, sans colonne `NOT NULL` sans défaut, et sans trigger actif pour l'API `main`. Le boot de `main` rejoue son propre DDL `IF NOT EXISTS`, qui ne devrait pas entrer en conflit. **Ce n'est pas prouvé à l'exécution.**
- **`20261105_report_card_class_scope` : INCOMPATIBLE, confirmé dans le code.**
  1. `main` exécute `INSERT INTO report_card_active_bindings … ON CONFLICT (school_id, model_key) DO UPDATE` (`backend/db/reportCardConfigurationPgStore.js:244` sur `main`). Après la migration, la PK devient `(id)` et l'unicité `(school_id, model_key)` ne survit que sous la forme d'un **index partiel** `WHERE class_id IS NULL`. PostgreSQL refuse un `ON CONFLICT` sans le prédicat correspondant : l'**activation d'un modèle de bulletin échoue** sur l'API `main`.
  2. Au boot, `main` exécute sans condition `CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active ON report_card_configuration_requests (school_id, model_key) WHERE status = 'ACTIVE'` (`reportCardConfigurationSql.js:113`), index supprimé par la migration. S'il existe à la fois une configuration ACTIVE établissement et une configuration ACTIVE classe pour le même modèle, **la création échoue et l'API `main` ne démarre pas**.

**Règle proposée :** `20261105_report_card_class_scope` est un **point de non-retour applicatif**. Ne pas l'appliquer pendant la fenêtre de déploiement v25. L'appliquer seulement une fois v25 stabilisée, avec une décision CTO dédiée. Pour revenir à `main` ensuite, exécuter d'abord `20261105_report_card_class_scope.rollback.sql`, après vérification qu'aucune configuration de classe ne doit être conservée.

**Preuve requise pour PASS :** sur une copie restaurée de production, démarrer la candidate (boot = 17 migrations), puis arrêter et démarrer `main@ef8bc95` sur cette même base. Smoke : login, présences, notes, finance, bulletins (activation de modèle incluse). Voir `GO-PROD-G5-01-RESTORE-RUNBOOK.md` §6.

### 5.2 Rollback base de données (inverser le schéma)

- Seules 4 migrations sur 21 ont un script inverse. Pour les 17 migrations de boot sans script, l'inversion n'est **pas nécessaire** si le §5.1 est prouvé : un schéma additif peut rester en place sous l'API `main`.
- Le `DROP` des tables v25 (`student_access_cards`, `attendance_roll_calls`, `school_entry_events`, `student_card_batches*`) **détruirait les données écrites depuis le déploiement** (cartes, appels, entrées). À proscrire sans export préalable et sans décision CTO.
- **Restauration complète d'un snapshot : opération non anodine.** Elle efface toutes les écritures postérieures au snapshot (présences, paiements, notes saisies après le déploiement). Elle réintroduit aussi les comptes effacés au titre du RGPD (`docs/compliance/sauvegardes-restauration.md` §5). Elle est réservée à la corruption de données, avec rejeu manuel des écritures et des effacements.

### 5.3 RPO / RTO

| Indicateur | Valeur |
|---|---|
| RPO (perte de données maximale) | **NOT VERIFIED** : dépend de la politique de sauvegarde ou PITR réellement active sur `Somafrik-prod`, non consultée |
| RTO (durée de restauration) | **NOT VERIFIED** : aucune restauration mesurée |
| Durée des index bloquants au boot (`students`, `subjects`) | **NOT VERIFIED** |

## 6. Actions nécessaires pour obtenir PASS sur le lot C

1. Lire en production (accès autorisé, lecture seule) quelles colonnes, tables, contraintes et index v25 existent déjà, pour reconstituer l'état réel : il n'existe pas de table de suivi des migrations. Requêtes de métadonnées uniquement : `information_schema.columns`, `pg_constraint`, `pg_indexes`.
2. Exécuter le runbook de restauration jusqu'au §6 (boot v25, puis rollback applicatif `main`) sur PostgreSQL 17. Mesurer les durées et verrous des migrations de boot.
3. Décision CTO sur `20261105_report_card_class_scope` : hors fenêtre de déploiement.
4. Décision CTO : faut-il une PR séparée pour créer les index de `20261006` et `20261103` avec `CONCURRENTLY` hors boot ? Je ne l'ai pas faite : c'est un changement de code.
