# AUDIT-REPO-2026 — État des lieux vérifié du dépôt Somafrik

**Date :** 2026-10-26
**Nature :** audit documentaire en lecture seule. Aucun changement Backend, Web, Mobile ou CI. Aucune fermeture de PR ou d'issue, aucun merge.
**Statut :** DRAFT / HOLD — NO READY / NO MERGE (décision CTO : « AUDIT ACCEPTÉ SOUS RÉSERVE — HOLD »).

## 0. Traçabilité

| Référence | SHA |
|---|---|
| `develop` (HEAD audité) | `0192e1ac226f624f0cc605f9af1a2c76c11142ff` (#998, 2026-10-26) |
| `main` (HEAD) | `ef8bc9517ffc94aa770743713d0f561f92a9fc1e` (#827, 2026-09-27) |
| Merge-base `main` / `develop` | `dd46ad17753738b68412e008baaf8c9017333885` |
| Commits `develop` absents de `main` | 246 |
| Commits `main` absents de `develop` | 11 |

**Légende**

- **[V]** : fait vérifié, avec la commande ou la source citée.
- **[S]** : risque supposé ou inférence, non prouvé.
- **[À VÉRIFIER]** : contrôle encore nécessaire, en général hors de portée de cet environnement.

### Méthode et limites

| Source | Accès | Méthode |
|---|---|---|
| Git (`develop`, `main`, têtes des 53 PR ouvertes) | Oui | `git merge-tree --write-tree` (fusion simulée réelle), comparaison des blobs avec `develop` |
| GitHub (PR, reviews, commentaires, check runs, Actions) | Oui (API) | Listes complètes, journaux de jobs |
| Tests backend unitaires | Oui | `node --test`, 322 fichiers, Chromium fourni via `PUPPETEER_EXECUTABLE_PATH` |
| `npm audit --omit=dev` (backend, web) | Oui | Analyse de l'usage réel dans le code |
| Render / API live (`api.somafrik.app`, `api-preprod.somafrik.app`) | **Non** | Hôtes refusés par la politique réseau de l'environnement d'audit (CONNECT 403) |
| Google Play Console | **Non** | Seules les traces présentes dans le dépôt sont exploitées |
| Historique Git antérieur au 13/09 | **Partiel** | Clone superficiel : `a42c079d4` (13/09) est la limite visible |
| Événements de PR (passage Draft → Ready, protections de branche) | **Non** | L'API disponible n'expose pas la chronologie des événements ni les règles de protection |

## 1. Corrections apportées au premier bilan

| Affirmation du premier bilan | Constat |
|---|---|
| « Somafrik n'est pas en production » | **[S] Probablement faux.** **[V]** `main` a été promue les 23 et 27/09 (#799, #823, #825, #827). Selon `docs/render.md`, `main` alimente `api.somafrik.app`. **[V]** Un AAB de production en `versionCode` 24 a été préparé le 23/09 (#801 à #803). **[À VÉRIFIER]** Ce qui tourne réellement sur Render et sur Play. |
| « Freeze G0 depuis le 19/09 » | **[V]** Document non tenu à jour : 246 commits sont entrés dans `develop` depuis, dont des fonctionnalités (cartes, NFC). `RELEASES.md` et `ROADMAP.md` datent du 19/09. |
| « ~30 PR NFC en HOLD » | **[V]** 53 PR ouvertes, dont environ 40 NFC/cartes (§5). |
| « 20 tests backend échouent » | **[V]** 4 échecs réels, aucune régression produit avérée (§6). |
| « Six échecs nocturnes » (bilan 2) | **[V]** Sous-estimé : **54 échecs sur 54** exécutions planifiées de `CI Full Nightly`, du 03/09 au 26/10 (§3). |

## 2. Divergence `main` / `develop`

### 2.1 Les 11 commits propres à `main` [V]

`git log origin/develop..origin/main`. Sept sont des commits de fusion (« merge »), quatre des commits simples.

| SHA | Date | Objet |
|---|---|---|
| `ef8bc9517` | 2026-09-27 | release: promote dashboard activity 403 fix to main (#827) — merge |
| `24e1eb8e9` | 2026-09-27 | release: promote web topbar changes to main (#825) — merge |
| `8d981efe6` | 2026-09-27 | release: promote develop to main (#823) — merge |
| `376f17a4d` | 2026-09-23 | fix(android): créer android avant local.properties (#803) — merge |
| `60feff041` | 2026-09-23 | fix(android): allow clean AAB prebuild without android directory |
| `aaf6e5ceb` | 2026-09-23 | fix(android): synchroniser versionCode natif avant AAB (#802) — merge |
| `a8af4bd2f` | 2026-09-23 | fix(android): sync native versionCode before AAB build |
| `f1102d470` | 2026-09-23 | release(android): versionCode 24 pour AAB production (#801) — merge |
| `cb1b79c71` | 2026-09-23 | release(android): align canonical versionCode 24 |
| `295c044e4` | 2026-09-23 | release(android): bump production versionCode to 24 |
| `372b7aac1` | 2026-09-23 | release(prod): promouvoir develop vers main avant AAB production (#799) — merge |

**[V]** Depuis le merge-base, `main` ne modifie que 4 fichiers par rapport à lui (+51 / −3) :
- `Mobile/app.json`
- `Mobile/config/releaseEnvironments.js`
- `Mobile/scripts/build-android-aab.js`
- `Mobile/scripts/build-android-env.js` (ajout de `fs.mkdirSync(androidDir, { recursive: true })`)

### 2.2 Configuration Android : comparaison `develop` → `main` [V]

| Élément | `develop` | `main` |
|---|---|---|
| `ANDROID_VERSION_CODE` (`Mobile/config/releaseEnvironments.js`) | **13** | **24** |
| `android.versionCode` (`Mobile/app.json`) | 13 | 24 |
| Plugin `expo-camera` (scan QR) | présent | absent |
| Plugin `./plugins/withSomafrikNfcAndroid` | présent | absent |
| Permission `android.permission.NFC` | demandée | **bloquée** (`blockedPermissions` dans `Mobile/app.config.js`) |
| `APP_VERSION` | 1.2.1 | 1.2.1 |

**Conséquences :**
- **[S]** Un AAB construit depuis `develop` porterait `versionCode` 13, inférieur au 24 déjà construit sur `main`. Play le refuserait si le 24 a été envoyé **[À VÉRIFIER]**.
- **[V]** Une fusion complète de `main` dans `develop` réintroduirait la configuration sans NFC ni QR caméra, d'où la décision CTO de ne pas fusionner automatiquement.
- **Correction minimale candidate (non appliquée) :** relever seulement `ANDROID_VERSION_CODE` et `android.versionCode` sur `develop` (≥ 25), et reporter le correctif `fs.mkdirSync` de `build-android-env.js`. **[À VÉRIFIER]** La source canonique du `versionCode` : `releaseEnvironments.js` est lu par `app.config.js`, et `app.json` doit rester aligné (garde `android-release-readiness`).

### 2.3 Workflows CI : écarts `develop` / `main` [V]

`git diff origin/develop origin/main -- .github/workflows` :
- **6 fichiers de workflow** diffèrent ;
- **3 n'existent que sur `develop`** : `nfc-encoding-preprod.yml`, `rbac-http-live.yml`, `mobile-preview-windows.yml` ;
- `ci.yml` diffère d'une ligne : `verify:student-access-cards`, présent sur `develop` seulement.

## 3. CI : `develop` n'est pas couverte par les exécutions de nuit

1. **[V]** `ci.yml` (« CI Full Nightly ») et `security.yml` (« Security Nightly ») se déclenchent uniquement sur `schedule` et `workflow_dispatch`. GitHub exécute les déclenchements planifiés sur la branche par défaut, ici **`main`**. `develop` n'est contrôlée que par `pr-gates.yml` et par les workflows déclenchés par chaque PR.
2. **[V]** **`CI Full Nightly` : 54 échecs sur 54 exécutions planifiées**, du 03/09 (run 1229) au 26/10 (run 1283). Depuis le 28/09, toutes tournent sur `main@ef8bc95`.
3. **[V] Cause de l'échec du 26/10** (run `40280712373`, job `121433157504`, étape « Full domain regression ») :
   - `npm run verify:school-code-v2` échoue sur l'assertion `CD-2026-0001 interdit en runtime`.
   - Fichiers en cause :
     - `web/src/lib/financeL308PaymentStudent.fixture.ts`
     - `web/src/lib/schoolCanonicalIdentity.ts`
     - `scripts/audit-go-prod-baseline-400.js`
     - `scripts/capture-communication-ux.mjs`
4. **[V] Échec reproduit localement**, à l'identique sur `develop@0192e1a` et sur `main@ef8bc95` (`node backend/scripts/verify-school-code-v2.js`).
5. **[V] Pourquoi aucune PR ne l'a détecté :** `verify:school-code-v2` n'est appelé que par `ci.yml` (nuit), jamais par `pr-gates.yml`.
6. **[À VÉRIFIER]**
   - Cause des échecs antérieurs (03/09 → 25/10) : les SHA diffèrent avant le 28/09 et les journaux n'ont pas été relus un par un.
   - Date d'introduction du jeton : présent dans les 4 fichiers au plus tard le 13/09 (limite du clone superficiel).
7. **[V] `Security Nightly`** a réussi 5 fois sur les 6 dernières exécutions, sur `main` (échec le 25/10, non analysé).

## 4. Fusions #984 à #998 : traçabilité

**Périmètre.** 12 PR fusionnées dans `develop` : #984, #985, #986, #988, #989, #990, #991, #994, #995, #996, #997, #998. Les numéros #987, #992 et #993 sont encore ouverts.

| PR | Titre au moment de l'audit | HEAD fusionné | Base | Ouverte → fusionnée (UTC) | Check runs (HEAD) | Reviews |
|---|---|---|---|---|---|---|
| [#984](https://github.com/Somafrik-education/Somafrik/pull/984) | [DRAFT/HOLD] CARTE-BATCH-API-02 | `1743c7b3` | `a7b10cd4` | 10-23 15:29 → 17:09 | 46 ; 0 échec | Codex (bot), 17:12 |
| [#985](https://github.com/Somafrik-education/Somafrik/pull/985) | [DRAFT / HOLD] SEC-PDF-01 | `2c96b90b` | `53510ca4` | 10-23 17:20 → 17:35 | 37 ; 0 échec | Codex (bot), 17:37 |
| [#986](https://github.com/Somafrik-education/Somafrik/pull/986) | DRAFT/HOLD — CARTE-BATCH-WEB-01 | `ff57aa31` | `79dadcfd` | 10-23 17:37 → 19:33 | 20 ; 0 échec | Codex (bot), 19:35 |
| [#988](https://github.com/Somafrik-education/Somafrik/pull/988) | feat(card): PDF A4… (corps : « DRAFT / HOLD — NO MERGE ») | `738af46a` | `3a3fc873` | 10-23 20:01 → 20:52 | 21 ; 0 échec | Codex (bot), 20:54 |
| [#989](https://github.com/Somafrik-education/Somafrik/pull/989) | [HOLD] CARTE-BATCH-DESIGN-01 | `5b69f42d` | `d6b29e9c` | 10-23 21:37 → 21:49 | 20 ; 0 échec | Codex (bot), 21:51 |
| [#990](https://github.com/Somafrik-education/Somafrik/pull/990) | [DRAFT / HOLD] CARTE-PHOTO-01 | `da044d3c` | `0d586a98` | 10-23 22:42 → 22:51 | 19 ; 0 échec | aucune |
| [#991](https://github.com/Somafrik-education/Somafrik/pull/991) | [HOLD] CARTE-PHOTO-02 | `5c0cf53b` | `69cadf24` | 10-23 23:25 → 23:41 | 48 ; 0 échec | aucune |
| [#994](https://github.com/Somafrik-education/Somafrik/pull/994) | [DRAFT / HOLD] SEC-AUTH-03 | `77993db2` | `a0edc64a` | 10-24 13:49 → 10-25 11:38 | 42 ; 0 échec | aucune |
| [#995](https://github.com/Somafrik-education/Somafrik/pull/995) | [DRAFT / HOLD] SEC-AUTH-04 | `adb8c362` | `6f840e6d` | 10-24 16:02 → 10-25 12:38 | 51 ; 0 échec | aucune |
| [#996](https://github.com/Somafrik-education/Somafrik/pull/996) | [DRAFT / HOLD] SEC-AUTH-05 | `327481e9` | `c4d49077` | 10-25 13:45 → 14:52 | 46 ; 0 échec | aucune |
| [#997](https://github.com/Somafrik-education/Somafrik/pull/997) | [DRAFT / HOLD] SEC-TENANT-02 | `f885f1c7` | `1f1c35c5` | 10-26 12:09 → 12:19 | 42 ; 0 échec | aucune |
| [#998](https://github.com/Somafrik-education/Somafrik/pull/998) | [DRAFT / HOLD] SEC-JWT-01a | `8c44a115` | `e4fc2b1c` | 10-26 13:22 → 13:37 | 37 ; 0 échec | aucune |

Les check runs « ignorés » (parités LOT hors périmètre) sont comptés dans le total, pas dans les échecs.

### Faits [V]

1. **Identité.** Les 12 PR sont ouvertes par le compte `Somafrik` et fusionnées par ce même compte (`merged_by: Somafrik`). Les commentaires humains visibles proviennent aussi de ce compte. Les commits sont signés « Claude », « Cursor » ou `Somafrik`.
2. **CI.** Pour chacune des 12 PR, les check runs du HEAD fusionné sont tous `success` ou `skipped`, sans aucun `failure`, et ils étaient terminés avant l'heure de fusion.
3. **Reviews.** Aucune approbation (`APPROVED`) ni demande de changements. Les seules reviews sont celles du bot Codex, déclenchées par le passage « Draft → Ready ».
   - Pour #984 à #989, la review Codex est postée **2 à 3 minutes après la fusion**.
   - Pour #995 et #998, le résumé Codex est daté d'après la fusion (12:39:32 contre 12:38:43 ; 13:38:55 contre 13:37:57).
4. **Corps des PR.** Les 12 corps déclarent « DRAFT / HOLD — NO READY / NO MERGE », ou « aucun Ready, merge ni déploiement sans décision CTO ».
5. **Autorisations citées hors GitHub.**
   - Le commit `619e0369` (#995) indique « Authorised by CTO on #995 », et le corps de #996 « avec l'autorisation CTO ».
   - **Aucun commentaire d'autorisation CTO n'existe dans ces PR.** Les seuls commentaires sont des rapports d'agent ou du bot Codex.
6. **#995.** Les deux derniers commits avant fusion ont été poussés directement par le compte `Somafrik`, après le dernier rapport d'agent :
   - `fabe0f99` : « test(nfc): avoid cross-schema index catalog race in DIAG-10 » ;
   - `adb8c362` : extension de la liste fermée L4-09.

   Le CI était vert sur ce HEAD.
7. **#990 et #991.** Les corps exigent un smoke navigateur ou préproduction (SMOKE-PHOTO-01) **non réalisé** au moment de la fusion.

### Lecture [S]

- Les fusions sont **techniquement couvertes par la CI de PR**.
- Elles ne sont **pas traçables dans GitHub** comme autorisées : aucune approbation, aucun commentaire CTO, et un titre ou corps qui contredit l'état final.
- Cela n'établit pas une fusion **non autorisée** : la décision a pu être prise hors GitHub.

### [À VÉRIFIER]

- Chronologie des événements `ready_for_review` / `merged` (API timeline).
- Règles de protection de `develop` : approbation requise, checks requis, contournement par administrateur.
- Trace hors GitHub de la décision CTO pour chaque PR.

## 5. Pull requests ouvertes : 53

Classement par analyse git : fusion simulée et identité des fichiers par rapport à `develop@0192e1a`. Une revue sémantique par l'auteur reste requise avant toute fermeture. **Aucune PR n'a été fermée par cet audit.**

### A. Contenu déjà présent dans `develop` (8)

| PR | Preuve [V] |
|---|---|
| [#957](https://github.com/Somafrik-education/Somafrik/pull/957), [#965](https://github.com/Somafrik-education/Somafrik/pull/965), [#968](https://github.com/Somafrik-education/Somafrik/pull/968) | Fusion simulée : **diff nul** par rapport à `develop` |
| [#946](https://github.com/Somafrik-education/Somafrik/pull/946), [#963](https://github.com/Somafrik-education/Somafrik/pull/963) | 4/4 fichiers ajoutés identiques (commits « reconcile #963 » du 17/10). Reliquat : 11 lignes en conflit |
| [#947](https://github.com/Somafrik-education/Somafrik/pull/947), [#964](https://github.com/Somafrik-education/Somafrik/pull/964) | 6/7 fichiers identiques (« reconcile #964 »). Reliquat : environ 90 lignes |
| [#949](https://github.com/Somafrik-education/Somafrik/pull/949) | Fichier ajouté identique. Reliquat : 4 lignes |

### B. Remplacées par des travaux fusionnés ensuite (13)

- **Chaîne empilée NFC-ENC / RECON / PROG :**
  - [#908](https://github.com/Somafrik-education/Somafrik/pull/908), [#909](https://github.com/Somafrik-education/Somafrik/pull/909), [#912](https://github.com/Somafrik-education/Somafrik/pull/912), [#913](https://github.com/Somafrik-education/Somafrik/pull/913), [#914](https://github.com/Somafrik-education/Somafrik/pull/914), [#915](https://github.com/Somafrik-education/Somafrik/pull/915), [#916](https://github.com/Somafrik-education/Somafrik/pull/916), [#917](https://github.com/Somafrik-education/Somafrik/pull/917) ;
  - 126 commits de retard sur `develop` ;
  - 23 à 32 fichiers en conflit chacune ;
  - 100 % de leurs fichiers ajoutés existent déjà dans `develop`, sous une forme évoluée.
- **Autres :**
  - [#891](https://github.com/Somafrik-education/Somafrik/pull/891) : 15 conflits ;
  - [#935](https://github.com/Somafrik-education/Somafrik/pull/935) : 14 conflits ;
  - [#936](https://github.com/Somafrik-education/Somafrik/pull/936) : 5 conflits ;
  - [#940](https://github.com/Somafrik-education/Somafrik/pull/940) : base `integration/carte-pr1-pr2` ;
  - [#939](https://github.com/Somafrik-education/Somafrik/pull/939) : base `fix/nfc-recette-06…`.

### C. Branches de recette ou composition « NO MERGE » (4)

[#930](https://github.com/Somafrik-education/Somafrik/pull/930), [#932](https://github.com/Somafrik-education/Somafrik/pull/932), [#943](https://github.com/Somafrik-education/Somafrik/pull/943), [#948](https://github.com/Somafrik-education/Somafrik/pull/948)

### D. Audits ou documentation seuls, fusion sans conflit (12)

[#756](https://github.com/Somafrik-education/Somafrik/pull/756), [#806](https://github.com/Somafrik-education/Somafrik/pull/806), [#833](https://github.com/Somafrik-education/Somafrik/pull/833), [#897](https://github.com/Somafrik-education/Somafrik/pull/897), [#910](https://github.com/Somafrik-education/Somafrik/pull/910), [#922](https://github.com/Somafrik-education/Somafrik/pull/922), [#926](https://github.com/Somafrik-education/Somafrik/pull/926), [#928](https://github.com/Somafrik-education/Somafrik/pull/928), [#950](https://github.com/Somafrik-education/Somafrik/pull/950), [#959](https://github.com/Somafrik-education/Somafrik/pull/959), [#977](https://github.com/Somafrik-education/Somafrik/pull/977), [#992](https://github.com/Somafrik-education/Somafrik/pull/992)

### E. Correctifs encore pertinents, à requalifier (16)

| PR | Sujet | Fusion simulée | Observation |
|---|---|---|---|
| [#987](https://github.com/Somafrik-education/Somafrik/pull/987) | SEC-XSS-01, aperçu bulletins / GrapesJS | Propre (11 fichiers) | Sécurité |
| [#993](https://github.com/Somafrik-education/Somafrik/pull/993) | SEC-PDF-02, sandbox Chromium | Propre (11 fichiers) | Dépend d'une image backend non-root (`backend/Dockerfile` sans `USER`) |
| [#839](https://github.com/Somafrik-education/Somafrik/pull/839) | Ne plus convertir un `passwordHash` en clair en hash scrypt | Propre (29 lignes) | **[V]** Toujours pertinent : `materializeAccountSecretHashes` lit encore `user.passwordHash` en clair. Exposition limitée aux chemins legacy |
| [#937](https://github.com/Somafrik-education/Somafrik/pull/937), [#971](https://github.com/Somafrik-education/Somafrik/pull/971) | NFC Reader Mode / « Absent provisoire » | Propre | Vérifier qu'elles ne sont pas déjà couvertes |
| [#925](https://github.com/Somafrik-education/Somafrik/pull/925), [#927](https://github.com/Somafrik-education/Somafrik/pull/927), [#929](https://github.com/Somafrik-education/Somafrik/pull/929), [#934](https://github.com/Somafrik-education/Somafrik/pull/934), [#938](https://github.com/Somafrik-education/Somafrik/pull/938), [#952](https://github.com/Somafrik-education/Somafrik/pull/952), [#958](https://github.com/Somafrik-education/Somafrik/pull/958), [#972](https://github.com/Somafrik-education/Somafrik/pull/972) | Correctifs NFC et présence | 1 à 6 conflits | Retester chaque bug sur `develop` |
| [#648](https://github.com/Somafrik-education/Somafrik/pull/648) | Web Push navigateur | 991 commits de retard, conflits | P2 |
| [#830](https://github.com/Somafrik-education/Somafrik/pull/830) | Audit Push annonces | 2 conflits | — |
| [#804](https://github.com/Somafrik-education/Somafrik/pull/804) | Signature AAB locale (base `main`) | Propre | À traiter avec le sujet `versionCode` (§2) |

## 6. Tests backend (`develop@0192e1a`)

**[V]** 322 fichiers unitaires (hors `*.pg.test.js`), 2 560 tests : **2 553 passent, 4 échouent, 3 sont ignorés**.

| Échec | Classe | En CI ? |
|---|---|---|
| 16 tests PDF (`secPdf01RendererIsolation`, `reportCardPdf`), lors de la première passe | **Environnement** (Chromium absent). Avec Chromium : 39/39 | — |
| `legacyBootMigrations.guard` : « tombstone fail-closed » | **Test obsolète.** Le mock `pg` ne satisfait plus `STUDENT_CANONICAL_POSTGRES_ALLOCATOR_NOT_READY` (#700, 18/09) | Non (`verify:notes-sync`, appelé par aucun workflow) |
| `pedagogyStaffSyncRepository.test.js` | **Test obsolète** : écriture BackOffice State supprimée (ADR LOT8) | Non |
| `studentsSyncRepository.test.js` | **Test obsolète** (même cause) | Non |
| `demoAssignments.greenB` : DEMO-PRES-RED-01 | **Dérive de contrat.** `roleKeys` du hash de scope = libellé `Admin School` au lieu de `SCHOOL_ADMIN`. La valeur provient des rôles relus en base (`loadLiveRoleKeys` puis `toRoleLabel`), pas du JWT : aucun impact sur les droits | Non |

**Recoupement :** les corps de #997 et #998 rapportent les deux mêmes échecs unitaires préexistants (`demoAssignments.greenB`, `legacyBootMigrations.guard`). Ils signalent aussi l'échec préexistant du banc PostgreSQL `backofficeStateRemoval.pg.test.js`, **non reproduit par cet audit**.

### Non exécutés par cet audit [À VÉRIFIER]

| Ensemble | Volume | Raison |
|---|---|---|
| Bancs PostgreSQL backend (`*.pg.test.js`) | 128 fichiers | Pas de base PostgreSQL jetable dans cette passe |
| Tests Mobile (`Mobile/src/**/*.test.ts*`) | 159 fichiers | Dépendances Mobile non installées |
| Tests Web (Vitest) | 321 fichiers | Seul le typecheck Web a été lancé (vert) |
| E2E (Playwright, Maestro), smoke navigateur ou appareil, NFC physique | — | Hors périmètre ou matériel requis |

## 7. Vulnérabilités des dépendances (`npm audit --omit=dev`) : exploitabilité

### Backend

| Paquet | Gravité | Atteignable ? | Analyse |
|---|---|---|---|
| `body-parser` (via express) | Haute | **[S] Oui, sans authentification** | `express.json()` décompresse le gzip : déni de service via octets en trop après un corps compressé. La variante « limite invalide » n'est pas atteignable (`JSON_BODY_LIMIT` = 1mb ou 2mb) |
| `qs` (via express) | Modérée | **[S] Oui, sans authentification** | Analyse des query strings : déni de service |
| `nodemailer` 6.x | Haute (×19) | **[V] Faible** | Seul usage : `communicationChannelFanout.js`. Destinataires issus de la base ou de `notifyTo()` (interne), jamais saisis par un visiteur. SMTP désactivé par défaut. Correctif = version majeure 10 |
| `zod` (via `puppeteer` → `chromium-bidi`) | Haute | [V] Non | Dépendance interne du pilote Chromium |
| `mongoose` | Modérée | **[V] Non** | Déclaré, jamais importé |

### Web

| Paquet | Gravité | Atteignable ? | Analyse |
|---|---|---|---|
| `react-router-dom` 6.30.x | Modérée | [S] Faible | Aucun paramètre `redirect` / `next` / `returnTo` trouvé dans `web/src` |
| `zod` | Haute | [S] Faible | Validation côté client uniquement |
| `postcss`, `nanoid`, `source-map-js`, `tailwindcss` | Haute / modérée | [V] Non | Outils de build |

**Mobile :** non audité (#510).

## 8. Issues ouvertes : points notables

| Issue | Constat |
|---|---|
| [#730](https://github.com/Somafrik-education/Somafrik/issues/730) (P0 DNS préprod) | **[V]** Correctif #731 fusionné le 20/09 (`32ad17521`). **[À VÉRIFIER]** Contrôle live avant clôture |
| [#499](https://github.com/Somafrik-education/Somafrik/issues/499) (P0 permissions de stockage) | **[V]** Correctif présent dans le code (`blockedPermissions`, `tools:node="remove"`). **[À VÉRIFIER]** Manifeste fusionné de l'AAB final |
| [#921](https://github.com/Somafrik-education/Somafrik/issues/921) (P0 NFC physique) | Ouvert. Test sur matériel requis |
| [#832](https://github.com/Somafrik-education/Somafrik/issues/832) (fiche élève) | Ouvert. Audit #833 non fusionné |
| [#690](https://github.com/Somafrik-education/Somafrik/issues/690) « noop » | Candidate à fermeture |

## 9. Plan de remédiation R1 à R15 (inchangé, **non autorisé**)

Décision CTO du 26/10 : aucune de ces PR n'est autorisée tant qu'elles ne sont pas ordonnées par dépendance et par risque.

| # | PR | Périmètre | Prérequis |
|---|---|---|---|
| R1 | Correction du `versionCode` sur `develop` | **Révisé par décision CTO :** pas de fusion `main` → `develop`. Correction minimale (§2.2) | GO CTO |
| R2 | CI : nightlies sur `develop` | `checkout ref: develop` ; corriger `verify:school-code-v2` (§3) ; ajouter ce gate aux PR Gates | — |
| R3 | Fermeture des 25 PR A + B + C | GitHub uniquement, commentaire de preuve | Validation auteur ou CTO |
| R4 | #987 XSS | Tel quel après revue | — |
| R5 | Backend non-root | `USER node` dans `backend/Dockerfile` | — |
| R6 | #993 sandbox Chromium | Tel quel | R5 |
| R7 | #839 hash en clair | Tel quel | — |
| R8 | express / body-parser / qs | Lockfile backend | — |
| R9 | Retrait de `mongoose` | `backend/package.json` et lockfile | — |
| R10 | Mise à jour mineure de puppeteer (zod) | Lockfile, tests PDF | — |
| R11 | nodemailer 10 | Lib et tests du fanout | R8 |
| R12 | Web : `react-router-dom`, `zod` | Lockfile web | — |
| R13 | 4 tests obsolètes : corriger et brancher en CI | Tests | R2 |
| R14 | Issues #690, #730, #499 | GitHub, AAB | R1 |
| R15 | Gouvernance | `RELEASES.md` / `ROADMAP.md` ; règle « titre et label = état réel » ; trace d'autorisation dans la PR | — |

**Proposition d'ordonnancement (à valider par le CTO) :**

1. **Gouvernance et observabilité d'abord**, parce qu'elles conditionnent la confiance dans tout le reste : R15 (trace des autorisations), puis R2 (CI de `develop`), puis R13.
2. **Ensuite, une PR à la fois, du plus isolé au plus large :** R9 → R8 → R10 → R4 → R5 → R6 → R7 → R12 → R11.
3. **R1 et R14 :** liés à une décision de release Android.
4. **R3 :** fermetures, après validation des auteurs.

## 10. Vérifications encore nécessaires (opérateur ou CTO)

1. SHA déployés sur Render en production et en préproduction (`/api/health` → `gitSha`).
2. Piste Google Play : dernier `versionCode` envoyé, piste, statut.
3. Chronologie GitHub des fusions #984 à #998 et règles de protection de `develop`.
4. Causes des échecs nocturnes du 03/09 au 25/10 et de `Security Nightly` du 25/10.
5. Bancs PostgreSQL, tests Mobile, Web et E2E sur `develop@0192e1a`.
6. Revalidation du nombre de commits d'avance et de retard (`develop` / `main`) au moment de toute décision de synchronisation.
