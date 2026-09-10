# Scolarité L0 — matrice de parité Web ↔ Mobile

**Base :** `develop@193c5df3e7b3049bb02f70d53106b0889f95fd0d`  
**Branche :** `cursor/schooling-web-mobile-parity-53ab`  
**Lot :** Scolarité principale → Classes → Élèves / inscriptions  
**Règle :** même établissement + même PostgreSQL + même utilisateur = mêmes données métier. Pas de copie pixel Web.

## Inventaire (audit, sans invention métier)

| Fonction | Web | Mobile | API canonique | Données identiques ? | Action L0 |
| --- | --- | --- | --- | --- | --- |
| Hub / synthèse | `/etablissement/vue-ensemble` (`scopedClasses` + synthèse `CLASS-${nom}` + dédup nom) | Accueil KPI Classes (`rows.length \|\| unique className`) | `GET /classes`, `GET /students`, `GET /v2/academic-years` | Non | Aligner KPI sur listes canoniques + année active |
| Année scolaire active | Paramètres `/parametres/annee-scolaire` ; absente du hub | `SchoolYearSettings` ; absente des listes Classes/Élèves | `GET /v2/academic-years` | Partielle | Afficher l’année active sur le hub |
| Liste des classes | `ClassesListPage` → `GET /classes` | `ClassesScreen` → `GET /classes` (+ L1 hors-ligne) + synthèse `CLASS-` | `GET /api/classes` | Non (synthèse Mobile / dédup Web hub) | Filtrer les classes canoniques uniquement |
| Effectif d’une classe | champ `students` API + lien élèves | comptage élèves filtrés par identité | `GET /classes` + `GET /classes/:code/students` | Oui en ligne si pas de synthèse | Conserver l’API ; retirer les fausses classes |
| Liste des élèves | `StudentsListPage` DataContext → `GET /students` | `StudentsScreen` → `GET /students` (+ L1 hors-ligne) | `GET /api/students` | Oui source ; statuts/année incomplets Web | Afficher classe + statut + année |
| Inscription dans une classe | `ClassStudentsPage` `POST /classes/:code/students` | `enrollClassStudent` même endpoint | `POST /api/classes/:code/students` | Oui | UX + navigation ; pas de nouvel endpoint |
| Fiche élève | `StudentWorkspacePage` `GET /students/:id` | `StudentDetailScreen` | `GET /api/students/:id` | Oui | Hors lot UI fiche (déjà existante) |
| Structure pédagogique | `/parametres/structure` | `SchoolPedagogicalStructure` | catalog + school-activation | Oui | Lien depuis le hub |
| Transfert / validate / close inscription | domaine C18 Web (repo local) | absent | pas d’endpoint REST dédié | Non | **Reporté** — pas inventer l’API |
| Référentiels pays (niveaux/filières) | `/referentiels-pedagogiques` | absent (activation école seulement) | backoffice education-* | N/A (Web plateforme) | Hors lot établissement |
| L1 Mobile classes/élèves | n/a | SQLite projection jetable si offline | `GET /mobile-sync/l1/*` | Hors-ligne seulement | Conservé ; en ligne = GET métier |

## Lot retenu (maîtrisable)

| ID | Fonction | Web | Mobile | Donnée canonique | UX maquette |
| --- | --- | --- | --- | --- | --- |
| SCO-01 | Compteur Classes = `GET /classes` sans synthèse / dédup nom | Vue d’ensemble | Accueil + liste Classes | `classCode` PostgreSQL | Indicateur Classes |
| SCO-02 | Hub titre `Scolarité` + année active | Vue d’ensemble | `SchoolingHubScreen` | `isCurrent` academic-years | En-tête |
| SCO-03 | Actions Classes / Élèves / Inscriptions / Année / Structure | Vue d’ensemble | Hub Mobile | routes existantes | Actions principales |
| SCO-04 | Liste Classes : libellés FR, lien structure réel, vide explicite | `ClassesListPage` | cartes Classes | `GET /classes` | Cartes vs table |
| SCO-05 | Liste Élèves : classe + statut + année | `StudentsListPage` | cartes Élèves | `GET /students` | Lignes tactiles |
| SCO-06 | 403 ≠ liste vide ; année absente ≠ succès | hub + listes | hub + listes | RBAC inchangé | États UX |

## Après L0 (GREEN)

| ID | Web | Mobile | Données identiques ? |
| --- | --- | --- | --- |
| SCO-01 Classes | `filterCanonicalClasses(state.classes)` | Accueil + liste : `filterCanonicalClasses` | Oui (GET /classes, sans CLASS-) |
| SCO-02 Hub + année | titre Scolarité + `academicYearsApi` | `SchoolingHubScreen` + `listAcademicYears` | Oui (`isCurrent`) |
| SCO-03 Actions | Classes / Élèves / Inscriptions / Structure / Année | mêmes labels et mêmes destinations métier | Oui |
| SCO-04 Liste classes | table FR + `/parametres/structure` | cartes + statut FR | Oui source |
| SCO-05 Élèves | classe + statut + année | classe + statut (année sur fiche) | Oui source GET /students |
| SCO-06 États | 403 / erreur / vide / année absente explicites | idem | Oui fail-closed |

## Reportés volontairement

| Sujet | Pourquoi |
| --- | --- |
| Transfert / validation / clôture C18 | Pas d’API REST canonique ; repo local Web uniquement |
| Référentiels pédagogiques pays | Surface Superadmin / Admin Pays, pas établissement |
| Suppression du L1 Mobile | Hors-ligne légitime ; en ligne déjà `fetchNetwork` GET métier |
| `scopedClasses` planning / notes / EntityPage | Hors module Scolarité ; ne pas casser Pédagogie |
| Enseignants CRUD / comptes / parents | Conservés comme tuiles secondaires, pas refondus |

## Legacy documenté (Scolarité)

| Mécanisme | Rôle dans l’écart | Décision L0 |
| --- | --- | --- |
| `scopedClasses` synthèse `CLASS-${nom}` + `dedupeClassesByName` | Hub Web ≠ liste Classes | Ne plus l’utiliser pour les KPI Scolarité |
| Home Mobile `rows.length \|\| unique className` | KPI Accueil ≠ liste Classes | Supprimer le fallback |
| `scopedClassesForSession` synthèse | Liste Mobile peut afficher une classe fantôme | Filtrer les enregistrements canoniques sur Classes |
| DataContext élèves | Même `GET /students` que l’annuaire | Conservé (une vérité Web élèves) |
| L1 SQLite | Vérité parallèle seulement offline | Conservé ; pas de fallback online qui masque une erreur PG |
| EntityPage students / PUT state | Déjà redirigé / strippé | Pas touché |
