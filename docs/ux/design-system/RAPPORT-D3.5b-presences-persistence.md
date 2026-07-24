# Rapport D3.5b — Contrat Présences et persistance canonique

**Type :** Contrat données + persistance (pas de chrome DS)  
**Module :** Présences / Appels  
**Impact runtime :** Oui  
**Migration chrome DS / ToolLayout :** Non  
**Notes / Bulletins :** Hors lot  

**Contrat :** [CONTRAT-D3.5b-presences.md](./CONTRAT-D3.5b-presences.md)  
**Prérequis :** tag `d3.5a`

---

## 1. Objectif

Appliquer les décisions CTO D3.5a : journée, enum 4, PG canonique, unicité `school+student+date`, alignement web/mobile/API.

---

## 2. Livrable

| Zone | Changement |
|------|------------|
| `CONTRAT-D3.5b-presences.md` | Contrat normatif |
| `schema.sql` | UNIQUE dans CREATE TABLE (nouvelles bases) ; **pas** d’index unique global bloquant |
| `attendanceUniqueness.js` + `ensureAttendanceCanonicalUniqueness` | Compte → dédup `ROW_NUMBER` (plus récente) → index unique |
| `postgresRepository.upsertAttendance` | `ON CONFLICT` idempotent |
| `dataIntegrityRules` / `server.js` | Même clé ; BO fallback **mémoire seulement** |
| Web + Mobile | `reason` = « Absence justifiée » ; message notif reformulé |
| Tests | `presenceContract.test.js` |

**Interdit (respecté) :** ToolLayout · onglet fiche Élève · notifications réelles · exports · Notes.

---

## 3. Tableau CTO

| Élément | Résultat |
|---------|----------|
| PG canonique | Oui |
| UNIQUE (school_id, student_id, attendance_date) | Oui |
| JSON BO autorité durable | Non |
| Justifié = absence justifiée | Oui |
| Chrome DS | Non |
| Notes / Bulletins | Non |
