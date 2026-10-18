# NFC-PERSIST-01 — Audit de la disparition apparente d'une affectation NFC

**Statut : AUDIT / HOLD / NO MERGE**
**Priorité : P1**
**Correctif : non appliqué. Aucun merge, aucun Ready, aucune reprogrammation, aucune écriture PostgreSQL.**
**Vérification du 14 octobre 2026 : le code confirme le conflit d'UID et le drapeau RAM. La ligne Preview QA qui porte l'UID reste non lue.**

Base mesurée : `develop` `5478f8ea80e0da237e55ece5e594bf453c810f40`.
Recette Preview QA V2.0 : commit `36bb96249af79abf5119348939761b6c7f700ced`, APK `c74d3a8c`, arbre `d57f185b0ec9ac39463619351e68240152c4e1f1`.
Les fichiers cités ci-dessous sont identiques entre cette recette et `develop` `5478f8ea`. Les commits ajoutés depuis la recette sont documentaires ou finance ; ils ne changent pas le parcours NFC Mobile.

Identité utilisée : code élève `CD-IN-BB-26-00020` uniquement. Ce document ne recopie aucun nom, UID, jeton, hash, secret ni NDEF.

Périmètre voisin, inchangé par cet audit :

- [#922](https://github.com/Somafrik-education/Somafrik/pull/922) reste Draft/HOLD, documentaire, HEAD `c880a6a74fd674fb551ce3271846a3916ff60aba`.
- [#925](https://github.com/Somafrik-education/Somafrik/pull/925) reste Draft/HOLD. Son HEAD `efb8c9c2664649e0e56f4395396e356d34676f51` avait les checks requis verts, y compris Required, Risk-targeted, Quality et l'APK preview du HEAD exact. Il ne modifie pas le drapeau RAM ni le choix du bouton décrits ici.
- SMOKE-NFC-01 reste FAIL. NFC-INT-02 reste suspendu. Aucune activation production. La carte physique déjà présentée ne doit pas être reprogrammée.

---

## 1. Ce que les deux captures prouvent

À une minute d'intervalle, pour le même code élève, l'interface Mobile est passée de :

- « Cette carte physique est déjà affectée. Son UID reste dans l'historique. »
- bouton « Reprendre la réservation interrompue »

à :

- proposition « Programmer une carte NFC »
- affectation précédente non affichée

Aucune désaffectation n'est visible dans les captures. Cela prouve un changement d'état d'interface. Cela ne prouve pas qu'une ligne PostgreSQL confirmée a été supprimée.

## 2. Cause racine de l'écart d'interface

Les deux libellés ne sont pas deux lectures du même enregistrement confirmé.

Le texte de 05:23 est exactement `nfcErrorCopy("STUDENT_CARD_NFC_UID_EXISTS")` dans `Mobile/src/lib/studentCardNfcEncoding.ts`. Ce code n'est pas produit par la liste des cartes. Il est produit quand `POST /api/student-cards` viole l'unicité PostgreSQL `23505` dont le nom de contrainte contient `nfc_uid`. Le mapping est `conflict()` dans `backend/lib/studentCardsNfcLifecycle.js`. L'index est `student_access_cards_nfc_uid_unique` sur `nfc_uid` dès qu'il n'est pas nul, tous statuts confondus, tous établissements confondus. Le commentaire de schéma dit que les liaisons historiques restent réservées après perte ou révocation.

Cette violation annule l'insertion. La tentative de 05:23 n'a donc pas créé de réservation.

Le bouton « Reprendre la réservation interrompue » ne lit pas cette ligne. `createIndividualNfcFlow` pose `attempt` en mémoire vive immédiatement avant `reserve()`, donc avant le `POST`. `hasUncertainReservation()` vaut `attempt !== null`. `attempt` n'est effacé que si `run()` atteint la phase `success`. Un `issue` qui lève `STUDENT_CARD_NFC_UID_EXISTS` laisse `attempt` posé. Le panneau (`StudentCardNfcEnrollmentPanel.tsx`) affiche alors ce bouton dès que la liste n'a pas de carte `issued` avec `nfc.state === "pending"`.

Une réservation réellement présente côté serveur a un autre libellé, sur la ligne de carte : « Reprendre l'opération — relire et confirmer ».

Le libellé de 05:24, « Programmer une carte NFC », est à la fois le texte de phase `initial` et le bouton affiché quand toutes les conditions suivantes sont vraies :

- la dernière liste HTTP a réussi (`cards` est un tableau, pas `null`) ;
- ce tableau n'a pas de carte `active` ;
- ce tableau n'a pas de réservation `issued` / `pending` ;
- `hasUncertainReservation()` est faux.

Un échec réseau après `setCards(null)` laisse `cards === null` et affiche « Chargement ou service indisponible. ». Il n'affiche pas « Programmer une carte NFC ». L'écran de 05:24, tel que décrit, est donc une liste réussie sans carte active et sans réservation en attente pour cet élève dans l'établissement de la session.

Le drapeau RAM ne survit pas au démontage du panneau. Le nettoyage d'effet met `flow.current = null`. La fiche remonte le panneau avec la clé `` `${resourceScopeKey}:${canonicalStudentId}` ``. Quitter la fiche, changer de périmètre, ou relancer le processus crée un flux neuf avec `attempt === null`. Un simple passage en arrière-plan, tant que le composant reste monté, incrémente la génération et ferme le matériel NFC ; il ne remet pas `attempt` à nul. Un rafraîchissement seul ne transforme donc pas « Reprendre la réservation interrompue » en « Programmer une carte NFC ». La bascule en une minute correspond à la perte de ce drapeau mémoire, pas à un `DELETE` observé.

## 3. Message de succès

La phrase de confirmation du produit est exactement :

`Carte NFC programmée et activée avec succès.`

Elle est `NFC_PHASE_COPY.success`. `run()` ne l'émet qu'après le retour réussi de l'action, ce qui exige `POST /api/student-cards/:id/nfc-confirm` puis la validation de la carte `active`. Ce même succès remet `attempt` à nul. L'écran suivant, après rafraîchissement de la liste, proposerait « Remplacer la carte active » et une ligne « Active », pas « Programmer une carte NFC » ni « Reprendre la réservation interrompue ».

Les deux captures décrites ne contiennent pas cette phrase. Elles contiennent le refus `STUDENT_CARD_NFC_UID_EXISTS`, incompatible avec une activation qui vient de réussir. Cet audit ne peut pas savoir si un écran antérieur, non capturé, a montré la phrase de succès. Seul l'opérateur qui tenait le téléphone peut le dire. En l'état des deux captures, il s'agit d'une programmation non confirmée, refusée parce que l'UID est déjà dans l'historique, et non d'une affectation confirmée qui disparaît ensuite.

## 4. Chaîne réservation, écriture, confirmation

Ordre côté client dans `program()` :

1. `GET /api/students/:id/cards` (`cache: no-store`).
2. Refus local s'il existe déjà une réservation `issued`/`pending` (`NFC_PENDING`) ou une carte active non explicitement remplacée (`NFC_REPLACE_REQUIRED`).
3. Lecture matérielle de l'identité NTAG, puis refus si un NDEF ou une carte en lecture seule est déjà présent (`NFC_FOREIGN`).
4. Pose de `attempt` en RAM.
5. `POST /api/student-cards` avec `studentId`, `medium: "nfc"`, l'identité et l'UUID d'opération.
6. Écriture NDEF puis relecture, seulement si l'étape 5 a renvoyé un jeton.
7. `POST /api/student-cards/:id/nfc-confirm`. Tant que cette confirmation n'est pas enregistrée, la carte reste `issued` / `nfc_encoding_state = pending`. Elle n'est pas active.

`reserveStudentCardNfc` insère `status = issued` et `nfc_encoding_state = pending`, avec expiration `issued_at + 30 minutes` évaluée par `clock_timestamp()`. `confirmStudentCardNfc` passe à `active` et `encoded` (ou `locked` si le téléphone a observé la lecture seule). `makeReadOnly()` n'est pas appelé.

Une confirmation n'est pas définitive avant cet enregistrement. Le refus `STUDENT_CARD_NFC_UID_EXISTS` intervient à l'étape 5, avant toute écriture lancée par cette tentative et avant toute confirmation.

`resume()` sans ligne de carte, tant que `attempt` est en mémoire, relit la liste. S'il ne trouve pas l'UUID, il représente la même carte et rappelle `reserve()` avec le même UUID et le même UID. Il ne crée pas une seconde réservation. Sur un UID déjà historique, le second appel retombe sur le même refus.

## 5. Composants Mobile et endpoints

| Rôle | Fichier |
| --- | --- |
| Textes de phase, copie `STUDENT_CARD_NFC_UID_EXISTS`, drapeau `attempt` | `Mobile/src/lib/studentCardNfcEncoding.ts` |
| Boutons, rafraîchissement, démontage du flux | `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` |
| Montage du panneau sur la fiche | `Mobile/src/screens/StudentDetailScreen.tsx` |
| Client HTTP | `Mobile/src/services/studentCardEnrollmentApi.ts` |

| Moment | Requête |
| --- | --- |
| Ouverture et chaque rafraîchissement | `GET /api/students/:id/cards`, `Cache-Control: no-store` |
| Réservation | `POST /api/student-cards` |
| Remplacement explicite | `POST /api/student-cards/:id/replace` |
| Nouvelle tentative de secret | `POST /api/student-cards/:id/nfc-retry` |
| Confirmation | `POST /api/student-cards/:id/nfc-confirm` |

`GET` est servi par `listStudentCards` puis `listByStudent(schoolId, student.id)`. La requête filtre `school_id` et `student_id`, tous statuts, `created_at DESC`. Elle ne sélectionne pas `token_hash`. La réponse inclut l'objet `nfc` seulement si `nfc_uid` est renseigné. Le panneau affiche l'identifiant public, le statut et le type de puce ; il n'affiche pas l'UID. Une ligne `revoked` du même élève dans le même établissement reste visible : « Carte {publicId} — Révoquée ».

Le rafraîchissement commence par `setCards(null)`. Une réponse suivante valide remplace la liste affichée. Une réponse malformée (`cards` non tableau) lève `NFC_RESPONSE_INVALID` après cet effacement d'affichage : l'utilisateur voit « Chargement ou service indisponible. », pas le bouton Programmer, et la ligne précédemment affichée n'est plus à l'écran tant qu'une liste valide ne revient pas. PostgreSQL n'est pas modifié. Ce chemin est le sujet de NFC-05 et NFC-08. Il n'explique pas les deux captures : 05:23 est un refus d'émission, pas une ligne active, et 05:24 exige une liste réussie.

## 6. PostgreSQL Preview QA

L'APK Preview QA appelle `https://api-preprod.somafrik.app`. La documentation `docs/mobile/PREVIEW-APK.md` relie cette API au PostgreSQL de préproduction. Le dépôt ne décrit pas une seconde base nommée Preview QA.

Le 14 octobre 2026, `GET /api/health` sur cette API a répondu 200 à 09:53:34 UTC : `status=ok`, `database=postgresql`, `gitSha=36bb96249af79abf5119348939761b6c7f700ced`. Ce SHA est la recette Preview QA V2.0. L'API en service correspond au code audité. `GET /api/students/CD-IN-BB-26-00020/cards` sans JWT a répondu 401, message « Authentification JWT requise », sans corps de carte.

Les variables `DATABASE_URL` et `SOMAFRIK_NFC_TEST_DATABASE_URL` de cet environnement pointent toutes deux vers `127.0.0.1:5432/nfc_encoding_test`. C'est la base jetable des tests NFC. `.env.preproduction` est absent. Aucun accès Render ni Supabase n'est disponible. Les lignes Preview QA n'ont donc pas été lues. Aucune suppression, réécriture d'UID ni purge n'a été faite.

Reste non déterminé pour l'UID déjà enregistré : autre élève ou non, autre établissement ou non, statut `active`, `revoked` ou `issued`/`pending`.

Le schéma et le code, vérifiés sans ces lignes, disent :

- une carte n'est active qu'après `nfc-confirm` ;
- `markRevoked` change `status`, `revoked_at`, `revoke_reason` et `updated_at` ; il ne change pas `nfc_encoding_state` ;
- un UID déjà présent, y compris sur une ligne `revoked` avec `revoke_reason = nfc_abandoned`, bloque une nouvelle émission par `STUDENT_CARD_NFC_UID_EXISTS` ;
- l'index `student_access_cards_one_pending_nfc_per_student` empêche deux réservations `issued`/`pending` pour le même élève dans le même établissement ;
- l'index UID est global, sans `school_id` : la liste de cet élève peut être vide alors que la puce est déjà liée à un autre élève ou à un autre établissement. L'index n'est pas à supprimer.

Un contrôle local, distinct de Preview QA, a été exécuté : le test `revoked reservation and retry replay cannot resurrect or reuse its UID` de `backend/lib/studentCardsNfcLifecycle.pg.test.js` a réussi en 120 ms. Il crée un schéma jetable `nfc_prog_*` sur `nfc_encoding_test`, révoque une réservation fictive avec `nfc_abandoned`, puis constate `STUDENT_CARD_NFC_UID_EXISTS`. Cela confirme le chemin de code. Cela n'identifie pas la ligne Preview QA.

Lecture seule proposée pour un opérateur humain, plus tard, sur la base Preview QA uniquement. Ne pas sélectionner `token_hash`, `first_name`, `last_name`, ni `nfc_uid`. Ne pas coller le résultat s'il contient un UID.

```sql
SELECT c.status,
       c.nfc_encoding_state,
       c.revoke_reason,
       c.nfc_tag_type,
       (c.nfc_uid IS NOT NULL) AS uid_bound,
       (c.nfc_operation_id IS NOT NULL) AS has_operation,
       c.created_at,
       c.updated_at
  FROM students s
  JOIN student_access_cards c
    ON c.student_id = s.id
   AND c.school_id = s.school_id
 WHERE s.student_code = 'CD-IN-BB-26-00020'
 ORDER BY c.created_at DESC;
```

Pour retrouver la ligne en conflit, un opérateur qui détient l'UID hors de Git fournit le paramètre localement. La projection ne contient ni UID, ni nom, ni hash.

```sql
SELECT s.student_code,
       sch.school_code,
       c.status,
       c.nfc_encoding_state,
       c.revoke_reason,
       c.nfc_tag_type,
       (s.student_code = 'CD-IN-BB-26-00020') AS same_student
  FROM student_access_cards c
  JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id
  JOIN schools sch ON sch.id = c.school_id
 WHERE c.nfc_uid = :uid;
```

`same_student` faux signifie un autre élève. Un `school_code` différent de l'établissement de la session signifie un autre établissement. `status` et `nfc_encoding_state` disent si l'enregistrement est actif, révoqué ou en attente. Cette requête n'a pas été exécutée ici : l'UID et la connexion Preview QA sont absents de cet environnement.

## 7. Séparation des établissements

`studentCardsHttpScope` exige `scope.mode === "school"` et un `schoolId`. `listStudentCards` et `reserveStudentCardNfc` utilisent ce `schoolId`. `GET /api/students/:id/cards` ne renvoie pas les cartes d'un autre établissement. Le refus d'UID global n'est pas une fuite de liste : c'est une réservation du puce au-delà de l'établissement. NFC-07 reste à préserver tel quel.

## 8. Diff proposé, non appliqué

Aucun fichier produit n'est modifié par cette PR. Le correctif suivant attend une autorisation CTO et une PR GitHub distincte.

1. Dans `program()`, ne traiter `STUDENT_CARD_NFC_UID_EXISTS` (et les autres refus qui prouvent qu'aucune ligne n'a été insérée) comme une réservation interrompue. Effacer `attempt` sur ces refus connus. Conserver `attempt` seulement pour un résultat incertain : coupure réseau, HTTP 5xx, ou réponse illisible après l'envoi. Le bouton « Reprendre la réservation interrompue » ne doit plus apparaître après ce refus d'UID.
2. Ne pas perdre le cas « le POST a été commis mais la réponse n'est pas arrivée ». Après rafraîchissement, la ligne `issued`/`pending` doit proposer « Reprendre l'opération — relire et confirmer ». `resume()` ne doit toujours pas créer un second UUID ni réaffecter un UID historique.
3. Dans le panneau, ne plus appeler `setCards(null)` avant la fin d'une lecture valide lorsqu'une liste valide est déjà affichée. Sur échec réseau ou corps malformé, conserver la dernière liste valide et afficher l'erreur. Un tableau vide explicitement valide reste une réponse serveur : il peut remplacer l'affichage, parce qu'il dit qu'il n'y a aucune carte pour cet élève dans cet établissement. Un corps non tableau ne doit pas être présenté comme une absence d'affectation.
4. Ne pas supprimer `reset()` de l'encodeur, ne pas affaiblir `nfc-confirm`, ne pas réécrire un UID historique, ne pas journaliser un UID complet.

## 9. Tests nécessaires avant tout correctif

| Id | Attendu | État sur `develop` |
| --- | --- | --- |
| NFC-01 | Après confirmation, un rechargement de `GET /cards` garde la carte `active`. Le bouton n'est pas « Programmer ». | La confirmation PostgreSQL existe. Le panneau n'a pas ce test de rechargement. |
| NFC-02 | Un nouveau flux, comme après déconnexion, avec une liste qui contient encore la carte `active`, affiche « Remplacer la carte active ». | Non couvert au niveau du bouton. |
| NFC-03 | Une ligne `issued`/`pending` reste reprenable sans drapeau RAM. Un refus `UID_EXISTS` ne laisse pas `hasUncertainReservation()` à vrai. Une coupure après envoi le laisse à vrai. | Le succès remet le drapeau à faux. Le cas `UID_EXISTS` n'est pas testé. |
| NFC-04 | Pas de seconde carte active, pas de seconde réservation `pending`, UID historique refusé. | Couvert par `studentCardsNfcLifecycle.pg.test.js`, y compris après `nfc_abandoned`. |
| NFC-05 | Une erreur réseau de liste ne remplace pas une liste confirmée par le bouton Programmer. | Le panneau actuel échouerait : il vide `cards` avant la requête. |
| NFC-06 | NTAG213 et NTAG216 restent les deux types acceptés, charge utile dans 144 octets. | Couvert par le contrat d'encodage. Recette physique non refaite ici. |
| NFC-07 | La liste ne contient pas un autre établissement. Le même UID y reste refusé. | Couvert par les tests HTTP de périmètre et par l'index global. |
| NFC-08 | Un corps sans tableau `cards` n'efface pas la dernière liste valide. | Non couvert. Le panneau actuel cache la liste précédente derrière « Chargement ou service indisponible. ». |

## 10. Vérification indépendante

Contrôle du 14 octobre 2026, sur les fichiers de `develop` `5478f8ea`, identiques à la recette `36bb9624` pour le parcours NFC cité. Le diff GitHub de #926, HEAD `b3d1af4b6a3744ce65aa709b3cb3f7dfd6d54001`, ne contient que `docs/audits/NFC-PERSIST-01-audit.md`. Merge-base exacte avec `develop`. La PR est Draft. Required, Scope et Secrets sont verts ; les jobs de code sont ignorés parce qu'aucun fichier produit ne change.

Sonde Node 22 sur `createIndividualNfcFlow`, API factice, sans réseau et sans UID réel :

- `program()` lève `STUDENT_CARD_NFC_UID_EXISTS` ;
- `hasUncertainReservation()` reste vrai ;
- les phases observées sont `waiting`, `reservation` ;
- aucun `write`, aucun `confirm`, la phase `success` est absente ;
- la copie affichée est « Cette carte physique est déjà affectée. Son UID reste dans l’historique. » ;
- la copie de succès « Carte NFC programmée et activée avec succès. » n'est pas atteinte ;
- `resume()` rappelle `issue` une seconde fois et reçoit le même code. Le bouton « Reprendre la réservation interrompue » ne rouvre pas une affectation confirmée : il renvoie le même refus.

`postgresRepository.withTransaction` fait `ROLLBACK` si l'insertion lève l'unicité. `conflict()` transforme ensuite la contrainte dont le nom contient `nfc_uid` en `STUDENT_CARD_NFC_UID_EXISTS`. La tentative refusée ne laisse pas de ligne.

Le démontage du panneau, ligne 42 de `StudentCardNfcEnrollmentPanel.tsx`, met `flow.current = null`. Le rafraîchissement, ligne 49, appelle `setCards(null)` avant la réponse. Ces deux lectures confirment le défaut Mobile décrit en section 2. Le bouton correspondant n'a pas de test de composant.

## 11. Décision

HOLD maintenu sur #926 et #925. Pas de Ready, pas de merge. L'index unique global reste en place. Pas de reprogrammation de la carte déjà présentée. Pas de PR corrective Mobile dans cette étape : la ligne UID Preview QA n'est pas encore identifiée. La prochaine action est la requête en lecture seule de la section 6, exécutée par un opérateur qui a la connexion préproduction et l'UID hors du ticket. Ensuite seulement, une PR distincte limitée à la section 8, puis NFC-01 à NFC-08.
