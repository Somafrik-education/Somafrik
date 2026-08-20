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
SOMAFRIK_E2E_APK_PATH obligatoire
→ fichier existe
→ SHA256 enregistré
→ aapt / aapt2 / apkanalyzer obligatoire (identité package)
→ package lu = com.somafrik.app
→ adb uninstall com.somafrik.app
→ adb install de CETTE APK (pas -r)
→ adb shell pm path com.somafrik.app
→ lancement
→ assertion UI : « API : https://somafrik-api-preprod.onrender.com/api »
→ Maestro réellement exécuté
```

Le scan ASCII du ZIP sert **uniquement** à détecter `localhost`, LAN ou production. La chaîne `com.somafrik.app` dans le binaire **n’est pas** une preuve d’identité. Inspecteur absent → `BLOCKED_APK_PACKAGE_INSPECTOR_MISSING`. Package lu ≠ `com.somafrik.app` → `BLOCKED_APK_PACKAGE_MISMATCH`.

Le runner **ne décide pas** que l’API est la préprod si aucune preuve n’est lue depuis l’app. `SOMAFRIK_E2E_API_URL` vide ≠ préprod. La preuve canonique est le texte `role-status-message` au lancement.

`eas.json buildType = apk` seul n’est pas une preuve.

**Interdit :** `eas submit`, upload Google Play.

Si l’authentification EAS manque pour **construire** une APK : `BLOCKED_EAS_AUTH`. Ce n’est pas SUCCESS. Le LOT 8 peut rester CODE READY sans nouvelle build EAS si une APK Preview déjà produite est installée.

Installer (runner E2E dédié) :

```bash
adb uninstall com.somafrik.app   # ignore si le package n'était pas présent
adb install chemin/vers/somafrik-qa.apk
adb shell pm path com.somafrik.app
```

L’application testée provient nécessairement de l’APK dont le SHA256 est enregistré. Une ancienne Somafrik déjà installée ne peut plus servir de faux RUNTIME GO.

Optionnel : aucun. `SOMAFRIK_E2E_APK_PATH` est **obligatoire** pour un RUNTIME GO.

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
SOMAFRIK_E2E_APK_PATH        # obligatoire — chemin de l'APK Preview à installer
```

Optionnel :

```text
SOMAFRIK_E2E_API_URL                 # si défini, doit être la préprod canonique ; ne prouve pas l'APK
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
export SOMAFRIK_E2E_APK_PATH=/chemin/vers/somafrik-qa.apk

npm run verify:mobile-ui-e2e-runtime
```

Le runner vérifie dans l’ordre :

1. `maestro --version`
2. `adb`
3. exactement un device (ou `ANDROID_SERIAL`)
4. `SOMAFRIK_E2E_APK_PATH` : fichier, SHA256, inspecteur aapt/aapt2/apkanalyzer, package `com.somafrik.app`
5. `adb uninstall` puis `adb install` de **cette** APK, puis `pm path`
6. lancement de l’application
7. credentials via l’environnement
8. Maestro : l’écran Role Selection affiche `API : https://somafrik-api-preprod.onrender.com/api`
9. exécution réelle des parcours, exit code 0
10. artifacts (dont SHA256, sans secrets)

`SOMAFRIK_RUN_MAESTRO` n’existe plus comme skip-vert.

Parcours exécutés (lecture) : `01`–`08`, `10`. `11` seulement si credentials plateforme QA **et** les deux écoles exposent des utilisateurs avec `Établissement : <login_code>`. Sinon le scénario échoue ou reste BLOCKED — jamais un SUCCESS sur un simple `home-users-value` visible.

Le login plateforme (SUPERADMIN / Admin Pays) attend `school-selector`, jamais `home-admin-dashboard` (réservé à `school_admin`).

## Isolation tenant — scénario 11

Le scénario Maestro prouve la sélection et l’absence de fuite dans les lignes UI observées ; l’isolation exhaustive du dataset est garantie par le gate backend school-scope.

`assertNotVisible` sur une `FlatList` ne prouve pas qu’aucune ligne A hors écran n’existe. Maestro seul ne prouve pas l’absence exhaustive de toute ligne de l’établissement A. La preuve dataset reste `verify:mobile-school-scope-transport`.

## Artifacts

Dossier **non commité** : `Mobile/artifacts/maestro/`

```text
report.xml
maestro.log
screenshots/
device-info.txt
app-package.txt
runtime-summary.json   # blocked ≠ mutationCoverage
```

`runtime-summary.json` distingue :

```text
flowExecution: READ          # 07 / 08 réellement exécutés en lecture
mutationCoverage: BLOCKED_NO_QA_FIXTURE
```

Un flow BLOCKED non exécuté (09, 11 sans credentials) a `flowExecution: NOT_EXECUTED`.

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
| `BLOCKED_APK_PATH_MISSING` | `SOMAFRIK_E2E_APK_PATH` absent |
| `BLOCKED_APK_NOT_FOUND` | fichier APK introuvable |
| `BLOCKED_APK_HASH_MISSING` | SHA256 manquant |
| `BLOCKED_APK_PACKAGE_MISMATCH` | package lu par aapt/aapt2/apkanalyzer ≠ `com.somafrik.app` |
| `BLOCKED_APK_PACKAGE_INSPECTOR_MISSING` | aapt, aapt2 et apkanalyzer absents — la chaîne dans le ZIP n’est pas une identité |
| `BLOCKED_APK_INSTALL_FAILED` | `adb uninstall` + `adb install` de l’APK fournie a échoué |

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
- Runtime : `.github/workflows/mobile-e2e-runtime.yml`, `workflow_dispatch` uniquement, runner **self-hosted** :

```yaml
runs-on: [self-hosted, linux, android, somafrik-mobile-e2e]
```

Ce runner doit déjà exposer Maestro, Android SDK/`adb`, un device, et le chemin `vars.SOMAFRIK_E2E_APK_PATH`. Le job n’installe pas d’émulateur. Pas de `ubuntu-latest`. Pas de `continue-on-error`. Pas de skip déclaré SUCCESS.

Tests du runner (sans Android) :

```bash
npm run test:mobile-ui-e2e-runtime
```
