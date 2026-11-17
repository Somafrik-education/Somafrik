# A6 / P1 — Écran Mobile natif « Règles de notification »

Base : `develop@4560495b`. Mandat : complément CTO AUDIT-SETUP-GUIDED-10-01.

**Problème.** L'étape 9 « Communication » exige au moins une règle de notification enregistrée. Le Mobile n'avait aucun écran pour en enregistrer une : le lien de l'étape menait à la boîte de réception (`InternalNotifications`). L'étape ne pouvait donc pas être satisfaite depuis le Mobile.

**Correctif.** Nouvel écran natif `SchoolNotificationSettings`, en parité avec `SettingsNotificationsPage` du Web :
- **même endpoint :** `GET` et `PATCH /api/backoffice/establishments/:code/notification-settings`. Les droits et la validation restent ceux du Backend (`rbacService` : lecture `Paramètres Établissement:READ`, écriture `Paramètres Établissement:UPDATE`) ;
- **lecture :** réservée aux opérateurs Paramètres établissement (`SCHOOL_SETTINGS_VIEWS` et `canReadView`, comme `SchoolYearSettings`). Refusée aux parents, à l'Admin Pays et aux rôles non opérateurs. **Non ajoutée** à la liste blanche Super Admin, donc aucun accès global aux données scolaires ;
- **écriture :** les interrupteurs et le bouton sont désactivés sans `UPDATE` ;
- **mêmes règles d'affichage que le Web :** destinataires autorisés uniquement, canal absent = activé ;
- **« Règles par défaut non enregistrées » et « Enregistrer ces règles » :** même patch que le Web (`patchFromDisplayedRules`) ;
- **refus du Backend :** l'interrupteur est rétabli et l'erreur affichée (`testID="school-notification-settings-error"`). Aucune erreur n'est avalée ;
- **rechargement :** à chaque focus (`useFocusEffect`) ;
- **accès :** depuis l'étape 9 de l'assistant (`SchoolNotificationSettings`). **Pas de carte** dans la configuration Mobile : PARITY-019 impose exactement six cartes opérationnelles.

**Tests.** `Mobile/src/lib/schoolNotificationSettingsMobile.a6.test.ts`, intégré au script `test:school-settings-access` :

| | Résultat |
|---|---|
| RED sur `develop` | 7 / 7 en échec (`red.txt`) |
| GREEN | 7 / 7 (`green.txt`) |
| Non-régression | `test:school-settings-access` OK ; assistant guidé Mobile 18 / 18 ; `tsc` Mobile 0 erreur ; `verify:mobile-security`, `mobile-cta-rbac-alignment`, `mobile-live-permissions-refresh`, `mobile-data-truth` OK ; copie française OK ; audit fonctionnel Paramètres OK ; L4-09 N/A (`l409.txt`) |

**Non vérifié.** Rendu sur un appareil réel (aucun appareil ni émulateur dans ce conteneur). Smoke en préproduction.

## Correctif CTO : PARITY-019 (HEAD `0867e9f7`)

**Problème.** La CI échouait sur `PARITY-019` (`pariteLot1PlatformSettingsBoundary.test.ts`, job LOT 1 parity) : une septième carte « Notifications » avait été ajoutée à `ConfigurationScreen`.

**Correctif.** `ConfigurationScreen.tsx` est rétabli à l'identique de `develop` (diff vide). L'écran natif et son accès depuis l'étape 9 sont conservés. Aucun test existant n'a été modifié.

**Test.** `A6-07` exige désormais trois choses :
- l'écran est enregistré, avec la garde de lecture ;
- l'étape 9 mène à l'écran ;
- les cartes de configuration sont exactement **6**, sans `SchoolNotificationSettings`.

| | Résultat |
|---|---|
| RED sur `0867e9f7` | A6-07 en échec ; PARITY-019 en échec (`red-parity019.txt`) |
| GREEN | A6 7 / 7 ; PARITY-019 OK ; `test:lot1-parity` OK (`green-parity019.txt`) |
| Non-régression | LOT 0 et LOT 2 à 8 parity OK ; `tsc` Mobile 0 erreur ; `test:school-settings-access` OK |
