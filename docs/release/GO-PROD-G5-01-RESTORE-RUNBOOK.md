# GO-PROD-G5-01 — Runbook de sauvegarde et de restauration isolée PostgreSQL

| Champ | Valeur |
|---|---|
| Source | Supabase `Somafrik-prod`, project ID `loyubruyrxcaeshonkwp`, PostgreSQL 17 (déclaré par le mandat CTO, non relu par Claude) |
| Candidate | `8124d331e3ef1a39ceea150e3c96e3e65a88ce7c` |
| Retour arrière applicatif | `main@ef8bc9517ffc94aa770743713d0f561f92a9fc1e` |
| Statut d'exécution | **NOT VERIFIED : procédure préparée, non exécutée.** L'environnement de Claude n'a accès ni à Supabase ni à Render (proxy réseau 403), et n'a aucun identifiant. |

> Ce runbook n'écrit **jamais** en production. La seule opération sur la source est une **lecture** : consultation du dashboard, ou `pg_dump` avec un rôle en lecture seule.
> La destination est une base jetable, **sans aucun lien réseau ni stockage partagé avec la production**, et **distincte de la préproduction**.
> Aucune infrastructure payante n'est créée sans autorisation CTO spécifique.

## 0. Rôles et autorisations

| Étape | Qui | Autorisation requise |
|---|---|---|
| 1. Audit des sauvegardes (dashboard, lecture seule) | Détenteur de l'accès Supabase | Mandat GO-PROD-G5-01 (déjà donné) |
| 2. Extraction du dump logique (lecture seule) | Idem | **GO CTO explicite** : le dump contient des données personnelles d'élèves |
| 3–6. Restauration et tests en base isolée | Idem, sur un poste ou un conteneur contrôlé | GO CTO ; base locale gratuite (Docker) de préférence |
| 7. Destruction de la copie | Idem | Obligatoire en fin de test |

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
| Santé du projet | *Project overview* | `ACTIVE_HEALTHY`. **Ce n'est pas une preuve de sauvegarde.** |

Publier ces métadonnées dans #720 (dates, rétention, type), **sans** chaîne de connexion, mot de passe ni capture contenant des données.

## 2. Sauvegarde logique indépendante (recommandée avant tout merge)

Les sauvegardes Supabase restent chez le même fournisseur. Un `pg_dump` exporté et chiffré fournit une copie indépendante et testable.

Préconditions :
- un rôle PostgreSQL **en lecture seule** (`pg_read_all_data` ou équivalent) sur la production ;
- pas d'utilisation de `postgres` ni de `service_role` ;
- client `pg_dump` **version 17** (un client plus ancien refuse un serveur 17).

```bash
# Les variables sont lues depuis un gestionnaire de secrets local, jamais tapées en clair ni versionnées.
pg_dump --format=custom --no-owner --no-privileges \
  --schema=public --file=somafrik-prod-$(date -u +%Y%m%dT%H%MZ).dump \
  "$PROD_READONLY_URL"
```

```bash
sha256sum somafrik-prod-*.dump > somafrik-prod.dump.sha256
```

```bash
gpg --symmetric --cipher-algo AES256 somafrik-prod-*.dump
```

```bash
shred -u somafrik-prod-*.dump
```

Notes :
- `--schema=public` correspond aux tables applicatives. Les schémas Supabase internes (`auth`, `storage`, etc.) ne sont pas utilisés par l'API Somafrik, qui gère ses propres utilisateurs. **À confirmer** au §1 en listant les schémas non vides.
- **Fichiers hors PostgreSQL :** `docs/render.md:85` et MIG-AUD-01 signalent des **disques persistants Render** (pièces jointes). Ils ne sont pas couverts par une sauvegarde PostgreSQL. À inventorier et sauvegarder séparément (lot D).
- Relever l'heure exacte du dump : c'est le RPO effectif de cette copie.

## 3. Préparation de la destination isolée

Option gratuite recommandée : un conteneur local PostgreSQL **17**, sans port publié vers l'extérieur.

```bash
docker run -d --name somafrik-g5-restore --network none \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" postgres:17
```

Contrôles d'identité avant restauration, à consigner dans le rapport :

| Contrôle | Commande | Attendu |
|---|---|---|
| Destination ≠ production | `docker exec somafrik-g5-restore psql -U postgres -Atc "select inet_server_addr(), current_database(), version()"` | Adresse locale ou NULL, `PostgreSQL 17.x` |
| Aucune connexion vers la prod possible depuis la destination | `--network none` | Aucune interface réseau hors loopback |
| Aucun identifiant de production dans l'environnement du conteneur | `docker exec somafrik-g5-restore env \| grep -i -E 'supabase\|render\|prod'` | Vide |
| Préproduction non utilisée comme destination | — | Confirmé |

