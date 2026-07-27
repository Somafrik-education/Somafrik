# KNOWN-ISSUE-NOTES-01 — Sync enseignant bloquée (RBAC) après rollback P0

**Référence stable :** `KNOWN-ISSUE-NOTES-01`  
**Statut :** clôturée — corrigée par HOTFIX-SYNC-03  
**Sévérité historique :** bloquant pour notes / évaluations persistées PostgreSQL  

---

## 1. Constat (après rollback vers PR #69)

| Observation | État |
|-------------|------|
| Connexion enseignant | Fonctionnelle |
| Évaluations locales | Toujours présentes |
| Outbox | Enregistrements en échec (ex. 4) |
| Cause visible | `Permission insuffisante pour modifier ces données.` |
| Perte de données locale | Non observée (HOTFIX-SYNC-01) |
| Synchronisation serveur / PG | **Bloquée** (avant SYNC-03) |

Cohérent avec le rollback vers le merge PR #69 (`885979ff`) : le mécanisme non destructif conserve les évaluations, mais l’autorisation métier enseignant (SYNC-03) n’était **pas** réintroduite. Cause additionnelle côté Notes UI : envoi client de `auditLog` (non writable → 403).

---

## 2. Résolution

1. **#73** — filet bootstrap runtime (`verify-runtime-bootstrap`) ✅  
2. **HOTFIX-SYNC-03** — RBAC enseignant `evaluations` + `notes` uniquement + Notes UI sans `auditLog` client — [CONTRAT](./CONTRAT-HOTFIX-SYNC-03.md) · [RAPPORT](./RAPPORT-HOTFIX-SYNC-03.md)  
3. **SYNC-04** — encore isolé (SAVEPOINT / `GRADE_*`)

---

## 3. Critères de clôture

- [x] Enseignant : chemin écriture `evaluations`/`notes` autorisé (contrôle affectation + `teacherId` session)
- [x] Hors clés Notes (`payments`, `exams`, `auditLog`, …) → 403
- [x] Notes UI n’envoie plus `auditLog` dans le PUT
- [ ] Validation préprod : ACK accepted / outbox vide + bootstrap CI vert (à confirmer après merge)
- [ ] SYNC-04 isolé (hors périmètre de cette clôture RBAC)
