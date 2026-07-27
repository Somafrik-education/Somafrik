# Rapport d’audit Pré-E1 V2.2 — Caractérisation `PRE-E1-STUDENT-CODE-SCOPE`

**Type :** caractérisation (audit) — **aucune implémentation** · **aucun cadrage correctif**  
**Contrat :** [`CONTRAT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md`](./CONTRAT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md) (ACCEPTÉ CTO · PR #101 · `38ad6793`)  
**Base code :** `develop` @ `38ad6793`  
**Preuve machine :** [`evidence/pre-e1-v2-student-code-scope-results.json`](./evidence/pre-e1-v2-student-code-scope-results.json)  
**Commande :** `npm run verify:pre-e1-v2-student-code`  
**Date preuve :** 2026-07-27  

---

## 0. Mandat et limites

| Règle | Respect |
|-------|---------|
| Harness + preuve + rapport uniquement | ✅ |
| Correctif `student_code` / UNIQUE / migration / regen | ❌ absent |
| Cadrage correctif dans cette PR | ❌ absent |
| E1 | **NO-GO** |
| Preuves historiques V1 / HF / V2.1 | lecture seule |
| §0.1 UNIQUE ≠ anomalie automatique | appliqué |
| §0.2 SC-06 transfert isolé | appliqué |

---

## 1. Verdict factuel (portée & dette)

| Question | Verdict |
|----------|---------|
| Portée **PostgreSQL** de `student_code` | **Globale** — `UNIQUE (student_code)` confirmé ; pas de UNIQUE `(school_id, student_code)` |
| Portée **BO JSON** | Pas d’unicité inter-écoles sur `matricule` — doublon accepté en state |
| Comportement sync | Isolation via `STUDENT_TENANT_CONFLICT` (pas d’écrasement cross-tenant) |
| Fait de schéma UNIQUE | **Confirmé** (≠ anomalie à lui seul) |
| Dette `PRE-E1-STUDENT-CODE-SCOPE` au sens §0.1 | **MAJOR confirmée pathologique** — les **trois** démonstrations §0.1 sont réunies (demo2 par indices, avec contre-indice documenté) |

### 1.1 Application §0.1

| Démonstration | Résultat | Preuve |
|---------------|----------|--------|
| 1. Même code **légitimement produit** dans deux établissements | **Confirmé** | BO accepte `MAT-SHARED-V22-*` sur école A et B (SC-03) |
| 2. Code **non censé** être un identifiant global Somafrik | **Confirmé par indices** | Champ `matricule`, pas d’allocateur global, doublon BO inter-écoles ; **contre-indice** : défaut `contactRegistrySync` → `matricule = STUDENTS-*` |
| 3. Conflit → rejet / perte observable | **Confirmé** | Sync B → `STUDENT_TENANT_CONFLICT` ; **1 seule** row PG ; élève B absent de PG |

> Le fait UNIQUE seul ne constitue pas la dette. La pathologie retenue est le **conflit reproductible** entre production multi-établissements d’un même matricule et la contrainte globale + rejet sync.

---

## 2. Matrice Q1–Q7

| # | Classification | Synthèse |
|---|---------------|----------|
| **Q1** | **confirmé** | `UNIQUE (student_code)` globale ; pas de composite école |
| **Q2** | **confirmé** | Priorité `matricule ?? publicId ?? id` ; stable sur re-PUT |
| **Q3** | **confirmé** | Impossible deux `school_id` pour le même code → `STUDENT_TENANT_CONFLICT` |
| **Q4** | **confirmé** | Intra-école : convergence vers **1** row (`ON CONFLICT` même école) |
| **Q5** | **confirmé** | `grades.student_id` = UUID PG de l’école ; pas de résolution cross-tenant |
| **Q6** | **confirmé** | Même fiche : JSON `schoolCode` change ; PG **refuse** (`STUDENT_TENANT_CONFLICT`) ; `school_id` inchangé |
| **Q7** | **infirmé** | Parcours nominal contact : `id = matricule = student_code` (convergence) |

---

## 3. Matrice SC-01…SC-08

| ID | Classification | Mesure clé |
|----|---------------|------------|
| **SC-01** | **confirmé** | Introspection PG : `UNIQUE (student_code)` ; index `idx_students_school_search` non unique |
| **SC-02** | **confirmé** | 1 élève / 1 école → `student_code = resolveStableStudentCode(...)` |
| **SC-03** | **confirmé** | Inter-écoles : 1 row PG + `STUDENT_TENANT_CONFLICT` sur B |
| **SC-04** | **confirmé** | Intra-école 2 fiches → 1 row PG |
| **SC-05** | **confirmé** | PUT eval/notes 200 + POST `/api/notes` 201 ; 1 grade aligné |
| **SC-06** | **confirmé** | Élève **dédié** ; snapshot avant/après ; fixtures autres SC intactes ; **aucun nettoyage** |
| **SC-07** | **confirmé** | 2ᵉ enrollment autre année OK ; `student_code` inchangé |
| **SC-08** | **confirmé** | Double PUT sync → toujours 1 row |

### 3.1 SC-06 — transfert isolé (§0.2)

| Exigence | Observé |
|----------|---------|
| Élève dédié (école XFER) | Oui |
| Snapshot avant | JSON + PG école source |
| Tentative | Opération **(1)** seule : même fiche, `schoolCode` → école B (via superadmin) |
| Snapshot après | JSON : `schoolCode` = B ; PG : `school_code` = source ; reject `STUDENT_TENANT_CONFLICT` sur l’id dédié |
| Nettoyage | Aucun |
| Fixtures SC-02…05 | Intactes (`fixturesIntact=true`) |
| Opérations (2) / (3) | **Non exécutées** — explicitement non équivalentes |

**Effet SoT :** divergence JSON↔PG sur l’établissement après tentative de transfert par changement de `schoolCode` sur la même fiche.

---

## 4. Producteurs → `student_code` → références

```
Contact BO (linkContactToOperationalRecord)
  └─ défaut : matricule = publicId = id (STUDENTS-*)
PUT /backoffice/state (students[])
  └─ resolveStableStudentCode = matricule ?? publicId ?? id
       └─ materializeBackOfficeStudent
            └─ INSERT … ON CONFLICT (student_code) DO UPDATE
                 WHERE students.school_id = EXCLUDED.school_id
                 sinon STUDENT_TENANT_CONFLICT (409 / ACK rejected)

Notes : resolveStudentForGrade(studentId/code, schoolCode)
  └─ grades.student_id = UUID students.id (scopé école)
```

| Producteur | Rôle observé |
|------------|--------------|
| Création BO / contact | Génère `STUDENTS-*` ; `matricule` overridable |
| Sync PG | Écrit / met à jour sous UNIQUE global + garde école |
| Seed runtime | Codes `ELE-*` présents ; hors collision des scénarios dédiés |
| API notes | Résolution par code/UUID **scopée école** |

---

## 5. Collisions

| Type | Résultat |
|------|----------|
| Inter-écoles | **Confirmé** — rejet B, 1 row A |
| Intra-école | **Confirmé** — dédup / update même row |
| Transfert même fiche | **Confirmé** — JSON mute, PG bloque |

---

## 6. Synthèse dette (sans cadrage)

| Champ | Valeur |
|-------|--------|
| Dette | `PRE-E1-STUDENT-CODE-SCOPE` |
| Sévérité documentée | MAJOR |
| Verdict caractérisation | **MAJOR confirmée** au sens §0.1 (pathologie = conflit métier reproductible, pas le seul UNIQUE) |
| Demo2 | Indices + contre-indice `STUDENTS-*` — **arbitrage intention CTO** possible sans invalider demo1+demo3 |
| Correctif / cadrage | **NON inclus** · **NON autorisé** dans cette PR |
| UNIQUE / migration / regen | **INTERDITS** |
| E1 | **NO-GO** |
| Suite | Décision CTO : valider la caractérisation · autoriser ou non un **cadrage correctif séparé** |

---

## 7. Livrables de cette PR

| Livrable | Chemin |
|----------|--------|
| Harness | `scripts/verify-pre-e1-v2-student-code-scope.js` |
| npm | `verify:pre-e1-v2-student-code` |
| Preuve machine | `docs/audits/evidence/pre-e1-v2-student-code-scope-results.json` |
| Rapport | ce fichier |

---

**Fin du rapport V2.2 — caractérisation uniquement · pas de cadrage correctif · E1 NO-GO.**
