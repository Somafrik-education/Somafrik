# BULLETIN-CLASSE-01 / L1 — stockage canonique par classe et année : migration, compatibilité, tests

Statut : **Draft / HOLD — NO READY / NO MERGE.** Lot d'infrastructure et de compatibilité : aucune fonctionnalité par classe n'est activée (résolution, assistant, matières de classe, en-têtes : L2–L5). Aucune migration exécutée sur Supabase, aucun déploiement.
Référence : `docs/project/BULLETIN-CLASSE-01-AUDIT.md` (#1054, fusionnée `156fe851`).

## 1. Contenu

| Fichier | Rôle |
|---|---|
| `backend/db/migrations/20261105_report_card_class_scope.sql` | Migration manuelle, transactionnelle, idempotente |
| `backend/db/migrations/20261105_report_card_class_scope.rollback.sql` | Retour arrière contrôlé (refusé si données de classe) |
| `backend/db/migrations/20261105_report_card_class_scope.preflight.sql` | Préflight lecture seule, verdict GO / WARN / NO-GO |
| `backend/db/reportCardConfigurationPgStore.js` | `upsertBinding`, `getBinding`, `getActiveByPair` compatibles avant / après migration |
| `backend/db/reportCardConfigurationSql.js` | Démarrage : l'index historique n'est plus recréé après migration |
| `backend/lib/reportCard/reportCardClassScopeL1.pg.test.js` | 12 scénarios PostgreSQL réels |
| `backend/lib/reportCard/reportCardClassScopeL1.test.js` | Gardes statiques (jamais au démarrage, préflight lecture seule, ordre des garanties) |
| `backend/lib/reportCard/reportCardClassScope.support.js` + `reportCardConfiguration.classScope.pg.test.js`, `reportCardLot11.classScope.pg.test.js` | Rejeu des suites LOT 6 et LOT 11 sur le schéma migré |
| `backend/lib/reportCard/reportCardConfiguration.pg.test.js`, `reportCardLot11.pg.test.js` | Point d'accroche du rejeu (inactif par défaut) |

## 2. Schéma après migration

`report_card_active_bindings`
- `id UUID NOT NULL DEFAULT gen_random_uuid()` : **clé primaire technique** (remplace `(school_id, model_key)`).
- `academic_year_id UUID`, `class_id UUID` : NULL ensemble (liaison établissement) ou renseignés ensemble (liaison de classe) — `CHECK report_card_active_bindings_scope_pair`.
- `uq_report_card_active_bindings_school (school_id, model_key) WHERE class_id IS NULL` : **invariant historique conservé**.
- `uq_report_card_active_bindings_class (school_id, model_key, academic_year_id, class_id) WHERE class_id IS NOT NULL`.
- FK `report_card_active_bindings_class_tenant (class_id, academic_year_id, school_id) → classes (id, academic_year_id, school_id)` ; FK existante `report_card_active_bindings_request_tenant` conservée.

`report_card_configuration_requests`
- `academic_year_id`, `class_id`, même `CHECK` de paire et même FK composite.
- `uq_report_card_configuration_one_active_school (school_id, model_key) WHERE status = 'ACTIVE' AND class_id IS NULL`.
- `uq_report_card_configuration_one_active_class (…, academic_year_id, class_id) WHERE status = 'ACTIVE' AND class_id IS NOT NULL`.
- L'index historique `uq_report_card_configuration_one_active` est retiré **après** création des deux index partiels.

`classes` : contrainte additive `classes_id_year_school_unique UNIQUE (id, academic_year_id, school_id)` (cible de la FK composite ; trivialement satisfaite, `id` étant déjà clé primaire).

**Provenance et définitions exactes (revue CTO)** : chaque objet créé par L1 (5 colonnes, 5 contraintes, 4 index, PK technique) reçoit le commentaire PostgreSQL `somafrik:bulletin-classe-01-l1`. Avant toute création ou adoption, la migration valide tout objet homonyme par sa **définition** : table (`conrelid` / `indrelid`), type, colonnes ordonnées (`indkey`), prédicat (`pg_get_expr(indpred, indrelid)`), absence d'expression, unicité, validité, définition de contrainte (`pg_get_constraintdef`, CHECK et FK référencées), type de colonne. Définition différente → `CLASS_SCOPE_DEFINITION_MISMATCH` ; définition identique mais **sans** marqueur (objet d'un autre chantier) → `CLASS_SCOPE_FOREIGN_OBJECT`. Dans les deux cas : exception, transaction annulée intégralement, aucun objet adopté. Les garanties historiques retirées (PK `(school_id, model_key)`, index `uq_report_card_configuration_one_active`) le sont seulement si leur définition historique exacte est vérifiée. Ré-exécution : un objet marqué et conforme est conservé.

