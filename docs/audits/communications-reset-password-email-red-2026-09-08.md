# Audit PR C — Reset mot de passe + email transactionnel (TESTS FIRST)

**Date :** 8 septembre 2026  
**Branche de référence :** `develop@112e365b39eec3ff1a1abc6df4f8ef4ac1226190`  
**PR :** Draft audit/RED uniquement. Pas GREEN. Pas Ready. Pas merge. Pas `main` / Render / production.

`DATABASE_URL` de test **absent** dans cet environnement d’audit. Les parcours HTTP PostgreSQL n’ont pas été relancés ici. Preuves unitaires + lecture source. Ne pas contourner avec une base production/preprod.

---

## 1. Architecture actuelle exacte du reset

Le reset est un **parcours administrateur authentifié**, pas un self-service « mot de passe oublié ».

1. L’admin (Web `UsersPage` / Mobile `AdminCrudScreen`) saisit ou génère un mot de passe provisoire.
2. `POST /api/users/:id/reset-password` avec JWT Bearer.
3. Contrôle permission (`canResetUserPassword`) + scope établissement (`usersHttpPrincipal` / `assertUsersTargetAccess`).
4. Validation `validateAccountSecret` (politique mot de passe **si non vide**).
5. **Une transaction PostgreSQL** :
   - `UPDATE users` : `password_hash` / `pin_hash` scrypt, `must_change_password = TRUE` ;
   - `UPDATE sessions` : `revoked_at`, `revoke_reason = 'password_reset'` ;
   - `DELETE login_lockouts` pour les alias du compte.
6. Audit `reset_user_password` **sans** le secret.
7. Réponse HTTP **200** avec `temporaryPassword` en clair au **top-level** + `user` sanitizé (`hasTemporaryPassword: true`).
8. **Aucun email. Aucun outbox. Aucun `setImmediate`.**

Le mot de passe provisoire est donc un secret **choisi par l’admin**, hashé en base, renvoyé à l’admin pour communication orale/toast. Ce n’est pas un token à usage unique.

---

## 2. Diagramme du flux actuel

```text
Admin (Web/Mobile)
  → POST /api/users/:id/reset-password  { temporaryPassword }
  → requireAuth (JWT access + session non révoquée)
  → canResetUserPassword (Utilisateurs:UPDATE | Gérer utilisateurs | ALL/COUNTRY)
  → usersHttpPrincipal + listClientsUsers(scope) + assertUsersTargetAccess
  → [409 si compte pending et non Superadmin]
  → validateAccountSecret (vide = OK aujourd’hui)
        │
        ▼
  BEGIN
    UPDATE users SET password_hash, pin_hash, must_change_password=TRUE
    UPDATE sessions SET revoked_at, revoke_reason='password_reset'
    DELETE login_lockouts …
  COMMIT
        │
        ▼
  audit reset_user_password (sans secret)
  res.json({ temporaryPassword, user: sanitize… })
        │
        ✕  aucune commande EMAIL
        ✕  communication_event_outbox non utilisée
        ✕  communication_channel_deliveries non écrite
```

Cible envisagée (non implémentée) :

```text
BEGIN
  hash + must_change_password
  révocation sessions
  INSERT communication_channel_deliveries EMAIL (delivery_key unique)
COMMIT
  → worker drain existant (Nodemailer SMTP_* / MAIL_FROM)
  → échec SMTP = failed retryable, jamais rollback du reset
```

---

## 3. Fichiers / routes / tables / services

| Rôle | Chemin |
|---|---|
| Route HTTP | `backend/server.js` `POST /api/users/:id/reset-password` |
| Permission route (catalogue) | `backend/services/rbacService.js` |
| Permission handler | `canResetUserPassword` dans `backend/server.js` |
| Scope tenant | `backend/lib/usersSchoolScope.js` |
| Hash | `backend/services/credentialService.js` `hashSecret` (scrypt) |
| Persist PG | `backend/db/postgresRepository.js` `resetUserPassword` |
| Persist mémoire | `backend/db/fallbackRepository.js` `resetUserPassword` |
| Sessions | `revokeAllSessionsForUser` / table `sessions` |
| Audit | `backend/services/auditService.js` |
| Sanitization user | `backend/lib/sanitizeUserForResponse.js` |
| Web | `web/src/lib/userAccounts.ts` `resetUserAccountPassword` ; `web/src/pages/UsersPage.tsx` |
| Mobile | `Mobile/src/services/api.ts` ; `Mobile/src/screens/AdminCrudScreen.tsx` |
| Changement obligatoire | `POST /api/auth/change-password` ; `must_change_password` |
| Tables | `users`, `sessions`, `login_lockouts` |
| Email existant (hors reset) | `communicationChannelFanout.js`, `trialAccessRequestNotification.js` |

