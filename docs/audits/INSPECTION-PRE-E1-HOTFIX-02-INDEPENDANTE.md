# Inspection indépendante — HOTFIX-PRE-E1-02 (PR #87 / #88)

**Statut :** AFFIRMATIONS D’INSPECTION — **≠ validation CTO**  
**Règle appliquée :** Rapport Cursor ≠ validation CTO  
**Gouvernance :** Audit Pré-E1 **NON CLOS** · V2 **BLOQUÉE** · E1 **NO-GO** · PR #84 **Draft**  
**HOTFIX-PRE-E1-02 :** mergé dans `develop` (`f8999ebe`), **pas validé indépendamment** par ce document  

**Code inspecté :** `develop` @ `f2210763`  
**Preuves machine :**
- [`evidence/pre-e1-hotfix-02-independent-inspection.json`](./evidence/pre-e1-hotfix-02-independent-inspection.json)
- [`evidence/pre-e1-v1-independent-replay-after-87.json`](./evidence/pre-e1-v1-independent-replay-after-87.json) (rejeu `verify:pre-e1-v1`)
- Harness : `scripts/inspect-pre-e1-hotfix-02-independent.js`

---

## 1. Diff réel

### PR #87 (`2be00d39…f8999ebe`) — +1937 / −89

| Zone | Nature |
|------|--------|
| `postgresRepository.js` | Sync staff + gardes établissement/classe/matière + `collectTeacherLookupKeys*` |
| `pedagogyStaffBoPersistence.js` (+ tests) | Mapping / validation sync |
| `pedagogyStaffSyncRepository.test.js` | Suite « verify:pre-e1-hotfix-02 » |
| `evaluationAttachment.js` | Résolution teacher + **fallback `findAnyTeacher` conservé** |
| `teacherNotesWriteAccess.js` | Préférence fiche avec affectations |
| `server.js` | Enrichissement session login / change-password |
| `verify-pre-e1-v1.js` | DUP-01 plus détaillé (comptages) |
| Docs contrat/rapport | Affirmations livraison |

### PR #88 — docs + preuve + renommage champs DUP-01 (gitleaks)

Pas de correction métier. Contient le bilan Cursor 33/33 (à traiter comme affirmation).

---

## 2. Les tests unitaires hotfix-02 ne touchent pas PostgreSQL

**CONFIRMED**

`pedagogyStaffSyncRepository.test.js` construit un `createInjectablePostgresRepository()` :
- `Object.create(PostgresRepository.prototype)`
- `pool.query` stub vide
- assertions sur `repo.tables.teachers|teacher_assignments|…` en mémoire

→ `npm run verify:pre-e1-hotfix-02` **ne prouve pas** la matérialisation PG réelle.

---

## 3. Assertions V1 : pas d’affaiblissement grossier, mais angles morts

| Point | Constat |
|-------|---------|
| Critères POST/PG/NEG/ISO | **Non assouplis** vs pré-#87 (mêmes sévérités) |
| DUP-01 | **Renforcé** (comptages avant/après + sans clé) vs ancien `<=2 grades` |
| GAP | `idsUnchanged*` calculé mais **non utilisé dans `idemOk`** |
| GAP | Pas de test « clé différente » ni « concurrence » dans V1 |
| GAP | V1 **ne SELECT jamais** `teachers` / `teacher_assignments` |
| GAP | V1 NEG accepte `400\|403\|404` — ne prouve pas exclusivement la garde 403 |

---

## 4. Reproduction `verify:pre-e1-v1` depuis base propre

**Rejoué indépendamment :** **33/33** (fichier `pre-e1-v1-independent-replay-after-87.json`).

Le score est **reproductible**. Il n’implique pas que la cause racine « assignments PG » soit démontrée.

### Inspection PG pendant / après ce 33/33 (école A `CD-2026-0051`)

| Table | Observation |
|-------|-------------|
| `teachers` | **1** ligne : `teacher_code=CD-2026-0051-ENS-0001`, **`user_id` NULL** |
| `teacher_assignments` | **`[]` vide** |
| `evaluations.teacher_id` | non null → pointe vers cet `ENS-0001` |
| `grades` | 2 lignes (cohérent SOT) |
| `enrollments` | présents (HOTFIX-01) |

**FAIL / RISK majeur :** le scénario vert n’a **pas** matérialisé les affectations BO (`TEACHERS-*`) en `teacher_assignments`.  
`PG-01b` passe parce que `teacher_id` est non null — or le code PG est un **`ENS-*` auto**, pas l’identité BO.

### Identités TEACHER-* / TEACHERS-* (cas réel du run 33/33)

