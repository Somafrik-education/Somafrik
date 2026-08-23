import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { studentDisplayName } from "./studentDisplayName";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

assert.equal(
  studentDisplayName({ firstName: "Gaston", lastName: "Kalonda", name: "Gaston Kalonda" }),
  "Gaston Kalonda",
);
assert.notEqual(
  studentDisplayName({ firstName: "Gaston", lastName: "Kalonda", name: "Gaston Kalonda" }),
  "Gaston Gaston Kalonda",
);
assert.equal(
  studentDisplayName({ firstName: "gaston", lastName: "kalonda", name: "gaston kalonda" }),
  "gaston kalonda",
);
assert.doesNotMatch(
  studentDisplayName({ firstName: "gaston", lastName: "kalonda", name: "gaston kalonda" }),
  /gaston gaston/i,
);

assert.equal(
  studentDisplayName({ firstName: "Maeva", lastName: "O'gulgune", name: "Maeva O'gulgune" }),
  "Maeva O'gulgune",
);
assert.equal(
  studentDisplayName({ firstName: "Jean Pierre", lastName: "Mukendi", name: "Jean Pierre Mukendi" }),
  "Jean Pierre Mukendi",
);
assert.equal(
  studentDisplayName({ firstName: "Anne-Marie", lastName: "Kabasele", name: "Anne-Marie Kabasele" }),
  "Anne-Marie Kabasele",
);

assert.equal(
  studentDisplayName({ firstName: "Gaston", lastName: "", name: "Gaston Kalonda" }),
  "Gaston Kalonda",
);
assert.equal(
  studentDisplayName({ firstName: "", lastName: "Kalonda", name: "Gaston Kalonda" }),
  "Gaston Kalonda",
);
assert.equal(
  studentDisplayName({ firstName: "Gaston", name: "Gaston Kalonda" }),
  "Gaston Kalonda",
);
assert.equal(studentDisplayName({ firstName: "", name: "Maeva O'gulgune" }), "Maeva O'gulgune");
assert.equal(studentDisplayName({ matricule: "EL-001", id: "ignored" }), "EL-001");
assert.equal(studentDisplayName({ id: "stu-9" }), "stu-9");
assert.equal(studentDisplayName({}), "");

const list = read("screens/StudentsScreen.tsx");
const detail = read("screens/StudentDetailScreen.tsx");
assert.match(list, /studentDisplayName\(student\)/);
assert.match(detail, /studentDisplayName\(student\)/);
assert.match(list, /student\.name\.toLowerCase\(\)\.includes\(normalizedQuery\)/);
assert.doesNotMatch(list, /\[student\.firstName,\s*student\.name\]/);
assert.doesNotMatch(detail, /\[student\.firstName,\s*student\.name\]/);
assert.doesNotMatch(list, /firstName \+ .*name/);
assert.doesNotMatch(detail, /firstName \+ .*name/);

const helper = read("lib/studentDisplayName.ts");
assert.doesNotMatch(helper, /\.split\(/);
assert.doesNotMatch(helper, /\.replace\(/);
assert.doesNotMatch(helper, /firstName \+ .*student\.name/);

console.log("studentDisplayName.test.ts OK");
