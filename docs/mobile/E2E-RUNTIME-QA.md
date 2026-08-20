# LOT 8 — E2E runtime Android (Maestro / APK Preview / préprod)

Ce document décrit la **preuve black-box** : une APK réellement installée, un appareil Android réel, Maestro qui pilote `com.somafrik.app`, l’API préprod canonique, PostgreSQL.

Ce n’est **pas** le gate scaffold.

## Scaffold vs runtime

| Gate | Commande | Preuve | CI standard |
| ---- | -------- | ------ | ----------- |
| Scaffold | `npm run verify:mobile-ui-e2e-scaffold` | YAML présents + contrat anti-faux-E2E | oui |
| Runtime | `npm run verify:mobile-ui-e2e-runtime` | Maestro exécuté, exit 0, artifacts | **non** (fail-closed dédié) |

`verify:mobile-ui-e2e` reste un **alias du scaffold**. Il ne devient jamais vert parce que Maestro a été sauté.

Un runner Ubuntu sans APK / device / Maestro doit afficher **FAIL / BLOCKED**, jamais **SUCCESS**.

Deux verdicts distincts :

```text
CODE READY          = typecheck + gates statiques + tests du runner
RUNTIME GO          = APK + device + Maestro + login préprod + parcours + artifacts
```

Ne jamais mélanger les deux.

## Prérequis Maestro

```bash
maestro --version
```

