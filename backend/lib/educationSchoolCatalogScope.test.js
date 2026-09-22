"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  applyEducationCatalogDeprecationHeaders,
  resolveEducationCatalogSchoolCode,
} = require("./educationSchoolCatalogScope");

test("PARITY-037 query schoolCode est l'autorité de scope explicite", () => {
  assert.equal(
    resolveEducationCatalogSchoolCode({ schoolCode: "CD-IN-26-001" }, "BI-EC-26-001"),
    "BI-EC-26-001",
  );
});

test("PARITY-037 sans query, le JWT établissement est utilisé", () => {
  assert.equal(
    resolveEducationCatalogSchoolCode({ schoolCode: "CD-IN-26-001" }),
    "CD-IN-26-001",
  );
});

test("PARITY-037 alias backoffice pose Deprecation + successor-version", () => {
  const headers = {};
  applyEducationCatalogDeprecationHeaders({
    set(key, value) {
      headers[key] = value;
    },
  });
  assert.equal(headers.Deprecation, "true");
  assert.match(headers.Link, /education-reference\/catalog/);
});

test("PARITY-037 alias PUT pointe vers school-activation canonique", () => {
  const headers = {};
  applyEducationCatalogDeprecationHeaders(
    {
      set(key, value) {
        headers[key] = value;
      },
    },
    "/api/education-reference/school-activation",
  );
  assert.equal(headers.Deprecation, "true");
  assert.match(headers.Link, /education-reference\/school-activation/);
});
