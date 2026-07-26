# Rapport HOTFIX-PRE-E1-01 — Persistance élèves & inscriptions

**Type :** Hotfix pré-E1 (Correctif 1)  
**Décision CTO :** V1 acceptée comme preuve · V2 bloquée · E1 NO-GO · PR #84 Draft inchangée  
**Contrat :** [CONTRAT-HOTFIX-PRE-E1-01.md](./CONTRAT-HOTFIX-PRE-E1-01.md)

---

## 1. Constat

L’audit V1 a prouvé que les élèves créés via `PUT /api/backoffice/state` restaient uniquement dans le JSON BackOffice : **0 ligne** `students` PG pour la chaîne, donc `POST /api/notes` → **404 Eleve introuvable**.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `studentsBoPersistence.js` | Identifiant stable, validation, merge ACK |
| `postgresRepository` | `syncStudentsDomainFromBackOffice` avant sync notes ; matérialisation + enrollment ; `resolveStudentForGrade` ; garde tenant |
| Docs | Contrat + ce rapport |
| Tests | `studentsBoPersistence.test.js` · `studentsSyncRepository.test.js` |

---

## 3. Tableau CTO

| Objectif | Résultat |
|----------|----------|
| Élèves BO → `students` PG | Oui (sync à chaque PUT touchant `students`) |
| Inscription cohérente `enrollments` | Oui (école + classe + année courante) |
| Mapping IDs stables | Oui (`matricule/publicId/id`) |
| Résolvable `POST /api/notes` | Oui (`resolveStudentForGrade`) |
| Isolation multi-tenant | Oui (filtre école + conflit 409) |
| Tests non-régression | `npm run verify:students-sync` |
| HOTFIX-PRE-E1-02 / Bulletins / V2 | Non démarrés |
| Preuve V1 historique | Non modifiée |

---

## 4. Arrêt

Livraison Correctif 1 uniquement — **revue CTO requise** avant tout Correctif 2.
