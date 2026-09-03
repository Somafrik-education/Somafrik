# Dépliant et présentation Somafrik — kit Canva

Kit de présentation officielle : **captures runtime** de l’application web et mobile (données fictives), textes de la vitrine, formes et titres **éditables dans Canva**.

Aucune maquette reconstruite, aucun faux iPhone / Android. Les écrans viennent de `docs/user-guides/assets/` et de `web/public/marketing/`.

## Téléchargement (un clic)

Sur GitHub, ouvrir le lien puis **clic droit → Enregistrer sous…**, ou le bouton **Download raw file**.

| Fichier | Lien direct |
|---|---|
| **Kit complet (ZIP)** | [Somafrik-kit-Canva.zip](https://github.com/Somafrik-education/Somafrik/raw/cursor/depliant-canva-somafrik-0b46/docs/marketing/depliant-canva/Somafrik-kit-Canva.zip) |
| Dépliant Canva (PPTX) | [Somafrik-depliant-3-volets-Canva.pptx](https://github.com/Somafrik-education/Somafrik/raw/cursor/depliant-canva-somafrik-0b46/docs/marketing/depliant-canva/Somafrik-depliant-3-volets-Canva.pptx) |
| Présentation Canva (PPTX) | [Somafrik-presentation-Canva.pptx](https://github.com/Somafrik-education/Somafrik/raw/cursor/depliant-canva-somafrik-0b46/docs/marketing/depliant-canva/Somafrik-presentation-Canva.pptx) |
| Carte de visite administrateur pays (PPTX) | [Somafrik-carte-visite-administrateur-pays-Canva.pptx](Somafrik-carte-visite-administrateur-pays-Canva.pptx) |
| Carte de visite administrateur pays (PDF) | [Somafrik-carte-visite-administrateur-pays.pdf](Somafrik-carte-visite-administrateur-pays.pdf) |
| Dépliant PDF | [Somafrik-depliant-3-volets.pdf](https://github.com/Somafrik-education/Somafrik/raw/cursor/depliant-canva-somafrik-0b46/docs/marketing/depliant-canva/Somafrik-depliant-3-volets.pdf) |
| Présentation PDF | [Somafrik-presentation.pdf](https://github.com/Somafrik-education/Somafrik/raw/cursor/depliant-canva-somafrik-0b46/docs/marketing/depliant-canva/Somafrik-presentation.pdf) |

Il faut être connecté à GitHub sur le compte qui a accès au dépôt. L’onglet *Files changed* de la PR n’offre pas de bouton de téléchargement pour les binaires : utiliser les liens ci-dessus.

## Fichiers à ouvrir

| Fichier | Usage |
|---|---|
| [`Somafrik-depliant-3-volets-Canva.pptx`](Somafrik-depliant-3-volets-Canva.pptx) | **Dépliant A4 paysage, 3 volets** (recto + verso). À importer dans Canva. |
| [`Somafrik-presentation-Canva.pptx`](Somafrik-presentation-Canva.pptx) | **Présentation 16:9**, 6 diapos (couverture, web, mobile, preuves, fonctionnalités, appel à l’action). |
| [`Somafrik-carte-visite-administrateur-pays-Canva.pptx`](Somafrik-carte-visite-administrateur-pays-Canva.pptx) | **Carte 85 × 55 mm, recto-verso**, avec nom, pays, email et téléphone éditables. |
| [`Somafrik-carte-visite-administrateur-pays.pdf`](Somafrik-carte-visite-administrateur-pays.pdf) | Aperçu PDF recto-verso de la carte. |
| [`Somafrik-depliant-3-volets.pdf`](Somafrik-depliant-3-volets.pdf) | Aperçu / impression du dépliant. |
| [`Somafrik-presentation.pdf`](Somafrik-presentation.pdf) | Aperçu de la présentation. |
| [`previews/`](previews/) | PNG haute lisibilité de chaque page. |
| [`assets/`](assets/) | Logo + captures originales à glisser dans Canva. |

## Importer dans Canva (modifiable)

1. Aller sur [canva.com](https://www.canva.com) et se connecter.
2. **Créer un design** :
   - dépliant : *Document A4* en **paysage**, ou *Brochure* ;
   - projection : *Présentation (16:9)*.
3. Menu **Fichier → Importer des fichiers** (ou glisser-déposer le `.pptx` dans Projets).
4. Ouvrir le fichier importé. Canva convertit chaque diapositive en page :
   - les **textes** restent des blocs éditables (police Inter, disponible dans Canva) ;
   - les **fonds et cartes** sont des formes recolorables ;
   - les **captures** sont des images remplaçables.
5. Pour remplacer une capture : cliquer l’image → **Remplacer** → choisir un fichier de `assets/web/` ou `assets/mobile/`.
6. Adapter le texte, les couleurs ou l’ordre des pages, puis **Partager → Télécharger** (PDF impression, PNG, ou lien Canva).

Si l’import PPTX fusionne trop d’éléments, créer un design vide 16:9 (ou A4 paysage) et **glisser les PNG** de `previews/` comme fonds, puis superposer du texte Canva par-dessus.

## Contenu des 6 diapos (présentation)

1. **Couverture** — promesse + tableau de bord web réel
2. **Application web** — tableau de bord, classes, annuaire des élèves
3. **Application mobile** — classes, appel, notes, espace parent
4. **Preuves métier** — connexion, dossier élève, paiements, élèves
5. **Fonctionnalités et publics** — scolarité, pédagogie, finances, communication, pilotage
6. **Appel à l’action** — `somafrik.app` / `somafrik.app/connexion` + périmètre de sécurité

## Pliage du dépliant 3 volets

Format ouvert : **A4 paysage** (297 × 210 mm). Traits gris = plis.

| Face | Gauche | Centre | Droite |
|---|---|---|---|
| Recto (extérieur) | Dos / contact | **Couverture** | Rabat « Pourquoi Somafrik » |
| Verso (intérieur) | Application web | Modules | Application mobile |

Pliage lettre (pli roulé) : rabat droit vers le centre, puis volet gauche par-dessus. La couverture se retrouve à l’extérieur.

## Identité

- Bleu marque `#1d4ed8` · encre `#0f172a` · teal `#0f766e` · fond `#f7f9fc`
- Copie alignée sur `web/src/data/marketingContent.ts`
- Contact public : [somafrik.app](https://somafrik.app)

## Personnaliser la carte administrateur pays

1. Importer `Somafrik-carte-visite-administrateur-pays-Canva.pptx` dans Canva.
2. Remplacer uniquement les champs entre crochets : `[PRÉNOM NOM]`, `[PAYS]`, email et téléphone professionnel.
3. Conserver le titre officiel **Administrateur pays** et l’identité visuelle Somafrik.
4. Exporter en **PDF pour impression**. Le format fini est 85 × 55 mm ; demander à l’imprimeur d’ajouter 3 mm de fond perdu si son procédé l’exige.

## Régénérer les fichiers

```bash
python3 -m pip install --user python-pptx pillow
python3 docs/marketing/depliant-canva/build_depliant.py
```

Cette commande régénère aussi la carte de visite, ses aperçus, ses PDF et le ZIP complet. Si Inter n’est pas installée, le générateur utilise automatiquement DejaVu Sans.