---

## 4. Matrice Auth / RBAC / tenant

| Contrôle | Comportement actuel |
|---|---|
| Auth | `requireAuth` uniquement (pas `requirePermission` sur la route). JWT query interdit. |
| Permission | `ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES`, `Utilisateurs:UPDATE`, `Gérer utilisateurs`. |
| Enseignant | **refus** (`productionRbacParity.test.js`, `systemRolesReconciliation.test.js`). |
| Superadmin | OK ; seul à reset un compte **pending validation**. |
| Tenant | `listClientsUsers(scope)` + `filterUsersRows` + `assertUsersTargetAccess`. Cible hors établissement → **404** « introuvable dans votre établissement » (pas 403 systématique). |
| Admin école B vs user école A | HTTP PG `usersTenant.http.pg.test.js` attend 403 **ou** 404. |
| Body | `{ temporaryPassword }` ; pas d’`Idempotency-Key`. |
| 400 | politique mot de passe / PIN si secret **non vide**. |
| 401 | JWT absent/invalide ; session révoquée. |
| 403 | permission insuffisante. |
| 409 | pending + non Superadmin. |

La route RBAC catalogue existe (`POST /api/users/:id/reset-password`) mais le handler **duplique** le check via `canResetUserPassword` au lieu d’appeler `requirePermission`. Les deux listes de jetons sont alignées aujourd’hui.

---

## 5. Gestion actuelle des sessions

- Login / refresh posent `sessionId` dans l’access JWT (`tokenService.createAccessToken`).
- `requireAuth` appelle `findActiveAccessSession(sessionId)` : `revoked_at IS NULL AND expires_at > NOW()`.
- Reset : `revokeAllSessionsForUser(id, "password_reset")` **dans la même transaction** que le hash.
- Access token encore présenté → **401 Session révoquée** (preuve HTTP dans `backend/scripts/verify-admin-user-creation.js` : token Admin School émis avant reset est fail-closed).
- Refresh token lié à `sessions.session_code` : session révoquée ⇒ refresh inutilisable.
- TTL access ≤ 15 min (`authTokenPolicy.test.js`).
- Pas de `token_version` / `session_version` séparée : la révocation ligne `sessions` suffit si `sessionId` est présent. Un JWT **sans** `sessionId` contournerait le check (`if (sessionId && …)`). Les tokens émis par login/refresh portent `sessionId`.

Unitaire : `backend/lib/passwordResetSessions.test.js` (mémoire) **PASS**.

---

## 6. Inventaire d’exposition du secret

| Lieu | Clair ? | Gravité | Preuve |
|---|---|---|---|
| Réponse HTTP reset | **Oui** `temporaryPassword` top-level | **P2** (contrat admin actuel, pas un log) | `backend/server.js` `res.json({ temporaryPassword, … })` |
| Objet `user` de la même réponse | Non (sanitize) | OK | `sanitizeUserForResponse` retire `temporaryPassword` |
| Audit `reset_user_password` | Non | OK | `{ user, oldPasswordInvalidated, sessionsRevoked, loginLockoutCleared }` |
| `console.*` handler | Non | OK | pas de log du secret |
| PostgreSQL | Hash scrypt uniquement | OK | `postgresRepository.resetUserPassword` |
| Fallback mémoire | **Oui** `password`, `pin`, `temporaryPassword` sur l’objet user | **P2** (moteur démo, pas PG) | `fallbackRepository.js` |
| Web toast | **Oui** | **P2** UX admin | `UsersPage.tsx` `Mot de passe réinitialisé · provisoire : ${issued}` |
| Mobile `Alert.alert` | **Oui** | **P2** | `AdminCrudScreen.tsx` |
| Tests / fixtures | Oui (valeurs de test) | OK | `verify-admin-user-creation.js` |
| Email | N/A (pas d’envoi) | — | — |

**Pas de P0** (pas de secret en log/audit/PG clair).  
**P1** ci-dessous : API accepte un provisoire **vide** ; **aucune durabilité d’email**.

`hashSecret('')` retourne `null` (`if (!secret) return null`) : un reset vide peut écrire `password_hash = NULL`.

---

## 7. Architecture email existante réutilisable (après #545)

| Silo | Rôle | Réutiliser pour reset ? |
|---|---|---|
| `communicationChannelFanout.js` | Nodemailer générique `SMTP_*` + `MAIL_FROM` ; table `communication_channel_deliveries` ; drain worker ; at-most-once stale processing | **Oui** (adaptateur EMAIL + `ensureDelivery`) |
| Worker C4 | `drainOutbox` puis `fanOutNotificationChannels` | Drain EMAIL oui ; **pas** `processOneEvent` |
| `communication_event_outbox` + `processOneEvent` | Persist **IN_APP** notifications métier (messages, annonces, absences, notes, paiements) | **Non** — un reset ne doit pas créer une notification interne |
| `trialAccessRequestNotification.js` | SMTP essai public, `setImmediate` optionnel, destinataire interne | **Non** — autre métier, autre destinataire, pas d’outbox |
| SDK Brevo | **Absent** du repo | Interdit d’en ajouter |

