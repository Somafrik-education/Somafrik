"use strict";

function attachStudentLifecyclePg(repository) {
  if (!repository || repository.engine === "memory") return repository;
  if (
    typeof repository.listSchoolStudents !== "function" ||
    typeof repository.getSchoolByCode !== "function" ||
    typeof repository.withTransaction !== "function"
  ) {
    return repository;
  }
  if (repository.__studentLifecyclePgAttached) return repository;
  Object.defineProperty(repository, "__studentLifecyclePgAttached", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  const originalListSchoolStudents = repository.listSchoolStudents.bind(repository);
  repository.listSchoolStudents = async (schoolCode) => {
    const rows = await originalListSchoolStudents(schoolCode);
    return (rows ?? []).filter((row) => String(row.status ?? "active").toLowerCase() !== "archived");
  };

  repository.archiveSchoolStudentByCode = async (studentCode, schoolCode) => {
    const code = String(studentCode ?? "").trim().toUpperCase();
    const scope = String(schoolCode ?? "").trim().toUpperCase();
    if (!code || !scope || scope === "*") {
      const error = new Error("Identifiant élève et établissement requis.");
      error.statusCode = 400;
      throw error;
    }

    const school = await repository.getSchoolByCode(scope);
    if (!school) {
      const error = new Error("Établissement introuvable.");
      error.statusCode = 404;
      throw error;
    }

    const result = await repository.withTransaction(async (tx) => {
      const student = await tx.one(
        `SELECT id, student_code, status
         FROM students
         WHERE school_id = $1
           AND (student_code = $2 OR login_code = $2 OR identity_code = $2)
         FOR UPDATE
         LIMIT 1`,
        [school.id, code],
      );
      if (!student) {
        const error = new Error("Eleve introuvable");
        error.statusCode = 404;
        throw error;
      }

      await tx.query(
        `UPDATE enrollments
         SET status = 'archived', updated_at = NOW()
         WHERE school_id = $1 AND student_id = $2 AND status = 'active'`,
        [school.id, student.id],
      );

      const archived = await tx.one(
        `UPDATE students
         SET status = 'archived', archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND school_id = $2
         RETURNING student_code, status, archived_at`,
        [student.id, school.id],
      );

      await tx.query(
        `UPDATE users
         SET status = 'archived', updated_at = NOW()
         WHERE school_id = $1
           AND status <> 'archived'
           AND (user_code = $2 OR login_code = $2 OR identity_code = $2)`,
        [school.id, student.student_code],
      );

      return {
        id: archived.student_code,
        publicId: archived.student_code,
        studentCode: archived.student_code,
        matricule: archived.student_code,
        schoolCode: scope,
        status: archived.status,
        archived: true,
        archivedAt: archived.archived_at,
      };
    });

    repository.cachedDataset = null;
    return result;
  };

  return repository;
}

async function ensureStudentLifecyclePgSchema(repository) {
  if (!repository || repository.engine === "memory" || typeof repository.query !== "function") return;
  await repository.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
}

module.exports = {
  attachStudentLifecyclePg,
  ensureStudentLifecyclePgSchema,
};
