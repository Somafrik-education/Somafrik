# PR E — Audit RED : préférences de communication utilisateur

**Date :** 8 septembre 2026  
**Branche :** `cursor/communication-preferences-red-3171`  
**Base :** `origin/develop` après merge #549 (`b62de1afff114a221b1620cad3960c4321acc7c2`)  
**Périmètre :** audit + 3 RED légitimes. Aucun GREEN. Aucune table. Aucune résolution. Aucune UI.

STOP obligatoire après ce livrable. Attendre revue CTO avant GREEN.

---

## 0. Synthèse CTO (lire en premier)

Il n’existe **aucune** préférence de canal persistée, **aucune** intersection `eventPolicy ∩ userPreferences`, et **aucune** notion de canal obligatoire.

Le runtime actuel est donc :

```text
événement
→ politique d'événement (PUSH+EMAIL figé, ou canaux explicites)
→ dispatcher mince (#549)
→ fan-out Expo (PUSH) / SMTP (EMAIL)
```

Les destinataires sont ignorés (`void recipients` dans `dispatchCommunication`).  
Un utilisateur ne peut pas désactiver EMAIL sans que cela n’existe pas encore — donc **le comportement actuel est « tout allumé »**. C’est précisément ce que les defaults GREEN devront conserver.

Trois trous seulement (prouvé par lecture + RED) :

| ID | Trou | Preuve |
|---|---|---|
| **RED-COM-05A** | Pas de persistance `user + school + channel` | aucun module, aucune table, aucune colonne `*_enabled` |
| **RED-COM-05B** | Pas de `resolveEffectiveChannels` | `resolveChannels` ne lit que `channels` / `eventType` |
| **RED-COM-05F/G** | Pas de canal mandatory | `auth.password.reset` n’est pas dans la politique dispatcher ; EMAIL est hardcodé dans le silo reset, pas déclaré mandatory vs optional |

**Non-RED (déjà GREEN — ne pas recréer) :** Expo tenant #544, fan-out #545, reset EMAIL #547, dispatcher unique #549, 04J (aucun SDK dans le dispatcher), idempotence `delivery_key` / stale `processing`.

**Contrainte d’architecture (pas une préférence) :**

```text
PUSH  → Expo + FCM     (jamais Brevo)
EMAIL → SMTP / Brevo-as-SMTP
Canal ≠ fournisseur
```

---

## 1. Architecture actuelle des préférences

**Il n’y en a pas.** Les canaux effectifs sont uniquement :

1. **Politique d’événement C4** — `EVENT_EXTERNAL_CHANNEL_POLICY` : cinq types → `["PUSH","EMAIL"]` (`communicationsDispatcher.js` L16–21).
2. **Canaux explicites** — `resolveChannels({ channels, eventType })` L68–72 : si `channels` est fourni, la politique est ignorée.
3. **Worker** — `dispatchProcessedEvents` force `["PUSH","EMAIL"]` (L128) pour tout événement drainé, **sans** destinataire, **sans** préférence.
4. **Reset #547** — `passwordResetNotification.js` L58–66 enqueue `channel: "EMAIL"` dans la même transaction Auth, puis le même drain.

```text
utilisateur
→ (aucune préférence)
→ politique métier / canaux explicites
→ dispatcher
→ canaux autorisés = politique entière
→ providers existants (Expo / SMTP)
```

IN_APP n’est pas un `channel` SQL : c’est la persistance `communication_notifications` + `notification_recipients` dans `processOneEvent`.

---

## 2. Inventaire complet

Recherche exhaustive : `email_enabled`, `push_enabled`, `notifications_enabled`, `communication_preferences`, `notification_preferences`, `preferred_provider`, `push_provider`, `opt_in` / `opt_out` métier, `resolveEffectiveChannels`, `mandatoryChannels`, `user_communication_preferences`.

**Résultat : zéro occurrence** dans le code, le schéma SQL et les migrations (hors commentaires RBAC / backfill identifiants, hors `mandatory` Finance/RBAC).

