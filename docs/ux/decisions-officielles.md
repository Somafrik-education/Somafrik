# Décisions officielles UI/UX (DO-xxx)

**Statut :** normatif  
**Phase :** D1.1 · D1.2 (navigation) · D1.3 (pages métier)  
**Usage :** référence obligatoire pour toute PR UI/UX

Toute dérogation doit être explicite dans la PR et validée en revue CTO / produit.

---

## DO-001 — Résumé opérationnel en tête de fiche

**Décision :** Une fiche métier commence toujours par un résumé opérationnel.

**Implications :**
- Pas de formulaire en premier viewport d’une fiche.
- Le résumé expose l’état utile (statut, contexte, alertes, signaux clés).
- Les détails et l’édition viennent après.

**Réf. :** Principe P2, Vision Produit.

---

## DO-002 — Une action primaire maximum par écran

**Décision :** Une action primaire maximum par écran (ou par zone d’action clairement délimitée).

**Implications :**
- L’action primaire utilise le style bouton dominant (`Button` variant `primary`).
- Les autres actions sont secondaires (`secondary` / `ghost`) ou groupées.
- Les actions « à venir » ne doivent pas paraître primaires.

**Réf. :** Principe P7.

---

## DO-003 — Confirmation des actions destructives

**Décision :** Les actions destructives nécessitent une confirmation.

**Implications :**
- Utiliser le mécanisme de confirmation existant (`ConfirmDialog`, tone `danger`) ou équivalent explicite.
- Le libellé de confirmation doit nommer l’impact (pas seulement « Confirmer » générique si l’action est grave).

**Réf. :** Principe P8.

---

## DO-004 — Couleurs = signification métier

**Décision :** Les couleurs transmettent une signification métier.

**Implications :**
- Tones officiels des badges : `neutral`, `success`, `warning`, `danger`, `info`.
- Ne pas inventer de mapping couleur divergent pour un même statut métier.
- Préférer les présentations de statut canoniques aux heuristiques sur libellés libres.
- La couleur ne doit jamais être le seul canal d’information critique.

**Réf. :** Principes P1, P6.

---

## DO-005 — États système explicites

**Décision :** Les états loading, empty, error et forbidden sont toujours explicites et distincts.

**Implications :**
- Chaque état a un message compréhensible en français.
- Forbidden propose une issue (retour section autorisée, contact admin, etc.) quand c’est possible.
- Empty explique l’absence de données ; il n’est pas un error déguisé.

**Réf. :** Principe P9, Glossaire « État système ».

---

## DO-006 — Prochaine action visible

**Décision :** Chaque écran doit rendre identifiable la prochaine action utile de l’utilisateur.

**Implications :**
- Si une action recommandée existe, elle apparaît près du constat / résumé.
- Si aucune action n’est possible, l’écran l’indique clairement (droits, lecture seule, module à venir).
- Éviter les contrôles désactivés sans explication.

**Réf. :** Principe P3 (Workflow).

---

## DO-007 — Données vivantes

**Décision :** Les indicateurs opérationnels portent un signal utile, pas seulement un volume.

**Implications :**
- Compléter les compteurs par écarts, échéances ou risques lorsque la donnée existe.
- Exemple : « 8 documents · 1 expire dans 6 jours · 2 manquants » plutôt que « 8 documents » seul.
- Un compteur plat n’est acceptable que s’il n’existe aucun signal dérivé pertinent.

**Réf. :** Principe P4.

---

## DO-008 — Aide à la décision

**Décision :** Chaque écran aide à prendre une décision (constat → interprétation → actions).

**Implications :**
- Après les faits, formuler l’interprétation métier quand elle est calculable (ex. « dossier administratif incomplet »).
- Proposer ensuite les actions associées.
- Le détail brut sans conclusion est insuffisant pour une fiche opérationnelle.

**Réf. :** Principe P5.

---

## DO-009 — Orientation permanente

**Décision :** L’utilisateur doit toujours pouvoir savoir module / entité / section courants.

**Implications :**
- Titres, navigation et contexte de fiche doivent rester cohérents.
- Les évolutions d’orientation (breadcrumb, titre Topbar, allègement des doubles onglets) devront respecter cette décision sans casser les parcours métier.

