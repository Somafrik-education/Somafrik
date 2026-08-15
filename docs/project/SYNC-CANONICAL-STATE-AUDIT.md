# P0 SYNC-CANONICAL-STATE — Audit

> Branche : `cursor/sync-canonical-state-2c2f`  
> Base : `develop` @ `3772384eca4ac443d99d6ef4159a70949eec568d`

## Classification des domaines

### A. Domaines canoniques PostgreSQL (GET autoritaire)

Tous les `DOMAIN_KEYS` ont une API GET canonique. Après correctif, une réponse GET réussie remplace le scope concerné (y compris `[]`).

| Domaine | GET | POST | PATCH | DELETE/archive | Source PG | Refresh Web | Merge (post-fix) | Outbox | Risque fantôme | Verdict |
|---------|-----|------|-------|----------------|-----------|-------------|------------------|--------|----------------|---------|
| schools | `/backoffice/establishments` | POST | PATCH | DELETE | `schools` | `ensureDomains`/`refresh` | `replaceGlobalRows` | Non (stripped) | Faible | Canonique |
| countries | `/backoffice/countries` | POST | PATCH | — | `countries` | refresh | `replaceGlobalRows` | Non | Faible | Canonique |
| subscriptions | `/backoffice/subscriptions` | POST | PATCH | — | `subscriptions` | refresh | `replaceGlobalRows` | Non | Faible | Canonique |
| notifications | `/backoffice/notifications` | POST | PATCH | — | `notifications` | refresh | `replaceGlobalRows` | Non | Faible | Canonique |
| rolePermissions | `/backoffice/role-permissions` | — | PUT | — | `role_permissions` | refresh | replace objet | Non | Faible | Canonique |
| dashboardChartConfig | `/backoffice/dashboard-chart-config` | — | PUT | — | `dashboard_chart_config` | refresh | replace objet | Non | Faible | Canonique |
| users | `/backoffice/users` | POST | PATCH | — | `users` | refresh | `replaceScopedUserRows` | Non (stripped) | Moyen (UI leak) | Canonique |
| contacts | `/backoffice/contacts` | POST | PATCH | — | `contacts` | refresh | `replaceScopedSchoolRows` | Non | Moyen (delete gap) | Canonique |
| relations | `/backoffice/relations` | POST | — | — | `contact_relations` | refresh | `replaceScopedSchoolRows` | Non | Élevé (no DELETE) | Canonique read/create |
| messages | `/backoffice/messages` | POST | PATCH read | — | `school_messages` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| announcements | `/backoffice/announcements` | POST | PATCH | POST archive | `announcements` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| students | `/students` | POST enroll | PATCH | — | `students` | ensureDomains | `replaceScopedSchoolRows` | Non | Moyen | Canonique |
| teachers | `/teachers` | POST | PATCH | DELETE archive | `teachers` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| classes | `/classes` | POST | PATCH | PATCH inactive | `classes` | ensureDomains | `replaceScopedSchoolRows` | Possible* | Faible | Canonique |
| courses | `/courses` | POST | PATCH | DELETE | `school_courses` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| courseSchedules | `/course-schedules` | POST | PATCH | DELETE | `course_schedule_slots` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| assignments | `/assignments` | POST | PATCH | DELETE | `teacher_assignments` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| payments | `/payments` | POST | — | POST cancel | `payments` | refresh | `replaceScopedSchoolRows` | Outbox legacy | Faible | Canonique |
| paymentStatuses | `/finance/payment-statuses` | POST | PATCH | — | `payment_statuses` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| feeGrids | `/finance/fee-grids` | POST | PATCH | POST deactivate | `fee_grids` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| studentFees | `/finance/student-fees` | apply/adjust | adjust | — | `student_fee_obligations` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| notes | `/notes` | POST upsert | — | — | `grades` | refresh | `replaceScopedSchoolRows` + pending | Outbox | Faible | Canonique offline-capable |
| presences | `/presences` | POST batch | — | — | `attendance` | refresh | `replaceScopedSchoolRows` + pending | Outbox | Faible | Canonique offline-capable |
| academicConfigs | `/academic-config` | — | PUT | — | `school_academic_configs` | ensureDomains force | merge par école | Résiduel dormant | Faible | Canonique |
| exams | `/exams` | POST | PATCH | archive POSTs | `exams` | refresh | `replaceScopedSchoolRows` + pending | Outbox | Faible | Canonique offline-capable |
| bulletins | `/report-cards` | generate | publish/archive | archive | `report_cards` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |
| documents | `/school-documents` | POST | PATCH | POST archive | `school_documents` | refresh | `replaceScopedSchoolRows` | Non | Faible | Canonique |

