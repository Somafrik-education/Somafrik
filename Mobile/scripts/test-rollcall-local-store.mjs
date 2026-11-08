/**
 * Execute with Node 22+:
 * node --experimental-strip-types Mobile/scripts/test-rollcall-local-store.mjs
 * Tests SQLite transaction semantics; NOT a native SQLCipher/Hermes proof.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createRollCallLocalStore } = await import(
  pathToFileURL(path.join(root, "src/offline/rollCall/localStore.ts")).href
);
const { applyRollCallSchemaV1 } = await import(
  pathToFileURL(path.join(root, "src/offline/rollCall/schema.ts")).href
);
let touched = false;
await assert.rejects(
  applyRollCallSchemaV1({
    getFirstAsync: async () => null,
    execAsync: async () => { touched = true; },
  }),
  (error) => error.code === "RC_SQLCIPHER_REQUIRED",
);
assert.equal(touched, false, "no schema DDL when cipher_version absent");

const source = fs.readFileSync(path.join(root, "src/offline/rollCall/schema.ts"), "utf8");
const match = source.match(/export const ROLL_CALL_SCHEMA_V1 = String\.raw\`([\s\S]*?)\`;/);
assert.ok(match);
const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");
database.exec(match[1]);

let rejectScan = false;
const handle = {
  execAsync: async (sql) => database.exec(sql),
  getFirstAsync: async (sql, params = []) => database.prepare(sql).get(...params) ?? null,
  runAsync: async (sql, params = []) => {
    if (rejectScan && sql.startsWith("INSERT INTO rc_scans")) {
      throw new Error("SIMULATED_DISK_FULL");
    }
    return database.prepare(sql).run(...params);
  },
};
const store = createRollCallLocalStore(handle);
const session = {
  sessionId: "session-1", userId: "teacher-1", schoolId: "school-1",
  classId: "class-1", date: "2026-11-09", openedAt: "2026-11-09T07:00:00Z",
  syncDeadline: "2026-11-12T23:00:00Z",
};
assert.deepEqual(await store.openDraft(session), {scans:0, marks:0});
// The schema permits only one roll-call per class and day; use another class
// to isolate the concurrency snapshot test from that uniqueness invariant.
const secondSession = {...session, sessionId: "session-concurrent-open", classId: "class-concurrent-open"};
const opening = store.openDraft(secondSession);
const queuedFirstScan = store.recordScan({
  scanId: "scan-opening", sessionId: secondSession.sessionId, publicId: "public-opening",
  proof: "fake-proof-for-test", medium: "nfc",
  scannedAt: "2026-11-09T07:30:00Z", localStatus: "unknown_local",
});
assert.deepEqual(await opening, {scans:0, marks:0},
  "openDraft must not observe a later queued scan");
assert.deepEqual(await queuedFirstScan, {
  duplicate: false, counts: {scans:1,marks:0},
});
const scan = {
  scanId: "scan-1", sessionId: session.sessionId, publicId: "public-1",
  proof: "fake-proof-for-test", medium: "nfc",
  scannedAt: "2026-11-09T07:31:00Z", localStatus: "unknown_local",
};
assert.deepEqual(await store.recordScan(scan), {
  duplicate: false, counts: {scans:1,marks:0},
});
assert.deepEqual(await store.recordScan({...scan, scanId:"scan-2"}), {
  duplicate: true, counts: {scans:1,marks:0},
});
// Concurrent scans must return the count at their own COMMIT, not a later
// transaction's count (the UI uses this snapshot for its scan feedback).
const concurrent = await Promise.all([
  store.recordScan({...scan, scanId:"scan-concurrent-1", publicId:"public-concurrent-1"}),
  store.recordScan({...scan, scanId:"scan-concurrent-2", publicId:"public-concurrent-2"}),
]);
assert.deepEqual(concurrent.map((item) => item.counts.scans), [2,3]);
rejectScan = true;
await assert.rejects(store.recordScan({...scan, scanId:"scan-3", publicId:"public-3"}),
  /SIMULATED_DISK_FULL/);
rejectScan = false;
assert.deepEqual(await store.counts(session.sessionId), {scans:3,marks:0},
  "no counter increase before committed scan");
assert.deepEqual(await store.recordMark(session.sessionId,"student-1","absent","manual",
  "2026-11-09T07:31:00Z"), {scans:3,marks:1});
assert.deepEqual(await store.recordMark(session.sessionId,"student-1","present","manual",
  "2026-11-09T07:32:00Z"), {scans:3,marks:1});
const concurrentMarks = await Promise.all([
  store.recordMark(session.sessionId,"student-2","present","manual","2026-11-09T07:32:01Z"),
  store.recordMark(session.sessionId,"student-3","late","manual","2026-11-09T07:32:02Z"),
]);
assert.deepEqual(concurrentMarks.map((item) => item.marks), [2,3],
  "mark feedback must reflect its own transaction snapshot");

await store.freeze(session.sessionId,"operation-1","a".repeat(64),
  new Uint8Array([12,34,56]),"2026-11-09T07:33:00Z");
await assert.rejects(store.recordScan({...scan,scanId:"scan-4",publicId:"public-4"}),
  /RC_SCAN_SESSION_NOT_DRAFT/);
await assert.rejects(store.recordScan({...scan,scanId:"scan-5"}),
  /RC_SCAN_SESSION_NOT_DRAFT/, "duplicate must not be acknowledged after freeze");
await assert.rejects(store.recordMark(session.sessionId,"student-2","absent","default",
  "2026-11-09T07:34:00Z"), /RC_MARK_SESSION_NOT_DRAFT/);
await assert.rejects(store.freeze(session.sessionId,"operation-2","b".repeat(64),
  new Uint8Array([99]),"2026-11-09T07:35:00Z"), /RC_SESSION_NOT_DRAFT/);
assert.deepEqual(await store.counts(session.sessionId), {scans:3,marks:3});
database.close();
console.log("PASS: local store transactions / duplicates / frozen state / SQLCipher fail closed (native NOT tested)");
