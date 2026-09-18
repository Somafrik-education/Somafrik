"use strict";

/**
 * PARITY-032 — machine C18 d'inscription.
 * Autorité : PostgreSQL `enrollments`. Aucun retour arrière implicite.
 */

const { BusinessError } = require("../services/authService");
const { createHttpError } = require("./classesManagement");

const ROSTER_ENROLLMENT_SQL = `lower(btrim(e.status)) IN ('active', 'enrolled')`;
const VALIDATE_SOURCE = Object.freeze(["PRE_REGISTERED", "PENDING_REVIEW", "INCOMPLETE"]);
const ASSIGN_SOURCE = Object.freeze(["APPROVED", "ENROLLED"]);
const TRANSFER_SOURCE = Object.freeze(["ENROLLED"]);
const CLOSE_SOURCE = Object.freeze(["ENROLLED", "APPROVED"]);
const TERMINAL = Object.freeze(["TRANSFERRED", "CLOSED"]);

const LEGACY_STATUS_ALIASES = Object.freeze({
  active: "ENROLLED",
  enrolled: "ENROLLED",
  approved: "APPROVED",
  pre_registered: "PRE_REGISTERED",
  preregistered: "PRE_REGISTERED",
  pending_review: "PENDING_REVIEW",
  incomplete: "INCOMPLETE",
  transferred: "TRANSFERRED",
  closed: "CLOSED",
});

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeEnrollmentStatus(value, fallback = "PENDING_REVIEW") {
  const raw = asTrimmed(value);
  if (!raw) return fallback;
  if (
    [
      "PRE_REGISTERED",
      "PENDING_REVIEW",
      "INCOMPLETE",
      "APPROVED",
      "ENROLLED",
      "TRANSFERRED",
      "CLOSED",
      "SUSPENDED",
      "WITHDRAWN",
      "COMPLETED",
      "GRADUATED",
      "REJECTED",
    ].includes(raw)
  ) {
    return raw;
  }
  const folded = raw.toLowerCase();
  if (LEGACY_STATUS_ALIASES[folded]) return LEGACY_STATUS_ALIASES[folded];
  return fallback;
}

function isTerminalEnrollmentStatus(status) {
  return TERMINAL.includes(normalizeEnrollmentStatus(status));
}

function canValidateEnrollmentStatus(status) {
  return VALIDATE_SOURCE.includes(normalizeEnrollmentStatus(status));
}

function canAssignClassEnrollmentStatus(status) {
  return ASSIGN_SOURCE.includes(normalizeEnrollmentStatus(status));
}

function canTransferEnrollmentStatus(status) {
  return TRANSFER_SOURCE.includes(normalizeEnrollmentStatus(status));
}

function canCloseEnrollmentStatus(status) {
  return CLOSE_SOURCE.includes(normalizeEnrollmentStatus(status));
}

function nextStatusAfterValidate() {
  return "APPROVED";
}

function nextStatusAfterAssignClass() {
  return "ENROLLED";
}

function nextStatusAfterTransfer() {
  return "TRANSFERRED";
}

function nextStatusAfterClose() {
  return "CLOSED";
}

function assertC18Engine(repository) {
  if (!repository || repository.engine === "memory" || typeof repository.one !== "function") {
    throw new BusinessError(503, "Inscriptions C18 PostgreSQL indisponibles.");
  }
}

function formatCivilDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function mapC18EnrollmentRow(row, studentCode) {
  const status = normalizeEnrollmentStatus(row.status ?? row.enrollment_status, "ENROLLED");
  const classId = row.class_id ?? row.classId ?? null;
  return {
    id: String(row.id ?? row.enrollment_id),
    studentId: asTrimmed(studentCode || row.student_code),
    status,
    classId: classId ? String(classId) : null,
    classCode: asTrimmed(row.class_code),
    className: asTrimmed(row.class_name),
    academicYearId: row.academic_year_id ? String(row.academic_year_id) : null,
    academicYearName: asTrimmed(row.academic_year_name),
    academicYearStatus: asTrimmed(row.academic_year_status),
    enrollmentDate: formatCivilDate(row.enrollment_date),
    validatedAt: row.validated_at ? new Date(row.validated_at).toISOString() : null,
    assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : null,
    transferredAt: row.transferred_at ? new Date(row.transferred_at).toISOString() : null,
    transferDestination: asTrimmed(row.transfer_destination) || null,
    transferNotes: asTrimmed(row.transfer_notes) || null,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    closeNotes: asTrimmed(row.close_notes) || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

const ENROLLMENT_SELECT = `
  SELECT e.id,
         e.status,
         e.enrollment_date,
         e.created_at,
         e.updated_at,
         e.validated_at,
         e.assigned_at,
         e.transferred_at,
         e.transfer_destination,
         e.transfer_notes,
         e.closed_at,
         e.close_notes,
         e.class_id,
         e.academic_year_id,
         cl.class_code,
         cl.name AS class_name,
         ay.name AS academic_year_name,
         ay.status AS academic_year_status,
         st.student_code
    FROM enrollments e
    JOIN students st ON st.id = e.student_id
    JOIN academic_years ay ON ay.id = e.academic_year_id
    LEFT JOIN classes cl ON cl.id = e.class_id
`;

async function requireSchoolStudent(repository, studentCode, schoolCode) {
  const code = asTrimmed(studentCode);
  const school = asTrimmed(schoolCode).toUpperCase();
  if (!code) throw createHttpError(400, "studentId invalide.");
  if (!school || school === "*") throw createHttpError(400, "schoolCode établissement requis.");
  const schoolRow =
    typeof repository.getSchoolByCode === "function" ? await repository.getSchoolByCode(school) : null;
  if (!schoolRow?.id) throw createHttpError(404, "Établissement introuvable.");
  const student = await repository.one(
    `SELECT st.id, st.student_code, st.school_id
       FROM students st
      WHERE (st.student_code = $1 OR st.id::text = $1)
        AND st.school_id = $2
      LIMIT 1`,
    [code, schoolRow.id],
  );
  if (!student) throw createHttpError(404, "Élève introuvable.");
  return { student, school: schoolRow };
}

async function loadEnrollment(repository, { studentCode, enrollmentId, schoolCode }) {
  const { student, school } = await requireSchoolStudent(repository, studentCode, schoolCode);
  const row = await repository.one(
    `${ENROLLMENT_SELECT}
     WHERE e.id::text = $1
       AND e.student_id = $2
       AND e.school_id = $3
     LIMIT 1`,
    [asTrimmed(enrollmentId), student.id, school.id],
  );
  if (!row) throw createHttpError(404, "Inscription introuvable.");
  return { student, school, row, mapped: mapC18EnrollmentRow(row, student.student_code) };
}

async function listEnrollments(repository, { studentCode, schoolCode }) {
  assertC18Engine(repository);
  const { student, school } = await requireSchoolStudent(repository, studentCode, schoolCode);
  const rows = await repository.all(
    `${ENROLLMENT_SELECT}
     WHERE e.student_id = $1 AND e.school_id = $2
     ORDER BY e.enrollment_date DESC NULLS LAST, e.created_at DESC NULLS LAST`,
    [student.id, school.id],
  );
  return (rows ?? []).map((row) => mapC18EnrollmentRow(row, student.student_code));
}

function illegalTransition(message) {
  const error = createHttpError(409, message);
  error.code = "C18_ILLEGAL_TRANSITION";
  return error;
}

async function applyValidate(repository, input) {
  assertC18Engine(repository);
  const loaded = await loadEnrollment(repository, input);
  const current = loaded.mapped.status;
  if (isTerminalEnrollmentStatus(current) || !canValidateEnrollmentStatus(current)) {
    throw illegalTransition(`Validation refusée depuis ${current}.`);
  }
  const next = nextStatusAfterValidate();
  const saved = await repository.one(
    `UPDATE enrollments
        SET status = $3,
            validated_at = COALESCE(validated_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      RETURNING id`,
    [loaded.row.id, loaded.school.id, next],
  );
  if (!saved) throw createHttpError(404, "Inscription introuvable.");
  return (await loadEnrollment(repository, input)).mapped;
}

async function applyAssignClass(repository, input) {
  assertC18Engine(repository);
  const loaded = await loadEnrollment(repository, input);
  const current = loaded.mapped.status;
  if (isTerminalEnrollmentStatus(current) || !canAssignClassEnrollmentStatus(current)) {
    throw illegalTransition(`Affectation refusée depuis ${current}.`);
  }
  const classCode = asTrimmed(input.classCode);
  const classId = asTrimmed(input.classId);
  if (!classCode && !classId) throw createHttpError(400, "Classe requise.");

  const klass = await repository.one(
    classId
      ? `SELECT id, class_code, name, academic_year_id
           FROM classes
          WHERE id::text = $1 AND school_id = $2
          LIMIT 1`
      : `SELECT id, class_code, name, academic_year_id
           FROM classes
          WHERE class_code = $1 AND school_id = $2
          LIMIT 1`,
    [classId || classCode, loaded.school.id],
  );
  if (!klass) throw createHttpError(404, "Classe introuvable.");

  const next = nextStatusAfterAssignClass();
  const sameYear = String(klass.academic_year_id) === String(loaded.row.academic_year_id);
  if (!sameYear) {
    throw createHttpError(409, "La classe n'appartient pas à la même année scolaire.");
  }

  const previousClassId = loaded.row.class_id ? String(loaded.row.class_id) : null;
  const classChanged = Boolean(previousClassId && previousClassId !== String(klass.id));
  const effectiveDate = asTrimmed(input.effectiveDate) || null;
  if (classChanged && !effectiveDate) {
    throw createHttpError(409, "Date effective du changement de classe obligatoire : aucune obligation n'a été annulée.");
  }

  let previousClass = null;
  if (classChanged) {
    previousClass = await repository.one(`SELECT id, class_code, name FROM classes WHERE id = $1`, [
      loaded.row.class_id,
    ]);
  }

  const saved = await repository.one(
    `UPDATE enrollments
        SET class_id = $3,
            status = $4,
            assigned_at = COALESCE(assigned_at, NOW()),
            class_effective_date = CASE
              WHEN enrollments.class_id IS DISTINCT FROM $3
                THEN COALESCE($5::date, enrollments.class_effective_date)
              ELSE COALESCE(enrollments.class_effective_date, enrollments.enrollment_date)
            END,
            updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      RETURNING id`,
    [loaded.row.id, loaded.school.id, klass.id, next, effectiveDate],
  );
  if (!saved) throw createHttpError(404, "Inscription introuvable.");

  const schoolLogin = await repository.one(`SELECT login_code FROM schools WHERE id = $1`, [loaded.school.id]);
  const login = asTrimmed(schoolLogin?.login_code);
  const actor =
    input.principal || { role: "system", schoolCode: login, financeLoginCode: login, sub: "c18-assign-class" };
  const financeInput = {
    schoolCode: login,
    studentKey: loaded.student.student_code,
    academicYear: loaded.mapped.academicYearName,
    classId: klass.id,
    effectiveDate,
    previousClass: previousClass
      ? { classId: previousClass.id, classCode: previousClass.class_code, className: previousClass.name }
      : null,
  };
  if (classChanged && typeof repository.ensureEnrollmentObligations === "function") {
    await repository.ensureEnrollmentObligations({ ...financeInput, reason: "class_transfer" }, actor);
  } else if (typeof repository.syncEnrollmentFinanceObligations === "function") {
    await repository.syncEnrollmentFinanceObligations({ ...financeInput, reason: "enrollment_active" }, actor);
  }

  return (await loadEnrollment(repository, input)).mapped;
}

async function applyTransfer(repository, input) {
  assertC18Engine(repository);
  const loaded = await loadEnrollment(repository, input);
  const current = loaded.mapped.status;
  if (isTerminalEnrollmentStatus(current) || !canTransferEnrollmentStatus(current)) {
    throw illegalTransition(`Transfert refusé depuis ${current}.`);
  }
  const destination = asTrimmed(input.destinationSchoolName);
  if (!destination) throw createHttpError(400, "Établissement de destination requis.");
  const notes = asTrimmed(input.reason || input.transferNotes);
  const saved = await repository.one(
    `UPDATE enrollments
        SET status = $3,
            transferred_at = NOW(),
            transfer_destination = $4,
            transfer_notes = $5,
            updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      RETURNING id`,
    [loaded.row.id, loaded.school.id, nextStatusAfterTransfer(), destination, notes || null],
  );
  if (!saved) throw createHttpError(404, "Inscription introuvable.");
  return (await loadEnrollment(repository, input)).mapped;
}

async function applyClose(repository, input) {
  assertC18Engine(repository);
  const loaded = await loadEnrollment(repository, input);
  const current = loaded.mapped.status;
  if (isTerminalEnrollmentStatus(current) || !canCloseEnrollmentStatus(current)) {
    throw illegalTransition(`Clôture refusée depuis ${current}.`);
  }
  const notes = asTrimmed(input.reason || input.closeNotes);
  const saved = await repository.one(
    `UPDATE enrollments
        SET status = $3,
            closed_at = NOW(),
            close_notes = $4,
            updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      RETURNING id`,
    [loaded.row.id, loaded.school.id, nextStatusAfterClose(), notes || null],
  );
  if (!saved) throw createHttpError(404, "Inscription introuvable.");
  return (await loadEnrollment(repository, input)).mapped;
}

function isParentOrStudentRole(role) {
  const key = String(role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return key.includes("parent") || key.includes("eleve") || key.includes("etudiant") || key === "student";
}

module.exports = {
  VALIDATE_SOURCE,
  ASSIGN_SOURCE,
  TRANSFER_SOURCE,
  CLOSE_SOURCE,
  TERMINAL,
  ROSTER_ENROLLMENT_SQL,
  normalizeEnrollmentStatus,
  isTerminalEnrollmentStatus,
  canValidateEnrollmentStatus,
  canAssignClassEnrollmentStatus,
  canTransferEnrollmentStatus,
  canCloseEnrollmentStatus,
  nextStatusAfterValidate,
  nextStatusAfterAssignClass,
  nextStatusAfterTransfer,
  nextStatusAfterClose,
  mapC18EnrollmentRow,
  listEnrollments,
  applyValidate,
  applyAssignClass,
  applyTransfer,
  applyClose,
  isParentOrStudentRole,
  assertC18Engine,
};
