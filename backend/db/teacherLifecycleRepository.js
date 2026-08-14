"use strict";

const {
  createTeacherHttpError,
  parseAndValidateDate,
  isExactTeacherCivilIdentity,
} = require("../lib/teachersManagement");
const { validateTeacherSchoolEntry } = require("../lib/teacherEntryRules");
const {
  assertUniqueUserLoginIdentity,
  isUsersLoginIdentityUniquenessViolation,
} = require("../lib/usersLoginIdentity");

const FORBIDDEN_PATCH_KEYS = Object.freeze([
  "id",
  "schoolCode",
  "school_code",
  "schoolId",
  "school_id",
  "role",
  "teacherCode",
  "teacher_code",
  "userId",
  "user_id",
  "userCode",
  "user_code",
  "password",
  "temporaryPassword",
  "temporary_password",
  "passwordHash",
  "password_hash",
  "pinHash",
  "pin_hash",
  "mustChangePassword",
  "must_change_password",
  "assignments",
  "assignedClasses",
  "classCode",
  "class_code",
  "classId",
  "class_id",
  "subjectId",
  "subject_id",
]);

function asOptionalString(value, field, maxLength) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw createTeacherHttpError(400, `${field} doit être une chaîne.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw createTeacherHttpError(400, `${field} trop long (max ${maxLength}).`);
  }
  return trimmed || null;
}

function requireNonEmptyIfPresent(value, field, maxLength) {
  if (value === undefined) return undefined;
  const normalized = asOptionalString(value, field, maxLength);
  if (!normalized) {
    throw createTeacherHttpError(400, `${field} ne peut pas être vide.`);
  }
  return normalized;
}

function normalizeGender(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = String(value).trim();
  if (!["Masculin", "Féminin", "Autre"].includes(normalized)) {
    throw createTeacherHttpError(400, "gender invalide.");
  }
  return normalized;
}

function validateTeacherUpdateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createTeacherHttpError(400, "Corps de requête invalide.");
  }
  for (const key of FORBIDDEN_PATCH_KEYS) {
    if (Object.hasOwn(body, key)) {
      throw createTeacherHttpError(400, `${key} ne peut pas être modifié.`);
    }
  }
  const patch = {
    firstName: requireNonEmptyIfPresent(body.firstName ?? body.first_name, "firstName", 120),
    lastName: requireNonEmptyIfPresent(body.lastName ?? body.last_name, "lastName", 120),
    phone: asOptionalString(body.phone, "phone", 40),
    email: asOptionalString(body.email, "email", 200),
    speciality: asOptionalString(body.speciality ?? body.specialty ?? body.mainSubject, "speciality", 200),
    gender: normalizeGender(body.gender),
    birthDate:
      body.birthDate !== undefined || body.birth_date !== undefined
        ? parseAndValidateDate(body.birthDate ?? body.birth_date, "birthDate", { required: true })
        : undefined,
    entryDate:
      body.entryDate !== undefined || body.entry_date !== undefined || body.hireDate !== undefined
        ? parseAndValidateDate(body.entryDate ?? body.entry_date ?? body.hireDate, "entryDate", { required: true })
        : undefined,
  };
  if (!Object.values(patch).some((value) => value !== undefined)) {
    throw createTeacherHttpError(400, "Aucun champ enseignant modifiable fourni.");
  }
  return patch;
}

function formatIsoDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function teacherSnapshot(row) {
  return {
    teacherCode: row.teacher_code,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    birthDate: formatIsoDate(row.birth_date),
    gender: row.gender,
    speciality: row.speciality,
    entryDate: formatIsoDate(row.hire_date),
    status: row.teacher_status,
    userStatus: row.user_status,
  };
}

function createTeacherLifecycleRepository(db) {
  async function requireSchool(schoolCode) {
    const code = String(schoolCode ?? "").trim().toUpperCase();
    if (!code || code === "*") {
      throw createTeacherHttpError(400, "schoolCode établissement requis.");
    }
    const school = await db.getSchoolByCode(code);
    if (!school) throw createTeacherHttpError(404, "Établissement introuvable.");
    return school;
  }

  async function lockedTeacher(scope, schoolId, teacherCode) {
    const row = await scope.one(
      `SELECT t.id AS teacher_id, t.teacher_code, t.user_id, t.speciality, t.hire_date,
              t.status AS teacher_status, u.first_name, u.last_name, u.email, u.phone,
              u.birth_date, u.gender, u.status AS user_status, s.school_code
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       JOIN schools s ON s.id = t.school_id
       WHERE t.school_id = $1 AND t.teacher_code = $2
       FOR UPDATE OF t, u`,
      [schoolId, teacherCode],
    );
    if (!row || ["deleted", "archived"].includes(String(row.teacher_status ?? "").toLowerCase())) {
      throw createTeacherHttpError(404, "Enseignant introuvable.");
    }
    return row;
  }

  async function assertCivilIdentityAvailable(scope, schoolId, currentTeacherCode, candidate) {
    const rows = await scope.all(
      `SELECT t.teacher_code, u.first_name, u.last_name, u.birth_date, u.gender
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       WHERE t.school_id = $1
         AND t.teacher_code <> $2
         AND COALESCE(t.status, 'active') NOT IN ('deleted', 'archived')
         AND COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')`,
      [schoolId, currentTeacherCode],
    );
    if (rows.some((row) => isExactTeacherCivilIdentity(candidate, {
      firstName: row.first_name,
      lastName: row.last_name,
      birthDate: formatIsoDate(row.birth_date),
      gender: row.gender,
    }))) {
      throw createTeacherHttpError(409, "Une fiche enseignant canonique existe déjà pour cette identité.", "TEACHER_CANON_AMBIGUOUS");
    }
  }

  async function writeAudit(scope, tx, principal, auditMeta, action, entityId, oldValue, newValue, schoolCode) {
    if (typeof scope.recordAudit !== "function") {
      throw createTeacherHttpError(500, "Audit enseignant indisponible dans la transaction.");
    }
    await scope.recordAudit({
      schoolCode,
      userId: principal?.sub || principal?.id,
      action,
      entityType: "teacher",
      entityId,
      oldValue,
      newValue,
      ipAddress: auditMeta?.ipAddress,
      userAgent: auditMeta?.userAgent,
    }, tx);
  }

  return {
    async update(teacherCodeParam, body, schoolCode, principal = {}, auditMeta = {}) {
      const teacherCode = String(teacherCodeParam ?? "").trim();
      if (!teacherCode) throw createTeacherHttpError(400, "teacherCode invalide.");
      const school = await requireSchool(schoolCode);
      const patch = validateTeacherUpdateInput(body);

      return db.withTransaction(async (tx) => {
        const scope = typeof db.createTxScope === "function" ? db.createTxScope(tx) : tx;
        const current = await lockedTeacher(scope, school.id, teacherCode);
        const next = {
          firstName: patch.firstName ?? current.first_name,
          lastName: patch.lastName ?? current.last_name,
          email: patch.email !== undefined ? patch.email : current.email,
          phone: patch.phone !== undefined ? patch.phone : current.phone,
          birthDate: patch.birthDate ?? formatIsoDate(current.birth_date),
          gender: patch.gender !== undefined ? patch.gender : current.gender,
          speciality: patch.speciality !== undefined ? patch.speciality : current.speciality,
          entryDate: patch.entryDate ?? formatIsoDate(current.hire_date),
        };
        if (!next.email && !next.phone) {
          throw createTeacherHttpError(400, "Au moins un moyen de contact est requis (phone ou email).");
        }
        const ageError = validateTeacherSchoolEntry({ birthDate: next.birthDate, entryDate: next.entryDate });
        if (ageError) throw createTeacherHttpError(400, ageError);

        await assertCivilIdentityAvailable(scope, school.id, teacherCode, next);
        try {
          await assertUniqueUserLoginIdentity(scope, {
            schoolId: school.id,
            email: next.email,
            phone: next.phone,
            excludeUserId: current.user_id,
          });
          await scope.one(
            `UPDATE users
             SET first_name = $2, last_name = $3, email = $4, phone = $5,
                 birth_date = $6, gender = $7, updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [current.user_id, next.firstName, next.lastName, next.email, next.phone, next.birthDate, next.gender],
          );
        } catch (error) {
          if (error?.code === "USER_LOGIN_IDENTITY_DUPLICATE" || isUsersLoginIdentityUniquenessViolation(error)) {
            throw createTeacherHttpError(409, "Un compte avec cet email ou ce téléphone existe déjà.", "TEACHER_LOGIN_IDENTITY_DUPLICATE");
          }
          throw error;
        }
        await scope.one(
          `UPDATE teachers
           SET speciality = $2, hire_date = $3, updated_at = NOW()
           WHERE id = $1
           RETURNING id`,
          [current.teacher_id, next.speciality, next.entryDate],
        );

        const updated = await lockedTeacher(scope, school.id, teacherCode);
        await writeAudit(scope, tx, principal, auditMeta, "update_teacher", teacherCode, teacherSnapshot(current), teacherSnapshot(updated), school.school_code ?? schoolCode);
        return teacherSnapshot(updated);
      });
    },

    async archive(teacherCodeParam, schoolCode, principal = {}, auditMeta = {}) {
      const teacherCode = String(teacherCodeParam ?? "").trim();
      if (!teacherCode) throw createTeacherHttpError(400, "teacherCode invalide.");
      const school = await requireSchool(schoolCode);

      return db.withTransaction(async (tx) => {
        const scope = typeof db.createTxScope === "function" ? db.createTxScope(tx) : tx;
        const current = await lockedTeacher(scope, school.id, teacherCode);
        const activeRefs = await scope.one(
          `SELECT
             (SELECT COUNT(*)::int FROM school_courses sc
              WHERE sc.teacher_id = $1 AND COALESCE(sc.status, 'active') NOT IN ('deleted', 'archived', 'inactive')) AS courses,
             (SELECT COUNT(*)::int FROM course_schedule_slots css
              WHERE css.teacher_id = $1 AND COALESCE(css.status, 'active') NOT IN ('deleted', 'archived', 'inactive')) AS schedules`,
          [current.teacher_id],
        );
        if (Number(activeRefs?.courses ?? 0) > 0 || Number(activeRefs?.schedules ?? 0) > 0) {
          throw createTeacherHttpError(
            409,
            "Cet enseignant possède encore des cours ou créneaux actifs. Retirez-les avant suppression.",
            "TEACHER_ACTIVE_PEDAGOGY_REFERENCES",
          );
        }

        await scope.query(
          `UPDATE teacher_assignments
           SET status = 'deleted', updated_at = NOW()
           WHERE teacher_id = $1 AND status = 'active'`,
          [current.teacher_id],
        );
        await scope.query(
          `UPDATE sessions
           SET revoked_at = NOW(), revoke_reason = 'teacher_archived'
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [current.user_id],
        );
        await scope.one(
          `UPDATE teachers SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
          [current.teacher_id],
        );
        await scope.one(
          `UPDATE users SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
          [current.user_id],
        );

        const archived = { ...teacherSnapshot(current), status: "archived", userStatus: "archived" };
        await writeAudit(scope, tx, principal, auditMeta, "archive_teacher", teacherCode, teacherSnapshot(current), archived, school.school_code ?? schoolCode);
        return { teacherCode, archived: true };
      });
    },
  };
}

module.exports = {
  FORBIDDEN_PATCH_KEYS,
  validateTeacherUpdateInput,
  createTeacherLifecycleRepository,
};
