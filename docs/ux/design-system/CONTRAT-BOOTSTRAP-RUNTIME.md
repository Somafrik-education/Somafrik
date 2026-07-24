# Contrat — Filet bootstrap runtime (post P0 AUTH DOWN)

**Base saine :** `885979ff` / merge PR #69 (HOTFIX-SYNC-01)  
**Freeze Notes PG :** [KNOWN-ISSUE-NOTES-01](./KNOWN-ISSUE-NOTES-01.md) — sync enseignant bloquée (RBAC), outbox failed conservée  
**Freeze merge :** #71 / #72 = sources d’analyse uniquement  

---

## 1. Objectif

Empêcher qu’un hotfix Notes casse à nouveau le chargement global :

`repository.init()` → `getDataset()` → `/api/schools` → `/api/identify` → `/api/backoffice/login`

Un login avec faux credentials doit répondre **401**, jamais **500**.

---

## 2. Commande

```bash
DATABASE_URL=postgresql://… \
SOMAFRIK_BOOTSTRAP_REQUIRED=true \
SOMAFRIK_SKIP_DEMO_SEED=true \
npm run verify:runtime-bootstrap
```

CI : jobs `CI` (lint-build) et `Security` (Tests) avec PostgreSQL 16, mode préprod-like (`SOMAFRIK_SKIP_DEMO_SEED=true`).

---

## 3. Reprise Notes (ordre CTO)

1. Merger ce filet depuis `885979ff`
2. Réintroduire **SYNC-03 seul** (RBAC enseignant + upsert partiel)
3. Valider bootstrap + 3 profils + périmètre enseignant
4. Seulement ensuite **SYNC-04** (SAVEPOINT / GRADE_*)

Ne pas reprendre directement les branches #71 / #72.
