# Contrat UX Mobile — Progressive disclosure

**Statut :** normatif — **GO CTO 2026-09-11**  
**Décision :** [DO-047](./decisions-officielles.md)  
**Pattern :** [P-011](./patterns-produit.md)  
**Anti-pattern :** [AP-013](./anti-patterns.md)  
**Audit :** PR #597 (Draft, non fusionnée comme PR d’implémentation)  
**Périmètre :** application native `Mobile/` uniquement. Aucun Web. Aucun backend.

Ce contrat gèle le modèle **carte fermée / carte ouverte** pour les collections d’objets métier.  
Il n’autorise pas une refonte globale : migration par lots, une PR par module.

---

## 1. Règle

Une **collection d’objets métier** se présente en cartes synthétiques **fermées par défaut**.

La carte fermée permet d’**identifier** l’objet et son **état**.  
Les détails secondaires et les actions métier (sauf exception nommée) se révèlent après **tap / chevron / « Voir détails » / ouverture de fiche**.

## 2. Carte fermée — contenu autorisé

- Identité (nom, titre, horaire + cours)
- Un sous-titre discriminant (classe, code, `classe • cours`)
- Un badge d’état (statut, lu/non lu, montant dû, présence)
- Chevron ou destination explicite
- **Au plus une** action primaire si le workflow quotidien l’exige — exception **nommée** ci-dessous

## 3. Carte ouverte — contenu

- Méta (dates, coefficient, contacts, audience, ventilation)
- Actions secondaires (Modifier, Archiver, Valider, Publier, PDF, Remplacer, Annuler)
- Sous-listes (lignes de paiement, pièces jointes)

## 4. Décisions CTO figées (2026-09-11)

| Sujet | Décision |
| --- | --- |
| CTA Notes `Saisir` / `Consulter` | **Option A** — reste visible même carte fermée |
| `Modifier` / `Valider` / `Publier` | Zone ouverte uniquement |
| PED-L3-12 | **À amender avant** toute modification de `TeacherGrades` : coef, enseignant, date **plus obligatoires** dans le résumé fermé ; **progression `N/M` reste visible** |
| Appel | **Exception métier** — pas d’accordion sur les 4 statuts. Pattern Roll-call compact, choix immédiatement accessibles |
| Messages | **Fil + modal** — pas une carte dépliable |
| `AdminCrudScreen`, `MenuScreen`, `PlatformNotificationsScreen` | **Pas de réactivation** |

## 5. Exceptions nommées (ne pas accordion)

| Surface | Pourquoi |
| --- | --- |
| Login, accueil, sélection de rôle | Auth / onboarding |
| Accueil KPI + actions rapides | Tableau de bord |
| Menus (tiroir, hub Paramètres) | Navigation |
| Formulaires (création, profil, structure pédagogique, composer) | Le contenu principal = les champs |
| Fiche élève | Destination, pas une liste |
| Roster saisie de notes | Espace de travail |
| **Appel — 4 statuts** | Vitesse métier — pattern Roll-call |
| Messages | Fil → modal |
| États chargement / vide / erreur | Doivent rester explicites |

## 6. Comportement

- `defaultExpanded = false`
- `accessibilityState.expanded` + libellé « Afficher / Masquer les détails »
- Cible tactile du résumé ≥ 44 dp (primitive Entity vise 68)
- Listes longues : une carte ouverte à la fois
- Tap résumé bascule ; les CTA internes n’utilisent pas le même handler
- Pas de navigation implicite sur le tap résumé si une fiche existe : CTA « Ouvrir la fiche » dans la zone ouverte

## 7. Primitive

Référence actuelle : `ExpandableEntityCard` (Finance = alias `ExpandableFinanceCard`).  
Communication conserve `ExpandableCommunicationCard` jusqu’au lot tokens (P2).  
L’Appel n’utilise **pas** cette primitive pour les 4 statuts.

## 8. Migration

Ordre CTO : Lot 0 (ce contrat) → PD-05 Finance élève → Enseignants → Appel → Évaluations → Utilisateurs → Bulletins/EDT → P2.

Chaque lot : tests RED → correction → GREEN → diff GitHub indépendant au HEAD exact → Ready/merge.  
Une PR par lot. Pas de fusion de la PR d’audit #597 comme PR d’implémentation.
