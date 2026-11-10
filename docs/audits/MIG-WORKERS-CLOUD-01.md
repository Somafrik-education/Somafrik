# MIG-WORKERS-CLOUD-01 — Préparation d'une expérimentation Cloudflare Workers

| Champ | Valeur |
|---|---|
| Projet | SOMAFRIK |
| Date | 29 octobre 2026 (Europe/Paris) |
| Dépôt | `Somafrik-education/Somafrik` |
| Base | `develop` |
| Classification | POC CLOUD ISOLÉ |
| Statut | **DRAFT / HOLD / NO MERGE** |
| PR source, non modifiée | #1027 |
| Cible | Cloudflare Workers. Le runtime Node traditionnel reste le repli |

Ce mandat prépare l'expérimentation. Il ne crée aucune ressource Cloudflare, ne déploie pas, et n'autorise pas la migration des 371 routes.

---

## A. Git

| Contrôle | Valeur |
|---|---|
| Branche | `cursor/mig-workers-cloud-01-1039` |
| Nom recommandé par le mandat | `poc/mig-workers-cloud-01`. La politique de branche de l'agent impose le préfixe `cursor/` et le suffixe `-1039` |
| Base SHA | `a11ec568871209fc2282c7796a1350812e22ad39` |
| Merge-base avec `origin/develop` | `a11ec568871209fc2282c7796a1350812e22ad39` |
| Source des composants réutilisés | `e7513c5b5a11c3824ec320116e058c3db8e54ff9` (HEAD de #1027 au moment de la copie) |
| Commit de préparation, vérifié par les checks | `75ea144bee19866b7a4b52b9d063c85bac2dc53b` |
| Ahead / behind après le relevé des checks | 2 / 0 |
| PR #1027 | Non modifiée, laissée en brouillon |

Fichiers repris tels quels depuis `e7513c5b5`, sans édition :

- `.github/workflows/mig-workers-poc-01.yml`
- `workers/mig-workers-poc-01/` (arbre complet du POC)

Fichiers nouveaux de ce mandat :

- `.github/workflows/mig-workers-cloud-01.yml`
- `docs/audits/MIG-WORKERS-CLOUD-01.md`
- `workers/mig-workers-cloud-01/README.md`
- `workers/mig-workers-cloud-01/wrangler.prepared.jsonc`
- `workers/mig-workers-cloud-01/test/prepared.test.js`

Le diff exact est `git diff a11ec568871209fc2282c7796a1350812e22ad39 HEAD`. Il ne contient pas les amendements documentaires de #1027 sur `docs/audits/MIG-AUD-01-render-supabase-cloudflare.md`. Aucun fichier de `backend/`, `web/` ou `Mobile/` n'est modifié.

## B. Infrastructure Cloudflare

Lecture faite le 29 octobre 2026, après-midi (Europe/Paris), depuis cet environnement :

| Vérification | Résultat |
|---|---|
| `CLOUDFLARE_API_TOKEN` | absent |
| `CLOUDFLARE_ACCOUNT_ID` | absent |
| `CF_API_TOKEN` | absent |
| `wrangler whoami` (Wrangler 4.155.0) | `You are not authenticated. Please run wrangler login.` |
| Ressource distante créée | aucune |

Le plan du compte, les quotas réellement attribués, la facturation et l'activation de Browser Run, Hyperdrive et Queues sur le compte Somafrik sont **non lus**. Les lignes « limite publiée » ci-dessous viennent de la documentation Cloudflare. Elles ne décrivent pas le compte.

| Service | Disponibilité sur le compte | Limite publiée | Coût potentiel publié | Autorisation pour aller plus loin |
|---|---|---|---|---|
| Compte Cloudflare | **Bloqué** : pas de jeton, pas de session Wrangler | — | Inconnu | Lecture seule du compte par le CTO, ou jeton à droits minimaux hors de Git |
| Workers | Non vérifiée | Free : 100 000 requêtes/jour, 10 ms CPU, 128 Mo. Paid : 10 millions de requêtes et 30 millions de ms CPU inclus, puis 0,30 USD / million de requêtes et 0,02 USD / million de ms CPU. Mémoire 128 Mo aussi en Paid. 6 connexions sortantes simultanées. Démarrage 1 s. Taille de Worker 64 Mio. Source : limites du 12 octobre 2026, tarifs du 2 octobre 2026 | Abonnement Paid : minimum 5 USD/mois. Plafond de planification de ce mandat | Créer ou déployer un Worker |
| Hyperdrive | Non vérifiée | Free : 100 000 requêtes/jour. Paid : requêtes illimitées, pooling et cache inclus. Source : page tarifaire du 18 juin 2026 | Pas de ligne séparée dans ces pages. Le Postgres externe, lui, se paie chez son hébergeur | Créer une config Hyperdrive et une base jetable |
| Browser Run | Non vérifiée | Free : 10 minutes/jour, 3 navigateurs concurrents. Paid : 10 heures/mois et 10 navigateurs en moyenne, puis 0,09 USD/heure et 2 USD par navigateur supplémentaire. Source : page du 21 avril 2026. Le binding s'appelle librement ; le POC utilise `BROWSER` | Un PDF d'essai tient dans le quota journalier Free s'il dure moins de 10 minutes et si le produit est activé. Non constaté | Exécuter Browser Run |
| Queues | Non vérifiée | Free : 10 000 opérations/jour, rétention 24 h. Paid : 1 million d'opérations/mois puis 0,40 USD / million. Un message livré compte en général 3 opérations. Source : page du 21 avril 2026 | Quelques messages d'essai restent dans le quota Free | Créer la queue `somafrik-cloud-01-notifications` |
| Facturation | Non lue | Le minimum Workers Paid ne couvre pas un dépassement Browser Run ni un Postgres externe | Coût engagé par ce mandat : **0 USD** | Tout abonnement ou dépassement |

Configuration préparée, non appliquée : `workers/mig-workers-cloud-01/wrangler.prepared.jsonc`.

| Binding | Nom | État |
|---|---|---|
| `BROWSER` | binding Browser Run | déclaré, aucune session lancée |
| `HYPERDRIVE` | id `PENDING_CTO_AUTHORIZATION` | pas une config réelle, pas de `localConnectionString` |
| `NOTIFY_QUEUE` | queue `somafrik-cloud-01-notifications` | nom réservé dans le fichier, queue non créée |
| Variables | `APP_ENV=workers-poc` | le code copié refuse tout autre environnement |

`workers_dev` et `preview_urls` sont faux. Pas de `account_id`, pas de route, pas de domaine `somafrik.app`.

### Plan chiffré soumis avant toute opération facturable

Ce plan n'est pas une autorisation. Il décrit ce qu'il faudrait créer, ensuite, si le CTO l'accepte.

Ressources :

1. Un Worker `somafrik-mig-workers-cloud-01`, sans route publique et sans sous-domaine `workers.dev`.
2. Une base PostgreSQL **nouvelle et jetable**, hors des projets Supabase de production et de préproduction. Tables `poc_ledger` et `poc_outbox` seulement. Pas de `schema.sql`.
3. Une config Hyperdrive vers cette base. La chaîne de connexion reste dans le secret Wrangler, jamais dans Git.
4. La queue `somafrik-cloud-01-notifications`.
5. Le binding `BROWSER`.
6. Une clé JWT d'expérience, 32 octets aléatoires, absente de Git.

Coût d'essai si le compte est Free et si les produits sont déjà inclus : quelques centaines de requêtes, quelques requêtes SQL, un PDF de moins de 10 minutes, moins de 10 000 opérations de queue. Ordre de grandeur publié : **0 USD**. Ce chiffre dépend du compte, qui n'a pas été lu. S'il faut passer à Workers Paid pour dépasser 10 ms de CPU, le minimum publié est **5 USD/mois**, dans le plafond de ce mandat, et il court jusqu'à l'arrêt de l'abonnement.

Risque de dépassement : une session Browser Run laissée ouverte, ou un essai de PDF répété en parallèle au-delà de 3 navigateurs sur le plan Free. Parade : un seul PDF, puis fermeture, puis arrêt.

Arrêt et nettoyage, dans cet ordre, après l'essai seulement :

1. Supprimer la route ou confirmer qu'aucune n'existe.
2. Supprimer le Worker.
3. Supprimer la config Hyperdrive.
4. Supprimer la queue.
5. Supprimer la base jetable et ses sauvegardes.
6. Révoquer le jeton d'API utilisé pour l'essai.
7. Ne pas laisser un abonnement Paid activé uniquement pour cet essai sans décision séparée.

Aucune de ces destructions n'est à faire aujourd'hui : les ressources n'existent pas.

## C. Résultats

| Preuve | Résultat |
|---|---|
| Express / JWT / RBAC | BLOCKED |
| Hyperdrive / PostgreSQL | BLOCKED |
| Browser Run / PDF | BLOCKED |
| Queue | BLOCKED |

Un succès local ne compte pas comme PASS.

### Express / JWT / RBAC — BLOCKED

| | |
|---|---|
| Environnement réel | Non atteint. Wrangler non authentifié |
| Méthode prévue | Déployer le Worker préparé, puis reprendre les cas du POC : 401 sans jeton, 401 si JWT invalide, 401 si jeton dans l'URL, 403 pour `Comptable`, 403 pour `super_admin` sur `GET /api/students`, 200 pour `student` et `school_admin`, corps sans donnée personnelle, champ `middleware` égal à `representative-simplified` |
| Résultat | BLOCKED |
| Durée Cloudflare | aucune |
| Limite | Le middleware copié ne certifie pas la session, le refresh, la portée établissement, les permissions en base, le rate limit ni les autres routes |
| Risque résiduel | Le plan Free coupe à 10 ms de CPU. Ce temps n'a pas été mesuré chez Cloudflare. `country_admin` sans `roleKeys` reste autorisé sur cette route : dette enregistrée dans `workers/mig-workers-poc-01/DEBT-ADMIN-PAYS.md`, module RBAC non modifié |
| Preuve consultable | Test local uniquement, voir la section Gouvernance |

### Hyperdrive / PostgreSQL — BLOCKED

| | |
|---|---|
| Environnement réel | Non atteint. Pas de config Hyperdrive, pas de base distante |
| Méthode prévue | `BEGIN`, `INSERT` fictif, `SELECT`, `ROLLBACK`, puis `SELECT` vide, via `env.HYPERDRIVE.connectionString` sans `localConnectionString`. Mesurer la connexion, une erreur provoquée, la fermeture du client |
| Résultat | BLOCKED |
| Durée Cloudflare | aucune |
| Limite | Le test local utilise `localConnectionString` vers Postgres sur la machine. Ce n'est pas Hyperdrive |
| Risque résiduel | Une chaîne mal gardée pourrait viser Supabase. Le code copié refuse les hôtes `supabase.co`, `supabase.com`, `pooler.supabase.com`, `onrender.com` et `somafrik.app`, et un nom de base sans `workers_poc` |
| Preuve consultable | Aucune preuve distante. Ne pas en simuler |

### Browser Run / PDF — BLOCKED

| | |
|---|---|
| Environnement réel | Non atteint. Binding absent du compte |
| Méthode prévue | `puppeteer.launch(env.BROWSER)`, HTML et CSS de la maquette officielle, données fictives, A4, en-tête `%PDF-`, fichier non vide, durée, fermeture du navigateur, aucun chargement d'URL externe |
| Résultat | BLOCKED |
| Durée Cloudflare | aucune |
| Limite | Sans binding, la route répond `503` `BROWSER_BINDING_REQUIRED`. Ce 503 est un garde-fou, pas un PDF |
| Risque résiduel | Le quota Free est de 10 minutes par jour. Un essai unique et court est le seul scénario compatible avec l'objectif de rester dans le gratuit |
| Preuve consultable | Aucun PDF. La config `wrangler.browser-run.jsonc` du POC et `wrangler.prepared.jsonc` ne lancent pas de navigateur |

### Queue — BLOCKED

| | |
|---|---|
| Environnement réel | Non atteint. Queue non créée |
| Méthode prévue | Publier `{ id }`, constater `queued` puis `processed`, rejouer un doublon, vérifier l'idempotence, provoquer une erreur puis un retry, provoquer un échec de publication puis une reprise. Aucun appel Expo |
| Résultat | BLOCKED |
| Durée Cloudflare | aucune |
| Limite | Le consumer local Wrangler et les tests `queueDelivery` prouvent le code, pas le service Queues |
| Risque résiduel | Relier cette queue aux notifications scolaires, ou y mettre autre chose qu'un identifiant fictif |
| Preuve consultable | Aucune preuve distante |

## D. Décision technique

Workers reste la cible architecturale, et le Node traditionnel le repli. **Cette préparation ne démontre pas que Workers tient.** Les quatre preuves réelles sont bloquées par l'absence d'accès au compte.

Adaptations déjà nécessaires, vues sur le code copié et non revalidées chez Cloudflare :

- `iconv-lite` 0.4 casse le runtime Workers. Le POC l'alias vers un décodeur UTF-8 limité à ce Worker.
- `TokenService` et `RbacService` sont empaquetés. Le graphe inclut les données de seed.
- Le pool `pg` de production ne se réutilise pas tel quel : Hyperdrive veut un client par invocation.
- Le PDF dépend de Browser Run, pas de Chromium dans l'isolate.
- Les `setInterval` de production ne sont pas dans ce POC.
- Les disques et le SMTP ne sont pas couverts ici.
- Le boot DDL de production ne doit pas partir contre une base canonique. Ce POC ne charge pas `schema.sql`.

Contraintes publiées, non observées sur un trafic Somafrik : 128 Mo par isolate, 10 ms de CPU en Free, 6 connexions sortantes, démarrage d'une seconde. Aucune mesure CPU ou mémoire Cloudflare n'existe pour ce Worker.

Dépendances fragiles : Express via `body-parser` et `iconv-lite`, le graphe `data.js` chargé par le RBAC, `@cloudflare/puppeteer` seulement si le binding existe.

### Coûts à 10, 100 et 1 000 établissements

Ce ne sont pas des factures. Le compte n'a pas été lu. Les volumes Somafrik réels sont inconnus. Hypothèses de planification, toutes remplaçables par une mesure :

- 400 élèves par établissement.
- Bande basse : 15 requêtes API par élève et par mois, 20 ms CPU par requête, 2 messages de queue par élève et par mois.
- Bande haute : 200 requêtes, 80 ms CPU, 30 messages.
- 3 bulletins PDF par élève et par an, 15 secondes de navigateur chacun, un seul essai.
- Un message de queue fait 3 opérations.
- Workers Paid est la base, à 5 USD, parce que le CPU Free de 10 ms est trop étroit pour servir d'hypothèse de production.
- Postgres de production reste les projets Supabase déjà là. Son coût n'est pas recompté ici. Le chiffre de l'audit MIG-AUD-01, environ 35 USD pour deux petits projets, n'a pas été relu sur une facture.
- SMTP et Expo : inchangés, montants non lus.

| Poste publié | 10, bande basse | 10, bande haute | 100, bande basse | 100, bande haute | 1 000, bande basse | 1 000, bande haute |
|---|---|---|---|---|---|---|
| Workers, abonnement | 5 USD | 5 USD | 5 USD | 5 USD | 5 USD | 5 USD |
| Requêtes au-delà de 10 millions | 0 | 0 | 0 | 0 | 0 | 21 USD |
| CPU au-delà de 30 millions de ms | 0 | 0,68 USD | 0 | 12,20 USD | 1,80 USD | 127,40 USD |
| Browser Run au-delà de 10 heures | 0 | 0 | 2,85 USD | 2,85 USD | 36,60 USD | 36,60 USD |
| Queue au-delà d'un million d'opérations | 0 | 0 | 0 | 1,04 USD | 0,56 USD | 14 USD |
| Ordre de grandeur Workers + Browser + Queue | 5 USD | 5,68 USD | 7,85 USD | 21,09 USD | 43,96 USD | 204 USD |

Le poste qui fait déraper la bande haute à 1 000 établissements est le CPU, et c'est justement celui qui n'a pas été mesuré. La concurrence des navigateurs, à 2 USD par navigateur au-delà de 10 en moyenne mensuelle, n'est pas dans le tableau : elle dépend du parallélisme des bulletins, inconnu.

Ces montants ne suffisent pas pour migrer. Il manque le Postgres, les fichiers R2, le SMTP, Expo, et la preuve que le Worker tient dans 128 Mo.

Conditions avant toute migration des routes :

1. Les quatre preuves réelles en PASS, sur le compte, sans `localConnectionString` et sans PDF simulé.
2. Mesure CPU et mémoire du Worker empaqueté.
3. Autorisation écrite distincte pour les 371 routes.
4. Aucun DNS modifié avant cette autorisation.
5. Migrations SQL explicites, pas le DDL de démarrage, répétées d'abord sur une copie.

## E. Gouvernance

| Contrôle | Résultat |
|---|---|
| Checks GitHub | Relevés le 29 octobre 2026, 14:10–14:12 (Europe/Paris), sur `75ea144bee19866b7a4b52b9d063c85bac2dc53b`. 8 réussites, 10 ignorés par filtre de chemins, 0 échec. Les quatre preuves Cloudflare restent `BLOCKED` |
| Production | Aucune modification de `backend/`, des bases, du DNS, des secrets réels, du RBAC canonique, de `develop` ou de `main` |
| PR #1027 | Non modifiée |
| Ressources distantes créées | aucune |
| Coût engagé | 0 USD |
| Nettoyage | Rien à détruire. La procédure est dans la section B, pour l'essai futur seulement |
| Contrôle indépendant | Encore dû. Pas de passage Ready, pas de merge |

| Check | Workflow | Résultat |
|---|---|---|
| Config préparée et preuves locales | MIG-WORKERS-CLOUD-01 | réussi |
| Express, Hyperdrive local, queue | MIG-WORKERS-POC-01 | réussi |
| Scope | PR Gates | réussi |
| Secrets | PR Gates | réussi |
| Quality | PR Gates | réussi |
| Core tests | PR Gates | réussi |
| Required | PR Gates | réussi |
| android-release-readiness | Android release readiness GO-PROD | réussi |
| Risk-targeted | PR Gates | ignoré |
| LOT 0 parity | PR Gates | ignoré |
| LOT 1 parity | PR Gates | ignoré |
| LOT 2 parity | PR Gates | ignoré |
| LOT 3 parity | PR Gates | ignoré |
| LOT 4 parity | PR Gates | ignoré |
| LOT 5 parity | PR Gates | ignoré |
| LOT 6 parity | PR Gates | ignoré |
| LOT 7 parity | PR Gates | ignoré |
| LOT 8 parity | PR Gates | ignoré |

Les jobs ignorés n'ont pas exécuté leurs suites. Les deux jobs de POC rejouent des preuves locales. Ils ne font pas passer les quatre preuves Cloudflare.

Les tests locaux déjà validés par #1027 sont rejoués par `npm test` dans `workers/mig-workers-poc-01`, avec `POC_DATABASE_URL` vers une base dont le nom contient `workers_poc`. Ils ne changent pas le statut BLOCKED des preuves Cloudflare.

---

`MIG-WORKERS-CLOUD-01 — EXPÉRIMENTATION CLOUD PRÉPARÉE / DRAFT / HOLD — EN ATTENTE DES AUTORISATIONS CTO.`
