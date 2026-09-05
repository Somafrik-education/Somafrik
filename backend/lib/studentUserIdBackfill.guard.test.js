"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260907_student_user_id.sql"),
  "utf8",
);

test("20260907 ne touche pas la CHECK canonique et n'écrit pas l'identité", () => {
  assert.doesNotMatch(MIGRATION, /DROP CONSTRAINT/i);
  assert.doesNotMatch(MIGRATION, /VALIDATE CONSTRAINT/i);
  assert.doesNotMatch(MIGRATION, /DISABLE TRIGGER/i);
  assert.doesNotMatch(MIGRATION, /SET student_code/i);
  assert.doesNotMatch(MIGRATION, /SET identity_code/i);
  assert.doesNotMatch(MIGRATION, /SET login_code/i);
});

test("20260907 exclut du backfill les students qui feraient échouer la CHECK (23514)", () => {
  assert.match(MIGRATION, /students_canonical_identifier_format_check/);
  assert.match(MIGRATION, /\[A-Z\]\{2\}-\[A-Z0-9\]\{2,5\}-\[A-Z0-9\]\{1,5\}-\[0-9\]\{2\}-\[0-9\]\{5\}/);
  assert.match(MIGRATION, /\[A-Z\]\{2\}-\[A-Z0-9\]\{2,5\}-EL-\[0-9\]\{2\}-\[0-9\]\{3\}/);
  assert.match(MIGRATION, /to_jsonb\(st\) \? 'login_code'/);
  assert.match(MIGRATION, /to_jsonb\(st\) \? 'identity_code'/);
  const updateBlocks = MIGRATION.split(/UPDATE students st/i).slice(1);
  assert.equal(updateBlocks.length, 2, "deux UPDATE students de backfill");
  for (const block of updateBlocks) {
    assert.match(block, /to_jsonb\(st\) \? 'login_code'/);
    assert.match(block, /student_code ~/);
  }
});
