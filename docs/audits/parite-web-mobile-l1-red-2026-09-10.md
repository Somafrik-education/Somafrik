# L1 Impayés — tests ROUGES métier + UX (aucune implémentation)

**Mandat :** RED uniquement. Aucun écran. Aucun GREEN. Aucun Ready. Aucun merge.  
**Base :** HEAD #580 `feat/577-l0-mobile-hygiene` (tests L1 déjà présents, production L0 inchangée).  
**Branche :** `cursor/l1-unpaid-red-tests-8d64`

## Résultat machine

| Lot | GREEN | RED | Total | Exit tests |
| --- | --- | --- | --- | --- |
| L1 métier | **1/10** (`L1-10`) | **9/10** | 10 | 1 |
| L1 UX | **0/10** | **10/10** | 10 | 1 |

`L1-10` reste vert : 360/390/430 dp et cible 44 dp déjà conformes. Non forcé au rouge.

Preuve : `docs/audits/evidence/parite-l1-red-verify.json`  
Commande : `npm run verify:parite-l1-red`

## Production non modifiée

Aucun de ces fichiers n'est touché :

- `Mobile/src/screens/HomeScreen.tsx`
- `Mobile/src/screens/PaymentsScreen.tsx`
- `Mobile/src/navigation/AppNavigator.tsx`
- `Mobile/src/services/api.ts`
- aucun `UnpaidScreen.tsx`

## Non-régression

- L0 : 12/12 GREEN (`test:parite-l0-green`)
- aucun `skip` / exemption
- TypeScript Mobile : pas d'erreur sur les fichiers L1 ajoutés

## Hors-périmètre (non modifié)

- Relances / encaissement depuis Impayés
- Catalogue `appliesMobile` du module unpaid
- Backend / GET unpaid
- Maquette pixel / nouvel écran
