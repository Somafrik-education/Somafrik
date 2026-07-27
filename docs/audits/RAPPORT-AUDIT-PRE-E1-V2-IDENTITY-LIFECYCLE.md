# Rapport d’audit Pré-E1 V2.1 — Caractérisation `PRE-E1-IDENTITY-LIFECYCLE`

**Type :** caractérisation (audit) — **aucune implémentation**  
**Contrat :** [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md)  
**Base code :** `develop` @ `6ca0ec62` (post-merge PR #94 · post-`094d5017`)  
**Preuve machine :** [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json)  
**Commande :** `npm run verify:pre-e1-v2-identity`  
**Date preuve (rejeu borné) :** 2026-07-27  
**Revalidation CTO :** 2026-07-27 — caractérisation **VALIDÉE** · bornage **SATISFAIT**

---

## 0. Décision CTO (revalidation)

| Champ | Décision |
|-------|----------|
| Caractérisation V2.1 | **VALIDÉE** |
| Bornage probatoire | **SATISFAIT** |
| `PRE-E1-IDENTITY-LIFECYCLE` | **MAJOR CONFIRMÉE — décision CTO** |
| Correctif métier | **INTERDIT** |
| Plan correctif | **NON AUTORISÉ À CE STADE** |
| BLOCKER / CRITICAL | **Non** |
| HOTFIX-01/02/02B | **Ne pas rouvrir** |
| E1 | **NO-GO** |

La mention **MAJOR PROVISOIRE** était appropriée pendant l’attente de revue. Avec la revalidation CTO, la dette est enregistrée **MAJOR confirmée**.

Cela **n’autorise pas** un correctif, une fusion d’identités, ni l’ouverture d’E1.

### Bornage validé

| Phase | Contenu |
|-------|---------|
| **ID-04A** | Parcours nominal **sans** injection |
| **ID-04B** | État contenant un jumeau **injecté** |

Distinction respectée : **préservation injectée ≠ création nominale** — les deux ont une preuve distincte.

---

## 1. Mandat et limites

| Règle | Respect |
|-------|---------|
| Harness / preuve / rapport uniquement | ✅ |
| Correctif / fusion / migration / logique métier | ❌ absent |
| Plan correctif présenté comme autorisé | ❌ absent |
| Séparation ID-04A / ID-04B | ✅ |

---

## 2. Méthode (deux phases)

### Phase A — ID-04A (nominal, sans injection)

1. Contact enseignant + compte user (`PUT` state)  
2. Snapshot des `teachers[]` après ce PUT  
3. Ajout de la fiche `TEACHERS-*` + affectation  
4. Notes / `POST /api/notes`  
5. Observer la création spontanée éventuelle d’un `TEACHER-*`

### Phase B — ID-04B (jumeau injecté)

1. Même chaîne sur une autre école  
2. Injection explicite `TEACHER-INJECT-*`  
3. Re-PUT / dedupe → persistance  
4. Notes / divergence Q7 sous fixture

---

## 3. Verdict technique (CTO)

| Résultat | Classement |
|----------|------------|
| Création nominale `TEACHER-*` puis `TEACHERS-*` | **CONFIRMÉE** |
| Non-convergence des identités | **CONFIRMÉE** |
| Divergence JSON ↔ PostgreSQL nominale | **CONFIRMÉE** |
| Divergence sous fixture | **CONFIRMÉE** |
| `PRE-E1-IDENTITY-LIFECYCLE` | **MAJOR CONFIRMÉE — décision CTO** |

### Phase nominale (faits validés)

- le PUT du contact enseignant et de son compte crée un `TEACHER-*` ;  
- la fiche pédagogique ajoute ensuite un `TEACHERS-*` ;  
- les deux coexistent **sans** injection harness du premier jumeau ;  
- la divergence des références d’évaluation existe **aussi** avant la phase fixture.

### Point d’écriture (création nominale)

```text
PUT /api/backoffice/state  (contact enseignant + compte user)
  → teachers[].id = TEACHER-…
PUT /api/backoffice/state  (fiche pédagogique)
  → teachers[].id = TEACHERS-… + assignment
```

---

## 4. Scénarios (rappel)

| Id | Classification | Constat |
|----|----------------|---------|
| **ID-01** | confirmé | Snapshot nominal multi-couches |
| **ID-02** | confirmé | Affectation JSON/PG sur `TEACHERS-*` |
| **ID-03** | confirmé | POST notes 201 via `pg_teacher_assignment` |
| **ID-04A** | confirmé | Création nominale spontanée `TEACHER-*` + `TEACHERS-*` |
| **ID-04A-Q7** | confirmé | Divergence evaluation JSON↔PG **sans** fixture injectée |
| **ID-04B** | confirmé | Non-fusion du jumeau injecté |
| **ID-04B-Q7** | confirmé | Divergence sous fixture |
| **ID-05** | confirmé | Idempotence sync |
| **ID-06** | contexte | Élève — pas de décision `student_code` |

---

## 5. Questions (rappel borné)

| Id | Classification |
|----|----------------|
| Q1 / Q2 / Q3 | confirmé |
| **Q4-CREATE** | confirmé (création nominale) |
| **Q4-PRESERVE** | confirmé (non-convergence) |
| Q4 (méta) | indéterminé — ne fusionne pas les deux verdicts |
| Q5 / Q6 | confirmé |
| **Q7-NOMINAL** | confirmé |
| **Q7-FIXTURE** | confirmé |
| Q7 (méta) | indéterminé — causalité via Q7-NOMINAL / Q7-FIXTURE |

---

## 6. Synthèse enregistrée

| Champ | Valeur |
|-------|--------|
| ID | `PRE-E1-IDENTITY-LIFECYCLE` |
| Sévérité | **MAJOR CONFIRMÉE — décision CTO** |
| Correctif | **Interdit** à ce stade |
| Plan correctif | **Non autorisé** à ce stade |
| Prochain livrable possible | Dossier de **cadrage** d’un plan correctif minimal V2.1 **ou** contrat du prochain sujet V2 — **arbitrage CTO** ; **pas** d’implémentation |

---

## 7. Hors livrable

- Implémentation / fusion / migration  
- Réouverture HOTFIX-01 / 02 / 02B  
- Ouverture E1  
- Plan correctif exécuté sans aval CTO  

---

## 8. Références

| Artefact | Rôle |
|----------|------|
| `npm run verify:pre-e1-v2-identity` | Harness ID-04A/04B |
| [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json) | Preuve |
| [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md) | Contrat |

**Fin du rapport V2.1 — caractérisation validée CTO — aucun correctif.**
