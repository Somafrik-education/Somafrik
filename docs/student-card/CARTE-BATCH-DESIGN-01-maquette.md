# CARTE-BATCH-DESIGN-01 — une seule maquette pour toutes les impressions de cartes

Statut : **DRAFT / HOLD**. Aucune fusion, aucun déploiement. CARTE-BATCH-SMOKE final suspendu jusqu’à la validation visuelle.

## Constat

Le lot par classe (#986, #988) n’utilisait pas la maquette validée CARTE-UI-01 / P1 « Bandeau institutionnel » (#979). Le HTML CR80 construisait un rectangle blanc avec du texte empilé ; le PDF A4 dessinait un troisième modèle. Ni le logo ni la photo n’étaient transportés.

## Correctif

Une seule référence : `web/src/lib/studentCardDesign.ts` (`STUDENT_CARD_P1`).

| Rendu | Source de la mise en page |
| --- | --- |
| Carte individuelle | `StudentCardFace` + CSS `studentCardFaceCss()` (produit depuis `STUDENT_CARD_P1`) |
| HTML CR80 par classe | le même composant `StudentCardFace`, rendu tel quel, avec le même CSS |
| PDF A4 | `studentCardBatchPdf` dessine les cotes et couleurs de `STUDENT_CARD_P1` |

Le CSS de la carte n’est plus recopié dans `index.css` : il est produit depuis les cotes de la maquette. Le CSS généré est identique, octet pour octet, au bloc validé par CARTE-UI-01. La carte individuelle ne change donc pas.

Éléments de la maquette présents dans les trois rendus : bandeau institutionnel, logo de l’établissement, photo de l’élève ou initiales, identité structurée au centre, QR de 23 mm à droite, référence abrégée de la carte, pied de carte Somafrik.

## Feuille A4

- Page A4 portrait, cartes CR80 85,60 × 53,98 mm à l’échelle réelle.
- Même grille dans le HTML et le PDF : 10 cartes par page (2 × 5), sinon 8, gouttière de 3,7 mm.
- Mêmes repères de découpe (1,5 mm, décalés de 0,35 mm, hors de la carte).
- Le QR garde sa zone de silence de 4 modules et l’image d’origine. Le PDF vérifie toujours que chaque QR relit son jeton.

## Document source `somafrik-card-batch-print-v2`

La source JSON intégrée au HTML est étendue. Les jetons, leur format et leur ordre ne changent pas.

- `schoolLogo` : logo de l’établissement.
- `cards[].photo` : photo de l’élève.

Chaque élément visuel a un état explicite :

| État | Signification | Impression |
| --- | --- | --- |
| `embedded` | image PNG ou JPEG intégrée (data URL, signature vérifiée, 200 Ko au plus) | image |
| `absent` | pas de logo enregistré, ou pas de photo pour l’élève | emplacement vide (logo), initiales (photo) |
| `unavailable` | l’image existe mais n’a pas pu être intégrée lors de la production | emplacement vide (logo), initiales (photo) |
| `not_in_source` | document v1, antérieur à ce correctif | emplacement vide (logo), initiales (photo) |

Le logo et les photos sont récupérés une seule fois, au moment de produire le document CR80, puis recadrés aux dimensions de la maquette. Aucun jeton ni identifiant n’accompagne ces requêtes. Une image qui ne peut pas être intégrée ne bloque pas l’activation du lot : l’opérateur voit la liste des éléments manquants.

## Réimpression des documents déjà générés

Les documents `somafrik-card-batch-print-v1` restent lisibles par le PDF A4. Ils ne contiennent ni logo ni photo. Le PDF est donc produit avec la maquette P1, sans logo et avec les initiales, et l’écran l’indique explicitement. Rien n’est inventé, rien n’est recherché après coup, aucune carte n’est réémise ni remplacée.

## Garanties de #986 et #988 conservées

- Aucune nouvelle émission, aucune activation, aucun appel aux routes de lot depuis le PDF.
- Le document CR80 reste obligatoire avant activation et doit être relu sans perte de jeton.
- Les secrets n’apparaissent jamais dans la partie visible du HTML, ni dans le texte du PDF.
- Aucun stockage `localStorage`, `sessionStorage` ou `IndexedDB`.

## Limite connue

Le PDF utilise les polices standard Helvetica (pas de dépendance supplémentaire) ; le HTML et la carte individuelle utilisent Inter. Les cotes, couleurs, tailles et positions sont identiques, seule la forme des caractères diffère légèrement.

## Tests

- `studentCardDesign.test.ts` : les mêmes cartes dans les trois rendus (carte individuelle, HTML CR80, PDF A4).
- `studentCardBatchPrintable.test.ts` : balisage identique à `StudentCardFace`, logo et photo transportés, document v1 relu, image altérée refusée, grille A4.
- `studentCardBatchPdf.test.ts` : cotes P1 dans le PDF (bandeau, QR à droite, photo, pied), réimpression v1, images altérées refusées.
