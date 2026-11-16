# BULLETIN-CATALOG-01 — fidélité des modèles La Colombière et Le Berceau de la Sagesse

Statut : **Remplacé par le rectificatif CTO** — La Colombière et Le Berceau de la Sagesse sont des références pédagogiques, pas des documents à reproduire ; l'absence des originaux n'est plus bloquante. Voir `BULLETIN-CATALOG-01.md`. (Historique : HOLD — validation visuelle impossible faute d'originaux.)

## 1. Références originales : introuvables dans le dépôt et la session

| Recherche | Résultat |
|---|---|
| Fichiers du dépôt (`*.pdf`, `*.png`, `*.jpg`, `*.webp`, `*.heic`, noms « colomb », « berceau », « sagesse », « rose ») | Aucun original. Seuls les PDF **générés** par Somafrik (`docs/project/bulletin-ui-01/`). |
| Historique git (fichiers supprimés, messages de commit) | Aucun original. |
| Artefacts source LOT 11 (`report_card_source_artifacts`) | Stockage d'environnement (base + volume), non accessible depuis cette session. |
| Documentation | Description **textuelle** seulement : `docs/audits/report-card-framework-multicountry.md` §1.3 ; fixtures de qualification `backend/lib/reportCard/qualification/model-{a,b}.json` (LOT 10). |

**Conséquence :** la comparaison visuelle demandée (en-têtes, dimensions, tableaux, couleurs, typographie) ne peut pas être faite sans les deux documents. La comparaison ci-dessous porte sur la **structure documentée**, pas sur l'image.

**Demande au CTO :** fournir les deux originaux (PDF ou photos lisibles, recto/verso si besoin), par exemple dans `docs/project/bulletin-references/` (données nominatives masquées) ou comme artefact source d'une demande de modèle. Dès réception : comparaison visuelle page à page, cotes, captures côte à côte.

## 2. Comparaison structure documentée ↔ PDF Somafrik actuel (BULLETIN-UI-01)

PDF comparés : `docs/project/bulletin-ui-01/modele-A-la-colombiere-annuel.pdf` et `modele-B-berceau-de-la-sagesse-annuel.pdf` (rendu Chromium réel, A4 portrait).

### 2.1 La Colombière (audit §1.3 « Modèle B — lignes » ; fixture `qualification/model-b.json`)

| Élément | Original (documenté) | PDF Somafrik actuel | Écart |
|---|---|---|---|
| Lignes | Une matière = une ligne, sans groupes | Une ligne par matière | Conforme |
| Colonnes | `T.J`, `EX`, `Total` × 3 trimestres ; « maxima distincts » | Par trimestre : bloc **Maxima** (TJ, EX, Total) **puis** bloc **Obtenu** (TJ, EX, Total) | **Probable écart** : l'original semble placer les maxima en une colonne par matière, puis T.J / EX / Total par trimestre. Ordre et nombre de colonnes à vérifier sur l'original. |
| Matières sans EX | Certaines matières sans examen (TPA, Religion-Morale /10), sans 0 artificiel | « — » (non applicable), jamais 0 | Conforme |
| Bilan annuel | Maximum, total, pourcentage, classement | Total annuel (Max, Obtenu) + lignes Total / Pourcentage / Rang | Conforme sur le contenu ; disposition à vérifier |
| Appréciations | Par trimestre **et** annuelle | Une seule zone « Appréciations » libre | **Écart** : pas d'appréciation par trimestre ; aucun texte d'appréciation dans le modèle canonique |
| Décision | Décision de fin d'année | Affichée seulement si un créneau DECISION existe (absent du gabarit utilisé) | **Écart** (la fixture LOT 10 prévoit `COL_DECISION`) |
| Visas | Enseignant / parents / directeur | Signatures configurables (3 zones) | Conforme sur le principe ; place et intitulés à vérifier |
| En-tête | Non décrit | « Bulletin » + référence + date ; identité (établissement, élève, matricule, classe, année) | **À vérifier** : en-tête officiel (République, ministère, logo, direction provinciale…), effectif |
| Format | Non décrit | A4 portrait | **À vérifier** (un bulletin à 3 trimestres × 3 colonnes est souvent en paysage) |

### 2.2 Le Berceau de la Sagesse (audit §1.3 « Modèle A — bulletin rose, domaines » ; fixture `qualification/model-a.json`)

| Élément | Original (documenté) | PDF Somafrik actuel | Écart |
|---|---|---|---|
| Regroupement | Matières regroupées par domaines (Français, Kirundi, Étude du milieu, Mathématiques, Arts, Anglais…) avec sous-matières | Matière principale + sous-matières indentées, sous-total | Conforme sur le principe |
| Composantes | Fixture LOT 10 : **une note de période** par sous-matière (`COMPONENT_PERIOD`) ; audit : « composantes de notation distinctes » | **TJ et EX** par sous-matière (mandat UI-01) | **Écart à trancher** : la fixture d'origine n'a pas de séparation TJ/EX ; seul l'original peut dire lequel est juste |
| Maxima | Maxima par matière | Maxima par sous-matière et sous-total de la matière principale | À vérifier (maxima affichés au niveau domaine ou sous-matière ?) |
| Totaux | Total par trimestre, maxima annuels, points obtenus, pourcentage, total général, place | Total / Pourcentage / Rang par trimestre et annuel | Conforme sur le contenu |
| Identité | Établissement, élève, classe, année, **effectif** | Établissement, élève, matricule, classe, année ; effectif seulement dans « rang / effectif » | **Écart** : effectif non affiché comme champ d'identité |
| Signatures | Titulaire et parents | Configurables (2 zones dans l'exemple) | Conforme sur le principe |
| Couleur | « Bulletin rose » | Noir et blanc | **Écart** (fond / bandeaux colorés à reproduire si exigé) |
| En-tête, format | Non décrits | Comme La Colombière | **À vérifier** |

### 2.3 Points communs à vérifier sur les originaux

Dimensions et marges, orientation, en-tête institutionnel et logo, position du QR de vérification et de la référence, police et tailles, largeur des colonnes, libellés exacts (« T.J » vs « TJ », « Place » vs « Rang », « Maxima »), lignes de conduite / assiduité éventuelles, mentions légales, verso.

## 3. Conséquences sur BULLETIN-CATALOG-01

1. **Arrêt de l'implémentation du catalogue** (correctif CTO). Le travail déjà commencé (migration catalogue, service, parcours école) est conservé sur la branche `feat/bulletin-catalog-01` comme **brouillon de travail**, sans PR, sans Ready, sans fusion.
2. Les deux modèles « Bulletin classique » / « Bulletin à sous-matières » de ce brouillon sont **retirés comme références** : le catalogue devra proposer « La Colombière » et « Le Berceau de la Sagesse », dont les aperçus seront générés par les **vrais gabarits Somafrik** (rendu PDF réel), jamais par des illustrations.
3. Correction des gabarits après réception des originaux : présentation uniquement (adaptateur de présentation, `canonical.css`, bloc `presentation` du gabarit). **Aucune modification** du moteur `somafrik.report_card.v1`, des snapshots publiés ni des permissions.
4. Décisions CTO nécessaires : séparation TJ/EX ou note unique pour Le Berceau de la Sagesse ; appréciations par trimestre (nécessitent une donnée nouvelle, hors moteur actuel) ; orientation ; couleur.
