# SEC-PDF-02 — Audit et durcissement de l'exécution Chromium (bulletins PDF)

Base : `develop@a0edc64a` (SEC-PDF-01 #985 intégré). SEC-XSS-01 #987 : chantier indépendant, non repris.

## 1. Matrice d'audit (phase A)

### A2 — Environnement d'exécution de l'API

| Environnement | Ce que dit le dépôt | Statut |
|---|---|---|
| Préproduction Render (`somafrik-api-preprod`) | `docs/render.md` (source canonique) et `docs/preproduction.md` : « Web Service Node ». `backend/lib/deployGitSha.js` lit `RENDER_GIT_COMMIT` (variable fournie par Render, en natif comme en Docker). Aucun `render.yaml` dans le dépôt. | **ENVIRONNEMENT RENDER RÉEL : NON CONFIRMÉ** (indices forts : Node natif) |
| Production Render | `docs/render.md` : soumise au gate GO-PROD, non activée. | **Non activée / non confirmée** |
| Production auto-hébergée (Docker) | `docker-compose.production.yml` + `deploy/caddy` + `backend/Dockerfile` (`node:22.12-alpine`, `chromium` Alpine, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, **aucune directive `USER` → root**). `docs/project/ARCHITECTURE.md` : « API prod : Docker + Caddy ». | Chemin documenté, usage réel non confirmé |
| Docker local (`docker-compose.yml`) | Même image, root. | Développement |
| CI GitHub (`ubuntu-latest` = 24.04) | Utilisateur `runner` non-root ; AppArmor restreint les espaces de noms utilisateur non privilégiés. | Confirmé (logs CI) |

**CI — justification.** Pour exécuter réellement la sandbox exigée, les jobs « Core tests » (PR Gates) et « Security invariants » (`security.yml`) — seuls à générer des PDF avec ce moteur — chargent `scripts/ci/chromium-userns-apparmor.sh` : profil AppArmor `somafrik-ci-chromium` accordant `userns` **au seul binaire Chromium de Puppeteer**. La restriction globale du runner reste à 1 (vérifié par le script) ; aucun `sysctl`. Runner GitHub hébergé, éphémère, détruit après le job.

À confirmer dans le tableau de bord Render, sans modification : type de runtime (Node ou Docker), commande de build et de démarrage, utilisateur d'exécution, présence de `PUPPETEER_EXECUTABLE_PATH`, valeur de `NODE_ENV`.

### A3 — Binaires Chromium

| Contexte | Binaire | Preuve |
|---|---|---|
| Puppeteer verrouillé | `puppeteer` / `puppeteer-core` 25.3.0, `@puppeteer/browsers` 3.0.6 | `backend/package-lock.json` |
| Render natif / CI (sans `PUPPETEER_EXECUTABLE_PATH`) | **Chrome 150.0.7871.24** complet, mode headless (`headless: true`) ; Chrome Headless Shell 150 également téléchargé mais non utilisé par défaut | `puppeteer.executablePath()` → `~/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome` ; log CI « chrome (150.0.7871.24) downloaded » |
| Docker Alpine | Chromium du paquet Alpine (`/usr/bin/chromium`), version liée à l'image | `backend/Dockerfile` — **non testé** (ni démon Docker ni dépôt Alpine accessibles) |
| Poste de vérification | Chromium 141.0.7390.37 et Headless Shell 141 | `/opt/pw-browsers` |
| Windows | Non concerné en déploiement | — |

Répertoires : profil Chromium temporaire créé par Puppeteer dans `os.tmpdir()` (`TMPDIR`) ; cache navigateur `~/.cache/puppeteer` (Render natif / CI). Aucun autre répertoire en écriture n'est nécessaire au rendu.

Correction par rapport au rapport SEC-PDF-01 : `headless: true` lance le Chrome complet 150 (nouveau mode headless), pas Chrome Headless Shell.

### A4 — Privilèges et sandbox (mesures)

Mesure par la page interne `chrome://sandbox` (Chromium 141, Linux 6.18) :

| Exécution | Résultat |
|---|---|
| Non-root, espaces de noms utilisateur disponibles, sans `--no-sandbox` | Layer 1 : **Namespace** ; PID namespaces **Yes** ; Network namespaces **Yes** ; Seccomp-BPF **Yes** ; « **You are adequately sandboxed** » |
| Root, sans `--no-sandbox` | **Échec du lancement** (Chromium refuse la sandbox en root) |
| Root, `--no-sandbox` (configuration SEC-PDF-01 par défaut) | Layer 1 : None ; seccomp **No** ; « **You are NOT adequately sandboxed** » |

Conditions nécessaires : processus **non-root** et espaces de noms utilisateur non privilégiés (ou helper `chrome-sandbox` setuid, non fourni par Puppeteer). Sur Ubuntu 24.04, AppArmor les restreint (`kernel.apparmor_restrict_unprivileged_userns=1`).

### A5 — Surface fonctionnelle

| Moteur | Appelants | Sandbox |
|---|---|---|
| `backend/services/bulletinPdfRenderer.js` | `GET /api/students/:id/report.pdf` (`ReportPdfService`), `POST /api/backoffice/bulletin-design/preview?format=pdf` (superadmin) | **Traité ici** |
| `backend/lib/reportCard/reportCardPdf.js` (LOT 5, publication) | `createReportCardPdf` (bulletins publiés) | **Même problème constaté** : `--no-sandbox --disable-setuid-sandbox` en dur, Chromium lancé par rendu. **Non modifié** (§8 du mandat : autorisation CTO requise). |

Les autres composants (cartes élèves, exports) n'utilisent pas Chromium.

## 2. Politique de sandbox (phase B)

`SOMAFRIK_PDF_CHROMIUM_SANDBOX` — `backend/lib/pdfChromiumSandboxPolicy.js` :

| Valeur | Mode | Effet |
|---|---|---|
| (absente), `enabled`, `required` | `required` | Sandbox exigée. **Nouveau défaut, y compris en production.** |
| `disabled`, `insecure-local` | `insecure-local` | Sans sandbox ; **poste local uniquement** (garde ci-dessous). |
| `pdf-disabled` | `pdf-disabled` | Génération PDF coupée (503). Mécanisme de retour arrière. |
| autre | `invalid` | Génération PDF refusée (503). |

Garde locale du mode sans sandbox (toutes les conditions requises, sinon refus 503) :
- `NODE_ENV` vaut exactement `development` ou `test` (vide, `production`, `staging` ou autre → refus) ;
- `APP_ENV` absent ou `local` / `development` / `test` / `ci` (`preproduction`, `production`, `demo` ou autre → refus) ;
- variable `RENDER` absente (Render la définit sur tous ses services).

Changement de contrat : sous SEC-PDF-01, l'absence de la variable signifiait « sans sandbox ».

Fail-closed : un seul lancement par demande, avec les options de la politique ; jamais de relance avec `--no-sandbox`. Échec de configuration ou de lancement → `503 BULLETIN_PDF_UNAVAILABLE` (« La génération des bulletins PDF est temporairement indisponible. »), journal interne `[SEC-PDF-02] Génération PDF indisponible (<raison>)` sans chemin absolu. Le reste de l'API continue de fonctionner. Toutes les protections SEC-PDF-01 sont inchangées.

## 3. Contrat de déploiement et retour arrière

**Ne pas déployer cette PR sans avoir vérifié l'environnement cible**, car le défaut devient « sandbox exigée » :

| Cible | Effet attendu après déploiement | Prérequis |
|---|---|---|
| Render natif non-root avec espaces de noms | PDF sandboxé | Vérifier utilisateur et `chrome://sandbox` (procédure ci-dessous) |
| Render natif root ou sans espaces de noms | PDF **503** | SEC-PDF-02B ou retour arrière |
| Docker `backend/Dockerfile` (root) | PDF **503** | SEC-PDF-02B : image non-root (proposition ci-dessous) |
| Postes locaux en root | PDF 503 | `SOMAFRIK_PDF_CHROMIUM_SANDBOX=disabled` (hors production) |

### Contrôles Render en lecture seule (liste minimale, avant tout déploiement)

Dans le tableau de bord du service API (aucune modification) :

| # | Paramètre | Où | Attendu pour la sandbox |
|---|---|---|---|
| R1 | Runtime | Settings → Runtime / Language | `Node` (natif) ou `Docker` — détermine le binaire |
| R2 | Build command | Settings → Build & Deploy | inclut `npm ci` dans `backend` (le `postinstall` télécharge Chrome 150) |
| R3 | Start command | Settings → Build & Deploy | `node server.js` (ou `npm start`) dans `backend` |
| R4 | Auto-deploy | Settings → Build & Deploy | Branche suivie (`develop` en préprod) : un merge déclenche-t-il un déploiement ? |
| R5 | Variables | Environment | Présence et valeur de `NODE_ENV`, `APP_ENV`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_CACHE_DIR`, `SOMAFRIK_PDF_CHROMIUM_SANDBOX` (noms et valeurs non secrètes uniquement) |

Depuis le shell du service (lecture seule, documents fictifs) :

| # | Commande | Attendu |
|---|---|---|
| S1 | `id -u` | ≠ 0 (non-root) |
| S2 | `cat /proc/sys/user/max_user_namespaces` | > 0 |
| S3 | `cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null` | absent ou 0 ; sinon profil requis |
| S4 | `unshare -U -r true && echo OK` | `OK` |
| S5 | `cd backend && node -e '(async()=>console.log(await require("puppeteer").executablePath()))()'` | chemin du Chrome 150 existant |
| S6 | `node --test backend/lib/secPdf02RealSandbox.test.js` | 4/4 (« adequately sandboxed ») |

Si S1 à S6 sont conformes : état 1 (confirmé). Sinon : ne pas déployer (SEC-PDF-02B ou retour arrière).

Retour arrière (dans l'ordre de préférence) :
1. Redéployer la version précédente validée.
2. Positionner `SOMAFRIK_PDF_CHROMIUM_SANDBOX=pdf-disabled` (PDF indisponible, reste de l'API intact).

Aucun retour automatique à une exécution non sandboxée n'existe en production (`disabled` y est refusé).

## 4. Proposition SEC-PDF-02B (non réalisée, autorisation CTO requise)

Si le chemin Docker est confirmé :
- `RUN addgroup -S pdf && adduser -S -G pdf pdf` puis `USER pdf` dans `backend/Dockerfile` ; `chown` de `/app` limité aux répertoires d'écriture (stockages montés) ;
- vérifier la sandbox du Chromium Alpine (espaces de noms ou `chromium` setuid sandbox) ; dans Docker, le profil seccomp par défaut peut bloquer `clone(CLONE_NEWUSER)` : prévoir un profil seccomp adapté plutôt que `--privileged` ;
- `/dev/shm` suffisant (`shm_size`) ;
- exécuter `verify:sec-pdf-02` dans l'image.

Architecture cible (proposition) : exécuter le rendu PDF dans un processus ou service séparé, sans secrets applicatifs dans son environnement (`DATABASE_URL`, `JWT_SECRET`), alimenté uniquement par le HTML déjà construit.

Moteur LOT 5 : appliquer la même politique (`buildChromiumLaunchOptions`) après autorisation.
