# Anti-patterns Produit Somafrik

**Statut :** normatif — introduit D1.3 (amendement CTO)  
**Usage :** détecter rapidement les dérives en revue de PR  
**Références :** [Patterns Produit](./patterns-produit.md) · [Décisions](./decisions-officielles.md) · [Pages métier](./architecture-pages-metier.md)

## Intention

Les Patterns Produit (P-00X) décrivent **ce qu’il faut faire**.  
Les Anti-patterns (AP-00X) décrivent **ce qu’il ne faut jamais faire**.

En revue :

- `Anti-pattern AP-002 détecté.`
- `Aucun Anti-pattern introduit.`

---

## Catalogue

### AP-001 — Plus d’une action primaire sur une même page

| Attribut | Valeur |
|----------|--------|
| **Interdit** | Plusieurs boutons / CTA de poids `primary` concurrents sur le même écran (ou la même zone d’action) |
| **Pourquoi** | Dilue la prochaine action ; contredit DO-002 / DO-029 |
| **Correctif** | Une seule action primaire ; le reste en secondaire / contextuelle |
| **DO liés** | DO-002, DO-029 |

---

### AP-002 — Une fiche sans résumé métier

| Attribut | Valeur |
|----------|--------|
| **Interdit** | Ouvrir une fiche métier (élève, enseignant, classe, parent, facture, paiement, contrat, salle, véhicule, ouvrage… ) sans Résumé métier en tête — sauf exception dûment justifiée en PR |
| **Pourquoi** | Brise la signature Somafrik ; empêche la décision rapide |
| **Correctif** | Appliquer P-001 / DO-028 avant le détail |
| **DO liés** | DO-001, DO-028 |

---

### AP-003 — Une action destructive sans confirmation

| Attribut | Valeur |
|----------|--------|
| **Interdit** | Supprimer, résilier, rejeter, annuler définitivement… sans confirmation explicite |
| **Pourquoi** | Risque d’erreur irréversible ; contredit DO-003 |
| **Correctif** | `ConfirmDialog` (ou équivalent) avec impact nommé |
| **DO liés** | DO-003, DO-029 |

---

### AP-004 — Une navigation qui fait perdre le contexte

| Attribut | Valeur |
|----------|--------|
| **Interdit** | Après une action locale (ex. ajouter un document), renvoyer vers un niveau supérieur non demandé (liste, autre module, onglet par défaut) ; ou basculer établissement / année sans geste explicite |
| **Pourquoi** | Perte d’orientation et de confiance ; contredit DO-023 / DO-024 / P14 |
| **Correctif** | Revenir à l’onglet / contexte d’origine ; changements de contexte explicites |
| **DO liés** | DO-023, DO-024 |

---

### AP-005 — Des statuts exprimés uniquement par une couleur

| Attribut | Valeur |
|----------|--------|
| **Interdit** | Encoder un statut critique seulement par une couleur (sans libellé / icône / texte accessible) |
| **Pourquoi** | Ambiguïté et échec d’accessibilité ; contredit DO-004 / DO-010 |
| **Correctif** | Libellé + tone Badge ; la couleur renforce, elle ne suffit pas |
| **DO liés** | DO-004, DO-010 |

---

### AP-006 — Informations critiques masquées sous plusieurs niveaux d’onglets

| Attribut | Valeur |
|----------|--------|
| **Interdit** | Enterrer alertes, échéances, risques ou actions urgentes derrière 2+ niveaux d’onglets / sections sans signal en tête de fiche |
| **Pourquoi** | L’utilisateur rate l’essentiel ; contredit DO-006 / DO-007 / DO-028 |
| **Correctif** | Faire remonter le signal dans le Résumé métier / alertes de premier niveau |
| **DO liés** | DO-006, DO-007, DO-028 |

---

## Gouvernance

1. Toute PR UI D2.x+ est revue contre ce catalogue (checklist Framework).
2. Introduire un nouvel Anti-pattern = amendement documentaire + validation CTO.
3. Un Anti-pattern détecté bloque l’acceptation sauf dérogation explicite CTO / produit.

---

## Journal

| ID | Titre | Introduit |
|----|-------|-----------|
| AP-001 | Plus d’une action primaire sur une même page | D1.3 |
| AP-002 | Une fiche sans résumé métier | D1.3 |
| AP-003 | Une action destructive sans confirmation | D1.3 |
| AP-004 | Une navigation qui fait perdre le contexte | D1.3 |
| AP-005 | Des statuts exprimés uniquement par une couleur | D1.3 |
| AP-006 | Informations critiques masquées sous plusieurs niveaux d’onglets | D1.3 |
