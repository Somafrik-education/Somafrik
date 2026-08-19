/**
 * P0 — écran connexion établissement : aucun code / école pré-sélectionné.
 *   npx tsx Mobile/src/lib/roleSelectionSchoolCode.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROLE_SELECTION_COPY } from "./loginScreenSpec";

const ROOT = path.join(__dirname, "..", "..", "..");
const screen = fs.readFileSync(
  path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"),
  "utf8",
);

assert.equal(ROLE_SELECTION_COPY.placeholderExample, "CD-IN-26-001");
assert.doesNotMatch(ROLE_SELECTION_COPY.placeholderExample, /CD-2026-0001/);

assert.match(screen, /const \[accessCode, setAccessCode\] = useState\(""\);/);
assert.match(screen, /const \[school, setSchool\] = useState<SchoolInfo \| null>\(null\);/);
assert.doesNotMatch(screen, /useState\(["']CD-2026-0001["']\)/);
assert.doesNotMatch(screen, /CD-2026-0001/);
assert.match(screen, /placeholder=\{ROLE_SELECTION_COPY\.placeholderExample\}/);
assert.match(screen, /disabled=\{isLoading \|\| !accessCode\.trim\(\)\}/);
assert.match(screen, /\{school && \(/);
assert.match(screen, /ROLE_SELECTION_COPY\.successMessage/);
assert.ok(
  screen.indexOf("const [school, setSchool]") < screen.indexOf("ROLE_SELECTION_COPY.successMessage"),
  "successMessage n'est pas un état initial",
);
assert.match(screen, /code: isGlobal \? "PLATFORM" : `PLATFORM-\$\{scope\}`/);
assert.doesNotMatch(screen, /code:\s*["']CD-2026-0001["']/);

console.log("OK roleSelectionSchoolCode: accessCode === \"\" ; school === null ; pas d'école auto-sélectionnée");
