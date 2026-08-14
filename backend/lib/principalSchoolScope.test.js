"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePrincipalSchoolCode,
  stripClientSchoolCode,
  scopeResidualItems,
} = require("./principalSchoolScope");
const { BusinessError } = require("../services/authService");

test("scopeResidualItems force le schoolCode du principal", () => {
  const scoped = scopeResidualItems("CD-2026-0001", [{ id: "EX-1", title: "Devoir" }]);
  assert.deepEqual(scoped, [{ id: "EX-1", title: "Devoir", schoolCode: "CD-2026-0001" }]);
});

test("scopeResidualItems rejette un schoolCode imbriqué étranger", () => {
  assert.throws(
    () =>
      scopeResidualItems("CD-2026-0001", [
        { id: "EX-FOREIGN", schoolCode: "BI-2026-0002", title: "Inject" },
      ]),
    (error) => error instanceof BusinessError && error.statusCode === 400,
  );
});

test("stripClientSchoolCode retire le schoolCode racine", () => {
  assert.deepEqual(stripClientSchoolCode({ schoolCode: "BI-2026-0002", periodMode: "trimestre" }), {
    periodMode: "trimestre",
  });
});

test("resolvePrincipalSchoolCode refuse le périmètre global", () => {
  assert.throws(
    () => resolvePrincipalSchoolCode({ schoolCode: "*" }),
    (error) => error instanceof BusinessError && error.statusCode === 400,
  );
});
