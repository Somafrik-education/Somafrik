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
      `SELECT id, school_id, student_id, public_id, token_hash, medium, status, nfc_encoding_state
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
              nfc_uid, nfc_tag_type, nfc_encoding_state, nfc_encoded_at, nfc_locked_at,
              nfc_operation_id, nfc_reservation_expires_at, nfc_replaces_card_id,
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
         created_by_user_id, nfc_uid, nfc_tag_type, nfc_encoding_state,
         nfc_operation_id, nfc_reservation_expires_at, nfc_replaces_card_id, issued_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, NOW()))
       RETURNING *`,
      [
        row.school_id,
        row.student_id,
        row.public_id,
        row.token_hash,
        row.medium,
        row.status || "active",
        isUuid(row.created_by_user_id) ? row.created_by_user_id : null,
        row.nfc_uid || null, row.nfc_tag_type || null, row.nfc_encoding_state || null,
        row.nfc_operation_id || null, row.nfc_reservation_expires_at || null, row.nfc_replaces_card_id || null,
        row.issued_at || null,
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
          AND status IN ('active', 'issued')
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

  async function rotatePendingNfc(schoolId, cardId, uid, tagType, previousHash, nextHash, operationId) {
    return one(
      `UPDATE student_access_cards SET token_hash = $6, updated_at = NOW(),
              nfc_retry_operation_ids = array_append(nfc_retry_operation_ids, $7::uuid)
       WHERE id = $1 AND school_id = $2 AND nfc_uid = $3 AND nfc_tag_type = $4
         AND token_hash = $5 AND status = 'issued' AND nfc_encoding_state = 'pending'
         AND nfc_reservation_expires_at > clock_timestamp()
         AND NOT ($7::uuid = ANY(nfc_retry_operation_ids))
       RETURNING *`,
      [cardId, schoolId, uid, tagType, previousHash, nextHash, operationId],
    );
  }

  async function confirmNfc(schoolId, cardId, uid, tagType, locked, expectedHash) {
    return one(
      `UPDATE student_access_cards
          SET status = 'active',
              nfc_encoding_state = CASE WHEN $5 OR nfc_encoding_state = 'locked' THEN 'locked' ELSE 'encoded' END,
              nfc_encoded_at = COALESCE(nfc_encoded_at, NOW()),
              nfc_locked_at = CASE WHEN $5 THEN COALESCE(nfc_locked_at, NOW()) ELSE nfc_locked_at END,
              updated_at = NOW()
        WHERE id = $1 AND school_id = $2 AND nfc_uid = $3 AND nfc_tag_type = $4
          AND token_hash = $6
          AND ((status = 'issued' AND nfc_encoding_state = 'pending'
                AND nfc_reservation_expires_at > clock_timestamp())
            OR (status = 'active' AND nfc_encoding_state IN ('encoded', 'locked')))
        RETURNING *`,
      [cardId, schoolId, uid, tagType, locked, expectedHash],
    );
  }

  // Re-activate the SAME UID row only. A lock is held by lifecycle transaction.
  async function recoverExpiredNfc(schoolId, cardId, uid, tagType, tokenHash) {
    return one(
      `UPDATE student_access_cards
          SET status = 'active', nfc_encoding_state = 'encoded',
              nfc_encoded_at = clock_timestamp(), revoked_at = NULL,
              revoke_reason = NULL, updated_at = clock_timestamp()
        WHERE id = $1 AND school_id = $2 AND nfc_uid = $3
          AND nfc_tag_type = $4 AND token_hash = $5
          AND status = 'revoked' AND revoke_reason = 'nfc_reservation_expired'
          AND nfc_encoded_at IS NULL AND nfc_replaces_card_id IS NULL
        RETURNING *`,
      [cardId, schoolId, uid, tagType, tokenHash],
    );
  }

  async function lockStudent(schoolId, studentId) {
    return one("SELECT id FROM students WHERE school_id = $1 AND id = $2 FOR NO KEY UPDATE", [schoolId, studentId]);
  }

  async function lockCard(schoolId, cardId) {
    if (!isUuid(cardId)) return null;
    return one(`SELECT *, nfc_reservation_expires_at <= clock_timestamp() AS reservation_expired
      FROM student_access_cards WHERE school_id = $1 AND id = $2 FOR UPDATE`, [schoolId, cardId]);
  }

  async function findNfcOperation(schoolId, operationId) {
    return one("SELECT * FROM student_access_cards WHERE school_id = $1 AND nfc_operation_id = $2", [schoolId, operationId]);
  }

  async function findPendingNfc(schoolId, studentId) {
    return one(`SELECT * FROM student_access_cards WHERE school_id = $1 AND student_id = $2
      AND status = 'issued' AND nfc_encoding_state = 'pending'`, [schoolId, studentId]);
  }

  async function expirePendingNfc(schoolId, studentId) {
    return all(`UPDATE student_access_cards SET status = 'revoked', revoked_at = clock_timestamp(),
      revoke_reason = 'nfc_reservation_expired', updated_at = clock_timestamp()
      WHERE school_id = $1 AND student_id = $2 AND status = 'issued' AND nfc_encoding_state = 'pending'
        AND nfc_reservation_expires_at <= clock_timestamp() RETURNING *`, [schoolId, studentId]);
  }

  async function queryReplacementPrevious(schoolId, oldCardId, newCardId) {
    return one(`UPDATE student_access_cards SET status = 'replaced', revoked_at = COALESCE(revoked_at, NOW()),
      revoke_reason = 'replaced', replaced_by_card_id = $3, updated_at = NOW()
      WHERE school_id = $1 AND id = $2 AND status IN ('active', 'lost') RETURNING *`, [schoolId, oldCardId, newCardId]);
  }

  return {
    lockStudent, lockCard, findNfcOperation, findPendingNfc, expirePendingNfc, queryReplacementPrevious,
    rotatePendingNfc,
    confirmNfc,
    recoverExpiredNfc,
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
