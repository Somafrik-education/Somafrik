const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = [
  { platform: "Web", root: path.join(ROOT, "web", "src"), uiSegments: ["pages", "components", "design-system"] },
  { platform: "Mobile", root: path.join(ROOT, "Mobile", "src"), uiSegments: ["screens", "components"] },
];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE = /(?:\.test\.|\.spec\.|__tests__|\/lib\/dates\.(?:ts|js)$)/;
const DATE_NAME = /\b(?:date|Date|startDate|endDate|birthDate|dueDate|paidAt|createdAt|updatedAt|scheduledAt|publishedAt|sentAt|enrollmentDate|paymentDate|attendanceDate)\b/g;
const RULES = [
  ["D7_DIRECT_LOCALE", /\.toLocaleDateString\s*\(/g, "Utiliser formatDateForDisplay()."],
  ["D7_DIRECT_INTL", /Intl\.DateTimeFormat\s*\(/g, "Centraliser dans dates.ts."],
  ["D5_RAW_ISO_SPLIT", /\.split\(\s*["']T["']\s*\)\s*\[0\]/g, "Ne pas formater une date UI par split ISO."],
  ["D5_RAW_ISO_SLICE", /\.slice\(\s*0\s*,\s*10\s*\)/g, "Vérifier qu'il ne s'agit pas d'un formatage UI ISO."],
  ["D1_BAD_PLACEHOLDER", /(?:DD\/MM\/YYYY|JJ\/MM\/AAAA|YYYY-MM-DD)/g, "Le contrat UI est JJ-MM-AAAA."],
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const inventory = [];
const violations = [];
const nativeDateInputs = [];
for (const target of TARGETS) {
  for (const file of walk(target.root)) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    if (IGNORE.test(`/${relative}`)) continue;
    const source = fs.readFileSync(file, "utf8");
    const isUi = target.uiSegments.some((segment) => relative.includes(`/${segment}/`));
    const dateTerms = [...source.matchAll(DATE_NAME)].length;
    const dateInputs = [...source.matchAll(/type\s*=\s*["']date["']/g)].length;
    if (dateTerms || dateInputs) inventory.push({ platform: target.platform, file: relative, dateTerms, dateInputs });
    if (dateInputs) nativeDateInputs.push({ platform: target.platform, file: relative, count: dateInputs });
    if (!isUi) continue;
    for (const [code, regex, correction] of RULES) {
      regex.lastIndex = 0;
      for (const match of source.matchAll(regex)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push({ code, platform: target.platform, file: relative, line, correction });
      }
    }
  }
}

console.log(`DATE_AUDIT inventory_files=${inventory.length} native_date_inputs=${nativeDateInputs.reduce((n, item) => n + item.count, 0)} violations=${violations.length}`);
for (const item of inventory) console.log(`DATE_INVENTORY ${item.platform} ${item.file} terms=${item.dateTerms} inputs=${item.dateInputs}`);
for (const item of nativeDateInputs) console.log(`DATE_INPUT ${item.platform} ${item.file} count=${item.count}`);
for (const issue of violations) console.error(`DATE_VIOLATION ${issue.code} ${issue.platform} ${issue.file}:${issue.line} — ${issue.correction}`);

if (violations.length) process.exitCode = 1;
