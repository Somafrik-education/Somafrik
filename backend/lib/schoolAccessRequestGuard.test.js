"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertActiveSchoolRequest } = require("./schoolAccessRequestGuard");

const principal = { sub: "user-1", role: "Enseignant", roleKeys: ["TEACHER"], schoolCode: "CD-2026-0001" };
const state = (status) => ({
  schools: [{ code: "CD-2026-0001", loginCode: "CD-2026-0001", status: "active" }],
  subscriptions: [{ schoolCode: "CD-2026-0001", dbStatus: status, status }],
});

test("O9-R1b : stale school JWT rejected immediately on suspended/expired status", async () => {
  for (const status of ["suspended", "expired"]) {
    await assert.rejects(() => assertActiveSchoolRequest(principal, "/api/students", async () => state(status)), (err) => err.statusCode === 403);
    await assert.rejects(() => assertActiveSchoolRequest({ ...principal, role: "Parent", roleKeys: ["PARENT"] }, "/api/finances", async () => state(status)), (err) => err.statusCode === 403);
  }
});

test("O9-R1b : active school JWT allowed, platform and logout exempt", async () => {
  await assert.doesNotReject(() => assertActiveSchoolRequest(principal, "/api/students", async () => state("active")));
  await assert.doesNotReject(() => assertActiveSchoolRequest(principal, "/api/auth/logout", async () => { throw Error("must not load"); }));
  await assert.doesNotReject(() => assertActiveSchoolRequest({ role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" }, "/api/students", async () => { throw Error("must not load"); }));
});

test("O9-R1b : non-canonical SUPERADMIN cannot bypass tenant gate", async () => {
  await assert.rejects(
    () => assertActiveSchoolRequest({ role: "Superadmin", roleKeys: ["SUPERADMIN"], schoolCode: "*" }, "/api/students", async () => state("active")),
    (err) => err.statusCode === 403,
  );
});
