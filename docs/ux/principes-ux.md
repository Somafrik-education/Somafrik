# Principes UX Somafrik

**Statut :** normatif  
**Phase :** D1.1  
**Référence croisée :** [Décisions officielles](./decisions-officielles.md), [Glossaire](./glossaire.md)

Ces principes s’appliquent à toute évolution UI/UX.  
Ils complètent les règles générales (accessibilité, cohérence, réutilisation) par des exigences propres à un **ERP scolaire**.

---

## P1 — Métier d’abord

L’information métier passe avant la décoration.  
Aucun élément purement esthétique ne doit retarder la compréhension d’un état critique (statut, alerte, échéance, permission).

## P2 — Résumé métier

**Chaque fiche métier commence par un résumé opérationnel avant les détails.**

Une fiche ne commence jamais par un formulaire.

Le résumé doit permettre de comprendre rapidement la situation (ex. élève : actif, classe, année, alertes, paiements, documents, présence, actions recommandées).

Voir aussi **DO-001**.

## P3 — Workflow (prochaine action)

Un ERP ne sert pas uniquement à consulter : il sert à travailler.

Chaque écran doit répondre implicitement à :

> Quelle est la prochaine action de l’utilisateur ?

Si aucune action n’est possible, l’écran doit l’expliquer (empty, forbidden, lecture seule, module à venir) plutôt que d’afficher des contrôles inertes sans contexte.

## P4 — Données vivantes

Pas d’écran passif.

Un indicateur qui se limite à un compteur plat (« 8 documents ») est insuffisant s’il existe un signal opérationnel.

Préférer une formulation utile, à quantité d’information comparable :

- 8 documents  
- 1 expire dans 6 jours  
- 2 manquants  

Les libellés et métriques doivent porter un **état**, une **échéance** ou un **écart**, pas seulement un volume.

## P5 — Aide à la décision

Chaque écran doit aider à prendre une décision.

Enchaînement cible :

1. Constat (ex. Documents)  
2. Interprétation (ex. Le dossier administratif est incomplet)  
3. Actions (ex. Ajouter certificat, Ajouter photo)

Le détail brut sans conclusion opérationnelle est une dette UX.

## P6 — État de fiche lisible

L’utilisateur doit comprendre l’état d’une fiche rapidement (statut, alertes, contexte scolaire / administratif).

Les couleurs et badges doivent transmettre une signification métier stable.  
Voir **DO-004**.

## P7 — Action primaire identifiable

Une action principale doit être facilement identifiable.  
Au plus **une action primaire** par écran (ou par zone d’action clairement délimitée).  
Voir **DO-002**.

## P8 — Actions destructives protégées

Les actions destructives nécessitent une confirmation explicite.  
Voir **DO-003**.

## P9 — États système explicites

Les états **loading**, **empty**, **error** et **forbidden** doivent être explicites, distincts et compréhensibles.  
Pas d’écran blanc, pas d’échec silencieux.

## P10 — Orientation permanente

L’utilisateur doit toujours savoir où il se trouve (module, entité, section).  
La navigation, le titre de page et le contexte de fiche doivent se renforcer, pas se contredire.

## P11 — Cohérence inter-modules

Les interfaces doivent être cohérentes entre modules : mêmes primitives, mêmes densités, mêmes libellés d’état, mêmes patterns d’alerte et d’empty.

## P12 — Accessibilité de base

Clavier, focus visible, libellés, rôles ARIA pertinents, hiérarchie de titres correcte.  
Les dialogs doivent rester utilisables au clavier.

## P13 — Réutilisation pragmatique

Les composants doivent être réutilisables.  
Ne pas multiplier les abstractions prématurément : factoriser un pattern seulement lorsqu’il est stable et répété.

## P14 — Trois questions de navigation métier

Toute navigation / écran métier doit permettre de répondre clairement :

1. **Où suis-je ?** — module, vue ou fiche, onglet, et contexte actif  
2. **Que puis-je faire ?** — prochaine action utile (voir aussi P3 / DO-006)  
3. **Comment revenir en arrière ?** — retour liste, breadcrumb, ou retour à l’onglet d’origine (DO-024)

Ces trois questions guident les revues UI.

---

## Mapping rapide principes → décisions

| Principe | Décision(s) |
|----------|-------------|
| P2 Résumé métier | DO-001 |
| P7 Action primaire | DO-002 |
| P8 Destructives | DO-003 |
| P6 / couleurs | DO-004 |
| P9 États système | DO-005 |
| P3 Workflow | DO-006 |
| P4 Données vivantes | DO-007 |
| P5 Aide à la décision | DO-008 |
| P10 Orientation | DO-009, DO-013 → DO-024 (navigation D1.2) |
| P11 Cohérence inter-modules | DO-011, Architecture navigation, Patterns Produit |
| P12 Accessibilité | DO-010, DO-020 |
| P13 Réutilisation pragmatique | DO-012, DO-022, DO-032 (Patterns) |
| P14 Trois questions de navigation | DO-009, DO-023, DO-024 |
| P2 Résumé + signature pages | DO-001, DO-028, Pattern P-001 |
