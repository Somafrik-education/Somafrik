"use strict";

const assert = require("node:assert/strict");
const {
  FORBIDDEN_BODY_KEYS,
  validateCreateTeacherInput,
  assertTeacherCreateScopeImmutable,
  isExactTeacherCivilIdentity,
} = require("./teachersManagement");
const { generateNextTeacherCodes, extractEnsSequence } = require("./teacherCodeAllocation");

function expectStatus(fn, statusCode, code) {
  try {
    fn();
    assert.fail("expected error");
  } catch (error) {
    assert.equal(error.statusCode, statusCode, error.message);
    if (code) {
      assert.equal(error.code, code);
    }
  }
}

function validBody(overrides = {}) {
  return {
    firstName: "Awa",
    lastName: "Diop",
    birthDate: "1990-04-12",
    phone: "+243 800 000 001",
    temporaryPassword: "TempPass1",
    ...overrides,
  };
}

function main() {
  assert.ok(FORBIDDEN_BODY_KEYS.includes("schoolCode"));
  assert.ok(FORBIDDEN_BODY_KEYS.includes("school_id"));
  assert.ok(FORBIDDEN_BODY_KEYS.includes("role"));
  assert.ok(FORBIDDEN_BODY_KEYS.includes("teacherCode"));
  assert.ok(FORBIDDEN_BODY_KEYS.includes("userId"));

  expectStatus(() => assertTeacherCreateScopeImmutable({ schoolCode: "CD-2026-0001" }), 400);
  expectStatus(() => assertTeacherCreateScopeImmutable({ school_id: "x" }), 400);
  expectStatus(() => assertTeacherCreateScopeImmutable({ role: "Enseignant" }), 400);
  expectStatus(() => assertTeacherCreateScopeImmutable({ teacherCode: "ENS-0001" }), 400);

  const ok = validateCreateTeacherInput(validBody(), "CD-2026-0001");
  assert.equal(ok.firstName, "Awa");
  assert.equal(ok.lastName, "Diop");
  assert.equal(ok.birthDate, "1990-04-12");
  assert.ok(ok.entryDate);

  expectStatus(() => validateCreateTeacherInput(validBody({ firstName: "" }), "CD-2026-0001"), 400);
  expectStatus(() => validateCreateTeacherInput(validBody({ lastName: "" }), "CD-2026-0001"), 400);
  expectStatus(
    () => validateCreateTeacherInput(validBody({ phone: undefined, email: undefined }), "CD-2026-0001"),
    400,
  );
  expectStatus(
    () => validateCreateTeacherInput(validBody({ birthDate: "2099-01-01" }), "CD-2026-0001"),
    400,
  );
  expectStatus(
    () => validateCreateTeacherInput(validBody({ birthDate: "2020-01-01", entryDate: "2020-06-01" }), "CD-2026-0001"),
    400,
  );
  expectStatus(
    () => validateCreateTeacherInput(validBody({ temporaryPassword: "short" }), "CD-2026-0001"),
    400,
  );
  expectStatus(() => validateCreateTeacherInput(validBody(), "*"), 400);

  assert.equal(
    isExactTeacherCivilIdentity(
      { firstName: "Awa", lastName: "Diop", birthDate: "1990-04-12", gender: "Féminin" },
      { firstName: "awa", lastName: "diop", birthDate: "1990-04-12", gender: "Féminin" },
    ),
    true,
  );
  assert.equal(
    isExactTeacherCivilIdentity(
      { firstName: "Awa", lastName: "Diop", birthDate: "1990-04-12" },
      { firstName: "Awa", lastName: "Diop", birthDate: "1991-04-12" },
    ),
    false,
  );
  assert.equal(
    isExactTeacherCivilIdentity(
      { firstName: "Awa", lastName: "Diop", birthDate: "1990-04-12" },
      { firstName: "Awa", lastName: "Diop", birthDate: "" },
    ),
    false,
  );

  assert.equal(extractEnsSequence("CD-2026-0001-ENS-0012"), 12);
  const codes = generateNextTeacherCodes("CD-2026-0001", ["CD-2026-0001-ENS-0003", "ENS-0005"]);
  assert.equal(codes.identifier, "ENS-0006");
  assert.equal(codes.teacherCode, "CD-2026-0001-ENS-0006");
  assert.equal(codes.userCode, codes.teacherCode);

  console.log("teachersManagement.test.js: OK");
}

main();
