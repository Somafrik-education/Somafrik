# Notifications — deep-link : la destination ouvre réellement la ressource

Date : 2026-09-09
Branche : `cursor/notifications-red-tests-d98a` (PR #570)
Base : `develop@7bcca23a3e594985c4a5d2ff6ef4e516a073f808`
HEAD précédent (GREEN C0–C3) : `73b414818a710c676fead4fc622f0bb49a34bf41`

## 1. P1 traité

Le verdict CTO sur `73b4148` a validé C0, C1 et C3, et retenu un P1 bloquant sur C2 :
le résolveur produit bien `/messages?conversationId=…`, mais les pages d'arrivée
n'exploitaient pas ces identifiants. La notification atterrissait sur la bonne page
sans ouvrir la bonne ressource, et pour `teacher_replacement` elle risquait d'ouvrir
le wizard « Programmer un remplacement » plutôt que le remplacement concerné.

Cette itération ferme la seconde moitié du parcours :

`Notification → clic Ouvrir → route → page destination → ressource exacte ouverte/sélectionnée`.

Aucune assertion RED existante n'a été modifiée. Aucun fichier `*.red.test.*` n'a été touché.

## 2. Consommation des paramètres, page par page

| Paramètre | Page de destination | Ce que la page fait maintenant |
| --- | --- | --- |
| `conversationId` | `MessagesConversationsPage` | Sélectionne la conversation ; l'effet existant charge le fil et applique le marquage lu selon `canUpdate`. |
| `announcementId` | `AnnouncementsPage` | Sélectionne l'annonce une fois la liste chargée, ce qui préserve l'aiguillage plateforme/école ; l'effet existant charge le détail et marque lu. |
| `paymentId` | `EntityPage` (`payments`) | Ouvre le reçu du paiement (`setReceiptPayment`), même action que le bouton « Reçu ». |
| `reportCardId` | `EntityPage` (`bulletins`) | Ouvre la fiche du bulletin (`setEditing`), même action que le bouton « Modifier ». |
| `obligationId` | `FinanceUnpaidPage` | Ouvre le détail de l'élève porteur de l'impayé et met l'obligation visée en évidence. |
| `attendanceId` | `PresencesPage` | Positionne l'appel sur la classe de la présence et met l'élève concerné en évidence. |
| `gradeId` | `GradesEvaluationsPage` | Positionne classe, période, évaluation et élève, bascule sur « Par élève » et met la note en évidence. |
| `weeklySlotId` | `CoursePlanningPage` | Se place sur la classe du créneau, élargit la période si nécessaire et ouvre la fiche du créneau. |
| `replacementId` | `PlanningSubstitutionsPage` | Sélectionne le **remplacement existant**. Le wizard de création ne s'ouvre pas. |

### Choix techniques

- **Lecteur unique** : `web/src/lib/notificationDeepLink.ts` (`useDeepLinkId`,
  `useDeepLinkIds`) lit les paramètres via `useSearchParams`. Une seule source pour
  les neuf destinations, donc pas de divergence de nommage entre pages.
- **Réutilisation des mécanismes existants** : chaque page appelle ses propres
  setters de sélection (`setSelectedId`, `setReceiptPayment`, `setEditing`,
  `setDetailStudentId`, `selectClass`, `openEdit`). Aucune logique métier de domaine
  n'est modifiée : ni chargement, ni validation, ni écriture.
- **Application unique** : les pages dont la sélection peut être refermée par
  l'utilisateur (`EntityPage`, `FinanceUnpaidPage`, `PresencesPage`,
  `GradesEvaluationsPage`, `CoursePlanningPage`) mémorisent l'identifiant déjà
  appliqué dans une `ref`, pour que le deep-link ne rouvre pas la fiche en boucle.
- **Mise en évidence** : `DataTable` et le `Table` du design-system reçoivent une
  prop optionnelle `isRowSelected`. Sans cette prop, leur rendu est inchangé.
- **RBAC inchangé** : chaque effet est conditionné par le `canRead`/`canAccess` déjà
  en place, et la résolution se fait dans les lignes déjà chargées et déjà filtrées
  par le périmètre serveur. Un identifiant hors périmètre n'ouvre rien : le
  deep-link désigne une ressource, il n'accorde jamais un droit.
