"use strict";

const { weightedAverage } = require("../lib/gradesCanonical");

function factKey(row) {
  return `${row.student_id}\0${row.subject_id}\0${row.period_id}\0${row.score_component_id}`;
}

function identitiesFromSnapshot(payload) {
  if (!payload || !Array.isArray(payload.students)) return null;
  const identities = [];
  const seen = new Set();
  for (const student of payload.students) {
    if (!student || student.student_id == null || student.student_id === "") continue;
    const cells = Array.isArray(student.cells) ? student.cells : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      if (!cell.subject_id || !cell.period_id || !cell.score_component_id) continue;
      const identity = {
        student_id: String(student.student_id),
        subject_id: String(cell.subject_id),
        period_id: String(cell.period_id),
        score_component_id: String(cell.score_component_id),
      };
      const key = factKey(identity);
      if (seen.has(key)) continue;
      seen.add(key);
      identities.push(identity);
    }
  }
  return identities.length ? identities : null;
}

function resolveFacts(identities, liveFacts) {
  if (!Array.isArray(identities) || identities.length === 0) return null;
  if (!Array.isArray(liveFacts)) return null;
  const liveByKey = new Map();
  for (const row of liveFacts) {
    if (!row) continue;
    const key = factKey(row);
    if (!liveByKey.has(key)) liveByKey.set(key, row);
  }
  const resolved = [];
  for (const identity of identities) {
    const live = liveByKey.get(factKey(identity));
    if (!live) return null;
    resolved.push({
      student_id: identity.student_id,
      subject_id: identity.subject_id,
      period_id: identity.period_id,
      score_component_id: identity.score_component_id,
      raw_score: live.raw_score,
      subject_applicable: live.subject_applicable !== false,
    });
  }
  return resolved;
}

function toAverageNote(row) {
  return {
    score: row.score,
    value: row.score,
    maxScore: row.max_score,
    scale: row.max_score,
    coefficient: row.coefficient,
    evaluationCoefficient: row.coefficient,
    gradeStatus: row.grade_status,
    status: row.grade_status,
  };
}

