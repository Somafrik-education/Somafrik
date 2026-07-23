# Contrat HOTFIX-SYNC-03 — Autorisation métier enseignant (Notes)

**Lot :** HOTFIX-SYNC-03  
**Prérequis :** tags `hotfix-sync-01`, `hotfix-sync-02`  
**Statut CTO amont :** HOTFIX-SYNC-02 techniquement incomplet en préproduction (cause RBAC)

---

## 1. Objectif

Débloquer la synchronisation enseignant des évaluations / notes **sans** élargir l’accès global à `PUT /backoffice/state`.

---

## 2. Règles d’autorisation

Sur le chemin actuel `PUT /api/backoffice/state`, un principal `Enseignant` peut toucher **uniquement** :

| Clé | Autorisé |
|-----|----------|
| `evaluations` | Oui |
| `notes` | Oui |
| toute autre clé (`payments`, `exams`, `auditLog`, …) | **Non** → 403 |

Contrôles serveur obligatoires :

1. L’enseignant appartient à l’établissement (`schoolCode` session)
2. Il est affecté à la classe **et** à la matière de chaque ligne écrite
3. `teacherId` est forcé depuis l’identité de session (jamais un `teacherId` libre client)
4. Les évaluations / notes des autres enseignants sont préservées
5. PUT partiel = **upsert par id** uniquement : l’absence d’une ligne dans le patch n’est jamais une suppression (y compris pour les autres lignes du même enseignant)

Les rôles backoffice établissement (`Admin School`, `Directeur`, …) conservent leur matrice S1.4 existante.

---

## 3. Client

Le module Notes **ne doit plus** envoyer `auditLog` dans le PUT (journal non writable client → 403).

---

## 4. Tests obligatoires

- enseignant affecté → création acceptée
- enseignant autre classe → 403
- enseignant autre matière → 403
- admin établissement → non traité comme chemin enseignant (matrice BO)
- payload enseignant contenant `payments` / `exams` → rejeté
- `teacherId` client forgé → remplacé par l’id session

---

## 5. Hors périmètre

- API métier dédiée `POST /evaluations` (roadmap ultérieure)
- Réouverture roadmap D3.7 / bulletins
- Élargissement enseignant à d’autres collections BO
