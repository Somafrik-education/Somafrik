<!-- Documentation de mandat. Ne pas implémenter ni fusionner sans GO CTO. -->

# MANDAT CTO — COEF-01 : vecteurs de parité des moyennes

**Statut : MANDAT PRÉPARÉ / DRAFT-HOLD / NO IMPLEMENTATION / NO MERGE.**  
**Dépendance :** audit #1207 et rapport fusionné #1208 ; sept décisions métier validées dans le commentaire CTO de #1207 (23/11/2026).  
**Base documentaire :** `develop@1d3429d93b5fd3245e33c3e02628b14d50e37c26`. Revalider le HEAD au démarrage.

## Objectif strict
Préparer une PR de **tests de caractérisation/parité seulement**, sans toucher au code de calcul : jeu de vecteurs JSON partagé et exécution/observabilité des 4 consommateurs actuels (Backend/GradeBookService et bulletin historique, Web personnel, Web Parent, Mobile) et, lorsque possible, moteur `somafrik.report_card.v1`.

La PR de tests COEF-01 pourra être **ouverte ultérieurement en Draft/HOLD sous GO CTO distinct** ; ce mandat ne l'autorise **pas** à implémenter maintenant.

## Références techniques As-Is
- `backend/lib/gradesCanonical.js`
- `backend/services/gradeBookService.js`
- `backend/db/documentsExamsPgStore.js`, `backend/lib/reportCard/reportCardAverage.js`
- `web/src/lib/gradeBook.ts`
- `web/src/lib/parentNotes.ts`
- `Mobile/src/lib/pedagogyAverage.ts`, `Mobile/src/lib/evaluationsV2.ts`
- `backend/lib/reportCard/reportCardFactBuilder.js`, `backend/lib/academicRuleProfile.js` (localiser paths exacts)
- `backend/lib/canonicalAverageParity.test.js` et tests existants Web/Mobile.
Référencer le SHA et les lignes de chaque observation ; distinguer données réelles, fixtures et exemples.

## Vecteurs minimaux obligatoires
| Vecteur | Notes / coefficients | Comportement voulu validé par CTO |
|---|---|---|
| V01 | Maths 16/20, coef cours 4 ; Histoire dispensée, coef cours 2 | **16,00**, matière dispensée exclue, pas 10,67 |
| V02 | Maths 16/20 coef 4 ; Histoire 8/20 coef 2 | **13,333...**, rendu 13,33 à 2 décimales ; Web Parent ne doit pas ignorer coef cours |
| V03 | Une matière entièrement absente, excusée, non rendue, exempte | **Non applicable**, jamais zéro ajouté au dénominateur |
| V04 | Une matière avec vrai 0/20 validé | Vrai zéro **comptabilisé** |
| V05 | Épreuves 4/10, 12/20, 80/100 avec poids d'évaluations distincts | Normalisation avant pondération ; même valeur pour tous |
| V06 | Coefficients matières 0,5 / 1,25 / 2,75 | Décimaux conservés ; pondérations exactes |
| V07 | Évaluation sans période, trimestre T1 vs T2 | Comportement cohérent, écarts actuels documentés ; pas de décision métier inventée |
| V08 | Évaluations draft/locked/published/annulées | Contrôle d'éligibilité explicite ; ne pas modifier la production |
| V09 | Arrondis 1,005 et 12,345 | Référence de calcul exact + stratégie d'arrondi versionnée ; constater les écarts JS |
| V10 | Évaluation manquante vs vrai 0 ; toutes matières sans note | Pas de diviseur nul / pas de 0 de substitution ; contrat null/non applicable |
| V11 | Barèmes /5 /10 /20 /100 ; note maximale et notes invalides | Contractualiser validation et normalisation |
| V12 | Deux établissements et deux pays, mêmes noms de matière, coefficients distincts | Aucun mélange de périmètres ni de coefficients |
| V13 | Même ensemble de notes, ex-aequo ou rang sensible à l'arrondi | Classement sur valeur non arrondie ; type d'ex-aequo configurable (à venir) |
| V14 | Bulletin publié puis modification coefficient | Constater divergence historique (R-01), préparer test de non-régression COEF-02, aucune mutation réelle |

## Stratégie de tests rouges
- Exécuter les moteurs réels, **pas** une duplication ad hoc des formules comme oracle.
- Sortir des résultats `expected_business`, `observed_backend`, `observed_web`, `observed_parent`, `observed_mobile`, `observed_v1`, `status`, `reason`, `source_sha`.
- **Conserver les échecs métier connus sans bloquer la CI courante** : tests de caractérisation au vert sur le comportement observé, et tests de cible explicitement `todo`/`skip` ou sortie de qualification non bloquante jusqu'aux PR de correction autorisées. Aucun faux vert sur la parité attendue.
- Vecteurs stables, indépendants de l'heure, pas d'accès aux données de production, pas de secrets, pas de snapshot personnel.
- Prévoir l'activation progressive des assertions bloquantes dans COEF-02/03/04/06/07/11, avec traçabilité vers risques R-01/R-02/R-03/R-05/R-06/R-12.

## Livrables COEF-01 à préparer (pas à coder maintenant)
1. Liste de chemins fichiers des futurs fixtures JSON + harness par plateforme.
2. Schéma contractuel des vecteurs, champs obligatoires, précision interne et sortie.
3. Matrice `vector × moteur × observed × expected × statut`.
4. Protocole de CI non bloquante vs future CI bloquante.
5. Checklist de smoke Web, Mobile Android natif, Parent, API et bulletin PDF (avec une école de test seulement).
6. Plan de PR tests-only, diff prévisionnel, risques, dépendances et critères d'acceptation.

## Gate GO CTO avant implémentation des tests
- Aucun fichier produit modifié dans ce mandat ; aucun recalcul ou migration.
- Pas de PR COEF-02 à COEF-11.
- Si une PR documentaire de mandat est utilisée, **Draft/HOLD**, docs uniquement, aucune transition Ready ni merge.
- Avant tout merge futur : **diff GitHub indépendant du CTO**, HEAD/base/merge-base/ahead-behind, CI Scope/Secrets/Required et périmètre.
- Les scénarios de pays Burundi/RDC ne sont pas des règles nationales officielles tant que les sources ne sont pas homologuées.

**Critère de clôture du mandat de préparation** : contrat et plan de tests prêts à être soumis au GO CTO, sans implémentation.

---

## Traçabilité documentaire

- Mandat source : #1209
- Rapport d'audit source : #1208 (fusionné par squash sur develop)
- Décisions CTO : commentaire du 23/11/2026 dans #1207
- Cette PR ne contient aucun test ni modification produit ; la PR de tests COEF-01 future reste soumise à GO CTO.