`notification_id` de `communication_channel_deliveries` est **nullable** (pas de `NOT NULL`). Une ligne EMAIL auth peut exister sans notification C4.

Aucun secret SMTP en dur. Brevo = fournisseur d’environnement uniquement.

---

## 8. Comparatif des stratégies d’intégration email

| Option | SMTP fail rollback reset ? | Perte crash post-COMMIT ? | Double envoi retry ? | Couplage Auth↔C4 IN_APP | Verdict |
|---|---|---|---|---|---|
| **A. mailer après commit** | Non | **Oui** (rien de durable) | Oui si retry HTTP | Non | Insuffisant vs mandat 03D |
| **B. `setImmediate`** (modèle essai) | Non | **Oui** | Oui | Non | Rejet : silo + perte silencieuse |
| **C. `communication_channel_deliveries` dans la txn reset** | Non | **Non** (ligne `pending`) | Unique `delivery_key` | Non si INSERT direct, pas `enqueueChannelDeliveries` C4 | **Recommandé** |
| **D. `communication_event_outbox`** | Non | Non | Unique `event_key` | **Oui** (`processOneEvent` → IN_APP) | Rejet |
| **E. nouvelle table `transactional_emails`** | Non | Non | Possible | Non | Possible mais **nouveau silo** sans besoin |

---

## 9. Recommandation CTO

**Une solution : option C.**

Dans la **même** `withTransaction` que hash + révocation :

1. `INSERT … communication_channel_deliveries` canal `EMAIL`, `delivery_key` unique  
   `auth.password.reset:{userId}:{resetId}` (`resetId` = uuid de la commande, pas le mot de passe).
2. Payload : nom, établissement, consigne de connexion, `must_change_password` — **sans** mot de passe en clair.
3. `ON CONFLICT (delivery_key) DO NOTHING`.
4. Après COMMIT, le worker existant `drainChannelDeliveries` envoie via Nodemailer / `SMTP_*`.
5. Pas de `processOneEvent`. Pas de SDK Brevo. Pas de `setImmediate`.
6. Pas d’email → `skipped` (`no_recipient_email`), reset déjà commité.
7. Échec SMTP → `failed` + retry borné (déjà dans le fan-out). Reset intact.
8. Crash après claim fournisseur / avant `markSent` : at-most-once déjà figé par #545 (`stale_processing_no_redelivery`).

**Contenu email recommandé (GREEN futur) :**

- Objet : `Votre mot de passe Somafrik a été réinitialisé`
- Corps : identité si connue, établissement, « un administrateur a réinitialisé votre accès », se connecter avec le mot de passe provisoire **communiqué par l’administrateur**, changer le mot de passe à la première connexion.
- **Ne pas** mettre le provisoire en clair dans l’email (canal SMTP, logs MTA, forwarding). L’admin le voit déjà en HTTP/toast (contrat produit actuel).

**Lien / token à usage unique :** meilleur modèle sécurité à terme (expiration, one-shot, pas de secret durable choisi par l’humain). Impact migration : Web + Mobile login, UX « mot de passe oublié », stockage token, invalidation. **Hors PR C GREEN immédiat** — rester sur provisoire admin + email d’information, sauf GO produit contraire.

**Ne pas** envoyer PUSH pour un reset.

---

## 10. P0 / P1 / P2 (preuves)

| ID | Gravité | Constat | Preuve |
|---|---|---|---|
| P1-NO-MAIL | P1 | Aucun email après reset | `backend/server.js` handler reset : `withTransaction` puis `res.json`, zéro mailer |
| P1-NO-OUTBOX | P1 | Crash post-COMMIT = intention d’envoi jamais enregistrée | même handler ; pas d’INSERT `communication_channel_deliveries` |
| P1-EMPTY-SECRET | P1 | Provisoire vide accepté ; `hashSecret('')` → `null` | `userAccountRules.js` `validateAccountSecret` : `if (!value) return null` ; `credentialService.js` `if (!secret) return null` |
| P2-HTTP-SECRET | P2 | Clair dans `res.json.temporaryPassword` | `backend/server.js` `res.json({ temporaryPassword, … })` — contrat admin, à conserver tant que l’email n’est pas un token |
| P2-UI-SECRET | P2 | Toast Web / Alert Mobile | `UsersPage.tsx` ; `AdminCrudScreen.tsx` |
| P2-MEMORY-SECRET | P2 | Fallback mémoire stocke password/pin/temporaryPassword | `fallbackRepository.js` `resetUserPassword` |
| P2-NO-IDEMPOTENCY | P2 | Pas d’`Idempotency-Key` sur la route | handler reset vs paiements `withIdempotency` |
| — | — | Pas de P0 fuite logs/PG | audit + sanitize + hash PG |

