# Architecture des pages métier Somafrik — D1.3

**Statut :** normatif — **validé CTO** (APPROVE WITH COMMENTS, amendements intégrés)  
**Phase :** D1.3  
**Nature :** spécification uniquement dans cette PR — l’implémentation relève des lots D2.x+  
**Références :** [Vision](./vision-produit.md) · [Principes](./principes-ux.md) · [Navigation D1.2](./architecture-navigation.md) · [Glossaire](./glossaire.md) · [Décisions](./decisions-officielles.md) · [Patterns Produit](./patterns-produit.md) · [Anti-patterns](./anti-patterns.md) · [Inventaire D1.1](./inventaire-ui.md)

Cette spécification définit la **structure officielle des pages métier** de Somafrik.  
Elle s’applique à tous les modules présents et futurs (Élèves, Enseignants, Personnel, Classes, Matières, Présences, Notes, Finance, Bibliothèque, RH, Communication, Administration…).

Avec D1.1 et D1.2, elle forme le **socle Framework Produit** de l’expérience utilisateur Somafrik.

Les DO-xxx, Patterns (P-00X) et Anti-patterns (AP-00X) sont des **exigences d’acceptation** des PR UI.

---

## 0. Constat de l’existant (audit code)

Analyse réalisée sur `web/src` (branche `develop`).

### Types de pages observés

| Type observé | Présent | Exemples |
|--------------|---------|----------|
| Landing / Auth | Oui | `LandingPage`, `LoginPage` |
| Dashboard analytique | Oui | `OverviewPage` (graphiques) |
| Dashboard / hub opérationnel | Oui | `EtablissementOverviewPage` (compteurs + alertes) |
| Liste CRUD | Oui | `EntityPage`, `UsersPage`, `SchoolsPage`, Fees / Impayés |
| Fiche / workspace | Oui (élèves seulement) | `StudentWorkspacePage` + onglets |
| Hub paramétrage | Oui | `SettingsHubPage`, layouts à onglets |
| Formulaire page | Oui (ponctuel) | `ChangeOfferPage`, `CancellationRequestPage`, `ConfigurationPage` |
| Outil opérationnel | Oui | Présences, Notes, Planning calendrier |
| Rapport | Oui (limité) | `ReportsPage`, `SubscriptionReportsPage` |
| Consultation | Oui (partiel) | Détail Modal ; lecture Mon abonnement |
| Placeholder | Oui | `PagePlaceholder` (paramètres / planning partiels) |
| **Assistant (wizard)** | **Absent** | Aucun stepper / parcours multi-étapes |

### Structures récurrentes observées

1. **Shell module** = en-tête domaine + `TabNav` + `Outlet`
2. **Liste** = `Card` + `SectionHeader` + recherche/filtres + `Table` + Modal CRUD
3. **Fiche élève** = header identité + nav sections + onglets + `Card`/`SectionHeader`
4. **Dashboard** = charts globaux **ou** tuiles + alertes (deux modèles)
5. **États** = messages ad hoc (pas de primitive unifiée)

### Absences structurantes

- Pas de fiche enseignant / classe / établissement
- Pas de panneau latéral métier (drawer)
- Pas d’assistant multi-étapes
- KPIs présents surtout en Finance / rapports, absents des listes Élèves / Classes
- Pagination hétérogène (intégrée Table / manuelle / absente)

---

## 1. Types de pages officiels

Les types suivants constituent le **catalogue officiel**.  
Toute nouvelle page doit déclarer son type (et son Pattern Produit associé).

| Type | Intention | Exemples cibles |
|------|-----------|-----------------|
| **Dashboard** | Synthèse pour décider / prioriser | TDB global, vue d’ensemble établissement |
| **Liste** | Parcourir, filtrer, agir sur une collection | Élèves, Classes, Paiements |
| **Fiche** | Comprendre et travailler une entité | Dossier élève (référence) |
| **Outil** | Exécuter une tâche opérationnelle dense | Appel de présence, saisie de notes, calendrier |
| **Hub** | Orienter vers des sous-domaines de configuration | Paramètres |
| **Formulaire** | Saisir / modifier un ensemble de champs sur une page dédiée | Changer d’offre, config année |
| **Assistant** | Guidage multi-étapes pour un flux complexe | Création établissement, inscription (futur) |
| **Rapport** | Consulter / exporter une synthèse analytique ou de conformité | Conformité, rapports abonnements |
| **Consultation** | Lecture seule d’un état (sans workspace complet) | Mon abonnement (lecture) |
| **Placeholder** | Annoncer une capacité non livrée (distinct empty/forbidden) | Modules « bientôt » |

