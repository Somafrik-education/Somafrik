"use strict";

const { planStudentCardBatch } = require("./studentCardBatchPlan");
const { readStudentCardHolder, assertStudentCardMasterEnabled } = require("./studentAccessCardsManagement");
const { ROSTER_ENROLLMENT_SQL } = require("./studentEnrollmentC18");

/**
 * Précontrôle PostgreSQL, sans jeton et sans mutation.
 * La route appelante DOIT établir le principal scolaire et sa permission effective.
 */
async function previewClassCardBatch(repo, schoolScope, classCode) {
  const schoolId = String(schoolScope?.schoolId ?? "").trim();
  const code = typeof classCode === "string" ? classCode.trim() : "";
  if (!schoolId || schoolScope?.mode !== "school") {
    const err = new Error("Périmètre établissement requis.");
    err.statusCode = 403;
    err.code = "STUDENT_CARD_TENANT_DENIED";
    throw err;
  }
  if (!code || code.length > 128) {
    const err = new Error("Code classe invalide.");
    err.statusCode = 400;
    err.code = "STUDENT_CARD_CLASS_INVALID";
    throw err;
  }
  if (typeof repo?.query !== "function") throw new Error("PostgreSQL requis.");
  await assertStudentCardMasterEnabled(repo, schoolId);
  const classes = await repo.query(
    `SELECT id, name, class_code FROM classes
      WHERE school_id = $1 AND class_code = $2 LIMIT 2`,
    [schoolId, code],
  );
  if (!Array.isArray(classes?.rows)) throw new Error("Lecture PostgreSQL des classes indisponible.");
  const found = classes.rows;
  if (found.length !== 1) {
    const err = new Error("Classe introuvable ou ambiguë.");
    err.statusCode = 404;
    err.code = "STUDENT_CARD_CLASS_NOT_FOUND";
    throw err;
  }
  const roster = await repo.query(
    `SELECT DISTINCT s.id AS student_id
       FROM enrollments e
       JOIN academic_years y ON y.id = e.academic_year_id AND y.school_id = e.school_id AND y.is_current IS TRUE
       JOIN classes c ON c.id = e.class_id AND c.school_id = e.school_id AND c.academic_year_id = y.id
       JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
      WHERE e.school_id = $1 AND c.id = $2 AND ${ROSTER_ENROLLMENT_SQL}
      ORDER BY s.id`,
    [schoolId, found[0].id],
  );
  if (!Array.isArray(roster?.rows)) throw new Error("Lecture PostgreSQL des inscriptions indisponible.");
  const entries = [];
  for (const row of roster.rows) {
    const id = String(row.student_id);
    const active = await repo.query(
      `SELECT 1 FROM student_access_cards WHERE school_id = $1 AND student_id = $2 AND status = 'active' LIMIT 1`,
      [schoolId, id],
    );
    if (!Array.isArray(active?.rows)) throw new Error("Lecture PostgreSQL des cartes indisponible.");
    const holder = await readStudentCardHolder(repo, id, schoolScope);
    entries.push({
      studentId: id,
      hasActiveCard: active.rows.length > 0,
      eligible: true,
      holderKind: holder?.kind ?? null,
    });
  }
  return {
    classCode: found[0].class_code,
    className: found[0].name,
    ...planStudentCardBatch(entries),
  };
}

module.exports = { previewClassCardBatch };
