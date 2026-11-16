# GO-PROD-G5-01 — Runbook Render : neutralisation de l'AutoDeploy et déploiement contrôlé

| Champ | Valeur |
|---|---|
| Service API production | `srv-dac22v8jo6nc739b3t9g` (`somafrik-api-prod`, `api.somafrik.app`) |
| Service Web production | `srv-dac39n8u01pc73flept0` (`somafrik-web-prod`, `somafrik.app`) |
| Configuration actuelle | Branche `main`, `autoDeploy=yes`, déclencheur `commit` : **déclaration CTO du 16/11/2026**, non relue par Claude (Render inaccessible depuis cet environnement) |
| Statut | **Procédure préparée. Aucune modification Render effectuée. Exécution réservée à un GO CTO spécifique.** |

## 1. Pourquoi c'est bloquant

1. Aucun `render.yaml` dans le dépôt (MIG-AUD-01 §« CONFIRMÉ »). La configuration de déploiement vit uniquement dans le dashboard Render.
2. **L'API applique 17 migrations de schéma à son démarrage** (`GO-PROD-G5-01-MIGRATIONS.md` §2). Un merge de #1145 dans `main` déclencherait donc, sans étape humaine :
   - un build et un deploy de l'API **et** du Web de production ;
   - au boot de l'API, des DDL sur `Somafrik-prod`, dont des index qui bloquent les écritures sur `students` et `subjects` ;
   - aucune fenêtre pour prendre une sauvegarde immédiatement avant.

## 2. Audit préalable (D1, lecture seule)

À relever dans le dashboard ou via l'API Render (`GET /v1/services/{id}`, `GET /v1/services/{id}/deploys?limit=5`) pour **chacun** des deux services. Ne publier que des métadonnées.

| Point | Valeur à relever | Statut |
|---|---|---|
| Branche suivie | `main` attendu | Déclaré CTO ; NOT VERIFIED par Claude |
| `autoDeploy` / déclencheur | `yes` / `commit` | Déclaré CTO ; NOT VERIFIED par Claude |
| Commit actuellement live | SHA du dernier deploy `live` ; attendu `ef8bc951…` ou antérieur | NOT VERIFIED |
| État des 5 derniers deploys | `live`, `deactivated`, `build_failed`… | NOT VERIFIED |
| Service suspendu ou actif | MIG-AUD-01 a observé `x-render-routing: suspend` (HTTP 503) le 29/10/2026 sur la prod | **À revérifier : si la prod est suspendue, un merge ne la relance pas forcément, mais le risque reste entier à la réactivation** |
| Disque persistant monté (API) | Nom, point de montage, taille | NOT VERIFIED (`docs/render.md:85`) |
| Health check configuré | `GET /api/health` | NOT VERIFIED |
| Possibilité de désactiver l'AutoDeploy sans redémarrage | Réglage de build, sans effet sur l'instance en cours | À confirmer : comparer l'ID de l'instance et l'uptime avant/après |

## 3. Plan de neutralisation (D2) — NE PAS EXÉCUTER DANS CE MANDAT

Prérequis : GO CTO spécifique, fenêtre annoncée, une personne exécute et une autre contrôle.

**Avant**, capturer pour chaque service : `autoDeploy`, branche, ID et commit du deploy live, `GET /api/health` (API) et `HTTP 200` sur `/` (Web).

**Action**, pour chaque service :

| Moyen | Opération |
|---|---|
| Dashboard | *Service → Settings → Build & Deploy → Auto-Deploy* : passer à **Off** (ou « No ») |
| API Render | `PATCH /v1/services/{serviceId}` avec le corps `{"autoDeploy": "no"}`, clé API Render dans un gestionnaire de secrets, jamais dans GitHub |

**Après**, recapturer les mêmes champs. Attendu :
- `autoDeploy=no` sur **les deux** services ;
- **aucun nouveau deploy** créé ;
- le commit live et l'instance sont inchangés ;
- le health check reste OK.

Publier le tableau avant/après dans #720.

## 4. Séquence de mise en production cible (pour un futur GO G6/G7)

1. AutoDeploy **off** sur l'API et le Web (§3) ; preuve publiée.
2. G5 PASS : restauration isolée et rollback applicatif prouvés (`GO-PROD-G5-01-RESTORE-RUNBOOK.md`).
3. Merge de #1145 dans `main`, sur GO CTO. **Aucun deploy ne doit partir** : le vérifier dans la liste des deploys.
4. Sauvegarde immédiate : snapshot ou `pg_dump` (runbook restauration §2). Heure relevée.
5. **Deploy manuel du commit exact**, l'API d'abord : *Manual Deploy → Deploy a specific commit* (dashboard), ou `POST /v1/services/{id}/deploys` avec `{"commitId": "<SHA de merge validé>"}`.
6. Suivre les logs de boot jusqu'à la fin de `init()`. Vérifier `GET /api/health`, puis le smoke production minimal.
7. Deploy manuel du Web au même commit, puis smoke Web.
8. Les 4 migrations manuelles restent **hors fenêtre** (décision CTO séparée, `GO-PROD-G5-01-MIGRATIONS.md` §5.1).
9. Conserver AutoDeploy **off** jusqu'à une décision explicite.

## 5. Retour arrière applicatif

| Situation | Action |
|---|---|
| Build v25 échoue | Rien n'est déployé ; le deploy live précédent reste actif. |
| Boot v25 échoue (erreur de migration) | Render conserve l'instance précédente si le health check n'est jamais passé. Sinon, *Rollback* vers le deploy `ef8bc951` dans le dashboard, ou deploy manuel de `ef8bc951`. Analyser l'état partiel du schéma : DDL non transactionnel entre `ensure*`. |
| Régression fonctionnelle v25 | *Rollback* Render vers le deploy `ef8bc951` (code seulement). **Le schéma reste migré** : valable uniquement si le rollback applicatif a été prouvé (`GO-PROD-G5-01-MIGRATIONS.md` §5.1) et si `20261105_report_card_class_scope` n'a **pas** été appliquée. |
| Corruption de données | Seulement en dernier recours : restauration du snapshot pris à l'étape 4, avec perte des écritures postérieures, à rejouer, et rejeu des effacements RGPD. Décision CTO. |

Un rollback Render ne revient que sur le **code**. Il n'annule aucune migration.

## 6. Ce qui reste à vérifier pour PASS (lot D)

- [ ] Configuration réelle des deux services relue et publiée (§2).
- [ ] Commit live et état des derniers deploys publiés.
- [ ] Inventaire des disques persistants et de leur sauvegarde.
- [ ] Confirmation que la désactivation de l'AutoDeploy ne redémarre pas le service.
- [ ] Neutralisation exécutée avec preuve avant/après, **après GO CTO spécifique**.
