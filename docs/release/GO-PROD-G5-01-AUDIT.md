# GO-PROD-G5-01 — Audit G5 : PostgreSQL, sauvegardes, restauration, rollback

| Champ | Valeur |
|---|---|
| Mandat | GO-PROD-G5-01, 16/11/2026 (#720, #719, #1145) |
| Candidate | `8124d331e3ef1a39ceea150e3c96e3e65a88ce7c` (inchangée par ce mandat) |
| Branche documentaire | `audit/go-prod-g5-01`, depuis `develop@b925ba9a1d58eb099dc62c8277fb4a9ddaa21e68` |
| Exécutant | Claude Code (environnement cloud sans accès Supabase ni Render : proxy 403, aucun identifiant) |
| Recommandation G5 | **FAIL / NOT VERIFIED : G5 reste bloquant.** |

Documents associés :
- [`GO-PROD-G5-01-MIGRATIONS.md`](GO-PROD-G5-01-MIGRATIONS.md) : inventaire des 27 fichiers, SHA-256, risques, plan de rollback ;
- [`GO-PROD-G5-01-RESTORE-RUNBOOK.md`](GO-PROD-G5-01-RESTORE-RUNBOOK.md) : audit des sauvegardes, dump, restauration isolée, répétition deploy/rollback ;
- [`GO-PROD-G5-01-RENDER-RUNBOOK.md`](GO-PROD-G5-01-RENDER-RUNBOOK.md) : neutralisation de l'AutoDeploy, deploy manuel, retour arrière.

## 1. Lot A — PostgreSQL et sauvegardes

| Critère | Statut | Source / preuve |
|---|---|---|
| Identité du projet `Somafrik-prod` (`loyubruyrxcaeshonkwp`, PostgreSQL 17) | NOT VERIFIED par Claude | Déclaration du mandat CTO ; MIG-AUD-01 (consignation du 05/09/2026 : `eu-west-1`, PG 17) |
| Santé actuelle `ACTIVE_HEALTHY` | NOT VERIFIED par Claude | Déclaration CTO. **Ce n'est pas une preuve de sauvegarde.** |
| Politique de sauvegarde du plan | NOT VERIFIED | Dashboard non consulté |
| Fréquence réelle | NOT VERIFIED | — |
| Date de la dernière sauvegarde | NOT VERIFIED | — |
| Rétention | NOT VERIFIED | — |
| PITR | NOT VERIFIED | MIG-AUD-01 : « INCONNU : … PITR, sauvegarde testée » |
| Possibilité de restauration | NOT VERIFIED | — |
| Test de restauration documenté | **FAIL** | `docs/compliance/sauvegardes-restauration.md:24` : « **aucun** dernier test daté n'est versionné » ; l'application n'implémente ni backup ni restore (ligne 7) |
| Sauvegarde des fichiers hors PostgreSQL (disques Render) | NOT VERIFIED | `docs/render.md:85` (disques persistants pour les pièces jointes) |

## 2. Lot B — Restauration isolée

**NOT VERIFIED.** Aucune destination isolée n'est disponible dans cet environnement, et aucune n'a été autorisée. Je n'ai créé aucune infrastructure. La procédure complète, gratuite (conteneur local `postgres:17` sans réseau), est dans le runbook de restauration, avec ses critères PASS.

## 3. Lot C — Migrations (synthèse ; détail dans `MIGRATIONS.md`)

**Vérifié directement dans le dépôt :**
- **27 fichiers ajoutés**, et non 26 : 21 migrations, 4 rollback, 2 préflight. Aucun fichier existant de `main` n'est modifié.
- **17 migrations sont appliquées automatiquement au démarrage de l'API** (`PostgresRepository.init()`, `backend/db/postgresRepository.js:123-196`). 4 sont manuelles (bulletins).
- Aucun `DROP TABLE/COLUMN`, aucun changement de type, aucun `NOT NULL` sans défaut sur une table existante.
- **Index non concurrents au boot** sur `students` (20261006) et `subjects` (20261103) : les écritures sont bloquées pendant leur construction. Durée inconnue.
- **Incompatibilité confirmée** : si `20261105_report_card_class_scope` (manuelle) est appliquée, l'API `main` ne peut plus activer un modèle de bulletin (`ON CONFLICT (school_id, model_key)` sans index correspondant). Elle peut même ne plus démarrer (re-création d'un index unique supprimé).

**Correction d'un rapport antérieur :** mon commentaire du 16/11 sur #1145 (« un rollback applicatif vers `main` paraît possible ») était trop large. Il ne vaut que **tant que `20261105_report_card_class_scope` n'est pas appliquée**. Cela confirme la consigne CTO : une migration additive n'est pas automatiquement sans risque.

