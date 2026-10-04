# ADMIN-07 — Replay final et clôture du chantier Administration

**Statut : DRAFT / HOLD — PAS READY — PAS MERGE**

**Verdict : ADMINISTRATION CLOSED** (sous réserve CI GitHub sur cette PR)

Base obligatoire : `develop@62334bacf346ad1f6efb9af96b52ebfe0ef2bb8f` (merge #870)

Lot **AUDIT-ONLY**. Aucune modification fonctionnelle. Aucune migration.
Aucune correction produit. `#851` et `#859` restent Draft — **ne pas merger**.

Preuves machine :

- `docs/audits/evidence/admin07-final-matrix.json`
- `docs/audits/evidence/admin07-851-closure.json`
- `docs/audits/evidence/admin07-859-closure.json`
- `backend/lib/admin07AdministrationReplay.test.js` (A07-01 → A07-36)
- `web/src/lib/admin07AdministrationReplay.audit.test.ts`

---

## 0. Chaîne mergée (ne pas rouvrir)

| Lot | PR | Merge SHA | Objet |
|---|---|---|---|
| ADMIN-01 | #853 | `2a1df064` | Droits effectifs, pas de DENY fantôme, reset override |
| ADMIN-02 | #858 | `2ba3c7d7` | Édition rôles + historique RBAC |
| ADMIN-02B | #861 | `46a91bfa` | `display_label` visuel only |
| ADMIN-02C | #870 | `62334bac` | Rôles et droits — matrice complète tous modules sur une seule page |
| ADMIN-03B | #860 | `6752b539` | Relations school-only persist update/archive |
| ADMIN-04 | #862 | `841362e2` | Utilisateurs clôture |
| ADMIN-05A | #863 | `4fdc842e` | Documents metadata school-only |
| ADMIN-06A | #864 | `1eb0bb47` | Audit périmètre conformité |
| ADMIN-06B0 | #865 | `5666bac9` | Advanced reports tenant-isolated |
| ADMIN-06B1 | #866 | `6d3eab5a` | Conformité A1 plateforme non-PII |
| ADMIN-06B2 | #867 | `0604f44b` | Privacy + export établissement |
| ADMIN-06C | #868 | `ff367049` | Journal audit school-only |

Audits historiques **ouverts, Draft, ne pas merger** :

| PR | Branche | Recommandation ADMIN-07 |
|---|---|---|
| #851 | `audit/superadmin-rbac-rights` | **CLOSE WITHOUT MERGE** — superseded par ADMIN-01 → ADMIN-07 |
| #859 | `cursor/admin-03a-relations-scope-audit-94fc` | **CLOSE WITHOUT MERGE** — superseded par #860 + replays ADMIN-07 |

---

## 1. Matrice finale

Légende : **ALLOW** opérationnel · **DENY** interdit · **A1** projection plateforme non-PII · **SCHOOL** tenant JWT uniquement · **n/a** hors surface.

| Surface | SUPER_ADMIN | COUNTRY_ADMIN | SCHOOL_ADMIN | Autre rôle établissement | Tenant | PII | Autorité backend | Autorité Web | Statut final |
|---|---|---|---|---|---|---|---|---|---|
| Relations | DENY | DENY | SCHOOL | READ si token Relations | JWT école | nominatif | `platformPersonalDataGuard` + `assertSchoolScope` / `filterRows` | `canReadView("relations")` false plateforme | **CLOSED** A07-01→04, 27 |
| Utilisateurs | catalogue plateforme (admins) | pays (admins) | SCHOOL | selon Utilisateurs:READ | JWT / `users.school_id` | comptes | `resolveUsersSchoolScope` | `canReadView("users")` | **CLOSED** A07-28 · U04 |
| Rôles | ALLOW (sauf clés système) | DENY rename/archive système | DENY mutation catalogue | DENY | n/a | non | `establishmentRolesService` | PermissionsPage | **CLOSED** A02 / DL |
| Droits | ALLOW configuration. UX : Pays → Établissement → Rôle → tous les modules. Backend : PATCH batch `grants[]`. Concurrence : `expectedUpdatedAt`. Reset : par module. Dirty : multi-module conservé. | DENY reset | DENY écriture matrice | DENY | override école isolé | non | `functionalRbacService` PATCH `grants[]` | matrice unique `#870` | **CLOSED** A07-24→26 + A07-31→36 |
| Documents | DENY | DENY | SCHOOL metadata | CRUD si Documents:* | JWT école | titre / élève | `listSchoolDocuments` + guard | onglet masqué plateforme | **CLOSED** A07-05/06/29 |
| Conformité A1 | A1 non-PII | DENY | DENY | DENY | global compteurs | **aucun** | `assertPlatformComplianceRead` | `reports` Superadmin → A1 | **CLOSED** A07-20/21 |
| Privacy requests | DENY | DENY | SCHOOL | Utilisateurs:READ | JWT école | identifiant / email | `listSchoolPrivacyRequests` | SchoolComplianceDashboard | **CLOSED** A07-07→09 |
| Privacy execute | DENY | DENY | SCHOOL | DENY hors self | JWT école | exécution | `assertCanExecuteSchoolErasure` | A2 school-only | **CLOSED** A07-07/08 |
| Data export | DENY | DENY | SCHOOL + Paramètres READ/UPDATE | **DENY** (rôle obligatoire) | JWT école | snapshot | `assertDataExportRead` | `canReadView("dataExport")` | **CLOSED** A07-10→12 |
| Audit | DENY | DENY | SCHOOL + Audit:READ | **DENY** (rôle obligatoire) | JWT école | projection sans old/new/IP/UA | `assertSchoolAuditRead` | dashboard si Audit:READ | **CLOSED** A07-13→17 |
| Advanced reports | DENY | DENY | SCHOOL + Rapports:READ | si Rapports:READ | JWT école | agrégats tenant | `resolveAdvancedReportsSchoolId` | ReportsPage A2 | **CLOSED** A07-18/19 |

SUPER_ADMIN ne voit **aucune** donnée personnelle établissement via Relations, Documents, privacy, export, `GET /api/audit`, advanced reports. Il voit uniquement la projection **A1** (`GET /api/backoffice/platform-compliance`).

Aucun contournement par `ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES`, `schoolCode="*"`, query `schoolCode` — A07-19 / A07-30.

---

## 2. Mapping #851 → PR correctrices

Aucun constat **CLOSED** sans preuve actuelle sur `develop@62334bacf346ad1f6efb9af96b52ebfe0ef2bb8f`. Aucune preuve Droits ne porte sur l’ancien écran module-par-module.

| Constat initial #851 | PR correctrice | Test actuel | Statut |
|---|---|---|---|
| ROOT-1 / RED-01 GET configured ≠ effective | #853 + #870 | `functionalRbacAdmin01` GET configured · A07-24 · A07-32 | **CLOSED** |
| ROOT-2 / RED-01 UI page n’appelle pas `/effective` | #853 + #870 | `permissions.effective.test.ts` + ADMIN-01 + matrice unique | **CLOSED** |
| ROOT-3 / RED-01b / RED-02 / RED-04 PATCH substitutif / perte U/D | #853 + #870 | ADMIN-01 PATCH CREATE / inchangé · A07-34 grants[] | **CLOSED** |
| ROOT-4 cadenas vs matrice vide | #853 + #870 | ADMIN-01 hydratation + locks · A07-32/33 | **CLOSED** |
| RED-ADM-DROITS-RESET pas d’API reset | #853 + #870 | ADMIN-01 reset · A07-25 · A07-35/36 | **CLOSED** |
| CAP-SA-1/2/3 Superadmin ne paramètre pas sans écraser | #853 + #870 | ADMIN-01 · A07-31→36 | **CLOSED** |
| DROITS-HERITAGE UI D | #853 + #870 | ADMIN-01 source/inherited · A07-32 | **CLOSED** |
| RISK-DENY Enregistrer → DENY fantôme | #853 + #870 | ADMIN-01 PATCH inchangé · A07-34 | **CLOSED** |
| ROLES-LABEL-UI pas de formulaire libellé | #858 + #861 | A02-01 · DL-06 · A07-22/23 | **CLOSED** |
| GAP-SYS-ROLES verrou CRUD COUNTRY/SCHOOL (PR-2 optionnel) | — | A02-02→05 archive/rename protégés | **OUT-OF-SCOPE** (PR-2 jamais mandaté) |
| DROITS-AUDIT-UI pas d’écran journal | #858 historique RBAC + #868 journal école | A02-07→15 · C06C · A07-13→17 | **CLOSED** |
| RED-ADM-REL Superadmin Relations deny API / façade UI | #860 | R03B-07→11 · A07-01/02 | **CLOSED** |
| REL-HYDRATE / REL-NATURE onglet plateforme incohérent | #860 Option A | `admin03b…audit.test.ts` | **CLOSED** |
| REL-UPDATE pas de PATCH | #860 | R03B-03 · A07-03 | **CLOSED** |
| RED-ADM-REL-DELETE delete local | #860 archive persistée | R03B-04/13 | **CLOSED** |
| USERS-RESET-UI pas de refresh | #862 | U04-15 · `UsersPage.resetRehydrate` | **CLOSED** |
| USERS-CSV export client only | — | U04 matrix | **ACCEPTED** (pas un leak ; hors export serveur) |
| USERS-PENDING-SA / USERS-REASSIGN-SA école D | #862 by design | U04-07/13 | **ACCEPTED** |
| USERS-SUPER-CREATE interdit | déjà protégé + #862 | U04-05 | **CLOSED** |
| RED-ADM-DOC / DOC-TAB-VIEW Superadmin Documents | #863 | D05-01→04 · A07-05 | **CLOSED** |
| DOC-FILE pas d’upload/download | #863 contrat metadata-only | D05-17 | **ACCEPTED** |
| DOC-PARAMETRES gabarits bulletins | — | hors admin documents | **OUT-OF-SCOPE** |
| RED-ADM-CONF façade MVP Conformité | #864→#868 | C06A / C06B1 / C06B2 / C06C · A07-07→21 | **CLOSED** |
| CONF-ORPHAN-APIS APIs non branchées | #865 #866 #867 #868 | A07-07→21 | **CLOSED** |
| CONF-SA-AUDIT-DENY Superadmin audit deny | #868 conserve deny + journal école | A07-13 | **CLOSED** |
| RED-ADM-TABS onglets sans `canReadView` | #860 #863 #866 | `AdministrationLayout` filter · web A07 | **CLOSED** |

Sécurité déjà GREEN dans #851 (RED-05→10, invariants SUPER_ADMIN, isolation, PUT legacy 403) : **CLOSED** (non-régression `platformPersonalDataGuard` + `verify:functional-rbac`).

---

## 3. Mapping #859 → #860

| Constat initial #859 | PR correctrice | Test actuel | Statut |
|---|---|---|---|
| META-02 / REL-01 façade UI Superadmin/Country | #860 Option A | `admin03b…audit.test.ts` · A07-01/02 | **CLOSED** |
| MAT-01/11 tab toujours listé | #860 + `canReadView` | web A07 · AdministrationLayout | **CLOSED** |
| PII-01→05 Relations = données personnelles | #860 garde + school-only | A07-01→04 | **CLOSED** |
| MAT-05 / EP-02 / CUD-02 pas de PATCH | #860 PATCH persisté | R03B-03 | **CLOSED** |
| MAT-06 / EP-03 / CUD-03 delete local | #860 archive ; pas de DELETE physique | R03B-04/13 | **CLOSED** |
| MAT-07 / EP-04 archive parents only | #860 archive backoffice | R03B-04 | **CLOSED** |
| REL-06/09 isolation A≠B | #860 | R03B-06 · A07-04/27 · PG-R03B | **CLOSED** |
| REL-08/10 scope B / `*` fail-closed | #860 | R03B-12 · A07-27 | **CLOSED** |
| GUARD-01/02/03 ALL_PRIV / query | déjà + #860 | A07-30 · P0-2 | **CLOSED** |
| GUARD-04 latent Superadmin `filterRows` si guard retiré | — | guard toujours premier | **ACCEPTED** (défense en profondeur optionnelle, pas de fuite live) |
| GUARD-06 / UI-06 Relations ≠ Messages deny | #860 | `webSchoolDomainDeny` + canReadView | **CLOSED** |
| UI-03/04/05 allowlists + `canLinkParent` | #860 | web 03B audit | **CLOSED** |
| RISK-08 Contacts encore allowlist Superadmin | — | hors Relations | **OUT-OF-SCOPE** |
| OPT-C support tracé PII | interdit | non implémenté | **OUT-OF-SCOPE** (politique) |
| META-01 / ARCH-04 audit-only 03A | #859 reste Draft | ce document | **CLOSED** comme audit superseded |

---

## 4. Preuves

### Superadmin

- Relations / Documents / privacy list+execute / export / `GET /api/audit` / advanced reports → **403** (guard avant `some()`, service refuse aussi `schoolCode` spoof).
- A1 uniquement : `getPlatformCompliance` scope `platform`, payload sans identifiant / email / schoolCode.
- Console droits : hydratation effective + reset (#853) puis matrice complète tous modules (#870). Pays → Établissement → Rôle → 31 modules. Un PATCH `grants[]`. Reset par ligne, drafts dirty des autres modules conservés, `expectedUpdatedAt` rafraîchi. Rôles : rename métier + `display_label` visuel (#858/#861). Utilisateurs : catalogue plateforme, pas les dossiers élèves.

### Country

- Mêmes surfaces school-PII **DENY**.
- A1 **DENY** (`assertPlatformComplianceRead`).
- `canReadView(reports|relations|documents|dataExport)` false.

### SCHOOL_ADMIN

- Relations / Utilisateurs / Documents / Privacy : son établissement uniquement.
- Export : rôle `SCHOOL_ADMIN` **et** Paramètres READ/UPDATE exacts.
- Audit : rôle `SCHOOL_ADMIN` **et** `Audit:READ` exact. Module catalogue DENY-by-default.
- Advanced reports : tenant JWT uniquement.

### Cross-tenant A ≠ B

- Relations, utilisateurs, documents, privacy, export, audit, advanced reports : A ne lit pas B. Query `schoolCode` ignorée.

### Contournements

`ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES`, `schoolCode="*"`, query `schoolCode`, `display_label` — A07-19, A07-22, A07-23, A07-30.

---

## 5. Replay A07-01 → A07-36

| ID | Preuve | coveredBy |
|---|---|---|
| A07-01 | Superadmin Relations PII denied | R03B-07 |
| A07-02 | Country Relations denied | R03B-11 |
| A07-03 | School A Relations A only | R03B-01/02 |
| A07-04 | School A ne lit pas B | R03B-06 |
| A07-05 | Superadmin Documents denied | D05-02 |
| A07-06 | School documents own tenant | D05-06 |
| A07-07 | Superadmin privacy detail denied | C06A-09 / C06B2 |
| A07-08 | Country privacy denied | C06B2 |
| A07-09 | School privacy own tenant | C06B2-04 |
| A07-10 | Superadmin export denied | EX06B2 / C06B2-26 |
| A07-11 | non-SCHOOL_ADMIN export denied | EX06B2-01 |
| A07-12 | SCHOOL_ADMIN export own tenant | C06B2-24 |
| A07-13 | Superadmin audit denied | C06C-01 |
| A07-14 | Country audit denied | C06C-02 |
| A07-15 | SCHOOL_ADMIN sans Audit:READ denied | C06C-03 |
| A07-16 | SCHOOL_ADMIN + Audit:READ allowed | C06C-04 |
| A07-17 | Projection sans old/new/IP/UA | C06C-11 |
| A07-18 | Advanced reports A ≠ B | R06B0-03 |
| A07-19 | query override ne change pas tenant | R06B0-12 |
| A07-20 | A1 Superadmin non-PII | C06B1-08 |
| A07-21 | Country A1 denied | C06B1-05 |
| A07-22 | alias rôle n’altère pas roleKey | DL-11 / ADMIN-02B |
| A07-23 | display_label n’altère pas permission | DL-18 / U04-18 |
| A07-24 | override RBAC school | ADMIN-01 DENY |
| A07-25 | reset override | ADMIN-01 reset |
| A07-26 | deny par défaut | C06C-RBAC |
| A07-27 | relations cross-school denied | R03B-06 |
| A07-28 | utilisateurs cross-school denied | U04-02/14 |
| A07-29 | documents cross-school denied | D05-12 |
| A07-30 | ALL_PRIVILEGES ne contourne pas | P0-2 |
| A07-31 | plus de sélecteur Module fonctionnel | ADMIN-02C MATRIX-01 |
| A07-32 | Pays + établissement + rôle → matrice complète | ADMIN-02C MATRIX-02 |
| A07-33 | 31 modules du catalogue dans une seule table | ADMIN-02C MATRIX-03/04 |
| A07-34 | plusieurs modules dirty → un PATCH grants[] | ADMIN-02C MATRIX-06/07 |
| A07-35 | reset d’une ligne conserve les drafts dirty tiers | ADMIN-02C MATRIX-17A/17B |
| A07-36 | reset met à jour expectedUpdatedAt pour le PATCH suivant | ADMIN-02C MATRIX-18B |

PG replay (établissements A / B) — **réutilise** les suites existantes, pas de nouveau scénario :

`admin03bRelationsSchoolPersist.pg.test.js`, `admin04UsersClosure.pg.test.js`, `admin05aDocumentsSchoolOnly.pg.test.js`, `admin06b0AdvancedReportsTenant.pg.test.js`, `admin06b2SchoolCompliance.pg.test.js`, `admin06cSchoolAudit.pg.test.js`, plus RBAC `functionalRbacAdmin01.pg.test.js`.

---

## 6. Recommandations de clôture

Si ADMIN-07 PASS (cette PR Draft + CI) :

1. **CLOSE #851 WITHOUT MERGE** — audit initial superseded par ADMIN-01 → ADMIN-07.
2. **CLOSE #859 WITHOUT MERGE** — audit ADMIN-03A superseded par #860 et les replays ADMIN-07.
3. Ne pas Ready / ne pas Merge ADMIN-07 tant que le CTO n’a pas contrôlé le diff GitHub.
4. Chantier produit suivant (hors Administration) : **#857 Carte Élève / NFC-QR / impayés** (Draft séparé).

---

## 7. Non-régression obligatoire

`verify:functional-rbac` (ADMIN-01 → 02C → 06C + A07-01→36 + `platformPersonalDataGuard`) · MATRIX-01→24 + 17A/17B + 18A/18B/18C · PG correspondants · Web lint · Web typecheck · Web build.

Aucune migration. Aucun fichier produit hors `docs/audits/`, tests de replay, `package.json`.
