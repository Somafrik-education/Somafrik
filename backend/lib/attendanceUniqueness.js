/**
 * D3.5b — Unicité présences PG (école + élève + jour).
 *
 * Ordre obligatoire pour bases legacy :
 * 1. schéma non bloquant (sans index unique global)
 * 2. déduplication déterministe (ligne la plus récente conservée)
 * 3. création de l'index unique
 */

/** Compte les groupes (school_id, student_id, attendance_date) ayant > 1 ligne. */
const COUNT_ATTENDANCE_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, student_id, attendance_date
    FROM attendance
    GROUP BY school_id, student_id, attendance_date
    HAVING COUNT(*) > 1
  ) d
`;

/**
 * Supprime les doublons en conservant la ligne la plus récente :
 * updated_at DESC, created_at DESC, id DESC.
 */
const DEDUP_ATTENDANCE_KEEP_LATEST_SQL = `
  DELETE FROM attendance
  WHERE id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY school_id, student_id, attendance_date
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS row_number
      FROM attendance
    ) ranked
    WHERE ranked.row_number > 1
  )
`;

const CREATE_ATTENDANCE_UNIQUE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_school_student_date
  ON attendance (school_id, student_id, attendance_date)
`;

/**
 * Sélectionne la ligne canonique d'un groupe de doublons (miroir SQL ORDER BY).
 * Utilisé par les tests unitaires sans PostgreSQL.
 */
function pickCanonicalAttendanceRow(rows = []) {
  const list = Array.isArray(rows) ? [...rows] : [];
  list.sort((left, right) => {
    const updated = compareDesc(left.updated_at, right.updated_at);
    if (updated !== 0) return updated;
    const created = compareDesc(left.created_at, right.created_at);
    if (created !== 0) return created;
    return compareDesc(String(left.id ?? ""), String(right.id ?? ""));
  });
  return list[0] ?? null;
}

function compareDesc(left, right) {
  const a = toSortable(left);
  const b = toSortable(right);
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a > b ? -1 : 1;
}

function toSortable(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  const asDate = Date.parse(String(value));
  if (!Number.isNaN(asDate)) return asDate;
  return String(value);
}

module.exports = {
  COUNT_ATTENDANCE_DUPLICATE_GROUPS_SQL,
  DEDUP_ATTENDANCE_KEEP_LATEST_SQL,
  CREATE_ATTENDANCE_UNIQUE_INDEX_SQL,
  pickCanonicalAttendanceRow,
};
