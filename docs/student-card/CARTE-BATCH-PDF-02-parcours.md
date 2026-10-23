# CARTE-BATCH-PDF-02 — PDF A4 depuis le document CR80

Statut : **DRAFT / HOLD**. Aucune fusion, aucun déploiement.

Le PDF ne déclenche pas d’émission. Il relit uniquement le fichier HTML `somafrik-card-batch-print-v1` enregistré par CARTE-BATCH-WEB-01. Les images QR de ce fichier sont recopiées. Les jetons ne sont pas redemandés au serveur, pas journalisés, et pas écrits dans `localStorage`, `sessionStorage` ou `IndexedDB`.

## Impression

- Page A4 portrait, 210 × 297 mm, à l’échelle réelle.
- Carte CR80, 85,60 × 53,98 mm, sans redimensionnement.
- Dix cartes par page (2 × 5) lorsque les marges extérieures restent d’au moins 5 mm et que le gouttière de 3,7 mm laisse passer des repères de 1,5 mm, décalés de 0,35 mm hors de la carte. Sinon huit cartes (2 × 4).
- Les pages supplémentaires sont ajoutées automatiquement.
- Le nom de l’établissement, la classe et le matricule ne sont dessinés que s’ils sont présents.

## Refus

Un document d’un autre format, incomplet, ou dont un QR ne correspond pas à son jeton, ne produit pas de PDF. Le message ne reprend ni identifiant, ni jeton.

Le fichier CR80 et le PDF généré sont des documents sensibles : leurs QR identifient les élèves.
