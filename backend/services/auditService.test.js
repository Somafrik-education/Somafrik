"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AuditService, resolveAuditSchoolCode } = require("./auditService");

const LEFTOVER_B = "BI-2026-0001";
const LOGIN_A = "CD-LAC-26-001";

function fakeReq(principal) {
  return {
    principal,
    ip: "127.0.0.1",
    get() {
      return "test-agent";
    },
  };
}

test("audit: leftover JWT n'est plus l'autorité quand membership ou override est fourni", () => {
  assert.equal(
    resolveAuditSchoolCode({ schoolCode: LEFTOVER_B }, { schoolCode: LOGIN_A }),
    LOGIN_A,
  );
  assert.equal(
    resolveAuditSchoolCode({
      schoolCode: LEFTOVER_B,
      enrollmentLoginCode: LOGIN_A,
    }),
    LOGIN_A,
  );
  assert.equal(resolveAuditSchoolCode({ schoolCode: LEFTOVER_B }), LEFTOVER_B);
});

test("audit: enroll/patch/delete propagent le login_code résolu, pas leftover B", async () => {
  const recorded = [];
  const service = new AuditService({
    async recordAudit(payload) {
      recorded.push(payload);
    },
  });
  const leftoverPrincipal = { sub: "user-a", role: "Admin School", schoolCode: LEFTOVER_B };

  await service.record(fakeReq(leftoverPrincipal), "enroll_student", "student", "STU-NEW", {}, {
    schoolCode: LOGIN_A,
  });
  await service.record(fakeReq(leftoverPrincipal), "update_student", "student", "STU-A-001", {}, {
    schoolCode: LOGIN_A,
  });
  await service.record(fakeReq(leftoverPrincipal), "archive_student", "student", "STU-A-001", {}, {
    schoolCode: LOGIN_A,
  });

  assert.equal(recorded.length, 3);
  for (const row of recorded) {
    assert.equal(row.schoolCode, LOGIN_A);
    assert.notEqual(row.schoolCode, LEFTOVER_B);
  }
});
