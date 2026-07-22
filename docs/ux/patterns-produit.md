# Patterns Produit Somafrik

**Statut :** normatif (introduit D1.3 — sous réserve validation CTO)  
**Usage :** bibliothèque de référence pour concevoir et revoir les pages métier  
**Référence :** [Architecture des pages métier](./architecture-pages-metier.md) · [Décisions](./decisions-officielles.md)

## Intention

Lorsqu’un développeur ou un designer crée une fonctionnalité, il déclare :

> Cette page suit le Pattern **P-00X**.

Objectif : expérience homogène, moins de divergences entre équipes, accélération des développements.

Toute PR UI qui crée ou refond une page métier doit citer le Pattern utilisé (DO-032).  
Tout nouveau Pattern nécessite une décision DO et une mise à jour de ce catalogue.

---

## Catalogue

### P-001 — Résumé métier

| Attribut | Valeur |
|----------|--------|
| **Type** | Bloc obligatoire de Fiche |
| **Objectif** | Comprendre l’état, les problèmes, la prochaine action en quelques secondes |
| **Contient** | Statuts, contexte, alertes, KPI vivants, interprétation, actions recommandées |
| **Ne contient pas** | Formulaire, table complète, actions destructives non confirmées |
| **DO** | DO-001, DO-006, DO-007, DO-008, DO-028 |
| **Réf. audit** | Amorcé sur overview / header élève |

---

### P-002 — Liste + Filtres + Tableau

| Attribut | Valeur |
|----------|--------|
| **Type** | Page Liste |
| **Objectif** | Parcourir une collection, filtrer, ouvrir / créer |
| **Contient** | Titre, description, KPI optionnels, recherche, filtres, actions, tableau, pagination, états |
| **Ne contient pas** | Workspace complet d’une entité |
| **DO** | DO-027, DO-029, DO-031 |
| **Réf. audit** | `EntityPage`, Users, Schools, Fees, Unpaid |

---

### P-003 — Fiche avec onglets

| Attribut | Valeur |
|----------|--------|
| **Type** | Page Fiche / workspace |
| **Objectif** | Travailler une entité dans la durée |
| **Contient** | Orientation, header, **P-001**, alertes, actions, onglets URL, sections, historique recommandé |
| **Ne contient pas** | CRUD collection principale (sauf sous-listes contextuelles) |
| **DO** | DO-014, DO-015, DO-024, DO-026, DO-028 |
| **Réf. audit** | Dossier élève (seule référence complète aujourd’hui) |

---

### P-004 — Tableau de bord opérationnel

| Attribut | Valeur |
|----------|--------|
| **Type** | Dashboard |
| **Objectif** | Prioriser le travail du jour |
| **Contient** | Compteurs / signaux, alertes, accès rapides vers listes / outils |
| **Ne contient pas** | Formulaire métier principal, table CRUD complète |
| **DO** | DO-007, DO-008, règles Dashboard D1.3 §4 |
| **Réf. audit** | `EtablissementOverviewPage` |

---

### P-005 — Tableau de bord analytique

| Attribut | Valeur |
|----------|--------|
| **Type** | Dashboard |
| **Objectif** | Pilotage par tendances et graphiques |
| **Contient** | Graphiques, filtres de période si pertinents, liens vers drill-down |
| **Ne contient pas** | Saisie opérationnelle dense |
| **DO** | Règles Dashboard D1.3 §4 |
| **Réf. audit** | `OverviewPage` |

---

### P-006 — Hub de paramétrage

| Attribut | Valeur |
|----------|--------|
| **Type** | Hub |
| **Objectif** | Orienter vers des domaines de configuration stables |
| **Contient** | Cartes / entrées vers pages filles ; retour hub |
| **Ne contient pas** | Opérations quotidiennes (élèves, notes, paiements) |
| **DO** | DO-018 (séparation modules), D1.2 pattern hub |
| **Réf. audit** | `SettingsHubPage` / `ParametresLayout` |

---

### P-007 — Outil opérationnel

