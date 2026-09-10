# L1 Impayés — tests ROUGES métier + UX (aucune implémentation)

**Mandat :** RED uniquement. Aucun écran. Aucun GREEN. Aucun Ready. Aucun merge.  
**Base :** `develop@b0bcc277` (`feat/577-l1-mobile-unpaid-green`, L0 #580 déjà fusionné).  
**Branche :** `feat/577-l1-mobile-unpaid-green`  
**Source RED reportée :** `54fa2276` + durcissement `446f3dcb` (sans commits de tampon/preuve #581).

## Résultat machine

| Lot | GREEN | RED | Total | Exit tests |
| --- | --- | --- | --- | --- |
| L1 métier | **1/10** (`L1-10`) | **9/10** | 10 | 1 |
| L1 UX | **0/10** | **10/10** | 10 | 1 |

`L1-10` reste vert : 360/390/430 dp et cible 44 dp déjà conformes. Non forcé au rouge.

Preuve : `docs/audits/evidence/parite-l1-red-verify.json`  
Commande : `npm run verify:parite-l1-red`

Le vérificateur **échoue** si la baseline n'est pas exactement celle-ci (un seul RED restant ne suffit plus) :

- L1 failed = `L1-01…L1-09`
- L1 passed = `L1-10`
- L1-UX failed = `L1-UX-01…L1-UX-10`
- L1-UX passed = `∅`

`productionUntouched` est **calculé** via `git diff` contre `develop@b0bcc27799cc43bab74c7c1f23279b8897b5a5a8` + allowlist stricte. Il n'est plus écrit en dur.

SHA : `testedHead` = commit des tests ; `evidenceCommit` / `prHead` = commit de la preuve (tampon `--stamp-heads`). Ils peuvent différer si la preuve JSON est un commit suivant.

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
