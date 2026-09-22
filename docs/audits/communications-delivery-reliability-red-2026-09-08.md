# Lot K — Audit RED : Delivery Reliability & Retry (PUSH / EMAIL)

**Date :** 8 septembre 2026  
**Branche :** `cursor/lot-k-delivery-reliability-red-3171`  
**Base :** `origin/develop` après merge #560 (`d4c896b8cde8d9f85514a7cb634cc8d7aed1212c`)  
**Périmètre :** inventaire + contrats RED. **Aucun GREEN.** Aucune migration. Aucune route. Aucune UI.

STOP obligatoire après ce livrable. Attendre revue CTO avant GREEN.

Le GREEN Lot K **ne doit pas** partir de ce HEAD : `git checkout -b cursor/lot-k-delivery-reliability-green-3171 origin/develop`.

---

## 0. Synthèse CTO (lire en premier)

Le fan-out C4 (`communication_channel_deliveries`) **existe déjà** (#545) :

- retry PUSH / EMAIL après erreur temporaire ;
- backoff exponentiel (5 s → cap 15 min, `MAX_ATTEMPTS = 8`) ;
- idempotence `delivery_key` UNIQUE ;
- `claimDue` ne SELECT **jamais** `processing` (SKIP LOCKED sur `pending`/`failed`).

Trois trous Lot K (prouvé par lecture + RED runtime) :

| ID | Trou | Preuve actuelle (`d4c896b8`) |
|---|---|---|
| **RED-COM-08A** | Pas d’état `dead_letter` | `markFailed` reste `failed` + `available_at` +365 jours quand `attempts >= 8` |
| **RED-COM-08B** | Worker mort **avant** l’appel fournisseur : delivery perdue | `recoverStaleProcessing` force `skipped` / `stale_processing_no_redelivery` — aucun reclaim |
| **RED-COM-08C** | Pas d’observabilité admin | aucun snapshot compteurs / last_error / attempts ; aucune route diagnostic |

**Non-RED (déjà GREEN — ne pas recréer) :** retry après Expo/SMTP 503, succès non renvoyé, `delivery_key`, SMTP `Idempotency-Key` / `Message-ID`, isolation tenant, dispatcher unique (`AUDIT-COM-05`), Lot H prefs, Lot I AND école, EMAIL reset mandatory, Lot J inbox C4.

**Tension d’architecture à trancher en GREEN (pas un skip) :**

`AUDIT-COM-03` / `RED-COM-01c` ferment un `processing` périmé en **skip** pour éviter un **second envoi** après crash *post-fournisseur*. Lot K exige à la fois :

1. **récupérable** si le worker meurt **avant** l’appel Expo/SMTP ;
2. **aucune duplication** si le crash arrive **après** un succès fournisseur et avant `markSent`.

GREEN attendu : distinguer les deux via un marqueur durable `dispatch_started_at` (ou équivalent) posé **immédiatement avant** l’appel fournisseur.

```text
processing + claimed_at périmé + dispatch_started_at IS NULL
  → reclaim pending/failed (un seul envoi ultérieur)

processing + claimed_at périmé + dispatch_started_at IS NOT NULL + sent_at IS NULL
  → skip / no_redelivery (ambiguïté post-fournisseur, pas de second send)
```

`claimDue` reste limité à `pending`/`failed` : on ne SELECT pas `processing` pour un second envoi.

---

## 1. États durables attendus

| Statut | Sens |
|---|---|
| `pending` | enqueued, pas encore claimed |
| `processing` | lease worker (`claimed_at`) |
| `sent` | fournisseur OK (`sent_at`, `provider_ref`) |
| `failed` | erreur temporaire, retry après backoff |
| `dead_letter` | tentatives épuisées — plus jamais claimed |
| `skipped` | terminal non-retryable (pas de device, pas d’email, canal unsupported, ambiguïté post-fournisseur) |

Aujourd’hui : `pending` / `processing` / `sent` / `failed` / `skipped`. **Pas de `dead_letter`.**

---

## 2. Inventaire runtime (`backend/lib/communicationChannelFanout.js`)

| Surface | État |
|---|---|
| `ensureDelivery` `ON CONFLICT (delivery_key) DO NOTHING` | OK |
| `claimDue` `FOR UPDATE SKIP LOCKED` `pending`/`failed` `attempts < 8` | OK |
| `retryDelayMs` 5 s × 2^n cap 15 min | OK |
| `markFailed` exhausted | **`failed` + 365 jours** — pas `dead_letter` |
| `recoverStaleProcessing` | **toujours `skipped`** |
| `markDispatchStarted` / `dispatch_started_at` | **absent** |
| snapshot compteurs / last_error | **absent** |
| `GET /api/backoffice/communications/deliveries/health` | **absent** |

Résidu documenté dans le drain actuel :

> At-most-once: a stale processing lease is closed as skipped, never redispatched. Residual: crash after claim and before the provider call also skips (lost send).

C’est exactement RED-COM-08B.

---

## 3. Observabilité attendue (sans PII)

Un Superadmin / Admin Pays / Admin School doit pouvoir diagnostiquer **sans** :

- email destinataire ;
- `ExponentPushToken[…]` ;
- body/title payload ;
- `delivery_key` (contient `userId`) ;
- secrets SMTP / Bearer.

Autorisé : compteurs par `channel` × `status`, `attempts` (max / distribution), `last_error` sanitizé, horodatage.

---

## 4. Conservations GREEN (non négociables)

- PUSH = Expo + FCM (jamais Brevo). EMAIL = SMTP / Brevo-as-SMTP.
- Pas de SMS / WhatsApp / nouveau fournisseur.
- Dispatcher = unique caller de `fanOutNotificationChannels`.
- `auth.password.reset` EMAIL mandatory.
- Quatre familles distinctes : C4 inbox, `notifications` plateforme, C3 announcements, `platform_announcements`.
- Pas `main`. Pas Render. Pas production.

---

## 5. RED historiques fermés (sans merge)

| PR | HEAD | Motif |
|---|---|---|
| #552 | `8348b751` | GREEN F / Lot J déjà sur develop |
| #554 | `3f9c07fe` | GREEN G déjà dans la chaîne Communications |

Ces HEAD **ne doivent jamais** être mergés ni ancêtres d’un GREEN.

---

## 6. GREEN suivant

Branche neuve depuis `origin/develop` (`d4c896b8` ou plus récent). PR Draft. Diff GitHub CTO indépendant avant merge.
