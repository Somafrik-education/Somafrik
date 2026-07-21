# Glossaire UX Somafrik

**Statut :** normatif  
**Phase :** D1.1  

Ce glossaire fixe le vocabulaire utilisé dans les specs, les PR et les revues.  
En cas d’ambiguïté, ce document fait foi.

---

## Entités d’interface

### Fiche

Vue détaillée d’une entité métier (élève, classe, offre d’abonnement, etc.).  
Une fiche expose un **résumé métier**, puis des sections / onglets de détail.

### Workspace (dossier)

Fiche structurée en sections navigables (ex. dossier élève : Identité, Inscription, Responsables…).  
Synonyme produit courant : « dossier ».

### Résumé métier

Synthèse opérationnelle affichée **en tête** d’une fiche.  
Elle répond à « où en est cette entité ? » avant tout détail ou formulaire.

### Section

Bloc thématique à l’intérieur d’une fiche ou d’un onglet (ex. « Synthèse médicale », « Tous les responsables »).

### Onglet / Module de fiche

Entrée de navigation interne à un workspace (ex. Médical, Documents).  
Ne pas confondre avec les onglets de module applicatif (ex. onglets *Mon établissement*).

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

### Workflow

Enchaînement intentionnel qui mène de la compréhension à l’action.  
Chaque écran doit rendre la prochaine étape du workflow identifiable.

---

## États et signaux

### État système

État technique ou d’accès de l’écran :

| État | Signification |
|------|----------------|
| Loading | Chargement en cours |
| Empty | Aucune donnée pertinente à afficher |
| Error | Échec de chargement ou d’opération |
| Forbidden | Accès non autorisé (permission insuffisante) |

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

Aide d’orientation hiérarchique (non implémentée à D1.1 ; terme réservé).

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

### Pattern

Combinaison récurrente de primitives + conventions (ex. `Card` + `SectionHeader` + `dl`).

### Présentation de statut

Mapping canonique statut métier → libellé + tone (ex. inscription élève).  
À préférer aux heuristiques génériques sur libellés libres.
