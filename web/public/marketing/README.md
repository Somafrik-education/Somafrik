# Visuels marketing — tableau de bord établissement

## Hero — `somafrik-dashboard-hero.webp`

Visuel marketing du tableau de bord Somafrik, basé sur l’interface produit.

| Champ | Valeur |
|---|---|
| Usage | Hero de la vitrine publique uniquement |
| Écran | Tableau de bord administrateur d’établissement |
| Profil affiché | Administrateur somafrik / AS |
| Périmètre | `CD-2026-0001` |
| Modules visibles | Scolarité, Paiements, Présences, Pédagogie, Administration, Taux de présence |
| Résolution | 1760 × 1400 |
| Encodage | WebP lossless |
| Poids | ~73 Ko |

Documenté uniquement comme visuel marketing. Les captures VITRINE-02 et VITRINE-03 restent les preuves officielles.

## Produit — `somafrik-dashboard-etablissement.webp`

| Champ | Valeur |
|---|---|
| Écran | Tableau de bord administrateur d’établissement |
| Route | `/tableau-de-bord` |
| Rôle | Administrateur d’établissement |
| Source | Capture runtime validée W02 (`docs/user-guides/assets/web/02-tableau-de-bord-etablissement.png`) |
| Données | Fictives uniquement (périmètre `CD-2026-0001`, compte « Somafrik Administrateur ») |
| Chrome navigateur | Absent |
| Résolution source | 1440 × 900 |
| Résolution asset | 1440 × 900 |
| Encodage | WebP lossless |

Aucune donnée personnelle réelle, aucun token, aucun secret.

## Application mobile — captures natives

Copies marketing de captures runtime déjà validées. Aucune génération, aucune reconstruction.

| Asset | Source | Écran |
|---|---|---|
| `mobile/somafrik-mobile-classes.webp` | `docs/user-guides/assets/mobile/02-classes-liste.png` | Liste des classes |
| `mobile/somafrik-mobile-eleves.webp` | `docs/user-guides/assets/mobile/04-eleves-liste.png` | Liste des élèves |
| `mobile/somafrik-mobile-enseignants.webp` | `docs/user-guides/assets/mobile/07-enseignants.png` | Liste des enseignants |

Résolution source et asset : 780 × 1688. Encodage WebP lossless. Données fictives (Institut Nouvelle Espérance).

## Preuves métier (VITRINE-03)

| Asset | Source | Écran | Rôle |
|---|---|---|---|
| `proofs/somafrik-finance-paiements.webp` | `12-paiements.png` | Liste des paiements | Comptable / Admin établissement |
| `proofs/somafrik-presences-appel.webp` | `16-presences-appel.png` | Appel des présences | Enseignant |
| `proofs/somafrik-evaluations.webp` | `17-evaluations.png` | Liste des évaluations | Enseignant |
| `proofs/somafrik-notes-saisie.webp` | `19-notes-saisie.png` | Saisie des notes (`TeacherGradesScreen`) | Enseignant |

`NOTES_RUNTIME_CAPTURE = FOUND`

Règle VITRINE-03 : uniquement des screenshots runtime de Somafrik. Aucune génération IA, aucun mockup reconstruit, aucune retouche de l’interface. Cadre CSS discret autorisé autour de la capture originale — pas de faux iPhone / Android.

Données QA de la capture Notes : évaluation `Contrôle de géographie`, classe `2ème A`, matière `Géographie`, Trimestre 1, /20, élèves fictifs `Amina Kabasele`, `Junior Mbala`, `Grâce Ilunga`, `Patrick Nsona`.