### Règles de choix

1. Si l’utilisateur doit **comprendre l’état d’une entité** → **Fiche** (pas une Modal longue).
2. Si l’utilisateur doit **parcourir une collection** → **Liste**.
3. Si l’utilisateur doit **exécuter une tâche répétitive** (appel, saisie) → **Outil**.
4. Si le flux a **≥ 3 étapes dépendantes** avec validation intermédiaire → **Assistant**.
5. Si c’est de la **configuration stable** dense → **Hub** (+ pages Formulaire filles).
6. Landing / Auth restent hors périmètre « pages métier ERP » (kit distinct autorisé, DO-011).

---

## 2. Structure officielle d’une Fiche métier

Référence d’audit : dossier élève.  
Contrat cible pour **toutes** les fiches futures (enseignant, classe, personnel, etc.).

### Ordre des blocs (de haut en bas)

| # | Bloc | Obligatoire | Rôle |
|---|------|-------------|------|
| 1 | **Orientation** | Oui | Retour liste + breadcrumb (D1.2) + contexte actif visible (shell) |
| 2 | **Header de fiche** | Oui | Identité de l’entité (nom, identifiant, badges de statut) |
| 3 | **Résumé métier** | Oui | Signature Somafrik — constat opérationnel (DO-001, DO-028, Pattern P-001) |
| 4 | **Alertes** | Si pertinentes | Signaux actionnables (lien vers onglet / action) |
| 5 | **Zone d’actions** | Oui | 1 action primaire max + secondaires (DO-002) |
| 6 | **Navigation locale de fiche** | Oui si multi-domaines | Onglets de fiche adressables (DO-015) |
| 7 | **Contenu d’onglet** | Oui | Sections (`Card` + `SectionHeader`) |
| 8 | **Historique** | Recommandé | Onglet ou section dédiée aux événements structurants |

### Header de fiche — contenu minimal

- Identifiant lisible (nom) + identifiant technique métier (matricule, code…)
- Badges d’état métier (actif, inscription, etc.) — tones DO-004
- Méta clés stables (classe, année, établissement…) **ou** déléguées au Résumé si redondance
- Lien **Retour à la liste** (D1.2 §6.1)

### Ce qu’une fiche ne doit pas faire

- Commencer par un formulaire (DO-001)
- Empiler des `h1` concurrents (Topbar / module / fiche) sans hiérarchie claire (DO-010)
- Perdre l’onglet après une action locale (DO-024)
- Remplacer un workspace par une Modal de 20 champs

### Mapping Pattern

→ **P-003 Fiche avec onglets** (+ **P-001 Résumé métier**)

---

## 3. Structure officielle d’une page Liste

### Ordre des blocs

| # | Bloc | Obligatoire | Rôle |
|---|------|-------------|------|
| 1 | **Titre** | Oui | Nom du Sous-module / Vue |
| 2 | **Description** | Recommandée | 1 phrase d’intention |
| 3 | **KPIs / signaux** | Recommandés si données vivantes | Compteurs utiles (DO-007) — pas de vanity metrics |
| 4 | **Barre d’outils** | Oui | Recherche, filtres, actions |
| 5 | **Tableau (ou équivalent)** | Oui | Collection principale |
| 6 | **Pagination / virtualisation** | Oui si volume > seuil page | Comportement stable et annoncé |
| 7 | **États** | Oui | Loading / Empty / Error / Forbidden |

### Règles Liste

1. L’action primaire ouvre la création **ou** le workflow principal du Sous-module.
2. L’ouverture d’une entité riche mène à une **Fiche URL** (DO-014) ; le détail léger peut rester en Modal (**P-009**).
3. Recherche + filtres sont visibles sans scroll excessif sur desktop.
4. Exports / impression = actions secondaires.
5. Empty explique l’absence et propose la prochaine action si autorisée (DO-005, DO-006).

