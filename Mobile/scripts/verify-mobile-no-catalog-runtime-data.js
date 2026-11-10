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
]);


/** Type-only imports are erased; value imports from catalog remain forbidden. */
const CATALOG_VALUE_IMPORT = /(?:^|\n)\s*import\s+(?!type\b)(?:\{[^}]*\}|[^\n;]+?)\s+from\s*["']\.\.\/data\/catalog["']/gm;

function catalogValueImport(source) {
  CATALOG_VALUE_IMPORT.lastIndex = 0;
  return CATALOG_VALUE_IMPORT.exec(source)?.[0] ?? null;
}

function verifyImportContract() {
  const cases = [
    [String.raw`import type { SchoolClass } from '../data/catalog';`, false],
    [String.raw`import type {
 SchoolClass,
} from '../data/catalog';`, false],
    [String.raw`import { SchoolClass } from '../data/catalog';`, true],
    [String.raw`import { SchoolClass as Alias } from '../data/catalog';`, true],
    [String.raw`import {
 SchoolClass as Alias,
} from '../data/catalog';`, true],
    [String.raw`import Catalog from '../data/catalog';`, true],
    [String.raw`import * as Catalog from '../data/catalog';`, true],
    [String.raw`import { Other } from './other';
import type { SchoolClass } from '../data/catalog';`, false],
    [String.raw`import type { SchoolClass } from '../data/catalog';
import { liveValue } from '../data/catalog';`, true],
  ];
  for (const [source, expected] of cases) {
    assert.strictEqual(Boolean(catalogValueImport(source)), expected, "catalog import fixture");
  }
  assert.ok(FORBIDDEN.some((pattern) => pattern.test("getPresenceRate")));
}

function main() {
  verifyImportContract();
  const classes = fs.readFileSync(path.join(SCREENS, "ClassesScreen.tsx"), "utf8");
  assert.doesNotMatch(classes, /getPresenceRate/);
  assert.strictEqual(catalogValueImport(classes), null, "ClassesScreen: import de valeur catalog interdit");
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
    const valueImport = catalogValueImport(source);
    if (valueImport && !ALLOWED_VALUE_IMPORTS.has(name)) {
      hits.push(`${name} value-import catalog ${valueImport[0]}`);
    }
  }
  assert.deepStrictEqual(hits, [], `catalog runtime data interdite:\n${hits.join("\n")}`);
  console.log("OK: aucun écran hors allowlist n'importe des données runtime de catalog.ts");
}

main();
