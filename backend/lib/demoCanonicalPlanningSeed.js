"use strict";

const { Pool } = require("pg");

function courseCodeForAssignment(schoolCode, ordinal) {
  return `${String(schoolCode || "DEMO").slice(0, 40)}-COURSE-${String(ordinal).padStart(4, "0")}`;
}

function slotForOrdinal(ordinal) {
  const zeroBased = Math.max(0, Number(ordinal) - 1);
  const dayOfWeek = (zeroBased % 5) + 1;
  const hour = 7 + Math.floor(zeroBased / 5);
  if (hour >= 23) {
    throw new Error(`DEMO_PLANNING_SLOT_OVERFLOW:${ordinal}`);
  }
  const startTime = `${String(hour).padStart(2, "0")}:00`;
  const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
  return { dayOfWeek, startTime, endTime };
}

/**
 * Matérialise un planning hebdomadaire canonique à partir des affectations
 * déjà semées. Cette étape est strictement réservée à la base Démo resettable.
 *
 * Un créneau horaire globalement unique est attribué à chaque affectation d'un
 * établissement. Cela garantit mécaniquement l'absence de chevauchement classe
 * et enseignant tout en alimentant la vraie table V2 consommée par l'API.
 */
async function seedDemoCanonicalPlanning(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM course_schedule_weekly_slots");

    const assignments = await client.query(
      `SELECT
         ta.id AS assignment_id,
         ta.school_id,
         ta.class_id,
         ta.subject_id,
         ta.teacher_id,
         ta.academic_year_id,
         s.school_code,
         COALESCE(sub.coefficient, 1) AS coefficient
       FROM teacher_assignments ta
       JOIN schools s ON s.id = ta.school_id
       JOIN subjects sub ON sub.id = ta.subject_id
       WHERE ta.status = 'active'
       ORDER BY ta.school_id, ta.created_at, ta.id`,
    );

    const schoolOrdinals = new Map();
    let courses = 0;
    let slots = 0;

    for (const assignment of assignments.rows) {
      const schoolKey = String(assignment.school_id);
      const ordinal = (schoolOrdinals.get(schoolKey) || 0) + 1;
      schoolOrdinals.set(schoolKey, ordinal);

      const courseCode = courseCodeForAssignment(assignment.school_code, ordinal);
      await client.query(
        `INSERT INTO school_courses
           (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, legacy_json_id, profile_payload)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          assignment.school_id,
          assignment.class_id,
          assignment.subject_id,
          assignment.teacher_id,
          courseCode,
          assignment.coefficient,
          `DEMO-${assignment.assignment_id}`,
          JSON.stringify({ source: "demo-canonical-planning-seed" }),
        ],
      );

      const course = await client.query(
        `SELECT id
         FROM school_courses
         WHERE school_id = $1
           AND class_id = $2
           AND subject_id = $3
           AND status = 'active'
         ORDER BY created_at, id
         LIMIT 1`,
        [assignment.school_id, assignment.class_id, assignment.subject_id],
      );
      const courseId = course.rows[0]?.id;
      if (!courseId) {
        throw new Error(`DEMO_PLANNING_COURSE_NOT_FOUND:${assignment.assignment_id}`);
      }
      courses += 1;

      const slot = slotForOrdinal(ordinal);
      await client.query(
        `INSERT INTO course_schedule_weekly_slots
           (school_id, academic_year_id, school_course_id, class_id, teacher_id,
            day_of_week, start_time, end_time, status, room)
         VALUES ($1,$2,$3,$4,$5,$6,$7::time,$8::time,'active',$9)`,
        [
          assignment.school_id,
          assignment.academic_year_id,
          courseId,
          assignment.class_id,
          assignment.teacher_id,
          slot.dayOfWeek,
          slot.startTime,
          slot.endTime,
          `Salle ${(ordinal % 8) + 1}`,
        ],
      );
      slots += 1;
    }

    if (slots < 1) {
      throw new Error("DEMO_CANONICAL_PLANNING_EMPTY");
    }

    await client.query("COMMIT");
    return {
      assignments: assignments.rowCount,
      courses,
      slots,
      schools: schoolOrdinals.size,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = {
  courseCodeForAssignment,
  slotForOrdinal,
  seedDemoCanonicalPlanning,
};
