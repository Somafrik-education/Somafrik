# Statut de suivi — Smoke Mobile RC0 du 25/08/2026

Ce fichier est un **addendum de suivi**. Le rapport `mobile-smoke-rc0-2026-08-25.md` et son JSON de preuve restent le relevé historique exact exécuté sur la baseline `ca6d074a746365044dacf1e1e5805bba2698057b` ; leurs FAIL ne sont donc pas réécrits a posteriori.

## État des P1 détectés par ce smoke

| P1 | Domaine | PR corrective | État actuel |
| --- | --- | --- | --- |
| P1-RC0-01 | Session Mobile Comptable | #328 | **MERGÉE** dans `develop` |
| P1-RC0-02 | PATCH élève / `expectedUpdatedAt` | #329 | **MERGÉE** dans `develop` |
| P1-RC0-03 | Auteur explicite de l'appel Admin | #330 | **OUVERTE / Draft** — non fusionnée à la date de cet addendum |

## Lecture correcte du rapport

- Le tableau « 3 P1 ouverts » du rapport principal décrit l'état **au moment du smoke** ; il ne doit pas être interprété comme l'état actuel de `develop`.
- La preuve JSON reste immuable afin de conserver la traçabilité du run.
- Le gate Android réel / kill-relaunch / mode avion reste un résultat de l'environnement du smoke : **NON EXÉCUTÉ** dans ce run cloud.
- Le NO-GO historique sur la suite Finance Comptable était lié à l'état P1 de cette baseline. Toute décision actuelle doit se prendre sur `develop` courant et sur l'état des PR correctives, pas sur ce snapshot seul.

## Baseline de rattachement documentaire

La branche de l'audit a été réalignée sur le `develop` courant lors de cette mise à jour, sans modifier les preuves brutes du smoke historique.
