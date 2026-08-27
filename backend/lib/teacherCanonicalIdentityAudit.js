"use strict";

/**
 * Inventaire read-only teacher ↔ user ↔ assignments.
 * Matching par nom = outil ops uniquement. Jamais utilisé par GET /assignments.
 */

const TEACHER_ROLE_KEYS = new Set(["TEACHER", "ENSEIGNANT"]);

function asText(value) {
  return String(value ?? "").trim();
}

function normName(value) {
  return asText(value).toLowerCase().replace(/\s+/g, " ");
}

function parsePersonName(raw) {
  const parts = normName(raw)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return { first: parts[0] || "", last: parts[1] || "" };
  }
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function namesMatch(firstName, lastName, query) {
  const first = normName(firstName);
  const last = normName(lastName);
  const { first: qFirst, last: qLast } = parsePersonName(query);
  if (!qFirst || !qLast) return false;
  return (
    (first.includes(qFirst) && last.includes(qLast)) ||
    (first.includes(qLast) && last.includes(qFirst))
  );
}

function isTeacherRole(role) {
  const key = asText(role).toUpperCase().replace(/\s+/g, "_");
  return TEACHER_ROLE_KEYS.has(key) || key === "ENSEIGNANT";
}

function classifyInventory(inventory, options = {}) {
  const users = Array.isArray(inventory?.users) ? inventory.users : [];
  const teachers = Array.isArray(inventory?.teachers) ? inventory.teachers : [];
  const assignments = (Array.isArray(inventory?.assignments) ? inventory.assignments : []).filter(
    (row) => asText(row.status).toLowerCase() === "active",
  );
  const expected = Number(options.expectedAssignments);
  const expectedAssignments = Number.isFinite(expected) && expected > 0 ? expected : null;

  if (!users.length) {
    return { verdict: "NOT_FOUND", repairable: false, reason: "aucun user correspondant" };
  }
  if (users.length > 1) {
    return {
      verdict: "AMBIGUOUS_USERS",
      repairable: false,
      reason: `${users.length} users correspondent — aucune mutation`,
    };
  }

  const user = users[0];
  const linked = teachers.filter((row) => asText(row.teacher_user_id) === asText(user.user_id));
  if (linked.length === 1) {
    const teacher = linked[0];
    const owned = assignments.filter((row) => asText(row.teacher_id) === asText(teacher.teacher_id));
    const countOk = expectedAssignments == null || owned.length === expectedAssignments;
    const sameSchool = asText(teacher.school_id) === asText(user.school_id);
    if (sameSchool && countOk && asText(teacher.teacher_user_id) === asText(user.user_id)) {
      return {
        verdict: "CANONICAL",
        repairable: false,
        user,
        teacher,
        assignmentCount: owned.length,
        reason: "users.id === teachers.user_id et teacher_assignments.teacher_id alignés",
      };
    }
  }
  if (linked.length > 1) {
    return {
      verdict: "AMBIGUOUS_TEACHERS",
      repairable: false,
      reason: "plusieurs fiches teachers.user_id pour le même user",
    };
  }

  const unlinked = teachers.filter((row) => !asText(row.teacher_user_id));
  if (unlinked.length !== 1) {
    return {
      verdict: "AMBIGUOUS_TEACHERS",
      repairable: false,
      reason:
        linked.length === 0 && unlinked.length === 0
          ? "aucune fiche teachers liée ni orpheline univoque"
          : `${unlinked.length} fiches teachers.user_id NULL — aucune mutation`,
    };
  }

  const teacher = unlinked[0];
  const owned = assignments.filter((row) => asText(row.teacher_id) === asText(teacher.teacher_id));
  if (asText(teacher.school_id) !== asText(user.school_id)) {
    return {
      verdict: "SCHOOL_MISMATCH",
      repairable: false,
      reason: "teacher.school_id ≠ user.school_id",
    };
  }
  if (expectedAssignments != null && owned.length !== expectedAssignments) {
    return {
      verdict: "ASSIGNMENT_COUNT_MISMATCH",
      repairable: false,
      reason: `attendues ${expectedAssignments}, trouvées ${owned.length}`,
    };
  }
  if (!owned.length) {
    return {
      verdict: "NO_ASSIGNMENTS",
      repairable: false,
      reason: "aucune affectation active sur la fiche orpheline",
    };
  }
  if (!isTeacherRole(user.role) && !(user.roles || []).some(isTeacherRole)) {
    return {
      verdict: "ROLE_MISMATCH",
      repairable: false,
      reason: "le user n'a pas le rôle Enseignant",
    };
  }

  return {
    verdict: "REPAIRABLE_UNLINKED",
    repairable: true,
    user,
    teacher,
    assignmentCount: owned.length,
    reason: "un user + un teacher.user_id NULL + affectations univoques",
  };
}

