# Contrat d’implémentation — Lot 2 Attribution notes / présences + T1 ACK

**ID lot :** `TEACHER-RECORD-LOT2-NOTES-ATTENDANCE-IDENTITY-ACK`  
**Type :** contrat documentaire — **aucun code dans cette PR**  
**Cadrage validé :** [`PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md`](./PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md) (PR #104)  
**Audit source :** [`AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md`](./AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md) — **C-05 CRITICAL** + **C-07 MAJOR** (T1)  
**Lot 1 clos :** PR #106 mergée `7931385a` (head `18a8832d`) — `T1_SERVER_SKIPS_ACK=DEFERRED_TO_LOT2`  
**Base :** `develop` @ `7931385a`  
**Date :** 2026-07-27  

| Élément | Statut |
|---------|--------|
| Lot 1 Identité Mobile | **CLOS TECHNIQUEMENT** |
| Contrat Lot 2 (ce document) | **SOUMIS** — attendre validation CTO explicite |
| Implémentation code Lot 2 | **INTERDITE** jusqu’à validation de ce contrat |
| Lot 3 | **INTERDIT** avant clôture Lot 2 |
| Migration / fusion historiques | **INTERDITES** |
| Voie 2 | **SUSPENDUE** |
| Cycle complet fiche enseignant | **NO-GO** |
| E1 | **NO-GO** |

> Rapport Cursor ≠ validation CTO.  
> Ce contrat fige **deux** portes indissociables du Lot 2 : (A) attribution exacte notes/présences ; (B) `identitySyncAck.skips[]` serveur (dette T1 Lot 1).  
> **Gouvernance (précédent Lot 1) :** aucun undraft / merge sans **revalidation CTO explicite** du head soumis — y compris après commits de correction sur la même PR.

---

## 0. Héritage Lot 1 (obligatoire)

| Dette / garantie | Statut |
|------------------|--------|
| Canon Mobile `TEACHERS-*` | VALIDÉ (Lot 1) |
| AC-M7 UI multi-twin stop | VALIDÉ (Lot 1) |
| Runtime Lot 1 HTTP/PG | VALIDÉ |
| `identitySyncAck.skips[]` sur réponse PUT | **REPORTÉ → Lot 2** — **OBLIGATOIRE ici** |

Le Lot 2 **ne peut pas** être déclaré clos sans fermer T1 serveur.

---

## 1. Objectifs du lot (gate unique)

### A — Attribution notes / présences (C-05)

1. **Supprimer** tout fallback `ORDER BY created_at LIMIT 1` / `findAnyTeacher` / « premier enseignant de l’école » pour rattacher un auteur pédagogique à une **note** ou une **présence**.
2. Résolution **exacte** uniquement :
   - clé stable fournie (`teacher_code` / `TEACHERS-*` / `TEACHER-*` historique) **scopée école**, et/ou
   - affectation active exacte (classe ± matière) lorsque le contrat métier l’exige pour le rôle.
3. Sinon : **refus structuré** `4xx` + `code` stable — **jamais** d’auteur inventé.
4. Non-régression : résolution exacte des **évaluations** (`EVAL_TEACHER_UNRESOLVED`) **préservée**.

### B — T1 `identitySyncAck.skips[]` (C-07 / dette Lot 1)

1. Exposer dans la réponse `PUT /api/backoffice/state` un ACK identité structuré, au minimum :

```json
{
  "identitySyncAck": {
    "skips": [
      {
        "code": "TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED",
        "userId": "…",
        "schoolCode": "…",
        "action": "noop"
      }
    ]
  }
}
```

2. Codes minimaux à remonter lorsqu’ils se produisent :
   - `TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED`
   - `TEACHER_HISTORICAL_MULTI_TWIN`
   - `TEACHER_LINK_AMBIGUOUS`
3. Les throws liés (`TEACHER_CANON_AMBIGUOUS` → HTTP 409) restent **inchangés**.
4. Clients : au minimum le champ est **présent et consommable** (Web et/ou journal opérateur) ; pas d’obligation UX complète hors Lot 2 si hors scope UI, mais **l’ACK serveur est non optionnel**.

Critères **AC-N*** + **AC-T1*** = **un seul gate** Lot 2 (non séparables pour clôture).

---

## 2. Non-objectifs (hors Lot 2)

| Hors scope | Motif |
|------------|-------|
| Matrice statuts / réactivation / affectations non actives | **Lot 3** |
| Migration / backfill `grades.teacher_id` / `TEACHER-*` | Interdit |
| Refonte complète fallback authz notes BO (hors C-05) | Ne pas élargir sans aval |
| UI Mobile notes (sauf si partage helper serveur) | Gate = backend |
| Réouverture V2.1 / voie 2 | Interdit / suspendue |

---

## 3. Causes racines et fichiers

### 3.1 Attribution (obligatoires)

| Fichier | Zones | Rôle |
|---------|-------|------|
| `backend/db/postgresRepository.js` | `findTeacherForGrade` (~4319–4366) | Fallback `ORDER BY created_at LIMIT 1` pour non-enseignant |
| `backend/db/postgresRepository.js` | `findTeacherForAttendance` (~4369–4394) | Même fallback |
| `backend/db/postgresRepository.js` | call sites notes/présences (~1147, ~1155, ~2957) + **seed** éventuel même pattern | Inventaire exhaustif en implémentation |
| `backend/lib/evaluationAttachment.js` | résolution teacher exacte | **Préserver** (non-régression) |

### 3.2 T1 ACK (obligatoires)

| Fichier | Zones | Rôle |
|---------|-------|------|
| `backend/services/userTeacherSyncService.js` | `syncTeachersFromUserAccounts` → `{ teachers, contacts, skips }` | Produit déjà `skips` |
| `backend/server.js` | `mergeScopedBackOfficeState` (~2849–2869) | **Aujourd’hui** : utilise `teacherSync.teachers` / `.contacts` ; **jette** `teacherSync.skips` |
| `backend/server.js` | `PUT /api/backoffice/state` (~1270–1274) | Pattern existant `response.syncAck` — **doit** aussi attacher `response.identitySyncAck = { skips }` (forme stable, même sans skip) |

**Exigence non négociable CTO :** le contrat Lot 2 **inclut obligatoirement** `identitySyncAck.skips[]` — suppression des fallbacks notes/présences **seule** ne suffit pas à clôturer le lot.

### 3.3 Probables / revue de diff

| Fichier | Motif |
|---------|-------|
| Clients Web consommant PUT state | Afficher / journaliser skips non fatals (amorçage T1 client) |
| Tests `evaluationAttachment.test.js`, authz notes | Non-régression |
| Garde CI grep anti-fallback | AC-N4 |

### 3.4 Explicitement hors touch

| Zone | Motif |
|------|-------|
| Matérialisation statut / assignments always `active` | Lot 3 |
| Mobile `userTeacherSync` (clos Lot 1) | Ne rouvrir que si régression |
| Migrations SQL | Interdit |

---

## 4. Comportement avant / après

### 4.1 Notes (`findTeacherForGrade`)

| Cas | Avant | Après Lot 2 |
|-----|-------|-------------|
| Principal Enseignant + affectation match | Teacher affecté | **Inchangé** |
| Principal Enseignant sans match | `null` / refus authz | **Inchangé** (pas de fallback) |
| Admin / direction + clé teacher résolue | Teacher exact | **Inchangé** |
| Admin / direction **sans** résolution | `ORDER BY created_at LIMIT 1` → **mauvais auteur** | **HTTP 4xx** + `GRADE_TEACHER_UNRESOLVED` (ou équivalent contractuel) — **pas** de 201 |

### 4.2 Présences (`findTeacherForAttendance`)

| Cas | Avant | Après |
|-----|-------|-------|
| Match / clé exacte | OK | OK |
| Non-enseignant sans résolution | Premier teacher école | **HTTP 4xx** + `ATTENDANCE_TEACHER_UNRESOLVED` |

### 4.3 Seed / chemins annexes

Tout chemin d’écriture note/présence qui invente un `teacher_id` via « premier de l’école » doit être **éliminé** ou **refusé** (même codes). Les `ORDER BY created_at LIMIT 1` **hors** résolution enseignant (ex. terms, admin seed unrelated) restent hors AC-N4 s’ils ne rattachent pas un auteur pédagogique — à **documenter** dans la revue de diff.

### 4.4 T1 ACK

| Cas | Avant | Après |
|-----|-------|-------|
| Sync produit `skips[]` | Calculé, **non renvoyé** | Présent dans `identitySyncAck.skips` de la réponse PUT **200** |
| `TEACHER_CANON_AMBIGUOUS` écriture liée | HTTP 409 + `code` | **Inchangé** |
| PUT sans skip | — | `identitySyncAck.skips` = `[]` ou objet présent vide (forme stable) |

---

## 5. Codes d’erreur structurés (attribution)

| Code | HTTP | Quand |
|------|------|-------|
| `GRADE_TEACHER_UNRESOLVED` | 400 ou 409 | Note : impossible de résoudre un enseignant déterministe |
| `ATTENDANCE_TEACHER_UNRESOLVED` | 400 ou 409 | Présence : idem |
| `EVAL_TEACHER_UNRESOLVED` | (existant) | Éval — **ne pas régresser** |

Le contrat d’implémentation code pourra figer 400 vs 409, mais **le code string et l’absence de 201 avec mauvais teacher** sont non négociables.

Comment l’opérateur admin fournit l’enseignant (champ obligatoire / sélection) : à préciser dans la PR code (UX minimale : refuser plutôt qu’inventer).

---

## 6. Critères d’acceptation

### Attribution

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-N1** | Admin/direction sans teacher résolu → erreur structurée, **pas** 201 | Runtime HTTP/PG |
| **AC-N2** | Enseignant + affectation exacte → 201, `grades.teacher_id` = canon attendu | Runtime |
| **AC-N3** | Présence : exact ou refus (même esprit) | Runtime |
| **AC-N4** | Garde CI : aucun fallback `created_at LIMIT 1` sur chemins resolve teacher grade/attendance | Gate obligatoire |
| **AC-N5** | Éval attachment exacte inchangée | Unit + runtime |

### T1 ACK

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-T1-01** | PUT provoquant skip (ex. multi-twin / ambiguous unrelated) → réponse contient `identitySyncAck.skips[]` avec `code` attendu | Runtime HTTP |
| **AC-T1-02** | PUT nominal sans skip → `identitySyncAck` présent (`skips: []` ou équivalent stable) | Runtime |
| **AC-T1-03** | Écriture liée ambiguë → toujours **409** `TEACHER_CANON_AMBIGUOUS` (non absorbée en skip) | Runtime |
| **AC-T1-04** | Non-régression Lot 1 Mobile (garde AC-G1 + unit Mobile) | CI |

### Non-régression / gouvernance

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-NR1** | Tests V2.1 sync identité backend verts | CI |
| **AC-NR2** | Aucune migration / fusion / backfill historique | Revue PR |

---

## 7. Preuve runtime obligatoire

| Champ | Valeur |
|-------|--------|
| Artefact | `docs/audits/evidence/teacher-record-fix-lot2-notes-attendance-runtime-results.json` |
| Environnement | Backend + PostgreSQL + harness |
| Scénarios min. | AC-N1, AC-N2, AC-N3, AC-N5, AC-T1-01, AC-T1-02, AC-T1-03 |
| Contenu | HTTP status, `code`, `grades.teacher_id` / absences, `identitySyncAck`, rows PG |
| Règle merge | **Aucun merge** code Lot 2 sans evidence **PASS** |

---

## 8. Garde anti-fallback (AC-N4) — obligatoire

Formulation :

> Toute résolution d’enseignant pour **note** ou **présence** via `ORDER BY created_at LIMIT 1`, `findAnyTeacher`, ou équivalent « premier teacher de l’école » fait **échouer** le gate Lot 2.

Couverture minimale : `backend/db/postgresRepository.js` (fonctions `findTeacherForGrade`, `findTeacherForAttendance` et call sites d’écriture associés).  
Allowlist : usages `created_at LIMIT 1` **non** liés à l’auteur pédagogique (à lister explicitement dans le script de garde).

---

## 9. Gate final Lot 2 = PASS

```
AC-N1 … AC-N5
+ AC-T1-01 … AC-T1-04
+ AC-NR1 / AC-NR2
+ garde anti-fallback obligatoire
+ runtime HTTP/PG
= PASS Lot 2
```

---

## 10. Séquence PR

| Étape | Nature | Condition |
|-------|--------|-----------|
| A | Validation CTO **explicite** de ce contrat | — |
| B | PR code Lot 2 (**Draft**) | Aval A — **pas avant** |
| C | Evidence runtime + gardes PASS | Avant undraft / merge B |
| D | Undraft + merge Lot 2 | CI + evidence + **revalidation CTO explicite du head** (pas de merge anticipé) |
| E | Contrat Lot 3 | **Seulement après** D |

**Rappel :** code Lot 2 **INTERDIT** avant A ; Lot 3 / voie 2 / E1 / cycle complet fiche enseignant restent **NO-GO** / suspendus.

---

## 11. Décision demandée au CTO

| Question | Attendu |
|----------|---------|
| Valider ce contrat Lot 2 (attribution **et** `identitySyncAck.skips[]`) ? | Oui / Ajuster |
| Autoriser ensuite la PR **code** Lot 2 ? | Seulement après validation contrat |
| Forme exacte ACK (`identitySyncAck` vs autre clé) ? | Trancher ici ou à la validation |

**Implémentation code :** **INTERDITE** jusqu’à validation explicite de ce contrat.