### Mapping Pattern

→ **P-002 Liste + Filtres + Tableau**

---

## 4. Règles des Dashboards

Deux sous-types officiels (observés et conservés) :

| Sous-type | Intention | Pattern |
|-----------|-----------|---------|
| **Dashboard opérationnel** | Compteurs + alertes + accès rapides vers le travail du jour | P-004 |
| **Dashboard analytique** | Graphiques / tendances pour pilotage | P-005 |

### Un Dashboard doit contenir

- Un **constat prioritaire** (ce qui demande attention maintenant)
- Des **indicateurs vivants** (écart, échéance, risque — DO-007)
- Des **chemins vers l’action** (liens vers listes / fiches / outils)
- Le **contexte actif** respecté (DO-023)

### Un Dashboard ne doit jamais contenir

- Un formulaire de saisie métier principal
- Une table CRUD complète (ça relève de Liste)
- Plus d’**une** zone d’action primaire concurrente
- Des modules « bientôt » présentés comme des données réelles
- Des informations hors permissions de l’utilisateur

### Mapping

→ **P-004** ou **P-005** (déclarer lequel)

---

## 5. Résumés métier (signature officielle Somafrik)

Le **Résumé métier** est la **signature officielle** de Somafrik.  
Il est obligatoire en tête de **toute fiche métier**, sauf exception dûment justifiée en PR (DO-001, DO-028, Anti-pattern **AP-002**).

S’applique notamment à : Élève, Enseignant, Classe, Parent, Facture, Paiement, Contrat, Salle, Véhicule, ouvrage / Bibliothèque, et toute fiche future.

### Objectif — trois questions obligatoires

En quelques secondes, le résumé doit permettre de répondre :

1. **Quel est l’état actuel ?**
2. **Quelles actions sont requises ?**
3. **Quels sont les risques ou alertes ?**

### Contenu type

| Élément | Obligatoire | Notes |
|---------|-------------|-------|
| Statut(s) métier | Oui | Badges tones officiels (jamais couleur seule — AP-005) |
| Contexte scolaire / organisationnel | Oui | Classe, année, établissement… |
| Alertes / risques prioritaires | Si présents | Visibles en tête ; lien vers résolution (pas AP-006) |
| KPI / signaux vivants | Recommandés | Ex. docs manquants, impayés, échéances |
| Actions recommandées | Si action possible | Liées au workflow (DO-006) |
| Interprétation courte | Recommandée | « Dossier administratif incomplet » (DO-008) |

### Informations prioritaires (ordre suggéré)

1. Identité + statut  
2. Contexte (classe / année / établissement)  
3. Alertes / risques critiques  
4. Signaux (documents, finance, présence…)  
5. Actions requises  

### Interdits Résumé

- Formulaire en premier viewport
- Mur de champs bruts sans synthèse
- Compteurs plats alors qu’un signal existe (DO-007)
- Actions destructives dans le résumé (réservées + confirmation)
- Enterrer l’essentiel sous des onglets (AP-006)

### Mapping Pattern

→ **P-001 Résumé métier**

---

## 6. Actions

| Type | Définition | Emplacement | Style |
|------|------------|-------------|-------|
| **Primaire** | Action principale de l’écran / zone | Zone d’actions header (Liste / Fiche / Outil) | `Button` `primary` — **1 max** (DO-002) |
| **Secondaire** | Alternative utile (exporter, imprimer, modifier léger) | Même zone, poids visuel moindre | `secondary` / `ghost` |
| **Contextuelle** | Liée à une ligne, une section, une alerte | Ligne de tableau, carte, alerte | Lien ou `ghost` / `secondary` `sm` |
| **Destructive** | Irréversible ou fort impact | Toujours derrière confirmation (DO-003) | `danger` + `ConfirmDialog` |

### Règles

1. Les actions « à venir » ne paraissent pas primaires (pas de faux CTA dominant).
2. Sur Fiche : actions globales dans la zone d’actions ; actions d’onglet près du contenu d’onglet.
3. Après action locale sur fiche → retour même onglet (DO-024).
4. Permission insuffisante → action absente ou explicite (pas de bouton mort silencieux).

