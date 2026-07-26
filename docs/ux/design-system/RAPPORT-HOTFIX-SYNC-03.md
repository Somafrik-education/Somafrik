# Rapport HOTFIX-SYNC-03 — Autorisation métier enseignant Notes

**Type :** Hotfix RBAC sync Notes  
**Prérequis :** `hotfix-sync-01`, `hotfix-sync-02`  
**Roadmap fonctionnelle :** toujours suspendue  

**Contrat :** [CONTRAT-HOTFIX-SYNC-03.md](./CONTRAT-HOTFIX-SYNC-03.md)

---

## 1. Constat

HOTFIX-SYNC-02 conserve localement les évaluations rejetées, mais le PUT enseignant échouait en **403** :

`Permission insuffisante pour modifier ces données.`

Cause : chemin `PUT /backoffice/state` + payload Notes incluant souvent `auditLog` (non writable) + absence d’un chemin RBAC métier enseignant limité à `evaluations` / `notes`.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `teacherNotesWriteAccess.js` | Clés autorisées, affectation classe/matière, stamp `teacherId` session, fusion non destructive |
| `server.js` | Branche `Enseignant` dans `assertBackOfficeWriter` + préparation payload avant save |
| `GradesEvaluationsPage` | Plus d’envoi client de `auditLog` |
| Tests | `teacherNotesWriteAccess.test.js` (scénarios CTO) |

---

## 3. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Enseignant → evaluations/notes seulement | Oui |
| Rejet payments/exams/auditLog | Oui |
| Affectation classe/matière | Oui |
| `teacherId` session | Oui |
| Préservation autres enseignants | Oui |
| Élargissement global `/backoffice/state` | Non |
| Roadmap D3.7 | Toujours suspendue |

---

## 4. Validation préprod manuelle

1. Connexion **Enseignant** affecté classe/matière  
2. Créer une évaluation → sync **accepted**, outbox vide  
3. Autre navigateur / session → évaluation visible  
4. Tentative autre classe / matière → 403 + sync failed local (non-perte)
