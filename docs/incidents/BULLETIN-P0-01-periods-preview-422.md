# BULLETIN-P0-01 — Périodes scolaires et aperçu 422

Statut : **DRAFT / HOLD**. Aucun déploiement, migration ni modification de données.

## Incident observé

Préproduction, établissement `CD-2026-0001`, modèle « Colombière — matières simples », assistant de configuration (étape 3).
L'aperçu `POST /api/report-card/catalog/models/:modelId/preview` est refusé avec HTTP 422 et trois erreurs `TERM_UNKNOWN` affichées sous les périodes du bulletin.

La réponse JSON complète de la requête 422 et l'état PostgreSQL exact de préproduction n'ont pas été fournis ; la correspondance entre ce rejet et des valeurs périmées ou issues d'une autre année est une hypothèse, pas une cause démontrée pour cet établissement.

## Défauts vérifiés dans le code

1. `reportCardCatalogPgStore.schoolContext` récupérait les noms des périodes de **toutes** les années scolaires de l'établissement, puis les dédupliquait. L'assistant de bulletin devrait proposer uniquement les périodes de l'année courante. `classContext` est déjà filtré par l'année de la classe : il n'est pas modifié.
2. L'assistant ne contrôlait que les périodes vides en local. Une référence enregistrée absente des choix du contexte courant pouvait être envoyée au serveur et rejetée en 422, sans possibilité visible de retirer cette référence si elle n'était plus une case disponible.

## Correctifs

- SQL `schoolContext` : `AND y.is_current = TRUE`, sans repli implicite vers les périodes des autres années.
- Validation locale : `TERM_UNKNOWN` sur toute référence hors `ctx.terms`, avec arrêt de l'aperçu.
- Références enregistrées devenues indisponibles : affichage explicite, retrait manuel, sans remplacement automatique.
- Si le serveur retourne malgré tout `TERM_UNKNOWN` après changement concurrent du référentiel, rechargement des périodes du contexte, en conservant les saisies de l'assistant.
- **Conservés** : calculs de notes, coefficients, totaux, permissions, isolation, publication et configuration déjà stockée. Aucun changement SQL des données.

## Tests ajoutés

- Backend : lecture des périodes bornée à l'année courante ; résultat vide sans période courante, sans héritage de l'ancienne année.
- Web : référence T1 héritée d'une autre année ; refus avant `preview`, erreur visible et retrait manuel sans suppression des autres choix.

## Vérification préproduction après fusion

1. Sur `CD-2026-0001`, vérifier que l'année active `2026-2027` possède réellement ses trois périodes dans le référentiel scolaire.
2. Recharger la configuration du modèle (Ctrl+F5), choisir T1, T2, T3 parmi les périodes proposées.
3. Vérifier la requête `preview` : HTTP 200 après choix valide, et aucun `TERM_UNKNOWN`.
4. Si les périodes de l'année courante n'existent pas, les configurer par le parcours métier autorisé avant de reprendre, et **ne pas** restaurer artificiellement les périodes des années passées.
5. Vérifier avec une deuxième école et une deuxième année que les périodes ne se mélangent pas.
6. Ne pas activer ni publier un bulletin tant que l'aperçu n'est pas validé.

## Limites et gouvernance

La cause exacte du 422 préproduction ne peut pas être certifiée sans le JSON `Response` et l'inventaire des trimestres de l'année active. Le correctif ferme les défauts démontrés dans le code ; sa validation opérationnelle nécessite un smoke. BULLETIN-CLASSE-01 #1058 et #1059 demeurent hors périmètre, sans retarget ni merge.