function aggregateCanonicalFacts(gradeRows, { scaleByComponent } = {}) {
  if (!scaleByComponent || typeof scaleByComponent !== "object" || Array.isArray(scaleByComponent)) {
    return [];
  }
  const groups = new Map();
  for (const row of gradeRows || []) {
    if (!row || !row.student_id || !row.subject_id || !row.period_id || !row.score_component_id) continue;
    const key = factKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const facts = [];
  for (const rows of groups.values()) {
    const identity = rows[0];
    const displayScale = Number(scaleByComponent[identity.score_component_id]);
    if (!Number.isFinite(displayScale) || !(displayScale > 0)) continue;
    const { average, totalCoefficients } = weightedAverage(rows.map(toAverageNote), { displayScale });
    if (!totalCoefficients) {
      facts.push({
        student_id: String(identity.student_id),
        subject_id: String(identity.subject_id),
        period_id: String(identity.period_id),
        score_component_id: String(identity.score_component_id),
        raw_score: null,
        subject_applicable: false,
      });
      continue;
    }
    facts.push({
      student_id: String(identity.student_id),
      subject_id: String(identity.subject_id),
      period_id: String(identity.period_id),
      score_component_id: String(identity.score_component_id),
      raw_score: average,
      subject_applicable: true,
    });
  }
  return facts;
}

function scaleByComponentFromProfile(profile) {
  if (!profile || !Array.isArray(profile.score_components)) return null;
  const scaleByComponent = {};
  for (const component of profile.score_components) {
    if (!component || component.id == null) return null;
    const max = Number(component.max);
    if (!Number.isFinite(max) || !(max > 0)) return null;
    scaleByComponent[String(component.id)] = max;
  }
  return Object.keys(scaleByComponent).length ? scaleByComponent : null;
}

function isUndefinedRelation(err) {
  return Boolean(err && (err.code === "42P01" || err.code === "42703"));
}

function schemaUnavailable() {
  const err = new Error("FACTS_REQUIRED");
  err.code = "FACTS_REQUIRED";
  return err;
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

  async function resolveCohort({ schoolId, classId, academicYearId } = {}) {
    if (!schoolId || !classId || !academicYearId) return null;
    return withClient(async (client) => {
      try {
        const result = await client.query(
          `SELECT c.id AS class_id, c.academic_year_id
             FROM classes c
            WHERE c.school_id = $1
              AND c.id = $2
              AND c.academic_year_id = $3`,
          [schoolId, classId, academicYearId]
        );
        if (!result.rowCount) return null;
        return {
          classId: result.rows[0].class_id,
          academicYearId: result.rows[0].academic_year_id,
        };
      } catch (err) {
        if (isUndefinedRelation(err)) throw schemaUnavailable();
        throw err;
      }
    });
  }

  async function listFacts({ schoolId, classId, academicYearId, scaleByComponent } = {}) {
    if (!schoolId || !classId || !academicYearId) return [];
    if (!scaleByComponent || typeof scaleByComponent !== "object") return [];
    return withClient(async (client) => {
      try {
        const result = await client.query(
          `SELECT
             COALESCE(NULLIF(st.student_code, ''), g.student_id::text) AS student_id,
             COALESCE(NULLIF(sub.subject_code, ''), g.subject_id::text) AS subject_id,
             t.name AS period_id,
             COALESCE(NULLIF(et.code, ''), NULLIF(e.evaluation_type, ''), g.grade_type) AS score_component_id,
             g.score AS score,
             COALESCE(e.max_score, g.max_score) AS max_score,
             COALESCE(e.coefficient, g.coefficient, 1) AS coefficient,
             g.grade_status AS grade_status
           FROM grades g
           JOIN students st ON st.id = g.student_id AND st.school_id = g.school_id
           JOIN subjects sub ON sub.id = g.subject_id AND sub.school_id = g.school_id
           JOIN terms t ON t.id = g.term_id
           JOIN classes c ON c.id = g.class_id AND c.school_id = g.school_id
           LEFT JOIN evaluations e ON e.id = g.evaluation_id
           LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
           WHERE g.school_id = $1
             AND g.class_id = $2
             AND t.academic_year_id = $3
             AND c.academic_year_id = $3
             AND g.publication_status = 'published'
             AND (e.id IS NULL OR e.status = 'published')`,
          [schoolId, classId, academicYearId]
        );
        return aggregateCanonicalFacts(result.rows, { scaleByComponent });
      } catch (err) {
        if (isUndefinedRelation(err)) throw schemaUnavailable();
        throw err;
      }
    });
  }

  /**
   * BULLETIN-PUBLISH-01 — inscrits actifs de la classe pour l'année (établissement
   * imposé). Un élève inscrit sans note figure au bulletin (notes MISSING).
   */
  async function listClassCohort({ schoolId, classId, academicYearId } = {}) {
    if (!schoolId || !classId || !academicYearId) return [];
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT st.id::text AS student_uuid, st.student_code, st.school_id::text AS student_school_id
           FROM enrollments e
           JOIN students st ON st.id = e.student_id
          WHERE e.school_id = $1 AND e.class_id = $2 AND e.academic_year_id = $3
            AND lower(btrim(e.status)) IN ('active', 'enrolled')
            AND COALESCE(st.status, 'active') <> 'archived'
          ORDER BY st.student_code COLLATE "C"`,
        [schoolId, classId, academicYearId]
      );
      return result.rows;
    });
  }

  /**
   * BULLETIN-PUBLISH-01 — toutes les notes de la classe (publiées ou non), avec les
   * références nécessaires au rattachement : élève, matière (+ parent), trimestre,
   * évaluation (statut, type, maximum, coefficient), cours de la classe (matière ou
   * matière principale). Les écarts d'établissement sont renvoyés pour être signalés.
   */
  async function listClassGradeSources({ schoolId, classId, academicYearId } = {}) {
    if (!schoolId || !classId || !academicYearId) return [];
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT g.id::text AS grade_id, g.school_id::text AS grade_school_id,
                st.id::text AS student_uuid, st.student_code, st.school_id::text AS student_school_id,
                sub.subject_code, sub.school_id::text AS subject_school_id, sub.status AS subject_status,
                parent.subject_code AS subject_parent_code,
                t.name AS term_name, t.academic_year_id::text AS term_year_id,
                e.id::text AS evaluation_id, e.school_id::text AS evaluation_school_id,
                e.status AS evaluation_status, e.active AS evaluation_active,
                et.code AS evaluation_type_code, e.evaluation_type AS evaluation_type_text,
                COALESCE(e.max_score, g.max_score) AS max_score,
                COALESCE(e.coefficient, g.coefficient, 1) AS coefficient,
                g.score, g.grade_status, g.publication_status,
                (SELECT sc.id::text
                   FROM school_courses sc
                  WHERE sc.school_id = c.school_id
                    AND sc.class_id = g.class_id
                    AND sc.status = 'active'
                    AND (sc.subject_id = g.subject_id OR sc.subject_id = sub.parent_subject_id)
                  ORDER BY (sc.subject_id = g.subject_id) DESC, sc.id
                  LIMIT 1) AS course_id
           FROM grades g
           JOIN classes c ON c.id = g.class_id
           JOIN students st ON st.id = g.student_id
           JOIN subjects sub ON sub.id = g.subject_id
           LEFT JOIN subjects parent ON parent.id = sub.parent_subject_id
           JOIN terms t ON t.id = g.term_id
           LEFT JOIN evaluations e ON e.id = g.evaluation_id
           LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
          WHERE c.school_id = $1 AND g.class_id = $2 AND c.academic_year_id = $3
          ORDER BY g.id`,
        [schoolId, classId, academicYearId]
      );
      return result.rows;
    });
  }

  /** Évaluations publiées de cette classe/année, y compris celles sans aucune note.
   * Lecture bornée par le tenant, la classe et l'année ; aucune mutation.
   */
  async function listClassEvaluationSources({ schoolId, classId, academicYearId } = {}) {
    if (!schoolId || !classId || !academicYearId) return [];
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT e.id::text AS evaluation_id, e.school_id::text AS evaluation_school_id,
                e.title AS evaluation_title, e.status AS evaluation_status, e.active AS evaluation_active,
                sub.subject_code, sub.school_id::text AS subject_school_id,
                t.name AS term_name, t.academic_year_id::text AS term_year_id,
                et.code AS evaluation_type_code, e.evaluation_type AS evaluation_type_text
           FROM evaluations e
           JOIN classes c ON c.id = e.class_id AND c.school_id = e.school_id AND c.academic_year_id = $3
           JOIN subjects sub ON sub.id = e.subject_id AND sub.school_id = e.school_id
           JOIN terms t ON t.id = e.term_id AND t.academic_year_id = c.academic_year_id
           LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id AND et.school_id = e.school_id
          WHERE e.school_id = $1 AND e.class_id = $2 AND e.status = 'published' AND e.active IS TRUE
          ORDER BY e.id`,
        [schoolId, classId, academicYearId]
      );
      return result.rows;
    });
  }

  return { listFacts, resolveCohort, listClassCohort, listClassGradeSources, listClassEvaluationSources };
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
    resolveCohort({ classId, academicYearId } = {}) {
      if (!classId || !academicYearId) return null;
      return { classId, academicYearId };
    },
  };
}

module.exports = {
  createReportCardFactsPgStore,
  createMemoryFactsStore,
  identitiesFromSnapshot,
  resolveFacts,
  aggregateCanonicalFacts,
  scaleByComponentFromProfile,
  factKey,
  isUndefinedRelation,
};
