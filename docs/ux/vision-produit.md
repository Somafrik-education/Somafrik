# Vision Produit — UI/UX Somafrik

**Statut :** normatif  
**Phase :** D1.1  
**Périmètre :** interface web ERP scolaire multi-établissements

## Intention

Somafrik n’est pas un catalogue de formulaires.  
C’est un **outil de travail scolaire** : il doit aider le personnel à comprendre une situation, décider, puis agir — rapidement et sans ambiguïté.

L’interface doit donc privilégier :

1. la **ibilité opérationnelle ;
2. la prochaine action utile ;
3. la cohérence entre modules ;
4. la confiance (permissions, confirmations, états explicites).

## Différenciation

Sur une fiche métier (élève, classe, facture, etc.), l’utilisateur doit pouvoir répondre en quelques secondes :

- Quel est l’état actuel ?
- Qu’est-ce qui pose problème ?
- Que dois-je faire maintenant ?

Ce n’est pas la densité de champs qui fait la valeur, c’est la **qualité du résumé et du guidage vers l’action**.

## Conséquences pour le produit

- Chaque fiche commence par un **résumé opérationnel**, jamais par un formulaire.
- Chaque écran rend visible (implicitement ou explicitement) la **prochaine action**.
- Les indicateurs sont **vivants** : ils portent un signal utile, pas un simple compteur.
- Les écrans aident à **prendre une décision**, pas seulement à consulter des données.
- L’information métier passe avant la décoration.

## Hors vision (rappel)

Cette vision ne prescrit pas, à elle seule :

- une refonte visuelle globale ;
- un nouveau système de couleurs ou de typographie ;
- des changements métier, API ou permissions ;
- une implémentation runtime de navigation (voir D1.2 + DO-022).

L’**architecture de navigation** est spécifiée et **validée CTO** en D1.2 ([document](./architecture-navigation.md)) ; son application runtime relève des lots D2.x+.

Elle fixe le **cadre** dans lequel les étapes D suivantes devront s’exécuter.
