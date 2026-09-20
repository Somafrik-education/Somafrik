# Échecs et blocages — audit E2E métier

**SHA :** `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8`  
**Règle :** chaque FAIL reste FAIL. Aucune correction.  
**Hypothèses de cause racine :** marquées *Hypothèse uniquement — aucune correction effectuée.*

Aucun FAIL d’exécution n’est encore enregistré.

## Gabarit obligatoire (à dupliquer par échec)

### FAIL-ID : _(à renseigner)_

| Champ | Valeur |
| ----- | ------ |
| ID du test | |
| Domaine | |
| Scénario | |
| Commande | |
| Fichier source | |
| Surface | |
| Résultat attendu | |
| Résultat observé | |
| Message d’erreur | |
| Stack trace pertinente | |
| Requête / API | |
| HTTP status | |
| Environnement | ENV-LOCAL / ENV-CI / ENV-PREPROD / ENV-PROD |
| SHA | `e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8` |
| Reproductibilité | |
| Capture / trace | |
| Logs | `results/…` |
| Classification | FAIL-PRODUCT / FAIL-TEST / FAIL-INFRA / FAIL-DATA / BLOCKED |
| Sévérité métier | P0 / P1 / P2 / P3 |

> Hypothèse uniquement — aucune correction effectuée.

## Blocages prévisibles (avant run)

### BLOCKED : E2E-MOB-RUNTIME / E2E-MAE-01…10

| Champ | Valeur |
| ----- | ------ |
| ID du test | E2E-MOB-RUNTIME + flux Maestro EXECUTABLE_FLOWS |
| Domaine | mobile natif |
| Scénario | Preuve black-box APK Preview + Maestro contre API préprod |
| Commande | `npm run verify:mobile-ui-e2e-runtime` |
| Fichier source | `Mobile/scripts/verify-mobile-ui-e2e-runtime.js`, `Mobile/maestro/*.yaml` |
| Surface | Android natif |
| Résultat attendu | Maestro exécuté, login préprod, artifacts |
| Résultat observé | Non exécutable sur la VM d’audit |
| Message d’erreur | Prérequis absents : Maestro, adb, device, APK, secrets `SOMAFRIK_E2E_*` |
| Environnement | ENV-LOCAL (pas de device) ; cible officielle = ENV-PREPROD |
| Classification | BLOCKED (infra / secrets / device) — confirmation runtime à journaliser si la commande est lancée |
| Sévérité métier | non classée produit (non exécuté) |

> Hypothèse uniquement — aucune correction effectuée. Le contrat runtime est fail-closed : un runner sans APK/device doit rester BLOCKED, jamais SUCCESS.

### SKIPPED-EXISTING : E2E-MAE-09 / 11 / 12

Déjà désactivés ou bloqués par le repository avant ce chantier. Non réactivés.
