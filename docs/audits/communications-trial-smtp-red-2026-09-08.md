# PR G — Audit RED : demande d’essai SMTP → delivery EMAIL durable

**Date :** 8 septembre 2026  
**Branche :** `cursor/trial-smtp-delivery-red-3171`  
**Base :** `origin/develop` après merge #553 (`9d9d4ffb6264308a0e8378c5ff404579b3d72914`)  
**Périmètre :** audit + 4 RED légitimes (07A–07D) + conservation 07E/07F. Aucun GREEN. Aucune table. Aucune résolution.

STOP obligatoire après ce livrable. Draft. Jamais merge. Le GREEN futur repart de `develop`, **pas** de ce HEAD RED.

---

## 0. Synthèse CTO (lire en premier)

La demande d’essai **persiste déjà** le lead PostgreSQL **avant** SMTP, et un échec SMTP **ne rollback pas** le lead (07E déjà vert). Le honeypot et le consentement invalide **ne créent ni lead ni email** (07F déjà vert).

Le trou n’est pas « SMTP peut faire échouer le 201 ». Le trou est le **silo SMTP hors `communication_channel_deliveries`** :

```text
POST /api/public/trial-requests
→ validation / rate-limit / honeypot
→ INSERT trial_access_requests          ← durable
→ setImmediate(notifyTrialAccessRequest) ← SMTP nodemailer dans le process HTTP
→ HTTP 201
```

Aucun `ensureDelivery`. Aucune `delivery_key`. Un crash après COMMIT **perd l’email**. Un retry de `notifyTrialAccessRequest` **renvoie**. Le worker `drainChannelDeliveries` **ne voit jamais** cette intention.

Quatre RED seulement (prouvé par lecture + tests) :

| ID | Trou | Preuve |
|---|---|---|
| **RED-COM-07A** | Handler trial déclenche encore `notifyTrialAccessRequest` / SMTP direct après persist | `trialAccessRequests.js` L52–66 `setImmediate` ; `server.js` L503–504 `deferNotification: true` ; `trialAccessRequestNotification.js` L47–62 `sendMail` |
| **RED-COM-07B** | Aucune `communication_channel_delivery` durable avec le lead | `postgresRepository.createTrialAccessRequest` = INSERT seul ; `ensureDelivery` absent du chemin essai |
| **RED-COM-07C** | Pas de `delivery_key` idempotente stable | aucune occurrence `delivery_key` / `trial.access.request:` dans le module essai |
| **RED-COM-07D** | Retry de la même demande peut produire plusieurs EMAIL | SMTP silo sans `ON CONFLICT (delivery_key)` ; `notifyTrialAccessRequest` n’est pas idempotent ; course `findOpen` + double INSERT |

**Non-RED (déjà GREEN — ne pas recréer) :**

| ID | Pourquoi ce n’est pas un RED |
|---|---|
| **07E** | Échec SMTP catch + `console.error` ; `deferNotification` renvoie le lead avant SMTP ; test existant « panne du mailer ne rollback pas » |
| **07F** | Honeypot `website` → `{ id: "honeypot" }` sans persist ni notify ; consentement false → 400 avant INSERT |

**Contrainte d’architecture (verrouillée) :**

```text
PUSH  → Expo + FCM          (jamais Brevo)
EMAIL → SMTP / Brevo-as-SMTP
Canal ≠ fournisseur
delivery table canonique = communication_channel_deliveries
```

Ne **pas** passer la demande d’essai dans `processOneEvent`.  
Ne **pas** ajouter un second caller de `fanOutNotificationChannels` (AUDIT-COM-05).  
Réutiliser `drainChannelDeliveries`. Pas de nouveau dispatcher / worker / mailer / SDK.

---

## 1. Chemin HTTP actuel

Fichier : `backend/server.js` L501–507.

```text
POST /api/public/trial-requests
  trialRequestRateLimiter          ← clé IP, pas e-mail
  (pas de requireAuth)
  createTrialAccessRequest(repository, body, { deferNotification: true })
  res.status(201).json(created)
```