| Couche | Valeur observée |
|--------|-----------------|
| JSON évaluation `teacherId` (REL-03) | `TEACHER-…` |
| JSON affectation `teacherId` (REL-04) | `TEACHERS-…` |
| PG `teachers.teacher_code` | `CD-2026-0051-ENS-0001` |

→ La double identité **persiste dans le run vert** ; PG n’ancre ni `TEACHER-*` ni `TEACHERS-*`.

Probable chemin d’attache évaluation : `evaluationAttachment.findAnyTeacher` / `ensureTeacher` → code `ENS-*`, pas sync staff BO.

---

## 5. Inspection indépendante (hors suite V1)

Harness `inspect-pre-e1-hotfix-02-independent.js` — résumé observé :

| ID | Statut | Lecture |
|----|--------|---------|
| SESS-01 | PASS | JWT `classNames` non vide |
| **SESS-01b** | **FAIL** | JWT = classes **seed démo** (`5ème A`…) — **pas** la classe de chaîne |
| SESS-02 | PASS | PUT enseignant `teachers`/`assignments`/`rolePermissions` → **403** |
| PG-TEACHERS / PG-GRADES / PG-ENROLL / PG-EVAL | PASS | Lignes existent ; `teacher_id` non null |
| **PG-ASSIGN** | **FAIL** | `teacher_assignments` école A **vide** |
| ID-DUAL / ID-EVAL-TEACHER | OBSERVED/FAIL | Pas de `TEACHERS-*` en PG ; `ENS-*` |
| POST-NOMINAL | PASS | 201 malgré assignments PG vides / JWT sans classe chaîne |
| NEG hors-classe / matière (setup inspect) | FAIL vs attente 403 stricte | **400** cohérence évaluation (autre chemin) — rejet existe, **pas le même code** que V1 |
| NEG ISO A/B | PASS | refus (400/403) |
| IDEM-SAME / DIFF / NONE / CONC | PASS | Pas de ligne grade supplémentaire |
| RESTART-JSON / PG / SOT | PASS | Cohérence après kill/restart backend |
| META-UNIT-STUB / META-V1-ASSERT | GAP | Voir §2–3 |

**Lecture sécurité nominale :** POST autorisé + 403 V1 reproductibles **ne démontrent pas** que la garde s’appuie sur `teacher_assignments` PG. Le fallback BO (`teacherCanAccessClassFromBackOffice` / affectations JSON) peut porter le scénario.

---

## 6. Idempotence (indépendante)

Sur grades PG (effectif baseline = 2) :

| Cas | Résultat observé |
|-----|------------------|
| Même en-tête | count stable, IDs stables |
| En-tête différent, même payload | count stable (upsert métier) |
| Sans en-tête | count stable |
| 3 appels concurrents même en-tête | count stable |

**PASS technique** sur non-duplication de lignes. Ne clôt pas l’audit métier.

---

## 7. Session / escalation

- Enrichissement `assignedClasses` côté serveur à login / change-password : **confirmé dans le diff**.
- Enseignant **ne peut pas** s’auto-attribuer droits via PUT state : **403** (PASS).
- **FAIL associé :** le JWT observé porte des classes démo, pas la classe opérationnelle — surface d’ambiguïté IDENTITY-LIFECYCLE toujours ouverte.

---

## 8. Synthèse pour arbitrage CTO

| Affirmation Cursor (bilans #87/#88) | Verdict d’inspection |
|-------------------------------------|----------------------|
| Sync teachers/assignments PG avant notes | **NON DÉMONTRÉ** sur runs réels (assignments vides ; codes `ENS-*`) |
| Cause 403 corrigée via affectations PG | **PARTIEL / AMBIGU** — succès via chemins BO / `ENS-*` possibles |
| `verify:pre-e1-hotfix-02` prouve PG | **FAUX** — stub mémoire |
| 33/33 | **REPRODUCTIBLE** mais **insuffisant** comme preuve d’architecture |
| DUP-01 / restart / anti-escalation PUT | **Orientés PASS** sous inspection |
| Identités TEACHER / TEACHERS unifiées | **FAUX** — divergence JSON + absentes en PG |
| Audit clos / V2 ouvrable | **NON** — hors périmètre ; gouvernance CTO |

### Décision demandée (hors agent)

Ce document **n’autorise pas** :
- clôture de l’audit Pré-E1 ;
- ouverture V2 ;
- GO E1 Bulletins ;
- undraft PR #84.

Prochain arbitrage Pré-E1 : **après** revue humaine de #87/#88 à la lumière de ces observations.
