/**
 * RC3-1 — preuves statiques Outbox SQLCipher + replay exactly-once.
 * Exécute aussi test:mobile-sqlite-outbox (A–S).
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd || MOBILE,
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 20 * 1024 * 1024,
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkTs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkTs(full, acc);
    else if (/\.(ts|tsx|js)$/.test(name)) acc.push(full);
    }
  return acc;
}

function main() {
  const schema = read(path.join(MOBILE, "src/offline/l1/schema.ts"));
  const types = read(path.join(MOBILE, "src/offline/l1/types.ts"));
  const database = stripComments(read(path.join(MOBILE, "src/offline/l1/database.ts")));
  const engine = read(path.join(MOBILE, "src/offline/outbox/engine.ts"));
  const sqliteStore = read(path.join(MOBILE, "src/offline/outbox/sqliteStore.ts"));
  const registry = read(path.join(MOBILE, "src/offline/outbox/registry.ts"));
  const outboxTypes = read(path.join(MOBILE, "src/offline/outbox/types.ts"));
  const logs = read(path.join(MOBILE, "src/offline/outbox/logs.ts"));
  const httpTransport = read(path.join(MOBILE, "src/offline/outbox/httpTransport.ts"));
  const index = read(path.join(MOBILE, "src/offline/outbox/index.ts"));
  const migrations = read(path.join(MOBILE, "src/offline/l1/migrations.ts"));
  const backendIdem = read(path.join(ROOT, "backend/services/idempotencyService.js"));
  const gates = read(path.join(ROOT, ".github/workflows/pr-gates.yml"));
  const audit = read(path.join(ROOT, "docs/audits/mobile-rc3-sqlite-outbox-exactly-once-2026-08-27.md"));
  const attendance = read(path.join(MOBILE, "src/screens/TeacherAttendanceScreen.tsx"));
  const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
  const mobilePkg = JSON.parse(read(path.join(MOBILE, "package.json")));

  assert.equal(types.includes("L1_LOCAL_SCHEMA_VERSION = 2"), true);
  const v2 = schema.slice(schema.indexOf("export const SCHEMA_MIGRATION_V2"));
  assert.match(v2, /CREATE TABLE IF NOT EXISTS l1_outbox/);
  assert.match(v2, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(v2, /user_id TEXT NOT NULL/);
  assert.match(v2, /school_id TEXT NOT NULL/);
  assert.match(v2, /payload_json TEXT NOT NULL/);
  assert.match(v2, /payload_hash TEXT NOT NULL/);
  assert.match(v2, /lease_owner TEXT/);
  assert.match(v2, /lease_expires_at TEXT/);
  assert.match(v2, /blocked_authorization/);
  assert.match(v2, /failed_terminal/);
  assert.doesNotMatch(v2, /access_token|refresh_token|password|jwt/i);
  assert.doesNotMatch(v2, /^\s+authorization\s+/im);
  assert.doesNotMatch(v2, /https?:\/\//i);
  assert.match(migrations, /SCHEMA_MIGRATION_V2/);
  console.log("OK: schema V2 outbox SQLCipher, pas de secret ni d'URL");

  assert.match(database, /PRAGMA cipher_version/);
  assert.match(database, /BEGIN EXCLUSIVE TRANSACTION/);
  assert.match(database, /createSqliteOutboxStore/);
  assert.match(database, /outboxStoreFor/);
  assert.doesNotMatch(database, /withExclusiveTransactionAsync/);
  console.log("OK: SQLCipher obligatoire, outbox dans la même DB chiffrée");

  assert.match(registry, /presence\.upsert/);
  assert.match(registry, /path: "\/presences"/);
  assert.match(registry, /OUTBOX_ERROR\.UNKNOWN_OPERATION/);
  assert.match(outboxTypes, /UNKNOWN_OPERATION: "OUTBOX_UNKNOWN_OPERATION"/);
  assert.doesNotMatch(registry, /enqueue\(url/);
  assert.match(engine, /enqueueOutboxOperation/);
  assert.match(engine, /drainOutbox/);
  assert.match(engine, /claimNextOutboxOperation/);
  assert.match(engine, /ackOutboxOperation/);
  assert.match(engine, /releaseForRetry/);
  assert.match(engine, /blockForAuthorization/);
  assert.match(engine, /markTerminalFailure/);
  assert.match(engine, /reclaimExpiredLeases/);
  assert.match(engine, /idempotencyKey: claimed.idempotencyKey/);
  assert.match(engine, /txn.insert\(row\)/);
  assert.match(engine, /state: "pending"/);
  assert.match(sqliteStore, /ORDER BY created_at ASC, outbox_id ASC/);
  assert.match(sqliteStore, /lease_owner/);
  assert.match(sqliteStore, /state = 'in_flight'/);
  assert.match(sqliteStore, /lease_expires_at IS NULL OR lease_expires_at <=/);
  assert.match(engine, /blocked_authorization/);
  assert.match(engine, /IDEMPOTENCY_KEY_REUSED/);
  assert.doesNotMatch(engine, /DELETE FROM l1_outbox/);
  assert.doesNotMatch(sqliteStore, /DELETE FROM l1_outbox/);
  assert.match(outboxTypes, /OUTBOX_REPLAY_HORIZON_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(outboxTypes, /SERVER_OFFLINE_IDEMPOTENCY_TTL_MS = 35 \* 24 \* 60 \* 60 \* 1000/);
  console.log("OK: enqueue-before-network, lease/reclaim, même clé, 401/403 conservés");

  assert.match(logs, /RC3_OUTBOX/);
  assert.doesNotMatch(logs, /payload_json/);
  assert.doesNotMatch(httpTransport, /Authorization/);
  assert.match(httpTransport, /idempotencyKey: input.idempotencyKey/);
  assert.match(index, /enqueueOutboxOperation/);
  assert.match(attendance, /offline\/outbox\/presenceWrite/);
  assert.doesNotMatch(attendance, /sqliteStore|l1_outbox|expo-sqlite/);
  console.log("OK: logs non sensibles, transport live auth, Appel via façade");

  const screenFiles = walkTs(path.join(MOBILE, "src/screens"));
  for (const file of screenFiles) {
    const src = read(file);
    assert.doesNotMatch(src, /from ["']expo-sqlite["']/, file);
    assert.doesNotMatch(src, /l1_outbox/, file);
    const isAttendance = /TeacherAttendanceScreen\.tsx$/.test(file);
    if (isAttendance) {
      assert.match(src, /offline\/outbox\/presenceWrite/);
      assert.doesNotMatch(src, /offline\/outbox\/sqliteStore/);
      continue;
    }
    assert.doesNotMatch(src, /offline\/outbox/, file);
  }
  console.log("OK: aucun écran n'accède à expo-sqlite / SQLCipher direct");

  assert.match(backendIdem, /TTL_OFFLINE_REPLAY_MS = 35 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(backendIdem, /TTL_DEFAULT_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(backendIdem, /TTL_PAYMENTS_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(backendIdem, /POST \\\/api\\\/presences/);
  assert.match(backendIdem, /ttlForRoute/);
  console.log("OK: TTL serveur ciblé présences 35j > horizon outbox 30j");

  assert.equal(mobilePkg.scripts["verify:mobile-sqlite-outbox"], "node scripts/verify-mobile-sqlite-outbox.js");
  assert.equal(mobilePkg.scripts["test:mobile-sqlite-outbox"], "npx --yes tsx src/offline/outbox/sqliteOutbox.test.ts");
  assert.equal(rootPkg.scripts["verify:mobile-sqlite-outbox"], "npm --prefix Mobile run verify:mobile-sqlite-outbox");
  assert.equal(rootPkg.scripts["test:mobile-sqlite-outbox"], "npm --prefix Mobile run test:mobile-sqlite-outbox");
  assert.match(gates, /verify:mobile-sqlite-outbox/);
  assert.match(gates, /test:mobile-sqlite-outbox/);
  assert.match(audit, /RC3-1/);
  assert.match(audit, /OUTBOX_REPLAY_HORIZON/);
  assert.match(audit, /exactly-once/);
  console.log("OK: scripts CI + audit RC3-1");

  const tests = run("npx", ["--yes", "tsx", "src/offline/outbox/sqliteOutbox.test.ts"], { cwd: MOBILE });
  process.stdout.write(tests.stdout || "");
  process.stderr.write(tests.stderr || "");
  assert.equal(tests.status, 0, "sqliteOutbox.test.ts");

  const ttl = run("node", ["--test", "lib/idempotencyService.test.js"], { cwd: path.join(ROOT, "backend") });
  process.stdout.write(ttl.stdout || "");
  process.stderr.write(ttl.stderr || "");
  assert.equal(ttl.status, 0, "idempotencyService.test.js");

  console.log("OK: verify:mobile-sqlite-outbox");
}

main();
