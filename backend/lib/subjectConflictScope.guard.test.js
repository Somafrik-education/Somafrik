const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const subjectWriters = [
  "backend/db/pedagogyPgStore.js",
  "backend/scripts/migrate-test-data.js",
  "backend/scripts/seed-platform-bulk.js",
];

test("subject upserts scope conflicts by school", () => {
  for (const relativePath of subjectWriters) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /ON CONFLICT\s*\(subject_code\)/,
      `${relativePath} must not use the obsolete global subject_code conflict target`,
    );
    assert.match(
      source,
      /ON CONFLICT\s*\(school_id, subject_code\)/,
      `${relativePath} must use the school-scoped subject conflict target`,
    );
  }
});