**Ordre des garanties** : nouveaux index créés puis contrôlés (`indisunique AND indisvalid`, sinon exception) **avant** tout retrait de la PK ou de l'index historique ; contrôle final (PK `id`, FK existante, aucune `id` NULL). Le tout dans une seule transaction (`lock_timeout` 5 s, `statement_timeout` 60 s) : un échec annule tout. Aucune ligne supprimée ; seule écriture de données : attribution d'une `id` aux liaisons existantes. Aucun `GRANT`/`REVOKE` (aucune exposition supplémentaire).

## 3. Compatibilité du code

| Méthode | Avant L1 | L1 (valable avant **et** après migration) |
|---|---|---|
| `upsertBinding` | `ON CONFLICT (school_id, model_key)` | détection de `class_id` à chaque appel : ancien schéma → cible historique ; nouveau schéma → `ON CONFLICT (school_id, model_key) WHERE class_id IS NULL`. En cas de migration appliquée pendant l'exécution (`42P10`), nouvelle détection et reprise (point de sauvegarde dans la transaction). |
| `getBinding` | première ligne `(school_id, model_key)` | ligne de portée **établissement** uniquement (`class_id` absent ou NULL) |
| `getActiveByPair` | première demande ACTIVE | demande ACTIVE de portée **établissement** uniquement ; après migration, filtre `class_id IS NULL` **en SQL** : `FOR UPDATE` ne verrouille jamais les demandes des classes (test de contention) |

Les objets exposés (`mapBinding`, `mapRequest`) sont **inchangés** (aucun nouveau champ) ; routes, `model_key`, `report_card_id` et publication inchangés. Aucune liaison de classe n'est créée par le code L1.

**Démarrage** : `REPORT_CARD_CONFIGURATION_SQL` (exécuté à chaque démarrage) recréait `uq_report_card_configuration_one_active`. En L1, cette création est conditionnée à l'absence de `class_id` : base neuve inchangée, base migrée préservée après redémarrage.

### Rollback et provenance

Le rollback inventorie d'abord tous les objets portant un nom L1 : il ne retire **que** ceux qui portent le marqueur et ont la définition L1. Un objet homonyme sans marqueur (créé avant la migration ou par un autre chantier) ou modifié → `CLASS_SCOPE_ROLLBACK_FOREIGN_OBJECT`, aucune modification. La PK `(id)` n'est remplacée que si elle porte le marqueur ; l'index historique restauré est vérifié (définition exacte). Aucun `DROP … IF EXISTS` inconditionnel.

## 4. Ordre code / migration (démontré par les tests)

| # | Schéma | Code | Résultat | Test |
|---|---|---|---|---|
| 1 | ancien | ancien | fonctionnel | `1.` |
| 2 | ancien | **L1** | fonctionnel | `2.`, `10.`, suites LOT 6 / LOT 11 |
| 3 | **nouveau** | **L1** | fonctionnel | `3.`, `4.`, `7.`, `11.`, suites `*.classScope.pg.test.js` |
| 4 | **nouveau** | ancien | **incompatible** : l'UPSERT historique échoue (`42P10`) et la lecture mélange établissement et classe ; au redémarrage, l'ancien démarrage recrée l'index historique | `5.`, préflight P07 |

**Conséquences** : déployer L1 **avant** la migration ; ne jamais redéployer un code antérieur à L1 sur un schéma migré sans exécuter d'abord le rollback.

## 5. Procédure de mise en service — préproduction uniquement

Aucune étape n'est exécutée par cette PR. Chaque étape exige l'autorisation CTO et le contrôle de l'étape précédente.

