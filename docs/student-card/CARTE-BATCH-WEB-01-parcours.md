# CARTE-BATCH-WEB-01 — Émission des cartes élèves par classe

**DRAFT / HOLD — aucune fusion, aucun déploiement.**

L'administrateur scolaire ouvre une classe et prépare les cartes QR des élèves éligibles. Le PDF A4 imprimable est le lot suivant (CARTE-BATCH-PDF-02). Ce parcours n'active rien à partir du seul aperçu.

## Parcours

1. **Classes → Cartes élèves.** Le bouton « Émettre / exporter les cartes » apparaît sur chaque classe lorsque le compte a `Élèves:UPDATE`. Un administrateur plateforme, un administrateur pays, un enseignant ou un comptable ne l'ont pas.
2. **Précontrôle.** Le dialogue affiche les élèves éligibles, les cartes déjà actives (non réexportées) et les élèves exclus avec leur motif. Aucune carte n'est créée.
3. **Préparation.** `POST .../batches` avec un corps vide. Les secrets QR et le nonce restent dans la mémoire du composant, le temps de l'onglet. Ils ne vont ni dans `localStorage`, ni dans `sessionStorage`, ni dans `IndexedDB`, ni dans l'adresse.
4. **Accusé technique.** Il est envoyé tout de suite avec le nonce reçu. S'il échoue, l'opérateur renvoie cet accusé. Une nouvelle préparation n'est pas lancée.
5. **Document.** « Enregistrer le document » écrit un fichier texte (sélecteur de fichier, ou téléchargement si le sélecteur est absent). L'annulation du sélecteur ne valide rien. La case de confirmation reste inactive tant que cette écriture n'est pas terminée.
6. **Activation.** Elle n'est proposée qu'après l'accusé de sauvegarde accepté par le serveur, lui-même envoyé avec les secrets détenus en mémoire. L'aperçu ne contient pas ces secrets.

## Coupure réseau

| Situation | Comportement de l'écran |
| --- | --- |
| Réponse de préparation perdue | Message explicite. Aucun second appel tant que l'opérateur ne choisit pas « Contrôler le lot ». |
| Lot déjà ouvert | `409`, identifiants publics, `secretsRecoverable` affiché faux. Abandon explicite, puis seulement une nouvelle demande. |
| Accusé ou activation sans réponse | Nouvel envoi de la même étape. Pas de nouvelle préparation. |
| Lot expiré | Les QR non activés ne le seront jamais. Nouvelle préparation uniquement sur action. |

Une carte déjà active n'est ni remplacée ni réexportée. Le serveur reste seul juge : l'écran ne peut pas forcer un remplacement.
