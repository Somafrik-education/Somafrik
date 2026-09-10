# Lots 0 et 1 — tests rouges parité Web ↔ Mobile (PR #577)

**Passe :** HOLD CTO sur #578 — révision vérificateur 22/22, tests L1 neutres, UX maquette.  
**Lots livrés :** **L0** et **L1** seulement.  
**Correction applicative :** **NON**.  
**Backend / PostgreSQL / API / RBAC / isolation établissement :** **NON TOUCHÉS**.  
**Ready / merge :** **INTERDIT**.

| Élément | Valeur |
|---|---|
| SHA `develop` | `ec2b232e8cb0e6aae27ddac5b1b99a3c9c3596c3` |
| Audit de référence | PR **#577** |
| Nature | documentation + tests rouges Mobile uniquement |
| Contrat UX | `docs/audits/parite-l0-l1-ux-maquette.md` |

Les critères P0/P1 **ne sont pas réinventés**. Ils viennent de #577.

Recommandation CTO (future décision L1, **pas un test** ) : brancher le ledger canonique Web plutôt que de seulement retirer « Impayés ».

---

## 1. Décision CTO #577 (inchangée)

- `super_admin` / `country_admin` Web-only.
- L0 = retrait / masquage / non opérationnel — jamais construction Superadmin Mobile.
- L1 = brancher ledger **ou** retirer le libellé Impayés (les tests acceptent les deux).

---

## 2. Matrice L0 / L1

Inchangée quant aux écarts #577. Voir `docs/audits/parite-web-mobile-l0-l1-matrix.json`.

L0-04 Documents : **retrait, masquage ou état explicitement non opérationnel** (plus l’absence stricte du drawer).

---

## 3. Vérificateur 22/22

`Mobile/scripts/verify-parite-l0-l1-red.js` refuse exit 0 s’il manque **un seul** identifiant.

Il exige, pour chaque fichier :

- exit 1 ;
- `PARITE_RED_REPORT` JSON ;
- `failedIds` **exactement** `L0-01…L0-12` et `L1-01…L1-10` ;
- `passedIds` vide.

```bash
npm run test:parite-l0-l1-red       # TDD : exit 1
npm run verify:parite-l0-l1-red     # preuve 22/22 : exit 0
```

Preuve machine : `docs/audits/evidence/parite-l0-l1-red-verify.json`.

---

## 4. Neutralité L1

| Test | Si Impayés reste | Si Impayés est retiré |
|---|---|---|
| L1-01 | valeur = ledger école | passe |
| L1-05 | client unpaid **dans** `services/api` uniquement | passe (URL **non** exigée dans les écrans) |
| L1-09 | pas de `paymentStats.pending` | passe (le KPI **peut** disparaître) |
| L1-06 | 401 et 403 simulés → pas de `success` numérique | passe |
| L1-07 | API 200 scopée école A ≠ reçus école B | passe |

---

## 5. UX maquette (textuel)

Voir `docs/audits/parite-l0-l1-ux-maquette.md`. Pas de parité pixel. Viewports **360 / 390 / 430**, a11y KPI, placeholder distinct, 401/403 explicites.

---

## 6. STOP CTO

```text
SHA develop        : ec2b232e8cb0e6aae27ddac5b1b99a3c9c3596c3
Lots livrés        : L0 + L1 tests rouges (HOLD révisé)
Correction code    : NON
Plateforme         : NON TOUCHÉ
Ready / merge      : INTERDIT
Vérificateur       : 12/12 + 10/10 identifiants exacts
```
