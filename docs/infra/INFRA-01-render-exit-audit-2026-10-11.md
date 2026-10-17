# INFRA-01 — Audit de faisabilite de sortie complete de Render

**Date de constat :** 2026-10-11
**Decision produit :** Option A — cible Cloudflare + Supabase ; sortie complete de Render.
**Statut :** AUDIT UNIQUEMENT / DRAFT / HOLD / NO READY / NO MERGE.
**Base figee pour le constat Git :** develop@bf04527c00e7999d7b161f63e1aeaac0f15e1d87.
**Périmètre :** inventaire en lecture seule, identification des écarts et critères d'acceptation. Aucun changement d'infrastructure, DNS, secrets, données, application ou déploiement.

## 0. Synthese CTO

- **GO pour instruire un prototype**, **NO-GO pour une bascule de production a ce stade**.
- Web React/Vite : candidat a Cloudflare Pages, apres validation monorepo, variables build, routes SPA, CORS et smoke.
- API Express/Node : conversion vers Workers **non prouvee**. Il faut un POC isole comprenant Chromium/PDF, PostgreSQL, stockage persistant, taches de fond et auth.
- Bases Supabase prod/preprod deja existantes : **aucun transfert PG prod/preprod vers Supabase n'est a presumer** ; conserver les bases actuelles et prouver les connexions applicatives avant cutover.
- Base Demo PostgreSQL 16 sur Render : migration separee avec donnees exclusivement fictives.
- **Interdiction de decommissionner Render** avant preuve de parite, integrite, monitoring, rollback operationnel et GO CTO explicite.

## 1. Sources, methode et limites

