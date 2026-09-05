# Audit npm — 4 avis vus sur Render (5 septembre 2026)

**Contexte :** complément CTO #505. `npm audit --omit=dev` sur le workspace à `HEAD` du Draft.  
**Interdit :** `npm audit fix --force`. Aucun bump majeur dans ce lot.

Source lockfile Web (build Render Static Site) : `web/package-lock.json`.  
Backend `npm audit --omit=dev` : **0** avis (API Node).

## Synthèse

| Package | Sévérité npm | Advisory | Chemin | Version lock | Corrigée | Exploitabilité Somafrik | Recommandation |
|---|---|---|---|---|---|---|---|
| `nanoid` | high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) CWE-835 ; [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | `postcss` → `nanoid` (build Web) | **3.3.13** | **≥ 3.3.18** | Faible. Générateur bloqué si `size` ≤ 0 / négatif. Somafrik ne passe pas une taille attaquant-contrôlée à `nanoid` en runtime API. Chaîne **build** Vite/PostCSS. | Override `nanoid@3.3.18` **sans** `--force`, PR dédiée. Pas urgent pour l’API. |
| `postcss` | high (+ moderate résiduel) | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) path traversal `.map` ; [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) correctif incomplet | direct `web` (dev/build) + Tailwind | **8.5.16** | **≥ 8.5.23** | Faible en prod. L’exploit suppose un CSS attaquant avec `sourceMappingURL` pendant **le build**, `from` non défini. Le runtime Web/API ne parse pas de CSS utilisateur via PostCSS. | Bump `postcss` (devDependency Web) vers 8.5.23+. Pas `--force`. |
| `react-router` | moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) open redirect `\` ; [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) injection constructeur SSR `deserializeErrors` | `react-router-dom` → `react-router` | **6.30.4** | **7.18.0** (majeur) | Open redirect : `Link`/`navigate` avec `to` contrôlé par l’URL. Les `to` Somafrik sont surtout des constantes internes (`/etablissement/...` + `encodeURIComponent` d’ids). **Pas de SSR** (Static Site) → GHSA-337j **non applicable**. | Ne pas passer à React Router 7 dans ce chantier. Auditer tout `to={userInput}`. Patch 6.x s’il existe ; sinon dette versionnée. |
| `react-router-dom` | moderate | [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2) open redirect → XSS `6.30.2–6.30.4` | direct `web` | **6.30.4** | **≥ 6.30.5** (ligne 6) ou 7.18 | Même surface que ci-dessus : navigation interne. XSS si `to` ouvert sur un schéma externe via le bypass backslash. | Bump **mineur** `react-router-dom@6.30.5+` en PR dédiée, tests routes / login. Toujours pas `--force`. |

Les 4 lignes correspondent au résumé `npm audit --omit=dev` racine de cet environnement (2 moderate + 2 high agrégés sur ces paquets). Render affiche souvent le même graphe au **build Web**.

## Ce qui n’est pas fait ici

- Pas d’`overrides` dans ce Draft (évite un churn lockfile hors GO).
- Pas de React Router 7.
- Mobile/Expo : hors ces 4 avis Render Web.

`npm run audit:ci` continue de **bloquer uniquement critical**.
