# P0 — Taux de présence par classe (vérité des données)

Date : 2026-08-24  
Branche : `cursor/p0-class-attendance-rate-truth-d0b9`  
Base : `origin/develop`  
Priorité : **P0 DATA TRUTH**  
PR Draft uniquement. Aucun Ready. Aucun merge.

---

## Cause racine

`ClassesScreen` calculait :

```ts
getPresenceStats(rows, classStudents.map((student) => student.id)).rate
```

et `getPresenceStats` / `getPaymentStats` faisaient :

```ts
const scopedRows = studentIds?.length ? rows.filter(...) : rows;
```

Donc `studentIds = []` (classe sans élève) tombait sur **toutes les présences** de l'établissement. Une classe vide héritait du taux global — d'où `1ère A · 0 élève · Présence 71 %`.

Un `if (classStudents.length === 0) afficher 0%` aurait masqué le défaut sans corriger le contrat `[] ≠ dataset global`.

Second défaut : le roster de classe était lié par `classNameMatches(student.className, item.name)` au lieu de `student.classId === class.id`.

---

## Contrat avant / après

| Entrée | Avant | Après |
| ------ | ----- | ----- |
| `studentIds === undefined` | dataset global | dataset global (inchangé, autorisé) |
| `studentIds = []` | **toutes les lignes** | **zéro ligne** (`total=0`, `attended=0`, `rate=0`) |
| `studentIds = [...]` | ces élèves | ces élèves |

Équivalent :

```ts
const scopedRows =
  studentIds === undefined
    ? presences
    : presences.filter((presence) => studentIds.includes(presence.studentId));
```

Garde-fou nommé : **empty scoped ids MUST NOT fallback to global dataset** (`getPresenceStats` + `getPaymentStats`).

---

## Vérité métier du badge (liste Classes)

Période retenue : **aujourd'hui**, jour civil de l'établissement (`Africa/Kinshasa` par défaut, même helper que le KPI Accueil « Présence du jour »).

Ce n'est **pas** une moyenne historique. Si le produit veut une moyenne, le libellé devra dire `Présence moyenne 92 %` avec période documentée.

| Situation | Badge |
| --------- | ----- |
| 0 élève attendu | `Présence —` (jamais un %) |
| Élèves, aucun appel confirmé aujourd'hui | `Non saisi` (jamais `0 %`) |
| Appel confirmé aujourd'hui (`recorded === expected`) | `Présence 75 %` |
| Snapshot loading / idle | `Présence —` |
| Snapshot error / offline sans cache | `Présence Indisponible` |
| Ligne absente en base | ≠ élève absent (appel partiel → `Non saisi`) |
| Présent + Retard | assistés |
| Absent + Justifié | non assistés |

---

## Identité et isolation

Source de vérité : `student.classId === class.id` via `filterStudentsByClassIdentity` (puis `classCode`). Le nom humain n'est plus la clé.

Pour chaque ligne retenue :

| Champ | Règle |
| ----- | ----- |
| `schoolId` / `schoolCode` | isolation tenant **fail-closed** : schoolCode manquant sur la ligne ou l’élève → hors scope |
| `classId` / `classCode` | doit matcher la classe affichée ; ligne sans `classId`/`classCode` → hors scope |
| `studentId` | roster d'inscription active de **cette** classe |
| `date` | jour civil courant uniquement |
| `status` | `present`/`late` = assisté ; `absent`/`excused` = non assisté |
| enrollment | `isExpectedStudentForToday` (non archivé, non transféré) |

Élève transféré A → B : les présences `class_id = A` n'alimentent pas le badge de B. A n'a plus l'élève dans son roster actif.

Deux classes « 1ère A » : aucun mélange.

---

## Preuve SQL / API → Mobile

PostgreSQL (`attendance`, via `PostgresRepository.mapAttendance`) expose déjà :

`school_id`, `school_code`, `student_code`, `class_id`, `class_code`, `attendance_date`, `status`

```sql
-- Taux du jour d'une classe, uniquement si l'appel est complet
SELECT
  c.id AS class_id,
  c.name,
  COUNT(e.student_id) FILTER (WHERE e.status = 'active') AS expected,
  COUNT(a.id) AS recorded,
  COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) AS attended
FROM classes c
JOIN enrollments e
  ON e.class_id = c.id
 AND e.school_id = c.school_id
 AND e.status = 'active'
LEFT JOIN attendance a
  ON a.student_id = e.student_id
 AND a.school_id = c.school_id
 AND a.class_id = c.id
 AND a.attendance_date = CURRENT_DATE
WHERE c.id = $1
GROUP BY c.id, c.name;
-- Mobile n'affiche un % que si recorded = expected AND expected > 0
-- rate = round(attended / expected * 100)
```

API : `GET /api/presences` → `mapAttendance` → Mobile `presencesSnapshot`.  
Mobile : `resolveClassTodayPresenceBadge` (période today + classId + tenant).  
Finance : même contrat de scope sur `getPaymentStats` ; **pas de changement UX Finance**.

---

## Tests

| Cas | Attendu |
| --- | -------- |
| A. Classe 0 élève + présences ailleurs | `Présence —`, pas 71 % |
| B. 4 élèves, aucun appel aujourd'hui | `Non saisi` |
| C. 3 Présent + 1 Absent | `75 %` |
| D. 2 Présent + 1 Retard + 1 Justifié | `75 %` |
| E. Appel d'hier uniquement | `Non saisi` |
| F. Deux classes même nom | pas de contamination |
| G. Transfert A → B | scope inscription active + période |
| H. Autre établissement | isolation tenant |
| I. loading / offline / error | jamais un % inventé |

Fichiers : `schoolMetrics.test.ts`, `classTodayPresenceBadge.test.ts`, `classesScreenPresenceContract.test.ts`, `verify:mobile-class-attendance-rate`.

---

## Capture cible (cas de la capture)

`1ère A` · `0 élève` · **Présence —**

Voir `docs/audits/evidence/class-attendance-rate-1ere-a-corrected.html`.