Commentaire runtime L508–509 : pas de session, pas de provisioning school/user/subscription, inbox Superadmin seulement.

Rate-limit : `backend/lib/rateLimit.js` `trialRequestRateLimitKey` = `trial-request:<ip>`.

Inbox lecture : `GET /api/backoffice/trial-requests` (auth Superadmin).

---

## 2. Transaction actuelle

**Il n’y a pas de transaction enveloppe lead + delivery.**

`backend/db/postgresRepository.js` `createTrialAccessRequest` L2260–2285 :

- `INSERT INTO trial_access_requests (...) RETURNING *`
- **pas** de `withTransaction`
- **pas** d’`INSERT communication_channel_deliveries`
- `public_ref` = `TRIAL-` + 8 hex si absent

Anti-doublon **applicatif** (pas une contrainte unique SQL sur email+école ouverte) :

- `findOpenTrialRequest(email, schoolName)` L2287–2298
- statuts ouverts : `nouvelle | contactee | qualifiee | essai_active`
- `createTrialAccessRequest` L30–35 : hit → HTTP 409

Course possible : deux POST concurrentes voient `findOpen` vide, deux INSERT, deux SMTP.

---

## 3. Emplacement exact de l’appel SMTP direct

| Étape | Fichier | Lignes | Quoi |
|---|---|---|---|
| Décision defer | `backend/server.js` | 503–504 | `deferNotification: true` |
| Schedule HTTP | `backend/lib/trialAccessRequests.js` | 56–66 | `setImmediate(() => notify(created))` |
| Chemin sync (tests / non-prod) | même fichier | 69–76 | `await notify(created)` dans try/catch |
| Transport | `backend/lib/trialAccessRequestNotification.js` | 28–45 | `nodemailer.createTransport` (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD`) |
| Envoi | même fichier | 47–62 | `transporter.sendMail({ from: MAIL_FROM, to, subject, text })` |
| Destinataire | `trialAccessRequestNotification.emailCopy.js` | `TRIAL_REQUEST_NOTIFY_TO` | **`contact@somafrik.app`** (override env `TRIAL_REQUEST_NOTIFY_TO`) |
| Expéditeur | env `MAIL_FROM` | — | **`notifications@somafrik.app`** / config Compose canonique |

Le module de copie (`buildTrialRequestNotificationEmail`) est réutilisable au GREEN. Le silo `sendMail` ne l’est pas.

---

## 4. Comportement en cas d’échec SMTP

| Cas | HTTP | Lead | Email |
|---|---|---|---|
| Production `deferNotification: true` | 201 **avant** SMTP | persisté | `setImmediate` ; échec → `console.error` seulement |
| `await notify` (défaut tests) | 201 / retour created | persisté | catch L71–76 ; pas de throw |
| SMTP absent (`SMTP_HOST` / `MAIL_FROM` manquants) | 201 | persisté | `{ skipped: true, reason: "smtp_not_configured" }` + `console.warn` |
| Crash process après COMMIT, avant `setImmediate` | 201 déjà parti | persisté | **email perdu** (pas de delivery à drainer) |

**07E n’est pas un RED :** SMTP n’influence déjà ni le statut HTTP ni le rollback du lead. Test existant : `trialAccessRequestNotification.red.test.js` « une panne du mailer ne rollback pas la demande PostgreSQL ».

Le trou associé est **07B** (pas de retry durable), pas 07E.

---

## 5. Idempotence actuelle

| Mécanisme | Portée | Limite |
|---|---|---|
| `findOpenTrialRequest` → 409 | même email + schoolName, statut ouvert | course concurrente possible |
| `deferNotification` après 201 | retry client → 409 | le premier `setImmediate` part quand même |
| `delivery_key` | **absente** | — |
| UNIQUE SQL `communication_channel_deliveries.delivery_key` | **non utilisée** par l’essai | déjà GREEN pour C4 / reset #547 |
| `notifyTrialAccessRequest` | **aucune** | chaque appel = un `sendMail` |

---

## 6. Risques crash / retry

| Scénario | Aujourd’hui |
|---|---|
| Crash après INSERT, avant `setImmediate` | lead OK, email perdu, **aucun replay worker** |
| Crash pendant `sendMail` | lead OK, email peut être perdu ou partiel ; pas de `provider_ref` / `status=sent` |
| Retry HTTP après 201 | 409 lead ; SMTP déjà schedulé une fois (séquentiel OK) |
| Course 2 POST | 2 leads + 2 SMTP |
| Retry worker C4 | **ne drain pas** l’essai (hors table deliveries) |
| Double appel `notify(created)` | 2 emails, pas de clé |

---

## 7. RED réels

Fichier : `backend/lib/communicationsTrialSmtp.red.test.js`.

Ces tests **assertent le contrat GREEN** et **échouent** sur `develop` actuel.

| ID | Assertion GREEN (doit échouer maintenant) |
|---|---|
| 07A | HTTP / `createTrialAccessRequest` / module notify **sans** `deferNotification` / `notifyTrialAccessRequest` / `setImmediate` / `nodemailer.sendMail` |
| 07B | après persist, **1** row EMAIL via `ensureDelivery` ; source contient `ensureDelivery` |
| 07C | `delivery_key` + préfixe `trial.access.request:` |
| 07D | retry 409 **et** exactement 1 delivery EMAIL ; **0** SMTP dans le persist |

Câblage C4 : `verify-communications-c4.js` exécute ce fichier **en dernier**. Draft attendu **rouge** sur 07A–07D. Ne pas SKIP.

---

## 8. Tests GREEN existants (doivent rester verts — hors C4 07A–07D)

| Périmètre | Fichiers | Note GREEN futur |
|---|---|---|
| Trial Web | `web/src/pages/TrialRequestPage.red.test.ts` (et inbox) | inchangé |
| Trial Backend public / 409 / consentement / pas de provisioning | `backend/lib/trialAccessRequests.red.test.js` | inchangé |
| Trial SMTP-direct (verrouille le silo actuel) | `backend/lib/trialAccessRequestNotification.red.test.js` | **à réécrire au GREEN** (aujourd’hui il exige `notify` après persist et `deferNotification: true`) |
| Privacy / AIPD | `docs/compliance/sous-traitants-transferts.md` ligne SMTP essai | GREEN : même destinataire, via deliveries |
| Rate limit IP | même fichier notification + `rateLimit.js` | inchangé |
| Pays francophones | inchangé | — |
| C4 / dispatcher / deliveries / reset EMAIL / préférences | C4 verify hors 07A–07D | AUDIT-COM-05 doit rester : trial **ne** `await fanOutNotificationChannels` **pas** |
| UI French Copy / PR Gates / Architecture Audit / Web build | gates existants | aucun Mobile sauf nécessité démontrée (aujourd’hui 0 hit essai dans Mobile) |

---

## 9. Proposition minimale GREEN (ne pas implémenter ici)

Miroir reset #547 (`passwordResetNotification.enqueuePasswordResetNotification`), **sans** `processOneEvent`, **sans** second dispatcher.

```text
POST /api/public/trial-requests
→ validation / rate-limit / honeypot          ← inchangé ; return avant txn
→ BEGIN
   INSERT trial_access_requests
   ensureDelivery EMAIL
     delivery_key = trial.access.request:<trialId>:EMAIL
     channel = EMAIL
     payload = { to: contact@somafrik.app, title, body, kind }
     payload SANS SMTP_PASSWORD / SMTP_USER
→ COMMIT
→ HTTP 201
→ worker existant runOnce
     → dispatchProcessedEvents (processed peut être [])
     → fanOutNotificationChannels
     → drainChannelDeliveries                 ← unique SMTP
```

### 9.1 Pourquoi `dispatchEmail` doit bouger (petit)

`communicationChannelFanout.js` `dispatchEmail` L405–411 :

```text
if (!userId || !schoolId) return { skipped: "missing_school_or_user" };
to = await adapter.getUserEmail(userId, schoolId);
```

Le destinataire essai est **`contact@somafrik.app`**, pas un `users` d’établissement.

Table actuelle : `school_id UUID NOT NULL REFERENCES schools(id)`, `user_id UUID NOT NULL REFERENCES users(id)`.

**Interdit :** faker un school/user pour satisfaire les FK.

Plus petit GREEN schéma :

- `school_id` / `user_id` **nullable** quand `notification_id IS NULL` (EMAIL opérationnel)
- `delivery_key` UNIQUE inchangé (idempotence)
- `dispatchEmail` : si `payload.to` est présent, l’utiliser ; ne pas exiger user/school ; **ne pas** appliquer les préférences utilisateur (destinataire opérateur, pas un user C4)
- `MAIL_FROM` reste lu par `createSmtpTransport` / `sendMail` du drain existant

### 9.2 Ce que GREEN ne fait pas

- Pas de `processOneEvent` / outbox C4 IN_APP pour l’essai
- Pas de `await fanOutNotificationChannels` depuis `trialAccessRequests.js` / `server.js` (AUDIT-COM-05)
- Pas de nouvel eventType dans `EVENT_EXTERNAL_CHANNEL_POLICY` (évite PUSH+EMAIL fan-out C4)
- Pas de nouveau worker, mailer, SDK Brevo/Expo
- Pas de création d’établissement / utilisateur / abonnement
- Honeypot / consentement false : **aucune** ligne lead **ni** delivery
- `trialAccessRequestNotification.js` : builder copie seulement (plus de `nodemailer`)

Clé recommandée (stable, unique, retry-safe) :

```text
trial.access.request:<trial_access_requests.id>:EMAIL
```

---

## 10. Fichiers impactés

### Ce RED (cette PR)

| Fichier | Rôle |
|---|---|
| `backend/lib/communicationsTrialSmtp.red.test.js` | 07A–07D + conservation 07E/07F |
| `docs/audits/communications-trial-smtp-red-2026-09-08.md` | ce livrable |
| `backend/scripts/verify-communications-c4.js` | exécute le RED en dernier |
| `.github/workflows/communications-c4.yml` | paths PR G |

### GREEN futur (hors cette PR)

| Fichier | Changement attendu |
|---|---|
| `backend/lib/trialAccessRequests.js` | txn : persist + `ensureDelivery` ; retirer `setImmediate` / notify SMTP |
| `backend/lib/trialAccessRequestNotification.js` | plus de transport ; garder copie / `to` |
| `backend/server.js` | retirer `deferNotification: true` |
| `backend/lib/communicationChannelFanout.js` | `dispatchEmail` : `payload.to` opérationnel |
| `backend/db/communicationsNotificationsSchema.js` + migration | `school_id` / `user_id` nullable pour EMAIL opérationnel |
| `backend/lib/trialAccessRequestNotification.red.test.js` | réécrire (ne plus verrouiller le silo SMTP) |
| `docs/compliance/sous-traitants-transferts.md` | même destinataire, via deliveries |

Mobile : **aucun** fichier (0 occurrence `trial-requests` aujourd’hui).

---

## 11–15. Git / PR (à compléter après push)

| # | Champ | Valeur |
|---|---|---|
| 11 | PR Draft URL | *renseigné après `ManagePullRequest`* |
| 12 | Base SHA | `9d9d4ffb6264308a0e8378c5ff404579b3d72914` (`origin/develop` #553) |
| 13 | HEAD SHA | *après commit* |
| 14 | ahead/behind | *après push* |
| 15 | diffstat | *après commit* |

Gouvernance :

- Draft. **Jamais merge.**
- GREEN G **repart de `develop`**. Ce HEAD **ne doit pas** être un ancêtre du GREEN.
- Avant merge GREEN : diff GitHub indépendant, HEAD exact, non-régression trial Backend/Web, C4, SMTP/deliveries, PR Gates, Architecture Audit, ascendance RED vérifiée (`git merge-base --is-ancestor <RED_HEAD> <GREEN_HEAD>` → **false**).

#552 (`8348b75102982428129b77048e963ace210bda59`) n’est **pas** un ancêtre de `develop` #553. Ne pas merger #552. Ne pas merger ce RED.
