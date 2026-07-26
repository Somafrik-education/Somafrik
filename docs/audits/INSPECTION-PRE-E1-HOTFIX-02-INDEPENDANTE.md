# Inspection indépendante — HOTFIX-PRE-E1-02 (PR #87 / #88 / #89)

**Statut :** AFFIRMATIONS D’INSPECTION — **≠ validation CTO**  
**Règle :** Rapport Cursor ≠ validation CTO  
**Audit Pré-E1 :** **OUVERT**  
**HOTFIX-PRE-E1-01 :** corrigé  
**HOTFIX-PRE-E1-02 :** **fonctionnel**, **causalité non démontrée** (voir §0)  
**V2 :** BLOQUÉE · **E1 :** NO-GO · **PR #84 :** Draft  

**PR #89 :** pièce centrale d’inspection (pas une correction métier de production).  
**Code de base :** `develop` + instrumentation diagnostic gated `SOMAFRIK_AUTHZ_TRACE=1`.

**Preuves :**
- [`evidence/pre-e1-notes-authz-causality.json`](./evidence/pre-e1-notes-authz-causality.json)
- [`evidence/notes-authz-trace.jsonl`](./evidence/notes-authz-trace.jsonl)
- [`evidence/pre-e1-hotfix-02-independent-inspection.json`](./evidence/pre-e1-hotfix-02-independent-inspection.json)
- [`evidence/pre-e1-v1-independent-replay-after-87.json`](./evidence/pre-e1-v1-independent-replay-after-87.json)

**Harness :**
- `scripts/audit-pre-e1-notes-authz-causality.js`
- `scripts/inspect-pre-e1-hotfix-02-independent.js`
- Trace runtime : `backend/lib/notesAuthzTrace.js` (+ hooks `postgresRepository` / `GET /api/debug/notes-authz-trace`)

---

## 0. Audit de causalité — Pourquoi le POST réussit-il ?

### Question unique

Identifier la source réellement utilisée à l’autorisation de `POST /api/notes` :

PostgreSQL `teacher_assignments` ? Snapshot BackOffice ? JWT `classNames` ? Fusion ? Fallback implicite ?

### Chemin instrumenté (run `audit-pre-e1-notes-authz-causality.js`)

```
POST /api/notes  →  201
teacher principal
↓
JWT classNames ?          → MISS (classes seed démo ≠ classe opérationnelle)
↓
teacher PG trouvé ?       → HIT (CD-2026-0051-ENS-0001, user_id null)
↓
teacher_assignment PG ?   → MISS (0 lignes pour l'école)
↓
fallback BO classe ?      → ALLOW via bo_assignment_match
↓
fallback BO matière ?     → ALLOW via bo_assignment
↓
autorisation accordée
grantedBy = class:bo_assignment_match+evaluation:bo_assignment
```

### Verdict de causalité

| Source | Utilisée pour ALLOW ? |
|--------|------------------------|
| PostgreSQL `teacher_assignments` | **NON** |
| Snapshot BackOffice (`assignments`) | **OUI** (classe + matière) |
| JWT `assignedClasses` / `classNames` | **NON** (miss explicite) |
| Fusion des trois | **NON** — BO seul après échecs JWT/PG |

- **conclusion machine :** `CAUSE_APPARENTE_FALLBACK_BO`
- **matchesHotfix02Narrative :** `false`
- **PG au moment du POST :** `teachers=1 (ENS-*)`, `assignments=0`

### Conséquence pour les rapports antérieurs

Les bilans #87/#88 qui attribuent le déblocage à la **matérialisation PG des affectations** sont **infirmés sur la causalité**, même si le comportement fonctionnel (POST 201, gardes négatives) est réel.

Le hotfix est donc au mieux :

> **fonctionnel par fallback BackOffice**,  
> **pas prouvé comme correction de la cause racine PG**.

---

## 1. Diff réel (#87 / #88)

### PR #87 — sync staff + gardes + session

Ajoute bien un chemin PG `teacher_assignments`, **et** des fallbacks BO / JWT.  
Le chemin PG peut être mort dans le scénario nominal si la sync staff n’a pas produit de lignes.

### PR #88 — docs / preuve 33/33

Affirmations Cursor ; ne prouve pas la causalité PG.

### PR #89 — inspection + trace

Ne « corrige » pas le métier notes ; instrumente et documente le mécanisme réel.

---

## 2. Tests unitaires hotfix-02 ≠ PostgreSQL

**CONFIRMED** — `pedagogyStaffSyncRepository.test.js` = stub mémoire (`repo.tables.*`).

---

## 3. Assertions V1

- Non assouplies globalement ; DUP-01 renforcé.
- **GAP :** V1 ne SELECT jamais `teacher_assignments`.
- **33/33 reproductible** sans prouver la cause PG (voir inspection PG : assignments vides, `ENS-*`).

---

## 4. Identités TEACHER-* / TEACHERS-* / ENS-*

Observé sur runs verts / causalité :

| Couche | Identité |
|--------|----------|
| Affectation BO | souvent `TEACHERS-*` ou match via `TEACHER-*` |
| JWT / lookup keys | mélange USERS / ENS / TEACHER / seed |
| PG `teachers.teacher_code` | `CD-…-ENS-0001` (`user_id` null) |

→ Dette **PRE-E1-IDENTITY-LIFECYCLE** confirmée empiriquement.

---

## 5. Autres contrôles d’inspection (rappel)

| Contrôle | Résultat |
|----------|----------|
| Idempotence (même/différente/sans clé + concurrence) | PASS (pas de ligne grade en plus) |
| Anti-escalation PUT enseignant | PASS (403) |
| Restart JSON ↔ PG | PASS |
| Sync `teacher_assignments` PG sur scénario nominal | **FAIL / absent** |

---

## 6. Correction documentaire requise

Le rapport HOTFIX-02 doit cesser d’affirmer, sans réserve :

- « Cohérence PG assignments » comme résultat acquis du scénario notes ;
- « Cause racine 403 corrigée » **via** affectations PG.

Formulation conforme à l’inspection :

- HOTFIX-02 : **fonctionnel** (POST nominal + refus négatifs observés) ;
- causalité du ALLOW : **fallback snapshot BackOffice** (preuve instrumentée) ;
- matérialisation PG des affectations : **non démontrée** sur le chemin réel du POST.

Voir rectificatif dans `docs/ux/design-system/RAPPORT-HOTFIX-PRE-E1-02.md`.

---

## 7. Synthèse pour arbitrage CTO

| Affirmation | Verdict inspection |
|-------------|-------------------|
| POST réussit grâce à `teacher_assignments` PG | **FAUX** (trace) |
| POST réussit grâce au JWT classNames opérationnel | **FAUX** (miss) |
| POST réussit grâce au fallback BO | **VRAI** (trace `grantedBy`) |
| Hotfix « fonctionnel » | **VRAI** (comportement) |
| Cause racine PG éliminée | **NON DÉMONTRÉ** |
| Clôture audit / ouverture V2 | **NON** |

**Décision non prise par cet agent.** Prochaine étape : revue CTO des diffs #87/#88/#89 sous l’angle *mécanisme réel vs récit*.
