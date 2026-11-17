# A7 / P2 — Erreurs de chargement de l'assistant Mobile

Base : `develop@4560495b`. Mandat : complément CTO AUDIT-SETUP-GUIDED-10-01.

**Problème.** Dans `SchoolSetupSettingsScreen`, une erreur de `GET /v2/school-setup/guided` était avalée par `.catch(() => setGuided(null))`. L'écran revenait alors silencieusement à l'ancien parcours 3/3, et l'utilisateur ignorait que l'assistant en 10 étapes avait échoué. Pendant le chargement, ce parcours 3/3 s'affichait aussi brièvement.

**Correctif** (`Mobile/src/screens/SchoolSetupSettingsScreen.tsx` uniquement) :
- l'état de l'assistant est explicite : `loading`, `ready` ou `error` ;
- **en cas d'erreur**, l'écran affiche « Impossible de charger l'assistant de configuration (HTTP …) : message » (`testID="guided-setup-load-error"`, `accessibilityRole="alert"`), avec un bouton **Réessayer** ;
- le parcours 3/3 n'apparaît **qu'après** cette erreur. Il est alors annoncé : « En attendant, voici les 3 étapes essentielles (parcours simplifié)… » (`testID="guided-setup-fallback-notice"`) ;
- **pendant le chargement**, un indicateur remplace le parcours 3/3 ;
- les contrats existants sont respectés **sans modification des tests** : M14 et le contrat backend « un seul assistant visible » (`guided ? … : payload ? …`).

**Tests.** Cas `M-A7` ajouté à `Mobile/src/lib/schoolSetupGuidedMobile.red.test.ts` :

| | Résultat |
|---|---|
| RED sur `develop` | M-A7 en échec, 18 / 19 (`red.txt`) |
| GREEN | 19 / 19 (`green.txt`) |
| Non-régression | `verify:school-setup-guided-green` PASS (backend 58, Web 60, Mobile 19) (`suite.txt`) ; LOT 4 GREEN, L4-09 N/A (`l409.txt`) ; `tsc` Mobile 0 erreur ; `verify:mobile-security`, `mobile-cta-rbac-alignment`, `mobile-data-truth` OK ; copie française OK |

**Non vérifié.** Rendu sur un appareil réel, smoke en préproduction.
