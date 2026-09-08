# Lot J / GREEN F — consolidation progressive notifications legacy → C4

**Date :** 8 septembre 2026  
**Branche :** `cursor/lot-j-communications-green-3171`  
**Base :** `origin/develop` `db2721cf9b47f92f9ebf94871666424611aa4bef` (#559)  
**RED non mergée :** #552 HEAD `8348b75102982428129b77048e963ace210bda59` — **ne pas merger, ne pas rebaser dessus**  
**GREEN F historique :** #553 déjà mergée dans develop — cette PR continue le lot, sans réécrire #553.

## Contrôle d’ascendance (obligatoire avant merge)

```bash
git merge-base --is-ancestor 8348b75102982428129b77048e963ace210bda59 HEAD
# attendu : exit 1 (HEAD #552 n'est pas ancêtre)
```

Cette GREEN a été créée par `git checkout -b … origin/develop`. Aucun cherry-pick / merge de #552. Hors périmètre : #554 SMTP demande d’essai.

## Périmètre Lot J

| ID | Correction |
|---|---|
| **J-01** | `paymentWorkflow` / `quickPayment` déjà C4. **Nouveau :** `paymentTransactionService.applyAtomicPayment` n’injecte plus `state.notifications`. Inbox paiement = `finance.payment.recorded` uniquement. |
| **J-02** | `/notifications` = `InternalNotificationsCenter`. Catalogue B = `/notifications-plateforme` + `platformApi`. |
| **J-03** | Home / cloche Mobile : `resolveNotificationsInboxRoute(session, activeSchoolCode)`. Un privilège plateforme **ne** route **pas** vers `PlatformNotifications` dans un contexte établissement. |
| **J-04** | KPI « Alertes à traiter » = `schoolUnreadCount` (C4 `notification_recipients.read_at` / `archived_at`, Lots H+I). Plus de `status === "Non lu"` ni de comptes inactifs. |

## Conservé (consommateurs encore réels)

- Table `notifications` + API `/backoffice/notifications` (catalogue plateforme)
- `scopedNotifications` pour le catalogue B et Topbar hors école
- `announcements` / `announcement_recipients` (C3)
- `platform_announcements`
- Relances impayés `unpaidService` → `state.notifications` (pas `finance.payment.recorded`)
- Lot H prefs, Lot I policy, snapshot `recipient_context.kinds`, store mémoire partagé, EMAIL reset obligatoire

## Hors périmètre

- Drop table `notifications`
- Fusion C3 ↔ D
- PR G / #554 SMTP demande d’essai
- Ready / merge de #552
- SMS / WhatsApp / nouveau provider
