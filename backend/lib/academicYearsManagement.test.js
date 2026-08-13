"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FallbackRepository } = require("../db/fallbackRepository");

test("crée une première année scolaire courante utilisable par Classes", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  const created = await repository.createAcademicYearV2({
    schoolCode: "SCH-001",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: true,
  });
  assert.equal(created.name, "2026-2027");
  assert.equal(created.schoolCode, "SCH-001");
  assert.equal(created.isCurrent, true);
  assert.equal((await repository.getAcademicYearsV2()).length, 1);
});

test("refuse une année dupliquée dans le même établissement", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  const payload = {
    schoolCode: "SCH-001",
    name: "2026-2027",
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    isCurrent: true,
  };
  await repository.createAcademicYearV2(payload);
  await assert.rejects(() => repository.createAcademicYearV2(payload), (error) => error.statusCode === 409);
});

test("une nouvelle année courante désactive la précédente", async () => {
  const repository = new FallbackRepository();
  repository._managedAcademicYears = [];
  await repository.createAcademicYearV2({ schoolCode: "SCH-001", name: "2025-2026", startDate: "2025-09-01", endDate: "2026-08-31", isCurrent: true });
  await repository.createAcademicYearV2({ schoolCode: "SCH-001", name: "2026-2027", startDate: "2026-09-01", endDate: "2027-08-31", isCurrent: true });
  const years = await repository.getAcademicYearsV2();
  assert.equal(years.filter((year) => year.isCurrent).length, 1);
  assert.equal(years.find((year) => year.isCurrent).name, "2026-2027");
});
