# E2E-PREPROD-GLOBAL-01 — Résultats Web (`https://preprod.somafrik.app`)

**Statut : 0 parcours Web exécuté en préproduction.** Tous les scénarios W de `MATRICE-E2E-GLOBALE.md` sont **BLOCKED (BLK-AUTH)** : aucun compte de test n'est disponible.

| Élément | État | Nature de la preuve |
|---|---|---|
| Disponibilité | `GET /` → 200, `last-modified: 2026-11-17 11:13:29 UTC`, servi par Cloudflare | E2E préprod |
| Version déployée | Le SHA exact n'est pas exposé par le build Web. Le chunk `assets/UsersPage-C2E58jRW.js` contient le libellé « Le catalogue des rôles ne propose pas le rôle Administrateur d'établissement… », introduit par #1183 (`93f98e44`, actuel HEAD de `develop`). Donc Web ⊇ `93f98e44` | E2E préprod (empreinte du bundle) |
| SHA exact via Render | **BLOCKED (BLK-RENDER)** : clé API refusée (401) | — |
| Outillage | Playwright et Chromium disponibles dans la session ; réseau ouvert vers la préproduction | — |

**Observation (P3, amélioration) :** le Web n'expose pas de SHA de build. Exposer `RENDER_GIT_COMMIT` dans une balise `meta` ou un fichier `/version.json` permettrait de rattacher chaque recette Web à un SHA exact. Cela fait l'objet d'une proposition, pas d'un correctif dans cette PR.

Les 12 smokes Web manuels S01 à S12 déclarés PASS par le CTO restent la seule recette Web authentifiée connue. Ils ne sont pas repris comme preuves de cette campagne.

La couverture automatisée Web (Vitest, LOT 0–8) figure dans `RESULTATS-API-POSTGRESQL.md` §2. Elle **ne remplace pas** l'E2E UI.