async function loadInventory(db, query = {}) {
  const userId = asText(query.userId);
  const schoolCode = asText(query.schoolCode).toUpperCase();
  const name = asText(query.name);
  const { first, last } = parsePersonName(name);

  const users = await db.all(
    `SELECT u.id::text AS user_id, u.user_code, u.first_name, u.last_name, u.role, u.status,
            u.school_id::text AS school_id, s.school_code
     FROM users u
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE (
       ($1 <> '' AND u.id::text = $1)
       OR (
         $2 <> '' AND $3 <> '' AND (
           (lower(btrim(u.first_name)) LIKE '%' || $2 || '%' AND lower(btrim(u.last_name)) LIKE '%' || $3 || '%')
           OR (lower(btrim(u.first_name)) LIKE '%' || $3 || '%' AND lower(btrim(u.last_name)) LIKE '%' || $2 || '%')
         )
       )
     )
       AND ($4 = '' OR upper(btrim(s.school_code)) = $4)
     ORDER BY s.school_code NULLS LAST, u.user_code`,
    [userId, first, last, schoolCode],
  );

  const userIds = users.map((row) => row.user_id);
  const schoolIds = [...new Set(users.map((row) => row.school_id).filter(Boolean))];

  const roles = userIds.length
    ? await db.all(
        `SELECT ur.user_id::text AS user_id, ur.school_id::text AS school_id, ur.role_key, ur.status,
                s.school_code
         FROM user_roles ur
         LEFT JOIN schools s ON s.id = ur.school_id
         WHERE ur.user_id::text = ANY($1::text[])
         ORDER BY ur.user_id, ur.role_key`,
        [userIds],
      )
    : [];

  const teachers = schoolIds.length
    ? await db.all(
        `SELECT t.id::text AS teacher_id, t.teacher_code, t.user_id::text AS teacher_user_id,
                t.school_id::text AS school_id, t.status, s.school_code,
                u.first_name, u.last_name, u.user_code AS linked_user_code
         FROM teachers t
         JOIN schools s ON s.id = t.school_id
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.school_id::text = ANY($1::text[])
         ORDER BY t.teacher_code`,
        [schoolIds],
      )
    : [];

  const teacherIds = teachers.map((row) => row.teacher_id);
  const assignments = teacherIds.length
    ? await db.all(
        `SELECT ta.id::text AS assignment_id, ta.teacher_id::text AS teacher_id, ta.status,
                ta.school_id::text AS school_id, cl.name AS class_name, sub.name AS subject_name
         FROM teacher_assignments ta
         LEFT JOIN classes cl ON cl.id = ta.class_id
         LEFT JOIN subjects sub ON sub.id = ta.subject_id
         WHERE ta.teacher_id::text = ANY($1::text[])
         ORDER BY ta.status, cl.name, sub.name`,
        [teacherIds],
      )
    : [];

  const usersWithRoles = users.map((user) => ({
    ...user,
    roles: roles.filter((row) => row.user_id === user.user_id && row.status === "active").map((row) => row.role_key),
  }));

  return { users: usersWithRoles, userRoles: roles, teachers, assignments };
}

async function applyCanonicalLink(db, classification) {
  if (!classification?.repairable || classification.verdict !== "REPAIRABLE_UNLINKED") {
    const error = new Error(classification?.reason || "mutation refusée");
    error.code = "TEACHER_CANONICAL_APPLY_REFUSED";
    throw error;
  }
  const teacherId = asText(classification.teacher.teacher_id);
  const userId = asText(classification.user.user_id);
  const schoolId = asText(classification.teacher.school_id);
  const row = await db.one(
    `UPDATE teachers
     SET user_id = $1, updated_at = NOW()
     WHERE id::text = $2
       AND school_id::text = $3
       AND user_id IS NULL
     RETURNING id::text AS teacher_id, user_id::text AS teacher_user_id`,
    [userId, teacherId, schoolId],
  );
  if (!row) {
    const error = new Error("UPDATE 0 — teachers.user_id n'était plus NULL");
    error.code = "TEACHER_CANONICAL_APPLY_RACE";
    throw error;
  }
  return row;
}

module.exports = {
  parsePersonName,
  namesMatch,
  classifyInventory,
  loadInventory,
  applyCanonicalLink,
};
