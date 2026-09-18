# LOT 5 — preuves RED → GREEN (PARITY-023 / 024 / 033 / 060 Pédagogie)

Base : `develop@68077f5259797b07e1da0230c60b95fee7cd1afe`  
Branche : `cursor/lot5-pedagogie-ae6a`  
Mandat : #704 commentaire `#5737276694`

## Décision contrat canonique

- **PARITY-023** — Mobile conserve publications / snapshots / PDF / historique. Ajout lecture seule du workflow modèle. Conception, approbation, publication, correction, révocation restent Web-only.
- **PARITY-024** — Examens Mobile natifs sur `/exams` uniquement. Lifecycle selon RBAC live. Pas de `/backoffice/planning-exams`. Online-only, pas d'outbox.
- **PARITY-033** — Une seule formule : Maths 17,5 / Français 12 / générale 15,666… ; 16,4 interdit. Web Parent et Mobile branchés au moteur canonique, y compris filtre cours.
- **PARITY-060** — Stats classe Mobile = `classGradesStats` composé de `canonicalStudentGeneralAverage`. Même contrat Web.

## RED (base `68077f52`, avant mutation produit)

`npx --yes tsx --test scripts/lot5-parity.test.ts` → **5 fail / 0 pass**

- FAIL PARITY-023 : pas de section workflow, pas de `reportCardWorkflowApi`, pas de frontière Web-only
- FAIL PARITY-024 : `ExamsScreen.tsx` absent, aucun client `/exams`
- FAIL PARITY-033 : `displayedAverage = courseFilter ? kpis.average : canonical` ; Mobile sans filtre cours
- FAIL PARITY-060 : `classGradesStats.ts` absent
- FAIL gate CI : `test:lot5-parity` et job `LOT 5 parity` absents

Preuve brute : `/tmp/lot5-red.txt`

## GREEN (cette branche)

```
npm run test:lot5-parity
# scripts/lot5-parity.test.ts 5/5
# lot5PedagogyParity 5/5
# ParentChildGradesPanel + gradeBook Web 10/10
# evaluationsV2 + reportCardLot8 + canonicalAverageParity + documentsExams
npm --prefix Mobile run typecheck
```

- **PARITY-023** — `ReportCardsScreen` conserve publications/PDF/historique. Section « État du workflow bulletin » lecture seule via `GET /report-card/requests`. Hint Web-only. Parent/élève exclus. Scan zéro mutation.
- **PARITY-024** — `ExamsScreen` + client `/exams` list/get/create/patch/validate/cancel/archive. RBAC `examPermissions`. Dates `JJ-MM-AAAA`. Online-only, pas d'outbox, pas de `planning-exams`.
- **PARITY-033** — Web `displayedAverage` = `GradeBookService` uniquement. Mobile filtre « Tous les cours » / matières de l'élève actif. Dataset 17,5 / 12 / 15,67 ; 16,4 interdit. Reset filtre au changement d'enfant.
- **PARITY-060** — `classGradesStats` + `ClassGradesStatsScreen` : moyenne, meilleur, plus faible, réussite, classement, égalités, at-risk < 10, scope enseignant.
- Job CI `LOT 5 parity` dans Required, `needs` extensible (`lot5` n'est pas figé comme dernier).

STOP : Draft. Pas Ready. Pas merge. Pas LOT 6.