Constats lus via connecteurs Render et Supabase, et via fichiers de la branche develop et metadonnees GitHub.
Sources internes :
- docs/render.md (source de verite hebergement tant que le cutover n'est pas effectue)
- docs/preproduction.md
- docs/demo/ENVIRONMENT-1-DATABASE.md
- docs/compliance/supabase-data-api-lockdown.md
- backend/package.json ; backend/server.js ; backend/db/connectionConfig.js
- backend/lib/communicationsAttachments.js ; backend/lib/schoolLogo.js
- backend/lib/reportCard/reportCardSourceStorage.js
- backend/services/bulletinPdfRenderer.js ; backend/lib/communicationsNotificationsWorker.js
- web/package.json ; web/vite.config.ts ; Mobile/config/releaseEnvironments.js

Limites d'observation au 2026-10-11 :
- Compte Cloudflare (zones, Pages, Workers, R2, Hyperdrive, facturation) **non inspecte** : aucun connecteur Cloudflare accessible dans cette session.
- DNS reels, delegation, certificat TLS, registrar, TTL, WAF, cache et mode proxy **non verifies en zone**.
- Valeurs des secrets, cles, tokens et chaines de connexion **non lues, non exportees, non copiees**.
- Capacite provisionnee des disques != octets effectivement occupes ; inventaire fichiers et checksums **non effectues**.
- Factures Render, couts Cloudflare et volumetrie globale longue duree **non audites**. Ne pas annoncer d'economies chiffrees.
- L'etat de la Data API Supabase dans le dashboard n'est **pas verifie**.

## 2. Inventaire Render (workspace Somafrik)

Les 7 services actifs et le service suspendu ci-dessous ont ete observes.

| Environnement | Composant Render | Branche | Deploy auto | Disque monte / capacite | Statut |
| --- | --- | --- | --- | --- | --- |
| PROD | Somafrik-web-prod (Static Site) | main | oui | aucun | actif |
| PROD | Somafrik-api-prod (Node, Frankfurt) | main | oui | /var/data ; 1 Go | actif |
| PREPROD | somafrik-web-preprod (Static Site) | develop | non | aucun | actif |
| PREPROD | somafrik-api-preprod (Node, Frankfurt) | develop | non | /var/lib/somafrik/communication-storage ; 10 Go | actif |
| DEMO | Somafrik-web-demo (Static Site) | develop | non | aucun | actif |
| DEMO | somafrik-api-demo (Node, Frankfurt) | develop | non | /var/lib/somafrik-demo ; 1 Go | actif |
| DEMO | somafrik-demo-db (PostgreSQL 16, Frankfurt) | n/a | n/a | 15 Go provisionnes | disponible |
| LEGACY | Somafrik (Node, depot historique soma-afrik/Somafrik) | develop | oui (configure) | aucun declare | suspendu |

Le tableau Render affiche 7 services actifs et 1 service suspendu ; la DB est une ressource distincte. Aucune instance Render Key Value detectee. Les API utilisent /api/health.

La DB Demo a retourne une taille PostgreSQL actuelle d'environ **21 Mo** (different du disque provisionne de 15 Go), sans analyse de la taille des fichiers externes.

**Cout :** inventaire des plans a rapprocher de la facturation reelle, aucune estimation monetaire validee :
- Web PROD/PREPROD/DEMO : build plan Starter
- API PROD/DEMO : 0.5c-512mb
- API PREPROD et LEGACY : Starter
- PG DEMO : 0.1c-256mb

## 3. Preuves de version / gouvernance de release

Derniers deploys Render signales LIVE :

| Composant | SHA deploye | Date UTC |
| --- | --- | --- |
| API PROD | ef8bc9517ffc94aa770743713d0f561f92a9fc1e | 2026-09-27 |
| Web PROD | 24e1eb8e923157d5b20100198643711664807c3b | 2026-09-27 |
| API PREPROD | 7a2944719dd6e7c2b5f79ca3c131da4e213fe16f | 2026-10-10 |
| Web PREPROD | 7a2944719dd6e7c2b5f79ca3c131da4e213fe16f | 2026-10-10 |
| API DEMO | ea30677d7dbbdca9b4ad35e8fcf9eb6951ceff7a | 2026-09-17 |
| Web DEMO | ea30677d7dbbdca9b4ad35e8fcf9eb6951ceff7a | 2026-09-17 |

GitHub lu : main@ef8bc9517ffc94aa770743713d0f561f92a9fc1e ; develop@bf04527c00e7999d7b161f63e1aeaac0f15e1d87.
Rulesets nommes develop et main en vigueur.

**Ecart important : Web PROD et API PROD sont sur deux SHA differents**. A investiguer lors d'un gate de release separe ; **aucun redeploiement** dans INFRA-01. PREPROD et DEMO ont la parite de SHA pour leur paire Web/API.

## 4. Supabase et donnees

Projets Supabase existants et etat constate :
- Somafrik-prod — PostgreSQL 17, region eu-west-1, ACTIVE_HEALTHY.
- Somafrik-preprod — PostgreSQL 17, region eu-central-1, ACTIVE_HEALTHY.

Comptages **SQL SELECT COUNT(*) directs** au 2026-10-11 :
- PROD : schools=3, users=293, students=203, enrollments=203, attendance=1072, sessions=282.
- PREPROD : schools=25, users=126, students=65, enrollments=65.

Ces donnees **ne sont pas vides** : aucune suppression, reinitialisation ou import au titre de cet audit. Ne pas deduire de la taille de la demo ni de la presence des projets qu'une purge/validation de donnees est terminee.

Securite :
- L'inventaire Supabase signale 114 tables PROD et 119 tables PREPROD sans RLS.
- Probe SQL explicite : **0** table sans RLS avec privileges SELECT/INSERT/UPDATE/DELETE effectifs pour les roles anon ou authenticated dans le schema public, sur ces tables, au moment du controle.
- Cela est coherent avec docs/compliance/supabase-data-api-lockdown.md : clients Web/Mobile → API Somafrik → PG et REVOKE Data API, mais ne prouve pas le toggle dashboard.
- **Pas de RLS activee a l'aveugle** ; elaborer politiques et plan de migration seulement si exposition directe API Supabase souhaitee.
- Les advisors signalent aussi 4 fonctions a search_path mutable et l'extension btree_gist dans public ; traitement ulterieur en PR securite, avec validation SQL et GO.

## 5. Architecture cible (hypothese, non encore validee)

- Frontend Web : Cloudflare Pages pour PROD, PREPROD et DEMO, avec domaines et pipelines isoles, build Vite monorepo.
- API : Cloudflare Workers, **sous condition de faisabilite et de tests**. Ne pas supprimer Express ni changer le routage tant que le POC n'est pas concluant.
- Donnees : PostgreSQL Supabase PROD et PREPROD existants ; environnements, roles et pools strictement isoles.
- Connectivite PG : evaluer Hyperdrive/TCP+TLS, transaction/session pooling, max connection, certificats et migrations runtime.
- Objets prives (PJ communication, logos, sources bulletin) : R2 prive ou stockage objet equivalent valide, sans acces public anonyme. Integrite et autorisation tenant obligatoires.
- DEMO : nouvelle base PG dediee, noms, secrets et seed fictifs separes ; jamais de reemploi du schema ou des credentials PROD/PREPROD.
- Domaine public contractuel inchange pendant et apres la bascule : somafrik.app, preprod.somafrik.app, api.somafrik.app, api-preprod.somafrik.app. Les URLs mobiles connues restent **api.somafrik.app** (prod) et **api-preprod.somafrik.app** (preview/preprod).
- Absence de Cloudflare dashboard : **aucun enregistrement DNS, projet ou bucket ne peut etre marque comme existant**.

## 6. Bloquants techniques pour sortie totale

### B1 — Chromium et generation PDF (P0)
- backend/services/bulletinPdfRenderer.js lance Puppeteer avec executablePath et options Chromium, utilise page.pdf().
- backend/Dockerfile installe chromium, fontes et bibliotheques OS.
- Workers ne fournit pas le processus Chromium local d'un serveur Node : POC Cloudflare Browser Run / rendu PDF alternatif requis.
- Preuves : rendu de bulletin/QR, fontes, format, liens, securite, charges, quotas, facturation et comportement en cas d'indisponibilite.

### B2 — Stockage FS persistant (P0)
- backend/lib/communicationsAttachments.js : SOMAFRIK_COMMUNICATION_STORAGE obligatoire et non-ephemere en NODE_ENV=production.
- backend/lib/schoolLogo.js : fichiers logos stockes dans le meme root Communications.
- backend/lib/reportCard/reportCardSourceStorage.js : SOMAFRIK_REPORT_CARD_SOURCE_STORAGE et filesystem durable requis en production.
- Capacites Render 10 + 1 + 1 Go = **12 Go provisionnes**, **pas 12 Go effectivement utilises**.
- Workers node:fs est un filesystem virtuel temporaire par requete, pas un volume persistant.
- Exigence : inventaire effectif, mapping cle objet, ACL school/tenant, chiffrement, SHA-256, rollback, non-duplication et telechargements securises.

### B3 — Worker de fond avec timer 5 secondes (P0)
- backend/lib/communicationsNotificationsWorker.js : setInterval par defaut 5000 ms, drain d'outbox et balayage finance payment due.
- Les Workers HTTP ne sont pas des demons Node persistants. Conception a revoir avec Queues / Cron Triggers / durable orchestration, garanties d'idempotence, retries, latence, monitoring et absence de doubles notifications.

### B4 — Initialisation/DB et compatibilite Node (P0)
- backend/server.js (Express), pg, mongoose present dans package.json, fs et path, logique de prestart et migrations au runtime.
- backend/db/connectionConfig.js : DEFAULT_DB_POOL_MAX=5, DB_POOL_MAX borne [1,6], politique SSL. Revoir pool par isolation et compatibilite Hyperdrive.
- Ne pas executer implicitement migrations de schema, reset ou bootstrap lors d'un deploy Workers ; passer par jobs de migration explicites avant cutover.
- Tests necessaires : JWT RS256, scope ecole/pays/superadmin, Finance, Fiche Eleve, Cartes QR/NFC, communication push, uploads, CORS, Cloudflare proxy/trust proxy, rate-limit, sessions.

### B5 — Build et release Web/Mobile (P1)
- Web : React/Vite, sortie dist, app SPA ; depends workspace et paquet local packages/help-catalog. Verifier construction depuis racine monorepo (pas seulement repertoire web).
- docs/render.md et docs/preproduction.md imposent re-ecriture de routes SPA et controle SHA.
- Mobile/config/releaseEnvironments.js impose URLs API canoniques HTTPS et segregation prod/preprod.
- Interdire deployment auto vers le domaine PROD sur un simple push non approuve. Branches develop et main restent protegees.

### B6 — Domaines, secrets, facturation Cloudflare (P0 externe)
- Zone Cloudflare, gestion DNS, certificats, acces compte, budget, alertes, quotas, stockage R2, Workers Paid/Browser Run/Hyperdrive non audites.
- Relever uniquement **noms des variables et presence/absence**, jamais les valeurs de secrets.
- Valider retour arriere DNS, TTL, original host, WAF, CORS, IP, maintenance et logs.

### B7 — Demo et residu Legacy (P1)
- Demo DB Render PG16 separee ; cible demo isolée Supabase ou service PG alternatif compatible Cloudflare, sous decision et GO.
- Ancien service Render Somafrik suspendu (ancien depot) : tracer domaines et dependances avant toute suppression ; pas de decommission automatique.

## 7. Matrice de decision

| Item | Statut INFRA-01 | Critere futur de GO |
| --- | --- | --- |
| Topologie Render | Inventoriee | SHA de chaque cutover fige |
| Supabase PROD/PREPROD | Projets identifies, comptes directs verifies | SSL/pool/roles/app tests validés |
| Cloudflare compte et DNS | NON VERIFIE | preuves dashboard et zone |
| Web Pages | CANDIDAT | build deterministe + routes SPA + smoke |
| API Workers | NO-GO production | POC fonctionnel securite/performance |
| Fichiers persistants | NO-GO production | checksums source/destination et lecture |
| PDF Chromium | NO-GO production | rendering identique ou alternative validee |
| Notifications periodiques | NO-GO production | outbox sans pertes/doublons |
| Demo PG16 | Inventory only | cible isolée, seed fictif |
| Chiffrage et suppression Render | NON CHIFFRE | factures, cout cible, plan rollback, GO |

## 8. Plan propose (aucune execution autorisee dans cette PR)

1. Gate INFRA-01 : diff CTO independant + cloture des inconnues ; conserver DRAFT/HOLD.
2. CF-WEB-01 : build et deployment PREPROD sur domaine de test distinct, sans changer les domaines officiels.
3. STORAGE-01 : inventaire des objets puis migration pilote R2 prive.
4. CF-API-01 : POC isole Workers/Browser Run/Queues/Hyperdrive, analyse de faisabilite. Nombre de PR a reviser selon resultat.
5. DB-DEMO-01 : separer demo PG16 et migrer uniquement donnees fictives.
6. CUTOVER-01 : uniquement apres smoke complet Web, Android et API ; certificat, DNS, monitoring et rollback.
7. CLEANUP-01 : desactivation puis suppression des services Render seulement apres validation explicite de chaque ressource et delai d'observation.

Criteres non negociables pour la production : code/revision figes ; tests et Required gates verts ; aucun cross-tenant ; identites et droits conserves ; exactitude donnees ; fichiers lisibles ; PDF corrects ; notifications idempotentes ; URL mobile preservees ; p95/performance et couts mesures ; procedure de retour arriere testee ; GO manuel CTO.

## 9. Regles de securite et de non-mutation INFRA-01

**INTERDIT dans cette PR :**
- deploiement Render ou Cloudflare, reset/purge/DDL/seed/backfill SQL, action DNS, rotation de secrets, download/copie de donnees personnelles, suppression de ressource ;
- changement dans backend, web, Mobile, Docker, CI/workflows, scripts, docs/render.md (contrat actuel), docs/preproduction.md ;
- merge vers develop ou main sans nouvel ordre explicite, approbation du diff independant et CI.

**AUTORISE :** ce document neuf uniquement, releves read-only des metadonnees d'infrastructure, SQL SELECT agreges et recherches GitHub.

## 10. Documentation externe de reference

- Pages React : https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- Workers Node compat : https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Workers fs virtuel : https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
- Browser Run pour PDF : https://developers.cloudflare.com/browser-run/get-started/
- Hyperdrive + Supabase : https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- R2 prive/CORS : https://developers.cloudflare.com/r2/buckets/cors/
- Limits Workers : https://developers.cloudflare.com/workers/platform/limits/

## 11. Rapport attendu pour lever HOLD

- Etat reel compte Cloudflare, DNS, certificats, domaines et autorisations ; sans valeur sensible.
- Volumetrie disques/objets par environnement, inventaire fichiers et politique integrite.
- Mesures trafic/p95/CPU/memoire, jobs PDF/notifications, couts Render factures et couts Cloudflare estimes avec hypotheses.
- Matrice de routes et dependencies Node avec preuve build POC ; alternative documentee si Workers seul ne suffit pas.
- Verification du contrat d'alignement SHA PROD Web/API, et statut de la Data API Supabase.
- Diff CTO independant : base, HEAD, merge-base, ahead/behind, fichiers, scope, CI.
- Decision formelle Go/No-Go sur ouverture CF-WEB-01 et CF-API-01.

**Conclusion : INFRA-01 AUDIT DOCUMENTAIRE / DRAFT HOLD. PAS READY. PAS MERGE.**
