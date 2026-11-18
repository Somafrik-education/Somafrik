# E2E-PREPROD-GLOBAL-01 — Performance

**Non exécuté.** Aucun test de charge ni de latence n'a été lancé contre la préproduction (BLK-PERM, BLK-AUTH). Le mandat autorise ces tests en préproduction seulement, à intensité contrôlée et sous surveillance des ressources. Rien n'a été envoyé.

**Proposition, sur GO CTO et avec un compte de test :**
- mesurer les temps de réponse (p50/p95) des écrans de liste (élèves, présences, paiements) ;
- monter progressivement jusqu'à 5 utilisateurs virtuels, puis 20 ;
- arrêt automatique dès p95 > 2 s ou dès la première erreur 5xx ;
- surveiller CPU et mémoire de Render et la base de données pendant le test.
