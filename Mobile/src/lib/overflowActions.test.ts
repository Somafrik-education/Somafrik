import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  LEGACY_STUDENT_ACTION_STACK_DP,
  OVERFLOW_MENU_ITEM_DP,
  OVERFLOW_TRIGGER_DP,
  STUDENT_OVERFLOW_A11Y_LABEL,
  STUDENT_ROW_INLINE_MAX_DP,
  shouldShowOverflowTrigger,
  studentRowOverflowActions,
} from "./overflowActions";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

assert.equal(MIN_TOUCH_TARGET_DP, 44);
assert.equal(OVERFLOW_TRIGGER_DP, 44);
assert.equal(OVERFLOW_MENU_ITEM_DP, 44);
assert.equal(LEGACY_STUDENT_ACTION_STACK_DP, 52);
assert.ok(STUDENT_ROW_INLINE_MAX_DP < 46 + LEGACY_STUDENT_ACTION_STACK_DP);

const updateOnly = studentRowOverflowActions({ canUpdate: true, canDelete: false });
assert.deepEqual(
  updateOnly.map((action) => action.key),
  ["update"],
);
assert.equal(updateOnly[0]?.label, "Modifier");
assert.equal(shouldShowOverflowTrigger(updateOnly), true);

const deleteOnly = studentRowOverflowActions({ canUpdate: false, canDelete: true });
assert.deepEqual(
  deleteOnly.map((action) => action.key),
  ["delete"],
);
assert.equal(deleteOnly[0]?.label, "Supprimer");
assert.equal(deleteOnly[0]?.destructive, true);
assert.equal(shouldShowOverflowTrigger(deleteOnly), true);

const both = studentRowOverflowActions({ canUpdate: true, canDelete: true });
assert.deepEqual(
  both.map((action) => action.key),
  ["update", "delete"],
);
assert.equal(shouldShowOverflowTrigger(both), true);

const none = studentRowOverflowActions({ canUpdate: false, canDelete: false });
assert.deepEqual(none, []);
assert.equal(shouldShowOverflowTrigger(none), false);

const overflow = read("components/OverflowActions.tsx");
assert.match(overflow, /ellipsis-vertical/);
assert.match(overflow, /OVERFLOW_TRIGGER_DP|MIN_TOUCH_TARGET_DP/);
assert.match(overflow, /OVERFLOW_MENU_ITEM_DP/);
assert.match(overflow, /minHeight:\s*OVERFLOW_MENU_ITEM_DP|minHeight:\s*MIN_TOUCH_TARGET_DP/);
assert.doesNotMatch(overflow, /create-outline/);
assert.doesNotMatch(overflow, /trash-outline/);
assert.doesNotMatch(overflow, /pencil/);

const controls = read("components/StudentMutationControls.tsx");
assert.match(controls, /OverflowActions/);
assert.match(controls, /studentRowOverflowActions/);
assert.match(controls, /STUDENT_OVERFLOW_A11Y_LABEL/);
assert.match(controls, /updateSchoolStudent/);
assert.match(controls, /deleteSchoolStudent/);
assert.match(controls, /enrollClassStudent/);
assert.match(controls, /Alert\.alert\("Supprimer l'élève"/);
assert.match(controls, /style:\s*"destructive"/);
assert.match(controls, /testID=\{createTestId\}/);
assert.match(controls, /Inscrire un élève/);
assert.match(controls, /students-create/);
assert.match(controls, /Modifier l'élève/);
assert.match(controls, /Supprimer l'élève/);
assert.doesNotMatch(controls, /marginTop:\s*8/);
assert.doesNotMatch(controls, /smallDanger/);
assert.doesNotMatch(controls, /flexWrap:\s*"wrap"/);
assert.doesNotMatch(
  controls,
  /<Text[^>]*>\s*Modifier\s*<\/Text>/,
  "mode ligne : plus de bouton texte Modifier sous la fiche",
);
assert.doesNotMatch(
  controls,
  /<Text[^>]*>\s*Supprimer\s*<\/Text>/,
  "mode ligne : plus de bouton texte Supprimer sous la fiche",
);

const students = read("screens/StudentsScreen.tsx");
assert.match(students, /style=\{styles\.studentRow\}/);
assert.match(students, /style=\{styles\.studentMain\}/);
assert.match(students, /STUDENT_ROW_TEST_ID\(student\.id\)/);
assert.match(students, /openStudentDetail\(student\.id\)/);
assert.match(students, /MIN_TOUCH_TARGET_DP/);
const mainAt = students.indexOf("style={styles.studentMain}");
const rowTestIdAt = students.indexOf("STUDENT_ROW_TEST_ID", mainAt);
const mainCloseAt = students.indexOf("</TouchableOpacity>", rowTestIdAt);
const overflowAt = students.indexOf("<StudentMutationControls", rowTestIdAt);
assert.ok(mainAt >= 0 && rowTestIdAt > mainAt, "tap fiche porte studentMain + STUDENT_ROW_TEST_ID");
assert.ok(mainCloseAt > rowTestIdAt, "la zone fiche se ferme");
assert.ok(overflowAt > mainCloseAt, "⋮ est sœur de la zone fiche : tap overflow n'ouvre pas StudentDetail");

assert.equal(STUDENT_OVERFLOW_A11Y_LABEL, "Actions de l'élève");

console.log("overflowActions.test.ts OK");
