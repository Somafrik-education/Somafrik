"use strict";

/**
 * Charge un school_course déjà matérialisé par le bootstrap canonique.
 * Les verifiers HTTP ne recréent plus le cours (unicité class+subject active).
 */
const { Pool } = require("pg");

async function loadReconciledSchoolCourseId(databaseUrl, { className, subjectName }) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `SELECT sc.id
       FROM school_courses sc
       JOIN classes c ON c.id = sc.class_id
       JOIN subjects sub ON sub.id = sc.subject_id
       WHERE c.name = $1 AND sub.name = $2 AND sc.status = 'active'`,
      [className, subjectName],
    );
    if (result.rows.length !== 1) {
      throw new Error(
        `school_course réconcilié attendu unique (${className} / ${subjectName}), trouvé ${result.rows.length}`,
      );
    }
    return result.rows[0].id;
  } finally {
    await pool.end();
  }
}

module.exports = { loadReconciledSchoolCourseId };
