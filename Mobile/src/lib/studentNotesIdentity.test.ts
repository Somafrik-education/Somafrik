/** SMOKE-PARITE-02 #1201 : updated identity preferred over stale student.name in Notes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { studentDisplayName } from "./studentDisplayName";

assert.equal(studentDisplayName({ firstName: "Gaston", lastName: "Nouveau", name: "gaston kalonda" }), "Gaston Nouveau");
assert.equal(studentDisplayName({ name: "gaston kalonda" }), "gaston kalonda");
const source = fs.readFileSync(path.join(__dirname, "..", "screens", "StudentNotesScreen.tsx"), "utf8");
assert.match(source, /student \? studentDisplayName\(student\)/, "Notes doit afficher l'identité canonique");
assert.match(source, /void loadStudents\(\)/, "Notes doit recharger la fiche lors du focus");
assert.match(source, /void loadNotes\(\)/, "Notes doit conserver le rechargement des notes");
assert.doesNotMatch(source, /: student\?\.name \?\? session/, "Le vieux nom brut ne doit plus être prioritaire");
console.log("OK SMOKE-PARITE-02: nom canonique actualisé à l'ouverture des Notes");
