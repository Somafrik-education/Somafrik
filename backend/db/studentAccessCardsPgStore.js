"use strict";

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    asTrimmed(value),
  );
}

function createStudentAccessCardsPgStore(repo) {
  async function query(sql, params = []) {
    return repo.query(sql, params);
  }

  async function one(sql, params = []) {
    if (typeof repo.one === "function") {
      return (await repo.one(sql, params)) ?? null;
    }
    const result = await query(sql, params);
    return result.rows[0] ?? null;
  }

  async function all(sql, params = []) {
    if (typeof repo.all === "function") {
      return (await repo.all(sql, params)) ?? [];
    }
    const result = await query(sql, params);
    return result.rows ?? [];
  }

  async function findStudentInSchool(schoolId, studentRef) {
    const ref = asTrimmed(studentRef);
    const school = asTrimmed(schoolId);
    if (!school || !ref) return null;
    return one(
      `SELECT id, school_id, student_code, status
         FROM students
        WHERE school_id = $1
          AND (id::text = $2 OR student_code = $2)
        LIMIT 1`,
      [school, ref],
    );
  }

  async function findByPublicIdInSchool(schoolId, publicId) {
    const school = asTrimmed(schoolId);
    const publicRef = asTrimmed(publicId);
    if (!school || !publicRef) return null;
    return one(
      `SELECT id, school_id, student_id, public_id, token_hash, medium, status
         FROM student_access_cards
        WHERE school_id = $1
          AND public_id = $2
        LIMIT 1`,
      [school, publicRef],
    );
  }

  async function findScanStudent(schoolId, studentId) {
    if (!asTrimmed(schoolId) || !isUuid(studentId)) return null;
    return one(
      `SELECT id, student_code, first_name, last_name, photo_url, status
         FROM students
        WHERE school_id = $1
          AND id = $2
        LIMIT 1`,
      [schoolId, studentId],
    );
  }

  async function findRosterClass(schoolId, studentId) {
    if (!asTrimmed(schoolId) || !isUuid(studentId)) return null;
    const { ROSTER_ENROLLMENT_SQL } = require("../lib/studentEnrollmentC18");
    return one(
      `SELECT c.id, c.class_code, c.name
         FROM enrollments e
         INNER JOIN academic_years y
           ON y.id = e.academic_year_id
          AND y.school_id = e.school_id
          AND y.is_current IS TRUE
         INNER JOIN classes c
           ON c.id = e.class_id
          AND c.school_id = e.school_id
          AND c.academic_year_id = e.academic_year_id
        WHERE e.school_id = $1
          AND e.student_id = $2
          AND e.class_id IS NOT NULL
          AND ${ROSTER_ENROLLMENT_SQL}
        LIMIT 1`,
      [schoolId, studentId],
    );
  }

  async function findActive(schoolId, studentId) {
    if (!asTrimmed(schoolId) || !asTrimmed(studentId)) return null;
    return one(
      `SELECT *
         FROM student_access_cards
        WHERE school_id = $1
          AND student_id = $2
          AND status = 'active'
        LIMIT 1`,
      [schoolId, studentId],
    );
  }

  async function getById(schoolId, cardId) {
    if (!asTrimmed(schoolId) || !isUuid(cardId)) return null;
    return one(
      `SELECT *
         FROM student_access_cards
        WHERE id = $1
          AND school_id = $2
        LIMIT 1`,
      [cardId, schoolId],
    );
  }

  async function listByStudent(schoolId, studentId) {
    if (!asTrimmed(schoolId) || !asTrimmed(studentId)) return [];
    return all(
      `SELECT id, school_id, student_id, public_id, medium, status,
              issued_at, revoked_at, revoke_reason, replaced_by_card_id,
              created_at, updated_at
         FROM student_access_cards
        WHERE school_id = $1
          AND student_id = $2
        ORDER BY created_at DESC`,
      [schoolId, studentId],
    );
  }

  async function insert(row) {
    return one(
      `INSERT INTO student_access_cards (
         school_id, student_id, public_id, token_hash, medium, status,
         created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        row.school_id,
        row.student_id,
        row.public_id,
        row.token_hash,
        row.medium,
        row.status || "active",
        isUuid(row.created_by_user_id) ? row.created_by_user_id : null,
      ],
    );
  }

  async function markLost(schoolId, cardId, reason) {
    const updated = await one(
      `UPDATE student_access_cards
          SET status = 'lost',
              revoked_at = NOW(),
              revoke_reason = $3,
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND status = 'active'
        RETURNING *`,
      [cardId, schoolId, asTrimmed(reason) || "lost"],
    );
    if (updated) return updated;
    return null;
  }

  async function markRevoked(schoolId, cardId, reason) {
    const updated = await one(
      `UPDATE student_access_cards
          SET status = 'revoked',
              revoked_at = NOW(),
              revoke_reason = $3,
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND status = 'active'
        RETURNING *`,
      [cardId, schoolId, asTrimmed(reason) || "revoked"],
    );
    if (updated) return updated;
    return null;
  }

  async function replaceAtomicOn(db, options) {
    const schoolId = asTrimmed(options.schoolId);
    const oldCardId = asTrimmed(options.oldCardId);
    if (!isUuid(oldCardId) || !schoolId) {
      const error = new Error("Carte introuvable.");
      error.statusCode = 404;
      error.code = "STUDENT_CARD_NOT_FOUND";
      throw error;
    }

    const locked = await db.one(
      `SELECT *
         FROM student_access_cards
        WHERE id = $1
          AND school_id = $2
        FOR UPDATE`,
      [oldCardId, schoolId],
    );
    if (!locked) {
      const error = new Error("Carte introuvable.");
      error.statusCode = 404;
      error.code = "STUDENT_CARD_NOT_FOUND";
      throw error;
    }
    if (locked.status !== "active" && locked.status !== "lost") {
      const error = new Error("Remplacement impossible dans cet état.");
      error.statusCode = 409;
      error.code = "STUDENT_CARD_INVALID_STATE";
      throw error;
    }

    const newCard = await db.one(
      `INSERT INTO student_access_cards (
         school_id, student_id, public_id, token_hash, medium, status,
         created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, 'issued', $6)
       RETURNING *`,
      [
        schoolId,
        locked.student_id,
        options.newPublicId,
        options.newTokenHash,
        options.medium || locked.medium,
        isUuid(options.createdByUserId) ? options.createdByUserId : null,
      ],
    );

    if (options.failAfterInsert) {
      const injected = new Error("replace injected failure");
      injected.code = "STUDENT_CARD_REPLACE_INJECTED_FAILURE";
      throw injected;
    }

    const oldCard = await db.one(
      `UPDATE student_access_cards
          SET status = 'replaced',
              revoked_at = COALESCE(revoked_at, NOW()),
              revoke_reason = COALESCE(NULLIF(btrim(revoke_reason), ''), 'replaced'),
              replaced_by_card_id = $3,
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
        RETURNING *`,
      [oldCardId, schoolId, newCard.id],
    );

    const activated = await db.one(
      `UPDATE student_access_cards
          SET status = 'active',
              updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND status = 'issued'
        RETURNING *`,
      [newCard.id, schoolId],
    );

    return { oldCard, newCard: activated };
  }

  async function replaceAtomic(options) {
    const exec = async (db) => replaceAtomicOn(
      {
        one: async (sql, params) => {
          if (typeof db.one === "function") return (await db.one(sql, params)) ?? null;
          const result = await db.query(sql, params);
          return result.rows[0] ?? null;
        },
        query: (sql, params) => db.query(sql, params),
      },
      options,
    );
    if (typeof repo.withTransaction === "function") {
      return repo.withTransaction(exec);
    }
    return exec(repo);
  }

  return {
    findStudentInSchool,
    findByPublicIdInSchool,
    findScanStudent,
    findRosterClass,
    findActive,
    getById,
    listByStudent,
    insert,
    markLost,
    markRevoked,
    replaceAtomic,
  };
}

module.exports = {
  createStudentAccessCardsPgStore,
  isUuid,
};