---

## 7. Panneaux et surfaces

| Surface | Quand l’utiliser | Quand ne pas l’utiliser |
|---------|------------------|-------------------------|
| **Page dédiée** | Fiche, Liste, Outil, Assistant, Dashboard | — |
| **Dialogue (Modal)** | CRUD léger, confirmation, édition courte, détail consultation simple | Workspace riche ; formulaires très longs ; multi-étapes complexes |
| **Carte (`Card`)** | Section de contenu dans une page | Comme seul substitut à une Fiche |
| **Encart** | Alerte, bandeau info, KPI compact | Navigation principale |
| **Panneau latéral** | Édition / détail secondaire sans quitter le contexte (futur recommandé) | Navigation globale ; remplacer une Fiche |
| **Placeholder** | Capacité non livrée | Empty métier ou Forbidden |

### Règle de bascule Modal → Page / Fiche

Si le contenu exige résumé + plusieurs sections + historique → **Fiche**.  
Si ≤ ~1 écran de champs avec une intention unique → **Modal** acceptable.

---

## 8. États officiels des pages

Extension de DO-005 / DO-021 pour les pages métier.

| État | Signification | Exigence UI |
|------|---------------|-------------|
| **Loading** | Chargement | Shell conservé ; message / squelette explicite |
| **Vide (Empty)** | Aucune donnée pertinente | Explication + prochaine action si possible |
| **Erreur** | Échec chargement / opération | Message + retry / repli |
| **Permission refusée** | Droits insuffisants | Distinct ; issue (retour zone autorisée) |
| **Conflit** | Version / concurrence | Rester sur place ; résoudre (recharger / réappliquer) |
| **Ressource absente** | Entité introuvable | Message + retour liste parent |
| **Lecture seule** | Visible sans écriture | Bandeau ou libellé clair ; pas de contrôles trompeurs |
| **Synchronisation** | Sync données en cours / en échec | Signal non bloquant (toast / indicateur) sauf erreur bloquante |
| **Maintenance** | Indisponibilité planifiée / technique | Message dédié ; pas confondre avec Error métier |
| **Coming soon** | Non livré | `PagePlaceholder` ou équivalent — ≠ Empty |

Forbidden ≠ Empty ≠ Error ≠ Coming soon ≠ Lecture seule.

### Distinction à formaliser (suite recommandée — hors D1.3 runtime)

Ne pas mélanger :

| Famille | Exemples | Nature |
|---------|----------|--------|
| **État système** | Chargement, erreur technique, maintenance, sync | Technique / disponibilité |
| **État métier** | Inscription incomplète, paiement en retard, document expiré | Situation fonctionnelle de l’entité |

Cette distinction est **reconnue** dès D1.3 ; sa formalisation normative détaillée (contrats d’affichage, patterns dédiés) est reportée à une étape ultérieure (ex. D1.4 / D2.x doc), sur demande CTO.

---

## 9. Responsive — structure par surface

| Surface | Fiche | Liste | Dashboard | Outil |
|---------|-------|-------|-----------|-------|
| **Desktop (`≥ lg`)** | Résumé + onglets + sections multi-colonnes | Filtres inline + tableau dense | Grille KPI / charts | Zone de travail large |
| **Tablette (`md`–`< lg`)** | Résumé empilé ; onglets scroll | Filtres compactés ; tableau | Grille 2 cols | Adaptation densités |
| **Mobile (`< md`)** | Résumé prioritaire ; 1 barre d’onglets (DO-020) ; sections empilées | Recherche + filtres en feuille / accordion ; **cartes** à la place du tableau dense si besoin | 1 colonne ; alertes d’abord | Saisie pouce ; actions primaires accessibles |

### Règles transverses

- Ne pas supprimer de blocs obligatoires sur mobile : les **réordonner / compacter**.
- Le Résumé métier reste dans le premier viewport de la Fiche.
- P14 reste valable sur chaque surface.

---

## 10. Patterns Produit

À partir de D1.3, chaque spécification **UI** et chaque spécification **fonctionnelle** (lorsque pertinent) référence les Patterns concernés.

