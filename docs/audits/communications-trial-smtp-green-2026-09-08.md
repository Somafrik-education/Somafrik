# PR G GREEN — demande d’essai SMTP → delivery EMAIL durable

**Date :** 8 septembre 2026  
**Branche :** `cursor/trial-smtp-delivery-green-3171`  
**Base :** `origin/develop` après merge #553 (`9d9d4ffb6264308a0e8378c5ff404579b3d72914`)  
**RED correspondant :** Draft #554 HEAD `3f9c07feb74493f0c24351632aa7d0d621e40b18` — **pas un ancêtre** de cette branche.

STOP merge / Ready / `main` / Render / production tant que le CTO n’a pas GO.

---

## Flux

```text
POST /api/public/trial-requests
→ validation / rate-limit / honeypot
→ BEGIN
   INSERT trial_access_requests
   ensureDelivery EMAIL
     delivery_key = trial.access.request:<id>:EMAIL
     channel = EMAIL
     school_id = NULL, user_id = NULL
     payload = { kind, to: contact@somafrik.app, title, body }
→ COMMIT
→ HTTP 201
→ worker runOnce → drainChannelDeliveries
→ SMTP / Brevo-as-SMTP (MAIL_FROM)
```

## Isolation tenant (`payload.to`)

`dispatchEmail` :

1. Si `user_id` **et** `school_id` sont des UUID → **uniquement** `getUserEmail(user, school)`. `payload.to` est **ignoré** (y compris un `kind: trial.access.request` injecté).
2. Sinon, EMAIL opérationnel **seulement** si `kind === "trial.access.request"` et `payload.to` non vide.
3. PUSH exige toujours user+school.

CHECK SQL `communication_channel_deliveries_recipient_chk` : tenant `(school_id AND user_id)` **ou** EMAIL opérationnel (FKs null + `payload.to`).

## Non-objectifs (respectés)

- Pas de `processOneEvent`
- Pas de second caller `fanOutNotificationChannels` (AUDIT-COM-05)
- Pas de nouveau worker / mailer / SDK
- Honeypot / consentement false : aucun lead, aucune delivery
- Pas de création school/user/subscription
- Mobile inchangé

## Tests

07A–07D doivent rester verts. Isolation `payload.to` dans `communicationChannelFanout.test.js`.
