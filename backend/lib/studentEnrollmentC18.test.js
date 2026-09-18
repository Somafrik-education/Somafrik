"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  normalizeEnrollmentStatus,
  canValidateEnrollmentStatus,
  canAssignClassEnrollmentStatus,
  canTransferEnrollmentStatus,
  canCloseEnrollmentStatus,
  isTerminalEnrollmentStatus,
  nextStatusAfterValidate,
  nextStatusAfterAssignClass,
  nextStatusAfterTransfer,
  nextStatusAfterClose,
  isParentOrStudentRole,
} = require("./studentEnrollmentC18");

test("C18 alias active → ENROLLED", () => {
  assert.equal(normalizeEnrollmentStatus("active"), "ENROLLED");
  assert.equal(normalizeEnrollmentStatus("ENROLLED"), "ENROLLED");
});

test("C18 validate PRE_REGISTERED|PENDING_REVIEW|INCOMPLETE → APPROVED", () => {
  assert.equal(canValidateEnrollmentStatus("PRE_REGISTERED"), true);
  assert.equal(canValidateEnrollmentStatus("PENDING_REVIEW"), true);
  assert.equal(canValidateEnrollmentStatus("INCOMPLETE"), true);
  assert.equal(canValidateEnrollmentStatus("APPROVED"), false);
  assert.equal(canValidateEnrollmentStatus("ENROLLED"), false);
  assert.equal(nextStatusAfterValidate(), "APPROVED");
});

test("C18 assign-class APPROVED|ENROLLED → ENROLLED", () => {
  assert.equal(canAssignClassEnrollmentStatus("APPROVED"), true);
  assert.equal(canAssignClassEnrollmentStatus("ENROLLED"), true);
  assert.equal(canAssignClassEnrollmentStatus("PENDING_REVIEW"), false);
  assert.equal(nextStatusAfterAssignClass("APPROVED"), "ENROLLED");
});

test("C18 transfer ENROLLED → TRANSFERRED terminal", () => {
  assert.equal(canTransferEnrollmentStatus("ENROLLED"), true);
  assert.equal(canTransferEnrollmentStatus("APPROVED"), false);
  assert.equal(nextStatusAfterTransfer(), "TRANSFERRED");
  assert.equal(isTerminalEnrollmentStatus("TRANSFERRED"), true);
  assert.equal(canValidateEnrollmentStatus("TRANSFERRED"), false);
  assert.equal(canAssignClassEnrollmentStatus("TRANSFERRED"), false);
  assert.equal(canCloseEnrollmentStatus("TRANSFERRED"), false);
});

test("C18 close ENROLLED|APPROVED → CLOSED terminal", () => {
  assert.equal(canCloseEnrollmentStatus("ENROLLED"), true);
  assert.equal(canCloseEnrollmentStatus("APPROVED"), true);
  assert.equal(canCloseEnrollmentStatus("PENDING_REVIEW"), false);
  assert.equal(nextStatusAfterClose(), "CLOSED");
  assert.equal(isTerminalEnrollmentStatus("CLOSED"), true);
});

test("C18 parent/student détectés pour interdire les mutations", () => {
  assert.equal(isParentOrStudentRole("Parent"), true);
  assert.equal(isParentOrStudentRole("Élève / Étudiant"), true);
  assert.equal(isParentOrStudentRole("Admin School"), false);
  assert.equal(isParentOrStudentRole("Enseignant"), false);
});