**Non vérifié :** l'état réel des migrations en production (le dépôt n'a pas de table de suivi), le comportement sur PostgreSQL 17 (la CI ne teste qu'en 16), les durées et verrous réels, RPO et RTO.

## 4. Lot D — Render AutoDeploy

| Point | Statut |
|---|---|
| API `srv-dac22v8jo6nc739b3t9g` : `main`, `autoDeploy=yes`, `commit` | Déclaré CTO ; NOT VERIFIED par Claude |
| Web `srv-dac39n8u01pc73flept0` : idem | Déclaré CTO ; NOT VERIFIED par Claude |
| Commit live et derniers deploys | NOT VERIFIED |
| Désactivation possible sans arrêt du service | NOT VERIFIED (à constater avant/après) |
| Procédures de désactivation, de deploy manuel et de retour arrière | **Préparées** (`RENDER-RUNBOOK.md`), **non exécutées** |

## 5. Lot E — Contrôles de sécurité

| Engagement | Statut | Moyen de contrôle |
|---|---|---|
| Aucune écriture sur PostgreSQL production | **Confirmé** | Aucun accès réseau à Supabase depuis l'environnement (proxy 403) ; aucun identifiant présent |
| Aucune modification des services Render | **Confirmé** | Idem pour Render |
| Aucune migration exécutée | **Confirmé** | Aucune base contactée ; aucun `psql` lancé |
| Aucun secret enregistré dans GitHub | **Confirmé pour cette PR** | Documents sans chaîne de connexion ni clé ; variables nommées (`$PROD_READONLY_URL`) uniquement ; gate `Secrets` de la CI |
| Aucun dump contenant des données personnelles publié | **Confirmé** | Aucun dump produit |
| Aucun accès temporaire laissé ouvert | **Confirmé** | Aucun accès créé |
| Aucune modification de `main` | **Confirmé** | PR vers `develop`, documentaire |
| Aucun changement du code métier | **Confirmé** | Diff limité à `docs/release/` (4 fichiers ajoutés) |
| APPEL-GLOBAL-01 / Agent IA | Non touchés | — |

## 6. Risques

| ID | Gravité | Risque | Action pour lever |
|---|---|---|---|
| R1 | **P0** | Aucune restauration PostgreSQL prouvée ; sauvegardes non auditées | Runbook de restauration §1–5, exécuté par un détenteur de l'accès |
| R2 | **P0** | `autoDeploy=yes` + migrations au boot : un merge dans `main` modifie la prod sans étape humaine | Runbook Render §3, avant tout merge, sur GO CTO |
| R3 | **P1** | Rollback applicatif non prouvé à l'exécution | Runbook de restauration §6 |
| R4 | **P1** | `20261105_report_card_class_scope` casse l'API `main` (bulletins, voire boot) | Point de non-retour : hors fenêtre de déploiement ; rollback SQL avant tout retour à `main` |
| R5 | **P1** | Index non concurrents sur `students` et `subjects` au boot | Mesurer sur la copie restaurée ; décider s'il faut une PR `CONCURRENTLY` hors boot |
| R6 | P2 | Migrations testées seulement sur PG 16, production en 17 | Restauration et boot sur `postgres:17` (runbook §3, §6) |
| R7 | P2 | Disques persistants Render non couverts par la sauvegarde PostgreSQL | Inventaire et sauvegarde séparés |
| R8 | P2 | Pas de table de suivi des migrations : état de la prod non traçable | Relevé des métadonnées en lecture seule (MIGRATIONS §6.1) |
| R9 | P2 | 17 migrations sur 21 sans script inverse ; privilèges `20261105` sans script inverse | Acceptable si R3 est prouvé (schéma additif conservé) |

## 7. Actions restantes (par un détenteur des accès, sur GO CTO)

1. Audit des sauvegardes Supabase en lecture seule ; publication des métadonnées.
2. Dump logique chiffré, puis restauration sur `postgres:17` isolé ; contrôles de cohérence ; mesure du RTO.
3. Boot v25 puis boot `main` sur la copie, avec smoke (preuve R3, mesure R5).
4. Relevé de la configuration Render des deux services ; neutralisation de l'AutoDeploy sur GO spécifique, avec preuve avant/après.
5. Décision CTO sur `20261105_report_card_class_scope` et sur les index `CONCURRENTLY`.

**Une PR documentaire verte ne qualifie pas G5.**

`GO-PROD-G5-01 — DRAFT / HOLD — STOP POUR DIFF CTO INDÉPENDANT.`
