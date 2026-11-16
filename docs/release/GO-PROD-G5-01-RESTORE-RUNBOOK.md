# GO-PROD-G5-01 — Runbook de sauvegarde et de restauration isolée PostgreSQL

| Champ | Valeur |
|---|---|
| Source | Supabase `Somafrik-prod`, project ID `loyubruyrxcaeshonkwp`, PostgreSQL 17 (déclaré par le mandat CTO, non relu par Claude) |
| Candidate | `8124d331e3ef1a39ceea150e3c96e3e65a88ce7c` |
| Retour arrière applicatif | `main@ef8bc9517ffc94aa770743713d0f561f92a9fc1e` |
| Révision | v2 (revue CTO #1165) : réseau Docker interne pour l'API de test (§3, §6) ; vérification explicite de l'empreinte du dump restauré (§2, §4) |
| Statut d'exécution | **NOT VERIFIED : procédure préparée, non exécutée.** L'environnement de Claude n'a accès ni à Supabase ni à Render (proxy réseau 403), et n'a aucun identifiant. |

> Ce runbook n'écrit **jamais** en production. La seule opération sur la source est une **lecture** : consultation du dashboard, ou `pg_dump` avec un rôle en lecture seule.
> La destination et l'API de test tournent sur un **réseau Docker interne sans sortie externe**, sans port publié, sans stockage partagé avec la production. Elles sont **distinctes de la préproduction**.
> Aucune infrastructure payante n'est créée sans autorisation CTO spécifique.

## 0. Rôles et autorisations

| Étape | Qui | Autorisation (décision CTO du 16/11/2026 sur #1165) |
|---|---|---|
| 1. Audit des sauvegardes (dashboard, lecture seule) | Détenteur de l'accès Supabase | **Autorisé** (audit en lecture seule) |
| 2. Extraction du dump logique | Idem | **Non autorisé à ce jour** : le dump contient des données personnelles d'élèves. GO CTO explicite requis |
| 3–6. Restauration et tests en base isolée | Idem, sur un poste contrôlé avec Docker | Dépend de l'étape 2 ; base locale gratuite |
| 7. Destruction de la copie | Idem | Obligatoire en fin de test |

Décisions CTO intégrées :
- `20261105_report_card_class_scope` n'est **pas** appliquée pendant le déploiement v25 (§6.4 reste un test de laboratoire facultatif) ;
- les index sur `students` et `subjects` sont **mesurés sur PostgreSQL 17** (§6.1) avant toute décision de PR corrective.

## 1. Audit des sauvegardes (lot A, lecture seule)

Dans le dashboard Supabase du projet `loyubruyrxcaeshonkwp`, section *Database → Backups*, relever sans rien modifier :

| Critère | Où le lire | Résultat attendu pour PASS |
|---|---|---|
| Plan Supabase et politique de sauvegarde applicable | *Settings → Billing* / *Database → Backups* | Politique identifiée (sauvegardes quotidiennes, PITR ou aucune) |
| Fréquence réelle | Liste des sauvegardes | Au moins une sauvegarde par 24 h |
| Date et heure de la dernière sauvegarde | Liste des sauvegardes | Moins de 24 h avant le futur déploiement |
| Rétention | Idem | Nombre de jours documenté |
| PITR activé | *Database → Backups → Point in Time* | Oui ou non, avec la fenêtre |
| Type (physique, logique, PITR) | Idem | Documenté |
| Possibilité de restauration | Bouton de restauration ou de restauration vers un nouveau projet, selon le plan | Documentée. **Ne pas cliquer** : une restauration en place écrase la production |
| Schémas non vides hors `public` | *Table editor* / *Database → Schemas* | Liste, pour confirmer le périmètre du dump (§2) |
| Santé du projet | *Project overview* | `ACTIVE_HEALTHY`. **Ce n'est pas une preuve de sauvegarde.** |

Publier ces métadonnées dans #720 (dates, rétention, type), **sans** chaîne de connexion, mot de passe ni capture contenant des données.

## 2. Sauvegarde logique indépendante (sur GO CTO uniquement)

Les sauvegardes Supabase restent chez le même fournisseur. Un `pg_dump` exporté et chiffré fournit une copie indépendante et testable.

Préconditions :
- un rôle PostgreSQL **en lecture seule** (`pg_read_all_data` ou équivalent) sur la production ;
- pas d'utilisation de `postgres` ni de `service_role` ;
- client `pg_dump` **version 17** (un client plus ancien refuse un serveur 17).

```bash
# Nom fixe pour toute la procédure. URL lue depuis un gestionnaire de secrets local, jamais versionnée.
export G5_DUMP="somafrik-prod-$(date -u +%Y%m%dT%H%MZ).dump"
```

```bash
pg_dump --format=custom --no-owner --no-privileges --schema=public --file="$G5_DUMP" "$PROD_READONLY_URL"
```

```bash
# Empreinte de référence : la valeur hexadécimale SEULE, sans nom de fichier.
sha256sum "$G5_DUMP" | cut -d' ' -f1 > "$G5_DUMP.sha256"
```

```bash
gpg --symmetric --cipher-algo AES256 --output "$G5_DUMP.gpg" "$G5_DUMP"
```

```bash
shred -u "$G5_DUMP"
```

À consigner : l'heure exacte du dump (RPO effectif de cette copie), la taille, et le contenu de `$G5_DUMP.sha256`. Une empreinte n'est pas une donnée personnelle : elle peut être publiée.

Notes :
- `--schema=public` couvre les tables applicatives. L'API Somafrik gère ses propres utilisateurs ; les schémas Supabase internes (`auth`, `storage`…) sont à confirmer comme inutilisés au §1.
- **Fichiers hors PostgreSQL :** `docs/render.md:85` et MIG-AUD-01 signalent des **disques persistants Render** (pièces jointes), non couverts par ce dump. À inventorier et sauvegarder séparément (`GO-PROD-G5-01-RENDER-RUNBOOK.md` §2).

## 3. Préparation de l'environnement isolé

Principe : un réseau Docker **`--internal`**, qui n'a aucune route vers l'extérieur. La base et l'API de test y sont attachées et se joignent par nom de conteneur. Aucun port n'est publié sur l'hôte.

Les images doivent être **construites avant**, avec accès réseau (npm, apk), puisqu'aucun téléchargement n'est possible sur le réseau interne.

```bash
docker network create --internal somafrik-g5-net
```

```bash
# Mot de passe de test généré localement, conservé uniquement dans un fichier local.
openssl rand -hex 24 > g5-db-password && chmod 600 g5-db-password
```

```bash
docker run -d --name somafrik-g5-db --network somafrik-g5-net \
  -e POSTGRES_PASSWORD="$(cat g5-db-password)" postgres:17
```

Contrôles d'isolement avant restauration, à consigner :

| Contrôle | Commande | Attendu |
|---|---|---|
| Réseau interne | `docker network inspect -f '{{.Internal}}' somafrik-g5-net` | `true` |
| Aucun port publié | `docker port somafrik-g5-db` | Vide |
| Aucune route vers l'extérieur | `docker run --rm --network somafrik-g5-net alpine:3.20 ip route` | **Aucune ligne `default`** : seule la route du sous-réseau interne |
| Résolution vers la prod impossible | `docker run --rm --network somafrik-g5-net alpine:3.20 nslookup loyubruyrxcaeshonkwp.supabase.co` | Échec |
| Version de la destination | `docker exec somafrik-g5-db psql -U postgres -Atc "select version()"` | `PostgreSQL 17.x` |
| Aucun identifiant de production dans le conteneur | `docker exec somafrik-g5-db env \| grep -i -E 'supabase\|render\|prod'` | Vide |
| Préproduction non utilisée comme destination | — | Confirmé |

(L'image `alpine:3.20` se télécharge avant, avec `docker pull alpine:3.20`.)

## 4. Restauration, vérification d'intégrité et mesure

```bash
gpg --decrypt --output /tmp/restore.dump "$G5_DUMP.gpg"
```

```bash
# Vérification EXPLICITE du fichier restauré contre l'empreinte de référence.
expected="$(cat "$G5_DUMP.sha256")"
actual="$(sha256sum /tmp/restore.dump | cut -d' ' -f1)"
echo "attendu=$expected obtenu=$actual"
[ -n "$expected" ] && [ "$expected" = "$actual" ] && echo "EMPREINTE OK" || { echo "EMPREINTE KO : arrêt"; exit 1; }
```

Arrêt obligatoire si `EMPREINTE KO`. Consigner les deux valeurs.

```bash
docker cp /tmp/restore.dump somafrik-g5-db:/tmp/restore.dump
```

```bash
time docker exec somafrik-g5-db pg_restore -U postgres -d postgres --no-owner --no-privileges --exit-on-error /tmp/restore.dump
```

Consigner : la durée (`time`, base du RTO), le code de sortie (0 exigé), les erreurs éventuelles.

## 5. Contrôles de cohérence (non sensibles)

Publier **uniquement des métadonnées et des comptes**, jamais de contenu. Les requêtes s'exécutent côté copie avec `docker exec somafrik-g5-db psql -U postgres -c '…'`, et côté production en lecture seule.

1. **Objets** : comparer les comptes du schéma `public` entre la production et la copie.
   ```sql
   select (select count(*) from pg_tables where schemaname='public') tables,
          (select count(*) from pg_indexes where schemaname='public') indexes,
          (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public') constraints,
          (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') functions,
          (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) triggers;
   ```
2. **Volumétrie** : `select relname, n_live_tup from pg_stat_user_tables order by relname;` des deux côtés, après `ANALYZE` sur la copie. Les écarts doivent rester expliqués par le délai entre dump et lecture.
3. **Schéma** : `pg_dump --schema-only` des deux côtés, puis `diff`. Attendu : aucune différence hors propriétaires et privilèges.
4. **Contraintes** : aucune contrainte restée `NOT VALID` de façon inattendue (`select conname from pg_constraint where not convalidated;`).
5. **Empreintes métier agrégées** : par exemple `select count(*), sum(amount) from payments;` et `select count(*) from grades;`. Comparer des agrégats, jamais des lignes.
6. **Instantané avant migration**, pour le §6 : conserver la sortie du point 1 et la liste `pg_indexes` / `pg_constraint` de la copie.

## 6. Répétition du déploiement et du rollback applicatif (preuve lot C)

### 6.0 Images de test (avant isolement, avec réseau)

Construire les deux images depuis des arbres Git propres, aux SHA exacts. La web n'est pas nécessaire.

```bash
git worktree add ../g5-v25 8124d331e3ef1a39ceea150e3c96e3e65a88ce7c
```

```bash
docker build -f ../g5-v25/backend/Dockerfile --build-arg SKIP_WEB_BUILD=true -t somafrik-api:g5-v25 ../g5-v25
```

```bash
git worktree add ../g5-main ef8bc9517ffc94aa770743713d0f561f92a9fc1e
```

```bash
docker build -f ../g5-main/backend/Dockerfile --build-arg SKIP_WEB_BUILD=true -t somafrik-api:g5-main ../g5-main
```

Si le build de `main` échoue, consigner l'erreur telle quelle. Le Dockerfile de `main` ne contient pas le correctif Puppeteer #1160. Ne pas corriger `main`.

### Fichier d'environnement de test

Valeurs **générées pour le test**, jamais celles de la production. L'API refuse `localhost` comme hôte de base en `NODE_ENV=production` (`backend/db/connectionConfig.js:376`) : l'hôte est donc le **nom du conteneur** sur le réseau interne.

```bash
cat > g5-test.env <<EOF
NODE_ENV=production
PORT=5000
SOMAFRIK_DB_REQUIRED=true
SOMAFRIK_SKIP_DEMO_SEED=true
DATABASE_URL=postgres://postgres:$(cat g5-db-password)@somafrik-g5-db:5432/postgres?sslmode=disable
JWT_SECRET=$(openssl rand -hex 32)
SOMAFRIK_COMMUNICATION_STORAGE=/var/lib/somafrik-g5/comm
SOMAFRIK_REPORT_CARD_SOURCE_STORAGE=/var/lib/somafrik-g5/rc
EOF
chmod 600 g5-test.env
```

- Les deux répertoires de stockage sont **obligatoires** : sans eux, `GET /api/health` répond **503 `not_ready`**. Ils **ne doivent pas être sous `/tmp`** (refus explicite de l'API). Ils correspondent aux disques persistants Render de la production. Le conteneur doit les créer avant de lancer l'API (`mkdir -p` dans la commande de démarrage, ou volume Docker).
- `gitSha` dans `/api/health` provient de `RENDER_GIT_COMMIT` (`backend/lib/deployGitSha.js`). Il reste `null` hors Render. En production, c'est un moyen de lire le commit live (`GO-PROD-G5-01-RENDER-RUNBOOK.md` §2).
- Ajouter les autres variables exigées par `backend/lib/productionSecrets.js` si le démarrage les réclame, toujours avec des valeurs de test.

### 6.1 Boot v25 : application des migrations de boot et mesure

```bash
docker run -d --name somafrik-g5-api --network somafrik-g5-net --env-file g5-test.env \
  somafrik-api:g5-v25 sh -c 'mkdir -p /var/lib/somafrik-g5/comm /var/lib/somafrik-g5/rc && exec npm start'
```

```bash
docker logs -f somafrik-g5-api
```

- Durée de `init()` : écart entre le démarrage du conteneur et la première réponse santé. C'est le temps d'application des 17 migrations de boot.
- **Mesure des index bloquants (décision CTO)** : pendant le boot, depuis une autre session, relever les verrous et leur durée.
  ```sql
  select now(), l.relation::regclass, l.mode, l.granted, a.state, now()-a.query_start as duree, left(a.query,80)
    from pg_locks l join pg_stat_activity a on a.pid=l.pid
   where l.relation::regclass::text in ('students','subjects');
  ```
  Requête à lancer en boucle (`\watch 1` dans `psql`). Consigner le mode (`ShareLock`), la durée maximale, et la volumétrie de `students` et `subjects` (§5.2).
- Santé : depuis le réseau interne, `docker run --rm --network somafrik-g5-net alpine:3.20 wget -q -O- http://somafrik-g5-api:5000/api/health`. Attendu : `database` OK.
- **Ne pas** exécuter les 4 migrations manuelles (`GO-PROD-G5-01-MIGRATIONS.md` §2).
- Après le boot : refaire le §5.1 et comparer à l'instantané §5.6. Les écarts doivent correspondre exactement aux objets des 17 migrations de boot.

### 6.2 Compte de test et smoke v25

La copie contient les vrais comptes, et leurs mots de passe ne sont pas connus. Utiliser le script existant, **sur la copie uniquement**, avec un mot de passe de test d'au moins 12 caractères :

```bash
docker exec -e SOMAFRIK_REPAIR_SUPERADMIN=true \
  -e BOOTSTRAP_SUPERADMIN_PASSWORD="$(openssl rand -base64 18)" \
  somafrik-g5-api node scripts/repair-superadmin-credentials.js
```

Ce script réécrit le mot de passe du premier `SUPER_ADMIN` de la copie. Il ne touche jamais à la production.

Smoke via un conteneur client sur `somafrik-g5-net` (curl ou wget vers `http://somafrik-g5-api:5000`) :
- login ;
- présences (appel, NFC/QR existant) ;
- notes ;
- finance (paiement couvert, flag `enforce_collection_cover`) ;
- bulletins ;
- communication.

### 6.3 Rollback applicatif vers `main`

```bash
docker rm -f somafrik-g5-api
```

```bash
docker run -d --name somafrik-g5-api --network somafrik-g5-net --env-file g5-test.env \
  somafrik-api:g5-main sh -c 'mkdir -p /var/lib/somafrik-g5/comm /var/lib/somafrik-g5/rc && exec npm start'
```

Attendu : boot OK sur la **même** base migrée, puis même smoke OK, activation d'un modèle de bulletin incluse.

### 6.4 Variante facultative (laboratoire uniquement)

Appliquer `20261105_report_card_class_scope.sql` sur la copie, puis redémarrer `main`, pour confirmer l'incompatibilité décrite dans `GO-PROD-G5-01-MIGRATIONS.md` §5.1. **Cette migration n'est pas appliquée pendant le déploiement v25** (décision CTO).

Consigner, pour 6.1 à 6.4 : les durées, les résultats et les erreurs.

## 7. Nettoyage obligatoire

```bash
docker rm -f somafrik-g5-api somafrik-g5-db
```

```bash
docker network rm somafrik-g5-net
```

```bash
shred -u /tmp/restore.dump g5-test.env g5-db-password
```

```bash
git worktree remove ../g5-v25 && git worktree remove ../g5-main
```

- Conserver le dump chiffré uniquement à l'emplacement et pour la durée décidés par le CTO. **Aucun dump dans GitHub, dans une issue ou dans un artefact CI.**
- Supprimer les images de test (`docker image rm somafrik-api:g5-v25 somafrik-api:g5-main`) si elles ne sont plus utiles.
- Révoquer le rôle en lecture seule s'il a été créé pour ce test. Ne laisser aucun accès temporaire ouvert.

## 8. Critères PASS (lot B)

| Critère | Statut actuel |
|---|---|
| Sauvegarde récupérée et empreinte vérifiée (§4) | NOT VERIFIED |
| Restauration terminée sans erreur | NOT VERIFIED |
| Schémas et objets attendus présents | NOT VERIFIED |
| Contrôles de cohérence réussis | NOT VERIFIED |
| Connexion applicative de test possible (§6.1) | NOT VERIFIED |
| Durée de restauration mesurée (RTO) | NOT VERIFIED |
| Index `students` / `subjects` mesurés sur PG 17 | NOT VERIFIED |
| Rollback applicatif `main` prouvé (§6.3) | NOT VERIFIED |
| Résultat documenté et reproductible | Procédure documentée ici ; exécution NOT VERIFIED |

## 9. Validation à blanc réalisée par Claude (16/11/2026, base vide)

But : prouver que la procédure est **exécutable**, sans aucune donnée de production. Exécutée dans le conteneur cloud de Claude, avec un daemon Docker local. Aucun accès à Supabase ni à Render. Tout a été supprimé ensuite (§7).

| Étape | Résultat | Remarque |
|---|---|---|
| §3 réseau `--internal`, `postgres:17` | **OK** : `Internal=true`, aucun port publié, `ip route` sans `default`, DNS vers `loyubruyrxcaeshonkwp.supabase.co` en `SERVFAIL`, TCP sortant vers `1.1.1.1:443` refusé, `PostgreSQL 17.12`, aucun identifiant de production dans le conteneur | Isolement vérifié |
| §2/§4 empreinte | **OK** sur un fichier factice : identique → `EMPREINTE OK` ; altéré d'un octet → `EMPREINTE KO` ; empreinte vide → `EMPREINTE KO` | Logique de comparaison vérifiée |
| §6.0 build des images | **Non validé ici** : `apk add` échoue dans le build, car le proxy TLS du conteneur de Claude n'est pas reconnu. Le Dockerfile n'a pas été modifié | Étape propre à l'environnement de Claude ; à exécuter sur le poste de test |
| §6.1 boot v25 (équivalent) | **OK** : source exacte `8124d331`, image `node:22.12-alpine` (base du Dockerfile), `NODE_ENV=production`, connexion par nom de conteneur sur le réseau interne. `init()` sur PostgreSQL 17 en environ **3,2 s sur base vide**. `GET /api/health` → `status: ok` une fois les deux stockages configurés | Les 17 migrations de boot passent sur PG 17 **à vide**. Les objets attendus sont présents (`student_access_cards`, `attendance_roll_calls`, `school_entry_events`, `student_card_batches*`, `students_school_id_id_uidx`, `uq_subjects_school_id_id`, `trg_payments_collection_covered`, `trg_subjects_hierarchy`). Les 3 tables des migrations manuelles sont **absentes**, comme attendu |
| §6.3 rollback applicatif `main@ef8bc95` sur ce schéma | **OK à vide** : boot sans erreur, `status: ok` | Première preuve d'exécution, au niveau schéma seulement, **sans données** |
| §6.4 labo `20261105_report_card_class_scope` | **Incompatibilité confirmée à l'exécution** : l'`INSERT … ON CONFLICT (school_id, model_key)` de `main` est accepté avant la migration. Après : `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`. Sur base vide, `main` redémarre et recrée `uq_report_card_configuration_one_active` | L'échec du boot de `main` reste **conditionnel aux données** (ACTIVE établissement + ACTIVE classe pour un même modèle) ; non reproduit |

Ce que cette validation **ne prouve pas** : restauration d'une vraie sauvegarde, volumétrie, durée des index sur `students` et `subjects` avec des données réelles, smoke fonctionnel, RTO. Le lot B reste **NOT VERIFIED**.
