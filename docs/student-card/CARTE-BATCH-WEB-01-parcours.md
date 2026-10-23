# CARTE-BATCH-WEB-01 — Émission des cartes élèves par classe

**DRAFT / HOLD — aucune fusion, aucun déploiement.**

L'administrateur scolaire ouvre une classe et prépare les cartes QR des élèves éligibles. L'activation n'est possible qu'après l'enregistrement d'un document CR80 produit localement. Le PDF A4 (CARTE-BATCH-PDF-02) devra relire ce document, sans nouvelle émission et sans demander les secrets au serveur. Ce parcours n'active rien à partir du seul aperçu.

## Parcours

1. **Classes → Cartes élèves.** Le bouton « Émettre / exporter les cartes » apparaît sur chaque classe lorsque le compte a `Élèves:UPDATE`. Un administrateur plateforme, un administrateur pays, un enseignant ou un comptable ne l'ont pas.
2. **Précontrôle.** Le dialogue affiche les élèves éligibles, les cartes déjà actives (non réexportées) et les élèves exclus avec leur motif. Aucune carte n'est créée.
3. **Préparation.** `POST .../batches` avec un corps vide. Les secrets QR et le nonce restent dans la mémoire du composant, le temps de l'onglet. Ils ne vont ni dans `localStorage`, ni dans `sessionStorage`, ni dans `IndexedDB`, ni dans l'adresse.
4. **Accusé technique.** Il est envoyé tout de suite avec le nonce reçu. S'il échoue, l'opérateur renvoie cet accusé. Une nouvelle préparation n'est pas lancée.
5. **Document CR80.** « Enregistrer le document CR80 » convertit localement les secrets encore en mémoire en une feuille HTML à la taille réelle 85,60 × 53,98 mm, avec la source versionnée `somafrik-card-batch-print-v1`. Un fichier de jetons ne débloque pas l'activation. L'annulation du sélecteur ne valide rien. Le téléchargement de secours ne suffit pas : la case de confirmation reste obligatoire.
6. **Activation.** Elle n'est proposée qu'après cette conversion, la confirmation de l'opérateur et l'accusé de sauvegarde accepté par le serveur. L'aperçu ne contient pas les secrets. Le serveur ne pourra pas réimprimer les QR.

## Coupure réseau

| Situation | Comportement de l'écran |
| --- | --- |
| Réponse de préparation perdue | Message explicite. Aucun second appel tant que l'opérateur ne choisit pas « Contrôler le lot ». |
| Fichier de jetons seul | L'activation reste impossible. Seul le document CR80 convertible est accepté. |
| Lot déjà ouvert | `409`, identifiants publics, `secretsRecoverable` affiché faux. Abandon explicite, puis seulement une nouvelle demande. |
| Accusé ou activation sans réponse | Nouvel envoi de la même étape. Pas de nouvelle préparation. |
| Lot expiré | Les QR non activés ne le seront jamais. Nouvelle préparation uniquement sur action. |

Une carte déjà active n'est ni remplacée ni réexportée. Le serveur reste seul juge : l'écran ne peut pas forcer un remplacement.
