/**
 * P0 — taux de présence par classe : [] ≠ global, période = aujourd'hui, classId.
 *
 * Usage : npm run verify:mobile-class-attendance-rate
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function runUnit(rel) {
  const unit = spawnSync("npx", ["--yes", "tsx", rel], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || `${rel} failed`);
  }
  process.stdout.write(unit.stdout || "");
}

function main() {
  for (const rel of [
    "src/domain/metrics/schoolMetrics.test.ts",
    "src/lib/classTodayPresenceBadge.test.ts",
    "src/lib/classesScreenPresenceContract.test.ts",
  ]) {
    runUnit(rel);
  }

  const metrics = fs.readFileSync(path.join(SRC, "domain", "metrics", "schoolMetrics.ts"), "utf8");
  assert.match(metrics, /studentIds === undefined/);
  assert.doesNotMatch(metrics, /studentIds\?\.length/);
  assert.match(metrics, /empty scoped ids MUST NOT fallback to global dataset/);
  assert.match(metrics, /scopeRowsByStudentIds/);

  const classes = fs.readFileSync(path.join(SRC, "screens", "ClassesScreen.tsx"), "utf8");
  assert.match(classes, /resolveClassTodayPresenceBadge/);
  assert.match(classes, /filterStudentsByClassIdentity/);
  assert.doesNotMatch(classes, /getPresenceStats/);
  assert.doesNotMatch(classes, /classNameMatches\(student\.className/);
  assert.doesNotMatch(classes, /"0%"/);

  const helper = fs.readFileSync(path.join(SRC, "lib", "classTodayPresenceBadge.ts"), "utf8");
  assert.match(helper, /CLASS_TODAY_PRESENCE_PERIOD = "today"/);
  assert.match(helper, /Non saisi/);
  assert.match(helper, /studentBelongsToSchool/);
  assert.doesNotMatch(
    helper,
    /if \(classCode && rowClassCode\) return rowClassCode === classCode;\s*return true;/,
  );
  console.log("OK: verify-mobile-class-attendance-rate");
}

main();
