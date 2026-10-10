"use strict";

const assert = require("node:assert/strict");
const {
  validateEnrollStudentInput,
  validateUpdateStudentInput,
  assertEnrollmentScopeImmutable,
  parseAndValidateBirthDate,
  redactAdministrativeNotesForPrincipal,
} = require("./classStudentsManagement");

function testForbiddenKeysAlwaysRejected() {
  for (const key of [
    "classCode",
    "class_code",
    "schoolCode",
    "school_code",
    "className",
    "class_name",
    "schoolId",
    "school_id",
    "academicYearId",
    "academic_year_id",
    "matricule",
    "studentCode",
    "loginCode",
    "identityCode",
    "identifier",
    "publicId",
  ]) {
    assert.throws(
      () => assertEnrollmentScopeImmutable({ [key]: "" }),
      (error) => error.statusCode === 400,
      `empty ${key} must be rejected`,
    );
    assert.throws(
      () => assertEnrollmentScopeImmutable({ [key]: "matching-value" }),
      (error) => error.statusCode === 400,
      `non-empty ${key} must be rejected`,
    );
  }
}

function testValidInput() {
  const input = validateEnrollStudentInput(
    { firstName: "Awa", lastName: "Diop", gender: "Féminin" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(input.firstName, "Awa");
  assert.equal(input.lastName, "Diop");
}

function testPersonNameValidation() {
  for (const bad of [123, "123", "  456  "]) {
    assert.throws(
      () => validateEnrollStudentInput({ firstName: bad, lastName: "Diop" }, "SCH-A", "CLS-A"),
      (error) => error.statusCode === 400,
      `firstName numérique doit être refusé: ${JSON.stringify(bad)}`,
    );
    assert.throws(
      () => validateEnrollStudentInput({ firstName: "Awa", lastName: bad }, "SCH-A", "CLS-A"),
      (error) => error.statusCode === 400,
      `lastName numérique doit être refusé: ${JSON.stringify(bad)}`,
    );
  }
  assert.throws(
    () => validateUpdateStudentInput({ firstName: "123", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
    (error) => error.statusCode === 400,
  );
  const accents = validateEnrollStudentInput(
    { firstName: " Élodie ", lastName: "O'Connor-Smith" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(accents.firstName, "Élodie");
  assert.equal(accents.lastName, "O'Connor-Smith");
}

function testBirthDateValidation() {
  assert.throws(
    () => parseAndValidateBirthDate("2026-02-30"),
    (error) => error.statusCode === 400,
  );
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
  assert.throws(
    () => parseAndValidateBirthDate(future),
    (error) => error.statusCode === 400,
  );
  assert.equal(parseAndValidateBirthDate("2012-04-12"), "2012-04-12");
}

function testUpdateRejectsScopeAndRequiresConflictToken() {
  assert.throws(
    () =>
      validateUpdateStudentInput({
        firstName: "Awa",
        classCode: "CLS-X",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        firstName: "Awa",
        schoolCode: "SCH-X",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateUpdateStudentInput({ firstName: "Awa" }),
    (error) => error.statusCode === 400,
  );
  const patch = validateUpdateStudentInput({
    parentPhone: "+243 820 000 001",
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(patch.parentPhone, "+243 820 000 001");
  assert.equal(patch.expectedUpdatedAt, "2026-01-01T00:00:00.000Z");
}

function testParentPhoneValidation() {
  const valid = validateEnrollStudentInput(
    { firstName: "Esther", lastName: "Okito", parentPhone: "+243 820 000 001" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(valid.parentPhone, "+243 820 000 001");
  const plus33 = validateEnrollStudentInput(
    { firstName: "Esther", lastName: "Okito", parentPhone: "+33 6 12 34 56 78" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(plus33.parentPhone, "+33 6 12 34 56 78");
  const empty = validateEnrollStudentInput(
    { firstName: "Esther", lastName: "Okito", parentPhone: "" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(empty.parentPhone, null);
  assert.throws(
    () =>
      validateEnrollStudentInput(
        { firstName: "Esther", lastName: "Okito", parentPhone: "Baudouin OKITO" },
        "SCH-A",
        "CLS-A",
      ),
    (error) => error.statusCode === 400,
  );
}

function testAdministrativeNotesValidation() {
  const token = "2026-01-01T00:00:00.000Z";
  const notesOnly = validateUpdateStudentInput({
    administrativeNotes: "  Note   interne  ",
    expectedUpdatedAt: token,
  });
  assert.equal(notesOnly.administrativeNotes, "Note interne");
  assert.equal(notesOnly.firstName, undefined);

  const cleared = validateUpdateStudentInput({
    administrativeNotes: "   ",
    expectedUpdatedAt: token,
  });
  assert.equal(cleared.administrativeNotes, null);

  const nulled = validateUpdateStudentInput({
    administrative_notes: null,
    expectedUpdatedAt: token,
  });
  assert.equal(nulled.administrativeNotes, null);

  assert.throws(
    () => validateUpdateStudentInput({ expectedUpdatedAt: token }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        administrativeNotes: "x".repeat(2001),
        expectedUpdatedAt: token,
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        administrativeNotes: "<b>secret</b>",
        expectedUpdatedAt: token,
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        administrativeNotes: "ok",
        preferredContactChannel: "PHONE",
        expectedUpdatedAt: token,
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        firstName: "Awa",
        administrativeNotes: 12,
        expectedUpdatedAt: token,
      }),
    (error) => error.statusCode === 400,
  );

  const combined = validateUpdateStudentInput({
    firstName: "Awa",
    administrativeNotes: "combiné",
    expectedUpdatedAt: token,
  });
  assert.equal(combined.firstName, "Awa");
  assert.equal(combined.administrativeNotes, "combiné");

  const identityOnly = validateUpdateStudentInput({
    firstName: "Awa",
    expectedUpdatedAt: token,
  });
  assert.equal(identityOnly.administrativeNotes, undefined);

  const threeLines = validateUpdateStudentInput({
    administrativeNotes: "  Ligne un   \nLigne  deux\n  Ligne trois  ",
    expectedUpdatedAt: token,
  });
  assert.equal(threeLines.administrativeNotes, "Ligne un\nLigne deux\nLigne trois");

  const paragraphs = validateUpdateStudentInput({
    administrativeNotes: "Para un\n\n\nPara deux",
    expectedUpdatedAt: token,
  });
  assert.equal(paragraphs.administrativeNotes, "Para un\n\nPara deux");

  const unicode = validateUpdateStudentInput({
    administrativeNotes: "  Élève — année  \n  deuxième  ",
    expectedUpdatedAt: token,
  });
  assert.equal(unicode.administrativeNotes, "Élève — année\ndeuxième");

  const max = `${"é".repeat(1998)}\nX`;
  assert.equal(max.length, 2000);
  assert.equal(
    validateUpdateStudentInput({ administrativeNotes: max, expectedUpdatedAt: token }).administrativeNotes,
    max,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        administrativeNotes: `${"é".repeat(1999)}\nX`,
        expectedUpdatedAt: token,
      }),
    (error) => error.statusCode === 400,
  );

  const blankLines = validateUpdateStudentInput({
    administrativeNotes: " \n \n ",
    expectedUpdatedAt: token,
  });
  assert.equal(blankLines.administrativeNotes, null);

  const dossier = { firstName: "Awa", administrativeNotes: "secret interne" };
  const hidden = redactAdministrativeNotesForPrincipal(dossier, {
    permissions: ["Élèves:READ", "Voir élèves", "Voir enfant"],
  });
  assert.equal(hidden.firstName, "Awa");
  assert.equal(Object.hasOwn(hidden, "administrativeNotes"), false);
  assert.equal(dossier.administrativeNotes, "secret interne");
  const shown = redactAdministrativeNotesForPrincipal(dossier, {
    permissions: ["Élèves:READ", "Élèves:UPDATE"],
  });
  assert.equal(shown.administrativeNotes, "secret interne");
  const legacy = redactAdministrativeNotesForPrincipal(dossier, {
    permissions: ["Gérer élèves"],
  });
  assert.equal(legacy.administrativeNotes, "secret interne");
  const allPrivileges = redactAdministrativeNotesForPrincipal(dossier, {
    permissions: ["ALL_PRIVILEGES", "Élèves:READ"],
  });
  assert.equal(Object.hasOwn(allPrivileges, "administrativeNotes"), false);
}

function main() {
  testForbiddenKeysAlwaysRejected();
  testValidInput();
  testPersonNameValidation();
  testBirthDateValidation();
  testUpdateRejectsScopeAndRequiresConflictToken();
  testAdministrativeNotesValidation();
  testParentPhoneValidation();
  assert.throws(
    () => validateEnrollStudentInput({ lastName: "Diop" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 400,
  );
  console.log("classStudentsManagement.test.js: OK");
}

main();
