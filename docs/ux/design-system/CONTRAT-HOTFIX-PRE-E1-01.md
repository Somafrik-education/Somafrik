# Contrat HOTFIX-PRE-E1-01 — Persistance PostgreSQL élèves & inscriptions

**Lot :** HOTFIX-PRE-E1-01  
**Autorisation CTO :** Correctif 1 uniquement (post-V1)  
**Base :** `develop` — PR Draft **distincte** de l’audit PR #84  
**Hors périmètre :** HOTFIX-PRE-E1-02 · Bulletins · V2 · preuve historique V1  

---

## 1. Objectif

Garantir que tout élève créé ou modifié via le parcours BackOffice (`PUT /api/backoffice/state`) est matérialisé de façon fiable dans PostgreSQL, avec une inscription cohérente, afin que `POST /api/notes` puisse le résoudre par **identifiants stables**.

Anomalies V1 ciblées :

| ID | Sévérité | Cible Correctif 1 |
|----|----------|-------------------|
| V1-PG-01c | BLOCKER | Oui — élèves absents de `students` |
| V1-POST-01 | BLOCKER | Oui — `404 Eleve introuvable` |
| V1-PG-01b / PG-02 / DUP-01 / SOT-01 | CRITICAL | Non — hors Correctif 1 (sauf effet cascade non masqué) |

---

## 2. Règle de synchronisation

```
PUT /api/backoffice/state (students[] présent)
  → syncStudentsDomainFromBackOffice (dans la txn)
  → materializeBackOfficeStudent (par enregistrement)
  → INSERT/UPDATE students
  → ensure class + academic year
  → ensureActiveEnrollment
  → puis sync notes (HOTFIX-SYNC-01)
  → persist JSON durable
  → syncAck.accepted|rejected
```

- Collection `students` **absente** du payload ⇒ **no-op** (PUT partiel notes/évaluations).
- Rejet métier ⇒ entrée `syncAck.rejected` ; **pas** de perte silencieuse du JSON élève.
- Échec infra ⇒ ROLLBACK transaction (comportement existant).

---

## 3. Mapping identifiants stables (obligatoire)

| Concept | Source BO | Cible PG |
|---------|-----------|----------|
| Élève | `matricule ?? publicId ?? id` | `students.student_code` |
| Établissement | `schoolCode` | `students.school_id` → `schools.school_code` |
| Classe | `className` (+ id/code classe BO si dispo) | `enrollments.class_id` |
| Année scolaire | année courante école (`active`/`open`) | `enrollments.academic_year_id` |

**Interdit** pour `POST /api/notes` : recherche nominale (prénom/nom) comme contournement.

---

## 4. Résolution `POST /api/notes`

1. Lookup PG par `student_code` ou UUID, **scopé** `schoolCode` de l’évaluation / payload.
2. Si miss PG mais fiche BO trouvée **du même établissement** ⇒ matérialisation puis re-lookup.
3. Si fiche BO d’un autre établissement ⇒ **null** (isolation).
4. Conflit `student_code` déjà porté par un autre `school_id` ⇒ `409 STUDENT_TENANT_CONFLICT`.

---

## 5. Isolation multi-tenant

- Aucune écriture / update cross-école sur `students` (clause `WHERE students.school_id = EXCLUDED.school_id`).
- Aucune résolution grade cross-école.
- Inscription toujours créée avec le `school_id` de l’élève matérialisé.

---

## 6. Tests minimums

| Preuve | Fichier |
|--------|---------|
| Helpers contrat (id stable, no-op, ACK) | `backend/lib/studentsBoPersistence.test.js` |
| Repository : save → PG students/enrollments → resolve grade → isolation | `backend/lib/studentsSyncRepository.test.js` |

```bash
npm run verify:students-sync
```

---

## 7. Non-régression / garde-fous

- Ne pas modifier `docs/audits/evidence/pre-e1-v1-results.json` (preuve V1 historique).
- Ne pas « réparer » l’audit PR #84 dans cette PR.
- Ne pas lancer V2 ni ouvrir E1 Bulletins.
- Ne pas masquer un échec V1 en changeant les assertions d’audit.