Codex P1 « enqueue avant `processed` C4 » concerne le fan-out **métier C4 déjà mergé (#545)**, pas le reset. Hors correctif de cette PR.

---

## 11. Tests existants exécutés

| Suite | Résultat | Note |
|---|---|---|
| `backend/lib/passwordResetSessions.test.js` | **PASS** | révocation sessions (mémoire) |
| `backend/lib/usersTenant.guard.test.js` | **PASS** | GP-003 reset scoped |
| `backend/lib/productionRbacParity.test.js` | **PASS** | enseignant ↛ reset |
| `backend/lib/systemRolesReconciliation.test.js` | **PASS** | enseignant ↛ reset |
| `backend/lib/communicationChannelFanout.test.js` | **PASS** 12/12 | SMTP fail ≠ rollback in-app ; at-most-once |
| `backend/lib/communicationsChannelFanout.red-com-01.test.js` | **PASS** | C4 persist sans fournisseur |
| `backend/lib/authTokenPolicy.test.js` | **PASS** | TTL access |
| `backend/lib/communicationsGlobalArchitecture.audit.test.js` | 3/4 PASS ; **AUDIT-COM-03 regex trop large** (matche `SET status='processing', claimed_at` légitime) | Hors périmètre PR C ; ne pas « corriger » ici |
| `usersTenant.http.pg.test.js` | **non exécuté** | `DATABASE_URL` absent |
| `verify-admin-user-creation.js` | **non exécuté** | besoin backend + comptes ; preuve source : reset 200, login temp, token pré-reset fail-closed |

---

## 12. Nouveaux RED + justification

Fichier : `backend/lib/communicationsPasswordReset.red.test.js`

| Test | Attendu aujourd’hui | Pourquoi |
|---|---|---|
| GREEN-COM-03B | PASS | SMTP n’est pas dans la txn (contrainte à garder) |
| GREEN-COM-03C | PASS | `revokeAllSessionsForUser` déjà dans la txn |
| GREEN-COM-03E | PASS | scope déjà correct (ne pas dupliquer un RED) |
| GREEN-COM-03F | PASS | audit sans secret |
| GREEN-COM-03-c4 | PASS | pas de C4 IN_APP / pas de Brevo |
| **RED-COM-03A** | **FAIL** | aucune programmation EMAIL après persist |
| **RED-COM-03D** | **FAIL** | aucune ligne durable dans la txn |
| **RED-COM-03G** | **FAIL** | pas de `delivery_key` / idempotence reset |
| **RED-COM-03H** | **FAIL** | provisoire vide non rejeté |

Non fabriqués : 03C sessions, 03E tenant, 03F logs — déjà GREEN.

Ce fichier **n’est branché sur aucun workflow** (même pattern que l’ancien RED #543). Le GREEN devra le faire passer **et** l’ajouter à un gate (C4 ou auth).

---

## 13. Non-régression obligatoire avant merge GREEN

1. `node --test backend/lib/communicationsPasswordReset.red.test.js` → tout PASS  
2. `node --test backend/lib/passwordResetSessions.test.js`  
3. `node --test backend/lib/usersTenant.guard.test.js`  
4. `node --test backend/lib/productionRbacParity.test.js`  
5. `node --test backend/lib/communicationChannelFanout.test.js`  
6. `node --test backend/lib/communicationsChannelFanout.red-com-01.test.js`  
7. `node --test backend/lib/communicationsGlobalArchitecture.audit.test.js` (fixer le regex AUDIT-COM-03 **dans la PR GREEN si on y touche**, sinon ne pas casser A/B)  
8. `npm run verify:auth-sessions`  
9. `npm run verify:sanitize-user-responses`  
10. `npm run verify:jwt-header`  
11. HTTP PG si `DATABASE_URL` test : `usersTenant.http.pg.test.js` (reset cross-school)  
12. `backend/scripts/verify-admin-user-creation.js` (reset → login `mustChangePassword` → change-password ; ancien token révoqué)  
13. `backend/scripts/verify-communications-c4.js` si le GREEN réutilise le fan-out  
14. Login / logout / création utilisateur / GRANT rôles : suites admin-user-creation + RBAC existantes  
15. Demande d’essai : `trialAccessRequestNotification.red.test.js` (ne pas fusionner les silos)

---

## 14–18. Gouvernance git

Renseignés dans la PR Draft (SHA HEAD, ahead/behind, diffstat).

**STOP.** Attendre GO CTO avant GREEN.