## 4. Restauration et mesure

```bash
gpg --decrypt somafrik-prod-*.dump.gpg > /tmp/restore.dump && sha256sum -c somafrik-prod.dump.sha256
```

```bash
docker cp /tmp/restore.dump somafrik-g5-restore:/tmp/restore.dump
```

```bash
time docker exec somafrik-g5-restore pg_restore -U postgres -d postgres --no-owner --no-privileges --exit-on-error /tmp/restore.dump
```

Consigner : la durée (`time`), le code de sortie (0 exigé), les erreurs éventuelles.

## 5. Contrôles de cohérence (non sensibles)

Publier **uniquement des métadonnées et des comptes**, jamais de contenu.

1. **Objets** : comparer `count` des tables, index, contraintes, fonctions et triggers du schéma `public` entre la production (lecture seule) et la copie.
   ```sql
   select (select count(*) from pg_tables where schemaname='public') tables,
          (select count(*) from pg_indexes where schemaname='public') indexes,
          (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public') constraints,
          (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') functions,
          (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) triggers;
   ```
2. **Volumétrie** : `select relname, n_live_tup from pg_stat_user_tables order by relname;` des deux côtés, après `ANALYZE` sur la copie. Les écarts doivent rester expliqués par le délai entre dump et lecture.
3. **Schéma** : `pg_dump --schema-only` des deux côtés, puis `diff`. Attendu : aucune différence hors propriétaires et privilèges.
4. **Contraintes** : vérifier qu'aucune contrainte n'est restée `NOT VALID` de façon inattendue (`select conname from pg_constraint where not convalidated;`).
5. **Empreintes métier agrégées** : par exemple `select count(*), sum(amount) from payments;` et `select count(*) from grades;`. Comparer des agrégats, jamais des lignes.

## 6. Répétition du déploiement et du rollback applicatif (preuve lot C)

Sur la **copie restaurée** uniquement, depuis un poste qui n'a aucun accès à la production :

1. **Boot v25** : démarrer l'API au SHA `8124d331` avec `NODE_ENV=production`, `SOMAFRIK_DB_REQUIRED=true`, `SOMAFRIK_SKIP_DEMO_SEED=true` et une `DATABASE_URL` pointant vers la copie. Secrets JWT et autres **générés pour le test**, jamais ceux de la production.
   - Mesurer la durée de `init()` : c'est le temps d'application des 17 migrations de boot, index sur `students` et `subjects` inclus.
   - Attendu : `GET /api/health` → `database` OK. Aucune erreur de contrainte.
   - **Ne pas** exécuter les 4 migrations manuelles (`GO-PROD-G5-01-MIGRATIONS.md` §2).
2. **Smoke v25** avec un compte de test créé sur la copie : login, présences (appel et NFC/QR existant), notes, finance (paiement couvert, flag `enforce_collection_cover`), bulletins, communication.
3. **Rollback applicatif** : arrêter v25 et démarrer `main@ef8bc95` sur la **même** base migrée. Attendu : boot OK, même smoke OK.
4. **Variante facultative** : appliquer `20261105_report_card_class_scope.sql`, puis redémarrer `main`, pour confirmer l'incompatibilité décrite dans `GO-PROD-G5-01-MIGRATIONS.md` §5.1.
5. Consigner les durées, les résultats et les erreurs.

## 7. Nettoyage obligatoire

```bash
docker rm -f somafrik-g5-restore
```

```bash
shred -u /tmp/restore.dump
```

- Conserver le dump chiffré uniquement à l'emplacement et pour la durée décidés par le CTO. **Aucun dump dans GitHub, dans une issue ou dans un artefact CI.**
- Révoquer le rôle en lecture seule s'il a été créé pour ce test. Ne laisser aucun accès temporaire ouvert.

## 8. Critères PASS (lot B)

| Critère | Statut actuel |
|---|---|
| Sauvegarde récupérée | NOT VERIFIED |
| Restauration terminée sans erreur | NOT VERIFIED |
| Schémas et objets attendus présents | NOT VERIFIED |
| Contrôles de cohérence réussis | NOT VERIFIED |
| Connexion applicative de test possible | NOT VERIFIED |
| Durée de restauration mesurée (RTO) | NOT VERIFIED |
| Résultat documenté et reproductible | Procédure documentée ici ; exécution NOT VERIFIED |