| Surface | État | Fichier |
|---|---|---|
| `users` | identité + `email` ; pas de flags canal | `backend/db/schema.sql` L57–73 |
| `users.profile_payload` | JSONB clients, **non utilisé** pour les canaux | `backend/db/clientsSchema.js` L9 |
| `school_settings` | académique (période, barème, bulletin) | `backend/db/schema.sql` L307–317 |
| `communication_event_outbox` / `communication_notifications` / `notification_recipients` / `communication_channel_deliveries` | outbox + IN_APP + deliveries ; pas de prefs | `backend/db/communicationsNotificationsSchema.js` |
| `mobile_push_devices` | tokens Expo, scoped `user_id + school_id + backend_environment` | `backend/db/mobilePushDevicesStore.js` L71–78 |
| Web `/parametres/notifications` | **ComingSoon** établissement (SMS/WhatsApp/templates) — pas user prefs | `web/src/pages/parametres/SettingsPlaceholders.tsx` L8–14 |
| Hub Paramètres | tuile Notifications `status: "soon"` | `web/src/pages/parametres/SettingsHubPage.tsx` L100–106 |
| Mobile | centre IN_APP + test push ; pas d’écran opt-in canal | `Mobile/src/screens/InternalNotificationsScreen.tsx`, `MenuScreen.tsx` |
| Platform announcements | silo distinct, hors C4 | PR F |
| `communicationService.js` | legacy, hors dispatcher | hors PR E |

**Conclusion inventaire :** l’existant **ne convient pas**. Une table (ou équivalent strictement équivalent) est nécessaire au GREEN. Ce RED **ne la crée pas**.

---

## 3. Proposition modèle canonique (GREEN futur — ne pas implémenter ici)

```text
user_communication_preferences
  user_id     UUID NOT NULL REFERENCES users(id)
  school_id   UUID NOT NULL REFERENCES schools(id)
  channel     TEXT NOT NULL CHECK (channel IN ('IN_APP','PUSH','EMAIL'))
  enabled     BOOLEAN NOT NULL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  UNIQUE (user_id, school_id, channel)
```

Pas de SMS dans PR E.  
Pas de `backend_environment` (ciblage Expo/FCM inchangé).  
Pas de token provider.  
Pas de `preferred_provider` / `push_provider`.

Absence de ligne = défaut ci-dessous (pas de changement silencieux).

---

## 4. Séparation channel / provider

Les préférences décident **uniquement** :

```text
IN_APP = true|false
PUSH   = true|false
EMAIL  = true|false
```

Ensuite l’infrastructure existante choisit le fournisseur :

| Canal | Provider actuel | Interdit |
|---|---|---|
| PUSH | Expo (`dispatchPush` → `expo_push_token`, `providerRef = expo:…`) ; FCM = ciblage device, pas une préférence | Brevo, SMTP |
| EMAIL | Nodemailer `SMTP_*` ; Brevo possible **comme SMTP** | Expo, FCM |

Preuve PUSH = Expo : `communicationChannelFanout.js` L346–375 (`expo_push_token`, `providerRef: expo:`).  
Preuve EMAIL = SMTP : L378+ `smtpConfigured` / `createSmtpTransport`.  
Preuve dispatcher sans SDK : `communicationsDispatcher.red.test.js` RED-COM-04J (GREEN).  
Aucun `brevo` dans le chemin PUSH.

---

## 5. Règles default

Recommandation CTO confirmée par l’audit :

| Canal | Défaut si aucune ligne | Justification |
|---|---|---|
| IN_APP | `true` | `processOneEvent` notifie tous les destinataires aujourd’hui |
| PUSH | `true` | `dispatchProcessedEvents` enqueue PUSH pour tous |
| EMAIL | `true` | idem EMAIL |

**Migration :** ne pas insérer de lignes `enabled=false`. Absence de préférence = comportement actuel.

---

## 6. Règles mandatory

| Événement | Canaux policy | Mandatory | Opt-out possible |
|---|---|---|---|
| `pedagogy.grade.published` (et 4 autres C4) | PUSH, EMAIL (+ IN_APP persist) | `[]` | oui, par canal |
| `auth.password.reset` | EMAIL | **EMAIL** | **non** |

Le reset #547 enqueue déjà EMAIL **parce qu’il n’y a pas de prefs**. Ce n’est **pas** une politique mandatory. Si le GREEN ajoute un opt-out EMAIL **sans** mandatory, #547 casse.

Autres événements de sécurité / compte : seul `auth.password.reset` est aujourd’hui une communication EMAIL durable. Aucun autre `auth.*` n’emprunte le fan-out C4. Le GREEN E n’a pas à inventer d’autres mandatory sans preuve.

---

## 7. Résolution `effectiveChannels`

```text
effectiveChannels =
  mandatoryChannels
  ∪
  (eventPolicyChannels ∩ userEnabledChannels)
```

Exemples :

