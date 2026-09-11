# Contrat UX — Pédagogie L3 (Notes & évaluations)

**Statut :** contrat de test L3 — **pas** une parité pixel Web/Mobile.  
**Surfaces :** Web `/notes` · Mobile `TeacherGrades` / `StudentNotes`.  
**Constantes machine :** `web/src/lib/pedagogyParityContract.ts` et `Mobile/src/lib/pedagogyParityContract.ts`.

---

## 1. Ce que la maquette impose (texte, pas pixels)

Vocabulaire unique, même fonction = même libellé :

| Fonction | Libellé |
| --- | --- |
| CTA créer | Nouvelle évaluation |
| CTA modifier | Modifier |
| CTA saisie | Saisir les notes |
| CTA lecture seule | Consulter |
| Enregistrement notes | Enregistrer les notes |
| Formulaire évaluation | Enregistrer |
| Valider (préfet/admin) | Valider |
| Publier (préfet/admin, métier existant) | Publier |
| Retour liste | Retour |
| Champ poids | Coefficient |

### Architecture du module

Entrée unique **Notes & évaluations** :

1. **Évaluations** — liste synthétique.
2. **Saisie des notes** — Classe → Matière/Cours → Évaluation → liste des élèves (pas un écran par élève).
3. **Consultation** — mêmes notes canoniques, par évaluation / élève / période. Aucun bulletin ni moyenne de classe inventée hors moteur déjà présent.

### Carte / ligne évaluation (champs visibles)

**Résumé fermé (Mobile, PED-L3-12 amendé 2026-09-11 / DO-047) :** Intitulé · Classe • Cours · Statut · progression de saisie (`N/M`). CTA **Saisir les notes** / **Consulter** visible même carte fermée.

**Zone dépliée :** Période · Date · Barème · Coefficient · Enseignant · **Modifier** / **Valider** / **Publier**.

Web (tableau) : Intitulé · Cours · Classe · Période · Date · Coefficient · Enseignant · Statut · progression `N/M` ; CTA Saisir sur la ligne.

### Saisie

- Web : tableau dense, enregistrement en masse.
- Mobile : cartes élève, champ note + absence, CTA bas de liste, cibles ≥ 44 dp, clavier décimal.
- Barème visible (`/20`). Absence réellement supportée (`Abs` / statut Absente). Pas de « non-noté » inventé au-delà de l’absence / note vide.

### Filtres

Période et statut (Tous / À valider pour les rôles qui valident). Mobile : puces, pas un tableau compressé.

### RBAC

Mêmes droits Notes:READ/CREATE/UPDATE. Valider et Publier : préfet/admin uniquement (enseignant 403 serveur). Parent/élève : notes des évaluations **Publiée** uniquement.

---

## 2. Web

- Tableaux lisibles, filtres rapides, espace horizontal.
- CTA **Saisir les notes** depuis la ligne d’évaluation (ouvre la saisie sur cette évaluation).
- Formulaire création/édition : Classe, Cours, Enseignant, Période, Type, Titre, Date, Barème, **Coefficient** ; `classId` canonique si la classe existe.

Viewports de recette : **360 / 768 / 1024 / 1440 px**.

---

## 3. Mobile

- Cartes, liste compacte, CTA principal évident.
- Création : Classe/cours (affectations), Période, Type, Date, Barème, **Coefficient**, Titre.
- Liste : filtres période/statut ; cartes `ExpandableEntityCard` — résumé = titre, classe • cours, statut, progression `N/M`, CTA Saisir/Consulter ; méta coef/date/enseignant et Modifier/Valider/Publier en zone dépliée.
- Saisie : roster de la classe (classId, sinon classCode, sinon className).
- Consultation élève/parent : notes publiées + moyenne pondérée des **coefficients d’évaluation**, jamais le coefficient matière à la place.

Viewports : **360 / 390 / 430 dp**.

---

## 4. Interdit

- « Ajouter résultat » / « Créer une évaluation » pour la même fonction que « Saisir les notes » / « Nouvelle évaluation ».
- Tableau desktop recalé au pixel près sur Mobile.
- Données démo, fixtures UI, fallback silencieux.
- Inventer un calcul de bulletin non fourni par le backend.
