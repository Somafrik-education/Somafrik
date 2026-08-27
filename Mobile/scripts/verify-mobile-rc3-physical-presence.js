/**
 * RC3-2 — Appel physique : enqueue SQLCipher avant réseau, pas de POST direct.
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

function main() {
  const screen = read(path.join(MOBILE, "src/screens/TeacherAttendanceScreen.tsx"));
  const write = read(path.join(MOBILE, "src/offline/outbox/presenceWrite.ts"));
  const engine = read(path.join(MOBILE, "src/offline/outbox/engine.ts"));
  const logs = read(path.join(MOBILE, "src/offline/outbox/logs.ts"));
  const app = read(path.join(MOBILE, "App.tsx"));
  const runtime = read(path.join(MOBILE, "src/offline/outbox/PresenceOutboxRuntime.tsx"));
  const audit = read(path.join(ROOT, "docs/audits/mobile-rc3-physical-offline-presence-2026-08-27.md"));
  const gates = read(path.join(ROOT, ".github/workflows/pr-gates.yml"));
  const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
  const mobilePkg = JSON.parse(read(path.join(MOBILE, "package.json")));

  assert.match(screen, /submitPresenceUpsertFromSession/);
  assert.doesNotMatch(screen, /savePresences\s*\(/);
  assert.doesNotMatch(screen, /submitProtectedMutation/);
  assert.doesNotMatch(screen, /request:\s*\(\)\s*=>\s*savePresences/);
  assert.doesNotMatch(screen, /expo-sqlite/);
  assert.doesNotMatch(screen, /l1_outbox/);
  assert.match(screen, /ROLL_CALL_COPY\.queued/);
  assert.match(screen, /En attente de synchronisation|ROLL_CALL_COPY\.queued/);
  assert.match(screen, /ROLL_CALL_COPY\.syncedAlertTitle/);
  assert.doesNotMatch(screen, /Alert\.alert\(\s*"Appel enregistré"/);
  console.log("OK: Appel branché enqueue-then-drain, pas de POST direct");

  assert.match(write, /enqueueOutboxOperation/);
  assert.match(write, /"presence.upsert"/);
  assert.match(write, /drainOutbox/);
  const insertAt = write.indexOf("const enqueued = await enqueueOutboxOperation");
  assert.ok(insertAt >= 0);
  assert.ok(write.slice(insertAt).indexOf("await drainOutbox") > 0, "enqueue avant drain");
  assert.match(runtime, /drainPresenceOutboxFromSession/);
  assert.match(app, /PresenceOutboxRuntime/);
  console.log("OK: runtime drain SQLCipher, écran sans SQLite");

  assert.match(engine, /event: "enqueue"/);
  assert.match(engine, /event: "claim"/);
  assert.match(engine, /event: "send"/);
  assert.match(engine, /event: "ack"/);
  assert.match(engine, /event: "retry"/);
  assert.match(engine, /event: "reclaim"/);
  assert.match(logs, /RC3_OUTBOX/);
  assert.match(logs, /RC3_PHYSICAL_PRESENCE_SMOKE/);
  assert.match(logs, /RC3_PHYSICAL_PRESENCE_SMOKE_TAG\} OK/);
  console.log("OK: logs enqueue/claim/send/retry/reclaim/ack + smoke OK");

  assert.match(audit, /RC3-2/);
  assert.match(audit, /e51a8da9/);
  assert.match(audit, /Physical/);
  assert.equal(mobilePkg.scripts["verify:mobile-rc3-physical-presence"], "node scripts/verify-mobile-rc3-physical-presence.js");
  assert.equal(mobilePkg.scripts["test:mobile-rc3-physical-presence"], "npx --yes tsx src/offline/outbox/presenceWrite.test.ts");
  assert.equal(rootPkg.scripts["verify:mobile-rc3-physical-presence"], "npm --prefix Mobile run verify:mobile-rc3-physical-presence");
  assert.match(gates, /verify:mobile-rc3-physical-presence/);
  console.log("OK: CI scripts + audit");

  const tests = run("npx", ["--yes", "tsx", "src/offline/outbox/presenceWrite.test.ts"], { cwd: MOBILE });
  process.stdout.write(tests.stdout || "");
  process.stderr.write(tests.stderr || "");
  assert.equal(tests.status, 0, "presenceWrite.test.ts");
  console.log("OK: verify:mobile-rc3-physical-presence");
}

main();