Exemple dans une spec fonctionnelle :

```text
Patterns :
- P-003 — Fiche avec onglets
- P-001 — Résumé métier
- P-002 — Liste + Filtres + Tableau
```

Le catalogue vivant est tenu dans [`patterns-produit.md`](./patterns-produit.md).

Lorsqu’un développeur crée une fonctionnalité, il déclare :

> Cette page suit le Pattern **P-00X**.

### Catalogue initial (D1.3)

| ID | Pattern | Type de page | Usage |
|----|---------|--------------|-------|
| **P-001** | Résumé métier | Bloc (Fiche) | Tête de toute fiche |
| **P-002** | Liste + Filtres + Tableau | Liste | Collections métier |
| **P-003** | Fiche avec onglets | Fiche | Workspace entité |
| **P-004** | Tableau de bord opérationnel | Dashboard | Compteurs + alertes + accès |
| **P-005** | Tableau de bord analytique | Dashboard | Graphiques / tendances |
| **P-006** | Hub de paramétrage | Hub | Configuration dense |
| **P-007** | Outil opérationnel | Outil | Présences, notes, planning |
| **P-008** | Assistant de création | Assistant | Flux multi-étapes (cible) |
| **P-009** | Consultation légère (Modal) | Consultation | Détail / édition courte |
| **P-010** | Rapport | Rapport | Synthèses / conformité |

---

## 10 bis. Anti-patterns Produit

Catalogue des pratiques **interdites** : [`anti-patterns.md`](./anti-patterns.md).

| ID | Anti-pattern |
|----|--------------|
| **AP-001** | Plus d’une action primaire sur une même page |
| **AP-002** | Une fiche sans résumé métier |
| **AP-003** | Une action destructive sans confirmation |
| **AP-004** | Une navigation qui fait perdre le contexte |
| **AP-005** | Des statuts exprimés uniquement par une couleur |
| **AP-006** | Informations critiques masquées sous plusieurs niveaux d’onglets |

En revue D2.x+ : vérifier qu’**aucun Anti-pattern** n’est introduit (DO-034).

---

## 11. Décisions officielles (pages métier)

| ID | Titre |
|----|-------|
| **DO-025** | Catalogue officiel des types de pages |
| **DO-026** | Structure officielle de la Fiche métier |
| **DO-027** | Structure officielle de la page Liste |
| **DO-028** | Résumé métier obligatoire (signature Somafrik) |
| **DO-029** | Taxonomy et placement des actions |
| **DO-030** | Choix des surfaces (page, modal, carte, panneau, placeholder) |
| **DO-031** | États officiels des pages métier |
| **DO-032** | Déclaration obligatoire d’un Pattern Produit |
| **DO-033** | Validation CTO avant implémentation pages D1.3 *(levé — D1.3 validé)* |
| **DO-034** | Catalogue officiel des Anti-patterns Produit |

Détail : [Décisions officielles](./decisions-officielles.md).

---

## 12. Dette actuelle (constat — sans plan de développement)

### Incohérences

1. Un seul vrai workspace Fiche (élève) vs listes + modals partout ailleurs.
2. Deux architectures Liste : `EntityPage` monolithe vs pages spécialisées (Users, Schools, Fees).
3. Deux modèles Dashboard (charts vs tuiles) sans contrat écrit jusqu’ici.
4. KPIs présents en Finance, absents des listes Élèves / Classes / Enseignants.
5. Pagination hétérogène (Table intégrée / manuelle / absente).
6. Modules student déclarés (présences, notes, finances…) non routés dans la fiche.
7. Actions « bientôt » disabled dans la fiche **et** `PagePlaceholder` ailleurs — deux langages.

### Doublons

1. Card/Button kit ERP vs sous-ensemble shadcn (Reports / auth).
2. `UsersPage` monté sous Établissement et Administration.
3. Relations parent-enfant vs Relations administration.
4. Pages legacy non routées (`EstablishmentPage`, `SubscriptionsPage`).

### Risques

1. Divergence UX accélérée si nouveaux modules inventent des structures hors catalogue.
2. Fiches futures (enseignant, RH…) sans contrat → réinvention coûteuse.
3. Absence d’Assistant alors que des flux complexes existent (inscription, abo, école).
4. États non factorisés → messages et a11y inégaux.
5. Modals trop chargées qui usurpent le rôle de Fiche.

