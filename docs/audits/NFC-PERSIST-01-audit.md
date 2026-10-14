# NFC-PERSIST-01 — Audit de la disparition apparente d'une affectation NFC

**Statut : AUDIT / HOLD / NO MERGE**
**Priorité : P1**
**Correctif : non appliqué. Aucun merge, aucun Ready, aucune reprogrammation, aucune écriture PostgreSQL.**

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

## 6. PostgreSQL

Cet agent n'a pas ouvert PostgreSQL Preview QA, préproduction ni production. Aucun comptage n'est donc rapporté. Aucune réservation n'a été supprimée, aucune affectation réécrite, aucun UID modifié, aucune purge exécutée.

Ce que le schéma et le code garantissent sans lecture de la base Preview :

- une carte n'est active qu'après `nfc-confirm` ;
- `markRevoked` change `status`, `revoked_at`, `revoke_reason` et `updated_at` ; il ne change pas `nfc_encoding_state` ;
- un UID déjà présent, y compris sur une ligne `revoked` avec `revoke_reason = nfc_abandoned`, bloque une nouvelle émission par `STUDENT_CARD_NFC_UID_EXISTS` ;
- l'index `student_access_cards_one_pending_nfc_per_student` empêche deux réservations `issued`/`pending` pour le même élève dans le même établissement ;
- l'index UID est global : la liste de cet élève peut être vide alors que le puce est déjà lié à un autre élève ou à un autre établissement.

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

Pour savoir si un UID est réservé hors de cette liste, sans l'imprimer : comparer le nombre de lignes `uid_bound` de cet élève au refus déjà observé. Si la liste de l'élève est vide et que le téléphone a reçu `STUDENT_CARD_NFC_UID_EXISTS`, la ligne en conflit est hors de cette liste d'établissement. L'identifier demande une requête séparée, toujours sans projeter `nfc_uid` dans un ticket ou un journal.

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

## 10. Décision

HOLD. Pas de correctif dans cette branche. Pas de merge de #922 ni de #925 au titre de cet audit. Pas de reprogrammation de la carte déjà présentée. Pas d'écriture en base. La prochaine action produit est une PR séparée, après accord CTO, limitée au diff de la section 8 et aux tests NFC-01 à NFC-08 qui manquent.
