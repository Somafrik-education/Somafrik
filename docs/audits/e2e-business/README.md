# E2E BUSINESS AUDIT

```text
E2E BUSINESS AUDIT

Base: origin/develop
HEAD: e8a7cf0f404d711e9d0b3d752cfc9fc5b771b0a8
Branch: cursor/audit-e2e-business-full-execution-d9e2
Environment(s): ENV-LOCAL (Postgres Docker + backend hôte + Expo web) ; préprod/prod GET only ; Maestro préprod BLOCKED
Production mutation: NONE

Business scenarios identified: 93
Existing E2E tests: 58
Executed: 46
PASS: 16
FAIL: 28
BLOCKED: 11
NOT COVERED: 22+

P0: 1
P1: 1
P2: 2
P3: 2
```

**Statut PR :** DRAFT / HOLD — aucun Ready, aucun Merge.  
**Zéro correction produit.** Un test rouge est resté rouge.

## Lecture obligatoire

| Verdict | Signification ici |
| ------- | ----------------- |
| **PASS vérifié** | Isolées PG (sync, COM C1–C4, admin-user, bulletins S1, planning web), establishment in-memory, E2E 0006 in-memory, welcome mobile 0010, scaffold Maestro, preflight health, web-smoke local |
| **FAIL vérifié** | Seed/init officiel ; bootstrap E2E ; 14 chaînes HTTP `verify:e2e-*` ; 11 scripts mobile 0017–0027 ; `docker:up:core` |
| **BLOCKED** | Maestro runtime Android préprod |
| **NON TESTÉ** | Agrégateur `verify:e2e-all` (enfants déjà lancés) |
| **ABSENT DE LA COUVERTURE** | Aide, wizard guidé, logout, session expirée, professeur principal, push, etc. |

Les PASS isolés **ne rendent pas** les parcours 0001–0015 « globalement OK ».

## P0 immédiat

Init PostgreSQL + seed officiel : contrainte `uq_users_school_email` (23505), reproductible sur base neuve. Le backend ne démarre pas. **Aucune correction effectuée.**

## Documents

| Fichier | Contenu |
| ------- | ------- |
| [environment.md](./environment.md) | SHA, environnements, interdiction prod write |
| [inventory.md](./inventory.md) | Matrice des suites |
| [coverage-matrix.md](./coverage-matrix.md) | Couverture métier |
| [execution-report.md](./execution-report.md) | Commandes + PASS/FAIL |
| [failures.md](./failures.md) | Dossiers d’échec |
| [results/](./results/) | Logs sanitizés |

## Condition de fin (mandat)

1. Inventaire repository complet — **oui**
2. Chaque suite E2E a un statut — **oui**
3. Suites exécutables lancées — **oui** (locales)
4. Suites impossibles justifiées — **oui** (Maestro)
5. Parcours sans couverture identifiés — **oui**
6. Chaque FAIL a une preuve — **oui**
7. Aucun code produit corrigé — **oui**
8. Aucune donnée production mutée — **oui**

**STOP.** Pas de chantier correctif. Pas de Ready. Pas de merge.  
Attendre un nouveau mandat CTO.