**Réf. :** Principe P10.

---

## DO-010 — Accessibilité de base non négociable

**Décision :** Clavier, focus visible, libellés et rôles pertinents sont exigés sur tout nouvel écran ou composant interactif.

**Implications :**
- Focus visible sur les contrôles navigables.
- Dialogs : fermeture et parcours clavier utilisables ; intitulé accessible.
- Hiérarchie de titres logique (éviter les `h1` multiples concurrents sur une même vue).
- Les états système critiques doivent être annoncés de façon accessible (`role` / live region selon le cas).

**Réf. :** Principe P12.

---

## DO-011 — Kit UI ERP canonique

**Décision :** Le kit `web/src/components/ui/*` (hors `shadcn/`) est la source de vérité des écrans ERP authentifiés.

**Implications :**
- Les nouveaux écrans métier utilisent `Button`, `Badge`, `Card`, `Modal`, `Field`, etc.
- Le sous-ensemble `ui/shadcn/*` reste limité aux surfaces déjà concernées (auth / marketing / cas isolés) sauf décision contraire.
- Pas de troisième kit parallèle.

**Réf. :** Principe P11, Inventaire UI.

---

## DO-012 — Documentation avant abstraction

**Décision :** Ne pas créer de primitive UI transverse sans pattern stable répété et sans alignement avec ce framework.

**Implications :**
- D1.1 documente ; les factorisations (EmptyState, InlineAlert, etc.) relèvent d’étapes ultérieures.
- Toute nouvelle abstraction doit citer les DO / principes qu’elle sert.

**Réf. :** Principe P13.

---

## DO-013 — Hiérarchie officielle de navigation

**Décision :** La navigation Somafrik suit exclusivement la hiérarchie :

Application → Module → Sous-module → Vue (Liste | Hub | Outil) → Fiche → Onglet de fiche → Section.

**Implications :**
- Tout nouveau module doit se mapper sur ces niveaux (détail : [Architecture de navigation](./architecture-navigation.md)).
- Au plus 6 niveaux routables jusqu’à l’onglet de fiche ; la Section n’impose pas de segment d’URL.
- Dépasser cette profondeur signale une mauvaise découpe, pas un besoin de niveau supplémentaire.

**Réf. :** Principe P10, DO-009, Architecture navigation D1.2 §1.

---

## DO-014 — Fiche métier adressable par URL

**Décision :** Toute fiche métier (workspace / dossier) est accessible par une URL stable et partageable.

**Implications :**
- L’ouverture d’une fiche navigue vers une route dédiée (ex. `/etablissement/eleves/:id`).
- Rafraîchir ou partager l’URL restaure la même fiche (et l’onglet si présent).
- Une modale peut servir l’édition légère ; elle ne remplace pas une fiche riche.

**Réf. :** Architecture navigation D1.2 §3, §5, §6.

---

## DO-015 — Onglets stables = segments d’URL

**Décision :** Les partitions stables (onglets de module, sous-onglets de vue, onglets de fiche) sont représentées par des segments de path, pas uniquement par un état mémoire ou `?tab=`.

**Implications :**
- `TabNav` / navigation de fiche restent pilotés par React Router.
- L’index d’un module redirige vers le sous-module / onglet par défaut.
- Les deep-links restaurent l’onglet exact.

**Réf. :** Architecture navigation D1.2 §5.

---

## DO-016 — Breadcrumb dès la profondeur Module + Sous-module + (Vue|Fiche)

**Décision :** Un fil d’Ariane est obligatoire dès qu’une vue combine Module, Sous-module et une Vue ou Fiche.

**Implications :**
- Maximum 5 segments visibles ; troncature au milieu si besoin.
- Absent sur tableau de bord et modules mono-vue de profondeur 1.
- Sur mobile : forme compacte (feuille + parent) avec accès au chemin complet.
- Complète, sans remplacer, l’action « Retour à la liste » sur les fiches.

**Réf. :** DO-009, Architecture navigation D1.2 §4.

---

## DO-017 — Contexte établissement et année scolaire dans le shell

**Décision :** L’établissement actif et l’année scolaire active sont des contextes globaux du shell, pas des contrôles dispersés par écran.

