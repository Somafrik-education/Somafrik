# LOT 8 — preuves RED → GREEN (PARITY-035 / 056 / 061 / 027 / 071)

Base : `develop@3cc55190736abd5d79d4128b35df7c74f38512e8`  
Branche : `cursor/lot8-legacy-parity`  
Mandat : #704 `#5742447318`

Aucun ré-audit global final. Aucun LOT 9. Pas de recode LOT 0–7. Pas de calcul Finance / Notes.

## Tableau audit 704 → état actuel → live → gap → décision

| ID | Audit #704 | État `develop@3cc55190` | Références live | Gap résiduel | Décision LOT 8 |
| --- | --- | --- | --- | --- | --- |
| **PARITY-035** | GET `role-permissions` encore lu ; PUT interdit | PUT → `throwLegacyRolePermissionsWrite`. GET reste projection lecture. Web admin `/administration/permissions` = `rbacApi` (catalog / configured / patch). `domainLoaders.rolePermissions` + `platformApi.getRolePermissions` hydratent `state.rolePermissions` (fallback `resolveEffectivePermissions` + `applyRoleChangeToUser`). Mobile : aucun appel. | GET : `domainLoaders` / `platformApi`. PUT : tombstone. Canonique : `/rbac/*` + `/auth/effective-permissions`. | GET compat encore utile (matrice `string[]` pour création compte). Pas un consommateur mort. | **Conserver GET lecture.** Verrou PUT interdit. Admin = `rbacApi`. Mobile sans `/role-permissions`. Pas de réactivation PUT. |
| **PARITY-056** | Chemin paiements / résidu EntityPage | Après LOT 4 : Web `/finances/paiements` = **EntityPage live** + `financeApi.listPayments` / `FinancePaymentsOverview`. Frais / Impayés = pages dédiées. Mobile : `PaymentsScreen` + `UnpaidScreen` + `FeeGridsScreen` + `PaymentMutationControls`. `MobilePaymentScreen` = parent live. | EntityPage payments = UI Web canonique actuelle, pas un orphelin. | Pas de résidu générique remplacé. AdminCrud paiements hors graphe. | **Aucun code produit.** Ne pas extraire EntityPage. Ne pas toucher aux calculs Finance. |
| **PARITY-061** | Écrans Mobile morts | LOT 7 a déjà supprimé `PermissionsScreen`. Restent hors graphe : `AdminCrudScreen`, `MenuScreen`, `PlatformNotificationsScreen` (`PD_DEAD_SCREENS` + LOT 1/6 : ne pas remonter). `SafeAdminCrudScreen` = gate fail-closed lue par verifiers, jamais enregistrée. | Contrats / tests / verifiers exigent encore ces fichiers comme surface morte. | Pas de fichier sans route **et** sans contrat. | **Aucun fichier supplémentaire supprimé.** Inventaire + verrous d'absence au navigateur. |
| **PARITY-027** | Dérive catalogues CRUD | Autorité : `backend/lib/functionalModulesCatalog.js`. Mobile `CANONICAL_CRUD_ENTITIES` = sous-ensemble mutation (pas une 3e matrice). Web `SCHOOL_ENTITY_MODULES` = champs EntityPage. `role_permissions.appliesMobile=true` alors que l'écran Mobile a été retiré LOT 7. `fees` / `unpaid` `appliesMobile=false` alors que LOT 4 a monté `FeeGridsScreen` / `UnpaidScreen`. | Catalogue PG sync depuis le JS. Navigator Mobile : FeeGrids + Unpaid. | Drapeaux `appliesMobile` faux vs surfaces live. | **Aligner le catalogue** : `role_permissions` Mobile=false ; `fees`/`unpaid` Mobile=true. Pas de remount Permissions. Pas de 3e liste. |
| **PARITY-071** | `GradeBookService` Mobile mort | Fichier `Mobile/src/domain/academics/GradeBookService.ts` existant. Seul import : `getStudentAcademicSummary` dans `schoolMetrics.ts`, **jamais appelé** par un écran. Notes live = `canonicalStudentGeneralAverage` (LOT 5). | Aucun écran / deep-link. | Copie morte du moteur. | **Suppression nette** du fichier + helper mort. Pas de nouveau moteur. Formules LOT 5 / Web / backend inchangées. |

## RED (base `3cc55190`, avant mutation produit)

`npx --yes tsx --test scripts/lot8-parity.test.ts` → **2 fail / 4 pass**

- PASS PARITY-035 : GET compat + PUT interdit + admin `rbacApi`
- PASS PARITY-056 : EntityPage payments live ; Mobile canonique
- PASS PARITY-061 : Permissions déjà absent ; PD_DEAD hors graphe
- FAIL PARITY-027 : `role_permissions` encore Mobile=true ; `fees`/`unpaid` encore Mobile=false
- FAIL PARITY-071 : `GradeBookService.ts` + `getStudentAcademicSummary` encore présents
- PASS gate : `test:lot8-parity` + job `LOT 8 parity` dans Required extensible

## GREEN (cette branche)

```
npm run test:lot8-parity
# scripts/lot8-parity.test.ts 6/6
```

- Catalogue : `role_permissions` appliesMobile=false ; `fees`/`unpaid` appliesMobile=true.
- `Mobile/src/domain/academics/GradeBookService.ts` + `getStudentAcademicSummary` supprimés.
- Job CI `LOT 8 parity` dans Required, `needs` extensible.

STOP : Draft. Pas Ready. Pas merge. Pas ré-audit global.
