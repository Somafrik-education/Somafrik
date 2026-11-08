# NFC-STATUT-PRESENCE-01 — « Absent » provisoire et mise à jour immédiate par le scan NFC

**Statut : DRAFT / HOLD — NO READY — NO MERGE — NO DEPLOY.** Base : `develop@677b1dd2` (#1132 fusionnée). Mobile uniquement.

## Constat du smoke
- L'écran des présences affichait **tous les élèves « Présent »**, scannés ou non.
- Cause : `attendanceTruth.ts` donnait « Présent » à tout élève sans ligne du jour (source `unset`). L'enregistrement manuel envoyait ensuite cette valeur comme une saisie.
- Les scans de l'appel NFC hors connexion, enregistrés dans SQLCipher, n'étaient pas repris par l'écran avant la synchronisation et le rechargement serveur.

## Nouveau fonctionnement

| Moment | Affichage | Écrit en PostgreSQL ? |
|---|---|---|
| Ouverture, élève sans ligne du jour | « Absent » **provisoire** (source `unset`, libellé « Absent provisoire — non enregistré ») | non |
| Carte NFC lue, COMMIT SQLCipher | « Présent » immédiatement, sans réseau (source `nfc_local`, « Carte scannée — enregistrée sur ce téléphone ») | par l'appel NFC, à sa synchronisation |
| Synchronisation réussie | ligne PostgreSQL rechargée : le serveur fait foi | oui |
| Statut déjà confirmé (Justifié, Retard, Présent, Absent) | conservé ; jamais remplacé par une valeur locale | — |

Exemple, classe de 35 élèves : 0 / 35 → 10 / 25 → 22 / 13 → 35 / 0 (présents / absents affichés). Toutes les absences affichées restent provisoires.

## Enregistrement : aucune valeur affichée ne devient une écriture automatique
- **Appel manuel** (« Enregistrer ») : s'il reste des absences provisoires, une confirmation est demandée.
  - « Confirmer les absences » : elles sont écrites `Absent`.
  - « Enregistrer sans eux » : elles ne sont pas envoyées.
  - « Annuler » : rien n'est écrit.
- **Présences NFC locales** : jamais renvoyées par l'appel manuel ; l'appel NFC les synchronise (pas de double écriture).
- **« Tout présent »** : déclaration explicite conservée. Elle ne remplace plus un statut confirmé autre qu'une absence (Justifié, Retard, Présent) ni une présence NFC locale.
- **Clôture de l'appel NFC** :
  - « Clôturer sans les absences » : les élèves non scannés restent sans statut, comme dans #1132.
  - « Confirmer N absence(s) et clôturer » : des pointages `manual` absents sont écrits dans la transaction de clôture, jamais pour un élève scanné, pointé ou au statut protégé.

## Parité Web / Mobile
- `PARITY-001` (`scripts/lot0-parity.test.ts`, Required dans PR Gates) imposait « Présent » par défaut sur les deux plateformes.
- Décision CTO : **Mobile seul**. Le test verrouille désormais la divergence volontaire : Web « Présent » (inchangé), Mobile « Absent » provisoire non écrit.
- Le Web n'est pas modifié ; son alignement éventuel relève d'un chantier séparé.

## Fichiers
- `Mobile/src/lib/attendanceTruth.ts` : défaut provisoire, `isProvisionalEntry`, `provisionalStudentIds`, `applyLocalRollCallMarks`, « Tout présent » protecteur, libellés.
- `Mobile/src/offline/rollCall/session/localRollCallStatuses.ts` (nouveau) : lecture seule des marques `card` et `manual` de la session du jour ; jamais les anciennes `default`, ni une session expirée.
- `Mobile/src/screens/TeacherAttendanceScreen.tsx` : superposition des statuts NFC, relecture à chaque COMMIT (`onLocalChange`) et à chaque synchronisation (`subscribeSync`, puis `loadPresences`), confirmation des absences, présences NFC exclues du lot manuel.
- `Mobile/src/components/OfflineRollCallModal.tsx` : « Absent (provisoire) », compteur « Absents provisoires », clôture avec ou sans confirmation des absences, notification de l'écran.
- `Mobile/src/offline/rollCall/session/offlineRollCall.ts`, `store/repository.ts` : `confirmAbsences` / `confirmedAbsent` à la clôture.

## Tests
- **Nouveau** `nfcStatutPresence.test.ts` (SQLCipher) :
  - tableau CTO 35 élèves, vérifié **après chaque carte** ;
  - 22 scans : 22 présents, 13 absents provisoires ;
  - justifié conservé, y compris si sa carte est lue ;
  - clôture sans confirmation : aucune absence ; avec confirmation : 11 absences explicites, sans le retard ni le justifié ;
  - « Tout présent » protecteur ;
  - contrôles de l'écran et de la modale.
- **Mis à jour** :
  - `attendanceTruth.test.ts` et `PARITY-001` : défaut Absent provisoire ;
  - deux assertions de libellé de #1132 (« non pointé » → « Absent provisoire »), sans changement de la règle « aucune absence sans décision ».
- Résultats locaux : `test:rollcall-offline` 145/145, `test:lot0-parity`, `test:lot1-parity`, `verify:mobile-attendance-hydration`, `verify:mobile-home-data-truth`, `verify:canonical-state-convergence`, `verify:sync-end-to-end`, TypeScript : verts.
- **Non exécutés** : preuve Hermes / SQLCipher Android (pas d'appareil dans la session ; workflow CI dédié), smoke physique.

## Risques résiduels
- **Lot manuel** : une présence NFC locale n'y est pas envoyée. Si l'appel NFC n'est jamais clôturé, cette présence reste seulement sur le téléphone (libellé explicite).
- **Après « Enregistrer sans eux »**, les élèves restent en absence provisoire à l'écran.
- **Web** : il affiche toujours « Présent » par défaut (divergence documentée).
- **Appels NFC en ligne** (lecture validée par le serveur) : leur mise à jour d'écran reste celle d'avant, après validation ; le critère du smoke porte sur l'appel hors connexion.

## Smoke
1. Ouvrir l'appel d'une classe connue : tous les élèves sans statut affichés « Absent » provisoire.
2. Mode avion, scanner une carte : l'élève passe à « Présent » immédiatement, dans la modale et sur l'écran des présences.
3. Un élève justifié reste « Justifié ».
4. Clôturer sans confirmer les absences, rétablir Internet, synchroniser : PostgreSQL contient les présences scannées et **aucune** absence non confirmée.
5. Recommencer en confirmant les absences : elles sont écrites, sans écraser le justifié.
