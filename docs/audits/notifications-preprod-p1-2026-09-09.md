# P1 post-merge — Vérification préprod + notifications historiques

Date de sonde : 2026-09-09, 16:08–16:10 UTC
Branche de diagnostic : `cursor/notifications-preprod-audit-d98a`
Candidat attendu : `5069f60286fa2572fa565c09a02069986f12ddf2` (merge #570 sur `develop`)
Décision : **STOP avant toute PR de correction.** Aucun fichier de production n'est modifié.

## 0. Ce que la capture explique déjà

Avant #570, le Web n'ouvrait que trois types, et sans identifiant :

```ts
if (target.type === "conversation") navigate("/messages");
else if (target.type === "announcement") navigate("/annonces");
else if (target.type === "payment") navigate("/paiements");
```

Conséquences visibles dans la capture :

| Notification | Type backend historique | Comportement Web pré-#570 |
| --- | --- | --- |
| Nouveau message | `conversation` + `conversationId` | ouvre `/messages` (liste, pas le fil) |
| Paiement arrivé à échéance | `finance_obligation` + `obligationId` | **ignoré** — ce n'est pas `payment` |
| Emploi du temps modifié | `navigationTarget = {}` | **ignoré** — aucun `type` |

C'est exactement le comportement encore observé en préprod. Les deux causes du CTO sont confirmées ci-dessous, avec une précision : le frontend préprod **n'est pas** le build #570.

## 1. Déploiement — SHA réellement servi

### 1.1 GitHub

| Fait | Preuve |
| --- | --- |
| `develop` HEAD = `5069f602…` | `git fetch origin develop` → merge #570, 2026-09-09 17:42:15 +0200 (15:42 UTC) |
| `7204cae0` (HEAD de la PR #570) est ancêtre de `develop` | `git merge-base --is-ancestor` |
| Aucun workflow GitHub sur `5069f602` | `gh api …/commits/5069f602…/check-runs` → `{ total: 0 }` |
| Aucun workflow de déploiement Render dans `.github/workflows/` | les workflows CI ne déploient pas |

Un badge CI vert sur la PR #570 ne prouve pas un redéploiement préprod. Le contrat documenté (`docs/render.md`) exige `RENDER_WEB_DEPLOYED_SHA == RENDER_API_DEPLOYED_SHA == G3_CANDIDATE_SHA`, collés depuis le dashboard Render. Ces variables ne sont pas exposées ici.

### 1.2 Web préprod — **n'est pas #570**

URL : `https://preprod.somafrik.app`

| Signal | Valeur | Lecture |
| --- | --- | --- |
| `Last-Modified` de `index.html` | **2026-09-09 04:31:37 UTC** | 11 h **avant** le merge #570 (15:42 UTC) |
| Bundle servi | `/assets/index-Cbx63Ilh.js` | même `Last-Modified` 04:31:37 UTC |
| `etag` HTML | `W/"6b4fa89e31e8a901dcdb7261b6e5a246"` | figé |

Empreinte du JS servi (occurrences dans `index-Cbx63Ilh.js`) :

| Marqueur #570 | Présent ? |
| --- | --- |
| `resolveNotificationDestination` | **0** |
| `finance_obligation` | **0** |
| `teacher_replacement` | **0** |
| `conversationId` / `obligationId` / `weeklySlotId` | **0** |
| `Cette notification ne renvoie` | **0** |
| `/finances/impayes` | **0** |
| `/planning/emploi-du-temps` | **0** |
| `/paiements` (ancien switch à 3 types) | **4** |
| `/messages` | **10** |

Verdict Web : le Static Site `somafrik-web-preprod` sert encore le build d'avant #570. **Redéployer d'abord, sans modifier le code.** Tant que ce SHA n'est pas `5069f602` ou un descendant, aucun test « Ouvrir » en préprod n'est recevable comme preuve de régression #570.

### 1.3 API préprod — SHA **inconnu**

URL : `https://somafrik-api-preprod.onrender.com/api/health`

Réponse observée :

```json
{
  "status": "ok",
  "database": "postgresql",
  "version": "1.0.0",
  "timestamp": "2026-09-09T16:08:18.991Z",
  "attachments": { "ready": true, "required": true, "configured": true, "writable": true }
}
```

`/api/health` n'expose pas le SHA, comme le note déjà `backend/scripts/verify-preprod-503.js`. `/api/version` n'existe pas. `GET /api/backoffice/internal-notifications` exige un JWT : cette sonde n'a pas de compte préprod.

Verdict API : **vivante**, PostgreSQL prêt, SHA **non prouvé**. Il faut coller `RENDER_API_DEPLOYED_SHA` depuis le dashboard `somafrik-api-preprod`. Le code C1 (nouvelles cibles planning) n'affecte que les événements **créés après** le déploiement API. Les lignes déjà stockées ne changent pas toutes seules.

## 2. Contrat API des 3 notifications de la capture

Impossible de relever les `id` réels sans JWT. Contrat **déterministe** d'après `mapNotification` + `eventSpec` au moment de la création (code `7bcca23a` = develop juste avant #570, encore vrai pour paiement et message après #570).

`GET /api/backoffice/internal-notifications` projette pour chaque ligne :

`id`, `eventType`, `sourceEntityType`, `sourceEntityId`, `navigationTarget`, `metadataSafe`

### 2.1 Nouveau message

| Champ | Valeur attendue |
| --- | --- |
| `eventType` | `communication.message.created` (ou équivalent message) |
| `sourceEntityType` | `message` |
| `sourceEntityId` | id du message |
| `navigationTarget` | `{ type: "conversation", conversationId }` — **déjà rempli avant #570** |
| `metadataSafe` | audience / contexte destinataire |

Sur le Web encore servi : `type === "conversation"` → `/messages` **sans** `conversationId`. Après redéploiement #570 : `/messages?conversationId=…` puis sélection du fil.

### 2.2 Paiement arrivé à échéance

Producteur **inchangé** par #570. Dès `7bcca23a` :

```js
navigationTarget = {
  type: "finance_obligation",
  studentId: obligation.student_id,
  obligationId: sourceId,
};
metadata = { dueDate, feeType, periodLabel };
```

| Champ | Valeur attendue **déjà en base** |
| --- | --- |
| `eventType` | `finance.payment.due` |
| `sourceEntityType` | `student_fee_obligation` |
| `sourceEntityId` | UUID de l'obligation |
| `navigationTarget` | `{ type: "finance_obligation", studentId, obligationId }` |
| `metadataSafe` | `{ dueDate, feeType, periodLabel }` |

Sur le Web encore servi : `finance_obligation` n'est pas dans le switch → **Ouvrir ne navigue pas**. Ce n'est pas une cible vide. Dès que le Web #570 est servi, `resolveNotificationDestination` doit produire `/finances/impayes?obligationId=…&studentId=…`.

**Étape 3 — pas de RED maintenant.** Un RED « cible présente mais Ouvrir inopérant sur le build #570 » n'est recevable **qu'après** preuve que le Web sert `5069f602` (ou descendant) **et** que l'API renvoie bien le `navigationTarget` ci-dessus. Aujourd'hui le Web explique à lui seul le symptôme.

### 2.3 Emploi du temps modifié (13:41, avant le merge)

Producteur **avant #570** (`7bcca23a`) :

```js
navigationTarget = {};
metadata = {
  weeklySlotId: sourceId,   // = course_schedule_weekly_slots.id
  changeRevision,
  classId,
  academicYearId,
  dayOfWeek,
  startTime,
  endTime,
  teacherId,
  previousTeacherId,
};
```

| Champ | Valeur attendue **pour cette ligne historique** |
| --- | --- |
| `eventType` | `planning.timetable.changed` |
| `sourceEntityType` | `weekly_schedule_slot` |
| `sourceEntityId` | UUID du créneau (`NEW.id`) |
| `navigationTarget` | `{}` — **figé à la création** |
| `metadataSafe` | contient déjà `weeklySlotId` (= `sourceEntityId`) et `classId` |

C1 ne réécrit pas les lignes existantes. Après redéploiement API, **seules les nouvelles** modifications d'emploi du temps naissent avec `{ type: "timetable", weeklySlotId, classId }`. La notification de 13:41 restera non ouvrable tant qu'on ne backfill pas, même avec le Web #570 : le résolveur refuse une cible vide.

## 3. Backfill planning — possible sans inventer d'ID

Les trois sources d'identifiant sont déjà persistées, alignées, et ne viennent pas du client :

1. `communication_notifications.source_entity_id` — UUID du créneau (producteur SQL `v_source_id := NEW.id`)
2. `metadata.weeklySlotId` — même UUID, écrit par `eventSpec` **avant** C1
3. `metadata.classId` — déjà dans le payload outbox (`NEW.class_id`)

Backfill proposé, **contrôlé et idempotent**, à n'exécuter qu'après preuve de déploiement et après lecture des 3 lignes réelles :

```sql
UPDATE communication_notifications
SET navigation_target = jsonb_strip_nulls(jsonb_build_object(
  'type', 'timetable',
  'weeklySlotId', source_entity_id,
  'classId', NULLIF(metadata->>'classId', '')
))
WHERE event_type = 'planning.timetable.changed'
  AND (navigation_target = '{}'::jsonb OR navigation_target IS NULL)
  AND source_entity_id IS NOT NULL
  AND COALESCE(metadata->>'weeklySlotId', '') IN ('', source_entity_id::text);
```

Garanties :

- aucun ID inventé : on recopie `source_entity_id` déjà stocké ;
- garde `metadata.weeklySlotId` vide ou égal à `source_entity_id` : on refuse un écart ;
- idempotent : relancer le `UPDATE` ne change plus les lignes déjà remplies ;
- C0 (`sanitizeNavigationTargets`) reste le juge tenant à la lecture : un créneau d'un autre établissement serait neutralisé, un créneau supprimé resterait un pointeur inerte.

**Ne pas** faire un fallback UI du type « si `navigationTarget` est vide, lire `metadataSafe` ». Cela contournerait C0 et rouvrirait le trou fail-closed.

Aucun SQL n'est exécuté dans cette étape.

## 4. Doublons « Paiement arrivé à échéance » à 07:51

Ce n'est **pas** un défaut de clé d'idempotence à première lecture du code.

- Sweep : `event_key = finance.payment.due:{obligationId}`
- Outbox : `ON CONFLICT (event_key) DO NOTHING`
- Inbox : `communication_notifications.event_key` UNIQUE ; destinataires `ON CONFLICT (notification_id, user_id) DO NOTHING`
- Titre et corps sont **identiques** pour toutes les échéances : « Paiement arrivé à échéance » / « Un paiement scolaire est arrivé à échéance. » Le nom de l'élève et le type de frais sont dans `metadataSafe`, pas dans le titre.

Un balayage à 07:51 qui trouve N obligations exigibles produit N cartes visuellement identiques, avec des `sourceEntityId` / `obligationId` distincts. À vérifier sur l'API (une fois JWT disponible) :

```
regrouper les items 07:51 finance.payment.due par sourceEntityId
```

- 1 ligne par `sourceEntityId` → pas un bug de déduplication, un trou UX de titre ;
- plusieurs lignes pour le **même** `sourceEntityId` → là seulement, défaut de déduplication.

Aucun changement de mécanisme dans cette étape.

## 5. Test frais (étape 5) — bloqué

Conditions non réunies :

1. Web préprod ≠ `5069f602`
2. SHA API non prouvé
3. Pas de compte JWT pour générer / lire les notifications

Après redéploiement des deux services sur `5069f602` (ou descendant) :

1. Modifier un créneau hebdomadaire actif → nouvelle notif `planning.timetable.changed` avec `navigationTarget.type = "timetable"` et `weeklySlotId` → Ouvrir doit ouvrir la fiche du créneau.
2. Laisser une obligation devenir exigible (ou rejouer un sweep sur une obligation **sans** `event_key` déjà présent) → `finance.payment.due` avec `finance_obligation` + `obligationId` → Ouvrir doit ouvrir le détail Impayés.

Les notifications **historiques** de planning restent un sujet de backfill, distinct du test frais.

## 6. Décision

| Question | Réponse |
| --- | --- |
| Le Web préprod sert-il #570 ? | **Non.** Build 04:31 UTC, switch à 3 types. |
| L'API préprod sert-elle #570 ? | **Non prouvé.** Health OK, pas de SHA. |
| Faut-il un correctif code maintenant ? | **Non.** Redéployer le Web (et confirmer l'API) d'abord. |
| Faut-il un RED paiement ? | **Pas encore.** Seulement si, sur le build #570, la cible `finance_obligation` est bien renvoyée et Ouvrir échoue. |
| Faut-il un backfill planning ? | **Oui, ensuite**, SQL idempotent ci-dessus, pas un fallback UI. |
| Doublons paiement 07:51 | Très probablement N obligations, même libellé. Vérifier les `sourceEntityId` avant de toucher au sweep. |

**STOP.** Prochaine action ops, pas ingénierie : redéployer `somafrik-web-preprod` (et vérifier `somafrik-api-preprod`) sur `5069f60286fa2572fa565c09a02069986f12ddf2`, coller les deux SHA Render, puis relire les 3 notifications de la capture.
