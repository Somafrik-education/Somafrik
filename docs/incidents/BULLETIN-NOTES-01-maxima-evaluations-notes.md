# BULLETIN-NOTES-01 — Notes publiées non reprises et discordance /20 → /10

**Date de constat :** 2026-11-05  
**Environnement :** préproduction uniquement, établissement `CD-2026-0001`, classe `2ème A`, année `2026-2027`.  
**Statut :** audit documentaire ; aucune mutation des notes/configurations ; **HOLD publication officielle** tant que les anomalies bloquantes persistent.

## Constat (captures utilisateur)

- Dans « Notes & évaluations », les évaluations de Technologie (« L'IA »), Histoire (« Le fleuve Congo »), Géographie (« La RDC »), Physiques (« La pression ») sont publiées sur **20**.
- Dans l'aperçu non officiel Colombière, certaines cellules du trimestre 1 restent « Manquante » malgré des évaluations publiées ; pour Histoire et Technologie, les maxima du bulletin valent **10**.
- Les anomalies visibles sont notamment `MAX_INCONSISTENT` et `COEFFICIENT_NOT_SUPPORTED`, plus « Note manquante (note non saisie) ».
- Les totaux et pourcentages affichés sont **provisoires** en présence de notes manquantes ; le rang reste « Non classé ».

## Éléments vérifiés en lecture seule (Supabase Somafrik-preprod)

La liaison active est `model_key=catalog-colombiere`, profil version **2**, activé le 2026-11-05 à 04:57:53 UTC. Le profil versionné contient :

- `fact_sources.components.TJ.aggregation = sum` ; types `composition`, `devoir`, `interrogation`, `tp` ;
- `fact_sources.components.EX.aggregation = sum` ; type `examen` ;
- T1/T2/T3 associés à `trimestre 1/2/3` ;
- maxima **TJ=10 / EX=10** pour `003` Histoire, `012` Technologie, `C1` Chimie ; maxima **20/20** pour `001` Mathématiques, `002` Physiques, `004` Géographie, `A1` Anatomie.

Évaluations actives de la classe, trimestre de l'année courante (contrôle agrégé sans liste nominative) :

| Matière (code) | Évaluation / type | Maximum de l'évaluation | Coef. | Notes publiées |
|---|---|---:|---:|---:|
| Technologie (012) | L'IA / interrogation | 20 | 1 | 9 |
| Histoire (003) | Le fleuve Congo / examen | 20 | 1 | 9 |
| Chimie (C1) | L'atome / interrogation | 20 | 1 | **0** |
| Géographie (004) | La RDC / examen | 20 | 1 | 9 |
| Géographie (004) | Interrogation / interrogation | 20 | 1 | 9 |
| Géographie (004) | Devoir / devoir | 20 | **3** | 6 |
| Physiques (002) | La pression / examen | 20 | 1 | 9 |
| Anatomie (A1) | le corp humain / interrogation | 20 | 1 | 9 |

Autres interrogations Géographie également présentes ; pour `sum`, plusieurs maxima à 20 peuvent excéder le maximum TJ=20. Ceci est à distinguer du cas de Histoire/Technologie où une seule évaluation à 20 excède déjà le maximum 10.

## Cause technique dans le code (develop après PR #1070)

`backend/lib/reportCard/reportCardFactBuilder.js` :

1. `indexSources()` mappe le code du type d'évaluation à TJ/EX, et la période de l'évaluation à T1/T2/T3.
2. `gradePublication()` considère une note publiée uniquement si `grades.publication_status=published` **et** `evaluations.status=published`.
3. `aggregateCell()`, pour `aggregation=sum` :
   - refuse toute évaluation de coefficient != 1 → `COEFFICIENT_NOT_SUPPORTED` ;
   - exige `SUM(evaluation.max_score) == profile.subjects[].components[component].max` → `MAX_INCONSISTENT` ;
   - refuse de transformer une note manquante en zéro et ne convertit pas silencieusement une note /20 en /10.
4. `buildPublicationFacts()` omet la cellule calculée lorsqu'une de ces erreurs bloquantes apparaît ; le moteur affiche alors une valeur manquante, même si la note source est publiée.

**Conclusion :** défaut de cohérence **configuration du modèle ↔ barèmes/coefficients des évaluations**, et non défaut général de publication des notes. **Chimie est distinct** : évaluation publiée mais 0 note individuelle en base (statut d'évaluation et saisie des notes sont deux choses différentes).

## Décision proposée, non implémentée

- **P0 publication :** ne jamais publier un bulletin portant des anomalies `MAX_INCONSISTENT` / `COEFFICIENT_NOT_SUPPORTED` / manques ; afficher les cellules non calculables comme « — / non calculable » et ne pas présenter un pourcentage partiel comme définitif.
- **P1 fonctionnel :** arbitrage produit explicite par établissement et par composante :
  - soit utiliser `weighted_average` pour normaliser chaque évaluation selon son maximum (/20 → /10), et pondérer par coefficient ;
  - soit conserver `sum` en exigeant des barèmes et coefficients compatibles. **Aucune conversion automatique implicite**.
- **P1 cohérence :** validation avant activation/aperçu sur les évaluations réelles de la classe et sur les barèmes de toutes les matières.
- **P1 Chimie :** lister précisément les élèves sans note dans l'évaluation ; ne pas fabriquer de note 0.
- **Tests ciblés à ajouter lors du correctif :** /20 vers /10 en `weighted_average`, coefficient 3, deux interrogations /20 sur TJ /20, examen /20 sur EX /10, évaluation publiée sans aucune note, sécurité multi-tenant, conservation de la publication et provenance.

## Contraintes CTO

Ne pas modifier les notes brutes `grades`, les barèmes `evaluations`, ni le profil versionné actif sans mandat de correction explicite et tests PostgreSQL + smoke réel. Aucune publication et aucun déploiement dans cette PR documentaire. Avant tout merge : diff GitHub indépendant, HEAD figé, CI verte, absence de conflit et revue résolue.