1. **Code** : après fusion autorisée, vérifier que Render `somafrik-api-preprod` sert le SHA de fusion (métadonnées Render) ; `GET /api/health` = 200 ; parcours existants (catalogue, configuration école, aperçu de publication) inchangés ; aucun `42P10` dans les journaux.
2. **Sauvegarde** : point de restauration Supabase horodaté (PITR / sauvegarde manuelle).
3. **Préflight** (connexion du rôle propriétaire des tables) :
   ```bash
   psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v expected_db='<base>' -v expected_env='preprod' -v expected_system_identifier='<identifiant relevé>' -f backend/db/migrations/20261105_report_card_class_scope.preflight.sql
   ```
   Attendu : P05 « à appliquer », P06 PK `(school_id, model_key)`, P07 index historique `OK` et index L1 `ABSENT`, P16 « aucun objet homonyme préexistant », aucun NO-GO. Réserves admises à justifier (P10 données classes/années, P14 exposition préexistante).
4. **Migration** (fenêtre validée, même rôle) :
   ```bash
   psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f backend/db/migrations/20261105_report_card_class_scope.sql
   ```
5. **Contrôle** : relancer le préflight → P05 « appliquée », P06 PK `(id)` marquée L1, P07 index historique `ABSENT` et 4 index L1 `OK`, P16 « tous les objets L1 présents, marqués et conformes ». Redémarrer l'API, relancer le préflight (P07 inchangé). Rejouer les parcours de l'étape 1.
6. **Rollback** si nécessaire (aucune donnée de classe ne peut exister en L1) :
   ```bash
   psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f backend/db/migrations/20261105_report_card_class_scope.rollback.sql
   ```
   Puis préflight : P05 « à appliquer ». Le code L1 reste compatible.

Production : hors périmètre ; même procédure après décision CTO distincte.

## 6. Tests

| Suite | Résultat local |
|---|---|
| `reportCardClassScopeL1.pg.test.js` (21) | 21/21 |
| `reportCardClassScopeL1.test.js` (5 gardes) | 5/5 |
| `reportCardConfiguration.pg.test.js` / `.classScope.pg.test.js` | 1/1 et 1/1 |
| `reportCardLot11.pg.test.js` / `.classScope.pg.test.js` | 7/7 et 7/7 |
| Suites bulletins backend complètes (contrats, LOT 0 → 11, catalogue, RLS #1053, PostgreSQL) | 449/449 |
| E2E navigateur réel (catalogue, configuration école, RBAC, autre pays) | 4/4 |
| Inventaire MONO-T1 | inchangé (382 routes) |

Scénarios PostgreSQL couverts : base sans liaison et avec liaisons ; migration appliquée deux fois ; PK technique UUID ; unicité établissement et classe ; aucune perte ; classe d'un autre établissement, année incompatible, classe sans année, année sans classe, doublons (liaisons et demandes ACTIVE) refusés par la base ; création, UPSERT, lecture et demande active établissement avant et après migration ; liaison de classe jamais confondue ; `model_key` et `report_card_id` inchangés ; isolation établissement A / B ; redémarrage après migration ; catalogue #1053 (RLS) et privilèges `anon`/`authenticated` inchangés ; snapshot publié identique octet pour octet après migration et rollback ; rollback refusé avec données de classe, autorisé sans, ré-application ; migration appliquée pendant l'exécution ; prérequis manquants (aucun effet partiel). **Revue CTO** : six objets homonymes incompatibles avant migration (index sans prédicat, index sur une autre table, contrainte aux mauvaises colonnes, contrainte identique sans marqueur, colonne d'un autre chantier, index historique inattendu) → migration annulée intégralement (empreinte du schéma identique) et préflight NO-GO (P16 / P07) ; rollback refusé quand un objet nommé L1 perd sa provenance, contrainte d'un autre chantier jamais supprimée, rollback complet une fois la provenance rétablie ; contrainte homonyme préexistante → migration et rollback refusés, contrainte conservée ; contention : une demande de classe verrouillée ne bloque pas `getActiveByPair`, la demande établissement verrouillée bloque toujours.

## 7. Risques résiduels

| Risque | Maîtrise |
|---|---|
| Ancien code redéployé après migration | Interdit (§4) ; préflight P07 le détecte ; rollback d'abord |
| Verrou bref sur `classes`, liaisons et demandes | `lock_timeout` 5 s (échec propre, rien d'appliqué) ; préflight P12 ; fenêtre validée |
| Identité de la base sous Supabase (base nommée `postgres` partout) | `expected_env` + identifiant système du cluster (P01) |
| Privilèges `anon`/`authenticated` préexistants sur les tables LOT 6 | Non modifiés par L1 ; signalés par P14 ; à traiter hors L1 si présents |
| Version PostgreSQL | 17.6 confirmée (D5) ; CI en 16 ; compatible ≥ 12 |
