# LOT MOBILE 8 — E2E Runtime APK / Préproduction

## Objectif

Transformer les contrôles Maestro historiques en preuve **black-box réelle** : une APK Android installée, pilotée par Maestro sur un appareil/émulateur, connectée au backend PostgreSQL de préproduction.

Un gate statique vert **n'est pas** une preuve E2E. La preuve runtime existe uniquement lorsqu'un manifeste et les artifacts d'une exécution `Mobile Runtime E2E` montrent des flows Maestro effectivement terminés sur `com.somafrik.app`.

## Autorités

- Données métier : PostgreSQL / API Somafrik.
- Tenant Mobile : `login_code` V2 public, jamais `SCH-*`.
- Preview live : `https://somafrik-api-preprod.onrender.com` uniquement.
- Secrets QA : GitHub Secrets uniquement, jamais commités ni inclus volontairement dans les artifacts.
- Logs Maestro : identifiant et mot de passe redacted par le runner.

## Workflow manuel

Workflow : `.github/workflows/mobile-e2e-runtime.yml`.

Il est volontairement `workflow_dispatch` : les attentes métier sont celles d'un fixture QA contrôlé et doivent être explicitement fournies au lancement.

### GitHub Secrets requis

- `SOMAFRIK_E2E_ADMIN_IDENTIFIER`
- `SOMAFRIK_E2E_ADMIN_PASSWORD`

Ces secrets ne sont pas placés dans l'`env` global du workflow. Ils sont injectés uniquement dans l'étape qui exécute notre runner E2E, après installation de Node, Android et Maestro.

### Inputs read-only

- `school_code` — `login_code` V2 du tenant QA
- `school_name`
- `expected_users`
- `expected_presence`
- `expected_payments`
- `class_name`
- `student_name`
- `teacher_name`
- `payment_reference`
- `evaluation_label`

Aucune valeur métier n'est inventée par les YAML : elles sont des attentes explicites du fixture QA.

## Mode `live`

APK Preview, badge `Preview QA`, API Render préprod.

Parcours exécutés :

1. login établissement/Admin réel ;
2. métriques Home exactes ;
3. Users cohérent avec Home ;
4. Classes + présence ;
5. paiement canonique ;
6. enseignant canonique ;
7. roster Présences ;
8. évaluations/notes ;
9. relaunch avec session restaurée et mêmes métriques.

Le scénario de panne partielle n'est pas exécuté contre l'APK Preview, car il exige une cible réseau contrôlable.

## Mode `fault`

Une deuxième APK de test réseau est construite avec `EXPO_PUBLIC_API_URL=http://10.0.2.2:5055` et mode démo désactivé.

Le proxy `Mobile/scripts/mobile-e2e-fault-proxy.js` :

- relaie vers la vraie API préprod ;
- force uniquement `GET /api/backoffice/users` en HTTP 503 ;
- conserve les headers d'authentification et de scope école ;
- ne journalise pas les credentials ;
- laisse Présences et Paiements fonctionner normalement.

Preuve attendue :

- Utilisateurs → `Indisponible` ;
- jamais faux `0` pour ce domaine en erreur ;
- Présence et Paiements restent aux valeurs attendues du fixture.

## Mode `mutation` — optionnel

Le test d'appel est séparé des parcours read-only. Il exige deux décisions explicites :

- `SOMAFRIK_E2E_MODE=mutation` ;
- `SOMAFRIK_E2E_ALLOW_MUTATIONS=1`.

Inputs supplémentaires :

- `student_id`
- `original_attendance_status`
- `target_attendance_status`

Les statuts autorisés sont `Présent`, `Absent`, `Retard`, `Justifié`, avec cible différente de l'original.

### Protection données

`CD-IN-26-001` est protégé par défaut : le runner refuse toute mutation sur ce code. La variable `SOMAFRIK_E2E_PROTECTED_SCHOOL_CODES` permet d'ajouter d'autres tenants protégés.

Le test mutationnel doit utiliser un **tenant QA dédié**.

### Restauration

Le flow `11-attendance-persistence.yaml` :

1. change le statut d'un élève QA ;
2. enregistre côté backend ;
3. relance l'application ;
4. vérifie que la valeur confirmée est toujours visible.

Le cleanup est un flow indépendant `12-attendance-restore.yaml`. Le runner l'exécute dans un bloc `finally`, y compris si la preuve de persistance échoue. Si le cleanup échoue, l'exécution est P0/rouge et le manifeste l'indique.

## Fail-closed runtime

`verify:mobile-ui-e2e-runtime` échoue si l'un des éléments suivants manque :

- Maestro CLI ;
- ADB ;
- exactement un appareil Android, sauf serial explicite ;
- package `com.somafrik.app` réellement installé ;
- API/proxy joignable avec le contrat `Somafrik API` ;
- credentials ;
- code école V2 ;
- attentes du fixture requises par le mode.

Il n'existe aucun chemin `SKIP => SUCCESS`.

## Artifacts

Répertoire local, gitignoré :

`Mobile/artifacts/maestro-runtime/<mode>-<timestamp>/`

Contenu :

- `manifest.json` ;
- un `.log` redacted par flow ;
- une capture `.png` après chaque flow ;
- logs émulateur ;
- log proxy en mode fault.

Le workflow GitHub conserve ces artifacts 14 jours.

## Sécurité CI

- permissions GitHub : `contents: read` ;
- uniquement actions officielles `actions/*` dans ce workflow ;
- Android Emulator démarré directement via Android SDK ;
- Maestro CLI verrouillé sur une version précise et installé avant toute injection des secrets ;
- aucun EAS submit ;
- aucun upload Play Store ;
- aucune donnée d'authentification dans le dépôt.

## Gates

### Gate statique CI/Security

`npm --prefix Mobile run verify:mobile-ui-e2e-scaffold`

Il vérifie la structure des flows, le runner, le proxy, les tests unitaires, le workflow et l'isolation des secrets. Il affiche explicitement qu'il **n'a pas piloté d'APK**.

### Gate runtime réel

`npm --prefix Mobile run verify:mobile-ui-e2e-runtime`

Un GO runtime ne peut être déclaré qu'après une exécution réelle avec artifacts disponibles.

## NO-GO

- appeler le scaffold « E2E APK » ;
- utiliser un faux backend comme source métier ;
- transformer une erreur API en `0` ;
- utiliser `SCH-*` comme code UI ;
- committer des credentials ;
- muter un tenant protégé ;
- laisser un fixture modifié après le test d'appel ;
- considérer une APK construite mais non installée/pilotée comme preuve.
