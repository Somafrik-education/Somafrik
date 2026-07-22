# Glossaire UX Somafrik

**Statut :** normatif  
**Phase :** D1.1 · D1.2 (navigation) · D1.3 (pages métier)  

Ce glossaire fixe le vocabulaire utilisé dans les specs, les PR et les revues.  
En cas d’ambiguïté, ce document fait foi.

Références : [Navigation](./architecture-navigation.md) · [Pages métier](./architecture-pages-metier.md) · [Patterns Produit](./patterns-produit.md).

---

## Entités d’interface

### Application (shell)

Conteneur authentifié commun : sidebar, header, contextes globaux, zone de contenu.  
Ce n’est pas un Module.

### Module

Domaine métier de premier niveau, exposé dans la sidebar (ex. Mon établissement, Finances, Planning).

### Sous-module

Partition stable d’un Module, exposée en navigation locale (souvent onglets de module).  
Exemple : Élèves sous Mon établissement ; Paiements sous Finances.

### Vue

Écran de travail d’un Sous-module : **Liste**, **Hub** ou **Outil** (calendrier, matrice, etc.).

### Liste

Vue tabulaire ou collection d’entités, point d’entrée vers les fiches.

### Hub

Vue d’accueil d’un Module de configuration dense (ex. Paramètres), menant à des pages filles.

### Fiche

Vue détaillée d’une entité métier (élève, classe, offre d’abonnement, etc.).  
Une fiche expose un **résumé métier**, puis des sections / onglets de détail.  
Toujours adressable par URL (DO-014).

### Workspace (dossier)

Fiche structurée en sections navigables (ex. dossier élève : Identité, Inscription, Responsables…).  
Synonyme produit courant : « dossier ».

### Résumé métier

Synthèse opérationnelle affichée **en tête** d’une fiche (signature Somafrik).  
Elle répond : état actuel, problèmes, prochaine action.  
Pattern **P-001** · DO-001 · DO-028.

### Dashboard

Page de synthèse pour décider ou prioriser.  
Sous-types : opérationnel (**P-004**) et analytique (**P-005**).

### Outil

Page dédiée à une tâche opérationnelle dense (appel, saisie, calendrier).  
Pattern **P-007**.

### Assistant

Parcours multi-étapes guidé avec progression et validation.  
Pattern **P-008** (cible — absent de l’existant D1.3).

### Rapport

Page de synthèse analytique ou de conformité, souvent exportable.  
Pattern **P-010**.

### Pattern Produit

Structure d’interface réutilisable et nommée (**P-00X**).  
Déclaré dans chaque PR de page métier et, lorsque pertinent, dans les specs fonctionnelles (DO-032).  
Catalogue : [patterns-produit.md](./patterns-produit.md).

### Anti-pattern Produit

Pratique d’interface **interdite**, nommée (**AP-00X**).  
Sert de critère d’acceptation négatif en revue (DO-034).  
Catalogue : [anti-patterns.md](./anti-patterns.md).

### Section

Bloc thématique à l’intérieur d’une fiche ou d’un onglet (ex. « Synthèse médicale », « Tous les responsables »).  
Niveau le plus bas de la hiérarchie ; pas de segment d’URL obligatoire.

### Onglet de module

Entrée de navigation locale d’un Module (= Sous-module).  
Exemple : onglets *Mon établissement*, *Finances*.

### Sous-onglet

Variante d’une même Vue (ex. Emploi du temps → Par classe / Par enseignant).

### Onglet / Module de fiche

Entrée de navigation interne à un workspace (ex. Médical, Documents).  
Ne pas confondre avec les **onglets de module**.

---

## Actions

### Action primaire

Action principale de l’écran (ou de la zone d’action).  
Unique, visuelle dominante, liée au workflow courant.

### Action secondaire

Action facultative ou alternative (annuler, exporter, voir le détail…).  
Ne doit pas concurrencer l’action primaire.

### Action destructive