**Implications :**
- Sélecteurs exposés dans le Header lorsque le rôle le nécessite.
- Changer d’établissement ou d’année recalcule le scope sans inventer une navigation parallèle.
- La configuration des années (création, périodes) reste dans Paramètres.
- Les sélecteurs locaux divergents sont une dette à résorber.

**Réf. :** Architecture navigation D1.2 §2.6, §2.7, §6.4, §6.5.

---

## DO-018 — Sidebar = Modules uniquement

**Décision :** La sidebar (et son drawer mobile) n’expose que le Tableau de bord et les Modules.

**Implications :**
- Sous-modules, listes, fiches et actions ponctuelles n’apparaissent pas comme entrées sidebar.
- Communication / Notifications relèvent des accès rapides Header lorsqu’ils ne constituent pas un Module sidebar.
- Les groupes de menu organisent les Modules ; ils ne créent pas un niveau de navigation supplémentaire.

**Réf. :** Architecture navigation D1.2 §2.1, §2.8, §3.

---

## DO-019 — Plafonds d’onglets et critères onglet vs page

**Décision :** Onglets de module ≤ 7, sous-onglets de vue ≤ 5, onglets de fiche visibles ≤ 8. Une partition devient une page / entrée séparée si l’intention métier est distincte et durable, ou si les plafonds sont dépassés.

**Implications :**
- Au-delà des plafonds : scinder le module, passer en hub, ou regrouper.
- Les modules « à venir » non navigables ne comptent pas dans la barre visible.
- Paramètres reste un hub de configuration ; les outils mono-intention peuvent rester des modules mono-vue.

**Réf. :** Architecture navigation D1.2 §5.

---

## DO-020 — Une barre d’onglets primaire à la fois sur mobile

**Décision :** Sur mobile, une fiche ne présente pas deux barres d’onglets primaires concurrentes.

**Implications :**
- Si Module et Fiche ont des onglets, la barre de fiche prime ; la barre de module est allégée ou masquée.
- Le scroll horizontal d’une seule barre reste acceptable.
- Desktop peut conserver davantage de chrome si l’orientation (titre + breadcrumb) reste claire.

**Réf. :** DO-009, DO-010, Architecture navigation D1.2 §3, §5, §7.

---

## DO-021 — États système et orientation préservée

**Décision :** Pendant loading, erreur, permission refusée, ressource absente ou conflit, le shell et l’orientation de module restent compréhensibles.

**Implications :**
- Pas d’écran blanc total à la place du shell.
- Forbidden / Error / Empty / Coming soon restent distincts (DO-005).
- Ressource absente → message + retour à la liste parent.
- Conflit d’édition → rester sur la fiche avec actions de résolution.

**Réf. :** DO-005, DO-006, Architecture navigation D1.2 §8.

---

## DO-022 — Validation CTO avant implémentation navigation D1.2

**Décision :** Aucune PR ne modifie la navigation runtime (routes, shell, TabNav, breadcrumb, sélecteurs globaux) tant que l’architecture D1.2 n’est pas validée CTO.

**Implications :**
- **Statut :** D1.2 validé CTO (APPROVE WITH COMMENTS) — le verrou d’implémentation est levé pour les lots D2.x+ conformes.
- Les PR d’implémentation navigation doivent citer les DO impactées et respecter le tableau d’impact modules.
- Les écarts listés dans le tableau d’impact restent de la dette jusqu’à leur lot dédié.
- Toute dérogation doit être explicite en revue (« Non conforme à DO-xxx » + justification).

**Réf. :** Architecture navigation D1.2 §13 ; DO-012.

---

## DO-023 — Contexte actif

**Décision :** Toute navigation métier s’effectue dans un **contexte actif explicite** (au minimum établissement et année scolaire lorsque ces informations sont pertinentes). Les changements de contexte ne doivent jamais être implicites.

**Implications :**
- Le Contexte est une **dimension transversale**, pas un niveau de la hiérarchie Module → … → Section.
- Établissement actif et année scolaire active sont exposés dans le shell lorsque le rôle le nécessite (cohérent DO-017).
- Extensions futures possibles (campus, filiale) suivent la même règle.
- Aucune bascule silencieuse d’établissement ou d’année lors d’une navigation ou d’une action.
- Critique pour le multi-établissements et la confiance dans les données affichées.

