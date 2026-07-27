# Rapport d’audit Pré-E1 V2.1 — Caractérisation `PRE-E1-IDENTITY-LIFECYCLE`

**Type :** caractérisation (audit) — **aucune implémentation**  
**Contrat :** [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md)  
**Base code :** `develop` @ `6ca0ec62` (post-merge PR #94 · post-`094d5017`)  
**Preuve machine :** [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json)  
**Commande :** `npm run verify:pre-e1-v2-identity`  
**Date preuve (rejeu borné) :** 2026-07-27  
**Statut revue CTO :** bornage probatoire — **merge non autorisé** tant que non revalidé  

---

## 0. Mandat, limites et bornage CTO

| Règle | Respect |
|-------|---------|
| Harness / preuve / rapport uniquement | ✅ |
| Correctif / fusion / migration / logique métier | ❌ absent |
| Plan correctif présenté comme autorisé | ❌ absent |
| Distinction **préservation injectée ≠ création nominale** | ✅ ID-04A / ID-04B |
| Verdict global « MAJOR confirmée » non revendiqué | ✅ → **MAJOR PROVISOIRE** |

### Formulation CTO intégrée

> Préservation d’une anomalie injectée ≠ création nominale de l’anomalie.

| Résultat | Classement temporaire |
|----------|----------------------|
| Non-convergence d’identités préexistantes / injectées | **CONFIRMÉE** (ID-04B / Q4-PRESERVE) |
| Création nominale des jumeaux | **CONFIRMÉE** sur ce rejeu (ID-04A / Q4-CREATE) — avec point d’écriture identifié |
| Divergence Q7 sous fixture jumelle | **CONFIRMÉE** (ID-04B-Q7 / Q7-FIXTURE) |
| Divergence Q7 **sans** fixture injectée | **CONFIRMÉE** sur ce rejeu (ID-04A-Q7 / Q7-NOMINAL) |
| Sévérité globale | **MAJOR PROVISOIRE** |

> Note : le premier livrable #95 concluait « MAJOR confirmée » en s’appuyant surtout sur une fixture jumelle. Ce rejeu **borne** et **sépare** les causes. La sévérité reste **provisoire** jusqu’à validation CTO du bornage.

---

## 1. Méthode (deux phases)

### Phase A — ID-04A (nominal, **sans** injection de jumeau)

1. Contact enseignant + compte user (`PUT` state)  
2. **Snapshot** des `teachers[]` après ce PUT (avant fiche pédagogique)  
3. Ajout **uniquement** de la fiche `TEACHERS-*` + affectation  
4. Notes / `POST /api/notes`  
5. Observer si un `TEACHER-*` est apparu **spontanément**

### Phase B — ID-04B (jumeau **injecté** par le harness)

1. Même chaîne sur une autre école  
2. Injection explicite `TEACHER-INJECT-*` (même user / identifier)  
3. Re-PUT / dedupe → persistance ?  
4. Notes / divergence Q7 sous fixture

---

## 2. Scénarios

| Id | Classification | Constat |
|----|----------------|---------|
| **ID-01** | confirmé | Snapshot nominal : `TEACHER-*` + `TEACHERS-*` + `user_id` PG |
| **ID-02** | confirmé | Affectation JSON/PG alignées sur `TEACHERS-*` |
| **ID-03** | confirmé | POST notes 201 via `pg_teacher_assignment` |
| **ID-04A** | **confirmé** | **Sans injection** : après PUT contact+user, fiche `TEACHER-*` déjà présente ; puis `TEACHERS-*` pédagogique ajouté → **création nominale spontanée observée** |
| **ID-04A-Q7** | **confirmé** | Sans fixture injectée : JSON `evaluation.teacherId=TEACHERS-*` vs PG `teacher_code=TEACHER-*` |
| **ID-04B** | **confirmé** | Jumeau injecté `TEACHER-INJECT-*` **conservé** après dedupe (non-fusion) |
| **ID-04B-Q7** | **confirmé** | Sous fixture : même pattern de divergence JSON↔PG |
| **ID-05** | confirmé | Idempotence sync sur identité d’affectation |
| **ID-06** | contexte | Élève — pas de décision `student_code` |

### Point d’écriture exact (création nominale)

Preuve `evidence.phases.nominal.writeTrace.afterContactUserPut` :

```text
PUT /api/backoffice/state  (contact enseignant + compte user)
  → crée spontanément teachers[].id = TEACHER-…
PUT /api/backoffice/state  (fiche pédagogique)
  → ajoute teachers[].id = TEACHERS-… + assignment
```

Le harness **n’injecte pas** le `TEACHER-*` de la phase A.

---

## 3. Questions (bornées)

| Id | Classification | Lecture |
|----|----------------|---------|
| **Q1** | confirmé | Inventaire nominal (n=2) vs fixture (n=3) — séparé |
| **Q2** | confirmé | Points d’écriture listés ; injection confinée à 04B |
| **Q3** | confirmé | Canonique d’affectation = `TEACHERS-*` |
| **Q4-CREATE** | **confirmé** | Création nominale des jumeaux **sans** injection |
| **Q4-PRESERVE** | **confirmé** | Non-convergence sous état injecté |
| **Q4** (synthèse) | indéterminé *(méta)* | Ne fusionne pas les deux verdicts — voir `extra.creation` / `extra.nonConvergence` |
| **Q5** | confirmé | `teacher_code` PG d’affectation = `TEACHERS-*` |
| **Q6** | confirmé | `user_id` canonique ↔ session POST |
| **Q7-NOMINAL** | **confirmé** | Divergence **aussi sans** fixture injectée |
| **Q7-FIXTURE** | **confirmé** | Divergence sous fixture jumelle |
| **Q7** (synthèse) | indéterminé *(méta)* | Causalité bornée via Q7-NOMINAL / Q7-FIXTURE |

---

## 4. Synthèse factuelle (bornée)

| Champ | Valeur |
|-------|--------|
| ID | `PRE-E1-IDENTITY-LIFECYCLE` |
| Sévérité globale | **MAJOR PROVISOIRE** |
| Non-convergence (préexistant/injecté) | **CONFIRMÉE** |
| Création nominale des jumeaux | **CONFIRMÉE** (rejeu borné — point d’écriture contact/user) |
| Q7 sous fixture | **CONFIRMÉE** |
| Q7 sans fixture | **CONFIRMÉE** (rejeu borné) |
| Correctif | **Non proposé · non commencé · non autorisé** |

### Ce que ce dossier affirme

1. Quand des jumeaux sont présents (spontanés ou injectés), le système **ne les fusionne pas**.  
2. Le flux nominal contact+user **peut** créer spontanément un `TEACHER-*` avant/avec le `TEACHERS-*` pédagogique.  
3. La divergence `evaluation.teacherId` JSON (`TEACHERS-*`) vs PG (`TEACHER-*`) apparaît **avec et sans** injection harness sur ce protocole.  
4. La sévérité reste **MAJOR PROVISOIRE** — pas un GO correctif.

### Ce que ce dossier n’affirme pas

- Un plan correctif autorisé  
- Une clôture de dette  
- Une décision sur `student_code`  
- Que le premier verdict « MAJOR confirmée » de #95 (pré-bornage) était suffisant

---

## 5. Hors livrable

- Fusion / suppression d’identités  
- Migration / modification métier  
- Ouverture E1  
- Réouverture HOTFIX-01 / 02 / 02B  
- Merge tant que le CTO n’a pas revalidé ce bornage  

---

## 6. Références

| Artefact | Rôle |
|----------|------|
| `npm run verify:pre-e1-v2-identity` | Harness borné ID-04A/04B |
| [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json) | Preuve |
| [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md) | Contrat |

**Fin du rapport V2.1 borné — aucun correctif.**
