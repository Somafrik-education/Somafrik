const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = process.argv.includes("--report-only");
const REPORT_PATH = path.join(ROOT, "docs", "audits", "date-fields-web-mobile.generated.md");
const TARGETS = [
  { platform: "Web", root: path.join(ROOT, "web", "src"), uiSegments: ["pages", "components", "design-system"] },
  { platform: "Mobile", root: path.join(ROOT, "Mobile", "src"), uiSegments: ["screens", "components"] },
];
/** Lib métier avec date visible utilisateur — ne plus échapper au scan D7. */
const FORCE_UI_FILES = new Set(["web/src/lib/unpaidModule.ts"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE = /(?:\.test\.|\.spec\.|__tests__|\/lib\/dates\.(?:ts|js)$)/;
const DATE_NAME = /\b(?:date|Date|startDate|endDate|birthDate|dueDate|paidAt|createdAt|updatedAt|scheduledAt|publishedAt|sentAt|enrollmentDate|paymentDate|attendanceDate)\b/g;
const RULES = [
  ["D7_DIRECT_LOCALE", /\.toLocaleDateString\s*\(/g, "Utiliser le contrat dates.ts pour une date utilisateur."],
  ["D7_DIRECT_INTL", /Intl\.DateTimeFormat\s*\(/g, "Centraliser le format utilisateur dans dates.ts."],
  ["D1_BAD_PLACEHOLDER", /(?:DD\/MM\/YYYY|JJ\/MM\/AAAA)/g, "Le contrat UI est JJ-MM-AAAA."],
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

function isAllowedLocaleCalendarLabel(source, index) {
  const window = source.slice(index, index + 180);
  return /month:\s*["']long["']/.test(window) && /year:\s*["']numeric["']/.test(window);
}

const inventory = [];
const violations = [];
const nativeDateInputs = [];
for (const target of TARGETS) {
  for (const file of walk(target.root)) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    if (IGNORE.test(`/${relative}`)) continue;
    const source = fs.readFileSync(file, "utf8");
    const scanSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const isUi =
      target.uiSegments.some((segment) => relative.includes(`/${segment}/`)) || FORCE_UI_FILES.has(relative);
    const dateTerms = [...source.matchAll(DATE_NAME)].length;
    const dateInputs = target.platform === "Web" ? [...scanSource.matchAll(/type\s*=\s*["']date["']/g)].length : 0;
    if (dateTerms || dateInputs) inventory.push({ platform: target.platform, file: relative, dateTerms, dateInputs });
    if (dateInputs) nativeDateInputs.push({ platform: target.platform, file: relative, count: dateInputs });
    if (!isUi) continue;

    for (const [code, regex, correction] of RULES) {
      regex.lastIndex = 0;
      for (const match of source.matchAll(regex)) {
        const index = match.index ?? 0;
        const line = source.slice(0, index).split("\n").length;
        const lineText = source.split("\n")[line - 1]?.trim() ?? "";
        if (code === "D1_BAD_PLACEHOLDER" && (lineText.startsWith("//") || lineText.startsWith("*") || lineText.startsWith("/**"))) continue;
        if (code === "D7_DIRECT_LOCALE" && isAllowedLocaleCalendarLabel(source, index)) continue;
        violations.push({ code, platform: target.platform, file: relative, line, correction });
      }
    }
  }
}

const webFiles = inventory.filter((item) => item.platform === "Web").length;
const mobileFiles = inventory.filter((item) => item.platform === "Mobile").length;
const inputCount = nativeDateInputs.reduce((n, item) => n + item.count, 0);
const byCode = violations.reduce((acc, item) => {
  acc[item.code] = (acc[item.code] ?? 0) + 1;
  return acc;
}, {});
const lines = [
  "# Audit automatisé des dates Web / Mobile",
  "",
  "> Généré par `scripts/audit-date-ui-contract.js`. Ne pas éditer manuellement.",
  "",
  `- Fichiers candidats : **${inventory.length}** (Web ${webFiles}, Mobile ${mobileFiles})`,
  `- Inputs calendrier natifs Web : **${inputCount}**`,
  `- Violations du contrat UI détectées : **${violations.length}**`,
  `- D1 : **${byCode.D1_BAD_PLACEHOLDER ?? 0}** · D7 locale : **${byCode.D7_DIRECT_LOCALE ?? 0}** · D7 Intl : **${byCode.D7_DIRECT_INTL ?? 0}**`,
  "",
  "## Inventaire",
  "",
  "| Plateforme | Fichier | Termes date | Inputs date |",
  "|---|---|---:|---:|",
  ...inventory.map((item) => `| ${item.platform} | \`${item.file}\` | ${item.dateTerms} | ${item.dateInputs} |`),
  "",
  "## Inputs calendrier détectés",
  "",
  ...(nativeDateInputs.length ? ["| Plateforme | Fichier | Nombre |", "|---|---|---:|", ...nativeDateInputs.map((item) => `| ${item.platform} | \`${item.file}\` | ${item.count} |`)] : ["Aucun input calendrier natif détecté."]),
  "",
  "## Violations D1 / D7",
  "",
  ...(violations.length ? ["| Code | Plateforme | Fichier | Ligne | Correction |", "|---|---|---|---:|---|", ...violations.map((item) => `| ${item.code} | ${item.platform} | \`${item.file}\` | ${item.line} | ${item.correction} |`)] : ["Aucune violation détectée par le garde statique."]),
  "",
  "## Contrat cible",
  "",
  "- UI : `JJ-MM-AAAA`.",
  "- Date civile API/DB : `YYYY-MM-DD`.",
  "- Horodatage technique : ISO 8601.",
  "- Les libellés de calendrier mois/année (ex. septembre 2026) ne sont pas des dates civiles complètes et restent localisés.",
  "- Les noms de fichiers et sérialisations ISO internes ne sont pas assimilés à un affichage UI.",
  "- Aucun parsing UTC implicite pour transformer une date civile.",
  "",
].join("\n");
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, lines, "utf8");

console.log(`DATE_AUDIT inventory_files=${inventory.length} web=${webFiles} mobile=${mobileFiles} native_date_inputs=${inputCount} violations=${violations.length}`);
for (const issue of violations) console.error(`DATE_VIOLATION ${issue.code} ${issue.platform} ${issue.file}:${issue.line} — ${issue.correction}`);
if ((violations.length || nativeDateInputs.length) && !REPORT_ONLY) process.exitCode = 1;
