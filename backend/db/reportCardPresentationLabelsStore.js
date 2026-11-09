"use strict";

/**
 * BULLETIN-UI-01 — libellés d'affichage d'un bulletin (lecture seule).
 *
 * Toutes les requêtes sont bornées à l'établissement du bulletin
 * (`school_id = $1`) : un code d'élève, de matière ou de classe d'un autre
 * établissement ne renvoie rien. Aucun résultat scolaire n'est lu ici : les
 * résultats viennent exclusivement du snapshot publié ou du brouillon calculé.
 */

function text(value) {
  return value == null ? "" : String(value).trim();
}

function uniqueTexts(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function createReportCardPresentationLabelsPgStore(db) {
  if (!db || typeof db.query !== "function") throw new Error("PostgreSQL requis.");

  async function getLabels({ schoolId, classId, academicYearId, subjectCodes, studentCodes } = {}) {
    const tenant = text(schoolId);
    if (!tenant) {
      const err = new Error("TENANT_REQUIRED");
      err.code = "TENANT_REQUIRED";
      throw err;
    }
    const subjects = uniqueTexts(subjectCodes);
    const students = uniqueTexts(studentCodes);
    const [school, klass, year, subjectRows, studentRows] = await Promise.all([
      db.query(`SELECT name FROM schools WHERE id::text = $1`, [tenant]),
      text(classId)
        ? db.query(`SELECT name FROM classes WHERE school_id::text = $1 AND id::text = $2`, [tenant, text(classId)])
        : { rows: [] },
      text(academicYearId)
        ? db.query(`SELECT name FROM academic_years WHERE school_id::text = $1 AND id::text = $2`, [tenant, text(academicYearId)])
        : { rows: [] },
      subjects.length
        ? db.query(`SELECT subject_code, name FROM subjects WHERE school_id::text = $1 AND subject_code = ANY($2::text[])`, [
            tenant,
            subjects,
          ])
        : { rows: [] },
      students.length
        ? db.query(
            `SELECT student_code, first_name, last_name FROM students WHERE school_id::text = $1 AND student_code = ANY($2::text[])`,
            [tenant, students]
          )
        : { rows: [] },
    ]);
    const subjectLabels = {};
    for (const row of subjectRows.rows) if (text(row.name)) subjectLabels[row.subject_code] = text(row.name);
    const studentLabels = {};
    for (const row of studentRows.rows) {
      const name = [text(row.last_name), text(row.first_name)].filter(Boolean).join(" ");
      if (name) studentLabels[row.student_code] = { name };
    }
    return {
      school: text(school.rows[0] && school.rows[0].name) || null,
      className: text(klass.rows[0] && klass.rows[0].name) || null,
      academicYear: text(year.rows[0] && year.rows[0].name) || null,
      subjects: subjectLabels,
      students: studentLabels,
    };
  }

  return { getLabels };
}

module.exports = { createReportCardPresentationLabelsPgStore };
