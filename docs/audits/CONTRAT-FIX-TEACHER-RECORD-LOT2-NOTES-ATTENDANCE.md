# Contrat d’implémentation — Lot 2 Attribution notes / présences + T1 ACK

**ID lot :** `TEACHER-RECORD-LOT2-NOTES-ATTENDANCE-IDENTITY-ACK`  
**Type :** contrat documentaire — **aucun code dans cette PR**  
**Cadrage validé :** [`PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md`](./PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md) (PR #104)  
**Audit source :** [`AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md`](./AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md) — **C-05 CRITICAL** + **C-07 MAJOR** (T1)  
**Lot 1 clos :** PR #106 mergée `7931385a` (head `18a8832d`) — `T1_SERVER_SKIPS_ACK=DEFERRED_TO_LOT2`  
**Base :** `develop` @ `7931385a`  
**PR contrat :** #107 (Draft)  
**Date :** 2026-07-27  

| Élément | Statut |
|---------|--------|
| Lot 1 Identité Mobile | **CLOS TECHNIQUEMENT** |
| Périmètre indissociable Lot 2 (notes/présences + `identitySyncAck.skips[]`) | **VALIDÉ DANS SON PRINCIPE** (CTO) |
| Contrat Lot 2 (ce document) | **CHANGES REQUIRED intégrés** — revalidation CTO sur **nouveau head** |
| Undraft / merge #107 | **INTERDITS** jusqu’à revalidation CTO + CI/Security verts |
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
2. Résolution **exacte** uniquement selon le rôle (voir §5) :
   - **Admin / direction** : **clé enseignant explicite** fournie et **scopée école** (`teacher_code` / `TEACHERS-*` / `TEACHER-*` historique) — résolution déterministe unique.
   - **Enseignant** : affectation active exacte (classe ± matière) du principal — **inchangé**.
3. Sinon (absence de clé, clé non résolue, ambiguïté) : **HTTP 409** + `code` stable — **jamais** d’auteur inventé.
4. Non-régression : résolution exacte des **évaluations** (`EVAL_TEACHER_UNRESOLVED`) **préservée**.

### B — T1 `identitySyncAck.skips[]` (C-07 / dette Lot 1)

1. Toute réponse `PUT /api/backoffice/state` **200** doit contenir **exactement** la forme suivante (clé + tableau toujours présents) :

```json
{
  "identitySyncAck": {
    "skips": []
  }
}
```

Lorsque des skips se produisent, `skips` est un tableau d’objets (jamais `null`, jamais omis, jamais un objet vide à la place du tableau) :

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

2. **Règle figée (CTO) :** `identitySyncAck` est **toujours** présent ; `skips` est **toujours** un **tableau** (éventuellement vide `[]`). Aucune variante « objet présent vide » / omission / `null`.
3. Codes minimaux à remonter lorsqu’ils se produisent :
   - `TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED`
   - `TEACHER_HISTORICAL_MULTI_TWIN`
   - `TEACHER_LINK_AMBIGUOUS`
4. Les throws liés (`TEACHER_CANON_AMBIGUOUS` → HTTP 409) restent **inchangés**.
5. Clients : au minimum le champ est **présent et consommable** (Web et/ou journal opérateur) ; pas d’obligation UX complète hors Lot 2 si hors scope UI, mais **l’ACK serveur est non optionnel**.

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
| `backend/server.js` | `PUT /api/backoffice/state` (~1270–1274) | Pattern existant `response.syncAck` — **doit** attacher `response.identitySyncAck = { skips: [...] }` avec `skips` **toujours** un tableau |

**Exigence non négociable CTO :** le contrat Lot 2 **inclut obligatoirement** `identitySyncAck.skips[]` — suppression des fallbacks notes/présences **seule** ne suffit pas à clôturer le lot.

### 3.3 Probables / revue de diff

| Fichier | Motif |
|---------|-------|
| Clients Web consommant PUT state | Afficher / journaliser skips non fatals (amorçage T1 client) |
| Surfaces admin notes/présences | Exiger / transmettre la **clé enseignant explicite** (payload) |
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
| Admin / direction + **clé explicite** résolue (unique, scopée école) | Teacher exact | **Inchangé** (résolution déterministe) |
| Admin / direction **sans** clé / clé non résolue / ambiguë | `ORDER BY created_at LIMIT 1` → **mauvais auteur** | **HTTP 409** + `GRADE_TEACHER_UNRESOLVED` — **pas** de 201 |

### 4.2 Présences (`findTeacherForAttendance`)

| Cas | Avant | Après |
|-----|-------|-------|
| Enseignant + match exact | OK | OK |
| Admin / direction + clé explicite unique | OK | OK |
| Admin / direction sans clé / non résolu / ambigu | Premier teacher école | **HTTP 409** + `ATTENDANCE_TEACHER_UNRESOLVED` |

### 4.3 Seed / chemins annexes

Tout chemin d’écriture note/présence qui invente un `teacher_id` via « premier de l’école » doit être **éliminé** ou **refusé** (mêmes codes **409**). Les `ORDER BY created_at LIMIT 1` **hors** résolution enseignant (ex. terms, admin seed unrelated) restent hors AC-N4 s’ils ne rattachent pas un auteur pédagogique — à **documenter** dans la revue de diff.

### 4.4 T1 ACK

| Cas | Avant | Après |
|-----|-------|-------|
| Sync produit `skips[]` | Calculé, **non renvoyé** | `identitySyncAck.skips` = tableau des skips dans la réponse PUT **200** |
| `TEACHER_CANON_AMBIGUOUS` écriture liée | HTTP 409 + `code` | **Inchangé** |
| PUT sans skip | — | **Exactement** `{ "identitySyncAck": { "skips": [] } }` (tableau vide, jamais omis) |

---

## 5. Source déterministe de l’enseignant (figée CTO)

### 5.1 Admin / direction

Pour toute écriture **note** ou **présence** initiée par un principal **admin / direction** :

1. Une **clé enseignant explicite** est **exigée** dans le payload (ou équivalent contractuel de la requête).
2. La clé doit être **scopée école** (résolution limitée à l’établissement courant).
3. La résolution doit aboutir à **exactement un** enseignant.
4. **Interdit** (non exhaustif) :
   - sélection implicite ;
   - « premier enseignant » de l’école ;
   - affectation arbitraire ;
   - déduction par ancienneté / `ORDER BY created_at` ;
   - tout fallback opportuniste.
5. Absence de clé, clé non trouvée, ou **ambiguïté** (plusieurs matches) → **HTTP 409** + `GRADE_TEACHER_UNRESOLVED` ou `ATTENDANCE_TEACHER_UNRESOLVED` selon le chemin — **pas** de 201.

Le canal UI (champ obligatoire / sélecteur) est libre en implémentation **à condition** de transmettre cette clé explicite ; le serveur **refuse** sans elle.

### 5.2 Enseignant

Résolution via l’identité du principal + affectation active exacte (classe ± matière) — **inchangée**. Pas de fallback « premier de l’école ».

---

## 6. Codes d’erreur structurés (attribution) — figés CTO

| Code | HTTP | Quand |
|------|------|-------|
| `GRADE_TEACHER_UNRESOLVED` | **409** | Note : clé absente / non résolue / ambiguë — conflit d’état/résolution métier |
| `ATTENDANCE_TEACHER_UNRESOLVED` | **409** | Présence : idem |
| `EVAL_TEACHER_UNRESOLVED` | (existant) | Éval — **ne pas régresser** |

**Décision CTO :** 409 (conflit métier), **pas** 400 (payload syntaxiquement invalide).  
Le code string, le statut **409**, et l’absence de 201 avec mauvais teacher sont **non négociables**.

---

## 7. Critères d’acceptation

### Attribution

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-N1** | Admin/direction sans clé / non résolu / ambigu → **409** + code structuré, **pas** 201 | Runtime HTTP/PG |
| **AC-N2** | Enseignant + affectation exacte → 201, `grades.teacher_id` = canon attendu | Runtime |
| **AC-N3** | Présence : clé explicite exacte → succès ; sinon **409** `ATTENDANCE_TEACHER_UNRESOLVED` | Runtime |
| **AC-N4** | Garde CI : aucun fallback `created_at LIMIT 1` sur chemins resolve teacher grade/attendance | Gate obligatoire |
| **AC-N5** | Éval attachment exacte inchangée | Unit + runtime |
| **AC-N6** | Admin/direction **avec** clé explicite unique scopée école → 201 et `teacher_id` = enseignant de la clé | Runtime |

### T1 ACK

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-T1-01** | PUT provoquant skip → `identitySyncAck.skips` est un **tableau** non vide avec `code` attendu | Runtime HTTP |
| **AC-T1-02** | PUT nominal sans skip → réponse contient **exactement** `identitySyncAck: { skips: [] }` | Runtime |
| **AC-T1-03** | Écriture liée ambiguë → toujours **409** `TEACHER_CANON_AMBIGUOUS` (non absorbée en skip) | Runtime |
| **AC-T1-04** | Non-régression Lot 1 Mobile (garde AC-G1 + unit Mobile) | CI |

### Non-régression / gouvernance

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-NR1** | Tests V2.1 sync identité backend verts | CI |
| **AC-NR2** | Aucune migration / fusion / backfill historique | Revue PR |

---

## 8. Preuve runtime obligatoire

| Champ | Valeur |
|-------|--------|
| Artefact | `docs/audits/evidence/teacher-record-fix-lot2-notes-attendance-runtime-results.json` |
| Environnement | Backend + PostgreSQL + harness |
| Scénarios min. | AC-N1, AC-N2, AC-N3, AC-N5, AC-N6, AC-T1-01, AC-T1-02, AC-T1-03 |
| Contenu | HTTP status (**409** attendu sur refus), `code`, `grades.teacher_id` / absences, `identitySyncAck.skips` (toujours tableau), rows PG |
| Règle merge | **Aucun merge** code Lot 2 sans evidence **PASS** |

---

## 9. Garde anti-fallback (AC-N4) — obligatoire

Formulation :

> Toute résolution d’enseignant pour **note** ou **présence** via `ORDER BY created_at LIMIT 1`, `findAnyTeacher`, ou équivalent « premier teacher de l’école » fait **échouer** le gate Lot 2.

Couverture minimale : `backend/db/postgresRepository.js` (fonctions `findTeacherForGrade`, `findTeacherForAttendance` et call sites d’écriture associés).  
Allowlist : usages `created_at LIMIT 1` **non** liés à l’auteur pédagogique (à lister explicitement dans le script de garde).

---

## 10. Gate final Lot 2 = PASS

```
AC-N1 … AC-N6
+ AC-T1-01 … AC-T1-04
+ AC-NR1 / AC-NR2
+ garde anti-fallback obligatoire
+ runtime HTTP/PG
= PASS Lot 2
```

---

## 11. Séquence PR

| Étape | Nature | Condition |
|-------|--------|-----------|
| A | Revalidation CTO **explicite** de ce contrat (nouveau head + CI/Security verts) | — |
| B | PR code Lot 2 (**Draft**) | Aval A — **pas avant** |
| C | Evidence runtime + gardes PASS | Avant undraft / merge B |
| D | Undraft + merge Lot 2 | CI + evidence + **revalidation CTO explicite du head** (pas de merge anticipé) |
| E | Contrat Lot 3 | **Seulement après** D |

**Rappel :** undraft/merge #107 **INTERDITS** avant A ; code Lot 2 **INTERDIT** avant A ; Lot 3 / voie 2 / E1 / cycle complet fiche enseignant restent **NO-GO** / suspendus.

---

## 12. Décisions CTO déjà tranchées (ne plus rouvrir)

| Point | Décision |
|-------|----------|
| Forme ACK sans skip | Toujours `{ "identitySyncAck": { "skips": [] } }` — `skips` = tableau obligatoire |
| `GRADE_TEACHER_UNRESOLVED` | **HTTP 409** |
| `ATTENDANCE_TEACHER_UNRESOLVED` | **HTTP 409** |
| Source admin/direction | Clé enseignant **explicite** scopée école ; sinon / ambigu → **409** |
| Périmètre indissociable | notes/présences + `identitySyncAck.skips[]` |

## 13. Décision demandée au CTO

| Question | Attendu |
|----------|---------|
| Revalider ce contrat Lot 2 (ambiguïtés §12 levées) ? | Oui / Ajuster |
| Autoriser ensuite la PR **code** Lot 2 ? | Seulement après validation contrat |

**Implémentation code :** **INTERDITE** jusqu’à validation explicite de ce contrat.
