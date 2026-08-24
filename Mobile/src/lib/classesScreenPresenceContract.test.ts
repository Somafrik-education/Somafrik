/**
 * Contrat Mobile ClassesScreen — métrique présence par classe.
 *   npx tsx Mobile/src/lib/classesScreenPresenceContract.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const classesScreen = fs.readFileSync(path.join("src", "screens", "ClassesScreen.tsx"), "utf8");
const helper = fs.readFileSync(path.join("src", "lib", "classTodayPresenceBadge.ts"), "utf8");
const metrics = fs.readFileSync(path.join("src", "domain", "metrics", "schoolMetrics.ts"), "utf8");

function run() {
  assert.match(classesScreen, /filterStudentsByClassIdentity/);
  assert.match(classesScreen, /resolveClassTodayPresenceBadge/);
  assert.match(classesScreen, /classPresenceBadgeTestId/);
  assert.match(classesScreen, /presencesSnapshot/);
  assert.match(classesScreen, /studentsSnapshot/);
  assert.doesNotMatch(
    classesScreen,
    /classNameMatches\(student\.className/,
    "les élèves d'une classe se lient par classId, pas par nom",
  );
  assert.doesNotMatch(
    classesScreen,
    /getPresenceStats/,
    "ClassesScreen ne recalcule plus un taux historique via getPresenceStats",
  );
  assert.doesNotMatch(classesScreen, /"0%"/);
  assert.doesNotMatch(classesScreen, /`\$\{getPresenceStats/);
  assert.doesNotMatch(classesScreen, /presenceRateLabel/);
  assert.match(classesScreen, /presenceBadge\.badgeText/);

  assert.match(helper, /CLASS_TODAY_PRESENCE_PERIOD = "today"/);
  assert.match(helper, /Non saisi/);
  assert.match(helper, /filterStudentsByClassIdentity/);
  assert.match(helper, /sameAttendanceDay/);
  assert.match(helper, /presenceBelongsToClass/);
  assert.match(helper, /presenceBelongsToSchool/);
  assert.match(helper, /studentBelongsToSchool/);
  assert.doesNotMatch(
    helper,
    /if \(expected && rowSchool\)[\s\S]{0,120}return true;/,
    "presenceBelongsToSchool ne doit plus être fail-open si l'un des schoolCode manque",
  );
  assert.doesNotMatch(
    helper,
    /if \(classCode && rowClassCode\) return rowClassCode === classCode;\s*return true;/,
    "presenceBelongsToClass ne doit plus accepter une ligne sans identité de classe",
  );

  assert.match(metrics, /studentIds === undefined/);
  assert.doesNotMatch(metrics, /studentIds\?\.length/);
  assert.match(metrics, /empty scoped ids MUST NOT fallback to global dataset/);

  console.log("OK: ClassesScreen contrat métrique présence du jour");
}

run();
