# R2 — Qualification des écarts fonctionnels préprod / prod

**Mandat :** [#1187](https://github.com/Somafrik-education/Somafrik/issues/1187) — **preuve GitHub indépendante**, 17-11-2026. **Statut : AUDIT TERMINÉ POUR LE CODE ; QUALIFICATION E2E / APK BLOQUÉE. HOLD PROMOTION.**

## 1. Périmètre et empreintes figées

- Baseline `main` = `fcf09327d2716967ffcd10a69347f06c2fbffb7a`, tree `1ddccac2baa7be1470dbee15b3f52e40c0a52c53`.
- Baseline `develop` = `93f98e44746607ba53c6997d76bbf1e126601e85`, tree `1b5e986ab04c3a71b5a2e8718d6afe2d7f5da280`.
- Merge-base `4560495b457980b438f50b2be5674bda7826a1e1`, tree **strictement identique** à `main`.
- GitHub `main...develop` : six commits propres à develop, trente commits historiques propres à main. Delta = **64 chemins : 15 Mobile, 8 Web, 3 Backend, 1 script, 37 docs**. Pas de migration SQL modifiée dans ce delta. 
- Contrôle via comparaison GitHub des refs et examen des patches des PR #1177, #1174, #1176, #1182, #1175, #1183. Un succès CI passé n'atteste ni qu'une build APK prod inclut le code, ni qu'une API préprod répond correctement avec des données réelles.

## 2. Matrice par lot, preuve, risques, proposition

| Lot develop-only | Modification produit réelle (par rapport à main) | Preuve disponible | Risque de promotion | Décision R2 |
|---|---|---|---|---|
| **#1177** `74608b4e` | **Aucune fonction métier** : pin `CURRENT_MAIN=fcf09327`, reclassement des 30 commits main-only du gate release-governance ; rapport historique | Diff PR, fichier `scripts/verify-release-governance.js`, Required CI au vert sur HEAD `feb21b0c` (**6 PASS, 13 SKIP**) | **P1 release process si une future modification main n'est pas repinnée** : gate intentionnellement fail-closed ; ne pas interpréter le patch comme une promotion | Conserver comme gate de préparation, revalider après toute mise à jour de main |
| **#1174** `342e4a36` | **Backend** : vérifications des 10 étapes fondées sur données actives, filtres classes/élèves/enseignants/matières, détail des champs manquants. **Web/Mobile** : date de finalisation vs conformité courante, route étape pédagogie vers paramètres d'année scolaire, **Web** : adresse obligatoire et devise lecture seule | Patch métier et tests unitaires/PG Web/Mobile dédiés ; HEAD `269492a5` **32 PASS, 0 FAIL** Required vert | **P2 UX / P1 régression à évaluer** : progression requalifiée après archivage, adresse exigée lors de modification profil, règles de calcul de complétude sur la base existante. #1178 (absence d'intégrité multi-tenant en BD) demeure ouvert | **HOLD promotion** tant que scénarios profil + rétrocompatibilité des écoles existantes et comptage PG ne sont pas prouvés sur préprod |
| **#1176** `4d5a32ab` | **Mobile** : état explicite loading / error du GET guidé ; bouton recharger ; pas de repli 3/3 silencieux | Patch écran + test A7 ; HEAD `2c0f0916` **25 PASS, 3 SKIP**, Required vert | **P2** : comportement lorsque réseau/API indisponible, navigation après récupération | Non-bloquant pour l'activité scolaire ; qualification sur APK préprod avant promotion Mobile |
| **#1182** `763d9bd8` | **Mobile preuve native** : horloge contrôlée seulement dans `App.rcNativeProof.tsx` / helpers de preuve SQLCipher et PR3 ; pas de changement du scanner métier revendiqué | Patch montre `withProofClock` injecté dans la plateforme de preuve ; 148 lignes nouveau test, HEAD `8593d479` **29 PASS, 3 SKIP**, Required vert | **P2 risque de packaging** : fichier de preuve/commandes package, valider séparation de l'app commerciale ; aucune homologation NFC induite | Ne pas utiliser le correctif de preuve comme justification GO NFC ; contrôler contenu APK/AAB et signature |
| **#1175** `db155599` | **Nouvelle vue Mobile native** Paramètres > Notifications (9 événements, canaux IN_APP/PUSH/EMAIL, destinataires), accès depuis étape guidée 9. Lecture/PATCH endpoint existant `/backoffice/establishments/:code/notification-settings`; navigation et mapping RBAC ajoutés ; **pas de nouvelle route Web** | Patch client et contrôle `canOpen/canEdit`, tests A6, HEAD `473e6ccd` **31 PASS, 3 SKIP**, Required vert | **P1 conditionnel** : modification des règles de notifications par mauvais rôle ou école = isolation fonctionnelle ; nécessité de tester PATCH refusé 403 et absence de diffusion cross-tenant. **P2** : comportement sans réseau, erreur sauvegarde, gestion défauts et règles autorisées | **HOLD Mobile** avant smoke natif cross-role/cross-school et vérification même donnée Web / Mobile |
| **#1183** `93f98e44` | **Web** Utilisateurs : utiliser rôle canonique `SCHOOL_ADMIN` au lieu du libellé API personnalisé, et alerte lorsque catalogue API absent. Pas de changement permission/backend | Patch PR et tests (libellé Directeur + catalogue vide), HEAD `771d3de3` **19 PASS, 3 SKIP**, Required vert ; smoke manuel S02 déclaré PASS par le CTO (sans preuve API jointe dans cet audit) | **P1 potentiel** si création/assignment incorrect sur école ou échec quand le catalogue est absent ; contrôle DB/API et pays/CD/BI indispensables avant une promotion définitive | **Priorité de qualification haute** : provision atomique Superadmin→Admin School, rôle custom, isolation scolaire, refresh session ; ne pas inclure dans prod sur seule CI |

**Classification** : les sévérités de cette table représentent les *risques à vérifier*, et non six incidents P1 confirmés. Les anomalies réellement ouvertes restent enregistrées dans le registre du chantier, notamment #1178.

## 3. Revue des domaines métier impactés

### Backend (1 fichier produit + 2 tests)

`backend/lib/schoolSetupGuided.js` modifie les prédicats de satisfaction des étapes : établissement (nom/pays/adresse/téléphone/devise), année, structure, matière active, enseignant avec affectation, inscription active, finance, évaluation, notifications et utilisateurs. Le statut `operational` dépend des six premières étapes requises, tandis que le pourcentage représente dix étapes ; **ne jamais traiter 60 % / operational comme 100 % / finalized**. Les requêtes PG sont détaillées dans #1174 et impliquent des références multi-tables : contrôle de cohérence tenant indispensable à cause de #1178. Il n'existe pas de migration SQL dans le delta R2 ; cela ne prouve pas l'identité des schémas actifs.

### Web (4 fichiers produit + 4 tests)

- Guidé : lien « Paramètres pédagogiques » vers `/parametres/annee-scolaire`, date de finalisation, statut conformité courant.
- Profil établissement : champ Adresse devient requis à l'enregistrement ; devise visible mais non éditable. **Retest sur établissement préexistant sans adresse indispensable** pour exclure une régression de modification des autres champs.
- Utilisateurs : choix d'un rôle custom `SCHOOL_ADMIN` utilise la clé/identité canonique ; alerte si l'API ne renvoie pas le rôle, sans fallback non autorisé.
- Le **repli silencieux 10 étapes → ancien 3/3 Web** n'est pas inclus dans les six commits promouvables : correction séparée **#1184 Draft**, reportée comme non bloquante. Ne pas considérer ce défaut fermé.

### Mobile (12 fichiers produit et de harness + 3 fichiers de tests)

- Une vue native de configuration des notifications est ajoutée ; la route est protégée par `Paramètres Établissement`, son édition par `UPDATE` ; les mises à jour sont effectuées via API existante.
- L'écran de configuration guidée affiche un échec réseau plutôt que le 3/3 silencieux, avec réessai.
- Les liens et le statut de l'assistant sont recalés sur les validations backend.
- Le harness natif de preuve SQLCipher/PR3 utilise une horloge figée ; ce n'est **pas** une modification du fonctionnement des badges NFC de production.
- **APK de préprod non vérifié dans ce rapport R2** ; le SHA du service Web/API ne démontre pas le contenu d'un APK déjà installé ni d'un AAB Play.

### Gouvernance et documentation

- Un script de pin release et 37 documents / artefacts de test ont été ajoutés ou changés. Les fichiers docs ne prouvent pas une recette intégrale en préprod.
- Aucune modification des tables finance, paiements, notes, bulletins ou présences hors setup/notification dans les 64 chemins : **ne pas prétendre que ces modules ont été retestés**.

## 4. Vérification CI indépendante des six PR

| PR | HEAD de PR exact utilisé pour lecture CI | Success | Skipped | Failure | Required |
|---|---|---:|---:|---:|---|
| #1177 | `feb21b0c13df` | 6 | 13 | 0 | PASS |
| #1174 | `269492a51102` | 32 | 0 | 0 | PASS |
| #1176 | `2c0f09162d37` | 25 | 3 | 0 | PASS |
| #1182 | `8593d4799c5c` | 29 | 3 | 0 | PASS |
| #1175 | `473e6ccd0a67` | 31 | 3 | 0 | PASS |
| #1183 | `771d3de3eeb9` | 19 | 3 | 0 | PASS |

Ces résultats sont les check-runs GitHub des **HEAD des PR au moment de leur fusion**, pas une nouvelle exécution sur `main` ni sur un APK candidat. Sur le commit squash de `develop@93f98e44`, la requête GitHub check-runs a renvoyé **0 résultat** : ne pas en déduire un échec ou une réussite globale supplémentaire.

## 5. Matrice minimale de non-régression E2E exigée avant promotion

| ID | Surface / rôles | Test et preuve attendue | Statut R2 |
|---|---|---|---|
| R2-E01 | Web Superadmin / Admin Pays | Créer Admin School BI et CD avec libellé personnalisé ; capturer rôle canonique et rattachement `schoolCode` en API et PG | **BLOCKED** (pas de preuve API/PG jointe à cette phase) |
| R2-E02 | Web School Admin | Modifier profil incomplet, confirmer le blocage adresse et possibilité de correction, tester devise | **BLOCKED** |
| R2-E03 | Backend PG | Compter les étapes guidées avec matières/enseignants/classes archivés et inscriptions supprimées, croiser #1178 | **BLOCKED** |
| R2-E04 | Web / Mobile | Finalisée puis devenue non conforme : garder l'historique et afficher la condition manquante | **BLOCKED** |
| R2-E05 | Mobile rôles | Lecture et PATCH notifications autorisées, refus 403, rollback UI, reload, école A ≠ B | **BLOCKED** (APK natif + comptes requis) |
| R2-E06 | Mobile appareil | Vérifier le contenu de l'APK/AAB et l'absence de clock proof dans runtime métier, GPS/SDK et URL API | **BLOCKED** |
| R2-E07 | Web / Mobile | Contrôle ciblé des 12 smokes S01–S12 sur build effectivement déployée, preuves horodatées | **NON RETESTÉ** (PASS manuels déclarés auparavant) |
| R2-E08 | Auth/RBAC | Contrôles cross-tenant négatifs comptes authentifiés, incl. nouveaux endpoints et changements de rôles | **BLOCKED** |

## 6. Conclusion R2 et plan de promotion proposé

**R2 — Inventaire ET revue des patches métier : PASS. Qualification fonctionnelle préprod / artefacts : BLOCKED.**

1. Ne pas fusionner `develop` vers `main` en bloc. Qualifier séparément #1183 (utilisateurs), #1174 (Backend + guidé), #1175/#1176 (Mobile), #1182 (harness natif) et #1177 (gouvernance).
2. Priorité de vérification : **RBAC tenant pour création et notifications**, puis établissement incomplet / calcul guidé, puis contenu APK et parité.
3. **#1178 demeure OPEN** : ne pas autoriser le GO Production sans plan et correction validés de l'intégrité cross-tenant.
4. Respecter le report CTO de l'amélioration **#1184 assistant 10 étapes Web** ; ce report ne dispense pas de vérifier que les parcours métier existants restent accessibles.
5. Pas de décision d'adoption en prod avant R3 (schémas/migrations), R4 final (env), R5 (artefacts, sécurité, E2E), backups/rollback et CI finale.
6. **NO MERGE / NO DEPLOY / NO DB WRITE / NO DATA COPY.** Tout changement de SHA avant un éventuel merge déclenche un nouveau diff indépendant.
