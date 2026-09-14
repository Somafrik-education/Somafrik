"use strict";

function factKey(row) {
  return `${row.student_id}\0${row.subject_id}\0${row.period_id}\0${row.score_component_id}`;
}

function factsFromSnapshot(payload) {
  if (!payload || !Array.isArray(payload.students)) return null;
  const facts = [];
  for (const student of payload.students) {
    if (!student || student.student_id == null || student.student_id === "") continue;
    const cells = Array.isArray(student.cells) ? student.cells : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      if (!cell.subject_id || !cell.period_id || !cell.score_component_id) continue;
      const numeric =
        cell.internal != null && cell.internal !== ""
          ? Number(cell.internal)
          : cell.kind === "NUMERIC" && cell.exposed != null && cell.exposed !== ""
            ? Number(cell.exposed)
            : null;
      facts.push({
        student_id: String(student.student_id),
        subject_id: String(cell.subject_id),
        period_id: String(cell.period_id),
        score_component_id: String(cell.score_component_id),
        raw_score: Number.isFinite(numeric) ? numeric : null,
        subject_applicable: cell.kind !== "NOT_APPLICABLE",
      });
    }
  }
  return facts.length ? facts : null;
}

function overlayFacts(snapshotFacts, liveFacts) {
  if (!Array.isArray(snapshotFacts) || snapshotFacts.length === 0) {
    return Array.isArray(liveFacts) && liveFacts.length ? liveFacts : null;
  }
  const liveByKey = new Map();
  for (const row of liveFacts || []) {
    if (!row) continue;
    const key = factKey(row);
    if (!liveByKey.has(key)) liveByKey.set(key, row);
  }
  return snapshotFacts.map((row) => liveByKey.get(factKey(row)) || row);
}

function mapGradeRow(row) {
  const numeric = row.raw_score == null || row.raw_score === "" ? null : Number(row.raw_score);
  return {
    student_id: String(row.student_id),
    subject_id: String(row.subject_id),
    period_id: String(row.period_id),
    score_component_id: String(row.score_component_id),
    raw_score: Number.isFinite(numeric) ? numeric : null,
    subject_applicable: row.subject_applicable !== false,
  };
}

function isUndefinedTable(err) {
  return Boolean(err && (err.code === "42P01" || err.code === "42703"));
}

function createReportCardFactsPgStore(db) {
  async function withClient(fn) {
    if (typeof db.connect === "function") {
      const client = await db.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }
    return fn(db);
  }

  async function listFacts({ schoolId } = {}) {
    if (!schoolId) return [];
    return withClient(async (client) => {
      try {
        const result = await client.query(
          `SELECT
             COALESCE(NULLIF(st.student_code, ''), g.student_id::text) AS student_id,
             COALESCE(NULLIF(sub.subject_code, ''), g.subject_id::text) AS subject_id,
             t.name AS period_id,
             COALESCE(NULLIF(et.code, ''), NULLIF(e.evaluation_type, ''), g.grade_type) AS score_component_id,
             g.score AS raw_score,
             CASE
               WHEN g.grade_status IN ('exempt', 'excused') THEN FALSE
               ELSE TRUE
             END AS subject_applicable
           FROM grades g
           JOIN students st ON st.id = g.student_id AND st.school_id = g.school_id
           JOIN subjects sub ON sub.id = g.subject_id AND sub.school_id = g.school_id
           JOIN terms t ON t.id = g.term_id
           LEFT JOIN evaluations e ON e.id = g.evaluation_id
           LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
           WHERE g.school_id = $1
             AND COALESCE(g.publication_status, 'published') = 'published'
           ORDER BY g.updated_at DESC NULLS LAST, g.created_at DESC NULLS LAST`,
          [schoolId]
        );
        return result.rows
          .filter((row) => row.student_id && row.subject_id && row.period_id && row.score_component_id)
          .map(mapGradeRow);
      } catch (err) {
        if (isUndefinedTable(err)) return [];
        throw err;
      }
    });
  }

  return { listFacts };
}

function createMemoryFactsStore(seed = []) {
  const rows = Array.isArray(seed) ? seed.slice() : [];
  return {
    listFacts({ schoolId } = {}) {
      return rows
        .filter((row) => !schoolId || row.schoolId === schoolId)
        .flatMap((row) => (Array.isArray(row.facts) ? row.facts : [row]))
        .filter((row) => row && row.student_id);
    },
  };
}

module.exports = {
  createReportCardFactsPgStore,
  createMemoryFactsStore,
  factsFromSnapshot,
  overlayFacts,
  factKey,
};
