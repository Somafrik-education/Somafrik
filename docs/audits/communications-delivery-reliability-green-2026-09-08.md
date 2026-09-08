# Lot K GREEN — Delivery Reliability & Retry (PUSH / EMAIL)

**Date :** 8 septembre 2026  
**Branche :** `cursor/lot-k-delivery-reliability-green-3171`  
**Base :** `origin/develop` `d4c896b8cde8d9f85514a7cb634cc8d7aed1212c` (#560)  
**RED :** #561 (`888cafd7`) — **pas un ancêtre** de cette branche.

STOP : PR Draft. Pas Ready. Pas merge autonome. Pas `main`. Pas Render. Pas production.

---

## Contrats corrigés

| ID | GREEN |
|---|---|
| **08A** | `markFailed` → `dead_letter` si `attempts >= 8` ; `claimDue` ne SELECT que `pending`/`failed` |
| **08B** | `processing` périmé **sans** `dispatch_started_at` → `failed` + `stale_lease_reclaimed` → un seul envoi |
| **08C/E** | `summarizeChannelDeliveryHealth` + `GET /api/backoffice/communications/deliveries/health` |
| **08D** | `dispatch_started_at` posé **avant** Expo/SMTP ; si le marqueur est posé, skip `stale_processing_no_redelivery` |

Crash après succès fournisseur avant `markSent` : **pas de second send** (conservation `AUDIT-COM-03` / tests existants).

## Observabilité

Compteurs `pending|processing|sent|failed|dead_letter|skipped` par canal, `attempts`, `last_error` sanitizé.  
Aucun email, token Expo, payload, `delivery_key`, secret SMTP.

RBAC : `Notifications:READ` + `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES`. Handler :

| Rôle | Scope |
|---|---|
| Superadmin | global (`mode: all`) |
| Admin Pays / `COUNTRY_ADMIN` | **iso_code pays uniquement** (`countryCode` / `countryScope` / `platformContext.kind=country`). Ambigu ou absent → **403** |
| Admin School | `school_id` de session. Absent → **403** |

Un Admin Pays CD ne lit aucune delivery d’un établissement d’un autre pays. Les EMAIL opérationnels sans `school_id` (essai) restent hors scope pays (INNER JOIN schools).

## P2 — fenêtre `dispatch_started_at` (non bloquant)

Entre `markDispatchStarted()` et l’appel Expo/SMTP, un crash worker pose `dispatch_started_at` puis le reclaim stale ferme en `skipped` / `stale_processing_no_redelivery`. **Pas de double envoi.** Résidu : **envoi éventuellement perdu**. Compromis at-most-once explicite. À reporter dans l’audit final Communications avant GO production.

