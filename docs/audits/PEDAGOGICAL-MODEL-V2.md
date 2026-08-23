# Architecture pédagogique V2 — décisions officielles

**Statut :** validé CTO (2026-08-23)  
**Base :** `origin/develop` `@c13df0ee5857dd86933fce33bad16eefe5b562cc`  
**Porte :** PR-0 inventaire live SELECT-only **avant** toute migration métier.

Ce document fige le modèle. Il ne migre rien.

---

## Décisions

1. **Pas** de colonnes fixes `filiere_id` / `serie_id` / `option_id` sur `classes`.
2. Orientation pédagogique **typée et hiérarchisable par pays** (taxonomie).  
   Une classe stocke à terme la **feuille** d’orientation. Les ancêtres se déduisent du catalogue.
3. `Filière → Série → Option` **n’est pas** une hiérarchie universelle.
4. **Groupe** = division locale de classe (`A` / `B` / `C`).  
   Ce n’est **pas** une confession, un réseau scolaire, ni un régime de gestion.
5. À la création : **Groupe facultatif**, valeur initiale **Aucun**, **jamais présélectionné**.
6. L’unicité structurelle doit couvrir `group_id IS NULL` **avant** d’autoriser les créations sans groupe.  
   L’index actuel `uq_classes_structural_offering` exclut précisément ces lignes (`WHERE group_id IS NOT NULL`).

---

## Ordre des PR

| PR | Objet | Condition |
|---|---|---|
| **PR-0** (cette livraison) | Inventaire PostgreSQL lecture seule + matrice STOP | aucune écriture |
| **PR-1** | `groupId` facultatif + unicité NULL + API/Web/Mobile | après diagnostic live |
| **PR-2+** | section / série / option / parent / applicabilité par niveau | après PR-1 |

Aucune classification silencieuse de `Bio-chimie`, `Générale`, `Sciences`, `Confession catholique`, etc.

---

## Ce que le schéma sait déjà / ne sait pas

| Capacité | État |
|---|---|
| `education_streams.stream_type ∈ filiere\|serie\|option` | présent |
| `classes.stream_id` unique | une seule orientation par classe |
| `parent_stream_id` | **absent** |
| `group_id` nullable en schéma | oui — « aucun backfill silencieux » |
| `groupId` requis en API / Web / Mobile | oui — incohérence à corriger en PR-1 |
| Libellé UI unique `trackLabel` (« Filière ») | écrase les types |

---

## Hors domaine Groupe

Catholique, protestant, conventionné, non conventionné, officiel : attributs d’**établissement** (régime / réseau).  
S’ils apparaissent dans `education_class_groups`, c’est une anomalie à tracer en PR-0, pas à convertir automatiquement.
