"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PostgresRepository } = require("../db/postgresRepository");

test("invalide le cache dataset après inscription élève", async () => {
  const repository = Object.create(PostgresRepository.prototype);
  repository.cachedDataset = { students: [] };
  repository.getClassStudentsRepository = () => ({
    enroll: async () => ({
      student: { studentCode: "ELE-CD-0001-0001-000001" },
      credentials: { login: "ELE-CD-0001-0001-000001", temporarySecret: "Tmp-ab" },
    }),
  });
  repository.getSchoolByCode = async () => ({ login_code: "CD-LAC-26-001" });
  repository.syncEnrollmentFinanceObligations = async () => ({ skipped: true });

  const created = await repository.enrollStudentInClass("CLS-1", "CD-2026-0001", {
    firstName: "Awa",
    lastName: "Test",
  });

  assert.equal(created.student.studentCode, "ELE-CD-0001-0001-000001");
  assert.equal(repository.cachedDataset, null);
});

test("invalide le cache dataset après PATCH fiche élève", async () => {
  const repository = Object.create(PostgresRepository.prototype);
  repository.cachedDataset = { students: [{ studentCode: "ELE-1" }] };
  repository.getClassStudentsRepository = () => ({
    updateByStudentCode: async () => ({
      studentCode: "ELE-1",
      parentPhone: "+243800000000",
    }),
  });

  const updated = await repository.updateSchoolStudentByCode(
    "ELE-1",
    "CD-2026-0001",
    { parentPhone: "+243800000000" },
  );

  assert.equal(updated.parentPhone, "+243800000000");
  assert.equal(repository.cachedDataset, null);
});
