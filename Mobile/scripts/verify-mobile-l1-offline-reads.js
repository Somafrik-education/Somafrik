/**
 * Vérifie le branchement des lectures Mobile sur le cache SQLite L1.
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
  const readModel = read(path.join(MOBILE, "src/offline/l1/readModel.ts"));
  const projection = read(path.join(MOBILE, "src/offline/l1/uiProjection.ts"));
  const dataTruth = read(path.join(MOBILE, "src/lib/dataTruth.ts"));
  const admin = read(path.join(MOBILE, "src/context/AdminDataContext.tsx"));
  const establishment = read(path.join(MOBILE, "src/lib/establishment.ts"));
  const gates = read(path.join(ROOT, ".github/workflows/pr-gates.yml"));
  const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
  const mobilePkg = JSON.parse(read(path.join(MOBILE, "package.json")));

  assert.match(readModel, /export async function readL1Resource/);
  assert.match(readModel, /resolveL1Partition/);
  assert.match(readModel, /meta\.state !== "ready"/);
  assert.match(readModel, /NETWORK_UNAVAILABLE/);
  assert.match(readModel, /ready_offline/);
  assert.match(
    readModel,
    /try \{\s*rows = await storeResult\.store\.listRows\([\s\S]*?catch \{\s*return \{ ok: false, reason: "sqlcipher_unavailable" \}/,
  );
  assert.match(projection, /subject_code/);
  assert.match(projection, /teacherUserId/);
  assert.match(dataTruth, /source\?:/);
  assert.match(dataTruth, /l1-cache/);
  assert.match(admin, /loadL1BackedSnapshot/);
  assert.match(admin, /resource: "school-courses"/);
  assert.match(admin, /filterL1AssignmentsForTeacherSession/);
  assert.match(establishment, /teacherUserId/);
  assert.match(establishment, /teacher_user_id/);
  assert.match(establishment, /export function l1AssignmentBelongsToTeacherSession/);
  assert.match(establishment, /teacherUserId === userId/);

  for (const rel of [
    "src/screens/ClassesScreen.tsx",
    "src/screens/StudentsScreen.tsx",
    "src/screens/TimetableScreen.tsx",
    "src/screens/SchoolPedagogicalStructureScreen.tsx",
    "src/screens/StudentDetailScreen.tsx",
  ]) {
    const source = read(path.join(MOBILE, rel));
    assert.doesNotMatch(source, /expo-sqlite/);
    assert.doesNotMatch(source, /from ["'].*offline\/l1\/database/);
    assert.doesNotMatch(source, /listRows\(/);
  }

  assert.equal(mobilePkg.scripts["verify:mobile-l1-offline-reads"], "node scripts/verify-mobile-l1-offline-reads.js");
  assert.equal(rootPkg.scripts["verify:mobile-l1-offline-reads"], "npm --prefix Mobile run verify:mobile-l1-offline-reads");
  assert.match(gates, /verify:mobile-l1-offline-reads/);

  const tests = run("npx", ["--yes", "tsx", "src/offline/l1/l1OfflineReads.test.ts"]);
  process.stdout.write(tests.stdout || "");
  process.stderr.write(tests.stderr || "");
  assert.equal(tests.status, 0, "l1OfflineReads.test.ts");
  console.log("OK: verify:mobile-l1-offline-reads");
}

main();