**Réf. :** DO-017, Architecture navigation D1.2 §1 (Contexte), §2.6, §2.7, §6.4, §6.5.

---

## DO-024 — Préservation du contexte de navigation dans une fiche

**Décision :** Dans une fiche métier, après une action locale (ajout, modification, détail), l’utilisateur revient au **même onglet / même contexte de fiche**, pas à un niveau supérieur non demandé.

**Implications :**
- Exemple : Élève → Documents → Ajouter un document → Retour à **Documents** (pas à la liste des élèves).
- Les modales se ferment sur l’onglet courant.
- Seules les actions explicites (Retour à la liste, breadcrumb vers un parent) quittent ce contexte.
- Les revues UI vérifient cette continuité (P14 — « Comment revenir en arrière ? »).

**Réf. :** P14, Architecture navigation D1.2 §6.6.

---

## DO-025 — Catalogue officiel des types de pages

**Décision :** Toute page métier appartient à l’un des types officiels : Dashboard, Liste, Fiche, Outil, Hub, Formulaire, Assistant, Rapport, Consultation, Placeholder.

**Implications :**
- La PR déclare le type de page.
- Landing / Auth restent hors catalogue ERP (kit distinct, DO-011).
- Un flux ≥ 3 étapes dépendantes utilise le type Assistant (Pattern P-008), pas une Modal opaque.

**Réf. :** Architecture pages métier D1.3 §1.

---

## DO-026 — Structure officielle de la Fiche métier

**Décision :** Une Fiche suit l’ordre : Orientation → Header → Résumé métier → Alertes → Actions → Navigation locale (si multi-domaines) → Contenu → Historique (recommandé).

**Implications :**
- Pas de formulaire en premier viewport (DO-001 / DO-028).
- Référence d’implémentation actuelle : dossier élève ; cible pour toutes les fiches futures.
- Pattern associé : P-003 (+ P-001).

**Réf. :** Architecture pages métier D1.3 §2 ; Pattern P-003.

---

## DO-027 — Structure officielle de la page Liste

**Décision :** Une Liste expose titre, barre d’outils (recherche / filtres / actions), tableau (ou équivalent), pagination si volume, et états système explicites.

**Implications :**
- KPIs / signaux recommandés lorsqu’il existe une donnée vivante (DO-007).
- Ouverture d’entité riche → Fiche URL (DO-014) ; détail léger → P-009.
- Pattern associé : P-002.

**Réf. :** Architecture pages métier D1.3 §3.

---

## DO-028 — Résumé métier obligatoire (signature Somafrik)

**Décision :** Toute Fiche commence par un Résumé métier qui permet de répondre : état actuel, problèmes, prochaine action.

**Implications :**
- Contenu type : statuts, contexte, alertes, KPI vivants, interprétation, actions recommandées.
- Interdit : mur de champs, compteurs plats alors qu’un signal existe, actions destructives non protégées.
- Pattern associé : P-001.
- Renforce et opérationnalise DO-001 pour toutes les fiches modules.

**Réf. :** DO-001, DO-006, DO-007, DO-008 ; Architecture pages métier D1.3 §5.

---

## DO-029 — Taxonomy et placement des actions

**Décision :** Les actions se classent en primaire, secondaire, contextuelle, destructive — avec emplacements et styles stables.

**Implications :**
- Une seule action primaire par écran / zone (DO-002).
- Destructive → confirmation (DO-003).
- Contextuelle près de la ligne / section / alerte concernée.
- Pas de faux CTA « à venir » en primaire.

**Réf. :** DO-002, DO-003 ; Architecture pages métier D1.3 §6.

---

## DO-030 — Choix des surfaces

**Décision :** Page dédiée, Modal, Carte, Encart, Panneau latéral et Placeholder ont des rôles distincts ; une Modal ne remplace pas une Fiche riche.

**Implications :**
- Workspace (résumé + onglets + historique) → Page Fiche (P-003).
- CRUD léger / détail court → Modal (P-009).
- Capacité non livrée → Placeholder (≠ Empty / Forbidden).
- Panneau latéral réservé à l’édition / détail secondaire sans quitter le contexte (cible).

