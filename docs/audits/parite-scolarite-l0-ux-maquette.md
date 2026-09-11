# Contrat UX — Scolarité L0 (mobile d’abord)

**Statut :** maquette textuelle de test — **pas** une parité pixel Web/Mobile.  
**Surfaces :** hub Scolarité, Classes, Élèves / inscriptions.  
**Viewports de recette :** Mobile 360 / 390 dp ; Web 1024 / 1440 px.

La parité porte sur **concepts, labels, données, actions, ordre logique**. Le Web reste en table desktop ; le Mobile reste en cartes.

---

## 1. Écran principal Scolarité

### En-tête

- Titre : `Scolarité`
- Année scolaire active (`isCurrent`) ou état explicite `Aucune année scolaire active`
- Nom d’établissement si le contexte le porte déjà

### Indicateurs (permissions fail-closed)

- Élèves → liste élèves
- Classes → liste classes
- Enseignants → liste enseignants (déjà présent, conservé)
- Alerte effectif : élèves sans classe affectée

Un indicateur disparaît s’il n’a pas la permission de lecture. 403 ≠ `0` succès.

### Actions principales (ordre)

1. Classes
2. Élèves
3. Inscriptions (ouvre Classes : l’inscription se fait depuis une classe existante)
4. Structure pédagogique (si `Paramètres Établissement:READ`)
5. Année scolaire (si `Paramètres Établissement:READ`)

Pas de nouvelle fonction métier. Pas d’action qui a l’air d’un succès sans API.

### États

| État | Copie |
| --- | --- |
| Chargement | `Chargement de la scolarité…` |
| Vide classes | `Aucune classe n'est encore créée pour cet établissement.` |
| Vide élèves | `Aucun élève inscrit. Ouvrez une classe puis « Inscrire un élève ».` |
| Erreur API | message serveur, pas une liste vide |
| Accès interdit | `Accès non autorisé` existant |
| Pas d’année active | `Aucune année scolaire active` + lien Paramètres |
| Pas de structure | conservé à la création de classe (niveaux/groupes inactifs) |

---

## 2. Classes

### Mobile (cartes, tactile ≥ 44 dp)

- Pas de tableau compressé
- Carte : nom canonique, effectif, année, statut FR (`Actif` / `Inactif`)
- Tap → élèves de la classe
- CTA créer si `Classes:CREATE` et réseau
- Classe synthétique `CLASS-${nom}` **interdite** à l’affichage

### Web (table desktop)

- Mêmes colonnes métier : nom, niveau, filière, groupe, année, effectif, statut, actions
- Lien structure : `/parametres/structure` (plus `/configuration`)
- Statuts en français dans filtres et cellules

---

## 3. Élèves / inscriptions

### Mobile

- Lignes/cartes : nom, classe, statut
- Retour cohérent vers Classes si ouvert depuis une classe
- Inscription : flux existant `POST /classes/:code/students`

### Web

- Table : nom, prénom, matricule, classe, statut, année, dossier
- Création toujours depuis une classe (pas de bouton Ajouter sur l’annuaire)

---

## 4. Ce que la maquette n’impose pas

- Reproduction pixel du Web
- Transfert d’inscription (C18) tant qu’il n’existe pas d’API
- Superadmin / Admin Pays
- Refonte Enseignants / Comptes / Parents (tuiles secondaires conservées)
