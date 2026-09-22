# Lot 0 — Progressive disclosure Mobile (GO CTO)

**Date :** 2026-09-11  
**Branche :** `cursor/mobile-pd-lot0-contract-0920`  
**Base :** `develop`  
**PR d’audit #597 :** reste Draft — **ne pas fusionner** comme PR d’implémentation.

## Décisions figées

- Contrat adopté : [docs/ux/progressive-disclosure-mobile.md](../ux/progressive-disclosure-mobile.md) (DO-047, P-011, AP-013)
- Option A Notes : `Saisir` / `Consulter` visibles carte fermée
- Appel : pas d’accordion sur les 4 statuts
- Messages : fil + modal
- PED-L3-12 : amendement **reporté au lot Évaluations** (avant `TeacherGrades`)
- Pas de réactivation AdminCrud / Menu / notifications plateforme

## Preuves machine

```bash
npm --prefix Mobile run test:progressive-disclosure-ux      # verts (îlots déjà conformes)
npm --prefix Mobile run verify:progressive-disclosure-red   # PD-01…PD-07 encore ROUGES
```

Aucun écran métier modifié dans ce lot.