| Attribut | Valeur |
|----------|--------|
| **Type** | Outil |
| **Objectif** | Exécuter une tâche répétitive ou dense |
| **Contient** | Contexte (classe, date…), zone de travail, action primaire claire, états |
| **Ne contient pas** | Navigation secondaire parasite ; résumé de fiche complet |
| **DO** | DO-002, DO-006, DO-023 |
| **Réf. audit** | Présences, Notes, Planning calendrier |

---

### P-008 — Assistant de création

| Attribut | Valeur |
|----------|--------|
| **Type** | Assistant (wizard) |
| **Objectif** | Guider un flux multi-étapes avec validation progressive |
| **Contient** | Étapes visibles, progression, récapitulatif, actions Suivant / Retour / Confirmer |
| **Ne contient pas** | Tout le flux dans une seule Modal opaque |
| **DO** | DO-025 (type Assistant), DO-024 (contexte), DO-003 si étape destructive |
| **Réf. audit** | **Absent** aujourd’hui — pattern cible |

**Quand l’exiger :** ≥ 3 étapes dépendantes (ex. création établissement, inscription complète, souscription complexe).

---

### P-009 — Consultation légère (Modal)

| Attribut | Valeur |
|----------|--------|
| **Type** | Consultation / édition courte |
| **Objectif** | Voir ou éditer un ensemble limité sans quitter la Liste |
| **Contient** | Titre, champs essentiels, actions Enregistrer / Fermer |
| **Ne contient pas** | Multi-onglets, historique long, résumé métier complet |
| **DO** | DO-030 |
| **Réf. audit** | Modals CRUD EntityPage / Users / Schools |

Si le besoin dépasse P-009 → basculer vers **P-003**.

---

### P-010 — Rapport

| Attribut | Valeur |
|----------|--------|
| **Type** | Rapport |
| **Objectif** | Synthèse analytique ou conformité, souvent exportable |
| **Contient** | Filtres de période / périmètre, indicateurs, tableaux de synthèse, export |
| **Ne contient pas** | CRUD opérationnel principal |
| **DO** | DO-007, DO-023 |
| **Réf. audit** | `ReportsPage`, `SubscriptionReportsPage` |

---

## Matrice Type de page → Pattern(s)

| Type de page | Pattern(s) typiques |
|--------------|---------------------|
| Dashboard | P-004, P-005 |
| Liste | P-002 (+ P-009 pour détail léger) |
| Fiche | P-003 + P-001 |
| Outil | P-007 |
| Hub | P-006 |
| Formulaire | Page dédiée (peut précéder P-008) |
| Assistant | P-008 |
| Rapport | P-010 |
| Consultation | P-009 ou lecture dans P-003 |
| Placeholder | Hors pattern métier (état Coming soon) |

---

## Règles de gouvernance

1. **Citation obligatoire** dans la PR : `Pattern: P-00X` (DO-032).
2. **Pas de Pattern fantôme** : si aucun ne convient, proposer un amendement D (doc) avant d’inventer une UI.
3. **Composition autorisée** : une Fiche = P-003 + P-001 ; une Liste peut ouvrir P-009.
4. **Évolution** : nouveau Pattern = mise à jour de ce fichier + DO associée + validation CTO.
5. **Revue** : « Conforme à P-002 / DO-027 » ou « Non conforme à P-001 ».

---

## Journal

| ID | Titre | Introduit |
|----|-------|-----------|
| P-001 | Résumé métier | D1.3 |
| P-002 | Liste + Filtres + Tableau | D1.3 |
| P-003 | Fiche avec onglets | D1.3 |
| P-004 | Tableau de bord opérationnel | D1.3 |
| P-005 | Tableau de bord analytique | D1.3 |
| P-006 | Hub de paramétrage | D1.3 |
| P-007 | Outil opérationnel | D1.3 |
| P-008 | Assistant de création | D1.3 |
| P-009 | Consultation légère (Modal) | D1.3 |
| P-010 | Rapport | D1.3 |
