# NFC-APPEL-PARTIEL-01 — Clôture et synchronisation d'appels NFC partiels

**Statut : DRAFT / HOLD — NO READY — NO MERGE — NO DEPLOY.**
Base : `develop@482d76c9` (PR4 #1131 fusionnée). Backend PostgreSQL + Mobile Expo React Native.

## 1. Décision métier appliquée

- Un appel NFC hors connexion s'enregistre **sans exiger 100 % des cartes**.
- Un élève non scanné et non pointé reste **« Non pointé »** : aucune ligne `attendance`, jamais `absent` par défaut.
- Une absence ne vient que d'une saisie explicite (pointage `absent` de l'enseignant dans l'appel, ou saisie ultérieure par les mécanismes existants).
- Trois notions distinctes :

| Notion | Où | Valeur |
|---|---|---|
| Clôture locale | Mobile, `rc_sessions.state` `draft → closed` | l'enseignant a terminé ses scans ; corps figé |
| Couverture de la classe | champ `complete` du lot | `false` = partielle (nouveau parcours), `true` = complète (contrat historique) |
| Synchronisation | Mobile, `synced` | uniquement après ACK conforme (`operationId`, `sessionId`, `revision`, `payloadDigest`) |

## 2. Audit sur `develop@482d76c9` (avant modification)

### Cause du `ROLL_CALL_ROSTER_CHANGED` observé au smoke
- Mobile `closeSession` construisait toujours `complete: true`.
- Serveur `readSyncBody` refusait tout autre valeur ; `applyTeacherMarks(complete: true)` exige que chaque inscrit soit transmis ou déjà pointé ce jour-là, sinon 409 `ROSTER_CHANGED` + `not_recorded`.
- Avec un pack vérifié, la clôture comblait les manques par des marques `absent` de source `default` (défaut P1-B).
- Sans pack (mode dégradé) ou si la liste du pack ne correspondait plus aux inscriptions, aucune marque ne comblait les élèves non scannés : le serveur répondait `ROSTER_CHANGED` (défaut P1-A).
- Les journaux de l'appareil du smoke n'ont pas été consultés : je ne peux pas dire lequel de ces deux chemins a été suivi. Les deux sont corrigés.

### Cause du bandeau contradictoire (P1-C)
- `OfflineRollCallModal` affichait en phase `closed` un texte **figé** (`OFFLINE_ROLL_CALL_COPY.closed`, « … en attente de synchronisation »), jamais relu.
- La liste de synchronisation en dessous suivait l'état stocké (`subscribeSync`) et passait à « Synchronisé » : les deux s'affichaient ensemble.

### Matrice des changements

| Élément | Avant | Après | Fichier |
|---|---|---|---|
| Marques `absent` `default` à la clôture | créées pour tout élève du pack sans statut | **supprimées** | `Mobile/.../store/repository.ts` |
| Champ `complete` du lot Mobile | `true` | `false` (partiel) | idem |
| Pointages transmis | `manual` + `default` | `manual` seulement | idem |
| Appel vide (0 scan, 0 pointage) | clôturable | refusé `RC_ROLL_CALL_EMPTY`, brouillon conservé | idem, `offlineRollCall.ts`, modale |
| Compteurs | Élèves, Présents, Restants, À vérifier ; « absents à la clôture » | Inscrits, Présents, En retard, Absents saisis, Justifiés, Non pointés, À vérifier | `offlineRollCall.ts`, modale |
| Bandeau après clôture | texte figé | dérivé de l'état stocké, relu à chaque événement de synchronisation | modale, `syncStatus.ts` (`syncBanner`) |
| `readSyncBody` | `complete !== true` → 400 | `complete` booléen strict ; partiel vide → 400 | `backend/lib/rollCallOfflineSync.js` |
| Contrôle de couverture | `complete: true` imposé | `complete: true` inchangé ; `false` : seuls les élèves transmis doivent être inscrits (sous verrou) | `backend/lib/studentCardRollCall.js` (`applyTeacherMarks`, option `requireSentEnrolled`) |
| Audit de synchronisation | — | `coverage: "full" \| "partial"` | `rollCallOfflineSync.js` |
| Révision après `not_recorded` | supprime les `default` | inchangé ; la nouvelle clôture n'en recrée pas | — |
| `/validate` (appel en ligne) | — | **inchangé** (option non utilisée) | — |

## 3. Contrat (compatible)

- `contractVersion` reste `rc-offline-1` ; aucun champ ajouté ni retiré ; preuves HMAC et digest JCS inchangés.
- `complete: true` : règle historique intacte. Les corps figés déjà stockés sur les téléphones (avec absences `default`) sont envoyés **à l'identique** et traités comme avant. Aucun corps figé n'est réécrit.
- Si un ancien corps figé reçoit `ROSTER_CHANGED` + `not_recorded`, l'enseignant utilise « Corriger l'appel » (révision existante). La révision supprime les `default`, et la nouvelle clôture produit un lot partiel.
- `complete: false` :
  - les élèves non transmis ne sont jamais écrits ;
  - chaque scan reste vérifié (preuve HMAC, carte active, support, titulaire inscrit dans la classe) → `CARD_INVALID` / `PROOF_INVALID` ;
  - chaque élève transmis doit être inscrit, revérifié sous `lockEnrolledRoster FOR SHARE` → `ROSTER_CHANGED` (`missing: 0`, `unexpected: n`) ;
  - une désinscription ou un changement de classe d'un élève **scanné** n'est donc jamais masqué ;
  - statuts protégés (`attendanceTransition`), idempotence, verrous, journal, droits, flags, abonnement et fenêtre de date : inchangés ;
  - lot sans scan ni pointage → 400 `ROLL_CALL_INPUT_INVALID`.
- ACK : forme inchangée ; le Mobile ne passe à `synced` qu'après vérification de `operationId`, `sessionId`, `revision` et `payloadDigest`.

## 4. Décision : appel à zéro carte

- **Refus motivé, sans rien inventer.**
- Sur le Mobile, la clôture est refusée avec le message « Aucune carte scannée ni aucun statut saisi : il n'y a rien à enregistrer. » ; le brouillon reste ouvert.
- Une seule absence explicite saisie suffit à rendre l'appel clôturable.
- Le serveur refuse aussi un lot partiel vide : un appel enregistré vide verrouillerait la session sans aucune donnée.

## 5. Corrections ultérieures

- Retards, absences et justifications des non-pointés passent par **POST /api/presences** (RBAC, abonnement, audit existants). Les présences NFC ne sont ni écrasées ni dupliquées (preuve T4/T5).
- « Justifié » reste interdit dans le lot enseignant hors connexion (statuts admis : `present`, `late`, `absent`). La direction justifie via `/api/presences`, avec un enseignant désigné explicitement (règle existante).
- Un second appel NFC, avec une **nouvelle** session, ne modifie aucun statut protégé ; la même session avec un autre contenu → `SESSION_CONFLICT`.

## 6. Tests

| Test | Résultat local |
|---|---|
| `backend/lib/rollCallOfflinePartial.http.pg.test.js` (nouveau, PostgreSQL 16 réel, serveur réel, 35 élèves) T1 à T8 | **vert** ; **rouge** sur le code d'origine (T1 refusé « Seul un appel complet confirmé ») |
| `rollCallOfflineSync.http.pg.test.js` (contrat PR1c, inchangé) | vert |
| `studentCardRollCall.http.pg.test.js` (`/validate`, inchangé) | vert |
| `rollCallOfflinePack.http.pg.test.js` | vert |
| Unitaires backend roll-call (48) | vert ; la validation stricte refusait `complete: false` : cas déplacé (partiel accepté, partiel vide et couverture non booléenne refusés) |
| Base unitaire backend | 2 934 réussis, 0 échec, 3 ignorés |
| Mobile `test:rollcall-offline` (SQLCipher, avec le nouveau `partialRollCall.test.ts`) | 139/139 |
| Mobile `mobileParentProfile.audit.red.test.ts` (MP-011 Parent) | vert |
| TypeScript Mobile | vert |

Détail T1–T8 :
- **T1** 22/35 : 22 écritures, 13 sans ligne, ACK conforme, audit `coverage: partial`.
- **T2** 35/35 : 35 présences, double lecture sans doublon.
- **T3** : 10 présents, 5 absents explicites, 20 non pointés.
- **T4** : 4 retards et 6 absences ajoutés ensuite ; les 22 présences NFC gardent la même ligne et le même statut.
- **T5** : justification enseignant hors ligne refusée (400), justification direction acceptée ; second appel NFC : 2 protégés, 0 écrasement ; total 35.
- **T6** : élève désinscrit, carte hors classe ou révoquée → 409 `CARD_INVALID` (scan identifié) ; pointage hors classe → 409 `ROSTER_CHANGED` ; carte d'un autre établissement → 400 `PROOF_INVALID` ; tous avec `not_recorded`, aucune écriture.
- **T7** : rejeu → même ACK (cache, puis journal sans cache) ; même session et autre contenu → `SESSION_CONFLICT` ; aucune double écriture.
- **T8** : `complete: true` incomplet → `ROSTER_CHANGED {missing: 13}` (inchangé) ; complet → 201 ; partiel vide et couverture non booléenne → 400.

Mobile (`partialRollCall.test.ts`) :
- clôture à 1, 10, 22 et 35 cartes sur 35, compteurs exacts, aucune marque `default` ;
- fermeture forcée puis réouverture avec le corps figé intact, synchronisation après reconnexion, renvoi octet pour octet, `synced` et bandeau « Appel synchronisé avec succès » ;
- ACK 2xx non conforme : jamais `synced` ;
- révision refusée après 500 et permise après `not_recorded`, sans réintroduire d'absence ;
- un libellé de bandeau par état ; la modale lit l'état stocké et s'abonne aux synchronisations.

**Non exécutés :**
- preuve native **Hermes / SQLCipher sur Android** (`npm run verify:rollcall-native-proof`) : aucun appareil ni émulateur `adb` dans la session ;
- **smoke physique** avec l'APK de préproduction ;
- les suites PostgreSQL complètes (3 lots), laissées à la CI.

## 7. Risques résiduels

- **Anciens corps figés** (`complete: true` + absences `default`) déjà clôturés et non synchronisés : ils sont envoyés tels quels.
  - Si la liste a changé, ils reçoivent encore `ROSTER_CHANGED` ; il faut alors « Corriger l'appel » (révision), puis clôturer de nouveau.
  - S'ils passent, leurs absences `default` sont enregistrées comme avant ce correctif.
- **Mode dégradé** (sans pack) : les cartes restent « à vérifier » ; une carte devenue invalide fait refuser **tout** le lot (`CARD_INVALID`, scan identifié), comme avant. Il n'y a pas d'acceptation partielle d'un lot contenant une carte invalide.
- **`/api/presences`** : ses règles d'écrasement propres ne sont pas modifiées. Une saisie ultérieure sur un élève déjà présent suit ces règles, pas celles de `attendanceTransition`.
- **Nombre de non pointés** : affiché par le Mobile à partir du pack ; l'ACK conserve sa forme (sans champ `notRecorded`).

## 8. Smoke physique à dérouler (APK préproduction)

1. Classe à effectif connu, pack préparé.
2. Scanner moins de cartes que l'effectif ; vérifier les compteurs (Non pointés = effectif − présents ; Absents saisis = 0).
3. Clôturer : bandeau « Appel enregistré localement — à synchroniser ».
4. Restaurer Internet : le bandeau passe à « Synchronisation en cours » puis « Appel synchronisé avec succès », sans fermer l'écran ; jamais les deux messages ensemble.
5. PostgreSQL : une ligne `present` par carte scannée, aucune ligne pour les non-pointés, une ligne `attendance_roll_calls` (`source = 'offline'`), audit `coverage = partial`.
6. Saisir ensuite quelques retards, absences et justifications ; vérifier : aucun doublon, aucun faux absent, présences NFC intactes.
