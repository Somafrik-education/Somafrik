# Lots 0 et 1 — tests rouges parité Web ↔ Mobile (PR #577)

**Passe :** audit + tests rouges uniquement.  
**Lots livrés :** **L0** et **L1** seulement (PR #577 §4.11). Lots L2…L9 hors livraison.  
**Correction applicative :** **NON**.  
**Backend / PostgreSQL / API / RBAC / isolation établissement :** **NON TOUCHÉS**.  
**Ready / merge :** **INTERDIT**. STOP CTO avant implémentation.

| Élément | Valeur |
|---|---|
| SHA `develop` de cette passe | `ec2b232e8cb0e6aae27ddac5b1b99a3c9c3596c3` |
| Audit de référence | PR **#577** (Draft) — `docs/audits/parite-web-mobile-etablissement-2026-09-09.md` |
| SHA `develop` audité par #577 | `1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82` |
| Delta `develop` depuis #577 | merge #575 notes Parent — **hors L0/L1** |
| Nature | documentation + tests rouges Mobile. Aucun fichier `backend/`, `web/src/` métier, schéma PG |

Les critères P0/P1 et le contenu des lots **ne sont pas réinventés**. Ils sont repris tels quels de #577.

---

## 1. Décision CTO déjà figée par #577 (non rediscutée)

- `super_admin` et `country_admin` restent **Web-only**.
- Leur absence Mobile **n’est pas** un manque de parité.
- Les fonctions plateforme encore visibles sur Mobile sont classées **à retirer**, pas à construire (L0).

---

## 2. Matrice Lots 0 et 1 (écrans × capacités)

Source : matrice machine #577 + §4.11. Statuts **constatés à nouveau** sur `ec2b232e` (lecture de code, pas de runtime établissement).

### L0 — Hygiène Mobile (`L0-hygiene-hide-fail-closed-and-mvp`)

| Écran / surface | Capacité | Web | Mobile actuel | API | RBAC | Écart #577 | Priorité |
|---|---|---|---|---|---|---|---|
| Drawer Superadmin / Admin Pays | Établissements, abonnements, matrice, notifs plateforme, audit | A Web-only | A navigable (fail-closed / AdminCrud) | — | plateforme | **retirer-mobile** P1-13 | P1 |
| Accueil plateforme | KPI Pays / Établissements | A Web | KPI → `AdminCrud` | — | plateforme | **retirer-mobile** | P1 |
| `SchoolManagement` | Cartes schools / courses / assignments / paymentStatuses | Web canonique | → `AdminCrud` fail-closed | — | — | **fail-closed** P1-13 | P1 |
| Drawer school_admin | Documents | A `/school-documents` | `DocumentsScreen` MVP « Disponible » | **non consommée** | `Documents:*` `appliesMobile: true` | **fail-closed / MVP** P1-07 | P1 |
| Drawer school_admin | Rapports | C-MVP Web conformité | `ReportsScreen` compteurs cache local | aucune canonique | `Rapports:*` | **retirer-mobile** P1-08 | P1 |
| Stack live | Audit MVP | — | `AuditScreen` monté | — | — | **retirer-mobile** | P1 |
| Graphe live | `AdminCrud` | — | monté dès Teachers/Users/Payments | — | — | **fail-closed** P1-13 | P1 |
| `MenuScreen` | CTA AdminCrud / Documents / Rapports / Audit | — | fichier mort, CTA encore présents | — | — | **isoler** | P1 |

Hors lot L0 : **ne pas construire Superadmin Mobile**.

### L1 — Impayés + vérité KPI (`L1-unpaid-ledger-or-remove-kpi`)

| Écran / surface | Capacité | Web | Mobile actuel | API | RBAC | Écart #577 | Priorité |
|---|---|---|---|---|---|---|---|
| Accueil Comptable | KPI « Impayés » | ledger `GET /backoffice/finance/unpaid` | `paymentStats.pending` (reçus) | **contrat différent** | `Impayés:*` `appliesMobile: false` ; UI gate `Paiements:READ` | **absent-mobile + divergence sémantique** P1-04 | P1 / **P0-CAND** |
| Accueil Comptable | Navigation KPI | `/finances/impayes` | `navigate("Payments")` | reçus ≠ ledger | idem | **divergence** | P1 |
| `PaymentsScreen` | Carte « Impayés » | — | `paymentStats.pending` | reçus | `Paiements:READ` | **même sémantique fausse** | P1 |
| Relances | POST reminders | A si permission | **absent** | non consommé | `Impayés:CREATE` \| `Paiements:UPDATE` | **absent-mobile** | P1 |
| Erreur 401/403 unpaid | Pas de faux succès | toast / empty Web | KPI affiche le pending des **reçus** si `paymentsReady` | unpaid jamais appelé | — | **faux succès d’affichage** | P0-CAND |
| Isolation établissement | Scope principal | `financeHttpPrincipal` | unpaid API absente ; KPI = snapshot paiements | — | tenant PG | **API scopée non utilisée** | L1 (pas un P0 écriture #577) |

Hors lot L1 : **pas de PSP**.  
Question CTO #577 encore ouverte : **brancher le ledger** vs **retirer le mot « Impayés »** en attendant.

---

## 3. Tests rouges causaux

| Fichier | Lot | Cas (HEAD `ec2b232e`) |
|---|---|---|
| `Mobile/src/lib/pariteL0Hygiene.red.test.ts` | L0 | **12 / 12 rouges** (L0-01…L0-12) |
| `Mobile/src/lib/pariteL1UnpaidKpi.red.test.ts` | L1 | **10 / 10 rouges** (L1-01…L1-10) |

Preuve : `npm --prefix Mobile run verify:parite-l0-l1-red` → exit 0 (écarts encore présents).  
`npm run test:parite-l0-l1-red` → exit 1 (TDD).

Scénario causal L1-01 (reproductible hors HTTP) :

```text
Reçus établissement A : 2 × Payé, 0 pending
Ledger Web A : 3 élèves avec amountDue > 0
KPI Mobile actuel : « Impayés » = 0
Ledger Web : 3
→ faux « tout est payé »
```

L1-07 : reçu pending d’un élève hors ledger A vs 1 obligation école A — le KPI reçus ne peut pas égaler le ledger scopé.

Exécution (attendu **exit 1** tant que L0/L1 ne sont pas corrigés) :

```bash
npm run test:parite-l0-l1-red
```

Lots L2…L9 : **aucun** test ajouté (examens, relations, grilles, bulletins write, dossier, salles, deep-link, documents canoniques).

---

## 4. UX — sources utilisées (sans inventer la maquette absente)

Le fichier joint `somafrik-admin-content-screens-v2.html` **n’était pas présent** dans le workspace de cette passe. Aucun critère visuel n’a été inventé à partir de cette maquette.

Contrôles appliqués aux **seules** surfaces L0/L1, d’après :

- spec déjà versionnée `docs/mobile/UX_UI_MOBILE_V1.md` (viewports 320/360/390/412, cibles ≥ 44 dp, max 4 KPI, fail-closed permission) ;
- mandat de cette passe : **360 / 390 / 430 dp**, accessibilité, navigation, 401/403, faux succès, cross-tenant.

Écarts UX **bornés L0/L1** (tests L0-11, L0-12, L1-06, L1-10) :

- KPI Accueil cliquables **sans** `accessibilityRole` / `accessibilityLabel` (`RoleDashboardLayout`) ;
- **430 dp** absent de `UX_V1_VIEWPORTS` ;
- 401/403 unpaid jamais observés → le chiffre « Impayés » suit le succès des **reçus**.

La parité visuelle Web/Mobile **n’est pas** un critère (#577 §8 / mandat d’origine §8).

---

## 5. Ce qui n’a pas été modifié

- `backend/**` (routes unpaid, RBAC, PostgreSQL)
- `web/src/**` applicatif
- écrans / navigation / API Mobile de production
- catalogue `appliesMobile`
- CI générale (nouveau script npm seulement, non branché aux gates)

---

## 6. STOP CTO

```text
SHA develop        : ec2b232e8cb0e6aae27ddac5b1b99a3c9c3596c3
Lots livrés        : L0 + L1 tests rouges + matrice
Correction code    : NON
Plateforme         : NON TOUCHÉ
PostgreSQL / API   : NON TOUCHÉ
Ready / merge      : INTERDIT
Suite              : implémentation L0 puis L1 après validation CTO
                     (tests rouges d'abord déjà présents)
```

Questions #577 toujours ouvertes, non tranchées ici :

1. L0 = retrait plateforme, jamais construction.
2. Impayés = brancher ledger **ou** retirer le KPI.
3. Documents/Rapports = retrait **ou** API (L0 retire l’apparence opérationnelle ; L9 reste hors passe).
4. `appliesMobile: true` pour planning / salles / remplacements / relations / frais / impayés — **hors L0/L1 UI**, sauf si L1 branche Impayés.
