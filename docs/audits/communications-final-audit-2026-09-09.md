# Audit final Communications Somafrik — AUDIT-COM-FINAL

**Date :** 9 septembre 2026  
**Mandat :** audit final H→K avant décision GO production  
**Base Git auditée :** `develop@a9400c26acd89d102b551edad8025df37efc325e` (merge #562 — Lot K Delivery Reliability & Retry)  
**Branche audit :** `cursor/audit-com-final-d98a`  
**HEAD audit :** `f9feb8c0eb48d2f2e70ef85fefda49701bb08908` (#564)  
**Contrôle CTO indépendant :** 8 septembre 2026 — HOLD confirmé ; errata documentaire Lot I (9 événements, non 10) corrigé dans ce commit.  
**RED historiques exclus :** #552 (`8348b751`), #554 (`3f9c07fe`), #561 (`888cafd7`)

---

## 1. Executive summary

**Verdict CTO recommandé : HOLD**

La chaîne Communications H→K est **cohérente, sécurisée, isolée et observable** pour les événements **effectivement câblés** (C4 outbox + fan-out PUSH/EMAIL + Lot I prefs + Lot K reliability). En revanche, sur le **contrat produit Lot I (9 événements canoniques)**, seuls **4/9** sont câblés aujourd’hui ; **5/9** figurent dans la politique établissement et l’UI Paramètres sans **producteur outbox** ni handler C4. Tant que ces producteurs ne sont pas livrés dans des PR GREEN dédiées, le GO production Communications global doit rester en attente.

| Classe | Ouverts |
|---|---|
| **P0** | 0 |
| **P1** | 1 (matrice événements incomplète — **4/9 câblés, 5/9 sans producteur**) |
| **P2** | 2 (résidu at-most-once ; legacy catalogue B conservé) |
| **Dette acceptée** | Relances impayés `unpaidService` → `state.notifications` ; SMTP essai opérationnel hors outbox C4 |

**Conclusion : COMMUNICATIONS HOLD** — ce verdict ne constitue pas une autorisation de déployer en production.

---

## 2. Base Git auditée

| Élément | Valeur |
|---|---|
| Base SHA | `a9400c26acd89d102b551edad8025df37efc325e` |
| HEAD audit (avant PR) | `a9400c26acd89d102b551edad8025df37efc325e` |
| Dernier commit base | Merge pull request #562 — Lot K Delivery Reliability & Retry |
| Ahead / behind develop | 0 / 0 (branche créée au HEAD exact) |
| Fichiers ajoutés par l’audit | `backend/lib/communicationsFinal.audit.test.js`, `docs/audits/communications-final-audit-2026-09-09.md` |

---

## 3. Architecture

Quatre familles restent séparées (validé runtime + PG + tests existants) :

| Famille | Tables canoniques | API / surface |
|---|---|---|
| **A — Inbox établissement C4** | `communication_notifications`, `notification_recipients`, `communication_channel_deliveries` | `/api/backoffice/internal-notifications` |
| **B — Catalogue plateforme (legacy)** | `notifications` | `/api/backoffice/notifications`, `/notifications-plateforme` |
| **C — Annonces établissement** | `announcements`, `announcement_recipients` | `/api/backoffice/announcements` |
| **D — Annonces plateforme** | `platform_announcements` | `/api/backoffice/platform-announcements` |

Pipeline runtime :

```text
Événement métier → communication_event_outbox
→ processOneEvent (IN_APP C4)
→ fanOutNotificationChannels (PUSH Expo + EMAIL SMTP)
→ communication_channel_deliveries (Lot K retry / dead_letter)
```

C4 n’écrit pas la table `notifications`. Brevo n’est **pas** utilisé comme fournisseur PUSH (Expo + FCM uniquement ; SMTP via Nodemailer).

---

## 4. Events

### Matrice événements Lot I (9 événements — `LOT_I_EVENTS` + contrainte PostgreSQL `school_notification_settings`)

**Bilan : 4/9 câblés (producteur outbox + handler C4), 5/9 sans producteur.**

| Événement | Producteur outbox | C4 créé | Destinataires (policy) | IN_APP | PUSH | EMAIL | Double-write legacy |
|---|---|---|---|---|---|---|---|
| STUDENT_ABSENT | `attendance.student.absent` | Oui | PARENT | Oui | Oui* | Oui* | Non |
| STUDENT_LATE | **Absent** | Non | PARENT | — | — | — | Non |
| GRADE_PUBLISHED | `pedagogy.grade.published` | Oui | PARENT, STUDENT | Oui | Oui* | Oui* | Non |
| REPORT_CARD_PUBLISHED | **Absent** | Non | PARENT, STUDENT | — | — | — | Non |
| PAYMENT_RECEIVED | `finance.payment.recorded` | Oui | PARENT | Oui | Oui* | Oui* | Non (J-01 GREEN) |
| PAYMENT_DUE | **Absent** | Non | PARENT, SCHOOL_ADMIN | — | — | — | Non |
| ANNOUNCEMENT_PUBLISHED | `communication.announcement.published` | Oui | PARENT, STUDENT, TEACHER, SCHOOL_ADMIN | Oui | Oui* | Oui* | Non |
| TIMETABLE_CHANGED | **Absent** | Non | TEACHER, SCHOOL_ADMIN | — | — | — | Non |
| TEACHER_REPLACEMENT | **Absent** | Non | PARENT, TEACHER, SCHOOL_ADMIN | — | — | — | Non |

\* Sous réserve politique école **AND** préférences utilisateur (Lot I + H).

### Événements hors matrice Lot I mais câblés

| Événement | Producteur | Canaux |
|---|---|---|
| `communication.message.created` | trigger `school_messages` | IN_APP + PUSH/EMAIL optionnels |
| `auth.password.reset` | `passwordResetNotification.js` | EMAIL **obligatoire** (mandatory, indépendant prefs) |

### Écarts

- **P1 — AUDIT-FINAL-P1-01 :** **5/9** événements Lot I configurables en UI (`SettingsNotificationsPage`) sans producteur outbox ni `processOneEvent` (`STUDENT_LATE`, `REPORT_CARD_PUBLISHED`, `PAYMENT_DUE`, `TIMETABLE_CHANGED`, `TEACHER_REPLACEMENT`).
- Aucun double envoi détecté sur les événements câblés (idempotence `event_key` outbox + `delivery_key` fan-out).

---

## 5. Recipients

Catégories canoniques : `PARENT`, `STUDENT`, `TEACHER`, `SCHOOL_ADMIN`.

Validé (tests Lot I + C4 PG) :

- snapshot `recipient_context.kinds` durable ;
- multi-rôles ordre-indifférent ;
- politique par catégorie réelle (pas d’union abusive sur `recipient_kind=school`) ;
- isolation établissement inbox / unread / mark read / archive (C4 HTTP PG) ;
- changement ultérieur de rôle n’altère pas la visibilité historique (snapshot).

---

## 6. Preferences / school policy

Règle : **school policy AND user preference** pour IN_APP / PUSH / EMAIL.

Cas validés runtime :

| Cas | Résultat |
|---|---|
| École désactive canal | pas d’enqueue externe |
| Utilisateur désactive canal | pas d’enqueue externe |
| École ON + user ON | éligible |
| Lecture prefs en erreur (table absente) | défaut all-canaux (documenté) |
| Lecture politique 42501 | fail-closed, pas d’enqueue |
| `auth.password.reset` | EMAIL mandatory même si prefs vides |

---

## 7. PUSH

Architecture : **Expo + FCM**. Audité runtime (`communicationChannelFanout.test.js`, AUDIT-COM-FINAL) :

- devices actifs filtrés `user_id + school_id + backend_environment` ;
- token révoqué ignoré ;
- token autre établissement / autre environnement ignoré ;
- multi-devices : un envoi groupé scoped ;
- absence device → `skipped` ;
- erreur Expo temporaire → retry puis `dead_letter` ;
- succès après retry → un seul send ;
- crash post-succès avant `markSent` → at-most-once (pas de double send).

---

## 8. EMAIL

Architecture : **SMTP / Nodemailer** (`SMTP_*`, pas Brevo SDK pour PUSH).

Validé :

- `Message-ID` / `Idempotency-Key` = `delivery_key` ;
- retry + dead_letter identiques PUSH ;
- `payload.to` ne override pas l’email tenant-scoped ;
- absence SMTP → `smtp_not_configured` / failed retryable ;
- credentials SMTP jamais exposés dans diagnostic.

---

## 9. Delivery reliability (Lot K)

| Contrat | Statut |
|---|---|
| États `pending`, `processing`, `sent`, `failed`, `dead_letter`, `skipped` | GO |
| Retry base 5 s, backoff exponentiel, cap 15 min, max 8 tentatives | GO |
| `dead_letter` non reclaim | GO |
| Cas A : `dispatch_started_at IS NULL` → reclaim → un envoi | GO |
| Cas B : `dispatch_started_at IS NOT NULL` → `skipped` / `stale_processing_no_redelivery` | GO |
| Diagnostic `GET /api/backoffice/communications/deliveries/health` | GO |

---

## 10. PostgreSQL

**Migrations Communications : GO**

Ordre vérifié : C4 (`20260828`) → deliveries (`20260907`) → reliability (`20260908`) → prefs (`20260910`) → school policy (`20260912`).

Alignement bootstrap / migration :

- `delivery_key UNIQUE` ;
- `dispatch_started_at` + indexes `processing` / `dead_letter` ;
- bootstrap `applyCommunicationsC4Schema` dans `clientsCanonicalBootstrap.js` ;
- test PG bootstrap payments (CAS A/B cancelled_at) — vert ;
- test concurrence PostgreSQL `delivery_key` (AUDIT-COM-FINAL-06) — vert.

Aucune divergence bloquante migration/bootstrap détectée.

---

## 11. RBAC

Diagnostic deliveries (`communicationsDeliveryHealth`) :

| Rôle | Scope | Verdict |
|---|---|---|
| Superadmin | global | GO |
| Admin Pays | un seul ISO (CD+RDC+CD→CD ; CD+BI→403) | GO |
| Admin School | `school_id` session ; absent→403 | GO |
| Parent / Teacher / Student | 403 | GO |

---

## 12. Tenant / country isolation

- **Tenant :** C4 HTTP PG (écoles A/B), fan-out PUSH scoped, Admin School limité à son établissement.
- **Pays :** Admin Pays CD ne voit pas deliveries BI (JOIN schools/countries.iso_code).

---

## 13. Web

Validé (`verify:communications-c4`, tests Web) :

- `/notifications` → `InternalNotificationsCenter` (C4) ;
- `/notifications-plateforme` → catalogue B ;
- Paramètres → Notifications (Lot I UI) ;
- Topbar / Overview KPI « Alertes à traiter » = unread C4 (`useInternalNotificationsUnreadCount`) ;
- `Notifications:READ` requis ; pas de fallback legacy `status === "Non lu"` ;
- `Notifications:READ` n’ouvre pas le graphique operations multi-module.

---

## 14. Mobile

Validé (`notificationInboxRoute.test.ts`, verify-c4) :

- contexte école + `Notifications:READ` → `InternalNotifications` ;
- Superadmin sans école → `PlatformNotifications` ;
- Superadmin + école active → C4 (pas de fuite catalogue B) ;
- sans `Notifications:READ` → pas de fallback plateforme.

---

## 15. Legacy

| Legacy | Lecture | Écriture | Runtime actif | Verdict |
|---|---|---|---|---|
| `notifications` (catalogue B) | Web/Mobile plateforme, `scopedNotifications` | Superadmin CRUD plateforme | Oui (catalogue) | Accepté — séparé C4 |
| `state.notifications` paiement | — | **Non** (J-01 GREEN) | Non pour paiement | GO |
| `unpaidService` relances | KPI legacy impayés | Oui → `state.notifications` | Oui (hors C4 finance.payment) | Dette connue |
| C3 `announcements` | Annonces établissement | Oui | Oui | GO — séparé C4 inbox |
| `platform_announcements` | Annonces plateforme | Oui | Oui | GO |

Aucun chemin de **double envoi PUSH/EMAIL** identifié sur les flux C4 câblés.

---

## 16. Security / PII

Diagnostic deliveries nettoie :

- adresses email ;
- `ExponentPushToken[...]` ;
- `Bearer ...` ;
- mentions `SMTP_PASSWORD` / credentials.

Interdits absents de la réponse : `delivery_key`, `user_id`, payload, titre/body message.

---

## 17. Résidu P2 at-most-once

**Fenêtre documentée (obligatoire) :**

```text
markDispatchStarted() → crash worker → Expo/SMTP jamais appelé
→ dispatch_started_at posé
→ reclaim stale → skipped / stale_processing_no_redelivery
→ pas de double envoi ; envoi éventuellement perdu
```

**Classification : P2 acceptable** pour les événements câblés, **à condition** que le P1 matrice événements soit résolu avant GO global. Ce résidu ne devient pas P1 au vu des constats actuels.

---

## 18. Findings

| ID | Gravité | Domaine | Preuve | Impact | Action |
|---|---|---|---|---|---|
| AUDIT-FINAL-P1-01 | P1 | Events | `AUDIT-COM-FINAL-01b`, `communicationsNotificationsSchema.js` triggers | Admin configure STUDENT_LATE, REPORT_CARD, PAYMENT_DUE, TIMETABLE, TEACHER_REPLACEMENT sans notification | PR GREEN dédiée : producteurs outbox + handlers C4 |
| AUDIT-FINAL-P2-01 | P2 | Delivery | `communicationChannelFanout.test.js`, AUDIT-COM-FINAL-08 | Envoi PUSH/EMAIL rarement perdu si crash entre markDispatchStarted et provider | Accepté at-most-once ; monitor dead_letter/skipped |
| AUDIT-FINAL-P2-02 | P2 | Legacy | `communications-legacy-green-2026-09-08.md` | Catalogue B + relances impayés legacy restent | Roadmap consolidation post-GO |
| AUDIT-FINAL-DETTE-01 | Dette | Legacy | `unpaidService.js` | Relances impayés ≠ C4 PAYMENT_RECEIVED | Lot futur ou documenter périmètre |

---

## 19. Verdict CTO recommandé

| Classe | Détail |
|---|---|
| **P0 ouverts** | 0 |
| **P1 ouverts** | 1 — matrice Lot I incomplète (**4/9 câblés, 5/9 producteurs manquants**) |
| **P2 ouverts** | 2 — at-most-once window ; legacy catalogue conservé |
| **Dettes acceptées** | relances impayés legacy ; SMTP essai opérationnel |

**Verdict : HOLD**

**COMMUNICATIONS HOLD** — la stack est production-ready **techniquement** pour les **4/9** événements Lot I câblés (+ `communication.message.created` et `auth.password.reset` hors Lot I), mais le **contrat produit Lot I (9 événements)** n’est pas encore honoré intégralement.

---

## Tests exécutés (runtime)

| Suite | Résultat |
|---|---|
| `communicationsFinal.audit.test.js` (13 tests AUDIT-COM-FINAL-01→12) | 13/13 PASS |
| `communicationsGlobalArchitecture.audit.test.js` | PASS |
| `communicationsLegacy.audit.test.js` + `.red.test.js` (GREEN F) | PASS |
| `communicationChannelFanout.test.js` | PASS |
| `communicationsDeliveryReliability.red.test.js` (Lot K GREEN) | PASS |
| `communicationsDeliveryHealth.test.js` | PASS |
| `communicationsDispatcher.test.js` + prefs + school policy | PASS |
| `communicationsC4.http.pg.test.js` | PASS |
| `npm run verify:communications-c4` | GO |

---

## Gouvernance

- PR **DRAFT** — pas Ready, pas merge autonome.
- Aucun correctif métier dans cette PR (audit + tests + rapport uniquement).
- Tout correctif P1 → PR GREEN séparée.
