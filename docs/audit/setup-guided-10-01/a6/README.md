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
- **accès :** carte « Notifications » dans Paramètres, et lien de l'étape 9 vers `SchoolNotificationSettings`.

**Tests.** `Mobile/src/lib/schoolNotificationSettingsMobile.a6.test.ts`, intégré au script `test:school-settings-access` :

| | Résultat |
|---|---|
| RED sur `develop` | 7 / 7 en échec (`red.txt`) |
| GREEN | 7 / 7 (`green.txt`) |
| Non-régression | `test:school-settings-access` OK ; assistant guidé Mobile 18 / 18 ; `tsc` Mobile 0 erreur ; `verify:mobile-security`, `mobile-cta-rbac-alignment`, `mobile-live-permissions-refresh`, `mobile-data-truth` OK ; copie française OK ; audit fonctionnel Paramètres OK ; L4-09 N/A (`l409.txt`) |

**Non vérifié.** Rendu sur un appareil réel (aucun appareil ni émulateur dans ce conteneur). Smoke en préproduction.