test("C18 assign-class : échec Finance rollback classe/statut/effectiveDate", async () => {
  const { applyAssignClass } = require("./studentEnrollmentC18");
  const state = {
    class_id: "class-a",
    status: "ENROLLED",
    class_effective_date: null,
  };
  const enrollmentRow = {
    id: "enr-1",
    status: "ENROLLED",
    class_id: "class-a",
    academic_year_id: "year-a",
    student_code: "STU-A",
    class_code: "CLS-A",
    class_name: "6A",
    academic_year_name: "2026-2027",
    academic_year_status: "open",
    enrollment_date: "2026-09-01",
  };
  const student = { id: "stu-a", student_code: "STU-A", school_id: "school-a" };
  const school = { id: "school-a", login_code: "CD-LAC-26-001" };
  const klassB = { id: "class-b", class_code: "CLS-B", name: "6B", academic_year_id: "year-a" };

  function snapshot() {
    return { ...state };
  }

  const repo = {
    engine: "pg",
    async getSchoolByCode() {
      return school;
    },
    async one(sql, params = []) {
      const text = String(sql);
      if (text.includes("SELECT st.id, st.student_code")) return student;
      if (text.includes("FROM enrollments e")) {
        return { ...enrollmentRow, class_id: state.class_id, status: state.status };
      }
      if (text.includes("FROM classes") && text.includes("class_code = $1")) return klassB;
      if (text.includes("FROM classes") && text.includes("WHERE id = $1")) {
        return { id: "class-a", class_code: "CLS-A", name: "6A" };
      }
      if (text.includes("UPDATE enrollments")) {
        state.class_id = params[2];
        state.status = params[3];
        state.class_effective_date = params[4];
        return { id: "enr-1", class_id: state.class_id, status: state.status, class_effective_date: state.class_effective_date };
      }
      return null;
    },
    async all() {
      return [];
    },
    async withTransaction(fn) {
      const before = snapshot();
      try {
        return await fn({
          one: (sql, params) => repo.one(sql, params),
          query: async () => ({}),
        });
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    async ensureEnrollmentObligationsInTx() {
      throw new Error("FINANCE_INJECTED_FAILURE");
    },
    async recordAudit() {},
  };

  await assert.rejects(
    () =>
      applyAssignClass(repo, {
        studentCode: "STU-A",
        enrollmentId: "enr-1",
        schoolCode: "CD-LAC-26-001",
        classCode: "CLS-B",
        effectiveDate: "2026-09-18",
      }),
    /FINANCE_INJECTED_FAILURE/,
  );
  assert.equal(state.class_id, "class-a");
  assert.equal(state.status, "ENROLLED");
  assert.equal(state.class_effective_date, null);
});

test("C18 concurrence TRANSFER vs CLOSE : un succès, l'autre 409", async () => {
  const { applyTransfer, applyClose } = require("./studentEnrollmentC18");
  const state = { status: "ENROLLED" };
  let locked = false;
  const waiters = [];
  async function acquire() {
    if (!locked) {
      locked = true;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    locked = true;
  }
  function release() {
    locked = false;
    const next = waiters.shift();
    if (next) next();
  }

  const enrollmentRow = {
    id: "enr-race",
    status: "ENROLLED",
    class_id: "class-a",
    academic_year_id: "year-a",
    student_code: "STU-R",
    class_code: "CLS-A",
    class_name: "6A",
    academic_year_name: "2026-2027",
    academic_year_status: "open",
    enrollment_date: "2026-09-01",
  };
  const student = { id: "stu-r", student_code: "STU-R", school_id: "school-a" };
  const school = { id: "school-a", login_code: "CD-LAC-26-001" };
  const audits = [];

  const repo = {
    engine: "pg",
    async getSchoolByCode() {
      return school;
    },
    async one(sql, params = []) {
      const text = String(sql);
      if (text.includes("SELECT st.id, st.student_code")) return student;
      if (text.includes("FROM enrollments e")) {
        return { ...enrollmentRow, status: state.status };
      }
      if (text.includes("UPDATE enrollments")) {
        const expected = params[params.length - 1];
        if (expected !== state.status) return null;
        if (text.includes("transferred_at")) state.status = "TRANSFERRED";
        else if (text.includes("closed_at")) state.status = "CLOSED";
        return { id: "enr-race", status: state.status };
      }
      return null;
    },
    async all() {
      return [];
    },
    async withTransaction(fn) {
      await acquire();
      try {
        return await fn({
          one: (sql, params) => repo.one(sql, params),
          query: async () => ({}),
        });
      } finally {
        release();
      }
    },
    async recordAudit(payload) {
      audits.push(payload);
    },
  };

  const [left, right] = await Promise.allSettled([
    applyTransfer(repo, {
      studentCode: "STU-R",
      enrollmentId: "enr-race",
      schoolCode: "CD-LAC-26-001",
      destinationSchoolName: "Lycée Horizon",
    }),
    applyClose(repo, {
      studentCode: "STU-R",
      enrollmentId: "enr-race",
      schoolCode: "CD-LAC-26-001",
      reason: "fin",
    }),
  ]);
  const ok = [left, right].filter((item) => item.status === "fulfilled");
  const ko = [left, right].filter((item) => item.status === "rejected");
  assert.equal(ok.length, 1, JSON.stringify({ left, right, status: state.status }));
  assert.equal(ko.length, 1);
  assert.equal(ko[0].reason.statusCode, 409);
  assert.ok(state.status === "TRANSFERRED" || state.status === "CLOSED");
  assert.equal(audits.length, 1);
  assert.ok(audits[0].action === "c18_transfer" || audits[0].action === "c18_close");
});