```text
grade.published / policy=[IN_APP,PUSH,EMAIL] / mandatory=[] / user=[IN_APP,PUSH]
→ [IN_APP, PUSH]

reset / policy=[EMAIL] / mandatory=[EMAIL] / user EMAIL=false
→ [EMAIL]
```

`userEnabledChannels` est **scoped** `(user_id, school_id)`.  
IN_APP effectif gouverne `processOneEvent` (GREEN) ; aujourd’hui IN_APP n’est pas filtrable.  
PUSH=false → ne pas enqueue PUSH ; **ne pas** révoquer `mobile_push_devices`.

Le dispatcher **ne doit pas** appeler Expo/SMTP/Brevo (déjà 04J). Il calcule les canaux, puis délègue.

---

## 8. Tenant

Préférences : `user_id + school_id`.  
Un compte multi-établissements peut avoir PUSH=true à l’école A et PUSH=false à l’école B.  
Le ciblage device reste `user_id + school_id + backend_environment` (#544) — hors préférences.

Pas de `backend_environment` dans la table métier.

---

## 9. Sécurité / permissions / données perso

| Acteur | Mutation prefs | Lecture |
|---|---|---|
| Utilisateur | ses propres lignes, son `school_id` de session | oui |
| Admin établissement | **non** (pas de mutation arbitraire des prefs personnelles) | éventuellement diagnostic, hors PR E |
| Superadmin | **pas** de mutation globale individuelle | hors PR E |
| Système | mandatory ignore l’opt-out | n/a |

Données de profil : isolation tenant, pas de tokens provider dans la table, pas de log des flags au-delà d’un audit `channel/enabled`.  
Suppression compte : l’effacement actuel révoque déjà `mobile_push_devices` (`postgresRepository.js` ~L2342) — **effacement**, pas opt-out. PUSH=false ≠ erasure.

---

## 10. API cible (GREEN — ne pas implémenter)

Proposition :

```text
GET  /api/me/communication-preferences
PUT  /api/me/communication-preferences
     body: { channels: { IN_APP: bool, PUSH: bool, EMAIL: bool } }
```

Scoped session `user_id + school_id`.  
Refuser tout champ `provider` / `brevo` / `expo` / `fcm`.  
Ne pas exposer les tokens.

---

## 11. UX cible (audit seulement — ne pas implémenter)

**Web :** pas `/parametres/notifications` (ComingSoon **établissement** : SMS, WhatsApp, templates).  
Placer plutôt : **Paramètres utilisateur → Notifications / Communications**.

**Mobile :** écran paramètres du compte, pas le drawer Configuration établissement.

```text
Notifications dans l'application    [ON]
Notifications push                  [ON]
E-mails                             [ON]
```

Copy : le reset mot de passe et les e-mails de sécurité ne sont pas désactivables.

---

## 12. P0 / P1 / P2

Aucun **P0** (pas de faille tenant/double-send **actuelle** : les prefs n’existent pas, donc pas d’opt-out inefficace en production aujourd’hui).

| ID | Sévérité | Preuve | Fichier:ligne | Risque | Recommandation GREEN |
|---|---|---|---|---|---|
| RED-COM-05A | **P1** | grep vide ; `users` L57–73 sans flags canal ; schéma C4 sans table prefs | `schema.sql` L57–73 ; `communicationsNotificationsSchema.js` | impossible de stocker un opt-out tenant-safe | créer `user_communication_preferences` UNIQUE(user, school, channel) |
| RED-COM-05B | **P1** | `resolveChannels` L68–72 ; `void recipients` L94 ; `dispatchProcessedEvents` L128 toujours PUSH+EMAIL | `communicationsDispatcher.js` L68–72, L93–94, L128 | dès qu’une table existe, sans intersection l’opt-out est cosmétique | `resolveEffectiveChannels` avant enqueue |
| RED-COM-05F/G | **P1** | pas de `mandatoryChannels*` ; `EVENT_EXTERNAL_CHANNEL_POLICY` L16–21 sans `auth.password.reset` ; EMAIL hardcodé L64 `passwordResetNotification.js` | dispatcher L16–21 ; `passwordResetNotification.js` L58–66 | opt-out EMAIL casserait #547 | `mandatory=[EMAIL]` pour reset ; union avant intersection |

**P2 (documentés, pas de RED) :**

- ComingSoon `/parametres/notifications` = mauvais emplacement UX (établissement vs user).
- `users.profile_payload` pourrait être détourné : **ne pas** l’utiliser (pas UNIQUE channel, pas de CHECK IN_APP/PUSH/EMAIL).
- Observabilité : pas de métrique `channel_skipped_preference`.
- PR F (legacy notifications/annonces) et PR G (trial SMTP) hors périmètre.

**Candidats 05C–05E / 05H–05J non matérialisés en RED :**

| Candidat | Pourquoi pas de RED |
|---|---|
| 05C PUSH indépendant | même trou que 05B (une seule fonction d’intersection) |
| 05D isolation school A/B | pas de table → rien à isoler ; contrainte UNIQUE dans 05A |
| 05E défaut tout-allumé | **conservation actuelle** (pas de trou) |
| 05H pas de provider dans prefs | **conservation** : aucun champ provider |
| 05I dispatcher sans provider | déjà RED-COM-04J GREEN |
| 05J PUSH=false ≠ revoke devices | pas d’écrivain d’opt-out ; erasure ≠ préférence |

---

## 13. Tests existants (ne pas casser)

| Fichier | Rôle | Attendu sur ce Draft |
|---|---|---|
| `communicationsGlobalArchitecture.audit.test.js` | #544/#545 unique caller / tenant Expo / stale | GREEN |
| `communicationsChannelFanout.red-com-01.test.js` | persist sans provider | GREEN |
| `communicationsDispatcher.red.test.js` | 04A/04F/04J + AUDIT-COM-05 unique caller | GREEN |
| `communicationsDispatcher.test.js` | politique PUSH+EMAIL, reset drain | GREEN |
| `communicationsPasswordReset.red.test.js` + `passwordResetNotification.test.js` | #547 | GREEN |
| `communicationChannelFanout.test.js` | at-most-once Expo/SMTP | GREEN |
| `verify-communications-c4.js` | gate C1–C4 + N1 contracts | GREEN jusqu’à l’étape RED-COM-05, puis **FAIL attendu** |

---

## 14. Nouveaux RED

Fichier : `backend/lib/communicationsPreferences.red.test.js`

1. **RED-COM-05A** — persistance canonique absente.  
2. **RED-COM-05B** — `resolveEffectiveChannels` absent ; contrat `grade.published` + EMAIL opt-out → `[IN_APP, PUSH]`.  
3. **RED-COM-05F/G** — `mandatoryChannelsForEvent("auth.password.reset") = ["EMAIL"]` et opt-out total n’enlève pas EMAIL.

Wiring CI : `verify-communications-c4.js` + path filter `communications-c4.yml`. **FAIL volontaire** jusqu’au GREEN E.

---

## 15. Non-régressions futures (GREEN E)

Le GREEN devra préserver :

- #544 tenant PUSH (`user_id + school_id + backend_environment`)
- #545 fan-out durable + at-most-once
- #547 reset EMAIL (mandatory)
- #549 dispatcher unique ; **aucun** second caller `fanOutNotificationChannels`
- C1/C2/C3/C4, Mobile Push N1
- `communicationChannelFanout` / `communicationsDispatcher` / `passwordResetNotification`
- Auth sessions, Users tenant, RBAC, Platform Announcements, trial email (PR G)
- Web build, Mobile typecheck, PR Gates, Architecture Audit
- **PUSH = Expo + FCM** ; **Brevo jamais PUSH**
- PUSH=false **ne révoque pas** les devices

---

## 16. Risques résiduels

- Si le GREEN stocke les prefs dans `profile_payload`, l’UNIQUE et le tenant seront fragiles.
- Si `dispatchProcessedEvents` continue de forcer PUSH+EMAIL **après** l’ajout des prefs, 05B reste rouge en production.
- Reset reste un enqueue direct `ensureDelivery` : le GREEN must **soit** déclarer mandatory dans le dispatcher avant tout filtre prefs sur le drain, **soit** court-circuiter le filtre pour `auth.password.reset`. Les deux doivent être testés (05F/G).
- FCM n’est pas encore un sender runtime (Expo aujourd’hui). PR E ne doit pas le faire entrer par les prefs.
- PR F/G inchangés.

---

## 17–21. Gouvernance git

| | |
|---|---|
| 17. PR Draft | https://github.com/Somafrik-education/Somafrik/pull/550 |
| 18. Base SHA | `b62de1afff114a221b1620cad3960c4321acc7c2` (`develop` après #549) |
| 19–21. HEAD / ahead / diffstat | voir la description de #550 (HEAD change à chaque commit de cette branche) |

**Interdit sur cette PR :** Ready, merge, `main`, Render, production, migration, code métier GREEN.
