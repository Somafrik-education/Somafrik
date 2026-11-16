# MIG-WORKERS-SEC-01 — Chaîne `@cloudflare/puppeteer`

Statut : AUDIT + CORRECTIF CIBLÉ / DRAFT / HOLD / NO MERGE.

Périmètre : `workers/mig-workers-poc-01` uniquement. Aucun changement du backend, du Web, du Mobile, des bases Supabase, ni déploiement Cloudflare. `npm audit fix --force` n'a pas été utilisé.

La base Git de la PR n'est pas `develop` (`a11ec568871209fc2282c7796a1350812e22ad39`). Le paquet n'existe pas sur `develop`. La PR part de la tête de la PR #1027, `38bbcb89d2d88fb9bc2aebda39000785abebf45a`, pour que le diff GitHub ne contienne que ce correctif. La PR #1027 reste en brouillon.

## 1. Sept alertes initiales

`npm audit` du lockfile d'origine, dépendances de production. 7 High, 0 Critical, 0 Moderate. `@cloudflare/puppeteer` était déjà en 1.4.0, dernière version stable publiée. Le correctif proposé par npm est une descente vers `0.0.11`. Il n'est pas retenu : c'est une régression majeure.

| Paquet | Version d'origine | Rôle | Avis |
|---|---|---|---|
| `@cloudflare/puppeteer` | 1.4.0, directe | High transitif | via `@puppeteer/browsers` |
| `@puppeteer/browsers` | 2.2.4, épinglée par Puppeteer | High transitif | via `extract-zip` et `proxy-agent` |
| `extract-zip` | 2.0.1 | avis propres | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) et [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3), traversée de liens symboliques, `<=2.0.1`, aucune version corrigée |
| `basic-ftp` | 5.3.1 | avis propre | [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r), déni de service CPU dans `Client.list()`, `<=6.2.0`, corrigé en 6.2.1 |
| `get-uri` | 6.0.5 | High transitif | via `basic-ftp`. La 8.0.1 dépend encore de `basic-ftp` `^5.3.1` |
| `pac-proxy-agent` | 7.2.0 | High transitif | via `get-uri` |
| `proxy-agent` | 6.5.0 | High transitif | via `pac-proxy-agent` |

Le point d'entrée Workers `puppeteer-cloudflare.js` n'importe pas `@puppeteer/browsers`. Cette dépendance sert au téléchargement local de Chromium, pas à `puppeteer.launch(binding)`.

## 2. Correctif retenu

Override npm, sans changer la version directe :

```json
"overrides": {
  "@cloudflare/puppeteer": {
    "@puppeteer/browsers": "3.2.6"
  }
}
```

`@puppeteer/browsers` 3.2.6 remplace `extract-zip` et `proxy-agent` par `modern-tar` 0.8.6. `proxy-agent` n'y est qu'une peer dependency optionnelle. Elle n'est pas installée. `basic-ftp`, `get-uri`, `pac-proxy-agent` et `extract-zip` sortent donc de l'arbre.

Les exports nommés que les lanceurs Node de Puppeteer 1.4 importent existent encore dans la 3.2.6 (`Browser`, `launch`, `computeExecutablePath`, `ChromeReleaseChannel`, etc.). Le bundle Wrangler ne contient pas ces modules.

## 3. État après correction

`npm ci` puis `npm audit --omit=dev` : 0 vulnérabilité. `npm audit` complet, devDependencies incluses : 0 vulnérabilité sur cet arbre.

| Alerte | Avant | Après | État |
|---|---|---|---|
| `@cloudflare/puppeteer` | 1.4.0 | 1.4.0 | close, la dépendance vulnérable a disparu |
| `@puppeteer/browsers` | 2.2.4 | 3.2.6 | close |
| `extract-zip` | 2.0.1 | absente | close par retrait. Pas de correctif amont |
| `basic-ftp` | 5.3.1 | absente | close par retrait. Le correctif amont 6.2.1 n'a pas été forcé |
| `get-uri` | 6.0.5 | absente | close |
| `pac-proxy-agent` | 7.2.0 | absente | close |
| `proxy-agent` | 6.5.0 | absente | close |

Inchangés : `express` 4.22.3, `pg` 8.23.1, `qs` 6.16.2, `wrangler` 4.155.0 (dev). Nouvelle dépendance de production : `modern-tar` 0.8.6, sans avis npm au 30 octobre 2026.

## 4. Options non implémentées

- Descente `@cloudflare/puppeteer` 0.0.11 : régression interdite.
- `@cloudflare/puppeteer` 1.5.0-rc.0 : retire `@puppeteer/browsers`, mais c'est une release candidate et une réécriture de puppeteer-core. Le chemin PDF réel n'est pas prouvé. À décider par le CTO avant toute adoption.
- Forcer `basic-ftp` 6.2.4 sous `get-uri` 8 : inutile tant que la peer optionnelle n'est pas installée. `get-uri` ne déclare toujours pas la ligne 6.2.1.
- Réécrire `src/pdf.js` sans la bibliothèque : refonte du POC, hors de cette PR.

## 5. Vérifications locales

Linux, Postgres jetable `somafrik_workers_poc` sur 127.0.0.1:5432, le 30 octobre 2026 (Europe/Paris).

- `npm ci` : 153 paquets, 0 vulnérabilité signalée à l'installation.
- `npm audit --omit=dev` : 0.
- `npm test` : 9 tests, 9 réussites, 0 échec. Le neuvième verrouille l'override, l'absence des cinq paquets retirés, Puppeteer 1.4.0 et `launch`.
- `wrangler deploy --dry-run --outdir /tmp/poc-bundle` : bundle produit, sortie avant envoi. Taille 1969,20 KiB, gzip 360,27 KiB. Le bundle contient `PuppeteerWorkers` et ne contient pas `extract-zip`, `basic-ftp`, `@puppeteer/browsers` ni `modern-tar`. Aucun déploiement.

Le workflow `MIG-WORKERS-POC-01` exécute désormais `npm audit --omit=dev` avant `npm test`.

## 6. Risque résiduel

`modern-tar` 0.8.6 n'a pas d'avis aujourd'hui et n'est pas dans le bundle Worker. Il ne sert que si un outil appelle l'installeur de navigateurs. Le POC ne l'appelle pas.

`@puppeteer/browsers` 3.2.6 n'est pas l'épingle 2.2.4 publiée par Cloudflare. Le point d'entrée Workers ne l'importe pas. Le téléchargement local de Chromium n'a pas été exécuté.

Si un futur `npm install` réinstalle la peer optionnelle `proxy-agent`, `basic-ftp` 5.x peut revenir. Le test `dependencyClosure` échoue si `extract-zip`, `basic-ftp`, `proxy-agent`, `get-uri` ou `pac-proxy-agent` réapparaissent dans le lockfile.

## 7. Recommandation

GO pour conserver cet override dans le POC en brouillon : les 7 High de production disparaissent sans descente de version et sans changer `puppeteer.launch`.

HOLD pour le merge vers `develop`, pour le passage Ready de la PR #1027, pour le déploiement Cloudflare, et pour l'adoption de `@cloudflare/puppeteer` 1.5.0-rc.0.

MIG-WORKERS-SEC-01 — CORRECTIF CIBLÉ / DRAFT / HOLD / NO MERGE.
