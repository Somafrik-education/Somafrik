# G0 — Freeze & baseline GO Production — 2026-09-19

**Lot :** G0 (gouvernance + inventaire). **Aucun merge `main`. Aucun deploy. Aucun EAS / Play / Render write.**  
**Chantier maître :** [#720](https://github.com/Somafrik-education/Somafrik/issues/720)  
**Contrat :** [../project/GO-PRODUCTION.md](../project/GO-PRODUCTION.md)  
**Observation git :** `git fetch origin develop main` le 2026-09-19.

| | |
|---|---|
| Baseline gelée (#720 / #719) | `develop@afa01321a42df3cfe825a789fc1a948ea0bf1e4c` |
| Tip `origin/develop` observé | `e457934f772ac2d509225ebd6cf12ad95b51215a` — *Merge pull request #717* |
| Tree `develop` | `ef3b4c2850e02784769fd479a30b0545bd9cea75` |
| Tip `origin/main` observé | `9f4badc61e2ecee2b7564da1dec3acc8d6c5c518` — *Merge pull request #674 — PROD-DEMO /demo* |
| Tree `main` | `495e26ca1ec10f307e85c17a923a23157b032339` |
| Merge-base | `5832882d908207da4ad3270370e2e312ff619102` |
| Ahead / behind (`main`…`develop`) | **15 main-only / 740 develop-only** |
| PR `develop → main` ouverte | **aucune** |
| Décision G0 | **HOLD** — freeze posé ; G1 **livrée #722 mais HOLD** ; GO Production interdit ; **aucune G8** |

La baseline d’ouverture #720 reste `afa01321…`. `origin/develop` a ensuite avancé par le merge P0 **#717** (`e457934f…`). Drift **autorisé** (correctif RC1), pas une feature.

---

## 1. Verdict

**HOLD.** G0 = contrat + photographie. Ce lot ne qualifie pas une RC, ne déploie rien et ne lève aucun blocker runtime.

G1 / #719 a été livrée : PR **#722** — **HOLD confirmé CTO**.  
P0 **#717 HelpHost** : **MERGED / CLOSED** sur `develop@e457934f`.  
P0 restant : **#645**. P1 restants : **#646**, **#503**. **G2 interdite.** **Aucune G8.**

---

## 2. `develop` vs `main` (git réel)

`main` n’est plus le snapshot juillet 2026 décrit dans l’audit Lot G du 2026-09-01 (`b5074565…`). Il porte désormais un historique production distinct (promotions `develop → main`, AAB #503, conformité #509, entrée `/demo` #674).

Les 15 commits `main`-only **ne sont pas** classés « stale snapshot à écraser ». Un futur merge `develop → main` exigera un audit dédié (G2+ / USER GO), pas un fast-forward aveugle.

`git merge-tree` sur le merge-base courant : **20 marqueurs de conflit**. Stratégie **non exécutée** ici. Interdit : `reset --hard` / force-push de `main`.

### Commits `main`-only (inventaire, pas de classification de fusion)

| SHA | Sujet |
|-----|--------|
| `9f4badc6` | Merge #674 — PROD-DEMO `/demo` |
| `57f00751` | ci(main): ignore exact historical Firebase client config fingerprint |
| `c102e253` | feat(prod-demo): promote controlled `/demo` entry from main |
| `ff5ae388` | Merge #509 — compliance runtime regions |
| `48e47f47` | docs(compliance): Data Safety v20 reaudit complete |
| `14920f68` | docs(compliance): final AAB v20 Data Safety audit |
| `fa37ece5` | fix(compliance): processor register / live regions |
| `8056569f` | fix(compliance): live transfer evidence regions |
| `8c337c47` | fix(compliance): public privacy regions |
| `17a9bfba` | Merge #507 — EAS production AAB #503 |
| `94da32bd` | ci(release): build EAS AAB production contrôlé |
| `b91cf514` | Merge #506 `develop` → `main` |
| `f0cda3c3` | Merge #502 `develop` → `main` |
| `fb37b9c3` | release(prod): promouvoir develop (#500 / #501) |
| `33d4ddc3` | release(prod): promouvoir develop après audit final |

---

## 3. Protections / rulesets (observable)

| Ruleset | Cible | Enforcement |
|---------|-------|-------------|
| `develop` id `19008211` | `refs/heads/develop` | **disabled** |
| `main` id `19007889` | `refs/heads/main` | **disabled** |

Inchangé depuis le Lot G 2026-09-01 : les required checks GitHub **ne sont pas enforced**. Le filet vivant reste la convention CTO (PR Gates, commentaires, diff indépendant). À traiter avant G7, pas dans G0.

---

## 4. Versions / metadata (constat)

| Surface | Valeur |
|---------|--------|
| Mobile `app.json` | `1.2.1` / versionCode **13** |
| `Mobile/package.json` | `1.2.1` (aligné `app.json`, contrairement au constat Lot F du 01/09) |
| `web/package.json` | `1.0.0` |
| `backend/package.json` | `1.0.0` |
| root `package.json` | pas de `version` |

---

## 5. État produit figé dans la baseline

| Item | État |
|------|------|
| Parité Web ↔ Mobile LOT 0–8 | **CLOSED GLOBAL** — [web-mobile-parity-final-2026-09-19.md](./web-mobile-parity-final-2026-09-19.md) ; #704 historique, ne pas merger |
| Dernière mutation parité | merge #718 (PARITY-082) puis rapport #716 |
| Freeze release 2026-09-01 | **LIFTED** (historique) — [release-governance-goprod-2026-09-01.md](./release-governance-goprod-2026-09-01.md) |
| Nouveau freeze | **G0 2026-09-19** — ce document |

---

## 6. PR ouvertes — hors freeze (ne pas merger sans mandat)

Observées le 2026-09-19. Aucune n’est la PR G0 / G1.

| PR | Titre | Draft |
|----|--------|-------|
| #717 | HelpHost startup navigation crash | oui |
| #715 | Clôture audit parité LOT 0–8 (docs) | oui |
| #685 | GREEN-B Affectations / Présences | oui |
| #670 / #668 / #663 | DEMO-DATA / DEMO-0 | oui |
| #648 / #647 | Web Push / Mobile Push | oui |
| #610 | branding audit | oui |
| #597 | progressive disclosure audit | oui |
| #588 | FIN-L3-06 encaissement | **non** |
| #582 / #581 / #577 | Impayés / parité historique | oui |
| #576 / #574 | isolation Parent / Présences | oui |
| #573 / #571 | notifications / Superadmin users | oui |
| #449 | inventaire `contact@somafrik.app` | non |
| #355 / #354 | RC3 SQLCipher / appel physique | oui — **OUT_OF_RELEASE** (héritage Lot G) |
| #312 / #298 / #297 / #295 | historiques CTO | oui — hors release |

Branches vides déjà poussées (tip = baseline, **pas** de PR) :

- `cursor/go-production-governance`
- `cursor/release-rc1-readiness`

Cette PR G0 utilise `cursor/go-production-gouvernance-090d`. G1 doit rester sur le mandat #719, pas se mélanger ici.

---

## 7. Issues — nouveau chantier vs historique

| Issue | Rôle |
|-------|------|
| **#720** | Chantier maître GO Production 2026-09-19 |
| **#719** | Phase G1 RC1 |
| #427 | Control plane GP-00x d’**un cycle antérieur** — ne pas traiter comme G0–G7 |
| #481 | G6 Render d’**un cycle antérieur** (`main@c4dd750d…`) — ne pas traiter comme le G6 de #720 |

---

## 8. Blockers hérités (non levés par G0)

Repris comme **dette à revalider en G1–G7**, pas comme preuve actuelle :

1. Rulesets `main` / `develop` disabled.
2. Graphe `develop` vs `main` non fast-forward (15 + 740, 20 conflits `merge-tree`).
3. Runtime / DNS / device / Store : à re-prouver sur les SHA **de ce** chantier (les SHA du Lot G 01/09 sont périmés).
4. Confidentialité + suppression de compte : présentes sur le cycle prod historique ; G4 doit les **revalider**, pas les présumer.
5. RC3 #354 / #355 : toujours hors release sauf mandat CTO nouveau.

---

## 9. Interdits de ce lot

- Merge `main`
- Deploy préprod / prod, EAS, Play, Firebase write
- Exécution G1 (E2E / perf / sécu) dans cette PR
- Feature, refactor runtime, migration
- Seconde PR GO Production en parallèle
- Commentaire de merge basé uniquement sur ce document

---

## 10. Décision

**HOLD — G0 posé. G1 livrée mais HOLD. G2 interdite.**

Causes :

1. Le contrat #720 est versionné dans `docs/project/GO-PRODUCTION.md` (cette PR).
2. G1 **#722 est livrée** (`docs/release/RC1-*.md`) et **HOLD confirmé CTO** — ce n’est plus « pas de rapport ».
3. P0 / P1 de cette vague sont **requalifiés et non nuls** : #645 **P0** ; #646 / #503 **P1** ; #499 P2 ; #510 P3. #717 HelpHost = **CLOSED ON DEVELOP** (`e457934f`).
4. `main` a divergé ; aucune promotion n’est autorisée. **Aucune G8.**

`RELEASE_ENGINEERING_READY` = **non**.  
`GO PRODUCTION` = **non**.  
`GO RC1` = **non**.

**STOP — pas Ready, pas merge par l’agent.**
