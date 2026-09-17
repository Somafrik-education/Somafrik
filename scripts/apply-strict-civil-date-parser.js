const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FILES = ["web/src/lib/academicPeriods.ts", "Mobile/src/lib/academicPeriods.ts"];

const helper = `function buildCivilDate(year: number, month: number, day: number): Date | null {\n  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;\n  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;\n  const date = new Date(year, month - 1, day);\n  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;\n  return date;\n}\n\n`;

for (const relative of FILES) {
  const file = path.join(ROOT, relative);
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes("function buildCivilDate(")) {
    source = source.replace("export function parsePeriodDate", `${helper}export function parsePeriodDate`);
  }

  source = source.replace(
    /const date = new Date\(Number\(dmy\[3\]\), Number\(dmy\[2\]\) - 1, Number\(dmy\[1\]\)\);\n\s*return Number\.isNaN\(date\.getTime\(\)\) \? null : date;/,
    "return buildCivilDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));",
  );
  source = source.replace(
    /const date = new Date\(Number\(ymd\[1\]\), Number\(ymd\[2\]\) - 1, Number\(ymd\[3\]\)\);\n\s*return Number\.isNaN\(date\.getTime\(\)\) \? null : date;/,
    "return buildCivilDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));",
  );
  source = source.replace(
    /if \(month >= 1 && month <= 12 && day >= 1 && day <= 31\) \{\n\s*const date = new Date\(year, month - 1, day\);\n\s*return Number\.isNaN\(date\.getTime\(\)\) \? null : date;\n\s*\}/,
    "return buildCivilDate(year, month, day);",
  );

  fs.writeFileSync(file, source, "utf8");
  console.log(`STRICT_DATE_PARSER ${relative}`);
}
