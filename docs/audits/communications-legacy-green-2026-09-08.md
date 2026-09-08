# PR F GREEN — consolidation progressive lecteurs notifications (06A/06B/06C/06E)

**Date :** 8 septembre 2026  
**Branche :** `cursor/communications-legacy-green-3171`  
**Base :** `origin/develop` `0c2cba7509fefd2eee593bdf45c0968d8aa94e56` (#551)  
**RED non mergée :** #552 HEAD `8348b75102982428129b77048e963ace210bda59` — **ne pas merger, ne pas rebaser dessus**

## Contrôle d’ascendance (obligatoire avant merge)

```bash
git merge-base --is-ancestor 8348b75102982428129b77048e963ace210bda59 HEAD
# attendu : exit 1 (HEAD #552 n'est pas ancêtre)
```

Cette GREEN a été créée par `git checkout -b … origin/develop`. Aucun cherry-pick / merge de #552.

## Périmètre corrigé

| RED | Correction |
|---|---|
| **06A** | `paymentWorkflow` n’injecte plus `state.notifications`. `buildParentPaymentNotification` retiré. L’inbox paiement reste C4 `finance.payment.recorded`. |
| **06B** | `/notifications` = `InternalNotificationsCenter` uniquement. Catalogue famille B déplacé vers `/notifications-plateforme`. KPI école ne lit plus le dataset legacy. |
| **06C** | Home Mobile : CTA Notifications → `InternalNotifications` dès que la route C4 est lisible. |
| **06E** | KPI « Alertes à traiter » = comptes inactifs uniquement. Unread école = cloche C4 (`unread-count`). Plus de `status === "Non lu"` legacy dans `getLiveKpis`. |

**Non touché :** C3, `platform_announcements`, table `notifications` + API `/backoffice/notifications`, #544–#551, dispatcher, fan-out, prefs.

## Conservation UI

- Cloche école → `/notifications` + unread C4
- Cloche plateforme (pas d’école) → `/notifications-plateforme` + dataset B
- Mobile `PlatformNotificationsScreen` et drawer Superadmin inchangés
- Liste `/annonces` toujours C3 + D tagués

## Hors périmètre

- Drop table `notifications`
- Fusion C3 ↔ D
- PR G SMTP demande d’essai
- Ready / merge de #552
