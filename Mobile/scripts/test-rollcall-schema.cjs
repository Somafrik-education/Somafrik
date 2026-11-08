"use strict";

/**
 * Test of SQLite constraints only; does not claim SQLCipher or Hermes validation.
 * Run: node Mobile/scripts/test-rollcall-schema.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const schemaSource = fs.readFileSync(
  path.resolve(__dirname, "../src/offline/rollCall/schema.ts"),
  "utf8",
);
const match = schemaSource.match(/export const ROLL_CALL_SCHEMA_V1 = String\.raw`([\s\S]*?)`;/);
assert.ok(match, "Schema SQL must be declared as a literal (test cannot silently skip)");
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(match[1]);
db.exec(match[1]); // migration is idempotent

const DIGEST = "a".repeat(64);
const base = {
  user: "user-A", school: "school-A", classId: "class-1", date: "2026-11-09",
};
function session(id, override = {}) {
  const s = { ...base, ...override };
  db.prepare(
    `INSERT INTO rc_sessions (
      session_id, user_id, school_id, class_id, roll_call_date,
      state, opened_at, sync_deadline
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(id, s.user, s.school, s.classId, s.date,
    "2026-11-09T07:00:00Z", "2026-11-12T23:00:00Z");
}
const scan = db.prepare(
  `INSERT INTO rc_scans (scan_id, session_id, public_id, proof, medium, scanned_at, local_status)
   VALUES (?, ?, ?, ?, 'nfc', '2026-11-09T07:30:00Z', 'verified_local')`
);
const mark = db.prepare(
  `INSERT INTO rc_marks(session_id, match_key, status, source, updated_at)
   VALUES (?, ?, ?, 'manual', '2026-11-09T07:30:00Z')`
);

session("one");
assert.throws(() => session("two"), /UNIQUE constraint failed/, "one draft per class per date");
assert.throws(() => scan.run("scan-X", "nonexistent", "card-X", "proof-X"), /FOREIGN KEY/);
scan.run("scan-A", "one", "card-A", "proof-A");
assert.throws(() => scan.run("scan-B", "one", "card-A", "proof-B"), /UNIQUE constraint failed/,
  "same card must not be scanned twice while active");
mark.run("one", "student-1", "present");
assert.throws(() => mark.run("one", "student-1", "absent"), /UNIQUE constraint failed/);
assert.throws(() => mark.run("one", "student-2", "excused"), /CHECK constraint failed/);

db.prepare(
  `UPDATE rc_sessions SET state = 'closed', operation_id = ?, payload_digest = ?, frozen_body = ? WHERE session_id = ?`
).run("operation-1", DIGEST, new Uint8Array([1, 2, 3]), "one");
assert.throws(
  () => db.exec("UPDATE rc_sessions SET payload_digest = '" + "b".repeat(64) + "' WHERE session_id = 'one'"),
  /RC_FROZEN_BODY_IMMUTABLE/,
);
assert.throws(
  () => db.exec("UPDATE rc_sessions SET operation_id = 'operation-2' WHERE session_id = 'one'"),
  /RC_FROZEN_BODY_IMMUTABLE/,
);
assert.throws(
  () => db.exec("UPDATE rc_sessions SET frozen_body = x'01020304' WHERE session_id = 'one'"),
  /RC_FROZEN_BODY_IMMUTABLE/,
);
assert.throws(
  () => db.exec("UPDATE rc_sessions SET state = 'draft', revision = 2 WHERE session_id = 'one'"),
  /RC_REVISION_NOT_ATTESTED/,
);
assert.throws(() => scan.run("scan-C", "one", "card-C", "proof-C"), /RC_SCAN_SESSION_NOT_DRAFT/);
assert.throws(() => mark.run("one", "student-2", "absent"), /RC_MARK_SESSION_NOT_DRAFT/);
assert.throws(() => db.exec("UPDATE rc_marks SET status = 'late' WHERE session_id = 'one'"),
  /RC_MARK_SESSION_NOT_DRAFT/);

db.exec("UPDATE rc_sessions SET state = 'failed_action_required' WHERE session_id = 'one'");
assert.throws(
  () => db.exec("UPDATE rc_sessions SET state = 'draft', revision = 2, frozen_body = NULL, operation_id = NULL, payload_digest = NULL WHERE session_id = 'one'"),
  /RC_REVISION_NOT_ATTESTED/,
);
db.exec("UPDATE rc_sessions SET last_session_state = 'not_recorded' WHERE session_id = 'one'");
db.exec("UPDATE rc_sessions SET state = 'draft', revision = 2, frozen_body = NULL, operation_id = NULL, payload_digest = NULL WHERE session_id = 'one'");
assert.equal(db.prepare("SELECT revision FROM rc_sessions WHERE session_id = 'one'").get().revision, 2);
scan.run("scan-C", "one", "card-C", "proof-C");

db.exec("BEGIN IMMEDIATE");
scan.run("scan-T", "one", "card-T", "proof-T");
db.exec("ROLLBACK");
assert.equal(db.prepare("SELECT count(*) AS n FROM rc_scans WHERE scan_id = 'scan-T'").get().n, 0);
db.close();
console.log("PASS: roll-call schema SQLite invariants (SQLCipher/Hermes NOT tested)");
