# Décisions officielles UI/UX (DO-xxx)

**Statut :** normatif  
**Phase :** D1.1 · étendu D1.2 (navigation)  
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
- D1.2 = documentation normative uniquement.
- Les écarts listés dans le tableau d’impact restent de la dette jusqu’aux lots D2.x+.
- Toute dérogation post-validation doit citer les DO impactées.

**Réf. :** Architecture navigation D1.2 §13 ; DO-012.

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
