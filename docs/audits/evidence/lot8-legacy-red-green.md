# LOT 8 — preuves RED → GREEN (PARITY-035 / 056 / 061 / 027 / 071)

Base : `develop@3cc55190736abd5d79d4128b35df7c74f38512e8`  
Branche : `cursor/lot8-legacy-parity`  
Mandat : #704 `#5742447318`  
HOLD : #714 `#5742558604`

Aucun ré-audit global final. Aucun LOT 9. Pas de recode LOT 0–7. Pas de calcul Finance / Notes.

## Tableau audit 704 → état actuel → live → gap → décision

| ID | Audit #704 | État `develop@3cc55190` | Références live | Gap résiduel | Décision LOT 8 |
| --- | --- | --- | --- | --- | --- |
| **PARITY-035** | GET `role-permissions` encore lu ; PUT interdit | PUT → `throwLegacyRolePermissionsWrite`. GET reste projection lecture. Web admin `/administration/permissions` = `rbacApi` (catalog / configured / patch). `domainLoaders.rolePermissions` + `platformApi.getRolePermissions` hydratent `state.rolePermissions` (fallback `resolveEffectivePermissions` + `applyRoleChangeToUser`). Mobile : aucun appel. | GET : `domainLoaders` / `platformApi`. PUT : tombstone. Canonique : `/rbac/*` + `/auth/effective-permissions`. | GET compat encore utile (matrice `string[]` pour création compte). Pas un consommateur mort. | **Conserver GET lecture.** Verrou PUT interdit. Admin = `rbacApi`. Mobile sans `/role-permissions`. Pas de réactivation PUT. |
| **PARITY-056** | Chemin paiements / résidu EntityPage | Après LOT 4 : Web `/finances/paiements` = **EntityPage live** + `financeApi.listPayments` / `FinancePaymentsOverview`. Frais / Impayés = pages dédiées. Mobile : `PaymentsScreen` + `UnpaidScreen` + `FeeGridsScreen` + `PaymentMutationControls`. `MobilePaymentScreen` = parent live. | EntityPage payments = UI Web canonique actuelle, pas un orphelin. | Pas de résidu générique remplacé. AdminCrud paiements hors graphe. | **Aucun code produit.** Ne pas extraire EntityPage. Ne pas toucher aux calculs Finance. |
| **PARITY-061** | Écrans Mobile morts | LOT 7 a déjà supprimé `PermissionsScreen`. Restent hors graphe : `AdminCrudScreen`, `MenuScreen`, `PlatformNotificationsScreen`, `SafeAdminCrudScreen`. HOLD : aucun consommateur live (navigator, drawer, tabs). Verifiers lisaient les fichiers pour prouver qu'ils étaient morts. | Aucun mount / deep-link. Contrats UX : `PD_DEAD_SCREENS` noms-only. | Fichiers morts + type `AdminCrud` orphelin. | **Suppression réelle** des 4 écrans + type `AdminCrud`. Verifiers → `existsSync === false`. `PD_DEAD_SCREENS` conserve les noms (jamais remonter). |
| **PARITY-027** | Dérive catalogues CRUD | Autorité : `backend/lib/functionalModulesCatalog.js`. Mobile `CANONICAL_CRUD_ENTITIES` = sous-ensemble mutation. Web `PermissionsPage` = `rbacApi.getCatalog()`. `CRUD_PERMISSION_MODULES` Web/Mobile = listes statiques divergentes. `getSuperadminMatrixModules` : aucun import live (PermissionsScreen Mobile déjà mort ; Web admin = rbacApi). `COUNTRY_SCOPE_MODULES` encore lu par `canReadView`. | Catalogue PG + `rbacApi`. `CANONICAL_CRUD_ENTITIES` mutations Mobile. | Listes statiques divergentes + helpers orphelins. | **Supprimer les catalogues statiques** `CRUD_PERMISSION_MODULES` Web/Mobile et `getSuperadminMatrixModules*`. Conserver `COUNTRY_SCOPE_MODULES` + `CANONICAL_CRUD_ENTITIES`. Catalogue : `role_permissions` Mobile=false ; `fees`/`unpaid` Mobile=true. |
| **PARITY-071** | `GradeBookService` Mobile mort | Fichier `Mobile/src/domain/academics/GradeBookService.ts` existant. Seul import : `getStudentAcademicSummary` dans `schoolMetrics.ts`, **jamais appelé** par un écran. Notes live = `canonicalStudentGeneralAverage` (LOT 5). | Aucun écran / deep-link. | Copie morte du moteur. | **Suppression nette** du fichier + helper mort. Pas de nouveau moteur. Formules LOT 5 / Web / backend inchangées. |

## RED (base `3cc55190`, avant mutation produit)

`npx --yes tsx --test scripts/lot8-parity.test.ts` → **2 fail / 4 pass**

- PASS PARITY-035 : GET compat + PUT interdit + admin `rbacApi`
- PASS PARITY-056 : EntityPage payments live ; Mobile canonique
- PASS PARITY-061 (1er passage) : Permissions déjà absent ; PD_DEAD hors graphe
- FAIL PARITY-027 (1er passage) : `role_permissions` encore Mobile=true ; `fees`/`unpaid` encore Mobile=false
- FAIL PARITY-071 : `GradeBookService.ts` + `getStudentAcademicSummary` encore présents
- PASS gate : `test:lot8-parity` + job `LOT 8 parity` dans Required extensible

## GREEN (1er passage `95e15d71`)

- Catalogue : `role_permissions` appliesMobile=false ; `fees`/`unpaid` appliesMobile=true.
- `Mobile/src/domain/academics/GradeBookService.ts` + `getStudentAcademicSummary` supprimés.
- Job CI `LOT 8 parity` dans Required, `needs` extensible.

## HOLD `#5742558604` → GREEN correction-only

- PARITY-061 : `AdminCrudScreen`, `SafeAdminCrudScreen`, `MenuScreen`, `PlatformNotificationsScreen` absents du disque ; type `AdminCrud` retiré ; verifiers en absence physique ; `PD_DEAD_SCREENS` noms-only (dont `SafeAdminCrudScreen`).
- PARITY-027 : `CRUD_PERMISSION_MODULES` et `getSuperadminMatrixModules*` supprimés (aucun consommateur live). `COUNTRY_SCOPE_MODULES` + `CANONICAL_CRUD_ENTITIES` conservés.
- PARITY-035 / 056 / 071 : aucun changement produit.

```
npm run test:lot8-parity
# scripts/lot8-parity.test.ts 6/6
```

STOP : Draft. Pas Ready. Pas merge. Pas ré-audit global.
