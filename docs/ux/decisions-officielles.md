# Décisions officielles UI/UX (DO-xxx)

**Statut :** normatif  
**Phase :** D1.1  
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
