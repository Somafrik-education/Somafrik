# MONO-T2 — Addendum de consolidation après correctifs P1

Date : 2026-10-28. Cette annexe complète, sans réécrire les constats historiques, les rapports `MONO-T2-CLOSURE-AUDIT.md` et `MONO-T2-RISK-REVALIDATION.md`. Les matrices « défaut confirmé » décrivent **l'état audité avant les corrections** et ne doivent pas être lues comme des constats actuels sur `develop`.

## Chaîne de correctifs réellement fusionnés

| Défaut | PR | Commit squash dans develop | Portée |
|---|---|---|---|
| REFRESH-R1 | #1018 | `c1e0048b6e671aad1e48d916f3ba9078d8b011d6` | Reconstruire les claims de rôle et le rattachement scolaire au rafraîchissement du JWT ; test de parité des claims |
| O9-R1 (refresh) | #1020 | `11fb9ecfc98c4f83d5ac87517a1ac46781ba4d46` | Contrôler l'abonnement au rafraîchissement ; refus et révocation de sessions en cas de blocage |
| A5-R1 (PATCH) | #1019 | `35319d138a93ff451d2876708a670555b3b26cb2` | UPDATE-only par établissement, conservation des champs omis ; test HTTP/PG |

Référence `develop` après les trois fusions : **`35319d138a93ff451d2876708a670555b3b26cb2`**.

## Contrôles GitHub indépendants effectués avant chaque merge

- #1018 : 20/20 workflows verts sur le HEAD vérifié `40664968f13bd41d216da6675177b1d1f17094d9` ; diff indépendant 2 fichiers, branche à jour et sans conflit.
- #1020 : 20/20 workflows verts sur le HEAD vérifié `d40a0265de7cae1845033074eed3f52d9421140c` ; diff indépendant 2 fichiers, branche resynchronisée après #1018.
- #1019 : 21/21 workflows verts sur le HEAD vérifié `d34a8d7b98b9bfb5a59ad1e00b79a5181df2ab12` ; diff indépendant 5 fichiers, branche resynchronisée après #1020.

Les résultats ci-dessus correspondent aux HEAD **avant fusion**, pas à une baseline PostgreSQL globale rejouée sur le nouveau commit `develop`. Ils ne prouvent pas à eux seuls la conformité de toutes les routes sensibles.

## Registre résiduel et décision

- **REFRESH-R1** : correction fusionnée ; vérifier à nouveau un appel enseignant après refresh Web et Mobile en smoke de consolidation.
- **O9-R1** : correction du **refresh** fusionnée. Limite documentée : un access token déjà émis peut rester utilisable jusqu'à son expiration sur les routes qui ne vérifient pas l'abonnement ; les politiques `limited` et « établissement sans abonnement » ne sont pas modifiées. **La clôture de la sécurité globale O9 n'est pas acquise.**
- **A5-R1** : correction du **PATCH** fusionnée. Les constats P2 historiques (POST sur code existant, effets en mode mémoire selon le périmètre) doivent être revalidés séparément ; ne pas les déclarer clos.
- **Gouvernance CI** : la couverture sur `develop` après fusion et le smoke préproduction doivent être constatés indépendamment.

**Décision à cette date : GO documentaire de consolidation, mais NO-GO pour une clôture produit sans réserve et pour la modularisation tant que les risques résiduels O9 et les tests de consolidation ne sont pas tranchés. NO-GO production.** Une décision CTO explicite est requise avant les lots de modularisation.

Aucune modification métier, test, migration, seed, règle GitHub ou environnement dans cette annexe.

## Consolidation finale du 28 octobre 2026 — après le FINAL-SMOKE

Le rapport `MONO-T2-FINAL-SMOKE.md` est une photographie du code `develop@35319d13`. Depuis ce smoke, trois corrections supplémentaires ont été fusionnées :

| Référence | PR | Commit squash sur develop | Résultat | 
|---|---|---|---|
| A5-REG-01 — dépôt mémoire | #1021 | `8c386d3ad390bcdb52b00a42d92dc766c7ba6b0a` | Délégation PATCH et contrat dépôt complétés |
| MULTI-ROLE-01 — Enseignant/Préfet | #1022 | `321c502b140963be03f0c2f18eb648a76e5cc678` | Reconnaissance du rôle enseignant pour la saisie des présences |
| O9-R1b — ancien access JWT | #1023 | `09ce72712d036e3729ebefd3625a7cf9cf9c5fc0` | Contrôle de l'abonnement sur chaque requête authentifiée scolaire |

Les CI au HEAD de ces PR étaient toutes vertes au moment de leur fusion : #1021 7/7, #1022 11/11 et #1023 20/20. **Cela ne remplace pas un smoke manuel Web/Mobile sur le nouveau develop final**, ni une preuve de performance du contrôle d'abonnement. Les observations du FINAL-SMOKE sont historiques ; les anomalies ci-dessus sont corrigées dans le code mais les interfaces déployées n'ont pas été revalidées ici.

Décision CTO : **GO clôture documentaire et démarrage Lot 0 outillage sous contrôle des gates** ; **NO-GO déploiement production** sans validation release indépendante. Les points P2 existants sur POST des statuts financiers restent suivis séparément.