- **`teacher_replacement`** : `wizardOpen` n'est plus amorcé par le seul
  `weeklySlotId`. Il vaut `Boolean(weeklySlotId) && !replacementId`. Le parcours
  « Programmer un remplacement » depuis le planning, qui n'envoie pas de
  `replacementId`, reste identique.

## 3. Tests ajoutés

54 tests, tous verts, dans huit fichiers :

| Fichier | Tests | Portée |
| --- | --- | --- |
| `web/src/lib/notificationDeepLinkContract.test.ts` | 29 | Contrat : pour chacune des neuf destinations, la page servie par la route consomme exactement la clé produite par le résolveur. Vérifie aussi que `teacher_replacement` n'ouvre pas la création. |
| `web/src/pages/notificationDeepLinkJourney.test.tsx` | 4 | Parcours complet dans un même Router : centre de notifications, clic réel sur « Ouvrir », page d'arrivée, ressource ouverte (conversation et remplacement). |
| `web/src/pages/AnnouncementsPage.deeplink.test.tsx` | 4 | Annonce école et annonce plateforme, marquage lu, cas sans paramètre. |
| `web/src/pages/EntityPage.deeplink.test.tsx` | 5 | Reçu de paiement, fiche bulletin, cas sans paramètre, identifiant hors périmètre. |
| `web/src/pages/finances/FinanceUnpaidPage.deeplink.test.tsx` | 3 | Détail de l'élève et obligation mise en évidence. |
| `web/src/pages/PresencesPage.deeplink.test.tsx` | 3 | Classe ouverte et élève mis en évidence. |
| `web/src/pages/GradesEvaluationsPage.deeplink.test.tsx` | 3 | Vue « Par élève » positionnée et note mise en évidence. |
| `web/src/pages/CoursePlanningPage.deeplink.test.tsx` | 3 | Créneau ouvert et classe sélectionnée. |

Chaque page a un test négatif : sans paramètre, ou avec un identifiant absent du
périmètre autorisé, rien n'est ouvert d'office.

### Ce que le contrat verrouille

Les tests R1 prouvaient `navigate("/page?id=123")`. Ils ne prouvaient pas que la page
lisait `id`. Renommer un paramètre d'un seul côté aurait laissé un bouton « Ouvrir »
silencieusement inopérant. `notificationDeepLinkContract.test.ts` échoue désormais dans
ce cas.

## 4. Harnais de test existants adaptés

`PresencesPage` et `FinanceUnpaidPage` lisent maintenant l'URL, donc leurs tests
doivent les monter sous un Router. Trois fichiers de test existants ont reçu un
wrapper `MemoryRouter` :

- `web/src/pages/PresencesPage.test.tsx`
- `web/src/pages/finances/FinanceUnpaidPage.fastPayment.test.tsx`
- `web/src/pages/finances/FinanceUnpaidPage.registerPayment.test.tsx`

Seul le montage change. Aucune assertion, aucun mock métier, aucun scénario n'a été
modifié dans ces fichiers.

## 5. Résultats

| Vérification | Résultat |
| --- | --- |
| Suite Web complète | 173 fichiers, **928 tests verts** (874 avant, +54) |
| Suites backend navigation (C0 à C3) | **20 tests verts**, inchangées |
| `npx tsc --noEmit` (web) | 0 erreur |
| `npm run lint` | 0 erreur (71 avertissements préexistants) |
| `npm run verify:communications-c4` | `verify-communications-c4: GO` |
| `node scripts/verify-ui-french-copy.js` | OK |
| `node scripts/verify-api-legacy-aliases.js` | OK |

Les 37 tests de la phase précédente (R1 à R5 et corrections C0–C3) font partie des 928
et restent verts.

## 6. Périmètre

Aucun changement fonctionnel hors deep-link dans Messages, Annonces, Finance,
Présences, Notes, Bulletins ou Planning. Les seules modifications de production sont :

- l'ajout du lecteur de paramètres et du contrat exportable ;
- un effet de sélection par page, appuyé sur les setters existants ;
- deux props optionnelles de mise en évidence (`isRowSelected` sur les deux tables,
  `highlightGradeId` sur `StudentGradesPanel`) ;
- des attributs `data-*` de test sur des éléments déjà rendus.

Le backend n'est pas touché par cette itération.

## 7. Suite

Arrêt avant Ready et avant merge, comme demandé, en attente d'un nouveau diff GitHub
indépendant.