---

## 13. Impact sur les modules existants

Légende : ✅ conforme · ⚠️ écart partiel · ❌ non conforme · — non développé / N/A

| Module | Conforme | Écart | Action future |
|--------|----------|-------|---------------|
| Tableau de bord (analytique) | ⚠️ | Proche P-005 ; peu de chemins d’action / alertes opérationnelles | D2.x alignement P-005 |
| Mon établissement (vue d’ensemble) | ⚠️ | Proche P-004 ; titres dupliqués ; pas de résumé formalisé | D2.x P-004 |
| Élèves (liste) | ⚠️ | P-002 partiel (search OK, KPIs absents, filtres limités) | D2.x P-002 |
| Élèves (fiche) | ⚠️ | Référence P-003/P-001 ; résumé perfectible ; actions header faibles ; doubles onglets | D2.x P-001/P-003 |
| Enseignants | ⚠️ | Liste seule ; pas de fiche | Plus tard — Fiche P-003 |
| Classes | ⚠️ | Liste ; pas de fiche classe | Plus tard |
| Parents & élèves | ⚠️ | Liste spécialisée | Audit + P-002 |
| Présences | ⚠️ | Outil P-007 amorcé | D2.x formaliser P-007 |
| Notes & évaluations | ⚠️ | Outil P-007 amorcé | D2.x |
| Examens / Bulletins | ⚠️ | Liste générique EntityPage | Plus tard |
| Finances (paiements / frais / impayés) | ⚠️ | Listes + KPIs (bon signal) ; pas de fiche finance élève | D2.x |
| Planning | ⚠️ | Outil + placeholders | D2.x / Plus tard |
| Administration | ⚠️ | Hub onglets + listes ; rapport conformité basique | D2.x |
| Paramètres | ⚠️ | Hub P-006 amorcé + placeholders | D2.x |
| Abonnements | ⚠️ | Listes / rapports / formulaires page ; pas d’assistant | Plus tard P-008 |
| Communication (messages / annonces) | ⚠️ | Listes EntityPage | Plus tard |
| Notifications | ⚠️ | Liste / consultation | Maintenir |
| Personnel / RH | — | Non développé | N/A — appliquer D1.3 dès création |
| Bibliothèque | — | Non développé | N/A — appliquer D1.3 |
| Matières (entité) | — | Redirigé / absorbé ailleurs | N/A produit |
| Modules futurs | — | — | Pattern P-00X obligatoire (DO-032) |

### Lecture

- Aucune refonte immédiate imposée.
- Le tableau mesure la maturité d’alignement pages ; à mettre à jour à chaque spécification D suivante.

---

## 14. Périmètre futur (hors D1.3 implémentation)

1. Appliquer P-001 / P-003 sur la fiche Élève (sans refonte globale).
2. Aligner listes prioritaires sur P-002 (KPIs vivants, filtres, états).
3. Formaliser P-004 / P-005 sur les dashboards existants.
4. Introduire P-008 pour les flux multi-étapes critiques.
5. Étendre P-003 aux fiches Enseignant / Classe / Personnel.
6. Factoriser les états (après stabilisation des libellés — DO-012).

---

## 15. Validation CTO

| Critère | Statut |
|---------|--------|
| Types de pages §1 (dont Assistant cible) | ✅ Validé |
| Structure Fiche / Liste / Dashboard §2–4 | ✅ Validé |
| Résumé métier = signature officielle §5 | ✅ Validé |
| Actions / surfaces / états §6–8 | ✅ Validé |
| Patterns Produit P-001 → P-010 | ✅ Validé |
| Anti-patterns AP-001 → AP-006 | ✅ Intégrés (amendement) |
| DO-025 → DO-034 | ✅ Intégrés |
| Tableau d’impact §13 (méthode pérenne) | ✅ Validé |

**Décision CTO :** APPROVE WITH COMMENTS — amendements intégrés.  
**Fusion :** autorisée.  
**Implémentation runtime :** lots D2.x+ avec checklist de conformité Framework.