\* `classes` non strippé dans `stripClient*` — risque outbox si `update({classes})` appelé (P1).

### B. Domaines résiduels

| Domaine | Preuve backend | Statut |
|---------|----------------|--------|
| *(aucun dans DOMAIN_KEYS)* | `PUT /api/backoffice/state` → 410 Gone (`server.js:2328`) | Supprimé |
| `academicConfigs` via `residualBackOfficeSync` | `PUT /backoffice/establishments/:school/academic-config` | Dormant — UI utilise `schoolSettingsApi` |

## Causes racines (P0)

| ID | Fichier | Lignes | Problème |
|----|---------|--------|----------|
| P0-1 | `web/src/lib/backofficeStateMerge.ts` | ancien L39, L92, L79-81, L116 | `if (!remote.length && prev.length) return prev` et réinjection `if (!map.has(id))` ressuscitaient les fantômes |
| P0-2 | `web/src/lib/syncOutbox.ts` | ancien L43-47, L296 | `failed` protégé + `reapplyOutboxToState` réinjectait les échecs |
| P0-3 | `web/src/context/DataContext.tsx` | merge sans `activeSchoolCode` / génération | Scope vide et courses race non gérés |
| P0-4 | `web/src/context/ActiveSchoolContext.tsx` | invalidation partielle | Changement d'établissement ne purgeait pas les données scopées |

## Backend hybride (P1 — hors scope correctif Web seul)

| Endpoint / helper | Fichier | Lignes | Note |
|-------------------|---------|--------|------|
| `getAuthoritativeBackOfficeState()` | `backend/server.js` | ~3030-3134 | Overlay projection pour réponses mutation |
| `overlayClientsProjection` | `backend/server.js` | ~3081-3090 | Clients |
| `overlayPedagogyProjection` | `backend/server.js` | ~3110-3119 | Pédagogie |
| `overlayFinanceProjection` | `backend/server.js` | ~3122-3133 | Finance |
| `overlayResidualProjection` | `backend/server.js` | ~3060-3078 | academicConfigs résiduel |
| `mergeBackOfficeRuntimeState` | `backend/server.js` | ~3187+ | Fallback mémoire |

## Mobile (PR2 recommandée)

| Pattern | Fichier | Écart |
|---------|---------|-------|
| Optimistic notes/presences | `Mobile/src/context/AdminDataContext.tsx` | Convergence locale avant ACK |
| `platformNotificationSync` | `Mobile/src/lib/platformNotificationSync.ts` | Optimistic + rollback |
| Pas de `backoffice/state` | `Mobile/src/services/api.ts` | Aligné |

Corrections corruption/doublon critiques : documentées pour PR2 Mobile.

## IDs client temporaires détectés (P1)

| Fichier | Pattern |
|---------|---------|
| `web/src/pages/UsersPage.tsx` | `usr-${Date.now()}` |
| `web/src/lib/userAccounts.ts` | `crypto.randomUUID()` / `usr-*` |
| `web/src/pages/NotificationsPage.tsx` | `ntf-${Date.now()}` |
| `web/src/lib/evaluations.ts` | `EVAL-${Date.now()}`, `NOTE-${Date.now()}` |
| `web/src/lib/pedagogySync.ts` | `${prefix}-${Date.now()}` |
| `web/src/lib/contacts.ts`, `entityCrudCore.ts` | `${prefix}-${Date.now()}` |

Les pages utilisant les APIs canoniques POST doivent adopter l'UUID serveur retourné (Cas 6).