**Réf. :** Architecture pages métier D1.3 §7.

---

## DO-031 — États officiels des pages métier

**Décision :** Les pages métier distinguent explicitement : Loading, Empty, Erreur, Permission refusée, Conflit, Ressource absente, Lecture seule, Synchronisation, Maintenance, Coming soon.

**Implications :**
- Ces états ne sont pas interchangeables.
- Le shell et l’orientation restent compréhensibles (DO-021).
- Lecture seule et Coming soon ne se présentent pas comme Empty.

**Réf. :** DO-005, DO-021 ; Architecture pages métier D1.3 §8.

---

## DO-032 — Déclaration obligatoire d’un Pattern Produit

**Décision :** Toute PR qui crée ou refond une page métier déclare le Pattern Produit utilisé (P-00X) issu du catalogue officiel.

**Implications :**
- Catalogue : [`patterns-produit.md`](./patterns-produit.md).
- Composition autorisée (ex. P-003 + P-001).
- Si aucun Pattern ne convient : amendement documentaire avant invention d’UI.
- En revue : « Conforme à P-002 » / « Non conforme à P-001 ».

**Réf. :** Architecture pages métier D1.3 §10 ; Patterns Produit.

---

## DO-033 — Validation CTO avant implémentation pages D1.3

**Décision :** Aucune PR ne modifie les structures de pages runtime pour se conformer à D1.3 tant que cette architecture n’est pas validée CTO.

**Implications :**
- D1.3 = documentation normative uniquement dans son lot.
- Les écarts du tableau d’impact restent de la dette jusqu’aux lots D2.x+.
- Après validation : implémentation par lots citant DO / Patterns.

**Réf. :** Architecture pages métier D1.3 §15 ; DO-012.

---

## Journal

| ID | Titre | Introduit |
|----|-------|-----------|
| DO-001 | Résumé opérationnel en tête de fiche | D1.1 |
| DO-002 | Une action primaire maximum par écran | D1.1 |
| DO-003 | Confirmation des actions destructives | D1.1 |
| DO-004 | Couleurs = signification métier | D1.1 |
| DO-005 | États système explicites | D1.1 |
| DO-006 | Prochaine action visible | D1.1 |
| DO-007 | Données vivantes | D1.1 |
| DO-008 | Aide à la décision | D1.1 |
| DO-009 | Orientation permanente | D1.1 |
| DO-010 | Accessibilité de base | D1.1 |
| DO-011 | Kit UI ERP canonique | D1.1 |
| DO-012 | Documentation avant abstraction | D1.1 |
| DO-013 | Hiérarchie officielle de navigation | D1.2 |
| DO-014 | Fiche métier adressable par URL | D1.2 |
| DO-015 | Onglets stables = segments d’URL | D1.2 |
| DO-016 | Breadcrumb dès profondeur Module+Sous-module+(Vue\|Fiche) | D1.2 |
| DO-017 | Contexte établissement et année scolaire dans le shell | D1.2 |
| DO-018 | Sidebar = Modules uniquement | D1.2 |
| DO-019 | Plafonds d’onglets et critères onglet vs page | D1.2 |
| DO-020 | Une barre d’onglets primaire à la fois sur mobile | D1.2 |
| DO-021 | États système et orientation préservée | D1.2 |
| DO-022 | Validation CTO avant implémentation navigation D1.2 | D1.2 |
| DO-023 | Contexte actif | D1.2 |
| DO-024 | Préservation du contexte de navigation dans une fiche | D1.2 |
| DO-025 | Catalogue officiel des types de pages | D1.3 |
| DO-026 | Structure officielle de la Fiche métier | D1.3 |
| DO-027 | Structure officielle de la page Liste | D1.3 |
| DO-028 | Résumé métier obligatoire (signature Somafrik) | D1.3 |
| DO-029 | Taxonomy et placement des actions | D1.3 |
| DO-030 | Choix des surfaces (page, modal, carte, panneau, placeholder) | D1.3 |
| DO-031 | États officiels des pages métier | D1.3 |
| DO-032 | Déclaration obligatoire d’un Pattern Produit | D1.3 |
| DO-033 | Validation CTO avant implémentation pages D1.3 | D1.3 |
