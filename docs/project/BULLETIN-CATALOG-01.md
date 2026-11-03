# BULLETIN-CATALOG-01 — catalogue de bulletins par pays et refonte UI/UX

Statut : **Draft / HOLD — aucun Ready, merge ou déploiement sans validation CTO.**
Base : `develop` @ `4d6114b1` (inclut #1050, notes en échec).

## 1. Décisions appliquées (rectificatif CTO)

| Exigence | Réalisation |
|---|---|
| La Colombière / Le Berceau = références pédagogiques, pas des copies | Deux modèles modernes construits sur leurs **caractéristiques structurelles** documentées : `colombiere` (matières simples) et `berceau` (matières principales + sous-matières, sous-totaux). Aucun logo, en-tête ni mise en page reproduits. |
| Matières simples vs sous-matières | `colombiere` refuse toute sous-matière (`SUB_SUBJECT_NOT_ALLOWED`) ; `berceau` accepte matières simples et sous-matières, la matière principale n'est jamais saisissable (`SUBJECT_IS_MAIN_SUBJECT`), son sous-total est calculé par le moteur. |
| TJ/EX et maxima, **sans imposer TJ/EX** | Structure choisie par l'établissement : « TJ et EX » ou « Note unique par période » (`NP`). Une matière peut n'avoir que le TJ. Maxima 0 < max ≤ 1000 par composante. Composante hors structure : refus explicite (jamais ignorée). |
| Présentation Web et PDF professionnelle | Même composant de présentation que les bulletins publiés (Web) et même gabarit PDF. Ajout du bloc de signatures dans la présentation Web (parité avec le PDF). Intitulés de périodes et de composantes portés par le gabarit. |
| Notes en échec rouges et soulignées (#1050) | Inchangé ; visible dans les aperçus du catalogue (calculés par le moteur sur des notes fictives). |
| Superadmin : visibilité par pays | Page **Paramètres → Catalogue des bulletins** (`/parametres/bulletins-catalogue`). |
| Établissement : choisir et configurer un modèle autorisé | **Pédagogie → Bulletins → Configurer un bulletin** (`/bulletins/modele`) : galerie + assistant en 5 étapes. |
| Retirer l'éditeur Superadmin de l'UI | Cartes « Documents » (GrapesJS) et « Configuration bulletins » (éditeur JSON) retirées du hub ; routes `/parametres/documents`, `/parametres/bulletins-configuration` et `/conception-bulletins` redirigées vers le catalogue. Les fichiers des anciennes pages restent dans le dépôt (non routés) : suppression à décider séparément. |
| Moteur, permissions, snapshots, PDF historiques préservés | Aucune modification de `reportCardEngine`, des permissions ni des snapshots. Le bloc `presentation` reste optionnel : gabarits existants et empreintes inchangés. |
| Migration jamais exécutée au démarrage | `backend/db/postgresRepository.js` est **identique à `develop`** ; un test le vérifie (`reportCardCatalog.test.js`). Les tests PostgreSQL et l'E2E appliquent la migration **explicitement** dans leur base jetable. |

## 2. Architecture

- **Catalogue** (`backend/lib/reportCard/reportCardCatalog.js`) : modèles connus du code (`MODEL_DEFINITIONS`), disponibilité par pays, construction du profil/schéma/gabarit à partir de l'assistant (`buildConfiguration`), aperçus calculés par le **moteur canonique** puis l'adaptateur de présentation réel (`official: false`).
- **Configuration** : passe par le service LOT 6 existant (seule autorité) — demande `CONFIGURING` limitée aux clés `catalog-<modèle>`, gel du profil/schéma/gabarit versionnés, `validateBundle`, liaison, activation, audit. Activation = même chemin que l'activation existante.
- **Pays** : toujours `schools.country_id` côté serveur, jamais transmis par le navigateur. Pays inconnu ⇒ aucun modèle (`reason: COUNTRY_UNKNOWN`).
- **Fail-closed** : aucune ligne de disponibilité = non disponible ; tables absentes (migration non appliquée) ⇒ `503 CATALOG_UNAVAILABLE`, jamais une liste vide trompeuse.
- **Désactivation dans un pays** : bloque uniquement les nouvelles configurations et modifications. Configurations actives, liaisons, bulletins publiés, PDF et QR restent valides (testé : snapshot publié identique octet pour octet). Le modèle reste visible pour l'établissement qui l'utilise, marqué « Non disponible ».

### Routes HTTP (8)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/report-card/catalog/admin` | Superadmin : modèles, aperçus, disponibilité, pays |
| PUT | `/api/report-card/catalog/admin/models/:modelId/countries/:countryId` | Superadmin : disponibilité (`confirm: true` obligatoire) |
| GET | `/api/report-card/catalog/admin/audit?modelId=` | Superadmin : historique |
| GET | `/api/report-card/catalog` | Établissement : modèles autorisés dans son pays |
| GET | `/api/report-card/catalog/models/:modelId/configuration` | Admin établissement : contexte de l'assistant |
| POST | `/api/report-card/catalog/models/:modelId/preview` | Admin établissement : aperçu (aucune écriture) |
| PUT | `/api/report-card/catalog/models/:modelId/configuration` | Admin établissement : enregistrer (non activé) |
| POST | `/api/report-card/catalog/models/:modelId/activate` | Admin établissement : activer (`confirm: true`) |

Droits : Superadmin = `REPORT_CARD_CONFIGURE` (contexte plateforme) — aucun accès aux routes école, élèves, notes, bulletins. Admin établissement = `REPORT_CARD_SCHOOL_APPROVE_TEMPLATE` (Bulletins:UPDATE) — aucun accès aux routes nationales. Enseignant : lecture du catalogue seulement. Parent : refusé. Inventaire MONO-T1 régénéré (382 routes).

## 3. Migration

Fichier : `backend/db/migrations/20261104_report_card_catalog.sql` (+ `.rollback.sql`). Additive, idempotente (vérifiée deux fois de suite), trois tables nouvelles, aucune table existante modifiée :

- `report_card_catalog_models` (identifiant, version, nom, description, style, statut `active|retired`) — amorçage `colombiere` et `berceau` (`ON CONFLICT DO NOTHING`) ;
- `report_card_catalog_availability` (modèle × `countries.id`, disponible, auteur, date) ;
- `report_card_catalog_availability_audit` (modèle, pays, ancienne valeur, nouvelle valeur, auteur, date) — jamais modifiée par l'application.

## 4. Procédure de configuration (après validation CTO)

1. Appliquer la migration **manuellement** sur l'environnement cible (fenêtre validée) :
   `psql "$DATABASE_URL" -f backend/db/migrations/20261104_report_card_catalog.sql`
2. Superadmin : Paramètres → Catalogue des bulletins → « Gérer la disponibilité » → rendre le modèle disponible pour le pays → confirmer.
3. Admin établissement du pays : Pédagogie → Bulletins → « Configurer un bulletin » → « Choisir ce modèle » → assistant → « Enregistrer » → « Activer ce bulletin » → confirmer.
4. Gestion des bulletins : choisir le modèle `catalog-<modèle>` → aperçu → publication (parcours existant inchangé).

## 5. Retour arrière

- **Retirer un modèle d'un pays** (UI Superadmin) : nouvelles configurations bloquées, rien d'existant n'est révoqué.
- **Retrait complet du catalogue** : `psql "$DATABASE_URL" -f backend/db/migrations/20261104_report_card_catalog.rollback.sql` — supprime les trois tables seulement. Profils, gabarits, liaisons actives et snapshots publiés restent valides ; le catalogue répond alors `503 CATALOG_UNAVAILABLE` (aucun modèle proposé).
- **Code** : revert de la PR ; aucune donnée existante n'est migrée ni transformée.

## 6. Tests

| Suite | Résultat local |
|---|---|
| `backend/lib/reportCard/reportCardCatalog.test.js` (structures, erreurs par champ, aperçus, fail-closed, permissions, migration hors démarrage) | 7/7 |
| `backend/lib/reportCard/reportCardCatalog01.http.pg.test.js` (PostgreSQL + HTTP réels : migration explicite, fail-closed, pays inconnu, confirmation, audit, rôles refusés, Superadmin hors parcours école, pays par établissement, erreurs par champ, enregistrer ≠ activer, publication sur la configuration du catalogue avec notes en échec, désactivation sans révocation, snapshot inchangé, note unique, isolation entre établissements) | 9/9 |
| Suites bulletins backend (LOT 0 → 11, contrats, HTTP, PostgreSQL) | 411/411 |
| Web (Vitest, toutes suites) dont `ReportCardCatalog.test.tsx` (13 cas : galerie, filtres, confirmation, historique, états chargement/erreur/refus/vide/503, pays inconnu, lecture seule, assistant, note unique, parcours complet, erreurs serveur par champ, activation refusée, sortie sans perte) | 1787/1787 |
| E2E Playwright réel `verify-report-card-s1-e2e.js` (refondu : disponibilité Superadmin, configuration école, RBAC secrétaire, autre pays + isolation) | 4/4 |
| Garde MONO-T1, couverture aide, garde S1, ESLint (0 erreur), `tsc` | OK |

## 7. Captures (bureau 1440×900, tablette 820×1180) — `docs/project/bulletin-catalog-01/`

01 galerie Superadmin · 02 voir le modèle · 03 confirmation de disponibilité · 04 disponibilité + historique · 05 galerie école · 06 structure · 07 matières et maxima · 08 erreurs près des champs · 09 calcul des notes · 10 aperçu (notes en échec, signatures) · 11 enregistré non activé · 12 confirmation d'activation · 13 modèle actif · 14 autre pays : aucun modèle · 15 erreur + Réessayer · 16 pays non reconnu · 17 accès refusé · 18 catalogue non installé · 19 modification d'une configuration active · 20 lecture seule · 21 erreur Superadmin.
Les captures 01–14 viennent de l'E2E réel ; 15–21 du même parcours avec réponses d'API simulées pour forcer l'état (preuve visuelle uniquement, script non conservé).

## 8. Risques résiduels

1. **Classes** : la configuration s'applique à tout l'établissement (liaison par modèle). Le choix par classe « si le contrat le permet » n'est pas implémenté : aucune règle contractuelle de ce type n'existe dans le code.
2. **Anciennes pages** (`ReportCardSuperadminWorkflowPage`, `BulletinDesignPage`, `ReportCardSchoolWorkflowPage`) conservées non routées, ainsi que leurs routes API (demandes, artefacts source) : suppression à décider (impact sur les demandes existantes).
3. **Migration manuelle** : tant qu'elle n'est pas appliquée, le catalogue répond 503 ; l'UI affiche « Le catalogue des bulletins n'est pas encore installé ».
4. **Modèles définis dans le code** : ajouter un modèle demande du code (`MODEL_DEFINITIONS`) **et** une ligne en base ; une ligne sans définition est ignorée (fail-closed).
5. **E2E local** : le navigateur Playwright n'est pas téléchargeable dans le bac à sable ; exécution avec `SOMAFRIK_CHROMIUM_PATH` (variable optionnelle, sans effet en CI).
