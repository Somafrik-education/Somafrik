const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = process.argv.includes("--report-only");
const REPORT_PATH = path.join(ROOT, "docs", "audits", "date-fields-web-mobile.generated.md");
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

const webFiles = inventory.filter((item) => item.platform === "Web").length;
const mobileFiles = inventory.filter((item) => item.platform === "Mobile").length;
const inputCount = nativeDateInputs.reduce((n, item) => n + item.count, 0);
const lines = [
  "# Audit automatisé des dates Web / Mobile",
  "",
  "> Généré par `scripts/audit-date-ui-contract.js`. Ne pas éditer manuellement.",
  "",
  `- Fichiers candidats : **${inventory.length}** (Web ${webFiles}, Mobile ${mobileFiles})`,
  `- Inputs calendrier natifs Web : **${inputCount}**`,
  `- Violations du contrat UI détectées : **${violations.length}**`,
  "",
  "## Inventaire",
  "",
  "| Plateforme | Fichier | Termes date | Inputs date |",
  "|---|---|---:|---:|",
  ...inventory.map((item) => `| ${item.platform} | \`${item.file}\` | ${item.dateTerms} | ${item.dateInputs} |`),
  "",
  "## Inputs calendrier détectés",
  "",
  ...(nativeDateInputs.length
    ? ["| Plateforme | Fichier | Nombre |", "|---|---|---:|", ...nativeDateInputs.map((item) => `| ${item.platform} | \`${item.file}\` | ${item.count} |`)]
    : ["Aucun input calendrier natif détecté."]),
  "",
  "## Violations D1 / D5 / D7",
  "",
  ...(violations.length
    ? ["| Code | Plateforme | Fichier | Ligne | Correction |", "|---|---|---|---:|---|", ...violations.map((item) => `| ${item.code} | ${item.platform} | \`${item.file}\` | ${item.line} | ${item.correction} |`)]
    : ["Aucune violation détectée par le garde statique."]),
  "",
  "## Contrat cible",
  "",
  "- UI : `JJ-MM-AAAA`.",
  "- Date civile API/DB : `YYYY-MM-DD`.",
  "- Horodatage technique : ISO 8601.",
  "- Aucun parsing UTC implicite pour transformer une date civile.",
  "",
].join("\n");
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, lines, "utf8");

console.log(`DATE_AUDIT inventory_files=${inventory.length} web=${webFiles} mobile=${mobileFiles} native_date_inputs=${inputCount} violations=${violations.length}`);
for (const issue of violations) console.error(`DATE_VIOLATION ${issue.code} ${issue.platform} ${issue.file}:${issue.line} — ${issue.correction}`);

if (violations.length && !REPORT_ONLY) process.exitCode = 1;
