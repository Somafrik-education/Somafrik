# LOT 10 — Qualification Burundi A/B des bulletins

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 11+ interdit.**  
**Ticket :** #651. **Prérequis :** LOT 9 mergé (`develop@609139c6445749ca14100ea1a06ebad1fa894bb7`).  
**Branche :** `cursor/report-card-lot10-burundi-ab-ce91`.

Qualification du moteur canonique `somafrik.report_card.v1` sur **deux configurations** (A = groupes / bulletin rose ; B = lignes TJ/EX/Total, EX N/A). Ce n’est **pas** un pack pays ni un second moteur.

Variations portées uniquement par les couches versionnées :

- `AcademicRuleProfile`
- `ReportCardSchema`
- `RenderingTemplate`
- fixtures de qualification + preuves

## Interdit

Branche `if/switch country|school|iso`, constantes Burundi dans `reportCardEngine`, duplication du moteur, fallback pays, mutation d’un profile/schema/template publié, LOT 11+, Finance/Scolarité/Users hors fixtures nécessaires.

## Hypothèses de qualification (documentées, pas du code moteur)

Les échelles `/20`, le seuil `PERCENTAGE` 50, les identifiants de groupes A et les matières EX N/A B (`TPA`, `RELIGION_MORALE`) viennent des fixtures LOT 0. Ce ne sont pas des règles `BI` dans le moteur.

Catalogue GREEN (fixtures uniquement, pas un pack pays) :

- `backend/lib/reportCard/reportCardQualification.js`
- `backend/lib/reportCard/qualification/model-a.json`
- `backend/lib/reportCard/qualification/model-b.json`

Gate : `npm run verify:report-card-lot10`.
