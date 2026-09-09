# Notifications — Phase GREEN (C0 → C3)

**Base SHA** : `7bcca23a3e594985c4a5d2ff6ef4e516a073f808` (`develop`, merge de la PR #569)
**Branche / PR** : `cursor/notifications-red-tests-d98a` — PR #570 (même PR que la phase RED)
**HEAD SHA** : reporté dans la description de la PR.
**Phase précédente** : `notifications-navigation-red-2026-09-09.md` (37 tests, 26 rouges).

## 1. Résultat

**37 / 37 GREEN.** Les 26 tests rouges de la phase RED passent, sans qu'aucune
assertion n'ait été modifiée : les fichiers de test sont identiques à ceux que le
CTO a contrôlés sur GitHub.

| Lot | Fichier | Tests | RED avant | Après |
| --- | --- | --- | --- | --- |
| R1 — navigation Web | `InternalNotificationsCenter.navigation.red.test.tsx` | 12 | 12 rouges | 12 verts |
| R2 — producteurs planning | `communicationsPlanningNavigation.red.test.js` | 7 | 7 rouges | 7 verts |
| R3 — API (harnais) | `communicationsUnreadPagination.red.test.js` | 4 | 4 verts | 4 verts |
| R3 — Web (preuve) | `InternalNotificationsCenter.counter.red.test.tsx` | 5 | 4 rouges | 5 verts |
| R4 — contrat producteurs | `communicationsNavigationContract.red.test.js` | 5 | 2 rouges | 5 verts |
| R5 — sécurité navigation | `communicationsNavigationSecurity.red.test.js` | 4 | 1 rouge | 4 verts |

## 2. C0 — refus fail-closed des cibles inter-tenant

Nouveau module dédié : `backend/lib/communicationsNavigationTargets.js`.

Il porte le registre figé des cibles — pour chaque type, les identifiants
transmis au client et la table qui atteste leur rattachement d'établissement — et
une seule fonction, `sanitizeNavigationTargets()`, appelée aux trois points de
lecture du service : `list()`, `get()` et `markRead()`.

### 2.1 Justification technique

Trois propriétés sont tenues volontairement.

**Aucun N+1.** La fonction collecte d'abord tous les identifiants de la page,
les regroupe par table, puis émet **une requête par type de ressource présent**,
sur un tableau d'identifiants (`id = ANY($1::uuid[])`). Le nombre de requêtes est
borné par le nombre de types de cibles présents — au plus onze — et il est
**indépendant de la taille de la page**. Une page de 50 notifications de messages
coûte une requête, pas cinquante.

**Aucune réhydratation de la ressource.** Les requêtes ne sélectionnent que
`id`, jamais une colonne métier. La notification ne s'enrichit pas du contenu de
sa cible : elle reste un pointeur. Le RBAC de la ressource visée demeure seul
juge de son contenu, au moment où l'utilisateur l'ouvre. C'est ce que
`RED-N5-04` continue de vérifier : la requête de lecture de l'inbox ne joint
aucune table métier.

**Tolérance à la suppression, refus du cross-tenant.** Le critère de refus n'est
pas « l'identifiant existe » mais « l'identifiant existe *et* appartient à un
autre établissement » :

```sql
SELECT id::text FROM <table> WHERE id = ANY($1::uuid[]) AND school_id <> $2::uuid
```

Une ressource supprimée n'est plus rattachée à personne : le pointeur est
conservé tel quel, inerte, et ne résout plus rien — comportement exigé par
`RED-N5-01`. Une ressource existante rattachée à une autre école déclenche la
suppression de la cible : la notification reste lisible, mais devient non
ouvrable — comportement exigé par `RED-N5-02`.

S'y ajoutent deux refus par défaut : un type de cible hors du registre est
supprimé, et un rattachement invérifiable — table absente, erreur SQL — est
traité comme non conforme. L'interpolation du nom de table provient
exclusivement du registre interne, jamais d'une donnée d'entrée, et est de plus
filtrée par une liste blanche.

### 2.2 Ce que C0 ne fait pas

Aucune refonte RBAC. Aucun changement de schéma PostgreSQL. Aucune route
ajoutée ou modifiée. La validation s'applique uniquement à la projection des
cibles de navigation.

## 3. C1 — cibles des producteurs planning

Dans `eventSpec()`, les deux affectations `navigationTarget = {}` sont
remplacées par les cibles attendues, à partir de données déjà présentes dans le
payload de l'évènement — aucune requête supplémentaire, aucun changement de
producteur outbox, aucune migration :

- `planning.timetable.changed` → `{ type: "timetable", weeklySlotId, classId }` ;
- `planning.teacher.replacement` → `{ type: "teacher_replacement", replacementId, classId, weeklySlotId, occurrenceDate }`.

`weeklySlotId` et `occurrenceDate` sont inclus dans la cible de remplacement
parce que `/planning/remplacements` lit déjà exactement ces deux paramètres.
Tous les identifiants transmis figurent au registre C0 et sont donc validés.

## 4. C2 — résolveur de navigation Web unique

Nouveau module `web/src/lib/notificationNavigation.ts`, seul endroit où une
cible devient une destination. `resolveNotificationDestination()` traduit les
neuf types du contrat vers des routes réellement déclarées dans `App.tsx`, en y
joignant les identifiants :

| Cible | Destination |
| --- | --- |
| `conversation` | `/messages?conversationId=…` |
| `announcement` | `/annonces?announcementId=…` |
| `payment` | `/finances/paiements?paymentId=…&studentId=…` |
| `attendance` | `/presences?attendanceId=…&studentId=…` |
| `grade` | `/notes?gradeId=…&studentId=…` |
| `report_card` | `/bulletins?reportCardId=…&studentId=…` |
| `finance_obligation` | `/finances/impayes?obligationId=…&studentId=…` |
| `timetable` | `/planning/emploi-du-temps/calendrier?weeklySlotId=…&classId=…` |
| `teacher_replacement` | `/planning/remplacements?replacementId=…&weeklySlotId=…&occurrenceDate=…&classId=…` |

Les paramètres reprennent le nom de l'identifiant métier, comme le fait déjà
`/planning/remplacements` avec `weeklySlotId` et `occurrenceDate`.

Deux règles closent le défaut d'origine. L'identifiant principal est
obligatoire : sans lui, la fonction renvoie `null` et **on ne retombe pas sur une
liste générique** — l'interface signale que la notification ne renvoie vers
aucune ressource consultable. Et une cible supprimée par C0 se comporte
exactement comme une cible vide : elle n'est pas ouvrable. Sécurité et
navigation convergent sans code de liaison.

## 5. C3 — compteur et pagination, côté client uniquement

Trois changements, tous dans le Web :

1. le compteur de la page provient désormais de `internal-notifications/unread-count`,
   **le même point d'entrée que la pastille du Topbar**. La parité est donc
   structurelle : il n'y a plus de décompte local calculé sur une page partielle.
   Si l'appel échoue, la page n'affiche aucun nombre plutôt qu'un nombre faux ;
2. `nextCursor` est conservé en état et une commande « Charger les notifications
   plus anciennes » consomme la page suivante, en concaténant sans doublon ;
3. `internalNotificationsApi.list()` accepte un `cursor` optionnel, transmis en
   paramètre de requête.

### 5.1 Preuve que la pagination backend n'a pas changé

Le diff du service backend ne contient que six modifications : l'import du
module C0, trois appels à `sanitizeNavigationTargets()` et les deux cibles de
C1. `parseLimit()`, `parseCursor()`, `makeCursor()`, `fetchRecipientPage()`, la
boucle de balayage de `list()` et le calcul de `nextCursor` sont **inchangés au
caractère près**. La route `GET /api/backoffice/internal-notifications`
transmettait déjà `req.query` au service : elle n'est pas touchée non plus.

Le harnais `communicationsUnreadPagination.red.test.js`, vert avant comme après,
verrouille ce contrat côté API.

## 6. Fichiers de production modifiés

| Fichier | Lot | Nature |
| --- | --- | --- |
| `backend/lib/communicationsNavigationTargets.js` | C0 | nouveau module |
| `backend/lib/communicationsNotificationsService.js` | C0 + C1 | 3 appels de validation, 2 cibles |
| `web/src/lib/notificationNavigation.ts` | C2 | nouveau module |
| `web/src/lib/internalNotificationsApi.ts` | C3 | `cursor` optionnel sur `list()` |
| `web/src/components/communications/InternalNotificationsCenter.tsx` | C2 + C3 | résolveur, compteur serveur, pagination |

Rien d'autre. Aucun fichier hors domaine Notifications.

## 7. Preuve qu'aucun comportement hors Notifications n'a changé

- **Périmètre du diff** : cinq fichiers de production, tous dans le domaine
  Notifications. `clientsPgStore.js`, `server.js`, `rbacService.js`, le schéma
  PostgreSQL et les migrations ne sont pas touchés.
- **Aucune route, aucun contrat d'API modifié** : `list()` accepte un paramètre
  de requête que le service lisait déjà. Aucune réponse ne perd de champ ;
  `navigationTarget` gagne un contenu là où il était vide.
- **Aucune modification de schéma** : pas de migration, pas de trigger, pas de
  colonne.
- **Suites hors Notifications** : portail `verify:communications-c4` complet vert
  (incluant les parcours HTTP PostgreSQL, l'audit d'architecture, les
  préférences, le fanout, les Lots I à L5), suite Vitest Web complète verte
  (165 fichiers, 874 tests), `tsc --noEmit` Web vert, typecheck Mobile vert.
- **Mobile inchangé** : aucune adaptation nécessaire. Les nouveaux types de
  cible passent par l'allowlist existante de `pushNotificationDestinations.ts`,
  qui les traite comme des types non déclarés — comportement inchangé, sans
  erreur. Les suites Mobile du portail restent vertes.

## 8. Hors périmètre, conformément à l'arbitrage

Archives (C4) différé. Aucune refonte RBAC. Aucun élargissement de droits.
Aucune modification d'un autre domaine métier. Le lot N6 — synchronisation
Web/Mobile — reste en deuxième vague.
