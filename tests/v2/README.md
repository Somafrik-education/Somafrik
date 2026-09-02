# Tests Somafrik V2

Ce dossier recevra les tests d'intégration et de parité entre le runtime actuel et les capacités V2.

Les tests unitaires restent près de leur package. Une capacité legacy ne pourra être retirée qu'après :

1. tests unitaires V2 ;
2. tests d'intégration PostgreSQL ;
3. comparaison legacy/V2 sur un jeu de données contrôlé ;
4. gate préproduction ;
5. validation CTO explicite.
