"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  formatCanonicalTeacherCodes,
  generateNextTeacherCodes,
  teacherPublicCodesMatch,
  sqlTeacherPublicCodeEquals,
  sqlTeacherIdentityEquals,
  isPersonIdentityCode,
} = require("./teacherCodeAllocation");

test("formatCanonicalTeacherCodes émet une seule identité personne", () => {
  const codes = formatCanonicalTeacherCodes(
    { loginCode: "CD-IN-26-001" },
    { firstName: "Jean Pierre", lastName: "Mbuyi" },
    1,
    2026,
  );
  assert.equal(codes.teacherCode, "CD-IN-JPM-26-00001");
  assert.equal(codes.userCode, codes.teacherCode);
  assert.equal(codes.identifier, codes.teacherCode);
  assert.equal(codes.publicId, codes.teacherCode);
  assert.equal(isPersonIdentityCode(codes.teacherCode), true);
});

test("generateNextTeacherCodes ignore les codes ENS et incrémente SEQ5", () => {
  const next = generateNextTeacherCodes(
    "CD-IN-26-001",
    ["ENS-0001", "CD-2026-0001-ENS-0009", "CD-IN-JPM-26-00002"],
    { firstName: "Ada", lastName: "Lovelace" },
    2026,
  );
  assert.equal(next.teacherCode, "CD-IN-AL-26-00003");
});

test("teacherPublicCodesMatch est exact — aucun suffixe ENS", () => {
  assert.equal(teacherPublicCodesMatch("CD-IN-JPM-26-00001", "CD-IN-JPM-26-00001"), true);
  assert.equal(teacherPublicCodesMatch("CD-IN-JPM-26-00001", "ENS-0001"), false);
  assert.equal(teacherPublicCodesMatch("CD-IN-JPM-26-00001", "JPM-26-00001"), false);
});

test("SQL enseignant : user_code + UUID, jamais teacher_code ni right()", () => {
  const publicSql = sqlTeacherPublicCodeEquals("u", "$2");
  assert.equal(publicSql.includes("legacy_teacher_code"), false);
  assert.equal(publicSql.includes("teacher_code"), false);
  assert.equal(publicSql.includes("right("), false);
  assert.match(publicSql, /u\.user_code = \$2/);

  const identity = sqlTeacherIdentityEquals("t", "u", "$2");
  assert.equal(identity.includes("legacy_teacher_code"), false);
  assert.equal(identity.includes("teacher_code"), false);
  assert.equal(identity.includes("ENS-"), false);
  assert.match(identity, /t\.id::text = \$2/);
  assert.match(identity, /u\.id::text = \$2/);
  assert.match(identity, /u\.user_code = \$2/);
});
