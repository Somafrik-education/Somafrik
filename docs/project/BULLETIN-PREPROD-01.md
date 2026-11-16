# BULLETIN-PREPROD-01 — catalogue indisponible en préproduction : diagnostic, préflight, GO/NO-GO

Statut : **Draft / HOLD.** Aucune migration exécutée, aucune modification de production. Application de la migration : **autorisation CTO distincte requise**.

## 1. Version déployée

| Élément | Constat | Vérifié depuis la session ? |
|---|---|---|
| `develop` | `4c516c83` = #1051 (fusion squash), arbre **identique** à la branche `feat/bulletin-catalog-01` (HEAD `c369d866`). | Oui (git) |
| Services Render `somafrik-web-preprod` / `somafrik-api-preprod` | Construits depuis `develop` (`docs/preproduction.md`). SHA réellement déployé : **à lire dans les métadonnées Render** (« Deploy » → commit). Contrat : `WEB_SHA == API_SHA == 4c516c83` (ou ultérieur). | **Non** : `api-preprod.somafrik.app` et `preprod.somafrik.app` refusés par la politique réseau du bac à sable. |

## 2. Réponses attendues des endpoints (à vérifier en préproduction)

Sans jeton : `401` attendu (authentification requise). Avec un jeton :

| Cas | `GET /api/report-card/catalog/admin` (Superadmin) | `GET /api/report-card/catalog` (Admin établissement) | UI |
|---|---|---|---|
| API antérieure à #1051 | `404` (route inconnue) | `404` | « Ce serveur ne propose pas encore le catalogue » |
| API #1051, **tables absentes** | `503 {"code":"CATALOG_UNAVAILABLE"}` | `503 {"code":"CATALOG_UNAVAILABLE"}` | « Le catalogue n'est pas encore installé » (Superadmin) / « pas encore disponible » (école) |
| API #1051, migration appliquée, aucune disponibilité | `200` (2 modèles, aucun pays) | `200 {"models":[]}` | Galerie Superadmin ; « Aucun modèle disponible pour <pays> » |

Commandes de vérification (jeton saisi localement, jamais copié dans un ticket) :

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://api-preprod.somafrik.app/api/health
curl -sS -H "Authorization: Bearer $SUPERADMIN_TOKEN" https://api-preprod.somafrik.app/api/report-card/catalog/admin | head -c 300
curl -sS -H "Authorization: Bearer $SCHOOL_ADMIN_TOKEN" https://api-preprod.somafrik.app/api/report-card/catalog | head -c 300
```

**Diagnostic le plus probable** (captures du 3 novembre : catalogue indisponible des deux côtés) : API #1051 déployée, **migration non appliquée** (choix volontaire : jamais au démarrage) ⇒ `503 CATALOG_UNAVAILABLE`. À confirmer par les commandes ci-dessus et par le préflight (contrôle P09).

## 3. Préflight SQL non destructif

Fichier : `backend/db/migrations/20261104_report_card_catalog.preflight.sql`. Transaction `READ ONLY` terminée par `ROLLBACK`, délai 15 s, verrou 2 s ; garde statique en test (aucun mot-clé d'écriture).

```bash
psql "$PREPROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v expected_db='<nom exact de la base de préproduction>' -f backend/db/migrations/20261104_report_card_catalog.preflight.sql
```

| Contrôle | Bloquant si |
|---|---|
| P01 base cible (nom confirmé par `expected_db`) | nom différent |
| P02 garde production | nom de base contenant « prod » hors « preprod/staging » |
| P03 transaction lecture seule | non lecture seule |
| P04 version PostgreSQL | (réserve si < 12) |
| P05 schéma `public` + droit CREATE | absent / sans droit |
| P06 `countries.id` UUID avec clé unique (cible des clés étrangères) | absent, autre type, non unique |
| P07 pays enregistrés | (réserve si aucun) |
| P08 établissements sans pays reconnu | (réserve : aucun modèle proposé, fail-closed) |
| P09 tables `report_card_catalog_*` | **état partiel** (0/3 = à appliquer ; 3/3 = déjà appliquée) |
| P10 objets `report_card_catalog*` inattendus | tout conflit de nom |
| P11 tables préalables créées au démarrage (LOT 1→6, publication, référentiels) | une absente |
| P12 hiérarchie des matières (`subjects.parent_subject_id`, `display_order`) | absente |
| P13 demandes `catalog-*` existantes | (réserve) |
| P14 transactions de plus de 5 min | (réserve : verrou bref sur `countries`) |
| VERDICT | NO-GO si un contrôle bloquant |

Vérifié localement (PostgreSQL 16) : base initialisée sans catalogue → **GO** (P09 « absentes 0/3 ») ; après migration → **GO avec réserve** (P09 « déjà présentes ») ; mauvaise base → **NO-GO** (P01) ; base vide → **NO-GO** (P00) ; variable `expected_db` absente → arrêt sans exécution ; aucune ligne écrite.

## 4. GO / NO-GO

| Critère | État |
|---|---|
| Code #1051 sur `develop` | **GO** (`4c516c83`) |
| SHA déployé Web = API ≥ `4c516c83` | **À confirmer** (Render) |
| Endpoints : `503 CATALOG_UNAVAILABLE` confirmé | **À confirmer** (commandes §2) |
| Préflight sur la base de préproduction : VERDICT GO | **À exécuter avec la connexion de l'API** (P15 = rôle de l'API) |
| Rôle de `DATABASE_URL` de l'API relevé (`current_user`, `rolbypassrls`) | **À confirmer** (§5 étape 1) |
| Autorisation CTO distincte pour appliquer | **Requise** |

**Verdict actuel : NO-GO d'application** tant que les trois lignes « à confirmer / à exécuter » ne sont pas vertes et que l'autorisation n'est pas donnée. Aucun risque identifié dans le contenu de la migration (additive, idempotente, trois tables nouvelles, aucune table existante modifiée).

## 5. Commande exacte d'application (après GO et autorisation CTO) — mise à jour BULLETIN-PREPROD-02

La migration active RLS sur les trois tables et accorde **au seul rôle applicatif** (rôle de `DATABASE_URL` de `somafrik-api-preprod`) les privilèges strictement utilisés, avec des politiques limitées à ce rôle : modèles `SELECT` ; disponibilité `SELECT, INSERT, UPDATE` ; historique `SELECT, INSERT` (ajout seul) ; séquence `USAGE, SELECT`. `anon`, `authenticated` et `PUBLIC` : aucun accès. **Jamais de `BYPASSRLS`.** Rôle applicatif = réglage `somafrik.catalog_app_role`, sinon le rôle qui applique la migration ; `anon`/`authenticated`/`PUBLIC` ou rôle inconnu : migration refusée.

1. **Rôle réel de l'API** (connexion `DATABASE_URL` de `somafrik-api-preprod`, pas la console SQL) :
   ```bash
   psql "$PREPROD_API_DATABASE_URL" -XAtc "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
   ```
2. **Préflight avec cette même connexion** (P15 = rôle de l'API) — VERDICT GO requis :
   ```bash
   psql "$PREPROD_API_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v expected_db='<nom exact de la base de préproduction>' -f backend/db/migrations/20261104_report_card_catalog.preflight.sql
   ```
3. **Application** — une seule des deux formes :
   - Le rôle de l'API a le droit CREATE sur `public` (P05 GO) : appliquer avec la connexion de l'API (il devient propriétaire et reçoit les politiques) :
     ```bash
     psql "$PREPROD_API_DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f backend/db/migrations/20261104_report_card_catalog.sql
     ```
   - Sinon (P05 WARN) : appliquer avec un rôle administrateur en nommant explicitement le rôle de l'API :
     ```bash
     psql "$PREPROD_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -c "SELECT set_config('somafrik.catalog_app_role', '<rôle relevé à l''étape 1>', true)" -f backend/db/migrations/20261104_report_card_catalog.sql
     ```
4. **Contrôle après migration** : relancer le préflight de l'étape 2 (connexion de l'API). **P16** (privilèges), **P17** (RLS), **P18** (politiques couvrant le rôle) et **P19** (aucun accès `anon`/`authenticated`) doivent être GO ; tout NO-GO = catalogue inutilisable ou exposé → retour arrière. Puis `GET /api/report-card/catalog/admin` → `200` avec 2 modèles.

Ré-exécution sans effet (politiques recréées à l'identique). Changement ultérieur de rôle applicatif : ré-exécuter la forme 3b avec le nouveau rôle. Aucun redémarrage requis.

Retour arrière : `psql "$PREPROD_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f backend/db/migrations/20261104_report_card_catalog.rollback.sql` (supprime uniquement les trois tables, leurs privilèges et politiques ; bulletins publiés intacts).