Installation : [Maestro CLI](https://docs.maestro.dev). Absent → `BLOCKED_MAESTRO_MISSING`.

## Prérequis adb

```bash
adb --version
adb devices
```

Un seul appareil à l’état `device` (pas `offline` / `unauthorized`). Plusieurs appareils : définir `ANDROID_SERIAL`.

Absent → `BLOCKED_ADB_MISSING`. Aucun device → `BLOCKED_NO_DEVICE`. Plusieurs sans sélection → `BLOCKED_MULTIPLE_DEVICES_NO_SELECTION`.

## Installation APK Preview

Profil attendu (voir `docs/mobile/PREVIEW-APK.md`) :

```text
preview
package = com.somafrik.app
display = Somafrik QA
API = https://somafrik-api-preprod.onrender.com
```

Preuve valide :

```text
APK existante
+ install réussie
+ package détecté par adb
+ Maestro réellement exécuté
```

`eas.json buildType = apk` seul n’est pas une preuve.

**Interdit :** `eas submit`, upload Google Play.

Si l’authentification EAS manque pour **construire** une APK : `BLOCKED_EAS_AUTH`. Ce n’est pas SUCCESS. Le LOT 8 peut rester CODE READY sans nouvelle build EAS si une APK Preview déjà produite est installée.

Installer :

```bash
adb install -r chemin/vers/somafrik-qa.apk
adb shell pm path com.somafrik.app
```

Désinstaller d’abord une app production / autre signature du même package.

Optionnel : `SOMAFRIK_E2E_APK_PATH=/chemin/app.apk` pour scanner l’APK (localhost / LAN / production interdits).

## Choix device

```bash
export ANDROID_SERIAL=emulator-5554   # ou le serial USB
adb -s "$ANDROID_SERIAL" devices
```

Le runner refuse plus d’un device exploitable sans `ANDROID_SERIAL`.

## Variables QA (runtime uniquement)

Aucune valeur secrète dans Git, YAML, TypeScript, JS, `.env.example` ou GitHub Actions.

```text
SOMAFRIK_E2E_SCHOOL_CODE     # login_code V2, attendu CD-IN-26-001 en préprod Nuru
SOMAFRIK_E2E_IDENTIFIER
SOMAFRIK_E2E_PASSWORD
```

Optionnel :

```text
SOMAFRIK_E2E_API_URL                 # doit être exactement l’URL préprod canonique
SOMAFRIK_E2E_APK_PATH
ANDROID_SERIAL
SOMAFRIK_E2E_PLATFORM_IDENTIFIER     # superadmin / admin pays
SOMAFRIK_E2E_PLATFORM_PASSWORD
SOMAFRIK_E2E_SCHOOL_CODE_B           # deuxième établissement pour le switch tenant
```

Maestro reçoit les valeurs via `-e KEY=value`. Le runner masque identifier / password / PIN dans les logs et artifacts (`[REDACTED]`).

Interdit : `SCH-*`, `CD-2026-0001`, PIN hardcodé, `localhost`, `10.0.2.2`, LAN, `https://api.somafrik.app`.

## Exécution

```bash
export SOMAFRIK_E2E_SCHOOL_CODE=CD-IN-26-001
export SOMAFRIK_E2E_IDENTIFIER='…'   # secret runtime, jamais commité
export SOMAFRIK_E2E_PASSWORD='…'

npm run verify:mobile-ui-e2e-runtime
```

Le runner vérifie dans l’ordre :

1. `maestro --version`
2. `adb`
3. exactement un device (ou `ANDROID_SERIAL`)
4. `com.somafrik.app` installé
5. lancement de l’application
6. API = `https://somafrik-api-preprod.onrender.com`
7. pas de localhost / LAN / production
8. credentials via l’environnement
9. exécution réelle de Maestro
10. exit code 0
11. artifacts

`SOMAFRIK_RUN_MAESTRO` n’existe plus comme skip-vert.

Parcours exécutés (lecture) : `01`–`08`, `10`. `11` seulement si credentials plateforme QA.

## Artifacts

Dossier **non commité** : `Mobile/artifacts/maestro/`

```text
report.xml
maestro.log
screenshots/
device-info.txt
app-package.txt
runtime-summary.json
```

Aucun token / password / PIN en clair.

## Codes BLOCKED

| Code | Signification |
| ---- | ------------- |
| `BLOCKED_MAESTRO_MISSING` | CLI Maestro absent |
| `BLOCKED_ADB_MISSING` | adb absent |
| `BLOCKED_NO_DEVICE` | aucun appareil `device` |
| `BLOCKED_MULTIPLE_DEVICES_NO_SELECTION` | plusieurs appareils, pas de `ANDROID_SERIAL` |
| `BLOCKED_PACKAGE_NOT_INSTALLED` | `com.somafrik.app` absent |
| `BLOCKED_APP_LAUNCH_FAILED` | lancement adb échoué |
| `BLOCKED_API_LOCALHOST` | localhost / LAN / HTTP |
| `BLOCKED_API_PRODUCTION` | API production |
| `BLOCKED_API_NOT_PREPROD` | URL ≠ préprod canonique |
| `BLOCKED_CREDENTIALS_MISSING` | school code / identifier / password absents |
| `BLOCKED_SCHOOL_CODE_SCH_ALIAS` | `SCH-*` |
| `BLOCKED_SCHOOL_CODE_LEGACY` | `CD-2026-0001` ou pattern legacy |
| `BLOCKED_MAESTRO_NOT_EXECUTED` | préflight OK mais Maestro non lancé ≠ SUCCESS |
| `BLOCKED_MAESTRO_FAILED` | Maestro exit ≠ 0 |
| `BLOCKED_NO_FAILURE_INJECTION` | scénario 09 — pas de proxy/mock réseau |
| `BLOCKED_NO_PLATFORM_QA_CREDENTIALS` | scénario 11 — pas de compte plateforme QA |
| `MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE` | 07 lecture seule |
| `MUTATION_NOTES_BLOCKED_NO_QA_FIXTURE` | 08 lecture seule |
| `BLOCKED_EAS_AUTH` | pas d’auth EAS pour construire une APK |
| `BLOCKED_APK_FORBIDDEN_HOST` | APK scanée : localhost / LAN / prod |

## Règles sécurité

- Secrets uniquement via l’environnement / secrets runtime.
- Pas de credential dans les YAML, le code, `.env.example` (valeurs), la CI, les logs.
- Header tenant `X-Somafrik-School-Code` = `login_code` V2 — preuve backend déjà couverte par `verify:mobile-school-scope-transport`. Ne pas contourner l’autorisation serveur.

## Règle données INSTITUT NURU

- École préprod attendue : `CD-IN-26-001`.
- **Lecture** réelle autorisée (Home, utilisateurs, classes, enseignants, paiements, présences, notes).
- **Aucune mutation destructive.** Pas d’encaissement de test, pas de présence / note Nuru modifiée « pour faire passer Maestro ».
- Présences / notes : lecture obligatoire ; mutation seulement avec fixture QA isolée et réversible. Sinon BLOCKED mutation.
- Zéro (`0`) peut être une valeur métier. Interdit : `assertNotVisible: "0"`.
- Interdit : `catalog.ts`, snapshot legacy, BackOffice legacy, données fictives comme preuve.

## CI

- Job GitHub standard : **scaffold + tests unitaires du runner** uniquement. Pas d’émulateur Android lourd.
- Runtime : workflow `mobile-e2e-runtime.yml`, `workflow_dispatch` uniquement, **fail-closed**. Un Ubuntu sans device échoue. Pas de `continue-on-error`. Pas de skip déclaré SUCCESS.

Tests du runner (sans Android) :

```bash
npm run test:mobile-ui-e2e-runtime
```
