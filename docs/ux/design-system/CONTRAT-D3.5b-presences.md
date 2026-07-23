# Contrat Présences — D3.5b

**Lot :** D3.5b — Contrat Présences et persistance canonique  
**Statut :** normatif  
**Base :** tag `d3.5a` · décisions CTO [AUDIT-D3.5 §10](./AUDIT-D3.5-presences.md#10-décisions-cto--arbitrages-du-gate)  
**Hors lot :** ToolLayout / chrome DS · onglet fiche Élève · notifications · exports PDF/Excel · Notes / Bulletins · séances

---

## 1. Surfaces

| Surface | Rôle |
|---------|------|
| Web `/presences` | Appel / correction administrative (canonique web) |
| Mobile enseignant | Appel terrain — **même contrat API** |
| Mobile parent / élève | Lecture historique |
| Dashboard | Agrégats uniquement |

---

## 2. Statuts

| Statut UI | Stockage PG | Signification D3.5 |
|-----------|-------------|--------------------|
| `Présent` | `present` | Présent |
| `Absent` | `absent` | Absence non justifiée |
| `Retard` | `late` | Retard (compté présent pour le taux) |
| `Justifié` | `excused` | **Absence justifiée** |

Pas de sortie anticipée, pas de double axe Absent×justification, pas de justificatif documentaire dans D3.5.

---

## 3. Granularité et clé

- Granularité : **journée entière**
- Clé fonctionnelle : `établissement + élève + date`
- Contrainte PG : `UNIQUE (school_id, student_id, attendance_date)`
- Upsert **idempotent**
- `hour` / `arrivalTime` : non persistés — ne pas les présenter comme granularité

---

## 4. Persistance

| Store | Rôle |
|-------|------|
| **PostgreSQL `attendance`** | Source d’autorité canonique |
| JSON BackOffice `presences` | Transitoire / secours **mémoire uniquement** — pas d’autorité durable |

En moteur `postgresql`, l’écriture API ne doit pas basculer silencieusement vers le JSON comme seconde autorité.

---

## 5. API

`POST /api/presences` : batch `{ className, date, items[] }` → upsert par clé ci-dessus.  
`GET /api/presences`, `GET /api/students/:id/presences` : lecture.

Web et mobile doivent émettre les mêmes statuts et la même sémantique de date.