Preuves (PostgreSQL réel, `reportCardCatalogRls.pg.test.js`, 7/7) : rôle applicatif non propriétaire, sans superutilisateur ni `BYPASSRLS` ; privilèges par défaut de type Supabase ouverts à `anon`/`authenticated` avant migration ; lecture du catalogue, activation/désactivation par pays et historique via le store réel ; suppression ou modification de l'historique et des modèles refusées ; `anon`/`authenticated` sans aucun privilège (et `SELECT` refusé) ; sans politique, catalogue vide pour le rôle applicatif (cas #1053 initial reproduit) ; ré-exécution idempotente ; rôle public ou inconnu refusé ; préflight via le rôle applicatif : P16–P19 GO, NO-GO si une politique manque ou si `anon` reçoit un droit.

## 6. Erreur Superadmin « academicConfigs: schoolCode établissement requis »

- **Cause** : sur les pages Paramètres (`/parametres`, `/parametres/securite`, `/parametres/abonnements`, `/parametres/roles-droits`, `/parametres/annee-scolaire`…), la carte des domaines charge `academicConfigs`. Pour un compte plateforme sans établissement sélectionné (`schoolCode = "*"`), le chargeur appelait `GET /api/academic-config` **sans établissement** ; le serveur refuse à juste titre (`resolvePrincipalSchoolCode` → 400). L'erreur remontait dans la barre supérieure.
- **Correctif** (`web/src/lib/domainLoaders.ts`) : pour un rôle plateforme (Superadmin, Admin Pays) **sans établissement concret**, le chargeur ne fait plus l'appel et renvoie une configuration vide. **Aucun établissement n'est attribué** ; dès qu'un établissement est sélectionné, sa configuration est chargée comme avant. Rôles établissement : comportement inchangé. Serveur : inchangé (le refus reste la règle).
- Tests : `web/src/lib/domainLoaders.academicConfigs.test.ts` (6 cas) ; vérification navigateur réelle : aucun appel `academic-config` ni erreur sur 4 pages Paramètres Superadmin.

## 7. UI/UX : états « catalogue indisponible »

- Superadmin : états distincts « pas encore installé » (503) et « serveur pas à jour » (404 sans code métier), explication, référence support, bouton « Vérifier à nouveau » ; plus d'alerte rouge générique.
- Établissement : message non technique (« pas encore disponible », bulletins publiés toujours consultables), « Vérifier à nouveau », « Retour aux bulletins ».
- Un 404 métier (`CATALOG_MODEL_UNKNOWN`) reste une erreur ordinaire.
- Captures bureau/tablette : `docs/project/bulletin-preprod-01/`.
