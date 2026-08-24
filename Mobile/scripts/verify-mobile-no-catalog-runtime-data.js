/**
 * Interdit les fixtures catalog.ts comme source de vérité runtime dans les écrans.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const SCREENS = path.join(SRC, "screens");

const FORBIDDEN = [
  /\bgetPresenceRate\b/,
  /\bgetPaymentRate\b/,
  /\bgetStudentById\b/,
  /\bgetTeacherById\b/,
];

const ALLOWED_VALUE_IMPORTS = new Set([
  "MessagesScreen.tsx",
  "AdminCrudScreen.tsx",
]);

function main() {
  const classes = fs.readFileSync(path.join(SCREENS, "ClassesScreen.tsx"), "utf8");
  assert.doesNotMatch(classes, /getPresenceRate/);
  assert.doesNotMatch(classes, /from ["']\.\.\/data\/catalog["']/);
  assert.match(classes, /resolveClassTodayPresenceBadge/);
  assert.match(classes, /filterStudentsByClassIdentity/);
  assert.match(classes, /presencesSnapshot/);
  assert.doesNotMatch(classes, /getPresenceStats/);
  assert.doesNotMatch(classes, /classNameMatches\(student\.className/);
  assert.doesNotMatch(classes, /"0%"/);
  console.log("OK: ClassesScreen n'utilise plus catalog.getPresenceRate");

  const hits = [];
  for (const name of fs.readdirSync(SCREENS)) {
    if (!/\.tsx$/.test(name)) continue;
    const source = fs.readFileSync(path.join(SCREENS, name), "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(source)) hits.push(`${name} ${pattern}`);
    }
    const valueImport = source.match(/import\s+(?!type)\{[^}]+}\s+from\s+["']\.\.\/data\/catalog["']/);
    if (valueImport && !ALLOWED_VALUE_IMPORTS.has(name)) {
      hits.push(`${name} value-import catalog ${valueImport[0]}`);
    }
  }
  assert.deepStrictEqual(hits, [], `catalog runtime data interdite:\n${hits.join("\n")}`);
  console.log("OK: aucun écran hors allowlist n'importe des données runtime de catalog.ts");
}

main();
