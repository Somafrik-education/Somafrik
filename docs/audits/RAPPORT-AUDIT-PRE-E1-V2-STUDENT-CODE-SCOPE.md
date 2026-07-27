# Rapport d’audit Pré-E1 V2.2 — Caractérisation `PRE-E1-STUDENT-CODE-SCOPE`

**Type :** caractérisation (audit) — **aucune implémentation** · **aucun cadrage correctif**  
**Contrat :** [`CONTRAT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md`](./CONTRAT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md) (ACCEPTÉ CTO · PR #101 · `38ad6793`)  
**Base code :** `develop` @ `38ad6793`  
**Preuve machine :** [`evidence/pre-e1-v2-student-code-scope-results.json`](./evidence/pre-e1-v2-student-code-scope-results.json)  
**Commande :** `npm run verify:pre-e1-v2-student-code`  
**Date preuve :** 2026-07-27  
**Revalidation CTO classification :** 2026-07-27 — caractérisation technique **VALIDÉE** · MAJOR définitif **NON VALIDÉ**

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

## 1. Décision CTO — trois niveaux (obligatoire)

> Séparer **fait de schéma**, **effet technique** et **qualification métier**.  
> Ne pas confondre injection harness `MAT-SHARED-*` avec production nominale légitime.

### 1.1 Fait de schéma

| Item | Classification |
|------|----------------|
| `student_code` globalement unique en PostgreSQL | **CONFIRMÉ** |
| `UNIQUE (student_code)` | **CONFIRMÉ** |
| `UNIQUE (school_id, student_code)` | **ABSENT** |
| Portée PostgreSQL | **GLOBALE** |

### 1.2 Effet technique

| Item | Classification |
|------|----------------|
| Collision inter-écoles (même code, deux `school_id`) | **CONFIRMÉE** |
| Effet | `STUDENT_TENANT_CONFLICT` + **absence** de row PG pour le second établissement |
| Écrasement cross-tenant | **NON OBSERVÉ** |
| Collision intra-école | **Convergence** vers une row PG |
| Notes / `grades.student_id` (nominal) | **ALIGNÉS** |
| Transfert simulé même fiche (SC-06) | **Divergence JSON ↔ PG CONFIRMÉE** |
| Replay sync | **IDEMPOTENT** |
| Q7 divergence nominale d’identifiant | **INFIRMÉE** |

### 1.3 Qualification métier

| Item | Classification |
|------|----------------|
| Intention métier du matricule (local vs global Somafrik) | **INDÉTERMINÉE** |
| Incompatibilité métier « portée locale attendue » | **PROVISOIRE** |
| Sévérité globale | **MAJOR PROVISOIRE** |

**Pourquoi demo §0.1-2 n’est pas close :**  
le flux nominal contact produit `matricule = STUDENTS-*` (identifiant technique à allure **globale**). L’acceptation BO de deux valeurs **injectées** identiques (`MAT-SHARED-*`) prouve une **absence de garde BO**, pas qu’une telle collision soit une situation métier **légitime** attendue. Une preuve complémentaire indépendante est requise (voir §8).

### 1.4 Verdict global (formulation CTO)

> **`PRE-E1-STUDENT-CODE-SCOPE` — portée globale et conflit inter-écoles confirmés ; incompatibilité métier et sévérité MAJOR provisoires.**

| Statut | Décision |
|--------|----------|
| Caractérisation technique | **VALIDÉE** |
| Verdict MAJOR définitif / pathologique | **NON VALIDÉ** |
| Undraft / merge PR #102 | **NON AUTORISÉS** en l’état tant que la formulation antérieure n’est pas corrigée (cette révision) ; merge ultérieur = arbitrage CTO |
| Correctif / cadrage | **INTERDITS** |
| E1 | **NO-GO** |

---

## 2. Application §0.1 (relecture CTO)

| Démonstration | Résultat | Lecture |
|---------------|----------|---------|
| 1. Même code **légitimement** produit dans deux établissements | **Non établi** | SC-03 montre injection + absence de garde BO ; **≠** producteur nominal légitime |
| 2. Code **non censé** être un identifiant global Somafrik | **Indéterminé** | Indices ambigus ; contre-indice fort : défaut `STUDENTS-*` |
| 3. Conflit → rejet / perte observable | **Confirmé** | `STUDENT_TENANT_CONFLICT` ; 1 row PG ; élève B absent |

→ Les trois démonstrations **ne sont pas** réunies → **pas** de « MAJOR confirmée pathologique ».

---

## 3. Matrice Q1–Q7

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

## 4. Matrice SC-01…SC-08

| ID | Classification | Mesure clé |
|----|---------------|------------|
| **SC-01** | **confirmé** | Introspection PG : `UNIQUE (student_code)` ; index non unique école |
| **SC-02** | **confirmé** | 1 élève / 1 école → `student_code = resolveStableStudentCode(...)` |
| **SC-03** | **confirmé** *(effet technique)* | Inter-écoles : 1 row PG + `STUDENT_TENANT_CONFLICT` sur B — **sans** conclure à la légitimité métier du doublon |
| **SC-04** | **confirmé** | Intra-école 2 fiches → 1 row PG |
| **SC-05** | **confirmé** | PUT eval/notes 200 + POST `/api/notes` 201 ; 1 grade aligné |
| **SC-06** | **confirmé** | Élève **dédié** ; snapshot avant/après ; fixtures intactes ; **aucun nettoyage** |
| **SC-07** | **confirmé** | 2ᵉ enrollment autre année OK ; `student_code` inchangé |
| **SC-08** | **confirmé** | Double PUT sync → toujours 1 row |

### 4.1 SC-06 — transfert isolé (§0.2)

| Exigence | Observé |
|----------|---------|
| Élève dédié (école XFER) | Oui |
| Snapshot avant | JSON + PG école source |
| Tentative | Opération **(1)** seule : même fiche, `schoolCode` → école B |
| Snapshot après | JSON : `schoolCode` = B ; PG : école source ; `STUDENT_TENANT_CONFLICT` sur l’id dédié |
| Nettoyage | Aucun |
| Fixtures SC-02…05 | Intactes |
| Opérations (2) / (3) | **Non exécutées** — non équivalentes |

---

## 5. Producteurs → `student_code` → références

```
Contact BO (linkContactToOperationalRecord)
  └─ défaut : matricule = publicId = id (STUDENTS-*)   ← allure d’identifiant global
PUT /backoffice/state (students[])
  └─ resolveStableStudentCode = matricule ?? publicId ?? id
       └─ materializeBackOfficeStudent
            └─ ON CONFLICT (student_code) … WHERE school_id = EXCLUDED.school_id
                 sinon STUDENT_TENANT_CONFLICT

Notes : resolveStudentForGrade(…) → grades.student_id = UUID students.id (scopé école)
```

| Producteur | Rôle observé |
|------------|--------------|
| Création BO / contact | Génère `STUDENTS-*` ; `matricule` overridable (sans unicité BO inter-écoles) |
| Sync PG | UNIQUE global + garde école |
| Seed | `ELE-*` ; hors collision des scénarios dédiés |
| API notes | Résolution scopée école |

---

## 6. Collisions (effet technique uniquement)

| Type | Résultat |
|------|----------|
| Inter-écoles | **Confirmé** — rejet B, 1 row A |
| Intra-école | **Confirmé** — dédup / update même row |
| Transfert même fiche | **Confirmé** — JSON mute, PG bloque |

---

## 7. Synthèse dette (sans cadrage)

| Champ | Valeur |
|-------|--------|
| Dette | `PRE-E1-STUDENT-CODE-SCOPE` |
| Sévérité documentée (historique) | MAJOR |
| Sévérité retenue (CTO) | **MAJOR PROVISOIRE** |
| Verdict | Portée globale + conflit inter-écoles **confirmés** ; incompatibilité métier **provisoire** |
| Intention matricule | **Indéterminée** |
| Correctif / cadrage | **INTERDITS** |
| UNIQUE / migration / regen | **INTERDITS** |
| E1 | **NO-GO** |

---

## 8. Preuve complémentaire acceptable (hors cette révision)

Pour lever le caractère **provisoire** de la MAJOR / incompatibilité métier, **au moins un** des éléments suivants :

1. Deux établissements générant **naturellement** le même matricule via un **flux nominal** existant ;  
2. Une **règle métier** ou **contrat fonctionnel** définissant le matricule comme **local** à l’établissement ;  
3. Un **générateur** de matricules démontré comme **compteur local** non préfixé par l’école ;  
4. Un **import officiellement supporté** où les matricules sont explicitement locaux ;  
5. Une **documentation produit ou réglementaire** imposant la conservation d’un matricule local à l’onboarding.

> Une simple injection `MAT-SHARED-*` dans deux fixtures **ne suffit pas**.

---

## 9. Livrables de cette PR

| Livrable | Chemin |
|----------|--------|
| Harness | `scripts/verify-pre-e1-v2-student-code-scope.js` |
| npm | `verify:pre-e1-v2-student-code` |
| Preuve machine | `docs/audits/evidence/pre-e1-v2-student-code-scope-results.json` |
| Rapport | ce fichier |

---

**Fin du rapport V2.2 — caractérisation technique validée · MAJOR provisoire · pas de cadrage · E1 NO-GO.**
