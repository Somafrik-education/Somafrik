# Notifications — Phase TESTS ROUGES (lots R1 → R5)

**Base SHA** : `7bcca23a3e594985c4a5d2ff6ef4e516a073f808` (`develop`, merge de la PR #569)
**Branche** : `cursor/notifications-red-tests-d98a`
**HEAD SHA** : reporté dans la description de la PR Draft.
**Périmètre** : tests uniquement. Aucun fichier de production n'est modifié.

## 1. Objet

Reproduire par des tests automatisés les trois P1 conclus par l'audit du domaine
Notifications, avant toute correction :

1. navigation incomplète du bouton « Ouvrir » ;
2. perte des identifiants de ressource lors de l'ouverture ;
3. divergence entre le badge de la Topbar et le compteur de la page.

Les correctifs C1, C2 et C3 ne sont pas dans cette PR. Les tests sont écrits pour
échouer sur `develop@7bcca23a` et devenir verts une fois ces correctifs livrés.

## 2. Preuve d'absence de correctif

Aucun fichier de production ne figure au diff : seuls des fichiers de test, la
déclaration CI correspondante et ce rapport. En particulier
`communicationsNotificationsService.js`, `InternalNotificationsCenter.tsx`,
`internalNotificationsApi.ts` et `clientsPgStore.js` sont inchangés.

## 3. Lot R1 — Navigation Web

`web/src/components/communications/InternalNotificationsCenter.navigation.red.test.tsx`

Le test rend le vrai composant d'inbox, simule le clic sur « Ouvrir » / « Lire »
et observe l'appel à `navigate()`. Il ne se contente pas de vérifier qu'une page
s'ouvre : il exige que l'identifiant de la ressource figure dans la destination.

Contrat gelé par le test, aligné sur des routes réellement déclarées dans `App.tsx` :

| Cible | Route attendue | Identifiant exigé |
| --- | --- | --- |
| `conversation` | `/messages` | `conversationId` |
| `announcement` | `/annonces` | `announcementId` |
| `payment` | `/finances` ou `/paiements` | `paymentId` |
| `attendance` | `/presences` | `attendanceId` |
| `grade` | `/notes` | `gradeId` |
| `report_card` | `/bulletins` | `reportCardId` |
| `finance_obligation` | `/finances` ou `/paiements` | `obligationId` |
| `timetable` | `/planning` | `weeklySlotId` |
| `teacher_replacement` | `/planning` | `replacementId` |

**Résultat : 12 tests, 12 en échec.** Deux causes distinctes, conformes à l'audit :

- `conversation`, `announcement`, `payment` : la navigation a bien lieu mais vers
  la page générique, sans identifiant (`/messages`, `/annonces`, `/paiements`) ;
- `attendance`, `grade`, `report_card`, `finance_obligation`, `timetable`,
  `teacher_replacement` : aucune navigation n'est déclenchée du tout.

Le test `RED-N1-couverture` énumère nommément les cibles restées sans effet, pour
que le message d'échec désigne directement le défaut.

## 4. Lot R2 — Producteurs planning

`backend/lib/communicationsPlanningNavigation.red.test.js`

Tests PostgreSQL de bout en bout : mutation réelle du planning ou création réelle
d'un remplacement, déclenchement du producteur outbox, drain, puis lecture de
`communication_notifications.navigation_target`, y compris à travers la projection
API servie au client.

**Résultat : 7 tests, 7 en échec.** `eventSpec()` affecte `navigationTarget = {}`
pour les deux évènements planning, alors que `metadata` porte déjà `weeklySlotId`,
`classId`, `replacementId` et `occurrenceDate`. Les tests le vérifient
explicitement : la donnée nécessaire est disponible, seule la cible manque.

## 5. Lot R3 — Compteur et pagination

Scénario figé, identique de part et d'autre : 51 notifications, les 50 plus
récentes lues, la plus ancienne non lue.

### 5.1 Côté API — harnais de caractérisation

`backend/lib/communicationsUnreadPagination.red.test.js` — **4 tests, 4 verts.**

`unread-count` renvoie 1, la première page renvoie 50 éléments tous lus avec un
`nextCursor` non nul, et suivre ce curseur atteint la notification non lue en
restituant exactement le compte du badge, sans doublon ni trou.

Ce vert est le résultat attendu : il établit que l'API est correcte et que la
divergence observée en préproduction est un défaut de consommation côté client.
Le correctif C3 n'a donc pas à toucher au backend.

### 5.2 Côté Web — preuve RED

`web/src/components/communications/InternalNotificationsCenter.counter.red.test.tsx`
— **5 tests, 4 en échec, 1 vert (cas de contrôle).**

| Test | Attendu | Constaté |
| --- | --- | --- |
| `RED-N2-01` | la page affiche « 1 non lue(s) » | rien d'affiché |
| `RED-N2-02` | jamais « 0 non lue(s) » face à un badge à 1 | « 0 non lue(s) » |
| `RED-N2-03` | la 51ᵉ notification est atteignable | absente de l'interface |
| `RED-N2-04` | `nextCursor` est renvoyé à l'API | seul appel observé : `list("SCH-001")` |
| `RED-N2-05` | sous le seuil, les compteurs coïncident | vert |

`RED-N2-05` est volontairement vert : il borne le défaut à la pagination et
interdit une régression du cas simple pendant le correctif.

## 6. Lot R4 — Contrat des producteurs

`backend/lib/communicationsNavigationContract.red.test.js` — **5 tests, 2 en échec,
3 verts.**

Le fichier gèle la matrice des dix types de notifications : pour chacun, le
caractère ouvrable, le discriminant de cible et les identifiants obligatoires.
Il analyse ensuite les affectations de `navigationTarget` branche par branche
dans `eventSpec()`.

- `RED-N7-01` (échec) : nomme les producteurs déclarant une ressource ouvrable et
  sortant avec une cible vide — `planning.timetable.changed` et
  `planning.teacher.replacement`.
- `RED-N7-02` (échec) : exige discriminant et identifiants dans la cible.
- `RED-N7-03` (vert) : interdit qu'un futur producteur soit livré sans figurer
  dans la matrice, donc sans décision explicite sur son ouverture. C'est le
  garde-fou demandé contre la reproduction du défaut actuel.
- `RED-N7-04` (vert) : la matrice couvre bien les 9 évènements du Lot I.
- `RED-N7-05` (vert) : les discriminants restent uniques, `attendance` étant
  volontairement partagé entre absence et retard.

## 7. Lot R5 — Sécurité de navigation

`backend/lib/communicationsNavigationSecurity.red.test.js` — **4 tests, 1 en échec,
3 verts.**

Le RBAC existant n'est pas refondu. Seuls les scénarios absents du socle sont
ajoutés ; la révocation live de `Notifications:READ` sur le même JWT (C4-11), le
déni de périmètre `*` (C4-12) et l'IDOR inter-établissement (C4-15) sont déjà
couverts par `communicationsC4.http.pg.test.js` et ne sont pas redupliqués. Le
scénario « changement de droits après émission » correspond exactement à C4-11.

| Test | Scénario | État |
| --- | --- | --- |
| `RED-N5-01` | cible supprimée après émission | vert |
| `RED-N5-02` | cible appartenant à un autre établissement | **échec** |
| `RED-N5-03` | cible devenue inaccessible, projection figée | vert |
| `RED-N5-04` | la lecture de l'inbox ne joint aucune table métier | vert |

`RED-N5-02` est le manque réel : une notification de l'école A dont la cible
pointe vers une ressource de l'école B est servie sans aucun contrôle de tenant
sur le contenu de `navigation_target`. Aucun producteur actuel ne fabrique une
telle cible, mais rien ne l'interdit — et C1/C2 vont précisément rendre ces
identifiants actionnables. Le fail-closed doit donc exister avant.

Les trois verts sont des invariants à préserver pendant C1/C2 : la cible reste un
pointeur inerte, la projection ne s'élargit pas, et le serveur ne résout jamais
la ressource cible à la place du RBAC de son domaine.

## 8. Bilan

| Lot | Fichier | Tests | Rouges | Verts |
| --- | --- | --- | --- | --- |
| R1 | `InternalNotificationsCenter.navigation.red.test.tsx` | 12 | 12 | 0 |
| R2 | `communicationsPlanningNavigation.red.test.js` | 7 | 7 | 0 |
| R3 API | `communicationsUnreadPagination.red.test.js` | 4 | 0 | 4 |
| R3 Web | `InternalNotificationsCenter.counter.red.test.tsx` | 5 | 4 | 1 |
| R4 | `communicationsNavigationContract.red.test.js` | 5 | 2 | 3 |
| R5 | `communicationsNavigationSecurity.red.test.js` | 4 | 1 | 3 |
| **Total** | | **37** | **26** | **11** |

Les 11 verts ne sont pas des tests ratés : ce sont le harnais de reproduction
côté API, le cas de contrôle sous le seuil de pagination et les garde-fous
destinés à encadrer les correctifs à venir.

## 9. Non-régression

- Web : `npx vitest run` → 163 fichiers verts, 858 tests verts. Seuls les 2
  nouveaux fichiers RED échouent (16 tests), ce qui correspond exactement aux
  comportements volontairement mis sous test.
- Web : `tsc --noEmit` et `npm run build` passent, nouveaux tests inclus.
- Backend : portail `npm run verify:communications-c4` inchangé et vert. Les
  nouvelles suites RED ne lui sont pas rattachées, afin qu'il continue de
  signaler les vraies régressions.

## 10. CI

Les six nouveaux fichiers sont déclarés dans les chemins déclencheurs du workflow
`Communications C4`. Un pas dédié `RED notifications navigation` exécute les
quatre suites backend et les deux suites Web en `continue-on-error`, et archive
la sortie complète en artefact `notifications-red`. Le portail bloquant reste
donc vert sur le code de production intact, tandis que les échecs attendus sont
consultables tels quels.

## 11. Suite

Les correctifs C1 (navigation Web complète avec identifiants), C2 (cibles des
producteurs planning) et C3 (compteur et pagination) restent hors périmètre
jusqu'à validation de la preuve RED. C4 Archives est reporté.