Action irréversible ou à fort impact (supprimer, résilier, rejeter…).  
Toujours protégée par confirmation.

### Action recommandée

Prochaine action suggérée par le système à partir de l’état métier (ex. « Ajouter certificat »).

### Action contextuelle

Action liée à une ligne, une section ou une alerte — pas à l’écran entier.  
Voir DO-029.

### Workflow

Enchaînement intentionnel qui mène de la compréhension à l’action.  
Chaque écran doit rendre la prochaine étape du workflow identifiable.

---

## États et signaux

### État système

État technique ou d’accès de l’écran (DO-005, DO-031) :

| État | Signification |
|------|----------------|
| Loading | Chargement en cours |
| Empty | Aucune donnée pertinente à afficher |
| Error | Échec de chargement ou d’opération |
| Forbidden | Accès non autorisé (permission insuffisante) |
| Conflit | Version / édition concurrente |
| Ressource absente | Entité introuvable |
| Lecture seule | Visible sans droit d’écriture |
| Synchronisation | Sync en cours ou en échec non bloquant |
| Maintenance | Indisponibilité planifiée / technique |
| Coming soon | Capacité non livrée (≠ Empty) |

### État métier

Situation de l’entité (actif, suspendu, dossier incomplet, payé…).  
Exprimé via libellés, badges et/ou résumé.

### Alerte

Information nécessitant une attention et, en général, une action.  
Distincte d’un simple statut informatif.

### Badge / Statut

Indicateur compact d’un état métier.  
La couleur porte une signification (voir DO-004), jamais décorative seule.

### Donnée vivante

Indicateur qui porte un signal opérationnel (écart, échéance, risque), pas seulement un volume.

---

## Structure de page

### Orientation

Capacité pour l’utilisateur de savoir où il se trouve (module, entité, section).

### Fil d’Ariane (breadcrumb)

Aide d’orientation hiérarchique cliquable (Module › Sous-module › …).  
Contrat normatif : DO-016 / Architecture navigation D1.2 §4.  
Implémentation runtime : post-validation CTO (pas dans D1.2).

### Navigation globale

Sidebar, Header, recherche, notifications, profil, contextes établissement / année, accès rapides.

### Navigation locale

Navigation à l’intérieur d’un Module (onglets de module, hub, outils).

### Navigation contextuelle

Enchaînements liés à l’entité ou au scope : retour liste, ouverture fiche, changement d’année / d’établissement.

### Accès rapide

Entrée Header hors arborescence sidebar (ex. Messages, Annonces, Notifications).

### Contexte actif

Dimension transversale de navigation (hors pile hiérarchique) : établissement, année scolaire, et extensions futures (campus, filiale).  
Toute navigation métier s’y inscrit de façon **explicite** (DO-023).

### Établissement actif

Périmètre établissement courant du shell (DO-017, DO-023).

### Année scolaire active

Année de travail courante du shell (DO-017, DO-023), distincte de l’écran de configuration des années.

### Préservation de contexte (fiche)

Après une action locale dans une fiche (ajout, édition, détail), retour au même onglet / même contexte — pas à un niveau supérieur non demandé (DO-024).

### Empty state

Présentation dédiée lorsqu’une liste ou une section n’a pas de contenu.  
Doit expliquer la situation et, si pertinent, la prochaine action.

### Coming soon / Module à venir

Section prévue mais non disponible.  
Doit rester distincte d’un empty métier et d’un forbidden.

---

## Rôles de composants (kit actuel)

### Primitive UI

Composant partagé non métier (`Button`, `Badge`, `Card`, `Modal`…).

### Pattern (UI)

Combinaison récurrente de primitives + conventions (ex. `Card` + `SectionHeader` + `dl`).  
Ne pas confondre avec **Pattern Produit** (P-00X).

### Présentation de statut

Mapping canonique statut métier → libellé + tone (ex. inscription élève).  
À préférer aux heuristiques génériques sur libellés libres.
